import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sqliteD1 } from './helpers/sqlite-d1.js';
import { testing } from '../worker/app.js';
import { PLANES, MODULOS, modulosDe, canalesOcupados } from '../worker/planes.js';
import { tenantPlan, validarPlan, planStatements } from '../worker/tenant-planes.js';
import { encryptSecret } from '../worker/crypto.js';

const ID = '00000000-0000-4000-8000-000000000091';
const admin = { role: 'velai', email: 'planes@test.invalid' };
const ctx = { waitUntil(p) { p.catch(() => {}); } };
async function fixture(t, options) {
  const DB = await sqliteD1(options); t.after(() => DB.close());
  const cache = new Map();
  return { DB, KV: { async get(k, type) { const value = cache.get(k); return value ? (type === 'json' ? JSON.parse(value) : value) : null; }, async put(k, v) { cache.set(k, v); }, async delete(k) { cache.delete(k); } } };
}
async function insert(env, { id = ID, address = 'whatsapp:+34600000001', origins = null, plan = 'esencial' } = {}) {
  await env.DB.prepare(`INSERT INTO tenants(id,slug,name,channel_address,web_origins,system_prompt,plan,created_at,updated_at)
    VALUES (?,?,?,?,?,'Contexto de prueba',?,'2026-09-21','2026-09-21')`).bind(id, 'test-' + id.slice(-4), 'Prueba', address, origins, plan).run();
}
async function call(env, path, body, scope = admin, method = body ? 'PATCH' : 'GET') {
  const url = new URL('https://admin.test' + path);
  const req = new Request(url, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  return testing.adminRouter(req, env, ctx, path, url, {}, scope);
}
const planPath = `/api/admin/tenants/${ID}/plan`;
const tenantPath = `/api/admin/tenants/${ID}`;
const config = (plan, excepciones = [], expected_revision = '') => ({ plan, excepciones, expected_revision });

// Catálogo y definición de plaza: sin coerciones de claves ni duplicar tipos.
test('planes: excepciones on/off y claves heredadas; Citas requiere Calendario', () => {
  assert.deepEqual(modulosDe('profesional'), ['calendario']);
  assert.deepEqual(modulosDe('esencial', [{ modulo: 'eventos', estado: 'on' }]), ['eventos']);
  assert.deepEqual(modulosDe('empresa', [{ modulo: 'calendario', estado: 'off' }]), []);
  for (const plan of ['__proto__', 'constructor', 'desconocido']) {
    assert.deepEqual(modulosDe(plan, [{ modulo: 'eventos', estado: 'on' }]), []);
    assert.throws(() => validarPlan({ plan }), (e) => e.code === 'invalid_plan');
  }
  assert.throws(() => validarPlan(config('esencial', [{ modulo: 'citas', estado: 'on' }])), (e) => e.code === 'citas_requires_calendario');
  assert.throws(() => validarPlan(config('empresa', [{ modulo: 'eventos', estado: 'on' }, { modulo: 'eventos', estado: 'off' }])), (e) => e.code === 'invalid_modulos');
});

test('canales: web explícita, orígenes vacíos, tipos únicos, Instagram y Telegram', () => {
  for (const web_origins of [null, '', '[]', 'null', '{}', 'basura', '[null," "]']) {
    assert.deepEqual(canalesOcupados({ channel_address: 'pending:nuevo', web_origins }, [{ kind: 'telegram' }]), []);
    assert.deepEqual(canalesOcupados({ channel_address: 'whatsapp:+34', web_origins }, [{ kind: 'whatsapp' }]), ['whatsapp']);
  }
  assert.deepEqual(canalesOcupados({ channel_address: 'web:nuevo' }), ['web']);
  assert.deepEqual(canalesOcupados({ channel_address: 'whatsapp:+34', web_origins: '["https://test.invalid"]' }), ['web', 'whatsapp']);
  assert.deepEqual(canalesOcupados({ channel_address: 'messenger:1' }, [{ kind: 'instagram' }, { kind: 'telegram' }]), ['messenger', 'instagram']);
});

test('migración: SQL y JS deducen igual y conservan derechos e histórico', async (t) => {
  const env = await fixture(t, { through: '0042' });
  const cases = [
    ['pending:nuevo', '[]', []], ['web:uno', null, []], ['whatsapp:+1', '', ['whatsapp', 'telegram']],
    ['whatsapp:+2', '["https://test.invalid"]', ['whatsapp']], ['messenger:1', 'basura', ['instagram']],
    ['pending:vacio', '[null, " "]', ['telegram']], ['web:varios', '[]', ['whatsapp', 'messenger']],
  ];
  for (const [i, [address, origins, kinds]] of cases.entries()) {
    const id = `migration-${i}`;
    await env.DB.prepare(`INSERT INTO tenants(id,slug,name,channel_address,web_origins,system_prompt,created_at,updated_at) VALUES (?,?,?,?,?,'test','now','now')`).bind(id, id, id, address, origins).run();
    for (const kind of kinds) await env.DB.prepare('INSERT INTO tenant_channels(address,tenant_id,kind,created_at) VALUES (?,?,?,?)').bind(`${kind}:${i}`, id, kind, 'now').run();
  }
  await env.DB.exec("UPDATE tenants SET reminders_enabled=1 WHERE id='migration-0'");
  await env.DB.exec("INSERT INTO tenant_calendars(tenant_id,provider,refresh_token_enc,connected_by,connected_at,updated_at,booking_enabled) VALUES ('migration-1','google','secret','test','now','now',1)");
  await env.DB.exec("INSERT INTO tenant_events(id,tenant_id,slug,name,status,created_at,updated_at) VALUES ('event','migration-0','event','Evento','active','now','now')");
  await env.DB.exec(await readFile(new URL('../migrations/0043_planes.sql', import.meta.url), 'utf8'));
  for (const [i, [channel_address, web_origins, kinds]] of cases.entries()) {
    const info = await tenantPlan(env, `migration-${i}`);
    assert.equal(info.plan, canalesOcupados({ channel_address, web_origins }, kinds.map((kind) => ({ kind }))).length > 1 ? 'profesional' : 'esencial');
  }
  assert.deepEqual((await tenantPlan(env, 'migration-0')).modulos, MODULOS);
  assert.deepEqual((await tenantPlan(env, 'migration-1')).modulos, ['calendario', 'citas']);
  // Los tenants de la casa quedan fuera del tarifario: un cupo de Esencial bloquearía
  // añadirle un canal al bot público de Velai.
  for (const slug of ['velai', 'velai-messenger']) {
    const row = await env.DB.prepare('SELECT plan FROM tenants WHERE slug=?').bind(slug).first();
    assert.equal(row.plan, 'empresa', `${slug} no puede quedar sujeto al cupo comercial`);
  }
});

test('alta y edición: límite real, cambio de primario y downgrade sin perder canales', async (t) => {
  const env = await fixture(t); await insert(env);
  await env.DB.prepare("INSERT INTO tenant_channels VALUES (?,?,'whatsapp','now')").bind('whatsapp:+34600000001', ID).run();
  await assert.rejects(call(env, tenantPath, { web_origins: ['https://test.invalid'], expected_updated_at: '2026-09-21' }), (e) => e.code === 'plan_channel_limit');
  assert.equal((await env.DB.prepare('SELECT web_origins FROM tenants WHERE id=?').bind(ID).first()).web_origins, null);
  // Sustituir WhatsApp por Messenger consume una plaza, no dos.
  assert.equal((await call(env, tenantPath, { channel_address: 'messenger:123456', expected_updated_at: '2026-09-21' })).status, 200);
  let info = await tenantPlan(env, ID);
  assert.deepEqual(info.canales, ['messenger']);
  await call(env, planPath, config('profesional', [], info.revision));
  info = await tenantPlan(env, ID);
  await call(env, tenantPath, { web_origins: ['https://test.invalid'], expected_updated_at: info.updated_at });
  await assert.rejects(call(env, planPath, config('esencial', [], (await tenantPlan(env, ID)).revision)), (e) => e.code === 'plan_channel_limit');
  assert.equal((await tenantPlan(env, ID)).plan, 'profesional');
  await assert.rejects(call(env, '/api/admin/tenants', { slug: 'alta', name: 'Alta', channel_address: 'whatsapp:+34600000002', web_origins: ['https://test.invalid'], system_prompt: 'x'.repeat(60), plan: 'esencial' }, admin, 'POST'), (e) => e.code === 'plan_channel_limit');
  const alta = await call(env, '/api/admin/tenants', { slug: 'alta', name: 'Alta', system_prompt: 'x'.repeat(60), plan: 'esencial', active: false, excepciones: [{ modulo: 'eventos', estado: 'on' }] }, admin, 'POST');
  assert.equal(alta.status, 201);
  assert.deepEqual((await tenantPlan(env, (await alta.json()).id)).modulos, ['eventos']);
});

test('planes: addons sobreviven al cambio; herencia, validación, auditoría y CAS', async (t) => {
  const env = await fixture(t); await insert(env);
  await call(env, planPath, config('esencial', [{ modulo: 'eventos', estado: 'on' }]));
  let info = await tenantPlan(env, ID);
  assert.deepEqual(info.modulos, ['eventos']);
  const stale = info.revision;
  await call(env, planPath, { plan: 'profesional', expected_revision: info.revision });
  info = await tenantPlan(env, ID);
  assert.deepEqual(info.modulos, ['calendario', 'eventos']);
  assert.equal(info.limite, null);
  await assert.rejects(call(env, planPath, config('esencial', [], stale)), (e) => e.code === 'stale_tenant');
  await assert.rejects(call(env, planPath, config('__proto__', [], info.revision)), (e) => e.code === 'invalid_plan');
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM tenant_versions WHERE field='plan'").first()).n, 2);
  // El CAS fallido tampoco permite ejecutar escrituras posteriores del batch.
  await env.DB.batch(planStatements(env, ID, validarPlan(config('esencial')), admin.email, 'now', 'revision-no-adquirida', info));
  assert.deepEqual((await tenantPlan(env, ID)).modulos, info.modulos);
  const scope = await testing.resolveScope({ ...env, ADMIN_EMAILS: '' }, 'nobody@test.invalid').catch((e) => e.code);
  assert.equal(scope, 'not_authorized');
  await env.DB.prepare("INSERT INTO tenant_users(email,tenant_id,role,created_at) VALUES (?,?,'cliente','now')").bind('cliente@test.invalid', ID).run();
  const own = await testing.resolveScope(env, 'CLIENTE@test.invalid');
  assert.deepEqual(own.modulos, ['calendario', 'eventos']);
  const me = await (await call(env, '/api/admin/me', null, own)).json();
  assert.deepEqual(me.modulos, own.modulos);
  assert.equal(me.eventsEnabled, undefined);
  await assert.rejects(call(env, planPath, null, own), (e) => e.code === 'not_authorized');
});

test('revocar Citas apaga flags; Velai no puede reactivarlos sin derecho', async (t) => {
  const env = await fixture(t); await insert(env, { plan: 'profesional' });
  await call(env, planPath, config('profesional', [{ modulo: 'citas', estado: 'on' }]));
  await env.DB.exec(`UPDATE tenants SET reminders_enabled=1 WHERE id='${ID}';
    INSERT INTO tenant_calendars(tenant_id,provider,refresh_token_enc,connected_by,connected_at,updated_at,booking_enabled) VALUES ('${ID}','google','secret','test','now','now',1)`);
  const info = await tenantPlan(env, ID);
  await call(env, planPath, config('profesional', [], info.revision));
  assert.equal((await env.DB.prepare('SELECT reminders_enabled FROM tenants WHERE id=?').bind(ID).first()).reminders_enabled, 0);
  assert.equal((await env.DB.prepare('SELECT booking_enabled FROM tenant_calendars WHERE tenant_id=?').bind(ID).first()).booking_enabled, 0);
  await assert.rejects(call(env, tenantPath + '/reminders', { enabled: true }), (e) => e.code === 'modulo_no_contratado');
  await assert.rejects(call(env, tenantPath + '/booking', { booking_enabled: true }), (e) => e.code === 'modulo_no_contratado');
  // Calendario revocado deja de ofrecer tools, incluso con conexión guardada en caché.
  await call(env, planPath, config('esencial', [], (await tenantPlan(env, ID)).revision));
  assert.equal(await testing.tenantCalendar({ ...env, GOOGLE_OAUTH_CLIENT_ID: 'test' }, { id: ID }), null);
});

test('calendario: revocar impide usar la caché aunque falle su borrado', async (t) => {
  const env = await fixture(t); await insert(env, { plan: 'profesional' });
  env.GOOGLE_OAUTH_CLIENT_ID = 'test';
  await env.DB.prepare("INSERT INTO tenant_calendars(tenant_id,provider,refresh_token_enc,connected_by,connected_at,updated_at) VALUES (?,'google','secret','test','now','now')").bind(ID).run();
  assert.equal((await testing.tenantCalendar(env, { id: ID })).tenant_id, ID);
  env.KV.delete = async () => { throw new Error('KV unavailable'); };
  await call(env, planPath, config('esencial'));
  assert.equal((await env.KV.get(`calcfg:${ID}`, 'json')).tenant_id, ID, 'queda la conexión antigua en KV');
  assert.equal(await testing.tenantCalendar(env, { id: ID }), null);
});

test('calendario: un llenado anterior a la revocación no habilita consultas posteriores', async (t) => {
  const env = await fixture(t); await insert(env, { plan: 'profesional' });
  env.GOOGLE_OAUTH_CLIENT_ID = 'test';
  await env.DB.prepare("INSERT INTO tenant_calendars(tenant_id,provider,refresh_token_enc,connected_by,connected_at,updated_at) VALUES (?,'google','secret','test','now','now')").bind(ID).run();
  let signalPut, releasePut;
  const putStarted = new Promise((resolve) => { signalPut = resolve; });
  const putBlocked = new Promise((resolve) => { releasePut = resolve; });
  const put = env.KV.put;
  env.KV.put = async (key, value) => {
    if (key === `calcfg:${ID}`) { signalPut(); await putBlocked; }
    await put(key, value);
  };
  const pending = testing.tenantCalendar(env, { id: ID });
  try {
    await putStarted;
    await call(env, planPath, config('esencial'));
  } finally { releasePut(); await pending; }
  assert.deepEqual((await tenantPlan(env, ID)).modulos, []);
  assert.equal((await env.KV.get(`calcfg:${ID}`, 'json')).tenant_id, ID, 'el llenado tardío restaura la conexión revocada');
  assert.equal(await testing.tenantCalendar(env, { id: ID }), null);
});

test('sender/sync: informa del guardado concurrente, repara el webhook y permite reintentar', async (t) => {
  const env = await fixture(t); await insert(env, { plan: 'profesional', address: 'web:prueba' });
  env.SECRETS_KEK = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
  const token = await encryptSecret(env, ID, 'test-token');
  await env.DB.prepare('UPDATE tenants SET twilio_subaccount_sid=?,twilio_auth_token_enc=? WHERE id=?').bind('AC' + 'c'.repeat(32), token, ID).run();
  let concurrentSave = true; let repairs = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('/v2/Channels/Senders?Channel=whatsapp') && init?.method === 'GET') {
      if (concurrentSave) {
        await env.DB.prepare("UPDATE tenants SET updated_at='2026-09-21T15:00:00Z',greeting='Otro guardado' WHERE id=?").bind(ID).run();
        concurrentSave = false;
      }
      return Response.json({ senders: [{ sid: 'XE' + 'a'.repeat(32), sender_id: 'whatsapp:+34600000002', status: 'ONLINE', configuration: { waba_id: '123456789012345' }, webhook: { callback_url: 'https://webhooks.twilio.com/default' } }] });
    }
    if (String(url).includes('/v2/Channels/Senders/')) { repairs++; return Response.json({ status: 'ONLINE' }); }
    throw new Error('Unexpected mocked request: ' + url);
  });
  const sync = () => testing.handleProvision(new Request('https://admin.test/x', { method: 'POST', body: '{}' }), env, ctx, ID, 'sender/sync', admin.email);
  const partial = await (await sync()).json();
  assert.equal(partial.channelRegistered, false);
  assert.equal(partial.channelError, 'stale_tenant');
  assert.equal(partial.applied, 0);
  assert.equal(partial.webhookFixed, true);
  assert.equal(repairs, 1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM tenant_channels WHERE tenant_id=?').bind(ID).first()).n, 0);
  const retry = await (await sync()).json();
  assert.equal(retry.channelRegistered, true);
  assert.equal(retry.channelError, null);
  assert.equal((await env.DB.prepare('SELECT tenant_id FROM tenant_channels WHERE address=?').bind('whatsapp:+34600000002').first()).tenant_id, ID);
  assert.equal((await env.DB.prepare('SELECT greeting FROM tenants WHERE id=?').bind(ID).first()).greeting, 'Otro guardado');
});

test('transacción: fallo intermedio revierte plan, derechos, flags y auditoría', async (t) => {
  const env = await fixture(t); await insert(env, { plan: 'profesional' });
  await call(env, planPath, config('profesional', [{ modulo: 'citas', estado: 'on' }]));
  const before = await tenantPlan(env, ID);
  await env.DB.exec(`UPDATE tenants SET reminders_enabled=1 WHERE id='${ID}';
    CREATE TRIGGER fail_plan_audit BEFORE INSERT ON tenant_versions WHEN NEW.field='plan' BEGIN SELECT RAISE(ABORT, 'test_failure'); END;`);
  await assert.rejects(call(env, planPath, config('esencial', [], before.revision)), /test_failure/);
  assert.deepEqual(await tenantPlan(env, ID), before);
  assert.equal((await env.DB.prepare('SELECT reminders_enabled FROM tenants WHERE id=?').bind(ID).first()).reminders_enabled, 1);
});

test('revocar Citas cierra la página pública; conceder no la abre automáticamente', async (t) => {
  const { bookingFixture, BOOKING_TEST_TENANT } = await import('./helpers/booking-fixture.js');
  const f = await bookingFixture(); t.after(() => f.close());
  const path = `/api/admin/tenants/${BOOKING_TEST_TENANT}/plan`;
  await call(f.env, path, config('profesional', [{ modulo: 'citas', estado: 'on' }]));
  assert.equal((await f.request('/dialogos/reservas')).status, 200);
  let info = await tenantPlan(f.env, BOOKING_TEST_TENANT);
  await call(f.env, path, config('profesional', [], info.revision));
  assert.equal((await f.request('/dialogos/reservas')).status, 404);
  info = await tenantPlan(f.env, BOOKING_TEST_TENANT);
  await call(f.env, path, config('profesional', [{ modulo: 'citas', estado: 'on' }], info.revision));
  assert.equal((await f.request('/dialogos/reservas')).status, 404);
});

test('revocar Eventos conserva los datos y retira la automatización', async (t) => {
  const env = await fixture(t); await insert(env);
  await call(env, planPath, config('esencial', [{ modulo: 'eventos', estado: 'on' }]));
  await env.DB.prepare("INSERT INTO tenant_events(id,tenant_id,slug,name,status,created_at,updated_at) VALUES ('event',?,'event','Evento','active','now','now')").bind(ID).run();
  assert.ok(await testing.activeTenantEvent(env, ID));
  await call(env, planPath, config('esencial', [], (await tenantPlan(env, ID)).revision));
  assert.equal(await testing.activeTenantEvent(env, ID), null);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM tenant_events WHERE tenant_id=?').bind(ID).first()).n, 1);
});

test('alta WhatsApp Esencial: activar el prospecto aprovecha el canal ya conectado', async (t) => {
  const env = await fixture(t); await insert(env, { address: 'pending:prueba' });
  await env.DB.prepare("INSERT INTO tenant_channels VALUES ('whatsapp:+34600000002',?,'whatsapp','now')").bind(ID).run();
  await env.DB.prepare('UPDATE tenants SET active=0 WHERE id=?').bind(ID).run();
  await call(env, tenantPath, { active: true, expected_updated_at: '2026-09-21' });
  assert.equal((await env.DB.prepare('SELECT channel_address FROM tenants WHERE id=?').bind(ID).first()).channel_address, 'whatsapp:+34600000002');
  assert.deepEqual((await tenantPlan(env, ID)).canales, ['whatsapp']);
});

test('dos cambios concurrentes de plan: solo uno guarda y audita', async (t) => {
  const env = await fixture(t); await insert(env);
  const results = await Promise.allSettled([
    call(env, planPath, config('profesional', [{ modulo: 'eventos', estado: 'on' }])),
    call(env, planPath, config('empresa', [{ modulo: 'eventos', estado: 'off' }])),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'stale_tenant');
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM tenant_versions WHERE field='plan'").first()).n, 1);
});

test('una activación en curso no puede reencender Citas tras revocarla', async (t) => {
  const { bookingFixture, BOOKING_TEST_TENANT } = await import('./helpers/booking-fixture.js');
  for (const [endpoint, body] of [['reminders', { enabled: true }], ['booking', { booking_enabled: true }]]) {
    const f = await bookingFixture(); t.after(() => f.close());
    const path = `/api/admin/tenants/${BOOKING_TEST_TENANT}/plan`;
    await call(f.env, path, config('profesional', [{ modulo: 'citas', estado: 'on' }]));
    // Intercalar una revocación real justo después de leer el derecho del activador.
    const DB = { ...f.DB, prepare(sql) {
      const st = f.DB.prepare(sql);
      if (!sql.startsWith('SELECT t.plan,t.plan_revision,m.estado')) return st;
      return { bind(...args) { const bound = st.bind(...args); return { async first() {
        const row = await bound.first();
        await call(f.env, path, config('profesional', [], row.plan_revision));
        return row;
      } }; } };
    } };
    await assert.rejects(call({ ...f.env, DB }, `/api/admin/tenants/${BOOKING_TEST_TENANT}/${endpoint}`, body), (e) => e.code === 'stale_tenant');
    assert.equal((await f.DB.prepare('SELECT reminders_enabled FROM tenants WHERE id=?').bind(BOOKING_TEST_TENANT).first()).reminders_enabled, 0);
    assert.equal((await f.DB.prepare('SELECT booking_enabled FROM tenant_calendars WHERE tenant_id=?').bind(BOOKING_TEST_TENANT).first()).booking_enabled, 0);
  }
});
