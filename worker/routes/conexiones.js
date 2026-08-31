// Dominio CONEXIONES del panel: los canales del cliente (globales y por tenant), el
// estado de su WhatsApp, sus destinos de aviso, el logo de marca (web + foto de
// WhatsApp), el informe semanal de prueba y todo el autoservicio de Telegram
// (vinculación, bot propio de marca blanca, Temas). Migrado tal cual del adminRouter
// monolítico — misma conducta, mismos códigos.
import { Hono } from 'hono';
import { partesAdmin, assertOwnTenant } from '../middleware.js';
import { encryptSecret } from '../crypto.js';
import {
  HttpError, json, NO_STORE, clean, readJson, rateLimited, sendTelegramText,
  escapeHtml, invalidateTenantCache, tenantChannelSummary, channelsForScope,
  leadAlertStatus, pushSenderProfile, mediaPut, PUBLIC_MEDIA_BASE, validateTenant,
  assertTeamNotFrom, weeklyStats, weeklyReportText, tenantTelegramToken,
  telegramSetWebhook, telegramBotUsername, createTelegramTopic,
  UUID_RE, CONV_TRACKING_SINCE, TELEGRAM_BOT_TOKEN_RE,
} from '../app.js';

export const conexiones = new Hono();

conexiones.post('/api/admin/tenants/:id/logo/apply', async (c) => {
  const { env, scope } = partesAdmin(c);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
  assertOwnTenant(scope, id);
  const tenant = await env.DB.prepare(`SELECT id, slug, name, logo_url, logo_wa_url, brand_name, greeting, web_origins,
    sender_sid, twilio_subaccount_sid, twilio_auth_token_enc FROM tenants WHERE id=?`).bind(id).first();
  if (!tenant) throw new HttpError(404, 'not_found');
  if (!tenant.logo_url && !tenant.logo_wa_url) throw new HttpError(400, 'logo_missing');
  if (!tenant.sender_sid) throw new HttpError(400, 'sender_required');
  const out = await pushSenderProfile(env, tenant);
  // El código REAL de Twilio llega al panel: aplanarlo a «sender_profile_failed» me
  // hizo culpar a la imagen cuando el 63100 era del cuerpo de la petición.
  if (!out.ok) return json({ ok: false, error: out.error || 'sender_profile_failed', why: out.why || null }, 502, NO_STORE);
  return json({ ok: true, applied: out.applied }, 200, NO_STORE);
});

conexiones.post('/api/admin/tenants/:id/logo', async (c) => {
  const { request, env, ctx, url, scope, actor } = partesAdmin(c);
  const tenantId = c.req.param('id');
  if (!UUID_RE.test(tenantId)) throw new HttpError(404, 'not_found');
  // Cliente ajeno = 404 ANTES de tocar D1 (nunca 403: no se confirma que exista).
  assertOwnTenant(scope, tenantId);
  const tenant = await env.DB.prepare(`SELECT id, slug, name, logo_url, logo_wa_url, brand_name, greeting, web_origins,
    sender_sid, twilio_subaccount_sid, twilio_auth_token_enc FROM tenants WHERE id=?`).bind(tenantId).first();
  if (!tenant) throw new HttpError(404, 'not_found');
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength < 64) throw new HttpError(400, 'invalid_image');
  if (body.byteLength > 2 * 1024 * 1024) throw new HttpError(413, 'image_too_large');
  // El tipo lo deciden los MAGIC BYTES, no el header: png/jpeg/webp y nada más.
  let ext = null, mime = null;
  if (body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) { ext = 'png'; mime = 'image/png'; }
  else if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) { ext = 'jpg'; mime = 'image/jpeg'; }
  else if (body[0] === 0x52 && body[1] === 0x49 && body[2] === 0x46 && body[3] === 0x46 && body[8] === 0x57 && body[9] === 0x45 && body[10] === 0x42 && body[11] === 0x50) { ext = 'webp'; mime = 'image/webp'; }
  if (!ext) throw new HttpError(400, 'invalid_image');
  // ¿A qué canales aplica esta imagen? Por defecto, a los dos (lo que hacía antes).
  // Ausente = a los dos canales (lo que hacía antes de separarlos). Presente pero
  // vacío es una petición explícita sin canales: eso se rechaza, no se adivina.
  const raw = url.searchParams.get('channels');
  const pedidos = String(raw === null ? 'web,whatsapp' : raw).toLowerCase().split(',').map((x) => x.trim());
  const aWeb = pedidos.includes('web');
  const aWa = pedidos.includes('whatsapp');
  if (!aWeb && !aWa) throw new HttpError(400, 'channels_required');
  // Clave por canal: si son imágenes distintas no pueden compartir fichero.
  const key = `logos/${tenantId}${aWeb && aWa ? '' : (aWeb ? '-web' : '-wa')}.${ext}`;
  const store = await mediaPut(env, key, body, mime);
  const now = new Date().toISOString();
  const logoUrl = `${PUBLIC_MEDIA_BASE}/media/${key}?v=${now.replace(/[^0-9]/g, '').slice(0, 14)}`;
  const cols = [...(aWeb ? ['logo_url=?'] : []), ...(aWa ? ['logo_wa_url=?'] : [])];
  const vals = cols.map(() => logoUrl);
  await env.DB.prepare(`UPDATE tenants SET ${cols.join(',')}, updated_at=? WHERE id=?`).bind(...vals, now, tenantId).run();
  await env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
    .bind(tenantId, actor, 'config', JSON.stringify({ logo_url: tenant.logo_url }), `logo subido a ${store} para ${[aWeb ? 'web' : null, aWa ? 'whatsapp' : null].filter(Boolean).join('+')} (${ext}, ${Math.round(body.byteLength / 1024)} KB)`, now).run();
  await invalidateTenantCache(env, [tenant]);
  // La foto de WhatsApp se actualiza SOLA: el cliente sube su logo y ya está en los dos
  // canales, sin entender de perfiles. En segundo plano porque Twilio puede tardar y la
  // subida no debe fallar por ello — el resultado queda registrado para el panel.
  if (aWa && tenant.sender_sid && tenant.twilio_subaccount_sid) {
    ctx.waitUntil(pushSenderProfile(env, { ...tenant, logo_wa_url: logoUrl }));
  }
  return json({ ok: true, logo_url: logoUrl, store, canales: { web: aWeb, whatsapp: aWa },
    whatsapp: !!(aWa && tenant.sender_sid && tenant.twilio_subaccount_sid) }, 200, NO_STORE);
});

// ── Canales vivos: visibilidad del ENRUTADO (2026-08-24) ──────────────────
// El panel mostraba la opinión de TWILIO (sender ONLINE) y las columnas de la ficha,
// nunca la tabla que de verdad enruta. Resultado: gogestion con el sender en verde,
// la ficha impecable y el bot MUDO, porque no existía su fila en tenant_channels y
// nada en el panel podía delatarlo. Esta vista contesta la única pregunta que
// importa: qué direcciones atiende el worker, y para quién.
conexiones.get('/api/admin/channels', async (c) => {
  const { env } = partesAdmin(c);
  const rows = (await env.DB.prepare(`SELECT c.address, c.kind, c.created_at, c.tenant_id,
           t.slug, t.name, t.active, t.twilio_from, t.sender_status
    FROM tenant_channels c LEFT JOIN tenants t ON t.id = c.tenant_id
    ORDER BY t.name IS NULL DESC, t.name ASC, c.kind ASC`).all()).results || [];
  // El diagnóstico se calcula AQUÍ, no en el navegador: es la MISMA pregunta que se
  // hace tenantByAddress en cada mensaje entrante (¿resuelve un tenant activo?), así
  // que vive junto a ella y se puede testear.
  // Dos formatos conviven en la columna: el backfill de la 0017 usó datetime('now')
  // (UTC sin marca) y syncPrimaryChannel escribe ISO con Z. Sin normalizar, el panel
  // pinta las viejas como hora local y se van 2 h.
  const isoish = (v) => (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(String(v || '')) ? `${String(v).replace(' ', 'T')}Z` : v);
  const channels = rows.map((r) => {
    let state = 'live';
    if (!r.slug) state = 'orphan';                                                            // fila apuntando a un tenant borrado
    else if (!r.active) state = 'inactive';                                                   // tenantByAddress exige active = 1
    else if (r.kind === 'whatsapp' && r.twilio_from && r.twilio_from !== r.address) state = 'from_mismatch'; // entra por aquí, responde por otro
    return { ...r, created_at: isoish(r.created_at), state };
  });
  // El caso gogestion al revés: sender de WhatsApp vivo en Twilio y NINGUNA fila que
  // lo enrute. El webhook responde 404 unknown_tenant y el bot calla, en verde.
  // COALESCE: un channel_address nulo no puede esconder el hueco (NULL <> x es NULL).
  // sender_sid IS NOT NULL es el filtro que separa «tiene sender propio» de «usa el
  // número de la cuenta padre»: velai-messenger lleva el From de Velai para los avisos
  // de salida y NO es un WhatsApp sin atender — sin esta línea salía como alarma falsa.
  const unrouted = (await env.DB.prepare(`SELECT t.id AS tenant_id, t.slug, t.name, t.active,
           t.channel_address, t.twilio_from, t.sender_status
    FROM tenants t
    WHERE t.sender_sid IS NOT NULL
      AND t.twilio_from IS NOT NULL
      AND COALESCE(t.channel_address, '') <> t.twilio_from
      AND NOT EXISTS (SELECT 1 FROM tenant_channels c WHERE c.tenant_id = t.id AND c.address = t.twilio_from)
    ORDER BY t.active DESC, t.name ASC`).all()).results || [];
  return json({ channels, unrouted }, 200, NO_STORE);
});

// ── Los canales DEL cliente, en su propio espacio ─────────────────────────
// Hoy tenía que leer tres tarjetas separadas para deducir qué tiene funcionando, y su
// canal web no aparecía en ninguna parte pese a llevar el widget en su web. Ajeno = 404,
// nunca 403: el molde del resto de rutas en autoservicio.
conexiones.get('/api/admin/tenants/:id/channels', async (c) => {
  const { env, scope } = partesAdmin(c);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
  assertOwnTenant(scope, id);
  const row = await env.DB.prepare(`SELECT id, slug, active, channel_address, twilio_from, sender_sid,
           telegram_chat_id, telegram_chat_title, web_origins
    FROM tenants WHERE id=?`).bind(id).first();
  if (!row) throw new HttpError(404, 'not_found');
  return json({ channels: channelsForScope(scope, await tenantChannelSummary(env, row)) }, 200, NO_STORE);
});

// ── WhatsApp del tenant (SPEC-CONEXIONES PR2): estado de SOLO LECTURA para el
// cliente, en columnas explícitas — ni el token cifrado ni el SID de la subcuenta
// (eso es infraestructura de Velai, no dato del cliente).
conexiones.get('/api/admin/tenants/:id/whatsapp', async (c) => {
  const { env, scope } = partesAdmin(c);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
  assertOwnTenant(scope, id);
  // `routed`: existe la fila de tenant_channels que hace que el webhook entrante
  // resuelva a este cliente. Sin ella el sender puede estar ONLINE y el bot mudo, así
  // que el estado que ve el cliente NO puede salir solo de sender_status.
  const row = await env.DB.prepare(`SELECT channel_address, twilio_from, (waba_id IS NOT NULL) AS has_waba, sender_status, lead_template_status, meta_partner_status, team_whatsapp, wa_number, logo_url, logo_wa_url, (twilio_auth_token_enc IS NOT NULL) AS has_token, (twilio_subaccount_sid IS NOT NULL) AS has_subaccount,
           (twilio_from IS NOT NULL AND (channel_address = twilio_from OR EXISTS (SELECT 1 FROM tenant_channels c WHERE c.tenant_id = tenants.id AND c.address = tenants.twilio_from))) AS routed
    FROM tenants WHERE id=?`).bind(id).first();
  if (!row) throw new HttpError(404, 'not_found');
  // Cómo fue el último empujón de la foto al perfil de WhatsApp (lo escribe el
  // waitUntil de la subida del logo): sin esto, un fallo en segundo plano es invisible.
  let profileSync = null;
  if (env.KV) { try { profileSync = await env.KV.get(`waprof:${id}`, 'json'); } catch (_) {} }
  // El estado de ENTREGA de los avisos, calculado con las mismas condiciones que deliver().
  // La fila de arriba no lo trae: necesita telegram_chat_id y el SID de la plantilla.
  const alertRow = await env.DB.prepare(`SELECT telegram_chat_id, twilio_subaccount_sid, team_whatsapp,
           lead_template_sid, lead_template_status, twilio_from FROM tenants WHERE id=?`).bind(id).first();
  return json({ whatsapp: row, alerts: leadAlertStatus(env, alertRow || {}), profileSync }, 200, NO_STORE);
});

// ── Números de aviso (SPEC-CONEXIONES PR3): el cliente edita SUS destinos ──
conexiones.patch('/api/admin/tenants/:id/notify', async (c) => {
  const { request, env, ctx, scope, actor } = partesAdmin(c);
  const tenantId = c.req.param('id');
  if (!UUID_RE.test(tenantId)) throw new HttpError(404, 'not_found');
  assertOwnTenant(scope, tenantId);
  const previous = await env.DB.prepare('SELECT id, slug, channel_address, twilio_from, team_whatsapp, wa_number, weekly_report, support_hours, support_tz FROM tenants WHERE id=?').bind(tenantId).first();
  if (!previous) throw new HttpError(404, 'not_found');
  const body = await readJson(request, 4000);
  const subset = {};
  if (body.team_whatsapp !== undefined) subset.team_whatsapp = body.team_whatsapp;
  if (body.wa_number !== undefined) subset.wa_number = body.wa_number;
  if (body.weekly_report !== undefined) subset.weekly_report = body.weekly_report;
  // Horario de atención humana: es configuración del negocio y la decide el cliente.
  if (body.support_hours !== undefined) subset.support_hours = body.support_hours;
  if (body.support_tz !== undefined) subset.support_tz = body.support_tz;
  if (!Object.keys(subset).length) throw new HttpError(400, 'nothing_to_update');
  const fields = validateTenant(subset, { partial: true }); // WA_RE / WA_DIGITS_RE de siempre
  assertTeamNotFrom(fields, previous);
  const now = new Date().toISOString();
  const columns = Object.keys(fields);
  await env.DB.prepare(`UPDATE tenants SET ${columns.map((col) => `${col}=?`).join(',')}, updated_at=? WHERE id=?`)
    .bind(...columns.map((col) => fields[col]), now, tenantId).run();
  await invalidateTenantCache(env, [previous]);
  ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
    .bind(tenantId, actor, 'config', JSON.stringify(Object.fromEntries(columns.map((col) => [col, previous[col]]))), `avisos (autoservicio, rol ${scope.role})`, now).run().catch(() => {}));
  return json({ ok: true }, 200, NO_STORE);
});

// Enviar el informe AHORA, como prueba. Sin esto, la única forma de comprobar que el
// informe semanal funciona es esperar al lunes — inaceptable para algo que depende de
// que el grupo esté vinculado y el bot tenga permisos. Manda los ÚLTIMOS 7 DÍAS (no la
// semana cerrada: con el historial recién arrancado esa saldría vacía) y va marcado como
// prueba para que nadie lo confunda con el informe del lunes.
// NO toca tenant_reports: una prueba no puede consumir el envío real de la semana.
conexiones.post('/api/admin/tenants/:id/report/test', async (c) => {
  const { env, scope, actor } = partesAdmin(c);
  const tenantId = c.req.param('id');
  if (!UUID_RE.test(tenantId)) throw new HttpError(404, 'not_found');
  assertOwnTenant(scope, tenantId);
  // Un botón que escribe en el grupo del cliente no se pulsa en bucle.
  if (await rateLimited(env, `${actor}:${tenantId}`, 'reporttest', 5)) throw new HttpError(429, 'rate_limited');
  const tenantRow = await env.DB.prepare('SELECT id, slug, name, telegram_chat_id, telegram_bot_token_enc FROM tenants WHERE id=?').bind(tenantId).first();
  if (!tenantRow) throw new HttpError(404, 'not_found');
  if (!tenantRow.telegram_chat_id) throw new HttpError(400, 'telegram_no_vinculado');
  const ms = Date.now();
  const period = {
    start: new Date(ms - 7 * 86400000).toISOString(),
    end: new Date(ms).toISOString(),
    prev: new Date(ms - 14 * 86400000).toISOString(),
  };
  const stats = await weeklyStats(env, [tenantId], period);
  const st = stats.get(tenantId);
  const comparable = period.prev.slice(0, 10) >= CONV_TRACKING_SINCE;
  const text = '🧪 <b>PRUEBA</b> — así llegará tu informe cada lunes por la mañana.\n\n'
    + weeklyReportText(tenantRow, st, period, comparable);
  const outcome = await sendTelegramText(env, text, tenantRow.telegram_chat_id,
    { allowFallback: false, botToken: await tenantTelegramToken(env, tenantRow) });
  if (!outcome.ok) throw new HttpError(502, clean(outcome.error || 'telegram_failed', 40));
  console.log(JSON.stringify({ level: 'info', code: 'weekly_report_test', tenant: tenantRow.slug, actor_role: scope.role }));
  return json({ ok: true, stats: st }, 200, NO_STORE);
});

// ── Telegram del tenant (SPEC-CONEXIONES PR1): vinculación en autoservicio ──
conexiones.post('/api/admin/telegram/setup', async (c) => {
  const { env, actor } = partesAdmin(c);
  // Registra el webhook del bot (idempotente; solo Velai). OJO operativo: con el
  // webhook activo, getUpdates deja de funcionar para ese bot (OPERATIONS.md).
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) throw new HttpError(503, 'telegram_not_configured');
  const hook = await telegramSetWebhook(env, env.TELEGRAM_TOKEN);
  if (!hook.ok) {
    console.log(JSON.stringify({ level: 'error', code: 'telegram_webhook_failed', bot: 'velai', why: hook.why }));
    throw new HttpError(502, hook.code, hook.why);
  }
  console.log(JSON.stringify({ level: 'info', code: 'telegram_webhook_registered', actor }));
  return json({ ok: true, botUsername: await telegramBotUsername(env) }, 200, NO_STORE);
});

// Temas del grupo: crear DESDE el panel (nombre + descripción — la descripción
// es la que guía al clasificador), editar la descripción y quitar del enrutado.
const grupoTopics = async (c) => {
  const { request, env, ctx, scope, actor } = partesAdmin(c);
  const tenantId = c.req.param('id');
  if (!UUID_RE.test(tenantId)) throw new HttpError(404, 'not_found');
  const topicId = c.req.param('tid') || null;
  assertOwnTenant(scope, tenantId);
  const row = await env.DB.prepare('SELECT id, slug, name, channel_address, telegram_chat_id, telegram_topics, telegram_bot_token_enc, telegram_whitelabel FROM tenants WHERE id=?').bind(tenantId).first();
  if (!row) throw new HttpError(404, 'not_found');
  let topics = [];
  try { topics = JSON.parse(row.telegram_topics || '[]'); } catch (_) {}
  if (!Array.isArray(topics)) topics = [];
  if (!topicId && request.method === 'POST') {
    if (!row.telegram_whitelabel) throw scope.role === 'velai' ? new HttpError(400, 'marca_blanca_requerida') : new HttpError(404, 'not_found');
    if (!row.telegram_chat_id) throw new HttpError(400, 'telegram_no_vinculado');
    if (topics.length >= 25) throw new HttpError(400, 'demasiados_temas');
    if (await rateLimited(env, actor, 'tgtopic', 10)) throw new HttpError(429, 'rate_limited');
    const body = await readJson(request, 4000);
    const name = clean(body.name, 64);
    const description = clean(body.description, 200);
    if (!name) throw new HttpError(400, 'invalid_topic_name');
    // El tema se crea EN el Telegram del cliente, con el bot que está en su grupo.
    const { threadId, botToken } = await createTelegramTopic(env, row, row.telegram_chat_id, name);
    topics.push({ thread_id: Number(threadId), name, ...(description ? { description } : {}) });
    const now = new Date().toISOString();
    await env.DB.prepare('UPDATE tenants SET telegram_topics=?, updated_at=? WHERE id=?').bind(JSON.stringify(topics), now, tenantId).run();
    await invalidateTenantCache(env, [row]);
    console.log(JSON.stringify({ level: 'info', code: 'telegram_topic_registered', tenant: row.slug, topics: topics.length, from: 'panel' }));
    // Primer mensaje del tema = su propósito: útil para el equipo del cliente.
    if (description) ctx.waitUntil(sendTelegramText(env, `📌 Aquí llegarán: ${escapeHtml(description)}`, row.telegram_chat_id, { botToken, threadId }).catch(() => {}));
    return json({ ok: true, topics }, 200, NO_STORE);
  }
  if (topicId && request.method === 'PATCH') {
    if (!row.telegram_whitelabel) throw scope.role === 'velai' ? new HttpError(400, 'marca_blanca_requerida') : new HttpError(404, 'not_found');
    const body = await readJson(request, 4000);
    const topic = topics.find((t) => String(t.thread_id) === topicId);
    if (!topic) throw new HttpError(404, 'not_found');
    const description = clean(body.description, 200);
    if (description) topic.description = description; else delete topic.description;
    await env.DB.prepare('UPDATE tenants SET telegram_topics=?, updated_at=? WHERE id=?').bind(JSON.stringify(topics), new Date().toISOString(), tenantId).run();
    await invalidateTenantCache(env, [row]);
    return json({ ok: true, topics }, 200, NO_STORE);
  }
  if (topicId && request.method === 'DELETE') {
    // Solo lo quita del ENRUTADO: el Tema sigue existiendo en su Telegram.
    const remaining = topics.filter((t) => String(t.thread_id) !== topicId);
    await env.DB.prepare('UPDATE tenants SET telegram_topics=?, updated_at=? WHERE id=?').bind(JSON.stringify(remaining), new Date().toISOString(), tenantId).run();
    await invalidateTenantCache(env, [row]);
    return json({ ok: true, topics: remaining }, 200, NO_STORE);
  }
  throw new HttpError(405, 'method_not_allowed');
};
conexiones.all('/api/admin/tenants/:id/telegram/topics', grupoTopics);
conexiones.all('/api/admin/tenants/:id/telegram/topics/:tid{\\d+}', grupoTopics);

const grupoTelegram = async (c) => {
  const { request, env, ctx, scope, actor } = partesAdmin(c);
  const tenantId = c.req.param('id');
  if (!UUID_RE.test(tenantId)) throw new HttpError(404, 'not_found');
  const tgSub = c.req.param('sub') || null;
  // Autoservicio: el cliente solo SU tenant — ajeno = 404, ANTES de tocar D1.
  assertOwnTenant(scope, tenantId);
  const tenantRow = await env.DB.prepare('SELECT id, slug, name, channel_address, telegram_chat_id, telegram_chat_title, telegram_linked_at, telegram_bot_username, telegram_bot_token_enc, telegram_whitelabel, telegram_topics, weekly_report FROM tenants WHERE id=?').bind(tenantId).first();
  if (!tenantRow) throw new HttpError(404, 'not_found');
  // La marca blanca es una feature que ACTIVA VELAI por cliente: sin el flag, el
  // bot propio no existe — para el cliente es 404 (ni confirmación de la feature)
  // y para velai un 400 claro: activar el flag primero, un básico jamás acaba con
  // bot propio "por accidente" (el DELETE sí se permite, es limpieza).
  if (tgSub === 'bot' && request.method === 'POST' && !tenantRow.telegram_whitelabel) {
    throw scope.role === 'velai' ? new HttpError(400, 'marca_blanca_requerida') : new HttpError(404, 'not_found');
  }
  if (tgSub === 'bot' && request.method === 'DELETE' && scope.role !== 'velai' && !tenantRow.telegram_whitelabel) throw new HttpError(404, 'not_found');
  if (!tgSub && request.method === 'PATCH') {
    // Conmutador de marca blanca: SOLO Velai (fuera de clienteAllowed).
    if (scope.role !== 'velai') throw new HttpError(403, 'not_authorized');
    const body = await readJson(request, 2000);
    const enable = body.whitelabel === true;
    const now = new Date().toISOString();
    if (!enable && tenantRow.telegram_bot_token_enc) {
      // Desactivarla con un bot configurado lo retira también (y desvincula el
      // chat): lo que el cliente ve y lo que el worker hace no pueden divergir.
      try {
        const oldToken = await tenantTelegramToken(env, tenantRow);
        if (oldToken) ctx.waitUntil(fetch(`https://api.telegram.org/bot${oldToken}/deleteWebhook`, { method: 'POST', signal: AbortSignal.timeout(8000) }).catch(() => {}));
      } catch (_) {}
      await env.DB.prepare('UPDATE tenants SET telegram_whitelabel=0, telegram_bot_token_enc=NULL, telegram_bot_username=NULL, telegram_topics=NULL, telegram_chat_id=NULL, telegram_chat_title=NULL, telegram_linked_at=NULL, updated_at=? WHERE id=?').bind(now, tenantId).run();
    } else {
      await env.DB.prepare(enable
        ? 'UPDATE tenants SET telegram_whitelabel=1, updated_at=? WHERE id=?'
        : 'UPDATE tenants SET telegram_whitelabel=0, telegram_topics=NULL, updated_at=? WHERE id=?').bind(now, tenantId).run();
    }
    await invalidateTenantCache(env, [tenantRow]);
    console.log(JSON.stringify({ level: 'info', code: 'telegram_whitelabel_toggled', tenant: tenantRow.slug, enabled: enable }));
    ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
      .bind(tenantId, actor, 'telegram', null, enable ? 'marca blanca activada' : 'marca blanca desactivada', now).run().catch(() => {}));
    return json({ ok: true, whitelabel: enable }, 200, NO_STORE);
  }
  if (tgSub === 'bot' && request.method === 'POST') {
    // Marca blanca: guardar el bot PROPIO del cliente. El token es write-only y va
    // cifrado (AAD telegram:<id>); se valida con getMe y se registra su webhook
    // ANTES de guardar nada — un token que no responde no entra en D1.
    if (!env.KV || !env.TELEGRAM_WEBHOOK_SECRET) throw new HttpError(503, 'telegram_not_configured');
    if (await rateLimited(env, actor, 'tgbot', 5)) throw new HttpError(429, 'rate_limited');
    const body = await readJson(request, 2000);
    const botToken = clean(body.token, 100);
    if (!TELEGRAM_BOT_TOKEN_RE.test(botToken)) throw new HttpError(400, 'invalid_bot_token');
    let username = null;
    try {
      const me = await (await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { signal: AbortSignal.timeout(8000) })).json();
      username = (me && me.ok && me.result && me.result.is_bot && clean(me.result.username, 64)) || null;
    } catch (_) {}
    if (!username) throw new HttpError(400, 'invalid_bot_token');
    const hook = await telegramSetWebhook(env, botToken);
    if (!hook.ok) {
      // El log lleva el motivo de Telegram y el tenant: sin esto, «Telegram rechazó el
      // registro del webhook» era todo lo que quedaba, en el panel y en los logs.
      console.log(JSON.stringify({ level: 'error', code: 'telegram_webhook_failed', tenant: tenantRow.slug, bot: username, why: hook.why }));
      throw new HttpError(502, hook.code, hook.why);
    }
    const enc = await encryptSecret(env, `telegram:${tenantId}`, botToken);
    const now = new Date().toISOString();
    // Cambiar de bot invalida el chat vinculado (el bot nuevo no está en ese chat):
    // se limpia y el cliente vuelve a vincular con SU bot en dos toques.
    await env.DB.prepare('UPDATE tenants SET telegram_bot_token_enc=?, telegram_bot_username=?, telegram_chat_id=NULL, telegram_chat_title=NULL, telegram_linked_at=NULL, updated_at=? WHERE id=?')
      .bind(enc, username, now, tenantId).run();
    await invalidateTenantCache(env, [tenantRow]);
    console.log(JSON.stringify({ level: 'info', code: 'telegram_bot_saved', tenant: tenantRow.slug, actor_role: scope.role }));
    ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
      .bind(tenantId, actor, 'telegram', tenantRow.telegram_bot_username || null, `bot propio: @${username}`, now).run().catch(() => {}));
    return json({ ok: true, botUsername: username }, 200, NO_STORE);
  }
  if (tgSub === 'bot' && request.method === 'DELETE') {
    if (!tenantRow.telegram_bot_token_enc) throw new HttpError(404, 'not_found');
    // Retirar el webhook del bot del cliente es best-effort: borrar la fila ya lo
    // saca del circuito (los avisos vuelven al bot de Velai tras revincular).
    try {
      const oldToken = await tenantTelegramToken(env, tenantRow);
      if (oldToken) ctx.waitUntil(fetch(`https://api.telegram.org/bot${oldToken}/deleteWebhook`, { method: 'POST', signal: AbortSignal.timeout(8000) }).catch(() => {}));
    } catch (_) {}
    const now = new Date().toISOString();
    await env.DB.prepare('UPDATE tenants SET telegram_bot_token_enc=NULL, telegram_bot_username=NULL, telegram_chat_id=NULL, telegram_chat_title=NULL, telegram_linked_at=NULL, updated_at=? WHERE id=?').bind(now, tenantId).run();
    await invalidateTenantCache(env, [tenantRow]);
    console.log(JSON.stringify({ level: 'info', code: 'telegram_bot_removed', tenant: tenantRow.slug, actor_role: scope.role }));
    ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
      .bind(tenantId, actor, 'telegram', tenantRow.telegram_bot_username || null, 'bot propio retirado', now).run().catch(() => {}));
    return json({ ok: true }, 200, NO_STORE);
  }
  if (tgSub === 'link' && request.method === 'POST') {
    if (!env.KV) throw new HttpError(503, 'telegram_not_configured');
    if (await rateLimited(env, actor, 'tglink', 5)) throw new HttpError(429, 'rate_limited');
    // Marca blanca: el enlace usa el bot PROPIO del cliente si lo configuró.
    const botUser = tenantRow.telegram_bot_username || (env.TELEGRAM_TOKEN && await telegramBotUsername(env));
    if (!botUser) throw new HttpError(503, 'telegram_not_configured');
    // 32 hex sin guiones: el payload de /start admite 64 caracteres como máximo.
    const token = crypto.randomUUID().replace(/-/g, '');
    await env.KV.put(`tglink:${token}`, JSON.stringify({ tenantId, actor }), { expirationTtl: 900 });
    return json({ token, dmUrl: `https://t.me/${botUser}?start=${token}`, groupUrl: `https://t.me/${botUser}?startgroup=${token}`, expiresInSeconds: 900 }, 200, NO_STORE);
  }
  if (!tgSub && request.method === 'GET') {
    // botUsername sí; el token cifrado JAMÁS sale del worker.
    let topics = [];
    try { topics = JSON.parse(tenantRow.telegram_topics || '[]'); } catch (_) {}
    // El último informe, con su estado. «¿Salió?» se responde en el panel y no abriendo
    // Telegram — y un 'skipped'/'failed' deja de ser invisible. En try/catch: si la
    // tabla aún no existe (deploy antes de migrar), la tarjeta simplemente no lo enseña.
    let lastReport = null;
    try {
      lastReport = await env.DB.prepare('SELECT period_start, status, detail, sent_at FROM tenant_reports WHERE tenant_id=? ORDER BY period_start DESC LIMIT 1').bind(tenantId).first();
    } catch (_) {}
    return json({ telegram: { linked: Boolean(tenantRow.telegram_chat_id), title: tenantRow.telegram_chat_title || null, linked_at: tenantRow.telegram_linked_at || null, botUsername: tenantRow.telegram_bot_username || null, whitelabel: Boolean(tenantRow.telegram_whitelabel), topics: Array.isArray(topics) ? topics : [], weeklyReport: tenantRow.weekly_report !== 0, lastReport: lastReport || null } }, 200, NO_STORE);
  }
  if (!tgSub && request.method === 'DELETE') {
    const now = new Date().toISOString();
    await env.DB.prepare('UPDATE tenants SET telegram_chat_id=NULL, telegram_chat_title=NULL, telegram_linked_at=NULL, updated_at=? WHERE id=?').bind(now, tenantId).run();
    await invalidateTenantCache(env, [tenantRow]);
    console.log(JSON.stringify({ level: 'info', code: 'telegram_unlinked', tenant: tenantRow.slug, actor_role: scope.role }));
    ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
      .bind(tenantId, actor, 'telegram', tenantRow.telegram_chat_title || null, 'desvinculado', now).run().catch(() => {}));
    return json({ ok: true }, 200, NO_STORE);
  }
  throw new HttpError(405, 'method_not_allowed');
};
conexiones.all('/api/admin/tenants/:id/telegram', grupoTelegram);
conexiones.all('/api/admin/tenants/:id/telegram/:sub{link|bot}', grupoTelegram);
