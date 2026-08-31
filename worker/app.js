import { ADMIN_HEADERS, ADMIN_HTML } from './admin-page.js';
import { encryptSecret, decryptSecret } from './crypto.js';
import { cloudflareConfigured, syncTurnstileDomains, syncAccessGroup, syncAdminGroup, verifyCfToken } from './cloudflare.js';
import { createSubaccount, fetchSubaccount, findSubaccountByName, createLeadTemplate, submitTemplateApproval, fetchApprovalStatus, createWhatsAppSender, verifySender, fetchSenderStatus, listWhatsAppSenders, updateSenderWebhook, updateSenderProfile, fetchSender } from './twilio.js';
import { CALENDAR_TOOLS, CALENDAR_GUARDRAILS, DEFAULT_BUSINESS_HOURS, freeSlots, localToUtcMs, localDateStr, localWeekday, googleAuthUrl, exchangeGoogleCode, refreshGoogleToken, revokeGoogleToken, googleBusy, createGoogleEvent } from './calendar.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
// URL pública del worker: webhook de Twilio (senders) y de Telegram apuntan aquí.
const WORKER_PUBLIC_URL = 'https://vai-worker.botnexo-ia.workers.dev';
// Desde cuándo se cuentan conversaciones (migración 0020): antes de esta fecha no hay
// denominador y la tasa de captura no se puede calcular sin engañar.
const CONV_TRACKING_SINCE = '2026-08-25';
const PUBLIC_MEDIA_BASE = 'https://api.hirevai.com'; // dominio propio: no lo cortan los adblock
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
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' https: data:; font-src https://hirevai.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
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

// Base del entorno (los orígenes de Velai). El tope sube de 1000 a 4000 y, si algún
// día se alcanza, se loguea: clean() truncaba EN SILENCIO y hacia el cliente ~15 el
// último dominio dejaba de funcionar con un origin_not_allowed inexplicable.
function envOrigins(env) {
  const raw = String(env.ALLOWED_WEB_ORIGINS || '');
  if (raw.length > 4000) console.log(JSON.stringify({ level: 'error', code: 'allowed_origins_truncated', length: raw.length }));
  return raw.slice(0, 4000).split(',').map((x) => x.trim()).filter(Boolean);
}

// Orígenes permitidos = los del entorno + los `web_origins` de los tenants ACTIVOS
// (D1, migración 0008). Caché en KV 5 min bajo 'origins:all', invalidada por
// invalidateTenantCache. Si D1 o KV fallan, la base del entorno sostiene nuestro sitio.
async function allowedOrigins(env) {
  const base = envOrigins(env);
  if (!env.DB) return base;
  if (env.KV) {
    try { const cached = await env.KV.get('origins:all', 'json'); if (Array.isArray(cached)) return cached; } catch (_) {}
  }
  let rows = [];
  try {
    rows = (await env.DB.prepare('SELECT web_origins FROM tenants WHERE active = 1 AND web_origins IS NOT NULL').all()).results || [];
  } catch (_) { return base; }
  const set = new Set(base);
  for (const row of rows) {
    try { for (const o of JSON.parse(row.web_origins)) if (ORIGIN_RE.test(o)) set.add(o); } catch (_) {}
  }
  const list = [...set];
  if (env.KV) { try { await env.KV.put('origins:all', JSON.stringify(list), { expirationTtl: TENANT_TTL }); } catch (_) {} }
  return list;
}

async function publicCors(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin || !(await allowedOrigins(env)).includes(origin)) return null;
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
  // `why` = el detalle CRUDO del tercero que falló (el "description" de Telegram, el
  // "message" de Twilio). Va aparte del código a propósito: el código es contrato con el
  // panel y es traducible; el why es diagnóstico y puede cambiar sin romper a nadie.
  // Sin esto, un fallo de un tercero llega al panel como "reintenta" y al log como nada:
  // exactamente lo que dejó el alta de Telegram de los clientes muerta y sin rastro
  // desde el 2026-08-21 (ningún cliente llegó a vincular; ver IMPLEMENTADO.md).
  constructor(status, code, why) { super(code); this.status = status; this.code = code; if (why) this.why = String(why).slice(0, 200); }
}

// Freno EN MEMORIA para actores ya autenticados (el panel): KV cobra una escritura por
// petición y una sola carga del panel dispara ~8 llamadas — así se agotó media cuota
// diaria en un día de pruebas (aviso de Cloudflare, 2026-08-24). Es por isolate, así que
// vale como tope anti-bucle, no como defensa: para lo público sigue el contador en KV.
const memHits = new Map();
function memLimited(key, limit, windowMs = 60000) {
  const now = Date.now();
  const hit = memHits.get(key);
  if (!hit || now - hit.at > windowMs) { memHits.set(key, { at: now, n: 1 }); if (memHits.size > 5000) memHits.clear(); return false; }
  hit.n += 1;
  return hit.n > limit;
}

async function rateLimited(env, ip, bucket, limit) {
  // El panel (identidad verificada por Access) no gasta cuota de KV.
  if (bucket === 'admin') return memLimited(`${bucket}:${ip}`, limit);
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
    const okHosts = new Set((await allowedOrigins(env)).map((o) => { try { return new URL(o).hostname; } catch (_) { return ''; } }));
    okHosts.add('localhost'); okHosts.add('127.0.0.1');
    if (!okHosts.has(result.hostname)) throw new HttpError(403, 'human_verification_failed');
  }
}

// Presupuesto diario de llamadas al modelo en dos niveles. El cupo POR TENANT evita
// que el tráfico anómalo de un cliente tumbe el chat de los demás; el techo GLOBAL
// se mantiene como red anti-catástrofe de la API key ante un abuso distribuido.
// Contadores en KV por día UTC; fail-open si KV cae (igual que el rate limit —
// Turnstile sigue siendo la barrera principal). Sin tenant (preview del panel)
// solo aplica el techo global.
async function aiBudgetGuard(env, tenant) {
  if (!env.KV) return;
  const day = new Date().toISOString().slice(0, 10);
  // Cupo del tenant primero: su 429 nombra al culpable. La columna ai_daily_limit
  // (migración 0011) permite estrangular a UN cliente sin deploy; la caché de
  // tenants (5 min) aplica el cambio casi al momento. Clave por id, no por slug:
  // el slug es editable y renombrarlo no debe resetear el contador.
  let tenantKey = null; let tenantCount = 0;
  if (tenant && tenant.id) {
    const tenantLimit = Number(tenant.ai_daily_limit) || Number(env.AI_TENANT_DAILY_LIMIT) || 300;
    tenantKey = `budget:ai:${tenant.id}:${day}`;
    try { tenantCount = Number(await env.KV.get(tenantKey) || 0); } catch (_) { tenantKey = null; }
    // Aviso al 80%, una vez al día: subir el tope sin avisar antes solo retrasa la
    // sorpresa. Este es el aviso que convierte el corte en algo que vemos venir.
    if (tenantKey && tenantCount >= Math.floor(tenantLimit * 0.8) && tenantCount < tenantLimit) {
      try {
        const warnKey = `alert:ai80:${tenant.id}:${day}`;
        if (!(await env.KV.get(warnKey))) {
          await env.KV.put(warnKey, '1', { expirationTtl: 2 * 86400 });
          console.log(JSON.stringify({ level: 'warn', code: 'ai_tenant_budget_warning', tenant: tenant.slug, used: tenantCount, limit: tenantLimit }));
          await sendTelegramText(env, `⚠️ <b>Velai</b>: <b>${escapeHtml(tenant.name)}</b> (${escapeHtml(tenant.slug)}) va por ${tenantCount} de ${tenantLimit} llamadas de IA hoy (80%). Si llega al tope, sus canales responden 429. Súbele el límite en su ficha si el tráfico es legítimo.`);
        }
      } catch (_) {}
    }
    if (tenantKey && tenantCount >= tenantLimit) {
      try {
        const alertKey = `alert:aibudget:${tenant.id}`;
        if (!(await env.KV.get(alertKey))) {
          await env.KV.put(alertKey, '1', { expirationTtl: 3600 });
          await sendTelegramText(env, `⚠️ <b>Velai</b>: presupuesto de IA agotado para <b>${escapeHtml(tenant.name)}</b> (${escapeHtml(tenant.slug)}): ${tenantLimit} llamadas hoy. Sus canales responden 429 hasta mañana o hasta subir su límite.`);
        }
      } catch (_) {}
      throw new HttpError(429, 'ai_tenant_budget_exhausted');
    }
  }
  const limit = Number(env.AI_DAILY_LIMIT) || 1000;
  const key = `budget:ai:${day}`;
  let current = 0;
  try { current = Number(await env.KV.get(key) || 0); } catch (_) { return; }
  if (current >= limit) {
    try {
      if (!(await env.KV.get('alert:aibudget'))) {
        await env.KV.put('alert:aibudget', '1', { expirationTtl: 3600 });
        await sendTelegramText(env, `⚠️ <b>Velai</b>: presupuesto diario de IA agotado (techo GLOBAL, ${limit} llamadas). El chat responde 429 hasta mañana o hasta subir AI_DAILY_LIMIT.`);
      }
    } catch (_) {}
    throw new HttpError(429, 'ai_budget_exhausted');
  }
  // Se incrementan AMBOS contadores tras pasar ambos cortes: así un 429 del techo
  // global no gasta cupo del tenant.
  try { await env.KV.put(key, String(current + 1), { expirationTtl: 2 * 86400 }); } catch (_) {}
  if (tenantKey) { try { await env.KV.put(tenantKey, String(tenantCount + 1), { expirationTtl: 2 * 86400 }); } catch (_) {} }
}

// options: { tenant }  → presupuesto por tenant además del global.
//          { retries, timeoutMs } → el webhook de Twilio usa 0 reintentos / 10 s
//          (Twilio corta a ~15 s; reintentar aquí garantizaba perder la respuesta).
//          Los demás llamadores mantienen 1 reintento / 15 s.
// Devuelve el JSON COMPLETO de la API: con tools el primer bloque puede ser
// tool_use y content[0].text no existe — el wrapper callAnthropic (texto) queda
// para los llamadores sin herramientas.
// Precios oficiales por millón de tokens (verificados en la referencia de la API de
// Anthropic, 2026-08-24). El caché escribe a 1,25x y lee a 0,1x del precio de entrada.
// Si un día cambian, se cambian AQUÍ: el panel calcula el gasto con esta tabla.
const AI_PRICES = {
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};
const AI_PRICE_FALLBACK = { in: 3, out: 15 };   // modelo desconocido: se estima como Sonnet

// Topes de salida del modelo, por canal.
// Web: sin límite de canal, así que manda la calidad de la respuesta. Con 300 se cortaban
// consultas legítimas por la mitad (GOgestión, 2026-08-26).
const WEB_MAX_TOKENS = 700;
// WhatsApp: el tope lo pone el CANAL, no el modelo — Twilio corta el cuerpo en 1.600
// caracteres y rechaza de largo (21617). ~400 tokens de español son ~1.500 caracteres:
// subir más cambiaría un truncado por un envío fallido, que es peor porque el cliente
// final no recibe nada.
const WA_MAX_TOKENS = 400;
const WA_TOOL_MAX_TOKENS = 500;   // el JSON de tool_use consume output aparte del texto
const WA_BODY_LIMIT = 1500;       // margen sobre los 1.600 de WhatsApp

// Cuerpo apto para WhatsApp: recorta a la última frase completa dentro del límite del
// canal, en vez de partir una palabra o dejar que Twilio rechace el mensaje entero.
function waBody(text) {
  const value = String(text || '');
  return value.length <= WA_BODY_LIMIT ? value : trimToSentence(value.slice(0, WA_BODY_LIMIT));
}


function aiCost(row) {
  const p = AI_PRICES[row.model] || AI_PRICE_FALLBACK;
  const m = 1e6;
  return (row.in_tokens * p.in + row.out_tokens * p.out
    + row.cache_w_tokens * p.in * 1.25 + row.cache_r_tokens * p.in * 0.1) / m;
}

// Acumula el consumo de UNA llamada. Nunca lanza: el registro no puede tumbar una
// respuesta al cliente. UPSERT para no crear una fila por llamada.
async function recordAiUsage(env, tenant, model, usage) {
  if (!env.DB || !usage) return;
  const day = new Date().toISOString().slice(0, 10);
  try {
    await env.DB.prepare(`INSERT INTO ai_usage (tenant_id,day,model,calls,in_tokens,out_tokens,cache_w_tokens,cache_r_tokens,updated_at)
      VALUES (?,?,?,1,?,?,?,?,?)
      ON CONFLICT(tenant_id,day,model) DO UPDATE SET calls=calls+1, in_tokens=in_tokens+excluded.in_tokens,
        out_tokens=out_tokens+excluded.out_tokens, cache_w_tokens=cache_w_tokens+excluded.cache_w_tokens,
        cache_r_tokens=cache_r_tokens+excluded.cache_r_tokens, updated_at=excluded.updated_at`)
      .bind((tenant && tenant.id) || '', day, String(model || 'desconocido'),
        usage.input_tokens || 0, usage.output_tokens || 0,
        usage.cache_creation_input_tokens || 0, usage.cache_read_input_tokens || 0,
        new Date().toISOString()).run();
  } catch (error) {
    console.log(JSON.stringify({ level: 'warn', code: 'ai_usage_not_recorded', error: clean(String(error.message || error), 60) }));
  }
}

async function callAnthropicRaw(env, payload, options = {}) {
  const { retries = 1, timeoutMs = 15000, tenant = null } = options;
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'ai_not_configured');
  await aiBudgetGuard(env, tenant);
  // Caché de prompt (CONTEXTOS-AMPLIOS fase 1): el system es estable por tenant y se
  // reenvía EN CADA turno — con cache_control la relectura cuesta 0,1x desde el segundo
  // mensaje de la conversación (escritura 1,25x, TTL 5 min). Por debajo del mínimo
  // cacheable (1.024 tokens en Sonnet) la API lo ignora sin coste. El bloque debe ser
  // idéntico byte a byte: nada variable (fechas, nombres) puede entrar en el system.
  const body = { ...payload };
  // Un system en array llega YA en bloques (calendario: [estable cacheado, volátil
  // con la fecha]) y no se toca; el string simple se envuelve como siempre.
  if (typeof body.system === 'string' && body.system) {
    body.system = [{ type: 'text', text: body.system, cache_control: { type: 'ephemeral' } }];
  }
  let response;
  for (let attempt = 0; attempt <= retries; attempt++) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt >= retries) break;
  }
  if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, 'ai_unavailable');
  const data = await response.json();
  // Contadores del caché al log (sin PII): si cache_w y cache_r son siempre 0, el
  // caché NO está acertando — y la API no avisa. Verificable en Workers Logs.
  if (data.usage) {
    console.log(JSON.stringify({ level: 'info', code: 'ai_usage', in: data.usage.input_tokens || 0, out: data.usage.output_tokens || 0, cache_w: data.usage.cache_creation_input_tokens || 0, cache_r: data.usage.cache_read_input_tokens || 0 }));
    // …y ADEMÁS a D1 por cliente: el log se pierde y no se puede sumar.
    await recordAiUsage(env, tenant, payload.model, data.usage);
  }
  return data;
}

// Un corte por max_tokens deja la frase a medias («…te recomiendo que») y eso llega tal
// cual al cliente final del cliente. Se recorta a la última frase COMPLETA: mejor una
// respuesta que acaba antes que una que acaba a mitad de palabra.
// El guarda de 40 evita dejar un fragmento inútil cuando se cortó muy pronto: ahí es menos
// malo mandar la frase incompleta que un saludo suelto.
function trimToSentence(text) {
  const value = String(text || '').trimEnd();
  for (let i = value.length - 1; i > 40; i--) {
    if ('.!?…'.includes(value[i])) return value.slice(0, i + 1);
  }
  return value;
}

// Truncado por max_tokens: hasta ahora era INVISIBLE — stop_reason solo se miraba para
// tool_use, así que una respuesta cortada salía al cliente y no quedaba rastro en ninguna
// parte. Se registra con el cliente y el modelo para poder subir el tope donde haga falta.
// Cierre de emergencia cuando la respuesta se cortó IGUAL. Nadie se queda a mitad de una
// conversación: se recorta a la última frase completa y se cierra ofreciendo el siguiente
// paso. Es la ÚLTIMA red — la primera es la regla «ESPACIO Y CIERRE» de GUARDRAILS, que le
// pide al modelo resumir y cerrar ANTES de agotar el espacio.
// En español fijo: todos los negocios atendidos hoy son de mercado español y sus prompts
// están en español. Si algún día hay un tenant que atienda en otro idioma se verá en
// `reply_truncated` y tocará hacerlo por tenant.
const TRUNCATED_CLOSING = {
  cita: '\n\nTe lo cuento entero y sin dejarme nada: ¿te agendo una cita?',
  equipo: '\n\nQueda algún detalle que conviene ver contigo: ¿quieres que el equipo te escriba para contártelo completo?',
};

function settleReply(data, options, raw) {
  if (data.stop_reason !== 'max_tokens') return raw;
  console.log(JSON.stringify({ level: 'warn', code: 'reply_truncated',
    tenant: (options.tenant && options.tenant.slug) || null, model: data.model || null, chars: raw.length }));
  const closing = TRUNCATED_CLOSING[options.closing === 'cita' ? 'cita' : 'equipo'];
  // El presupuesto se descuenta ANTES de recortar: si el cierre se añadiera después, el
  // guarda del canal lo volvería a cortar y se comería justamente el cierre.
  const budget = (options.bodyLimit || 8000) - closing.length;
  return trimToSentence(String(raw).slice(0, Math.max(0, budget))) + closing;
}

async function callAnthropic(env, payload, options = {}) {
  const data = await callAnthropicRaw(env, payload, options);
  const reply = data.content?.[0]?.text;
  if (!reply) throw new HttpError(502, 'ai_invalid_response');
  return settleReply(data, options, reply);
}

function contentText(data) {
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

// ── Bucle de tool use (SPEC-CALENDARIO §3) ───────────────────────────────────
// Contrato de la Messages API blindado por tests: los tool_result de una vuelta
// van en UN SOLO mensaje user (cada uno con su tool_use_id) y el content del
// assistant se reenvía ENTERO. Cada vuelta pasa por aiBudgetGuard (cada una se
// factura). Un fallo del executor es tool_result con is_error, nunca rompe el bucle.
const MAX_TOOL_ITERATIONS = 3;
async function runToolLoop(env, payload, tools, executor, options = {}, first = null) {
  const messages = payload.messages.slice();
  let data = first;
  for (let round = 0; ; round++) {
    if (!data) data = await callAnthropicRaw(env, { ...payload, messages, tools }, options);
    const toolUses = (data.content || []).filter((b) => b.type === 'tool_use');
    if (data.stop_reason !== 'tool_use' || !toolUses.length) return settleReply(data, options, contentText(data));
    if (round >= MAX_TOOL_ITERATIONS) {
      console.log(JSON.stringify({ level: 'warn', code: 'tool_loop_overflow', rounds: round }));
      return null; // el llamador pone la disculpa del canal
    }
    const results = [];
    for (const use of toolUses) {
      try {
        results.push({ type: 'tool_result', tool_use_id: use.id, content: String(await executor(use.name, use.input || {})) });
      } catch (error) {
        // El proveedor caído no debe tumbar la conversación: el modelo se disculpa.
        console.log(JSON.stringify({ level: 'error', code: 'calendar_tool_failed', tool: use.name, error: clean(error.message, 60) }));
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify({ error: 'herramienta_no_disponible' }), is_error: true });
      }
    }
    messages.push({ role: 'assistant', content: data.content });
    messages.push({ role: 'user', content: results });
    data = null;
  }
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
// 30 min: CUALQUIER edición desde el panel invalida estas claves al instante
// (invalidateTenantCache), así que el TTL solo cubre cambios hechos por SQL directo. Con
// 300 s se reescribía cada 5 minutos por clave y tenant — cientos de escrituras al día.
const TENANT_TTL = 1800;

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
  // tenant_channels permite N canales por cliente (0017); tenants.channel_address se
  // mantiene como fallback y fuente del canal primario. El SQL conserva el prefijo
  // histórico a propósito: los mocks de tests casan por startsWith.
  return tenantCached(env, `tenant:addr:${address}`, `SELECT * FROM tenants WHERE channel_address = ?1 AND active = 1
    UNION ALL SELECT t.* FROM tenants t JOIN tenant_channels c ON c.tenant_id = t.id WHERE c.address = ?1 AND t.active = 1
    LIMIT 1`, address);
}

// El canal es la llave que enruta TODOS los mensajes entrantes del cliente: antes de
// escribirlo hay que saber que no desviaría las conversaciones de otro.
async function assertChannelFree(env, address, tenantId) {
  if (!/^(whatsapp|messenger):/.test(String(address || ''))) return;
  const row = await env.DB.prepare('SELECT tenant_id FROM tenant_channels WHERE address=?').bind(address).first();
  if (row && row.tenant_id !== tenantId) throw new HttpError(409, 'address_taken');
}

// Mantiene tenant_channels como espejo del canal primario (tenants.channel_address).
// Secuencial y tolerante: si el INSERT fallara a mitad, el enrutado sigue vivo por el
// fallback a channel_address — la tabla nunca es un punto único de fallo.
async function syncPrimaryChannel(env, tenantId, previousAddress, newAddress) {
  const kindOf = (a) => { const m = /^(whatsapp|messenger):/.exec(String(a || '')); return m ? m[1] : null; };
  const oldKind = kindOf(previousAddress);
  const newKind = kindOf(newAddress);
  if (oldKind) await env.DB.prepare('DELETE FROM tenant_channels WHERE address=? AND tenant_id=?').bind(previousAddress, tenantId).run();
  if (!newKind) return;
  await env.DB.prepare('DELETE FROM tenant_channels WHERE tenant_id=? AND kind=?').bind(tenantId, newKind).run();
  try {
    await env.DB.prepare('INSERT INTO tenant_channels (address,tenant_id,kind,created_at) VALUES (?,?,?,?)')
      .bind(newAddress, tenantId, newKind, new Date().toISOString()).run();
  } catch (error) { throw tenantWriteError(error); }
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
// Twilio rechaza con 63031 cuando From y To son el MISMO número: si team_whatsapp
// incluye el número del bot, TODOS los avisos de ese cliente caen en silencio
// (5 reintentos → failed, sin error legible). El agujero es de la FILA, no de un
// formulario: la guarda corre en el PATCH general Y en el endpoint de autoservicio.
function assertTeamNotFrom(fields, previous) {
  const from = String(fields.twilio_from ?? previous.twilio_from ?? '');
  const list = String(fields.team_whatsapp ?? previous.team_whatsapp ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (from && list.includes(from)) throw new HttpError(400, 'team_whatsapp_equals_from');
}
const TEMPLATE_RE = /^HX[0-9a-f]{32}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const CHAT_ID_RE = /^-?\d{5,20}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;
// El mínimo de 50 evita que un guardado accidental con el campo casi vacío deje
// al bot de un cliente sin contexto contestando cualquier cosa.
const PROMPT_MIN = 50, PROMPT_MAX = 20000;
// Marca del widget (migración 0007): el chat en la web de un cliente lleva SU marca.
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
// Orígenes web del tenant (migración 0008): https, sin path ni barra final.
const ORIGIN_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const WA_DIGITS_RE = /^[1-9]\d{5,14}$/;
const THEMES = new Set(['auto', 'light', 'dark']);

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
  if (has('bot_name')) out.bot_name = clean(body.bot_name, 40) || null;
  if (has('brand_name')) out.brand_name = clean(body.brand_name, 80) || null;
  if (has('logo_url')) {
    out.logo_url = clean(body.logo_url, 300) || null;
    // https obligatorio: un logo por http rompería las webs de los clientes (mixed content).
    if (out.logo_url && !/^https:\/\/[^\s]+$/i.test(out.logo_url)) bad('logo_url');
  }
  if (has('agent_color')) {
    const raw = clean(body.agent_color, 10);
    if (!raw) out.agent_color = null;
    else if (!HEX_COLOR_RE.test(raw)) bad('agent_color');
    else out.agent_color = raw;
  }
  if (has('brand_color')) {
    out.brand_color = clean(body.brand_color, 10) || null;
    if (out.brand_color && !HEX_COLOR_RE.test(out.brand_color)) bad('brand_color');
  }
  if (has('brand_color_2')) {
    out.brand_color_2 = clean(body.brand_color_2, 10) || null;
    if (out.brand_color_2 && !HEX_COLOR_RE.test(out.brand_color_2)) bad('brand_color_2');
  }
  if (has('greeting')) out.greeting = clean(body.greeting, 300) || null;
  if (has('greeting_en')) out.greeting_en = clean(body.greeting_en, 300) || null;
  if (has('chips_json')) {
    // Acepta array o JSON string; se guarda normalizado. Máximo 3 chips de 60 car.
    let chips = body.chips_json;
    if (typeof chips === 'string' && chips.trim()) { try { chips = JSON.parse(chips); } catch (_) { bad('chips_json'); } }
    if (chips == null || (typeof chips === 'string' && !chips.trim()) || (Array.isArray(chips) && !chips.length)) out.chips_json = null;
    else {
      if (!Array.isArray(chips) || chips.length > 3 || chips.some((c) => typeof c !== 'string' || !c.trim() || c.length > 60)) bad('chips_json');
      out.chips_json = JSON.stringify(chips.map((c) => c.trim()));
    }
  }
  if (has('placeholder')) out.placeholder = clean(body.placeholder, 60) || null;
  if (has('wa_number')) {
    out.wa_number = clean(body.wa_number, 20).replace(/\D/g, '') || null;
    if (out.wa_number && !WA_DIGITS_RE.test(out.wa_number)) bad('wa_number');
  }
  if (has('theme')) {
    out.theme = clean(body.theme, 10) || null;
    if (out.theme && !THEMES.has(out.theme)) bad('theme');
  }
  if (has('web_origins')) {
    // Acepta array o JSON string; normaliza (minúsculas, sin barra final) y guarda
    // JSON. Máximo 6 por tenant. Estos orígenes entran en la allowlist de CORS y en
    // el cruce de hostname de Turnstile: solo https y sin path.
    let origins = body.web_origins;
    if (typeof origins === 'string' && origins.trim()) { try { origins = JSON.parse(origins); } catch (_) { bad('web_origins'); } }
    if (origins == null || (typeof origins === 'string' && !origins.trim()) || (Array.isArray(origins) && !origins.length)) out.web_origins = null;
    else {
      if (!Array.isArray(origins) || origins.length > 6) bad('web_origins');
      const normalized = origins.map((o) => String(o).trim().toLowerCase().replace(/\/$/, ''));
      if (normalized.some((o) => !ORIGIN_RE.test(o))) bad('web_origins');
      out.web_origins = JSON.stringify([...new Set(normalized)]);
    }
  }
  if (has('active')) out.active = body.active ? 1 : 0;
  if (has('weekly_report')) out.weekly_report = body.weekly_report ? 1 : 0;
  // Saldo mensual de tokens del plan (contador, no corta) y cupo diario de llamadas
  // (guarda anti-abuso, sí corta). Vacío = NULL = el default del toml, para no tener que
  // tocar seis filas cuando cambie el plan estándar.
  // Horario de atención HUMANA. Llega como texto desde el textarea de la ficha (misma
  // convención que el horario del calendario) y se valida con las mismas reglas: si entra
  // basura, la interacción humana quedaría abierta o cerrada a lo loco.
  if (has('support_tz')) out.support_tz = clean(body.support_tz, 60) || null;
  if (has('support_hours')) {
    const raw = String(body.support_hours ?? '').trim();
    if (!raw) out.support_hours = null;
    else {
      let table = null;
      try { table = JSON.parse(raw); } catch (_) { bad('support_hours'); }
      if (table !== null) {
        if (!table || typeof table !== 'object' || Array.isArray(table)) bad('support_hours');
        else {
          const DIAS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
          let malo = false;
          for (const [day, windows] of Object.entries(table)) {
            if (!DIAS.includes(day) || !Array.isArray(windows) || windows.length > 4) { malo = true; break; }
            for (const w of windows) {
              if (!Array.isArray(w) || w.length !== 2 || !HHMM_RE.test(w[0]) || !HHMM_RE.test(w[1]) || w[0] >= w[1]) { malo = true; break; }
            }
            if (malo) break;
          }
          if (malo) bad('support_hours'); else out.support_hours = JSON.stringify(table);
        }
      }
    }
  }
  for (const [field, min, max] of [['ai_monthly_tokens', 10000, 1e10], ['ai_daily_limit', 1, 100000]]) {
    if (!has(field)) continue;
    const raw = String(body[field] ?? '').trim();
    if (!raw) { out[field] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) bad(field);
    else out[field] = Math.floor(n);
  }
  return out;
}

// ── Marca del widget: GET /widget/boot?tenant=<slug> ─────────────────────────
// Endpoint PÚBLICO de solo lectura: devuelve la marca del tenant (nunca nada sensible)
// para que el widget en la web del cliente pinte su logo, nombre, saludo y colores.
// Devuelve null en lo no configurado y el WIDGET aplica sus defaults de Velai: así
// hirevai.com (fila velai sin marca) queda idéntico byte a byte. La caché es la misma
// fila que tenantBySlug (KV 5 min) y se invalida con invalidateTenantCache.
// Almacén de medios (logos de marca). R2 es el sitio natural, pero exige activarlo una
// vez en el dashboard (error 10042 si no): mientras no esté, los logos viven en KV, que
// admite valores de hasta 25 MB y ya está enlazado. En cuanto exista el binding MEDIA,
// las subidas NUEVAS van a R2 y las viejas se siguen sirviendo desde KV.
const MEDIA_KEY_RE = /^[a-z0-9][a-z0-9/_.-]{0,120}$/i;

async function mediaPut(env, key, bytes, contentType) {
  if (env.MEDIA) { await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } }); return 'r2'; }
  if (!env.KV) throw new HttpError(503, 'media_not_configured');
  await env.KV.put(`media:${key}`, bytes, { metadata: { contentType } });
  return 'kv';
}

async function mediaGet(env, key) {
  if (env.MEDIA) {
    const obj = await env.MEDIA.get(key);
    if (obj) return { body: obj.body, contentType: (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream', etag: obj.httpEtag };
  }
  if (!env.KV) return null;
  const hit = await env.KV.getWithMetadata(`media:${key}`, 'arrayBuffer');
  if (!hit || !hit.value) return null;
  return { body: hit.value, contentType: (hit.metadata && hit.metadata.contentType) || 'application/octet-stream', etag: null };
}

async function handleWidgetBoot(request, env, url) {
  const origin = request.headers.get('Origin') || '';
  // GET simple: el navegador no hace preflight, pero el Allow-Origin es obligatorio.
  const cors = origin && (await allowedOrigins(env)).includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  const slug = clean(url.searchParams.get('tenant'), 40) || defaultTenantSlug(env);
  const tenant = await tenantBySlug(env, slug);
  // Un slug desconocido no cae a la marca de Velai: pintaría la marca equivocada en la
  // web de un cliente con el snippet mal puesto — mejor que el error se vea en consola.
  if (!tenant) throw new HttpError(404, 'invalid_tenant');
  let chips = null;
  if (tenant.chips_json) { try { const p = JSON.parse(tenant.chips_json); if (Array.isArray(p) && p.length) chips = p.slice(0, 3).map(String); } catch (_) {} }
  return json({
    bot_name: tenant.bot_name || null,
    brand_name: tenant.brand_name || null,
    logo_url: tenant.logo_url || null,
    brand_color: tenant.brand_color || null,
    // Acento de la burbuja del equipo. Vacío = el color de marca del cliente (nunca el
    // violeta por defecto para todos).
    agent_color: tenant.agent_color || null,
    brand_color_2: tenant.brand_color_2 || null,
    greeting: tenant.greeting || null,
    greeting_en: tenant.greeting_en || null,
    chips,
    placeholder: tenant.placeholder || null,
    wa_number: tenant.wa_number || null,
    theme: THEMES.has(tenant.theme) ? tenant.theme : 'auto',
  }, 200, { ...cors, 'Cache-Control': 'public, max-age=300' });
}

// ── Ajustes cifrados en D1 (tabla settings, migración 0010) ──────────────────
// Hoy solo 'cf_api_token': el token de API de Cloudflare rotable desde el panel
// (solo admins raíz). El valor del panel tiene PRIORIDAD sobre el secret del worker
// (withCfToken); el secret queda como respaldo raíz.
async function getSetting(env, key) {
  try {
    const row = await env.DB.prepare('SELECT value_enc FROM settings WHERE key=?').bind(key).first();
    if (!row) return null;
    const out = await decryptSecret(env, `setting:${key}`, row.value_enc);
    return out ? out.value : null;
  } catch (_) { return null; }
}

async function setSetting(env, key, value, actor) {
  const enc = await encryptSecret(env, `setting:${key}`, value);
  await env.DB.prepare(`INSERT INTO settings (key, value_enc, updated_by, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_enc=excluded.value_enc, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .bind(key, enc, actor, new Date().toISOString()).run();
}

async function withCfToken(env) {
  const stored = await getSetting(env, 'cf_api_token');
  return stored ? { ...env, CF_API_TOKEN: stored } : env;
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
// Los canales de un cliente, LEÍDOS de donde de verdad viven: la ficha ya no los
// declara en una caja de texto. Web entra por slug y no tiene dirección que enrutar;
// whatsapp y messenger viven en tenant_channels (con el canal primario como respaldo
// histórico); telegram en su propia columna. Un solo sitio que conteste «qué canales
// tiene este cliente» y que no pueda discrepar del enrutado real.
// Lo que se le CUENTA al cliente sobre sus canales, en un solo sitio testeable. Los
// estados de diagnóstico (sin enrutar, cliente inactivo) no viajan a su espacio: si su
// WhatsApp no está enrutado eso es trabajo pendiente NUESTRO, no un problema que él pueda
// accionar — se le dice que lo estamos dejando listo, no «404 unknown_tenant». Velai, en
// la misma vista, sigue viendo el estado crudo: ahí el diagnóstico sí sirve.
const CLIENT_STATE = { live: 'on', inactive: 'paused', unrouted: 'preparing', off: 'off' };
function channelsForScope(scope, channels) {
  if (scope.role === 'velai') return channels;
  return channels.map((c) => ({ ...c, state: CLIENT_STATE[c.state] || 'off' }));
}

async function tenantChannelSummary(env, tenant) {
  const rows = (await env.DB.prepare('SELECT address, kind FROM tenant_channels WHERE tenant_id=?').bind(tenant.id).all()).results || [];
  const byKind = {};
  for (const r of rows) byKind[r.kind] = r.address;
  const primary = /^(whatsapp|messenger):/.exec(String(tenant.channel_address || ''));
  if (primary && !byKind[primary[1]]) byKind[primary[1]] = tenant.channel_address; // enruta por el fallback
  const off = (kind) => ({ kind, address: null, state: 'off' });
  const on = (kind, address) => ({ kind, address, state: tenant.active ? 'live' : 'inactive' });
  // Direcciones LEGIBLES: el dominio del cliente en vez del slug y el nombre del grupo en
  // vez del chat_id. Un `-100123456789` no le dice nada a nadie, y menos al cliente.
  let web = tenant.slug;
  try { const o = JSON.parse(tenant.web_origins || '[]'); if (o.length) web = new URL(o[0]).hostname.replace(/^www\./, ''); } catch (_) {}
  const channels = [{ kind: 'web', address: web, state: tenant.active ? 'live' : 'inactive' }];
  // `unrouted` es el caso gogestion: sender propio en Twilio y ninguna fila que lo
  // enrute. Aquí se ve en la ficha, no solo en la vista global de Canales.
  if (byKind.whatsapp) channels.push(on('whatsapp', byKind.whatsapp));
  else if (tenant.sender_sid && tenant.twilio_from) channels.push({ kind: 'whatsapp', address: tenant.twilio_from, state: 'unrouted' });
  else channels.push(off('whatsapp'));
  channels.push(tenant.telegram_chat_id ? on('telegram', tenant.telegram_chat_title || String(tenant.telegram_chat_id)) : off('telegram'));
  channels.push(byKind.messenger ? on('messenger', byKind.messenger) : off('messenger'));
  return channels;
}

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
  if (/UNIQUE.*tenant_channels/i.test(msg)) return new HttpError(409, 'address_taken');
  if (/UNIQUE.*twilio_subaccount_sid/i.test(msg)) return new HttpError(409, 'subaccount_taken');
  return error;
}

// La caché KV guarda la fila COMPLETA del tenant: CUALQUIER edición (también el
// prompt) debe invalidar, y al cambiar dirección o slug hay que borrar las claves
// viejas Y las nuevas. También tras un alta: los fallos de lookup se cachean.
async function invalidateTenantCache(env, tenants) {
  if (!env.KV) return;
  // 'origins:all' cae con CUALQUIER edición: activar/desactivar un tenant o tocar sus
  // web_origins cambia la allowlist de CORS y no puede esperar 5 minutos.
  const keys = new Set(['origins:all']);
  const ids = [];
  for (const t of tenants) {
    if (!t) continue;
    if (t.channel_address) keys.add(`tenant:addr:${t.channel_address}`);
    if (t.slug) keys.add(`tenant:slug:${t.slug}`);
    if (t.id) { keys.add(`calcfg:${t.id}`); ids.push(t.id); } // la config de calendario se cachea aparte
  }
  // channel_address es UNO; el enrutado real vive en tenant_channels (N por cliente) y
  // tenantByAddress cachea CADA dirección — el fallo incluido (objeto vacío, 5 min). Sin
  // barrer esas claves, registrar un canal nuevo deja al bot mudo hasta que el negativo
  // caduque, y editar la ficha deja atendiendo a la versión vieja por WhatsApp.
  if (ids.length && env.DB) {
    try {
      const rows = (await env.DB.prepare(`SELECT address FROM tenant_channels WHERE tenant_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results || [];
      for (const r of rows) if (r.address) keys.add(`tenant:addr:${r.address}`);
    } catch (_) { /* la caché caduca sola en 5 min: no se rompe la escritura por esto */ }
  }
  await Promise.all([...keys].map((k) => env.KV.delete(k).catch(() => {})));
}

// ── Telegram en autoservicio (SPEC-CONEXIONES PR1) ───────────────────────────
// El cliente pulsa su enlace t.me con un token de un solo uso, Telegram nos entrega
// el /start por webhook, y la fila del tenant queda vinculada a SU chat sin que
// nadie transcriba un chat id a mano.

// Comparación en tiempo constante para el secreto del webhook (mismo principio que
// la firma de Twilio): longitudes desiguales salen rápido, el resto no filtra bytes.
function timingSafeEqual(a, b) {
  const x = String(a); const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// Token del bot PROPIO del tenant (marca blanca). null = usa el bot de Velai.
// Un token indescifrable se loguea y devuelve null: el aviso saldrá por el bot de
// Velai y, si ese bot no está en el chat del cliente, el ledger lo mostrará failed
// — visible, nunca un silencio.
async function tenantTelegramToken(env, tenant) {
  if (!tenant || !tenant.telegram_bot_token_enc) return null;
  try {
    const out = await decryptSecret(env, `telegram:${tenant.id}`, tenant.telegram_bot_token_enc);
    return out ? out.value : null;
  } catch (_) {
    console.log(JSON.stringify({ level: 'error', code: 'telegram_bot_undecryptable', tenant: tenant.slug || tenant.id }));
    return null;
  }
}

const TELEGRAM_BOT_TOKEN_RE = /^\d{5,12}:[A-Za-z0-9_-]{25,60}$/;

// Registra (o retira) el webhook de UN bot apuntando al worker, con el secreto
// compartido: todos los bots (el de Velai y los de marca blanca) entran por el
// mismo endpoint — el token de /start ya identifica al tenant.
// Telegram solo admite A-Z a-z 0-9 _ - en secret_token (1-256). Un secreto generado con
// `openssl rand -base64 32` trae +, / y = y Telegram rechaza el setWebhook ENTERO con un
// 400 genérico. Se comprueba aquí para poder decirlo con esas palabras en vez de dejar
// al cliente con un "reintenta" que no arregla nada por muchas veces que lo pulse.
const TELEGRAM_SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;

// Registra (o retira) el webhook de UN bot. Devuelve el motivo cuando falla: el
// `description` de Telegram es lo único que distingue un token malo de un secreto con
// caracteres prohibidos o de un tope de peticiones, y antes se tiraba a la basura.
async function telegramSetWebhook(env, botToken) {
  if (!TELEGRAM_SECRET_RE.test(String(env.TELEGRAM_WEBHOOK_SECRET || ''))) {
    return { ok: false, code: 'webhook_secret_invalid', why: 'TELEGRAM_WEBHOOK_SECRET tiene caracteres que Telegram no admite (solo A-Z a-z 0-9 _ -)' };
  }
  let response; let data = {};
  try {
    response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ url: `${WORKER_PUBLIC_URL}/telegram/webhook`, secret_token: env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'] }),
      signal: AbortSignal.timeout(8000),
    });
    data = await response.json().catch(() => ({}));
  } catch (error) {
    return { ok: false, code: 'telegram_setup_failed', why: `red: ${String(error.message || error).slice(0, 80)}` };
  }
  if (response.ok && data.ok) return { ok: true };
  const why = clean(data.description, 200) || `HTTP ${response.status}`;
  const lower = why.toLowerCase();
  // Traducción a códigos accionables, mismo criterio que los Temas del grupo (§Telegram):
  // el cliente tiene que saber si el problema es SU token o nuestra configuración.
  let code = 'telegram_setup_failed';
  if (lower.includes('secret_token')) code = 'webhook_secret_invalid';
  else if (data.error_code === 401 || lower.includes('unauthorized')) code = 'invalid_bot_token';
  else if (data.error_code === 429 || lower.includes('too many requests')) code = 'telegram_rate_limited';
  else if (lower.includes('url') || lower.includes('https')) code = 'webhook_url_invalid';
  return { ok: false, code, why };
}

// Diagnóstico del webhook, de SOLO LECTURA. Existe porque la alternativa para saber por
// qué no llegan los /start era `getUpdates`, y eso NO se puede usar con un webhook activo:
// Telegram responde 409 «can't use getUpdates method while webhook is active» — las dos
// vías de entrega son excluyentes para que un mensaje no se entregue dos veces. Volver a
// getUpdates exigiría un deleteWebhook, que deja a TODOS los clientes sin poder vincular.
// getWebhookInfo no toca nada y trae lo único que hacía falta: last_error_message, o sea
// qué falló en el último intento de entrega. No devuelve el secret_token.
async function telegramWebhookInfo(env) {
  if (!env.TELEGRAM_TOKEN) return { configured: false };
  let data;
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getWebhookInfo`, { signal: AbortSignal.timeout(8000) });
    data = await response.json();
  } catch (error) { return { configured: true, error: `red: ${String(error.message || error).slice(0, 80)}` }; }
  if (!data || !data.ok) return { configured: true, error: clean(data && data.description, 200) || 'telegram_error' };
  const r = data.result || {};
  const esperada = `${WORKER_PUBLIC_URL}/telegram/webhook`;
  return {
    configured: true,
    url: clean(r.url, 200) || null,
    esperada,
    // La comprobación que de verdad importa: un webhook apuntando a otro sitio es un
    // webhook «activo» que no nos entrega nada, y desde fuera se ve idéntico a uno sano.
    coincide: r.url === esperada,
    pendientes: Number(r.pending_update_count) || 0,
    ultimoError: r.last_error_message
      ? { mensaje: clean(r.last_error_message, 200), cuando: r.last_error_date ? new Date(r.last_error_date * 1000).toISOString() : null }
      : null,
    maxConexiones: Number(r.max_connections) || null,
    ip: clean(r.ip_address, 60) || null,
  };
}

// Usuario del bot (para construir los enlaces t.me): se descubre con getMe y se
// cachea en KV — sin variable nueva que pueda quedar desincronizada del token.
async function telegramBotUsername(env) {
  if (!env.TELEGRAM_TOKEN) return null;
  if (env.KV) { try { const cached = await env.KV.get('tg:botuser'); if (cached) return cached; } catch (_) {} }
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/getMe`, { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    const username = (data && data.ok && data.result && clean(data.result.username, 64)) || null;
    if (username && env.KV) { try { await env.KV.put('tg:botuser', username, { expirationTtl: 86400 }); } catch (_) {} }
    return username;
  } catch (_) { return null; }
}

// Alta/actualización de un Tema del grupo vinculado. El nombre lo pone EL CLIENTE
// en su Telegram; aquí solo se registra el mapa tema→hilo para clasificar avisos.
async function registerTelegramTopic(env, ctx, chatId, threadId, name) {
  if (!threadId || !name) return json({ ok: true }, 200, NO_STORE);
  const tenant = await env.DB.prepare('SELECT id, slug, name, channel_address, telegram_topics, telegram_bot_token_enc, telegram_whitelabel FROM tenants WHERE telegram_chat_id = ?').bind(chatId).first();
  if (!tenant) return json({ ok: true }, 200, NO_STORE);
  // Los Temas son parte del paquete de marca blanca (decisión de Juan 2026-08-22):
  // sin el flag, el tema del grupo se ignora — nada se registra ni clasifica.
  if (!tenant.telegram_whitelabel) {
    console.log(JSON.stringify({ level: 'info', code: 'telegram_topic_ignored', tenant: tenant.slug }));
    return json({ ok: true }, 200, NO_STORE);
  }
  let topics = [];
  try { topics = JSON.parse(tenant.telegram_topics || '[]'); } catch (_) {}
  if (!Array.isArray(topics)) topics = [];
  const existing = topics.find((t) => t && String(t.thread_id) === String(threadId));
  if (existing) existing.name = name; else topics.push({ thread_id: Number(threadId), name });
  topics = topics.slice(0, 25); // tope defensivo: nadie clasifica contra 200 temas
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE tenants SET telegram_topics=?, updated_at=? WHERE id=?').bind(JSON.stringify(topics), now, tenant.id).run();
  await invalidateTenantCache(env, [tenant]);
  console.log(JSON.stringify({ level: 'info', code: 'telegram_topic_registered', tenant: tenant.slug, topics: topics.length }));
  if (!existing) {
    const botToken = await tenantTelegramToken(env, tenant);
    ctx.waitUntil(sendTelegramText(env, `📌 Tema registrado: los leads que encajen con «${escapeHtml(name)}» llegarán aquí.`, chatId, { botToken, threadId }).catch(() => {}));
  }
  return json({ ok: true }, 200, NO_STORE);
}

// Crea un Tema en el grupo del cliente DESDE el panel (pedido de Juan: nombre +
// descripción definidos en nuestra plataforma). Requiere que el grupo tenga Temas
// activados y que el bot sea admin con «Gestionar temas» — los dos fallos típicos
// se traducen a códigos que el panel explica.
async function createTelegramTopic(env, tenant, chatId, name) {
  const botToken = (await tenantTelegramToken(env, tenant)) || env.TELEGRAM_TOKEN;
  if (!botToken) throw new HttpError(503, 'telegram_not_configured');
  const response = await fetch(`https://api.telegram.org/bot${botToken}/createForumTopic`, {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ chat_id: chatId, name }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !data.result || !data.result.message_thread_id) {
    const why = String(data.description || '').toLowerCase();
    if (why.includes('forum')) throw new HttpError(400, 'group_sin_temas');
    if (why.includes('rights') || why.includes('administrator')) throw new HttpError(400, 'bot_sin_permisos');
    throw new HttpError(502, 'telegram_topic_failed');
  }
  return { threadId: data.result.message_thread_id, botToken };
}

// Clasifica el lead en uno de los Temas que el cliente creó en su grupo. Estricto:
// el modelo responde el nombre EXACTO de un tema o GENERAL, y ante cualquier duda
// o fallo la respuesta es null (chat General) — un aviso jamás se pierde por esto.
async function telegramThreadFor(env, tenant, lead) {
  if (!tenant.telegram_whitelabel) return null; // Temas = marca blanca
  let topics = [];
  try { topics = JSON.parse(tenant.telegram_topics || '[]'); } catch (_) {}
  topics = Array.isArray(topics) ? topics.filter((t) => t && t.thread_id && t.name) : [];
  if (!topics.length) return null;
  try {
    const reply = await callAnthropic(env, {
      model: 'claude-haiku-4-5-20251001', max_tokens: 20,
      // La DESCRIPCIÓN del tema (escrita por el cliente en el panel) es la señal
      // principal del enrutado; el nombre solo es la etiqueta de respuesta.
      system: `Clasifica el lead en UNO de estos temas de Telegram definidos por el negocio y responde SOLO con el nombre exacto del tema, sin nada más. Si ninguno encaja claramente, responde GENERAL.\nTemas:\n${topics.map((t) => `- «${t.name}»${t.description ? `: ${t.description}` : ''}`).join('\n')}`,
      messages: [{ role: 'user', content: JSON.stringify({ fuente: lead.source, sector: lead.sector, necesidad: lead.need, contexto: lead.context, nota: lead.note }) }],
    }, { tenant, retries: 0, timeoutMs: 8000 });
    const pick = String(reply).trim().toLowerCase();
    const hit = topics.find((t) => String(t.name).trim().toLowerCase() === pick);
    return hit ? hit.thread_id : null;
  } catch (_) { return null; }
}

async function handleTelegramWebhook(request, env, ctx) {
  const update = await readJson(request, 16000).catch(() => null);
  const message = update && update.message;
  const text = clean(message && message.text, 200);
  const chatOk = message && message.chat && message.chat.id !== undefined;
  const threadId = (chatOk && message.message_thread_id) || null;
  // 1) El cliente creó o renombró un Tema en su grupo: Telegram lo cuenta con un
  //    mensaje de servicio — se registra solo, sin que nadie copie nada.
  const topicEvent = message && (message.forum_topic_created || message.forum_topic_edited);
  if (topicEvent && chatOk) {
    return registerTelegramTopic(env, ctx, String(message.chat.id), threadId, clean(topicEvent.name, 64));
  }
  // 2) '/tema' DENTRO de un tema que ya existía antes de añadir el bot: el mensaje
  //    trae el hilo y (vía reply_to_message) el nombre del tema.
  if (chatOk && threadId && /^\/tema(?:@\w+)?\s*$/i.test(text)) {
    const topicName = clean(message.reply_to_message && message.reply_to_message.forum_topic_created && message.reply_to_message.forum_topic_created.name, 64);
    return registerTelegramTopic(env, ctx, String(message.chat.id), threadId, topicName);
  }
  // 3) Vinculación por token de un solo uso. En grupos el cliente llega como
  //    '/start@NombreDelBot <token>': aceptar ambas formas.
  const match = text.match(/^\/start(?:@\w+)?\s+([0-9a-f]{32})\b/i);
  if (!match || !message.chat || message.chat.id === undefined) return json({ ok: true }, 200, NO_STORE);
  const token = match[1].toLowerCase();
  let stored = null;
  try { stored = await env.KV.get(`tglink:${token}`, 'json'); } catch (_) {}
  if (!stored || !stored.tenantId) {
    // Nada al chat: un token caducado no debe confirmar que un cliente existe.
    console.log(JSON.stringify({ level: 'info', code: 'telegram_link_expired' }));
    return json({ ok: true }, 200, NO_STORE);
  }
  // Un solo uso: borrar ANTES de escribir — el reintento del mismo update no revincula.
  await env.KV.delete(`tglink:${token}`);
  const chatId = String(message.chat.id);
  if (!CHAT_ID_RE.test(chatId)) return json({ ok: true }, 200, NO_STORE);
  const title = clean(message.chat.title || message.chat.first_name, 100) || null;
  const row = await env.DB.prepare('SELECT id, slug, name, channel_address, telegram_bot_token_enc FROM tenants WHERE id=?').bind(stored.tenantId).first();
  if (!row) return json({ ok: true }, 200, NO_STORE);
  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE tenants SET telegram_chat_id=?, telegram_chat_title=?, telegram_linked_at=?, updated_at=? WHERE id=?')
    .bind(chatId, title, now, now, stored.tenantId).run();
  await invalidateTenantCache(env, [row]);
  console.log(JSON.stringify({ level: 'info', code: 'telegram_linked', tenant: row.slug }));
  ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
    .bind(stored.tenantId, stored.actor, 'telegram', null, `vinculado: ${title || 'chat'}`, now).run().catch(() => {}));
  // Confirmación al propio chat (el cliente ve que funcionó sin volver al panel),
  // desde SU bot si tiene marca blanca — es el bot que está dentro de ese chat…
  const ownBot = await tenantTelegramToken(env, row);
  ctx.waitUntil(sendTelegramText(env, `✅ Listo. Los avisos de leads de <b>${escapeHtml(row.name)}</b> llegarán a este chat.`, chatId, { botToken: ownBot }).catch(() => {}));
  // …y alerta operativa a Velai (aquí el respaldo global es correcto: es interna).
  ctx.waitUntil(sendTelegramText(env, `🔗 <b>${escapeHtml(row.name)}</b> vinculó su Telegram (${escapeHtml(title || chatId)}).`).catch(() => {}));
  return json({ ok: true }, 200, NO_STORE);
}

// ── Handoff a humano (SPEC-HANDOFF §A) ───────────────────────────────────────
// El modelo termina con [[HUMANO]] SOLO cuando la persona pide hablar con alguien
// del equipo (instrucción en GUARDRAILS). El centinela se quita SIEMPRE del texto:
// jamás debe llegar al cliente final.
const WANTS_HUMAN = /\[\[HUMANO\]\]/;
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// Pausa por tenant + cliente final (nunca global): crear la clave ES el antirebote —
// con el bot pausado no hay modelo, no hay centinela y no hay aviso repetido.
// TTL 4 h: si nadie atendió, mejor que el bot vuelva a un silencio indefinido.
// Antes esto pausaba el bot 4 h SIEMPRE, aunque no hubiera nadie para contestar: si el
// aviso llegaba de noche, el cliente final se quedaba en silencio cuatro horas justo
// después de pedir ayuda. Ahora solo se cede el turno si de verdad hay alguien.
// Devuelve si escaló, porque el que llama tiene que capturar el lead si no.
async function escalateToHuman(env, tenant, from, lastMessage, convId = null, options = {}) {
  if (!options.assumeAvailable && !(await advisorAvailable(env, tenant))) {
    console.log(JSON.stringify({ level: 'info', code: 'handoff_declined', tenant: tenant.slug }));
    return false;
  }
  // La pausa de KV se mantiene EN PARALELO al estado nuevo a propósito: es la que ya
  // gobierna la guarda del webhook y la vista de Escalaciones. Si el estado nuevo se
  // comportara mal, el fallo es «el bot se queda callado», nunca «el bot habla por encima
  // de una persona» — y de eso se sale con el botón Reanudar de siempre.
  // En el canal web manda el ESTADO, no la clave de KV: la guarda de handleChat mira
  // conv.state, y una escritura de KV por escalada es justo lo que no sobra.
  if (env.KV && !options.stateOnly) { try { await env.KV.put(`pause:${tenant.id}:${from}`, '1', { expirationTtl: 4 * 3600 }); } catch (_) {} }
  if (convId && env.DB) {
    try {
      await env.DB.prepare("UPDATE conversations SET state='esperando', state_at=?, agent_email=NULL WHERE id=? AND state='bot'")
        .bind(new Date().toISOString(), convId).run();
    } catch (error) {
      console.log(JSON.stringify({ level: 'error', code: 'handoff_state_failed', tenant: tenant.slug, error: clean(String(error.message || error), 60) }));
    }
  }
  await sendTelegramText(env, `🙋 <b>Handoff</b> — <b>${escapeHtml(tenant.name)}</b>: <code>${escapeHtml(from)}</code> pide hablar con una persona.\nÚltimo mensaje: «${escapeHtml(String(lastMessage).slice(0, 300))}»\nToma el control en el panel (Conversaciones). Queda en cola ${QUEUE_MAX_MIN} min: a los ${TAKEOVER_GRACE_MIN} Vai le avisa de que seguís buscando, y al final retoma y le pide el teléfono.`);
  return true;
}

// prompt efectivo = negocio del tenant (D1) + guardrails (código, innegociables).
// Si el prompt sigue en 'PENDIENTE' (entre migración y seed) cae al SYSTEM de código:
// el bot nunca contesta vacío.
function systemFor(config, tenant) {
  const base = tenant && tenant.system_prompt && tenant.system_prompt !== 'PENDIENTE'
    ? tenant.system_prompt : config.SYSTEM;
  // La identidad de la marca viaja SIEMPRE con el contexto: en la web el saludo fijo
  // del widget la disimulaba, pero en WhatsApp/Telegram el primer mensaje lo genera el
  // modelo y se presentaba sin nombre (visto con Alma/Diálogos, 2026-08-22). Va al
  // principio del bloque estable: cachea igual que el resto del system.
  const who = tenant && tenant.bot_name
    ? `Te llamas ${tenant.bot_name} y eres el asistente de ${tenant.brand_name || tenant.name}. Preséntate por tu nombre.\n`
    : '';
  // El saludo de marca del widget también es la personalidad del bot en el resto de
  // canales: sin esto, la web sonaba a Alma y WhatsApp a un genérico educado. Es
  // referencia de tono, no un guion: si la conversación ya está en marcha no se repite.
  const tone = tenant && tenant.greeting
    ? `Tu saludo característico, y la referencia de tu tono y personalidad en TODOS los canales: «${tenant.greeting}». Al iniciar una conversación nueva saluda en ese estilo; si la persona ya plantea algo concreto, responde directo manteniendo esa personalidad, sin repetir el saludo.\n`
    : '';
  return `${who}${tone}${base}\n${config.GUARDRAILS || ''}`.trim();
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
    // Recaptura sobre un lead YA guardado: rellena solo los HUECOS. El motivo se sabe al
    // segundo mensaje pero el nombre llega más tarde, y antes la fila se quedaba «sin
    // nombre» para siempre porque el conflicto no actualizaba nada. COALESCE es la regla:
    // un valor que ya existe NO se pisa — puede haberlo corregido una persona en el panel.
    const fill = [['name', input.name], ['sector', input.sector], ['need', input.need], ['context', input.context]]
      .filter(([, val]) => val);
    if (fill.length) {
      await env.DB.prepare(`UPDATE leads SET ${fill.map(([col]) => `${col}=COALESCE(${col},?)`).join(',')}, updated_at=? WHERE id=?`)
        .bind(...fill.map(([, val]) => val), now, existing.id).run();
    }
    return { id: existing.id, created: false, enriched: fill.length > 0 };
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// El título lleva el NOMBRE del cliente dueño del lead (pedido de Juan, 2026-08-22:
// el primer lead real de Diálogos llegó como «VELAI»); sin tenant (leads de la web
// propia), Velai.
function notificationText(lead, tenant) {
  const owner = (tenant && tenant.name) ? String(tenant.name).toUpperCase() : 'VELAI';
  let text = `📨 <b>NUEVO LEAD — ${escapeHtml(owner)} (${escapeHtml(lead.source)})</b>\n\n`;
  if (lead.name) text += `👤 Nombre: ${escapeHtml(lead.name)}\n`;
  if (lead.whatsapp) text += `📱 WhatsApp: ${escapeHtml(lead.whatsapp)}\n`;
  if (lead.sector) text += `🏪 Sector: ${escapeHtml(lead.sector)}\n`;
  if (lead.messages_per_day) text += `💬 Mensajes/día: ${escapeHtml(lead.messages_per_day)}\n`;
  if (lead.channel) text += `📡 Canal: ${escapeHtml(lead.channel)}\n`;
  if (lead.need) text += `🎯 Necesidad: ${escapeHtml(lead.need)}\n`;
  if (lead.note) text += `📝 ${escapeHtml(lead.note)}\n`;
  return text + '\n⚡ <b>Contactar hoy mismo</b>';
}

// El respaldo a env.TELEGRAM_CHAT_ID es para las alertas OPERATIVAS de Velai
// (provision_orphan, tokens indescifrables…), NUNCA para el aviso de lead de un
// cliente: ahí un chat id vacío tiene que ser un skip visible, no un mensaje que
// acaba en el Telegram de Velai diciendo ok:true (SPEC-CONEXIONES §1.2).
// botToken: bot PROPIO del tenant (marca blanca) — sin él, el bot de Velai.
// threadId: Tema del grupo (message_thread_id) al que va el mensaje.
async function sendTelegramText(env, text, chatId, { allowFallback = true, botToken = null, threadId = null } = {}) {
  const bot = botToken || env.TELEGRAM_TOKEN;
  const target = chatId || (allowFallback ? env.TELEGRAM_CHAT_ID : null);
  if (!bot || !target) return { skipped: true, error: 'not_configured' };
  const response = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ chat_id: target, text, parse_mode: 'HTML', ...(threadId ? { message_thread_id: Number(threadId) } : {}) }),
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
// ¿A dónde llegan de verdad los leads de este cliente? El panel prometía «los avisos
// llegan por Telegram mientras WhatsApp aprueba la plantilla» sin comprobar que hubiera un
// Telegram vinculado: con gogestión y dialogos era MENTIRA — los dos canales salían
// `skipped` y nadie se enteraba de sus leads (2026-08-24). Espeja las condiciones de
// deliver() a propósito y vive pegado a ella: si una cambia, la otra se ve al lado.
function leadAlertStatus(env, tenant) {
  const telegram = Boolean(tenant.telegram_chat_id) ? 'on' : 'off';
  const sub = Boolean(tenant.twilio_subaccount_sid);
  // Con subcuenta NO hay respaldo con los recursos del padre: dentro de ella no existen.
  const recipients = clean(tenant.team_whatsapp || env.TEAM_WHATSAPP, 1000).split(',').map((x) => x.trim()).filter(Boolean);
  const templateSid = tenant.lead_template_sid || (sub ? null : env.TWILIO_LEAD_TEMPLATE_SID);
  const fromAddress = tenant.twilio_from || (sub ? null : env.TWILIO_FROM);
  let whatsapp = 'off';
  if (recipients.length && fromAddress && templateSid && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    // Plantilla propia creada pero sin aprobar: Meta la rechaza, así que aún NO entrega.
    whatsapp = (tenant.lead_template_status && tenant.lead_template_status !== 'approved'
      && tenant.lead_template_sid === templateSid) ? 'pending_template' : 'on';
  }
  return { telegram, whatsapp, any: telegram === 'on' || whatsapp === 'on' };
}

async function deliver(env, channel, lead, tenant) {
  if (channel === 'telegram') {
    // Entrega DUAL (decisión de Juan, 2026-08-21): el aviso del cliente va a SU chat
    // — y sin chat propio es un skip VISIBLE, no un fallback silencioso — pero a
    // Velai le llega SIEMPRE una copia operativa de cada lead, deduplicada por lead
    // para que los reintentos del ledger no dupliquen el ping.
    const chatId = tenant ? tenant.telegram_chat_id : env.TELEGRAM_CHAT_ID;
    if (env.TELEGRAM_CHAT_ID && String(chatId || '') !== String(env.TELEGRAM_CHAT_ID)) {
      try {
        const dedupeId = lead.id || lead.request_id || '';
        const opsKey = `opsping:${dedupeId}`;
        if (!dedupeId || !env.KV || !(await env.KV.get(opsKey))) {
          if (dedupeId && env.KV) await env.KV.put(opsKey, '1', { expirationTtl: 30 * 86400 });
          await sendTelegramText(env, notificationText(lead, tenant), env.TELEGRAM_CHAT_ID);
        }
      } catch (_) { /* la copia de Velai jamás decide el estado del aviso del cliente */ }
    }
    if (tenant && !chatId) return { skipped: true, error: 'telegram_not_configured' };
    // Marca blanca: el aviso del cliente sale desde SU bot si lo configuró; y si el
    // grupo tiene Temas registrados, Vai clasifica el lead hacia el que encaje.
    const botToken = tenant ? await tenantTelegramToken(env, tenant) : null;
    const threadId = tenant ? await telegramThreadFor(env, tenant, lead) : null;
    let outcome = await sendTelegramText(env, notificationText(lead, tenant), chatId, { allowFallback: false, botToken, threadId });
    if (!outcome.ok && threadId) {
      // Tema borrado o hilo cerrado: el aviso cae al chat General, nunca se pierde.
      outcome = await sendTelegramText(env, notificationText(lead, tenant), chatId, { allowFallback: false, botToken });
    }
    return outcome;
  }
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

async function summarizeLead(config, env, tenant, messages) {
  const conversation = messages.map((m) => `${m.role === 'user' ? 'Cliente' : 'Vai'}: ${m.content}`).join('\n');
  try {
    const raw = await callAnthropic(env, { model: 'claude-haiku-4-5-20251001', max_tokens: 200, system: config.SUMMARY_PROMPT, messages: [{ role: 'user', content: conversation }] }, { tenant });
    return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
  } catch (_) { return {}; }
}

// Un lead sin NOMBRE no le sirve a quien tiene que llamar, y archivarlo en el primer turno
// útil es lo que llenó el panel de «Lead sin nombre» (2026-08-24). Pero DIFERIR la captura
// perdería el lead si la conversación acaba antes de dar el nombre — y un teléfono con una
// conversación real siempre es un lead. Así que: se guarda ya (el equipo se entera al
// momento) y se ENRIQUECE en los turnos siguientes, hasta que llegue el nombre o se agote
// la paciencia. La marca de KV cierra la captura solo cuando ya no hay nada que ganar.
const LEAD_PATIENCE = 8;
function leadFromSummary(summary) {
  return {
    name: clean(summary.nombre, 100), sector: clean(summary.negocio, 100),
    need: clean(summary.necesidad, 200), context: clean(summary.contexto, 300),
  };
}
// Cerrar la captura: con nombre no hay más que buscar; sin él, se reintenta en cada mensaje
// hasta LEAD_PATIENCE turnos — y ahí se deja de gastar resúmenes y se registra el hueco.
function leadCaptureDone(env, tenant, fields, userTurns) {
  if (fields.name) return true;
  if (userTurns < LEAD_PATIENCE) return false;
  console.log(JSON.stringify({ level: 'warn', code: 'lead_sin_nombre', tenant: tenant.slug, turns: userTurns }));
  return true;
}

async function captureChatLead(config, env, ctx, tenant, body, phone, messages, convId) {
  // Mismas guardas que el canal WhatsApp: una captura por conversación (marca en KV),
  // mínimo 2 turnos del usuario. Claves namespaceadas por tenant: dos clientes con el
  // mismo usuario final no se pisan el UNIQUE(request_id).
  const mark = `lead:web:${tenant.id}:${body.conversationId}`;
  if (env.KV && await env.KV.get(mark)) return;
  const userTurns = messages.filter((m) => m.role === 'user').length;
  if (userTurns < 2) return;
  const summary = await summarizeLead(config, env, tenant, messages);
  const fields = leadFromSummary(summary);
  // Este canal NO tenía guarda: guardaba el resumen tal cual, vacíos incluidos. Sin motivo
  // ni negocio no hay nada que contarle a nadie — se espera al siguiente mensaje.
  if (!fields.need && !fields.sector) return;
  const result = await storeLead(env, ctx, {
    requestId: `chat:${tenant.id}:${body.conversationId}:${phone}`, conversationId: body.conversationId,
    tenantId: tenant.id, tenantIsDefault: tenant.slug === defaultTenantSlug(env),
    source: 'chat web', whatsapp: phone, phone, ...fields,
    pageUrl: clean(body.pageUrl, 500), utm: safeUtm(body.utm), score: null,
  });
  if (result.ok) await convLinkLead(env, convId, result.leadId);
  if (result.ok && env.KV && leadCaptureDone(env, tenant, fields, userTurns)) await env.KV.put(mark, '1', { expirationTtl: 30 * 86400 });
}

// El canal WhatsApp también captura leads (regresión corregida): el teléfono es el
// From de Twilio — el cliente no tiene que escribir su número — y se captura una
// sola vez por remitente (marca en KV + request_id idempotente `wa:<phone>`).
// Se dispara con intención comercial mínima: ≥2 turnos del cliente y un resumen
// de Haiku que detecte negocio o necesidad.
async function captureWhatsAppLead(config, env, ctx, tenant, from, phone, messages, convId, options = {}) {
  const mark = `lead:wa:${tenant.id}:${from}`;
  if (env.KV && await env.KV.get(mark)) return;
  const userTurns = messages.filter((m) => m.role === 'user').length;
  // Con force (pidió una persona y no había nadie) basta UN turno: el lead es lo único que
  // le queda al negocio de esa petición, y perderlo por la guarda de dos turnos sería peor.
  if (userTurns < (options.force ? 1 : 2)) return;
  const summary = await summarizeLead(config, env, tenant, messages);
  const fields = leadFromSummary(summary);
  if (!options.force && !fields.need && !fields.sector) return;
  if (options.force && !fields.need) fields.need = 'Pidió hablar con una persona del equipo';
  const result = await storeLead(env, ctx, {
    requestId: `wa:${tenant.id}:${phone}`, source: 'whatsapp',
    tenantId: tenant.id, tenantIsDefault: tenant.slug === defaultTenantSlug(env),
    whatsapp: from.replace(/^whatsapp:/i, ''), phone, ...fields, score: null,
  });
  if (result.ok) await convLinkLead(env, convId, result.leadId);
  if (result.ok && env.KV && leadCaptureDone(env, tenant, fields, userTurns)) await env.KV.put(mark, '1', { expirationTtl: 30 * 86400 });
}

// ── Calendario por tenant (SPEC-CALENDARIO fase 1, solo Google) ──────────────
// La conexión vive en tenant_calendars (migración 0012) con el refresh_token
// cifrado (AAD `calendar:<tenant_id>`); la config se cachea en KV como los tenants.
async function tenantCalendar(env, tenant) {
  if (!env.DB || !tenant || !env.GOOGLE_OAUTH_CLIENT_ID) return null;
  const key = `calcfg:${tenant.id}`;
  if (env.KV) {
    try { const cached = await env.KV.get(key, 'json'); if (cached) return cached.tenant_id ? cached : null; } catch (_) {}
  }
  let row = null;
  // try/catch deliberado: si la tabla aún no existe (deploy antes de migrar en dev),
  // el tenant simplemente no tiene calendario — el chat nunca se cae por esto.
  try {
    row = await env.DB.prepare("SELECT tenant_id,provider,refresh_token_enc,calendar_id,timezone,slot_minutes,business_hours,status FROM tenant_calendars WHERE tenant_id = ? AND status = 'connected'").bind(tenant.id).first();
  } catch (_) { return null; }
  if (env.KV) { try { await env.KV.put(key, JSON.stringify(row || {}), { expirationTtl: TENANT_TTL }); } catch (_) {} }
  return row || null;
}

// invalid_grant = el negocio revocó el acceso (o caducó el token en modo Testing de
// Google): la conexión pasa a error, alerta con antirebote, y las tools dejan de
// ofrecerse en ≤5 min (caché de calcfg) — el bot vuelve a contestar sin calendario.
async function calendarAccessToken(env, cal) {
  const kvKey = `caltoken:${cal.tenant_id}`;
  if (env.KV) { try { const cached = await env.KV.get(kvKey); if (cached) return cached; } catch (_) {} }
  let secret;
  try { secret = await decryptSecret(env, `calendar:${cal.tenant_id}`, cal.refresh_token_enc); } catch (_) { secret = null; }
  if (!secret) {
    console.log(JSON.stringify({ level: 'error', code: 'calendar_token_undecryptable', tenant: cal.tenant_id }));
    throw new HttpError(503, 'calendar_not_configured');
  }
  let data;
  try {
    data = await refreshGoogleToken(env, secret.value);
  } catch (error) {
    if (error.message === 'invalid_grant') {
      try {
        await env.DB.prepare("UPDATE tenant_calendars SET status='error', last_error='invalid_grant', updated_at=? WHERE tenant_id=?").bind(new Date().toISOString(), cal.tenant_id).run();
        await env.KV?.delete(`calcfg:${cal.tenant_id}`);
        const alertKey = `alert:calendar:${cal.tenant_id}`;
        if (env.KV && !(await env.KV.get(alertKey))) {
          await env.KV.put(alertKey, '1', { expirationTtl: 3600 });
          await sendTelegramText(env, `⚠️ <b>Velai</b>: la conexión de Google Calendar del tenant <code>${escapeHtml(cal.tenant_id)}</code> fue revocada o caducó. Reconectar desde el panel; mientras tanto el bot atiende sin citas.`);
        }
      } catch (_) {}
    }
    console.log(JSON.stringify({ level: 'error', code: 'calendar_refresh_failed', tenant: cal.tenant_id, error: clean(error.message, 40) }));
    throw new HttpError(503, 'calendar_unavailable');
  }
  if (env.KV) { try { await env.KV.put(kvKey, data.access_token, { expirationTtl: Math.max(60, (Number(data.expires_in) || 3600) - 60) }); } catch (_) {} }
  return data.access_token;
}

// system con calendario = [bloque ESTABLE cacheado (negocio + guardrails de citas),
// bloque VOLÁTIL sin cache_control (fecha/hora actual)]. La fecha JAMÁS puede entrar
// en el bloque cacheado: rompería el contrato byte-a-byte de CONTEXTOS-AMPLIOS.
function calendarSystem(config, tenant, cal, handoff = null) {
  const tz = cal.timezone || 'Europe/Madrid';
  const now = new Intl.DateTimeFormat('es-ES', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(new Date());
  return [
    { type: 'text', text: `${systemFor(config, tenant)}\n${CALENDAR_GUARDRAILS}`, cache_control: { type: 'ephemeral' } },
    // Volátil: la fecha y, cuando el canal lo sabe, si hay asesores disponibles ahora.
    { type: 'text', text: `Ahora mismo es ${now} (zona horaria del negocio: ${tz}). Las citas duran ${Number(cal.slot_minutes) || 30} minutos.`
      + (handoff === null ? '' : `\n${handoff ? HANDOFF_ON : HANDOFF_OFF}`) },
  ];
}

function calendarHoursFor(cal, weekday) {
  let table = null;
  try { table = cal.business_hours ? JSON.parse(cal.business_hours) : null; } catch (_) {}
  const source = table && typeof table === 'object' ? table : DEFAULT_BUSINESS_HOURS;
  const windows = source[weekday];
  return Array.isArray(windows) ? windows.filter((w) => Array.isArray(w) && /^\d{2}:\d{2}$/.test(w[0]) && /^\d{2}:\d{2}$/.test(w[1])) : [];
}

// null si la fecha es operable; si no, el JSON de error que se devuelve al modelo.
function validCalendarDate(cal, fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return JSON.stringify({ error: 'fecha_invalida', nota: 'usa YYYY-MM-DD' });
  const tz = cal.timezone || 'Europe/Madrid';
  const today = localDateStr(tz, Date.now());
  const max = localDateStr(tz, Date.now() + 60 * 86400000);
  if (fecha < today) return JSON.stringify({ error: 'fecha_pasada', hoy: today });
  if (fecha > max) return JSON.stringify({ error: 'fecha_lejana', nota: 'máximo 60 días vista' });
  return null;
}

// Huecos libres del día: horario del negocio menos la ocupación REAL de su Google
// Calendar (releída del proveedor — es la barrera principal contra dobles reservas).
async function availableSlots(env, cal, fecha) {
  const tz = cal.timezone || 'Europe/Madrid';
  const windows = calendarHoursFor(cal, localWeekday(tz, fecha));
  if (!windows.length) return [];
  const dayStart = localToUtcMs(tz, fecha, '00:00');
  const dayEnd = localToUtcMs(tz, fecha, '23:59') + 60000;
  const token = await calendarAccessToken(env, cal);
  const busy = await googleBusy(env, token, cal.calendar_id, new Date(dayStart).toISOString(), new Date(dayEnd).toISOString());
  return freeSlots({ date: fecha, busy, hours: windows, slotMinutes: cal.slot_minutes, timezone: tz, nowMs: Date.now() });
}

// El executor es un CLOSURE sobre el tenant ya resuelto por el canal: las tools no
// aceptan identificadores — ni el modelo ni una inyección del usuario final pueden
// apuntar al calendario de otro cliente. Todo input del modelo se trata como
// entrada hostil (clean/regex/normalizePhone) y NUNCA lanza hacia el bucle salvo
// fallo real del proveedor (que el bucle convierte en is_error).
function calendarExecutor(env, tenant, cal, meta) {
  return async (name, rawInput) => {
    const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {};
    if (name === 'consultar_disponibilidad') {
      const fecha = clean(input.fecha, 10);
      const invalid = validCalendarDate(cal, fecha);
      if (invalid) return invalid;
      const huecos = await availableSlots(env, cal, fecha);
      return JSON.stringify(huecos.length ? { fecha, huecos } : { fecha, huecos, nota: 'sin huecos ese día, prueba otro' });
    }
    if (name === 'agendar_cita') {
      const fechaHora = clean(input.fecha_hora, 16);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fechaHora)) return JSON.stringify({ error: 'fecha_invalida', nota: 'usa YYYY-MM-DDTHH:MM' });
      const [fecha, hhmm] = fechaHora.split('T');
      const invalid = validCalendarDate(cal, fecha);
      if (invalid) return invalid;
      const nombre = clean(input.nombre, 100);
      // En WhatsApp el From del canal vale como teléfono: no se le pide dos veces.
      const telefono = normalizePhone(clean(input.telefono, 40)) || meta.defaultPhone || '';
      if (!nombre || !telefono) return JSON.stringify({ error: 'datos_incompletos', nota: 'hacen falta nombre y teléfono' });
      const motivo = clean(input.motivo, 200);
      // Relectura del hueco JUSTO antes de crear + cerrojo KV best-effort: las dos
      // primeras capas anti doble reserva; la tercera es el UNIQUE de request_id.
      const huecos = await availableSlots(env, cal, fecha);
      if (!huecos.includes(hhmm)) return JSON.stringify({ error: 'hueco_ocupado', alternativas: huecos.slice(0, 6) });
      const tz = cal.timezone || 'Europe/Madrid';
      const startMs = localToUtcMs(tz, fecha, hhmm);
      const endMs = startMs + (Number(cal.slot_minutes) || 30) * 60000;
      const startIso = new Date(startMs).toISOString();
      if (env.KV) {
        const lockKey = `booklock:${cal.tenant_id}:${startIso}`;
        try {
          if (await env.KV.get(lockKey)) return JSON.stringify({ error: 'hueco_ocupado', alternativas: huecos.filter((h) => h !== hhmm).slice(0, 6) });
          await env.KV.put(lockKey, '1', { expirationTtl: 60 });
        } catch (_) {}
      }
      const token = await calendarAccessToken(env, cal);
      const event = await createGoogleEvent(env, token, cal.calendar_id, {
        summary: `Cita: ${nombre}${motivo ? ` — ${motivo}` : ''}`,
        description: `Teléfono: ${telefono}\nAgendada por Vai (${meta.channel}).`,
        startIso, endIso: new Date(endMs).toISOString(), timezone: tz,
      });
      const now = new Date().toISOString();
      try {
        await env.DB.prepare('INSERT INTO appointments (id,tenant_id,request_id,channel,customer_name,customer_phone,reason,starts_at,ends_at,timezone,provider_event_id,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .bind(crypto.randomUUID(), cal.tenant_id, `cita:${cal.tenant_id}:${clean(meta.conversationKey, 80)}:${fechaHora}`, meta.channel, nombre, telefono, motivo || null, startIso, new Date(endMs).toISOString(), tz, (event && event.id) || null, 'confirmed', now)
          .run();
      } catch (error) {
        // UNIQUE de request_id: un reintento del bucle no duplica la cita (el evento
        // de Google sí podría duplicarse en ese reintento — riesgo residual asumido).
        if (!/UNIQUE/i.test(String(error.message))) throw error;
      }
      console.log(JSON.stringify({ level: 'info', code: 'appointment_created', tenant: tenant.slug, channel: meta.channel }));
      // La fecha vuelve YA formateada en local: el modelo no debe recalcularla.
      return JSON.stringify({ ok: true, fecha, hora: hhmm, nombre, duracion_min: Number(cal.slot_minutes) || 30 });
    }
    return JSON.stringify({ error: 'tool_desconocida' });
  };
}

// La vuelta del canal web (migración 0026). El widget pregunta por lo nuevo SOLO cuando la
// conversación no la lleva el bot: con la IA atendiendo —el 99% del tráfico— no hay ni una
// petición extra, y eso es lo que hace que esto no se coma el plan gratuito de Workers.
async function handleChatPoll(request, env, cors, url) {
  if (!env.DB) throw new HttpError(503, 'conversation_storage_not_configured');
  const cid = clean(url.searchParams.get('conversationId'), 40);
  if (!UUID_RE.test(cid)) throw new HttpError(400, 'invalid_conversation_id');
  // Limitador EN MEMORIA, no en KV: una escritura de KV por sondeo sería el peor uso
  // posible del recurso más escaso del sistema (docs/VOLUMEN-Y-ALMACENAMIENTO.md).
  if (memLimited(`poll:${cid}`, 40)) throw new HttpError(429, 'rate_limited');
  const tenant = await webTenant(env, { tenant: clean(url.searchParams.get('tenant'), 40) });
  const row = await env.DB.prepare(`SELECT id, state, state_at FROM conversations
     WHERE tenant_id=? AND channel='web' AND external_id=? ORDER BY last_at DESC LIMIT 1`)
    .bind(tenant.id, cid).first();
  // Sin conversación no se dice nada más: quien sondea un id inventado recibe lo mismo que
  // quien sondea uno recién creado.
  if (!row) return json({ state: 'bot', messages: [] }, 200, cors);
  const after = Math.max(0, Math.min(1e12, Number(url.searchParams.get('after')) || 0));
  const rows = (await env.DB.prepare(`SELECT id, role, text, created_at FROM conv_messages
     WHERE conversation_id=? AND id > ? AND role <> 'user' ORDER BY id ASC LIMIT 20`)
    .bind(row.id, after).all()).results || [];
  // La marca de presencia: es lo que le dice al panel si el visitante sigue delante. Sin
  // ella, una persona del equipo escribiría a una pestaña cerrada creyendo que atiende.
  try { await env.DB.prepare('UPDATE conversations SET visitor_seen_at=? WHERE id=?').bind(new Date().toISOString(), row.id).run(); } catch (_) {}
  return json({
    state: row.state || 'bot',
    messages: rows.map((m) => ({ id: m.id, role: m.role, text: m.text, at: m.created_at })),
  }, 200, cors);
}

async function handleChat(request, env, cors, ctx, config) {
  const body = await readJson(request, 8000);
  if (!UUID_RE.test(body.conversationId || '')) throw new HttpError(400, 'invalid_conversation_id');
  const message = clean(body.message, 2000);
  if (!message) throw new HttpError(400, 'invalid_message');
  if (body.demo && !isDemoKey(config, body.demo)) throw new HttpError(400, 'invalid_demo');
  // La conversación vive en D1 desde la migración 0021 (antes en KV, con TTL de 24 h y
  // recortada a 20 mensajes). Sin base no hay memoria, y responder sin memoria es peor
  // que no responder — el 503 es el mismo contrato que tenía KV.
  if (!env.DB) throw new HttpError(503, 'conversation_storage_not_configured');
  // Límite también por conversación: rotar de IP (CGNAT/móvil) no multiplica el cupo.
  if (await rateLimited(env, body.conversationId, 'chatconv', 20)) throw new HttpError(429, 'rate_limited');
  const tenant = await webTenant(env, body);
  const conv = await convLoad(env, tenant, 'web', body.conversationId);
  if (conv.isNew) {
    await verifyTurnstile(env, body.turnstileToken, request, 'chat');
    conv.demo = isDemoKey(config, body.demo) ? body.demo : '';
    // Turnstile ya pasó: es una conversación real, no un bot contando de más.
    if (!conv.demo) ctx.waitUntil(recordConversation(env, tenant, 'web'));
  }
  if (body.demo && conv.demo !== body.demo) throw new HttpError(409, 'conversation_mode_mismatch');
  // Mismas reglas que WhatsApp desde la migración 0026. La cuenta atrás vence aquí además
  // de en el cron: si el visitante vuelve a escribir y el plazo pasó, la IA le contesta en
  // este mismo mensaje en vez de hacerle esperar otra ventana del cron.
  if (conv.state === 'esperando' && graceExpired(conv.stateAt)) {
    conv.state = 'bot';
    try { await env.DB.prepare("UPDATE conversations SET state='bot', state_at=? WHERE id=? AND state='esperando'").bind(new Date().toISOString(), conv.id).run(); } catch (_) {}
    console.log(JSON.stringify({ level: 'info', code: 'takeover_expired', tenant: tenant.slug, via: 'mensaje_web' }));
  }
  // Con una persona al mando el bot NO contesta: el mensaje se guarda y el widget lo
  // recogerá por el sondeo. Dos voces en el mismo hilo es peor que ninguna.
  if (['esperando', 'humano'].includes(conv.state)) {
    await convAppend(env, conv, [{ role: 'user', content: message }]);
    console.log(JSON.stringify({ level: 'info', code: 'bot_paused', tenant: tenant.slug, state: conv.state, channel: 'web' }));
    return json({ reply: null, state: conv.state, lastId: conv.lastId || 0 }, 200, cors);
  }
  // El widget DECLARA que sabe recibir respuestas (`live`). Sin eso no se cede el turno:
  // los widgets cacheados en las webs de clientes (v=8, caché de un año) no saben sondear,
  // y escalar ahí dejaría al visitante hablándole a una pared. Sin `live` se comporta
  // exactamente como hasta ahora: la IA atiende y captura el lead.
  const live = body.live === true && !conv.demo;
  const hayAsesor = live && await advisorAvailable(env, tenant);
  // Se GUARDA todo y al modelo se le manda solo la ventana: el slice de antes tiraba lo
  // viejo, que es justo lo que dejamos de hacer.
  const history = [...conv.messages, { role: 'user', content: message }].slice(-CONV_WINDOW);
  // Con calendario conectado (y fuera de demo) el turno va por el bucle de tools.
  // WEB_MAX_TOKENS: el canal web no tiene límite de longitud, y 300 cortaba respuestas
  // legítimas por la mitad (una consulta de trámites en GOgestión, 2026-08-26). El JSON de
  // tool_use consume output, así que el camino del calendario necesita al menos tanto.
  const cal = isDemoKey(config, conv.demo) ? null : await tenantCalendar(env, tenant);
  let reply;
  if (cal) {
    reply = await runToolLoop(env, {
      model: 'claude-sonnet-4-6', max_tokens: WEB_MAX_TOKENS,
      system: calendarSystem(config, tenant, cal, hayAsesor), messages: history,
    }, CALENDAR_TOOLS, calendarExecutor(env, tenant, cal, { channel: 'web', conversationKey: body.conversationId, defaultPhone: '' }), { tenant, closing: 'cita' });
    reply = reply || 'Ahora mismo no puedo consultar la agenda. Déjame tu nombre y teléfono y el equipo te confirma la cita enseguida.';
  } else {
    reply = await callAnthropic(env, {
      model: 'claude-sonnet-4-6', max_tokens: WEB_MAX_TOKENS,
      // Las DEMOS son material comercial de Velai, no de un tenant: van tal cual.
      // Las DEMOS van tal cual: son material comercial de Velai, no de un tenant, y ahí no
      // hay asesores que ofrecer.
      system: isDemoKey(config, conv.demo) ? config.DEMOS[conv.demo] : systemWithHandoff(config, tenant, hayAsesor), messages: history,
    }, { tenant, closing: 'equipo' });
  }
  // El centinela de handoff jamás llega al usuario, tampoco en el canal web.
  const wantsHuman = WANTS_HUMAN.test(reply);
  reply = reply.replace(WANTS_HUMAN, '').trim() || 'De acuerdo, aviso al equipo para que te contacten.';
  await convAppend(env, conv, [{ role: 'user', content: message }, { role: 'assistant', content: reply }]);
  // Se cede el turno DESPUÉS de guardar, para que el panel abra el hilo con el último
  // mensaje ya dentro. assumeAvailable: la disponibilidad ya se resolvió arriba y no hace
  // falta volver a consultarla. stateOnly: en web manda el estado, no la clave de KV.
  if (wantsHuman && hayAsesor) {
    ctx.waitUntil(escalateToHuman(env, tenant, body.conversationId, message, conv.id, { assumeAvailable: true, stateOnly: true })
      .catch((error) => console.log(JSON.stringify({ level: 'error', code: 'handoff_alert_failed', tenant: tenant.slug, error: error.name }))));
  }
  const trail = [...history, { role: 'assistant', content: reply }].slice(-CONV_WINDOW);
  const phone = extractPhone(message);
  if (!conv.demo && phone) {
    ctx.waitUntil(captureChatLead(config, env, ctx, tenant, body, phone, trail, conv.id).catch((error) => {
      console.log(JSON.stringify({ level: 'error', code: 'chat_lead_capture_failed', conversationId: body.conversationId, error: error.name }));
    }));
  }
  // `state` y `lastId` los usa el widget para decidir si tiene que empezar a preguntar por
  // mensajes nuevos, y desde qué punto. Un widget viejo ignora los dos campos.
  return json({ reply, state: wantsHuman && hayAsesor ? 'esperando' : 'bot', lastId: conv.lastId || 0 }, 200, cors);
}

// Una conversación NUEVA (no cada mensaje): es el denominador de la tasa de captura.
// Nunca lanza y va en waitUntil: contar no puede estropear una respuesta.
async function recordConversation(env, tenant, channel) {
  if (!env.DB || !tenant || !tenant.id) return;
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`INSERT INTO conv_daily (tenant_id,day,channel,convs,updated_at) VALUES (?,?,?,1,?)
      ON CONFLICT(tenant_id,day,channel) DO UPDATE SET convs=convs+1, updated_at=excluded.updated_at`)
      .bind(tenant.id, now.slice(0, 10), channel, now).run();
  } catch (error) {
    console.log(JSON.stringify({ level: 'warn', code: 'conv_not_counted', error: clean(String(error.message || error), 60) }));
  }
}

// ── Historial de conversación en D1 (migración 0021) ─────────────────────────
// `conversations` + `conv_messages` son la FUENTE ÚNICA del estado de la conversación:
// sustituyen al `conv:web:*` / `conv:wa:*` de KV, no lo acompañan. El motivo no es solo
// poder leerla en el panel — es que KV era el techo de volumen REAL del sistema (cinco
// escrituras por turno contra 1.000/día; ver docs/VOLUMEN-Y-ALMACENAMIENTO.md).
const CONV_WINDOW = 20;          // lo que ve el modelo; se GUARDA todo
const CONV_SESSION_HOURS = 72;   // tras este silencio, la siguiente entrada abre sesión nueva
const CONV_RETENTION_DAYS = 90;  // default; la var CONV_RETENTION_DAYS del toml lo pisa

function convRetentionDays(env) {
  const raw = Number(env.CONV_RETENTION_DAYS);
  return Number.isFinite(raw) && raw >= 1 && raw <= 3650 ? Math.floor(raw) : CONV_RETENTION_DAYS;
}

// Respuestas en las que el bot admite no resolver. Deliberadamente CONSERVADOR: en el
// informe semanal del cliente es mejor contar de menos que inflar «preguntas que no supe
// contestar». El recuento se guarda en la fila al escribir (reprocesar transcripciones
// enteras después sale caro) y se puede recalcular sobre conv_messages si se afina.
// «sé» CON acento a propósito: «no se admiten perros» o «no se puede pagar en efectivo»
// son respuestas perfectamente resueltas, y `no se` las contaría todas. El modelo escribe
// español con acentos, así que la forma acentuada es la señal fiable.
const UNANSWERED_RE = /no (?:lo )?sé(?![a-z])|no tengo (?:esa|esta|la) informaci[óo]n|no dispongo de|no puedo (?:darte|facilitarte|confirmarte)|no figura|no aparece en|no estoy seguro|lo consulto con el equipo|te lo confirma el equipo/i;

// La sesión ABIERTA de una dirección, con su ventana de mensajes. Nunca devuelve null:
// si no hay sesión viva devuelve una nueva SIN escribir nada — el INSERT ocurre en
// convAppend, porque en el camino web todavía falta pasar Turnstile y una conversación
// rechazada no debe dejar fila.
async function convLoad(env, tenant, channel, externalId, inbox = null) {
  const since = new Date(Date.now() - CONV_SESSION_HOURS * 3600000).toISOString();
  const row = await env.DB.prepare(`SELECT id, demo, msgs, state, state_at, agent_email FROM conversations
     WHERE tenant_id=? AND channel=? AND external_id=? AND last_at > ?
     ORDER BY last_at DESC LIMIT 1`).bind(tenant.id, channel, externalId, since).first();
  const base = { tenant: tenant.id, channel, externalId, inbox };
  if (!row) return { ...base, id: crypto.randomUUID(), demo: '', msgs: 0, isNew: true, messages: [], state: 'bot', stateAt: null };
  // DESC + LIMIT + reverse: leer la cola de una conversación larga por el índice, no
  // barrer la conversación entera para quedarse con el final.
  const rows = (await env.DB.prepare('SELECT role, text FROM conv_messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?')
    .bind(row.id, CONV_WINDOW).all()).results || [];
  return {
    ...base, id: row.id, demo: row.demo || '', msgs: Number(row.msgs) || 0, isNew: false,
    state: row.state || 'bot', stateAt: row.state_at || null, agentEmail: row.agent_email || null,
    // 'agent' se le presenta al modelo como 'assistant': la API solo conoce user y
    // assistant, y el modelo TIENE que ver lo que dijo la persona del equipo — si no, al
    // expirar la pausa retomaría la conversación contradiciéndola.
    messages: rows.reverse().map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
  };
}

// Cierra el turno: la fila de la conversación y sus mensajes en UN batch (transacción,
// así que el orden INSERT-conversación → INSERT-mensajes satisface la FK).
// Se hace AWAIT, no waitUntil: esto es el estado de la conversación y perderlo deja al
// turno siguiente sin memoria. Pero NO lanza: el modelo ya respondió y esa respuesta se
// ha pagado — devolverla sin memoria es malo, tirarla es peor.
// `expires_at` se recalcula en cada turno para que el reloj de retención corra desde el
// último mensaje: una conversación viva no se purga a media frase.
async function convAppend(env, conv, turns) {
  const list = (turns || []).filter((t) => t && t.content);
  if (!list.length) return false;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + convRetentionDays(env) * 86400000).toISOString();
  const unanswered = list.filter((t) => t.role === 'assistant' && UNANSWERED_RE.test(t.content)).length;
  // Marca de «entró algo del cliente final». El aviso del panel se apoya en esto: con
  // last_at, una respuesta del propio equipo se avisaría a sí misma.
  const inbound = list.some((t) => t.role === 'user') ? now : null;
  const head = conv.isNew
    ? env.DB.prepare(`INSERT INTO conversations (id,tenant_id,channel,external_id,demo,msgs,unanswered,started_at,last_at,expires_at,inbox_address,last_inbound_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(conv.id, conv.tenant, conv.channel, conv.externalId, conv.demo || '', list.length, unanswered, now, now, expires, conv.inbox || null, inbound)
    // COALESCE en inbox_address: una conversación abierta antes de la migración 0023 lo
    // tiene a NULL y el siguiente mensaje entrante lo rellena, en vez de quedarse muda
    // para siempre. Y un valor ya guardado no se pisa con NULL.
    // COALESCE en last_inbound_at: un turno sin mensaje del cliente no debe borrar la marca
    // del último que sí lo hubo.
    : env.DB.prepare('UPDATE conversations SET msgs=msgs+?, unanswered=unanswered+?, last_at=?, expires_at=?, inbox_address=COALESCE(inbox_address,?), last_inbound_at=COALESCE(?,last_inbound_at) WHERE id=?')
      .bind(list.length, unanswered, now, expires, conv.inbox || null, inbound, conv.id);
  try {
    const out = await env.DB.batch([head, ...list.map((t) => env.DB
      .prepare('INSERT INTO conv_messages (conversation_id,role,agent_email,text,created_at) VALUES (?,?,?,?,?)')
      .bind(conv.id, t.role, t.agentEmail || null, t.content, now))]);
    const last = out && out[out.length - 1];
    if (last && last.meta && last.meta.last_row_id) conv.lastId = last.meta.last_row_id;
    else {
      // Respaldo: el cursor del widget depende de esto. Sin un lastId real, /chat mandaría 0
      // y el primer sondeo le repintaría la conversación entera al visitante.
      try {
        const row = await env.DB.prepare('SELECT MAX(id) AS id FROM conv_messages WHERE conversation_id=?').bind(conv.id).first();
        if (row && row.id) conv.lastId = row.id;
      } catch (_) { /* sin cursor el sondeo no duplica: solo pinta de más una vez */ }
    }
  } catch (error) {
    // Sin texto del mensaje: los logs no llevan PII, tampoco cuando fallan.
    console.log(JSON.stringify({ level: 'error', code: 'conv_state_not_saved', channel: conv.channel, error: clean(String(error.message || error), 80) }));
    return false;
  }
  conv.isNew = false;
  conv.msgs += list.length;
  return true;
}

// ── Disponibilidad de asesores (migración 0025, docs/H2-HANDOFF.md) ─────────
// Regla de Juan: el BOT no tiene restricción horaria; hablar con una persona SÍ. Fuera de
// horario no se ofrece interacción humana, y si la piden se rechaza con explicación.
const CONV_STATES = ['bot', 'esperando', 'humano'];
// La cola de espera (migración 0027). Los 5 minutos son el primer AVISO, no el final:
// con un asesor ocupado en otra conversación, rendirse a los 5 minutos saltaba casi
// siempre y el visitante lo leía como «no hay nadie», cuando sí había.
const TAKEOVER_GRACE_MIN = 5;    // primer aviso: «seguimos buscando a alguien»
const QUEUE_MAX_MIN = 15;        // final: la IA retoma y pide el teléfono

// Mismo formato y mismo default que tenant_calendars.business_hours: si la interacción
// humana va con horario, un NULL no puede significar «sin límite».
function supportWindows(tenant, weekday) {
  let table = null;
  try { table = tenant && tenant.support_hours ? JSON.parse(tenant.support_hours) : null; } catch (_) {}
  const source = table && typeof table === 'object' && !Array.isArray(table) ? table : DEFAULT_BUSINESS_HOURS;
  const windows = source[weekday];
  return Array.isArray(windows) ? windows.filter((w) => Array.isArray(w) && HHMM_RE.test(w[0]) && HHMM_RE.test(w[1])) : [];
}

// hourCycle h23 a propósito: con otras variantes la medianoche sale como «24:00» y la
// comparación de cadenas dejaría fuera la primera hora del día.
function withinSupportHours(tenant, nowMs = Date.now()) {
  const tz = (tenant && tenant.support_tz) || 'Europe/Madrid';
  const when = new Date(nowMs);
  let day; let hhmm;
  try {
    day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(when).toLowerCase();
    hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(when);
  } catch (_) {
    // Zona horaria inválida en la fila: se cae al default en vez de dejar de atender.
    return withinSupportHours({ ...tenant, support_tz: null }, nowMs);
  }
  return supportWindows(tenant, day).some(([from, to]) => hhmm >= from && hhmm < to);
}

// Minutos que lleva esperando. Sin state_at devuelve Infinity: una fila a medias no puede
// dejar a nadie esperando para siempre.
function waitedMin(stateAt, nowMs = Date.now()) {
  if (!stateAt) return Infinity;
  const at = Date.parse(stateAt);
  if (!Number.isFinite(at)) return Infinity;
  return (nowMs - at) / 60000;
}

// ¿Se acabó la cola? Ojo: mide QUEUE_MAX_MIN, no los 5 del primer aviso — confundir los dos
// es exactamente el fallo que había.
function graceExpired(stateAt, nowMs = Date.now()) {
  return waitedMin(stateAt, nowMs) >= QUEUE_MAX_MIN;
}

// ¿Se puede ofrecer un asesor AHORA? Interruptor de alguien encendido Y dentro de horario.
// Nunca lanza: si la tabla de presencia no existe aún (deploy antes de migrar), no hay
// asesores y el bot sigue atendiendo — que es el comportamiento seguro.
async function advisorAvailable(env, tenant) {
  if (!env.DB || !tenant || !tenant.id) return false;
  if (!withinSupportHours(tenant)) return false;
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM agent_presence WHERE tenant_id=? AND available=1').bind(tenant.id).first();
    return Number(row && row.n) > 0;
  } catch (_) { return false; }
}

// «Fuera de horario NO se ofrece interacción humana» (Juan). La forma limpia de que el bot
// no prometa lo que no puede dar es DECÍRSELO, no censurar su respuesta después. Va en un
// bloque volátil, sin cache_control: el bloque estable del system sigue cacheando igual.
const HANDOFF_ON = 'AHORA MISMO hay alguien del equipo disponible y puede entrar EN ESTA MISMA CONVERSACIÓN. Si la persona pide hablar con alguien: dile que avisas a un compañero y que se une aquí en un momento, y termina tu mensaje con el marcador [[HUMANO]]. NO le pidas el teléfono ni el WhatsApp para eso: no hace falta ningún dato, porque la persona del equipo escribe en este mismo chat, y pedírselo da a entender que le van a llamar en otro momento. Esta regla tiene PRIORIDAD sobre cualquier instrucción de conseguir su contacto.';
const HANDOFF_OFF = 'AHORA MISMO no hay nadie del equipo disponible (fuera del horario de atención, o sin nadie conectado). NO ofrezcas pasar la conversación a una persona ni digas que alguien va a entrar ahora. Si la persona lo pide, dile con naturalidad que en este momento no hay nadie del equipo, pídele su nombre y su teléfono si no los tienes, y dile que el equipo le escribe en cuanto pueda. Sigue ayudándole tú con lo que puedas. NO uses el marcador [[HUMANO]].';

function systemWithHandoff(config, tenant, available) {
  return [
    { type: 'text', text: systemFor(config, tenant), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: available ? HANDOFF_ON : HANDOFF_OFF },
  ];
}

// Velai atiende SOLO sus propias conversaciones (decisión de Juan, 2026-08-26). Puede VER
// las de todos los clientes —lo necesita para dar soporte y diagnosticar— pero no
// responderlas ni tomar su control: el cliente final de un negocio no debe encontrarse a
// Velai dentro de su chat, y la burbuja del panel lleva el correo de quien escribe.
async function velaiTenantId(env) {
  const slug = clean(env.DEFAULT_TENANT_SLUG, 40) || 'velai';
  try {
    const row = await env.DB.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first();
    return row ? row.id : null;
  } catch (_) { return null; }
}

// ¿Puede ESTA persona atender ESTA conversación? Un cliente, las suyas; Velai, solo las de
// Velai. Devuelve booleano y no lanza: el código de error lo elige el que llama.
async function canAttend(env, scope, tenantId) {
  if (!tenantId) return false;
  if (scope.role !== 'velai') return scope.tenantId === tenantId;
  const mine = await velaiTenantId(env);
  return Boolean(mine) && tenantId === mine;
}

const META_WINDOW_HOURS = 24;
// Margen para considerar que el visitante sigue en la página: el widget refresca cada 6 s
// mientras hay una persona al otro lado, así que 90 s aguanta un tropiezo de red sin
// declararlo ausente a las primeras de cambio.
const VISITOR_AWAY_MS = 90000;

// La ventana de atención al cliente de Meta: 24 h desde el ÚLTIMO mensaje ENTRANTE. Fuera
// de ella, el texto libre se rechaza con 63016 y hace falta una plantilla aprobada. Wati es
// el único del grupo que la expone; un cajón de escritura que no la conoce es una trampa —
// el agente escribe, pulsa enviar y el mensaje muere en Twilio.
// Devuelve el MOTIVO cuando está cerrada: el panel lo traduce y cierra el cajón antes de
// que alguien escriba, en vez de después.
async function replyWindow(env, conv) {
  // El cajón se abre SOLO con el control tomado (migración 0025): escribir en una
  // conversación que la IA sigue atendiendo mete dos voces en el mismo hilo.
  if (conv.state !== 'humano') return { open: false, reason: conv.state === 'esperando' ? 'sin_control' : 'atiende_la_ia' };
  // Canal web (migración 0026): no hay ventana de Meta, pero sí la pregunta equivalente —
  // ¿sigue delante? El mensaje se guarda igual y le llegará si vuelve dentro de la sesión,
  // así que esto AVISA, no bloquea: bloquear le quitaría a la persona la única forma de
  // dejar algo escrito.
  if (conv.channel === 'web') {
    const seen = conv.visitor_seen_at ? Date.parse(conv.visitor_seen_at) : 0;
    const away = !seen || Date.now() - seen > VISITOR_AWAY_MS;
    return { open: true, web: true, away, seenAt: conv.visitor_seen_at || null };
  }
  if (!conv.inbox_address) return { open: false, reason: 'inbox_address_unknown' };
  const row = await env.DB.prepare("SELECT MAX(created_at) AS last_in FROM conv_messages WHERE conversation_id=? AND role='user'").bind(conv.id).first();
  const lastIn = row && row.last_in;
  if (!lastIn) return { open: false, reason: 'no_inbound' };
  const closesAt = new Date(new Date(lastIn).getTime() + META_WINDOW_HOURS * 3600000).toISOString();
  return closesAt > new Date().toISOString()
    ? { open: true, closesAt, lastIn }
    : { open: false, reason: 'window_closed', closesAt, lastIn };
}

// Enlaza la conversación con el lead que salió de ella. `leads.conversation_id` existe
// desde la migración 0001, pero solo lo rellena el canal web y guarda el id del widget:
// el camino de vuelta (ficha del lead → lo que se dijo) necesita esto, y en WhatsApp es
// el ÚNICO camino. Nunca lanza: es navegación del panel, no el lead.
async function convLinkLead(env, convId, leadId) {
  if (!env.DB || !convId || !leadId) return;
  try {
    await env.DB.prepare('UPDATE conversations SET lead_id=? WHERE id=? AND lead_id IS NULL').bind(leadId, convId).run();
  } catch (error) {
    console.log(JSON.stringify({ level: 'warn', code: 'conv_lead_not_linked', error: clean(String(error.message || error), 60) }));
  }
}

// Límites del plan GRATUITO de Cloudflare, verificados en su documentación el
// 2026-08-25. Si se pasa a un plan de pago, actualizar aquí (el panel pinta el % con
// estos números y un límite equivocado da una falsa sensación de holgura).
const CF_FREE_LIMITS = {
  worker_requests: 100000,   // Workers: 100.000 peticiones/día
  kv_reads: 100000,          // KV: 100.000 lecturas/día
  kv_writes: 1000,           // KV: 1.000 escrituras/día a claves distintas
  kv_lists: 1000,            // KV: 1.000 listados/día — el segundo cuello real (escalaciones)
  kv_deletes: 1000,          // KV: 1.000 borrados/día
  d1_rows_read: 5000000,     // D1: 5 millones de filas leídas/día
  d1_rows_written: 100000,   // D1: 100.000 filas escritas/día
};

// Consumo real de la infraestructura, leído de la API de analíticas de Cloudflare (no
// estimado por nosotros). Requiere que el token tenga «Account Analytics: Read»; si no
// lo tiene, se devuelve el motivo y el panel explica qué añadir en vez de mentir con
// ceros.
async function cloudflareUsage(env) {
  const cfEnv = await withCfToken(env);
  const token = cfEnv.CF_API_TOKEN; const account = cfEnv.CF_ACCOUNT_ID;
  if (!token || !account) return { error: 'cloudflare_api_not_configured', limits: CF_FREE_LIMITS };
  const since = new Date(Date.now() - 86400000).toISOString();
  const query = `query($acc:String!,$since:Time!){viewer{accounts(filter:{accountTag:$acc}){
    workersInvocationsAdaptive(limit:100,filter:{datetime_geq:$since}){sum{requests errors}}
    kvOperationsAdaptiveGroups(limit:100,filter:{datetime_geq:$since}){sum{requests} dimensions{actionType}}
    d1AnalyticsAdaptiveGroups(limit:100,filter:{datetime_geq:$since}){sum{readQueries writeQueries rowsRead rowsWritten}}
  }}}`;
  let data;
  try {
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { acc: account, since } }),
      signal: AbortSignal.timeout(10000),
    });
    data = await response.json();
  } catch (_) { return { error: 'cloudflare_unreachable', limits: CF_FREE_LIMITS }; }
  const acc = data && data.data && data.data.viewer && data.data.viewer.accounts && data.data.viewer.accounts[0];
  if (!acc) {
    const why = (data && data.errors && data.errors[0] && String(data.errors[0].message).slice(0, 120)) || 'sin datos';
    console.log(JSON.stringify({ level: 'warn', code: 'cf_analytics_denied', why }));
    return { error: 'cloudflare_analytics_denied', why, limits: CF_FREE_LIMITS };
  }
  const sum = (rows, field) => (rows || []).reduce((t, r) => t + ((r.sum && r.sum[field]) || 0), 0);
  const kv = { read: 0, write: 0, delete: 0, list: 0 };
  for (const row of acc.kvOperationsAdaptiveGroups || []) {
    const k = String((row.dimensions && row.dimensions.actionType) || '').toLowerCase();
    if (k in kv) kv[k] += (row.sum && row.sum.requests) || 0;
  }
  const d1 = acc.d1AnalyticsAdaptiveGroups || [];
  return {
    ventana: '24 h',
    worker: { requests: sum(acc.workersInvocationsAdaptive, 'requests'), errors: sum(acc.workersInvocationsAdaptive, 'errors') },
    kv,
    d1: { rowsRead: sum(d1, 'rowsRead'), rowsWritten: sum(d1, 'rowsWritten') },
    limits: CF_FREE_LIMITS,
  };
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

// Tras la respuesta del modelo, el cierre del turno de Twilio es idéntico en el
// camino síncrono (TwiML) y en el asíncrono del calendario (Messages API): handoff,
// historial en D1 y captura de lead — factorizado para que no diverjan.
// El turno del USUARIO se guarda aquí, no antes: así el mensaje y su respuesta entran en
// el mismo batch y no queda un mensaje huérfano si el modelo falla a mitad.
async function settleTwilioReply(config, env, ctx, tenant, from, message, conv, rawReply) {
  let reply = String(rawReply || '');
  const wantsHuman = WANTS_HUMAN.test(reply);
  reply = reply.replace(WANTS_HUMAN, '').trim();
  if (wantsHuman) {
    ctx.waitUntil(escalateToHuman(env, tenant, from, message, conv.id).catch((error) => {
      console.log(JSON.stringify({ level: 'error', code: 'handoff_alert_failed', tenant: tenant.slug, error: error.name }));
    }));
  }
  const turns = [{ role: 'user', content: message }];
  if (reply) turns.push({ role: 'assistant', content: reply });
  const trail = [...conv.messages, ...turns].slice(-CONV_WINDOW);
  await convAppend(env, conv, turns);
  const phone = normalizePhone(from.replace(/^whatsapp:/i, ''));
  if (phone) {
    // Pedir hablar con una persona ES intención comercial suficiente: si nadie pudo
    // atender, el lead se fuerza en vez de esperar a que el resumen traiga sector o
    // necesidad. Es lo único que queda del handoff cuando no hay asesores.
    ctx.waitUntil(captureWhatsAppLead(config, env, ctx, tenant, from, phone, trail, conv.id, { force: wantsHuman }).catch((error) => {
      console.log(JSON.stringify({ level: 'error', code: 'wa_lead_capture_failed', tenant: tenant.slug, error: error.name }));
    }));
  }
  return reply;
}

// Respuesta saliente FUERA del webhook (camino asíncrono del calendario). Texto libre
// es legal aquí: la ventana de 24 h la abrió el mensaje entrante del usuario. From =
// el To del webhook (la dirección del tenant). Credenciales de la subcuenta si existe
// — regla de oro de deliver(): los recursos de una subcuenta se operan con SUS credenciales.
async function sendTwilioText(env, tenant, fromAddress, toAddress, body) {
  const sub = tenant && tenant.twilio_subaccount_sid;
  const sid = sub || env.TWILIO_ACCOUNT_SID;
  const token = sub ? await twilioAuthTokenFor(env, tenant) : env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return { skipped: true, error: 'not_configured' };
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: fromAddress, To: toAddress, Body: waBody(body) }),
    signal: AbortSignal.timeout(8000),
  });
  return response.ok ? { ok: true } : { error: `twilio_${response.status}` };
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
  // Twilio reintenta el webhook si la respuesta tarda o falla: sin dedupe, el mismo
  // mensaje se procesaba (y se pagaba al modelo) DOS veces. La clave se escribe ANTES
  // de llamar al modelo: si el modelo falla se pierde esa respuesta, pero nunca se
  // cobra doble. Solo tras validar la firma: una petición sin firmar no puede
  // envenenar el sid de un mensaje legítimo. Fail-open si KV cae (como el rate limit).
  const messageSid = clean(params.get('MessageSid') || params.get('SmsMessageSid'), 40);
  if (env.KV && messageSid) {
    const dedupeKey = `dedupe:twilio:${tenant.id}:${messageSid}`;
    try {
      if (await env.KV.get(dedupeKey)) {
        console.log(JSON.stringify({ level: 'info', code: 'twilio_duplicate_ignored', tenant: tenant.slug }));
        return new Response(EMPTY_TWIML, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
      }
      await env.KV.put(dedupeKey, '1', { expirationTtl: 86400 });
    } catch (_) { /* mejor riesgo de duplicado que webhook caído */ }
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

  // Historial en D1 (migración 0021), namespaceado por tenant: dos clientes distintos con
  // el mismo usuario final no comparten conversación. Y por SESIÓN de 72 h, no por vida
  // del teléfono: el panel enseña conversaciones discretas en vez de un hilo infinito.
  if (!env.DB) throw new HttpError(503, 'conversation_storage_not_configured');
  const channel = from.startsWith('messenger:') ? 'messenger' : 'whatsapp';
  // `to` es la dirección del tenant a la que escribió el cliente final: es por la que
  // hay que responder desde el panel, no por tenants.twilio_from (migración 0023).
  const conv = await convLoad(env, tenant, channel, from, to);
  // OJO: el CONTADOR sigue diciendo 'whatsapp' también para Messenger, aunque la
  // conversación se guarde con su canal real. No es descuido: el panel cruza este
  // denominador con `leads.source`, y captureWhatsAppLead escribe 'whatsapp' para los dos
  // canales. Un 'messenger' aquí dejaría a Messenger con 0 leads sobre N conversaciones y
  // le inflaría la tasa a WhatsApp. Se separan cuando se separe también el origen del lead.
  if (conv.isNew) ctx.waitUntil(recordConversation(env, tenant, 'whatsapp'));
  const history = [...conv.messages, { role: 'user', content: message }].slice(-CONV_WINDOW);
  // La cuenta atrás de la toma de control vence AQUÍ además de en el cron: el cron corre
  // cada 5 min, así que si la persona vuelve a escribir y el plazo ya pasó, la IA le
  // contesta en este mismo mensaje en vez de hacerle esperar otra ventana del cron.
  if (conv.state === 'esperando' && graceExpired(conv.stateAt)) {
    conv.state = 'bot';
    try {
      await env.DB.prepare("UPDATE conversations SET state='bot', state_at=? WHERE id=? AND state='esperando'").bind(new Date().toISOString(), conv.id).run();
      if (env.KV) await env.KV.delete(`pause:${tenant.id}:${from}`);
    } catch (_) { /* si falla, la guarda de abajo mantiene al bot callado: es el lado seguro */ }
    console.log(JSON.stringify({ level: 'info', code: 'takeover_expired', tenant: tenant.slug, via: 'mensaje' }));
  }
  // Conversación en manos de una persona (o esperando a que alguien la tome): el mensaje se
  // guarda pero NO se contesta ni se llama al modelo — dos voces es peor que ninguna.
  // La clave `pause:` se consulta EN PARALELO al estado a propósito: mientras las dos
  // convivan, el fallo posible es «el bot se queda callado», nunca «el bot habla por encima
  // de una persona», y de eso se sale con el botón Reanudar de siempre.
  const humanoAlMando = ['esperando', 'humano'].includes(conv.state);
  if (humanoAlMando || (env.KV && await env.KV.get(`pause:${tenant.id}:${from}`))) {
    await convAppend(env, conv, [{ role: 'user', content: message }]);
    console.log(JSON.stringify({ level: 'info', code: 'bot_paused', tenant: tenant.slug, state: conv.state }));
    return new Response(EMPTY_TWIML, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
  }
  // Se resuelve UNA vez por mensaje y viaja al modelo en el bloque volátil del system: así
  // el bot no ofrece pasar con una persona cuando no hay nadie que pueda entrar.
  const hayAsesor = await advisorAvailable(env, tenant);
  const twiml = (text) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeHtml(waBody(text))}</Message></Response>`, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
  const cal = await tenantCalendar(env, tenant);
  if (!cal) {
    const raw = await callAnthropic(env, { model: 'claude-sonnet-4-6', max_tokens: WA_MAX_TOKENS, system: systemWithHandoff(config, tenant, hayAsesor), messages: history }, { tenant, retries: 0, timeoutMs: 10000, closing: 'equipo', bodyLimit: WA_BODY_LIMIT });
    return twiml(await settleTwilioReply(config, env, ctx, tenant, from, message, conv, raw));
  }
  // Con calendario: híbrido síncrono/asíncrono (SPEC-CALENDARIO §3.4). La primera
  // llamada mantiene la latencia de siempre; si el modelo NO pide herramientas,
  // TwiML como hoy. Si las pide, TwiML vacío YA (el bucle puede superar el corte
  // de ~15 s de Twilio) y el resto sigue en waitUntil, entregando la respuesta
  // final por la Messages API — el dedupe por MessageSid impide que el reintento
  // de Twilio (si lo hubiera) duplique el trabajo.
  const payload = { model: 'claude-sonnet-4-6', max_tokens: WA_TOOL_MAX_TOKENS, system: calendarSystem(config, tenant, cal, hayAsesor), messages: history };
  const waOpts = { tenant, retries: 0, timeoutMs: 10000, closing: 'cita', bodyLimit: WA_BODY_LIMIT };
  const first = await callAnthropicRaw(env, { ...payload, tools: CALENDAR_TOOLS }, waOpts);
  if (first.stop_reason !== 'tool_use') {
    return twiml(await settleTwilioReply(config, env, ctx, tenant, from, message, conv, settleReply(first, waOpts, contentText(first))));
  }
  ctx.waitUntil((async () => {
    const executor = calendarExecutor(env, tenant, cal, {
      channel,
      conversationKey: from,
      defaultPhone: normalizePhone(from.replace(/^whatsapp:/i, '')),
    });
    // Timeouts agresivos en el tramo asíncrono: waitUntil da ~30 s en total.
    const raw = await runToolLoop(env, payload, CALENDAR_TOOLS, executor, waOpts, first)
      || 'No he podido confirmar la agenda ahora mismo; el equipo te escribe enseguida para cerrarla.';
    const reply = await settleTwilioReply(config, env, ctx, tenant, from, message, conv, raw);
    if (reply) {
      const sent = await sendTwilioText(env, tenant, to, from, reply);
      if (!sent.ok) console.log(JSON.stringify({ level: 'error', code: 'calendar_reply_failed', tenant: tenant.slug, error: sent.error || 'skipped' }));
    }
  })().catch((error) => console.log(JSON.stringify({ level: 'error', code: 'calendar_reply_failed', tenant: tenant.slug, error: error.name }))));
  return new Response(EMPTY_TWIML, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
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

// Filtros de la vista Conversaciones. Alias `c.` — el aislamiento por tenant NO se
// construye aquí, lo pone scopeClause(scope, 'c') en el endpoint.
function convFilters(url) {
  const clauses = ['1=1']; const values = [];
  const channel = clean(url.searchParams.get('channel'), 20);
  // Instagram entra en la lista aunque el canal no exista aún: el panel pinta su chip a 0
  // y filtrar por él tiene que devolver VACÍO, no «todas» — que es lo que pasaba cuando el
  // parámetro se ignoraba en silencio.
  if (['web', 'whatsapp', 'messenger', 'instagram'].includes(channel)) { clauses.push('c.channel = ?'); values.push(channel); }
  const tenant = clean(url.searchParams.get('tenant'), 40);
  if (tenant && UUID_RE.test(tenant)) { clauses.push('c.tenant_id = ?'); values.push(tenant); }
  const from = clean(url.searchParams.get('from'), 30);
  if (from) { clauses.push('c.last_at >= ?'); values.push(from); }
  const to = clean(url.searchParams.get('to'), 30);
  // Una fecha suelta (input type=date) debe incluir el día completo frente al ISO almacenado.
  if (to) { clauses.push('c.last_at <= ?'); values.push(/^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to); }
  // Buscador de la bandeja (rediseño 2026-08-27): por PERSONA (nombre del lead) o por
  // número/identificador. NO entra en el texto de los mensajes: eso obligaría a recorrer
  // conv_messages en cada tecla. El número se compara en crudo porque en D1 se guarda sin
  // espacios («whatsapp:+34622418807») y en el panel se lee con ellos.
  const q = clean(url.searchParams.get('q'), 60);
  if (q) {
    const like = (v) => `%${v.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const bare = q.replace(/[^0-9a-zA-Z]/g, '');
    clauses.push(`(l.name LIKE ? ESCAPE '\\'${bare ? ` OR c.external_id LIKE ? ESCAPE '\\'` : ''})`);
    values.push(like(q));
    if (bare) values.push(like(bare));
  }
  const lead = clean(url.searchParams.get('lead'), 4);
  if (lead === 'si') clauses.push('c.lead_id IS NOT NULL');
  if (lead === 'no') clauses.push('c.lead_id IS NULL');
  // «Lo que el bot no supo contestar» — el filtro que convierte la lista en plan de
  // acción, y el germen de la pantalla de H2 §2.
  if (url.searchParams.get('sinResolver') === '1') clauses.push('c.unanswered > 0');
  // Las DEMOS son juego de rol comercial de Velai, no conversaciones del negocio: fuera
  // por defecto, o la tasa de captura y los recuentos del panel mienten.
  if (url.searchParams.get('demo') !== '1') clauses.push("c.demo = ''");
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

const PANEL_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cada alta y baja de usuario deja rastro con actor Y rol (SPEC-USUARIOS §B.2): un
// cliente tocando su acceso tiene que poder distinguirse de Velai haciéndolo.
// La puerta de Access (grupo «Clientes Velai») se reconstruye desde D1 tras CADA
// alta/baja: el include del grupo es sustitución completa. D1 primero, Cloudflare
// después — si el PUT falla, la fila ya está y el estado devuelto es 'pendiente' con
// log + alerta: el único estado incoherente tiene que verse, no adivinarse. Sin
// CF_API_TOKEN o sin grupo, 'manual' (la puerta se gestiona en el dashboard).
// No hay cerrojo: el PUT reescribe la lista COMPLETA leída tras la escritura propia,
// así que dos operaciones simultáneas convergen con la siguiente sincronización.
// Igual que la puerta de clientes, pero para el grupo «Admins Velai»: la lista se
// reconstruye desde env (raíz, SIEMPRE presentes — redundancia sobre la política
// «Equipo Velai» del dashboard, que el worker no toca) + admin_users. Un PUT fallido
// no pierde la fila: gate 'pendiente' + log + alerta.
async function syncAdminGate(env, ctx) {
  const cfEnv = await withCfToken(env);
  if (!cloudflareConfigured(cfEnv) || !cfEnv.CF_ADMIN_GROUP_ID) return 'manual';
  try {
    const rows = (await env.DB.prepare('SELECT email FROM admin_users ORDER BY email').all()).results || [];
    const emails = [...new Set([...envAdmins(env), ...rows.map((r) => r.email)])];
    await syncAdminGroup(cfEnv, emails);
    return 'sincronizado';
  } catch (error) {
    console.log(JSON.stringify({ level: 'error', code: 'admin_policy_desync', error: String(error.message || error) }));
    ctx.waitUntil(sendTelegramText(env, '⚠️ <b>Velai</b>: la política de admins de Access no se pudo sincronizar tras un alta/baja de admin. La fila en D1 está bien; repetir la operación o revisar CF_API_TOKEN.').catch(() => {}));
    return 'pendiente';
  }
}

async function syncPanelGate(env, ctx) {
  const cfEnv = await withCfToken(env);
  if (!cloudflareConfigured(cfEnv) || !cfEnv.CF_ACCESS_GROUP_ID) return 'manual';
  try {
    const rows = (await env.DB.prepare('SELECT email FROM tenant_users ORDER BY email').all()).results || [];
    await syncAccessGroup(cfEnv, rows.map((r) => r.email));
    return 'sincronizado';
  } catch (error) {
    console.log(JSON.stringify({ level: 'error', code: 'access_group_desync', error: String(error.message || error) }));
    ctx.waitUntil(sendTelegramText(env, '⚠️ <b>Velai</b>: el grupo de Access «Clientes Velai» no se pudo sincronizar tras un alta/baja de usuario. La fila en D1 está bien; repetir la operación o revisar CF_API_TOKEN.').catch(() => {}));
    return 'pendiente';
  }
}

async function panelUserAudit(env, ctx, tenantId, actor, role, note) {
  await env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
    .bind(tenantId, actor, 'users', null, `${note} (rol ${role})`, new Date().toISOString()).run();
  ctx.waitUntil(sendTelegramText(env, `👤 <b>${escapeHtml(actor)}</b> · ${escapeHtml(note)}`).catch(() => {}));
}

// Recibe el tenant entero (no solo el id): el aviso de Telegram DEBE decir de qué
// cliente es el paso — Juan recibió «token recuperado (adopción)» sin saber de quién.
async function provisionAudit(env, ctx, tenant, actor, note) {
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
    .bind(tenant.id, actor, 'provision', null, note, now).run();
  ctx.waitUntil(sendTelegramText(env, `🛠 <b>${escapeHtml(tenant.name)}</b> (${escapeHtml(tenant.slug)}) · ${escapeHtml(note)}\n<i>${escapeHtml(actor)}</i>`).catch(() => {}));
}

// Twilio respondió OK pero D1 no guardó: recurso huérfano con su token perdido.
// Es el único fallo que no se arregla solo — SID al log y alerta para reconciliar.
async function provisionOrphan(env, ctx, tenant, resource, sid, error) {
  console.log(JSON.stringify({ level: 'error', code: 'provision_orphan', tenant: tenant.slug, resource, sid, error: error.code || error.name }));
  ctx.waitUntil(sendTelegramText(env, `🚨 <b>Velai</b>: ${escapeHtml(resource)} <code>${escapeHtml(sid)}</code> creado en Twilio para <b>${escapeHtml(tenant.name)}</b> pero D1 no lo guardó. Reconciliar a mano.`).catch(() => {}));
  throw new HttpError(500, 'provision_orphan');
}

// TwilioError (y cualquier error tipado con status+code) no es HttpError: sin este
// duck-typing, TODO fallo de la API de Twilio salía al panel como «server_error» sin
// pista (así se perdió el fallo real del primer sender/sync de gogestion). Los 500
// auténticos registran además el mensaje real para no volver a diagnosticar a ciegas.
function errorResponseParts(error) {
  const typed = error instanceof HttpError || (Number.isInteger(error && error.status) && typeof (error && error.code) === 'string');
  const status = typed ? error.status : 500;
  const code = typed ? error.code : 'server_error';
  // El why solo aparece cuando existe: añadir la clave con undefined rompe el deepEqual
  // del contrato de esta función, que está fijado por test desde el arreglo de Twilio.
  const why = typed && error.why ? { why: error.why } : {};
  return { status, code, ...why, detail: { ...(status >= 500 ? { error: String((error && error.message) || error).slice(0, 200) } : {}), ...why } };
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

// Perfil de negocio del sender a partir de la marca de la FICHA (una sola fuente para
// widget web y WhatsApp). El display name se relee y se reenvía intacto: la API lo exige
// en el cuerpo y cambiarlo dispara una revisión de Meta.
async function applySenderProfile(env, tenant, credentials) {
  const current = await fetchSender(credentials, tenant.sender_sid);
  const webs = [];
  try {
    const origins = JSON.parse(tenant.web_origins || '[]');
    const first = (Array.isArray(origins) ? origins : []).find((o) => /^https:\/\//.test(o) && !/^https:\/\/www\./.test(o)) || (Array.isArray(origins) ? origins[0] : null);
    if (first) webs.push({ website: first, label: 'Web' });
  } catch (_) { /* web_origins corrupto no bloquea el perfil */ }
  // MÍNIMO y saneado: reenviar el perfil entero del GET metía campos que la API de
  // escritura NO acepta y Twilio contestaba 63100 (validación) sin decir cuál — le pasó
  // al perfil de Diálogos. Solo van los campos que queremos, más el nombre intacto.
  const profile = { name: (current.profile && current.profile.name) || tenant.brand_name || tenant.name };
  const about = clean(tenant.brand_name || tenant.name, 139);
  if (about) profile.about = about;
  const description = clean(tenant.greeting || tenant.brand_name || tenant.name, 512);
  if (description) profile.description = description;
  // La imagen de WhatsApp puede ser distinta de la del widget (Juan, 2026-08-24): se
  // recorta en círculo y pide 640x640, así que muchos negocios quieren el isotipo aquí
  // y el logotipo completo en la web. Sin imagen propia, se usa la del widget.
  const waLogo = tenant.logo_wa_url || tenant.logo_url;
  if (waLogo && /^https:\/\//.test(waLogo)) profile.logo_url = waLogo;
  if (webs.length) profile.websites = webs;
  await updateSenderProfile(credentials, tenant.sender_sid, profile);
  return { logo: !!profile.logo_url, websites: webs.length, description: !!profile.description };
}

// Empuja la marca al perfil de WhatsApp y DEJA CONSTANCIA del resultado: sin este
// registro un fallo en segundo plano es invisible (Diálogos se quedó sin foto sin que
// nada lo dijera). Nunca lanza: el llamante decide si el fallo importa.
async function pushSenderProfile(env, tenant) {
  const at = new Date().toISOString();
  const note = async (data) => { if (env.KV) { try { await env.KV.put(`waprof:${tenant.id}`, JSON.stringify({ at, ...data }), { expirationTtl: 30 * 86400 }); } catch (_) {} } };
  if (!tenant.sender_sid || !tenant.twilio_subaccount_sid) return { skipped: true, error: 'sender_required' };
  try {
    const token = await twilioAuthTokenFor(env, tenant);
    if (!token) { await note({ ok: false, error: 'twilio_auth_token_missing' }); return { error: 'twilio_auth_token_missing' }; }
    const applied = await applySenderProfile(env, tenant, { sid: tenant.twilio_subaccount_sid, token });
    console.log(JSON.stringify({ level: 'info', code: 'sender_profile_synced', tenant: tenant.slug }));
    await note({ ok: true, logo: applied.logo });
    return { ok: true, applied };
  } catch (error) {
    const detail = clean(String(error.message || error), 80);
    const why = clean(String(error.detail || ''), 160);   // el «message» de Twilio: qué campo falla
    console.log(JSON.stringify({ level: 'warn', code: 'sender_profile_sync_failed', tenant: tenant.slug, error: detail, why }));
    await note({ ok: false, error: detail, why });
    return { error: detail, why };
  }
}

async function runProvisionStep(request, env, ctx, tenant, tenantId, step, actor) {
  const now = new Date().toISOString();

  // Sincroniza los hostnames del widget de Turnstile con la allowlist real (entorno +
  // web_origins de TODOS los tenants activos, reconstruida desde D1). Es idempotente:
  // el mismo botón ES la reconciliación. No requiere subcuenta de Twilio.
  if (step === 'domains') {
    const cfEnv = await withCfToken(env);
    if (!cloudflareConfigured(cfEnv)) throw new HttpError(503, 'cloudflare_api_not_configured');
    // Turnstile admite MÁXIMO 10 dominios por widget (verificado: la API rechazó 12 con
    // "too many values") y cubre los subdominios de los listados automáticamente: se
    // sincronizan solo los apex — www.x.com se pliega en x.com sin perder cobertura.
    const hosts = [...new Set((await allowedOrigins(env)).map((o) => { try { return new URL(o).hostname.replace(/^www\./, ''); } catch (_) { return ''; } }).filter(Boolean))];
    if (hosts.length > 10) throw new HttpError(400, 'turnstile_domains_limit');
    try {
      await syncTurnstileDomains(cfEnv, hosts);
    } catch (error) {
      // El estado incoherente peligroso: D1 ya acepta el origen pero Turnstile no
      // emitiría token para ese hostname («No pude verificar que eres humano»).
      console.log(JSON.stringify({ level: 'error', code: 'turnstile_sync_failed', error: String(error.message || error) }));
      ctx.waitUntil(sendTelegramText(env, `⚠️ <b>Velai</b>: el PUT a Turnstile falló al sincronizar dominios para <b>${escapeHtml(tenant.name)}</b>. D1 acepta el origen pero Turnstile no emitirá token: reintentar «Sincronizar Turnstile» o revisar CF_API_TOKEN.`).catch(() => {}));
      throw new HttpError(502, 'turnstile_sync_failed');
    }
    await provisionAudit(env, ctx, tenant, actor, `Turnstile sincronizado desde D1: ${hosts.length} hostnames`);
    return json({ ok: true, hostnames: hosts.length }, 200, NO_STORE);
  }

  if (step === 'subaccount') {
    // CREAR-O-ADOPTAR (pedido de Juan, 2026-08-22, tras topar con la subcuenta vieja
    // de gogestion): (a) SID en la fila sin token → se recupera el token de Twilio y
    // se cifra, sin pegar nada a mano; (b) sin SID pero ya existe cliente-<slug> en
    // Twilio → se ADOPTA en vez de duplicar; (c) solo se crea si no hay nada.
    if (tenant.twilio_subaccount_sid && tenant.twilio_auth_token_enc) throw new HttpError(409, 'already_provisioned');
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) throw new HttpError(503, 'twilio_not_configured');
    // La KEK se comprueba ANTES de gastar dinero: si no puede cifrar, no se crea nada
    // (una subcuenta no se borra, solo se cierra con eliminación a 30 días).
    try { await encryptSecret(env, tenantId, 'probe'); }
    catch (_) { throw new HttpError(503, 'kek_not_configured'); }
    if (tenant.twilio_subaccount_sid) {
      // (a) recuperar el token de la subcuenta ya anotada en la fila
      const found = await fetchSubaccount(env, tenant.twilio_subaccount_sid);
      if (!found || !found.authToken || found.status !== 'active') throw new HttpError(400, 'subaccount_unusable');
      const enc = await encryptSecret(env, tenantId, found.authToken);
      await env.DB.prepare('UPDATE tenants SET twilio_auth_token_enc=?, updated_at=? WHERE id=? AND twilio_auth_token_enc IS NULL')
        .bind(enc, now, tenantId).run();
      await invalidateTenantCache(env, [tenant]);
      await provisionAudit(env, ctx, tenant, actor, `token de la subcuenta ${found.sid} recuperado de Twilio y cifrado (adopción)`);
      return json({ ok: true, sid: found.sid, adopted: true }, 200, NO_STORE);
    }
    const existing = await findSubaccountByName(env, `cliente-${tenant.slug}`);
    if (existing && existing.authToken) {
      // (b) adoptar la subcuenta preexistente con ese nombre — cero duplicados
      const enc = await encryptSecret(env, tenantId, existing.authToken);
      const res = await env.DB.prepare('UPDATE tenants SET twilio_subaccount_sid=?, twilio_auth_token_enc=?, provisioned_at=?, updated_at=? WHERE id=? AND twilio_subaccount_sid IS NULL')
        .bind(existing.sid, enc, now, now, tenantId).run();
      if (!res.meta.changes) throw new HttpError(409, 'already_provisioned');
      await invalidateTenantCache(env, [tenant]);
      await provisionAudit(env, ctx, tenant, actor, `subcuenta preexistente ${existing.sid} (cliente-${tenant.slug}) adoptada con su token cifrado`);
      return json({ ok: true, sid: existing.sid, adopted: true }, 200, NO_STORE);
    }
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
    await provisionAudit(env, ctx, tenant, actor, `subcuenta ${created.sid} creada (token cifrado en el acto)`);
    return json({ ok: true, sid: created.sid }, 201, NO_STORE);
  }

  // Los pasos siguientes operan recursos DE la subcuenta: credenciales DE la subcuenta.
  if (!tenant.twilio_subaccount_sid) throw new HttpError(400, 'subaccount_required');
  const token = await twilioAuthTokenFor(env, tenant);
  if (!token) throw new HttpError(400, 'twilio_auth_token_missing');
  const credentials = { sid: tenant.twilio_subaccount_sid, token };

  // REENVIAR a aprobación una plantilla que ya existe en Twilio. Descubierto con gogestión
  // (2026-08-24): Twilio aceptó el submit —quedó su línea de auditoría— pero la WABA de Meta
  // tenía CERO plantillas, así que el `pending` de la fila era una espera que no iba a
  // resolverse jamás. Y el paso 2 lanza 409 si ya hay SID, con lo que el panel te dejaba
  // atascado justo cuando había que reintentar. Devuelve el crudo: si Twilio rechaza el
  // reenvío (duplicado, categoría, nombre), el motivo se ve en vez de deducirse.
  if (step === 'template/resubmit') {
    if (!tenant.lead_template_sid) throw new HttpError(400, 'template_required');
    let sent = null; let error = null;
    try {
      sent = await submitTemplateApproval(credentials, tenant.lead_template_sid, `nuevo_lead_${tenant.slug}`);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      error = clean(e.message, 120);
    }
    if (!error) {
      await env.DB.prepare("UPDATE tenants SET lead_template_status='pending', updated_at=? WHERE id=?").bind(now, tenantId).run();
      await invalidateTenantCache(env, [tenant]);
    }
    await provisionAudit(env, ctx, tenant, actor,
      `plantilla ${tenant.lead_template_sid} REENVIADA a aprobación${error ? ` — Twilio la rechazó: ${error}` : ''}`);
    return json({ ok: !error, sid: tenant.lead_template_sid, error, raw: sent }, error ? 502 : 200, NO_STORE);
  }

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
    await provisionAudit(env, ctx, tenant, actor, `plantilla nuevo_lead_${tenant.slug} (${contentSid}) enviada a aprobación Utility`);
    await invalidateTenantCache(env, [tenant]);
    return json({ ok: true, sid: contentSid, status: 'pending' }, 201, NO_STORE);
  }

  // Perfil de negocio del sender: la MISMA marca de la ficha (logo, descripción, web)
  // pasa a ser la foto y los datos que ve el cliente final en WhatsApp. Un solo sitio de
  // configuración para todos los canales (pedido de Juan, 2026-08-22).
  if (step === 'sender/profile') {
    if (!tenant.sender_sid) throw new HttpError(400, 'sender_required');
    if (!tenant.logo_url && !tenant.brand_name) throw new HttpError(400, 'brand_empty');
    const applied = await applySenderProfile(env, tenant, credentials);
    await provisionAudit(env, ctx, tenant, actor, `perfil de WhatsApp actualizado con la marca de la ficha${applied.logo ? ' (con foto)' : ' (sin foto: falta el logo)'}`);
    return json({ ok: true, applied }, 200, NO_STORE);
  }

  // Comprobar la plantilla AHORA, sin esperar al cron de 5 min, y con el crudo de Twilio
  // delante: es la única forma de distinguir «Meta va lenta» de «lo estamos leyendo mal».
  // Si Twilio ya dice approved/rejected, se aplica aquí mismo en vez de esperar otra vuelta.
  if (step === 'template/check') {
    if (!tenant.lead_template_sid) throw new HttpError(400, 'template_required');
    const approval = await fetchApprovalStatus(credentials, tenant.lead_template_sid);
    let applied = false;
    if ((approval.status === 'approved' || approval.status === 'rejected') && approval.status !== tenant.lead_template_status) {
      await env.DB.prepare('UPDATE tenants SET lead_template_status=?, updated_at=? WHERE id=?').bind(approval.status, now, tenantId).run();
      await invalidateTenantCache(env, [tenant]);
      await provisionAudit(env, ctx, tenant, actor, `plantilla ${approval.status} según Twilio${approval.reason ? ` (${clean(approval.reason, 120)})` : ''}`);
      applied = true;
    }
    return json({ ok: true, status: approval.status, reason: approval.reason, applied,
      stored: tenant.lead_template_status, sid: tenant.lead_template_sid, raw: approval.raw }, 200, NO_STORE);
  }

  if (step === 'sender/sync') {
    // Reconciliación de LECTURA (SPEC-CONEXIONES PR2): tras el Self Sign-up del
    // cliente en la consola, el worker lee el sender de la subcuenta y rellena la
    // fila solo. Idempotente y NO destructivo: channel_address y twilio_from no se
    // pisan si ya tienen valor — channel_address es UNIQUE y enruta TODOS los
    // webhooks del cliente; pisarlo por una lectura dejaría al tenant sin atender.
    const senders = await listWhatsAppSenders(credentials);
    if (!senders.length) throw new HttpError(404, 'sender_not_found');
    if (senders.length > 1) throw new HttpError(409, 'multiple_senders'); // decidir a mano, no adivinar
    const s = senders[0];
    const phone = s.senderId;
    const proposed = { waba_id: s.wabaId, sender_sid: s.senderSid, sender_status: s.status, twilio_from: phone, channel_address: phone };
    const sets = []; const args = [];
    for (const [col, val] of Object.entries(proposed)) {
      if (!val) continue;
      if ((col === 'channel_address' || col === 'twilio_from') && tenant[col]) continue; // ya puesto: se informa, no se pisa
      sets.push(`${col}=?`); args.push(val);
    }
    if (sets.length) {
      await env.DB.prepare(`UPDATE tenants SET ${sets.join(',')}, updated_at=? WHERE id=?`).bind(...args, now, tenantId).run();
      await invalidateTenantCache(env, [tenant]);
    }
    // El ENRUTADO vive en tenant_channels, no en las columnas de arriba. Un tenant que
    // ya tenía canal web (channel_address='web:<slug>') no recibe el número por el
    // bucle anterior — se lo salta a propósito para no pisarlo — y sin fila aquí el
    // webhook entrante no resuelve tenant: 404 unknown_tenant y bot MUDO con el sender
    // en ONLINE (le pasó a gogestion, 2026-08-24). Registrar el canal es el paso que
    // de verdad enciende WhatsApp, así que va siempre, no solo cuando sets.length.
    let channelRegistered = false;
    try {
      await assertChannelFree(env, phone, tenantId);
      await syncPrimaryChannel(env, tenantId, null, phone);
      channelRegistered = true;
      await invalidateTenantCache(env, [tenant]); // ahora sí barre `tenant:addr:<numero>`
    } catch (error) {
      // 409 address_taken: el número enruta a OTRO cliente. No se toca — se informa.
      if (!(error instanceof HttpError)) throw error;
      console.log(JSON.stringify({ level: 'error', code: 'sender_channel_not_registered', tenant: tenant.slug, error: error.code }));
    }
    // El Self Sign-up deja el webhook en el default de Twilio: sender verde y bot
    // mudo. Si no apunta al worker, se repara AQUÍ y se informa del resultado.
    let webhookOk = s.webhookUrl === WORKER_PUBLIC_URL;
    let webhookFixed = false;
    if (!webhookOk) {
      try { await updateSenderWebhook(credentials, s.senderSid, WORKER_PUBLIC_URL); webhookOk = true; webhookFixed = true; }
      catch (error) { console.log(JSON.stringify({ level: 'error', code: 'sender_webhook_fix_failed', tenant: tenant.slug, error: clean(error.message, 60) })); }
    }
    await provisionAudit(env, ctx, tenant, actor, `sender sincronizado desde Twilio (${s.senderSid}, ${s.status})${webhookFixed ? ' + webhook reparado' : ''}${channelRegistered ? ` + canal ${phone} enrutado` : ''}`);
    return json({
      ok: true, applied: sets.length, sender: { senderSid: s.senderSid, senderId: s.senderId, status: s.status, wabaId: s.wabaId },
      conflicts: ['channel_address', 'twilio_from'].filter((c) => tenant[c] && tenant[c] !== phone).map((c) => ({ field: c, current: tenant[c], fromTwilio: phone })),
      webhookOk, webhookFixed, channelRegistered,
    }, 200, NO_STORE);
  }

  if (step === 'sender') {
    if (tenant.sender_sid) throw new HttpError(409, 'already_provisioned');
    if (!tenant.waba_id) throw new HttpError(400, 'waba_required');
    const body = await readJson(request, 2000);
    const phone = clean(body.phone, 20);
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new HttpError(400, 'invalid_phone');
    const created = await createWhatsAppSender(credentials, { phone, wabaId: tenant.waba_id, callbackUrl: WORKER_PUBLIC_URL });
    try {
      const res = await env.DB.prepare('UPDATE tenants SET sender_sid=?, sender_status=?, updated_at=? WHERE id=? AND sender_sid IS NULL')
        .bind(created.senderSid, created.status || 'CREATING', now, tenantId).run();
      if (!res.meta.changes) await provisionOrphan(env, ctx, tenant, 'sender (carrera)', created.senderSid, new Error('already_provisioned'));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      await provisionOrphan(env, ctx, tenant, 'sender', created.senderSid, error);
    }
    await provisionAudit(env, ctx, tenant, actor, `sender whatsapp:${phone} creado (${created.senderSid})`);
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
    await provisionAudit(env, ctx, tenant, actor, `OTP del sender enviado (estado ${result.status})`);
    await invalidateTenantCache(env, [tenant]);
    return json({ ok: true, status: result.status }, 200, NO_STORE);
  }

  throw new HttpError(404, 'not_found');
}

// ── Identidad → alcance (SPEC-HANDOFF §B) ────────────────────────────────────
// Access dice QUIÉN eres; esto dice QUÉ puedes ver. Sin coincidencia no se entra:
// que Access te deje pasar no te autoriza a ver leads de nadie. Los admins van en
// ADMIN_EMAILS (var), nunca en la tabla: una fila borrada no deja a Velai fuera.
// Admins raíz: los del entorno, indestructibles (ninguna operación del panel los toca).
function envAdmins(env) {
  return clean(env.ADMIN_EMAILS, 500).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}

async function resolveScope(env, email) {
  const who = String(email).toLowerCase();
  if (envAdmins(env).includes(who)) return { role: 'velai', tenantId: null, email };
  // Admins gestionados desde el panel (admin_users, migración 0009). En try/catch:
  // si la tabla aún no existe, el panel no se cae — simplemente no hay admins de D1.
  try {
    const admin = await env.DB.prepare('SELECT email FROM admin_users WHERE lower(email) = ?').bind(who).first();
    if (admin) return { role: 'velai', tenantId: null, email };
  } catch (_) {}
  const row = await env.DB.prepare('SELECT tenant_id, role FROM tenant_users WHERE lower(email) = ?')
    .bind(who).first();
  if (!row) throw new HttpError(403, 'not_authorized');
  return { role: 'cliente', tenantId: row.tenant_id, email };
}

// Único punto de paso del aislamiento (NO NEGOCIABLE): con tenantId la condición
// filtra; con null (Velai) se anula. Ningún endpoint construye SQL de leads —ni de
// conversaciones— sin esto. El alias es parámetro para que las tablas nuevas usen ESTA
// función en vez de escribirse su propio filtro: un segundo punto de paso es un agujero.
function scopeClause(scope, alias = 'l') {
  return scope.tenantId
    ? { sql: ` AND ${alias}.tenant_id = ?`, args: [scope.tenantId] }
    : { sql: '', args: [] };
}

// La OTRA mitad del aislamiento. scopeClause filtra listados; esto cierra los recursos
// direccionados por su id en la ruta (/tenants/:id/...), donde no hay listado que filtrar
// y la única defensa es comprobar que ese id es el tuyo ANTES de leer la fila.
// Ajeno = 404 y nunca 403: un 403 confirmaría que el tenant existe.
// Estaba escrita a mano en nueve sitios; ahora tiene nombre para que check-aislamiento.mjs
// pueda exigirla y para que la puerta número diez no se escriba distinta.
function assertOwnTenant(scope, tenantId) {
  if (scope.role !== 'velai' && scope.tenantId !== tenantId) throw new HttpError(404, 'not_found');
  return tenantId;
}

// Rutas que el rol cliente SÍ puede usar. Todo lo demás — tenants, provisioning,
// preview, versiones, retry, borrado RGPD — es 403 ANTES de tocar datos.
function clienteAllowed(path, method) {
  if (path === '/api/admin/leads' && method === 'GET') return true;
  if (path === '/api/admin/leads/export.csv' && method === 'GET') return true;
  if (path === '/api/admin/appointments' && method === 'GET') return true;
  // Calendario en autoservicio: el cliente conecta y gestiona SU calendario. El
  // handler exige que el :id sea el suyo (ajeno = 404, nunca 403).
  if (/^\/api\/admin\/tenants\/[0-9a-f-]+\/calendar$/i.test(path) && ['GET', 'PATCH', 'DELETE'].includes(method)) return true;
  if (/^\/api\/admin\/tenants\/[0-9a-f-]+\/calendar\/connect$/i.test(path) && method === 'POST') return true;
  // Telegram en autoservicio (SPEC-CONEXIONES PR1): mismo molde que el calendario.
  if (/^\/api\/admin\/tenants\/[0-9a-f-]+\/telegram$/i.test(path) && ['GET', 'DELETE'].includes(method)) return true;
  if (/^\/api\/admin\/tenants\/[0-9a-f-]+\/telegram\/link$/i.test(path) && method === 'POST') return true;
  if (/^\/api\/admin\/tenants\/[0-9a-f-]+\/telegram\/bot$/i.test(path) && ['POST', 'DELETE'].includes(method)) return true;
  if (/^\/api\/admin\/tenants\/[0-9a-f-]+\/whatsapp$/i.test(path) && method === 'GET') return true;
  // Sus canales, en su espacio. El handler colapsa los estados de diagnóstico y exige que
  // el :id sea el suyo. La vista GLOBAL de canales sigue siendo solo de Velai: lleva
  // números y nombres de otros clientes.
  if (/^\/api\/admin\/tenants\/[0-9a-f-]+\/channels$/i.test(path) && method === 'GET') return true;
  if (/^\/api\/admin\/tenants\/[0-9a-f-]+\/notify$/i.test(path) && method === 'PATCH') return true;
  // Probar SU informe semanal en SU grupo: el handler exige que el :id sea el suyo.
  if (/^\/api\/admin\/tenants\/[0-9a-f-]+\/report\/test$/i.test(path) && method === 'POST') return true;
  // Su logo es SU marca: el cliente lo sube desde Conexiones (el handler exige que el
  // :id sea el suyo — ajeno = 404) y de paso se aplica a su foto de WhatsApp.
  if (/^\/api\/admin\/tenants\/[0-9a-f-]+\/logo$/i.test(path) && method === 'POST') return true;
  // Aplicar a WhatsApp el logo que YA está guardado: volver a subir la misma imagen no
  // tiene sentido (Juan, 2026-08-24). Idempotente y con guarda own-only en el handler.
  if (/^\/api\/admin\/tenants\/[0-9a-f-]+\/logo\/apply$/i.test(path) && method === 'POST') return true;
  if (/^\/api\/admin\/tenants\/[0-9a-f-]+\/telegram\/topics$/i.test(path) && method === 'POST') return true;
  if (/^\/api\/admin\/tenants\/[0-9a-f-]+\/telegram\/topics\/\d+$/i.test(path) && ['PATCH', 'DELETE'].includes(method)) return true;
  if (path === '/api/admin/stats' && method === 'GET') return true;
  // Su saldo de IA: el handler lo fuerza a su propio tenant y no devuelve coste.
  if (path === '/api/admin/ai-balance' && method === 'GET') return true;
  if (path === '/api/admin/me' && method === 'GET') return true;
  if (path === '/api/admin/escalations' && method === 'GET') return true;
  // Sus conversaciones, en su espacio: el scope las filtra por tenant y el detalle exige
  // que la conversación sea suya (ajena = 404, nunca 403).
  if (path === '/api/admin/conversations' && method === 'GET') return true;
  if (path === '/api/admin/conversations/export.csv' && method === 'GET') return true;
  if (/^\/api\/admin\/conversations\/[0-9a-f-]+$/i.test(path) && method === 'GET') return true;
  // Su bandeja y sus respuestas: el scope filtra y el handler exige que la conversación
  // sea suya (ajena = 404).
  if (path === '/api/admin/inbox' && method === 'GET') return true;
  if (path === '/api/admin/alerts' && method === 'GET') return true;
  // Su disponibilidad y el control de SUS conversaciones (el handler exige que sean suyas).
  if (path === '/api/admin/availability' && ['GET', 'PATCH'].includes(method)) return true;
  if (/^\/api\/admin\/conversations\/[0-9a-f-]+\/(takeover|release)$/i.test(path) && method === 'POST') return true;
  if (/^\/api\/admin\/conversations\/[0-9a-f-]+\/reply$/i.test(path) && method === 'POST') return true;
  if (path === '/api/admin/escalations/resume' && method === 'POST') return true;
  if (/^\/api\/admin\/leads\/[0-9a-f-]+$/i.test(path) && (method === 'GET' || method === 'PATCH')) return true;
  if (/^\/api\/admin\/leads\/[0-9a-f-]+\/notes$/i.test(path) && method === 'POST') return true;
  return false;
}

// Con la política de Access en OTP-para-cualquier-correo (SPEC-USUARIOS §B.1), el 403
// de resolveScope pasa a ser la única cerradura. Tres compensaciones: registrar cada
// intento CON el correo (excepción deliberada a la regla de no-PII en logs — sin el
// correo no hay forense), alertar a la 3ª en una hora, y rate limit por correo.
async function recordAuthFailure(env, email) {
  const who = String(email || '').toLowerCase().slice(0, 200);
  console.log(JSON.stringify({ level: 'warn', code: 'not_authorized', email: who }));
  if (!env.KV) return;
  try {
    const key = `authfail:${who}`;
    const attempts = Number(await env.KV.get(key) || 0) + 1;
    await env.KV.put(key, String(attempts), { expirationTtl: 3600 });
    // Solo en el tercer intento: ni al primero (ruido de altas a medias) ni en cada
    // uno posterior (el contador sigue subiendo pero la alerta ya salió esta hora).
    if (attempts === 3) {
      await sendTelegramText(env, `🔐 <b>Velai</b>: el correo <code>${escapeHtml(who)}</code> pasó Access pero acumula ${attempts} intentos sin autorización en la última hora.`);
    }
  } catch (_) {}
}

async function handleAdmin(request, env, ctx, path, url, config) {
  adminCorsGuard(request, env);
  const identity = await adminIdentity(request, env);
  if (!env.DB) throw new HttpError(503, 'lead_storage_not_configured');
  if (await rateLimited(env, String(identity).toLowerCase(), 'admin', 120)) throw new HttpError(429, 'rate_limited');
  let scope;
  try {
    scope = await resolveScope(env, identity);
  } catch (e) {
    if (e instanceof HttpError && e.code === 'not_authorized') ctx.waitUntil(recordAuthFailure(env, identity));
    throw e;
  }
  return adminRouter(request, env, ctx, path, url, config, scope);
}

async function adminRouter(request, env, ctx, path, url, config, scope) {
  const actor = scope.email;
  if (scope.role !== 'velai' && !clienteAllowed(path, request.method)) throw new HttpError(403, 'not_authorized');
  const sc = scopeClause(scope);

  if (path === '/api/admin/me' && request.method === 'GET') {
    let tenantName = null; let tenantLogo = null;
    if (scope.tenantId) {
      const row = await env.DB.prepare('SELECT name, logo_url FROM tenants WHERE id=?').bind(scope.tenantId).first();
      tenantName = row ? row.name : null;
      // El panel del cliente se viste con SU logo en cuanto lo sube (pedido de Juan).
      tenantLogo = row && row.logo_url && /^https:\/\//.test(row.logo_url) ? row.logo_url : null;
    }
    // tenantId: el cliente lo necesita para llamar a SUS rutas de calendario
    // (/tenants/:id/calendar); es su propio id, no filtra nada ajeno.
    return json({ role: scope.role, tenantName, tenantLogo, tenantId: scope.tenantId }, 200, NO_STORE);
  }

  if (path === '/api/admin/escalations' && request.method === 'GET') {
    if (!env.KV) return json({ escalations: [] }, 200, NO_STORE);
    const prefix = scope.tenantId ? `pause:${scope.tenantId}:` : 'pause:';
    const list = await env.KV.list({ prefix, limit: 100 });
    const escalations = list.keys.map((k) => {
      const rest = k.name.slice('pause:'.length);
      const cut = rest.indexOf(':');
      return { tenantId: rest.slice(0, cut), from: rest.slice(cut + 1) };
    });
    return json({ escalations }, 200, NO_STORE);
  }
  if (path === '/api/admin/escalations/resume' && request.method === 'POST') {
    const body = await readJson(request, 2000);
    // Un cliente solo puede reanudar SUS conversaciones: su tenantId manda.
    const tenantId = scope.tenantId || clean(body.tenantId, 40);
    const from = clean(body.from, 80);
    if (!tenantId || !from) throw new HttpError(400, 'invalid_resume');
    if (env.KV) { try { await env.KV.delete(`pause:${tenantId}:${from}`); } catch (_) {} }
    console.log(JSON.stringify({ level: 'info', code: 'bot_resumed', actor_role: scope.role }));
    return json({ ok: true }, 200, NO_STORE);
  }

  if (path === '/api/admin/leads' && request.method === 'GET') {
    const filters = leadFilters(url);
    // Sin ?limit el default es 50: Number(null) es 0 (finito) y el clamp lo convertía
    // en 1 — el panel paginaba de lead en lead. NaN/0/'' caen todos al default.
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50)); // NaN en LIMIT = sin límite en SQLite
    // Cursor por tupla (created_at, id): un created_at repetido en el borde de página no salta leads.
    const cursor = clean(url.searchParams.get('cursor'), 80);
    if (cursor) {
      const [cAt, cId] = cursor.split('|');
      if (cId) { filters.sql += ' AND (l.created_at < ? OR (l.created_at = ? AND l.id < ?))'; filters.values.push(cAt, cAt, cId); }
      else { filters.sql += ' AND l.created_at < ?'; filters.values.push(cAt); }
    }
    const result = await env.DB.prepare(`SELECT l.*, t.name AS tenant_name, GROUP_CONCAT(n.channel || ':' || n.status) notification_summary FROM leads l LEFT JOIN tenants t ON t.id=l.tenant_id LEFT JOIN lead_notifications n ON n.lead_id=l.id WHERE ${filters.sql}${sc.sql} GROUP BY l.id ORDER BY l.created_at DESC, l.id DESC LIMIT ?`).bind(...filters.values, ...sc.args, limit + 1).all();
    const rows = result.results; const more = rows.length > limit; if (more) rows.pop();
    // Un cliente nunca recibe nombres de tenant (el suyo va en su cabecera).
    if (scope.role !== 'velai') for (const row of rows) { delete row.tenant_name; delete row.tenant_id; }
    return json({ leads: rows, nextCursor: more ? `${rows.at(-1).created_at}|${rows.at(-1).id}` : null }, 200, NO_STORE);
  }
  if (path === '/api/admin/leads/export.csv' && request.method === 'GET') {
    const filters = leadFilters(url);
    const rows = (await env.DB.prepare(`SELECT l.created_at,l.status,t.name AS tenant_name,l.source,l.name,l.whatsapp,l.need,l.context,l.sector,l.messages_per_day,l.channel,l.score,l.note,l.page_url FROM leads l LEFT JOIN tenants t ON t.id=l.tenant_id WHERE ${filters.sql}${sc.sql} ORDER BY l.created_at DESC LIMIT 5000`).bind(...filters.values, ...sc.args).all()).results;
    // need/context van DELANTE de sector: es lo que lee quien va a llamar, y sector viene
    // vacío en casi todo lead de cliente (es un concepto del embudo de Velai).
    const keys = scope.role === 'velai'
      ? ['created_at','status','tenant_name','source','name','whatsapp','need','context','sector','messages_per_day','channel','score','note','page_url']
      : ['created_at','status','source','name','whatsapp','need','context','sector','messages_per_day','channel','score','note','page_url'];
    const csv = [keys.join(','), ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(','))].join('\r\n');
    return new Response('\uFEFF' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="velai-leads.csv"', 'Cache-Control': 'no-store' } });
  }

  // ── Conversaciones (migración 0021) ────────────────────────────────────────
  // El hueco de paridad número uno: hasta ahora la conversación vivía en KV con TTL de
  // 24 h y cuando un lead salía mal no había forma de mirar qué pasó.
  if (path === '/api/admin/conversations' && request.method === 'GET') {
    const f = convFilters(url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    // Mismo cursor por tupla que los leads: un last_at repetido en el borde de página no
    // se salta conversaciones.
    const cursor = clean(url.searchParams.get('cursor'), 80);
    if (cursor) {
      const [cAt, cId] = cursor.split('|');
      if (cId) { f.sql += ' AND (c.last_at < ? OR (c.last_at = ? AND c.id < ?))'; f.values.push(cAt, cAt, cId); }
      else { f.sql += ' AND c.last_at < ?'; f.values.push(cAt); }
    }
    const scc = scopeClause(scope, 'c');
    const rows = (await env.DB.prepare(`
      SELECT c.id, c.channel, c.msgs, c.unanswered, c.started_at, c.last_at, c.lead_id,
             c.demo <> '' AS is_demo, t.name AS tenant_name, c.tenant_id,
             l.name AS lead_name, l.status AS lead_status
      FROM conversations c
      LEFT JOIN tenants t ON t.id = c.tenant_id
      LEFT JOIN leads l ON l.id = c.lead_id
      WHERE ${f.sql}${scc.sql} ORDER BY c.last_at DESC, c.id DESC LIMIT ?`)
      .bind(...f.values, ...scc.args, limit + 1).all()).results;
    const more = rows.length > limit; if (more) rows.pop();
    // Un cliente nunca recibe nombres de otros tenants (el suyo va en su cabecera).
    if (scope.role !== 'velai') for (const row of rows) { delete row.tenant_name; delete row.tenant_id; }
    return json({ conversations: rows, nextCursor: more ? `${rows.at(-1).last_at}|${rows.at(-1).id}` : null }, 200, NO_STORE);
  }
  if (path === '/api/admin/conversations/export.csv' && request.method === 'GET') {
    const f = convFilters(url);
    const scc = scopeClause(scope, 'c');
    // Un mensaje por fila, con la conversación como columna: es el formato que sirve
    // para leer en una hoja de cálculo, y el que pide un cliente que quiere auditar.
    const rows = (await env.DB.prepare(`
      SELECT c.id AS conversacion, c.channel AS canal, m.created_at AS fecha, m.role AS quien, m.text AS mensaje
      FROM conversations c JOIN conv_messages m ON m.conversation_id = c.id
      LEFT JOIN leads l ON l.id = c.lead_id
      WHERE ${f.sql}${scc.sql} ORDER BY c.last_at DESC, c.id DESC, m.id ASC LIMIT 20000`)
      .bind(...f.values, ...scc.args).all()).results;
    const keys = ['conversacion', 'canal', 'fecha', 'quien', 'mensaje'];
    const csv = [keys.join(','), ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(','))].join('\r\n');
    return new Response('\uFEFF' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="velai-conversaciones.csv"', 'Cache-Control': 'no-store' } });
  }
  // ── Bandeja: lista + hilo abierto en UNA llamada (docs/H2-BANDEJA.md §5) ────
  // Un solo endpoint porque el panel hace polling: dos llamadas cada 5 s con seis paneles
  // abiertos son 35.000 peticiones/día, un tercio del plan gratuito de Workers en
  // refrescar una pantalla. Con una cada 15 s y solo con la pestaña visible, ~11.500.
  if (path === '/api/admin/inbox' && request.method === 'GET') {
    const f = convFilters(url);
    const scc = scopeClause(scope, 'c');
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 40));
    const rows = (await env.DB.prepare(`
      SELECT c.id, c.channel, c.external_id, c.msgs, c.unanswered, c.last_at, c.lead_id,
             (c.last_read_at IS NULL OR c.last_read_at < c.last_at) AS unread,
             c.state, c.state_at, c.agent_email,
             t.name AS tenant_name, c.tenant_id, l.name AS lead_name, l.status AS lead_status,
             (SELECT m.text FROM conv_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS preview,
             (SELECT m.role FROM conv_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS preview_role
      FROM conversations c
      LEFT JOIN tenants t ON t.id = c.tenant_id
      LEFT JOIN leads l ON l.id = c.lead_id
      WHERE ${f.sql}${scc.sql}
      -- Lo que ESPERA a que alguien lo tome va primero, y lo más antiguo antes: con varias
      -- en cola, atender por «lo último que llegó» es dejar tirado justo al que más lleva.
      ORDER BY CASE c.state WHEN 'esperando' THEN 0 WHEN 'humano' THEN 1 ELSE 2 END,
               CASE WHEN c.state = 'esperando' THEN c.state_at END ASC,
               c.last_at DESC
      LIMIT ?`)
      .bind(...f.values, ...scc.args, limit).all()).results;
    // Contadores por canal para las pestañas: se cuentan SOBRE EL MISMO filtro de scope,
    // no sobre el de canal — si no, la pestaña activa se contaría a sí misma y las demás
    // saldrían a cero.
    const counts = (await env.DB.prepare(`SELECT channel, COUNT(*) AS n,
        SUM(CASE WHEN last_read_at IS NULL OR last_read_at < last_at THEN 1 ELSE 0 END) AS unread,
        SUM(CASE WHEN state = 'esperando' THEN 1 ELSE 0 END) AS waiting
      FROM conversations c WHERE demo = ''${scc.sql} GROUP BY channel`).bind(...scc.args).all()).results;
    if (scope.role !== 'velai') for (const row of rows) { delete row.tenant_name; delete row.tenant_id; }
    let thread = null;
    const wanted = clean(url.searchParams.get('conversation'), 40);
    if (wanted && UUID_RE.test(wanted)) {
      const head = await env.DB.prepare(`SELECT c.*, t.name AS tenant_name FROM conversations c
        LEFT JOIN tenants t ON t.id = c.tenant_id WHERE c.id=?${scc.sql}`).bind(wanted, ...scc.args).first();
      if (head) {
        const messages = (await env.DB.prepare('SELECT role, agent_email, text, created_at FROM conv_messages WHERE conversation_id=? ORDER BY id ASC LIMIT 500').bind(head.id).all()).results;
        const win = await replyWindow(env, head);
        // La misma puerta que el endpoint de respuesta, pero ANTES: el cajón se cierra con
        // el motivo escrito en vez de dejar que alguien escriba y se coma un 403.
        if (!(await canAttend(env, scope, head.tenant_id))) { win.open = false; win.reason = 'velai_no_atiende_clientes'; }
        // Marcar leído SOLO si hay algo nuevo: en un polling cada 15 s, un UPDATE
        // incondicional serían 1.900 escrituras al día por panel abierto para nada.
        if (!head.last_read_at || head.last_read_at < head.last_at) {
          await env.DB.prepare('UPDATE conversations SET last_read_at=? WHERE id=?').bind(new Date().toISOString(), head.id).run();
        }
        // El token cifrado del bot y el interno del tenant no salen del worker.
        delete head.demo; if (scope.role !== 'velai') { delete head.tenant_name; delete head.tenant_id; }
        thread = { conversation: head, messages, window: win };
      }
    }
    // queueMin viaja para que el panel pinte la cuenta atrás con el MISMO número que usa el
    // worker: si se escribiera a mano en el panel, un día dirían cosas distintas.
    return json({ conversations: rows, counts, thread, queueMin: QUEUE_MAX_MIN, pingMin: TAKEOVER_GRACE_MIN }, 200, NO_STORE);
  }

  // Aviso de mensajes nuevos. Deliberadamente MÍNIMO: lo sondea el panel cada 30 segundos
  // incluso con la pestaña oculta (es el caso que hay que cubrir), así que es una sola
  // consulta agregada sobre una tabla pequeña y devuelve tres números, nada más.
  if (path === '/api/admin/alerts' && request.method === 'GET') {
    const scc = scopeClause(scope, 'c');
    const row = await env.DB.prepare(`SELECT
        SUM(CASE WHEN c.state = 'esperando' THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN c.last_read_at IS NULL OR c.last_read_at < c.last_at THEN 1 ELSE 0 END) AS unread,
        MAX(c.last_inbound_at) AS lastInbound
      FROM conversations c WHERE c.demo = ''${scc.sql}`).bind(...scc.args).first();
    return json({
      waiting: Number(row && row.waiting) || 0,
      unread: Number(row && row.unread) || 0,
      lastInbound: (row && row.lastInbound) || null,
    }, 200, NO_STORE);
  }

  // Disponibilidad de la persona que mira el panel. El interruptor es POR PERSONA; el
  // horario es del cliente y lo cierra por fuera (docs/H2-HANDOFF.md).
  if (path === '/api/admin/availability' && ['GET', 'PATCH'].includes(request.method)) {
    // Velai solo puede estar disponible para SUS conversaciones: el ?tenant= se ignora a
    // propósito, porque no hay nada que elegir.
    const asked = clean(url.searchParams.get('tenant'), 40);
    if (scope.tenantId && asked && asked !== scope.tenantId) throw new HttpError(404, 'not_found');
    const tenantId = scope.tenantId || await velaiTenantId(env);
    if (!tenantId) throw new HttpError(503, 'velai_tenant_missing');
    const tenantRow = await env.DB.prepare('SELECT id, name, support_hours, support_tz FROM tenants WHERE id=?').bind(tenantId).first();
    if (!tenantRow) throw new HttpError(404, 'not_found');
    if (request.method === 'PATCH') {
      const body = await readJson(request, 2000);
      const on = body.available ? 1 : 0;
      const now = new Date().toISOString();
      await env.DB.prepare(`INSERT INTO agent_presence (tenant_id,email,available,updated_at) VALUES (?,?,?,?)
        ON CONFLICT(tenant_id,email) DO UPDATE SET available=excluded.available, updated_at=excluded.updated_at`)
        .bind(tenantId, String(actor).toLowerCase(), on, now).run();
      console.log(JSON.stringify({ level: 'info', code: 'agent_availability', available: on === 1, actor_role: scope.role }));
    }
    const mine = await env.DB.prepare('SELECT available FROM agent_presence WHERE tenant_id=? AND email=?')
      .bind(tenantId, String(actor).toLowerCase()).first();
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM agent_presence WHERE tenant_id=? AND available=1').bind(tenantId).first();
    const dentro = withinSupportHours(tenantRow);
    return json({
      available: Boolean(mine && mine.available),
      withinHours: dentro,
      // Lo que de verdad decide si se ofrece un asesor: el interruptor Y el horario.
      offering: dentro && Number(total && total.n) > 0,
      advisors: Number(total && total.n) || 0,
      hours: tenantRow.support_hours ? JSON.parse(tenantRow.support_hours) : DEFAULT_BUSINESS_HOURS,
      tz: tenantRow.support_tz || 'Europe/Madrid',
      graceMin: TAKEOVER_GRACE_MIN,
      // Para quién es esta disponibilidad. El panel lo enseña porque un admin de Velai ve
      // conversaciones de todos y tiene que saber que solo cubre las de Velai.
      forTenant: tenantRow.name || null,
    }, 200, NO_STORE);
  }

  // Tomar / devolver el control de una conversación. Es un CERROJO de una conversación, no
  // una cola con dueños: la asignación sigue descartada en PLAN-PANEL.md.
  const ctrlMatch = path.match(/^\/api\/admin\/conversations\/([0-9a-f-]+)\/(takeover|release)$/i);
  if (ctrlMatch && request.method === 'POST') {
    if (!UUID_RE.test(ctrlMatch[1])) throw new HttpError(404, 'not_found');
    const scc = scopeClause(scope, 'c');
    const conv = await env.DB.prepare(`SELECT c.id, c.state, c.agent_email, c.channel, c.tenant_id, c.external_id, c.inbox_address, c.demo, c.msgs FROM conversations c WHERE c.id=?${scc.sql}`)
      .bind(ctrlMatch[1], ...scc.args).first();
    if (!conv) throw new HttpError(404, 'not_found');
    // 403 y no 404 a propósito: Velai SÍ ve esta conversación, así que fingir que no existe
    // sería mentirle al panel. Lo que no puede es meterse a atenderla.
    if (!(await canAttend(env, scope, conv.tenant_id))) throw new HttpError(403, 'velai_no_atiende_clientes');
    const now = new Date().toISOString();
    const who = String(actor).toLowerCase();
    if (ctrlMatch[2] === 'takeover') {
      // Ya lo tiene OTRA persona: se dice quién, en vez de dejar que dos escriban a la vez
      // creyendo cada una que la otra no está.
      if (conv.state === 'humano' && conv.agent_email && conv.agent_email !== who) {
        throw new HttpError(409, 'ya_tomada');
      }
      if (!['esperando', 'humano'].includes(conv.state)) throw new HttpError(409, 'nada_que_tomar');
      await env.DB.prepare("UPDATE conversations SET state='humano', agent_email=?, state_at=? WHERE id=?").bind(who, now, conv.id).run();
      console.log(JSON.stringify({ level: 'info', code: 'takeover', channel: conv.channel, actor_role: scope.role }));
      return json({ ok: true, state: 'humano', agent_email: who }, 200, NO_STORE);
    }
    // Devolver el control. Al principio no mandaba nada al cliente final, razonando que un
    // «te devuelvo al bot» sobraba. Estaba mal (Juan, 2026-08-26): el visitante estaba
    // hablando con una PERSONA y de golpe vuelve el bot sin que nadie se lo diga — se queda
    // esperando a alguien que ya no está. Se le avisa, con el nombre del asistente.
    // MISMO orden que en la cola: guardar el aviso, luego cambiar el estado, y Twilio al
    // final. El widget deja de preguntar al ver 'bot', así que invertirlo abre el hueco en el
    // que el aviso se escribe sin nadie escuchando.
    const tRow = await env.DB.prepare('SELECT * FROM tenants WHERE id=?').bind(conv.tenant_id).first();
    const quien = clean(tRow && tRow.bot_name, 40) || 'El asistente';
    const aviso = `${quien} vuelve a atenderte a partir de aquí. Si necesitas otra vez a alguien del equipo, solo tienes que pedírmelo.`;
    await convAppend(env, { id: conv.id, tenant: conv.tenant_id, channel: conv.channel, externalId: conv.external_id,
      inbox: conv.inbox_address, demo: conv.demo || '', msgs: conv.msgs, isNew: false },
    [{ role: 'assistant', content: aviso }]);
    await env.DB.prepare("UPDATE conversations SET state='bot', agent_email=NULL, state_at=? WHERE id=?").bind(now, conv.id).run();
    // La clave de pausa se borra con el tenant y el destinatario REALES de la conversación,
    // no con el scope: para un admin de Velai scope.tenantId es null y la clave saldría
    // malformada, dejando al bot callado para siempre.
    if (env.KV) { try { await env.KV.delete(`pause:${conv.tenant_id}:${conv.external_id}`); } catch (_) {} }
    // Twilio al final y sin bloquear: si falla, la conversación ya está devuelta y el bot
    // vuelve a atender. Quedarse en 'humano' sin nadie delante sería peor.
    if (tRow && conv.channel !== 'web' && conv.inbox_address) {
      const out = await sendTwilioText(env, tRow, conv.inbox_address, conv.external_id, aviso);
      if (!out.ok) console.log(JSON.stringify({ level: 'error', code: 'release_notice_failed', tenant: tRow.slug, error: clean(out.error || 'skipped', 40) }));
    }
    console.log(JSON.stringify({ level: 'info', code: 'control_released', channel: conv.channel, actor_role: scope.role }));
    return json({ ok: true, state: 'bot' }, 200, NO_STORE);
  }

  // Responder desde el panel. La parte difícil no es enviar: es NO enviar cuando no se
  // puede, y decir por qué (docs/H2-BANDEJA.md §1 y §2).
  const replyMatch = path.match(/^\/api\/admin\/conversations\/([0-9a-f-]+)\/reply$/i);
  if (replyMatch && request.method === 'POST') {
    if (!UUID_RE.test(replyMatch[1])) throw new HttpError(404, 'not_found');
    const scc = scopeClause(scope, 'c');
    const conv = await env.DB.prepare(`SELECT c.* FROM conversations c WHERE c.id=?${scc.sql}`).bind(replyMatch[1], ...scc.args).first();
    if (!conv) throw new HttpError(404, 'not_found');   // de otro cliente = 404, nunca 403
    if (!(await canAttend(env, scope, conv.tenant_id))) throw new HttpError(403, 'velai_no_atiende_clientes');
    const body = await readJson(request, 4000);
    const text = clean(body.text, 1500);
    if (!text) throw new HttpError(400, 'invalid_message');
    if (await rateLimited(env, `${actor}:${conv.id}`, 'convreply', 30)) throw new HttpError(429, 'rate_limited');
    // La guarda va ANTES de tocar Twilio: el 63016 de un texto libre fuera de ventana
    // llega cuando el mensaje ya se dio por enviado en la pantalla.
    const win = await replyWindow(env, conv);
    if (!win.open) throw new HttpError(409, win.reason);
    const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id=?').bind(conv.tenant_id).first();
    if (!tenant) throw new HttpError(404, 'not_found');
    // En el canal web no hay proveedor al que enviar: el mensaje se guarda y el widget lo
    // recoge en su siguiente sondeo. Por eso aquí no se toca Twilio.
    if (conv.channel !== 'web') {
      const sent = await sendTwilioText(env, tenant, conv.inbox_address, conv.external_id, text);
      if (!sent.ok) throw new HttpError(502, clean(sent.error || 'twilio_failed', 40));
    }
    // El bot se CALLA: dos voces en la misma conversación es peor que ninguna. Es la
    // MISMA pausa que escribe el centinela [[HUMANO]], así que la vista de escalaciones y
    // su botón de reanudar siguen valiendo tal cual — sin mecanismo nuevo.
    // En web NO se escribe: allí manda conv.state, y gastar una escritura de KV por
    // respuesta sería el peor uso del recurso más escaso que tenemos.
    if (env.KV && conv.channel !== 'web') { try { await env.KV.put(`pause:${conv.tenant_id}:${conv.external_id}`, '1', { expirationTtl: 4 * 3600 }); } catch (_) {} }
    const saved = await convAppend(env, {
      id: conv.id, tenant: conv.tenant_id, channel: conv.channel, externalId: conv.external_id,
      inbox: conv.inbox_address, demo: conv.demo || '', msgs: conv.msgs, isNew: false,
    }, [{ role: 'agent', content: text, agentEmail: actor }]);
    console.log(JSON.stringify({ level: 'info', code: 'agent_reply', channel: conv.channel, saved, actor_role: scope.role }));
    return json({ ok: true, window: win }, 200, NO_STORE);
  }

  const convMatch = path.match(/^\/api\/admin\/conversations\/([0-9a-f-]+)$/i);
  if (convMatch && request.method === 'GET') {
    if (!UUID_RE.test(convMatch[1])) throw new HttpError(404, 'not_found');
    const scc = scopeClause(scope, 'c');
    // La transcripción ajena es un 404, nunca un 403: un 403 confirmaría que la
    // conversación existe. Mismo criterio que el resto del panel.
    const head = await env.DB.prepare(`
      SELECT c.id, c.channel, c.external_id, c.msgs, c.unanswered, c.started_at, c.last_at,
             c.expires_at, c.lead_id, c.demo <> '' AS is_demo, t.name AS tenant_name
      FROM conversations c LEFT JOIN tenants t ON t.id = c.tenant_id
      WHERE c.id = ?${scc.sql}`).bind(convMatch[1], ...scc.args).first();
    if (!head) throw new HttpError(404, 'not_found');
    if (scope.role !== 'velai') delete head.tenant_name;
    const messages = (await env.DB.prepare('SELECT role, text, created_at FROM conv_messages WHERE conversation_id=? ORDER BY id ASC LIMIT 500')
      .bind(head.id).all()).results;
    return json({ conversation: head, messages }, 200, NO_STORE);
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
             t.sender_status,
             (SELECT group_concat(kind) FROM tenant_channels c WHERE c.tenant_id = t.id) AS channels,
             length(t.system_prompt) AS prompt_len,
             COUNT(l.id) AS lead_count
      FROM tenants t LEFT JOIN leads l ON l.tenant_id = t.id
      GROUP BY t.id ORDER BY t.active DESC, t.name ASC`).all()).results;
    return json({ tenants: rows }, 200, NO_STORE);
  }
  if (path === '/api/admin/tenants' && request.method === 'POST') {
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
  }
  if (path === '/api/admin/stats' && request.method === 'GET') {
    // Métricas para la cabecera del panel: solo recuentos y fechas, nunca PII.
    // El listado está paginado — contar en cliente daría números falsos.
    // Para el rol cliente, TODAS las cuentas van filtradas a su tenant.
    const t = scope.tenantId;
    const leadW = t ? ' AND tenant_id = ?' : '';
    const leadArgs = t ? [t] : [];
    const statements = [
      env.DB.prepare(`SELECT COUNT(*) AS n FROM leads WHERE created_at >= datetime('now','-30 days')${leadW}`).bind(...leadArgs),
      env.DB.prepare(`SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM leads WHERE status = 'new'${leadW}`).bind(...leadArgs),
      t
        ? env.DB.prepare("SELECT COUNT(*) AS n FROM lead_notifications ln JOIN leads l ON l.id = ln.lead_id WHERE ln.status = 'failed' AND ln.updated_at >= datetime('now','-7 days') AND l.tenant_id = ?").bind(t)
        : env.DB.prepare("SELECT COUNT(*) AS n FROM lead_notifications WHERE status = 'failed' AND updated_at >= datetime('now','-7 days')"),
      env.DB.prepare(`SELECT date(created_at) AS d, COUNT(*) AS n FROM leads WHERE created_at >= datetime('now','-14 days')${leadW} GROUP BY d ORDER BY d`).bind(...leadArgs),
      // Leads por canal: el dato ya estaba en la fila (source) y no se veía en ninguna parte.
      env.DB.prepare(`SELECT source, COUNT(*) AS n FROM leads WHERE created_at >= datetime('now','-30 days')${leadW} GROUP BY source ORDER BY n DESC`).bind(...leadArgs),
      // Denominador de la tasa de captura: conversaciones atendidas en el mismo periodo.
      env.DB.prepare(`SELECT channel, SUM(convs) AS n FROM conv_daily WHERE day >= date('now','-30 days')${t ? ' AND tenant_id = ?' : ''} GROUP BY channel`).bind(...leadArgs),
      // Valores para el desplegable de «Fuente» del filtro de leads. Salen de los DATOS y
      // no de una lista en código porque `source` es TEXTO LIBRE: /lead acepta el `fuente`
      // que mande la página (app.js, clean(body.fuente, 80)), así que una lista fija dejaría
      // sin filtrar cualquier landing nueva. SIN ventana de 30 días — un lead viejo tiene
      // que seguir siendo filtrable — y con tope, que esto alimenta un <select>.
      env.DB.prepare(`SELECT DISTINCT source FROM leads WHERE source IS NOT NULL AND source <> ''${leadW} ORDER BY source LIMIT 60`).bind(...leadArgs),
    ];
    // scope-ok: el push va dentro de `if (!t)`, o sea SOLO cuando no hay tenant en el
    // scope (Velai). Un cliente nunca llega a añadir esta consulta a la tanda. Se anota
    // porque check-aislamiento lee el SQL, no el condicional que decide si se ejecuta.
    if (!t) statements.push(env.DB.prepare('SELECT active, COUNT(*) AS n FROM tenants GROUP BY active'));
    const results = await env.DB.batch(statements);
    // OJO: el destructuring es POSICIONAL y la fila de tenants se añade condicionalmente.
    // Toda consulta nueva va ANTES de ese push y se añade aquí en el mismo orden.
    const [total30, nuevos, fallidos7, serieRows, canalRows, convRows, fuentesRows, tenantsRows] = results;
    const activos = tenantsRows ? (tenantsRows.results || []).find((r) => Number(r.active) === 1) : null;
    return json({
      total30: total30.results[0].n,
      sinContactar: nuevos.results[0].n,
      sinContactarDesde: nuevos.results[0].oldest || null,
      fallidos7: fallidos7.results[0].n,
      tenantsActivos: t ? null : (activos ? activos.n : 0),
      porDia: fillSeries(serieRows.results || [], 14),
      porCanal: (canalRows.results || []).map((r) => ({ canal: r.source || 'sin canal', n: r.n })),
      fuentes: (fuentesRows.results || []).map((r) => r.source).filter(Boolean),
      // Tasa de captura por canal Y total. Solo cuenta desde que el registro existe
      // (2026-08-25): las conversaciones anteriores no se guardaron, y una tasa
      // calculada con un denominador incompleto sería mentira — el panel lo advierte.
      captura: {
        conversaciones: (convRows.results || []).reduce((s, r) => s + (r.n || 0), 0),
        porCanal: (convRows.results || []).map((r) => ({ canal: r.channel, convs: r.n || 0 })),
        desde: CONV_TRACKING_SINCE,
      },
    }, 200, NO_STORE);
  }
  const provMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/provision(?:\/(subaccount|template\/check|template\/resubmit|template|sender\/verify|sender\/sync|sender\/profile|sender|domains))?$/i);
  if (provMatch) {
    if (!UUID_RE.test(provMatch[1])) throw new HttpError(404, 'not_found');
    return await handleProvision(request, env, ctx, provMatch[1], provMatch[2] || '', actor);
  }
  // ── Configuración (SOLO admins raíz): estado de integraciones y rotación del
  // token de API de Cloudflare. Raíz = envAdmins (los del toml): ni siquiera un admin
  // dado de alta en el panel puede tocar tokens — dos factores reales en vez de un PIN.
  if (path === '/api/admin/config' || path === '/api/admin/config/cf-token' || path === '/api/admin/config/telegram-webhook') {
    if (!envAdmins(env).includes(String(actor).toLowerCase())) throw new HttpError(403, 'root_only');
  }
  if (path === '/api/admin/config' && request.method === 'GET') {
    const stored = await getSetting(env, 'cf_api_token');
    const token = stored || clean(env.CF_API_TOKEN, 200) || '';
    let verify = null;
    if (token) { try { verify = await verifyCfToken(token); } catch (_) { verify = { valid: false, status: 'unreachable' }; } }
    return json({
      cf_token: { source: stored ? 'panel' : (env.CF_API_TOKEN ? 'worker' : 'none'), valid: verify ? verify.valid : null, status: verify ? verify.status : null },
      account_id: clean(env.CF_ACCOUNT_ID, 40) || null,
      turnstile_sitekey: clean(env.TURNSTILE_SITEKEY, 60) || null,
      groups: { clientes: Boolean(env.CF_ACCESS_GROUP_ID), admins: Boolean(env.CF_ADMIN_GROUP_ID) },
      d1: Boolean(env.DB), kv: Boolean(env.KV),
    }, 200, NO_STORE);
  }
  // Bajo demanda y no dentro de /config: llamar a Telegram en cada carga de la vista
  // sería una llamada externa por visita para un dato que casi nunca cambia.
  if (path === '/api/admin/config/telegram-webhook' && request.method === 'GET') {
    return json(await telegramWebhookInfo(env), 200, NO_STORE);
  }
  if (path === '/api/admin/config/cf-token' && request.method === 'POST') {
    const body = await readJson(request, 2000);
    const token = clean(body.token, 200);
    if (!/^[A-Za-z0-9_-]{40,120}$/.test(token)) throw new HttpError(400, 'invalid_token_format');
    // Se valida contra Cloudflare ANTES de guardar: un token roto no puede sustituir
    // a uno sano. Y es write-only: se cifra con la KEK y jamás se devuelve.
    let verify;
    try { verify = await verifyCfToken(token); } catch (_) { throw new HttpError(502, 'token_verify_unavailable'); }
    if (!verify.valid) throw new HttpError(400, 'token_invalid');
    await setSetting(env, 'cf_api_token', token, actor);
    console.log(JSON.stringify({ level: 'info', code: 'cf_token_rotated', actor }));
    ctx.waitUntil(sendTelegramText(env, `🔑 <b>${escapeHtml(actor)}</b> rotó el token de API de Cloudflare desde el panel (estado: ${escapeHtml(verify.status)}).`).catch(() => {}));
    return json({ ok: true, source: 'panel', status: verify.status }, 200, NO_STORE);
  }
  if (path === '/api/admin/config/cf-token' && request.method === 'DELETE') {
    try { await env.DB.prepare("DELETE FROM settings WHERE key='cf_api_token'").run(); } catch (_) {}
    ctx.waitUntil(sendTelegramText(env, `🔑 <b>${escapeHtml(actor)}</b> retiró el token del panel: vuelve a usarse el secret del worker.`).catch(() => {}));
    return json({ ok: true, source: env.CF_API_TOKEN ? 'worker' : 'none' }, 200, NO_STORE);
  }

  // ── Admins de Velai gestionados desde el panel (migración 0009) ──────────────
  // Solo rol velai (clienteAllowed no incluye estas rutas). Los ADMIN_EMAILS del
  // entorno son RAÍZ: se listan pero no se pueden borrar desde aquí. La auditoría va
  // por Telegram + log (no hay tenant al que colgar una versión). Cada alta/baja
  // sincroniza también la política «Equipo Velai» de Access (env raíz SIEMPRE dentro).
  if (path === '/api/admin/admins' && request.method === 'GET') {
    let rows = [];
    try { rows = (await env.DB.prepare('SELECT email, created_by, created_at FROM admin_users ORDER BY created_at').all()).results || []; } catch (_) {}
    const admins = [
      ...envAdmins(env).map((email) => ({ email, root: true })),
      ...rows.map((r) => ({ email: r.email, root: false, created_by: r.created_by, created_at: r.created_at })),
    ];
    return json({ admins }, 200, NO_STORE);
  }
  if (path === '/api/admin/admins' && request.method === 'POST') {
    const body = await readJson(request, 2000);
    const email = String(body.email || '').trim().toLowerCase();
    if (!PANEL_EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, 'invalid_email');
    if (envAdmins(env).includes(email)) throw new HttpError(409, 'already_admin');
    // Un correo de cliente no puede ascender a admin conservando su fila: vería TODO
    // y seguiría pareciendo "usuario de X". Primero baja de cliente, luego alta aquí.
    const client = await env.DB.prepare('SELECT tenant_id FROM tenant_users WHERE lower(email) = ?').bind(email).first();
    if (client) throw new HttpError(409, 'email_is_client');
    try {
      await env.DB.prepare('INSERT INTO admin_users (email, created_by, created_at) VALUES (?,?,?)')
        .bind(email, actor, new Date().toISOString()).run();
    } catch (e) {
      if (/UNIQUE|PRIMARY KEY/i.test(String(e.message || ''))) throw new HttpError(409, 'already_admin');
      throw e;
    }
    console.log(JSON.stringify({ level: 'info', code: 'admin_added', email, actor }));
    ctx.waitUntil(sendTelegramText(env, `👑 <b>${escapeHtml(actor)}</b> dio de alta al ADMIN <code>${escapeHtml(email)}</code> (ve todos los clientes y leads).`).catch(() => {}));
    const gate = await syncAdminGate(env, ctx);
    return json({ ok: true, email, gate }, 201, NO_STORE);
  }
  const adminDelMatch = path.match(/^\/api\/admin\/admins\/([^/]+)$/);
  if (adminDelMatch && request.method === 'DELETE') {
    const email = decodeURIComponent(adminDelMatch[1]).trim().toLowerCase();
    if (envAdmins(env).includes(email)) throw new HttpError(400, 'admin_is_root');
    // Quitarse a uno mismo es la receta del cierre accidental: que lo haga otro admin.
    if (email === String(actor).toLowerCase()) throw new HttpError(400, 'cannot_remove_self');
    const result = await env.DB.prepare('DELETE FROM admin_users WHERE lower(email) = ?').bind(email).run();
    if (!result.meta || !result.meta.changes) throw new HttpError(404, 'not_found');
    console.log(JSON.stringify({ level: 'info', code: 'admin_removed', email, actor }));
    ctx.waitUntil(sendTelegramText(env, `👑 <b>${escapeHtml(actor)}</b> quitó al ADMIN <code>${escapeHtml(email)}</code>.`).catch(() => {}));
    const gate = await syncAdminGate(env, ctx);
    return json({ ok: true, gate }, 200, NO_STORE);
  }

  // ── Citas (SPEC-CALENDARIO): lista scoped — velai todo (con ?tenant=), cliente
  // solo las suyas vía scopeClause (mismo único punto de paso que los leads).
  if (path === '/api/admin/appointments' && request.method === 'GET') {
    const clauses = ['1=1']; const values = [];
    const tenantFilter = clean(url.searchParams.get('tenant'), 40);
    if (scope.role === 'velai' && tenantFilter && UUID_RE.test(tenantFilter)) { clauses.push('l.tenant_id = ?'); values.push(tenantFilter); }
    // Rango opcional (la vista de calendario del panel pide el mes visible).
    const fromIso = clean(url.searchParams.get('from'), 30);
    const toIso = clean(url.searchParams.get('to'), 30);
    if (fromIso) { clauses.push('l.starts_at >= ?'); values.push(fromIso); }
    if (toIso) { clauses.push('l.starts_at < ?'); values.push(toIso); }
    const hasRange = Boolean(fromIso || toIso);
    const limit = Math.min(hasRange ? 500 : 100, Math.max(1, Number(url.searchParams.get('limit')) || (hasRange ? 500 : 50)));
    const rows = (await env.DB.prepare(`SELECT l.id,l.tenant_id,t.name AS tenant_name,l.channel,l.customer_name,l.customer_phone,l.reason,l.starts_at,l.ends_at,l.timezone,l.status,l.created_at FROM appointments l LEFT JOIN tenants t ON t.id=l.tenant_id WHERE ${clauses.join(' AND ')}${sc.sql} ORDER BY l.starts_at ${hasRange ? 'ASC' : 'DESC'} LIMIT ?`)
      .bind(...values, ...sc.args, limit).all()).results;
    if (scope.role !== 'velai') for (const row of rows) { delete row.tenant_name; delete row.tenant_id; }
    return json({ appointments: rows }, 200, NO_STORE);
  }

  // ── WhatsApp del tenant (SPEC-CONEXIONES PR2): estado de SOLO LECTURA para el
  // cliente, en columnas explícitas — ni el token cifrado ni el SID de la subcuenta
  // (eso es infraestructura de Velai, no dato del cliente).
  // Logo de marca subido AL BUCKET (R2): una sola imagen alimenta el widget web y la
  // foto de perfil de WhatsApp. Se guarda bajo logos/<tenantId>.<ext> y se sirve por
  // /media/ del propio worker (api.hirevai.com) — nada de dominios de terceros.
  // Reaplicar a WhatsApp la imagen guardada (sin resubirla).
  // ── Consumo de infraestructura (solo Velai) ───────────────────────────────
  if (path === '/api/admin/infra-usage' && request.method === 'GET') {
    return json(await cloudflareUsage(env), 200, NO_STORE);
  }

  // ── Consumo de IA por cliente (solo Velai) ────────────────────────────────
  // El gasto real de cada cliente en euros/dólares: sin esto no se sabe si un cliente
  // cuesta más de lo que paga, ni quién dispara el cupo diario.
  // Saldo de IA del mes, para el panel DEL CLIENTE. Deliberadamente sin coste: la tarjeta
  // de gasto en dólares es velai-only porque enseñarle al cliente lo que pagamos por él es
  // enseñarle el margen. Aquí van tokens y porcentaje, que es lo que necesita saber.
  if (path === '/api/admin/ai-balance' && request.method === 'GET') {
    // Velai puede mirar el de cualquiera con ?tenant=; un cliente, solo el suyo.
    const asked = clean(url.searchParams.get('tenant'), 40);
    const tenantId = scope.tenantId || (asked && UUID_RE.test(asked) ? asked : null);
    if (!tenantId) throw new HttpError(400, 'tenant_required');
    if (scope.tenantId && asked && asked !== scope.tenantId) throw new HttpError(404, 'not_found');
    const row = await env.DB.prepare('SELECT id, name, ai_monthly_tokens FROM tenants WHERE id=?').bind(tenantId).first();
    if (!row) throw new HttpError(404, 'not_found');
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const today = now.toISOString().slice(0, 10);
    // La misma suma que usa el dashboard: con el caché de prompt casi todo el input llega
    // como cache_r, así que contar solo in+out no enseñaría casi nada.
    const totals = await env.DB.prepare(`SELECT
        SUM(in_tokens+out_tokens+cache_w_tokens+cache_r_tokens) AS mes,
        SUM(CASE WHEN day = ? THEN in_tokens+out_tokens+cache_w_tokens+cache_r_tokens ELSE 0 END) AS hoy,
        SUM(calls) AS llamadas
      FROM ai_usage WHERE tenant_id = ? AND day LIKE ?`).bind(today, tenantId, `${month}-%`).first();
    const included = Number(row.ai_monthly_tokens) || Number(env.AI_TENANT_MONTHLY_TOKENS) || 5000000;
    const used = Number(totals && totals.mes) || 0;
    // Serie diaria del mes para la gráfica: los días sin consumo también existen, o la
    // gráfica comprime el eje y miente sobre la distribución.
    const rows = (await env.DB.prepare('SELECT day, SUM(in_tokens+out_tokens+cache_w_tokens+cache_r_tokens) AS n FROM ai_usage WHERE tenant_id=? AND day LIKE ? GROUP BY day').bind(tenantId, `${month}-%`).all()).results || [];
    const byDay = new Map(rows.map((r) => [r.day, r.n || 0]));
    const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const serie = [];
    for (let d = 1; d <= days; d++) {
      const key = `${month}-${String(d).padStart(2, '0')}`;
      serie.push({ d: key, n: byDay.get(key) || 0 });
    }
    return json({
      month, included, used,
      remaining: Math.max(0, included - used),
      // El porcentaje se acota a 100: una barra al 140% no significa nada.
      pct: included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0,
      over: used > included,
      usedToday: Number(totals && totals.hoy) || 0,
      calls: Number(totals && totals.llamadas) || 0,
      serie,
    }, 200, NO_STORE);
  }
  if (path === '/api/admin/ai-usage' && request.method === 'GET') {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const from = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    const rows = (await env.DB.prepare(`SELECT u.tenant_id, u.day, u.model, u.calls, u.in_tokens, u.out_tokens,
        u.cache_w_tokens, u.cache_r_tokens, t.name AS tenant_name, t.slug
      FROM ai_usage u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.day >= ? ORDER BY u.day ASC`).bind(from).all()).results || [];
    const porCliente = new Map(); const porDia = new Map();
    let totalCost = 0; let totalCalls = 0; let totalTokens = 0;
    for (const r of rows) {
      const cost = aiCost(r);
      const tokens = (r.in_tokens || 0) + (r.out_tokens || 0) + (r.cache_w_tokens || 0) + (r.cache_r_tokens || 0);
      totalCost += cost; totalCalls += r.calls || 0; totalTokens += tokens;
      const key = r.tenant_id || '';
      const cli = porCliente.get(key) || { tenant_id: key, name: r.tenant_name || (key ? 'cliente borrado' : 'Velai (panel)'), slug: r.slug || null, calls: 0, tokens: 0, cost: 0, models: {} };
      cli.calls += r.calls || 0; cli.tokens += tokens; cli.cost += cost;
      cli.models[r.model] = (cli.models[r.model] || 0) + (r.calls || 0);
      porCliente.set(key, cli);
      const d = porDia.get(r.day) || { d: r.day, cost: 0, calls: 0 };
      d.cost += cost; d.calls += r.calls || 0; porDia.set(r.day, d);
    }
    // Serie completa (los días sin consumo también existen) para que la gráfica no mienta.
    const serie = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      serie.push(porDia.get(d) || { d, cost: 0, calls: 0 });
    }
    return json({
      days,
      total: { cost: Number(totalCost.toFixed(4)), calls: totalCalls, tokens: totalTokens },
      clientes: [...porCliente.values()].sort((a, b) => b.cost - a.cost).map((c) => ({ ...c, cost: Number(c.cost.toFixed(4)) })),
      porDia: serie.map((d) => ({ ...d, cost: Number(d.cost.toFixed(4)) })),
      moneda: 'USD',
    }, 200, NO_STORE);
  }

  const logoApply = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/logo\/apply$/i);
  if (logoApply && request.method === 'POST') {
    if (!UUID_RE.test(logoApply[1])) throw new HttpError(404, 'not_found');
    assertOwnTenant(scope, logoApply[1]);
    const tenant = await env.DB.prepare(`SELECT id, slug, name, logo_url, logo_wa_url, brand_name, greeting, web_origins,
      sender_sid, twilio_subaccount_sid, twilio_auth_token_enc FROM tenants WHERE id=?`).bind(logoApply[1]).first();
    if (!tenant) throw new HttpError(404, 'not_found');
    if (!tenant.logo_url && !tenant.logo_wa_url) throw new HttpError(400, 'logo_missing');
    if (!tenant.sender_sid) throw new HttpError(400, 'sender_required');
    const out = await pushSenderProfile(env, tenant);
    // El código REAL de Twilio llega al panel: aplanarlo a «sender_profile_failed» me
    // hizo culpar a la imagen cuando el 63100 era del cuerpo de la petición.
    if (!out.ok) return json({ ok: false, error: out.error || 'sender_profile_failed', why: out.why || null }, 502, NO_STORE);
    return json({ ok: true, applied: out.applied }, 200, NO_STORE);
  }

  const logoMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/logo$/i);
  if (logoMatch && request.method === 'POST') {
    if (!UUID_RE.test(logoMatch[1])) throw new HttpError(404, 'not_found');
    // Cliente ajeno = 404 ANTES de tocar D1 (nunca 403: no se confirma que exista).
    assertOwnTenant(scope, logoMatch[1]);
    const tenantId = logoMatch[1];
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
    const pedidos = String(raw === null ? 'web,whatsapp' : raw).toLowerCase().split(',').map((c) => c.trim());
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
    // subida no debe fallar por ello — si falla, queda el botón manual de Velai.
    // La foto de WhatsApp se actualiza SOLA: el cliente sube su logo y ya está en los dos
    // canales, sin entender de perfiles. En segundo plano porque Twilio puede tardar y la
    // subida no debe fallar por ello — el resultado queda registrado para el panel.
    if (aWa && tenant.sender_sid && tenant.twilio_subaccount_sid) {
      ctx.waitUntil(pushSenderProfile(env, { ...tenant, logo_wa_url: logoUrl }));
    }
    return json({ ok: true, logo_url: logoUrl, store, canales: { web: aWeb, whatsapp: aWa },
      whatsapp: !!(aWa && tenant.sender_sid && tenant.twilio_subaccount_sid) }, 200, NO_STORE);
  }

  // ── Canales vivos: visibilidad del ENRUTADO (2026-08-24) ──────────────────
  // El panel mostraba la opinión de TWILIO (sender ONLINE) y las columnas de la ficha,
  // nunca la tabla que de verdad enruta. Resultado: gogestion con el sender en verde,
  // la ficha impecable y el bot MUDO, porque no existía su fila en tenant_channels y
  // nada en el panel podía delatarlo. Esta vista contesta la única pregunta que
  // importa: qué direcciones atiende el worker, y para quién.
  if (path === '/api/admin/channels' && request.method === 'GET') {
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
  }

  // ── Los canales DEL cliente, en su propio espacio ─────────────────────────
  // Hoy tenía que leer tres tarjetas separadas para deducir qué tiene funcionando, y su
  // canal web no aparecía en ninguna parte pese a llevar el widget en su web. Ajeno = 404,
  // nunca 403: el molde del resto de rutas en autoservicio.
  const chMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/channels$/i);
  if (chMatch && request.method === 'GET') {
    if (!UUID_RE.test(chMatch[1])) throw new HttpError(404, 'not_found');
    assertOwnTenant(scope, chMatch[1]);
    const row = await env.DB.prepare(`SELECT id, slug, active, channel_address, twilio_from, sender_sid,
             telegram_chat_id, telegram_chat_title, web_origins
      FROM tenants WHERE id=?`).bind(chMatch[1]).first();
    if (!row) throw new HttpError(404, 'not_found');
    return json({ channels: channelsForScope(scope, await tenantChannelSummary(env, row)) }, 200, NO_STORE);
  }

  const waMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/whatsapp$/i);
  if (waMatch && request.method === 'GET') {
    if (!UUID_RE.test(waMatch[1])) throw new HttpError(404, 'not_found');
    assertOwnTenant(scope, waMatch[1]);
    // `routed`: existe la fila de tenant_channels que hace que el webhook entrante
    // resuelva a este cliente. Sin ella el sender puede estar ONLINE y el bot mudo, así
    // que el estado que ve el cliente NO puede salir solo de sender_status.
    const row = await env.DB.prepare(`SELECT channel_address, twilio_from, (waba_id IS NOT NULL) AS has_waba, sender_status, lead_template_status, meta_partner_status, team_whatsapp, wa_number, logo_url, logo_wa_url, (twilio_auth_token_enc IS NOT NULL) AS has_token, (twilio_subaccount_sid IS NOT NULL) AS has_subaccount,
             (twilio_from IS NOT NULL AND (channel_address = twilio_from OR EXISTS (SELECT 1 FROM tenant_channels c WHERE c.tenant_id = tenants.id AND c.address = tenants.twilio_from))) AS routed
      FROM tenants WHERE id=?`).bind(waMatch[1]).first();
    if (!row) throw new HttpError(404, 'not_found');
    // Cómo fue el último empujón de la foto al perfil de WhatsApp (lo escribe el
    // waitUntil de la subida del logo): sin esto, un fallo en segundo plano es invisible.
    let profileSync = null;
    if (env.KV) { try { profileSync = await env.KV.get(`waprof:${waMatch[1]}`, 'json'); } catch (_) {} }
    // El estado de ENTREGA de los avisos, calculado con las mismas condiciones que deliver().
    // La fila de arriba no lo trae: necesita telegram_chat_id y el SID de la plantilla.
    const alertRow = await env.DB.prepare(`SELECT telegram_chat_id, twilio_subaccount_sid, team_whatsapp,
             lead_template_sid, lead_template_status, twilio_from FROM tenants WHERE id=?`).bind(waMatch[1]).first();
    return json({ whatsapp: row, alerts: leadAlertStatus(env, alertRow || {}), profileSync }, 200, NO_STORE);
  }

  // ── Números de aviso (SPEC-CONEXIONES PR3): el cliente edita SUS destinos ──
  const notifyMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/notify$/i);
  if (notifyMatch && request.method === 'PATCH') {
    if (!UUID_RE.test(notifyMatch[1])) throw new HttpError(404, 'not_found');
    const tenantId = notifyMatch[1];
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
    await env.DB.prepare(`UPDATE tenants SET ${columns.map((c) => `${c}=?`).join(',')}, updated_at=? WHERE id=?`)
      .bind(...columns.map((c) => fields[c]), now, tenantId).run();
    await invalidateTenantCache(env, [previous]);
    ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
      .bind(tenantId, actor, 'config', JSON.stringify(Object.fromEntries(columns.map((c) => [c, previous[c]]))), `avisos (autoservicio, rol ${scope.role})`, now).run().catch(() => {}));
    return json({ ok: true }, 200, NO_STORE);
  }

  // Enviar el informe AHORA, como prueba. Sin esto, la única forma de comprobar que el
  // informe semanal funciona es esperar al lunes — inaceptable para algo que depende de
  // que el grupo esté vinculado y el bot tenga permisos. Manda los ÚLTIMOS 7 DÍAS (no la
  // semana cerrada: con el historial recién arrancado esa saldría vacía) y va marcado como
  // prueba para que nadie lo confunda con el informe del lunes.
  // NO toca tenant_reports: una prueba no puede consumir el envío real de la semana.
  const reportTestMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/report\/test$/i);
  if (reportTestMatch && request.method === 'POST') {
    if (!UUID_RE.test(reportTestMatch[1])) throw new HttpError(404, 'not_found');
    const tenantId = reportTestMatch[1];
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
  }

  // ── Telegram del tenant (SPEC-CONEXIONES PR1): vinculación en autoservicio ──
  if (path === '/api/admin/telegram/setup' && request.method === 'POST') {
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
  }
  // Temas del grupo: crear DESDE el panel (nombre + descripción — la descripción
  // es la que guía al clasificador), editar la descripción y quitar del enrutado.
  const tgTopicMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/telegram\/topics(?:\/(\d+))?$/i);
  if (tgTopicMatch) {
    if (!UUID_RE.test(tgTopicMatch[1])) throw new HttpError(404, 'not_found');
    const tenantId = tgTopicMatch[1];
    assertOwnTenant(scope, tenantId);
    const row = await env.DB.prepare('SELECT id, slug, name, channel_address, telegram_chat_id, telegram_topics, telegram_bot_token_enc, telegram_whitelabel FROM tenants WHERE id=?').bind(tenantId).first();
    if (!row) throw new HttpError(404, 'not_found');
    let topics = [];
    try { topics = JSON.parse(row.telegram_topics || '[]'); } catch (_) {}
    if (!Array.isArray(topics)) topics = [];
    if (!tgTopicMatch[2] && request.method === 'POST') {
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
    if (tgTopicMatch[2] && request.method === 'PATCH') {
      if (!row.telegram_whitelabel) throw scope.role === 'velai' ? new HttpError(400, 'marca_blanca_requerida') : new HttpError(404, 'not_found');
      const body = await readJson(request, 4000);
      const topic = topics.find((t) => String(t.thread_id) === tgTopicMatch[2]);
      if (!topic) throw new HttpError(404, 'not_found');
      const description = clean(body.description, 200);
      if (description) topic.description = description; else delete topic.description;
      await env.DB.prepare('UPDATE tenants SET telegram_topics=?, updated_at=? WHERE id=?').bind(JSON.stringify(topics), new Date().toISOString(), tenantId).run();
      await invalidateTenantCache(env, [row]);
      return json({ ok: true, topics }, 200, NO_STORE);
    }
    if (tgTopicMatch[2] && request.method === 'DELETE') {
      // Solo lo quita del ENRUTADO: el Tema sigue existiendo en su Telegram.
      const remaining = topics.filter((t) => String(t.thread_id) !== tgTopicMatch[2]);
      await env.DB.prepare('UPDATE tenants SET telegram_topics=?, updated_at=? WHERE id=?').bind(JSON.stringify(remaining), new Date().toISOString(), tenantId).run();
      await invalidateTenantCache(env, [row]);
      return json({ ok: true, topics: remaining }, 200, NO_STORE);
    }
    throw new HttpError(405, 'method_not_allowed');
  }
  const tgMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/telegram(?:\/(link|bot))?$/i);
  if (tgMatch) {
    if (!UUID_RE.test(tgMatch[1])) throw new HttpError(404, 'not_found');
    const tenantId = tgMatch[1];
    // Autoservicio: el cliente solo SU tenant — ajeno = 404, ANTES de tocar D1.
    assertOwnTenant(scope, tenantId);
    const tenantRow = await env.DB.prepare('SELECT id, slug, name, channel_address, telegram_chat_id, telegram_chat_title, telegram_linked_at, telegram_bot_username, telegram_bot_token_enc, telegram_whitelabel, telegram_topics, weekly_report FROM tenants WHERE id=?').bind(tenantId).first();
    if (!tenantRow) throw new HttpError(404, 'not_found');
    // La marca blanca es una feature que ACTIVA VELAI por cliente: sin el flag, el
    // bot propio no existe — para el cliente es 404 (ni confirmación de la feature)
    // y para velai un 400 claro: activar el flag primero, un básico jamás acaba con
    // bot propio "por accidente" (el DELETE sí se permite, es limpieza).
    if (tgMatch[2] === 'bot' && request.method === 'POST' && !tenantRow.telegram_whitelabel) {
      throw scope.role === 'velai' ? new HttpError(400, 'marca_blanca_requerida') : new HttpError(404, 'not_found');
    }
    if (tgMatch[2] === 'bot' && request.method === 'DELETE' && scope.role !== 'velai' && !tenantRow.telegram_whitelabel) throw new HttpError(404, 'not_found');
    if (!tgMatch[2] && request.method === 'PATCH') {
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
    if (tgMatch[2] === 'bot' && request.method === 'POST') {
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
    if (tgMatch[2] === 'bot' && request.method === 'DELETE') {
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
    if (tgMatch[2] === 'link' && request.method === 'POST') {
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
    if (!tgMatch[2] && request.method === 'GET') {
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
    if (!tgMatch[2] && request.method === 'DELETE') {
      const now = new Date().toISOString();
      await env.DB.prepare('UPDATE tenants SET telegram_chat_id=NULL, telegram_chat_title=NULL, telegram_linked_at=NULL, updated_at=? WHERE id=?').bind(now, tenantId).run();
      await invalidateTenantCache(env, [tenantRow]);
      console.log(JSON.stringify({ level: 'info', code: 'telegram_unlinked', tenant: tenantRow.slug, actor_role: scope.role }));
      ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
        .bind(tenantId, actor, 'telegram', tenantRow.telegram_chat_title || null, 'desvinculado', now).run().catch(() => {}));
      return json({ ok: true }, 200, NO_STORE);
    }
    throw new HttpError(405, 'method_not_allowed');
  }

  // ── Calendario del tenant (SPEC-CALENDARIO §6): solo rol velai en v1
  // (clienteAllowed no incluye estas rutas). El GET jamás devuelve el token cifrado.
  const calMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/calendar(?:\/(connect))?$/i);
  if (calMatch) {
    if (!UUID_RE.test(calMatch[1])) throw new HttpError(404, 'not_found');
    const tenantId = calMatch[1];
    // Autoservicio del cliente: SOLO su propio calendario. Fuera de alcance = 404
    // (un 403 confirmaría que ese tenant existe), y ANTES de tocar D1.
    assertOwnTenant(scope, tenantId);
    const tenantRow = await env.DB.prepare('SELECT id, slug, name FROM tenants WHERE id=?').bind(tenantId).first();
    if (!tenantRow) throw new HttpError(404, 'not_found');
    if (calMatch[2] === 'connect' && request.method === 'POST') {
      const body = await readJson(request, 2000);
      if (clean(body.provider, 20) !== 'google') throw new HttpError(400, 'invalid_provider'); // microsoft: fase futura
      if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) throw new HttpError(503, 'calendar_not_configured');
      if (!env.KV) throw new HttpError(503, 'calendar_not_configured');
      const state = crypto.randomUUID();
      await env.KV.put(`calstate:${state}`, JSON.stringify({ tenantId, provider: 'google', actor }), { expirationTtl: 600 });
      return json({ authUrl: googleAuthUrl(env, state, `${adminOrigin(env)}/oauth/calendar/callback`) }, 200, NO_STORE);
    }
    if (!calMatch[2] && request.method === 'GET') {
      // Columnas explícitas, NUNCA SELECT * : refresh_token_enc no sale del worker.
      let row = null;
      try { row = await env.DB.prepare('SELECT provider,account_email,calendar_id,timezone,slot_minutes,business_hours,status,last_error,connected_at,updated_at FROM tenant_calendars WHERE tenant_id=?').bind(tenantId).first(); } catch (_) {}
      return json({ calendar: row || null }, 200, NO_STORE);
    }
    if (!calMatch[2] && request.method === 'PATCH') {
      const body = await readJson(request, 4000);
      const sets = []; const args = [];
      if (body.calendar_id !== undefined) {
        const calendarId = clean(body.calendar_id, 200) || 'primary';
        sets.push('calendar_id=?'); args.push(calendarId);
      }
      if (body.timezone !== undefined) {
        const tz = clean(body.timezone, 60);
        try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (_) { throw new HttpError(400, 'invalid_timezone'); }
        sets.push('timezone=?'); args.push(tz);
      }
      if (body.slot_minutes !== undefined) {
        const minutes = Number(body.slot_minutes);
        if (!Number.isInteger(minutes) || minutes < 10 || minutes > 240) throw new HttpError(400, 'invalid_slot_minutes');
        sets.push('slot_minutes=?'); args.push(minutes);
      }
      if (body.business_hours !== undefined) {
        let stored = null;
        if (body.business_hours !== null && body.business_hours !== '') {
          const hours = body.business_hours;
          const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
          const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
          if (!hours || typeof hours !== 'object' || Array.isArray(hours)) throw new HttpError(400, 'invalid_business_hours');
          const outHours = {};
          for (const day of Object.keys(hours)) {
            if (!DAYS.includes(day)) throw new HttpError(400, 'invalid_business_hours');
            const windows = hours[day];
            if (!Array.isArray(windows) || windows.length > 4) throw new HttpError(400, 'invalid_business_hours');
            for (const w of windows) {
              if (!Array.isArray(w) || w.length !== 2 || !HHMM.test(w[0]) || !HHMM.test(w[1]) || w[0] >= w[1]) throw new HttpError(400, 'invalid_business_hours');
            }
            outHours[day] = windows;
          }
          stored = JSON.stringify(outHours);
        }
        sets.push('business_hours=?'); args.push(stored);
      }
      if (!sets.length) throw new HttpError(400, 'nothing_to_update');
      const now = new Date().toISOString();
      const updated = await env.DB.prepare(`UPDATE tenant_calendars SET ${sets.join(',')}, updated_at=? WHERE tenant_id=?`).bind(...args, now, tenantId).run();
      if (!updated.meta.changes) throw new HttpError(404, 'not_found');
      if (env.KV) { try { await env.KV.delete(`calcfg:${tenantId}`); } catch (_) {} }
      ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
        .bind(tenantId, actor, 'calendar', null, 'config editada', now).run().catch(() => {}));
      return json({ ok: true }, 200, NO_STORE);
    }
    if (!calMatch[2] && request.method === 'DELETE') {
      const row = await env.DB.prepare('SELECT refresh_token_enc FROM tenant_calendars WHERE tenant_id=?').bind(tenantId).first();
      if (!row) throw new HttpError(404, 'not_found');
      // Revocación best-effort en Google; borrar la fila ya inutiliza la conexión aquí.
      try {
        const secret = await decryptSecret(env, `calendar:${tenantId}`, row.refresh_token_enc);
        if (secret) ctx.waitUntil(revokeGoogleToken(secret.value));
      } catch (_) {}
      await env.DB.prepare('DELETE FROM tenant_calendars WHERE tenant_id=?').bind(tenantId).run();
      if (env.KV) { try { await env.KV.delete(`calcfg:${tenantId}`); await env.KV.delete(`caltoken:${tenantId}`); } catch (_) {} }
      const now = new Date().toISOString();
      ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
        .bind(tenantId, actor, 'calendar', null, 'desconectado', now).run().catch(() => {}));
      console.log(JSON.stringify({ level: 'info', code: 'calendar_disconnected', tenant: tenantId }));
      return json({ ok: true }, 200, NO_STORE);
    }
    throw new HttpError(405, 'method_not_allowed');
  }

  // ── Usuarios del cliente (SPEC-USUARIOS §B.2): solo rol velai (clienteAllowed es
  // lista blanca y no incluye estas rutas). resolveScope consulta tenant_users en cada
  // petición sin caché, así que alta y baja surten efecto inmediato.
  const usersMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/users(?:\/([^/]+))?$/i);
  if (usersMatch) {
    if (!UUID_RE.test(usersMatch[1])) throw new HttpError(404, 'not_found');
    const tenantId = usersMatch[1];
    if (!usersMatch[2] && request.method === 'GET') {
      const rows = await env.DB.prepare('SELECT email, created_at FROM tenant_users WHERE tenant_id=? ORDER BY created_at')
        .bind(tenantId).all();
      return json({ users: rows.results || [] }, 200, NO_STORE);
    }
    if (!usersMatch[2] && request.method === 'POST') {
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
    if (usersMatch[2] && request.method === 'DELETE') {
      const email = decodeURIComponent(usersMatch[2]).trim().toLowerCase();
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
  }

  const tenantMatch = path.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)(?:\/(preview|versions))?(?:\/(\d+)\/restore)?$/i);
  if (tenantMatch) {
    if (!UUID_RE.test(tenantMatch[1])) throw new HttpError(404, 'not_found');
    const tenantId = tenantMatch[1]; const tenantAction = tenantMatch[2]; const versionId = tenantMatch[3];
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
    // Un tenant no se borra NUNCA: los leads apuntan a tenant_id y el histórico es
    // del negocio. El panel solo desactiva (active=0).
    throw new HttpError(405, 'method_not_allowed');
  }
  const match = path.match(/^\/api\/admin\/leads\/([0-9a-f-]+)(?:\/(notes|retry))?$/i);
  if (!match || !UUID_RE.test(match[1])) throw new HttpError(404, 'not_found');
  const id = match[1]; const action = match[2];
  if (!action && request.method === 'GET') {
    // Fuera de alcance = 404, no 403: un 403 confirmaría que el lead existe.
    const lead = await env.DB.prepare(`SELECT l.*, t.name AS tenant_name FROM leads l LEFT JOIN tenants t ON t.id=l.tenant_id WHERE l.id=?${sc.sql}`).bind(id, ...sc.args).first();
    if (!lead) throw new HttpError(404, 'not_found');
    if (scope.role !== 'velai') { delete lead.tenant_name; delete lead.tenant_id; }
    const [notes, events, notifications] = await Promise.all([
      env.DB.prepare('SELECT * FROM lead_notes WHERE lead_id=? ORDER BY created_at DESC').bind(id).all(),
      env.DB.prepare('SELECT * FROM lead_events WHERE lead_id=? ORDER BY created_at DESC').bind(id).all(),
      env.DB.prepare('SELECT * FROM lead_notifications WHERE lead_id=?').bind(id).all(),
    ]);
    return json({ lead, notes: notes.results, events: events.results, notifications: notifications.results }, 200, NO_STORE);
  }
  if (!action && request.method === 'PATCH') {
    const body = await readJson(request, 2000); if (!STATUSES.has(body.status)) throw new HttpError(400, 'invalid_status');
    // Propiedad primero: el UPDATE lleva el scope y 0 cambios = 404 (no existe para ti).
    const now = new Date().toISOString();
    const updated = await env.DB.prepare(`UPDATE leads SET status=?,updated_at=?,expires_at=? WHERE id=?${sc.sql.replace('l.', '')}`).bind(body.status, now, expiryDate(env), id, ...sc.args).run();
    if (!updated.meta.changes) throw new HttpError(404, 'not_found');
    await env.DB.prepare("INSERT INTO lead_events (lead_id,actor_email,actor_role,event_type,detail,created_at) VALUES (?,?,?,'status_changed',?,?)").bind(id, actor, scope.role, body.status, now).run();
    return json({ ok: true }, 200, NO_STORE);
  }
  if (action === 'notes' && request.method === 'POST') {
    const body = await readJson(request, 3000); const text = clean(body.text, 2000); if (!text) throw new HttpError(400, 'invalid_note');
    const now = new Date().toISOString();
    const owned = await env.DB.prepare(`SELECT l.id FROM leads l WHERE l.id=?${sc.sql}`).bind(id, ...sc.args).first();
    if (!owned) throw new HttpError(404, 'not_found');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO lead_notes (lead_id,author_email,author_role,text,created_at) VALUES (?,?,?,?,?)').bind(id, actor, scope.role, text, now),
      env.DB.prepare('UPDATE leads SET updated_at=?,expires_at=? WHERE id=?').bind(now, expiryDate(env), id),
    ]);
    return json({ ok: true }, 201, NO_STORE);
  }
  if (action === 'retry' && request.method === 'POST') {
    // Defensa en profundidad: el router ya lo bloquea, pero el endpoint valida igual.
    if (scope.role !== 'velai') throw new HttpError(403, 'not_authorized');
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE lead_notifications SET status='pending',attempts=0,next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE lead_id=? AND status!='sent'").bind(now, id).run();
    ctx.waitUntil(processNotifications(env, id, true)); return json({ ok: true }, 202, NO_STORE);
  }
  if (!action && request.method === 'DELETE') {
    if (scope.role !== 'velai') throw new HttpError(403, 'not_authorized'); // borrado RGPD: solo Velai
    await env.DB.prepare('DELETE FROM leads WHERE id=?').bind(id).run(); return new Response(null, { status: 204 });
  }
  throw new HttpError(405, 'method_not_allowed');
}

// ── Callback OAuth de Google Calendar (SPEC-CALENDARIO §1.2) ─────────────────
// Vive SOLO en el hostname del panel: Access delante (el admin llega con su cookie)
// y el worker valida el JWT igual que el resto del panel. El state en KV es de un
// solo uso (leer-y-borrar) y va atado al tenant y al actor que inició la conexión.
async function handleCalendarCallback(request, env, ctx, url) {
  const actor = await adminIdentity(request, env);
  const scope = await resolveScope(env, actor);
  return calendarCallbackFor(env, ctx, url, actor, scope);
}

// Separada de la identidad (JWT de Access) para que los tests cubran la lógica
// del state/intercambio sin montar un JWKS real.
async function calendarCallbackFor(env, ctx, url, actor, scope = { role: 'velai' }) {
  if (!env.DB || !env.KV) throw new HttpError(503, 'calendar_not_configured');
  const state = clean(url.searchParams.get('state'), 40);
  let stored = null;
  if (state) { try { stored = await env.KV.get(`calstate:${state}`, 'json'); } catch (_) {} }
  if (!stored || !stored.tenantId) throw new HttpError(403, 'invalid_oauth_state');
  await env.KV.delete(`calstate:${state}`); // un solo uso, también si algo falla después
  // Autoservicio: un cliente solo puede cerrar la conexión de SU tenant, aunque
  // consiga un state ajeno (el state ya está consumido llegados aquí).
  if (scope.role !== 'velai' && stored.tenantId !== scope.tenantId) throw new HttpError(403, 'not_authorized');
  const back = (result) => new Response(null, { status: 302, headers: { Location: `${adminOrigin(env)}/#calendar=${result}` } });
  const code = clean(url.searchParams.get('code'), 512);
  if (!code) return back('denegado'); // el usuario canceló en la pantalla de Google
  let tokens;
  try {
    tokens = await exchangeGoogleCode(env, code, `${adminOrigin(env)}/oauth/calendar/callback`);
  } catch (_) { return back('error_intercambio'); }
  // Sin refresh_token la conexión muere en 1 h. Google solo lo da con prompt=consent
  // (ya va en la URL): si aun así falta, mejor error claro que conexión zombi.
  if (!tokens.refresh_token) return back('error_sin_refresh');
  const enc = await encryptSecret(env, `calendar:${stored.tenantId}`, tokens.refresh_token);
  let email = null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(tokens.id_token.split('.')[1])));
    email = clean(payload.email, 200);
  } catch (_) { /* sin email no pasa nada: es solo informativo en el panel */ }
  const now = new Date().toISOString();
  // Reconectar conserva la config (calendar_id, horario…): solo rotan los tokens.
  await env.DB.prepare(`INSERT INTO tenant_calendars (tenant_id,provider,refresh_token_enc,account_email,calendar_id,timezone,slot_minutes,business_hours,status,last_error,connected_by,connected_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET provider=excluded.provider, refresh_token_enc=excluded.refresh_token_enc, account_email=excluded.account_email, status='connected', last_error=NULL, updated_at=excluded.updated_at`)
    .bind(stored.tenantId, 'google', enc, email, 'primary', 'Europe/Madrid', 30, null, 'connected', null, actor, now, now).run();
  if (env.KV && tokens.access_token) {
    try { await env.KV.put(`caltoken:${stored.tenantId}`, tokens.access_token, { expirationTtl: Math.max(60, (Number(tokens.expires_in) || 3600) - 60) }); } catch (_) {}
  }
  try { await env.KV.delete(`calcfg:${stored.tenantId}`); } catch (_) {}
  // Auditoría SIN tokens: solo que se conectó, quién y cuándo.
  ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
    .bind(stored.tenantId, actor, 'calendar', null, 'conectado google', now).run().catch(() => {}));
  console.log(JSON.stringify({ level: 'info', code: 'calendar_connected', tenant: stored.tenantId, provider: 'google' }));
  // El tenantId viaja en el hash para que el panel reabra SU calendario al volver.
  return back(`ok:${stored.tenantId}`);
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
        // 'unknown' = Twilio contestó pero sin el estado donde lo buscamos. Sin este log la
        // fila se queda 'pending' eternamente y parece que Meta va lenta.
        if (!['approved', 'rejected', 'pending', 'received'].includes(approval.status)) {
          console.log(JSON.stringify({ level: 'warn', code: 'template_status_unknown', tenant: tenant.slug,
            status: approval.status, keys: Object.keys(approval.raw || {}).slice(0, 8).join(',') }));
        }
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
    } catch (error) {
      // Antes este catch era MUDO: un sondeo roto dejaba las plantillas 'pending' para
      // siempre sin dejar rastro en ninguna parte (2026-08-24). Se sigue al siguiente
      // tenant — el cron reintenta en 5 min — pero ya no en silencio.
      console.log(JSON.stringify({ level: 'error', code: 'provision_poll_failed', tenant: tenant.slug,
        error: clean(error.message, 80) }));
    }
  }
}

// ── Informe semanal al canal del cliente (H1 §2, migración 0022) ─────────────
// El hueco más grande del análisis competitivo: NI UN SOLO proveedor español o
// latinoamericano manda un resumen periódico automático, y los pocos que lo mandan (solo
// Intercom fuera del mercado hispano) lo mandan por CORREO. Va por Telegram porque es
// donde el dueño YA está y porque no tiene ventana de 24 h: por WhatsApp haría falta una
// plantilla aprobada por Meta, que es un bloque aparte y comparte maquinaria con las
// plantillas de la bandeja (docs/H2-BANDEJA.md).
const WEEKLY_REPORT_HOUR = 7;    // UTC
const WEEKLY_REPORT_BATCH = 5;   // clientes por tick: el plan gratuito de D1 da 50 consultas por invocación
const WEEKLY_REPORT_TRIES = 3;

// El lunes desde las 07:00 UTC y durante 24 h. NO es un instante único a propósito: lo
// manda el cron de 5 minutos QUE YA EXISTE, así que un fallo puntual se reintenta en el
// tick siguiente en vez de esperar una semana, y no hace falta un segundo trigger ni
// ramificar por event.cron. Fuera de la ventana esta función no toca D1.
// Los crons de Cloudflare son UTC: son las 09:00 en horario de verano y las 08:00 en
// invierno. Se acepta el desfase de una hora; no merece lógica de husos.
function reportPeriod(now) {
  const d = new Date(now);
  const hour = d.getUTCHours(); const day = d.getUTCDay();   // 0 = domingo, 1 = lunes
  if (!((day === 1 && hour >= WEEKLY_REPORT_HOUR) || (day === 2 && hour < WEEKLY_REPORT_HOUR))) return null;
  // Lunes 00:00 UTC de la semana EN CURSO; la semana informada es la ANTERIOR.
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((day === 0 ? 7 : day) - 1));
  return {
    end: monday.toISOString(),
    start: new Date(monday.getTime() - 7 * 86400000).toISOString(),
    prev: new Date(monday.getTime() - 14 * 86400000).toISOString(),
    key: new Date(monday.getTime() - 7 * 86400000).toISOString().slice(0, 10),
  };
}

const dm = (iso) => iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/');

// «14 (▲ 3 más que la semana anterior)». Sin comparación cuando no es comparable — un
// «▼ 100%» calculado contra una semana sin datos registrados es una mentira, y es
// exactamente lo que pasa las dos primeras semanas del historial.
function reportMetric(label, value, previous, comparable) {
  const n = Number(value) || 0;
  if (!comparable) return `${label}: <b>${n}</b>`;
  const diff = n - (Number(previous) || 0);
  if (!diff) return `${label}: <b>${n}</b> <i>(igual que la semana anterior)</i>`;
  return `${label}: <b>${n}</b> <i>(${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} ${diff > 0 ? 'más' : 'menos'} que la semana anterior)</i>`;
}

function weeklyReportText(tenant, st, period, comparable) {
  const head = `📊 <b>TU SEMANA EN VELAI — ${escapeHtml(String(tenant.name || '').toUpperCase())}</b>\ndel ${dm(period.start)} al ${dm(new Date(new Date(period.end).getTime() - 86400000).toISOString())}\n\n`;
  // Una semana en blanco NO se disfraza de informe con cuatro ceros: se dice, y se
  // aprovecha para lo que este panel hace mejor que nadie — comprobar la entrega.
  if (!st.convs && !st.leads) {
    return head + 'Esta semana no ha entrado ninguna conversación.\n\n'
      + 'Si esperabas mensajes, merece la pena abrir el panel y mirar <b>Canales</b>: comprueba de verdad si tus avisos pueden salir (destinatarios, número, plantilla) y te dice qué falta.';
  }
  const lines = [
    reportMetric('💬 Conversaciones', st.convs, st.prevConvs, comparable),
    reportMetric('🎯 Leads', st.leads, st.prevLeads, comparable),
    reportMetric('📅 Citas', st.citas, st.prevCitas, comparable),
  ];
  if (st.unans) lines.push(`❓ Preguntas que no supe contestar: <b>${st.unans}</b>`);
  let text = head + lines.join('\n');
  if (st.unans) {
    text += `\n\n<i>Están en el panel, en Conversaciones → «Solo con preguntas sin respuesta». Arreglar tres o cuatro al mes es lo que más sube la tasa de resolución.</i>`;
  }
  return text;
}

// Un solo GROUP BY por tabla para TODO el lote, no cuatro consultas por cliente: con seis
// clientes eso serían 48 consultas y el plan gratuito de D1 corta en 50 por invocación.
async function weeklyStats(env, ids, period) {
  const holes = ids.map(() => '?').join(',');
  const blank = () => ({ convs: 0, unans: 0, prevConvs: 0, leads: 0, prevLeads: 0, citas: 0, prevCitas: 0 });
  const out = new Map(ids.map((id) => [id, blank()]));
  const [conv, leads, citas] = await env.DB.batch([
    // demo = '': las demos son juego de rol comercial de Velai, no conversaciones del negocio.
    env.DB.prepare(`SELECT tenant_id,
        SUM(CASE WHEN last_at >= ? THEN 1 ELSE 0 END) AS convs,
        SUM(CASE WHEN last_at >= ? THEN unanswered ELSE 0 END) AS unans,
        SUM(CASE WHEN last_at < ? THEN 1 ELSE 0 END) AS prev_convs
      FROM conversations WHERE demo = '' AND last_at >= ? AND last_at < ? AND tenant_id IN (${holes})
      GROUP BY tenant_id`).bind(period.start, period.start, period.start, period.prev, period.end, ...ids),
    env.DB.prepare(`SELECT tenant_id,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS leads,
        SUM(CASE WHEN created_at < ? THEN 1 ELSE 0 END) AS prev_leads
      FROM leads WHERE created_at >= ? AND created_at < ? AND tenant_id IN (${holes})
      GROUP BY tenant_id`).bind(period.start, period.start, period.prev, period.end, ...ids),
    env.DB.prepare(`SELECT tenant_id,
        SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS citas,
        SUM(CASE WHEN created_at < ? THEN 1 ELSE 0 END) AS prev_citas
      FROM appointments WHERE status = 'confirmed' AND created_at >= ? AND created_at < ? AND tenant_id IN (${holes})
      GROUP BY tenant_id`).bind(period.start, period.start, period.prev, period.end, ...ids),
  ]);
  for (const r of conv.results || []) Object.assign(out.get(r.tenant_id) || blank(), { convs: r.convs, unans: r.unans, prevConvs: r.prev_convs });
  for (const r of leads.results || []) Object.assign(out.get(r.tenant_id) || blank(), { leads: r.leads, prevLeads: r.prev_leads });
  for (const r of citas.results || []) Object.assign(out.get(r.tenant_id) || blank(), { citas: r.citas, prevCitas: r.prev_citas });
  return out;
}

async function sendWeeklyReports(env, now) {
  const period = reportPeriod(now);
  if (!period) return;
  // Los que faltan, de pocos en pocos. Una fila 'sent'/'skipped' o con los intentos
  // agotados ya no vuelve: la idempotencia vive en la tabla, no en la hora del cron.
  const pending = (await env.DB.prepare(`
    SELECT t.id, t.slug, t.name, t.telegram_chat_id, t.telegram_bot_token_enc FROM tenants t
    WHERE t.active = 1 AND t.weekly_report = 1
      AND NOT EXISTS (SELECT 1 FROM tenant_reports r WHERE r.tenant_id = t.id AND r.period_start = ?
                        AND (r.status IN ('sent','skipped') OR r.attempts >= ?))
    ORDER BY t.slug LIMIT ?`).bind(period.key, WEEKLY_REPORT_TRIES, WEEKLY_REPORT_BATCH).all()).results;
  if (!pending.length) return;
  const stats = await weeklyStats(env, pending.map((t) => t.id), period);
  // La comparación necesita que la semana anterior ESTUVIERA registrada. El historial de
  // conversaciones arrancó el 2026-08-26 (migración 0021): antes de eso el «anterior» es
  // cero por no haber existido, no por no haber pasado nada.
  const comparable = period.prev.slice(0, 10) >= CONV_TRACKING_SINCE;
  for (const tenant of pending) {
    // Reserva ANTES de enviar: un segundo tick del cron no puede mandar el mismo informe
    // dos veces. changes = 0 significa que otro tick se lo llevó o que agotó los intentos.
    const claim = await env.DB.prepare(`INSERT INTO tenant_reports (tenant_id,period_start,status,attempts,sent_at)
      VALUES (?,?,'sending',1,?)
      ON CONFLICT(tenant_id,period_start) DO UPDATE SET status='sending', attempts=attempts+1, sent_at=excluded.sent_at
        WHERE tenant_reports.attempts < ? AND tenant_reports.status NOT IN ('sent','skipped')`)
      .bind(tenant.id, period.key, new Date().toISOString(), WEEKLY_REPORT_TRIES).run();
    if (!claim.meta || !claim.meta.changes) continue;
    let status = 'sent'; let detail = null;
    if (!tenant.telegram_chat_id) {
      // Skip VISIBLE con su motivo, como la entrega dual de leads: un cliente sin
      // Telegram vinculado no es un silencio, es una tarea pendiente.
      status = 'skipped'; detail = 'telegram_not_configured';
    } else {
      const st = stats.get(tenant.id) || { convs: 0, leads: 0, citas: 0, unans: 0 };
      const botToken = await tenantTelegramToken(env, tenant);
      const outcome = await sendTelegramText(env, weeklyReportText(tenant, st, period, comparable),
        tenant.telegram_chat_id, { allowFallback: false, botToken });
      if (!outcome.ok) { status = 'failed'; detail = clean(outcome.error || 'telegram_failed', 60); }
    }
    await env.DB.prepare('UPDATE tenant_reports SET status=?, detail=?, sent_at=? WHERE tenant_id=? AND period_start=?')
      .bind(status, detail, new Date().toISOString(), tenant.id, period.key).run();
    console.log(JSON.stringify({ level: status === 'failed' ? 'error' : 'info', code: 'weekly_report', tenant: tenant.slug, period: period.key, status, detail }));
  }
}

// «Si pasados 5 min nadie toma el control, la IA retoma diciendo que no hay asesores
// disponibles» (Juan, 2026-08-26). Este camino cubre el caso en que el cliente final se
// queda CALLADO; si vuelve a escribir, handleTwilio lo resuelve en ese mismo mensaje sin
// esperar al cron. El cron corre cada 5 min, así que el plazo real está entre 5 y 10: no se
// disimula, se compensa con el otro camino.
const NO_ADVISOR_TEXT = 'Perdona la espera: al final no ha podido entrar nadie del equipo ahora mismo. Sigo yo y te ayudo con lo que pueda. Si quieres, déjame tu teléfono y les paso tu caso para que te escriban en cuanto puedan.';
// Aviso a mitad de cola. Existe para que no haya silencio: un chat mudo diez minutos se
// lee como abandono, y es justo cuando la gente cierra la pestaña.
const QUEUE_WAIT_TEXT = 'Sigo buscando a alguien del equipo, están terminando otra conversación. Gracias por esperar — en cuanto se libere alguien te escribe aquí mismo.';

// Atiende la cola: avisa a mitad y solo se rinde al final. En el canal WEB el mensaje no se
// envía a ningún proveedor — se guarda y el widget lo recoge en su sondeo.
async function expireTakeovers(env) {
  const cutoff = new Date(Date.now() - TAKEOVER_GRACE_MIN * 60000).toISOString();
  // LIMIT bajo a propósito: el cron ya gasta consultas en la cola de leads y los avisos, y
  // el plan gratuito de D1 corta en 50 por invocación.
  const rows = (await env.DB.prepare(`SELECT id, tenant_id, external_id, channel, inbox_address, demo, msgs, state_at, queue_pings
    FROM conversations WHERE state='esperando' AND state_at <= ? LIMIT 5`).bind(cutoff).all()).results || [];
  for (const c of rows) {
    const esperados = waitedMin(c.state_at);
    const seRinde = esperados >= QUEUE_MAX_MIN;
    // A mitad de cola solo se avisa UNA vez: sin queue_pings el cron repetiría el mismo
    // mensaje cada 5 minutos hasta agotar la espera.
    if (!seRinde && Number(c.queue_pings) > 0) continue;
    const texto = seRinde ? NO_ADVISOR_TEXT : QUEUE_WAIT_TEXT;
    // ORDEN CRÍTICO: el mensaje se GUARDA antes de cambiar el estado. El widget del canal web
    // deja de preguntar en cuanto ve 'bot', así que al revés —como estaba— su sondeo podía
    // caer en el hueco entre el UPDATE y el guardado y el aviso de los 15 minutos se
    // escribía cuando ya no había nadie escuchando. Es exactamente lo que vio Juan: el de
    // los 10 llegó y el de los 15 no.
    await convAppend(env, { id: c.id, tenant: c.tenant_id, channel: c.channel, externalId: c.external_id,
      inbox: c.inbox_address, demo: c.demo || '', msgs: c.msgs, isNew: false },
    [{ role: 'assistant', content: texto }]);
    if (seRinde) {
      // Se libera SIEMPRE, aunque el envío por Twilio falle después: dejarla en 'esperando'
      // la congelaría y el bot no volvería a contestarle nunca.
      await env.DB.prepare("UPDATE conversations SET state='bot', state_at=? WHERE id=? AND state='esperando'")
        .bind(new Date().toISOString(), c.id).run();
      if (env.KV) { try { await env.KV.delete(`pause:${c.tenant_id}:${c.external_id}`); } catch (_) {} }
      console.log(JSON.stringify({ level: 'info', code: 'takeover_expired', via: 'cron', channel: c.channel, waited: Math.round(esperados) }));
    } else {
      await env.DB.prepare('UPDATE conversations SET queue_pings=queue_pings+1 WHERE id=?').bind(c.id).run();
      console.log(JSON.stringify({ level: 'info', code: 'queue_ping', channel: c.channel, waited: Math.round(esperados) }));
    }
    // En web el guardado YA es la entrega: el widget lo recoge en su sondeo. Solo los canales
    // de Twilio necesitan salida, y su fallo no puede deshacer nada de lo anterior.
    if (c.channel === 'web' || !c.inbox_address) continue;
    const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id=?').bind(c.tenant_id).first();
    if (!tenant) continue;
    const sent = await sendTwilioText(env, tenant, c.inbox_address, c.external_id, texto);
    if (!sent.ok) {
      console.log(JSON.stringify({ level: 'error', code: 'queue_notice_failed', tenant: tenant.slug, error: clean(sent.error || 'skipped', 40) }));
    }
  }
}

const MINUTE_CRON = '* * * * *';

async function scheduled(env, cron) {
  if (!env.DB) return;
  const now = new Date().toISOString();
  // El reloj de CADA MINUTO solo atiende la cola de espera: es lo único que necesita
  // precisión de minuto. Lo demás no puede correr cada minuto porque drainQueuedLeads hace
  // un LISTADO de KV por tick (1.000/día en el plan gratuito) y porque multiplicaría por
  // cinco los reintentos a Twilio y a Telegram.
  if (cron === MINUTE_CRON) {
    try { await expireTakeovers(env); } catch (error) {
      console.log(JSON.stringify({ level: 'error', code: 'takeover_expiry_failed', error: clean(String(error.message || error), 80) }));
    }
    return;
  }
  await drainQueuedLeads(env);
  try { await pollProvisioning(env); } catch (_) {}
  // Dos consultas con ORDER BY: lo entregable (pending/failed) tiene prioridad y las
  // filas 'skipped' perpetuas no pueden acaparar la ventana del cron (inanición).
  // Red por si el reloj de cada minuto no llegara a dispararse: es idempotente, así que
  // repetirlo no cuesta nada y sin esto un fallo del otro trigger congelaría la cola.
  try { await expireTakeovers(env); } catch (error) {
    console.log(JSON.stringify({ level: 'error', code: 'takeover_expiry_failed', error: clean(String(error.message || error), 80) }));
  }
  // El informe semanal vive aquí y no en un trigger propio: así un fallo se reintenta en
  // el tick siguiente en vez de esperar una semana. Fuera de la ventana del lunes, sale
  // sin tocar D1. Nunca lanza: no puede impedir que se entreguen los avisos de leads.
  try { await sendWeeklyReports(env, now); } catch (error) {
    console.log(JSON.stringify({ level: 'error', code: 'weekly_report_failed', error: clean(String(error.message || error), 80) }));
  }
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
  // Transcripciones (migración 0021): retención propia y MÁS CORTA que la de los leads —
  // una transcripción es más sensible que una ficha. LIMIT bajo porque cada fila arrastra
  // sus mensajes por ON DELETE CASCADE: 100 conversaciones pueden ser miles de filas.
  try {
    await env.DB.prepare('DELETE FROM conversations WHERE id IN (SELECT id FROM conversations WHERE expires_at <= ? LIMIT 100)').bind(now).run();
  } catch (error) {
    console.log(JSON.stringify({ level: 'error', code: 'conv_purge_failed', error: clean(String(error.message || error), 80) }));
  }
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
        if (path === '/oauth/calendar/callback' && request.method === 'GET') {
          // Mismo perímetro que el panel: solo en el hostname de Access (en el
          // público es un 404 idéntico al de cualquier ruta inexistente).
          const host = adminHost(env);
          if (!host || url.hostname !== host) throw new HttpError(404, 'not_found');
          return await handleCalendarCallback(request, env, ctx, url);
        }
        const contentType = request.headers.get('Content-Type') || '';
        if (path === '/' && request.method === 'POST' && contentType.includes('application/x-www-form-urlencoded')) {
          // Con el reorden tenant→firma, una petición sin firma ya toca D1: rate limit por IP.
          const twilioIp = request.headers.get('CF-Connecting-IP') || 'unknown';
          if (await rateLimited(env, twilioIp, 'twilio', 120)) throw new HttpError(429, 'rate_limited');
          return await handleTwilio(request, env, ctx, config);
        }
        if (path === '/telegram/webhook' && request.method === 'POST') {
          // Público (lo llama Telegram, fuera de Access): primero el secreto, y 200
          // SIEMPRE — un 403 confirma el endpoint a un escáner y pone a Telegram a
          // reintentar en bucle. Sin secreto configurado, el endpoint no existe.
          if (!env.TELEGRAM_WEBHOOK_SECRET || !timingSafeEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '', env.TELEGRAM_WEBHOOK_SECRET)) {
            return json({ ok: true }, 200, NO_STORE);
          }
          const tgIp = request.headers.get('CF-Connecting-IP') || 'unknown';
          if (await rateLimited(env, tgIp, 'tgwh', 120)) return json({ ok: true }, 200, NO_STORE);
          return await handleTelegramWebhook(request, env, ctx);
        }
        if (path === '/widget/boot' && request.method === 'GET') {
          return await handleWidgetBoot(request, env, url);
        }
        if (path.startsWith('/media/') && request.method === 'GET') {
          const key = path.slice('/media/'.length);
          if (!MEDIA_KEY_RE.test(key) || key.includes('..')) throw new HttpError(404, 'not_found');
          // Caché del edge: la URL va versionada, así que un logo se lee del almacén una
          // vez por centro de datos en lugar de una vez por visitante del widget.
          const cache = caches.default;
          const cached = await cache.match(request);
          if (cached) return cached;
          const obj = await mediaGet(env, key);
          if (!obj) throw new HttpError(404, 'not_found');
          // La URL va versionada (?v=): cachear un año es seguro y la foto la lee
          // también Meta al aplicar el perfil de WhatsApp — tiene que ser pública.
          const headers = { 'Content-Type': obj.contentType, 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' };
          if (obj.etag) headers.ETag = obj.etag;
          const media = new Response(obj.body, { headers });
          ctx.waitUntil(cache.put(request, media.clone()).catch(() => {}));
          return media;
        }
        if (path === '/chat/poll') {
          const cors = await publicCors(request, env);
          if (!cors) throw new HttpError(403, 'origin_not_allowed');
          if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
          if (request.method !== 'GET') throw new HttpError(405, 'method_not_allowed');
          return await handleChatPoll(request, env, cors, url);
        }
        if (path === '/lead' || path === '/chat') {
          const cors = await publicCors(request, env);
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
        const { status, code, detail, why } = errorResponseParts(error);
        console.log(JSON.stringify({ level: status >= 500 ? 'error' : 'warn', code, status, path, ...detail, requestId: request.headers.get('cf-ray') || crypto.randomUUID() }));
        return json({ ok: false, error: code, ...(why ? { why } : {}) }, status, (await publicCors(request, env).catch(() => null)) || {});
      }
    },
    async scheduled(event, env, ctx) { ctx.waitUntil(scheduled(env, event && event.cron)); },
  };
}

export const testing = { scheduled, MINUTE_CRON, waitedMin, QUEUE_MAX_MIN, QUEUE_WAIT_TEXT, canAttend, velaiTenantId, handleChatPoll, VISITOR_AWAY_MS, expireTakeovers, NO_ADVISOR_TEXT, graceExpired, systemWithHandoff, HANDOFF_ON, HANDOFF_OFF, supportWindows, withinSupportHours, advisorAvailable, CONV_STATES, TAKEOVER_GRACE_MIN, settleReply, TRUNCATED_CLOSING, trimToSentence, waBody, replyWindow, reportPeriod, reportMetric, weeklyReportText, weeklyStats, sendWeeklyReports, convLoad, convAppend, convLinkLead, convFilters, convRetentionDays, UNANSWERED_RE, CONV_WINDOW, cloudflareUsage, CF_FREE_LIMITS, recordConversation, aiCost, recordAiUsage, rateLimited, memLimited, applySenderProfile, pushSenderProfile, clean, persistLead, leadAlertStatus, captureWhatsAppLead, leadFromSummary, leadCaptureDone, errorResponseParts, tenantByAddress, syncPrimaryChannel, assertChannelFree, normalizePhone, extractPhone, safeUtm, publicCors, validTwilioSignature, callAnthropic, callAnthropicRaw, runToolLoop, calendarExecutor, calendarSystem, tenantCalendar, validCalendarDate, availableSlots, handleCalendarCallback, calendarCallbackFor, sendTwilioText, timingSafeEqual, telegramBotUsername, telegramSetWebhook, telegramWebhookInfo, handleTelegramWebhook, sendTelegramText, tenantTelegramToken, telegramThreadFor, registerTelegramTopic, csvCell, expiryDate, leadFilters, isDemoKey, templateVar, leadTemplateVariables, readJson, deliver, drainQueuedLeads, verifyTurnstile, systemFor, validateTenant, invalidateTenantCache, tenantWriteError, assertNotActivePending, tenantChannelSummary, channelsForScope, handleProvision, pollProvisioning, fillSeries, resolveScope, scopeClause, assertOwnTenant, clienteAllowed, adminRouter, recordAuthFailure, handleAdmin, handleWidgetBoot, allowedOrigins, envOrigins, syncPanelGate, envAdmins, syncAdminGate, getSetting, setSetting, withCfToken };
