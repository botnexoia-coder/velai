// Dominio CONFIG/MÉTRICAS del panel: quién soy (/me), las métricas del dashboard
// (/stats), el consumo de IA (coste solo-Velai y saldo del cliente), el consumo de
// infraestructura, la Configuración de admins raíz (token de Cloudflare, webhook de
// Telegram) y los admins gestionados. Migrado tal cual del adminRouter monolítico.
import { Hono } from 'hono';
import { partesAdmin, envAdmins } from '../middleware.js';
import { verifyCfToken } from '../cloudflare.js';
import {
  HttpError, json, NO_STORE, clean, readJson, getSetting, setSetting,
  cloudflareUsage, aiCost, fillSeries, syncAdminGate, telegramWebhookInfo,
  sendTelegramText, escapeHtml, UUID_RE, PANEL_EMAIL_RE, CONV_TRACKING_SINCE,
} from '../app.js';

export const configuracion = new Hono();

configuracion.get('/api/admin/me', async (c) => {
  const { env, scope } = partesAdmin(c);
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
});

configuracion.get('/api/admin/stats', async (c) => {
  const { env, scope } = partesAdmin(c);
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
    // Por día Y por canal: la gráfica enseña el total y el globo el desglose. Antes
    // solo se sabía «7 leads el jueves», que no dice si vinieron de WhatsApp o de la web
    // — que es justo lo que decide dónde mirar cuando un día se cae.
    env.DB.prepare(`SELECT date(created_at) AS d, source, COUNT(*) AS n FROM leads WHERE created_at >= datetime('now','-14 days')${leadW} GROUP BY d, source ORDER BY d`).bind(...leadArgs),
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
    porDia: (() => {
      // La consulta viene por día+canal: se pliega a un total por día (que es lo que
      // pinta la barra) conservando el desglose ordenado de mayor a menor.
      const porDiaCanal = new Map();
      for (const r of serieRows.results || []) {
        const e = porDiaCanal.get(r.d) || { n: 0, canales: [] };
        e.n += r.n; e.canales.push({ canal: r.source || 'sin canal', n: r.n });
        porDiaCanal.set(r.d, e);
      }
      // fillSeries rellena los días sin leads: sin eso la gráfica comprime el eje y
      // miente sobre la distribución.
      return fillSeries([...porDiaCanal].map(([d, e]) => ({ d, n: e.n })), 14)
        .map((x) => ({ ...x, canales: ((porDiaCanal.get(x.d) || {}).canales || []).sort((a, b) => b.n - a.n) }));
    })(),
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
});

// ── Configuración (SOLO admins raíz): estado de integraciones y rotación del
// token de API de Cloudflare. Raíz = envAdmins (los del toml): ni siquiera un admin
// dado de alta en el panel puede tocar tokens — dos factores reales en vez de un PIN.
// El middleware cubre CUALQUIER método sobre estas tres rutas, como el if del monolito.
const soloRaiz = async (c, next) => {
  const { env, actor } = partesAdmin(c);
  if (!envAdmins(env).includes(String(actor).toLowerCase())) throw new HttpError(403, 'root_only');
  await next();
};
configuracion.use('/api/admin/config', soloRaiz);
configuracion.use('/api/admin/config/cf-token', soloRaiz);
configuracion.use('/api/admin/config/telegram-webhook', soloRaiz);

configuracion.get('/api/admin/config', async (c) => {
  const { env } = partesAdmin(c);
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
});

// Bajo demanda y no dentro de /config: llamar a Telegram en cada carga de la vista
// sería una llamada externa por visita para un dato que casi nunca cambia.
configuracion.get('/api/admin/config/telegram-webhook', async (c) => {
  const { env } = partesAdmin(c);
  return json(await telegramWebhookInfo(env), 200, NO_STORE);
});

configuracion.post('/api/admin/config/cf-token', async (c) => {
  const { request, env, ctx, actor } = partesAdmin(c);
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
});

configuracion.delete('/api/admin/config/cf-token', async (c) => {
  const { env, ctx, actor } = partesAdmin(c);
  try { await env.DB.prepare("DELETE FROM settings WHERE key='cf_api_token'").run(); } catch (_) {}
  ctx.waitUntil(sendTelegramText(env, `🔑 <b>${escapeHtml(actor)}</b> retiró el token del panel: vuelve a usarse el secret del worker.`).catch(() => {}));
  return json({ ok: true, source: env.CF_API_TOKEN ? 'worker' : 'none' }, 200, NO_STORE);
});

// ── Admins de Velai gestionados desde el panel (migración 0009) ──────────────
// Solo rol velai (clienteAllowed no incluye estas rutas). Los ADMIN_EMAILS del
// entorno son RAÍZ: se listan pero no se pueden borrar desde aquí. La auditoría va
// por Telegram + log (no hay tenant al que colgar una versión). Cada alta/baja
// sincroniza también la política «Equipo Velai» de Access (env raíz SIEMPRE dentro).
configuracion.get('/api/admin/admins', async (c) => {
  const { env } = partesAdmin(c);
  let rows = [];
  try { rows = (await env.DB.prepare('SELECT email, created_by, created_at FROM admin_users ORDER BY created_at').all()).results || []; } catch (_) {}
  const admins = [
    ...envAdmins(env).map((email) => ({ email, root: true })),
    ...rows.map((r) => ({ email: r.email, root: false, created_by: r.created_by, created_at: r.created_at })),
  ];
  return json({ admins }, 200, NO_STORE);
});

configuracion.post('/api/admin/admins', async (c) => {
  const { request, env, ctx, actor } = partesAdmin(c);
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
});

configuracion.delete('/api/admin/admins/:email', async (c) => {
  const { env, ctx, actor } = partesAdmin(c);
  const email = c.req.param('email').trim().toLowerCase();
  if (envAdmins(env).includes(email)) throw new HttpError(400, 'admin_is_root');
  // Quitarse a uno mismo es la receta del cierre accidental: que lo haga otro admin.
  if (email === String(actor).toLowerCase()) throw new HttpError(400, 'cannot_remove_self');
  const result = await env.DB.prepare('DELETE FROM admin_users WHERE lower(email) = ?').bind(email).run();
  if (!result.meta || !result.meta.changes) throw new HttpError(404, 'not_found');
  console.log(JSON.stringify({ level: 'info', code: 'admin_removed', email, actor }));
  ctx.waitUntil(sendTelegramText(env, `👑 <b>${escapeHtml(actor)}</b> quitó al ADMIN <code>${escapeHtml(email)}</code>.`).catch(() => {}));
  const gate = await syncAdminGate(env, ctx);
  return json({ ok: true, gate }, 200, NO_STORE);
});

// ── Consumo de infraestructura (solo Velai) ───────────────────────────────
configuracion.get('/api/admin/infra-usage', async (c) => {
  const { env } = partesAdmin(c);
  return json(await cloudflareUsage(env), 200, NO_STORE);
});

// ── Consumo de IA por cliente (solo Velai) ────────────────────────────────
// El gasto real de cada cliente en euros/dólares: sin esto no se sabe si un cliente
// cuesta más de lo que paga, ni quién dispara el cupo diario.
// Saldo de IA del mes, para el panel DEL CLIENTE. Deliberadamente sin coste: la tarjeta
// de gasto en dólares es velai-only porque enseñarle al cliente lo que pagamos por él es
// enseñarle el margen. Aquí van tokens y porcentaje, que es lo que necesita saber.
configuracion.get('/api/admin/ai-balance', async (c) => {
  const { env, url, scope } = partesAdmin(c);
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
  const rows = (await env.DB.prepare('SELECT day, SUM(in_tokens+out_tokens+cache_w_tokens+cache_r_tokens) AS n, SUM(calls) AS c FROM ai_usage WHERE tenant_id=? AND day LIKE ? GROUP BY day').bind(tenantId, `${month}-%`).all()).results || [];
  const byDay = new Map(rows.map((r) => [r.day, { n: r.n || 0, calls: r.c || 0 }]));
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const serie = [];
  for (let d = 1; d <= days; d++) {
    const key = `${month}-${String(d).padStart(2, '0')}`;
    const v = byDay.get(key);
    // Los tokens dicen cuánto se ha gastado; las llamadas, cuántas conversaciones lo
    // gastaron. El cliente solo veía tokens, que por sí solos no significan nada para él.
    serie.push({ d: key, n: v ? v.n : 0, calls: v ? v.calls : 0 });
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
});

configuracion.get('/api/admin/ai-usage', async (c) => {
  const { env, url } = partesAdmin(c);
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
    const d = porDia.get(r.day) || { d: r.day, cost: 0, calls: 0, porCliente: new Map() };
    d.cost += cost; d.calls += r.calls || 0;
    // Llamadas POR CLIENTE en cada día: el total diario no dice quién lo gastó, y con
    // varios clientes es lo primero que se quiere saber cuando un día se dispara.
    d.porCliente.set(cli.name, (d.porCliente.get(cli.name) || 0) + (r.calls || 0));
    porDia.set(r.day, d);
  }
  // Serie completa (los días sin consumo también existen) para que la gráfica no mienta.
  const serie = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    serie.push(porDia.get(d) || { d, cost: 0, calls: 0, porCliente: new Map() });
  }
  return json({
    days,
    total: { cost: Number(totalCost.toFixed(4)), calls: totalCalls, tokens: totalTokens },
    clientes: [...porCliente.values()].sort((a, b) => b.cost - a.cost).map((cli) => ({ ...cli, cost: Number(cli.cost.toFixed(4)) })),
    porDia: serie.map(({ porCliente: pc, ...d }) => ({
      ...d,
      cost: Number(d.cost.toFixed(4)),
      clientes: [...pc].map(([name, calls]) => ({ name, calls })).sort((a, b) => b.calls - a.calls),
    })),
    moneda: 'USD',
  }, 200, NO_STORE);
});
