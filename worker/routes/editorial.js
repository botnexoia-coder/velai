// Plan editorial interno por fecha civil. No crea citas ni llama a proveedores.
import { Hono } from 'hono';
import { partesAdmin, assertOwnTenant } from '../middleware.js';
import { HttpError, json, NO_STORE, readJson, UUID_RE } from '../app.js';

export const editorial = new Hono();
const BASE = '/api/admin/tenants/:id/editorial';
const COLS = 'id,tenant_id,fecha,titulo,detalle,version,created_by,created_at,updated_at';
const fail = (code) => { throw new HttpError(400, code); };
function fecha(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2025-01-01' || value > '2100-12-31'
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('fecha_invalida');
  return value;
}
function titulo(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) fail('titulo_invalido');
  return value.trim();
}
function detalle(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 4000) fail('detalle_invalido');
  return value.trim() || null;
}
function version(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('version_requerida');
  return value;
}
async function body(request, allowed) {
  const b = await readJson(request, 24000);
  if (!b || typeof b !== 'object' || Array.isArray(b)) fail('cuerpo_invalido');
  if (Object.keys(b).some((k) => !allowed.includes(k))) fail('campo_desconocido');
  return b;
}
async function abrir(c, escritura = false) {
  const parts = partesAdmin(c), tenantId = c.req.param('id');
  if (escritura && parts.scope.role !== 'velai') throw new HttpError(403, 'not_authorized');
  if (!UUID_RE.test(tenantId)) throw new HttpError(404, 'not_found');
  assertOwnTenant(parts.scope, tenantId);
  if (parts.scope.role !== 'velai' && !parts.scope.modulos?.includes('calendario')) throw new HttpError(403, 'modulo_no_contratado');
  if (!await parts.env.DB.prepare('SELECT id FROM tenants WHERE id=?').bind(tenantId).first()) throw new HttpError(404, 'not_found');
  return { ...parts, tenantId };
}
async function entry(env, tenantId, entryId) {
  if (!UUID_RE.test(entryId)) throw new HttpError(404, 'not_found');
  const row = await env.DB.prepare(`SELECT ${COLS} FROM tenant_editorial WHERE id=? AND tenant_id=?`).bind(entryId, tenantId).first();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}
editorial.get(BASE, async (c) => {
  const { env, tenantId, url } = await abrir(c);
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  const clauses = ['tenant_id=?'], args = [tenantId];
  if (from !== null) { clauses.push('fecha>=?'); args.push(fecha(from)); }
  if (to !== null) { clauses.push('fecha<=?'); args.push(fecha(to)); }
  if (from && to && from > to) fail('periodo_invalido');
  const rows = (await env.DB.prepare(`SELECT ${COLS} FROM tenant_editorial WHERE ${clauses.join(' AND ')} ORDER BY fecha,created_at,id LIMIT 501`).bind(...args).all()).results;
  const mas = rows.length > 500;
  if (mas) rows.pop();
  return json({ entries: rows, mas, limite: 500 }, 200, NO_STORE);
});
editorial.post(BASE, async (c) => {
  const { env, tenantId, request, actor } = await abrir(c, true);
  const b = await body(request, ['fecha', 'titulo', 'detalle']);
  const item = { id: crypto.randomUUID(), tenant_id: tenantId, fecha: fecha(b.fecha), titulo: titulo(b.titulo), detalle: detalle(b.detalle), version: 1,
    created_by: actor, created_at: new Date().toISOString() };
  item.updated_at = item.created_at;
  await env.DB.prepare(`INSERT INTO tenant_editorial (${COLS}) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(item.id, tenantId, item.fecha, item.titulo, item.detalle, item.version, actor, item.created_at, item.updated_at).run();
  return json({ entry: item }, 201, NO_STORE);
});
editorial.patch(`${BASE}/:entryId`, async (c) => {
  const { env, tenantId, request } = await abrir(c, true);
  const old = await entry(env, tenantId, c.req.param('entryId'));
  const b = await body(request, ['fecha', 'titulo', 'detalle', 'version']), revision = version(b.version);
  if (revision !== old.version) throw new HttpError(409, 'version_conflicto');
  if (!['fecha', 'titulo', 'detalle'].some((k) => Object.hasOwn(b, k))) fail('nothing_to_update');
  const item = { ...old, fecha: b.fecha === undefined ? old.fecha : fecha(b.fecha), titulo: b.titulo === undefined ? old.titulo : titulo(b.titulo),
    detalle: b.detalle === undefined ? old.detalle : detalle(b.detalle), version: revision + 1, updated_at: new Date().toISOString() };
  const result = await env.DB.prepare('UPDATE tenant_editorial SET fecha=?,titulo=?,detalle=?,version=version+1,updated_at=? WHERE id=? AND tenant_id=? AND version=?')
    .bind(item.fecha, item.titulo, item.detalle, item.updated_at, old.id, tenantId, revision).run();
  if (!result.meta.changes) throw new HttpError(409, 'version_conflicto');
  return json({ entry: item }, 200, NO_STORE);
});
editorial.delete(`${BASE}/:entryId`, async (c) => {
  const { env, tenantId, url } = await abrir(c, true);
  const old = await entry(env, tenantId, c.req.param('entryId'));
  const revision = url.searchParams.get('version');
  if (!revision || !/^[1-9]\d*$/.test(revision)) fail('version_requerida');
  const result = await env.DB.prepare('DELETE FROM tenant_editorial WHERE id=? AND tenant_id=? AND version=?').bind(old.id, tenantId, version(Number(revision))).run();
  if (!result.meta.changes) throw new HttpError(409, 'version_conflicto');
  return json({ ok: true }, 200, NO_STORE);
});
