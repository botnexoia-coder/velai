import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, testing } from '../worker/app.js';

test('normaliza teléfonos válidos y rechaza longitudes peligrosas', () => {
  assert.equal(testing.normalizePhone('+34 612 345 678'), '+34612345678');
  assert.equal(testing.normalizePhone('612-345-678'), '612345678');
  assert.equal(testing.normalizePhone('123'), '');
  assert.equal(testing.normalizePhone('1'.repeat(16)), '');
});

test('extrae un teléfono del chat sin concatenar otros números del mensaje', () => {
  assert.equal(testing.extractPhone('Tengo 2 locales. Mi número es +34 612 345 678.'), '+34612345678');
  assert.equal(testing.extractPhone('Tengo 2 locales y 40 mensajes al día'), '');
});

test('extractPhone no confunde fechas, importes, CIFs ni rangos con teléfonos', () => {
  assert.equal(testing.extractPhone('la cita fue el 13-05-2024 y no vino'), '');
  assert.equal(testing.extractPhone('Facturo entre 40.000 - 60.000 al mes'), '');
  assert.equal(testing.extractPhone('mi cif es B-12345678'), '');
  assert.equal(testing.extractPhone('somos 120.000 - 150.000 clientes'), '');
  assert.equal(testing.extractPhone('llámame al 612 345 678 mejor'), '612345678');
});

test('las variables de plantilla nunca van vacías y se normalizan', () => {
  const vars = JSON.parse(testing.leadTemplateVariables({ whatsapp: '', name: null, sector: '  ', need: '' }));
  assert.equal(Object.values(vars).filter((v) => !v).length, 0);
  const multi = JSON.parse(testing.leadTemplateVariables({ whatsapp: '+34 612', name: 'Ana\n\nLópez', sector: 'Bar & Grill', need: 'x'.repeat(500) }));
  assert.equal(multi[2], 'Ana López');
  assert.equal(multi[3], 'Bar & Grill');
  assert.equal(multi[4].length, 200);
});

test('el aviso de WhatsApp usa plantilla (ContentSid) y nunca Body en texto libre', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: String(init && init.body) });
    return new Response('{}', { status: 201 });
  };
  try {
    const env = {
      TEAM_WHATSAPP: 'whatsapp:+34600000001,whatsapp:+34600000002',
      TWILIO_FROM: 'whatsapp:+15550000000', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't',
      TWILIO_LEAD_TEMPLATE_SID: 'HXtest',
    };
    const outcome = await testing.deliver(env, 'whatsapp', { whatsapp: '+34612345678', name: 'María', sector: 'Barbería', need: 'citas' });
    assert.equal(outcome.ok, true);
    const twilio = calls.filter((c) => c.url.includes('api.twilio.com'));
    assert.equal(twilio.length, 2);
    assert.ok(twilio[0].body.includes('ContentSid=HXtest'), 'debe mandar ContentSid');
    assert.ok(!twilio[0].body.includes('Body='), 'no debe mandar Body en texto libre');
    assert.deepEqual(await testing.deliver({ ...env, TWILIO_LEAD_TEMPLATE_SID: '' }, 'whatsapp', {}), { skipped: true, error: 'template_not_configured' });
  } finally { globalThis.fetch = realFetch; }
});

test('el drenaje solo marca como enviados los canales que entregaron en el fallback', async () => {
  const updates = [];
  const kv = {
    entries: { 'leadq:r1': JSON.stringify({ requestId: 'r1', source: 'test', notified: true, notifiedChannels: ['telegram'] }) },
    async list() { return { keys: Object.keys(this.entries).map((name) => ({ name })) }; },
    async get(k) { return this.entries[k] ? JSON.parse(this.entries[k]) : null; },
    async delete(k) { delete this.entries[k]; },
  };
  const stmt = (sql) => ({ bind: (...args) => ({ sql, args, run: async () => { updates.push({ sql, args }); }, first: async () => null, all: async () => ({ results: [] }) }) });
  const db = { prepare: stmt, batch: async (stmts) => { stmts.forEach((s) => updates.push({ sql: s.sql, args: s.args })); return stmts.map(() => ({})); } };
  await testing.drainQueuedLeads({ KV: kv, DB: db, LEAD_RETENTION_MONTHS: '24' });
  const sentUpdates = updates.filter((u) => u.sql.includes("status='sent'"));
  assert.equal(sentUpdates.length, 1, 'solo un canal marcado');
  assert.equal(sentUpdates[0].args.at(-1), 'telegram');
  assert.equal(Object.keys(kv.entries).length, 0, 'la clave de la cola se borra');
});

test('limita atribución a claves conocidas y longitudes seguras', () => {
  const value = testing.safeUtm({ utm_source: 'google', evil: 'x', gclid: 'a'.repeat(500) });
  assert.deepEqual(Object.keys(value).sort(), ['gclid', 'utm_source']);
  assert.equal(value.gclid.length, 300);
});

test('CORS solo autoriza orígenes configurados de forma exacta', () => {
  const env = { ALLOWED_WEB_ORIGINS: 'https://hirevai.com,https://www.hirevai.com' };
  assert.equal(testing.publicCors(new Request('https://worker.test', { headers: { Origin: 'https://hirevai.com' } }), env)['Access-Control-Allow-Origin'], 'https://hirevai.com');
  assert.equal(testing.publicCors(new Request('https://worker.test', { headers: { Origin: 'https://evil.pages.dev' } }), env), null);
  assert.equal(testing.publicCors(new Request('https://worker.test'), env), null);
});

test('valida una firma Twilio y rechaza una firma alterada', async () => {
  const token = 'test-auth-token';
  const url = 'https://worker.test/';
  const params = { Body: 'Hola', From: 'whatsapp:+34600000000' };
  const data = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signed)));
  assert.equal(await testing.validTwilioSignature(token, url, params, signature), true);
  assert.equal(await testing.validTwilioSignature(token, url, params, signature.slice(0, -1) + 'x'), false);
});

test('un demo inválido (incl. claves del prototipo) devuelve 400 y nunca llega al modelo', async () => {
  const worker = createWorker({ SYSTEM: 'sys', DEMOS: { restaurante: 'demo prompt' }, SUMMARY_PROMPT: '' });
  const ctx = { waitUntil() {} };
  const env = { ALLOWED_WEB_ORIGINS: 'https://hirevai.com', KV: { get: async () => null, put: async () => {} } };
  for (const demo of ['constructor', '__proto__', 'hasOwnProperty', 'noexiste']) {
    const res = await worker.fetch(new Request('https://worker.test/chat', {
      method: 'POST', headers: { Origin: 'https://hirevai.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: '123e4567-e89b-42d3-a456-426614174000', message: 'hola', demo }),
    }), env, ctx);
    assert.equal(res.status, 400, `demo "${demo}" debería dar 400`);
    assert.equal((await res.json()).error, 'invalid_demo');
  }
  assert.equal(testing.isDemoKey({ DEMOS: { restaurante: 'x' } }, 'restaurante'), true);
  assert.equal(testing.isDemoKey({ DEMOS: { restaurante: 'x' } }, 'constructor'), false);
});

test('el CSV neutraliza fórmulas y escapa comillas', () => {
  assert.equal(testing.csvCell('=SUM(A1:A9)'), '"\'=SUM(A1:A9)"');
  assert.equal(testing.csvCell('+34"600'), '"\'+34""600"');
  assert.equal(testing.csvCell('María'), '"María"');
  assert.equal(testing.csvCell(null), '""');
});

test('la retención de leads no explota con configuración inválida', () => {
  assert.ok(!Number.isNaN(Date.parse(testing.expiryDate({ LEAD_RETENTION_MONTHS: 'banana' }))));
  assert.ok(!Number.isNaN(Date.parse(testing.expiryDate({}))));
  // '' es Number 0: debe caer al default de 24 meses, no a 1
  const blank = new Date(testing.expiryDate({ LEAD_RETENTION_MONTHS: '' }));
  const explicit = new Date(testing.expiryDate({ LEAD_RETENTION_MONTHS: '24' }));
  assert.equal(blank.getUTCFullYear(), explicit.getUTCFullYear());
});

test('readJson rechaza null, arrays y primitivos con 400', async () => {
  for (const body of ['null', '[1,2]', '"hola"', '42']) {
    const request = new Request('https://x/', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(testing.readJson(request), (e) => e.status === 400 && e.code === 'invalid_json');
  }
  assert.deepEqual(await testing.readJson(new Request('https://x/', { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } })), { a: 1 });
});

test('readJson exige application/json (415) y limita el tamaño (413)', async () => {
  await assert.rejects(
    testing.readJson(new Request('https://x/', { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'text/plain' } })),
    (e) => e.status === 415 && e.code === 'unsupported_media_type');
  await assert.rejects(
    testing.readJson(new Request('https://x/', { method: 'POST', body: `{"a":"${'x'.repeat(20000)}"}`, headers: { 'Content-Type': 'application/json' } }), 16000),
    (e) => e.status === 413 && e.code === 'payload_too_large');
});

test('verifyTurnstile valida hostname y action contra la config del servidor', async () => {
  const realFetch = globalThis.fetch;
  const env = { TURNSTILE_SECRET_KEY: 's', ALLOWED_WEB_ORIGINS: 'https://hirevai.com,https://velai-dey.pages.dev' };
  const request = new Request('https://x/', { headers: { 'CF-Connecting-IP': '1.2.3.4' } });
  const mock = (result) => async () => new Response(JSON.stringify(result), { status: 200 });
  try {
    globalThis.fetch = mock({ success: true, action: 'lead', hostname: 'hirevai.com' });
    await testing.verifyTurnstile(env, 'tok', request, 'lead'); // no lanza
    globalThis.fetch = mock({ success: true, action: 'lead', hostname: 'evil.example' });
    await assert.rejects(testing.verifyTurnstile(env, 'tok', request, 'lead'), (e) => e.status === 403);
    globalThis.fetch = mock({ success: true, action: 'chat', hostname: 'hirevai.com' });
    await assert.rejects(testing.verifyTurnstile(env, 'tok', request, 'lead'), (e) => e.status === 403);
    globalThis.fetch = mock({ success: true, action: 'lead', hostname: 'localhost' });
    await testing.verifyTurnstile(env, 'tok', request, 'lead'); // dev local pasa
  } finally { globalThis.fetch = realFetch; }
});

test('el filtro de fecha final incluye el día completo', () => {
  const filters = testing.leadFilters(new URL('https://x/api/admin/leads?to=2026-08-17'));
  assert.ok(filters.values.includes('2026-08-17T23:59:59.999Z'));
  const passthrough = testing.leadFilters(new URL('https://x/api/admin/leads?to=2026-08-17T10:00:00Z'));
  assert.ok(passthrough.values.includes('2026-08-17T10:00:00Z'));
});

test('el Worker rechaza CORS desconocido y exige Access en administración', async () => {
  const worker = createWorker({ SYSTEM: '', DEMOS: {}, SUMMARY_PROMPT: '' });
  const ctx = { waitUntil() {} };
  const env = { ALLOWED_WEB_ORIGINS: 'https://hirevai.com', ADMIN_ORIGIN: 'https://admin.hirevai.com' };
  const publicResponse = await worker.fetch(new Request('https://worker.test/lead', { method: 'POST', headers: { Origin: 'https://evil.test' } }), env, ctx);
  assert.equal(publicResponse.status, 403);
  assert.equal((await publicResponse.json()).error, 'origin_not_allowed');
  const adminResponse = await worker.fetch(new Request('https://admin.hirevai.com/api/admin/leads'), env, ctx);
  assert.equal(adminResponse.status, 401);
  // Sin ADMIN_ORIGIN, las rutas admin fallan con 503 explícito (no silencio, no 500)…
  const misconfigured = await worker.fetch(new Request('https://admin.hirevai.com/api/admin/leads'), { ALLOWED_WEB_ORIGINS: '' }, ctx);
  assert.equal(misconfigured.status, 503);
  assert.equal((await misconfigured.json()).error, 'admin_misconfigured');
  // …y las rutas públicas siguen funcionando con normalidad.
  const publicOk = await worker.fetch(new Request('https://worker.test/lead', { method: 'POST', headers: { Origin: 'https://hirevai.com' } }), { ALLOWED_WEB_ORIGINS: 'https://hirevai.com' }, ctx);
  assert.notEqual(publicOk.status, 503);
});
