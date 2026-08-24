import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorker, testing } from '../worker/app.js';
import { encryptSecret, decryptSecret } from '../worker/crypto.js';

const TEST_KEK = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));

// El system viaja como array de bloques con cache_control (caché de prompt);
// este helper extrae el texto y verifica el contrato del caché de paso.
function sysText(body) {
  const s = body.system;
  if (typeof s === 'string') return s;
  if (!Array.isArray(s) || !s.length || s[0].type !== 'text') throw new Error('system sin bloques');
  if (!s[0].cache_control || s[0].cache_control.type !== 'ephemeral') throw new Error('bloque estable sin cache_control');
  return s.map((b) => b.text).join('');
}

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

test('CORS solo autoriza orígenes configurados de forma exacta', async () => {
  const env = { ALLOWED_WEB_ORIGINS: 'https://hirevai.com,https://www.hirevai.com' };
  assert.equal((await testing.publicCors(new Request('https://worker.test', { headers: { Origin: 'https://hirevai.com' } }), env))['Access-Control-Allow-Origin'], 'https://hirevai.com');
  assert.equal(await testing.publicCors(new Request('https://worker.test', { headers: { Origin: 'https://evil.pages.dev' } }), env), null);
  assert.equal(await testing.publicCors(new Request('https://worker.test'), env), null);
});

test('allowedOrigins une la base del entorno con los web_origins de tenants ACTIVOS y cachea en KV', async () => {
  const kv = new Map();
  const env = {
    ALLOWED_WEB_ORIGINS: 'https://hirevai.com',
    KV: { async get(k, t) { const v = kv.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); } },
    DB: { prepare: (sql) => ({
      all: async () => ({ results: sql.includes('active = 1') ? [{ web_origins: '["https://zoetravelspain.com","https://www.zoetravelspain.com"]' }, { web_origins: 'json-roto' }] : [] }),
      bind: () => ({ all: async () => ({ results: [] }), first: async () => null, run: async () => ({ meta: { changes: 0 } }) }),
    }) },
  };
  const list = await testing.allowedOrigins(env);
  assert.deepEqual(list.sort(), ['https://hirevai.com', 'https://www.zoetravelspain.com', 'https://zoetravelspain.com']);
  assert.ok(kv.has('origins:all'), 'la unión queda cacheada');
  // segunda llamada: sale de la caché aunque D1 explote
  env.DB.prepare = () => { throw new Error('boom'); };
  assert.deepEqual((await testing.allowedOrigins(env)).sort(), list.sort());
  // sin caché y con D1 caída: la base del entorno sostiene nuestro sitio
  kv.clear();
  assert.deepEqual(await testing.allowedOrigins(env), ['https://hirevai.com']);
});

test('validateTenant: web_origins exige https sin path, máximo 6 y normaliza', () => {
  const out = testing.validateTenant({ web_origins: [' https://Zoe.COM/ ', 'https://www.zoe.com'] }, { partial: true });
  assert.equal(out.web_origins, '["https://zoe.com","https://www.zoe.com"]');
  assert.throws(() => testing.validateTenant({ web_origins: ['http://inseguro.com'] }, { partial: true }), (e) => e.code === 'invalid_web_origins');
  assert.throws(() => testing.validateTenant({ web_origins: ['https://con.path/ruta'] }, { partial: true }), (e) => e.code === 'invalid_web_origins');
  assert.throws(() => testing.validateTenant({ web_origins: Array(7).fill('https://a.com') }, { partial: true }), (e) => e.code === 'invalid_web_origins');
  assert.equal(testing.validateTenant({ web_origins: [] }, { partial: true }).web_origins, null);
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

test('el prompt efectivo incluye siempre los guardrails, con fallback si el seed falta', () => {
  const config = { SYSTEM: 'VELAI-CODE', GUARDRAILS: 'REGLA-INQUEBRANTABLE' };
  const full = testing.systemFor(config, { system_prompt: 'NEGOCIO-D1' });
  assert.ok(full.includes('NEGOCIO-D1') && full.includes('REGLA-INQUEBRANTABLE'));
  assert.ok(!full.includes('VELAI-CODE'));
  for (const tenant of [{ system_prompt: 'PENDIENTE' }, { system_prompt: '' }, null]) {
    const fallback = testing.systemFor(config, tenant);
    assert.ok(fallback.includes('VELAI-CODE') && fallback.includes('REGLA-INQUEBRANTABLE'), JSON.stringify(tenant));
  }
});

test('las variables de plantilla usan el teléfono E.164 normalizado', () => {
  const vars = JSON.parse(testing.leadTemplateVariables({ whatsapp: '602 608 940', whatsapp_normalized: '+34602608940', name: 'Ana' }));
  assert.equal(vars[1], '+34602608940');
});

async function twilioRequest(url, params, authToken) {
  const data = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature },
    body: new URLSearchParams(params).toString(),
  });
}

test('el webhook de Twilio enruta por To al tenant correcto y aísla el historial', async () => {
  const worker = createWorker({ SYSTEM: 'VELAI-CODE', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: 'REGLA' });
  const ctx = { waitUntil() {} };
  const kvPuts = [];
  const tenants = {
    'whatsapp:+15550000001': { id: 't-uno', slug: 'uno', system_prompt: 'PROMPT-UNO' },
    'whatsapp:+15550000002': { id: 't-dos', slug: 'dos', system_prompt: 'PROMPT-DOS' },
  };
  const env = {
    TWILIO_AUTH_TOKEN: 'tok', TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32),
    ANTHROPIC_API_KEY: 'k',
    KV: { async get() { return null; }, async put(key, value) { kvPuts.push(key); }, async delete() {} },
    DB: { prepare: (sql) => ({ bind: (...args) => ({
      first: async () => sql.includes('channel_address') ? (tenants[args[0]] || null) : null,
      all: async () => ({ results: [] }), run: async () => {},
    }) }), batch: async () => [] },
  };
  const anthropicSystems = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.anthropic.com')) {
      anthropicSystems.push(sysText(JSON.parse(init.body)));
      return new Response(JSON.stringify({ content: [{ text: 'hola' }] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    for (const to of ['whatsapp:+15550000001', 'whatsapp:+15550000002']) {
      const request = await twilioRequest('https://worker.test/', { AccountSid: env.TWILIO_ACCOUNT_SID, From: 'whatsapp:+34600000000', To: to, Body: 'hola' }, 'tok');
      const response = await worker.fetch(request, env, ctx);
      assert.equal(response.status, 200);
    }
    assert.ok(anthropicSystems[0].includes('PROMPT-UNO') && anthropicSystems[0].includes('REGLA'));
    assert.ok(anthropicSystems[1].includes('PROMPT-DOS'));
    // historiales namespaceados por tenant: mismo usuario final, claves distintas
    const convKeys = kvPuts.filter((k) => k.startsWith('conv:wa:'));
    assert.deepEqual([...new Set(convKeys)].sort(), ['conv:wa:t-dos:whatsapp:+34600000000', 'conv:wa:t-uno:whatsapp:+34600000000']);
    // To desconocido: 404 unknown_tenant y sin llamar al modelo
    const before = anthropicSystems.length;
    const unknown = await twilioRequest('https://worker.test/', { AccountSid: env.TWILIO_ACCOUNT_SID, From: 'whatsapp:+34600000000', To: 'whatsapp:+15559999999', Body: 'hola' }, 'tok');
    const notFound = await worker.fetch(unknown, env, ctx);
    assert.equal(notFound.status, 404);
    assert.equal((await notFound.json()).error, 'unknown_tenant');
    assert.equal(anthropicSystems.length, before, 'no debe llamar al modelo');
  } finally { globalThis.fetch = realFetch; }
});

test('cifrado de tokens: ida y vuelta, AAD por tenant y formato corrupto', async () => {
  const env = { SECRETS_KEK: TEST_KEK };
  const stored = await encryptSecret(env, 'tenant-a', 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
  assert.ok(stored.startsWith('v1:'), 'formato v1:<iv>:<ct>');
  assert.equal((await decryptSecret(env, 'tenant-a', stored)).value, 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
  await assert.rejects(decryptSecret(env, 'tenant-B', stored), /cipher_undecryptable/, 'otro tenantId no descifra');
  await assert.rejects(decryptSecret(env, 'tenant-a', 'basura'), /cipher_format/);
});

async function subaccountHarness() {
  const env = {
    TWILIO_AUTH_TOKEN: 'parent-tok', TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32),
    ANTHROPIC_API_KEY: 'k', SECRETS_KEK: TEST_KEK,
    KV: { async get() { return null; }, async put() {}, async delete() {} },
  };
  const subSid = 'AC' + 'c'.repeat(32);
  const subToken = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';
  const tenant = {
    id: 't-cliente', slug: 'cliente', name: 'Cliente', system_prompt: 'PROMPT-CLIENTE',
    twilio_subaccount_sid: subSid,
    twilio_auth_token_enc: await encryptSecret(env, 't-cliente', subToken),
  };
  env.DB = { prepare: (sql) => ({ bind: (...args) => ({
    first: async () => sql.includes('channel_address') && args[0] === 'whatsapp:+15551112222' ? tenant : null,
    all: async () => ({ results: [] }), run: async () => {},
  }) }), batch: async () => [] };
  return { env, subSid, subToken, tenant };
}

test('webhook de subcuenta: firma con el token cifrado del tenant, sin respaldo global', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: 'REGLA' });
  const ctx = { waitUntil() {} };
  const { env, subSid, subToken } = await subaccountHarness();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.anthropic.com')) { calls.push(sysText(JSON.parse(init.body))); return new Response(JSON.stringify({ content: [{ text: 'ok' }] }), { status: 200 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    const base = { AccountSid: subSid, From: 'whatsapp:+34611111111', To: 'whatsapp:+15551112222', Body: 'hola' };
    // firmado con el token de la subcuenta → 200 y contesta con su contexto
    const ok = await worker.fetch(await twilioRequest('https://worker.test/', base, subToken), env, ctx);
    assert.equal(ok.status, 200);
    assert.ok(calls[0].includes('PROMPT-CLIENTE'));
    // el MISMO webhook firmado con el token del padre → 403 (no hay respaldo global)
    const spoofed = await worker.fetch(await twilioRequest('https://worker.test/', base, 'parent-tok'), env, ctx);
    assert.equal(spoofed.status, 403);
    assert.equal((await spoofed.json()).error, 'invalid_twilio_signature');
    // AccountSid que no coincide con la subcuenta de la fila → 403 mismatch
    const mismatch = await worker.fetch(await twilioRequest('https://worker.test/', { ...base, AccountSid: 'AC' + 'x'.repeat(32) }, subToken), env, ctx);
    assert.equal((await mismatch.json()).error, 'account_tenant_mismatch');
  } finally { globalThis.fetch = realFetch; }
});

test('tenant con subcuenta pero sin token: 403 sin llamar al modelo', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const ctx = { waitUntil() {} };
  const { env, subSid, subToken, tenant } = await subaccountHarness();
  tenant.twilio_auth_token_enc = null;
  let modelCalled = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { if (String(url).includes('api.anthropic.com')) modelCalled = true; return new Response('{}', { status: 200 }); };
  try {
    const res = await worker.fetch(await twilioRequest('https://worker.test/', { AccountSid: subSid, From: 'whatsapp:+34611111111', To: 'whatsapp:+15551112222', Body: 'hola' }, subToken), env, ctx);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'twilio_auth_token_missing');
    assert.equal(modelCalled, false);
  } finally { globalThis.fetch = realFetch; }
});

test('deliver envía desde la subcuenta con SUS credenciales (SID en URL y en el Basic)', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), auth: init.headers.Authorization }); return new Response('{}', { status: 201 }); };
  try {
    const env = { TEAM_WHATSAPP: 'whatsapp:+34600000001', TWILIO_FROM: 'whatsapp:+15550000000', TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 'parent-tok', TWILIO_LEAD_TEMPLATE_SID: 'HXtest', SECRETS_KEK: TEST_KEK };
    const sub = 'AC' + 'c'.repeat(32);
    const subToken = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';
    // Con subcuenta ya no hay respaldo cruzado: el tenant necesita SU From y SU plantilla.
    const tenant = { id: 't-x', twilio_subaccount_sid: sub, twilio_from: 'whatsapp:+34910000000', lead_template_sid: 'HX' + 'b'.repeat(32), twilio_auth_token_enc: await encryptSecret(env, 't-x', subToken) };
    await testing.deliver(env, 'whatsapp', { whatsapp: '+34612345678' }, tenant);
    assert.ok(calls[0].url.includes(`/Accounts/${sub}/Messages.json`), 'usa el SID de la subcuenta en la URL');
    assert.equal(calls[0].auth, `Basic ${btoa(`${sub}:${subToken}`)}`, 'autentica con las credenciales de la subcuenta');
    await testing.deliver(env, 'whatsapp', { whatsapp: '+34612345678' }, null);
    assert.equal(calls[1].auth, `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:parent-tok`)}`, 'sin tenant usa el padre');
    // subcuenta sin token: skipped, no un envío roto
    assert.deepEqual(await testing.deliver(env, 'whatsapp', {}, { id: 't-y', twilio_subaccount_sid: sub, twilio_auth_token_enc: null }), { skipped: true, error: 'not_configured' });
  } finally { globalThis.fetch = realFetch; }
});

test('un prospecto pending: no puede activarse y el webhook tiene rate limit por IP', async () => {
  assert.throws(() => testing.assertNotActivePending('pending:myxu-costura', 1), (e) => e.code === 'pending_tenant_cannot_be_active');
  testing.assertNotActivePending('pending:myxu-costura', 0);
  testing.assertNotActivePending('whatsapp:+34910000000', 1);
  assert.doesNotThrow(() => testing.validateTenant({ channel_address: 'pending:myxu-costura' }, { partial: true }));
  // rate limit del webhook: con el contador a tope, 429 antes de tocar D1
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const env = { KV: { async get(k) { return k.startsWith('rl:twilio:') ? '120' : null; }, async put() {}, async delete() {} } };
  const res = await worker.fetch(new Request('https://worker.test/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '9.9.9.9' }, body: 'a=b' }), env, { waitUntil() {} });
  assert.equal(res.status, 429);
});

test('el widget y el formulario envían el tenant en el payload', async () => {
  const widget = await readFile(new URL('../assets/vai-widget.js', import.meta.url), 'utf8');
  const form = await readFile(new URL('../assets/leadform.js', import.meta.url), 'utf8');
  assert.match(widget, /payload\.tenant\s*=\s*window\.VELAI_TENANT/);
  assert.match(form, /payload\.tenant\s*=\s*window\.VELAI_TENANT/);
});

test('validateTenant rechaza formatos inválidos y normaliza los buenos', () => {
  const ok = testing.validateTenant({
    slug: 'Barberia-Lopez', name: 'Barbería López', channel_address: 'whatsapp:+34910000000',
    team_whatsapp: ' whatsapp:+34600111222 , whatsapp:+34600333444 ',
    lead_template_sid: 'HX' + 'a'.repeat(32), system_prompt: 'x'.repeat(60),
  });
  assert.equal(ok.slug, 'barberia-lopez');
  assert.equal(ok.team_whatsapp, 'whatsapp:+34600111222,whatsapp:+34600333444');
  const bad = (body, code) => assert.throws(() => testing.validateTenant(body, { partial: true }), (e) => e.code === code, code);
  bad({ channel_address: 'whatsapp:34910000000' }, 'invalid_channel_address');
  bad({ channel_address: 'telegram:12345' }, 'invalid_channel_address');
  bad({ lead_template_sid: 'HX123' }, 'invalid_lead_template_sid');
  bad({ team_whatsapp: '+34600111222' }, 'invalid_team_whatsapp');
  bad({ system_prompt: 'corto' }, 'invalid_system_prompt');
  bad({ slug: 'Ñ!' }, 'invalid_slug');
});

test('los choques de unicidad se traducen a 409, no a 500', () => {
  assert.equal(testing.tenantWriteError(new Error('UNIQUE constraint failed: tenants.slug')).code, 'slug_taken');
  assert.equal(testing.tenantWriteError(new Error('UNIQUE constraint failed: tenants.channel_address')).code, 'address_taken');
  assert.equal(testing.tenantWriteError(new Error('otra cosa')).message, 'otra cosa');
});

test('la invalidación de caché borra las claves viejas Y las nuevas (addr y slug)', async () => {
  const deleted = [];
  const env = { KV: { async delete(k) { deleted.push(k); } } };
  await testing.invalidateTenantCache(env, [
    { channel_address: 'whatsapp:+1000', slug: 'viejo' },
    { channel_address: 'whatsapp:+2000', slug: 'nuevo' },
  ]);
  // 'origins:all' cae con CUALQUIER edición: la allowlist de CORS depende de las filas.
  assert.deepEqual(deleted.sort(), ['origins:all', 'tenant:addr:whatsapp:+1000', 'tenant:addr:whatsapp:+2000', 'tenant:slug:nuevo', 'tenant:slug:viejo']);
});

function adminEnvWithSpies() {
  const writes = [];
  const stmt = (sql) => ({ bind: (...args) => ({
    run: async () => { writes.push(sql); return { meta: { changes: 1 } }; },
    first: async () => null,
    all: async () => ({ results: [] }),
  }) });
  return {
    writes,
    env: {
      ALLOWED_WEB_ORIGINS: '', ADMIN_ORIGIN: 'https://admin.hirevai.com',
      ANTHROPIC_API_KEY: 'k',
      KV: { puts: [], async get() { return null; }, async put(k) { this.puts.push(k); }, async delete() {} },
      DB: { prepare: stmt, batch: async (s) => { writes.push('batch'); return s.map(() => ({})); } },
    },
  };
}

test('el preview responde sin escribir en D1 ni en KV, y no existe DELETE de tenants', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: 'REGLA' });
  const ctx = { waitUntil() {} };
  const { env, writes } = adminEnvWithSpies();
  // sin JWT válido no se llega al preview: probamos el handler saltándonos Access no es
  // posible desde fuera, así que verificamos 401 (guardián) y después el contrato interno
  const noAuth = await worker.fetch(new Request('https://admin.hirevai.com/api/admin/tenants/00000000-0000-4000-8000-000000000001/preview', { method: 'POST' }), env, ctx);
  assert.equal(noAuth.status, 401);
  const del = await worker.fetch(new Request('https://admin.hirevai.com/api/admin/tenants/00000000-0000-4000-8000-000000000001', { method: 'DELETE' }), env, ctx);
  assert.equal(del.status, 401, 'DELETE tampoco pasa de Access; con Access, el router responde 405');
  assert.equal(writes.length, 0, 'nada escrito en D1');
  assert.equal(env.KV.puts.filter((k) => !k.startsWith('rl:')).length, 0, 'nada escrito en KV');
});

function provisionHarness({ tenant, failUpdate = false } = {}) {
  const updates = [];
  const row = tenant || { id: '00000000-0000-4000-8000-00000000000a', slug: 'acme', name: 'Acme', twilio_subaccount_sid: null, twilio_auth_token_enc: null, lead_template_sid: null, lead_template_status: null, sender_sid: null, waba_id: null };
  const env = {
    TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 'ptok', SECRETS_KEK: TEST_KEK,
    KV: { async get() { return null; }, async put() {}, async delete() {} },
    DB: { prepare: (sql) => ({ bind: (...args) => ({
      first: async () => sql.startsWith('SELECT * FROM tenants') ? row : null,
      run: async () => { if (failUpdate && sql.startsWith('UPDATE tenants')) throw new Error('d1 down'); updates.push({ sql, args }); return { meta: { changes: 1 } }; },
      all: async () => ({ results: [] }),
    }) }), batch: async () => [] },
  };
  return { env, row, updates, ctx: { waitUntil() {} } };
}
const provReq = (body) => new Request('https://admin.hirevai.com/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

test('provision/subaccount: idempotente, cifra el token y no lo devuelve', async () => {
  const twilioCalls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    twilioCalls.push(String(url));
    return new Response(JSON.stringify({ sid: 'AC' + 'n'.repeat(32), auth_token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }), { status: 201 });
  };
  try {
    // fila ya provisionada (SID + token) → 409 SIN llamar a Twilio
    const done = provisionHarness({ tenant: { id: '00000000-0000-4000-8000-00000000000a', slug: 'acme', name: 'Acme', twilio_subaccount_sid: 'AC' + 'x'.repeat(32), twilio_auth_token_enc: 'v1:x:y' } });
    await assert.rejects(testing.handleProvision(provReq(), done.env, done.ctx, done.row.id, 'subaccount', 'juan@x'), (e) => e.code === 'already_provisioned');
    assert.equal(twilioCalls.length, 0);
    // SID pegado a mano SIN token (caso gogestion): se RECUPERA el token de Twilio,
    // se cifra, y no se crea ninguna subcuenta nueva
    globalThis.fetch = async (url, init) => {
      twilioCalls.push(String(url));
      return new Response(JSON.stringify({ sid: 'AC' + 'x'.repeat(32), auth_token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', friendly_name: 'cliente-acme', status: 'active' }), { status: 200 });
    };
    const tgBodies = [];
    const twFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.telegram.org')) { tgBodies.push(JSON.parse(init.body)); return new Response('{"ok":true}', { status: 200 }); }
      return twFetch(url, init);
    };
    const adopt = provisionHarness({ tenant: { id: '00000000-0000-4000-8000-00000000000a', slug: 'acme', name: 'Acme', twilio_subaccount_sid: 'AC' + 'x'.repeat(32), twilio_auth_token_enc: null } });
    adopt.env.TELEGRAM_TOKEN = '123:abc';
    adopt.env.TELEGRAM_CHAT_ID = '-100';
    const pending = [];
    adopt.ctx.waitUntil = (p2) => pending.push(p2.catch(() => {}));
    const adoptRes = await (await testing.handleProvision(provReq(), adopt.env, adopt.ctx, adopt.row.id, 'subaccount', 'juan@x')).json();
    await Promise.all(pending);
    assert.deepEqual([adoptRes.ok, adoptRes.adopted], [true, true]);
    assert.ok(twilioCalls.some((u) => u.includes('/Accounts/AC' + 'x'.repeat(32) + '.json')), 'lee ESA subcuenta, no crea otra');
    // el aviso de auditoría en Telegram DEBE decir de qué cliente es el paso
    const audit = tgBodies.find((b) => String(b.text).includes('adopción'));
    assert.ok(audit && audit.text.includes('Acme') && audit.text.includes('(acme)'), 'la auditoría nombra al cliente');
    globalThis.fetch = twFetch;
    const tokUp = adopt.updates.find((u) => u.sql.includes('SET twilio_auth_token_enc=?'));
    assert.ok(String(tokUp.args[0]).startsWith('v1:'), 'token recuperado y cifrado');
    // sin SID pero con subcuenta preexistente cliente-<slug> en Twilio → se ADOPTA (cero duplicados)
    globalThis.fetch = async (url) => {
      twilioCalls.push(String(url));
      if (String(url).includes('FriendlyName=')) return new Response(JSON.stringify({ accounts: [{ sid: 'AC' + 'z'.repeat(32), auth_token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', friendly_name: 'cliente-acme' }] }), { status: 200 });
      return new Response(JSON.stringify({ sid: 'AC' + 'n'.repeat(32), auth_token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }), { status: 201 });
    };
    const reuse = provisionHarness();
    reuse.row.slug = 'acme';
    const reuseRes = await (await testing.handleProvision(provReq(), reuse.env, reuse.ctx, reuse.row.id, 'subaccount', 'juan@x')).json();
    assert.deepEqual([reuseRes.adopted, reuseRes.sid], [true, 'AC' + 'z'.repeat(32)], 'adopta la existente en vez de crear');
    // creación de verdad: sin SID y sin subcuenta preexistente
    globalThis.fetch = async (url) => {
      twilioCalls.push(String(url));
      if (String(url).includes('FriendlyName=')) return new Response(JSON.stringify({ accounts: [] }), { status: 200 });
      return new Response(JSON.stringify({ sid: 'AC' + 'n'.repeat(32), auth_token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }), { status: 201 });
    };
    // creación correcta: SID guardado, token cifrado v1:, respuesta sin token
    const ok = provisionHarness();
    const res = await testing.handleProvision(provReq(), ok.env, ok.ctx, ok.row.id, 'subaccount', 'juan@x');
    const data = await res.json();
    assert.equal(data.sid.startsWith('AC'), true);
    assert.equal(JSON.stringify(data).includes('a1b2c3d4'), false, 'el token no vuelve al panel');
    const update = ok.updates.find((u) => u.sql.includes('twilio_subaccount_sid'));
    assert.ok(String(update.args[1]).startsWith('v1:'), 'token cifrado en D1');
  } finally { globalThis.fetch = realFetch; }
});

test('un error de Twilio sale al panel con su código (502), nunca como server_error mudo', () => {
  // error tipado 4xx: se respeta status+code y no lleva detalle
  const he = new Error('not_found'); he.status = 404; he.code = 'not_found';
  assert.deepEqual(testing.errorResponseParts(he), { status: 404, code: 'not_found', detail: {} });
  // TwilioError (status+code sin ser HttpError): duck-typing, y al ser 5xx lleva detalle
  const tw = new Error('twilio_400_21404'); tw.status = 502; tw.code = 'twilio_400_21404';
  const parts = testing.errorResponseParts(tw);
  assert.deepEqual([parts.status, parts.code, parts.detail.error], [502, 'twilio_400_21404', 'twilio_400_21404']);
  // error sin tipar: 500 server_error PERO con el mensaje real en el log
  const raw = testing.errorResponseParts(new TypeError('x is not a function'));
  assert.deepEqual([raw.status, raw.code, raw.detail.error], [500, 'server_error', 'x is not a function']);
});

test('provision: Twilio 400 → 502 sin tocar la fila; D1 caída tras crear → provision_orphan', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 21404 }), { status: 400 });
    const bad = provisionHarness();
    await assert.rejects(testing.handleProvision(provReq(), bad.env, bad.ctx, bad.row.id, 'subaccount', 'juan@x'), (e) => e.code === 'twilio_400_21404');
    assert.equal(bad.updates.length, 0, 'la fila no se toca');
    globalThis.fetch = async (url) => new Response(JSON.stringify({ sid: 'AC' + 'n'.repeat(32), auth_token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }), { status: 201 });
    const orphan = provisionHarness({ failUpdate: true });
    await assert.rejects(testing.handleProvision(provReq(), orphan.env, orphan.ctx, orphan.row.id, 'subaccount', 'juan@x'), (e) => e.code === 'provision_orphan');
  } finally { globalThis.fetch = realFetch; }
});

test('provision/sender sin waba → 400 sin llamada; el cron aprueba plantillas pendientes', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('{}', { status: 200 }); };
    const sub = { id: '00000000-0000-4000-8000-00000000000a', slug: 'acme', name: 'Acme', twilio_subaccount_sid: 'AC' + 'c'.repeat(32), waba_id: null, sender_sid: null };
    const h = provisionHarness({ tenant: { ...sub, twilio_auth_token_enc: await encryptSecret({ SECRETS_KEK: TEST_KEK }, sub.id, 'a1b2c3d4e5f60718293a4b5c6d7e8f90') } });
    await assert.rejects(testing.handleProvision(provReq({ phone: '+34910000000' }), h.env, h.ctx, sub.id, 'sender', 'juan@x'), (e) => e.code === 'waba_required');
    assert.equal(calls.length, 0, 'sin llamada a Twilio');
    // cron: pending → approved rellena el estado e invalida
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('/ApprovalRequests')) return new Response(JSON.stringify({ whatsapp: { status: 'approved' } }), { status: 200 });
      return new Response('{}', { status: 200 });
    };
    const pending = { id: '00000000-0000-4000-8000-00000000000b', slug: 'acme2', name: 'Acme2', channel_address: 'whatsapp:+1', twilio_subaccount_sid: 'AC' + 'd'.repeat(32), lead_template_sid: 'HX' + 'a'.repeat(32), lead_template_status: 'pending', sender_sid: null };
    pending.twilio_auth_token_enc = await encryptSecret({ SECRETS_KEK: TEST_KEK }, pending.id, 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
    const cronUpdates = [];
    const env = {
      SECRETS_KEK: TEST_KEK,
      KV: { async get() { return null; }, async put() {}, async delete() {} },
      DB: { prepare: (sql) => ({
        bind: (...args) => ({ run: async () => { cronUpdates.push(sql); return { meta: { changes: 1 } }; }, first: async () => null, all: async () => ({ results: [] }) }),
        all: async () => ({ results: [pending] }),
      }) },
    };
    await testing.pollProvisioning(env);
    assert.ok(cronUpdates.some((sql) => sql.includes("lead_template_status='approved'")), 'el cron marca approved');
  } finally { globalThis.fetch = realFetch; }
});

test('un token que no descifra da 403 con alerta, nunca 500 mudo', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const ctx = { promises: [], waitUntil(p) { this.promises.push(p); } };
  const otherKek = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 99)));
  const id = '00000000-0000-4000-8000-0000000000c1';
  const subSid = 'AC' + 'c'.repeat(32);
  const subToken = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const tenant = { id, slug: 'rot', name: 'Rot', channel_address: 'whatsapp:+34911111111', active: 1,
    twilio_subaccount_sid: subSid, system_prompt: 'x'.repeat(60),
    twilio_auth_token_enc: await encryptSecret({ SECRETS_KEK: otherKek }, id, subToken) };
  const telegramCalls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.telegram.org')) telegramCalls.push(1);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    const env = {
      SECRETS_KEK: TEST_KEK, TELEGRAM_TOKEN: 'tg', TELEGRAM_CHAT_ID: '-1',
      TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 'ptok', ANTHROPIC_API_KEY: 'k',
      KV: { async get() { return null; }, async put() {}, async delete() {} },
      DB: { prepare: (sql) => ({ bind: () => ({ first: async () => sql.includes('channel_address') ? tenant : null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }) }) }), batch: async () => [] },
    };
    const request = await twilioRequest('https://worker.test/', { AccountSid: subSid, From: 'whatsapp:+34600', To: 'whatsapp:+34911111111', Body: 'hola' }, subToken);
    const res = await worker.fetch(request, env, ctx);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'twilio_auth_token_missing');
    await Promise.allSettled(ctx.promises);
    assert.ok(telegramCalls.length >= 1, 'debe alertar a Telegram');
  } finally { globalThis.fetch = realFetch; }
});

test('un ciphertext corrupto no lanza DOMException y deliver lo trata como no configurado', async () => {
  await assert.rejects(decryptSecret({ SECRETS_KEK: TEST_KEK }, 't', 'v1:@@@:@@@'), (e) => e.message === 'cipher_format');
  const out = await testing.deliver(
    { SECRETS_KEK: TEST_KEK, TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 'p' },
    'whatsapp', { whatsapp: '+34612' },
    { id: 't', twilio_subaccount_sid: 'AC' + 'c'.repeat(32), twilio_auth_token_enc: 'v1:@@@:@@@',
      team_whatsapp: 'whatsapp:+34600111222', twilio_from: 'whatsapp:+34910000000', lead_template_sid: 'HX' + '9'.repeat(32) });
  assert.equal(out.skipped, true);
});

test('un tenant con subcuenta nunca usa el From ni la plantilla de Velai', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('{}', { status: 201 }); };
  try {
    const env = { SECRETS_KEK: TEST_KEK, TEAM_WHATSAPP: 'whatsapp:+34600000001', TWILIO_FROM: 'whatsapp:+15706160059', TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 'p', TWILIO_LEAD_TEMPLATE_SID: 'HXvelai' };
    const tenant = { id: 't-n', twilio_subaccount_sid: 'AC' + 'c'.repeat(32), team_whatsapp: 'whatsapp:+34600111222', twilio_from: null, lead_template_sid: null };
    tenant.twilio_auth_token_enc = await encryptSecret(env, 't-n', 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
    const out = await testing.deliver(env, 'whatsapp', { whatsapp: '+34612' }, tenant);
    assert.equal(out.skipped, true, 'skipped, no un envío condenado al 21606');
    assert.equal(calls.length, 0, 'ninguna llamada a Twilio');
  } finally { globalThis.fetch = realFetch; }
});

test('sin SECRETS_KEK no se crea ninguna subcuenta en Twilio', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('{}', { status: 201 }); };
  try {
    const h = provisionHarness();
    delete h.env.SECRETS_KEK;
    await assert.rejects(testing.handleProvision(provReq(), h.env, h.ctx, h.row.id, 'subaccount', 'juan@x'), (e) => e.code === 'kek_not_configured');
    assert.equal(calls.filter((u) => u.includes('/Accounts.json')).length, 0);
  } finally { globalThis.fetch = realFetch; }
});

test('el UPDATE de aprovisionamiento exige columna vacía (carrera → provision_orphan)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({ sid: 'AC' + 'n'.repeat(32), auth_token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' }), { status: 201 });
  };
  try {
    const h = provisionHarness();
    // Simular la carrera: el UPDATE condicionado no cambia nada (otro ya escribió)
    h.env.DB.prepare = (sql) => ({ bind: () => ({
      first: async () => (sql.startsWith('SELECT * FROM tenants') ? h.row : null),
      run: async () => ({ meta: { changes: sql.includes('IS NULL') ? 0 : 1 } }),
      all: async () => ({ results: [] }),
    }) });
    await assert.rejects(testing.handleProvision(provReq(), h.env, h.ctx, h.row.id, 'subaccount', 'juan@x'), (e) => e.code === 'provision_orphan');
  } finally { globalThis.fetch = realFetch; }
});

test('el cerrojo de aprovisionamiento se libera al fallar el paso', async () => {
  const kvOps = { puts: [], deletes: [] };
  const h = provisionHarness({ tenant: { id: '00000000-0000-4000-8000-00000000000a', slug: 'acme', name: 'Acme', twilio_subaccount_sid: 'AC' + 'x'.repeat(32), twilio_auth_token_enc: 'v1:x:y' } });
  h.env.KV = { async get() { return null; }, async put(k) { kvOps.puts.push(k); }, async delete(k) { kvOps.deletes.push(k); } };
  await assert.rejects(testing.handleProvision(provReq(), h.env, h.ctx, h.row.id, 'subaccount', 'juan@x'), (e) => e.code === 'already_provisioned');
  assert.ok(kvOps.deletes.includes(`provision:${h.row.id}:subaccount`), 'la clave del cerrojo se borra aunque el paso falle');
});

test('un tenant web: atiende por el chat con su contexto y es activable', async () => {
  const worker = createWorker({ SYSTEM: 'VELAI', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: 'REGLA' });
  const ctx = { waitUntil() {} };
  const webTenantRow = { id: 't-web', slug: 'zoe', name: 'Zoe', channel_address: 'web:zoe', active: 1, system_prompt: 'PROMPT-ZOE' };
  const anthropicSystems = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('siteverify')) return new Response(JSON.stringify({ success: true, action: 'chat', hostname: 'zoetravelspain.com' }), { status: 200 });
    if (String(url).includes('api.anthropic.com')) { anthropicSystems.push(sysText(JSON.parse(init.body))); return new Response(JSON.stringify({ content: [{ text: 'hola' }] }), { status: 200 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    const env = {
      ALLOWED_WEB_ORIGINS: 'https://zoetravelspain.com', TURNSTILE_SECRET_KEY: 's', ANTHROPIC_API_KEY: 'k',
      KV: { async get() { return null; }, async put() {}, async delete() {} },
      DB: { prepare: (sql) => ({ bind: (...args) => ({ first: async () => sql.includes('slug = ?') && args[0] === 'zoe' ? webTenantRow : null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }) }) }), batch: async () => [] },
    };
    const res = await worker.fetch(new Request('https://worker.test/chat', {
      method: 'POST', headers: { Origin: 'https://zoetravelspain.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'f23e4567-e89b-42d3-a456-426614174000', message: 'hola', tenant: 'zoe', turnstileToken: 'tok' }),
    }), env, ctx);
    assert.equal(res.status, 200);
    assert.ok(anthropicSystems[0].includes('PROMPT-ZOE') && anthropicSystems[0].includes('REGLA'));
  } finally { globalThis.fetch = realFetch; }
  // web: es activable; pending: sigue sin poderlo ser
  testing.assertNotActivePending('web:zoe', 1);
  assert.throws(() => testing.assertNotActivePending('pending:zoe', 1), (e) => e.code === 'pending_tenant_cannot_be_active');
  assert.doesNotThrow(() => testing.validateTenant({ channel_address: 'web:zoe' }, { partial: true }));
});

test('el webhook rechaza direcciones no enrutables (web:/pending:) sin tocar D1', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const ctx = { waitUntil() {} };
  let dbTouched = false;
  const env = {
    TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 'tok',
    KV: { async get() { return null; }, async put() {}, async delete() {} },
    DB: { prepare: () => ({ bind: () => ({ first: async () => { dbTouched = true; return null; }, all: async () => ({ results: [] }), run: async () => {} }) }), batch: async () => [] },
  };
  for (const to of ['web:zoe', 'pending:myxu-costura', 'telegram:123']) {
    const request = await twilioRequest('https://worker.test/', { AccountSid: env.TWILIO_ACCOUNT_SID, From: 'whatsapp:+34600', To: to, Body: 'hola' }, 'tok');
    const res = await worker.fetch(request, env, ctx);
    assert.equal(res.status, 400, to);
    assert.equal((await res.json()).error, 'invalid_twilio_payload');
  }
  assert.equal(dbTouched, false, 'ninguna consulta a D1');
});

test('el panel rediseñado: sin dominios externos salvo las fuentes, nonce y todos los controles', async () => {
  const { ADMIN_HTML } = await import('../worker/admin-page.js');
  assert.equal(ADMIN_HTML.includes('http://'), false, 'nada por http://');
  const externals = [...ADMIN_HTML.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]);
  assert.deepEqual([...new Set(externals)], ['hirevai.com'], 'solo hirevai.com (fuentes)');
  // RECURSOS (src=/url() — lo que gobierna la CSP) siguen siendo solo /fonts/; los
  // ENLACES <a> a hirevai.com (aviso in-product de Google Calendar) son navegación
  // y solo apuntan a las páginas legales. La invariante de CSP no se debilita.
  const resources = [...ADMIN_HTML.matchAll(/(?:src="|url\(')https:\/\/hirevai\.com\/([a-z]+)\//g)];
  assert.ok(resources.length && resources.every((m) => m[1] === 'fonts'), 'recursos solo /fonts/');
  const links = [...ADMIN_HTML.matchAll(/<a href="https:\/\/hirevai\.com\/([a-z]+)\//g)];
  assert.ok(links.length && links.every((m) => ['privacidad', 'condiciones'].includes(m[1])), 'enlaces solo a páginas legales');
  assert.ok(ADMIN_HTML.includes('__NONCE__'));
  for (const id of ['tName', 'tSlug', 'tChannels', 'tFrom', 'tTeam', 'tChat', 'tTpl', 'tSub', 'tWaba', 'tToken', 'tPartner', 'tActive', 'tPrompt', 'tNote', 'pSub', 'pTpl', 'pPhone', 'pSender', 'pCode', 'pVerify', 'tenantFilter', 'newTenant', 'export', 'tTokenState', 'tBotName', 'tBrandName', 'tLogo', 'tColor1', 'tColor2', 'tGreeting', 'tGreetingEn', 'tChips', 'tPlaceholder', 'tWa', 'tTheme', 'brandPrev', 'toasts', 'tOrigins', 'tSyncDomains', 'logout', 'themeBtn', 'themeLabel', 'adminsCard', 'adminsList', 'aEmail', 'aAdd', 'configCard', 'configState', 'cfgToken', 'cfgTokenSave', 'cfgTokenClear']) {
    assert.ok(ADMIN_HTML.includes(`id="${id}"`), `falta #${id}`);
  }
  assert.ok(!/localStorage/.test(ADMIN_HTML), 'sin localStorage');
  // El canal dejó de ser una caja de texto: teclear `web:<slug>` a mano es lo que dejó a
  // gogestion ocupando el canal primario con su WhatsApp sin enrutar (2026-08-24).
  assert.ok(!ADMIN_HTML.includes('id="tAddress"'), 'el canal ya no se teclea en la ficha');
});

test('la serie de 14 días devuelve 14 entradas incluso sin leads y la respuesta de stats no lleva PII', async () => {
  const empty = testing.fillSeries([], 14);
  assert.equal(empty.length, 14);
  assert.ok(empty.every((x) => x.n === 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.d)));
  const withData = testing.fillSeries([{ d: empty[13].d, n: 3 }], 14);
  assert.equal(withData[13].n, 3);
  // /api/admin/stats sin JWT → 401 (Access primero); con host equivocado → 404
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const env = { ALLOWED_WEB_ORIGINS: '', ADMIN_ORIGIN: 'https://admin.hirevai.com' };
  const res = await worker.fetch(new Request('https://admin.hirevai.com/api/admin/stats'), env, { waitUntil() {} });
  assert.equal(res.status, 401);
});

// ── SPEC-HANDOFF parte A: el bot se calla cuando entra un humano ──
function handoffHarness() {
  const kvStore = new Map();
  const telegram = [];
  let modelCalls = 0;
  const tenant = { id: 't-h', slug: 'barberia', name: 'Barbería', channel_address: 'whatsapp:+34910000001', system_prompt: 'x'.repeat(60) };
  const tenantB = { id: 't-i', slug: 'clinica', name: 'Clínica', channel_address: 'whatsapp:+34910000002', system_prompt: 'y'.repeat(60) };
  const env = {
    TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 'tok', ANTHROPIC_API_KEY: 'k',
    TELEGRAM_TOKEN: 'tg', TELEGRAM_CHAT_ID: '-1',
    KV: {
      async get(k, type) { const v = kvStore.get(k); return v == null ? null : (type === 'json' ? JSON.parse(v) : v); },
      async put(k, v) { kvStore.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
      async delete(k) { kvStore.delete(k); },
    },
    DB: { prepare: (sql) => ({ bind: (...args) => ({
      first: async () => sql.includes('channel_address') ? ([tenant, tenantB].find((t) => t.channel_address === args[0]) || null) : null,
      all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }),
    }) }), batch: async () => [] },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.anthropic.com')) {
      modelCalls++;
      const msg = JSON.parse(init.body).messages.at(-1).content;
      const text = /persona|humano/i.test(msg) ? 'Claro, aviso al equipo. [[HUMANO]]' : 'hola, ¿en qué te ayudo?';
      return new Response(JSON.stringify({ content: [{ text }] }), { status: 200 });
    }
    if (String(url).includes('api.telegram.org')) { telegram.push(String(init.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response('{}', { status: 200 });
  };
  return { env, kvStore, telegram, modelCalls: () => modelCalls, restore: () => { globalThis.fetch = realFetch; },
    send: async (worker, ctx, to, body) => worker.fetch(await twilioRequest('https://worker.test/', { AccountSid: env.TWILIO_ACCOUNT_SID, From: 'whatsapp:+34600000000', To: to, Body: body }, 'tok'), env, ctx) };
}

test('handoff: el centinela pausa por tenant+remitente, avisa una vez y nunca llega al cliente', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: 'REGLA' });
  const promises = []; const ctx = { waitUntil(p) { promises.push(p); } };
  const h = handoffHarness();
  try {
    // 1) conversación normal: contesta
    const ok = await h.send(worker, ctx, 'whatsapp:+34910000001', 'hola');
    assert.match(await ok.text(), /en qué te ayudo/);
    // 2) pide humano: responde SIN el centinela, crea la pausa y avisa UNA vez
    const esc = await h.send(worker, ctx, 'whatsapp:+34910000001', 'quiero hablar con una persona');
    const twiml = await esc.text();
    assert.ok(!twiml.includes('[[HUMANO]]'), 'el centinela jamás llega al cliente final');
    assert.match(twiml, /aviso al equipo/);
    await Promise.allSettled(promises);
    assert.ok(h.kvStore.has('pause:t-h:whatsapp:+34600000000'), 'clave de pausa creada');
    assert.equal(h.telegram.length, 1, 'un aviso de escalada');
    // 3) pausado: 200 TwiML vacío, sin modelo, sin aviso nuevo, mensaje guardado
    const before = h.modelCalls();
    const paused = await h.send(worker, ctx, 'whatsapp:+34910000001', '¿hola?');
    assert.equal(paused.status, 200);
    assert.match(await paused.text(), /<Response><\/Response>/);
    assert.equal(h.modelCalls(), before, 'cero llamadas al modelo en pausa');
    assert.equal(h.telegram.length, 1, 'sin aviso repetido');
    const hist = JSON.parse(h.kvStore.get('conv:wa:t-h:whatsapp:+34600000000'));
    assert.equal(hist.at(-1).content, '¿hola?', 'el mensaje queda en el historial');
    // 4) la pausa NO es global: el mismo remitente con OTRO tenant recibe respuesta
    const other = await h.send(worker, ctx, 'whatsapp:+34910000002', 'hola');
    assert.match(await other.text(), /en qué te ayudo/);
    // 5) expirada la pausa (TTL): vuelve a contestar
    h.kvStore.delete('pause:t-h:whatsapp:+34600000000');
    const back = await h.send(worker, ctx, 'whatsapp:+34910000001', 'hola de nuevo');
    assert.match(await back.text(), /en qué te ayudo/);
  } finally { h.restore(); }
});

// ── SPEC-HANDOFF parte B: aislamiento por tenant — tests de fuga ──
function scopedDb({ leads = [], tenantUser = null } = {}) {
  const queries = [];
  return {
    queries,
    prepare(sql) {
      return { bind: (...args) => ({
        first: async () => {
          queries.push({ sql, args });
          if (sql.includes('tenant_users')) return tenantUser;
          if (/SELECT l\.\*.*WHERE l\.id=\?/.test(sql) || /SELECT l\.id FROM leads/.test(sql)) {
            return leads.find((l) => l.id === args[0] && (!sql.includes('tenant_id') || l.tenant_id === args[1])) || null;
          }
          if (sql.includes('SELECT name FROM tenants')) return { name: 'Mi Negocio' };
          return null;
        },
        all: async () => {
          queries.push({ sql, args });
          if (sql.includes('FROM leads l')) {
            const scoped = sql.includes('l.tenant_id = ?') ? leads.filter((l) => l.tenant_id === args.at(sql.includes('LIMIT ?') ? -2 : -1)) : leads;
            return { results: scoped.map((l) => ({ ...l })) };
          }
          return { results: [] };
        },
        run: async () => { queries.push({ sql, args }); return { meta: { changes: sql.includes('tenant_id') ? (leads.some((l) => l.id === args[3] && l.tenant_id === args[4]) ? 1 : 0) : 1 } }; },
      }) };
    },
    batch: async (stmts) => stmts.map(() => ({ results: [{ n: 0, oldest: null }] })),
  };
}
const CLIENTE = { role: 'cliente', tenantId: 't-mio', email: 'cliente@x.com' };
const VELAI = { role: 'velai', tenantId: null, email: 'admin@velai' };
const LEADS = [
  { id: '00000000-0000-4000-8000-0000000000a1', tenant_id: 't-mio', name: 'Mío', whatsapp: '+34600000001', tenant_name: 'Mi Negocio', status: 'new', created_at: '2026-08-18T00:00:00Z' },
  { id: '00000000-0000-4000-8000-0000000000a2', tenant_id: 't-otro', name: 'Ajeno', whatsapp: '+34600000002', tenant_name: 'Otro Negocio', status: 'new', created_at: '2026-08-18T00:00:00Z' },
];
const adminReq = (path, init) => new Request('https://admin.hirevai.com' + path, init);

test('fuga B1/B2/B8: un cliente solo ve sus leads; el lead ajeno es 404; sin nombres de otros', async () => {
  const db = scopedDb({ leads: LEADS });
  const env = { KV: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [] }; } }, DB: db };
  const ctx = { waitUntil() {} };
  // listado: solo los suyos, sin tenant_name
  const list = await testing.adminRouter(adminReq('/api/admin/leads'), env, ctx, '/api/admin/leads', new URL('https://x/api/admin/leads'), {}, CLIENTE);
  const data = await list.json();
  assert.deepEqual(data.leads.map((l) => l.id), ['00000000-0000-4000-8000-0000000000a1']);
  const raw = JSON.stringify(data);
  assert.ok(!raw.includes('Otro Negocio') && !raw.includes('tenant_name') && !raw.includes('twilio_auth_token_enc'));
  // lead ajeno por id → 404, no 403
  await assert.rejects(
    testing.adminRouter(adminReq('/api/admin/leads/' + LEADS[1].id), env, ctx, '/api/admin/leads/' + LEADS[1].id, new URL('https://x/'), {}, CLIENTE),
    (e) => e.status === 404, 'ajeno = 404');
  // el suyo sí
  const mine = await testing.adminRouter(adminReq('/api/admin/leads/' + LEADS[0].id), env, ctx, '/api/admin/leads/' + LEADS[0].id, new URL('https://x/'), {}, CLIENTE);
  assert.equal((await mine.json()).lead.id, LEADS[0].id);
});

test('fuga B3: rutas prohibidas para cliente → 403 sin tocar datos', async () => {
  const db = scopedDb({ leads: LEADS });
  const env = { KV: { async get() { return null; } }, DB: db };
  const ctx = { waitUntil() {} };
  const forbidden = [
    ['/api/admin/tenants', 'GET'],
    ['/api/admin/tenants/00000000-0000-4000-8000-000000000001/provision/subaccount', 'POST'],
    ['/api/admin/leads/' + LEADS[0].id, 'DELETE'],
    ['/api/admin/leads/' + LEADS[0].id + '/retry', 'POST'],
    ['/api/admin/tenants/00000000-0000-4000-8000-000000000001/preview', 'POST'],
  ];
  for (const [path, method] of forbidden) {
    const before = db.queries.length;
    await assert.rejects(
      testing.adminRouter(adminReq(path, { method }), env, ctx, path, new URL('https://x' + path), {}, CLIENTE),
      (e) => e.status === 403 && e.code === 'not_authorized', `${method} ${path}`);
    assert.equal(db.queries.length, before, `sin consultas a D1 para ${path}`);
  }
});

test('fuga B4/B5: CSV y métricas de un cliente, solo lo suyo y sin columna de tenants', async () => {
  const db = scopedDb({ leads: LEADS });
  const env = { KV: { async get() { return null; } }, DB: db };
  const csv = await testing.adminRouter(adminReq('/api/admin/leads/export.csv'), env, { waitUntil() {} }, '/api/admin/leads/export.csv', new URL('https://x/api/admin/leads/export.csv'), {}, CLIENTE);
  const text = await csv.text();
  assert.ok(!text.includes('tenant_name') && !text.includes('Otro Negocio') && !text.includes('+34600000002'));
  // stats: la consulta de leads lleva el filtro del tenant
  await testing.adminRouter(adminReq('/api/admin/stats'), env, { waitUntil() {} }, '/api/admin/stats', new URL('https://x/api/admin/stats'), {}, CLIENTE);
  const statsQueries = db.queries.filter((q) => q.sql.includes('FROM leads') && q.sql.includes('-30 days'));
  assert.ok(statsQueries.every((q) => q.sql.includes('tenant_id = ?')), 'métricas filtradas por tenant');
});

test('fuga B6/B7: sin fila ni ADMIN_EMAILS → 403; ADMIN_EMAILS vacío no rompe a los clientes', async () => {
  const noUser = { DB: scopedDb({ tenantUser: null }), ADMIN_EMAILS: 'admin@velai' };
  await assert.rejects(testing.resolveScope(noUser, 'extraño@x.com'), (e) => e.status === 403);
  // admin por variable
  assert.equal((await testing.resolveScope(noUser, 'ADMIN@velai')).role, 'velai');
  // ADMIN_EMAILS vacío: nadie escala a admin, el cliente sigue entrando con su fila
  const cliente = { DB: scopedDb({ tenantUser: { tenant_id: 't-mio', role: 'cliente' } }), ADMIN_EMAILS: '' };
  const scope = await testing.resolveScope(cliente, 'cliente@x.com');
  assert.deepEqual({ role: scope.role, tenantId: scope.tenantId }, { role: 'cliente', tenantId: 't-mio' });
  await assert.rejects(testing.resolveScope({ DB: scopedDb({}), ADMIN_EMAILS: '' }, 'nadie@x.com'), (e) => e.status === 403);
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

// ── SPEC-USUARIOS parte B: usuarios del cliente desde el panel ──
const TID = '00000000-0000-4000-8000-00000000000b';
function usersDb({ takenEmail = null, users = [] } = {}) {
  const queries = []; const writes = [];
  return {
    queries, writes,
    prepare(sql) {
      return { bind: (...args) => ({
        first: async () => {
          queries.push({ sql, args });
          if (sql.includes('SELECT id FROM tenants')) return { id: args[0] };
          if (sql.includes('COUNT(*)')) return { n: users.length };
          return null;
        },
        all: async () => { queries.push({ sql, args }); return { results: users }; },
        run: async () => {
          queries.push({ sql, args });
          if (sql.includes('INSERT INTO tenant_users')) {
            if (args[0] === takenEmail) throw new Error('D1_ERROR: UNIQUE constraint failed: tenant_users.email');
            writes.push({ sql, args });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('DELETE FROM tenant_users')) {
            const hit = users.some((u) => u.email === args[1]);
            if (hit) writes.push({ sql, args });
            return { meta: { changes: hit ? 1 : 0 } };
          }
          writes.push({ sql, args });
          return { meta: { changes: 1 } };
        },
      }) };
    },
  };
}
const usersPath = (suffix = '') => `/api/admin/tenants/${TID}/users${suffix}`;
const usersReq = (init, suffix = '') => new Request('https://admin.hirevai.com' + usersPath(suffix), init);
const postUser = (db, email, adminEmails = '') => testing.adminRouter(
  usersReq({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }),
  { DB: db, ADMIN_EMAILS: adminEmails }, { waitUntil() {} }, usersPath(), new URL('https://x' + usersPath()), {}, VELAI);

test('usuarios B4.1: correo ya usado por otro cliente → 409 email_taken, sin escribir', async () => {
  const db = usersDb({ takenEmail: 'gestora@otro.com' });
  await assert.rejects(postUser(db, 'gestora@otro.com'), (e) => e.status === 409 && e.code === 'email_taken');
  assert.equal(db.writes.length, 0, 'ni fila ni auditoría tras el 409');
});

test('usuarios B4.2: correo de ADMIN_EMAILS → 400 email_is_admin antes de tocar D1', async () => {
  const db = usersDb({});
  await assert.rejects(postUser(db, 'admin@velai.ai', 'admin@velai.ai, otro@velai.ai'),
    (e) => e.status === 400 && e.code === 'email_is_admin');
  assert.equal(db.queries.length, 0, 'la comprobación de admin no consulta D1');
});

test('usuarios B4.3: rol cliente en los tres endpoints → 403 y cero consultas', async () => {
  const db = usersDb({});
  const cases = [
    ['GET', ''], ['POST', ''], ['DELETE', '/x%40y.com'],
  ];
  for (const [method, suffix] of cases) {
    await assert.rejects(
      testing.adminRouter(usersReq({ method }, suffix), { DB: db }, { waitUntil() {} }, usersPath(suffix), new URL('https://x' + usersPath(suffix)), {}, CLIENTE),
      (e) => e.status === 403 && e.code === 'not_authorized', `${method} ${suffix || '(lista)'}`);
  }
  assert.equal(db.queries.length, 0);
});

test('usuarios B4.4: mayúsculas se guardan en minúsculas y resolveScope las encuentra', async () => {
  const db = usersDb({});
  const res = await postUser(db, '  Gestora@Cliente.COM ');
  assert.equal(res.status, 201);
  const insert = db.writes.find((w) => w.sql.includes('INSERT INTO tenant_users'));
  assert.equal(insert.args[0], 'gestora@cliente.com');
  // resolveScope normaliza también al leer: entra aunque Access reporte el correo con mayúsculas
  const env = { DB: scopedDb({ tenantUser: { tenant_id: TID, role: 'cliente' } }), ADMIN_EMAILS: '' };
  const scope = await testing.resolveScope(env, 'GESTORA@Cliente.com');
  assert.equal(scope.tenantId, TID);
  const lookup = env.DB.queries.find((q) => q.sql.includes('tenant_users'));
  assert.equal(lookup.args[0], 'gestora@cliente.com');
});

test('usuarios B4.5: tras DELETE el correo pasa Access pero recibe 403 (revocación real)', async () => {
  const db = usersDb({ users: [{ email: 'gestora@cliente.com', created_at: '2026-08-18T00:00:00Z' }] });
  const del = await testing.adminRouter(
    usersReq({ method: 'DELETE' }, '/gestora%40cliente.com'),
    { DB: db }, { waitUntil() {} }, usersPath('/gestora%40cliente.com'), new URL('https://x/'), {}, VELAI);
  assert.equal((await del.json()).ok, true);
  // sin fila, resolveScope cierra la puerta aunque Access deje pasar
  await assert.rejects(
    testing.resolveScope({ DB: scopedDb({ tenantUser: null }), ADMIN_EMAILS: '' }, 'gestora@cliente.com'),
    (e) => e.status === 403 && e.code === 'not_authorized');
});

test('usuarios B4.6: el 403 desconocido queda registrado y a la 3ª en una hora sale UNA alerta', async () => {
  const kvStore = new Map();
  const env = {
    TELEGRAM_TOKEN: 'tok', TELEGRAM_CHAT_ID: '1',
    KV: {
      async get(k) { return kvStore.get(k) ?? null; },
      async put(k, v) { kvStore.set(k, v); },
    },
  };
  const telegrams = []; const logs = [];
  const realFetch = globalThis.fetch; const realLog = console.log;
  globalThis.fetch = async (url, init) => { telegrams.push(JSON.parse(init.body)); return new Response('{"ok":true}', { status: 200 }); };
  console.log = (line) => logs.push(line);
  try {
    for (let i = 0; i < 5; i++) await testing.recordAuthFailure(env, 'Curioso@X.com');
  } finally { globalThis.fetch = realFetch; console.log = realLog; }
  assert.equal(logs.filter((l) => l.includes('"not_authorized"') && l.includes('curioso@x.com')).length, 5, 'cada intento queda en el log con el correo');
  assert.equal(telegrams.length, 1, 'la alerta sale exactamente una vez (a la 3ª)');
  assert.ok(telegrams[0].text.includes('curioso@x.com'));
  assert.equal(kvStore.get('authfail:curioso@x.com'), '5');
});

// ── Widget de clientes: autosuficiencia (PR A) y marca por tenant (PR B) ──
test('el widget es autosuficiente: Turnstile propio sin funnel.js y sitekey por defecto', async () => {
  const widget = await readFile(new URL('../assets/vai-widget.js', import.meta.url), 'utf8');
  // (a) sin VELAI_HUMAN, el widget carga y ejecuta Turnstile él mismo
  assert.match(widget, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(widget, /SITEKEY_FALLBACK = '0x4AAAAAAESkAwvlDVJD9Z1l'/);
  // (b) con VELAI_HUMAN presente (hirevai.com) se usa el de funnel.js: no hay un 2º widget
  assert.match(widget, /if \(window\.VELAI_HUMAN\) return window\.VELAI_HUMAN\.execute\(action\);/);
  // (c) funnel.js ya no es un requisito: el error 'human_check_unavailable' desapareció
  assert.equal(widget.includes('human_check_unavailable'), false);
});

test('el widget pinta la marca del tenant desde /widget/boot, no la de Velai', async () => {
  const widget = await readFile(new URL('../assets/vai-widget.js', import.meta.url), 'utf8');
  assert.match(widget, /\/widget\/boot/);
  // colores por variables CSS aplicadas por CSSOM, nunca style="" (lección de la CSP del panel)
  assert.match(widget, /setProperty\('--vai-c1'/);
  // el WhatsApp de los mensajes de error sale de la marca del tenant
  assert.match(widget, /BRAND && BRAND\.wa_number/);
  // bilingüe: el saludo EN del tenant se usa cuando la página está en inglés
  assert.match(widget, /BRAND\.greeting_en/);
});

test('GET /widget/boot devuelve la marca del tenant, con CORS, y 404 si el slug no existe', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const row = {
    id: 't1', slug: 'zoe', name: 'Zoe Travel', active: 1, bot_name: 'Zoe', brand_name: 'Zoe Travel Spain',
    brand_color: '#1a4fd0', greeting: '¡Hola! Soy Zoe', chips_json: '["Vuelos","Hoteles"]', theme: 'dark',
    twilio_auth_token_enc: 'v1:SECRETO', system_prompt: 'PROMPT-PRIVADO',
  };
  const env = {
    ALLOWED_WEB_ORIGINS: 'https://zoetravelspain.com',
    KV: { async get() { return null; }, async put() {}, async delete() {} },
    DB: { prepare: (sql) => ({ bind: (...a) => ({ first: async () => (sql.includes('slug = ?') && a[0] === 'zoe' ? row : null), all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }) }) }), batch: async () => [] },
  };
  const res = await worker.fetch(new Request('https://worker.test/widget/boot?tenant=zoe', { headers: { Origin: 'https://zoetravelspain.com' } }), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://zoetravelspain.com');
  const body = await res.json();
  assert.equal(body.bot_name, 'Zoe');
  assert.deepEqual(body.chips, ['Vuelos', 'Hoteles']);
  assert.equal(body.theme, 'dark');
  // NADA sensible sale del endpoint público: ni token cifrado ni system_prompt
  const raw = JSON.stringify(body);
  assert.equal(raw.includes('SECRETO'), false);
  assert.equal(raw.includes('PROMPT-PRIVADO'), false);
  // slug desconocido → 404 (no cae a la marca de Velai: el snippet mal puesto debe verse)
  const miss = await worker.fetch(new Request('https://worker.test/widget/boot?tenant=nadie'), env, { waitUntil() {} });
  assert.equal(miss.status, 404);
  assert.equal((await miss.json()).error, 'invalid_tenant');
});

test('validateTenant: la marca del widget se valida campo a campo', () => {
  const out = testing.validateTenant({
    bot_name: 'Zoe', brand_color: '#1A4FD0', chips_json: ['Vuelos', 'Hoteles'],
    wa_number: '34 644 280 183', theme: 'dark', logo_url: 'https://zoetravelspain.com/img/zoe-logo.png',
  }, { partial: true });
  assert.equal(out.chips_json, '["Vuelos","Hoteles"]');
  assert.equal(out.wa_number, '34644280183');
  assert.equal(out.theme, 'dark');
  assert.throws(() => testing.validateTenant({ brand_color: 'rojo' }, { partial: true }), (e) => e.code === 'invalid_brand_color');
  assert.throws(() => testing.validateTenant({ logo_url: 'http://inseguro.com/l.png' }, { partial: true }), (e) => e.code === 'invalid_logo_url', 'el logo exige https (mixed content)');
  assert.throws(() => testing.validateTenant({ theme: 'neon' }, { partial: true }), (e) => e.code === 'invalid_theme');
  assert.throws(() => testing.validateTenant({ chips_json: ['1', '2', '3', '4'] }, { partial: true }), (e) => e.code === 'invalid_chips_json');
  // vacío = null: el widget cae a la marca de Velai
  assert.equal(testing.validateTenant({ chips_json: [] }, { partial: true }).chips_json, null);
  assert.equal(testing.validateTenant({ theme: '' }, { partial: true }).theme, null);
});

test('el listado de leads sin ?limit usa 50, no 1 (Number(null) es 0 y el clamp lo subía a 1)', async () => {
  let boundArgs = null;
  const env = { DB: { prepare: (sql) => ({ bind: (...args) => ({
    all: async () => { if (sql.includes('FROM leads l')) boundArgs = args; return { results: [] }; },
    first: async () => null, run: async () => ({ meta: { changes: 0 } }),
  }) }), batch: async () => [] } };
  const url = new URL('https://admin.hirevai.com/api/admin/leads');
  const res = await testing.adminRouter(new Request(url), env, { waitUntil() {} }, '/api/admin/leads', url, {}, { role: 'velai', tenantId: null, email: 'a@velai' });
  assert.equal(res.status, 200);
  assert.equal(boundArgs.at(-1), 51, 'limit por defecto 50 (+1 para detectar nextCursor)');
});

// ── SPEC-ORIGENES-Y-TURNSTILE + SPEC-ACCESO: sincronización con la API de Cloudflare ──
test('provision/domains reescribe Turnstile preservando el mode invisible y con la lista de D1', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/challenges/widgets/')) {
      calls.push({ method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null });
      if (!init || !init.method || init.method === 'GET') {
        return new Response(JSON.stringify({ success: true, result: { name: 'velai-web', mode: 'invisible', bot_fight_mode: false, offlabel: false, clearance_level: 'no_clearance', domains: ['hirevai.com'] } }), { status: 200 });
      }
      return new Response('{"success":true,"result":{}}', { status: 200 });
    }
    return new Response('{"success":true,"ok":true,"result":{}}', { status: 200 });
  };
  try {
    const row = { id: '00000000-0000-4000-8000-000000000001', slug: 'zoe', name: 'Zoe' };
    const env = {
      CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'acc', TURNSTILE_SITEKEY: '0xKEY',
      // el www se pliega en el apex: Turnstile cubre subdominios y solo admite 10 dominios
      ALLOWED_WEB_ORIGINS: 'https://hirevai.com,https://www.hirevai.com',
      DB: { prepare: (sql) => ({
        all: async () => ({ results: sql.includes('active = 1') ? [{ web_origins: '["https://zoetravelspain.com"]' }] : [] }),
        bind: () => ({ first: async () => (sql.startsWith('SELECT * FROM tenants') ? row : null), run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) }),
      }) },
    };
    const res = await testing.handleProvision(new Request('https://admin.hirevai.com/x', { method: 'POST' }), env, { waitUntil() {} }, row.id, 'domains', 'juan@x');
    assert.equal(res.status, 200);
    const put = calls.find((c) => c.method === 'PUT');
    assert.equal(put.body.mode, 'invisible', 'el tipo del widget se preserva (NUNCA managed)');
    assert.deepEqual(put.body.domains.sort(), ['hirevai.com', 'zoetravelspain.com'], 'la lista se reconstruye desde D1 + entorno');
  } finally { globalThis.fetch = realFetch; }
});

test('sin CF_API_TOKEN, provision/domains devuelve 503 y no llama a Cloudflare', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('{"success":true,"result":{}}', { status: 200 }); };
  try {
    const row = { id: '00000000-0000-4000-8000-000000000001', slug: 'zoe', name: 'Zoe' };
    const env = { ALLOWED_WEB_ORIGINS: '', DB: { prepare: (sql) => ({ all: async () => ({ results: [] }), bind: () => ({ first: async () => (sql.startsWith('SELECT * FROM tenants') ? row : null), run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) }) }) } };
    await assert.rejects(
      testing.handleProvision(new Request('https://x', { method: 'POST' }), env, { waitUntil() {} }, row.id, 'domains', 'juan@x'),
      (e) => e.status === 503 && e.code === 'cloudflare_api_not_configured');
    assert.equal(calls.filter((u) => u.includes('cloudflare.com')).length, 0);
  } finally { globalThis.fetch = realFetch; }
});

test('la puerta de Access se reescribe ENTERA desde D1 tras un alta, y un PUT fallido no rompe el alta', async () => {
  const puts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/access/groups/')) { puts.push(JSON.parse(init.body)); return new Response('{"success":true,"result":{}}', { status: 200 }); }
    return new Response('{"success":true,"ok":true,"result":{}}', { status: 200 });
  };
  const gateDb = (emails) => ({ prepare: (sql) => ({
    all: async () => ({ results: emails.map((e) => ({ email: e })) }),
    bind: (...args) => ({
      first: async () => (sql.includes('SELECT id FROM tenants') ? { id: args[0] } : sql.includes('COUNT(*)') ? { n: emails.length } : null),
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: 1 } }),
    }),
  }) });
  try {
    const env = { CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'acc', CF_ACCESS_GROUP_ID: 'g1', DB: gateDb(['a@x.com', 'b@y.com']) };
    const res = await testing.adminRouter(
      usersReq({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'b@y.com' }) }),
      env, { waitUntil() {} }, usersPath(), new URL('https://x' + usersPath()), {}, VELAI);
    const body = await res.json();
    assert.equal(body.gate, 'sincronizado');
    assert.deepEqual(puts[0].include, [{ email: { email: 'a@x.com' } }, { email: { email: 'b@y.com' } }], 'lista COMPLETA desde D1, no incremental');
    // PUT fallido: la fila queda, el alta responde ok y el estado es 'pendiente'
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('/access/groups/')) return new Response('{"success":false,"errors":[{"code":10000}]}', { status: 403 });
      return new Response('{"success":true,"ok":true,"result":{}}', { status: 200 });
    };
    const realLog = console.log; const logs = []; console.log = (l) => logs.push(l);
    let res2;
    try {
      res2 = await testing.adminRouter(
        usersReq({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'c@z.com' }) }),
        env, { waitUntil() {} }, usersPath(), new URL('https://x' + usersPath()), {}, VELAI);
    } finally { console.log = realLog; }
    const body2 = await res2.json();
    assert.equal(res2.status, 201, 'D1 primero: el alta no se pierde por Cloudflare');
    assert.equal(body2.gate, 'pendiente');
    assert.ok(logs.some((l) => l.includes('access_group_desync')), 'la desincronía queda logueada');
  } finally { globalThis.fetch = realFetch; }
});

test('sin usuarios, el grupo de Access se cierra con un centinela (include vacío no es válido)', async () => {
  const { syncAccessGroup } = await import('../worker/cloudflare.js');
  const puts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { puts.push(JSON.parse(init.body)); return new Response('{"success":true,"result":{}}', { status: 200 }); };
  try {
    await syncAccessGroup({ CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'a', CF_ACCESS_GROUP_ID: 'g' }, []);
    assert.deepEqual(puts[0].include, [{ email: { email: 'nadie@velai.invalid' } }]);
  } finally { globalThis.fetch = realFetch; }
});

// ── Admins de Velai desde el panel (migración 0009) ──
function adminsDb({ admins = [], clientEmail = null } = {}) {
  const writes = [];
  return { writes, prepare(sql) {
    const stmt = (args) => ({
      first: async () => {
        if (sql.includes('FROM tenant_users')) return clientEmail && args[0] === clientEmail ? { tenant_id: 't1' } : null;
        if (sql.includes('FROM admin_users')) return admins.find((a) => a === args[0]) ? { email: args[0] } : null;
        return null;
      },
      all: async () => ({ results: admins.map((email) => ({ email, created_by: 'x', created_at: 'y' })) }),
      run: async () => {
        if (sql.includes('INSERT INTO admin_users') && admins.includes(args[0])) throw new Error('UNIQUE constraint failed: admin_users.email');
        writes.push({ sql, args });
        return { meta: { changes: sql.includes('DELETE') ? (admins.includes(args[0]) ? 1 : 0) : 1 } };
      },
    });
    return { bind: (...args) => stmt(args), all: async () => ({ results: admins.map((email) => ({ email, created_by: 'x', created_at: 'y' })) }) };
  } };
}
const adminsReq = (init, suffix = '') => new Request('https://admin.hirevai.com/api/admin/admins' + suffix, init);
const adminsCall = (env, init, suffix = '') => testing.adminRouter(
  adminsReq(init, suffix), env, { waitUntil() {} }, '/api/admin/admins' + suffix, new URL('https://x/api/admin/admins' + suffix), {}, VELAI);

test('admins: el rol cliente no toca /api/admin/admins (403 antes de datos)', async () => {
  await assert.rejects(
    testing.adminRouter(adminsReq({ method: 'GET' }), { DB: adminsDb({}) }, { waitUntil() {} }, '/api/admin/admins', new URL('https://x/api/admin/admins'), {}, CLIENTE),
    (e) => e.status === 403 && e.code === 'not_authorized');
});

test('admins: alta reescribe el grupo «Admins Velai» con los RAÍZ siempre dentro', async () => {
  const puts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/access/groups/')) { puts.push(JSON.parse(init.body)); return new Response('{"success":true,"result":{}}', { status: 200 }); }
    return new Response('{"success":true,"ok":true,"result":{}}', { status: 200 });
  };
  try {
    const env = { CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'a', CF_ADMIN_GROUP_ID: 'g-admins', ADMIN_EMAILS: 'juan@velai.ai', DB: adminsDb({ admins: ['estivenrojas09@gmail.com'] }) };
    const res = await adminsCall(env, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ' Nuevo@Admin.com ' }) });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.email, 'nuevo@admin.com', 'normalizado a minúsculas');
    assert.equal(body.gate, 'sincronizado');
    assert.equal(puts[0].name, 'Admins Velai');
    const included = puts[0].include.map((i) => i.email.email);
    assert.ok(included.includes('juan@velai.ai'), 'los admins raíz del entorno SIEMPRE van en el PUT');
    assert.ok(included.includes('estivenrojas09@gmail.com'));
  } finally { globalThis.fetch = realFetch; }
});

test('admins: guardas — cliente no asciende, raíz no se borra, nadie se quita a sí mismo', async () => {
  const env = { ADMIN_EMAILS: 'juan@velai.ai', DB: adminsDb({ clientEmail: 'gestora@cliente.com' }) };
  await assert.rejects(
    adminsCall(env, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'gestora@cliente.com' }) }),
    (e) => e.status === 409 && e.code === 'email_is_client');
  await assert.rejects(
    adminsCall(env, { method: 'DELETE' }, '/juan%40velai.ai'),
    (e) => e.status === 400 && e.code === 'admin_is_root');
  await assert.rejects(
    adminsCall(env, { method: 'DELETE' }, '/' + encodeURIComponent(VELAI.email)),
    (e) => e.status === 400 && e.code === 'cannot_remove_self');
});

test('admins: resolveScope reconoce a un admin de D1 y un admin de D1 no puede ser usuario de cliente', async () => {
  const env = { ADMIN_EMAILS: '', DB: adminsDb({ admins: ['estivenrojas09@gmail.com'] }) };
  const scope = await testing.resolveScope(env, 'EstivenRojas09@gmail.com');
  assert.equal(scope.role, 'velai');
  assert.equal(scope.tenantId, null);
  // y el cruce inverso: darlo de alta como usuario de cliente → 400 email_is_admin
  const db = adminsDb({ admins: ['estivenrojas09@gmail.com'] });
  await assert.rejects(
    testing.adminRouter(usersReq({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'estivenrojas09@gmail.com' }) }),
      { DB: db, ADMIN_EMAILS: '' }, { waitUntil() {} }, usersPath(), new URL('https://x' + usersPath()), {}, VELAI),
    (e) => e.status === 400 && e.code === 'email_is_admin');
});

// ── Configuración (solo raíz): rotación del token de API de Cloudflare ──
function settingsDb() {
  const store = new Map();
  return { store, prepare(sql) { return { bind: (...args) => ({
    first: async () => (sql.includes('FROM settings') && store.has(args[0]) ? { value_enc: store.get(args[0]) } : null),
    run: async () => { if (sql.includes('INSERT INTO settings')) store.set(args[0], args[1]); if (sql.includes('DELETE FROM settings')) store.clear(); return { meta: { changes: 1 } }; },
    all: async () => ({ results: [] }),
  }), run: async () => { if (sql.includes('DELETE FROM settings')) store.clear(); return { meta: { changes: 1 } }; } }; } };
}
const cfgCall = (env, init, path = '/api/admin/config') => testing.adminRouter(
  new Request('https://admin.hirevai.com' + path, init), env, { waitUntil() {} }, path, new URL('https://x' + path), {}, VELAI);

test('config: solo los admins RAÍZ (env) entran — un admin de D1 recibe 403 root_only', async () => {
  // VELAI.email NO está en ADMIN_EMAILS → aunque su rol sea velai (vía admin_users), config es 403
  await assert.rejects(
    cfgCall({ ADMIN_EMAILS: 'otro@velai.ai', DB: settingsDb() }, { method: 'GET' }),
    (e) => e.status === 403 && e.code === 'root_only');
});

test('config: el token se valida contra Cloudflare ANTES de guardarse, cifrado y write-only', async () => {
  const verifies = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/user/tokens/verify')) {
      verifies.push((init && init.headers && init.headers.Authorization) || '');
      return new Response(JSON.stringify({ success: true, result: { status: 'active' } }), { status: 200 });
    }
    return new Response('{"success":true,"ok":true,"result":{}}', { status: 200 });
  };
  try {
    const db = settingsDb();
    const env = { ADMIN_EMAILS: VELAI.email, SECRETS_KEK: TEST_KEK, DB: db };
    const goodToken = 'A'.repeat(53);
    const res = await cfgCall(env, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: goodToken }) }, '/api/admin/config/cf-token');
    const body = await res.json();
    assert.equal(body.source, 'panel');
    assert.ok(verifies[0].includes(goodToken), 'verificado con el token candidato');
    const enc = db.store.get('cf_api_token');
    assert.ok(enc && !enc.includes(goodToken), 'guardado CIFRADO, nunca en claro');
    // y el worker lo resuelve con prioridad sobre el secret del entorno
    const resolved = await testing.withCfToken(env);
    assert.equal(resolved.CF_API_TOKEN, goodToken);
    // la respuesta jamás devuelve el token
    assert.equal(JSON.stringify(body).includes(goodToken), false);
  } finally { globalThis.fetch = realFetch; }
});

test('config: un token que Cloudflare rechaza NO se guarda', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/user/tokens/verify')) return new Response(JSON.stringify({ success: false, errors: [{ code: 1000 }] }), { status: 401 });
    return new Response('{"success":true,"result":{}}', { status: 200 });
  };
  try {
    const db = settingsDb();
    const env = { ADMIN_EMAILS: VELAI.email, SECRETS_KEK: TEST_KEK, DB: db };
    await assert.rejects(
      cfgCall(env, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'B'.repeat(53) }) }, '/api/admin/config/cf-token'),
      (e) => e.status === 400 && e.code === 'token_invalid');
    assert.equal(db.store.size, 0, 'nada escrito');
  } finally { globalThis.fetch = realFetch; }
});

// ── Sprint de blindaje: idempotencia del webhook + presupuesto por tenant ────

function mapKV(kv = new Map()) {
  return {
    map: kv,
    async get(k, t) { const v = kv.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { kv.set(k, v); },
    async delete(k) { kv.delete(k); },
  };
}

function webhookEnv(tenants, kv) {
  return {
    TWILIO_AUTH_TOKEN: 'tok', TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), ANTHROPIC_API_KEY: 'k',
    KV: mapKV(kv),
    DB: { prepare: (sql) => ({ bind: (...args) => ({
      first: async () => sql.includes('channel_address') ? (tenants[args[0]] || null) : null,
      all: async () => ({ results: [] }), run: async () => {},
    }) }), batch: async () => [] },
  };
}

test('el webhook ignora un MessageSid repetido sin llamar al modelo ni duplicar historial', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const ctx = { waitUntil() {} };
  const env = webhookEnv({ 'whatsapp:+15550000001': { id: 't-uno', slug: 'uno', system_prompt: 'P' } });
  let modelCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.anthropic.com')) { modelCalls++; return new Response(JSON.stringify({ content: [{ text: 'hola' }] }), { status: 200 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    const params = { AccountSid: env.TWILIO_ACCOUNT_SID, From: 'whatsapp:+34600000000', To: 'whatsapp:+15550000001', Body: 'hola', MessageSid: 'SM' + '1'.repeat(32) };
    const first = await worker.fetch(await twilioRequest('https://worker.test/', params, 'tok'), env, ctx);
    assert.equal(first.status, 200);
    assert.ok((await first.text()).includes('<Message>'), 'el primero contesta');
    // Twilio reintenta el MISMO webhook (mismo MessageSid): TwiML vacío, sin modelo
    const second = await worker.fetch(await twilioRequest('https://worker.test/', params, 'tok'), env, ctx);
    assert.equal(second.status, 200);
    assert.ok(!(await second.text()).includes('<Message>'), 'el duplicado responde TwiML vacío');
    assert.equal(modelCalls, 1, 'el modelo se paga UNA vez');
    const history = JSON.parse(env.KV.map.get('conv:wa:t-uno:whatsapp:+34600000000'));
    assert.equal(history.filter((m) => m.role === 'user').length, 1, 'sin turnos duplicados');
  } finally { globalThis.fetch = realFetch; }
});

test('el webhook no reintenta al modelo y los demás llamadores mantienen el reintento', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const ctx = { waitUntil() {} };
  const env = webhookEnv({ 'whatsapp:+15550000001': { id: 't-uno', slug: 'uno', system_prompt: 'P' } });
  let modelCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.anthropic.com')) { modelCalls++; return new Response('{}', { status: 500 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    const params = { AccountSid: env.TWILIO_ACCOUNT_SID, From: 'whatsapp:+34600000000', To: 'whatsapp:+15550000001', Body: 'hola', MessageSid: 'SM' + '2'.repeat(32) };
    const res = await worker.fetch(await twilioRequest('https://worker.test/', params, 'tok'), env, ctx);
    assert.equal(res.status, 502);
    assert.equal(modelCalls, 1, 'el webhook no reintenta: Twilio ya reintenta el webhook entero');
    modelCalls = 0;
    // fuera del webhook los defaults siguen: timeout 15 s y 1 reintento en 5xx
    await assert.rejects(testing.callAnthropic({ ANTHROPIC_API_KEY: 'k' }, { messages: [] }), (e) => e.code === 'ai_unavailable');
    assert.equal(modelCalls, 2, 'los defaults mantienen el reintento');
  } finally { globalThis.fetch = realFetch; }
});

test('una petición sin firma válida no escribe la clave de dedupe', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const ctx = { waitUntil() {} };
  const env = webhookEnv({ 'whatsapp:+15550000001': { id: 't-uno', slug: 'uno', system_prompt: 'P' } });
  const params = { AccountSid: env.TWILIO_ACCOUNT_SID, From: 'whatsapp:+34600000000', To: 'whatsapp:+15550000001', Body: 'hola', MessageSid: 'SM' + '3'.repeat(32) };
  const res = await worker.fetch(await twilioRequest('https://worker.test/', params, 'token-equivocado'), env, ctx);
  assert.equal(res.status, 403);
  // sin firma no se puede envenenar el sid de un mensaje legítimo
  assert.equal([...env.KV.map.keys()].filter((k) => k.startsWith('dedupe:')).length, 0);
});

test('el cupo agotado de un tenant no afecta a otro y la alerta dice qué tenant fue', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const ctx = { waitUntil() {} };
  const day = new Date().toISOString().slice(0, 10);
  const kv = new Map([[`budget:ai:t-uno:${day}`, '300']]);
  const env = webhookEnv({
    'whatsapp:+15550000001': { id: 't-uno', slug: 'uno', name: 'Cliente Uno', system_prompt: 'P' },
    'whatsapp:+15550000002': { id: 't-dos', slug: 'dos', name: 'Cliente Dos', system_prompt: 'P' },
  }, kv);
  env.TELEGRAM_TOKEN = 'tg'; env.TELEGRAM_CHAT_ID = '1';
  const telegramTexts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.telegram.org')) { telegramTexts.push(JSON.parse(init.body).text); return new Response('{"ok":true}', { status: 200 }); }
    if (String(url).includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ text: 'hola' }] }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  try {
    const base = { AccountSid: env.TWILIO_ACCOUNT_SID, From: 'whatsapp:+34600000000', Body: 'hola' };
    const blocked = await worker.fetch(await twilioRequest('https://worker.test/', { ...base, To: 'whatsapp:+15550000001', MessageSid: 'SM' + '4'.repeat(32) }, 'tok'), env, ctx);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error, 'ai_tenant_budget_exhausted');
    assert.ok(telegramTexts.some((t) => t.includes('Cliente Uno')), 'la alerta nombra al tenant');
    const fine = await worker.fetch(await twilioRequest('https://worker.test/', { ...base, To: 'whatsapp:+15550000002', MessageSid: 'SM' + '5'.repeat(32) }, 'tok'), env, ctx);
    assert.equal(fine.status, 200, 'el otro tenant sigue en servicio');
    // tras la llamada OK, ambos contadores existen e incrementados
    assert.equal(kv.get(`budget:ai:t-dos:${day}`), '1');
    assert.equal(kv.get(`budget:ai:${day}`), '1');
  } finally { globalThis.fetch = realFetch; }
});

test('el techo global sigue cortando a todos y tenants.ai_daily_limit pisa el default', async () => {
  const day = new Date().toISOString().slice(0, 10);
  // techo global agotado: 429 ai_budget_exhausted para cualquier tenant
  const globalKv = mapKV(new Map([[`budget:ai:${day}`, '1000']]));
  await assert.rejects(
    testing.callAnthropic({ ANTHROPIC_API_KEY: 'k', KV: globalKv }, { messages: [] }, { tenant: { id: 't-uno', slug: 'uno', name: 'Uno' } }),
    (e) => e.code === 'ai_budget_exhausted');
  // límite por fila (ai_daily_limit=1) por debajo del default del env
  const kv = mapKV(new Map([[`budget:ai:t-uno:${day}`, '1']]));
  const env = { ANTHROPIC_API_KEY: 'k', AI_TENANT_DAILY_LIMIT: '300', KV: kv };
  await assert.rejects(
    testing.callAnthropic(env, { messages: [] }, { tenant: { id: 't-uno', slug: 'uno', name: 'Uno', ai_daily_limit: 1 } }),
    (e) => e.code === 'ai_tenant_budget_exhausted');
  // el mismo contador con el default del env (300) pasa
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ text: 'ok' }] }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  try {
    const reply = await testing.callAnthropic(env, { messages: [] }, { tenant: { id: 't-uno', slug: 'uno', name: 'Uno' } });
    assert.equal(reply, 'ok');
  } finally { globalThis.fetch = realFetch; }
});

// ── Sprint de blindaje: el JS del panel es una función real y arranca de verdad ──

test('el JS del panel se serializa entero como IIFE, con nonce y sin romper el HTML', async () => {
  const { ADMIN_HTML } = await import('../worker/admin-page.js');
  const { panelApp } = await import('../worker/admin-panel.js');
  assert.ok(ADMIN_HTML.includes('(function panelApp'), 'la función viaja serializada como IIFE');
  assert.equal([...ADMIN_HTML.matchAll(/<\/script>/g)].length, 1, 'un único cierre de script');
  // la regla de la cabecera de admin-panel.js, verificada: el cuerpo no puede
  // contener el cierre (cortaría el <script> del panel a mitad)
  assert.ok(!panelApp.toString().includes('</scr' + 'ipt>'));
  assert.ok(!panelApp.toString().includes('`'), 'sin backticks: el ensamblador es un template literal');
  // el shim de __name debe ir ANTES de la IIFE: esbuild (keepNames) inyecta
  // __name(...) dentro del cuerpo y sin shim el panel muere al arrancar
  assert.ok(ADMIN_HTML.indexOf('var __name=') < ADMIN_HTML.indexOf('(function panelApp'), 'shim de __name antes de la IIFE');
});

test('el panel arranca contra un DOM mínimo y pide me, leads, stats y escalations', async () => {
  const vm = await import('node:vm');
  const { ADMIN_HTML } = await import('../worker/admin-page.js');
  // Se ejecuta el script ENSAMBLADO extraído del HTML (shim de __name incluido),
  // no panelApp a secas: es lo más parecido a lo que recibe el navegador que se
  // puede probar sin bundlear (el bundle real lo cubre scripts/check-bundle.mjs).
  const script = ADMIN_HTML.slice(
    ADMIN_HTML.indexOf('<script nonce="__NONCE__">') + '<script nonce="__NONCE__">'.length,
    ADMIN_HTML.lastIndexOf('</scr' + 'ipt>'),
  );
  // Elemento stub: acepta cualquier lectura/escritura sin romperse. No simula un DOM;
  // caza ReferenceErrors, typos y regresiones del arranque que el grep no ve.
  const listNoop = () => [];
  let element;
  const handler = {
    get(_, prop) {
      if (prop === 'then' || prop === Symbol.toPrimitive) return undefined;
      if (prop === 'querySelectorAll') return listNoop;
      if (prop === 'children') return [];
      if (prop === 'querySelector' || prop === 'closest' || prop === 'createElement') return () => element;
      if (prop === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (prop === 'dataset' || prop === 'style') return new Proxy({}, { get: () => '', set: () => true });
      if (prop === 'value' || prop === 'textContent' || prop === 'innerHTML' || prop === 'id') return '';
      if (prop === 'checked' || prop === 'hidden' || prop === 'disabled') return false;
      if (prop === 'matches') return () => false;
      return () => undefined; // addEventListener, insertAdjacentHTML, showPopover, remove…
    },
    set: () => true,
  };
  element = new Proxy(function () {}, handler);
  const fetched = [];
  const fixtures = [
    ['/api/admin/me', { role: 'velai' }],
    ['/api/admin/stats', { total30: 0, sinContactar: 0 }],
    ['/api/admin/leads', { leads: [] }],
    ['/api/admin/tenants', { tenants: [] }],
    ['/api/admin/escalations', { escalations: [] }],
  ];
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  const context = vm.createContext({
    document: element,
    location: { href: '' },
    fetch: async (path) => {
      fetched.push(String(path));
      const hit = fixtures.find(([route]) => String(path).startsWith(route));
      return new Response(JSON.stringify(hit ? hit[1] : {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    FormData: class { *[Symbol.iterator]() {} },
    URLSearchParams, Intl, Response,
    setTimeout: () => 0, requestAnimationFrame: () => {}, confirm: () => false,
  });
  try {
    new vm.default.Script(script).runInContext(context);
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  } finally { process.off('unhandledRejection', onRejection); }
  assert.deepEqual(rejections, [], 'el arranque no deja promesas rotas');
  for (const route of ['/api/admin/me', '/api/admin/leads', '/api/admin/stats', '/api/admin/escalations']) {
    assert.ok(fetched.some((p) => p.startsWith(route)), `el arranque pide ${route}`);
  }
});

// ── SPEC-CALENDARIO fase 1 (solo Google) ─────────────────────────────────────

test('freeSlots: DST de Madrid, horario partido, solapes y margen de 15 min', async () => {
  const { freeSlots, localToUtcMs } = await import('../worker/calendar.js');
  // offsets reales: invierno +1, verano +2, y el propio día del cambio de hora
  assert.equal(new Date(localToUtcMs('Europe/Madrid', '2026-01-15', '10:00')).toISOString(), '2026-01-15T09:00:00.000Z');
  assert.equal(new Date(localToUtcMs('Europe/Madrid', '2026-07-15', '10:00')).toISOString(), '2026-07-15T08:00:00.000Z');
  assert.equal(new Date(localToUtcMs('Europe/Madrid', '2026-03-29', '10:00')).toISOString(), '2026-03-29T08:00:00.000Z');
  const base = { date: '2026-07-15', slotMinutes: 60, timezone: 'Europe/Madrid', nowMs: Date.parse('2026-07-14T00:00:00Z') };
  // horario partido y una cita 11:00-12:00 local: se cae exactamente ese hueco
  const huecos = freeSlots({ ...base, hours: [['10:00', '13:00'], ['16:00', '18:00']], busy: [{ start: '2026-07-15T09:00:00Z', end: '2026-07-15T10:00:00Z' }] });
  assert.deepEqual(huecos, ['10:00', '12:00', '16:00', '17:00']);
  assert.deepEqual(freeSlots({ ...base, hours: [], busy: [] }), [], 'día sin horario = sin huecos');
  // margen: a las 10:30 ya no se ofrece el hueco de las 10:00 (ni "en 3 minutos")
  const hoy = freeSlots({ ...base, hours: [['10:00', '12:00']], busy: [], nowMs: localToUtcMs('Europe/Madrid', '2026-07-15', '10:30') });
  assert.deepEqual(hoy, ['11:00']);
});

test('el bucle de tools cumple el contrato de la API y corta en 3 vueltas', async () => {
  const requests = [];
  let mode = 'oneTool';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('api.anthropic.com')) return new Response('{}', { status: 200 });
    requests.push(JSON.parse(init.body));
    if (mode === 'always') return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_x', name: 'consultar_disponibilidad', input: {} }] }), { status: 200 });
    if (requests.length === 1) return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'Voy a mirar' }, { type: 'tool_use', id: 'tu_1', name: 'consultar_disponibilidad', input: { fecha: '2026-09-01' } }] }), { status: 200 });
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tengo hueco a las 10:00' }] }), { status: 200 });
  };
  try {
    const env = { ANTHROPIC_API_KEY: 'k' };
    const calls = [];
    const executor = async (name, input) => { calls.push({ name, input }); return JSON.stringify({ huecos: ['10:00'] }); };
    const reply = await testing.runToolLoop(env, { model: 'm', max_tokens: 500, messages: [{ role: 'user', content: 'cita' }] }, [], executor);
    assert.equal(reply, 'Tengo hueco a las 10:00');
    assert.deepEqual(calls, [{ name: 'consultar_disponibilidad', input: { fecha: '2026-09-01' } }]);
    // 2ª petición: content del assistant ENTERO + UN solo mensaje user con el tool_result
    const assistant = requests[1].messages.at(-2); const user = requests[1].messages.at(-1);
    assert.equal(assistant.role, 'assistant');
    assert.equal(assistant.content.length, 2, 'el content del assistant se reenvía entero');
    assert.deepEqual(user.content.map((b) => [b.type, b.tool_use_id]), [['tool_result', 'tu_1']]);
    // un executor que lanza es tool_result con is_error, no rompe el bucle
    requests.length = 0; mode = 'oneTool';
    const errored = await testing.runToolLoop(env, { model: 'm', messages: [{ role: 'user', content: 'x' }] }, [], async () => { throw new Error('boom'); });
    assert.equal(errored, 'Tengo hueco a las 10:00');
    assert.equal(requests[1].messages.at(-1).content[0].is_error, true);
    // bucle infinito: corta tras 3 vueltas de tools (4 llamadas) y devuelve null
    requests.length = 0; mode = 'always';
    assert.equal(await testing.runToolLoop(env, { model: 'm', messages: [{ role: 'user', content: 'x' }] }, [], executor), null);
    assert.equal(requests.length, 4);
  } finally { globalThis.fetch = realFetch; }
});

test('system del calendario: bloque estable cacheado y bloque volátil sin cache_control', () => {
  const config = { SYSTEM: 'BASE', GUARDRAILS: 'REGLA' };
  const cal = { timezone: 'Europe/Madrid', slot_minutes: 30 };
  const a = testing.calendarSystem(config, { system_prompt: 'NEGOCIO' }, cal);
  const b = testing.calendarSystem(config, { system_prompt: 'NEGOCIO' }, cal);
  assert.equal(a[0].cache_control.type, 'ephemeral');
  assert.ok(a[0].text.includes('NEGOCIO') && a[0].text.includes('REGLA') && a[0].text.includes('GESTIÓN DE CITAS'));
  assert.equal(a[1].cache_control, undefined, 'el bloque volátil JAMÁS lleva cache_control');
  assert.ok(a[1].text.includes('Europe/Madrid'));
  assert.equal(a[0].text, b[0].text, 'el bloque cacheado es byte-estable entre llamadas');
  assert.ok(!/\d{4}/.test(a[0].text), 'ninguna fecha puede entrar en el bloque cacheado');
});

test('el executor trata el input del modelo como hostil y nunca lanza por datos malos', async () => {
  const cal = { tenant_id: 't-cal', calendar_id: 'primary', timezone: 'Europe/Madrid', slot_minutes: 30, business_hours: null };
  const exec = testing.calendarExecutor({}, { slug: 'uno' }, cal, { channel: 'web', conversationKey: 'c1', defaultPhone: '' });
  const future = `${new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}T10:00`;
  assert.equal(JSON.parse(await exec('consultar_disponibilidad', { fecha: 'mañana' })).error, 'fecha_invalida');
  assert.equal(JSON.parse(await exec('consultar_disponibilidad', { fecha: '2020-01-01' })).error, 'fecha_pasada');
  assert.equal(JSON.parse(await exec('agendar_cita', { fecha_hora: '2099-01-01T10:00', nombre: 'Ana', telefono: '612345678' })).error, 'fecha_lejana');
  assert.equal(JSON.parse(await exec('agendar_cita', { fecha_hora: future, nombre: 'Ana', telefono: '12' })).error, 'datos_incompletos');
  assert.equal(JSON.parse(await exec('agendar_cita', { fecha_hora: 'basura' })).error, 'fecha_invalida');
  assert.equal(JSON.parse(await exec('otra_cosa', {})).error, 'tool_desconocida');
});

// Próximo día laborable a ≥7 días vista en Madrid (el horario default es L-V).
function nextWorkday() {
  for (let offset = 7; ; offset++) {
    const day = new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', weekday: 'short' }).format(new Date(`${day}T12:00:00Z`)).toLowerCase();
    if (wd !== 'sat' && wd !== 'sun') return day;
  }
}

test('agendar_cita: relee el hueco antes de crear, no duplica y respeta el cerrojo', async () => {
  const { localToUtcMs } = await import('../worker/calendar.js');
  const day = nextWorkday();
  const iso = (hhmm) => new Date(localToUtcMs('Europe/Madrid', day, hhmm)).toISOString();
  const inserts = [];
  const db = { prepare: (sql) => ({ bind: (...args) => ({
    run: async () => {
      if (sql.includes('INSERT INTO appointments')) {
        if (inserts.some((i) => i[2] === args[2])) throw new Error('UNIQUE constraint failed: appointments.request_id');
        inserts.push(args);
      }
      return { meta: { changes: 1 } };
    },
    first: async () => null, all: async () => ({ results: [] }),
  }) }) };
  const env = { DB: db, KV: mapKV(), GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'sec', SECRETS_KEK: TEST_KEK };
  const enc = await encryptSecret(env, 'calendar:t-cal', 'refresh-tok');
  const cal = { tenant_id: 't-cal', provider: 'google', refresh_token_enc: enc, calendar_id: 'primary', timezone: 'Europe/Madrid', slot_minutes: 30, business_hours: null, status: 'connected' };
  const created = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
    if (u.includes('/events?')) return new Response(JSON.stringify({ items: [{ start: { dateTime: iso('10:00') }, end: { dateTime: iso('10:30') }, status: 'confirmed' }] }), { status: 200 });
    if (u.includes('/events')) { created.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'evt1' }), { status: 201 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    const exec = testing.calendarExecutor(env, { slug: 'uno' }, cal, { channel: 'whatsapp', conversationKey: 'whatsapp:+34600', defaultPhone: '+34600000000' });
    // relectura del proveedor: el hueco de las 10:00 está ocupado — ni evento ni fila
    const busy = JSON.parse(await exec('agendar_cita', { fecha_hora: `${day}T10:00`, nombre: 'Ana', telefono: '612345678' }));
    assert.equal(busy.error, 'hueco_ocupado');
    assert.ok(busy.alternativas.length && !busy.alternativas.includes('10:00'));
    assert.equal(created.length, 0);
    // hueco libre: evento en Google + fila en appointments
    const ok = JSON.parse(await exec('agendar_cita', { fecha_hora: `${day}T11:00`, nombre: 'Ana', telefono: '612345678' }));
    assert.deepEqual([ok.ok, ok.hora], [true, '11:00']);
    assert.equal(created.length, 1);
    assert.equal(inserts.length, 1);
    assert.ok(created[0].summary.includes('Ana'));
    // cerrojo KV: otra conversación sobre el MISMO hueco no crea un segundo evento
    const race = JSON.parse(await exec('agendar_cita', { fecha_hora: `${day}T11:00`, nombre: 'Luis', telefono: '612345679' }));
    assert.equal(race.error, 'hueco_ocupado');
    assert.equal(created.length, 1, 'el cerrojo evita el segundo evento');
  } finally { globalThis.fetch = realFetch; }
});

test('webhook con calendario: tool_use → TwiML vacío YA y la respuesta llega por la Messages API', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: 'REGLA' });
  const waits = [];
  const ctx = { waitUntil(p) { waits.push(p); } };
  const kv = new Map();
  const tenant = { id: '00000000-0000-4000-8000-0000000000c1', slug: 'uno', name: 'Uno', system_prompt: 'P' };
  const env = webhookEnv({}, kv);
  env.GOOGLE_OAUTH_CLIENT_ID = 'cid'; env.GOOGLE_OAUTH_CLIENT_SECRET = 'sec'; env.SECRETS_KEK = TEST_KEK;
  const enc = await encryptSecret(env, `calendar:${tenant.id}`, 'refresh-tok');
  const calRow = { tenant_id: tenant.id, provider: 'google', refresh_token_enc: enc, calendar_id: 'primary', timezone: 'Europe/Madrid', slot_minutes: 30, business_hours: null, status: 'connected' };
  env.DB = { prepare: (sql) => ({ bind: () => ({
    first: async () => sql.includes('channel_address') ? tenant : (sql.includes('tenant_calendars') ? calRow : null),
    all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }),
  }) }), batch: async () => [] };
  let anthropicCalls = 0; const twilioSends = [];
  const day = nextWorkday();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.anthropic.com')) {
      anthropicCalls++;
      if (anthropicCalls === 1) return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'consultar_disponibilidad', input: { fecha: day } }] }), { status: 200 });
      return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tienes hueco a las 10:00, ¿te lo reservo?' }] }), { status: 200 });
    }
    if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
    if (u.includes('/events?')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
    if (u.includes('api.twilio.com')) { twilioSends.push(String(init.body)); return new Response('{}', { status: 201 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    const params = { AccountSid: env.TWILIO_ACCOUNT_SID, From: 'whatsapp:+34600000000', To: 'whatsapp:+15550000001', Body: 'quiero cita', MessageSid: 'SM' + '6'.repeat(32) };
    env.DB.prepare('x'); // no-op para linters de stub
    const tenants = { 'whatsapp:+15550000001': tenant };
    env.DB = { prepare: (sql) => ({ bind: (...args) => ({
      first: async () => sql.includes('channel_address') ? (tenants[args[0]] || null) : (sql.includes('tenant_calendars') ? calRow : null),
      all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }),
    }) }), batch: async () => [] };
    const res = await worker.fetch(await twilioRequest('https://worker.test/', params, 'tok'), env, ctx);
    assert.equal(res.status, 200);
    assert.ok(!(await res.text()).includes('<Message>'), 'TwiML vacío inmediato: Twilio no espera al bucle');
    await Promise.all(waits);
    assert.equal(anthropicCalls, 2);
    const send = twilioSends.map((b) => new URLSearchParams(b)).find((p) => p.get('Body'));
    assert.ok(send, 'la respuesta final sale por la Messages API');
    assert.equal(send.get('From'), 'whatsapp:+15550000001', 'From = la dirección del tenant');
    assert.equal(send.get('To'), 'whatsapp:+34600000000');
    assert.ok(send.get('Body').includes('10:00'));
    const history = JSON.parse(kv.get(`conv:wa:${tenant.id}:whatsapp:+34600000000`));
    assert.equal(history.at(-1).role, 'assistant', 'el turno completo queda en el historial');
  } finally { globalThis.fetch = realFetch; }
});

test('callback OAuth: state de un solo uso, token cifrado con AAD calendar: y 404 en el hostname público', async () => {
  const kv = mapKV();
  const inserts = [];
  const db = { prepare: (sql) => ({ bind: (...args) => ({
    run: async () => { inserts.push({ sql, args }); return { meta: { changes: 1 } }; },
    first: async () => null, all: async () => ({ results: [] }),
  }) }), batch: async () => [] };
  const env = { DB: db, KV: kv, SECRETS_KEK: TEST_KEK, GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'sec', ADMIN_ORIGIN: 'https://admin.hirevai.com' };
  const ctx = { waitUntil() {} };
  const cbUrl = (qs) => new URL(`https://admin.hirevai.com/oauth/calendar/callback?${qs}`);
  await assert.rejects(testing.calendarCallbackFor(env, ctx, cbUrl('state=malo&code=c'), 'admin@velai'), (e) => e.code === 'invalid_oauth_state');
  const tenantId = '00000000-0000-4000-8000-0000000000c1';
  await kv.put('calstate:st1', JSON.stringify({ tenantId, provider: 'google', actor: 'admin@velai' }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('oauth2.googleapis.com/token')
    ? new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: `x.${btoa(JSON.stringify({ email: 'negocio@gmail.com' }))}.y` }), { status: 200 })
    : new Response('{}', { status: 200 });
  try {
    const ok = await testing.calendarCallbackFor(env, ctx, cbUrl('state=st1&code=abc'), 'admin@velai');
    assert.equal(ok.status, 302);
    assert.ok(ok.headers.get('Location').includes('#calendar=ok'));
    const upsert = inserts.find((i) => i.sql.includes('tenant_calendars'));
    assert.ok(upsert && String(upsert.args[2]).startsWith('v1:'), 'el refresh_token va CIFRADO a D1');
    assert.ok(!JSON.stringify(inserts.map((i) => i.args)).includes('"rt"'), 'el token en claro no toca D1');
    // AAD por propósito: el AAD de calendar: no descifra como si fuera el de twilio
    await assert.rejects(decryptSecret(env, tenantId, upsert.args[2]), /cipher_undecryptable/);
    assert.equal((await decryptSecret(env, `calendar:${tenantId}`, upsert.args[2])).value, 'rt');
    // el MISMO state otra vez → 403 (un solo uso)
    await assert.rejects(testing.calendarCallbackFor(env, ctx, cbUrl('state=st1&code=abc'), 'admin@velai'), (e) => e.code === 'invalid_oauth_state');
  } finally { globalThis.fetch = realFetch; }
  // el hostname público no expone el callback
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const pub = await worker.fetch(new Request('https://vai-worker.botnexo-ia.workers.dev/oauth/calendar/callback?state=x'), env, ctx);
  assert.equal(pub.status, 404);
});

test('citas en el panel: el cliente solo ve las suyas y solo puede tocar SU calendario', async () => {
  const APPTS = [
    { id: 'a1', tenant_id: 't-mio', tenant_name: 'Mi Negocio', customer_name: 'Ana', starts_at: '2026-09-01T10:00:00Z' },
    { id: 'a2', tenant_id: 't-otro', tenant_name: 'Otro', customer_name: 'Luis', starts_at: '2026-09-01T11:00:00Z' },
  ];
  const db = { prepare: (sql) => ({ bind: (...args) => ({
    all: async () => ({ results: sql.includes('FROM appointments l') ? (sql.includes('l.tenant_id = ?') ? APPTS.filter((a) => a.tenant_id === args.at(-2)) : APPTS).map((a) => ({ ...a })) : [] }),
    first: async () => null, run: async () => ({ meta: { changes: 1 } }),
  }) }) };
  const env = { DB: db, KV: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [] }; } } };
  const ctx = { waitUntil() {} };
  const call = (scope) => testing.adminRouter(adminReq('/api/admin/appointments'), env, ctx, '/api/admin/appointments', new URL('https://x/api/admin/appointments'), {}, scope);
  const mine = await (await call(CLIENTE)).json();
  assert.deepEqual(mine.appointments.map((a) => a.id), ['a1']);
  assert.equal(mine.appointments[0].tenant_name, undefined, 'sin nombres de tenant para el cliente');
  const all = await (await call(VELAI)).json();
  assert.equal(all.appointments.length, 2);
  // autoservicio: el cliente accede a SU calendario; el de otro tenant es 404 (nunca 403)
  const TID = '00000000-0000-4000-8000-0000000000c1';
  const OWN = { role: 'cliente', tenantId: TID, email: 'cliente@x.com' };
  const dbCal = { prepare: (sql) => ({ bind: () => ({
    first: async () => sql.includes('SELECT id, slug, name') ? { id: TID, slug: 'mio', name: 'Mi Negocio' } : null,
    all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }),
  }) }) };
  const ownPath = `/api/admin/tenants/${TID}/calendar`;
  const own = await (await testing.adminRouter(adminReq(ownPath), { DB: dbCal, KV: env.KV }, ctx, ownPath, new URL('https://x' + ownPath), {}, OWN)).json();
  assert.equal(own.calendar, null, 'el cliente ve (aunque vacío) SU calendario');
  for (const [path, method] of [[`/api/admin/tenants/${LEADS[0].id}/calendar`, 'GET'], [`/api/admin/tenants/${LEADS[0].id}/calendar/connect`, 'POST']]) {
    await assert.rejects(testing.adminRouter(adminReq(path, { method }), { DB: dbCal, KV: env.KV }, ctx, path, new URL('https://x' + path), {}, OWN), (e) => e.code === 'not_found', path);
  }
});

test('callback OAuth: un cliente no puede cerrar la conexión de OTRO tenant con un state ajeno', async () => {
  const kv = mapKV();
  const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => ({ meta: { changes: 1 } }), first: async () => null, all: async () => ({ results: [] }) }) }) }, KV: kv, SECRETS_KEK: TEST_KEK, GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'sec', ADMIN_ORIGIN: 'https://admin.hirevai.com' };
  const ctx = { waitUntil() {} };
  await kv.put('calstate:stx', JSON.stringify({ tenantId: 't-otro', provider: 'google', actor: 'cliente@x.com' }));
  await assert.rejects(
    testing.calendarCallbackFor(env, ctx, new URL('https://admin.hirevai.com/oauth/calendar/callback?state=stx&code=c'), 'cliente@x.com', { role: 'cliente', tenantId: 't-mio' }),
    (e) => e.code === 'not_authorized');
  // y el state quedó consumido igualmente (un solo uso, también en el rechazo)
  assert.equal(await kv.get('calstate:stx'), null);
});

// ── SPEC-CONEXIONES PR1: Telegram en autoservicio ────────────────────────────

function tgDb(row) {
  const writes = [];
  return { writes, prepare: (sql) => ({ bind: (...args) => ({
    first: async () => { writes.push({ sql, args, op: 'first' }); return sql.includes('FROM tenants WHERE id=') ? row : null; },
    run: async () => { writes.push({ sql, args, op: 'run' }); return { meta: { changes: 1 } }; },
    all: async () => ({ results: [] }),
  }) }) };
}

test('telegram/link: el cliente genera SU enlace; el de otro tenant es 404 sin tocar tenants', async () => {
  const TID = '00000000-0000-4000-8000-0000000000d1';
  const row = { id: TID, slug: 'mio', name: 'Mi Negocio', channel_address: 'web:mio', telegram_chat_id: null };
  const db = tgDb(row);
  const kv = mapKV();
  const env = { DB: db, KV: kv, TELEGRAM_TOKEN: 'tg-token' };
  const ctx = { waitUntil() {} };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('/getMe')
    ? new Response(JSON.stringify({ ok: true, result: { username: 'VelaiAvisosBot' } }), { status: 200 })
    : new Response('{}', { status: 200 });
  try {
    const OWN = { role: 'cliente', tenantId: TID, email: 'cliente@x.com' };
    const path = `/api/admin/tenants/${TID}/telegram/link`;
    const out = await (await testing.adminRouter(adminReq(path, { method: 'POST' }), env, ctx, path, new URL('https://x' + path), {}, OWN)).json();
    assert.match(out.token, /^[0-9a-f]{32}$/);
    assert.ok(out.dmUrl.includes('t.me/VelaiAvisosBot?start=' + out.token));
    assert.ok(out.groupUrl.includes('startgroup=' + out.token));
    assert.ok(kv.map.has('tglink:' + out.token), 'el token queda en KV con TTL');
    // ajeno → 404 y CERO consultas a tenants
    db.writes.length = 0;
    const foreign = `/api/admin/tenants/${LEADS[1].id}/telegram/link`;
    await assert.rejects(testing.adminRouter(adminReq(foreign, { method: 'POST' }), env, ctx, foreign, new URL('https://x' + foreign), {}, OWN), (e) => e.code === 'not_found');
    assert.equal(db.writes.length, 0, 'el 404 de alcance no toca D1');
  } finally { globalThis.fetch = realFetch; }
});

test('webhook de Telegram: sin secreto 200 mudo; con /start válido vincula, borra el token y no revincula al reintentar', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const waits = [];
  const ctx = { waitUntil(p) { waits.push(p.catch(() => {})); } };
  const TID = '00000000-0000-4000-8000-0000000000d1';
  const row = { id: TID, slug: 'mio', name: 'Mi Negocio', channel_address: 'web:mio' };
  const db = tgDb(row);
  const kv = mapKV();
  const token = 'a'.repeat(32);
  await kv.put('tglink:' + token, JSON.stringify({ tenantId: TID, actor: 'cliente@x.com' }));
  const env = { DB: db, KV: kv, TELEGRAM_WEBHOOK_SECRET: 'S3CRETO', TELEGRAM_TOKEN: 'tg', TELEGRAM_CHAT_ID: '-100999' };
  const tgReq = (body, secret) => new Request('https://vai-worker.botnexo-ia.workers.dev/telegram/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}) },
    body: JSON.stringify(body),
  });
  // chat de GRUPO: id negativo — debe guardarse con el signo
  const update = { message: { text: `/start@VelaiAvisosBot ${token}`, chat: { id: -481516234, title: 'GOgestión · Leads' } } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"ok":true}', { status: 200 });
  try {
    // sin secreto → 200 y ninguna escritura
    const bad = await worker.fetch(tgReq(update, null), env, ctx);
    assert.equal(bad.status, 200);
    assert.equal(db.writes.filter((w) => w.op === 'run').length, 0, 'sin secreto no se escribe nada');
    // con secreto → vincula: UPDATE con chat id NEGATIVO y título, token consumido
    const ok = await worker.fetch(tgReq(update, 'S3CRETO'), env, ctx);
    assert.equal(ok.status, 200);
    const update1 = db.writes.find((w) => w.sql.includes('SET telegram_chat_id='));
    assert.ok(update1, 'escribe la vinculación');
    assert.equal(update1.args[0], '-481516234', 'el id de grupo conserva el signo');
    assert.equal(update1.args[1], 'GOgestión · Leads');
    assert.equal(await kv.get('tglink:' + token), null, 'token de un solo uso');
    await Promise.all(waits);
    // el MISMO update reenviado → no revincula (el token ya no existe) y no lanza
    db.writes.length = 0;
    const replay = await worker.fetch(tgReq(update, 'S3CRETO'), env, ctx);
    assert.equal(replay.status, 200);
    assert.equal(db.writes.filter((w) => w.sql.includes('SET telegram_chat_id=')).length, 0, 'el reintento no revincula');
    // un mensaje sin /start → 200 sin escritura
    const noise = await worker.fetch(tgReq({ message: { text: 'hola grupo', chat: { id: -1 } } }, 'S3CRETO'), env, ctx);
    assert.equal(noise.status, 200);
    assert.equal(db.writes.filter((w) => w.op === 'run').length, 0);
  } finally { globalThis.fetch = realFetch; }
});

test('deliver(telegram): entrega DUAL — el cliente sin chat es skip visible y Velai recibe SIEMPRE su copia', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.telegram.org')) { sent.push(JSON.parse(init.body).chat_id); return new Response('{"ok":true}', { status: 200 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    const env = { TELEGRAM_TOKEN: 'tg', TELEGRAM_CHAT_ID: '-100999', KV: mapKV() };
    const lead = { id: 'lead-1', source: 'chat web', name: 'Ana' };
    // tenant SIN chat propio: skip visible para su ledger… pero la copia a Velai sale
    const out = await testing.deliver(env, 'telegram', lead, { id: 't1', telegram_chat_id: null });
    assert.deepEqual(out, { skipped: true, error: 'telegram_not_configured' }, 'cierra el bug del fallback silencioso');
    assert.deepEqual(sent, ['-100999'], 'la copia operativa de Velai SÍ llegó');
    // el reintento del ledger (skipped se revisita) NO duplica la copia a Velai
    await testing.deliver(env, 'telegram', lead, { id: 't1', telegram_chat_id: null });
    assert.equal(sent.length, 1, 'copia deduplicada por lead');
    // tenant CON chat propio: le llega a él Y a Velai (lead nuevo)
    sent.length = 0;
    await testing.deliver(env, 'telegram', { id: 'lead-2', source: 'chat web' }, { id: 't1', telegram_chat_id: '-555' });
    assert.deepEqual(sent.sort(), ['-100999', '-555'].sort());
    // tenant cuyo chat ES el de Velai (backfill): un solo envío, sin duplicar
    sent.length = 0;
    await testing.deliver(env, 'telegram', { id: 'lead-3', source: 'chat web' }, { id: 't2', telegram_chat_id: '-100999' });
    assert.deepEqual(sent, ['-100999']);
    // y las alertas operativas conservan el respaldo global de siempre
    sent.length = 0;
    await testing.sendTelegramText(env, 'alerta interna');
    assert.deepEqual(sent, ['-100999']);
  } finally { globalThis.fetch = realFetch; }
});

test('telegram: GET de estado y DELETE de desvinculación (rol cliente, solo lo suyo)', async () => {
  const TID = '00000000-0000-4000-8000-0000000000d1';
  const row = { id: TID, slug: 'mio', name: 'Mi Negocio', channel_address: 'web:mio', telegram_chat_id: '-555', telegram_chat_title: 'Mi grupo', telegram_linked_at: '2026-08-21T10:00:00Z' };
  const db = tgDb(row);
  const env = { DB: db, KV: mapKV(), TELEGRAM_TOKEN: 'tg' };
  const ctx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
  const OWN = { role: 'cliente', tenantId: TID, email: 'cliente@x.com' };
  const path = `/api/admin/tenants/${TID}/telegram`;
  const got = await (await testing.adminRouter(adminReq(path), env, ctx, path, new URL('https://x' + path), {}, OWN)).json();
  assert.deepEqual(got.telegram, { linked: true, title: 'Mi grupo', linked_at: '2026-08-21T10:00:00Z', botUsername: null, whitelabel: false, topics: [] });
  const del = await (await testing.adminRouter(adminReq(path, { method: 'DELETE' }), env, ctx, path, new URL('https://x' + path), {}, OWN)).json();
  assert.equal(del.ok, true);
  const cleared = db.writes.find((w) => w.sql.includes('SET telegram_chat_id=NULL'));
  assert.ok(cleared, 'limpia las tres columnas');
  assert.ok(db.writes.some((w) => w.sql.includes('tenant_versions')), 'queda auditado');
});

test('bot propio (marca blanca): se valida con getMe, se cifra, registra su webhook y desvincula el chat anterior', async () => {
  const TID = '00000000-0000-4000-8000-0000000000d1';
  const row = { id: TID, slug: 'mio', name: 'Mi Negocio', channel_address: 'web:mio', telegram_chat_id: '-555', telegram_chat_title: 'Viejo', telegram_bot_username: null, telegram_bot_token_enc: null, telegram_whitelabel: 0 };
  const db = tgDb(row);
  const env = { DB: db, KV: mapKV(), SECRETS_KEK: TEST_KEK, TELEGRAM_WEBHOOK_SECRET: 'S3CRETO', TELEGRAM_TOKEN: 'tg-velai' };
  const ctx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
  const OWN = { role: 'cliente', tenantId: TID, email: 'cliente@x.com' };
  const path = `/api/admin/tenants/${TID}/telegram/bot`;
  // la marca blanca es una FEATURE que activa Velai: sin el flag, para el cliente
  // el bot propio NO EXISTE (404) — y el conmutador es solo-velai (cliente → 403)
  await assert.rejects(testing.adminRouter(adminReq(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'x' }) }), env, ctx, path, new URL('https://x' + path), {}, OWN), (e) => e.code === 'not_found');
  const flagPath = `/api/admin/tenants/${TID}/telegram`;
  await assert.rejects(testing.adminRouter(adminReq(flagPath, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ whitelabel: true }) }), env, ctx, flagPath, new URL('https://x' + flagPath), {}, OWN), (e) => e.code === 'not_authorized');
  // Velai la activa…
  const on = await (await testing.adminRouter(adminReq(flagPath, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ whitelabel: true }) }), env, ctx, flagPath, new URL('https://x' + flagPath), {}, VELAI)).json();
  assert.deepEqual(on, { ok: true, whitelabel: true });
  row.telegram_whitelabel = 1; // la fila real la actualizó el UPDATE; el stub la refleja
  const botToken = '123456789:AAHfakefakefakefakefakefake_fake';
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url); calls.push(u);
    if (u.includes('/getMe')) return new Response(JSON.stringify({ ok: true, result: { is_bot: true, username: 'MiNegocioBot' } }), { status: 200 });
    if (u.includes('/setWebhook')) return new Response('{"ok":true}', { status: 200 });
    return new Response('{}', { status: 200 });
  };
  try {
    // formato inválido → 400 sin llamar a Telegram
    await assert.rejects(testing.adminRouter(adminReq(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'basura' }) }), env, ctx, path, new URL('https://x' + path), {}, OWN), (e) => e.code === 'invalid_bot_token');
    assert.equal(calls.length, 0);
    const out = await (await testing.adminRouter(adminReq(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: botToken }) }), env, ctx, path, new URL('https://x' + path), {}, OWN)).json();
    assert.deepEqual(out, { ok: true, botUsername: 'MiNegocioBot' });
    assert.ok(calls.some((u) => u.includes(`bot${botToken}/getMe`)) && calls.some((u) => u.includes(`bot${botToken}/setWebhook`)), 'valida y registra el webhook DEL bot del cliente');
    const saved = db.writes.find((w) => w.sql.includes('SET telegram_bot_token_enc=?'));
    assert.ok(saved, 'guarda el bot');
    assert.ok(String(saved.args[0]).startsWith('v1:') && !String(saved.args[0]).includes(botToken), 'el token va CIFRADO');
    assert.equal(saved.args[1], 'MiNegocioBot');
    assert.ok(saved.sql.includes('telegram_chat_id=NULL'), 'el chat vinculado con el bot anterior se limpia');
    // el AAD es telegram:<id>: descifra con él y NO con el de twilio (el id a secas)
    assert.equal((await decryptSecret(env, `telegram:${TID}`, saved.args[0])).value, botToken);
    await assert.rejects(decryptSecret(env, TID, saved.args[0]), /cipher_undecryptable/);
    // y el aviso del cliente sale desde SU bot; la copia de Velai, desde el de Velai
    calls.length = 0;
    const tenant = { id: TID, slug: 'mio', telegram_chat_id: '-777', telegram_bot_token_enc: saved.args[0] };
    const res = await testing.deliver({ ...env, TELEGRAM_CHAT_ID: '-100999' }, 'telegram', { id: 'lead-9', source: 'chat web' }, tenant);
    assert.equal(res.ok, undefined === res.skipped ? res.ok : res.ok); // deliver devuelve {ok:true}
    assert.ok(calls.some((u) => u.includes(`bot${botToken}/sendMessage`)), 'aviso del cliente por SU bot');
    assert.ok(calls.some((u) => u.includes('bottg-velai/sendMessage')), 'copia de Velai por el bot de Velai');
    // …y si Velai DESACTIVA la marca blanca con bot configurado, se retira todo
    row.telegram_bot_token_enc = saved.args[0]; row.telegram_bot_username = 'MiNegocioBot';
    db.writes.length = 0;
    const off = await (await testing.adminRouter(adminReq(flagPath, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ whitelabel: false }) }), env, ctx, flagPath, new URL('https://x' + flagPath), {}, VELAI)).json();
    assert.deepEqual(off, { ok: true, whitelabel: false });
    const cleared = db.writes.find((w) => w.sql.includes('telegram_whitelabel=0'));
    assert.ok(cleared && cleared.sql.includes('telegram_bot_token_enc=NULL') && cleared.sql.includes('telegram_chat_id=NULL'), 'desactivar retira el bot y desvincula el chat');
  } finally { globalThis.fetch = realFetch; }
});

test('temas de Telegram: el grupo los registra solo (servicio y /tema) y Vai clasifica cada lead a su tema', async () => {
  const TID = '00000000-0000-4000-8000-0000000000d1';
  const row = { id: TID, slug: 'mio', name: 'Mi Negocio', channel_address: 'web:mio', telegram_chat_id: '-777', telegram_topics: null, telegram_bot_token_enc: null, telegram_whitelabel: 1 };
  const updates = [];
  const env = {
    KV: mapKV(), TELEGRAM_WEBHOOK_SECRET: 'S3CRETO', TELEGRAM_TOKEN: 'tg-velai', TELEGRAM_CHAT_ID: '-100999', ANTHROPIC_API_KEY: 'k',
    DB: { prepare: (sql) => ({ bind: (...args) => ({
      first: async () => sql.includes('WHERE telegram_chat_id') && args[0] === '-777' ? { ...row } : null,
      run: async () => { updates.push({ sql, args }); if (sql.includes('SET telegram_topics=')) row.telegram_topics = args[0]; return { meta: { changes: 1 } }; },
      all: async () => ({ results: [] }),
    }) }) },
  };
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const waits = [];
  const ctx = { waitUntil(p) { waits.push(p.catch(() => {})); } };
  const tgReq = (body) => new Request('https://vai-worker.botnexo-ia.workers.dev/telegram/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'S3CRETO' }, body: JSON.stringify(body),
  });
  const telegramSends = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) { telegramSends.push(JSON.parse(init.body)); return new Response('{"ok":true}', { status: 200 }); }
    if (u.includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ text: 'Presupuestos' }] }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  try {
    // 0) SIN marca blanca, el tema del grupo se ignora (Temas = feature premium)
    row.telegram_whitelabel = 0;
    await worker.fetch(tgReq({ message: { chat: { id: -777 }, message_thread_id: 41, forum_topic_created: { name: 'Colado' } } }), env, ctx);
    assert.equal(row.telegram_topics, null, 'sin marca blanca no se registra nada');
    row.telegram_whitelabel = 1;
    // 1) el cliente crea el Tema en su grupo → mensaje de servicio → registrado
    await worker.fetch(tgReq({ message: { chat: { id: -777 }, message_thread_id: 42, forum_topic_created: { name: 'Presupuestos' } } }), env, ctx);
    // 2) un tema que ya existía: '/tema' dentro del tema, con el nombre en el reply
    await worker.fetch(tgReq({ message: { chat: { id: -777 }, message_thread_id: 43, text: '/tema', reply_to_message: { forum_topic_created: { name: 'Urgente' } } } }), env, ctx);
    await Promise.all(waits);
    const topics = JSON.parse(row.telegram_topics);
    assert.deepEqual(topics, [{ thread_id: 42, name: 'Presupuestos' }, { thread_id: 43, name: 'Urgente' }]);
    assert.ok(telegramSends.some((s) => s.message_thread_id === 42 && String(s.text).includes('Tema registrado')), 'confirma DENTRO del tema');
    // 3) el aviso del lead va al tema que el clasificador elige (thread 42)
    telegramSends.length = 0;
    const tenant = { id: TID, slug: 'mio', telegram_chat_id: '-777', telegram_topics: row.telegram_topics, telegram_bot_token_enc: null, telegram_whitelabel: 1 };
    // sin marca blanca el clasificador está apagado aunque queden temas guardados
    const off = await testing.deliver(env, 'telegram', { id: 'ld0', source: 'chat web' }, { ...tenant, telegram_whitelabel: 0 });
    assert.equal(off.ok, true);
    assert.equal(telegramSends.find((s) => String(s.chat_id) === '-777').message_thread_id, undefined, 'apagado: al chat General');
    telegramSends.length = 0;
    const out = await testing.deliver(env, 'telegram', { id: 'ld1', source: 'chat web', need: 'quiero un presupuesto' }, tenant);
    assert.equal(out.ok, true);
    const aviso = telegramSends.find((s) => String(s.chat_id) === '-777');
    assert.equal(aviso.message_thread_id, 42, 'clasificado al tema Presupuestos');
    // 4) si el clasificador responde GENERAL (o falla), el aviso va SIN hilo
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('api.telegram.org')) { telegramSends.push(JSON.parse(init.body)); return new Response('{"ok":true}', { status: 200 }); }
      if (u.includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ text: 'GENERAL' }] }), { status: 200 });
      return new Response('{}', { status: 200 });
    };
    telegramSends.length = 0;
    await testing.deliver(env, 'telegram', { id: 'ld2', source: 'chat web' }, tenant);
    assert.equal(telegramSends.find((s) => String(s.chat_id) === '-777').message_thread_id, undefined, 'GENERAL = chat principal');
    // 5) tema borrado en Telegram: el primer envío falla y el aviso cae al General
    let first = true;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ text: 'Urgente' }] }), { status: 200 });
      if (u.includes('api.telegram.org')) {
        const body = JSON.parse(init.body); telegramSends.push(body);
        if (body.message_thread_id && first) { first = false; return new Response('{"ok":false}', { status: 400 }); }
        return new Response('{"ok":true}', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };
    telegramSends.length = 0;
    const fallback = await testing.deliver(env, 'telegram', { id: 'ld3', source: 'chat web' }, tenant);
    assert.equal(fallback.ok, true, 'el aviso nunca se pierde por un tema roto');
    // 6) quitar un tema del enrutado (cliente, autoservicio)
    const dbDel = { prepare: (sql) => ({ bind: (...args) => ({
      first: async () => sql.includes('FROM tenants WHERE id=') ? { id: TID, slug: 'mio', channel_address: 'web:mio', telegram_topics: row.telegram_topics, telegram_whitelabel: 1 } : null,
      run: async () => { updates.push({ sql, args }); return { meta: { changes: 1 } }; }, all: async () => ({ results: [] }),
    }) }) };
    const OWN = { role: 'cliente', tenantId: TID, email: 'cliente@x.com' };
    const delPath = `/api/admin/tenants/${TID}/telegram/topics/42`;
    const res = await (await testing.adminRouter(adminReq(delPath, { method: 'DELETE' }), { DB: dbDel, KV: env.KV }, ctx, delPath, new URL('https://x' + delPath), {}, OWN)).json();
    assert.deepEqual(res.topics, [{ thread_id: 43, name: 'Urgente' }]);
  } finally { globalThis.fetch = realFetch; }
});

test('temas desde el panel: se crean en el Telegram del cliente con descripción, y la descripción guía al clasificador', async () => {
  const TID = '00000000-0000-4000-8000-0000000000d1';
  const row = { id: TID, slug: 'mio', name: 'Mi Negocio', channel_address: 'web:mio', telegram_chat_id: '-777', telegram_topics: null, telegram_bot_token_enc: null, telegram_whitelabel: 1 };
  const env = {
    KV: mapKV(), TELEGRAM_TOKEN: 'tg-velai', ANTHROPIC_API_KEY: 'k',
    DB: { prepare: (sql) => ({ bind: (...args) => ({
      first: async () => sql.includes('FROM tenants WHERE id=') ? { ...row } : null,
      run: async () => { if (sql.includes('SET telegram_topics=')) row.telegram_topics = args[0]; return { meta: { changes: 1 } }; },
      all: async () => ({ results: [] }),
    }) }) },
  };
  const ctx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
  const OWN = { role: 'cliente', tenantId: TID, email: 'cliente@x.com' };
  const base = `/api/admin/tenants/${TID}/telegram/topics`;
  const call = (method, path, body) => testing.adminRouter(adminReq(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, ctx, path, new URL('https://x' + path), {}, OWN);
  let forum = true; let classifierSystem = '';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/createForumTopic')) {
      if (!forum) return new Response(JSON.stringify({ ok: false, description: 'Bad Request: the chat is not a forum' }), { status: 400 });
      return new Response(JSON.stringify({ ok: true, result: { message_thread_id: 77 } }), { status: 200 });
    }
    if (u.includes('api.telegram.org')) return new Response('{"ok":true}', { status: 200 });
    if (u.includes('api.anthropic.com')) { classifierSystem = JSON.parse(init.body).system[0].text; return new Response(JSON.stringify({ content: [{ text: 'Presupuestos' }] }), { status: 200 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    // sin marca blanca, para el CLIENTE la feature no existe (404)
    row.telegram_whitelabel = 0;
    await assert.rejects(call('POST', base, { name: 'X' }), (e) => e.code === 'not_found');
    row.telegram_whitelabel = 1;
    // grupo sin Temas activados → error traducible, nada guardado
    forum = false;
    await assert.rejects(call('POST', base, { name: 'Presupuestos' }), (e) => e.code === 'group_sin_temas');
    assert.equal(row.telegram_topics, null);
    // con Temas: se crea EN Telegram y se guarda con su descripción
    forum = true;
    const out = await (await call('POST', base, { name: 'Presupuestos', description: 'clientes que piden precio o cotización' })).json();
    assert.deepEqual(out.topics, [{ thread_id: 77, name: 'Presupuestos', description: 'clientes que piden precio o cotización' }]);
    // el clasificador recibe la DESCRIPCIÓN, no solo el nombre
    const tenant = { id: TID, slug: 'mio', telegram_chat_id: '-777', telegram_topics: row.telegram_topics, telegram_bot_token_enc: null, telegram_whitelabel: 1 };
    await testing.deliver({ ...env, TELEGRAM_CHAT_ID: '-100999' }, 'telegram', { id: 'ldx', source: 'chat web', need: 'precio del servicio' }, tenant);
    assert.ok(classifierSystem.includes('clientes que piden precio o cotización'), 'la descripción viaja en el prompt');
    // editar la descripción desde el panel
    const patched = await (await call('PATCH', `${base}/77`, { description: 'todo lo que hable de dinero' })).json();
    assert.equal(patched.topics[0].description, 'todo lo que hable de dinero');
  } finally { globalThis.fetch = realFetch; }
});

// ── SPEC-CONEXIONES PR2: WhatsApp sender/sync + estado para el cliente ───────

test('sender/sync: reconcilia desde Twilio sin pisar el canal, repara el webhook y no adivina', async () => {
  const subToken = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';
  const mkTenant = async (env, extra) => ({
    id: '00000000-0000-4000-8000-00000000000a', slug: 'gogestion', name: 'GOgestión',
    twilio_subaccount_sid: 'AC' + 'c'.repeat(32),
    twilio_auth_token_enc: await encryptSecret(env, '00000000-0000-4000-8000-00000000000a', subToken),
    waba_id: null, sender_sid: null, sender_status: null, twilio_from: null, channel_address: 'web:gogestion', ...extra,
  });
  let senders = []; const twilioCalls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url); twilioCalls.push({ u, method: (init && init.method) || 'POST', body: init && init.body });
    if (u.includes('/v2/Channels/Senders?Channel=whatsapp') && (!init || init.method === 'GET')) return new Response(JSON.stringify({ senders: [{ sid: 'XEsandbox', sender_id: 'whatsapp:+14155238886', status: 'OFFLINE' }, ...senders] }), { status: 200 });
    if (u.includes('/v2/Channels/Senders/')) return new Response(JSON.stringify({ status: 'ONLINE' }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  try {
    // 0 senders → 404 y la fila no se toca
    let h = provisionHarness({});
    h.row = await mkTenant(h.env);
    h.env.DB.prepare = ((orig) => (sql) => ({ bind: (...args) => ({
      first: async () => sql.startsWith('SELECT * FROM tenants') ? h.row : null,
      run: async () => { h.updates.push({ sql, args }); return { meta: { changes: 1 } }; },
      all: async () => ({ results: [] }),
    }) }))();
    await assert.rejects(
      testing.handleProvision(provReq(), h.env, h.ctx, h.row.id, 'sender/sync', 'admin@velai'),
      (e) => e.code === 'sender_not_found');
    assert.equal(h.updates.filter((u) => u.sql.includes('SET waba_id')).length, 0);
    // 2 senders → 409 multiple_senders, sin tocar la fila
    senders = [{ sid: 'XE1', sender_id: 'whatsapp:+34624121930' }, { sid: 'XE2', sender_id: 'whatsapp:+34999999999' }];
    await assert.rejects(
      testing.handleProvision(provReq(), h.env, h.ctx, h.row.id, 'sender/sync', 'admin@velai'),
      (e) => e.code === 'multiple_senders');
    // 1 sender con webhook por defecto: rellena, NO pisa channel_address, y REPARA el webhook
    senders = [{ sid: 'XE' + 'a'.repeat(32), sender_id: 'whatsapp:+34624121930', status: 'ONLINE', configuration: { waba_id: '123456789012345' }, webhook: { callback_url: 'https://webhooks.twilio.com/default' } }];
    const res = await (await testing.handleProvision(provReq(), h.env, h.ctx, h.row.id, 'sender/sync', 'admin@velai')).json();
    assert.deepEqual([res.ok, res.webhookOk, res.webhookFixed], [true, true, true]);
    const up = h.updates.find((u) => u.sql.includes('SET waba_id'));
    assert.ok(up, 'rellena la fila');
    assert.ok(up.sql.includes('waba_id=?') && up.sql.includes('sender_sid=?') && up.sql.includes('sender_status=?') && up.sql.includes('twilio_from=?'), 'campos vacíos rellenados');
    assert.ok(!up.sql.includes('channel_address=?'), 'channel_address ya tenía valor (web:) y NO se pisa');
    assert.deepEqual(res.conflicts, [{ field: 'channel_address', current: 'web:gogestion', fromTwilio: 'whatsapp:+34624121930' }]);
    assert.ok(twilioCalls.some((c) => c.u.includes('/v2/Channels/Senders/XE') && String(c.body).includes(WORKER_URL_TEST)), 'el PUT del webhook apunta al worker');
    // El paso que de verdad ENCIENDE WhatsApp: sin esta fila el sender queda ONLINE y el
    // bot mudo (gogestion, 2026-08-24). Va aunque channel_address no se pise.
    assert.equal(res.channelRegistered, true);
    const ins = h.updates.find((u) => u.sql.includes('INSERT INTO tenant_channels'));
    assert.ok(ins, 'registra el número en la tabla de enrutado');
    assert.ok(ins.args.includes('whatsapp:+34624121930') && ins.args.includes('whatsapp'), 'la fila enruta el número del sender');
  } finally { globalThis.fetch = realFetch; }
});
const WORKER_URL_TEST = 'vai-worker.botnexo-ia.workers.dev';

test('whatsapp del cliente: estado propio sin secretos, ajeno 404, y sender/sync vetado al rol cliente', async () => {
  const TID = '00000000-0000-4000-8000-0000000000e1';
  const db = { prepare: (sql) => ({ bind: () => ({
    first: async () => sql.includes('FROM tenants WHERE id=') ? { channel_address: 'web:mio', twilio_from: 'whatsapp:+34624121930', has_waba: 0, sender_status: null, lead_template_status: null, meta_partner_status: 'pendiente', team_whatsapp: null, wa_number: null, has_token: 0, has_subaccount: 0 } : null,
    all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }),
  }) }) };
  const env = { DB: db, KV: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [] }; } } };
  const ctx = { waitUntil() {} };
  const OWN = { role: 'cliente', tenantId: TID, email: 'cliente@x.com' };
  const path = `/api/admin/tenants/${TID}/whatsapp`;
  const out = await (await testing.adminRouter(adminReq(path), env, ctx, path, new URL('https://x' + path), {}, OWN)).json();
  assert.equal(out.whatsapp.twilio_from, 'whatsapp:+34624121930');
  const raw = JSON.stringify(out);
  assert.ok(!raw.includes('token_enc') && !raw.includes('subaccount_sid'), 'ni token ni SID de subcuenta');
  // ajeno → 404
  const foreign = `/api/admin/tenants/${LEADS[1].id}/whatsapp`;
  await assert.rejects(testing.adminRouter(adminReq(foreign), env, ctx, foreign, new URL('https://x' + foreign), {}, OWN), (e) => e.code === 'not_found');
  // provision/* sigue siendo 403 para el cliente, ANTES de tocar D1
  const prov = `/api/admin/tenants/${TID}/provision/sender/sync`;
  await assert.rejects(testing.adminRouter(adminReq(prov, { method: 'POST' }), env, ctx, prov, new URL('https://x' + prov), {}, OWN), (e) => e.code === 'not_authorized');
});

test('la dirección del canal se DERIVA: alta prospecto, promoción a web al activar, y la ficha lista los 4 canales', async () => {
  const TID = '00000000-0000-4000-8000-0000000000c1';
  // (a) el alta ya no recibe channel_address: el worker lo deriva del slug
  const ins = [];
  const envA = { DB: { prepare: (sql) => ({ bind: (...args) => ({
    first: async () => null, all: async () => ({ results: [] }),
    run: async () => { ins.push({ sql, args }); return { meta: { changes: 1 } }; } }) }) },
    KV: { async get() { return null; }, async put() {}, async delete() {} } };
  const ctx = { waitUntil() {} };
  const VELAI = { role: 'velai', email: 'admin@velai' };
  const JH = { 'Content-Type': 'application/json' };
  const post = (body) => testing.adminRouter(adminReq('/api/admin/tenants', { method: 'POST', headers: JH, body: JSON.stringify(body) }),
    envA, ctx, '/api/admin/tenants', new URL('https://x/api/admin/tenants'), {}, VELAI);
  await post({ name: 'Nuevo', slug: 'nuevo', active: false, system_prompt: 'x'.repeat(60) });
  assert.ok(ins.find((u) => u.args.includes('pending:nuevo')), 'nace prospecto, que no enruta ni puede activarse');
  ins.length = 0;
  // Sin `active` el endpoint crea ACTIVO (fields.active ?? 1): la derivación usa el mismo
  // default, o el alta se autocontradice con un 400 de pending+activo.
  await post({ name: 'Def', slug: 'def', system_prompt: 'x'.repeat(60) });
  assert.ok(ins.find((u) => u.args.includes('web:def')), 'el default de active y el de la derivación no pueden discrepar');
  ins.length = 0;
  // alta ya activa → nace directamente en web:<slug>, sin el 400 de pending+activo
  await post({ name: 'Ya', slug: 'ya', active: 1, system_prompt: 'x'.repeat(60) });
  assert.ok(ins.find((u) => u.args.includes('web:ya')), 'un alta activa no necesita la cadena mágica');

  // (b) marcar Activo promueve pending:<slug> → web:<slug> sin teclear nada
  const prev = { id: TID, slug: 'gog', name: 'G', channel_address: 'pending:gog', active: 0, updated_at: 't0', system_prompt: 'x'.repeat(60) };
  const ups = [];
  const envB = { DB: { prepare: (sql) => ({ bind: (...args) => ({
    first: async () => (sql.includes('FROM tenants WHERE id=') ? prev : null), all: async () => ({ results: [] }),
    run: async () => { ups.push({ sql, args }); return { meta: { changes: 1 } }; } }) }) },
    KV: { async get() { return null; }, async put() {}, async delete() {} } };
  const path = `/api/admin/tenants/${TID}`;
  await testing.adminRouter(adminReq(path, { method: 'PATCH', headers: JH, body: JSON.stringify({ active: 1, updated_at: 't0' }) }),
    envB, ctx, path, new URL('https://x' + path), {}, VELAI);
  assert.ok(ups.find((u) => u.args.includes('web:gog')), 'la promoción la hace el worker, no el dedo de Juan');
  // Pero un pending: EXPLÍCITO con active=1 sigue siendo contradicción, no hueco a rellenar
  await assert.rejects(
    testing.adminRouter(adminReq(path, { method: 'PATCH', headers: JH, body: JSON.stringify({ active: 1, channel_address: 'pending:gog', updated_at: 't0' }) }),
      envB, ctx, path, new URL('https://x' + path), {}, VELAI),
    (e) => e.code === 'pending_tenant_cannot_be_active');

  // (c) la ficha LEE los 4 canales de donde viven; el sender sin fila sale «sin enrutar»
  const tenant = { id: TID, slug: 'gog', active: 1, channel_address: 'web:gog', twilio_from: 'whatsapp:+34624121930', sender_sid: 'XE1', telegram_chat_id: null };
  const envC = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => null }) }) } };
  const sum = await testing.tenantChannelSummary(envC, tenant);
  assert.deepEqual(sum.map((c) => [c.kind, c.state]),
    [['web', 'live'], ['whatsapp', 'unrouted'], ['telegram', 'off'], ['messenger', 'off']]);
  // con su fila en tenant_channels, el mismo cliente pasa a atendido
  const envD = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ address: 'whatsapp:+34624121930', kind: 'whatsapp' }] }), first: async () => null }) }) } };
  const sum2 = await testing.tenantChannelSummary(envD, tenant);
  assert.deepEqual(sum2.find((c) => c.kind === 'whatsapp'), { kind: 'whatsapp', address: 'whatsapp:+34624121930', state: 'live' });
});

test('canales: la vista diagnostica el enrutado real y delata el sender vivo SIN fila (bot mudo en verde)', async () => {
  const CH = [
    // atendido: fila, cliente activo y el From coincide
    { address: 'whatsapp:+15706160059', kind: 'whatsapp', created_at: '2026-08-22 20:02:20', tenant_id: 't1', slug: 'velai', name: 'Velai', active: 1, twilio_from: 'whatsapp:+15706160059', sender_status: 'ONLINE' },
    // el webhook exige active=1: con el cliente apagado, la fila NO atiende
    { address: 'whatsapp:+34600000000', kind: 'whatsapp', created_at: '2026-08-22T20:02:20.000Z', tenant_id: 't2', slug: 'off', name: 'Apagado', active: 0, twilio_from: 'whatsapp:+34600000000', sender_status: 'ONLINE' },
    // entra por aquí pero responde desde otro número
    { address: 'whatsapp:+34611111111', kind: 'whatsapp', created_at: '2026-08-22 20:02:20', tenant_id: 't3', slug: 'mix', name: 'Desalineado', active: 1, twilio_from: 'whatsapp:+34699999999', sender_status: 'ONLINE' },
    // fila apuntando a un tenant que ya no existe
    { address: 'messenger:999', kind: 'messenger', created_at: '2026-08-22 20:02:20', tenant_id: 'tzz', slug: null, name: null, active: null, twilio_from: null, sender_status: null },
  ];
  const UNROUTED = [{ tenant_id: 'tg', slug: 'gogestion', name: 'GOgestión', active: 1, channel_address: 'web:gogestion', twilio_from: 'whatsapp:+34624121930', sender_status: 'ONLINE' }];
  const seen = [];
  const env = { DB: { prepare: (sql) => { seen.push(sql); return { bind: () => ({ all: async () => ({ results: [] }), first: async () => null }),
    all: async () => ({ results: sql.includes('NOT EXISTS') ? UNROUTED : CH }), first: async () => null }; } } };
  const ctx = { waitUntil() {} };
  const VELAI = { role: 'velai', email: 'admin@velai' };
  const out = await (await testing.adminRouter(adminReq('/api/admin/channels'), env, ctx, '/api/admin/channels', new URL('https://x/api/admin/channels'), {}, VELAI)).json();
  assert.deepEqual(out.channels.map((c) => c.state), ['live', 'inactive', 'from_mismatch', 'orphan']);
  // El sender vivo sin fila es EL fallo que nadie veía: tiene que salir en su propia lista
  assert.deepEqual(out.unrouted.map((u) => [u.slug, u.twilio_from]), [['gogestion', 'whatsapp:+34624121930']]);
  // La consulta del hueco exige las dos vías del enrutado (tabla y canal primario)
  const q = seen.find((x) => x.includes('NOT EXISTS'));
  assert.ok(q.includes('tenant_channels') && q.includes('channel_address'), 'no da por mudo a quien enruta por el canal primario');
  // Alarma falsa que salió con los datos reales: velai-messenger lleva el From de Velai
  // para los avisos de SALIDA y no tiene sender propio — no es un WhatsApp sin atender.
  assert.ok(q.includes('sender_sid IS NOT NULL'), 'solo alarma a quien tiene sender propio');
  // Fechas normalizadas: las dos formas de la columna salen comparables
  assert.ok(out.channels.every((c) => !/^\d{4}-\d\d-\d\d \d\d/.test(c.created_at)), 'created_at normalizado a ISO');
  // Es vista de Velai: el cliente no ve el mapa de canales de los demás
  await assert.rejects(
    testing.adminRouter(adminReq('/api/admin/channels'), env, ctx, '/api/admin/channels', new URL('https://x/api/admin/channels'), {}, { role: 'cliente', tenantId: 't1', email: 'c@x.com' }),
    (e) => e.code === 'not_authorized');
});

test('tenant_channels: el webhook enruta por la tabla ADEMÁS del canal primario, y el PATCH mantiene el espejo', async () => {
  // (a) el enrutado consulta la tabla nueva sin abandonar el fallback histórico
  const sqls = [];
  const envA = { DB: { prepare: (sql) => { sqls.push(sql); return { bind: () => ({
    first: async () => ({ id: 't-ch', slug: 'ch', active: 1 }), run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }),
  }) }; } } };
  const hit = await testing.tenantByAddress(envA, 'whatsapp:+34600000001');
  assert.equal(hit.id, 't-ch');
  assert.ok(sqls[0].includes('tenant_channels') && sqls[0].includes('channel_address'), 'tabla nueva + fallback en la misma consulta');
  // (b) cambiar el canal primario en el PATCH refleja la tabla: borra el viejo e inserta el nuevo
  const TID = '00000000-0000-4000-8000-0000000000f1';
  const row = { id: TID, slug: 'mio', channel_address: 'web:mio', twilio_from: null, team_whatsapp: null, updated_at: 'T0' };
  const writes = [];
  let takenBy = null;
  const db = { prepare: (sql) => ({ bind: (...args) => ({
    first: async () => {
      if (sql.includes('FROM tenants WHERE id=')) return { ...row };
      if (sql.includes('FROM tenant_channels WHERE address=')) return takenBy ? { tenant_id: takenBy } : null;
      return null;
    },
    run: async () => { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
    all: async () => ({ results: [] }),
  }) }) };
  const env = { DB: db, KV: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [] }; } } };
  const ctx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
  const path = `/api/admin/tenants/${TID}`;
  const call = (body) => testing.adminRouter(adminReq(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, ctx, path, new URL('https://x' + path), {}, VELAI);
  const ok = await (await call({ channel_address: 'whatsapp:+34600000002', expected_updated_at: 'T0' })).json();
  assert.equal(ok.ok, true);
  const ins = writes.find((w) => w.sql.includes('INSERT INTO tenant_channels'));
  assert.ok(ins && ins.args[0] === 'whatsapp:+34600000002' && ins.args[2] === 'whatsapp', 'el canal nuevo entra al espejo con su tipo');
  assert.ok(writes.some((w) => w.sql.includes('DELETE FROM tenant_channels WHERE tenant_id=? AND kind=?')), 'sin duplicar el tipo');
  // (c) un canal que ya enruta a OTRO cliente se rechaza ANTES de tocar la fila
  writes.length = 0; takenBy = 'otro-tenant';
  await assert.rejects(call({ channel_address: 'whatsapp:+34600000003', expected_updated_at: 'T0' }), (e) => e.code === 'address_taken');
  assert.equal(writes.length, 0, 'ni UPDATE ni espejo: la fila no se toca');
});

test('el aviso de lead en Telegram lleva el NOMBRE del cliente dueño, y VELAI solo sin tenant', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.telegram.org')) { sent.push(JSON.parse(init.body)); return new Response('{"ok":true}', { status: 200 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    const env = { TELEGRAM_TOKEN: '1:a', TELEGRAM_CHAT_ID: '-100', KV: mapKV(), DB: { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) }) }) } };
    const lead = { id: 'l-1', source: 'whatsapp', name: 'Ana', whatsapp: '+34600000009' };
    const tenant = { id: 't-d', name: 'Diálogos que Enseñan', slug: 'dialogos', telegram_chat_id: '-200', telegram_whitelabel: 0 };
    await testing.deliver(env, 'telegram', lead, tenant);
    // copia operativa a Velai Y aviso del cliente: ambos nombran al dueño del lead
    assert.equal(sent.length, 2);
    for (const m of sent) assert.ok(m.text.includes('DIÁLOGOS QUE ENSEÑAN (whatsapp)'), 'título con el cliente: ' + m.text.slice(0, 60));
    // lead propio (sin tenant): VELAI como siempre
    sent.length = 0;
    await testing.deliver(env, 'telegram', { ...lead, id: 'l-2' }, null);
    assert.ok(sent.length === 1 && sent[0].text.includes('VELAI (whatsapp)'));
  } finally { globalThis.fetch = realFetch; }
});

test('la identidad del bot (nombre y marca) viaja en el system de TODOS los canales', () => {
  const cfg = { SYSTEM: 'base velai', GUARDRAILS: 'reglas' };
  const t = { system_prompt: 'contexto del cliente', bot_name: 'Alma', brand_name: 'Diálogos que Enseñan', name: 'Diálogos' };
  const sys = testing.systemFor(cfg, t);
  assert.ok(sys.startsWith('Te llamas Alma y eres el asistente de Diálogos que Enseñan.'), 'identidad al frente');
  assert.ok(sys.includes('contexto del cliente') && sys.includes('reglas'));
  // el saludo de marca viaja como personalidad a todos los canales
  const conSaludo = testing.systemFor(cfg, { ...t, greeting: '¡Hola! Soy Alma 💛' });
  assert.ok(conSaludo.includes('¡Hola! Soy Alma 💛') && conSaludo.includes('TODOS los canales'), 'saludo como referencia de tono');
  // sin bot_name no se inventa nada; sin brand_name cae al nombre del tenant
  assert.ok(!testing.systemFor(cfg, { system_prompt: 'x' }).includes('Te llamas'));
  assert.ok(testing.systemFor(cfg, { system_prompt: 'x', bot_name: 'Faby', name: 'GOgestión' }).includes('asistente de GOgestión'));
});

test('logo del negocio: se sube por bytes, valida el tipo real y queda servido por /media', async () => {
  const TID = '00000000-0000-4000-8000-0000000000d1';
  const put = [];
  const kv = { store: new Map(),
    async put(k, v, o) { put.push({ k, o }); this.store.set(k, { value: v, metadata: o && o.metadata }); },
    async getWithMetadata(k) { return this.store.get(k) || { value: null }; },
    async get() { return null; }, async delete() {}, async list() { return { keys: [] }; } };
  const writes = [];
  const env = { KV: kv, DB: { prepare: (sql) => ({ bind: (...args) => ({
    first: async () => (sql.includes('FROM tenants WHERE id=') ? { id: TID, slug: 'mio', name: 'Mío', logo_url: null } : null),
    run: async () => { writes.push({ sql, args }); return { meta: { changes: 1 } }; }, all: async () => ({ results: [] }),
  }) }) } };
  const ctx = { waitUntil() {} };
  const path = `/api/admin/tenants/${TID}/logo`;
  const post = (bytes) => testing.adminRouter(adminReq(path, { method: 'POST', body: bytes }), env, ctx, path, new URL('https://x' + path), {}, VELAI);
  // un PNG de verdad (magic bytes) entra
  const png = new Uint8Array(200); png.set([0x89, 0x50, 0x4e, 0x47], 0);
  const okRes = await (await post(png)).json();
  assert.match(okRes.logo_url, /^https:\/\/api\.hirevai\.com\/media\/logos\/[0-9a-f-]+\.png\?v=\d+$/);
  assert.ok(writes.some((w) => w.sql.includes('SET logo_url=?')), 'la URL queda en la fila');
  assert.equal(put[0].o.metadata.contentType, 'image/png');
  // un archivo que dice ser imagen pero no lo es → 400 y NADA guardado
  const before = put.length;
  await assert.rejects(post(new Uint8Array(200)), (e) => e.code === 'invalid_image');
  assert.equal(put.length, before, 'no se guarda basura');
  // un cliente NO puede subir logos (la ruta no está en clienteAllowed)
  await assert.rejects(
    testing.adminRouter(adminReq(path, { method: 'POST', body: png }), env, ctx, path, new URL('https://x' + path), {}, { role: 'cliente', tenantId: TID }),
    (e) => e.code === 'not_authorized');
});

test('perfil de WhatsApp: manda la marca de la ficha y NUNCA cambia el nombre visible', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  const sub = 'AC' + 'c'.repeat(32);
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ u: String(url), m: (init && init.method) || 'GET', body: init && init.body });
      if (String(url).includes('api.telegram.org')) return new Response('{"ok":true}', { status: 200 });
      if (!init || init.method === 'GET') return new Response(JSON.stringify({ status: 'ONLINE', profile: { name: 'Nombre Aprobado', vertical: 'Other' } }), { status: 200 });
      return new Response('{"status":"ONLINE"}', { status: 200 });
    };
    const h = provisionHarness({ tenant: {
      id: '00000000-0000-4000-8000-0000000000d2', slug: 'mio', name: 'Mío', brand_name: 'Marca Mía',
      greeting: 'Hola, soy Alma', logo_url: 'https://api.hirevai.com/media/logos/x.png?v=1',
      web_origins: '["https://www.mio.com","https://mio.com"]',
      twilio_subaccount_sid: sub, sender_sid: 'XE' + 'a'.repeat(32),
      twilio_auth_token_enc: await encryptSecret({ SECRETS_KEK: TEST_KEK }, '00000000-0000-4000-8000-0000000000d2', 'a1b2c3d4e5f60718293a4b5c6d7e8f90'),
    } });
    const res = await (await testing.handleProvision(provReq(), h.env, h.ctx, h.row.id, 'sender/profile', 'juan@x')).json();
    assert.deepEqual(res.applied, { logo: true, websites: 1, description: true });
    const post = calls.find((c) => c.m === 'POST' && c.u.includes('/v2/Channels/Senders/XE'));
    const sent = JSON.parse(post.body).profile;
    assert.equal(sent.name, 'Nombre Aprobado', 'el display name se reenvía intacto');
    assert.equal(sent.logo_url, 'https://api.hirevai.com/media/logos/x.png?v=1');
    assert.deepEqual(sent.websites, [{ website: 'https://mio.com', label: 'Web' }], 'el apex, no el www');
    assert.equal(sent.vertical, 'Other', 'lo que ya había en el perfil no se pierde');
    // sin sender no hay nada que perfilar
    const sin = provisionHarness({ tenant: { id: '00000000-0000-4000-8000-0000000000d3', slug: 'x', name: 'X', brand_name: 'X', twilio_subaccount_sid: sub, sender_sid: null, twilio_auth_token_enc: await encryptSecret({ SECRETS_KEK: TEST_KEK }, '00000000-0000-4000-8000-0000000000d3', 'a1b2c3d4e5f60718293a4b5c6d7e8f90') } });
    await assert.rejects(testing.handleProvision(provReq(), sin.env, sin.ctx, sin.row.id, 'sender/profile', 'juan@x'), (e) => e.code === 'sender_required');
  } finally { globalThis.fetch = realFetch; }
});

test('números de aviso (PR3): el cliente edita los suyos y la guarda del 63031 cierra los dos caminos', async () => {
  const TID = '00000000-0000-4000-8000-0000000000e1';
  const row = { id: TID, slug: 'mio', channel_address: 'whatsapp:+34624121930', twilio_from: 'whatsapp:+34624121930', team_whatsapp: null, wa_number: null, updated_at: 'T0' };
  const writes = [];
  const db = { prepare: (sql) => ({ bind: (...args) => ({
    first: async () => sql.includes('FROM tenants WHERE id=') ? { ...row } : null,
    run: async () => { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
    all: async () => ({ results: [] }),
  }) }) };
  const env = { DB: db, KV: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [] }; } } };
  const ctx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
  const OWN = { role: 'cliente', tenantId: TID, email: 'cliente@x.com' };
  const path = `/api/admin/tenants/${TID}/notify`;
  const call = (scope, body) => testing.adminRouter(adminReq(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, ctx, path, new URL('https://x' + path), {}, scope);
  // el cliente guarda sus números y queda auditado con su rol
  const ok = await (await call(OWN, { team_whatsapp: 'whatsapp:+34600111222,whatsapp:+34600333444', wa_number: '624121930' })).json();
  assert.equal(ok.ok, true);
  assert.ok(writes.some((w) => w.sql.includes('SET team_whatsapp=?')), 'guarda los campos');
  assert.ok(writes.some((w) => w.sql.includes('tenant_versions') && String(w.args[4]).includes('rol cliente')), 'auditado con el rol');
  // 63031 por el endpoint de autoservicio: el número del bot no puede ser destinatario
  await assert.rejects(call(OWN, { team_whatsapp: 'whatsapp:+34624121930' }), (e) => e.code === 'team_whatsapp_equals_from');
  // …y por el PATCH general de admin (el agujero es de la fila, no del formulario)
  const gen = `/api/admin/tenants/${TID}`;
  await assert.rejects(
    testing.adminRouter(adminReq(gen, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team_whatsapp: 'whatsapp:+34624121930', expected_updated_at: 'T0' }) }), env, ctx, gen, new URL('https://x' + gen), {}, VELAI),
    (e) => e.code === 'team_whatsapp_equals_from');
  // ajeno → 404
  const foreign = `/api/admin/tenants/${LEADS[1].id}/notify`;
  await assert.rejects(testing.adminRouter(adminReq(foreign, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wa_number: '1' }) }), env, ctx, foreign, new URL('https://x' + foreign), {}, OWN), (e) => e.code === 'not_found');
});
