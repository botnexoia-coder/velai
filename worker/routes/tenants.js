// Dominio TENANTS del panel (solo rol velai — clienteAllowed no abre ninguna de estas
// rutas): alta y ficha del cliente, versionado/restauración del prompt, preview contra
// el modelo, aprovisionamiento de Twilio y usuarios del cliente. Migrado tal cual del
// adminRouter monolítico — misma conducta, mismos códigos.
import { Hono } from 'hono';
import { partesAdmin, envAdmins } from '../middleware.js';
import { templateKind, catalogKinds } from '../plantillas.js';
import {
  HttpError, json, NO_STORE, clean, readJson, rateLimited, callAnthropic,
  validateTenant, tenantTokenColumn, assertNotActivePending, assertTeamNotFrom,
  tenantWriteError, syncPrimaryChannel, assertChannelFree, invalidateTenantCache,
  tenantChannelSummary, handleProvision, panelUserAudit, syncPanelGate,
  sendTelegramText, escapeHtml, UUID_RE, PANEL_EMAIL_RE, PENDING_RE,
  PROMPT_MIN, PROMPT_MAX, WA_MAX_TOKENS, WA_BODY_LIMIT, reminderHoursFor,
} from '../app.js';

export const tenants = new Hono();

tenants.get('/api/admin/tenants', async (c) => {
  const { env } = partesAdmin(c);
  // Semáforo de configuración de un vistazo: sin plantilla, sin equipo o con
  // prompt sospechosamente corto se ve desde el listado, sin abrir nada.
  const rows = (await env.DB.prepare(`
    SELECT t.id, t.slug, t.name, t.channel_address, t.active, t.updated_at,
           t.lead_template_sid IS NOT NULL AS has_template,
           t.team_whatsapp IS NOT NULL AS has_team,
           t.twilio_subaccount_sid IS NOT NULL AS has_subaccount,
           t.twilio_auth_token_enc IS NOT NULL AS has_twilio_token,
           t.twilio_from IS NOT NULL AS has_from,
           t.telegram_chat_id IS NOT NULL AS has_telegram,
           t.meta_partner_status,
           t.sender_status,
           (SELECT group_concat(kind) FROM tenant_channels c WHERE c.tenant_id = t.id) AS channels,
           length(t.system_prompt) AS prompt_len,
           COUNT(l.id) AS lead_count
    FROM tenants t LEFT JOIN leads l ON l.tenant_id = t.id
    GROUP BY t.id ORDER BY t.active DESC, t.name ASC`).all()).results;
  return json({ tenants: rows }, 200, NO_STORE);
});

// ── Catálogo de plantillas (vista «Plantillas», para AMBOS roles) ─────────────
// Velai ve la matriz global; el cliente, SOLO su fila (decisión de Juan: «el cliente
// debe poder ver sus plantillas, cómo están creadas y qué ve el cliente final»).
// Mismo endpoint consciente del rol, patrón de /stats.

// Parse seguro del JSON de opciones (0031): basura en la columna → null, la vista
// nunca revienta por un dato viejo o corrupto.
function parseOpciones(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch (_) { return null; }
}

// La fila de UN tenant con su mapa de plantillas: el registro (tenant_templates, con
// lo elegido en `opciones`) + la de LEADS desde las columnas históricas (unificación
// de LECTURA; sin updated_at — el de la fila entera de tenants mentiría). `sinSid`:
// la vista del cliente es de solo lectura y el sid es dato operativo de Velai.
function plantillasDe(t, registroRows, { sinSid = false } = {}) {
  const plantillas = {};
  for (const r of registroRows) {
    // Un kind retirado del catálogo no se pinta (y el lookup seguro de templateKind
    // descarta de paso claves del prototipo).
    if (!templateKind(r.kind)) continue;
    plantillas[r.kind] = {
      ...(sinSid ? {} : { sid: r.sid || null }),
      status: r.status || null, updated_at: r.updated_at || null, opciones: parseOpciones(r.opciones),
      // La categoría REAL leída de Twilio por el poll (0032); null = aún no leída y el
      // panel enseña «—» — JAMÁS la intención del catálogo como si fuera un hecho.
      categoria: r.categoria || null,
    };
  }
  if (t.lead_template_sid || t.lead_template_status) {
    plantillas.aviso_lead = {
      ...(sinSid ? {} : { sid: t.lead_template_sid || null }),
      status: t.lead_template_status || null, updated_at: null, opciones: null,
      categoria: t.lead_template_category || null,
    };
  }
  return { id: t.id, slug: t.slug, name: t.name, active: t.active, plantillas };
}

// tenant_templates puede ir por detrás de las migraciones (0030/0031/0032): primero
// con `categoria` y `opciones`, luego sin las columnas que falten, y si la tabla
// falta, vacío — la vista sale igualmente con lo que viva en columnas.
async function leerRegistro(env, tenantId) {
  const where = tenantId ? ' WHERE tenant_id = ?' : '';
  const args = tenantId ? [tenantId] : [];
  for (const cols of [
    'tenant_id, kind, sid, status, opciones, categoria, updated_at',
    'tenant_id, kind, sid, status, opciones, updated_at',
    'tenant_id, kind, sid, status, updated_at',
  ]) {
    try {
      return (await env.DB.prepare(`SELECT ${cols} FROM tenant_templates${where}`).bind(...args).all()).results || [];
    } catch (_) { /* columna o tabla aún sin migrar: siguiente forma */ }
  }
  return [];
}

tenants.get('/api/admin/plantillas', async (c) => {
  const { env, scope } = partesAdmin(c);
  // Rol cliente: SOLO su fila — §4b caso 4, el id se ata desde el scope y jamás desde
  // la petición — sin sids y de solo lectura (la gestión sigue siendo de Velai).
  // OJO: no citar aquí el patrón literal del bind — check-aislamiento lee texto plano
  // y un comentario que lo nombre le taparía una consulta sin puerta de verdad.
  if (scope.role !== 'velai') {
    const propio = await env.DB.prepare('SELECT id, slug, name, active, reminder_hours, lead_template_sid, lead_template_status, lead_template_category FROM tenants WHERE id = ?').bind(scope.tenantId).first();
    if (!propio) throw new HttpError(404, 'not_found');
    const registro = await leerRegistro(env, scope.tenantId);
    // `hours` = su antelación vigente: los selectores de solicitud del cliente parten
    // de lo actual para que el de→a sea honesto.
    return json({ kinds: catalogKinds(), tenants: [{ ...plantillasDe(propio, registro, { sinSid: true }), hours: reminderHoursFor(propio) }] }, 200, NO_STORE);
  }
  // Velai: la matriz GLOBAL — filas de TODOS los clientes, sin scope a propósito
  // (la rama del cliente ya retornó arriba: estas consultas no son alcanzables por él).
  const rows = (await env.DB.prepare(`SELECT id, slug, name, active, lead_template_sid, lead_template_status, lead_template_category
    FROM tenants ORDER BY active DESC, name ASC`).all()).results || [];
  const registro = await leerRegistro(env, null);
  const porTenant = new Map();
  for (const r of registro) {
    const lista = porTenant.get(r.tenant_id) || [];
    lista.push(r);
    porTenant.set(r.tenant_id, lista);
  }
  return json({ kinds: catalogKinds(), tenants: rows.map((t) => plantillasDe(t, porTenant.get(t.id) || [])) }, 200, NO_STORE);
});

tenants.post('/api/admin/tenants', async (c) => {
  const { request, env, scope, actor } = partesAdmin(c);
  const body = await readJson(request, 32000);
  // La dirección del canal ya no se teclea en el alta: un cliente nuevo nace prospecto
  // (`pending:<slug>`) y pasa a `web:<slug>` en cuanto se marca Activo. El panel manda
  // el slug y el worker deriva.
  // El default de active en este endpoint es 1 (`fields.active ?? 1`): la derivación usa
  // EXACTAMENTE el mismo, o alta y guarda se contradicen con un 400 imposible de
  // entender desde el panel (un alta sin `active` nacería prospecto y activa a la vez).
  if (!body.channel_address && body.slug) {
    const base = String(body.slug).trim().toLowerCase();
    const willBeActive = body.active === undefined ? 1 : (body.active ? 1 : 0);
    body.channel_address = willBeActive === 1 ? `web:${base}` : `pending:${base}`;
  }
  const fields = validateTenant(body, { partial: false });
  assertNotActivePending(fields.channel_address, fields.active ?? 1);
  const now = new Date().toISOString();
  const tenantId = crypto.randomUUID();
  const tokenColumn = await tenantTokenColumn(env, tenantId, body);
  try {
    await env.DB.prepare(`INSERT INTO tenants
      (id,slug,name,channel_address,team_whatsapp,telegram_chat_id,lead_template_sid,twilio_from,twilio_subaccount_sid,waba_id,twilio_auth_token_enc,meta_partner_status,system_prompt,
       bot_name,brand_name,logo_url,brand_color,brand_color_2,agent_color,greeting,greeting_en,chips_json,placeholder,wa_number,theme,web_origins,
       active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(tenantId, fields.slug, fields.name, fields.channel_address, fields.team_whatsapp ?? null,
        fields.telegram_chat_id ?? null, fields.lead_template_sid ?? null, fields.twilio_from ?? null,
        fields.twilio_subaccount_sid ?? null, fields.waba_id ?? null, tokenColumn,
        fields.meta_partner_status ?? 'pendiente', fields.system_prompt,
        fields.bot_name ?? null, fields.brand_name ?? null, fields.logo_url ?? null,
        fields.brand_color ?? null, fields.brand_color_2 ?? null, fields.agent_color ?? null, fields.greeting ?? null,
        fields.greeting_en ?? null, fields.chips_json ?? null, fields.placeholder ?? null,
        fields.wa_number ?? null, fields.theme ?? null, fields.web_origins ?? null,
        fields.active ?? 1, now, now).run();
  } catch (error) { throw tenantWriteError(error); }
  await syncPrimaryChannel(env, tenantId, null, fields.channel_address);
  // Invalidar ANTES del versionado: si el INSERT de la versión fallara, la caché
  // no puede quedarse 5 minutos sirviendo el estado anterior.
  await invalidateTenantCache(env, [fields]);
  await env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
    .bind(tenantId, actor, 'config', null, clean(body.note, 200) || 'alta', now).run();
  return json({ ok: true, id: tenantId, updated_at: now }, 201, NO_STORE);
});

// Aprovisionamiento de Twilio (PR 6): el paso viaja en la ruta y la lógica —cerrojo,
// idempotencia, auditoría— vive en handleProvision (worker/app.js), que también usan
// los tests directamente.
const provision = async (c) => {
  const { request, env, ctx, actor } = partesAdmin(c);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
  const step = [c.req.param('paso'), c.req.param('sub')].filter(Boolean).join('/');
  return handleProvision(request, env, ctx, id, step, actor);
};
tenants.all('/api/admin/tenants/:id/provision', provision);
tenants.all('/api/admin/tenants/:id/provision/:paso{subaccount|template|sender|domains}', provision);
tenants.all('/api/admin/tenants/:id/provision/:paso{template}/:sub{check|resubmit}', provision);
// Plantillas del catálogo (worker/plantillas.js): el kind viaja en la ruta y el paso
// genérico de app.js lo valida contra el catálogo (404 unknown_template_kind).
tenants.all('/api/admin/tenants/:id/provision/:paso{plantillas}/:sub{[a-z0-9_]+}', provision);
tenants.all('/api/admin/tenants/:id/provision/:paso{sender}/:sub{verify|sync|profile}', provision);

// ── Usuarios del cliente (SPEC-USUARIOS §B.2): solo rol velai (clienteAllowed es
// lista blanca y no incluye estas rutas). resolveScope consulta tenant_users en cada
// petición sin caché, así que alta y baja surten efecto inmediato.
const grupoUsers = async (c) => {
  const { request, env, ctx, scope, actor } = partesAdmin(c);
  const tenantId = c.req.param('id');
  if (!UUID_RE.test(tenantId)) throw new HttpError(404, 'not_found');
  const userParam = c.req.param('email') || null;
  if (!userParam && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT email, created_at FROM tenant_users WHERE tenant_id=? ORDER BY created_at')
      .bind(tenantId).all();
    return json({ users: rows.results || [] }, 200, NO_STORE);
  }
  if (!userParam && request.method === 'POST') {
    const body = await readJson(request, 2000);
    const email = String(body.email || '').trim().toLowerCase();
    if (!PANEL_EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, 'invalid_email');
    // Un admin de Velai en la tabla quedaría degradado a un solo tenant al entrar
    // (resolveScope mira ADMIN_EMAILS primero, pero el error sería silencioso).
    if (envAdmins(env).includes(email)) throw new HttpError(400, 'email_is_admin');
    // También los admins de D1 (migración 0009): resolveScope los mira ANTES que
    // tenant_users, así que la fila de cliente quedaría muerta y confundiría.
    try {
      const adminRow = await env.DB.prepare('SELECT email FROM admin_users WHERE lower(email) = ?').bind(email).first();
      if (adminRow) throw new HttpError(400, 'email_is_admin');
    } catch (e) { if (e instanceof HttpError) throw e; }
    const tenant = await env.DB.prepare('SELECT id FROM tenants WHERE id=?').bind(tenantId).first();
    if (!tenant) throw new HttpError(404, 'not_found');
    try {
      await env.DB.prepare('INSERT INTO tenant_users (email, tenant_id, role, created_at) VALUES (?,?,?,?)')
        .bind(email, tenantId, 'cliente', new Date().toISOString()).run();
    } catch (e) {
      // email es PK: el caso real es un gestor que ya trabaja con otro cliente vuestro.
      if (/UNIQUE|PRIMARY KEY/i.test(String(e.message || ''))) throw new HttpError(409, 'email_taken');
      throw e;
    }
    await panelUserAudit(env, ctx, tenantId, actor, scope.role, `alta usuario ${email}`);
    const gate = await syncPanelGate(env, ctx);
    return json({ ok: true, email, gate }, 201, NO_STORE);
  }
  if (userParam && request.method === 'DELETE') {
    const email = userParam.trim().toLowerCase();
    const result = await env.DB.prepare('DELETE FROM tenant_users WHERE tenant_id=? AND lower(email)=?')
      .bind(tenantId, email).run();
    if (!result.meta || !result.meta.changes) throw new HttpError(404, 'not_found');
    await panelUserAudit(env, ctx, tenantId, actor, scope.role, `baja usuario ${email}`);
    // La baja TAMBIÉN sincroniza la puerta: si no, un correo revocado sigue pudiendo
    // autenticarse en Access (el worker le daría 403, pero la puerta debe cerrarse).
    const gate = await syncPanelGate(env, ctx);
    // `remaining` permite a la interfaz avisar de "este cliente se queda sin acceso".
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM tenant_users WHERE tenant_id=?').bind(tenantId).first();
    return json({ ok: true, remaining: left ? left.n : 0, gate }, 200, NO_STORE);
  }
  throw new HttpError(404, 'not_found');
};
tenants.all('/api/admin/tenants/:id/users', grupoUsers);
tenants.all('/api/admin/tenants/:id/users/:email', grupoUsers);

// La ficha del tenant y su versionado comparten handler, como compartían regex en el
// monolito. Un tenant no se borra NUNCA: los leads apuntan a tenant_id y el histórico
// es del negocio — el panel solo desactiva (active=0), y lo demás sigue siendo 405.
const grupoTenant = async (c) => {
  const { request, env, ctx, scope, actor, config } = partesAdmin(c);
  const tenantId = c.req.param('id');
  if (!UUID_RE.test(tenantId)) throw new HttpError(404, 'not_found');
  const versionId = c.req.param('vid') || null;
  const tenantAction = c.req.param('accion') || (versionId ? 'versions' : null);
  if (!tenantAction && request.method === 'GET') {
    // Columnas explícitas, NUNCA SELECT *: twilio_auth_token_enc no sale del worker.
    const tenant = await env.DB.prepare(`SELECT id, slug, name, channel_address, team_whatsapp, telegram_chat_id,
      lead_template_sid, twilio_from, twilio_subaccount_sid, waba_id, meta_partner_status, system_prompt,
      bot_name, brand_name, logo_url, brand_color, brand_color_2, agent_color, greeting, greeting_en, chips_json,
      placeholder, wa_number, theme, web_origins, sender_sid, sender_status, telegram_chat_title,
      ai_monthly_tokens, ai_daily_limit, support_hours, support_tz,
      active, created_at, updated_at, twilio_auth_token_enc IS NOT NULL AS has_twilio_token
      FROM tenants WHERE id=?`).bind(tenantId).first();
    if (!tenant) throw new HttpError(404, 'not_found');
    return json({ tenant, channels: await tenantChannelSummary(env, tenant) }, 200, NO_STORE);
  }
  if (!tenantAction && request.method === 'PATCH') {
    const body = await readJson(request, 32000);   // el prompt es grande
    const previous = await env.DB.prepare('SELECT * FROM tenants WHERE id=?').bind(tenantId).first();
    if (!previous) throw new HttpError(404, 'not_found');
    const fields = validateTenant(body, { partial: true });
    const tokenColumn = await tenantTokenColumn(env, tenantId, body);
    if (!Object.keys(fields).length && !tokenColumn) throw new HttpError(400, 'nothing_to_update');
    // Activar un prospecto obligaba a reescribir `pending:<slug>` → `web:<slug>` a mano
    // en una caja de texto. Ese paso es el que dejó a gogestion con `web:gogestion`
    // ocupando el canal primario y su WhatsApp sin enrutar. Ahora se promueve solo.
    // Si el llamante manda EXPLÍCITAMENTE un `pending:` y active=1, sigue siendo 400:
    // eso es una contradicción que pidió a mano, no un hueco que rellenar.
    if (fields.channel_address === undefined && Number(fields.active ?? previous.active) === 1
      && PENDING_RE.test(String(previous.channel_address))) {
      fields.channel_address = `web:${previous.slug}`;
    }
    assertNotActivePending(fields.channel_address ?? previous.channel_address, fields.active ?? previous.active);
    assertTeamNotFrom(fields, previous);
    const channelChanged = fields.channel_address !== undefined && fields.channel_address !== previous.channel_address;
    if (channelChanged) await assertChannelFree(env, fields.channel_address, tenantId);
    const now = new Date().toISOString();
    // `columns` alimenta también el versionado: el token va aparte y jamás entra ahí.
    const columns = Object.keys(fields);
    const setSql = [...columns.map((c2) => `${c2}=?`), ...(tokenColumn ? ['twilio_auth_token_enc=?'] : [])].join(',');
    const setValues = [...columns.map((c2) => fields[c2]), ...(tokenColumn ? [tokenColumn] : [])];
    // Bloqueo optimista: sin el updated_at cargado, el último en guardar pisaría al otro.
    let result;
    try {
      result = await env.DB.prepare(`UPDATE tenants SET ${setSql}, updated_at=? WHERE id=? AND updated_at=?`)
        .bind(...setValues, now, tenantId, clean(body.expected_updated_at, 40)).run();
    } catch (error) { throw tenantWriteError(error); }
    if (!result.meta.changes) throw new HttpError(409, 'stale_tenant');
    // El prompt se versiona aparte porque es lo que de verdad se querrá revertir.
    const changedPrompt = fields.system_prompt !== undefined && fields.system_prompt !== previous.system_prompt;
    await env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
      .bind(tenantId, actor, changedPrompt ? 'system_prompt' : 'config',
        changedPrompt ? previous.system_prompt : JSON.stringify(
          Object.fromEntries(columns.filter((c2) => c2 !== 'system_prompt').map((c2) => [c2, previous[c2]]))),
        clean(body.note, 200) || null, now).run();
    if (channelChanged) await syncPrimaryChannel(env, tenantId, previous.channel_address, fields.channel_address);
    await invalidateTenantCache(env, [previous, fields]);
    if (changedPrompt) {
      ctx.waitUntil(sendTelegramText(env, `✏️ <b>${escapeHtml(actor)}</b> cambió el contexto de <b>${escapeHtml(previous.name)}</b>`).catch(() => {}));
    }
    return json({ ok: true, updated_at: now }, 200, NO_STORE);
  }
  if (tenantAction === 'versions' && !versionId && request.method === 'GET') {
    const rows = (await env.DB.prepare('SELECT id, actor_email, field, previous_value, note, created_at FROM tenant_versions WHERE tenant_id=? ORDER BY created_at DESC LIMIT 20').bind(tenantId).all()).results;
    return json({ versions: rows }, 200, NO_STORE);
  }
  if (tenantAction === 'versions' && versionId && request.method === 'POST') {
    // Restaurar crea una versión nueva, no borra: siempre se puede deshacer el deshacer.
    // Solo se restauran versiones de prompt; las de config son consultables ("Ver").
    const version = await env.DB.prepare('SELECT * FROM tenant_versions WHERE id=? AND tenant_id=?').bind(versionId, tenantId).first();
    if (!version) throw new HttpError(404, 'not_found');
    if (version.field !== 'system_prompt' || !version.previous_value) throw new HttpError(400, 'not_restorable');
    const previous = await env.DB.prepare('SELECT * FROM tenants WHERE id=?').bind(tenantId).first();
    if (!previous) throw new HttpError(404, 'not_found');
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare('UPDATE tenants SET system_prompt=?, updated_at=? WHERE id=?').bind(version.previous_value, now, tenantId),
      env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
        .bind(tenantId, actor, 'system_prompt', previous.system_prompt, `restore #${version.id}`, now),
    ]);
    await invalidateTenantCache(env, [previous]);
    return json({ ok: true, updated_at: now }, 200, NO_STORE);
  }
  if (tenantAction === 'preview' && request.method === 'POST') {
    // Ejecuta el prompt BORRADOR contra el modelo. No guarda, no toca KV, no crea
    // lead, no notifica. Rate limit por actor (no por IP): son llamadas que se pagan.
    // Sin cupo por tenant a propósito: son llamadas de admin ya limitadas por actor,
    // y no deben gastar el presupuesto diario del cliente que se está editando.
    if (await rateLimited(env, actor, 'preview', 20)) throw new HttpError(429, 'rate_limited');
    const body = await readJson(request, 32000);
    const draft = String(body.prompt ?? '').trim().slice(0, PROMPT_MAX);
    const message = clean(body.message, 500);
    if (draft.length < PROMPT_MIN || !message) throw new HttpError(400, 'invalid_preview');
    const reply = await callAnthropic(env, {
      model: 'claude-sonnet-4-6', max_tokens: WA_MAX_TOKENS,
      system: `${draft}\n${config.GUARDRAILS || ''}`.trim(),
      messages: [{ role: 'user', content: message }],
    }, { closing: 'equipo', bodyLimit: WA_BODY_LIMIT });
    return json({ reply }, 200, NO_STORE);
  }
  throw new HttpError(405, 'method_not_allowed');
};
tenants.all('/api/admin/tenants/:id', grupoTenant);
tenants.all('/api/admin/tenants/:id/:accion{preview|versions}', grupoTenant);
tenants.all('/api/admin/tenants/:id/versions/:vid{\\d+}/restore', grupoTenant);
