import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sqliteD1 } from './helpers/sqlite-d1.js';
import { calculateAvailability, slotInterval, createHold, bookAppointment, manageToken, appointmentByToken, cancelAppointment } from '../worker/agenda.js';
import { googleBusy, localToUtcMs } from '../worker/calendar.js';

const tenantId = '00000000-0000-4000-8000-00000000000a';
const cal = { tenant_id: tenantId, timezone: 'Europe/Madrid', slot_minutes: 30, min_notice_min: 120, max_days_ahead: 60, calendar_id: 'primary', business_hours: JSON.stringify({ mon: [['09:00','14:00'],['16:00','20:00']], tue: [['09:00','20:00']], wed: [['09:00','20:00']], thu: [['09:00','20:00']], fri: [['09:00','20:00']], sat: [['09:00','20:00']], sun: [['00:00','20:00']] }) };
const service = { id: null, name: 'Sesión', minutes: 30, buffer_min: 15 };
const future = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0,10);
async function fixture(t) {
  const DB = await sqliteD1(); t.after(() => DB.close());
  await DB.prepare("INSERT INTO tenants(id,slug,name,channel_address,system_prompt,created_at,updated_at) VALUES (?,'dialogos','Diálogos','web:dialogos','test',?,?)").bind(tenantId, new Date().toISOString(), new Date().toISOString()).run();
  await DB.prepare("INSERT INTO tenant_calendars(tenant_id,provider,refresh_token_enc,connected_by,connected_at,updated_at) VALUES (?,'google','test','test',?,?)").bind(tenantId, new Date().toISOString(), new Date().toISOString()).run();
  const cache = new Map([['caltoken:' + tenantId, 'test-access-token']]);
  const env = { DB, APP_SECRET: 'a'.repeat(32), KV: { get: async (k) => cache.get(k) || null, put: async (k,v) => cache.set(k,v), delete: async (k) => cache.delete(k) } };
  const events = new Map(); let failAfterInsert = false;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/events?')) return Response.json({ items: [] });
    if (!init.method || init.method === 'GET') { const id = new URL(url).pathname.split('/').pop(); return Response.json(events.get(id) || {}, { status: events.has(id) ? 200 : 404 }); }
    if (init.method === 'DELETE') { events.delete(String(url).split('/').pop()); return new Response(null, { status: 204 }); }
    const event = JSON.parse(init.body);
    if (events.has(event.id)) return Response.json({}, { status: 409 });
    events.set(event.id, event);
    if (failAfterInsert) { failAfterInsert = false; throw new Error('simulated network timeout after insert'); }
    return Response.json({ id: event.id });
  };
  t.after(() => { globalThis.fetch = oldFetch; });
  return { env, events, timeoutNext: () => { failAfterInsert = true; } };
}

test('mes: festivos, horario partido, buffer, antelación y DST de octubre', () => {
  const days = calculateAvailability(cal, { from: '2026-10-01', to: '2026-10-31', service, exceptions: [{ date: '2026-10-12', windows: null }], nowMs: Date.parse('2026-10-01T06:00:00Z') });
  assert.equal(days['2026-10-01'][0], '10:00');
  assert.deepEqual(days['2026-10-12'], []);
  assert.ok(days['2026-10-05'].includes('16:00'));
  assert.ok(!days['2026-10-05'].includes('13:30'));
  assert.equal(new Set(days['2026-10-25']).size, days['2026-10-25'].length);
  assert.equal(new Date(localToUtcMs('Europe/Madrid','2026-10-25','10:00')).toISOString(), '2026-10-25T09:00:00.000Z');
});

test('Google: mes paginado, solo ocupación y días completos en zona local', async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return Response.json(urls.length === 1 ? { nextPageToken: 'page2', items: [{ summary: 'PRIVADO', start: {date:'2026-10-25'}, end:{date:'2026-10-26'} }] } : { items: [{ transparency:'transparent', start:{date:'2026-10-27'}, end:{date:'2026-10-28'} }] }); };
  const busy = await googleBusy({}, 'token','primary','2026-10-01T00:00:00Z','2026-11-01T00:00:00Z');
  assert.equal(urls.length, 2); assert.match(urls[1], /pageToken=page2/);
  assert.deepEqual(busy, [{ start:'2026-10-24T22:00:00.000Z', end:'2026-10-25T23:00:00.000Z' }]);
  assert.ok(!urls[0].includes('summary'));
});

test('D1: holds simultáneos bloquean intervalos solapados y caducan', async (t) => {
  const { env } = await fixture(t); const date = future();
  const attempts = await Promise.allSettled([createHold(env,cal,service,date+'T10:00'), createHold(env,cal,{...service, minutes:60},date+'T10:30')]);
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length,1);
  await env.DB.prepare("UPDATE booking_claims SET expires_at='2000-01-01T00:00:00.000Z'").run();
  assert.ok((await createHold(env,cal,service,date+'T10:00')).hold);
});

test('D1: reserva idempotente, token revocable y cancelación', async (t) => {
  const { env, events } = await fixture(t); const date = future();
  const hold = await createHold(env,cal,service,date+'T10:00');
  const input = { ...hold, fecha_hora: date+'T10:00', nombre:'Ana',telefono:'+34612345678' };
  const a = await bookAppointment(env,cal,service,input,{channel:'web_reserva'});
  const b = await bookAppointment(env,cal,service,input,{channel:'web_reserva'});
  assert.equal(a.id,b.id); assert.equal(events.size,1);
  assert.equal((await appointmentByToken(env,a.manage_token,tenantId)).id,a.id);
  await assert.rejects(appointmentByToken(env,a.manage_token,'other'), (e) => e.status===404);
  await assert.rejects(appointmentByToken(env,await manageToken(env,'another')), (e) => e.status===404);
  await assert.rejects(appointmentByToken(env,a.manage_token.slice(0,31)+(a.manage_token[31]==='a'?'b':'a')), (e) => e.status===404);
  await cancelAppointment(env,{id:tenantId,slug:'dialogos'},cal,a);
  assert.equal(events.size,0);
  assert.equal((await appointmentByToken(env,a.manage_token)).status,'cancelled');
  await env.DB.prepare('UPDATE appointments SET manage_token=NULL WHERE id=?').bind(a.id).run();
  await assert.rejects(appointmentByToken(env,a.manage_token), (e) => e.status===404);
});

test('D1: timeout después de crear en Google conserva bloqueo y reintenta sin duplicar', async (t) => {
  const { env, events, timeoutNext } = await fixture(t); const date = future();
  const hold = await createHold(env,cal,service,date+'T10:00');
  const input = {...hold,fecha_hora:date+'T10:00',nombre:'Ana',telefono:'+34612345678'};
  timeoutNext();
  await assert.rejects(bookAppointment(env,cal,service,input,{channel:'web_reserva'}));
  assert.equal((await env.DB.prepare('SELECT status FROM appointments').first()).status, 'error', 'la intención recuperable se guarda antes de Google');
  await env.DB.prepare("UPDATE booking_claims SET expires_at='2000-01-01T00:00:00.000Z'").run();
  await assert.rejects(createHold(env,cal,service,date+'T10:00'),(e)=>e.status===409);
  await bookAppointment(env,cal,service,input,{channel:'web_reserva'});
  assert.equal((await env.DB.prepare('SELECT status FROM appointments').first()).status, 'confirmed');
  assert.equal(events.size,1);
});

test('D1: cuota de tres futuras por teléfono también con prefijos y concurrencia', async (t) => {
  const { env, events } = await fixture(t); const date = future();
  const holds = await Promise.all(['09:00','10:00','11:00','12:00'].map(async (hour)=>({ ...(await createHold(env,cal,service,date+'T'+hour)),fecha_hora:date+'T'+hour,nombre:'Ana',telefono:hour==='12:00'?'612345678':'+34612345678' })));
  const results = await Promise.allSettled(holds.map((input)=>bookAppointment(env,cal,service,input,{channel:'web_reserva'})));
  assert.equal(results.filter((r)=>r.status==='fulfilled').length,3); assert.equal(events.size,3);
});


test('horas de inicio cada 30 minutos, independientemente de duración y apertura', () => {
  const calendar = {...cal, business_hours: JSON.stringify({mon:[['09:10','13:00']]})};
  const days = calculateAvailability(calendar,{from:'2026-10-05',to:'2026-10-05',service:{...service,minutes:60,buffer_min:0},nowMs:Date.parse('2026-10-01T00:00:00Z')});
  assert.deepEqual(days['2026-10-05'],['09:30','10:00','10:30','11:00','11:30','12:00']);
  assert.throws(()=>slotInterval(calendar,service,'2026-10-05T09:15'),(e)=>e.code==='invalid_date');
  assert.throws(()=>slotInterval(calendar,service,'2026-10-05T09:45'),(e)=>e.code==='invalid_date');
});

test('piloto Diálogos prepara presencial, vídeo y teléfono a 30 minutos sin activar la página', async (t) => {
  const DB = await sqliteD1(); t.after(() => DB.close());
  const now = new Date().toISOString();
  await DB.prepare("INSERT INTO tenants(id,slug,name,channel_address,system_prompt,created_at,updated_at) VALUES (?,'dialogos','Diálogos','web:dialogos','test',?,?)")
    .bind(tenantId, now, now).run();
  await DB.prepare("INSERT INTO tenant_calendars(tenant_id,provider,refresh_token_enc,connected_by,connected_at,updated_at) VALUES (?,'google','test','test',?,?)")
    .bind(tenantId, now, now).run();
  await DB.exec(await readFile(new URL('../migrations/0036_dialogos_autoagenda_piloto.sql', import.meta.url), 'utf8'));
  const rows = (await DB.prepare('SELECT slug,mode,minutes FROM tenant_services WHERE tenant_id=? ORDER BY position').bind(tenantId).all()).results;
  assert.deepEqual(rows, [
    { slug: 'presencial', mode: 'presencial', minutes: 30 },
    { slug: 'video', mode: 'video', minutes: 30 },
    { slug: 'telefono', mode: 'telefono', minutes: 30 },
  ]);
  assert.equal((await DB.prepare('SELECT booking_enabled FROM tenant_calendars WHERE tenant_id=?').bind(tenantId).first()).booking_enabled, 0);
});
