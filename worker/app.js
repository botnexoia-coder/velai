import { ADMIN_HEADERS, ADMIN_HTML } from './admin-page.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['new', 'contacted', 'qualified', 'won', 'lost', 'spam']);
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function adminPageResponse() {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const headers = {
    ...ADMIN_HEADERS,
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  };
  return new Response(ADMIN_HTML.replaceAll('__NONCE__', nonce), { headers });
}

function clean(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizePhone(value) {
  const raw = clean(value, 40);
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 15 ? (raw.startsWith('+') ? '+' : '') + digits : '';
}

// Sin '.' en la clase (importes «40.000»), sin fechas y con longitud de teléfono real:
// una conversación sobre facturación o CIFs no debe disparar la captura de lead.
const DATE_RE = /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/;
function extractPhone(text) {
  const candidates = String(text || '').match(/\+?\d[\d\s()-]{7,}\d/g) || [];
  for (const candidate of candidates) {
    if (DATE_RE.test(candidate)) continue;
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) continue;
    const phone = normalizePhone(candidate);
    if (phone) return phone;
  }
  return '';
}

function allowedOrigins(env) {
  return clean(env.ALLOWED_WEB_ORIGINS, 1000).split(',').map((x) => x.trim()).filter(Boolean);
}

function publicCors(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin || !allowedOrigins(env).includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function readJson(request, maxBytes = 16000) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > maxBytes) throw new HttpError(413, 'payload_too_large');
  let text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'payload_too_large');
  // Las rutas JSON exigen su content-type (415); el webhook de Twilio va aparte
  // como x-www-form-urlencoded y nunca pasa por aquí.
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) throw new HttpError(415, 'unsupported_media_type');
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { throw new HttpError(400, 'invalid_json'); }
  // `null`, arrays o primitivos son entrada inválida (400), no un 500 al leer .campo
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'invalid_json');
  return parsed;
}

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

async function rateLimited(env, ip, bucket, limit) {
  if (!env.KV || !ip) return false;
  const key = `rl:${bucket}:${ip}`;
  try {
    const current = Number(await env.KV.get(key) || 0);
    if (current >= limit) return true;
    await env.KV.put(key, String(current + 1), { expirationTtl: 60 });
  } catch (_) { /* fail open; Turnstile remains authoritative */ }
  return false;
}

async function verifyTurnstile(env, token, request, expectedAction) {
  if (!env.TURNSTILE_SECRET_KEY) throw new HttpError(503, 'turnstile_not_configured');
  if (!clean(token, 2048)) throw new HttpError(403, 'human_verification_required');
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', body: form, signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new HttpError(503, 'human_verification_unavailable');
  const result = await response.json();
  if (!result.success || (result.action && result.action !== expectedAction)) {
    throw new HttpError(403, 'human_verification_failed');
  }
  // Un token emitido para un hostname ajeno no vale aunque sea "success": la lista
  // sale de ALLOWED_WEB_ORIGINS (config del servidor), nunca del Origin del cliente.
  if (result.hostname) {
    const okHosts = new Set(allowedOrigins(env).map((o) => { try { return new URL(o).hostname; } catch (_) { return ''; } }));
    okHosts.add('localhost'); okHosts.add('127.0.0.1');
    if (!okHosts.has(result.hostname)) throw new HttpError(403, 'human_verification_failed');
  }
}

// Presupuesto diario global de llamadas al modelo: un abuso distribuido (muchas IPs)
// no puede quemar la API key. Contador en KV por día UTC; fail-open si KV cae
// (igual que el rate limit — Turnstile sigue siendo la barrera principal).
async function aiBudgetGuard(env) {
  if (!env.KV) return;
  const limit = Number(env.AI_DAILY_LIMIT) || 1000;
  const key = `budget:ai:${new Date().toISOString().slice(0, 10)}`;
  let current = 0;
  try { current = Number(await env.KV.get(key) || 0); } catch (_) { return; }
  if (current >= limit) {
    try {
      if (!(await env.KV.get('alert:aibudget'))) {
        await env.KV.put('alert:aibudget', '1', { expirationTtl: 3600 });
        await sendTelegramText(env, `⚠️ <b>Velai</b>: presupuesto diario de IA agotado (${limit} llamadas). El chat responde 429 hasta mañana o hasta subir AI_DAILY_LIMIT.`);
      }
    } catch (_) {}
    throw new HttpError(429, 'ai_budget_exhausted');
  }
  try { await env.KV.put(key, String(current + 1), { expirationTtl: 2 * 86400 }); } catch (_) {}
}

async function callAnthropic(env, payload) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'ai_not_configured');
  await aiBudgetGuard(env);
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt) break;
  }
  if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, 'ai_unavailable');
  const data = await response.json();
  const reply = data.content?.[0]?.text;
  if (!reply) throw new HttpError(502, 'ai_invalid_response');
  return reply;
}

function expiryDate(env) {
  // `Number('')` es 0 (finito) y el clamp lo convertía en 1 mes; `|| 24` cubre '', 0 y NaN.
  const months = Number(env.LEAD_RETENTION_MONTHS) || 24;
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + Math.min(60, Math.max(1, months)));
  return date.toISOString();
}

// Guarda contra claves heredadas del prototipo ('constructor', '__proto__', …):
// un demo inválido nunca debe colar un valor no-string como system prompt.
function isDemoKey(config, key) {
  return typeof key === 'string' && key !== ''
    && Object.prototype.hasOwnProperty.call(config.DEMOS, key)
    && typeof config.DEMOS[key] === 'string';
}

function safeUtm(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of UTM_KEYS) if (raw[key] != null) out[key] = clean(String(raw[key]), 300);
  return out;
}

async function persistLead(env, input) {
  if (!env.DB) throw new HttpError(503, 'lead_storage_not_configured');
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const args = [
    id, input.requestId, input.conversationId || null, input.source, input.name || null,
    input.whatsapp || null, input.phone || null, input.sector || null, input.messagesPerDay || null,
    input.channel || null, input.currentResponder || null, input.score, input.note || null,
    input.need || null, input.context || null, JSON.stringify(input.utm || {}), input.pageUrl || null,
    now, now, expiryDate(env),
  ];
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO leads
        (id,request_id,conversation_id,source,name,whatsapp,whatsapp_normalized,sector,messages_per_day,channel,current_responder,score,note,need,context,attribution_json,page_url,created_at,updated_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...args),
      env.DB.prepare("INSERT INTO lead_notifications (lead_id,channel,status,updated_at) VALUES (?,'telegram','pending',?)").bind(id, now),
      env.DB.prepare("INSERT INTO lead_notifications (lead_id,channel,status,updated_at) VALUES (?,'whatsapp','pending',?)").bind(id, now),
    ]);
    return { id, created: true };
  } catch (error) {
    if (!/UNIQUE|constraint/i.test(String(error))) throw error;
    const existing = await env.DB.prepare('SELECT id FROM leads WHERE request_id = ? OR (conversation_id = ? AND whatsapp_normalized = ?) LIMIT 1')
      .bind(input.requestId, input.conversationId || '', input.phone || '').first();
    if (!existing) throw error;
    return { id: existing.id, created: false };
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function notificationText(lead) {
  let text = `📨 <b>NUEVO LEAD — VELAI (${escapeHtml(lead.source)})</b>\n\n`;
  if (lead.name) text += `👤 Nombre: ${escapeHtml(lead.name)}\n`;
  if (lead.whatsapp) text += `📱 WhatsApp: ${escapeHtml(lead.whatsapp)}\n`;
  if (lead.sector) text += `🏪 Sector: ${escapeHtml(lead.sector)}\n`;
  if (lead.messages_per_day) text += `💬 Mensajes/día: ${escapeHtml(lead.messages_per_day)}\n`;
  if (lead.channel) text += `📡 Canal: ${escapeHtml(lead.channel)}\n`;
  if (lead.need) text += `🎯 Necesidad: ${escapeHtml(lead.need)}\n`;
  if (lead.note) text += `📝 ${escapeHtml(lead.note)}\n`;
  return text + '\n⚡ <b>Contactar hoy mismo</b>';
}

async function sendTelegramText(env, text) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) return { skipped: true, error: 'not_configured' };
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return { error: `telegram_${response.status}` };
  const data = await response.json();
  return data.ok ? { ok: true } : { error: 'telegram_rejected' };
}

// WhatsApp rechaza variables de plantilla vacías, con saltos de línea o con más de
// 4 espacios seguidos. Todo campo se normaliza y lleva respaldo.
function templateVar(value, fallback) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return text || fallback;
}

// Orden fijado por la plantilla velai_nuevo_lead: 1 WhatsApp, 2 Nombre, 3 Negocio, 4 Necesidad.
// Si cambias la plantilla, cambia esto a la vez.
function leadTemplateVariables(lead) {
  return JSON.stringify({
    1: templateVar(lead.whatsapp, 'sin teléfono'),
    2: templateVar(lead.name, 'sin nombre'),
    3: templateVar(lead.sector, 'sin especificar'),
    4: templateVar(lead.need || lead.note, 'sin especificar'),
  });
}

async function deliver(env, channel, lead) {
  if (channel === 'telegram') return sendTelegramText(env, notificationText(lead));
  const recipients = clean(env.TEAM_WHATSAPP, 1000).split(',').map((x) => x.trim()).filter(Boolean);
  if (!recipients.length || !env.TWILIO_FROM || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    return { skipped: true, error: 'not_configured' };
  }
  // Sin plantilla, el aviso al equipo es un mensaje iniciado por el negocio fuera de la
  // ventana de 24 h y WhatsApp lo rechaza siempre con 63016. Mejor 'skipped' explícito.
  if (!env.TWILIO_LEAD_TEMPLATE_SID) return { skipped: true, error: 'template_not_configured' };
  const auth = `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;
  const variables = leadTemplateVariables(lead);
  // allSettled, no all: con Promise.all un timeout de un destinatario tumbaba el envío
  // entero y el reintento duplicaba el mensaje a quien sí lo había recibido.
  const results = await Promise.allSettled(recipients.map((to) => fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        From: env.TWILIO_FROM,
        To: to,
        ContentSid: env.TWILIO_LEAD_TEMPLATE_SID,
        ContentVariables: variables,
      }),
      signal: AbortSignal.timeout(8000),
    })));
  const delivered = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
  if (!delivered) return { error: 'twilio_rejected' };
  return { ok: true, partial: delivered < recipients.length };
}

async function processNotifications(env, leadId, force = false) {
  if (!env.DB) return;
  const lead = await env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first();
  if (!lead) return;
  // 'skipped' (canal sin configurar) no consume intentos y se revisita cada 6 h:
  // al configurar el canal, el aviso sale solo sin pasar por el botón Reintentar.
  const jobs = (await env.DB.prepare(`SELECT * FROM lead_notifications WHERE lead_id = ? AND ((status IN ('pending','failed') AND attempts < 5) OR status = 'skipped')`).bind(leadId).all()).results;
  for (const job of jobs) {
    if (!force && job.next_attempt_at && job.next_attempt_at > new Date().toISOString()) continue;
    let outcome;
    try { outcome = await deliver(env, job.channel, lead); }
    catch (error) { outcome = { error: error.name === 'TimeoutError' ? 'timeout' : 'network_error' }; }
    const now = new Date().toISOString();
    const attempts = outcome.skipped ? job.attempts : job.attempts + 1;
    const status = outcome.ok ? 'sent' : outcome.skipped ? 'skipped' : 'failed';
    const next = status === 'failed' && attempts < 5 ? new Date(Date.now() + attempts * attempts * 5 * 60000).toISOString()
      : status === 'skipped' ? new Date(Date.now() + 6 * 3600000).toISOString() : null;
    await env.DB.prepare('UPDATE lead_notifications SET status=?, attempts=?, next_attempt_at=?, last_error=?, sent_at=?, updated_at=? WHERE id=?')
      .bind(status, attempts, next, outcome.error || null, outcome.ok ? now : null, now, job.id).run();
  }
}

function inputToNotifiable(input) {
  return {
    source: input.source, name: input.name, whatsapp: input.whatsapp, sector: input.sector,
    messages_per_day: input.messagesPerDay, channel: input.channel, need: input.need, note: input.note,
  };
}

// Degradación controlada: D1 → aviso directo → cola en KV (TTL 7 días, drenada por el
// cron). Una caída de D1 no puede costar leads; la respuesta indica la garantía obtenida
// via `stored` ('d1' | 'kv' | 'notification') y `degraded`.
async function storeLead(env, ctx, input) {
  try {
    const result = await persistLead(env, input);
    if (result.created) {
      ctx.waitUntil(processNotifications(env, result.id).catch((error) => {
        console.log(JSON.stringify({ level: 'error', code: 'lead_notify_failed', leadId: result.id, error: error.name }));
      }));
    }
    return { ok: true, leadId: result.id, duplicate: !result.created, stored: 'd1' };
  } catch (error) {
    // Distinguir la caída transitoria del error de configuración: un binding DB
    // ausente NO debe pasar por "degradado OK" en silencio.
    const misconfigured = error instanceof HttpError && error.code === 'lead_storage_not_configured';
    console.log(JSON.stringify({ level: 'error', code: misconfigured ? 'lead_d1_misconfigured' : 'lead_d1_fallback', error: error.code || error.name }));
    // Guardar QUÉ canales entregaron (no un booleano): el drenaje solo marca 'sent'
    // los que de verdad salieron; el resto se notifica al reinsertar en D1.
    const notifiedChannels = [];
    for (const channel of ['telegram', 'whatsapp']) {
      try { if ((await deliver(env, channel, inputToNotifiable(input))).ok) notifiedChannels.push(channel); } catch (_) {}
    }
    const notified = notifiedChannels.length > 0;
    let queued = false;
    if (env.KV) {
      try {
        await env.KV.put(`leadq:${input.requestId}`, JSON.stringify({ ...input, notified, notifiedChannels }), { expirationTtl: 30 * 86400 });
        queued = true;
      } catch (_) {}
    }
    // Alerta al equipo con antirebote de 1 h: el modo degradado no puede ser invisible.
    if (env.KV) {
      try {
        if (!(await env.KV.get('alert:degraded'))) {
          await env.KV.put('alert:degraded', '1', { expirationTtl: 3600 });
          await sendTelegramText(env, '⚠️ <b>Velai</b>: D1 no disponible, leads en cola KV. Revisar el binding DB del worker.');
        }
      } catch (_) {}
    }
    if (!queued && !notified) throw error;
    console.log(JSON.stringify({ level: 'error', code: 'lead_degraded', stored: queued ? 'kv' : 'notification' }));
    return { ok: true, duplicate: false, stored: queued ? 'kv' : 'notification', degraded: true };
  }
}

async function handleLead(request, env, cors, ctx) {
  const body = await readJson(request);
  if (!UUID_RE.test(body.requestId || '')) throw new HttpError(400, 'invalid_request_id');
  await verifyTurnstile(env, body.turnstileToken, request, 'lead');
  const phone = normalizePhone(body.whatsapp);
  if (!phone) throw new HttpError(400, 'invalid_phone');
  if (!clean(body.nombre, 100)) throw new HttpError(400, 'invalid_name');
  const score = body.score == null ? null : Number(body.score);
  if (score != null && (!Number.isFinite(score) || score < 0 || score > 100)) throw new HttpError(400, 'invalid_score');
  const result = await storeLead(env, ctx, {
    requestId: body.requestId, source: clean(body.fuente, 80) || 'formulario web',
    name: clean(body.nombre, 100), whatsapp: clean(body.whatsapp, 40), phone,
    sector: clean(body.sector, 100), messagesPerDay: clean(body.mensajesDia, 50),
    channel: clean(body.canal, 50), currentResponder: clean(body.quienResponde, 80), score,
    note: clean(body.nota, 500), utm: safeUtm(body.utm), pageUrl: clean(body.pageUrl, 500),
  });
  return json(result, 201, cors);
}

async function validTwilioSignature(authToken, url, params, signature) {
  if (!authToken || !signature) return false;
  const data = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', bytes.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, bytes.encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));
  if (expected.length !== signature.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return difference === 0;
}

async function summarizeLead(config, env, messages) {
  const conversation = messages.map((m) => `${m.role === 'user' ? 'Cliente' : 'Vai'}: ${m.content}`).join('\n');
  try {
    const raw = await callAnthropic(env, { model: 'claude-haiku-4-5-20251001', max_tokens: 200, system: config.SUMMARY_PROMPT, messages: [{ role: 'user', content: conversation }] });
    return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
  } catch (_) { return {}; }
}

async function captureChatLead(config, env, ctx, body, phone, messages) {
  // Mismas guardas que el canal WhatsApp: una captura por conversación (marca en KV),
  // mínimo 2 turnos del usuario. Sin esto, cada cifra suelta del mensaje generaba un
  // lead + 2 avisos + 1 llamada a Haiku, hasta 20/min por el rate limit del chat.
  const mark = `lead:web:${body.conversationId}`;
  if (env.KV && await env.KV.get(mark)) return;
  if (messages.filter((m) => m.role === 'user').length < 2) return;
  const summary = await summarizeLead(config, env, messages);
  const result = await storeLead(env, ctx, {
    requestId: `chat:${body.conversationId}:${phone}`, conversationId: body.conversationId,
    source: 'chat web', name: clean(summary.nombre, 100), whatsapp: phone, phone,
    sector: clean(summary.negocio, 100), need: clean(summary.necesidad, 200),
    context: clean(summary.contexto, 300), pageUrl: clean(body.pageUrl, 500),
    utm: safeUtm(body.utm), score: null,
  });
  if (result.ok && env.KV) await env.KV.put(mark, '1', { expirationTtl: 30 * 86400 });
}

// El canal WhatsApp también captura leads (regresión corregida): el teléfono es el
// From de Twilio — el cliente no tiene que escribir su número — y se captura una
// sola vez por remitente (marca en KV + request_id idempotente `wa:<phone>`).
// Se dispara con intención comercial mínima: ≥2 turnos del cliente y un resumen
// de Haiku que detecte negocio o necesidad.
async function captureWhatsAppLead(config, env, ctx, from, phone, messages) {
  const mark = `lead:wa:${from}`;
  if (env.KV && await env.KV.get(mark)) return;
  if (messages.filter((m) => m.role === 'user').length < 2) return;
  const summary = await summarizeLead(config, env, messages);
  const sector = clean(summary.negocio, 100);
  const need = clean(summary.necesidad, 200);
  if (!sector && !need) return;
  const result = await storeLead(env, ctx, {
    requestId: `wa:${phone}`, source: 'whatsapp',
    name: clean(summary.nombre, 100), whatsapp: from.replace(/^whatsapp:/i, ''), phone,
    sector, need, context: clean(summary.contexto, 300), score: null,
  });
  if (result.ok && env.KV) await env.KV.put(mark, '1', { expirationTtl: 30 * 86400 });
}

async function handleChat(request, env, cors, ctx, config) {
  const body = await readJson(request, 8000);
  if (!UUID_RE.test(body.conversationId || '')) throw new HttpError(400, 'invalid_conversation_id');
  const message = clean(body.message, 2000);
  if (!message) throw new HttpError(400, 'invalid_message');
  if (!env.KV) throw new HttpError(503, 'conversation_storage_not_configured');
  const key = `conv:web:${body.conversationId}`;
  let state = await env.KV.get(key, 'json');
  if (body.demo && !isDemoKey(config, body.demo)) throw new HttpError(400, 'invalid_demo');
  // Límite también por conversación: rotar de IP (CGNAT/móvil) no multiplica el cupo.
  if (await rateLimited(env, body.conversationId, 'chatconv', 20)) throw new HttpError(429, 'rate_limited');
  if (!state) {
    await verifyTurnstile(env, body.turnstileToken, request, 'chat');
    state = { demo: isDemoKey(config, body.demo) ? body.demo : '', messages: [] };
  }
  if (body.demo && state.demo !== body.demo) throw new HttpError(409, 'conversation_mode_mismatch');
  state.messages.push({ role: 'user', content: message });
  state.messages = state.messages.slice(-20);
  const reply = await callAnthropic(env, {
    model: 'claude-sonnet-4-6', max_tokens: 300,
    system: isDemoKey(config, state.demo) ? config.DEMOS[state.demo] : config.SYSTEM, messages: state.messages,
  });
  state.messages.push({ role: 'assistant', content: reply });
  state.messages = state.messages.slice(-20);
  await env.KV.put(key, JSON.stringify(state), { expirationTtl: 86400 });
  const phone = extractPhone(message);
  if (!state.demo && phone) {
    ctx.waitUntil(captureChatLead(config, env, ctx, body, phone, state.messages).catch((error) => {
      console.log(JSON.stringify({ level: 'error', code: 'chat_lead_capture_failed', conversationId: body.conversationId, error: error.name }));
    }));
  }
  return json({ reply }, 200, cors);
}

async function handleTwilio(request, env, ctx, config) {
  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const object = {}; params.forEach((value, key) => { object[key] = value; });
  if (!await validTwilioSignature(env.TWILIO_AUTH_TOKEN, request.url, object, request.headers.get('X-Twilio-Signature') || '')) {
    throw new HttpError(403, 'invalid_twilio_signature');
  }
  const from = clean(params.get('From'), 80);
  const message = clean(params.get('Body'), 2000);
  if (!from || !message) throw new HttpError(400, 'invalid_twilio_payload');
  let history = env.KV ? await env.KV.get(`conv:wa:${from}`, 'json') || [] : [];
  history.push({ role: 'user', content: message }); history = history.slice(-20);
  const reply = await callAnthropic(env, { model: 'claude-sonnet-4-6', max_tokens: 300, system: config.SYSTEM, messages: history });
  history.push({ role: 'assistant', content: reply }); history = history.slice(-20);
  if (env.KV) await env.KV.put(`conv:wa:${from}`, JSON.stringify(history), { expirationTtl: 86400 });
  const phone = normalizePhone(from.replace(/^whatsapp:/i, ''));
  if (phone) {
    ctx.waitUntil(captureWhatsAppLead(config, env, ctx, from, phone, history).catch((error) => {
      console.log(JSON.stringify({ level: 'error', code: 'wa_lead_capture_failed', error: error.name }));
    }));
  }
  const safe = escapeHtml(reply);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
}

// Caché del JWKS de Access en memoria del isolate (10 min): evita un fetch externo
// por cada petición del panel. Ante un kid desconocido (rotación) se refresca una vez.
let jwksCache = { keys: null, fetchedAt: 0 };
async function accessKeys(issuer, forceRefresh = false) {
  if (forceRefresh || !jwksCache.keys || Date.now() - jwksCache.fetchedAt > 600000) {
    const jwks = await (await fetch(`${issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) })).json();
    jwksCache = { keys: jwks.keys || [], fetchedAt: Date.now() };
  }
  return jwksCache.keys;
}

let jwksLastForcedRefresh = 0;

async function adminIdentity(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.TEAM_DOMAIN || !env.POLICY_AUD) throw new HttpError(401, 'admin_unauthorized');
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'admin_unauthorized');
  // Datos del atacante: base64/JSON inválidos son 401, no un 500 del catch genérico.
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch (_) { throw new HttpError(401, 'admin_unauthorized'); }
  if (header.alg !== 'RS256') throw new HttpError(401, 'admin_unauthorized');
  const issuer = env.TEAM_DOMAIN.replace(/\/$/, '');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  // exp ausente o no numérico debe rechazar: NaN <= Date.now() es false y colaría.
  if (payload.iss !== issuer || !aud.includes(env.POLICY_AUD) || !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) throw new HttpError(401, 'admin_unauthorized');
  let jwk = (await accessKeys(issuer)).find((item) => item.kid === header.kid);
  if (!jwk && Date.now() - jwksLastForcedRefresh > 30000) {
    // Antirebote: un kid inventado no puede forzar un fetch al JWKS por petición.
    jwksLastForcedRefresh = Date.now();
    jwk = (await accessKeys(issuer, true)).find((item) => item.kid === header.kid);
  }
  if (!jwk) throw new HttpError(401, 'admin_unauthorized');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new HttpError(401, 'admin_unauthorized');
  return clean(payload.email, 200) || 'admin';
}

// Sin fallback silencioso: si ADMIN_ORIGIN falta o es inválida, las rutas de admin
// fallan con 503 explícito — pero las rutas públicas del router no deben verse afectadas,
// por eso estas funciones devuelven null en vez de lanzar.
function adminOrigin(env) {
  try { return new URL(env.ADMIN_ORIGIN).origin; } catch (_) { return null; }
}

function adminHost(env) {
  const origin = adminOrigin(env);
  return origin ? new URL(origin).hostname : null;
}

function adminCorsGuard(request, env) {
  const expected = adminOrigin(env);
  if (!expected) throw new HttpError(503, 'admin_misconfigured');
  const origin = request.headers.get('Origin');
  // Comparar orígenes normalizados: una barra final en la variable no debe romper las escrituras.
  if (origin && origin !== expected) throw new HttpError(403, 'invalid_admin_origin');
}

function leadFilters(url) {
  const clauses = ['1=1']; const values = [];
  const status = clean(url.searchParams.get('status'), 20);
  if (status && STATUSES.has(status)) { clauses.push('l.status = ?'); values.push(status); }
  const source = clean(url.searchParams.get('source'), 80);
  if (source) { clauses.push('l.source = ?'); values.push(source); }
  const notification = clean(url.searchParams.get('notification'), 20);
  if (['pending', 'sent', 'failed', 'skipped'].includes(notification)) {
    clauses.push('EXISTS (SELECT 1 FROM lead_notifications nf WHERE nf.lead_id=l.id AND nf.status=?)');
    values.push(notification);
  }
  const query = clean(url.searchParams.get('q'), 100);
  if (query) { clauses.push('(l.name LIKE ? OR l.whatsapp LIKE ? OR l.sector LIKE ? OR l.source LIKE ?)'); values.push(...Array(4).fill(`%${query}%`)); }
  const from = clean(url.searchParams.get('from'), 30);
  if (from) { clauses.push('l.created_at >= ?'); values.push(from); }
  const to = clean(url.searchParams.get('to'), 30);
  // Una fecha suelta (input type=date) debe incluir el día completo frente al ISO almacenado.
  if (to) { clauses.push('l.created_at <= ?'); values.push(/^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to); }
  return { sql: clauses.join(' AND '), values };
}

function csvCell(value) {
  const text = String(value ?? '');
  // Prefijo ' contra inyección de fórmulas al abrir el CSV en Excel/Sheets.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

// Datos administrativos: nunca cacheables (ni en el navegador ni en proxies).
const NO_STORE = { 'Cache-Control': 'no-store' };

async function handleAdmin(request, env, ctx, path, url) {
  adminCorsGuard(request, env);
  const actor = await adminIdentity(request, env);
  if (!env.DB) throw new HttpError(503, 'lead_storage_not_configured');
  if (path === '/api/admin/leads' && request.method === 'GET') {
    const filters = leadFilters(url);
    const rawLimit = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 50; // NaN en LIMIT = sin límite en SQLite
    // Cursor por tupla (created_at, id): un created_at repetido en el borde de página no salta leads.
    const cursor = clean(url.searchParams.get('cursor'), 80);
    if (cursor) {
      const [cAt, cId] = cursor.split('|');
      if (cId) { filters.sql += ' AND (l.created_at < ? OR (l.created_at = ? AND l.id < ?))'; filters.values.push(cAt, cAt, cId); }
      else { filters.sql += ' AND l.created_at < ?'; filters.values.push(cAt); }
    }
    const result = await env.DB.prepare(`SELECT l.*, GROUP_CONCAT(n.channel || ':' || n.status) notification_summary FROM leads l LEFT JOIN lead_notifications n ON n.lead_id=l.id WHERE ${filters.sql} GROUP BY l.id ORDER BY l.created_at DESC, l.id DESC LIMIT ?`).bind(...filters.values, limit + 1).all();
    const rows = result.results; const more = rows.length > limit; if (more) rows.pop();
    return json({ leads: rows, nextCursor: more ? `${rows.at(-1).created_at}|${rows.at(-1).id}` : null }, 200, NO_STORE);
  }
  if (path === '/api/admin/leads/export.csv' && request.method === 'GET') {
    const filters = leadFilters(url);
    const rows = (await env.DB.prepare(`SELECT created_at,status,source,name,whatsapp,sector,messages_per_day,channel,score,note,page_url FROM leads l WHERE ${filters.sql} ORDER BY created_at DESC LIMIT 5000`).bind(...filters.values).all()).results;
    const keys = ['created_at','status','source','name','whatsapp','sector','messages_per_day','channel','score','note','page_url'];
    const csv = [keys.join(','), ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(','))].join('\r\n');
    return new Response('\uFEFF' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="velai-leads.csv"', 'Cache-Control': 'no-store' } });
  }
  const match = path.match(/^\/api\/admin\/leads\/([0-9a-f-]+)(?:\/(notes|retry))?$/i);
  if (!match || !UUID_RE.test(match[1])) throw new HttpError(404, 'not_found');
  const id = match[1]; const action = match[2];
  if (!action && request.method === 'GET') {
    const lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(id).first();
    if (!lead) throw new HttpError(404, 'not_found');
    const [notes, events, notifications] = await Promise.all([
      env.DB.prepare('SELECT * FROM lead_notes WHERE lead_id=? ORDER BY created_at DESC').bind(id).all(),
      env.DB.prepare('SELECT * FROM lead_events WHERE lead_id=? ORDER BY created_at DESC').bind(id).all(),
      env.DB.prepare('SELECT * FROM lead_notifications WHERE lead_id=?').bind(id).all(),
    ]);
    return json({ lead, notes: notes.results, events: events.results, notifications: notifications.results }, 200, NO_STORE);
  }
  if (!action && request.method === 'PATCH') {
    const body = await readJson(request, 2000); if (!STATUSES.has(body.status)) throw new HttpError(400, 'invalid_status');
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare('UPDATE leads SET status=?,updated_at=?,expires_at=? WHERE id=?').bind(body.status, now, expiryDate(env), id),
      env.DB.prepare("INSERT INTO lead_events (lead_id,actor_email,event_type,detail,created_at) VALUES (?,?,'status_changed',?,?)").bind(id, actor, body.status, now),
    ]);
    return json({ ok: true }, 200, NO_STORE);
  }
  if (action === 'notes' && request.method === 'POST') {
    const body = await readJson(request, 3000); const text = clean(body.text, 2000); if (!text) throw new HttpError(400, 'invalid_note');
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO lead_notes (lead_id,author_email,text,created_at) VALUES (?,?,?,?)').bind(id, actor, text, now),
      env.DB.prepare('UPDATE leads SET updated_at=?,expires_at=? WHERE id=?').bind(now, expiryDate(env), id),
    ]);
    return json({ ok: true }, 201, NO_STORE);
  }
  if (action === 'retry' && request.method === 'POST') {
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE lead_notifications SET status='pending',attempts=0,next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE lead_id=? AND status!='sent'").bind(now, id).run();
    ctx.waitUntil(processNotifications(env, id, true)); return json({ ok: true }, 202, NO_STORE);
  }
  if (!action && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM leads WHERE id=?').bind(id).run(); return new Response(null, { status: 204 });
  }
  throw new HttpError(405, 'method_not_allowed');
}

// Re-inserta en D1 los leads encolados en KV durante una caída (idempotente por
// request_id). Si el aviso directo ya salió en el fallback, marca los canales como
// enviados para no duplicar el ping al equipo.
async function drainQueuedLeads(env) {
  if (!env.KV) return;
  let list;
  try { list = await env.KV.list({ prefix: 'leadq:', limit: 25 }); } catch (_) { return; }
  for (const entry of list.keys) {
    const input = await env.KV.get(entry.name, 'json');
    if (!input) { await env.KV.delete(entry.name); continue; }
    try {
      const result = await persistLead(env, input);
      // Solo los canales que entregaron durante el fallback se marcan 'sent';
      // compat con colas antiguas que solo traían el booleano `notified`.
      const channels = Array.isArray(input.notifiedChannels) ? input.notifiedChannels
        : (input.notified ? ['telegram', 'whatsapp'] : []);
      if (result.created && channels.length) {
        const now = new Date().toISOString();
        await env.DB.batch(channels.map((ch) => env.DB
          .prepare("UPDATE lead_notifications SET status='sent',attempts=1,sent_at=?,updated_at=? WHERE lead_id=? AND channel=?")
          .bind(now, now, result.id, ch)));
      }
      await env.KV.delete(entry.name);
    } catch (_) { /* D1 sigue caída: se reintenta en el siguiente cron */ }
  }
}

async function scheduled(env) {
  if (!env.DB) return;
  const now = new Date().toISOString();
  await drainQueuedLeads(env);
  // Dos consultas con ORDER BY: lo entregable (pending/failed) tiene prioridad y las
  // filas 'skipped' perpetuas no pueden acaparar la ventana del cron (inanición).
  const due = (await env.DB.prepare(`
    SELECT lead_id FROM lead_notifications
    WHERE status IN ('pending','failed') AND attempts < 5
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    GROUP BY lead_id ORDER BY MIN(updated_at) ASC LIMIT 20`).bind(now).all()).results;
  const idle = (await env.DB.prepare(`
    SELECT lead_id FROM lead_notifications
    WHERE status = 'skipped' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    GROUP BY lead_id ORDER BY MIN(updated_at) ASC LIMIT 5`).bind(now).all()).results;
  for (const row of [...due, ...idle]) await processNotifications(env, row.lead_id);
  // Purga acotada: una acumulación grande no debe chocar con los límites por sentencia de D1.
  await env.DB.prepare('DELETE FROM leads WHERE id IN (SELECT id FROM leads WHERE expires_at <= ? LIMIT 500)').bind(now).run();
}

export function createWorker(config) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url); const path = url.pathname.replace(/\/$/, '') || '/';
      try {
        if (url.hostname === adminHost(env) && path === '/' && request.method === 'GET') {
          await adminIdentity(request, env);
          return adminPageResponse();
        }
        if (path.startsWith('/api/admin/')) {
          // El panel y su API solo existen en el hostname de Access; en workers.dev el
          // JWT seguiría siendo el guardián, pero no hay motivo para exponer la ruta.
          const host = adminHost(env);
          if (!host) throw new HttpError(503, 'admin_misconfigured');
          if (url.hostname !== host) throw new HttpError(404, 'not_found');
          return await handleAdmin(request, env, ctx, path, url);
        }
        const contentType = request.headers.get('Content-Type') || '';
        if (path === '/' && request.method === 'POST' && contentType.includes('application/x-www-form-urlencoded')) return await handleTwilio(request, env, ctx, config);
        if (path === '/lead' || path === '/chat') {
          const cors = publicCors(request, env);
          if (!cors) throw new HttpError(403, 'origin_not_allowed');
          if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
          if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
          const ip = request.headers.get('CF-Connecting-IP') || '';
          if (await rateLimited(env, ip, path.slice(1), path === '/lead' ? 5 : 20)) throw new HttpError(429, 'rate_limited');
          return path === '/lead' ? await handleLead(request, env, cors, ctx) : await handleChat(request, env, cors, ctx, config);
        }
        if (path === '/' && request.method === 'POST' && contentType.includes('application/json')) throw new HttpError(410, 'legacy_chat_retired');
        throw new HttpError(404, 'not_found');
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        const code = error instanceof HttpError ? error.code : 'server_error';
        console.log(JSON.stringify({ level: status >= 500 ? 'error' : 'warn', code, status, path, requestId: request.headers.get('cf-ray') || crypto.randomUUID() }));
        return json({ ok: false, error: code }, status, publicCors(request, env) || {});
      }
    },
    async scheduled(_event, env, ctx) { ctx.waitUntil(scheduled(env)); },
  };
}

export const testing = { clean, normalizePhone, extractPhone, safeUtm, publicCors, validTwilioSignature, csvCell, expiryDate, leadFilters, isDemoKey, templateVar, leadTemplateVariables, readJson, deliver, drainQueuedLeads, verifyTurnstile };
