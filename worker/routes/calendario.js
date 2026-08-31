// Dominio CALENDARIO del panel: las citas agendadas (/appointments) y la conexión
// de Google Calendar por tenant (conectar por OAuth, configurar, desconectar). El
// callback OAuth vive en routes/publico.js (no es /api/admin/*) y el proveedor puro
// en worker/calendar.js. Migrado tal cual del adminRouter monolítico.
import { Hono } from 'hono';
import { partesAdmin, scopeClause, assertOwnTenant, adminOrigin } from '../middleware.js';
import { googleAuthUrl, revokeGoogleToken } from '../calendar.js';
import { decryptSecret } from '../crypto.js';
import { HttpError, json, NO_STORE, clean, readJson, UUID_RE } from '../app.js';

export const calendario = new Hono();

// ── Citas (SPEC-CALENDARIO): lista scoped — velai todo (con ?tenant=), cliente
// solo las suyas vía scopeClause (mismo único punto de paso que los leads).
calendario.get('/api/admin/appointments', async (c) => {
  const { env, url, scope } = partesAdmin(c);
  const sc = scopeClause(scope);
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
});

// ── Calendario del tenant (SPEC-CALENDARIO §6). El GET jamás devuelve el token
// cifrado. La conexión y la config comparten handler, como compartían regex.
const grupoCalendar = async (c) => {
  const { request, env, ctx, scope, actor } = partesAdmin(c);
  const tenantId = c.req.param('id');
  if (!UUID_RE.test(tenantId)) throw new HttpError(404, 'not_found');
  const sub = c.req.param('sub') || null;
  // Autoservicio del cliente: SOLO su propio calendario. Fuera de alcance = 404
  // (un 403 confirmaría que ese tenant existe), y ANTES de tocar D1.
  assertOwnTenant(scope, tenantId);
  const tenantRow = await env.DB.prepare('SELECT id, slug, name FROM tenants WHERE id=?').bind(tenantId).first();
  if (!tenantRow) throw new HttpError(404, 'not_found');
  if (sub === 'connect' && request.method === 'POST') {
    const body = await readJson(request, 2000);
    if (clean(body.provider, 20) !== 'google') throw new HttpError(400, 'invalid_provider'); // microsoft: fase futura
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) throw new HttpError(503, 'calendar_not_configured');
    if (!env.KV) throw new HttpError(503, 'calendar_not_configured');
    const state = crypto.randomUUID();
    await env.KV.put(`calstate:${state}`, JSON.stringify({ tenantId, provider: 'google', actor }), { expirationTtl: 600 });
    return json({ authUrl: googleAuthUrl(env, state, `${adminOrigin(env)}/oauth/calendar/callback`) }, 200, NO_STORE);
  }
  if (!sub && request.method === 'GET') {
    // Columnas explícitas, NUNCA SELECT * : refresh_token_enc no sale del worker.
    let row = null;
    try { row = await env.DB.prepare('SELECT provider,account_email,calendar_id,timezone,slot_minutes,business_hours,status,last_error,connected_at,updated_at FROM tenant_calendars WHERE tenant_id=?').bind(tenantId).first(); } catch (_) {}
    return json({ calendar: row || null }, 200, NO_STORE);
  }
  if (!sub && request.method === 'PATCH') {
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
  if (!sub && request.method === 'DELETE') {
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
};
calendario.all('/api/admin/tenants/:id/calendar', grupoCalendar);
calendario.all('/api/admin/tenants/:id/calendar/:sub{connect}', grupoCalendar);
