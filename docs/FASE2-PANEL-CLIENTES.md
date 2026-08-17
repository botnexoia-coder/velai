# Fase 2 — Gestión de clientes desde `admin.hirevai.com`

> **Estado (2026-08-17): APLICADA Y DESPLEGADA.** Migración `0003`, API completa
> (lista con semáforo, alta, PATCH con bloqueo optimista y versionado, historial,
> restore, preview con rate limit por actor), pestaña **Clientes** en el panel con
> contador de caracteres/tokens del contexto, probador del borrador y "Duplicar de…".
> Tests 24/24. **Adaptaciones sobre este doc**: (1) las claves de caché reales son
> `tenant:addr:*` y `tenant:slug:*` — la invalidación borra ambas, viejas y nuevas
> (el slug también cambia), y TAMBIÉN tras el alta (los fallos de lookup se cachean);
> (2) como la caché guarda la fila completa, TODA edición invalida — incluido un
> cambio de prompt, no solo el de dirección; (3) el restore se limita a versiones de
> `system_prompt` (las de config son consultables, no restaurables).

> Objetivo: dar de alta clientes, editar su contexto y cambiar su configuración desde el panel,
> sin tocar SQL ni desplegar el Worker.
>
> Depende de la Fase 1 (tabla `tenants` y enrutado por `To`). Se puede escribir en paralelo,
> pero no desplegar antes.

---

## 1. La frontera: qué se edita aquí y qué no

Esto no es un detalle de organización, es la superficie de ataque del panel.

| Va al panel (D1) | Se queda como secret del Worker |
|---|---|
| Nombre, slug, estado activo | `ANTHROPIC_API_KEY` |
| `channel_address`, `twilio_from` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| `team_whatsapp`, `telegram_chat_id` | `TELEGRAM_TOKEN` |
| `lead_template_sid` | `TURNSTILE_SECRET_KEY` |
| **`system_prompt` (el contexto)** | — |

**Ninguna credencial pasa por el panel.** Si una sesión de Access se compromete, el atacante
puede reescribir prompts y desviar avisos — malo, y con rastro en la auditoría — pero **no se
lleva las llaves de Twilio ni de Anthropic**. Esa frontera no se cruza ni por comodidad.

Ten presente lo que sí implica el acceso: cualquiera que entre al panel puede reescribir el bot
de cualquier cliente y redirigir sus leads. Hoy sois pocos y está bien así, pero el día que entre
alguien del equipo de un cliente hará falta separar roles por grupo de Access. No lo construyas
ahora; solo no lo olvides.

---

## 2. Migración — `migrations/0003_tenant_admin.sql`

```sql
-- Historial de cambios de configuración. Resuelve la pega de que el prompt salga de git:
-- cada guardado deja el estado ANTERIOR, con quién y cuándo. Rollback con un clic.
CREATE TABLE tenant_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_email TEXT NOT NULL,
  field TEXT NOT NULL,            -- 'system_prompt' | 'config'
  previous_value TEXT,            -- el valor que se reemplazó
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX tenant_versions_idx ON tenant_versions(tenant_id, created_at DESC);
```

Nada más. El resto vive en `tenants`, que ya existe.

---

## 3. Reglas de servidor que hay que acertar

Estas cuatro son las que separan un panel que funciona de uno que rompe clientes en silencio.

### 3.1 Validación estricta — un carácter mal deja a un cliente sin atender

```js
const ADDRESS_RE  = /^(whatsapp:\+[1-9]\d{6,14}|messenger:\d{5,25})$/;
const WA_RE       = /^whatsapp:\+[1-9]\d{6,14}$/;
const TEMPLATE_RE = /^HX[0-9a-f]{32}$/i;
const SLUG_RE     = /^[a-z0-9][a-z0-9-]{1,39}$/;
const CHAT_ID_RE  = /^-?\d{5,20}$/;
const PROMPT_MIN = 50, PROMPT_MAX = 20000;

function validateTenant(body, { partial = false } = {}) {
  const out = {}; const bad = (f) => { throw new HttpError(400, `invalid_${f}`); };
  const has = (k) => body[k] !== undefined;

  if (has('slug') || !partial) {
    out.slug = clean(body.slug, 40).toLowerCase();
    if (!SLUG_RE.test(out.slug)) bad('slug');
  }
  if (has('name') || !partial) {
    out.name = clean(body.name, 120); if (!out.name) bad('name');
  }
  if (has('channel_address') || !partial) {
    out.channel_address = clean(body.channel_address, 80);
    if (!ADDRESS_RE.test(out.channel_address)) bad('channel_address');
  }
  if (has('twilio_from')) {
    out.twilio_from = clean(body.twilio_from, 80) || null;
    if (out.twilio_from && !WA_RE.test(out.twilio_from)) bad('twilio_from');
  }
  if (has('team_whatsapp')) {
    const list = clean(body.team_whatsapp, 1000).split(',').map((x) => x.trim()).filter(Boolean);
    if (list.length > 10) bad('team_whatsapp');
    if (list.some((x) => !WA_RE.test(x))) bad('team_whatsapp');
    out.team_whatsapp = list.join(',') || null;
  }
  if (has('telegram_chat_id')) {
    out.telegram_chat_id = clean(body.telegram_chat_id, 30) || null;
    if (out.telegram_chat_id && !CHAT_ID_RE.test(out.telegram_chat_id)) bad('telegram_chat_id');
  }
  if (has('lead_template_sid')) {
    out.lead_template_sid = clean(body.lead_template_sid, 40) || null;
    if (out.lead_template_sid && !TEMPLATE_RE.test(out.lead_template_sid)) bad('lead_template_sid');
  }
  if (has('system_prompt') || !partial) {
    out.system_prompt = String(body.system_prompt ?? '').trim().slice(0, PROMPT_MAX + 1);
    if (out.system_prompt.length < PROMPT_MIN || out.system_prompt.length > PROMPT_MAX) bad('system_prompt');
  }
  if (has('active')) out.active = body.active ? 1 : 0;
  return out;
}
```

El mínimo de 50 caracteres del prompt no es capricho: evita que un guardado accidental con el
campo casi vacío deje al bot de un cliente sin contexto y contestando cualquier cosa.

Y los choques de unicidad hay que traducirlos, no dejarlos reventar en un 500:

```js
try { await env.DB.prepare(sql).bind(...args).run(); }
catch (error) {
  if (/UNIQUE.*slug/i.test(String(error))) throw new HttpError(409, 'slug_taken');
  if (/UNIQUE.*channel_address/i.test(String(error))) throw new HttpError(409, 'address_taken');
  throw error;
}
```

`address_taken` merece un mensaje explícito en la interfaz: significa que ese número ya está
asignado a otro cliente, que es exactamente el error que desviaría las conversaciones de uno al
prompt de otro.

### 3.2 Invalidación de caché — si no, editas y "no pasa nada" durante 5 minutos

`tenantByAddress` cachea en KV con TTL de 300 s. Al guardar hay que **borrar la clave vieja y la
nueva**, no solo la nueva:

```js
async function invalidateTenantCache(env, ...addresses) {
  if (!env.KV) return;
  await Promise.all(addresses.filter(Boolean)
    .map((a) => env.KV.delete(`tenant:${a}`).catch(() => {})));
}

// En el PATCH, ANTES de responder:
await invalidateTenantCache(env, previous.channel_address, updated.channel_address);
```

Si se cambia el `channel_address` y solo se invalida el nuevo, la dirección antigua sigue
resolviendo al tenant durante cinco minutos. Es el bug más probable de toda esta fase.

### 3.3 Bloqueo optimista — dos personas editando el mismo prompt

El cliente manda el `updated_at` que cargó; si no coincide, se rechaza:

```js
const result = await env.DB.prepare(
  'UPDATE tenants SET ... , updated_at = ? WHERE id = ? AND updated_at = ?'
).bind(..., now, id, body.expected_updated_at).run();
if (!result.meta.changes) throw new HttpError(409, 'stale_tenant');
```

En la interfaz: *"Alguien modificó este cliente mientras editabas. Recarga y vuelve a aplicar tus
cambios."* Sin esto, el último en guardar pisa al otro sin que ninguno se entere.

### 3.4 Un tenant no se borra nunca

Los leads apuntan a `tenant_id`. Un `DELETE` o rompe la FK o se lleva el histórico por cascada.
**El panel solo ofrece desactivar** (`active = 0`): deja de enrutar, conserva todo. Sin ruta
`DELETE /api/admin/tenants/:id`.

---

## 4. La API

Todo bajo `handleAdmin`, con el mismo `adminIdentity` + `adminCorsGuard` de las rutas de leads.

| Método y ruta | Qué hace |
|---|---|
| `GET /api/admin/tenants` | Lista, con recuento de leads y estado de configuración |
| `POST /api/admin/tenants` | Alta. Valida y crea versión inicial |
| `GET /api/admin/tenants/:id` | Detalle completo, incluido el prompt |
| `PATCH /api/admin/tenants/:id` | Edición parcial, con bloqueo optimista y versionado |
| `GET /api/admin/tenants/:id/versions` | Historial de cambios |
| `POST /api/admin/tenants/:id/versions/:v/restore` | Rollback |
| `POST /api/admin/tenants/:id/preview` | **Probar el prompt sin guardar ni enviar nada** |

El listado da lo justo para ver de un vistazo qué cliente está mal configurado:

```js
if (path === '/api/admin/tenants' && request.method === 'GET') {
  const rows = (await env.DB.prepare(`
    SELECT t.id, t.slug, t.name, t.channel_address, t.active, t.updated_at,
           t.lead_template_sid IS NOT NULL AS has_template,
           t.team_whatsapp IS NOT NULL AS has_team,
           length(t.system_prompt) AS prompt_len,
           COUNT(l.id) AS lead_count
    FROM tenants t LEFT JOIN leads l ON l.tenant_id = t.id
    GROUP BY t.id ORDER BY t.active DESC, t.name ASC`).all()).results;
  return json({ tenants: rows });
}
```

### El PATCH, con versionado

```js
if (tenantMatch && request.method === 'PATCH') {
  const body = await readJson(request, 32000);   // el prompt es grande
  const previous = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
  if (!previous) throw new HttpError(404, 'not_found');
  const fields = validateTenant(body, { partial: true });
  if (!Object.keys(fields).length) throw new HttpError(400, 'nothing_to_update');

  const now = new Date().toISOString();
  const columns = Object.keys(fields);
  const sql = `UPDATE tenants SET ${columns.map((c) => `${c}=?`).join(',')}, updated_at=? WHERE id=? AND updated_at=?`;
  const result = await env.DB.prepare(sql)
    .bind(...columns.map((c) => fields[c]), now, id, clean(body.expected_updated_at, 40)).run();
  if (!result.meta.changes) throw new HttpError(409, 'stale_tenant');

  // El prompt se versiona aparte porque es lo que de verdad querrás revertir.
  const changedPrompt = fields.system_prompt !== undefined && fields.system_prompt !== previous.system_prompt;
  await env.DB.prepare(
    'INSERT INTO tenant_versions (tenant_id, actor_email, field, previous_value, note, created_at) VALUES (?,?,?,?,?,?)'
  ).bind(id, actor, changedPrompt ? 'system_prompt' : 'config',
         changedPrompt ? previous.system_prompt : JSON.stringify(
           Object.fromEntries(columns.filter((c) => c !== 'system_prompt').map((c) => [c, previous[c]]))),
         clean(body.note, 200) || null, now).run();

  await invalidateTenantCache(env, previous.channel_address, fields.channel_address);
  if (changedPrompt) {
    ctx.waitUntil(sendTelegramText(env,
      `✏️ <b>${escapeHtml(actor)}</b> cambió el contexto de <b>${escapeHtml(previous.name)}</b>`).catch(() => {}));
  }
  return json({ ok: true, updated_at: now });
}
```

Ese aviso a Telegram cuesta tres líneas y te entera de cualquier cambio en el bot de un cliente
sin tener que mirar el panel.

### El preview — lo que hace útil el panel

```js
// POST /api/admin/tenants/:id/preview  { prompt, message }
// Ejecuta el prompt BORRADOR contra el modelo. No guarda, no toca KV, no crea lead,
// no notifica a nadie. Sirve para iterar el contexto y ver la respuesta al momento.
if (tenantMatch && action === 'preview' && request.method === 'POST') {
  if (await rateLimited(env, actor, 'preview', 20)) throw new HttpError(429, 'rate_limited');
  const body = await readJson(request, 32000);
  const draft = String(body.prompt ?? '').trim().slice(0, PROMPT_MAX);
  const message = clean(body.message, 500);
  if (draft.length < PROMPT_MIN || !message) throw new HttpError(400, 'invalid_preview');
  const reply = await callAnthropic(env, {
    model: 'claude-sonnet-4-6', max_tokens: 300,
    system: `${draft}\n${config.GUARDRAILS || ''}`.trim(),
    messages: [{ role: 'user', content: message }],
  });
  return json({ reply });
}
```

Fíjate en el `rateLimited` por `actor`, no por IP: son llamadas al modelo y se pagan. 20/min es
generoso para iterar y suficiente para que un bucle accidental no se coma la factura.

> Para el preview hace falta que `handleAdmin` reciba `config` — hoy no lo hace. Un parámetro más
> desde `createWorker`.

---

## 5. La interfaz

`worker/admin-page.js` es un HTML autocontenido con nonce y JS vanilla. Se amplía, no se
reescribe: se añade una pestaña **Clientes** junto a la de Leads, reutilizando estilos, `dialog`
y el patrón de `fetch` que ya hay.

**Listado.** Una fila por cliente con nombre, canal, número de leads y un semáforo de
configuración: sin plantilla, sin equipo o prompt sospechosamente corto salen marcados. Es la
pantalla que responde "¿está todo bien montado?" sin abrir nada.

**Ficha.** Dos zonas:

- *Configuración* — campos cortos, cada uno con su formato de ejemplo debajo (`whatsapp:+34…`,
  `HX…`). Los errores de validación se pintan en su campo, no en un `alert` genérico.
- *Contexto* — un `<textarea>` grande, monoespaciado, con **contador de caracteres y coste
  estimado por mensaje**. Esto importa: el prompt se envía en *cada* llamada al modelo, así que
  4.000 caracteres de más no son un detalle estético, son dinero en cada conversación. Que se vea
  mientras se escribe.

**Probar.** Debajo del contexto: un campo "mensaje de prueba", un botón y la respuesta del bot.
Llama a `/preview` con el borrador **sin guardar**. Iteras el contexto y ves el efecto al momento;
es la diferencia entre un formulario y una herramienta.

**Historial.** Lista de cambios con quién y cuándo, y por cada uno "Ver" y "Restaurar". Restaurar
crea una versión nueva, no borra: siempre se puede deshacer el deshacer.

**Alta.** Formulario con los mismos campos y un botón "Duplicar de…" que copia el contexto de
otro cliente como punto de partida. Para verticales parecidas (dos barberías, dos clínicas) ahorra
la mayor parte del trabajo.

---

## 6. Tests

```js
test('rechaza channel_address con formato inválido');
test('rechaza un lead_template_sid que no sea HX + 32 hex');
test('un slug o channel_address duplicado devuelve 409, no 500');
test('el PATCH con updated_at viejo devuelve 409 stale_tenant');
test('guardar invalida la clave KV vieja Y la nueva al cambiar de dirección');
test('el preview no escribe en D1 ni en KV');
test('no existe ruta DELETE de tenants');
```

El de la invalidación de caché y el del preview sin efectos son los dos que de verdad hay que
tener: los demás fallan ruidosamente, esos dos fallan en silencio.

---

## 7. Orden

1. Fase 1 desplegada y verificada (WhatsApp y Messenger enrutando por `tenants`).
2. Migración `0003_tenant_admin.sql`.
3. API de tenants + tests.
4. Interfaz.
5. Prueba real: crear un cliente de mentira, editar su contexto, probarlo con el preview,
   restaurar una versión anterior, desactivarlo. Sin tocar la CLI en ningún momento — que es el
   objetivo de toda la fase.

---

## 8. Lo que deliberadamente no lleva

- **Borrado de clientes.** Solo desactivar.
- **Credenciales.** Ninguna, nunca.
- **Borrador y publicación.** Guardar es publicar. Con preview y rollback es suficiente para un
  equipo de dos o tres personas; el flujo de borradores añade complejidad que ahora no compensa.
- **Roles.** Todos los que pasan el Access pueden todo. Cuando entre alguien de fuera del núcleo,
  toca separar por grupo de Access.
- **Editar las `DEMOS`.** Siguen en código: son material comercial de Velai, no clientes.
