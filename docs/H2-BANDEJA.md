# Bandeja de conversaciones — responder desde el panel

> Pedido de Juan el 2026-08-26 con dos capturas de referencia: lista de conversaciones a
> la izquierda con filtros por canal, hilo a la derecha, cajón de escritura abajo.
> Es **H2 §4 adelantado** (`H2-PANEL.md`) más una reforma de la vista Conversaciones que
> se desplegó en H1 §1: de lista + modal a bandeja de dos paneles.
>
> Lo tienen las 8 plataformas DIY, Cliengo y Zenvia. No es un diferenciador: es paridad.
> Lo que sí puede ser diferenciador es **hacerlo honesto**, y de eso va casi toda la spec.

---

## Lo que ya está construido (más de lo que parece)

| Pieza | Dónde |
| --- | --- |
| El hilo completo, por sesión de 72 h | `conversations` + `conv_messages` (migración 0021) |
| Lectura con aislamiento por tenant | `GET /api/admin/conversations[/:id]` |
| **Salida de texto libre por WhatsApp** | `sendTwilioText()` — ya la usa el camino asíncrono del calendario |
| **Silenciar al bot cuando entra una persona** | `pause:<tenant>:<from>` en KV, 4 h de TTL, más la vista de escalaciones y su botón de reanudar |
| Enrutado y credenciales por subcuenta | `deliver()` y la regla de oro: los recursos de una subcuenta se operan con SUS credenciales |

O sea: el almacén, la lectura, la salida y el handoff **existen**. Lo que falta es
coserlo, la UI de dos paneles, y las tres cosas de abajo — que son el trabajo real.

---

## 1. La ventana de 24 horas de Meta — la parte difícil

`sendTwilioText()` manda **texto libre**, y eso solo es legal dentro de la ventana de
atención al cliente de 24 h que abre el ÚLTIMO mensaje entrante del usuario. Fuera de
ella WhatsApp lo rechaza con `63016` y hace falta una plantilla aprobada.

Un cajón de escritura que no lo sabe es una trampa: el agente escribe, pulsa enviar, y el
mensaje muere en Twilio. **Wati es el único del grupo que expone la ventana como
métrica**, y es exactamente lo que hay que copiar.

El dato ya está, sin migración: `conv_messages.role = 'user'` marca lo entrante.

```sql
SELECT MAX(created_at) FROM conv_messages WHERE conversation_id = ? AND role = 'user'
```

- Dentro de la ventana: cajón normal, con **el tiempo restante a la vista** (no un
  semáforo verde: las horas que quedan).
- Fuera: cajón **deshabilitado** con el motivo escrito, no un envío que falla luego.
- El canal **web** no tiene ventana: es un widget, no WhatsApp. Pero tiene el problema
  opuesto y hay que decirlo igual — si el visitante cerró la pestaña, la respuesta no le
  llega a ningún sitio. Fuera de sesión, el cajón del canal web también se cierra.

## 2. ¿Por qué número se responde? — el hallazgo

`conversations` guarda `external_id` (el `From` del cliente final) pero **no la dirección
a la que escribió**. Con un solo número por cliente no importa; con dos, el panel no sabe
por cuál salir y `tenants.twilio_from` puede no ser el de llegada. El cliente final vería
la respuesta llegar **desde otro número**.

No es hipotético: la vista Canales ya marca «responde con otro número», y
`TAREAS-PENDIENTES.md` §2k lo tiene apuntado como fase 2 pendiente —
«respuesta saliente por el canal de llegada». **La bandeja convierte eso en obligatorio.**

Arreglo, y es barato:

```sql
ALTER TABLE conversations ADD COLUMN inbox_address TEXT;  -- el `To` del webhook
```

Se rellena en `handleTwilio` (el `to` ya está en la mano) y es el `From` de la respuesta.
Sin él no se responde: mejor un cajón cerrado con «no sé por qué número contestarte» que
una respuesta que sale por el número equivocado.

## 3. `role='agent'`: ahora es gratis, en tres meses no

`conv_messages.role` tiene `CHECK (role IN ('user','assistant'))`. Una respuesta humana no
es ninguna de las dos, y confundirla con la del bot rompe todo lo que viene después: la
tasa de resolución, «lo que el bot no supo contestar», y el CSAT medido aparte.

SQLite no puede ampliar un `CHECK` con `ALTER`: hay que reconstruir la tabla
(`CREATE` nueva → `INSERT SELECT` → `DROP` → `RENAME`). **La tabla se desplegó ayer y está
casi vacía: este es el momento más barato de toda la vida del proyecto para hacerlo.**
Dentro de tres meses son miles de filas y una ventana de migración de verdad.

```sql
role TEXT NOT NULL CHECK (role IN ('user','assistant','agent'))
agent_email TEXT   -- quién respondió; NULL salvo en 'agent'
```

Y de paso, para los no leídos de la captura:

```sql
ALTER TABLE conversations ADD COLUMN last_read_at TEXT;
```

Por conversación y no por usuario: una pyme no tiene dos agentes mirando la misma bandeja,
y `TAREAS-PENDIENTES` ya descartó asignación y etiquetas por eso mismo.

## 4. La pausa del bot no se decide, se hereda

Si una persona responde desde el panel, el bot **tiene que callarse**: dos voces en la
misma conversación es peor que ninguna. Y eso ya existe — `escalateToHuman()` escribe
`pause:<tenant>:<from>` con 4 h de TTL y `handleTwilio` lo respeta.

Así que responder desde el panel **escribe la misma pausa**. Sin mecanismo nuevo, sin
decisión nueva, y la vista de escalaciones con su botón de reanudar sigue valiendo tal
cual. Las 4 h se quedan: son las que ya hay, y cambiarlas es una línea el día que estorben.

## 5. Tiempo real: polling, con la cuenta hecha

Las capturas parecen tiempo real. WebSockets exigirían Durable Objects; no hace falta.

Pero el polling no es gratis y conviene medirlo antes que después: el plan gratuito de
Workers da **100.000 peticiones/día** (`CF_FREE_LIMITS.worker_requests`). Un panel abierto
8 h refrescando cada 5 s con dos llamadas son ~5.800 peticiones/día — por panel. Con seis
clientes, 35.000: un tercio del presupuesto en refrescar una pantalla.

Con **un solo endpoint** que devuelva lista y hilo abierto de una vez, cada **15 s**, y
**solo con la pestaña visible** (`document.visibilityState`): ~1.900 por panel, ~11.500
con seis. El 11%. Esa es la versión que se construye.

## 6. Lo que NO va en la v1

- **Instagram.** La captura de referencia lo lleva; Velai **no tiene canal de Instagram
  desplegado** (está apuntado en `TAREAS-PENDIENTES.md` como promesa de la web sin canal
  detrás). Un filtro que no filtra nada es exactamente la clase de mentira que este panel
  no se permite — la vista Canales calcula su diagnóstico en el worker para no poder
  mentir. El filtro aparece cuando exista el canal.
- **Enviar plantillas fuera de la ventana.** Es el picker, las variables y las plantillas
  aprobadas por subcuenta: un bloque entero. La v1 **dice** que la ventana se cerró; no
  finge poder saltarla. Enviar plantillas es el paso siguiente natural, junto con el
  informe semanal por WhatsApp (H1 §2), que necesita la misma maquinaria.
- **Asignación de conversaciones, etiquetas y colas de revisión.** Descartado en
  `PLAN-PANEL.md` con motivo: presuponen un equipo de agentes que una pyme no tiene.
- **Adjuntos.** El icono sale en la captura. Entra cuando alguien lo pida.

## 7. Estado: desplegado el 2026-08-26

Migración **0023** + los cuatro pasos de infraestructura + la UI de dos paneles.

Lo que se hizo tal como estaba escrito: la reconstrucción de `conv_messages` con
`role='agent'` y `agent_email` (con la tabla casi vacía, como tocaba), `inbox_address`
rellenado desde el `to` del webhook, `last_read_at`, `POST /conversations/:id/reply` con la
guarda de ventana **antes** de tocar Twilio, y `GET /inbox` devolviendo lista, contadores y
hilo abierto en una llamada para el polling de 15 s con la pestaña visible.

Detalles que aparecieron al construir:

- **`role='agent'` se le presenta al modelo como `assistant`.** La API solo conoce `user` y
  `assistant`, y el modelo TIENE que ver lo que dijo la persona del equipo: si no, al
  expirar la pausa de 4 h retomaría la conversación contradiciéndola. La burbuja del panel
  sí los distingue (verde, con el correo de quien respondió) — si no se distinguieran, nadie
  sabría si el cliente habló con Vai o con una persona, y la tasa de resolución mentiría.
- **`inbox_address` se rellena con `COALESCE`** en cada mensaje entrante. Las conversaciones
  abiertas antes de la migración lo tienen a `NULL`: en vez de quedarse mudas para siempre,
  el siguiente mensaje del cliente las repara. Mientras esté a `NULL`, el cajón se cierra
  diciendo por qué.
- **Marcar leído solo cuando hay algo nuevo.** Con polling cada 15 s, un `UPDATE`
  incondicional serían ~1.900 escrituras diarias por panel abierto para nada.
- **El scroll no salta si el lector no estaba abajo.** Bajar al final cada 15 s mientras
  alguien lee hacia arriba es insoportable.
- **El tope de 40 conversaciones se dice.** «las más recientes; filtra por fecha o canal
  para ver más atrás» — un tope callado se lee como «esto es todo».

### Lo que sigue fuera, y por qué

- **Responder por el canal web: no se puede, y lo dice.** El widget solo habla cuando el
  visitante escribe; no hay canal de vuelta desde el panel. Darle uno es otro trabajo
  (polling en el widget, o un canal push). El cajón se cierra con el motivo escrito.
- **Plantillas fuera de la ventana.** La v1 **dice** que la ventana se cerró; no finge poder
  saltarla. Comparte maquinaria con el informe semanal por WhatsApp: se harán juntas.
- **Instagram.** No se pinta la pestaña. Va por Meta igual que Messenger, así que se conecta
  cuando se conecte Facebook (Juan, 2026-08-26).
- **Asignación, etiquetas y adjuntos.**

## 8. Orden que se siguió

1. Migración: reconstruir `conv_messages` con `role='agent'` + `agent_email`; añadir
   `inbox_address` y `last_read_at` a `conversations`. **Primero porque es lo que se
   encarece con el tiempo.**
2. Rellenar `inbox_address` en `handleTwilio` (una línea) y en el chat web.
3. `POST /api/admin/conversations/:id/reply`: calcula la ventana, elige el `From` por
   `inbox_address`, envía con `sendTwilioText()`, guarda el turno como `agent` y escribe
   la pausa. Rechaza con motivo si la ventana está cerrada.
4. `GET /api/admin/inbox`: lista + hilo abierto en una llamada, para el polling.
5. La UI de dos paneles, sustituyendo la lista + modal de H1 §1.
6. No leídos y el contador por canal.

Los pasos 1-3 son la mitad del trabajo y son los que no se ven. El 5 es el que se
enseña.
