import { HttpError, verifyTurnstile } from './app.js';
import { adminHost } from './middleware.js';
import { digest } from './agenda.js';

export function bookingOrigin(env) {
  try {
    const u = new URL(env.BOOKING_ORIGIN);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash || !/^citas(?:-staging)?\.hirevai\.com$/.test(u.hostname) || u.hostname === adminHost(env)) return null;
    return u.origin;
  } catch (_) { return null; }
}
export function bookingHost(env) { const origin = bookingOrigin(env); return origin ? new URL(origin).hostname : null; }
export async function mwBookingHost(c, next) {
  const host = bookingHost(c.env);
  if (!host || new URL(c.req.url).hostname !== host) throw new HttpError(404, 'not_found');
  await next();
}
export function bookingWriteOrigin(request, env) {
  if (!bookingOrigin(env) || request.headers.get('Origin') !== bookingOrigin(env)) throw new HttpError(403, 'origin_not_allowed');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new HttpError(415, 'json_required');
}
export async function bookingRateLimit(env, request, bucket, limit) {
  const now = Date.now();
  const key = `${bucket}:${await digest(request.headers.get('CF-Connecting-IP') || 'unknown')}`;
  const row = await env.DB.prepare(`INSERT INTO booking_rate_limits(key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`)
    .bind(key, now + 60000, now, now).first();
  if (!row || row.count > limit) throw new HttpError(429, 'rate_limited');
}
export async function bookingHuman(env, request, body) {
  await verifyTurnstile(env, body.turnstileToken, request, 'reserva', bookingHost(env));
}
// tenants.web_origins es un ARRAY JSON (lo escribe validateTenant con JSON.stringify y
// así lo lee allowedOrigins): partirlo por comas dejaba fuera TODOS los dominios del
// cliente —con corchetes y comillas, cada trozo falla al parsear como URL— y la página
// salía con frame-ancestors sin ellos, o sea con el iframe y el popup bloqueados.
export function frameOrigins(env, tenant) {
  const allowed = new Set();
  let listed = [];
  try { const parsed = JSON.parse(tenant.web_origins || '[]'); if (Array.isArray(parsed)) listed = parsed; } catch (_) {}
  for (const raw of listed) {
    const value = String(raw).trim();
    try { const u = new URL(value); if (u.protocol === 'https:' && !u.username && !u.password && !u.hostname.includes('*') && u.origin === value) allowed.add(u.origin); } catch (_) {}
  }
  try { const u = new URL(env.ADMIN_ORIGIN); if (u.protocol === 'https:' && !u.username && !u.password) allowed.add(u.origin); } catch (_) {}
  return [...allowed];
}
// Requisitos de SERVIDOR para que la página pública pueda existir. Se consultan antes
// de encenderla (el panel los pinta) y al encenderla (el PATCH nombra el que falla):
// un 503 genérico obligaba a adivinar cuál de los cuatro era.
export function bookingReadiness(env) {
  const faltan = [];
  if (!bookingOrigin(env)) faltan.push('origin');
  if (!env.APP_SECRET) faltan.push('secret');
  else if (String(env.APP_SECRET).length < 32) faltan.push('secret_corto');
  if (!env.TURNSTILE_SITEKEY || !env.TURNSTILE_SECRET_KEY) faltan.push('turnstile');
  return faltan;
}

export const BOOKING_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };
