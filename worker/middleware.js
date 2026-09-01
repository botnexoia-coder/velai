// Perímetro del panel como ESTRUCTURA, no como disciplina (migración a Hono 4).
//
// Antes, cada petición admin pasaba por handleAdmin —una función que había que
// acordarse de llamar— y el aislamiento vivía en que cada handler del monolito
// recordara su puerta. Ahora la cadena identidad → scope → clienteAllowed son
// middlewares de Hono aplicados a TODO /api/admin/*: un endpoint nuevo nace ya
// detrás de ellas, no puede registrarse fuera del perímetro.
//
// Orden (el mismo que tenía handleAdmin, verificado por tests):
//   mwAdminHost      solo el hostname de ADMIN_ORIGIN (en workers.dev, 404)
//   mwAdminCors      el Origin de una escritura debe ser el propio panel
//   mwAdminIdentity  JWT de Cloudflare Access verificado (firma JWKS, iss, aud, exp)
//   mwResolveScope   identidad → alcance (quién eres → qué filas ves) + rate limit
//   clienteGate      lista blanca de rutas del rol cliente (403 ANTES de tocar datos)
//
// Lo que NO vive aquí: scopeClause/assertOwnTenant se aplican DENTRO de cada
// consulta — el middleware sabe QUIÉN pregunta, pero solo el handler sabe qué
// SQL construye. Esa mitad la vigila scripts/check-aislamiento.mjs.
import { HttpError, clean, rateLimited, sendTelegramText, escapeHtml, decodeBase64Url } from './app.js';

// Sin fallback silencioso: si ADMIN_ORIGIN falta o es inválida, las rutas de admin
// fallan con 503 explícito — pero las rutas públicas del router no deben verse afectadas,
// por eso estas funciones devuelven null en vez de lanzar.
export function adminOrigin(env) {
  try { return new URL(env.ADMIN_ORIGIN).origin; } catch (_) { return null; }
}

export function adminHost(env) {
  const origin = adminOrigin(env);
  return origin ? new URL(origin).hostname : null;
}

export function adminCorsGuard(request, env) {
  const expected = adminOrigin(env);
  if (!expected) throw new HttpError(503, 'admin_misconfigured');
  const origin = request.headers.get('Origin');
  // Comparar orígenes normalizados: una barra final en la variable no debe romper las escrituras.
  if (origin && origin !== expected) throw new HttpError(403, 'invalid_admin_origin');
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

export async function adminIdentity(request, env) {
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

// ── Identidad → alcance (SPEC-HANDOFF §B) ────────────────────────────────────
// Access dice QUIÉN eres; esto dice QUÉ puedes ver. Sin coincidencia no se entra:
// que Access te deje pasar no te autoriza a ver leads de nadie. Los admins van en
// ADMIN_EMAILS (var), nunca en la tabla: una fila borrada no deja a Velai fuera.
// Admins raíz: los del entorno, indestructibles (ninguna operación del panel los toca).
export function envAdmins(env) {
  return clean(env.ADMIN_EMAILS, 500).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}

export async function resolveScope(env, email) {
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
export function scopeClause(scope, alias = 'l') {
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
export function assertOwnTenant(scope, tenantId) {
  if (scope.role !== 'velai' && scope.tenantId !== tenantId) throw new HttpError(404, 'not_found');
  return tenantId;
}

// Rutas que el rol cliente SÍ puede usar. Todo lo demás — tenants, provisioning,
// preview, versiones, retry, borrado RGPD — es 403 ANTES de tocar datos.
// OJO: test/aislamiento.test.js LEE el código fuente de esta función (toString) para
// exigir que cada ruta abierta tenga su caso en el barrido adversario. Mantén el
// formato de cada línea: `if (path === '...') ...` o `if (/regex/.test(path) ...`.
export function clienteAllowed(path, method) {
  if (path === '/api/admin/leads' && method === 'GET') return true;
  if (path === '/api/admin/leads/export.csv' && method === 'GET') return true;
  if (path === '/api/admin/appointments' && method === 'GET') return true;
  // Sus plantillas, en su espacio (solo lectura): el handler devuelve SOLO su fila
  // (el id sale del scope) y sin sids. La gestión sigue siendo solo de Velai.
  if (path === '/api/admin/plantillas' && method === 'GET') return true;
  // Sus SOLICITUDES de cambio: crear (validada contra el catálogo, tenant del scope,
  // 1 pendiente por tipo) y ver las suyas. Aprobar/rechazar sigue siendo solo-Velai.
  if (path === '/api/admin/solicitudes' && ['GET', 'POST'].includes(method)) return true;
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
export async function recordAuthFailure(env, email) {
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

// ── Middlewares de Hono (la cadena de handleAdmin, hecha estructura) ──────────

// El panel y su API solo existen en el hostname de Access; en workers.dev el
// JWT seguiría siendo el guardián, pero no hay motivo para exponer la ruta.
export async function mwAdminHost(c, next) {
  const host = adminHost(c.env);
  if (!host) throw new HttpError(503, 'admin_misconfigured');
  if (new URL(c.req.url).hostname !== host) throw new HttpError(404, 'not_found');
  await next();
}

export async function mwAdminCors(c, next) {
  adminCorsGuard(c.req.raw, c.env);
  await next();
}

export async function mwAdminIdentity(c, next) {
  c.set('identity', await adminIdentity(c.req.raw, c.env));
  await next();
}

export async function mwResolveScope(c, next) {
  const identity = c.get('identity');
  if (!c.env.DB) throw new HttpError(503, 'lead_storage_not_configured');
  if (await rateLimited(c.env, String(identity).toLowerCase(), 'admin', 120)) throw new HttpError(429, 'rate_limited');
  let scope;
  try {
    scope = await resolveScope(c.env, identity);
  } catch (e) {
    if (e instanceof HttpError && e.code === 'not_authorized') c.executionCtx.waitUntil(recordAuthFailure(c.env, identity));
    throw e;
  }
  c.set('scope', scope);
  await next();
}

// La lista blanca del rol cliente, ANTES de que ningún handler toque datos. Vive en
// el sub-app admin (no en la cadena de identidad) para que el barrido de
// test/aislamiento.test.js —que inyecta el scope sin pasar por Access— la ejerza igual.
export async function clienteGate(c, next) {
  const scope = c.get('scope');
  if (scope.role !== 'velai' && !clienteAllowed(c.req.path, c.req.method)) throw new HttpError(403, 'not_authorized');
  await next();
}

// Lo que todo handler admin necesita del contexto de Hono, con los MISMOS nombres
// que tenían dentro del monolito: la migración de cada bloque es copiar el cuerpo.
export function partesAdmin(c) {
  const scope = c.get('scope');
  return {
    request: c.req.raw,
    env: c.env,
    ctx: c.executionCtx,
    url: new URL(c.req.url),
    config: c.get('config'),
    scope,
    actor: scope.email,
  };
}
