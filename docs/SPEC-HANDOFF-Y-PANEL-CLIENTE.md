# Spec — A) Handoff a humano · B) Panel por cliente (solo lectura)

> **Estado (2026-08-18): AMBAS PARTES APLICADAS Y DESPLEGADAS** (suite 48/48, con los
> 8 tests de fuga del §B.6 y los 5 del §A.7). Notas de implementación: (1) el centinela
> `[[HUMANO]]` también se quita en el canal web, aunque la pausa v1 sea solo de WhatsApp
> (§A.1); (2) las escaladas activas se listan en el panel (chips ⏸ con "Reanudar bot",
> vía `GET /api/admin/escalations` sobre las claves `pause:*` de KV, con scope por rol);
> (3) el 404-no-403 del lead ajeno se aplica también al PATCH (0 cambios = 404);
> (4) `ADMIN_EMAILS` arrancó con `botnexo.ia@gmail.com` — añadir el resto de admins de
> Velai a la variable. Alta de usuario cliente = 2 pasos (Access + fila en
> `tenant_users`), documentado en OPERATIONS.

> Dos PRs independientes, en este orden. El A resuelve el agujero que abre pasar el número a la API
> (el equipo del cliente pierde WhatsApp Web y no tiene dónde atender). El B es el que convierte el
> producto: *"os avisamos de vuestros leads"* → *"tenéis vuestro panel"*.
>
> El B es **crítico en seguridad**: un fallo de aislamiento es un cliente viendo los leads de otro.
> Su §B.3 no es negociable.

---

# PARTE A — Handoff: el bot se calla cuando entra un humano

## A.1 El problema concreto

Cuando el número del cliente pasa a la API, la app de WhatsApp deja de funcionar en él: sus 3
personas atendiendo por WhatsApp Web se quedan sin herramienta. Hasta que haya bandeja, lo mínimo
imprescindible es que **el bot deje de contestar cuando el caso pasa a una persona**, para que no
haya dos voces en la misma conversación.

## A.2 Cómo se dispara

Tres vías, por orden de importancia:

1. **El cliente final lo pide** ("quiero hablar con una persona", "un humano", "que me llame
   alguien"). No lo detectes con palabras clave: se escapan la mitad de las formas de pedirlo.
   Para v1, sin cambiar la arquitectura de una sola llamada al modelo: añade a `GUARDRAILS` la
   instrucción de terminar la respuesta con el centinela `[[HUMANO]]` **solo** cuando la persona pida
   hablar con alguien del equipo. El worker lo detecta, **lo quita del texto** antes de enviar, y pausa.
   ```js
   const WANTS_HUMAN = /\[\[HUMANO\]\]/;
   const wantsHuman = WANTS_HUMAN.test(reply);
   reply = reply.replace(WANTS_HUMAN, '').trim();   // nunca debe llegar al cliente final
   ```
   Cuando se implemente la herramienta de consulta de la base de conocimiento (ver
   `CONTEXTOS-AMPLIOS.md` §C), esto migra a una tool `escalar_a_humano(motivo)`, que es más limpio.
2. **Pausa manual desde el panel**, por conversación.
3. *(No en v1)* frustración detectada o fallos repetidos: no hay forma fiable de medirlo todavía.

## A.3 Estado de la pausa

Una clave en KV, sin tabla nueva: `pause:<tenant.id>:<from>` con TTL de **4 horas**.

- La pausa es **por tenant y por cliente final**. Nunca global: un handoff de la barbería no puede
  callar al bot de la clínica.
- Al expirar el TTL el bot vuelve solo. Es deliberado: si nadie atendió en 4 h, mejor que el bot
  siga que un silencio indefinido.
- Reanudar antes: botón en el panel que borra la clave.

## A.4 Qué hace el worker mientras está pausado

En `handleTwilio`, después de resolver el tenant y **antes** de llamar al modelo:

```js
  const pauseKey = `pause:${tenant.id}:${from}`;
  if (env.KV && await env.KV.get(pauseKey)) {
    // Guardamos el mensaje en el historial pero NO contestamos: hay una persona en la
    // conversación y dos voces es peor que ninguna. TwiML vacío = 200 sin respuesta.
    history.push({ role: 'user', content: message });
    await env.KV.put(key, JSON.stringify(history.slice(-20)), { expirationTtl: 86400 });
    console.log(JSON.stringify({ level: 'info', code: 'bot_paused', tenant: tenant.slug }));
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
  }
```

Tres cosas que **no** debe hacer estando pausado: llamar al modelo (cuesta dinero), contestar, y
volver a avisar en cada mensaje (antirebote: el aviso sale una vez por ventana de pausa).

## A.5 El aviso de escalada

Distinto del aviso de lead: no lleva teléfono ni datos cualificados, lleva urgencia.

- **v1: Telegram a Velai**, instantáneo y gratis, con el tenant, el `From` y el último mensaje.
  Y marca en el panel para que se vea en la lista.
- **Después: plantilla de WhatsApp al equipo del cliente** (`escalada_<slug>`, categoría Utility).
  Necesita aprobación de Meta, así que va cuando su plantilla de leads ya esté aprobada.

## A.6 Dónde responde el humano

Con esta versión, en ningún sitio dentro de Velai: el equipo del cliente llama por teléfono o escribe
desde **su** WhatsApp (el número de aviso, que es distinto del del bot). Funciona, y es honesto
decirlo así: el cliente final recibe un mensaje desde otro número.

El paso natural siguiente —y lo que convierte esto en bandeja— es una **vista de conversación en el
panel con un cuadro de respuesta**. Requiere dos cosas que hoy no hay: persistir la conversación en
D1 (el historial vive en KV con TTL de 24 h y 20 mensajes) y respetar la ventana de 24 h (pasada,
solo plantilla). Es el PR siguiente, no este.

## A.7 Tests

1. Conversación pausada → 200, TwiML vacío, **cero llamadas al modelo**, y el mensaje sí queda en el
   historial.
2. El centinela `[[HUMANO]]` **nunca** aparece en el texto enviado al cliente final.
3. Detectado el centinela: se crea la clave de pausa y sale **un** aviso; el segundo mensaje del
   cliente final en la misma ventana no genera un aviso nuevo.
4. La pausa es por tenant + remitente: pausar la barbería no calla a la clínica.
5. Expirado el TTL, el bot vuelve a contestar.

---

# PARTE B — Panel por cliente, solo lectura

## B.1 Qué ve cada rol

| | **Velai (admin)** | **Cliente** |
|---|---|---|
| Leads | Todos, con columna *Cliente* | **Solo los suyos**, sin columna *Cliente* |
| Cambiar estado y añadir nota | Sí | Sí |
| Exportar CSV | Todo | Solo lo suyo |
| Reintentar avisos | Sí | **No** (cuesta dinero) |
| Borrado RGPD | Sí | **No** |
| Pestaña Clientes, aprovisionamiento, credenciales | Sí | **No existe en su interfaz** |
| Filtro por cliente | Sí | **No** (vería nombres de otros negocios) |
| Métricas | Globales | Solo de su tenant |

Solo lectura de la configuración y escritura mínima sobre sus propios leads. Cero acceso a nada que
cueste dinero o revele a otro cliente.

## B.2 Identidad → alcance

Cloudflare Access **autentica**; **autorizar es del worker**. Hoy `adminIdentity` devuelve el correo y
**ninguna consulta filtra por tenant**.

`migrations/0006_tenant_users.sql`:

```sql
-- Quién entra al panel y con qué alcance. Access valida la identidad; esta tabla decide
-- qué puede ver. Un correo pertenece a un solo tenant.
CREATE TABLE tenant_users (
  email TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  role TEXT NOT NULL DEFAULT 'cliente',   -- 'cliente'
  created_at TEXT NOT NULL
);
```

Los administradores de Velai **no** van en la tabla: van en `ADMIN_EMAILS` (var de
`wrangler.toml`, lista separada por comas). Motivo: si la tabla se corrompe o se borra una fila,
nadie debe quedar bloqueado fuera de su propio panel.

```js
// Access dice QUIÉN eres; esto dice QUÉ puedes ver. Sin coincidencia no se entra:
// que Access te deje pasar no te autoriza a ver leads de nadie.
async function resolveScope(env, email) {
  const admins = clean(env.ADMIN_EMAILS, 500).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (admins.includes(String(email).toLowerCase())) return { role: 'velai', tenantId: null, email };
  const row = await env.DB.prepare('SELECT tenant_id, role FROM tenant_users WHERE lower(email) = ?')
    .bind(String(email).toLowerCase()).first();
  if (!row) throw new HttpError(403, 'not_authorized');
  return { role: 'cliente', tenantId: row.tenant_id, email };
}
```

## B.3 El aislamiento: un único punto de paso — **no negociable**

Si el filtro por tenant se escribe endpoint por endpoint, el día que alguien olvide un
`AND tenant_id = ?` un cliente ve los leads de otro. Todas las consultas del panel pasan por helpers
que **reciben el scope y no se pueden invocar sin él**:

```js
// Con scope.tenantId = null (Velai) la condición se anula; con un tenantId, filtra. Ningún
// endpoint del panel construye SQL de leads sin pasar por aquí.
function scopeClause(scope) {
  return scope.tenantId
    ? { sql: ' AND l.tenant_id = ?', args: [scope.tenantId] }
    : { sql: '', args: [] };
}
```

Reglas concretas:

1. **Lead por id**: `WHERE id = ? AND (?2 IS NULL OR tenant_id = ?2)` → si no es suyo, **404**, no
   403. Un 403 confirmaría que el lead existe.
2. **Listado, métricas y CSV**: siempre con `scopeClause`.
3. **Rutas prohibidas para `cliente`**: todo `/api/admin/tenants*`, todo `/provision/*`, el borrado
   RGPD y el reintento de avisos → **403 `not_authorized`**, comprobado en el router antes de tocar D1.
4. **Nada de tenant en las respuestas de un cliente**: ni nombres, ni slugs, ni el desplegable de
   clientes, ni `tenant_id` de otros. Su propio nombre, en el encabezado, sí.
5. **La interfaz no es la defensa.** Ocultar la pestaña está bien para no confundir, pero cada
   endpoint valida por su cuenta: un cliente curioso escribe la URL a mano.

## B.4 Auditoría

Cada escritura registra `actor` **y** `role`. Un cliente cambiando el estado de su lead tiene que
poder distinguirse de Velai haciéndolo. Reutiliza el patrón de `tenant_versions` con una tabla
`lead_events` o añade `actor_role` donde ya se guarda el actor.

## B.5 Configuración de Access

- Añadir los correos de cliente a la política de la app existente (o una segunda política sobre el
  mismo hostname). Con OTP no necesitan contraseña: reciben un código en su correo.
- Documentar en `OPERATIONS.md` que **dar de alta a un usuario de cliente son dos pasos**: su correo
  en Access **y** su fila en `tenant_users`. Solo Access no da acceso a nada (403 del worker); solo la
  fila tampoco (no pasa de Access). Es defensa en profundidad a propósito.

## B.6 Tests de fuga — los que de verdad importan

1. Identidad de cliente pidiendo el **UUID de un lead de otro tenant** → **404**.
2. Listado con leads de dos tenants en D1: la identidad de cliente ve **solo los suyos** (comprobar
   por recuento **y** por ids).
3. Cliente en `/api/admin/tenants`, `/provision/subaccount`, borrado RGPD y reintento → **403**, y
   **sin** consultas a D1 (espiar `env.DB`).
4. CSV de un cliente: ninguna fila de otro tenant, y ninguna columna que revele otros tenants.
5. Métricas de un cliente: cuentan solo lo suyo.
6. Correo que pasa Access pero **no** está en `tenant_users` ni en `ADMIN_EMAILS` → **403**.
7. `ADMIN_EMAILS` vacío → ningún admin, pero **los clientes siguen funcionando** (fallo cerrado, sin
   escalada accidental de privilegios).
8. Ninguna respuesta dirigida a un cliente contiene `twilio_auth_token_enc`, `twilio_subaccount_sid`
   ni nombres de otros tenants (regex sobre el JSON completo).

## B.7 Orden dentro del PR

Migración → `resolveScope` → helpers de alcance → aplicar en **todos** los endpoints → prohibiciones
del router → interfaz por rol → tests de fuga. **Los tests de fuga se escriben antes de tocar la
interfaz**: son la razón de ser del PR.

---

## Lo que este par de PRs deja pendiente a propósito

- **Bandeja de conversación con respuesta** (persistir en D1 + ventana de 24 h + asignación).
- **Plantilla de escalada** aprobada por cliente.
- **Resumen diario** por WhatsApp o email.
- **Roles dentro de un cliente** (dueño vs empleado): hoy todos sus usuarios ven lo mismo.
