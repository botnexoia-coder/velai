// Rutas PÚBLICAS del worker (todo lo que no es /api/admin/*): chat web, leads,
// widget, medios, webhooks de Twilio y Telegram y el callback OAuth del calendario.
//
// Este módulo solo CABLEA: los handlers viven en worker/app.js porque comparten
// helpers con el cron y con el panel (convLoad, storeLead, publicCors…). Cada rama
// conserva el orden y las guardas del router monolítico original — mismo contrato,
// verificado por test/worker.test.js.
import { Hono } from 'hono';
import { adminHost, adminIdentity } from '../middleware.js';
import {
  HttpError, json, NO_STORE, publicCors, rateLimited, timingSafeEqual,
  adminPageResponse, handleTwilio, handleTelegramWebhook, handleWidgetBoot,
  handleChatPoll, handleLead, handleChat, handleCalendarCallback,
  mediaGet, MEDIA_KEY_RE,
} from '../app.js';

export const publico = new Hono();

// ── Panel v2 (React, servido como estáticos por el worker) ───────────────────
// La SPA compilada (panel/dist) llega por el binding ASSETS (wrangler.toml [assets] con
// run_worker_first: TODO entra al worker y es él quien decide). Solo en el hostname del
// panel y solo con la bandera PANEL_V2 — sin ella el v1 serializado sigue tal cual, así
// que el rollback es quitar la bandera y desplegar. Detalles: panel/INTEGRACION.md.
const PANEL_V2_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; "
  + 'font-src https://hirevai.com; img-src \'self\' https: data:; connect-src \'self\'; '
  + "base-uri 'none'; frame-ancestors 'none'";
function panelV2Activo(env, url) {
  return env.PANEL_V2 === '1' && Boolean(env.ASSETS) && url.hostname === adminHost(env);
}
// Separado de la identidad a propósito: así se puede probar la mecánica de servir
// (fallback de SPA, cabeceras, caché) sin fabricar un JWT de Access en los tests.
async function panelV2Assets(request, env, url) {
  let res = await env.ASSETS.fetch(request);
  // SPA con react-router: cualquier ruta de vista (/leads, /conversaciones…) es index.html.
  if (res.status === 404) res = await env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
  const out = new Response(res.body, res);
  // CSP SIN nonce ni inline: el v2 son ficheros externos del mismo origen y React aplica
  // estilos por CSSOM. Más estricta que la del v1, no menos.
  out.headers.set('Content-Security-Policy', PANEL_V2_CSP);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  out.headers.set('X-Frame-Options', 'DENY');
  out.headers.set('Referrer-Policy', 'no-referrer');
  // El HTML no se cachea (un deploy o el rollback deben verse al momento); los assets
  // llevan hash en el nombre y pueden ser immutable, como los del sitio público.
  const esHtml = (out.headers.get('Content-Type') || '').includes('text/html');
  out.headers.set('Cache-Control', esHtml ? 'no-store' : 'public, max-age=31536000, immutable');
  return out;
}
async function panelV2Response(request, env, url) {
  // La misma puerta que el v1: el JWT de Access se valida ANTES de servir un byte.
  // Los datos viajan por /api/admin/* (que valida igual), pero el HTML tampoco se regala.
  await adminIdentity(request, env);
  return panelV2Assets(request, env, url);
}

// La raíz atiende a TRES clientes distintos y el orden importa:
// 1) GET en el hostname del panel = la página del admin (tras validar el JWT);
// 2) POST x-www-form-urlencoded = webhook de Twilio (WhatsApp/Messenger);
// 3) POST JSON = el chat de la arquitectura RETIRADA — 410 a propósito
//    (docs/GUIA-WORKERS.md §1: no volver a abrirlo).
publico.all('/', async (c) => {
  const request = c.req.raw; const env = c.env;
  const url = new URL(c.req.url);
  if (url.hostname === adminHost(env) && request.method === 'GET') {
    if (panelV2Activo(env, url)) return panelV2Response(request, env, url);
    await adminIdentity(request, env);
    return adminPageResponse();
  }
  const contentType = request.headers.get('Content-Type') || '';
  if (request.method === 'POST' && contentType.includes('application/x-www-form-urlencoded')) {
    // Con el reorden tenant→firma, una petición sin firma ya toca D1: rate limit por IP.
    const twilioIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (await rateLimited(env, twilioIp, 'twilio', 120)) throw new HttpError(429, 'rate_limited');
    return handleTwilio(request, env, c.executionCtx, c.get('config'));
  }
  if (request.method === 'POST' && contentType.includes('application/json')) throw new HttpError(410, 'legacy_chat_retired');
  throw new HttpError(404, 'not_found');
});

publico.post('/telegram/webhook', async (c) => {
  const request = c.req.raw; const env = c.env;
  // Público (lo llama Telegram, fuera de Access): primero el secreto, y 200
  // SIEMPRE — un 403 confirma el endpoint a un escáner y pone a Telegram a
  // reintentar en bucle. Sin secreto configurado, el endpoint no existe.
  if (!env.TELEGRAM_WEBHOOK_SECRET || !timingSafeEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '', env.TELEGRAM_WEBHOOK_SECRET)) {
    return json({ ok: true }, 200, NO_STORE);
  }
  const tgIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (await rateLimited(env, tgIp, 'tgwh', 120)) return json({ ok: true }, 200, NO_STORE);
  return handleTelegramWebhook(request, env, c.executionCtx);
});

publico.get('/widget/boot', async (c) => handleWidgetBoot(c.req.raw, c.env, new URL(c.req.url)));

publico.get('/media/*', async (c) => {
  const request = c.req.raw; const env = c.env;
  const key = c.req.path.slice('/media/'.length);
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
  c.executionCtx.waitUntil(cache.put(request, media.clone()).catch(() => {}));
  return media;
});

publico.all('/chat/poll', async (c) => {
  const request = c.req.raw; const env = c.env;
  const cors = await publicCors(request, env);
  if (!cors) throw new HttpError(403, 'origin_not_allowed');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET') throw new HttpError(405, 'method_not_allowed');
  return handleChatPoll(request, env, cors, new URL(c.req.url));
});

// /lead y /chat comparten el mismo perímetro: CORS exacto, preflight, solo POST y
// rate limit por IP (5/min los leads, 20/min el chat).
const leadOChat = async (c) => {
  const request = c.req.raw; const env = c.env;
  const path = c.req.path;
  const cors = await publicCors(request, env);
  if (!cors) throw new HttpError(403, 'origin_not_allowed');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (await rateLimited(env, ip, path.slice(1), path === '/lead' ? 5 : 20)) throw new HttpError(429, 'rate_limited');
  return path === '/lead'
    ? handleLead(request, env, cors, c.executionCtx)
    : handleChat(request, env, cors, c.executionCtx, c.get('config'));
};
publico.all('/lead', leadOChat);
publico.all('/chat', leadOChat);

// Mismo perímetro que el panel: solo en el hostname de Access (en el
// público es un 404 idéntico al de cualquier ruta inexistente).
publico.get('/oauth/calendar/callback', async (c) => {
  const host = adminHost(c.env);
  if (!host || new URL(c.req.url).hostname !== host) throw new HttpError(404, 'not_found');
  return handleCalendarCallback(c.req.raw, c.env, c.executionCtx, new URL(c.req.url));
});

// Rutas de la SPA del v2 (/leads, /conversaciones, /assets/index-*.js…). Registrado el
// ÚLTIMO: toda ruta real del worker gana antes de llegar aquí (y /api/admin/* ni entra a
// este router). Sin bandera o fuera del hostname del panel, este comodín no existe: 404
// idéntico al de siempre — el worker público no cambia ni un byte de conducta.
publico.get('*', async (c) => {
  const url = new URL(c.req.url);
  if (panelV2Activo(c.env, url)) return panelV2Response(c.req.raw, c.env, url);
  throw new HttpError(404, 'not_found');
});

export const testingPanelV2 = { panelV2Activo, panelV2Assets };
