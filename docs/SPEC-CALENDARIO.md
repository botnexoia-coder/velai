# SPEC — Calendario: consulta de disponibilidad y agendado de citas por Vai

> **Estado**: propuesta (planificada 2026-08-20). **Alcance**: conexión de Google Calendar / Microsoft 365 por tenant, tool use en `callAnthropic`, agendado desde cualquier canal ya desplegado (web, WhatsApp, Messenger). Telegram-cliente e Instagram quedan explícitamente en fase aparte (§9).
> **Convenciones**: todo lo de `GUIA-WORKERS.md` aplica — `HttpError`, `clean()`, SQL con `bind()`, logs JSON sin PII, secretos cifrados write-only, tests `node --test` con mocks a mano, cero dependencias npm (los proveedores se llaman con `fetch` + `AbortSignal.timeout`, como `worker/twilio.js`).

## 0. Decisiones de arquitectura (resumen ejecutivo)

1. **Un módulo nuevo `worker/calendar.js`** (patrón `worker/twilio.js`/`cloudflare.js`): OAuth de ambos proveedores, renovación de access_token, freeBusy/listado y creación de eventos, y el cálculo puro de huecos (`freeSlots`) exportado para test.
2. **Tool use con la Messages API en crudo** (el repo ya llama a `api.anthropic.com` con `fetch`; no se introduce SDK). Bucle manual: `stop_reason === 'tool_use'` → ejecutar → `tool_result` → reenviar. Máximo **3 iteraciones**.
3. **El webhook de Twilio se vuelve asíncrono SOLO cuando el modelo pide una tool**: la primera llamada al modelo se mantiene síncrona (10 s como hoy); si `stop_reason` es `end_turn`, TwiML como siempre (latencia cero de regresión). Si es `tool_use`, se devuelve TwiML vacío YA y el bucle continúa en `ctx.waitUntil`, entregando la respuesta final por la Messages API de Twilio (texto libre, legal: estamos dentro de la ventana de 24 h porque el usuario acaba de escribir).
4. **Redirect OAuth en el hostname del panel** (`https://admin.hirevai.com/oauth/calendar/callback`): Cloudflare Access ya protege esa ruta (el admin conecta desde su navegador con la cookie de Access), y encima va `state` firmado en KV contra CSRF.
5. **refresh_token cifrado en D1 con `worker/crypto.js`**, AAD `calendar:<tenant_id>` (patrón `setting:<key>` de la tabla `settings`); **access_token en KV con TTL** = `expires_in - 60`.
6. **La fecha/hora actual NO puede entrar en el bloque de system cacheado** (rompería el contrato byte-a-byte de CONTEXTOS-AMPLIOS). Va en un **segundo bloque de system sin `cache_control`**, después del breakpoint.

---

## 1. OAuth por tenant

### 1.1 Qué crear fuera del repo (empezar YA, es el camino crítico)

**Google Cloud Console** (proyecto `velai-calendar`):
- Habilitar **Google Calendar API**.
- Pantalla de consentimiento OAuth: tipo **External**, marca de Velai, política de privacidad `https://hirevai.com/privacidad/`.
- Credencial **OAuth client ID (Web application)** con redirect URI exacto: `https://admin.hirevai.com/oauth/calendar/callback` (+ `http://localhost:8787/oauth/calendar/callback` para `wrangler dev`).
- Scope único: `https://www.googleapis.com/auth/calendar.events` (leer y escribir eventos; suficiente para listar ocupación del calendario elegido con `events.list` y crear citas — no pedir `calendar` completo).
- **RIESGO (el mayor del proyecto)**: `calendar.events` es un scope *sensible* → **verificación de la app por Google** (revisión de marca + demostración de uso; semanas, típicamente 2–6). Mientras la app esté en estado **Testing**, los refresh_token **caducan a los 7 días** y hay tope de 100 testers. Mitigación: (a) iniciar la verificación en la semana 1, en paralelo al desarrollo; (b) para el piloto, añadir a los clientes como *test users* y asumir reconexión semanal, documentado en el panel («conexión de prueba: caduca en 7 días»); (c) publicar "In production" sin verificar muestra la pantalla de "app no verificada" — aceptable solo internamente.

**Azure AD (Microsoft Entra)**:
- App registration **multi-tenant + cuentas personales** («Accounts in any organizational directory and personal Microsoft accounts»).
- Redirect URI (Web): el mismo callback.
- Client secret (rotación: caduca a 24 meses máximo — apuntarlo en OPERATIONS.md).
- Permisos delegados de Graph: `Calendars.ReadWrite`, `offline_access`, `openid email`. Sin admin consent forzoso (delegados); un tenant corporativo con consentimiento restringido necesitará aprobación de su IT — documentar en ALTACLIENTE.md. No hay proceso de verificación equivalente al de Google (riesgo menor).

**Variables/secrets del worker** (documentar en `.dev.vars.example` y `docs/OPERATIONS.md`):
- `[vars]`: `GOOGLE_OAUTH_CLIENT_ID`, `MS_OAUTH_CLIENT_ID` (no sensibles).
- Secrets (`wrangler secret put`): `GOOGLE_OAUTH_CLIENT_SECRET`, `MS_OAUTH_CLIENT_SECRET`.

### 1.2 Flujo de conexión (rutas nuevas, todas en el hostname admin)

```
POST /api/admin/tenants/:id/calendar/connect   {provider:'google'|'microsoft'}
  → genera state = crypto.randomUUID()
  → KV: calstate:<state> = {tenantId, provider, actor}  (TTL 600 s, un solo uso)
  → responde {authUrl}
     Google:  https://accounts.google.com/o/oauth2/v2/auth
              ?client_id&redirect_uri&response_type=code&scope=...calendar.events
              &access_type=offline&prompt=consent&state=<state>
     MS:      https://login.microsoftonline.com/common/oauth2/v2.0/authorize
              ?client_id&redirect_uri&response_type=code
              &scope=Calendars.ReadWrite offline_access openid email&state=<state>

GET /oauth/calendar/callback?code=...&state=...
  (hostname admin → Access delante; el worker ADEMÁS valida el JWT con adminIdentity
   — misma defensa en profundidad que el resto del panel)
  → lee y BORRA calstate:<state> (ausente/expirado → 403 invalid_oauth_state; CSRF cubierto)
  → intercambia code por tokens (fetch al token endpoint, timeout 10 s)
  → sin refresh_token → 400 oauth_no_refresh_token (Google solo lo da con prompt=consent)
  → cifra: encryptSecret(env, `calendar:${tenantId}`, refresh_token)
  → UPSERT en tenant_calendars (status 'connected', account_email del id_token/userinfo)
  → guarda access_token en KV caltoken:<tenantId> (TTL expires_in-60)
  → auditoría: fila en tenant_versions (field 'calendar', SIN tokens) + Telegram
  → redirect 302 a la ficha del tenant en el panel (#tenant=<id>&calendar=ok)
```

### 1.3 Renovación y revocación

- `calendarAccessToken(env, tenantCal)` en `worker/calendar.js`: KV hit → devolver; miss → descifrar refresh_token, POST al token endpoint del proveedor, guardar en KV. **Microsoft puede rotar el refresh_token en cada refresh**: si la respuesta trae uno nuevo, re-cifrar y actualizar la fila (patrón de rotación perezosa de `twilioAuthTokenFor`). Google no rota.
- Refresh fallido con `invalid_grant` (usuario revocó desde su cuenta): marcar `status='error'`, `last_error='invalid_grant'`, alerta a Telegram con antirebote 1 h (patrón `alertTenantMisconfigured`), y las tools dejan de ofrecerse (el bot vuelve a contestar sin calendario, nunca un 500).
- `DELETE /api/admin/tenants/:id/calendar`: Google → `POST https://oauth2.googleapis.com/revoke?token=<refresh>`; Microsoft no tiene revoke sencillo → basta borrar la fila. Borra fila + `caltoken:` + caché de config. Auditoría.

---

## 2. Modelo de datos — `migrations/0012_calendario.sql`

```sql
-- Conexión de calendario por tenant (1:1). El refresh_token va CIFRADO
-- (AES-256-GCM, AAD 'calendar:<tenant_id>'): un ciphertext copiado a otra fila no descifra.
CREATE TABLE tenant_calendars (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  provider TEXT NOT NULL CHECK (provider IN ('google','microsoft')),
  refresh_token_enc TEXT NOT NULL,
  account_email TEXT,                 -- solo para mostrar "conectado como" en el panel
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  business_hours TEXT,                -- JSON {"mon":[["09:00","14:00"],["16:00","20:00"]],...}; NULL = L-V 9-19
  status TEXT NOT NULL DEFAULT 'connected',  -- connected | error | revoked
  last_error TEXT,
  connected_by TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Citas agendadas por Vai: auditoría + panel. La fuente de verdad del hueco es el
-- calendario del proveedor; esta tabla es el registro de lo que Vai hizo.
CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  lead_id TEXT REFERENCES leads(id),  -- enlazable si la conversación ya capturó lead
  request_id TEXT NOT NULL UNIQUE,    -- idempotencia: reintento del bucle no duplica
  channel TEXT NOT NULL,              -- web | whatsapp | messenger
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  reason TEXT,
  starts_at TEXT NOT NULL,            -- ISO UTC
  ends_at TEXT NOT NULL,
  timezone TEXT NOT NULL,             -- la del negocio al agendar (para mostrar bien siempre)
  provider_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',   -- confirmed | cancelled | error
  created_at TEXT NOT NULL
);
CREATE INDEX appointments_tenant_starts_idx ON appointments(tenant_id, starts_at DESC);
```

Aislamiento multitenant: `tenant_id` obligatorio en ambas, índice por tenant, y el listado del panel pasa por el mismo patrón `scopeClause` que los leads. La config se cachea en KV (`calcfg:<tenantId>`, TTL 300) e **invalidateTenantCache se extiende** para borrarla junto con la fila del tenant.

---

## 3. Tool use en `callAnthropic`

### 3.1 Refactor mínimo (sin romper a los llamadores actuales)

- Extraer `callAnthropicRaw(env, payload, options)` que devuelve el **JSON completo** (hoy `callAnthropic` devuelve `content[0].text` y con tools eso puede ser un bloque `tool_use`). `callAnthropic` queda como wrapper que extrae el texto — contrato intacto, cero cambios en tests existentes.
- Nueva `runToolLoop(env, payload, tools, executor, options)`:

```
iter = 0
loop:
  response = callAnthropicRaw(env, {...payload, tools, max_tokens: 500}, options)
  si stop_reason !== 'tool_use' → devolver texto (concatenar bloques text)
  si ++iter > MAX_TOOL_ITERATIONS (3) → devolver texto de disculpa fija
    ('No he podido completar la gestión, el equipo te confirmará la cita.') + alerta log
  results = para CADA bloque tool_use (en paralelo, Promise.allSettled):
    executor(name, input) con timeout 5 s → string JSON compacto
    error → tool_result con is_error: true (nunca romper el bucle por un fallo del proveedor)
  messages.push({role:'assistant', content: response.content})
  messages.push({role:'user', content: [todos los tool_result EN UN SOLO MENSAJE user,
                                         cada uno con su tool_use_id]})
```

Reglas duras del contrato (blindar con tests): los `tool_result` de una misma vuelta van **en un único mensaje `user`**; el `content` del assistant se reenvía **entero** (con los bloques `tool_use`); los `input` se parsean siempre como JSON y se validan con `clean()`/regex antes de tocar el proveedor.

### 3.2 Las dos tools (constantes de código, nunca de D1)

```js
// worker/calendar.js — CONSTANTE: byte-estable para el caché de prompt
const CALENDAR_TOOLS = [
  { name: 'consultar_disponibilidad',
    description: 'Consulta los huecos libres de la agenda del negocio para un día concreto. Úsala antes de proponer horas.',
    input_schema: { type: 'object', properties: { fecha: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['fecha'] } },
  { name: 'agendar_cita',
    description: 'Crea la cita SOLO cuando el cliente haya confirmado hora y dado nombre y teléfono.',
    input_schema: { type: 'object', properties: {
      fecha_hora: { type: 'string', description: 'YYYY-MM-DDTHH:MM en hora local del negocio' },
      nombre: { type: 'string' }, telefono: { type: 'string' }, motivo: { type: 'string' } },
      required: ['fecha_hora', 'nombre', 'telefono'] } },
];
```

El `executor` es un **closure que captura el tenant** ya resuelto por el canal: la tool no recibe ni acepta identificadores de tenant — imposible que el modelo (o una inyección del usuario) apunte al calendario de otro cliente (§7).

- `consultar_disponibilidad`: valida `fecha` (regex, no pasada, máx +60 días) → freeBusy del proveedor para ese día (Google `freeBusy.query` funciona con el scope de events sobre el calendario propio; si diera 403, fallback a `events.list` timeMin/timeMax; Microsoft: `GET /me/calendars/{id}/calendarView?startDateTime&endDateTime` con `Prefer: outlook.timezone`) → `freeSlots(busy, business_hours, slot_minutes, timezone)` (función **pura**, exportada en `testing`) → JSON `{fecha, huecos: ['10:00','10:30',...]}` (tope ~12 huecos para no inflar tokens).
- `agendar_cita`: valida (`normalizePhone` para el teléfono, `clean` para nombre/motivo, fecha futura) → **relee la disponibilidad de ese hueco justo antes de crear** (§4) → crea evento (summary `Cita: <nombre> — <motivo>`, description con teléfono, start/end con la timezone del negocio) → INSERT en `appointments` con `request_id = cita:<tenantId>:<clave conversación>:<fecha_hora>` (UNIQUE = idempotente ante reintentos) → devuelve `{ok:true, fecha_hora, nombre}` o `{error:'hueco_ocupado', alternativas:[...]}` para que el modelo re-proponga.

### 3.3 Convivencia con el caché de prompt y max_tokens

- La API renderiza `tools → system → messages`: los tools entran ANTES del breakpoint de `cache_control` del bloque de system, así que **mientras `CALENDAR_TOOLS` sea una constante idéntica byte a byte, el caché sigue acertando** (los tenants con calendario y sin calendario tienen prefijos distintos → cachés distintos, correcto y esperado).
- **La fecha/hora actual y la timezone** (imprescindibles para que "mañana a las 5" signifique algo) van en un **segundo bloque de system SIN `cache_control`**, después del estable: `callAnthropicRaw` acepta `system` como array `[{estable, cache_control}, {volátil}]`. El helper `sysText` de los tests se extiende para verificar que el bloque 2 nunca lleva `cache_control` y el 1 nunca contiene fechas.
- Guardrails de citas **en código** (`CALENDAR_GUARDRAILS`, concatenado por `systemFor` cuando hay calendario): "pide siempre nombre y teléfono antes de agendar; nunca inventes huecos; confirma fecha, hora y timezone antes de crear la cita". Editar la fila del tenant no puede degradar esto (misma filosofía que `GUARDRAILS`).
- `max_tokens`: **500 en las llamadas con tools** (el JSON de `tool_use` consume output; con 300 un `agendar_cita` con motivo largo se truncaría con `stop_reason max_tokens` a mitad de JSON). La respuesta final visible sigue corta por prompt. Coste marginal: ~0.
- Presupuesto: **cada iteración del bucle pasa por `aiBudgetGuard`** (cada vuelta es una llamada facturable); el log `ai_usage` gana el campo `iter`. Los cupos por tenant (`ai_daily_limit`) y global ya contienen el coste.

### 3.4 Latencia y el webhook de Twilio (~15 s)

- **Canal web (`/chat`)**: bucle síncrono dentro de la petición. Peor caso: 3 × (15 s modelo + 5 s proveedor) ≈ 60 s — el widget no tiene timeout propio y Cloudflare aguanta; aceptable en v1, y el bucle real rara vez pasa de 2 vueltas (consultar → proponer; agendar → confirmar).
- **Canal Twilio (`handleTwilio`)**: patrón **híbrido síncrono/asíncrono**:
  1. Primera llamada al modelo como hoy (`retries:0, timeoutMs:10000`) pero con tools si el tenant tiene calendario.
  2. `end_turn` → TwiML con el texto (camino actual, sin regresión de latencia).
  3. `tool_use` → **responder TwiML vacío inmediatamente** y continuar el bucle en `ctx.waitUntil(...).catch(...)`. Al terminar, enviar la respuesta final por la **Messages API de Twilio** (`From` = `tenant.twilio_from`, credenciales de la subcuenta vía `twilioAuthTokenFor` — regla de oro de `deliver()`; `Body` en texto libre es legal: ventana de 24 h abierta por el mensaje entrante). El historial en KV se escribe al final del bucle; si el envío falla, log `calendar_reply_failed` + alerta.
  - **Límite duro**: `waitUntil` da ~30 s tras la respuesta → con 3 iteraciones × 10 s vamos justos; en el tramo asíncrono, timeout del modelo 10 s y del proveedor 5 s; si se agota, mandar el mensaje de disculpa (mejor un "te confirmo enseguida" que silencio).
  - El dedupe por `MessageSid` (sprint de blindaje 2026-08-20) evita que un reintento de Twilio duplique nada.

---

## 4. Reglas de negocio

- **Dobles reservas**: (1) `agendar_cita` relee la ocupación del hueco exacto contra el proveedor justo antes de crear; (2) cerrojo KV `booklock:<tenantId>:<starts_at>` TTL 60 s (patrón `provisionLock`) contra dos conversaciones simultáneas — best-effort (KV es eventualmente consistente entre PoPs), la relectura del proveedor es la barrera principal; (3) `request_id` UNIQUE en `appointments` contra reintentos del propio bucle. Riesgo residual asumido y documentado: una carrera perfecta entre dos PoPs puede crear dos eventos; el negocio lo ve en su calendario.
- **Zona horaria**: siempre la del negocio (`tenant_calendars.timezone`); el bloque volátil de system declara "hoy es <fecha> (<tz>)"; los eventos se crean con timeZone explícita; `appointments` guarda UTC + tz.
- **Datos mínimos**: nombre + teléfono, forzados por partida doble: `required` del schema + `CALENDAR_GUARDRAILS`. El teléfono pasa por `normalizePhone` (6–15 dígitos) — en WhatsApp el modelo puede ofrecer usar el número del que escribe (el `From` está en contexto de canal, no hace falta pedirlo dos veces: el executor lo recibe como default).
- **Confirmación**: la respuesta final del modelo tras un `agendar_cita` exitoso confirma día, hora y nombre; el `tool_result` devuelve la fecha ya formateada en local para que no la recalcule mal.
- **Panel**: nueva pestaña/lista «Citas» (GET paginado, mismo cursor por tupla que leads) y contador en la ficha; si `lead_id` enlaza, la ficha del lead muestra su cita. Aviso opcional a Telegram del tenant por cada cita creada (mismo canal de avisos de lead) — barato y de mucho valor percibido.

## 5. Canales

**Fase 1 (esta spec)** — el tool use es transversal a lo ya desplegado:
- **Web** (`handleChat`): pasar tools cuando `tenant` tiene calendario conectado y no es demo. Sin cambios en `assets/vai-widget.js` (la respuesta sigue siendo `{reply}`).
- **WhatsApp y Messenger** (`handleTwilio`): patrón híbrido de §3.4. Messenger comparte el camino (la Messages API de Twilio envía a `messenger:` igual).

**Fase aparte (spec propia, NO en esta)** — nuevos canales:
- **Telegram como canal de cliente**: hoy el bot de Telegram es SOLO alertas internas. Canal de cliente = nueva forma de dirección `telegram:<bot_id>` en `ADDRESS_RE`/validación, webhook nuevo (`POST /telegram/<secreto>` con `X-Telegram-Bot-Api-Secret-Token` validado en tiempo constante), token del bot por tenant cifrado en D1, historial `conv:tg:<tenant>:<chat_id>`, envío por `sendMessage`. Complejidad propia: un bot por cliente (BotFather), sin firma HMAC como Twilio.
- **Instagram**: prometido y sin desplegar. Vía Twilio (Instagram channel sender sobre la subcuenta, requiere WABA/Meta Business verificada por cliente) o Meta directo. Trámites de Meta por cliente = el mismo cuello de botella que la WABA.
- Recomendación explícita: **no acoplar calendario a canales nuevos**. El bucle de tools es agnóstico del canal; cuando Telegram/Instagram existan, heredan las citas gratis.

## 6. Panel

Sección «Calendario y citas» en la ficha del tenant (el JS del panel vive en `worker/admin-panel.js` desde el sprint de blindaje):
- Estado: desconectado / conectado como `account_email` (proveedor, badge verde) / error (`last_error` humano + botón «Reconectar»).
- Botones «Conectar Google» / «Conectar Microsoft» → `POST .../calendar/connect` → `location.href = authUrl` (el callback redirige de vuelta al panel).
- Tras conectar: selector de calendario (`GET .../calendar/calendars` lista los del proveedor), timezone, duración de cita, horario laboral (editor simple por día). `PATCH .../calendar`.
- «Desconectar» con confirmación.
- Lista de citas (`GET /api/admin/appointments`), filtrable por tenant para rol velai.

Endpoints y roles (siguiendo `clienteAllowed`/`scopeClause`):

| Ruta | Método | Rol |
|---|---|---|
| `/api/admin/tenants/:id/calendar` | GET/PATCH/DELETE | solo velai (v1) |
| `/api/admin/tenants/:id/calendar/connect` | POST | solo velai (v1) |
| `/api/admin/tenants/:id/calendar/calendars` | GET | solo velai |
| `/api/admin/appointments` | GET | velai + **cliente** (añadir a `clienteAllowed`, filtrado con `scopeClause`) |
| `/oauth/calendar/callback` | GET | Access + adminIdentity + state |

El GET del estado **nunca** devuelve `refresh_token_enc` (columnas explícitas, como la ficha del tenant). Auditoría de conectar/editar/desconectar en `tenant_versions` (field `calendar`).

## 7. Seguridad

- **Scopes mínimos**: solo `calendar.events` (Google) y `Calendars.ReadWrite offline_access openid email` (Microsoft). Nada de contactos, correo ni listado de todos los calendarios más allá del picker.
- **Cifrado**: refresh_token con `encryptSecret`, AAD `calendar:<tenant_id>` — write-only, jamás sale del worker ni entra en `tenant_versions`. Hereda gratis la rotación de KEK (`SECRETS_KEK_OLD` + re-cifrado perezoso).
- **Qué NO loguear**: `code`, `state`, tokens, `account_email` completo (solo dominio si hace falta), nombres/teléfonos de citas, títulos de eventos ajenos. Logs: `calendar_connected {tenant, provider}`, `calendar_refresh_failed {tenant, provider, error_code}`, `appointment_created {tenant, channel}`, `tool_loop {tenant, iter, tool}`.
- **CSRF**: `state` aleatorio en KV, un solo uso (leer-y-borrar), TTL 10 min, atado a `{tenantId, provider, actor}` — el callback rechaza cualquier combinación que no case; además el callback vive tras Access.
- **Aislamiento de tools**: el executor se construye con el tenant del canal (closure); el input del modelo se trata como **entrada de usuario hostil** (`clean`, regex de fecha, `normalizePhone`); un `tool_result` nunca incluye datos de eventos existentes más allá de ocupado/libre (los títulos de otras citas del negocio no viajan al modelo → no se los puede sonsacar el usuario final).
- **Límites KV**: 1 escritura/segundo por clave (el `caltoken:` se escribe solo en refresh, OK), consistencia eventual ~60 s entre PoPs (afecta a `booklock`, mitigado en §4), y el TTL mínimo de KV es 60 s (OK).

## 8. Tests (`test/worker.test.js`, estilo del repo)

1. `freeSlots` puro: horario partido, solapes, tz con DST (fecha de cambio de hora), día sin horario → sin huecos.
2. Bucle de tools con `globalThis.fetch` mockeado (anthropic devuelve `tool_use` y luego `end_turn`): los `tool_result` van en UN mensaje user con su `tool_use_id`; el content del assistant se reenvía entero; corta en 3 iteraciones.
3. Contrato de caché: bloque 1 estable con `cache_control`, bloque 2 volátil sin él; `CALENDAR_TOOLS` serializa idéntico en dos llamadas (extensión de `sysText`).
4. Executor valida input hostil: fecha inválida/pasada → `is_error`, teléfono corto → `is_error`; nunca lanza.
5. `agendar_cita` con hueco ocupado en la relectura → `{error:'hueco_ocupado'}` sin INSERT; `request_id` duplicado → no duplica cita.
6. Webhook Twilio con calendario: primera respuesta `tool_use` → TwiML vacío + `waitUntil` registrado; el envío final usa credenciales de la subcuenta y `Body` (aquí SÍ es legal texto libre, al contrario que el test de plantillas de avisos).
7. OAuth: state desconocido → 403; state usado dos veces → 403; round-trip encrypt/decrypt con AAD `calendar:` (y que el AAD de twilio NO descifra el de calendar).
8. Aislamiento: tool de tenant A jamás consulta la fila de B (el executor no acepta tenantId externo).
9. Rechazo: `/oauth/calendar/callback` en hostname público → 404.

## 9. Fases de entrega y estimación

| Fase | Contenido | Estimación |
|---|---|---|
| **0 — Trámites (semana 1, en paralelo)** | Google Cloud Console + solicitud de verificación (camino crítico: 2–6 semanas de Google), Azure app registration, secrets | 1 día de trabajo + espera externa |
| **1 — Google + web + WhatsApp/Messenger** | `0012_calendario.sql`, `worker/calendar.js` (solo Google), refactor `callAnthropicRaw` + `runToolLoop`, executor, patrón híbrido en `handleTwilio`, OAuth completo, panel mínimo (conectar/estado/desconectar + lista de citas), tests | 6–9 días de dev |
| **2 — Microsoft** | Segundo proveedor en `calendar.js` (la abstracción ya existe), picker de calendarios, rotación de refresh_token | 2–3 días |
| **3 — Pulido** | Horario laboral editable fino, aviso Telegram por cita, enlace cita↔lead, cancelación desde el panel, recordatorios por plantilla WhatsApp (requiere plantilla Utility nueva → aprovisionamiento) | 3–5 días |
| **4 — Nuevos canales (SPEC APARTE)** | Telegram-cliente, Instagram | no estimar aquí |

**Riesgos explícitos**: (1) verificación de Google — sin ella, refresh de 7 días en Testing: arrancarla la semana 1; (2) latencia Twilio — resuelta con el híbrido TwiML-vacío + Messages API, pero el techo de ~30 s de `waitUntil` obliga a 3 iteraciones máximo y timeouts agresivos; (3) KV eventual — el antidoble-reserva definitivo es la relectura del proveedor, no el cerrojo; (4) `max_tokens 300` trunca JSON de tools — subir a 500 solo en llamadas con tools; (5) coste — cada cita son 2–3 llamadas al modelo: los cupos `ai_daily_limit`/global ya lo contienen, contar cada iteración.

## Ficheros críticos

- `worker/app.js` — `callAnthropic` (refactor a `callAnthropicRaw` + `runToolLoop`), `handleChat`, `handleTwilio` (híbrido async), `adminRouter`/`clienteAllowed` (endpoints nuevos), `invalidateTenantCache`
- `worker/calendar.js` — NUEVO: OAuth Google/Microsoft, refresh de tokens, freeBusy/createEvent, `freeSlots` puro (patrón de `worker/twilio.js`)
- `migrations/0012_calendario.sql` — NUEVO: `tenant_calendars` + `appointments`
- `worker/crypto.js` — se reutiliza tal cual (`encryptSecret`/`decryptSecret` con AAD `calendar:<tenant_id>`)
- `worker/admin-page.js` + `worker/admin-panel.js` — sección «Calendario y citas» en la ficha del tenant
- `test/worker.test.js` — los 9 bloques de tests de §8
