import { ADMIN_HEADERS, ADMIN_HTML } from './admin-page.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import { createSubaccount, createLeadTemplate, submitTemplateApproval, fetchApprovalStatus, createWhatsAppSender, verifySender, fetchSenderStatus } from './twilio.js';

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
    // font-src es la ÚNICA apertura: las fuentes de marca se sirven desde hirevai.com
    // (con CORS en _headers de Pages); el resto sigue cerrado con nonce.
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; font-src https://hirevai.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
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
  // Caché de prompt (CONTEXTOS-AMPLIOS fase 1): el system es estable por tenant y se
  // reenvía EN CADA turno — con cache_control la relectura cuesta 0,1x desde el segundo
  // mensaje de la conversación (escritura 1,25x, TTL 5 min). Por debajo del mínimo
  // cacheable (1.024 tokens en Sonnet) la API lo ignora sin coste. El bloque debe ser
  // idéntico byte a byte: nada variable (fechas, nombres) puede entrar en el system.
  const body = { ...payload };
  if (typeof body.system === 'string' && body.system) {
    body.system = [{ type: 'text', text: body.system, cache_control: { type: 'ephemeral' } }];
  }
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt) break;
  }
  if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, 'ai_unavailable');
  const data = await response.json();
  // Contadores del caché al log (sin PII): si cache_w y cache_r son siempre 0, el
  // caché NO está acertando — y la API no avisa. Verificable en Workers Logs.
  if (data.usage) {
    console.log(JSON.stringify({ level: 'info', code: 'ai_usage', in: data.usage.input_tokens || 0, out: data.usage.output_tokens || 0, cache_w: data.usage.cache_creation_input_tokens || 0, cache_r: data.usage.cache_read_input_tokens || 0 }));
  }
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

// ── Multi-tenant ─────────────────────────────────────────────────────────────
// La config de cada negocio es un dato (tabla `tenants`); los guardrails
// antiinyección son código y se concatenan SIEMPRE (systemFor). El webhook de
// Twilio enruta por `To`; el canal web por `body.tenant` (default: velai).
const TENANT_TTL = 300; // 5 min: un cambio en la fila se ve casi al momento

// Caché en KV para no pegarle a D1 en cada mensaje. Se cachea también el fallo
// (objeto vacío) para que un bombardeo a un To inexistente no golpee la base.
async function tenantCached(env, cacheKey, query, bindValue) {
  if (env.KV) {
    try {
      const cached = await env.KV.get(cacheKey, 'json');
      if (cached) return cached.id ? cached : null;
    } catch (_) {}
  }
  const row = await env.DB.prepare(query).bind(bindValue).first();
  if (env.KV) { try { await env.KV.put(cacheKey, JSON.stringify(row || {}), { expirationTtl: TENANT_TTL }); } catch (_) {} }
  return row || null;
}

async function tenantByAddress(env, address) {
  if (!env.DB) throw new HttpError(503, 'tenant_storage_not_configured');
  return tenantCached(env, `tenant:addr:${address}`, 'SELECT * FROM tenants WHERE channel_address = ? AND active = 1', address);
}

async function tenantBySlug(env, slug) {
  if (!env.DB) throw new HttpError(503, 'tenant_storage_not_configured');
  return tenantCached(env, `tenant:slug:${slug}`, 'SELECT * FROM tenants WHERE slug = ? AND active = 1', slug);
}

function defaultTenantSlug(env) {
  return clean(env.DEFAULT_TENANT_SLUG, 40) || 'velai';
}

// Resuelve el tenant del canal web: slug del body, o el de por defecto. El widget
// de un cliente solo tendrá que definir window.VELAI_TENANT y adjuntarlo al payload.
async function webTenant(env, body) {
  const slug = clean(body && body.tenant, 40) || defaultTenantSlug(env);
  const tenant = await tenantBySlug(env, slug);
  if (!tenant) throw new HttpError(400, 'invalid_tenant');
  return tenant;
}

// Un sender registrado en Twilio sin fila en `tenants` es un agujero negro: los
// mensajes llegan y nadie los ve. Que avise, no que se pierda en un log. Antirebote 1 h.
async function alertUnknownTenant(env, address) {
  if (!env.KV) return;
  const key = `alert:tenant:${address}`;
  try {
    if (await env.KV.get(key)) return;
    await env.KV.put(key, '1', { expirationTtl: 3600 });
  } catch (_) {}
  try {
    await sendTelegramText(env, `⚠️ <b>Velai</b>: mensaje entrante para <code>${escapeHtml(address)}</code> sin fila en <code>tenants</code>. El cliente no está siendo atendido.`);
  } catch (_) {}
}

// ── Gestión de tenants desde el panel (Fase 2) ──────────────────────────────
const ADDRESS_RE = /^(whatsapp:\+[1-9]\d{6,14}|messenger:\d{5,25})$/;
// Dirección reservada para clientes en negociación (prospectos): NO es enrutable
// (Twilio nunca manda un To con este prefijo) y ocupa el UNIQUE sin pisar la real.
const PENDING_RE = /^pending:[a-z0-9][a-z0-9-]{1,39}$/;
// Cliente solo-web: atiende por `body.tenant` (resuelto por slug), nunca por webhook de
// Twilio. Es una dirección legal y ACTIVABLE — al revés que `pending:`, que fuerza inactivo.
const WEB_RE = /^web:[a-z0-9][a-z0-9-]{1,39}$/;
const ACCOUNT_SID_RE = /^AC[0-9a-f]{32}$/i;
const WABA_RE = /^\d{10,20}$/;
const PARTNER_STATUS = new Set(['pendiente', 'concedido', 'revocado']);
const WA_RE = /^whatsapp:\+[1-9]\d{6,14}$/;
const TEMPLATE_RE = /^HX[0-9a-f]{32}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const CHAT_ID_RE = /^-?\d{5,20}$/;
// El mínimo de 50 evita que un guardado accidental con el campo casi vacío deje
// al bot de un cliente sin contexto contestando cualquier cosa.
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
    if (!ADDRESS_RE.test(out.channel_address) && !PENDING_RE.test(out.channel_address)
      && !WEB_RE.test(out.channel_address)) bad('channel_address');
  }
  if (has('twilio_from')) {
    out.twilio_from = clean(body.twilio_from, 80) || null;
    if (out.twilio_from && !WA_RE.test(out.twilio_from)) bad('twilio_from');
  }
  if (has('team_whatsapp')) {
    const list = clean(body.team_whatsapp, 1000).split(',').map((x) => x.trim()).filter(Boolean);
    if (list.length > 10 || list.some((x) => !WA_RE.test(x))) bad('team_whatsapp');
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
  if (has('active')) out.active = body.active ? 1 : 0;
  return out;
}

// Write-only: el auth token de la subcuenta entra en claro, se guarda cifrado y
// nunca vuelve a salir del worker. No pasa por validateTenant (cifrar es asíncrono)
// y NUNCA entra en el versionado de tenant_versions.
async function tenantTokenColumn(env, tenantId, body) {
  if (body.twilio_auth_token === undefined || body.twilio_auth_token === '') return null;
  const token = clean(body.twilio_auth_token, 64);
  if (!/^[0-9a-f]{32}$/i.test(token)) throw new HttpError(400, 'invalid_twilio_auth_token');
  return encryptSecret(env, tenantId, token);
}

// Activar un prospecto sin ponerle antes su dirección real dejaría una fila "activa"
// que no atiende a nadie y que tapa el hueco del semáforo. Se rechaza explícitamente.
function assertNotActivePending(finalAddress, finalActive) {
  if (Number(finalActive) === 1 && PENDING_RE.test(String(finalAddress))) {
    throw new HttpError(400, 'pending_tenant_cannot_be_active');
  }
}

// Los choques de unicidad se traducen, no revientan en 500. address_taken es EL error
// que desviaría las conversaciones de un cliente al prompt de otro: mensaje claro.
function tenantWriteError(error) {
  const msg = String(error);
  if (/UNIQUE.*slug/i.test(msg)) return new HttpError(409, 'slug_taken');
  if (/UNIQUE.*channel_address/i.test(msg)) return new HttpError(409, 'address_taken');
  if (/UNIQUE.*twilio_subaccount_sid/i.test(msg)) return new HttpError(409, 'subaccount_taken');
  return error;
}

// La caché KV guarda la fila COMPLETA del tenant: CUALQUIER edición (también el
// prompt) debe invalidar, y al cambiar dirección o slug hay que borrar las claves
// viejas Y las nuevas. También tras un alta: los fallos de lookup se cachean.
async function invalidateTenantCache(env, tenants) {
  if (!env.KV) return;
  const keys = new Set();
  for (const t of tenants) {
    if (!t) continue;
    if (t.channel_address) keys.add(`tenant:addr:${t.channel_address}`);
    if (t.slug) keys.add(`tenant:slug:${t.slug}`);
  }
  await Promise.all([...keys].map((k) => env.KV.delete(k).catch(() => {})));
}

// prompt efectivo = negocio del tenant (D1) + guardrails (código, innegociables).
// Si el prompt sigue en 'PENDIENTE' (entre migración y seed) cae al SYSTEM de código:
// el bot nunca contesta vacío.
function systemFor(config, tenant) {
  const base = tenant && tenant.system_prompt && tenant.system_prompt !== 'PENDIENTE'
    ? tenant.system_prompt : config.SYSTEM;
  return `${base}\n${config.GUARDRAILS || ''}`.trim();
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
    id, input.tenantId || null, input.requestId, input.conversationId || null, input.source, input.name || null,
    input.whatsapp || null, input.phone || null, input.sector || null, input.messagesPerDay || null,
    input.channel || null, input.currentResponder || null, input.score, input.note || null,
    input.need || null, input.context || null, JSON.stringify(input.utm || {}), input.pageUrl || null,
    now, now, expiryDate(env),
  ];
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO leads
        (id,tenant_id,request_id,conversation_id,source,name,whatsapp,whatsapp_normalized,sector,messages_per_day,channel,current_responder,score,note,need,context,attribution_json,page_url,created_at,updated_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...args),
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

async function sendTelegramText(env, text, chatId) {
  const target = chatId || env.TELEGRAM_CHAT_ID;
  if (!env.TELEGRAM_TOKEN || !target) return { skipped: true, error: 'not_configured' };
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ chat_id: target, text, parse_mode: 'HTML' }),
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
    // E.164 (whatsapp_normalized) para que el equipo pueda pulsar-para-llamar.
    1: templateVar(lead.whatsapp_normalized || lead.whatsapp, 'sin teléfono'),
    2: templateVar(lead.name, 'sin nombre'),
    3: templateVar(lead.sector, 'sin especificar'),
    4: templateVar(lead.need || lead.note, 'sin especificar'),
  });
}

// Los canales de aviso se resuelven por tenant con respaldo a las variables de
// entorno: Velai sigue funcionando aunque su fila falte o esté incompleta.
async function deliver(env, channel, lead, tenant) {
  if (channel === 'telegram') return sendTelegramText(env, notificationText(lead), tenant && tenant.telegram_chat_id);
  const sub = tenant && tenant.twilio_subaccount_sid;
  const recipientsRaw = (tenant && tenant.team_whatsapp) || env.TEAM_WHATSAPP;
  // Los recursos del padre (número y plantilla de Velai) NO existen dentro de una
  // subcuenta: si el tenant tiene subcuenta, no hay respaldo cruzado posible —
  // Twilio rechazaría siempre (21606/20404) y quemaría los 5 intentos en silencio.
  const templateSid = (tenant && tenant.lead_template_sid) || (sub ? null : env.TWILIO_LEAD_TEMPLATE_SID);
  const fromAddress = (tenant && tenant.twilio_from) || (sub ? null : env.TWILIO_FROM);
  const recipients = clean(recipientsRaw, 1000).split(',').map((x) => x.trim()).filter(Boolean);
  if (!recipients.length || !fromAddress || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    return { skipped: true, error: 'not_configured' };
  }
  // Sin plantilla, el aviso al equipo es un mensaje iniciado por el negocio fuera de la
  // ventana de 24 h y WhatsApp lo rechaza siempre con 63016. Mejor 'skipped' explícito.
  if (!templateSid) return { skipped: true, error: 'template_not_configured' };
  // Una plantilla creada por el panel pero aún no aprobada por Meta no puede enviar:
  // el cron la marcará 'approved' y a partir de ahí sale sola.
  if (tenant && tenant.lead_template_status && tenant.lead_template_status !== 'approved' && tenant.lead_template_sid === templateSid) {
    return { skipped: true, error: 'template_not_approved' };
  }
  // CORREGIDO con la doc de Twilio: los recursos DE una subcuenta se operan con las
  // credenciales DE esa subcuenta (las del padre no valen). El token es el mismo que
  // valida la firma del webhook: ya está cifrado en la fila y se descifra aquí.
  const sendAccountSid = (tenant && tenant.twilio_subaccount_sid) || env.TWILIO_ACCOUNT_SID;
  const sendToken = tenant && tenant.twilio_subaccount_sid
    ? await twilioAuthTokenFor(env, tenant)
    : env.TWILIO_AUTH_TOKEN;
  if (!sendToken) return { skipped: true, error: 'not_configured' };
  const auth = `Basic ${btoa(`${sendAccountSid}:${sendToken}`)}`;
  const variables = leadTemplateVariables(lead);
  // allSettled, no all: con Promise.all un timeout de un destinatario tumbaba el envío
  // entero y el reintento duplicaba el mensaje a quien sí lo había recibido.
  const results = await Promise.allSettled(recipients.map((to) => fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sendAccountSid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        From: fromAddress,
        To: to,
        ContentSid: templateSid,
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
  const tenant = lead.tenant_id
    ? await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(lead.tenant_id).first()
    : null;
  // 'skipped' (canal sin configurar) no consume intentos y se revisita cada 6 h:
  // al configurar el canal, el aviso sale solo sin pasar por el botón Reintentar.
  const jobs = (await env.DB.prepare(`SELECT * FROM lead_notifications WHERE lead_id = ? AND ((status IN ('pending','failed') AND attempts < 5) OR status = 'skipped')`).bind(leadId).all()).results;
  for (const job of jobs) {
    if (!force && job.next_attempt_at && job.next_attempt_at > new Date().toISOString()) continue;
    let outcome;
    try { outcome = await deliver(env, job.channel, lead, tenant); }
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
    source: input.source, name: input.name, whatsapp: input.whatsapp, whatsapp_normalized: input.phone,
    sector: input.sector, messages_per_day: input.messagesPerDay, channel: input.channel,
    need: input.need, note: input.note,
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
    // El aviso directo del modo degradado sale SIEMPRE por los canales de Velai (env):
    // con D1 caída no se puede resolver la fila del tenant. Por eso, si el lead es de
    // un tenant cliente, NO se registran notifiedChannels — al drenar, sus filas quedan
    // 'pending' y el cron notifica por los canales correctos del cliente. Marcarlas
    // habría dejado al cliente sin su aviso con un 'sent' falso en el panel.
    let alerted = false;
    const notifiedChannels = [];
    for (const channel of ['telegram', 'whatsapp']) {
      try {
        if ((await deliver(env, channel, inputToNotifiable(input))).ok) {
          alerted = true;
          if (input.tenantIsDefault !== false) notifiedChannels.push(channel);
        }
      } catch (_) {}
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
    if (!queued && !alerted) throw error;
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
  const tenant = await webTenant(env, body);
  const result = await storeLead(env, ctx, {
    requestId: body.requestId, source: clean(body.fuente, 80) || 'formulario web',
    tenantId: tenant.id, tenantIsDefault: tenant.slug === defaultTenantSlug(env),
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

async function captureChatLead(config, env, ctx, tenant, body, phone, messages) {
  // Mismas guardas que el canal WhatsApp: una captura por conversación (marca en KV),
  // mínimo 2 turnos del usuario. Claves namespaceadas por tenant: dos clientes con el
  // mismo usuario final no se pisan el UNIQUE(request_id).
  const mark = `lead:web:${tenant.id}:${body.conversationId}`;
  if (env.KV && await env.KV.get(mark)) return;
  if (messages.filter((m) => m.role === 'user').length < 2) return;
  const summary = await summarizeLead(config, env, messages);
  const result = await storeLead(env, ctx, {
    requestId: `chat:${tenant.id}:${body.conversationId}:${phone}`, conversationId: body.conversationId,
    tenantId: tenant.id, tenantIsDefault: tenant.slug === defaultTenantSlug(env),
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
async function captureWhatsAppLead(config, env, ctx, tenant, from, phone, messages) {
  const mark = `lead:wa:${tenant.id}:${from}`;
  if (env.KV && await env.KV.get(mark)) return;
  if (messages.filter((m) => m.role === 'user').length < 2) return;
  const summary = await summarizeLead(config, env, messages);
  const sector = clean(summary.negocio, 100);
  const need = clean(summary.necesidad, 200);
  if (!sector && !need) return;
  const result = await storeLead(env, ctx, {
    requestId: `wa:${tenant.id}:${phone}`, source: 'whatsapp',
    tenantId: tenant.id, tenantIsDefault: tenant.slug === defaultTenantSlug(env),
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
  if (body.demo && !isDemoKey(config, body.demo)) throw new HttpError(400, 'invalid_demo');
  if (!env.KV) throw new HttpError(503, 'conversation_storage_not_configured');
  // Límite también por conversación: rotar de IP (CGNAT/móvil) no multiplica el cupo.
  if (await rateLimited(env, body.conversationId, 'chatconv', 20)) throw new HttpError(429, 'rate_limited');
  const tenant = await webTenant(env, body);
  const key = `conv:web:${tenant.id}:${body.conversationId}`;
  let state = await env.KV.get(key, 'json');
  if (!state) {
    await verifyTurnstile(env, body.turnstileToken, request, 'chat');
    state = { demo: isDemoKey(config, body.demo) ? body.demo : '', messages: [] };
  }
  if (body.demo && state.demo !== body.demo) throw new HttpError(409, 'conversation_mode_mismatch');
  state.messages.push({ role: 'user', content: message });
  state.messages = state.messages.slice(-20);
  const reply = await callAnthropic(env, {
    model: 'claude-sonnet-4-6', max_tokens: 300,
    // Las DEMOS son material comercial de Velai, no de un tenant: van tal cual.
    system: isDemoKey(config, state.demo) ? config.DEMOS[state.demo] : systemFor(config, tenant), messages: state.messages,
  });
  state.messages.push({ role: 'assistant', content: reply });
  state.messages = state.messages.slice(-20);
  await env.KV.put(key, JSON.stringify(state), { expirationTtl: 86400 });
  const phone = extractPhone(message);
  if (!state.demo && phone) {
    ctx.waitUntil(captureChatLead(config, env, ctx, tenant, body, phone, state.messages).catch((error) => {
      console.log(JSON.stringify({ level: 'error', code: 'chat_lead_capture_failed', conversationId: body.conversationId, error: error.name }));
    }));
  }
  return json({ reply }, 200, cors);
}

async function twilioAuthTokenFor(env, tenant) {
  if (!tenant || !tenant.twilio_auth_token_enc) return null;
  try {
    const out = await decryptSecret(env, tenant.id, tenant.twilio_auth_token_enc);
    if (!out) return null;
    // Rotación perezosa: si descifró con la KEK antigua, se re-guarda con la actual.
    if (out.stale && env.DB) {
      try {
        const rewrapped = await encryptSecret(env, tenant.id, out.value);
        await env.DB.prepare('UPDATE tenants SET twilio_auth_token_enc=? WHERE id=?').bind(rewrapped, tenant.id).run();
        await invalidateTenantCache(env, [tenant]);
      } catch (_) { /* mejor stale que roto */ }
    }
    return out.value;
  } catch (error) {
    // Un token ilegible (KEK rotada sin re-guardar, fila corrupta) equivale a no tenerlo:
    // 403 + alerta, nunca un 500 mudo que Twilio reintenta y nadie ve.
    console.log(JSON.stringify({ level: 'error', code: 'tenant_token_undecryptable', tenant: tenant.slug }));
    return null;
  }
}

// Un tenant con subcuenta pero sin auth token descifrable = mensajes entrantes que no
// se atienden. Alerta al equipo de Velai con antirebote de 1 h.
async function alertTenantMisconfigured(env, tenant, accountSid) {
  if (!env.KV) return;
  const key = `alert:token:${tenant.id}`;
  try {
    if (await env.KV.get(key)) return;
    await env.KV.put(key, '1', { expirationTtl: 3600 });
  } catch (_) {}
  try {
    await sendTelegramText(env, `⚠️ <b>Velai</b>: mensajes entrantes de <code>${escapeHtml(accountSid)}</code> para <b>${escapeHtml(tenant.name)}</b> sin auth token configurado. El cliente no está siendo atendido.`);
  } catch (_) {}
}

async function handleTwilio(request, env, ctx, config) {
  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const object = {}; params.forEach((value, key) => { object[key] = value; });
  const accountSid = clean(params.get('AccountSid'), 40);
  const to = clean(params.get('To'), 80);
  if (!accountSid || !to) throw new HttpError(400, 'invalid_twilio_payload');
  // Twilio solo manda `whatsapp:` o `messenger:`. Cualquier otra cosa (incluidas las
  // direcciones internas `web:` y `pending:`) se rechaza aquí: una dirección interna
  // no puede recibir tráfico ni gastar una consulta a D1, ni con el token del padre.
  if (!ADDRESS_RE.test(to)) throw new HttpError(400, 'invalid_twilio_payload');

  // ORDEN: la firma depende del auth token de la cuenta que envía, y con subcuentas
  // ese token vive cifrado en la fila del tenant. Primero el tenant (por To, que es
  // único) y después la firma. Sin tenant o sin token NO se valida y NO se pasa:
  // nunca hay camino "pasa igualmente".
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
  if (!from) throw new HttpError(400, 'invalid_twilio_payload');
  // Messenger manda adjuntos (stickers, fotos) sin Body: 200 con TwiML vacío en vez
  // de 400, para no llenar los logs de Twilio de errores por cada sticker.
  if (!message) {
    console.log(JSON.stringify({ level: 'info', code: 'messenger_attachment_ignored', to }));
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
  }

  // Historial namespaceado por tenant: dos clientes distintos con el mismo usuario
  // final no comparten conversación.
  const key = `conv:wa:${tenant.id}:${from}`;
  let history = env.KV ? await env.KV.get(key, 'json') || [] : [];
  history.push({ role: 'user', content: message }); history = history.slice(-20);
  const reply = await callAnthropic(env, { model: 'claude-sonnet-4-6', max_tokens: 300, system: systemFor(config, tenant), messages: history });
  history.push({ role: 'assistant', content: reply }); history = history.slice(-20);
  if (env.KV) await env.KV.put(key, JSON.stringify(history), { expirationTtl: 86400 });
  const phone = normalizePhone(from.replace(/^whatsapp:/i, ''));
  if (phone) {
    ctx.waitUntil(captureWhatsAppLead(config, env, ctx, tenant, from, phone, history).catch((error) => {
      console.log(JSON.stringify({ level: 'error', code: 'wa_lead_capture_failed', tenant: tenant.slug, error: error.name }));
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
  const tenant = clean(url.searchParams.get('tenant'), 40);
  if (tenant && UUID_RE.test(tenant)) { clauses.push('l.tenant_id = ?'); values.push(tenant); }
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

// La serie del gráfico rellena los días vacíos con 0 EN EL SERVIDOR: si no, el
// gráfico comprime el eje y miente sobre la distribución.
function fillSeries(rows, days) {
  const byDay = new Map(rows.map((r) => [r.d, r.n]));
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    out.push({ d, n: byDay.get(d) || 0 });
  }
  return out;
}

// ── Aprovisionamiento de Twilio desde el panel (PR 6) ────────────────────────
// Cerrojo para la ventana entre la llamada a Twilio y el UPDATE en D1: dos clics
// simultáneos no deben crear dos subcuentas (en Twilio no se borran, se cierran).
async function provisionLock(env, tenantId, step) {
  if (!env.KV) return true;
  const key = `provision:${tenantId}:${step}`;
  try {
    if (await env.KV.get(key)) return false;
    await env.KV.put(key, '1', { expirationTtl: 60 });
  } catch (_) {}
  return true;
}

async function provisionAudit(env, ctx, tenantId, actor, note) {
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
    .bind(tenantId, actor, 'provision', null, note, now).run();
  ctx.waitUntil(sendTelegramText(env, `🛠 <b>${escapeHtml(actor)}</b> · ${escapeHtml(note)}`).catch(() => {}));
}

// Twilio respondió OK pero D1 no guardó: recurso huérfano con su token perdido.
// Es el único fallo que no se arregla solo — SID al log y alerta para reconciliar.
async function provisionOrphan(env, ctx, tenant, resource, sid, error) {
  console.log(JSON.stringify({ level: 'error', code: 'provision_orphan', tenant: tenant.slug, resource, sid, error: error.code || error.name }));
  ctx.waitUntil(sendTelegramText(env, `🚨 <b>Velai</b>: ${escapeHtml(resource)} <code>${escapeHtml(sid)}</code> creado en Twilio para <b>${escapeHtml(tenant.name)}</b> pero D1 no lo guardó. Reconciliar a mano.`).catch(() => {}));
  throw new HttpError(500, 'provision_orphan');
}

async function handleProvision(request, env, ctx, tenantId, step, actor) {
  if (!env.DB) throw new HttpError(503, 'lead_storage_not_configured');
  const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id=?').bind(tenantId).first();
  if (!tenant) throw new HttpError(404, 'not_found');
  if (!step && request.method === 'GET') {
    return json({
      subaccount: { sid: tenant.twilio_subaccount_sid, hasToken: !!tenant.twilio_auth_token_enc },
      template: { sid: tenant.lead_template_sid, status: tenant.lead_template_status },
      sender: { sid: tenant.sender_sid, status: tenant.sender_status },
      provisioned_at: tenant.provisioned_at,
      // La API de Twilio no configura topes de gasto: el panel avisa hasta ponerlo a mano.
      warnings: tenant.twilio_subaccount_sid ? ['Configura el tope de gasto de la subcuenta en la consola de Twilio (la API no lo permite).'] : [],
    }, 200, NO_STORE);
  }
  if (!step || request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  // Rate limit por actor: cada llamada crea recursos facturables.
  if (await rateLimited(env, actor, 'provision', 5)) throw new HttpError(429, 'rate_limited');
  if (!await provisionLock(env, tenantId, step)) throw new HttpError(409, 'provision_in_progress');
  // El cerrojo se libera SIEMPRE al terminar (éxito o fallo): un OTP mal escrito no
  // puede dejar "ese paso ya está en curso" durante un minuto sin nada en curso.
  try {
    return await runProvisionStep(request, env, ctx, tenant, tenantId, step, actor);
  } finally {
    if (env.KV) { try { await env.KV.delete(`provision:${tenantId}:${step}`); } catch (_) {} }
  }
}

async function runProvisionStep(request, env, ctx, tenant, tenantId, step, actor) {
  const now = new Date().toISOString();

  if (step === 'subaccount') {
    if (tenant.twilio_subaccount_sid) throw new HttpError(409, 'already_provisioned');
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) throw new HttpError(503, 'twilio_not_configured');
    // La KEK se comprueba ANTES de gastar dinero: si no puede cifrar, no se crea nada
    // (una subcuenta no se borra, solo se cierra con eliminación a 30 días).
    try { await encryptSecret(env, tenantId, 'probe'); }
    catch (_) { throw new HttpError(503, 'kek_not_configured'); }
    const created = await createSubaccount(env, `cliente-${tenant.slug}`);
    let encrypted = null;
    try { encrypted = await encryptSecret(env, tenantId, created.authToken); }
    catch (error) { await provisionOrphan(env, ctx, tenant, 'subcuenta', created.sid, error); }
    try {
      // La idempotencia la impone D1 (WHERE … IS NULL), no el cerrojo de KV: dos
      // peticiones simultáneas no pueden pisarse el SID/token la una a la otra.
      const res = await env.DB.prepare(`UPDATE tenants SET twilio_subaccount_sid=?, twilio_auth_token_enc=?,
        provisioned_at=?, updated_at=? WHERE id=? AND twilio_subaccount_sid IS NULL`)
        .bind(created.sid, encrypted, now, now, tenantId).run();
      if (!res.meta.changes) await provisionOrphan(env, ctx, tenant, 'subcuenta (carrera)', created.sid, new Error('already_provisioned'));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      await provisionOrphan(env, ctx, tenant, 'subcuenta', created.sid, error);
    }
    await invalidateTenantCache(env, [tenant]);
    await provisionAudit(env, ctx, tenantId, actor, `subcuenta ${created.sid} creada para ${tenant.name} (token cifrado en el acto)`);
    return json({ ok: true, sid: created.sid }, 201, NO_STORE);
  }

  // Los pasos siguientes operan recursos DE la subcuenta: credenciales DE la subcuenta.
  if (!tenant.twilio_subaccount_sid) throw new HttpError(400, 'subaccount_required');
  const token = await twilioAuthTokenFor(env, tenant);
  if (!token) throw new HttpError(400, 'twilio_auth_token_missing');
  const credentials = { sid: tenant.twilio_subaccount_sid, token };

  if (step === 'template') {
    if (tenant.lead_template_sid || tenant.lead_template_status) throw new HttpError(409, 'already_provisioned');
    const { contentSid } = await createLeadTemplate(credentials, tenant.slug, tenant.name);
    try {
      await submitTemplateApproval(credentials, contentSid, `nuevo_lead_${tenant.slug}`);
      const res = await env.DB.prepare("UPDATE tenants SET lead_template_sid=?, lead_template_status='pending', updated_at=? WHERE id=? AND lead_template_sid IS NULL")
        .bind(contentSid, now, tenantId).run();
      if (!res.meta.changes) await provisionOrphan(env, ctx, tenant, 'plantilla (carrera)', contentSid, new Error('already_provisioned'));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      await provisionOrphan(env, ctx, tenant, 'plantilla', contentSid, error);
    }
    await provisionAudit(env, ctx, tenantId, actor, `plantilla nuevo_lead_${tenant.slug} (${contentSid}) enviada a aprobación Utility`);
    await invalidateTenantCache(env, [tenant]);
    return json({ ok: true, sid: contentSid, status: 'pending' }, 201, NO_STORE);
  }

  if (step === 'sender') {
    if (tenant.sender_sid) throw new HttpError(409, 'already_provisioned');
    if (!tenant.waba_id) throw new HttpError(400, 'waba_required');
    const body = await readJson(request, 2000);
    const phone = clean(body.phone, 20);
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new HttpError(400, 'invalid_phone');
    const created = await createWhatsAppSender(credentials, { phone, wabaId: tenant.waba_id, callbackUrl: 'https://vai-worker.botnexo-ia.workers.dev' });
    try {
      const res = await env.DB.prepare('UPDATE tenants SET sender_sid=?, sender_status=?, updated_at=? WHERE id=? AND sender_sid IS NULL')
        .bind(created.senderSid, created.status || 'CREATING', now, tenantId).run();
      if (!res.meta.changes) await provisionOrphan(env, ctx, tenant, 'sender (carrera)', created.senderSid, new Error('already_provisioned'));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      await provisionOrphan(env, ctx, tenant, 'sender', created.senderSid, error);
    }
    await provisionAudit(env, ctx, tenantId, actor, `sender whatsapp:${phone} creado (${created.senderSid})`);
    await invalidateTenantCache(env, [tenant]);
    return json({ ok: true, sid: created.senderSid, status: created.status }, 201, NO_STORE);
  }

  if (step === 'sender/verify') {
    if (!tenant.sender_sid) throw new HttpError(400, 'sender_required');
    if (tenant.sender_status === 'ONLINE') throw new HttpError(409, 'already_provisioned');
    const body = await readJson(request, 2000);
    const code = clean(body.code, 10);
    if (!/^\d{4,8}$/.test(code)) throw new HttpError(400, 'invalid_code');
    const result = await verifySender(credentials, tenant.sender_sid, code);
    await env.DB.prepare('UPDATE tenants SET sender_status=?, updated_at=? WHERE id=?').bind(result.status || 'VERIFYING', now, tenantId).run();
    await provisionAudit(env, ctx, tenantId, actor, `OTP del sender enviado (estado ${result.status})`);
    await invalidateTenantCache(env, [tenant]);
    return json({ ok: true, status: result.status }, 200, NO_STORE);
  }

  throw new HttpError(404, 'not_found');
}

async function handleAdmin(request, env, ctx, path, url, config) {
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
    const result = await env.DB.prepare(`SELECT l.*, t.name AS tenant_name, GROUP_CONCAT(n.channel || ':' || n.status) notification_summary FROM leads l LEFT JOIN tenants t ON t.id=l.tenant_id LEFT JOIN lead_notifications n ON n.lead_id=l.id WHERE ${filters.sql} GROUP BY l.id ORDER BY l.created_at DESC, l.id DESC LIMIT ?`).bind(...filters.values, limit + 1).all();
    const rows = result.results; const more = rows.length > limit; if (more) rows.pop();
    return json({ leads: rows, nextCursor: more ? `${rows.at(-1).created_at}|${rows.at(-1).id}` : null }, 200, NO_STORE);
  }
  if (path === '/api/admin/leads/export.csv' && request.method === 'GET') {
    const filters = leadFilters(url);
    const rows = (await env.DB.prepare(`SELECT l.created_at,l.status,t.name AS tenant_name,l.source,l.name,l.whatsapp,l.sector,l.messages_per_day,l.channel,l.score,l.note,l.page_url FROM leads l LEFT JOIN tenants t ON t.id=l.tenant_id WHERE ${filters.sql} ORDER BY l.created_at DESC LIMIT 5000`).bind(...filters.values).all()).results;
    const keys = ['created_at','status','tenant_name','source','name','whatsapp','sector','messages_per_day','channel','score','note','page_url'];
    const csv = [keys.join(','), ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(','))].join('\r\n');
    return new Response('\uFEFF' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="velai-leads.csv"', 'Cache-Control': 'no-store' } });
  }
  if (path === '/api/admin/tenants' && request.method === 'GET') {
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
             length(t.system_prompt) AS prompt_len,
             COUNT(l.id) AS lead_count
      FROM tenants t LEFT JOIN leads l ON l.tenant_id = t.id
      GROUP BY t.id ORDER BY t.active DESC, t.name ASC`).all()).results;
    return json({ tenants: rows }, 200, NO_STORE);
  }
  if (path === '/api/admin/tenants' && request.method === 'POST') {
    const body = await readJson(request, 32000);
    const fields = validateTenant(body, { partial: false });
    assertNotActivePending(fields.channel_address, fields.active ?? 1);
    const now = new Date().toISOString();
    const tenantId = crypto.randomUUID();
    const tokenColumn = await tenantTokenColumn(env, tenantId, body);
    try {
      await env.DB.prepare(`INSERT INTO tenants
        (id,slug,name,channel_address,team_whatsapp,telegram_chat_id,lead_template_sid,twilio_from,twilio_subaccount_sid,waba_id,twilio_auth_token_enc,meta_partner_status,system_prompt,active,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(tenantId, fields.slug, fields.name, fields.channel_address, fields.team_whatsapp ?? null,
          fields.telegram_chat_id ?? null, fields.lead_template_sid ?? null, fields.twilio_from ?? null,
          fields.twilio_subaccount_sid ?? null, fields.waba_id ?? null, tokenColumn,
          fields.meta_partner_status ?? 'pendiente', fields.system_prompt, fields.active ?? 1, now, now).run();
    } catch (error) { throw tenantWriteError(error); }
    // Invalidar ANTES del versionado: si el INSERT de la versión fallara, la caché
    // no puede quedarse 5 minutos sirviendo el estado anterior.
    await invalidateTenantCache(env, [fields]);
    await env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
      .bind(tenantId, actor, 'config', null, clean(body.note, 200) || 'alta', now).run();
    return json({ ok: true, id: tenantId, updated_at: now }, 201, NO_STORE);
  }
  if (path === '/api/admin/stats' && request.method === 'GET') {
    // Métricas para la cabecera del panel: solo recuentos y fechas, nunca PII.
    // El listado está paginado — contar en cliente daría números falsos.
    const [total30, nuevos, fallidos7, tenantsRows, serieRows] = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE created_at >= datetime('now','-30 days')"),
      env.DB.prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM leads WHERE status = 'new'"),
      env.DB.prepare("SELECT COUNT(*) AS n FROM lead_notifications WHERE status = 'failed' AND updated_at >= datetime('now','-7 days')"),
      env.DB.prepare('SELECT active, COUNT(*) AS n FROM tenants GROUP BY active'),
      env.DB.prepare("SELECT date(created_at) AS d, COUNT(*) AS n FROM leads WHERE created_at >= datetime('now','-14 days') GROUP BY d ORDER BY d"),
    ]);
    const activos = (tenantsRows.results || []).find((r) => Number(r.active) === 1);
    return json({
      total30: total30.results[0].n,
      sinContactar: nuevos.results[0].n,
      sinContactarDesde: nuevos.results[0].oldest || null,
      fallidos7: fallidos7.results[0].n,
      tenantsActivos: activos ? activos.n : 0,
      porDia: fillSeries(serieRows.results || [], 14),
    }, 200, NO_STORE);
  }
  const provMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/provision(?:\/(subaccount|template|sender\/verify|sender))?$/i);
  if (provMatch) {
    if (!UUID_RE.test(provMatch[1])) throw new HttpError(404, 'not_found');
    return await handleProvision(request, env, ctx, provMatch[1], provMatch[2] || '', actor);
  }
  const tenantMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)(?:\/(preview|versions))?(?:\/(\d+)\/restore)?$/i);
  if (tenantMatch) {
    if (!UUID_RE.test(tenantMatch[1])) throw new HttpError(404, 'not_found');
    const tenantId = tenantMatch[1]; const tenantAction = tenantMatch[2]; const versionId = tenantMatch[3];
    if (!tenantAction && request.method === 'GET') {
      // Columnas explícitas, NUNCA SELECT *: twilio_auth_token_enc no sale del worker.
      const tenant = await env.DB.prepare(`SELECT id, slug, name, channel_address, team_whatsapp, telegram_chat_id,
        lead_template_sid, twilio_from, twilio_subaccount_sid, waba_id, meta_partner_status, system_prompt,
        active, created_at, updated_at, twilio_auth_token_enc IS NOT NULL AS has_twilio_token
        FROM tenants WHERE id=?`).bind(tenantId).first();
      if (!tenant) throw new HttpError(404, 'not_found');
      return json({ tenant }, 200, NO_STORE);
    }
    if (!tenantAction && request.method === 'PATCH') {
      const body = await readJson(request, 32000);   // el prompt es grande
      const previous = await env.DB.prepare('SELECT * FROM tenants WHERE id=?').bind(tenantId).first();
      if (!previous) throw new HttpError(404, 'not_found');
      const fields = validateTenant(body, { partial: true });
      const tokenColumn = await tenantTokenColumn(env, tenantId, body);
      if (!Object.keys(fields).length && !tokenColumn) throw new HttpError(400, 'nothing_to_update');
      assertNotActivePending(fields.channel_address ?? previous.channel_address, fields.active ?? previous.active);
      const now = new Date().toISOString();
      // `columns` alimenta también el versionado: el token va aparte y jamás entra ahí.
      const columns = Object.keys(fields);
      const setSql = [...columns.map((c) => `${c}=?`), ...(tokenColumn ? ['twilio_auth_token_enc=?'] : [])].join(',');
      const setValues = [...columns.map((c) => fields[c]), ...(tokenColumn ? [tokenColumn] : [])];
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
            Object.fromEntries(columns.filter((c) => c !== 'system_prompt').map((c) => [c, previous[c]]))),
          clean(body.note, 200) || null, now).run();
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
      return json({ reply }, 200, NO_STORE);
    }
    // Un tenant no se borra NUNCA: los leads apuntan a tenant_id y el histórico es
    // del negocio. El panel solo desactiva (active=0).
    throw new HttpError(405, 'method_not_allowed');
  }
  const match = path.match(/^\/api\/admin\/leads\/([0-9a-f-]+)(?:\/(notes|retry))?$/i);
  if (!match || !UUID_RE.test(match[1])) throw new HttpError(404, 'not_found');
  const id = match[1]; const action = match[2];
  if (!action && request.method === 'GET') {
    const lead = await env.DB.prepare('SELECT l.*, t.name AS tenant_name FROM leads l LEFT JOIN tenants t ON t.id=l.tenant_id WHERE l.id=?').bind(id).first();
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

// El sistema avisa cuándo un cliente quedó listo, en vez de tener que entrar a mirar:
// sondea las plantillas pendientes de aprobación y los senders que aún no están ONLINE.
async function pollProvisioning(env) {
  const rows = (await env.DB.prepare(`SELECT * FROM tenants
    WHERE (lead_template_status = 'pending' AND lead_template_sid IS NOT NULL)
       OR (sender_sid IS NOT NULL AND (sender_status IS NULL OR sender_status != 'ONLINE'))
    ORDER BY updated_at ASC LIMIT 10`).all()).results;
  for (const tenant of rows) {
    try {
      const token = await twilioAuthTokenFor(env, tenant);
      if (!token || !tenant.twilio_subaccount_sid) continue;
      const credentials = { sid: tenant.twilio_subaccount_sid, token };
      const now = new Date().toISOString();
      if (tenant.lead_template_status === 'pending' && tenant.lead_template_sid) {
        const approval = await fetchApprovalStatus(credentials, tenant.lead_template_sid);
        if (approval.status === 'approved') {
          await env.DB.prepare("UPDATE tenants SET lead_template_status='approved', updated_at=? WHERE id=?").bind(now, tenant.id).run();
          await invalidateTenantCache(env, [tenant]);
          await sendTelegramText(env, `✅ <b>Velai</b>: la plantilla de <b>${escapeHtml(tenant.name)}</b> ya está aprobada — los avisos salen por la suya.`);
        } else if (approval.status === 'rejected') {
          await env.DB.prepare("UPDATE tenants SET lead_template_status='rejected', updated_at=? WHERE id=?").bind(now, tenant.id).run();
          await invalidateTenantCache(env, [tenant]);
          await sendTelegramText(env, `❌ <b>Velai</b>: Meta rechazó la plantilla de <b>${escapeHtml(tenant.name)}</b>${approval.reason ? `: ${escapeHtml(approval.reason)}` : ''}.`);
        }
      }
      if (tenant.sender_sid && tenant.sender_status !== 'ONLINE') {
        const sender = await fetchSenderStatus(credentials, tenant.sender_sid);
        if (sender.status && sender.status !== tenant.sender_status) {
          await env.DB.prepare('UPDATE tenants SET sender_status=?, updated_at=? WHERE id=?').bind(sender.status, now, tenant.id).run();
          await invalidateTenantCache(env, [tenant]);
          if (sender.status === 'ONLINE') await sendTelegramText(env, `✅ <b>Velai</b>: el sender de WhatsApp de <b>${escapeHtml(tenant.name)}</b> está ONLINE.`);
        }
      }
    } catch (_) { /* siguiente tenant; el cron reintenta en 5 min */ }
  }
}

async function scheduled(env) {
  if (!env.DB) return;
  const now = new Date().toISOString();
  await drainQueuedLeads(env);
  try { await pollProvisioning(env); } catch (_) {}
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
          return await handleAdmin(request, env, ctx, path, url, config);
        }
        const contentType = request.headers.get('Content-Type') || '';
        if (path === '/' && request.method === 'POST' && contentType.includes('application/x-www-form-urlencoded')) {
          // Con el reorden tenant→firma, una petición sin firma ya toca D1: rate limit por IP.
          const twilioIp = request.headers.get('CF-Connecting-IP') || 'unknown';
          if (await rateLimited(env, twilioIp, 'twilio', 120)) throw new HttpError(429, 'rate_limited');
          return await handleTwilio(request, env, ctx, config);
        }
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

export const testing = { clean, normalizePhone, extractPhone, safeUtm, publicCors, validTwilioSignature, csvCell, expiryDate, leadFilters, isDemoKey, templateVar, leadTemplateVariables, readJson, deliver, drainQueuedLeads, verifyTurnstile, systemFor, validateTenant, invalidateTenantCache, tenantWriteError, assertNotActivePending, handleProvision, pollProvisioning, fillSeries };
