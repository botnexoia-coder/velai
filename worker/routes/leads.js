// Dominio LEADS del panel: listado, export CSV y la ficha (estado, notas, retry,
// borrado RGPD). Migrado tal cual del adminRouter monolítico — misma conducta,
// mismos códigos; los tests de worker.test.js y el barrido de aislamiento la fijan.
//
// Aislamiento: los listados llevan scopeClause (sc.sql) y la ficha resuelve la
// propiedad con la MISMA cláusula en el WHERE (ajeno = 404, nunca 403). Las tablas
// hijas (lead_notes, lead_events, lead_notifications) van SIEMPRE detrás de un
// padre filtrado que cerró con 404 — regla de GUIA-WORKERS §4b.
import { Hono } from 'hono';
import { partesAdmin, scopeClause } from '../middleware.js';
import {
  HttpError, json, NO_STORE, clean, readJson, csvCell, leadFilters, expiryDate,
  processNotifications, UUID_RE, STATUSES,
} from '../app.js';

export const leads = new Hono();

leads.get('/api/admin/leads', async (c) => {
  const { env, url, scope } = partesAdmin(c);
  const sc = scopeClause(scope);
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
});

leads.get('/api/admin/leads/export.csv', async (c) => {
  const { env, url, scope } = partesAdmin(c);
  const sc = scopeClause(scope);
  const filters = leadFilters(url);
  const rows = (await env.DB.prepare(`SELECT l.created_at,l.status,t.name AS tenant_name,l.source,l.name,l.whatsapp,l.need,l.context,l.sector,l.messages_per_day,l.channel,l.score,l.note,l.page_url FROM leads l LEFT JOIN tenants t ON t.id=l.tenant_id WHERE ${filters.sql}${sc.sql} ORDER BY l.created_at DESC LIMIT 5000`).bind(...filters.values, ...sc.args).all()).results;
  // need/context van DELANTE de sector: es lo que lee quien va a llamar, y sector viene
  // vacío en casi todo lead de cliente (es un concepto del embudo de Velai).
  const keys = scope.role === 'velai'
    ? ['created_at','status','tenant_name','source','name','whatsapp','need','context','sector','messages_per_day','channel','score','note','page_url']
    : ['created_at','status','source','name','whatsapp','need','context','sector','messages_per_day','channel','score','note','page_url'];
  const csv = [keys.join(','), ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(','))].join('\r\n');
  return new Response('\uFEFF' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="velai-leads.csv"', 'Cache-Control': 'no-store' } });
});

// La ficha del lead y sus acciones comparten handler (como compartían regex en el
// monolito): el método decide la rama y lo no contemplado sigue siendo 405.
const grupoLead = async (c) => {
  const { request, env, ctx, scope, actor } = partesAdmin(c);
  const sc = scopeClause(scope);
  const id = c.req.param('id'); const action = c.req.param('accion') || null;
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
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
};
leads.all('/api/admin/leads/:id', grupoLead);
leads.all('/api/admin/leads/:id/:accion{notes|retry}', grupoLead);
