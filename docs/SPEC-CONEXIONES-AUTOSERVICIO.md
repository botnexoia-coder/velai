# SPEC — Conexiones en autoservicio para el cliente (Telegram, WhatsApp, avisos)

> **Para Claude Code, desde la raíz de `botnexoia-coder/velai`.** Levantado sobre **`71203fd`**
> (2026-08-21, suite **88/88**, migraciones 0001–0012).
>
> **Objetivo.** Que el cliente conecte sus propios canales desde `admin.hirevai.com` y **Velai tome
> el dato automáticamente**, sin copiar-pegar ni entrar a consolas. El patrón ya existe y funciona:
> el autoservicio de Google Calendar (`worker/app.js:1992`, `clienteAllowed:1998-1999`). Esto lo
> extiende a Telegram y a WhatsApp.
>
> **Aplica PR por PR, en orden. No pases al siguiente sin `npm run check` verde.**
>
> **ESTADO (CLI, 2026-08-22): PR 1, 2 y 3 IMPLEMENTADOS** (suite 98/98; PR 4 documentado en TAREAS §2j). Ampliaciones sobre la spec, pedidas por Juan durante la validación: marca blanca de bot POR CLIENTE conmutable por Velai (0014-0015), TEMAS del grupo con clasificación IA como parte del paquete de marca blanca (0016; básico = un solo chat), temas creados desde el panel con descripción (createForumTopic), asistente HORIZONTAL guiado en la UI del cliente, y sender/sync REPARA el webhook además de detectarlo. PR 1 detalle original: (suite 92/92) con tres ajustes acordados con Juan:
> (1) **Entrega DUAL** en vez del fix a secas — se descubrió que NINGÚN tenant tenía
> `telegram_chat_id` y TODOS los avisos dependían del fallback buggy: ahora el aviso del
> cliente va a SU chat (sin chat = skip visible) y Velai recibe SIEMPRE una copia operativa
> deduplicada por lead (`opsping:` en KV). (2) El username del bot se descubre con `getMe`
> cacheado en KV — la var `TELEGRAM_BOT_USERNAME` no existe. (3) El `setWebhook` lo hace el
> propio worker (`POST /api/admin/telegram/setup`, botón en Conexiones, solo Velai) — sin
> curl manual con el token; y el parser acepta `/start@Bot <token>` (forma de grupos).
> La pestaña Conexiones NO absorbe el calendario (decisión de Juan). PR 2, 3 y 4 pendientes.

---

## 0. El hallazgo que fija el alcance — leer antes de diseñar nada

### 0.1 Aclaración: Self Sign-up es lo más RÁPIDO, pero NO es autoservicio

Conviene no confundir las dos cosas, porque suenan igual y no lo son:

| | Self Sign-up (hoy) | Embedded Signup en nuestro panel (Tech Provider) |
|---|---|---|
| ¿Desde dónde se lanza el popup? | **Consola de Twilio**, por el dueño de la cuenta (Velai) | **`admin.hirevai.com`**, por el propio cliente |
| ¿Quién inicia sesión en Meta dentro del popup? | **El cliente** (así la WABA nace en su portfolio) | El cliente |
| ¿Puede el cliente hacerlo solo? | **NO** | Sí |
| Tiempo | minutos, con el cliente delante | minutos, sin nadie delante |

Literal del doc de Twilio: *«In the Twilio Console, go to Messaging > Senders > WhatsApp Senders…
Click Create new sender»*. Y el aviso que cierra la puerta a cualquier atajo:

> 🔴 **«Don't share the pop-up window URL with anyone else. The registration will fail.»**
>
> Es decir: **no** se puede mandar el enlace del popup al cliente para que lo haga por su cuenta. Si
> alguien lo intenta, el registro falla. Escribirlo aquí para que nadie lo pruebe «por si acaso».

**Y tampoco vale invitarle a la consola:** los roles de Twilio son **de cuenta**, no de subcuenta. No
existe forma de dar acceso a un tercero solo a `cliente-gogestion`; darle acceso le daría la cuenta
padre entera, con las 4 subcuentas y las credenciales maestras.

**Conclusión práctica:** hoy el paso de conectar la WABA es una **sesión compartida de ~20 min**
(pantalla compartida o presencial): Velai lanza el popup desde su consola, el cliente pone sus
credenciales de Meta y recibe el OTP en su número. Rápido, sí. Autoservicio, no.

### 0.2 El autoservicio completo exige Tech Provider

Verificado el 2026-08-21 contra la documentación de Twilio y de Meta:

Embebir el Embedded Signup de Meta en una aplicación propia requiere el **programa Tech Provider**
de Twilio. Requisitos, literales de la guía de integración:

| Requisito | Velai hoy |
|---|---|
| «Create a Meta business portfolio» | ✅ `949061711290882` |
| «Register a WhatsApp sender for your ISV using Self Sign-up» | ✅ `+1 570-616-0059` |
| «Turn on two-factor authentication and complete business verification» | ❌ **portfolio SIN verificar** |
| «Create a new Meta app. Don't reuse an existing app» + enviarla a **revisión de Meta** | ❌ no existe |

Y la guía **no documenta ninguna alternativa** de autoservicio para un ISV que no sea Tech Provider.
Meta añade que su verificación de negocio *«can take several weeks»*.

**Conclusión de alcance:**

- **Telegram sí se puede hacer autoservicio completo hoy.** → **PR 1**, y es donde está el ahorro
  operativo real por cliente.
- **WhatsApp no se puede hacer autoservicio hoy** (§0.1). Lo que sí se puede es **quitarle a Velai
  todo lo que no es la sesión de 20 min**: que el worker lea el sender de la subcuenta por API y
  rellene la fila solo, y que el cliente vea su estado en su propio panel sin preguntar. El login de
  Meta sigue siendo del cliente —eso es *correcto*, no una limitación—, pero **nadie transcribe un
  `waba_id` a mano ni tiene que escribir para saber cómo va**. → **PR 2**.
- **`team_whatsapp` y `wa_number` sí son autoservicio hoy** y cierran un pendiente del §5 del
  contexto (la guarda del `63031`). → **PR 3**.
- **Fase B (Embedded Signup real en nuestro panel)** queda documentada en **§PR 4**, sin implementar,
  con la lista de precondiciones para el día que exista la S.L.

> **No reabrir el debate de proveedor.** 360dialog cobra **49–249 €/mes por canal**; a un cliente de
> 100 €/mes se le comería la mitad del recurrente. Twilio no tiene cuota fija por sender. Se reevalúa
> a ~10 clientes, no ahora.

---

## PR 1 — Telegram en autoservicio (el que más ahorra)

### 1.1 El problema

Hoy conseguir el `telegram_chat_id` de un cliente es: pedirle que hable con el bot → que Juan llame a
`getUpdates` a mano → leer `message.chat.id` → pegarlo en el panel. Por cliente. Es exactamente el
tipo de ruido que este PR elimina.

### 1.2 🔴 Bug que va en este PR — el respaldo silencioso

`sendTelegramText` (`worker/app.js`):

```js
const target = chatId || env.TELEGRAM_CHAT_ID;
```

Y `deliver()` lo llama con `tenant.telegram_chat_id`. **Si la fila del cliente no tiene chat id, el
aviso NO falla: se va al Telegram de Velai y devuelve `ok: true`.** El panel te dice que el aviso se
entregó y el cliente no ha recibido nada. Con un solo tenant era inofensivo; con clientes es un lead
perdido en silencio.

**Arreglo:** que el respaldo global sea **explícito**, no implícito.

```js
// El respaldo a env.TELEGRAM_CHAT_ID es para las alertas OPERATIVAS de Velai
// (provision_orphan, tokens indescifrables…), NO para el aviso de lead de un
// cliente: ahí un chat id vacío tiene que ser un skip visible, no un mensaje que
// acaba en el Telegram de Velai diciendo ok:true.
async function sendTelegramText(env, text, chatId, { allowFallback = true } = {}) {
  const target = chatId || (allowFallback ? env.TELEGRAM_CHAT_ID : null);
  if (!env.TELEGRAM_TOKEN || !target) return { skipped: true, error: 'not_configured' };
  …
}
```

y en `deliver()`:

```js
if (channel === 'telegram') {
  const chatId = tenant && tenant.telegram_chat_id;
  // Un tenant sin chat id propio NO cae al de Velai.
  if (tenant && !chatId) return { skipped: true, error: 'telegram_not_configured' };
  return sendTelegramText(env, notificationText(lead), chatId, { allowFallback: !tenant });
}
```

Todas las demás llamadas (`alertUnknownTenant`, `alertTenantMisconfigured`, `provision_orphan`,
`access_group_desync`, `turnstile_sync_failed`…) siguen igual: son de Velai y **deben** usar el
respaldo.

### 1.3 Vinculación por token de un solo uso

**Migración `0013_tenant_connections.sql`:**

```sql
-- Vinculación de Telegram en autoservicio. El token vive en KV (TTL), no en D1: si
-- caduca no deja basura. Aquí solo el resultado y quién lo hizo, para auditoría.
ALTER TABLE tenants ADD COLUMN telegram_linked_at TEXT;
ALTER TABLE tenants ADD COLUMN telegram_chat_title TEXT;  -- 'GOgestión · Leads' — para que el panel muestre a DÓNDE va
```

**Nueva var** en `wrangler.toml` (pública, es el usuario del bot):

```toml
# Usuario del bot de Telegram, para construir el enlace de vinculación del panel.
TELEGRAM_BOT_USERNAME = "<rellenar>"
```

**Nuevo secret**: `TELEGRAM_WEBHOOK_SECRET` (32 bytes aleatorios). Se registra una vez con
`setWebhook`:

```
POST https://api.telegram.org/bot<TELEGRAM_TOKEN>/setWebhook
{ "url": "https://vai-worker.botnexo-ia.workers.dev/telegram/webhook",
  "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
  "allowed_updates": ["message"] }
```

> 🔴 **Consecuencia operativa que hay que documentar en `OPERATIONS.md`:** registrar un webhook
> **desactiva `getUpdates`**. A partir de aquí Juan ya no puede leer chat ids a mano por ese camino —
> que es justo el punto del PR, pero conviene que esté escrito antes de que alguien lo busque.

### 1.4 Endpoint de vinculación (rol **cliente** permitido)

`POST /api/admin/tenants/:id/telegram/link`

```js
// Autoservicio: el cliente genera SU enlace. Mismo molde que calendar/connect —
// alcance comprobado ANTES de tocar D1 y ajeno = 404, nunca 403.
if (scope.role !== 'velai' && scope.tenantId !== tenantId) throw new HttpError(404, 'not_found');
if (!env.KV) throw new HttpError(503, 'telegram_not_configured');
if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_BOT_USERNAME) throw new HttpError(503, 'telegram_not_configured');
if (await rateLimited(env, actor, 'tglink', 5)) throw new HttpError(429, 'rate_limited');
const token = crypto.randomUUID().replace(/-/g, '');   // 32 hex, sin guiones: Telegram limita el payload de start a 64 car.
await env.KV.put(`tglink:${token}`, JSON.stringify({ tenantId, actor }), { expirationTtl: 900 });
return json({
  token,                                                // visible en el panel, para grupos
  dmUrl: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${token}`,
  groupUrl: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startgroup=${token}`,
  expiresInSeconds: 900,
}, 200, NO_STORE);
```

`DELETE /api/admin/tenants/:id/telegram` → borra `telegram_chat_id`, `telegram_linked_at`,
`telegram_chat_title`, invalida caché, auditoría. También rol cliente (desconectar es suyo, igual que
en calendario).

### 1.5 Webhook de Telegram (público, con secreto)

`POST /telegram/webhook` — **fuera** de Cloudflare Access (lo llama Telegram), así que la
autenticación es el header:

```js
// Primero el secreto, antes de leer el cuerpo: un endpoint público sin Access no
// puede permitirse parsear nada de un desconocido.
if (path === '/telegram/webhook' && request.method === 'POST') {
  const given = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!env.TELEGRAM_WEBHOOK_SECRET || !timingSafeEqual(given, env.TELEGRAM_WEBHOOK_SECRET)) {
    // 200 a propósito: un 403 le confirma a un escáner que el endpoint existe, y
    // Telegram reintenta en bucle ante un no-2xx.
    return json({ ok: true }, 200, NO_STORE);
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (await rateLimited(env, ip, 'tgwh', 120)) return json({ ok: true }, 200, NO_STORE);
  return await handleTelegramWebhook(request, env, ctx);
}
```

`handleTelegramWebhook`:

1. Lee `update.message`. Si no hay `text` o no empieza por `/start `, **200 y fuera** (el bot recibirá
   mucho ruido de grupo).
2. `token = text.slice(7).trim().split(/\s+/)[0]` y valida `/^[0-9a-f]{32}$/`.
3. `GET tglink:<token>` en KV. Sin fila → 200 y log `code:'telegram_link_expired'` (no filtrar nada
   al chat: un token caducado no debe decir «ese cliente existe»).
4. **`DELETE` del token ANTES del `UPDATE`**: un solo uso, y si el update se reintenta no revincula.
5. `UPDATE tenants SET telegram_chat_id=?, telegram_chat_title=?, telegram_linked_at=?, updated_at=? WHERE id=?`
   con `message.chat.id` y `message.chat.title || message.chat.first_name`.
6. `invalidateTenantCache(env, [row])`.
7. Auditoría en `tenant_versions` (`field: 'telegram'`) + alerta a Telegram **de Velai** (con
   respaldo, es alerta operativa).
8. Responder al propio chat con un `sendMessage` de confirmación: *«Listo. Los avisos de leads de
   <negocio> llegarán aquí.»* — así el cliente ve que funcionó sin volver al panel.

**Trampas de Telegram a respetar:**

- `?startgroup=` añade el bot al grupo pero **no todos los clientes envían el `/start`**. Por eso el
  panel muestra **también el token en texto** con la instrucción «si no aparece la confirmación,
  escribe `/start <token>` en el grupo». No dependas solo del deep link.
- Con el modo privacidad activado (el default) el bot **solo recibe comandos** en grupos. `/start`
  lo es; un mensaje normal no. No cambies el modo privacidad para arreglar esto.
- Los `chat.id` de grupo son **negativos**. `CHAT_ID_RE = /^-?\d{5,20}$/` ya los acepta — verificar
  que sigue así y que el `UPDATE` no pasa por un `clean()` que se coma el signo.

### 1.6 UI — pestaña «Conexiones»

En `worker/admin-panel.js` + `worker/admin-page.js`, **una pestaña `Conexiones` visible para los dos
roles**, con una tarjeta por canal y el mismo lenguaje visual de la tarjeta de calendario:

| Canal | Cliente | Velai |
|---|---|---|
| Google Calendar | conectar / desconectar / ajustes | + ver todos |
| **Telegram de avisos** | **conectar / desconectar** | + ver estado |
| **WhatsApp** | **solo lectura**: estado y qué le toca hacer | + botones de aprovisionamiento y sincronización (PR 2) |
| **Números de aviso** | **editar `team_whatsapp` y `wa_number`** (PR 3) | + ver todos |

Estados de la tarjeta de Telegram: `sin conectar` → (enlace + token, cuenta atrás de 15 min) →
`conectado: <telegram_chat_title>` + botón Desconectar. Colores dinámicos **por CSSOM**, no por
`style=""` (la CSP no cubre el atributo).

### 1.7 Tests (objetivo **88 → 98**)

1. `POST …/telegram/link` como cliente del tenant → 200 con `dmUrl`, `groupUrl` y token de 32 hex.
2. Como cliente de **otro** tenant → **404** (no 403), y **sin** consultar `tenants`.
3. Webhook sin el header secreto → **200** y **ningún `UPDATE`**.
4. Webhook con secreto correcto y `/start <token>` válido → escribe `telegram_chat_id`, borra el
   token de KV e invalida caché.
5. **El mismo update reenviado** → no revincula (el token ya no está) y no lanza.
6. Webhook con `chat.id` **negativo** (grupo) → se guarda con el signo.
7. Mensaje sin `/start` → 200, sin escritura.
8. `deliver('telegram')` con un tenant **sin** `telegram_chat_id` → `skipped: telegram_not_configured`
   y **NO** llama a la API de Telegram. *(Este es el test que cierra el bug del 1.2 — que exista es
   más importante que los otros siete.)*
9. `alertUnknownTenant` **sí** usa `env.TELEGRAM_CHAT_ID` (el respaldo de Velai sigue vivo).
10. `DELETE …/telegram` como cliente → limpia las 3 columnas y audita.

---

## PR 2 — WhatsApp: estado para el cliente y **sincronización del sender** para Velai

### 2.1 Qué resuelve

El cliente hace el login de Meta en el Self Sign-up de Twilio (paso que **debe** ser suyo: la WABA
nace en su portfolio, con su cuenta, y puede revocar). Lo que sobra es que después alguien
transcriba `waba_id`, `sender_sid`, `sender_status` y `twilio_from` a mano. Este PR los **lee de
Twilio y los escribe solo**.

### 2.2 `worker/twilio.js` — función nueva

```js
// Lista los senders de WhatsApp de una subcuenta. Es la contraparte de lectura de
// createWhatsAppSender: cuando el sender lo ha creado el Self Sign-up (el cliente
// desde la consola, no nuestro botón), la fila de D1 no sabe nada y hay que
// reconciliarla. Mismo principio que el resto del módulo: credenciales DE la subcuenta.
export async function listWhatsAppSenders(credentials) {
  const data = await twilioRequest('https://messaging.twilio.com/v2/channels/senders', credentials, { method: 'GET' });
  const items = Array.isArray(data.senders) ? data.senders : (data.data || []);
  return items
    .filter((s) => String(s.sender_id || '').startsWith('whatsapp:'))
    .map((s) => ({
      senderSid: s.sid,
      senderId: s.sender_id,                       // 'whatsapp:+34624121930'
      status: s.status,                            // CREATING|PENDING_VERIFICATION|VERIFYING|ONLINE|…
      wabaId: (s.configuration && s.configuration.waba_id) || null,
      webhookUrl: (s.webhook && s.webhook.callback_url) || null,
    }));
}
```

> ✅ **Verificado contra la API real (gogestion, 2026-08-22):** la ruta es
> `/v2/Channels/Senders` **con mayúsculas** (en minúsculas responde 404 20404), el listado exige
> `Channel=whatsapp`, y el array de la respuesta se llama `senders`. Además, el **Sandbox de
> Twilio (`whatsapp:+14155238886`) aparece listado como un sender más en toda subcuenta** y hay
> que filtrarlo siempre — la primera sync real lo adoptó como sender del cliente (OFFLINE, sin
> WABA) y hubo que limpiar la fila a mano.

### 2.3 Endpoint `POST /api/admin/tenants/:id/provision/sender/sync` — **solo rol velai**

Añadir `sender/sync` a `provMatch` (`app.js:1878`), **antes** de `sender` en la alternancia del
regex (si no, `sender` gana y `sync` nunca entra):

```js
const provMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/provision(?:\/(subaccount|template|sender\/verify|sender\/sync|sender|domains))?$/i);
```

Lógica, con las guardas del módulo (cerrojo KV, rate limit por actor, auditoría):

```js
if (step === 'sender/sync') {
  const senders = await listWhatsAppSenders(credentials);
  if (!senders.length) throw new HttpError(404, 'sender_not_found');
  if (senders.length > 1) throw new HttpError(409, 'multiple_senders');  // decidir a mano: no adivinar
  const s = senders[0];
  const phone = s.senderId;                                    // 'whatsapp:+34…'
  // Idempotente y NO destructivo: rellena huecos. channel_address y twilio_from
  // NO se sobrescriben si ya tienen valor — channel_address es UNIQUE y enruta
  // todos los webhooks del cliente: pisarlo por una lectura de Twilio dejaría al
  // tenant sin atender y con un 404 unknown_tenant por cada mensaje.
  const proposed = {
    waba_id: s.wabaId, sender_sid: s.senderSid, sender_status: s.status,
    twilio_from: phone, channel_address: phone,
  };
  const sets = []; const args = [];
  for (const [col, val] of Object.entries(proposed)) {
    if (!val) continue;
    if ((col === 'channel_address' || col === 'twilio_from') && tenant[col]) continue;   // ya puesto: se propone, no se pisa
    sets.push(`${col}=?`); args.push(val);
  }
  …UPDATE + invalidateTenantCache + provisionAudit…
  return json({
    ok: true, applied: sets.length, sender: s,
    // Lo que NO se tocó, para que el panel lo muestre como conflicto a resolver a mano.
    conflicts: ['channel_address', 'twilio_from']
      .filter((c) => tenant[c] && tenant[c] !== phone)
      .map((c) => ({ field: c, current: tenant[c], fromTwilio: phone })),
    webhookOk: s.webhookUrl === 'https://vai-worker.botnexo-ia.workers.dev',
  }, 200, NO_STORE);
}
```

### 2.4 🔴 Lo que hay que verificar en la primera ejecución real

El Self Sign-up **no configura nuestro webhook**: lo pone Twilio a su valor por defecto. Por eso
`webhookOk` va en la respuesta. Si sale `false`, la subcuenta está recibiendo mensajes que **no
llegan al worker** y el bot no contesta aunque el sender esté `ONLINE`. El panel debe pintarlo en
rojo con el valor esperado, y añadir un `PUT` del webhook a `worker/twilio.js` es trabajo de este
mismo PR si la primera prueba lo confirma.

**Aquí es donde el Self Sign-up y nuestro panel se pisan**, y es el fallo más probable de todo el
alta: sender verde en Twilio, silencio en WhatsApp.

### 2.5 Tarjeta de WhatsApp para el cliente (solo lectura)

`GET /api/admin/tenants/:id/whatsapp` → **sí en `clienteAllowed`**, columnas explícitas, **sin**
`twilio_auth_token_enc` ni `twilio_subaccount_sid` (el SID de la subcuenta es infraestructura de
Velai, no dato del cliente):

```sql
SELECT channel_address, twilio_from, waba_id, sender_status, lead_template_status,
       meta_partner_status, team_whatsapp, wa_number,
       twilio_auth_token_enc IS NOT NULL AS has_token
FROM tenants WHERE id=?
```

El panel lo traduce a lenguaje de negocio, no a estados de Twilio:

| `sender_status` | Lo que ve el cliente |
|---|---|
| *(null)* | «Sin conectar. Te avisamos para hacerlo juntos en 20 min.» |
| `CREATING`, `PENDING_VERIFICATION`, `VERIFYING` | «Verificando tu número con WhatsApp.» |
| `ONLINE` + plantilla no aprobada | «Activo. Los avisos de leads llegan por Telegram mientras WhatsApp aprueba la plantilla.» |
| `ONLINE` + `approved` | «Activo.» |
| otro | «Revisando un problema con tu número.» |

### 2.6 Tests (**98 → 106**)

1. `sender/sync` sin subcuenta → 400 `subaccount_required`, sin llamar a Twilio.
2. Sin token → 400 `twilio_auth_token_missing`, sin llamar a Twilio.
3. Twilio devuelve 0 senders → 404 `sender_not_found`, la fila **no se toca**.
4. 2 senders → 409 `multiple_senders`, la fila **no se toca**.
5. Fila vacía + 1 sender → rellena las 5 columnas.
6. Fila con `channel_address` **distinto** → **no lo pisa** y lo devuelve en `conflicts`.
7. `webhookOk: false` cuando el `callback_url` no es el del worker.
8. El **rol cliente** contra `sender/sync` → **403** (está en `provision/*`, fuera de la lista
   blanca), comprobado en el router **antes** de tocar D1.
9. `GET …/whatsapp` como cliente → 200 y la respuesta **no contiene** `twilio_auth_token_enc` ni
   `twilio_subaccount_sid`.
10. `GET …/whatsapp` de otro tenant → 404.

---

## PR 3 — Números de aviso en autoservicio + la guarda del `63031`

Cierra un pendiente del §5 del contexto y de paso quita a Velai del medio.

`PATCH /api/admin/tenants/:id/notify` → **en `clienteAllowed`**. Campos: `team_whatsapp` (lista, ya
validada por `WA_RE`, máx. 10) y `wa_number` (dígitos, `WA_DIGITS_RE`).

**La guarda que hoy no existe:**

```js
// Twilio rechaza con 63031 cuando From y To son el mismo número. Si team_whatsapp
// incluye el número del bot, TODOS los avisos de ese cliente se caen y el error no
// llega a ninguna parte legible: 5 reintentos y 'failed' en silencio.
const from = String(fields.twilio_from ?? previous.twilio_from ?? '');
const list = String(fields.team_whatsapp ?? previous.team_whatsapp ?? '').split(',').map((x) => x.trim()).filter(Boolean);
if (from && list.includes(from)) throw new HttpError(400, 'team_whatsapp_equals_from');
```

Aplicarla **también** en `validateTenant`/el `PATCH` general de tenants, no solo en el endpoint
nuevo: el agujero es de la fila, no del formulario.

**Tests (**106 → 110**):** cliente cambia su `team_whatsapp` → 200 y auditado con su rol · cliente
pone el número del bot → 400 `team_whatsapp_equals_from` · el mismo choque por el `PATCH` de admin →
400 igual · cliente contra el `/notify` de otro tenant → 404.

---

## PR 4 — Fase B: Embedded Signup real *(NO implementar ahora)*

Documentar en `docs/TAREAS-PENDIENTES.md`, sin código. Precondiciones, en orden, todas de Juan:

1. **S.L. o alta censal** que sostenga la verificación de negocio de Velai en Meta.
2. **2FA + verificación de negocio** del portfolio `949061711290882` (*«can take several weeks»*).
3. **App de Meta nueva** (no reutilizar) enviada a **App Review**.
4. Alta en el **programa Tech Provider** de Twilio.

Solo entonces el botón «Conectar WhatsApp» vive en nuestro panel y el cliente no pisa la consola de
Twilio. Reevaluar cuando haya ~10 clientes, junto a la comparativa con 360dialog.

**Lo que este spec deja preparado para ese día:** la pestaña Conexiones, la tarjeta de WhatsApp con
sus estados, y `sender/sync` como reconciliación. Cambiar de fase A a fase B será sustituir **cómo
llega el `waba_id`**, no rehacer la interfaz ni el modelo de datos.

---

## Orden de ejecución y criterio de «listo»

| PR | Bloquea a | Listo cuando |
|---|---|---|
| **1** Telegram | el alta de GoGestión sin plantilla | 98/98 · un `/start` real vincula un grupo y el aviso de un lead de prueba llega **al grupo, no al Telegram de Velai** |
| **2** WhatsApp sync | que el alta no dependa de transcribir a mano | 106/106 · `sender/sync` rellena la fila desde una subcuenta real y `webhookOk` se ha comprobado **en vivo** |
| **3** Números | — | 110/110 · un cliente edita sus números y el `63031` está cerrado por los dos caminos |
| **4** Fase B | nada (documentación) | `TAREAS-PENDIENTES.md` con las 4 precondiciones |

**Despliegue:** hay CD en push a `main` (checks → `check-bundle` → migraciones D1 → deploy → smoke).
El único paso manual del PR 1 es el `setWebhook` de Telegram y los dos secretos nuevos:

```bash
openssl rand -base64 32
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
# TELEGRAM_BOT_USERNAME va como var en wrangler.toml
```

---

## Invariantes del repo que este spec NO negocia

- **Alcance:** tenant ajeno → **404**, nunca 403, y comprobado **antes** de tocar D1.
- **`clienteAllowed` es lista blanca**, verificada en el router. Todo `provision/*` sigue siendo 403
  para el rol cliente.
- **Nunca `SELECT *`** en nada que devuelva una fila de `tenants`: `twilio_auth_token_enc` y
  `refresh_token_enc` no salen del worker.
- **Secretos write-only**, cifrados con la KEK y AAD `tenant_id`; nunca en la respuesta, ni en
  `tenant_versions.previous_value`, ni en logs.
- **APIs de sustitución completa** (Turnstile `domains`, Access `include`): reconstruir desde D1 en
  cada llamada, y que cada alta/baja **sea** la reconciliación.
- **CSP:** un nonce en `style-src` no habilita `style=""`. Valores dinámicos por **CSSOM**.
- **Idempotencia impuesta por D1** (`WHERE columna IS NULL`), no solo por el cerrojo de KV.
- `wrangler.toml`: no quitar `keep_vars`, `workers_dev`, los bindings `KV`/`DB` ni `[observability]`.
- Migración D1 en remoto **antes** del deploy (lo hace el CD).
- **No pedir un `?v=N` antes de que su deployment de Pages esté activo** (el CDN lo envenena un año)
  y comprobar el deployment **por API**: el webhook GitHub→Pages pierde pushes.
