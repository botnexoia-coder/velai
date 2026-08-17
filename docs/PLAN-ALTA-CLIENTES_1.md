# Plan ejecutable — alta de clientes con WABA propia (multi-cuenta Twilio)

> **Estado (2026-08-17): APLICADO ÍNTEGRO, incluida la corrección de `deliver()`**
> (credenciales de la subcuenta en el Basic, no las del padre) **y el PR 6 completo**:
> migración 0005, `worker/twilio.js`, endpoints `/provision/*` con las 7 guardas
> (idempotencia 409, cerrojo KV 60s, D1-antes-de-responder + `provision_orphan` con
> alerta, rate limit 5/min por actor, auditoría en tenant_versions, token que nunca
> vuelve, aviso de tope de gasto), cron que sondea aprobaciones de plantilla y estado
> del sender con aviso a Telegram, y sección de aprovisionamiento en la ficha del panel.
> Matiz de implementación: el `lead_template_sid` se guarda al CREAR la plantilla y
> `deliver()` no la usa hasta que el cron la marque `approved` (una sola fuente de
> verdad, sin clave suelta en KV). Suite 33/33. Los SID de subcuenta se redactaron de
> este doc: GitHub Push Protection bloquea el push si van en claro.

> **Para Claude Code, desde la raíz del repo `botnexoia-coder/velai`.** Levantado sobre `a63b9b7`
> (Fase 2 desplegada) el 2026-08-17. Todo el código necesario está aquí; aplica PR por PR, en
> orden, y no pases al siguiente sin que `npm run check` esté verde.
>
> **Objetivo.** Dar de alta a **4 tenants de cliente** — `hiredatavision`, `gogestion`, `zoe`,
> `dialogos`, los cuatro independientes — más **`myxu-costura` como prospecto desactivado** — por **tres canales**: Messenger (cero trámites), chat web y WhatsApp con **la WABA
> del cliente** bajo **una subcuenta de Twilio por cliente**. Velai no envía ni un documento a
> Meta: verifica cada cliente con su CIF y añade a Velai como socio.
>
> **Decisión de arquitectura ya tomada** (no reabrir): una sola cuenta de Twilio (la de Velai) con
> **una subcuenta por cliente**, porque Twilio solo admite *1 WABA por cuenta o subcuenta* (error
> `63102`). No se crean cuentas de Twilio por cliente. No se gestionan cuentas de Meta de clientes.

---

## 0. Estado verificado del que partimos

| Hecho | Dónde | Consecuencia |
|---|---|---|
| El worker resuelve el tenant del canal web por `body.tenant` | `worker/app.js:203` | Servidor listo |
| `vai-widget.js` **nunca envía** `tenant` | `assets/vai-widget.js:474` (`postChat`) | PR 1 |
| `leadform.js` **nunca envía** `tenant` | `assets/leadform.js:224` | PR 1 — más grave: el lead se persiste con el tenant equivocado |
| `OPERATIONS.md:92` afirma que el payload ya lo adjunta | doc | Falso hasta PR 1 |
| `ADDRESS_RE` ya acepta `messenger:<pageId>` | `worker/app.js:225` | Messenger no necesita esquema nuevo |
| La firma de Twilio se valida solo con `env.TWILIO_AUTH_TOKEN` | `worker/app.js:643` | PR 3 |
| `deliver()` envía siempre contra `env.TWILIO_ACCOUNT_SID` | `worker/app.js:416` | PR 3 |
| `GET /api/admin/tenants/:id` hace `SELECT *` | `worker/app.js:838` | PR 3: expondría la columna cifrada |
| `POST /` (Twilio) no tiene rate limit por IP | `worker/app.js:1017` | PR 3: tras el reorden, una petición sin firma toca D1 |
| Tests actuales | `npm test` | 24/24 — al terminar deben ser **36/36** |

### Ya hecho en Twilio (2026-08-17, cuenta `velai`)

Las cuatro subcuentas están **creadas y activas**. Estos SID son los que van en la columna
`twilio_subaccount_sid` de cada tenant:

| Subcuenta | Account SID | Tenant |
|---|---|---|
| `cliente-hiredatavision` | `AC… (en Twilio → Subaccounts; GitHub Push Protection no permite publicarlos)` | `hiredatavision` |
| `cliente-gogestion` | `AC… (en Twilio → Subaccounts; GitHub Push Protection no permite publicarlos)` | `gogestion` |
| `cliente-zoe` | `AC… (en Twilio → Subaccounts; GitHub Push Protection no permite publicarlos)` | `zoe` |
| `cliente-dialogos` | `AC… (en Twilio → Subaccounts; GitHub Push Protection no permite publicarlos)` | `dialogos` |

> **Los auth tokens de las subcuentas NO están aquí a propósito.** Están en *Keys & Credentials →
> API keys & tokens* de cada subcuenta y los pega Juan en el panel (campo write-only). Ningún
> secreto de Twilio debe pasar por este documento, por el repo ni por un chat.

**Estado de la cuenta padre**, verificado el mismo día:

- Sender WhatsApp: **1 solo**, `+1 570-616-0059` ("Velai"), *Online*, calidad **Alta**, 80 MPS.
  WABA `950927537764373`, Meta Business `949061711290882`.
- Plantillas (8 en total, 3 relevantes): `velai_nuevo_lead` `HX1b64454910a2b69179a7250114448c2b`
  (mayo, **aprobada y en producción**), `velai_nuevo_lead_util` `HX8578a135ff13bdcf335d2c916b9f31b7`
  y `velai_solicitud_contacto` `HX8dd9e597c0686fae08058b901ae7df2f` (ambas del 17-ago, categoría
  **Marketing**, la segunda reclasificada por Meta con revisión disponible hasta el **17 oct 2026**).
  Es decir: **hay dos intentos de plantilla Utility y ninguno ha cuajado todavía.**
- En el menú *Senders* **no aparece Messenger**: el canal está en otro sitio de la consola (o en
  Conversations classic). Localizarlo es el primer paso del PR 2, porque `velai-messenger` ya tuvo
  conversaciones reales en mayo: existe configurado en alguna parte.
- La consola quedó con el contexto en `cliente-dialogos`; volver a la cuenta padre con el selector
  de arriba a la izquierda → *Go back to main account* antes de tocar senders o plantillas.

**Restricciones del repo que no se negocian**

- `wrangler.toml`: no quitar `keep_vars`, `workers_dev`, ni los bindings `KV`/`DB`.
- Migración D1 en remoto **antes** del deploy del Worker.
- **Nunca** pedir una URL `?v=N` antes de que su deployment de Pages esté activo: el CDN la
  envenena un año (así se quemó `funnel.js?v=6`). Consultar el ESTADO del deployment por API.
- Pages despliega solo con el push; el Worker se despliega a mano con `wrangler deploy`.

---

## PR 1 — Canal web multi-tenant

### 1.1 `assets/vai-widget.js`

En `postChat()`, donde se arma `payload` (≈ línea 474), añadir el tenant:

```js
  async function postChat(text) {
    var payload = {
      conversationId: conversationId,
      message: text,
      pageUrl: location.href.slice(0, 500),
      utm: (window.VELAI_getUTM && window.VELAI_getUTM()) || {}
    };
    // Canal web multi-tenant: la web de un cliente declara su slug antes de cargar el
    // widget. Sin esto el worker cae en DEFAULT_TENANT_SLUG y contesta como Velai.
    if (typeof window.VELAI_TENANT === 'string' && window.VELAI_TENANT) {
      payload.tenant = window.VELAI_TENANT.slice(0, 40);
    }
    if (demo) payload.demo = demo;
```

### 1.2 `assets/leadform.js`

Mismo bloque en el `payload` de `/lead` (≈ línea 224), con el mismo comentario. **Este es el
crítico**: sin él, un lead del formulario de un cliente se guarda con el `tenant_id` de Velai y el
aviso sale por la plantilla de Velai al equipo de Velai.

### 1.3 Cache-busting

- `vai-widget.js?v=4` → `?v=5` y `leadform.js?v=2` → `?v=3` en **las 26 páginas**.
- Push, esperar a que el deployment de Pages esté **activo** (`wrangler pages deployment list` o la
  API), y solo entonces pedir las URLs nuevas.

### 1.4 Tests

En `test/worker.test.js`, dos guardas de regresión que leen los ficheros del cliente (no hay
navegador en los tests, así que se comprueba el contrato en el texto):

```js
test('el widget y el formulario envían el tenant en el payload', async () => {
  const widget = await readFile(new URL('../assets/vai-widget.js', import.meta.url), 'utf8');
  const form = await readFile(new URL('../assets/leadform.js', import.meta.url), 'utf8');
  assert.match(widget, /payload\.tenant\s*=\s*window\.VELAI_TENANT/);
  assert.match(form, /payload\.tenant\s*=\s*window\.VELAI_TENANT/);
});
```

**Aceptación:** `npm run check` verde · en `velai-dey.pages.dev` con
`window.VELAI_TENANT='hiredatavision'` inyectado a mano, `/chat` responde con el contexto de ese
tenant y `/lead` guarda con su `tenant_id`.

---

## PR 2 — Messenger como canal de cliente

**No requiere código de enrutado**: `channel_address = messenger:<pageId>` ya funciona (es como
está dado de alta `velai-messenger`). Lo que hay que hacer es:

1. **Verificar la respuesta TwiML en Messenger** en la primera prueba real: `handleTwilio` contesta
   `<Response><Message>…</Message></Response>`. Si el canal Messenger de Twilio no acepta TwiML en
   esa cuenta, cambiar a envío por API con `MessagingServiceSid`. **Comprobar antes de prometer el
   canal a un cliente.**
2. En `handleTwilio`, `Body` es obligatorio (`invalid_twilio_payload`). Messenger envía adjuntos sin
   `Body`: responder 200 con un TwiML vacío y un log `code:'messenger_attachment_ignored'` en vez de
   400, para no llenar los logs de Twilio de errores.
3. El aviso de lead sigue saliendo por **WhatsApp con plantilla** al equipo del cliente: para un
   cliente solo-Messenger hay que rellenar `team_whatsapp` + `lead_template_sid` igual, o dejar solo
   Telegram.

**Aceptación:** un mensaje a la página del cliente responde con su contexto, el lead cae con su
`tenant_id` y el aviso llega a su equipo.

---

## PR 3 — Subcuentas de Twilio: firma por cuenta y secretos cifrados

### 3.1 `migrations/0004_tenant_twilio.sql`

```sql
-- Un cliente = una subcuenta de Twilio + la WABA del propio cliente. Twilio solo admite
-- 1 WABA por cuenta o subcuenta (error 63102), así que la subcuenta es el contenedor.
-- El auth token de cada subcuenta se guarda CIFRADO (AES-GCM, KEK en un secret del Worker).
ALTER TABLE tenants ADD COLUMN twilio_subaccount_sid TEXT;
ALTER TABLE tenants ADD COLUMN waba_id TEXT;
ALTER TABLE tenants ADD COLUMN twilio_auth_token_enc TEXT;
ALTER TABLE tenants ADD COLUMN meta_partner_status TEXT NOT NULL DEFAULT 'pendiente';
CREATE UNIQUE INDEX tenants_subaccount_idx ON tenants(twilio_subaccount_sid);
```

> SQLite permite varias filas con `NULL` en un índice único, así que los tenants sin subcuenta
> (Velai, los solo-web) no chocan entre sí.

### 3.2 `worker/crypto.js` (nuevo)

```js
// Cifrado de secretos de cliente en D1 (auth tokens de subcuentas de Twilio).
// AES-256-GCM con la KEK en un secret del Worker. Formato: v1:<iv_b64>:<ciphertext_b64>.
// AAD = tenant_id, para que un ciphertext copiado de otra fila no descifre.
// Protege ante una fuga del CONTENIDO de D1, no ante quien ya ejecuta código aquí.
const KEYS = new Map();

function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
function unb64(text) { return Uint8Array.from(atob(text), (c) => c.charCodeAt(0)); }

async function kek(env, name) {
  const raw = env[name];
  if (!raw) return null;
  if (!KEYS.has(raw)) {
    const bytes = unb64(raw);
    if (bytes.length !== 32) throw new Error('kek_bad_length');
    KEYS.set(raw, await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']));
  }
  return KEYS.get(raw);
}

export async function encryptSecret(env, tenantId, plaintext) {
  const key = await kek(env, 'SECRETS_KEK');
  if (!key) throw new Error('kek_not_configured');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(tenantId) },
    key, encoder.encode(plaintext));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

// Rotación perezosa: si no descifra con la KEK actual, se intenta con SECRETS_KEK_OLD y
// el llamante puede reescribir la fila con la nueva.
export async function decryptSecret(env, tenantId, stored) {
  if (!stored) return null;
  const parts = String(stored).split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('cipher_format');
  const iv = unb64(parts[1]); const ct = unb64(parts[2]);
  const aad = new TextEncoder().encode(tenantId);
  for (const name of ['SECRETS_KEK', 'SECRETS_KEK_OLD']) {
    const key = await kek(env, name);
    if (!key) continue;
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct);
      return { value: new TextDecoder().decode(plain), stale: name === 'SECRETS_KEK_OLD' };
    } catch (_) { /* siguiente clave */ }
  }
  throw new Error('cipher_undecryptable');
}
```

### 3.3 `handleTwilio`: resolver tenant → elegir token → validar firma

Sustituir el arranque de `handleTwilio` (`worker/app.js:639-649`) por:

```js
async function twilioAuthTokenFor(env, tenant) {
  if (!tenant || !tenant.twilio_auth_token_enc) return null;
  const out = await decryptSecret(env, tenant.id, tenant.twilio_auth_token_enc);
  return out ? out.value : null;
}

async function handleTwilio(request, env, ctx, config) {
  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const object = {}; params.forEach((value, key) => { object[key] = value; });
  const accountSid = clean(params.get('AccountSid'), 40);
  const to = clean(params.get('To'), 80);
  if (!accountSid || !to) throw new HttpError(400, 'invalid_twilio_payload');

  // ORDEN NUEVO: la firma depende del auth token de la cuenta que envía, y con
  // subcuentas ese token vive cifrado en la fila del tenant. Así que primero el
  // tenant (por `To`, que es único) y después la firma. Sin tenant o sin token NO
  // se valida y NO se pasa: se rechaza. Nunca hay camino "pasa igualmente".
  const tenant = await tenantByAddress(env, to);
  if (!tenant) {
    ctx.waitUntil(alertUnknownTenant(env, to));
    throw new HttpError(404, 'unknown_tenant');
  }
  // La cuenta padre (los números de Velai) firma con el token del entorno. Cada
  // subcuenta de cliente, con el suyo. El token global NO sirve de respaldo para un
  // AccountSid ajeno: eso convertiría un despiste de configuración en un bypass.
  const isParent = Boolean(env.TWILIO_ACCOUNT_SID) && accountSid === env.TWILIO_ACCOUNT_SID;
  if (!isParent && tenant.twilio_subaccount_sid && tenant.twilio_subaccount_sid !== accountSid) {
    throw new HttpError(403, 'account_tenant_mismatch');
  }
  const authToken = isParent ? env.TWILIO_AUTH_TOKEN : await twilioAuthTokenFor(env, tenant);
  if (!authToken) {
    ctx.waitUntil(alertTenantMisconfigured(env, tenant, accountSid));
    throw new HttpError(403, 'twilio_auth_token_missing');
  }
  if (!await validTwilioSignature(authToken, request.url, object, request.headers.get('X-Twilio-Signature') || '')) {
    throw new HttpError(403, 'invalid_twilio_signature');
  }
  const from = clean(params.get('From'), 80);
  const message = clean(params.get('Body'), 2000);
  if (!from || !message) throw new HttpError(400, 'invalid_twilio_payload');
  // …el resto del cuerpo actual, sin cambios
```

`alertTenantMisconfigured`: igual que `alertUnknownTenant` (antirebote de 1 h en KV, clave
`alert:token:<tenant.id>`) con el texto *"mensajes entrantes de `<AccountSid>` para `<nombre>` sin
auth token configurado: el cliente no está siendo atendido"*.

**Y una guarda nueva**, porque ahora una petición sin firma llega a tocar D1: en `createWorker`,
antes de `handleTwilio`, un rate limit por IP con el mismo mecanismo que `/chat`:

```js
if (path === '/' && request.method === 'POST' && contentType.includes('application/x-www-form-urlencoded')) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (await rateLimited(env, ip, 'twilio', 120)) throw new HttpError(429, 'rate_limited');
  return await handleTwilio(request, env, ctx, config);
}
```

### 3.4 `deliver()`: enviar desde la subcuenta

En `worker/app.js:399-429`:

```js
  // La cuenta padre puede operar recursos de sus subcuentas: se autentica con las
  // credenciales del padre y el SID de la subcuenta va en la URL.
  const accountSid = (tenant && tenant.twilio_subaccount_sid) || env.TWILIO_ACCOUNT_SID;
```

y usar `accountSid` en la URL de `Messages.json`, dejando el `Authorization` del padre.

> ⚠️ **CORREGIDO el 2026-08-17 con la documentación de Twilio.** No uses las credenciales del
> padre: la doc de subcuentas dice explícitamente que para operar recursos *dentro* de una
> subcuenta se usan **el SID y el auth token de la subcuenta**, y que las **API Keys de la cuenta
> principal NO pueden acceder a recursos de subcuenta**. Así que `deliver()` autentica con
> `Basic <twilio_subaccount_sid>:<token descifrado>`:
>
> ```js
>   const accountSid = (tenant && tenant.twilio_subaccount_sid) || env.TWILIO_ACCOUNT_SID;
>   const token = tenant && tenant.twilio_subaccount_sid
>     ? await twilioAuthTokenFor(env, tenant)     // el mismo que valida la firma
>     : env.TWILIO_AUTH_TOKEN;
>   if (!token) return { skipped: true, error: 'not_configured' };
>   const auth = `Basic ${btoa(`${accountSid}:${token}`)}`;
> ```
>
> Ventaja lateral: el token de la subcuenta ya está cifrado en la fila y se descifra una sola vez
> por invocación, así que no hay credencial nueva ni ruta alternativa que mantener.

### 3.5 Panel y API

1. **`validateTenant`** (`worker/app.js:234`), campos nuevos:

```js
const ACCOUNT_SID_RE = /^AC[0-9a-f]{32}$/i;
const WABA_RE = /^\d{10,20}$/;
const PARTNER_STATUS = new Set(['pendiente', 'concedido', 'revocado']);

  if (has('twilio_subaccount_sid')) {
    out.twilio_subaccount_sid = clean(body.twilio_subaccount_sid, 40) || null;
    if (out.twilio_subaccount_sid && !ACCOUNT_SID_RE.test(out.twilio_subaccount_sid)) bad('twilio_subaccount_sid');
  }
  if (has('waba_id')) {
    out.waba_id = clean(body.waba_id, 30) || null;
    if (out.waba_id && !WABA_RE.test(out.waba_id)) bad('waba_id');
  }
  if (has('meta_partner_status')) {
    out.meta_partner_status = clean(body.meta_partner_status, 20);
    if (!PARTNER_STATUS.has(out.meta_partner_status)) bad('meta_partner_status');
  }
```

   `tenantWriteError`: añadir `if (/UNIQUE.*twilio_subaccount_sid/i.test(msg)) return new HttpError(409, 'subaccount_taken');`

2. **El auth token no pasa por `validateTenant`** (cifrar es asíncrono). En el `PATCH`, aparte:

```js
  // Write-only: entra en claro, se guarda cifrado y nunca vuelve a salir del worker.
  let tokenColumn = null;
  if (body.twilio_auth_token !== undefined) {
    const token = clean(body.twilio_auth_token, 64);
    if (!/^[0-9a-f]{32}$/i.test(token)) throw new HttpError(400, 'invalid_twilio_auth_token');
    tokenColumn = await encryptSecret(env, tenantId, token);
  }
```
   Añadirlo al `UPDATE` como columna extra, **y excluirlo del versionado**: en el `previous_value`
   de `tenant_versions` nunca puede aparecer `twilio_auth_token_enc`.

3. **`GET /api/admin/tenants/:id`**: cambiar el `SELECT *` (`:838`) por lista explícita de columnas
   **sin** `twilio_auth_token_enc`, más un booleano:

```sql
SELECT id, slug, name, channel_address, team_whatsapp, telegram_chat_id, lead_template_sid,
       twilio_from, twilio_subaccount_sid, waba_id, meta_partner_status, system_prompt,
       active, created_at, updated_at,
       twilio_auth_token_enc IS NOT NULL AS has_twilio_token
FROM tenants WHERE id=?
```

4. **`GET /api/admin/tenants`** (listado): añadir al semáforo
   `t.twilio_auth_token_enc IS NOT NULL AS has_twilio_token`, `t.twilio_subaccount_sid IS NOT NULL AS has_subaccount`
   y `t.meta_partner_status`.

5. **`worker/admin-page.js`**: tres tarjetas nuevas junto a las de `:18-22` —
   `Subcuenta Twilio (AC…)`, `WABA del cliente`, `Auth token de la subcuenta` (este con
   `type="password"`, `placeholder="solo para cambiarlo"`, y debajo `configurado ✓` cuando
   `has_twilio_token`) — y un selector `Socio en Meta` con los tres estados. El campo del token
   **se envía solo si el usuario escribe algo**; nunca se rellena al cargar la ficha.

6. **Semáforo del listado**: `sin subcuenta` / `sin token` / `socio pendiente` / `listo`.

### 3.6 Clientes en negociación: tenants "prospecto"

Un cliente cuya negociación no está cerrada (hoy **MyXu Costura**) debe poder existir en el panel
con su contexto ya escrito, **sin atender a nadie**, y activarse el día que se firme sin rehacer
trabajo. `active = 0` ya lo consigue en el enrutado (`tenantByAddress`/`tenantBySlug` filtran
`active = 1`) y el panel nunca borra. El único obstáculo es `channel_address NOT NULL UNIQUE`: no
hay número ni página que poner.

**Solución: dirección reservada `pending:<slug>`.** No es enrutable —los webhooks de Twilio traen
siempre `whatsapp:+…` o `messenger:<id>`— y es única por slug. Nada de reconstruir la tabla.

En `worker/app.js`, junto a `ADDRESS_RE`:

```js
// Dirección reservada para clientes en negociación: NO es enrutable (Twilio nunca manda
// un `To` con este prefijo) y ocupa el UNIQUE sin pisar una dirección real futura.
const PENDING_RE = /^pending:[a-z0-9][a-z0-9-]{1,39}$/;
```

y en `validateTenant`, sustituir la validación de `channel_address` por:

```js
  if (has('channel_address') || !partial) {
    out.channel_address = clean(body.channel_address, 80);
    if (!ADDRESS_RE.test(out.channel_address) && !PENDING_RE.test(out.channel_address)) bad('channel_address');
  }
```

**Y la regla cruzada, que es lo que evita el pie en el que es fácil tropezar:** un tenant con
dirección `pending:` **no se puede activar**. Al final de `validateTenant` no hay contexto
suficiente (en `PATCH` los campos son parciales), así que la comprobación va en el handler del
`PATCH` y del `POST`, con la fila previa a la vista:

```js
// Activar un prospecto sin ponerle antes su dirección real dejaría una fila "activa" que
// no atiende a nadie y que, peor, tapa el hueco del semáforo. Se rechaza explícitamente.
const finalAddress = fields.channel_address ?? previous.channel_address;
const finalActive = fields.active ?? previous.active;
if (finalActive === 1 && PENDING_RE.test(String(finalAddress))) {
  throw new HttpError(400, 'pending_tenant_cannot_be_active');
}
```

En el `POST` (alta), la misma comprobación con `fields` solamente.

**Panel** (`worker/admin-page.js`): el placeholder del campo Canal pasa a
`whatsapp:+34910000000 · messenger:12345 · pending:mi-cliente`, y el semáforo del listado muestra
**`prospecto`** (gris) cuando `active = 0` y la dirección empieza por `pending:`, distinto de
**`desactivado`** (un cliente que sí tuvo servicio y se paró). Son dos situaciones distintas y
conviene no confundirlas al mirar la lista.

**Reactivar cuando se cierre el trato** — todo desde el panel, sin deploy:

1. Cambiar `channel_address` de `pending:myxu-costura` a la dirección real.
2. Rellenar subcuenta, auth token, plantilla y equipo.
3. Marcar Activo y guardar.

La invalidación de caché ya cubre esto sin tocar nada: `invalidateTenantCache(env, [previous, fields])`
borra la clave vieja (`tenant:addr:pending:…`) **y** la nueva en la misma edición.

**Tests (2 más → 36/36)**

- `POST`/`PATCH` con `channel_address: 'pending:x'` y `active: 1` → 400 `pending_tenant_cannot_be_active`.
- Un tenant `pending:` con `active = 0` **no se resuelve** ni por dirección ni por slug (el bot no
  contesta por él), y sigue apareciendo en el listado del panel con su contexto intacto.

### 3.7 Secretos y entorno

```bash
openssl rand -base64 32            # 32 bytes exactos
npx wrangler secret put SECRETS_KEK
```
Añadir `SECRETS_KEK` a `.dev.vars.example` (con un valor de ejemplo evidente, no uno real) y
documentar la rotación con `SECRETS_KEK_OLD` en `docs/OPERATIONS.md`.

### 3.8 Tests (8 nuevos → 34/34)

1. Webhook de subcuenta firmado con el token **cifrado del tenant** → 200 y responde su contexto.
2. El mismo webhook firmado con `env.TWILIO_AUTH_TOKEN` → **403** (no hay respaldo global).
3. `AccountSid` que no coincide con `twilio_subaccount_sid` de la fila → 403 `account_tenant_mismatch`.
4. Tenant sin token + `AccountSid` ajeno → 403 `twilio_auth_token_missing`, **sin llamar al modelo**.
5. Número de Velai (`AccountSid` = padre) sigue funcionando con el token del entorno → 200.
6. `encryptSecret`/`decryptSecret`: ida y vuelta correcta; descifrar con otro `tenantId` **falla**;
   formato corrupto lanza `cipher_format`.
7. `GET /api/admin/tenants/:id` y el listado **no contienen** `twilio_auth_token_enc` ni el token.
8. `PATCH` con `twilio_auth_token`: la columna queda cifrada (empieza por `v1:`) y el
   `previous_value` de `tenant_versions` no contiene el token ni el ciphertext.
9. `deliver()` con `twilio_subaccount_sid` pega a `…/Accounts/AC<sub>/Messages.json`.
10. `POST /` con 121 peticiones desde la misma IP → 429 en la última.

### 3.9 Orden de despliegue

```bash
npx wrangler d1 migrations apply vai-leads --remote   # 1º la migración
npx wrangler secret put SECRETS_KEK                   # 2º el secreto
npx wrangler deploy                                   # 3º el worker
```
Comprobar que el cron `*/5 * * * *` sigue registrado y que los bindings `KV`/`DB` siguen ahí.

---

## PR 4 — Contextos de los 4 clientes + 1 prospecto

Para cada uno, crear `tenants/<slug>.md` con el contexto del negocio (**solo negocio**: qué es,
catálogo, precios, horarios, cómo atender, qué puede prometer y qué no — los guardrails los añade
el worker). Materia prima, en el propio repo o en el sitio publicado:

| Slug | Cliente | De dónde sacar el contexto |
|---|---|---|
| `hiredatavision` | HireDataVision | repo `botnexoia-coder/hiredatavision` + `hiredatavision.com`, y el prompt del worker viejo `hiredatavision-bot` |
| `gogestion` | GoGestión | repo `CronoSeb/gogestion-demo` + el worker `gogestion-bot` (nuevo, 2 días) |
| `zoe` | Zoe Travel Spain | repo `botnexoia-coder/Zoe` + `zoetravelspain.com` |
| `dialogos` | Diálogos que Enseñan | repo `botnexoia-coder/Dialogos` + `dialogosqueensenan.com` |

Reglas: 50–20.000 caracteres (`PROMPT_MIN`/`PROMPT_MAX`), tono del negocio, **sin datos personales
de terceros**, y sin prometer canales que ese cliente no tenga contratado. El alta real de la fila
se hace **desde el panel** (no por SQL): D1 es la fuente de verdad y el `.md` es la copia revisable.

| `myxu-costura` | MyXu Costura | **Prospecto** (§3.6): fila con `channel_address = pending:myxu-costura` y `active = 0`. Contexto desde `botnexoia-coder/MyXuCostura` + `myxucostura.com` + el prompt de `myxu-costura-bot` |

**Zoe y Diálogos son dos clientes independientes** (confirmado): dos filas, dos subcuentas, dos
topes de gasto y facturación separada. No se agrupan en ningún informe del panel.

**MyXu Costura queda fuera por ahora**: negociación abierta. Se da de alta como prospecto para no
perder el trabajo del contexto, **sin subcuenta de Twilio** (se crea el día que se firme) y sin
atender a nadie. Su worker `myxu-costura-bot` sigue funcionando igual: desactivar un tenant no lo
toca.

> Los workers `hiredatavision-bot` y `gogestion-bot` **no se apagan** hasta que su tenant responda
> igual o mejor en producción. Cuando se apaguen, anotarlo en `docs/OPERATIONS.md`.

---

## PR 5 — Documentación

1. **`docs/ALTACLIENTE.md`** — reescribir con las dos rutas (§ "Runbook" de abajo) y **corregir el
   paso 8**: `window.VELAI_TENANT` funciona a partir del PR 1, no antes.
2. **`docs/OPERATIONS.md:92`** — quitar el "(el payload lo adjunta)" y sustituirlo por la
   instrucción real: script inline con `window.VELAI_TENANT` **antes** del `<script src=…vai-widget.js>`,
   más el dominio en `ALLOWED_WEB_ORIGINS` (esto sí es deploy del Worker) **y** en los hostnames del
   widget de Turnstile. Añadir la sección de subcuentas, la de `SECRETS_KEK` y su rotación.
3. **`docs/TAREAS-PENDIENTES.md`** — cerrar lo hecho y dejar abierto: verificación de negocio de
   cada cliente, revisión de categoría de `velai_solicitud_contacto_hx` (Marketing → Utility, hasta
   el 17 oct), topes de gasto por subcuenta, y el runbook de baja de cliente.
4. **`docs/FASE1-MULTITENANT.md:291`** — marcar como histórica la frase "el widget no necesita
   cambios hoy".
5. **`docs/REVISION-2026-08-17.md`** — el hallazgo 19 (Instagram en el `SYSTEM`) sigue abierto: con
   este modelo Instagram sería un activo del cliente, pero hasta que exista hay que quitarlo del
   prompt o dejar de venderlo.

---

## Runbook de alta (resultado final) — *C = cliente · V = Velai*

### Ruta A — Messenger y/o web: sin un solo trámite

| # | Paso | Quién |
|---|---|---|
| 1 | Te asigna su página de Facebook como socio (o te hace admin) | C |
| 2 | Conectas la página en Twilio → Messenger (hasta **25 páginas** por cuenta/subcuenta) | V |
| 3 | Webhook al worker de siempre | V |
| 4 | Alta en el panel: `channel_address = messenger:<pageId>`, equipo, plantilla, contexto | V |
| 5 | Si lleva web: `window.VELAI_TENANT='<slug>'` en su página + su dominio en `ALLOWED_WEB_ORIGINS` y en Turnstile (deploy) | V |
| 6 | Prueba end-to-end | V |

### Ruta B — WhatsApp con la WABA del cliente

| # | Paso | Quién |
|---|---|---|
| 1 | Crea su Business Portfolio (o usa el que ya tenga si hace anuncios) | C |
| 2 | Verifica su negocio con su CIF | C |
| 3 | Añade a Velai como **socio** con permisos sobre la WABA | C |
| 4 | Subcuenta `cliente-<slug>` en Twilio (**ya creadas las 4**) + **tope de gasto** | V |
| 5 | Registras el sender con la WABA **del cliente** (Embedded Signup; el OTP lo recibe él) | V+C |
| 6 | Display name = su marca, exacta — cambiarlo después exige ticket de soporte | V |
| 7 | Perfil del sender con los datos del cliente | V |
| 8 | Webhook de la subcuenta → `https://vai-worker.botnexo-ia.workers.dev` | V |
| 9 | Plantilla `nuevo_lead_<slug>`, Utility, **crear nueva** (no duplicar) con los 4 ejemplos | V |
| 10 | Alta/edición en el panel: `channel_address`, subcuenta, WABA, **auth token**, plantilla, equipo, contexto, socio = concedido | V |
| 11 | Prueba end-to-end + firma validada con el token de la subcuenta | V |

**Antes de prometer fechas:** su número no puede tener WhatsApp activo; si lo tiene, hay que
eliminar esa cuenta y **pierde su historial**. Esa conversación va primero.

**Baja de un cliente:** borrar sender, retirar el socio en Meta, `active=0` en el panel (la fila
**nunca** se borra: los leads apuntan a `tenant_id`), y purgar sus leads según retención.

---

## Orden de ejecución y criterio de "listo"

| Paso | Bloquea a | Listo cuando |
|---|---|---|
| PR 1 | Cualquier piloto web | `npm run check` verde, `?v=` desplegado y verificado |
| PR 2 | Clientes por Messenger | Un mensaje real responde con el contexto del cliente |
| PR 3 | Clientes 2…N por WhatsApp | 36/36 tests, migración aplicada, worker desplegado, envío padre→subcuenta **verificado** |
| PR 4 | Que cada bot suene a su negocio | 5 `tenants/*.md` revisados · 4 filas activas sin avisos en el semáforo y 1 marcada `prospecto` |
| PR 5 | Que el siguiente no repita los errores | Ninguna doc afirma algo que el código no hace |

**Lo que no depende de nosotros y conviene lanzar ya en paralelo:** que cada cliente verifique su
negocio en Meta (días de gestoría) y la revisión de categoría de la plantilla de Velai.

---

## PR 6 — Aprovisionamiento desde el panel (añadido 2026-08-17)

> **Pregunta que lo motiva:** ¿se puede dar de alta un cliente en `admin.hirevai.com` y que la
> subcuenta de Twilio se cree sola, sin entrar a la consola? **Sí, y bastante más que la subcuenta.**
> Lo que sigue está verificado contra la documentación de Twilio.

### 6.1 Qué se automatiza y qué no

| Paso del alta | ¿API? | Cómo |
|---|---|---|
| Crear la subcuenta | ✅ | `POST /2010-04-01/Accounts` con las credenciales del **padre**. La respuesta **incluye el `auth_token` de la subcuenta**: se cifra y se guarda en el acto. Límite 1000 subcuentas |
| Guardar el auth token | ✅ | Deja de ser un copiar-pegar humano: nunca se muestra en pantalla |
| Crear la plantilla de aviso | ✅ | `POST https://content.twilio.com/v1/Content` con las credenciales **de la subcuenta** → devuelve el `HX…` |
| Enviarla a aprobación | ✅ | `POST /v1/Content/{sid}/ApprovalRequests/whatsapp` con `name` (minúsculas y guiones bajos) y `category: UTILITY` |
| Saber si ya está aprobada | ✅ | `GET /v1/Content/{sid}/ApprovalRequests` — lo sondea el cron, sin que nadie vigile |
| Crear el sender de WhatsApp | ✅ | Senders API: `sender_id: whatsapp:+E164`, `configuration.waba_id`, método de verificación, y el `webhook.callback_url` ya apuntando al worker |
| Completar el OTP del número | ✅ | `UPDATE` del sender con `verification_code` — el panel puede pedirle el código al cliente por teléfono y enviarlo |
| Conectar la WABA del cliente a Twilio | ❌ | Requiere login de Meta del cliente (Embedded Signup). Sin `waba_id` no hay sender. Solo el ISV lo evita, y el ISV exige verificación de Velai |
| Verificar el negocio del cliente en Meta | ❌ | Trámite suyo, con su CIF |
| Añadir a Velai como socio | ❌ | Lo hace el cliente en su Business Manager |
| Aprobación del display name / de la plantilla | ❌ | Decide Meta; solo se puede consultar |

**Resultado práctico:** el alta pasa de 11 pasos manuales a **2 manuales del cliente** (conectar su
WABA y darte acceso) **+ un botón** en el panel. Lo que no se puede automatizar tampoco lo hacías
tú: lo hace el cliente o lo decide Meta.

### 6.2 Esquema (`migrations/0005_provisioning.sql`)

```sql
-- Estado del aprovisionamiento automático. Nada aquí es secreto: los tokens siguen
-- cifrados en twilio_auth_token_enc.
ALTER TABLE tenants ADD COLUMN lead_template_status TEXT;  -- null|'pending'|'approved'|'rejected'
ALTER TABLE tenants ADD COLUMN sender_sid TEXT;            -- XE… del sender de WhatsApp
ALTER TABLE tenants ADD COLUMN sender_status TEXT;         -- CREATING|PENDING_VERIFICATION|VERIFYING|ONLINE|…
ALTER TABLE tenants ADD COLUMN provisioned_at TEXT;
```

### 6.3 `worker/twilio.js` (nuevo)

Un módulo con una función por operación, todas devolviendo `{ok, data}` o lanzando `HttpError`, y
**ninguna** registrando credenciales:

```js
// Aprovisionamiento de Twilio desde el panel. Regla de oro: los recursos DE una subcuenta se
// operan con las credenciales DE esa subcuenta — la doc de Twilio dice que las API Keys de la
// cuenta principal no acceden a recursos de subcuenta. Solo la creación usa las del padre.
async function twilioPost(url, credentials, form) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${credentials.sid}:${credentials.token}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, `twilio_${response.status}_${data.code || 'error'}`);
  return data;
}

export async function createSubaccount(env, friendlyName) {
  const data = await twilioPost('https://api.twilio.com/2010-04-01/Accounts.json',
    { sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN }, { FriendlyName: friendlyName });
  // data.auth_token solo viaja aquí: se cifra inmediatamente y no se devuelve al panel.
  return { sid: data.sid, authToken: data.auth_token };
}
```

Y del mismo estilo: `createLeadTemplate(credentials, slug, businessName)` (JSON contra
`content.twilio.com/v1/Content`, con las 4 variables en el orden fijado por
`leadTemplateVariables`), `submitTemplateApproval(credentials, contentSid, name)` con
`category: 'UTILITY'`, `fetchApprovalStatus(credentials, contentSid)`,
`createWhatsAppSender(credentials, {phone, wabaId, callbackUrl})` y
`verifySender(credentials, senderSid, code)`.

### 6.4 Endpoints del panel

Todos bajo `/api/admin/tenants/:id/provision/…`, detrás de Cloudflare Access igual que el resto:

| Endpoint | Hace | Precondición |
|---|---|---|
| `POST …/subaccount` | Crea la subcuenta, cifra el token, guarda SID | La fila no tiene `twilio_subaccount_sid` |
| `POST …/template` | Crea la plantilla y la manda a aprobación (`pending`) | Hay subcuenta |
| `POST …/sender` | Crea el sender con `waba_id` y webhook | Hay subcuenta y `waba_id` |
| `POST …/sender/verify` | Manda el `verification_code` | Sender en `PENDING_VERIFICATION`/`VERIFYING` |
| `GET …/provision` | Estado consolidado de los 4 pasos | — |

### 6.5 Guardas — esto es lo que decide si el botón es una ayuda o un problema

1. **Idempotencia por columna.** Cada endpoint se niega (409 `already_provisioned`) si su columna ya
   tiene valor. Un doble clic no crea dos subcuentas — y en Twilio **una subcuenta no se borra**,
   solo se cierra y se elimina 30 días después: crear basura sale caro en confusión.
2. **Cerrojo en KV** (`provision:<tenantId>:<paso>`, TTL 60 s) para la ventana entre la llamada a
   Twilio y el `UPDATE` en D1: sin él, dos clics simultáneos crean dos subcuentas antes de que la
   primera se guarde.
3. **Si Twilio responde OK pero el `UPDATE` de D1 falla**, quedaría una subcuenta huérfana con su
   token perdido. Por eso: escribir en D1 **antes** de responder al panel y, si el `UPDATE` falla,
   registrar `code:'provision_orphan'` con el SID **y alertar a Telegram** para reconciliar a mano.
   Es el único fallo de este PR que no se arregla solo.
4. **Rate limit por actor** (5/min) con el mecanismo que ya usa `preview`: son llamadas que crean
   recursos facturables.
5. **Auditoría**: cada paso deja fila en `tenant_versions` (`field: 'provision'`, sin secretos en
   `previous_value`) y aviso a Telegram con actor y paso.
6. **El token nunca vuelve**: ni en la respuesta del endpoint, ni en el `GET` de la ficha, ni en los
   logs. El test que ya existe para `twilio_auth_token_enc` se extiende a estas rutas.
7. **Tope de gasto**: la API no lo configura, así que el panel debe **mostrar un aviso** hasta que
   Juan lo ponga a mano en la consola de esa subcuenta. Un cliente nuevo sin tope es riesgo abierto.

### 6.6 Cron: cerrar el círculo sin vigilar nada

En `scheduled()`, junto al drenaje de la cola: para cada tenant con
`lead_template_status = 'pending'`, consultar la aprobación; si pasó a `approved`, escribir
`lead_template_sid`, poner `lead_template_status = 'approved'`, invalidar caché y avisar por
Telegram (*"la plantilla de Barbería López ya está aprobada, los avisos salen por la suya"*). Si
`rejected`, avisar con el motivo. Igual con `sender_status` mientras no sea `ONLINE`.

Esto es lo que convierte el runbook en algo que no hay que recordar: el sistema te dice cuándo un
cliente quedó listo, en vez de que tú entres a mirar.

### 6.7 Tests (6 más → 42/42)

1. `POST …/subaccount` con la fila ya provisionada → 409, y **no** llama a Twilio.
2. Creación correcta: el token queda cifrado (`v1:`), la respuesta **no** lo contiene y el SID se
   guarda.
3. Twilio devuelve 400 → 502 `twilio_400_*`, la fila **no se toca**.
4. `UPDATE` de D1 falla tras crear en Twilio → log `provision_orphan` con el SID y alerta enviada.
5. El cron pasa una plantilla de `pending` a `approved`, rellena `lead_template_sid` e invalida caché.
6. `POST …/sender` sin `waba_id` → 400 `waba_required`, sin llamada a Twilio.

### 6.8 Orden

**PR 6 va después del 3**, no antes: reutiliza `encryptSecret` y la resolución de tenant, y no tiene
sentido automatizar la creación de algo cuyo consumo aún no funciona. Las 4 subcuentas que ya
existen se quedan como están: el endpoint solo se usará para el cliente número 5 en adelante.
