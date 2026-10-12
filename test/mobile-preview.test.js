import test from 'node:test';
import assert from 'node:assert/strict';
import { previewTarget, readOnlyEnv } from '../worker/mobile-preview.js';
import { testing } from '../worker/app.js';

test('router real aplica solo lectura y conserva el rol y permisos existentes', async () => {
  const path = '/api/admin/mobile-preview/me';
  const url = new URL('https://admin.hirevai.com' + path);
  const env = { DB: { prepare() { throw Error('No debería consultar ni escribir'); } }, SOCIOS_EMAILS: 'equipo@example.com' };
  const scope = { role: 'velai', email: 'equipo@example.com', tenantId: null, permisos: [], modulos: [] };
  const response = await testing.adminRouter(new Request(url), env, {}, path, url, {}, scope);
  const me = await response.json();
  assert.equal(me.role, 'velai'); assert.equal(me.socio, true);
  await assert.rejects(testing.adminRouter(new Request(url, { method: 'POST' }), env, {}, path, url, {}, scope), { status: 405 });
});

test('preview conserva alcance Velai y rechaza escrituras antes de consultar', () => {
  assert.equal(previewTarget('/api/admin/mobile-preview/inbox', 'GET', { role: 'velai' }), '/api/admin/inbox');
  assert.equal(previewTarget('/api/admin/inbox', 'POST', { role: 'velai' }), null);
  for (const suffix of ['config', 'config/telegram-webhook', 'infra-usage', 'gestion/anything-new', 'tenants/00000000-0000-4000-8000-000000000000/sync']) {
    assert.throws(() => previewTarget('/api/admin/mobile-preview/' + suffix, 'GET', { role: 'velai' }), { status: 403 });
  }
  for (const method of ['POST', 'PATCH', 'DELETE', 'PUT', 'HEAD']) {
    assert.throws(() => previewTarget('/api/admin/mobile-preview/inbox', method, { role: 'velai' }), { status: 405 });
  }
  assert.throws(() => previewTarget('/api/admin/mobile-preview/me', 'GET', { role: 'cliente' }), { status: 403 });
  for (const suffix of ['../me', '/me', 'mobile-preview/me', '']) {
    assert.throws(() => previewTarget('/api/admin/mobile-preview/' + suffix, 'GET', { role: 'velai' }), { status: 404 });
  }
});

test('bindings de prueba bloquean SQL y almacenamiento incluso en handlers GET', async () => {
  let writes = 0;
  const db = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [{ id: 'real' }] }), first: async () => ({ id: 'real' }), run: () => { writes++; } }), batch: async (items) => Promise.all(items.map(x => x.all())), exec: () => { writes++; } };
  const binding = { get: async () => 'real', put: () => { writes++; }, delete: () => { writes++; } };
  const ro = readOnlyEnv({ DB: db, KV: binding, MEDIA: binding, FINANCE_DOCS: binding });
  assert.equal((await ro.DB.prepare('SELECT id FROM tenants WHERE id=?').bind('x').first()).id, 'real');
  assert.equal((await ro.DB.batch([ro.DB.prepare('SELECT id FROM tenants')]))[0].results[0].id, 'real');
  for (const sql of ['UPDATE tenants SET name=?', 'DELETE FROM tenants', 'INSERT INTO tenants VALUES (?)', 'SELECT 1; DELETE FROM tenants', 'PRAGMA writable_schema=1']) assert.throws(() => ro.DB.prepare(sql), { status: 405 });
  assert.throws(() => ro.DB.prepare('SELECT 1').run(), { status: 405 });
  assert.throws(() => ro.DB.exec('SELECT 1'), { status: 405 });
  for (const store of [ro.KV, ro.MEDIA, ro.FINANCE_DOCS]) {
    assert.equal(await store.get('x'), 'real');
    assert.throws(() => store.put('x', 'y'), { status: 405 });
    assert.throws(() => store.delete('x'), { status: 405 });
  }
  assert.equal(writes, 0);
});
