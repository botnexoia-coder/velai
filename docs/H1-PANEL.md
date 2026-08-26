# Horizonte 1 — lo barato que se nota

> Semanas, no meses. Mapa y justificación del orden en [`PLAN-PANEL.md`](./PLAN-PANEL.md).
> Cinco entregables; los cuatro primeros son autocontenidos, el quinto depende de
> comprobar contra la API viva de Twilio.
>
> Al cerrar el horizonte: borrar este doc, resumen a `IMPLEMENTADO.md`, restos a
> `TAREAS-PENDIENTES.md`.

---

## §1. Guardar la conversación en D1 — el cimiento

**Por qué primero.** Hoy la conversación vive en `KV` con TTL de 24 h y solo los últimos
20 mensajes (`worker/app.js:1559` para web, `:1818` para WhatsApp). Cuando un lead sale
mal no hay forma de mirar qué pasó. Y desbloquea el informe con la línea de «no supe
contestar» (§2), las conversaciones no resueltas (H2 §2), responder desde el panel
(H2 §4) y la traza del «Probar» (H2 §3).

**Alcance de esta fase: guardar y *leer*. No responder.** Eso cierra el 80% del hueco
según el análisis, y responder trae la ventana de 24 h de Meta encima (H2 §4).

### D1 sustituye a KV, no lo acompaña

Decisión del 2026-08-26, con los números en
[`VOLUMEN-Y-ALMACENAMIENTO.md`](./VOLUMEN-Y-ALMACENAMIENTO.md): el techo de volumen del
sistema **no está en D1** (332 KB de 500 MB, margen de ~140×) **sino en KV** (1.000
escrituras/día, cinco por turno de chat → margen de ~5×).

Así que `conversations` + `conv_messages` no son una copia de archivo: son **la fuente
única del estado de la conversación**. El `env.KV.put('conv:web:…')` de
`worker/app.js:1593` y su gemelo de WhatsApp (`:1818`) **se borran**. La escritura a D1
la íbamos a hacer igual, así que esto no cuesta trabajo extra y sube el techo de ~25 a
~60 conversaciones/día.

Lo que NO se hace: repartir la conversación entre KV (caliente) y D1 (frío). Duplica el
estado y obliga a decidir cuál manda cuando discrepan — el mismo patrón que produjo el
«verde en Twilio y mudo a la vez» de GOgestión.

### Migración `0021_conversaciones_historial.sql`

`conv_daily` (0020) es un contador agregado y se queda como está — es el denominador de
la tasa de captura. Esto es aparte:

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,              -- uuid propio, NO el conversationId del widget
  tenant_id TEXT NOT NULL,
  channel TEXT NOT NULL,            -- 'web' | 'whatsapp'
  external_id TEXT NOT NULL,        -- conversationId (web) | teléfono normalizado (wa)
  demo TEXT NOT NULL DEFAULT '',    -- clave de demo; '' = conversación real
  lead_id TEXT,                     -- se rellena al capturar; NULL = sin lead
  msgs INTEGER NOT NULL DEFAULT 0,
  unanswered INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (tenant_id, channel, external_id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_last ON conversations (tenant_id, last_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_expires ON conversations (expires_at);

CREATE TABLE IF NOT EXISTS conv_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conv_messages (conversation_id, id);
```

Notas de diseño:

- **`id` propio, no el `conversationId` del widget.** Ese lo elige el navegador; es
  entrada de usuario y no puede ser clave primaria. `UNIQUE(tenant_id, channel,
  external_id)` es lo que hace idempotente el upsert.
- **`demo`** existía como campo del estado en KV y sostiene la guarda
  `conversation_mode_mismatch` (`worker/app.js:1567`). Al morir KV tiene que vivir aquí.
- **`unanswered`** se incrementa cuando la respuesta del modelo cae en el patrón de «no
  lo sé». Contarlo al escribir evita reprocesar transcripciones enteras después.
- **`lead_id`** cierra el círculo con `leads.conversation_id`, que ya existe (0001).
- **Sin tope duro de mensajes por conversación, a propósito.** KV caducaba a las 24 h y
  eso acotaba de rebote cuánto crecía un historial; D1 no caduca solo, así que la primera
  idea fue un tope de 200 mensajes. Se descartó: en WhatsApp la dirección es el teléfono
  y un tope por conversación **enmudecería para siempre a un cliente real de verdad**. Lo
  que ya acota es suficiente y no tiene ese riesgo — la sesión de 72 h corta la fila, el
  limitador de 20/min por `conversationId` corta la ráfaga, y el cupo diario de IA por
  cliente (`ai_daily_limit`, 300 llamadas) pone el techo real de turnos al día.

### Lectura y escritura por turno

Reemplaza al par «leer KV / escribir KV» que hay hoy:

- **Leer**: `SELECT role, text FROM conv_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 20`,
  invertido. Se guarda **todo** y se le manda al modelo solo la ventana de 20 — hoy el
  `slice(-20)` de `worker/app.js:1568` *tira* lo viejo, que es justo lo que queremos
  dejar de hacer.
- **Escribir**: un `env.DB.batch()` de tres sentencias — upsert de `conversations` con
  `msgs = msgs + 2, last_at = ?` e insert de los dos mensajes. Se hace **await**, no
  `waitUntil`: es el estado de la conversación, y si falla el turno siguiente responde
  sin memoria. (Distinto de `recordConversation()` en `worker/app.js:1603`, que es un
  contador y sí va en `waitUntil` — contar no puede estropear una respuesta, pero
  recordar sí.)
- Sin `env.DB` el chat responde **503**, que es el mismo contrato que tenía KV: sin
  almacén no hay memoria, y responder sin memoria es peor que no responder.
- Si el `batch` falla con la base presente, la respuesta **sí se devuelve** (ya está
  pagada) y se registra `conv_state_not_saved`: el turno siguiente irá sin ese contexto.
  Tirar la respuesta para castigar un fallo de escritura sería peor para el visitante.

Al volumen actual son ~3 filas escritas y ~20 leídas por turno: 0,08% de las 100.000
escrituras diarias de D1. El techo por almacenamiento está en ~1.400 conversaciones/día
con 90 días de retención — unas 140 veces el volumen de hoy.

Se escribe **por turno**, no al cerrar la conversación: no hay evento de cierre fiable
(el visitante cierra la pestaña) y una conversación a medias es exactamente la que hay
que poder leer cuando algo va mal.

### Una conversación es una SESIÓN de 72 h

Implementado así, y merece constar porque cambia una métrica: la fila se reutiliza
mientras haya actividad y tras **72 h de silencio** la siguiente entrada abre una nueva.
Los 72 h son el estándar de facto del sector (Zendesk, HubSpot, Freshworks) para dar una
conversación por resuelta — el mismo que adopta `PLAN-PANEL.md`. De rebote acota cuánto
crece una fila y hace que el panel enseñe conversaciones discretas en vez de un hilo
infinito por teléfono.

**Efecto en la tasa de captura**: antes el canal WhatsApp contaba una conversación cada
vez que el historial de KV había caducado (24 h); ahora cada 72 h. El denominador baja un
poco y los dos canales pasan a contar con el MISMO criterio, que antes no ocurría. No
rompe series históricas: `conv_daily` arrancó el 2026-08-25 y el panel ya advierte de
que solo cuenta desde entonces.

Y una trampa esquivada: la conversación se **guarda** con su canal real (`messenger` ya no
se disfraza de `whatsapp`), pero el **contador** de `conv_daily` sigue diciendo `whatsapp`
para los dos. El panel cruza ese denominador con `leads.source`, y la captura de leads de
WhatsApp escribe `whatsapp` también para Messenger: separar solo el denominador le habría
dado a Messenger 0 leads sobre N conversaciones e inflado la tasa de WhatsApp. Se separan
los dos a la vez, o ninguno.

### Retención: 90 días — decidido el 2026-08-26

`leads` retiene 24 meses (`LEAD_RETENTION_MONTHS`), pero **no sirve de referencia**: un
lead es una ficha de contacto comercial y una transcripción no. `CONV_RETENTION_DAYS = 90`
(var del toml, editable sin migración), purgada en el mismo cron que limpia `leads`.

El plazo sale de la finalidad, no de una cifra redonda: depurar un lead que salió mal son
días, el informe semanal dos, y «lo que el bot no supo contestar» (H2 §2) trabaja en ciclos
mensuales de tres a cinco temas — 90 días dan un trimestre de tendencia, que es lo máximo
que esa pantalla llega a usar. Más allá no hay finalidad y sí hay riesgo: una transcripción
de clínica puede contener datos de salud (art. 9 RGPD), así que minimizar no es opcional.

**Uniforme a propósito**: una conversación que dio lead NO se guarda más tiempo. Sería
defendible (la transcripción es la prueba del lead) pero complica la purga y obliga a
decirle al cliente final «tu conversación se guarda dos años si dejaste el teléfono», que
es peor para él que la regla simple.

`/privacidad/` actualizado el 2026-08-26 (§2 quién puede leerlas, §3 la base jurídica de
la nueva finalidad, §4 el plazo). El clausulado anterior decía «24 horas en almacenamiento
temporal», que con esto habría pasado a ser falso.

### Lectura y panel

- `GET /api/admin/conversations` — lista paginada. Filtros: `channel`, `from`, `to`,
  `conLead` (sí/no), `sinResolver`. Scope por tenant con `resolveScope`/`scopeClause`,
  igual que leads: **el rol cliente solo ve las suyas**.
- `GET /api/admin/conversations/:id` — la transcripción completa.
- Vista nueva **Conversaciones** en el sidebar, entre Leads y Clientes. Lista con
  fecha, canal, nº de mensajes, si generó lead; al abrir, la transcripción.
- En la ficha del lead, enlace a su conversación (por `leads.conversation_id`).
- `GET /api/admin/conversations.csv` — exportar, como ya se exportan leads.

Sin PII en los logs, como el resto del worker: los códigos nuevos
(`conv_state_not_saved`, `conv_lead_not_linked`, `conv_purge_failed`) van sin texto de
mensaje. El que hay que vigilar es `conv_state_not_saved`: significa que alguien recibió
su respuesta pero el turno siguiente irá sin ese contexto.

---

## §2. Informe semanal al canal del cliente

**El hueco más grande del análisis: ni un solo proveedor español o latinoamericano envía
un resumen periódico automático.** Cliengo se acerca (informe a hasta cinco correos)
pero bajo demanda. Fuera del mercado hispano solo Intercom lo tiene. Y todos lo mandan
**por correo, donde una pyme no vive**.

Contenido de la v1, todo calculable con lo que habrá tras §1:

> *Esta semana: 14 conversaciones, 6 leads, 2 citas, 3 preguntas que no supe contestar.*

Más la comparación con la semana anterior (§3 lo deja hecho) y, cuando §4 esté,
el tiempo ahorrado.

### Telegram sí, WhatsApp después — corrección al plan original

El artifact dice «reutiliza `deliver()`». Solo a medias: `deliver()`
(`worker/app.js:1115`) está moldeado para un lead y usa `lead_template_sid`. Un informe
semanal por WhatsApp es un **mensaje iniciado por el negocio fuera de la ventana de
24 h**: necesita **su propia plantilla aprobada por Meta**, provisionada por subcuenta
con la misma maquinaria que la de leads (`template/check`, `template/resubmit`). Eso no
es gratis y arrastra los tiempos de aprobación de Meta.

→ **H1 entrega Telegram** (sin restricción de ventana, y es donde ya está el dueño).
La plantilla `velai_weekly_report` y el envío por WhatsApp son un segundo paso, no un
bloqueante del primero.

### Sin cron nuevo: el informe viaja en el de 5 minutos — cambio sobre la spec

La spec pedía un segundo trigger (`0 7 * * 1`) y ramificar `scheduled()` por `event.cron`.
**No se hizo, y el resultado es mejor.** El informe lo manda el cron de 5 minutos que ya
existe, dentro de una **ventana** de 24 h que abre el lunes a las 07:00 UTC:

- **Reintento gratis.** Un fallo de Telegram se vuelve a intentar en el tick siguiente en
  vez de esperar una semana. Con un trigger único, un 500 de Telegram a las 07:00 del
  lunes = informe perdido hasta el lunes siguiente.
- **Coste cero fuera de la ventana.** `reportPeriod()` mira el día y la hora en JS y sale
  sin tocar D1. Los otros 6 días no cuestan ni una consulta.
- **El tope de consultas de D1 deja de ser un riesgo.** El plan gratuito da **50 consultas
  por invocación** del Worker. Cuatro métricas × dos periodos × N clientes se lo come con
  seis clientes (48). Se resolvió con **un `GROUP BY` por tabla para todo el lote** — tres
  consultas, sean 6 clientes o 60 — y con lotes de 5 clientes por tick, así que el
  siguiente tick sigue por donde iba.

Los crons de Cloudflare son UTC: son las 09:00 en horario de verano y las 08:00 en
invierno. Se acepta el desfase de una hora; no merece lógica de husos.

### Idempotencia, baja y honestidad

`tenant_reports` (PK `tenant_id + period_start`) se **reserva antes de enviar**
(`status='sending'`), así que dos ticks no mandan dos informes. `attempts` acota a 3: sin
tope, un fallo permanente reintentaría en cada tick durante las 24 h de la ventana (288
veces). Un cliente sin `telegram_chat_id` es un **`skipped` visible con su motivo**, no un
silencio — el mismo criterio que la entrega dual de leads.

`tenants.weekly_report` (default 1) con su interruptor en **Conexiones → Informe semanal**.
Intercom resuelve la baja con un clic y es lo mínimo esperable de algo que llega sin
pedirlo. Va por el endpoint `/notify`, que es donde ya viven los avisos.

Dos decisiones de honestidad en el contenido:

- **La comparación se calla cuando no es comparable.** El historial arrancó el 2026-08-26,
  así que en los primeros informes la semana anterior es cero *por no haber existido*, no
  por no haber pasado nada. Un «▼ 100%» ahí sería mentira.
- **Una semana en blanco no se disfraza de informe con cuatro ceros.** Dice que no entró
  ninguna conversación y manda a **Canales**, que es lo que este panel hace mejor que
  nadie: comprobar de verdad si los avisos pueden salir. Un cero repetido cada lunes es
  una señal de baja; un cero que te dice qué mirar es servicio.

## §3. Comparativa con el periodo anterior

En cada tarjeta del Dashboard. Convierte un contador en un informe, y es la única
función de la tabla comparativa que solo tiene Gorgias.

En `/api/admin/stats` (`worker/app.js:2628`) cada consulta de 30 días gana su gemela
desplazada — `created_at >= datetime('now','-60 days') AND created_at < datetime('now','-30 days')` —
y la respuesta devuelve `{ valor, anterior }` por métrica. Es literalmente un `WHERE`
desplazado; el `batch()` ya existe y absorbe las sentencias nuevas.

**Trampa a evitar:** `captura.desde` es `CONV_TRACKING_SINCE` (2026-08-25). Hasta finales
de septiembre la ventana anterior **no tiene denominador**, y una comparación con cero
pintaría un -100% falso. Cuando `desde` cae dentro del periodo anterior, la tarjeta
enseña «—» y el motivo, no un porcentaje. El panel ya advierte de esto en la tasa de
captura; misma honestidad aquí.

---

## §4. Tiempo y dinero ahorrado

Solo Bookline y 1MillionBot traducen a lenguaje de dueño (`ETC`, horas humanas
ahorradas); Gorgias lo hace en soporte con dos tarjetas de primer nivel. Para Velai la
fórmula es aritmética:

```
horas_ahorradas = conversaciones_atendidas × minutos_por_conversación / 60
dinero_ahorrado = horas_ahorradas × coste_hora
```

**Lo importante no es la fórmula, son los supuestos visibles y editables por el
cliente.** Un número que el cliente puede ajustar es un número que defiende él.

```sql
ALTER TABLE tenants ADD COLUMN savings_minutes REAL;   -- NULL = usar el default
ALTER TABLE tenants ADD COLUMN savings_cost_hour REAL;
```

Defaults en `[vars]`, no en el esquema, para poder moverlos sin migración. La referencia
citable es el informe de ROI de Intercom: **6–12 $ por ticket atendido por una persona**.
La tarjeta enseña el supuesto usado en letra pequeña, con un lápiz para cambiarlo.

Cuenta conversaciones, no leads, y lo dice: *«supone que cada una de las 14
conversaciones habría costado 6 minutos a una persona»*.

---

## §5. Estado granular de plantillas

Velai ya tiene lo difícil — crear, comprobar a demanda, reenviar a aprobación y mostrar
la respuesta cruda de Twilio (`handleProvision`, `template/check` en
`worker/app.js:2288`; el barrido del cron en `:3563`). Lo que falta es que enseñe **siete
estados donde hoy enseña dos**.

Patrón a copiar casi literal (Respond.io):
`Processing / In Review / Approved / Rejected / Flagged / Paused / Appeal`, más:

- **el motivo de rechazo** y el **quality rating** traídos de Meta,
- sincronización automática con botón manual de respaldo (ya existe el botón),
- el **contador de ediciones** a la vista: 10 en 30 días, 1 cada 24 h en las aprobadas,
- y **valores de ejemplo obligatorios para cada parámetro** al crear la plantilla — es
  la causa de rechazo número uno según la documentación de Meta y de Wati.

```sql
ALTER TABLE tenants ADD COLUMN lead_template_reason TEXT;
ALTER TABLE tenants ADD COLUMN lead_template_quality TEXT;
ALTER TABLE tenants ADD COLUMN lead_template_checked_at TEXT;
ALTER TABLE tenants ADD COLUMN lead_template_edits_json TEXT;   -- [{at}] de las ediciones
```

`deliver()` seguirá bloqueando el envío con cualquier estado ≠ `approved`
(`worker/app.js:1160`), así que el `CHECK` no cambia de semántica: solo se ensancha el
vocabulario de lo que se muestra.

**Por qué va al final del horizonte:** es el único entregable cuyo alcance depende de
qué expone de verdad la API de Twilio. `rejection_reason` está documentado; el *quality
rating* vive en el lado WABA/Meta y puede no venir en la respuesta de aprobación de
Content API.

- [ ] **Verificar en vivo** contra una plantilla real (GOgestión sirve: su plantilla
      estuvo en `pending` eterno porque nunca llegó a Meta — es justo el caso que un
      panel así habría enseñado el primer día) qué campos devuelve Twilio, y recortar el
      alcance a los que existan antes de escribir la UI.
