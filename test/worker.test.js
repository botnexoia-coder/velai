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
    DB: withConversations({ prepare: (sql) => ({ bind: (...args) => ({
      first: async () => sql.includes('channel_address') ? (tenants[args[0]] || null) : null,
      all: async () => ({ results: [] }), run: async () => {},
    }) }), batch: async () => [] }),
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
    // historiales namespaceados por tenant: mismo usuario final, DOS conversaciones
    // distintas en D1 (antes eran dos claves de KV — la memoria se mudó, el aislamiento no).
    assert.deepEqual(env.DB.convs.map((c) => `${c.tenant_id}|${c.external_id}`).sort(),
      ['t-dos|whatsapp:+34600000000', 't-uno|whatsapp:+34600000000']);
    assert.equal(new Set(env.DB.convs.map((c) => c.id)).size, 2, 'ids distintos: no comparten fila');
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
  for (const id of ['tName', 'tSlug', 'tChannels', 'tFrom', 'tTeam', 'tChat', 'tTpl', 'tSub', 'tWaba', 'tToken', 'tPartner', 'tActive', 'tPrompt', 'tNote', 'pSub', 'pTpl', 'pPhone', 'pSender', 'pCode', 'pVerify', 'pTplChk', 'pTplRe', 'tTplRaw', 'tenantFilter', 'newTenant', 'export', 'tTokenState', 'tBotName', 'tBrandName', 'tLogo', 'tColor1', 'tColor2', 'tGreeting', 'tGreetingEn', 'tChips', 'tPlaceholder', 'tWa', 'tTheme', 'brandPrev', 'toasts', 'tOrigins', 'tSyncDomains', 'logout', 'themeBtn', 'themeLabel', 'adminsCard', 'adminsList', 'aEmail', 'aAdd', 'configCard', 'configState', 'cfgToken', 'cfgTokenSave', 'cfgTokenClear', 'chRows', 'chAlarm', 'chQ', 'chTenant', 'chState', 'chCount', 'cxChannels', 'cxAlerts']) {
    assert.ok(ADMIN_HTML.includes(`id="${id}"`), `falta #${id}`);
  }
  assert.ok(!/localStorage/.test(ADMIN_HTML), 'sin localStorage');
  // Dashboard (2026-08-25): las gráficas viven en su propia vista y Leads se queda con
  // la bandeja. Cada vista del menú tiene que existir, o el botón deja la pantalla vacía.
  const vistas = [...ADMIN_HTML.matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(vistas.includes('dashboard'), 'hay pestaña Dashboard');
  for (const v of new Set(vistas)) {
    assert.ok(ADMIN_HTML.includes(`id="view${v[0].toUpperCase()}${v.slice(1)}"`), `la pestaña ${v} no tiene vista`);
  }
  // las gráficas están en el Dashboard, no en Leads
  const dash = ADMIN_HTML.slice(ADMIN_HTML.indexOf('id="viewDashboard"'), ADMIN_HTML.indexOf('id="viewLeads"'));
  for (const id of ['chart', 'aiCard', 'aiChart', 'aiRows', 'mTotal']) assert.ok(dash.includes(`id="${id}"`), `#${id} debe estar en el Dashboard`);
  const leads = ADMIN_HTML.slice(ADMIN_HTML.indexOf('id="viewLeads"'), ADMIN_HTML.indexOf('id="viewTenants"'));
  assert.ok(leads.includes('id="escalations"') && leads.includes('id="filters"'), 'Leads conserva sus avisos y filtros');
  assert.ok(!leads.includes('id="chart"'), 'las gráficas ya no están en Leads');
  // El canal dejó de ser una caja de texto: teclear `web:<slug>` a mano es lo que dejó a
  // gogestion ocupando el canal primario con su WhatsApp sin enrutar (2026-08-24).
  assert.ok(!ADMIN_HTML.includes('id="tAddress"'), 'el canal ya no se teclea en la ficha');
  // `.search` es una pastilla con su propio fondo y borde; el input de dentro solo queda
  // desnudo con class="q" (`.search input.q`). Sin ella sale una caja dentro de la caja.
  for (const m of ADMIN_HTML.matchAll(/<label class="search">[\s\S]*?<\/label>/g)) {
    assert.ok(/<input[^>]*class="q"/.test(m[0]), 'todo buscador lleva class="q": ' + m[0].slice(0, 90));
  }
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
const SIEMPRE_ABIERTO = JSON.stringify(Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [['00:00', '23:59']]])));
function handoffHarness({ advisor = false } = {}) {
  const kvStore = new Map();
  const telegram = [];
  let modelCalls = 0;
  // support_hours explícito (todo el día, todos los días) en vez del default L-V 9-19: si no,
  // el test pasaría a las 14:00 y fallaría a las 22:00.
  const horas = advisor ? SIEMPRE_ABIERTO : JSON.stringify({});
  const tenant = { id: 't-h', slug: 'barberia', name: 'Barbería', channel_address: 'whatsapp:+34910000001', system_prompt: 'x'.repeat(60), support_hours: horas, support_tz: 'Europe/Madrid' };
  const tenantB = { id: 't-i', slug: 'clinica', name: 'Clínica', channel_address: 'whatsapp:+34910000002', system_prompt: 'y'.repeat(60), support_hours: horas, support_tz: 'Europe/Madrid' };
  const env = {
    TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 'tok', ANTHROPIC_API_KEY: 'k',
    TELEGRAM_TOKEN: 'tg', TELEGRAM_CHAT_ID: '-1',
    KV: {
      async get(k, type) { const v = kvStore.get(k); return v == null ? null : (type === 'json' ? JSON.parse(v) : v); },
      async put(k, v) { kvStore.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
      async delete(k) { kvStore.delete(k); },
    },
    DB: withConversations({ prepare: (sql) => ({ bind: (...args) => ({
      first: async () => {
        if (sql.includes('channel_address')) return [tenant, tenantB].find((t) => t.channel_address === args[0]) || null;
        if (/COUNT\(\*\) AS n FROM agent_presence/.test(sql)) return { n: advisor ? 1 : 0 };
        return null;
      },
      all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }),
    }) }), batch: async () => [] }),
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

test('handoff CON asesor disponible: pausa, avisa una vez y el centinela nunca llega al cliente', async () => {
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: 'REGLA' });
  const promises = []; const ctx = { waitUntil(p) { promises.push(p); } };
  const h = handoffHarness({ advisor: true });
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
    const handoffs = h.telegram.filter((m) => /Handoff/.test(m));
    assert.equal(handoffs.length, 1, 'un aviso de escalada');
    assert.match(handoffs[0], /Toma el control en el panel/, 'y dice qué hacer con él');
    // 3) pausado: 200 TwiML vacío, sin modelo, sin aviso nuevo, mensaje guardado
    const before = h.modelCalls();
    const paused = await h.send(worker, ctx, 'whatsapp:+34910000001', '¿hola?');
    assert.equal(paused.status, 200);
    assert.match(await paused.text(), /<Response><\/Response>/);
    assert.equal(h.modelCalls(), before, 'cero llamadas al modelo en pausa');
    assert.equal(h.telegram.filter((m) => /Handoff/.test(m)).length, 1, 'sin aviso repetido');
    const hist = h.env.DB.history('t-h', 'whatsapp', 'whatsapp:+34600000000');
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

test('handoff SIN asesores: no se cede el turno, la IA sigue y el lead se fuerza', async () => {
  // El cambio que pidió Juan. Antes esto pausaba el bot 4 h aunque no hubiera nadie para
  // contestar: si el aviso llegaba de noche, el cliente final se quedaba en silencio cuatro
  // horas justo después de pedir ayuda.
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: 'REGLA' });
  const promises = []; const ctx = { waitUntil(p) { promises.push(p); } };
  const h = handoffHarness({ advisor: false });
  try {
    const esc = await h.send(worker, ctx, 'whatsapp:+34910000001', 'quiero hablar con una persona');
    const twiml = await esc.text();
    assert.ok(!twiml.includes('[[HUMANO]]'), 'el centinela sigue sin llegar al cliente final');
    await Promise.allSettled(promises);
    // Lo esencial: NO hay pausa, así que el bot sigue atendiendo.
    assert.ok(!h.kvStore.has('pause:t-h:whatsapp:+34600000000'), 'sin nadie disponible NO se pausa el bot');
    assert.equal(h.telegram.filter((m) => /Handoff/.test(m)).length, 0, 'ni aviso de escalada que nadie va a atender');
    // Y el bot responde al mensaje siguiente en vez de callarse.
    const sigue = await h.send(worker, ctx, 'whatsapp:+34910000001', '¿sigues ahí?');
    assert.match(await sigue.text(), /en qué te ayudo/, 'la IA sigue atendiendo');
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

// ── Conversaciones en D1 (migración 0021) ────────────────────────────────────
// La memoria del chat dejó de vivir en KV: envuelve un mock de D1 y le añade estado REAL
// para `conversations` / `conv_messages`. Sin estado, cada turno arrancaría de cero y los
// tests de aislamiento por tenant, de reintento y de pausa no probarían nada.
function withConversations(inner) {
  const convs = []; const msgs = [];
  // `since` es el corte de la ventana de sesión (72 h). El mock lo respeta de verdad:
  // sin eso, el test de la sesión no probaría la sesión.
  const openOf = (tenantId, channel, externalId, since) => [...convs].reverse()
    .find((c) => c.tenant_id === tenantId && c.channel === channel && c.external_id === externalId
      && (!since || c.last_at > since));
  return {
    convs,
    msgs,
    // Historial de una dirección tal y como lo leería el worker, o null si no hay ninguno.
    history(tenantId, channel, externalId) {
      const c = openOf(tenantId, channel, externalId);
      return c ? msgs.filter((m) => m.conversation_id === c.id).map((m) => ({ role: m.role, content: m.text })) : null;
    },
    prepare(sql) {
      const base = inner.prepare(sql);
      return {
        sql,
        bind: (...args) => {
          const b = base.bind(...args);
          return {
            sql,
            args,
            first: async () => {
              if (/FROM conversations/.test(sql) && /last_at > \?/.test(sql)) {
                const found = openOf(args[0], args[1], args[2], args[3]);
                return found ? { id: found.id, demo: found.demo, msgs: found.msgs } : null;
              }
              return b.first();
            },
            all: async () => {
              if (/FROM conv_messages/.test(sql)) {
                const rows = msgs.filter((m) => m.conversation_id === args[0]);
                return { results: rows.slice(-args[1]).reverse().map((m) => ({ role: m.role, text: m.text })) };
              }
              return b.all();
            },
            run: async () => b.run(),
          };
        },
      };
    },
    batch: async (stmts) => {
      // Solo interceptamos los batches de conversación; los demás (stats, etc.) siguen
      // yendo al mock de abajo, que es quien sabe qué devolver.
      if (!stmts.every((st) => /conversations|conv_messages/.test(st.sql || ''))) return inner.batch(stmts);
      for (const st of stmts) {
        if (/INSERT INTO conversations/.test(st.sql)) {
          const [id, tenant_id, channel, external_id, demo, m,, started] = st.args;
          convs.push({ id, tenant_id, channel, external_id, demo, msgs: m, last_at: started });
        } else if (/UPDATE conversations SET msgs/.test(st.sql)) {
          const c = convs.find((x) => x.id === st.args.at(-1));
          if (c) { c.msgs += st.args[0]; c.last_at = st.args[2]; }
        } else if (/INSERT INTO conv_messages/.test(st.sql)) {
          // (conversation_id, role, agent_email, text, created_at) desde la migración 0023
          msgs.push({ conversation_id: st.args[0], role: st.args[1], agent_email: st.args[2], text: st.args[3] });
        }
      }
      return stmts.map(() => ({}));
    },
  };
}

function webhookEnv(tenants, kv) {
  return {
    TWILIO_AUTH_TOKEN: 'tok', TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), ANTHROPIC_API_KEY: 'k',
    KV: mapKV(kv),
    DB: withConversations({ prepare: (sql) => ({ bind: (...args) => ({
      first: async () => sql.includes('channel_address') ? (tenants[args[0]] || null) : null,
      all: async () => ({ results: [] }), run: async () => {},
    }) }), batch: async () => [] }),
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
    const history = env.DB.history('t-uno', 'whatsapp', 'whatsapp:+34600000000');
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
    env.DB = withConversations({ prepare: (sql) => ({ bind: (...args) => ({
      first: async () => sql.includes('channel_address') ? (tenants[args[0]] || null) : (sql.includes('tenant_calendars') ? calRow : null),
      all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }),
    }) }), batch: async () => [] });
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
    const history = env.DB.history(tenant.id, 'whatsapp', 'whatsapp:+34600000000');
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
  // weeklyReport viaja con la tarjeta de Telegram: es por donde llega el informe (H1 §2).
  // Sin columna en la fila cuenta como ACTIVADO, igual que el default de la migración.
  assert.deepEqual(got.telegram, { linked: true, title: 'Mi grupo', linked_at: '2026-08-21T10:00:00Z', botUsername: null, whitelabel: false, topics: [], weeklyReport: true, lastReport: null });
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

test('plantilla: se puede REENVIAR a aprobación (el paso 2 lanzaba 409 y dejaba el panel atascado)', async () => {
  const subToken = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';
  const TID = '00000000-0000-4000-8000-0000000000f2';
  let fail = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).includes('/ApprovalRequests')
    ? (fail ? new Response(JSON.stringify({ code: 63005, message: 'duplicate' }), { status: 400 })
      : new Response(JSON.stringify({ status: 'received', name: 'nuevo_lead_gog' }), { status: 200 }))
    : new Response('{}', { status: 200 }));
  try {
    const mk = async (env, sid) => ({ id: TID, slug: 'gog', name: 'G', twilio_subaccount_sid: 'AC' + 'c'.repeat(32),
      lead_template_sid: sid, lead_template_status: 'pending', twilio_auth_token_enc: await encryptSecret(env, TID, subToken) });
    const run = async (sid) => {
      const h = provisionHarness({});
      h.row = await mk(h.env, sid);
      h.env.DB.prepare = (sql) => ({ bind: (...args) => ({
        first: async () => (sql.startsWith('SELECT * FROM tenants') ? h.row : null),
        run: async () => { h.updates.push({ sql, args }); return { meta: { changes: 1 } }; },
        all: async () => ({ results: [] }) }) });
      return { h, res: await testing.handleProvision(provReq(), h.env, h.ctx, TID, 'template/resubmit', 'admin@velai') };
    };
    // El caso gogestión: la plantilla existe en Twilio, Meta no la tiene. Se reenvía.
    let out = await run('HXgog');
    const body = await out.res.json();
    assert.deepEqual([body.ok, body.sid, body.error], [true, 'HXgog', null]);
    assert.ok(out.h.updates.find((u) => u.sql.includes("lead_template_status='pending'")), 'vuelve a quedar pendiente');
    assert.ok(out.h.updates.find((u) => u.sql.includes('tenant_versions') && String(u.args).includes('REENVIADA')), 'queda auditado');
    // Si Twilio rechaza el reenvío, el motivo VIAJA y la fila no se toca a mentira
    fail = true;
    out = await run('HXgog');
    const bad = await out.res.json();
    assert.equal(out.res.status, 502);
    assert.equal(bad.ok, false);
    assert.ok(bad.error && bad.error.includes('twilio_400'), 'el motivo de Twilio llega al panel: ' + bad.error);
    assert.ok(!out.h.updates.some((u) => u.sql.includes("lead_template_status='pending'")), 'un reenvío fallido NO marca pending');
    fail = false;
    // Sin plantilla creada no hay nada que reenviar
    const h = provisionHarness({});
    h.row = await mk(h.env, null);
    h.env.DB.prepare = (sql) => ({ bind: () => ({
      first: async () => (sql.startsWith('SELECT * FROM tenants') ? h.row : null),
      run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) }) });
    await assert.rejects(testing.handleProvision(provReq(), h.env, h.ctx, TID, 'template/resubmit', 'admin@velai'),
      (e) => e.code === 'template_required');
  } finally { globalThis.fetch = realFetch; }
});

test('plantilla: comprobar a demanda aplica el veredicto de Twilio y delata la forma inesperada', async () => {
  const subToken = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';
  const TID = '00000000-0000-4000-8000-0000000000f1';
  let payload = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).includes('/ApprovalRequests')
    ? new Response(JSON.stringify(payload), { status: 200 })
    : new Response('{}', { status: 200 }));
  try {
    const mk = async (env, status) => ({ id: TID, slug: 'gog', name: 'G',
      twilio_subaccount_sid: 'AC' + 'c'.repeat(32), lead_template_sid: 'HXgog', lead_template_status: status,
      twilio_auth_token_enc: await encryptSecret(env, TID, subToken) });
    const run = async (status) => {
      const h = provisionHarness({});
      h.row = await mk(h.env, status);
      h.env.DB.prepare = (sql) => ({ bind: (...args) => ({
        first: async () => (sql.startsWith('SELECT * FROM tenants') ? h.row : null),
        run: async () => { h.updates.push({ sql, args }); return { meta: { changes: 1 } }; },
        all: async () => ({ results: [] }) }) });
      const res = await (await testing.handleProvision(provReq(), h.env, h.ctx, TID, 'template/check', 'admin@velai')).json();
      return { res, updates: h.updates };
    };
    // Twilio dice approved: se aplica AHÍ MISMO, sin esperar otra vuelta del cron
    payload = { whatsapp: { status: 'approved' } };
    let out = await run('pending');
    assert.deepEqual([out.res.status, out.res.applied, out.res.stored], ['approved', true, 'pending']);
    assert.ok(out.updates.find((u) => u.sql.includes('SET lead_template_status=?') && u.args.includes('approved')));
    // Sigue pending: no se toca la fila, pero se informa
    payload = { whatsapp: { status: 'pending' } };
    out = await run('pending');
    assert.deepEqual([out.res.status, out.res.applied], ['pending', false]);
    assert.equal(out.updates.filter((u) => u.sql.includes('SET lead_template_status=?')).length, 0);
    // LA FORMA INESPERADA: Twilio contesta 200 pero el estado no está donde lo leemos.
    // Antes esto dejaba la fila «pending» para siempre en silencio; ahora sale 'unknown'
    // y el crudo viaja al panel para ver dónde está de verdad.
    payload = { approval_requests: [{ status: 'approved', channel: 'whatsapp' }] };
    out = await run('pending');
    assert.equal(out.res.status, 'unknown');
    assert.equal(out.res.applied, false, 'un unknown NUNCA escribe en la fila');
    assert.deepEqual(out.res.raw, payload, 'el crudo llega íntegro al panel');
    // Sin plantilla creada, error claro en vez de una llamada inútil a Twilio
    const h = provisionHarness({});
    h.row = { ...(await mk(h.env, null)), lead_template_sid: null };
    h.env.DB.prepare = (sql) => ({ bind: () => ({
      first: async () => (sql.startsWith('SELECT * FROM tenants') ? h.row : null),
      run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) }) });
    await assert.rejects(testing.handleProvision(provReq(), h.env, h.ctx, TID, 'template/check', 'admin@velai'),
      (e) => e.code === 'template_required');
  } finally { globalThis.fetch = realFetch; }
});

test('¿dónde llegan los leads?: el panel deja de prometer un Telegram que no existe', async () => {
  const ENV = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TEAM_WHATSAPP: null,
    TWILIO_FROM: 'whatsapp:+15706160059', TWILIO_LEAD_TEMPLATE_SID: 'HXvelai' };
  // El caso REAL de gogestión: team_whatsapp puesto, plantilla propia creada pero `pending`
  // en Meta, y NINGÚN Telegram vinculado. Los dos canales salían skipped y el panel decía
  // que los avisos llegaban por Telegram: nadie se enteraba de sus leads.
  const gog = { telegram_chat_id: null, twilio_subaccount_sid: 'ACsub', team_whatsapp: 'whatsapp:+34634167405',
    lead_template_sid: 'HXgog', lead_template_status: 'pending', twilio_from: 'whatsapp:+34624121930' };
  assert.deepEqual(testing.leadAlertStatus(ENV, gog), { telegram: 'off', whatsapp: 'pending_template', any: false });
  // Con su Telegram vinculado ya hay un canal vivo, aunque Meta siga con la plantilla
  assert.equal(testing.leadAlertStatus(ENV, { ...gog, telegram_chat_id: '-100123' }).any, true);
  // Plantilla aprobada: WhatsApp entrega
  assert.deepEqual(testing.leadAlertStatus(ENV, { ...gog, lead_template_status: 'approved' }),
    { telegram: 'off', whatsapp: 'on', any: true });
  // Con SUBCUENTA no hay respaldo con los recursos del padre: dentro de ella no existen.
  // Sin From ni plantilla propios, WhatsApp no entrega aunque el env los tenga.
  assert.equal(testing.leadAlertStatus(ENV, { ...gog, lead_template_sid: null, twilio_from: null }).whatsapp, 'off');
  // Un tenant SIN subcuenta sí cae a los recursos de Velai (así avisa velai/hiredatavision)
  assert.equal(testing.leadAlertStatus(ENV, { telegram_chat_id: null, twilio_subaccount_sid: null,
    team_whatsapp: 'whatsapp:+34600', lead_template_sid: null, lead_template_status: null, twilio_from: null }).whatsapp, 'on');
  // Y sin destinatarios no hay aviso posible
  assert.equal(testing.leadAlertStatus({ ...ENV, TEAM_WHATSAPP: null }, { telegram_chat_id: null,
    twilio_subaccount_sid: null, team_whatsapp: null, lead_template_sid: null, lead_template_status: null, twilio_from: null }).any, false);
});

test('leads sin nombre: se guardan YA para no perderlos y se ENRIQUECEN cuando llega el nombre', async () => {
  // (a) recaptura sobre un lead ya guardado: rellena huecos y NO pisa lo que ya hay.
  //     Antes el conflicto no actualizaba nada y la fila se quedaba «sin nombre» para siempre.
  const ups = [];
  let clash = true;
  const env = { DB: {
    batch: async () => { if (clash) throw new Error('UNIQUE constraint failed: leads.request_id'); return []; },
    prepare: (sql) => ({ bind: (...args) => ({
      first: async () => (sql.includes('SELECT id FROM leads') ? { id: 'lead-1' } : null),
      run: async () => { ups.push({ sql, args }); return { meta: { changes: 1 } }; },
      all: async () => ({ results: [] }) }) }) } };
  const out = await testing.persistLead(env, { requestId: 'wa:t:1', source: 'whatsapp', phone: '+34600',
    name: 'Ana', need: 'canje de carnet', context: 'venezolana', sector: null });
  assert.deepEqual([out.id, out.created, out.enriched], ['lead-1', false, true]);
  const up = ups.find((u) => u.sql.includes('UPDATE leads SET'));
  assert.ok(up, 'la recaptura actualiza la fila existente');
  // COALESCE: lo que ya tiene valor NO se pisa — puede haberlo corregido una persona
  assert.ok(/name=COALESCE\(name,\?\)/.test(up.sql) && /need=COALESCE\(need,\?\)/.test(up.sql));
  assert.ok(!up.sql.includes('sector='), 'un campo vacío en el resumen no entra en el UPDATE');
  assert.ok(up.args.includes('Ana') && up.args.includes('lead-1'));

  // (b) la guarda: sin motivo NI negocio no hay lead que contar
  assert.deepEqual(testing.leadFromSummary({ nombre: ' Ana ', necesidad: 'x'.repeat(300) }).name, 'Ana');
  const tenant = { id: 't', slug: 'gog' };
  // (c) la marca de KV cierra la captura solo cuando ya no hay nada que ganar: con nombre,
  //     sí; sin nombre se reintenta en cada mensaje hasta agotar la paciencia.
  assert.equal(testing.leadCaptureDone(env, tenant, { name: 'Ana' }, 2), true);
  assert.equal(testing.leadCaptureDone(env, tenant, { name: null }, 2), false, 'sin nombre: se reintenta');
  assert.equal(testing.leadCaptureDone(env, tenant, { name: null }, 8), true, 'agotada la paciencia, se deja de gastar resúmenes');
});

test('captura de lead: los DOS canales exigen un asunto y reintentan mientras falte el nombre', async () => {
  const realFetch = globalThis.fetch;
  let summary = {};
  globalThis.fetch = async (url) => (String(url).includes('anthropic')
    ? new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(summary) }] }), { status: 200 })
    : new Response('{}', { status: 200 }));
  try {
    const kv = new Map();
    const stored = [];
    const env = { ANTHROPIC_API_KEY: 'k', DB: {
      batch: async (st) => { stored.push(st); return []; },
      prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) }) }) },
      KV: { async get(k) { return kv.get(k) ?? null; }, async put(k, v) { kv.set(k, v); }, async delete(k) { kv.delete(k); } } };
    const ctx = { waitUntil() {} };
    const tenant = { id: 't1', slug: 'gog' };
    const turns = (n) => Array.from({ length: n }, () => [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'hey' }]).flat();
    const cap = () => testing.captureWhatsAppLead({ SUMMARY_PROMPT: 'p' }, env, ctx, tenant, 'whatsapp:+34600', '+34600', turns(2));
    const marked = () => kv.has('lead:wa:t1:whatsapp:+34600');

    // Sin motivo ni negocio: no se guarda NADA (el canal web no tenía esta guarda)
    summary = { nombre: null, negocio: null, necesidad: null, contexto: null };
    await cap();
    assert.equal(stored.length, 0, 'un resumen vacío no crea lead');
    assert.equal(marked(), false, 'y no se marca: el siguiente mensaje reintenta');

    // Con motivo pero SIN nombre: se guarda (no se pierde) y NO se cierra la captura
    summary = { nombre: null, necesidad: 'obtener certificado FNMT', contexto: 'trámites' };
    await cap();
    assert.equal(stored.length, 1, 'el lead se guarda ya: un teléfono con conversación real no se pierde');
    assert.equal(marked(), false, 'sigue abierto para enriquecerlo con el nombre');

    // Cuando el nombre llega, se guarda de nuevo (enriquece) y ahí sí se cierra
    summary = { nombre: 'Ana', necesidad: 'obtener certificado FNMT', contexto: 'trámites' };
    await cap();
    assert.equal(stored.length, 2);
    assert.equal(marked(), true, 'con nombre ya no hay nada que ganar: captura cerrada');
  } finally { globalThis.fetch = realFetch; }
});

test('canales del cliente: ve los suyos sin diagnóstico, el ajeno es 404, y la vista GLOBAL sigue siendo de Velai', async () => {
  const TID = '00000000-0000-4000-8000-0000000000d1';
  // Su WhatsApp está de alta en Twilio pero SIN fila que lo enrute: el peor caso.
  const row = { id: TID, slug: 'gog', active: 1, channel_address: 'web:gog', twilio_from: 'whatsapp:+34624121930',
    sender_sid: 'XE1', telegram_chat_id: '-100123', telegram_chat_title: 'Leads GOgestión',
    web_origins: JSON.stringify(['https://www.gogestion.es']) };
  const env = { DB: { prepare: (sql) => ({ bind: () => ({
    first: async () => (sql.includes('FROM tenants WHERE id=') ? row : null),
    all: async () => ({ results: [] }) }) }) } };
  const ctx = { waitUntil() {} };
  const path = `/api/admin/tenants/${TID}/channels`;
  const url = new URL('https://x' + path);
  const OWN = { role: 'cliente', tenantId: TID, email: 'c@x.com' };
  const mine = await (await testing.adminRouter(adminReq(path), env, ctx, path, url, {}, OWN)).json();
  // Vocabulario del cliente: nada que no pueda accionar. Su WhatsApp sin enrutar es
  // trabajo pendiente NUESTRO, así que lee «preparing», jamás «unrouted».
  assert.deepEqual(mine.channels.map((c) => [c.kind, c.state]),
    [['web', 'on'], ['whatsapp', 'preparing'], ['telegram', 'on'], ['messenger', 'off']]);
  const raw = JSON.stringify(mine);
  for (const leak of ['unrouted', 'sender_sid', 'XE1', 'channel_address']) assert.ok(!raw.includes(leak), 'no se filtra ' + leak);
  // Direcciones legibles: su dominio y el nombre del grupo, no el slug ni el chat_id
  assert.equal(mine.channels[0].address, 'gogestion.es');
  assert.equal(mine.channels[2].address, 'Leads GOgestión');
  // Velai, en la MISMA ruta, sigue viendo el estado crudo: ahí el diagnóstico sirve
  const asVelai = await (await testing.adminRouter(adminReq(path), env, ctx, path, url, {}, { role: 'velai', email: 'a@velai' })).json();
  assert.equal(asVelai.channels.find((c) => c.kind === 'whatsapp').state, 'unrouted');
  // El :id ajeno es 404, nunca 403
  const foreign = `/api/admin/tenants/${LEADS[1].id}/channels`;
  await assert.rejects(testing.adminRouter(adminReq(foreign), env, ctx, foreign, new URL('https://x' + foreign), {}, OWN),
    (e) => e.code === 'not_found');
  // Y el mapa GLOBAL de canales (números y nombres de OTROS clientes) sigue vetado
  assert.equal(testing.clienteAllowed('/api/admin/channels', 'GET'), false);
  assert.equal(testing.clienteAllowed(`/api/admin/tenants/${TID}/channels`, 'GET'), true);
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
  // AUTOSERVICIO: el cliente sube el SUYO (es su marca)…
  const own = await (await testing.adminRouter(adminReq(path, { method: 'POST', body: png }), env, ctx, path, new URL('https://x' + path), {}, { role: 'cliente', tenantId: TID })).json();
  assert.equal(own.ok, true, 'el cliente sube su propio logo');
  // …y el de OTRO es 404, nunca 403 (no se confirma que exista)
  const foreign = '/api/admin/tenants/00000000-0000-4000-8000-0000000000d9/logo';
  await assert.rejects(
    testing.adminRouter(adminReq(foreign, { method: 'POST', body: png }), env, ctx, foreign, new URL('https://x' + foreign), {}, { role: 'cliente', tenantId: TID }),
    (e) => e.status === 404);
});

test('al subir el logo, la foto de WhatsApp se actualiza sola (y un fallo de Twilio no rompe la subida)', async () => {
  const TID = '00000000-0000-4000-8000-0000000000d4';
  const realFetch = globalThis.fetch;
  const posts = [];
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.telegram.org')) return new Response('{"ok":true}', { status: 200 });
      if (!init || init.method === 'GET') return new Response(JSON.stringify({ status: 'ONLINE', profile: { name: 'Nombre Aprobado' } }), { status: 200 });
      posts.push({ u: String(url), body: init.body });
      return new Response('{"status":"ONLINE"}', { status: 200 });
    };
    const row = { id: TID, slug: 'mio', name: 'Mío', brand_name: 'Marca Mía', greeting: 'Hola', logo_url: null,
      web_origins: '["https://mio.com"]', sender_sid: 'XE' + 'b'.repeat(32), twilio_subaccount_sid: 'AC' + 'c'.repeat(32),
      twilio_auth_token_enc: await encryptSecret({ SECRETS_KEK: TEST_KEK }, TID, 'a1b2c3d4e5f60718293a4b5c6d7e8f90') };
    const kv = { store: new Map(), async put(k, v, o) { this.store.set(k, { value: v, metadata: o && o.metadata }); },
      async getWithMetadata(k) { return this.store.get(k) || { value: null }; },
      async get() { return null; }, async delete() {}, async list() { return { keys: [] }; } };
    const env = { SECRETS_KEK: TEST_KEK, KV: kv, DB: { prepare: (sql) => ({ bind: () => ({
      first: async () => (sql.includes('FROM tenants WHERE id=') ? { ...row } : null),
      run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }),
    }) }) } };
    const pending = [];
    const ctx = { waitUntil: (p2) => pending.push(p2) };
    const png = new Uint8Array(200); png.set([0x89, 0x50, 0x4e, 0x47], 0);
    const path = `/api/admin/tenants/${TID}/logo`;
    const res = await (await testing.adminRouter(adminReq(path, { method: 'POST', body: png }), env, ctx, path, new URL('https://x' + path), {}, VELAI)).json();
    assert.equal(res.whatsapp, true, 'avisa de que también va a WhatsApp');
    await Promise.all(pending);
    const sent = JSON.parse(posts[0].body).profile;
    assert.match(sent.logo_url, /^https:\/\/api\.hirevai\.com\/media\/logos\//, 'la foto nueva llega a Twilio');
    assert.equal(sent.name, 'Nombre Aprobado', 'sin tocar el nombre visible');
    // si Twilio falla, la subida ya respondió OK y el error solo queda en el log
    globalThis.fetch = async () => new Response('{"code":20003}', { status: 401 });
    const pend2 = [];
    const res2 = await (await testing.adminRouter(adminReq(path, { method: 'POST', body: png }), env, { waitUntil: (p2) => pend2.push(p2) }, path, new URL('https://x' + path), {}, VELAI)).json();
    assert.equal(res2.ok, true);
    await Promise.all(pend2); // no lanza: el fallo se registra, no rompe
  } finally { globalThis.fetch = realFetch; }
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
    // El payload va MÍNIMO: los campos del GET que la API de escritura no acepta se
    // quedan fuera (reenviarlos provocaba el 63100 de validación).
    assert.equal(sent.vertical, undefined, 'no se reenvía lo que el POST no admite');
    assert.deepEqual(Object.keys(sent).sort(), ['about', 'description', 'logo_url', 'name', 'websites']);
    // sin sender no hay nada que perfilar
    const sin = provisionHarness({ tenant: { id: '00000000-0000-4000-8000-0000000000d3', slug: 'x', name: 'X', brand_name: 'X', twilio_subaccount_sid: sub, sender_sid: null, twilio_auth_token_enc: await encryptSecret({ SECRETS_KEK: TEST_KEK }, '00000000-0000-4000-8000-0000000000d3', 'a1b2c3d4e5f60718293a4b5c6d7e8f90') } });
    await assert.rejects(testing.handleProvision(provReq(), sin.env, sin.ctx, sin.row.id, 'sender/profile', 'juan@x'), (e) => e.code === 'sender_required');
  } finally { globalThis.fetch = realFetch; }
});

test('el panel del cliente se viste con su logo y el fallo del perfil de WhatsApp deja de ser invisible', async () => {
  const TID = '00000000-0000-4000-8000-0000000000e7';
  const kv = { store: new Map(),
    async get(k, t2) { const v = this.store.get(k); return v == null ? null : (t2 === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { this.store.set(k, v); }, async delete() {}, async list() { return { keys: [] }; } };
  const env = { KV: kv, DB: { prepare: (sql) => ({ bind: () => ({
    first: async () => (sql.includes('SELECT name, logo_url') ? { name: 'Mío', logo_url: 'https://api.hirevai.com/media/logos/x.png?v=1' }
      : sql.includes('FROM tenants WHERE id=') ? { channel_address: 'whatsapp:+34600000001', sender_status: 'ONLINE', logo_url: 'https://api.hirevai.com/media/logos/x.png?v=1' } : null),
    run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }),
  }) }) } };
  const ctx = { waitUntil() {} };
  const OWN = { role: 'cliente', tenantId: TID, email: 'c@x.com' };
  // /me lleva el logo para vestir la cabecera al arrancar
  const me = await (await testing.adminRouter(adminReq('/api/admin/me'), env, ctx, '/api/admin/me', new URL('https://x/api/admin/me'), {}, OWN)).json();
  assert.equal(me.tenantLogo, 'https://api.hirevai.com/media/logos/x.png?v=1');
  // un logo http:// (no https) no se sirve como marca
  const envHttp = { ...env, DB: { prepare: (sql) => ({ bind: () => ({ first: async () => (sql.includes('SELECT name, logo_url') ? { name: 'M', logo_url: 'http://insegura/x.png' } : null), run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }) }) }) } };
  const meHttp = await (await testing.adminRouter(adminReq('/api/admin/me'), envHttp, ctx, '/api/admin/me', new URL('https://x/api/admin/me'), {}, OWN)).json();
  assert.equal(meHttp.tenantLogo, null);
  // el resultado del último empujón del perfil viaja al panel
  await kv.put(`waprof:${TID}`, JSON.stringify({ at: '2026-08-24T10:00:00.000Z', ok: false, error: 'twilio_400_63028' }));
  const wp = `/api/admin/tenants/${TID}/whatsapp`;
  const wa = await (await testing.adminRouter(adminReq(wp), env, ctx, wp, new URL('https://x' + wp), {}, OWN)).json();
  assert.deepEqual([wa.profileSync.ok, wa.profileSync.error], [false, 'twilio_400_63028'], 'el fallo se cuenta, no se esconde');
});

test('la imagen guardada se aplica a WhatsApp SIN volver a subirla, y el panel puede pintar imágenes', async () => {
  const TID = '00000000-0000-4000-8000-0000000000e8';
  // La CSP del panel debe permitir imágenes: sin img-src, default-src 'none' las bloquea
  // TODAS y la miniatura del logo sale rota (lo vio Juan en Conexiones).
  const source = await readFile(new URL('../worker/app.js', import.meta.url), 'utf8');
  const csp = /'Content-Security-Policy': `([^`]+)`/.exec(source);
  assert.ok(csp && /img-src [^;]*https:/.test(csp[1]), 'la CSP del panel deja pasar imágenes https');
  const page = await readFile(new URL('../worker/admin-page.js', import.meta.url), 'utf8');
  assert.ok(page.includes('class="filein"'), 'el input de archivo lleva el estilo del panel, no el nativo');
  const realFetch = globalThis.fetch;
  const posts = [];
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.telegram.org')) return new Response('{"ok":true}', { status: 200 });
      if (!init || init.method === 'GET') return new Response(JSON.stringify({ status: 'ONLINE', profile: { name: 'Nombre Aprobado' } }), { status: 200 });
      posts.push(JSON.parse(init.body));
      return new Response('{"status":"ONLINE"}', { status: 200 });
    };
    const row = { id: TID, slug: 'mio', name: 'Mío', brand_name: 'Marca', greeting: 'Hola',
      logo_url: 'https://api.hirevai.com/media/logos/y.png?v=2', web_origins: '[]',
      sender_sid: 'XE' + 'd'.repeat(32), twilio_subaccount_sid: 'AC' + 'e'.repeat(32),
      twilio_auth_token_enc: await encryptSecret({ SECRETS_KEK: TEST_KEK }, TID, 'a1b2c3d4e5f60718293a4b5c6d7e8f90') };
    const kv = mapKV();
    const env = { SECRETS_KEK: TEST_KEK, KV: kv, DB: { prepare: (sql) => ({ bind: () => ({
      first: async () => (sql.includes('FROM tenants WHERE id=') ? { ...row } : null),
      run: async () => ({ meta: { changes: 1 } }), all: async () => ({ results: [] }),
    }) }) } };
    const ctx = { waitUntil() {} };
    const path = `/api/admin/tenants/${TID}/logo/apply`;
    // el CLIENTE puede reaplicar SU imagen (autoservicio), sin resubir nada
    const res = await (await testing.adminRouter(adminReq(path, { method: 'POST' }), env, ctx, path, new URL('https://x' + path), {}, { role: 'cliente', tenantId: TID })).json();
    assert.equal(res.applied.logo, true);
    assert.equal(posts[0].profile.logo_url, 'https://api.hirevai.com/media/logos/y.png?v=2', 'usa la URL ya guardada');
    assert.equal(JSON.parse(await kv.get(`waprof:${TID}`)).ok, true, 'queda registrado para el panel');
    // el de otro cliente, 404
    const foreign = '/api/admin/tenants/00000000-0000-4000-8000-0000000000e9/logo/apply';
    await assert.rejects(testing.adminRouter(adminReq(foreign, { method: 'POST' }), env, ctx, foreign, new URL('https://x' + foreign), {}, { role: 'cliente', tenantId: TID }), (e) => e.status === 404);
  } finally { globalThis.fetch = realFetch; }
});

test('el panel no gasta cuota de KV y sigue teniendo tope; lo público sí cuenta en KV', async () => {
  // El aviso de Cloudflare del 2026-08-24 (media cuota diaria de KV en un día de pruebas)
  // era esto: una sola carga del panel son ~8 peticiones y cada una escribía una clave.
  const kv = mapKV();
  let writes = 0;
  const env = { KV: { async get(k) { return kv.get(k); }, async put(k, v, o) { writes += 1; return kv.put(k, v, o); }, async delete(k) { return kv.delete(k); }, async list() { return { keys: [] }; } } };
  for (let i = 0; i < 30; i++) await testing.rateLimited(env, 'juan@velai.com', 'admin', 120);
  assert.equal(writes, 0, 'el panel no escribe en KV');
  // pero el tope sigue existiendo (en memoria, por isolate)
  let blocked = false;
  for (let i = 0; i < 8; i++) blocked = await testing.rateLimited(env, 'otro@velai.com', 'admin', 5) || blocked;
  assert.equal(blocked, true, 'un bucle del panel se frena igual');
  // el tráfico público (sin identidad verificada) mantiene el contador en KV
  await testing.rateLimited(env, '1.2.3.4', 'chat', 20);
  assert.equal(writes, 1, 'lo público sigue contando en KV');
  // la caché de tenants deja de reescribirse cada 5 minutos
  const source = await readFile(new URL('../worker/app.js', import.meta.url), 'utf8');
  const ttl = /const TENANT_TTL = (\d+)/.exec(source);
  assert.ok(ttl && Number(ttl[1]) >= 900, 'TTL alto: la invalidación explícita ya cubre los cambios del panel');
});

test('gasto de IA: se registra por cliente y modelo, y el panel lo suma con las tarifas reales', async () => {
  // Tarifas verificadas en la referencia de la API (2026-08-24): sonnet 4.6 $3/$15 por
  // millón, haiku 4.5 $1/$5; caché escribe a 1,25x de entrada y lee a 0,1x.
  const sonnet = testing.aiCost({ model: 'claude-sonnet-4-6', in_tokens: 1e6, out_tokens: 0, cache_w_tokens: 0, cache_r_tokens: 0 });
  assert.equal(Number(sonnet.toFixed(4)), 3);
  const haiku = testing.aiCost({ model: 'claude-haiku-4-5', in_tokens: 0, out_tokens: 1e6, cache_w_tokens: 0, cache_r_tokens: 0 });
  assert.equal(Number(haiku.toFixed(4)), 5);
  const cache = testing.aiCost({ model: 'claude-sonnet-4-6', in_tokens: 0, out_tokens: 0, cache_w_tokens: 1e6, cache_r_tokens: 1e6 });
  assert.equal(Number(cache.toFixed(4)), 3 * 1.25 + 3 * 0.1);
  // un modelo desconocido no rompe el cálculo (se estima, no se ignora)
  assert.ok(testing.aiCost({ model: 'modelo-nuevo', in_tokens: 1e6, out_tokens: 0, cache_w_tokens: 0, cache_r_tokens: 0 }) > 0);
  // el registro acumula con UPSERT y NUNCA lanza si D1 falla
  const binds = [];
  const env = { DB: { prepare: (sql) => ({ bind: (...a) => { binds.push({ sql, a }); return { run: async () => ({ meta: { changes: 1 } }) }; } }) } };
  await testing.recordAiUsage(env, { id: 't-1' }, 'claude-sonnet-4-6', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 });
  assert.ok(binds[0].sql.includes('ON CONFLICT(tenant_id,day,model) DO UPDATE'), 'una fila por cliente/día/modelo');
  assert.deepEqual([binds[0].a[0], binds[0].a[2], binds[0].a[3], binds[0].a[4], binds[0].a[6]], ['t-1', 'claude-sonnet-4-6', 10, 5, 100]);
  await testing.recordAiUsage({ DB: { prepare: () => { throw new Error('d1 down'); } } }, { id: 't-1' }, 'm', { input_tokens: 1 });
  // sin cliente (previsualización del panel) se registra igual, con cliente vacío
  await testing.recordAiUsage(env, null, 'claude-haiku-4-5', { input_tokens: 1 });
  assert.equal(binds[1].a[0], '');
  // el endpoint agrega por cliente y rellena los días sin consumo
  const rows = [
    { tenant_id: 't-1', day: '2026-08-24', model: 'claude-sonnet-4-6', calls: 2, in_tokens: 1e6, out_tokens: 0, cache_w_tokens: 0, cache_r_tokens: 0, tenant_name: 'Uno', slug: 'uno' },
    { tenant_id: 't-2', day: '2026-08-24', model: 'claude-haiku-4-5', calls: 1, in_tokens: 0, out_tokens: 1e6, cache_w_tokens: 0, cache_r_tokens: 0, tenant_name: 'Dos', slug: 'dos' },
  ];
  const envList = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }), first: async () => null, run: async () => ({ meta: { changes: 1 } }) }) }) } };
  const path = '/api/admin/ai-usage?days=7';
  const res = await (await testing.adminRouter(adminReq(path), envList, { waitUntil() {} }, '/api/admin/ai-usage', new URL('https://x' + path), {}, VELAI)).json();
  assert.equal(res.porDia.length, 7, 'la serie no miente: los días sin gasto valen 0');
  assert.equal(res.total.cost, 8, '3 + 5');
  assert.deepEqual(res.clientes.map((c) => [c.name, c.cost]), [['Dos', 5], ['Uno', 3]], 'ordenado por gasto');
  // un cliente NO puede ver el gasto de nadie
  await assert.rejects(testing.adminRouter(adminReq(path), envList, { waitUntil() {} }, '/api/admin/ai-usage', new URL('https://x' + path), {}, { role: 'cliente', tenantId: 't-1' }), (e) => e.code === 'not_authorized');
});

test('imagen por canal: web y WhatsApp pueden ser distintas y cada una va a lo suyo', async () => {
  const TID = '00000000-0000-4000-8000-0000000000f7';
  const writes = [];
  const row = { id: TID, slug: 'mio', name: 'Mío', logo_url: null, logo_wa_url: null, brand_name: 'M', greeting: 'h',
    web_origins: '[]', sender_sid: 'XE' + 'f'.repeat(32), twilio_subaccount_sid: 'AC' + 'f'.repeat(32), twilio_auth_token_enc: null };
  const env = { KV: mapKV(), DB: { prepare: (sql) => ({ bind: (...a) => ({
    first: async () => (sql.includes('FROM tenants WHERE id=') ? { ...row } : null),
    run: async () => { writes.push({ sql, a }); return { meta: { changes: 1 } }; }, all: async () => ({ results: [] }),
  }) }) } };
  const png = new Uint8Array(200); png.set([0x89, 0x50, 0x4e, 0x47], 0);
  const call = (qs) => {
    const path = `/api/admin/tenants/${TID}/logo`;
    return testing.adminRouter(adminReq(path + qs, { method: 'POST', body: png }), env, { waitUntil() {} }, path, new URL('https://x' + path + qs), {}, VELAI);
  };
  // solo web: toca logo_url y NO empuja nada a WhatsApp
  const web = await (await call('?channels=web')).json();
  assert.deepEqual(web.canales, { web: true, whatsapp: false });
  assert.equal(web.whatsapp, false, 'no se aplica a WhatsApp si no se pidió');
  const upWeb = writes.find((w) => w.sql.includes('UPDATE tenants SET logo_url=?'));
  assert.ok(upWeb && !upWeb.sql.includes('logo_wa_url'), 'solo la columna del widget');
  assert.match(web.logo_url, /-web\.png/, 'fichero propio del canal');
  // solo WhatsApp: otra columna, otro fichero
  writes.length = 0;
  const wa = await (await call('?channels=whatsapp')).json();
  assert.ok(writes.some((w) => w.sql.includes('UPDATE tenants SET logo_wa_url=?')), 'columna de WhatsApp');
  assert.match(wa.logo_url, /-wa\.png/);
  // los dos a la vez (el comportamiento de antes) comparten fichero
  writes.length = 0;
  const both = await (await call('?channels=web,whatsapp')).json();
  assert.deepEqual(both.canales, { web: true, whatsapp: true });
  assert.ok(writes.some((w) => w.sql.includes('logo_url=?') && w.sql.includes('logo_wa_url=?')));
  assert.ok(!/-web|-wa/.test(both.logo_url), 'misma imagen, un solo fichero');
  // sin canales marcados, no se guarda nada
  await assert.rejects(call('?channels='), (e) => e.code === 'channels_required');
  // y la foto de WhatsApp prefiere SU imagen sobre la del widget
  const realFetch = globalThis.fetch;
  try {
    const posts = [];
    globalThis.fetch = async (u, init) => {
      if (!init || init.method === 'GET') return new Response(JSON.stringify({ status: 'ONLINE', profile: { name: 'N' } }), { status: 200 });
      posts.push(JSON.parse(init.body)); return new Response('{"status":"ONLINE"}', { status: 200 });
    };
    await testing.applySenderProfile({}, { ...row, logo_url: 'https://x/web.png', logo_wa_url: 'https://x/wa.png' }, { sid: 'AC', token: 't' });
    assert.equal(posts[0].profile.logo_url, 'https://x/wa.png');
  } finally { globalThis.fetch = realFetch; }
});

test('dashboard: leads por canal, tasa de captura con denominador real y consumo de Cloudflare', async () => {
  // conversación nueva = una escritura, no una por mensaje
  const binds = [];
  const envConv = { DB: { prepare: (sql) => ({ bind: (...a) => { binds.push({ sql, a }); return { run: async () => ({ meta: { changes: 1 } }) }; } }) } };
  await testing.recordConversation(envConv, { id: 't-1' }, 'web');
  assert.ok(binds[0].sql.includes('ON CONFLICT(tenant_id,day,channel) DO UPDATE SET convs=convs+1'));
  assert.deepEqual([binds[0].a[0], binds[0].a[2]], ['t-1', 'web']);
  await testing.recordConversation({ DB: { prepare: () => { throw new Error('d1 down'); } } }, { id: 't-1' }, 'web'); // no lanza
  await testing.recordConversation(envConv, null, 'web');
  assert.equal(binds.length, 1, 'sin tenant no se cuenta nada');
  // stats devuelve canal y captura, con el aviso de desde cuándo hay denominador
  const batches = [
    { results: [{ n: 9 }] }, { results: [{ n: 2, oldest: '2026-08-01' }] }, { results: [{ n: 0 }] },
    { results: [{ d: '2026-08-25', n: 3 }] },
    { results: [{ source: 'whatsapp', n: 6 }, { source: 'chat web', n: 3 }] },
    { results: [{ channel: 'whatsapp', n: 20 }, { channel: 'web', n: 10 }] },
    { results: [{ active: 1, n: 7 }] },
  ];
  const env = { DB: { prepare: () => ({ bind: () => ({}) }), batch: async () => batches } };
  const res = await (await testing.adminRouter(adminReq('/api/admin/stats'), env, { waitUntil() {} }, '/api/admin/stats', new URL('https://x/api/admin/stats'), {}, VELAI)).json();
  assert.deepEqual(res.porCanal, [{ canal: 'whatsapp', n: 6 }, { canal: 'chat web', n: 3 }]);
  assert.equal(res.captura.conversaciones, 30, 'suma de conversaciones de todos los canales');
  assert.ok(res.captura.desde, 'dice desde cuándo se cuentan: sin eso el % engañaría');
  // consumo de Cloudflare: sin permiso NO devuelve ceros, devuelve el motivo y los límites
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: null, errors: [{ message: 'not authorized for that account' }] }), { status: 200 });
    const denied = await testing.cloudflareUsage({ CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'a', DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } });
    assert.equal(denied.error, 'cloudflare_analytics_denied');
    assert.equal(denied.limits.kv_writes, 1000, 'los límites del plan gratuito viajan igual');
    // con datos, agrega por tipo de operación
    globalThis.fetch = async () => new Response(JSON.stringify({ data: { viewer: { accounts: [{
      workersInvocationsAdaptive: [{ sum: { requests: 500, errors: 2 } }],
      kvOperationsAdaptiveGroups: [{ sum: { requests: 40 }, dimensions: { actionType: 'read' } }, { sum: { requests: 7 }, dimensions: { actionType: 'write' } }],
      d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 900, rowsWritten: 30 } }],
    }] } } }), { status: 200 });
    const ok = await testing.cloudflareUsage({ CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'a', DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } });
    assert.deepEqual([ok.worker.requests, ok.kv.read, ok.kv.write, ok.d1.rowsWritten], [500, 40, 7, 30]);
    // los listados de KV también se vigilan: comparten un límite de 1.000/día con los
    // borrados y en producción iban al 30% (las escalaciones listan por prefijo).
    assert.equal(ok.limits.kv_lists, 1000);
  } finally { globalThis.fetch = realFetch; }
  // el cliente no ve la infraestructura
  await assert.rejects(testing.adminRouter(adminReq('/api/admin/infra-usage'), env, { waitUntil() {} }, '/api/admin/infra-usage', new URL('https://x/api/admin/infra-usage'), {}, { role: 'cliente', tenantId: 't-1' }), (e) => e.code === 'not_authorized');
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

// ── Historial de conversación en D1 (migración 0021) ─────────────────────────
test('conversaciones: sesión de 72 h, ventana de 20 al modelo y recuento de «no supe contestar»', async () => {
  const env = { DB: withConversations({ prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }) }), batch: async () => [] }) };
  const tenant = { id: 't-1' };

  // Primer turno: no hay sesión abierta → fila nueva, y convLoad NO escribe (el INSERT
  // lo hace convAppend, para que una conversación que no pasa Turnstile no deje rastro).
  const first = await testing.convLoad(env, tenant, 'web', 'c-1');
  assert.equal(first.isNew, true);
  assert.deepEqual(first.messages, []);
  assert.equal(env.DB.convs.length, 0, 'convLoad no escribe');
  await testing.convAppend(env, first, [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'buenas' }]);
  assert.equal(env.DB.convs.length, 1);

  // Segundo turno: reutiliza la MISMA fila y trae el historial.
  const second = await testing.convLoad(env, tenant, 'web', 'c-1');
  assert.equal(second.isNew, false);
  assert.equal(second.id, first.id);
  assert.deepEqual(second.messages.map((m) => m.content), ['hola', 'buenas']);
  assert.equal(env.DB.convs.length, 1, 'no duplica la conversación');

  // Otro tenant con la MISMA dirección es otra conversación: el aislamiento no depende
  // del almacén (antes eran claves de KV distintas, ahora filas distintas).
  const otro = await testing.convLoad(env, { id: 't-2' }, 'web', 'c-1');
  assert.equal(otro.isNew, true);
  assert.notEqual(otro.id, first.id);
  await testing.convAppend(env, otro, [{ role: 'user', content: 'soy de otro negocio' }]);
  assert.deepEqual((await testing.convLoad(env, tenant, 'web', 'c-1')).messages.map((m) => m.content),
    ['hola', 'buenas'], 'el mensaje del otro tenant no se cuela en esta conversación');

  // Pasadas las 72 h de silencio, la siguiente entrada abre una conversación NUEVA: el
  // panel enseña sesiones discretas y no un hilo infinito por teléfono. (72 h es el
  // estándar de facto del sector para dar una conversación por resuelta.)
  env.DB.convs.forEach((c) => { c.last_at = '2026-01-01T00:00:00.000Z'; });
  const tras72h = await testing.convLoad(env, tenant, 'web', 'c-1');
  assert.equal(tras72h.isNew, true, 'tras el silencio, sesión nueva');
  assert.notEqual(tras72h.id, first.id);
  assert.deepEqual(tras72h.messages, [], 'la sesión nueva no arrastra el historial de la vieja');
  await testing.convAppend(env, tras72h, [{ role: 'user', content: 'vuelvo' }]);
  assert.equal(env.DB.convs.length, 3, 'dos sesiones del mismo visitante + la del otro tenant');

  // Se GUARDA todo y al modelo solo le va la ventana: 30 mensajes dentro, 20 fuera.
  const long = await testing.convLoad(env, tenant, 'web', 'c-1');
  await testing.convAppend(env, long, Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })));
  const windowed = await testing.convLoad(env, tenant, 'web', 'c-1');
  assert.equal(windowed.messages.length, testing.CONV_WINDOW);
  assert.equal(windowed.messages.at(-1).content, 'm29', 'la ventana es la COLA, no la cabeza');
  assert.equal(env.DB.msgs.filter((m) => m.conversation_id === tras72h.id).length, 31, 'guardado íntegro: 1 + 30');
});

test('«no supe contestar»: el patrón cuenta las respuestas sin resolver y no las normales', () => {
  const cuenta = (text) => testing.UNANSWERED_RE.test(text);
  assert.ok(cuenta('No lo sé, lo siento'));
  assert.ok(cuenta('No tengo esa información ahora mismo'));
  assert.ok(cuenta('No puedo confirmarte el precio'));
  assert.ok(cuenta('Eso lo consulto con el equipo y te digo'));
  // Conservador a propósito: en el informe del cliente es mejor contar de menos que
  // inflar «preguntas que no supe contestar».
  assert.ok(!cuenta('Claro, te lo reservo para el martes a las 10:00'));
  assert.ok(!cuenta('Tenemos hueco mañana por la mañana'));
  assert.ok(!cuenta('El corte de pelo cuesta 15 euros'));
  // «sé» con acento a propósito: «no se» sin acento es otro verbo y aparece en
  // respuestas perfectamente resueltas.
  assert.ok(!cuenta('No se admiten perros en la terraza'));
  assert.ok(!cuenta('No se puede pagar en efectivo, solo tarjeta'));
});

test('el chat web guarda el turno en D1 y NO gasta escrituras de KV en el historial', async () => {
  const worker = createWorker({ SYSTEM: 'VELAI', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: 'REGLA' });
  const ctx = { waitUntil() {} };
  const row = { id: 't-web', slug: 'zoe', name: 'Zoe', channel_address: 'web:zoe', active: 1, system_prompt: 'P'.repeat(60) };
  const kvPuts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('siteverify')) return new Response(JSON.stringify({ success: true, action: 'chat', hostname: 'zoetravelspain.com' }), { status: 200 });
    if (String(url).includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ text: 'No lo sé, te lo confirma el equipo.' }] }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  try {
    const env = {
      ALLOWED_WEB_ORIGINS: 'https://zoetravelspain.com', TURNSTILE_SECRET_KEY: 's', ANTHROPIC_API_KEY: 'k',
      KV: { async get() { return null; }, async put(k) { kvPuts.push(k); }, async delete() {} },
      DB: withConversations({ prepare: (sql) => ({ bind: (...args) => ({ first: async () => (sql.includes('slug = ?') && args[0] === 'zoe' ? row : null), all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 1 } }) }) }), batch: async () => [] }),
    };
    const res = await worker.fetch(new Request('https://worker.test/chat', {
      method: 'POST', headers: { Origin: 'https://zoetravelspain.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'f23e4567-e89b-42d3-a456-426614174001', message: '¿abrís el domingo?', tenant: 'zoe', turnstileToken: 'tok' }),
    }), env, ctx);
    assert.equal(res.status, 200);
    // El turno completo, en D1.
    assert.deepEqual(env.DB.history('t-web', 'web', 'f23e4567-e89b-42d3-a456-426614174001').map((m) => m.role), ['user', 'assistant']);
    // Y la respuesta era un «no lo sé»: queda contada para el informe semanal.
    assert.equal(env.DB.convs[0].msgs, 2);
    // El punto de docs/VOLUMEN-Y-ALMACENAMIENTO.md: el historial ya NO gasta cuota de KV
    // (era 1 de las 5 escrituras por turno contra un tope de 1.000/día).
    assert.deepEqual(kvPuts.filter((k) => k.startsWith('conv:')), []);
  } finally { globalThis.fetch = realFetch; }
});

function convDb(conversations, messages = {}) {
  return {
    prepare(sql) {
      return { bind: (...args) => ({
        first: async () => {
          if (!/WHERE c\.id = \?/.test(sql)) return null;
          const scoped = sql.includes('c.tenant_id = ?') ? conversations.filter((c) => c.tenant_id === args[1]) : conversations;
          return scoped.find((c) => c.id === args[0]) || null;
        },
        all: async () => {
          if (/FROM conv_messages/.test(sql)) return { results: messages[args[0]] || [] };
          if (!/FROM conversations c/.test(sql)) return { results: [] };
          let rows = conversations;
          if (sql.includes("c.demo = ''")) rows = rows.filter((c) => !c.is_demo);
          if (sql.includes('c.unanswered > 0')) rows = rows.filter((c) => c.unanswered > 0);
          if (sql.includes('c.tenant_id = ?')) rows = rows.filter((c) => c.tenant_id === args.at(-2));
          return { results: rows.map((c) => ({ ...c })) };
        },
        run: async () => ({ meta: { changes: 1 } }),
      }) };
    },
    batch: async () => [],
  };
}

const CONVS = [
  { id: '00000000-0000-4000-8000-0000000000b1', tenant_id: 't-mio', tenant_name: 'Mi Negocio', channel: 'web', msgs: 6, unanswered: 1, last_at: '2026-08-26T10:00:00Z', is_demo: 0, external_id: 'c-mia' },
  { id: '00000000-0000-4000-8000-0000000000b2', tenant_id: 't-otro', tenant_name: 'Otro Negocio', channel: 'whatsapp', msgs: 4, unanswered: 0, last_at: '2026-08-26T09:00:00Z', is_demo: 0, external_id: 'whatsapp:+34600000002' },
  { id: '00000000-0000-4000-8000-0000000000b3', tenant_id: 't-mio', tenant_name: 'Mi Negocio', channel: 'web', msgs: 2, unanswered: 0, last_at: '2026-08-26T08:00:00Z', is_demo: 1, external_id: 'c-demo' },
];

test('conversaciones en el panel: el cliente solo ve las suyas, la ajena es 404 y las demos no cuentan', async () => {
  const env = { KV: { async get() { return null; }, async put() {}, async delete() {} }, DB: convDb(CONVS, { '00000000-0000-4000-8000-0000000000b1': [{ role: 'user', text: '¿abrís?', created_at: 'x' }] }) };
  const ctx = { waitUntil() {} };
  const call = (path, scope) => testing.adminRouter(adminReq(path), env, ctx, path.split('?')[0], new URL('https://admin.hirevai.com' + path), {}, scope);

  // Listado del cliente: solo lo suyo, sin la demo y sin nombres de otros.
  const list = await (await call('/api/admin/conversations', CLIENTE)).json();
  assert.deepEqual(list.conversations.map((c) => c.id), ['00000000-0000-4000-8000-0000000000b1']);
  const raw = JSON.stringify(list);
  assert.ok(!raw.includes('Otro Negocio') && !raw.includes('tenant_name'), 'sin nombres de otros clientes');

  // La demo solo aparece si se pide explícitamente (es juego de rol de Velai, no del negocio).
  const conDemo = await (await call('/api/admin/conversations?demo=1', CLIENTE)).json();
  assert.deepEqual(conDemo.conversations.map((c) => c.id).sort(), ['00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b3']);

  // «Lo que el bot no supo contestar»: el filtro que convierte la lista en plan de acción.
  const sinResolver = await (await call('/api/admin/conversations?sinResolver=1', CLIENTE)).json();
  assert.deepEqual(sinResolver.conversations.map((c) => c.id), ['00000000-0000-4000-8000-0000000000b1']);

  // Velai las ve todas y CON el nombre del cliente.
  const todas = await (await call('/api/admin/conversations', VELAI)).json();
  assert.equal(todas.conversations.length, 2);
  assert.ok(JSON.stringify(todas).includes('Otro Negocio'));

  // La transcripción ajena es 404, nunca 403: un 403 confirmaría que existe.
  await assert.rejects(call('/api/admin/conversations/' + CONVS[1].id, CLIENTE), (e) => e.status === 404);
  const mia = await (await call('/api/admin/conversations/' + CONVS[0].id, CLIENTE)).json();
  assert.equal(mia.conversation.id, CONVS[0].id);
  assert.deepEqual(mia.messages.map((m) => m.text), ['¿abrís?']);
  assert.ok(!('tenant_name' in mia.conversation));
});

test('la retención de transcripciones es propia, acotada y más corta que la de los leads', () => {
  assert.equal(testing.convRetentionDays({}), 90, 'default');
  assert.equal(testing.convRetentionDays({ CONV_RETENTION_DAYS: '30' }), 30);
  // Basura y valores absurdos caen al default en vez de dejar la purga sin criterio.
  assert.equal(testing.convRetentionDays({ CONV_RETENTION_DAYS: '0' }), 90);
  assert.equal(testing.convRetentionDays({ CONV_RETENTION_DAYS: 'nope' }), 90);
  assert.equal(testing.convRetentionDays({ CONV_RETENTION_DAYS: '99999' }), 90);
});

// ── Informe semanal al canal del cliente (H1 §2, migración 0022) ─────────────
const LUNES = '2026-08-31T07:30:00.000Z';        // lunes, dentro de la ventana
const LUNES_TARDE = '2026-09-14T07:30:00.000Z';  // lunes con semana anterior ya registrada

test('informe semanal: la ventana es el lunes desde las 07:00 UTC y 24 h, y la semana es la anterior', () => {
  const p = testing.reportPeriod(LUNES);
  assert.ok(p, 'lunes 07:30 está dentro');
  assert.equal(p.start, '2026-08-24T00:00:00.000Z');
  assert.equal(p.end, '2026-08-31T00:00:00.000Z', 'la semana informada CIERRA el lunes: es la anterior');
  assert.equal(p.prev, '2026-08-17T00:00:00.000Z');
  assert.equal(p.key, '2026-08-24');
  // El martes de madrugada sigue dentro (24 h de ventana) y apunta a la MISMA semana:
  // así un fallo se reintenta en el tick siguiente en vez de esperar una semana.
  assert.equal(testing.reportPeriod('2026-09-01T03:00:00.000Z').key, '2026-08-24');
  // Fuera de la ventana no hay periodo, y por tanto la función no toca D1.
  assert.equal(testing.reportPeriod('2026-08-31T06:59:00.000Z'), null, 'lunes antes de las 7');
  assert.equal(testing.reportPeriod('2026-09-01T08:00:00.000Z'), null, 'martes ya pasado');
  assert.equal(testing.reportPeriod('2026-08-28T12:00:00.000Z'), null, 'viernes');
  assert.equal(testing.reportPeriod('2026-08-30T12:00:00.000Z'), null, 'domingo');
});

test('informe semanal: la comparación se calla cuando la semana anterior no estaba registrada', () => {
  assert.equal(testing.reportMetric('Leads', 6, 3, true), 'Leads: <b>6</b> <i>(▲ 3 más que la semana anterior)</i>');
  assert.equal(testing.reportMetric('Leads', 3, 6, true), 'Leads: <b>3</b> <i>(▼ 3 menos que la semana anterior)</i>');
  assert.equal(testing.reportMetric('Leads', 6, 6, true), 'Leads: <b>6</b> <i>(igual que la semana anterior)</i>');
  // Lo importante: sin comparable NO se inventa un -100% contra una semana que no existió.
  assert.equal(testing.reportMetric('Leads', 6, 0, false), 'Leads: <b>6</b>');
});

test('informe semanal: el texto lleva lo medido, y una semana en blanco manda a Canales', () => {
  const p = testing.reportPeriod(LUNES);
  const t = { name: 'GOgestión' };
  const texto = testing.weeklyReportText(t, { convs: 14, leads: 6, citas: 2, unans: 3 }, p, true);
  assert.match(texto, /TU SEMANA EN VELAI — GOGESTIÓN/);
  assert.match(texto, /del 24\/08 al 30\/08/, 'de lunes a domingo, no al lunes siguiente');
  assert.match(texto, /Conversaciones: <b>14<\/b>/);
  assert.match(texto, /Leads: <b>6<\/b>/);
  assert.match(texto, /Citas: <b>2<\/b>/);
  assert.match(texto, /no supe contestar: <b>3<\/b>/);
  assert.match(texto, /Solo con preguntas sin respuesta/, 'dice dónde mirarlas');
  // Sin preguntas sin respuesta, esa línea NO aparece (un 0 ahí es ruido).
  assert.ok(!/no supe contestar/.test(testing.weeklyReportText(t, { convs: 4, leads: 1, citas: 0, unans: 0 }, p, true)));
  // Semana en blanco: no se disfraza de informe con cuatro ceros; se aprovecha para lo
  // que este panel hace mejor que nadie.
  const vacia = testing.weeklyReportText(t, { convs: 0, leads: 0, citas: 0, unans: 0 }, p, true);
  assert.match(vacia, /no ha entrado ninguna conversación/);
  assert.match(vacia, /<b>Canales<\/b>/);
  assert.ok(!/Conversaciones: <b>0<\/b>/.test(vacia));
});

function reportDb(tenants, stats = {}) {
  const reports = new Map();   // "<tenant>|<period>" -> { status, attempts }
  return {
    reports,
    prepare(sql) {
      return { sql, bind: (...args) => ({
        sql, args,
        first: async () => null,
        all: async () => {
          if (/FROM tenants t/.test(sql)) {
            const [period, tries, limit] = args;
            const open = tenants.filter((t) => {
              const r = reports.get(t.id + '|' + period);
              return !r || (!['sent', 'skipped'].includes(r.status) && r.attempts < tries);
            });
            return { results: open.slice(0, limit) };
          }
          return { results: [] };
        },
        run: async () => {
          if (/INSERT INTO tenant_reports/.test(sql)) {
            const key = args[0] + '|' + args[1];
            const r = reports.get(key);
            if (!r) { reports.set(key, { status: 'sending', attempts: 1 }); return { meta: { changes: 1 } }; }
            if (['sent', 'skipped'].includes(r.status) || r.attempts >= 3) return { meta: { changes: 0 } };
            r.status = 'sending'; r.attempts += 1; return { meta: { changes: 1 } };
          }
          if (/UPDATE tenant_reports/.test(sql)) {
            const r = reports.get(args[3] + '|' + args[4]);
            if (r) { r.status = args[0]; r.detail = args[1]; }
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      }) };
    },
    batch: async (stmts) => stmts.map((st) => ({
      results: (stats[/FROM conversations/.test(st.sql) ? 'conv' : /FROM leads/.test(st.sql) ? 'leads' : 'citas'] || []),
    })),
  };
}

test('informe semanal: se manda una vez por semana, el sin-Telegram es un skip visible y va de cinco en cinco', async () => {
  const tenants = [
    { id: 't-a', slug: 'a', name: 'Alfa', telegram_chat_id: '-100', telegram_bot_token_enc: null },
    { id: 't-b', slug: 'b', name: 'Beta', telegram_chat_id: null, telegram_bot_token_enc: null },
  ];
  const db = reportDb(tenants, {
    conv: [{ tenant_id: 't-a', convs: 14, unans: 3, prev_convs: 11 }],
    leads: [{ tenant_id: 't-a', leads: 6, prev_leads: 6 }],
    citas: [{ tenant_id: 't-a', citas: 2, prev_citas: 1 }],
  });
  const env = { DB: db, TELEGRAM_TOKEN: 'tg' };
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.telegram.org')) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    await testing.sendWeeklyReports(env, LUNES_TARDE);
    assert.equal(sent.length, 1, 'solo el que tiene Telegram recibe');
    assert.equal(sent[0].chat_id, '-100');
    assert.match(sent[0].text, /Conversaciones: <b>14<\/b>/);
    assert.match(sent[0].text, /▲ 3 más que la semana anterior/, 'la semana anterior ya estaba registrada');
    // El que no tiene Telegram es un SKIP con su motivo, no un silencio.
    const key = (id) => id + '|' + testing.reportPeriod(LUNES_TARDE).key;
    assert.equal(db.reports.get(key('t-b')).status, 'skipped');
    assert.equal(db.reports.get(key('t-b')).detail, 'telegram_not_configured');
    assert.equal(db.reports.get(key('t-a')).status, 'sent');

    // Segundo tick del cron en la misma ventana: NI UN mensaje más. La idempotencia vive
    // en la tabla, no en la hora a la que se dispara el cron.
    await testing.sendWeeklyReports(env, LUNES_TARDE);
    assert.equal(sent.length, 1, 'un cron que se dispara dos veces no manda dos informes');

    // Fuera de la ventana no hace nada, ni siquiera consultar.
    let tocado = false;
    await testing.sendWeeklyReports({ DB: { prepare() { tocado = true; return { bind: () => ({ all: async () => ({ results: [] }) }) }; } } }, '2026-09-16T10:00:00.000Z');
    assert.equal(tocado, false, 'fuera de la ventana no toca D1');
  } finally { globalThis.fetch = realFetch; }
});

test('informe semanal: un fallo de Telegram queda como failed y se reintenta, con tope', async () => {
  const tenants = [{ id: 't-a', slug: 'a', name: 'Alfa', telegram_chat_id: '-100', telegram_bot_token_enc: null }];
  const db = reportDb(tenants, {});
  const env = { DB: db, TELEGRAM_TOKEN: 'tg' };
  const realFetch = globalThis.fetch;
  let intentos = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.telegram.org')) { intentos++; return new Response('nope', { status: 500 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    const key = 't-a|' + testing.reportPeriod(LUNES_TARDE).key;
    for (let i = 0; i < 5; i++) await testing.sendWeeklyReports(env, LUNES_TARDE);
    assert.equal(db.reports.get(key).status, 'failed');
    // Tope de 3: sin él, un fallo permanente reintentaría en cada tick del cron durante
    // las 24 h de la ventana (288 intentos).
    assert.equal(intentos, 3, 'tres intentos y para');
  } finally { globalThis.fetch = realFetch; }
});

test('prueba del informe: manda los últimos 7 días marcado como PRUEBA, y no consume el envío del lunes', async () => {
  const TID = '00000000-0000-4000-8000-0000000000e1';
  const row = { id: TID, slug: 'mio', name: 'Mi Negocio', telegram_chat_id: '-777', telegram_bot_token_enc: null };
  const writes = [];
  const db = {
    prepare(sql) {
      return { sql, bind: (...args) => ({
        sql, args,
        first: async () => (/FROM tenants WHERE id=\?/.test(sql) ? row : null),
        all: async () => ({ results: [] }),
        run: async () => { writes.push(sql); return { meta: { changes: 1 } }; },
      }) };
    },
    batch: async (stmts) => stmts.map((st) => ({
      results: /FROM conversations/.test(st.sql) ? [{ tenant_id: TID, convs: 9, unans: 2, prev_convs: 4 }]
        : /FROM leads/.test(st.sql) ? [{ tenant_id: TID, leads: 3, prev_leads: 1 }]
          : [{ tenant_id: TID, citas: 1, prev_citas: 0 }],
    })),
  };
  const env = { DB: db, KV: mapKV(), TELEGRAM_TOKEN: 'tg' };
  const ctx = { waitUntil() {} };
  const OWN = { role: 'cliente', tenantId: TID, email: 'cliente@x.com' };
  const path = `/api/admin/tenants/${TID}/report/test`;
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.telegram.org')) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    const res = await testing.adminRouter(adminReq(path, { method: 'POST', body: '{}' }), env, ctx, path, new URL('https://x' + path), {}, OWN);
    assert.equal((await res.json()).ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].chat_id, '-777');
    assert.match(sent[0].text, /🧪 <b>PRUEBA<\/b>/, 'va marcado: nadie lo confunde con el informe del lunes');
    assert.match(sent[0].text, /Conversaciones: <b>9<\/b>/);
    // Lo importante: una prueba NO puede consumir el envío real de la semana.
    assert.ok(!writes.some((w) => /tenant_reports/.test(w)), 'no toca tenant_reports');
    // El de otro tenant es 404, nunca 403.
    const ajeno = `/api/admin/tenants/00000000-0000-4000-8000-0000000000e9/report/test`;
    await assert.rejects(testing.adminRouter(adminReq(ajeno, { method: 'POST', body: '{}' }), env, ctx, ajeno, new URL('https://x' + ajeno), {}, OWN), (e) => e.status === 404);
    // Sin grupo vinculado no se finge que salió: 400 con el motivo que el panel ya traduce.
    row.telegram_chat_id = null;
    await assert.rejects(testing.adminRouter(adminReq(path, { method: 'POST', body: '{}' }), env, ctx, path, new URL('https://x' + path), {}, OWN),
      (e) => e.status === 400 && e.code === 'telegram_no_vinculado');
  } finally { globalThis.fetch = realFetch; }
});

// ── Bandeja: responder desde el panel (migración 0023) ───────────────────────
function windowEnv(lastIn) {
  return { DB: { prepare: () => ({ bind: () => ({ first: async () => ({ last_in: lastIn }), all: async () => ({ results: [] }), run: async () => ({}) }) }), batch: async () => [] } };
}

test('ventana de 24 h de Meta: abierta con horas, y cerrada CON MOTIVO en cada caso', async () => {
  const hace = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const conv = (over) => ({ id: 'c1', channel: 'whatsapp', inbox_address: 'whatsapp:+15550000001', state: 'humano', ...over });

  // Dentro de la ventana: abierta, y con la hora de cierre para que el panel pinte «quedan N h».
  const open = await testing.replyWindow(windowEnv(hace(2)), conv());
  assert.equal(open.open, true);
  assert.ok(new Date(open.closesAt) > new Date(), 'closesAt en el futuro');

  // Fuera: cerrada con motivo. Este es el 63016 que se evita ANTES de tocar Twilio.
  const shut = await testing.replyWindow(windowEnv(hace(30)), conv());
  assert.deepEqual({ open: shut.open, reason: shut.reason }, { open: false, reason: 'window_closed' });

  // El canal web no tiene ventana: tiene el problema opuesto (el widget no tiene por
  // dónde recibir). Se dice, no se finge.
  assert.equal((await testing.replyWindow(windowEnv(hace(1)), conv({ channel: 'web' }))).reason, 'web_reply_unsupported');
  // Conversación anterior a la migración: no sabemos por qué número contestar.
  assert.equal((await testing.replyWindow(windowEnv(hace(1)), conv({ inbox_address: null }))).reason, 'inbox_address_unknown');
  // Sin ningún mensaje entrante no hay ventana que abrir.
  assert.equal((await testing.replyWindow(windowEnv(null), conv())).reason, 'no_inbound');

  // La puerta nueva (migración 0025): el cajón SOLO se abre con el control tomado. Escribir
  // en una conversación que la IA sigue atendiendo mete dos voces en el mismo hilo.
  assert.equal((await testing.replyWindow(windowEnv(hace(1)), conv({ state: 'bot' }))).reason, 'atiende_la_ia');
  assert.equal((await testing.replyWindow(windowEnv(hace(1)), conv({ state: 'esperando' }))).reason, 'sin_control',
    'esperando: hay que tomar el control primero, y el panel lo dice así');
});

function inboxDb(conv, tenant, lastIn) {
  const writes = []; const batches = [];
  return {
    writes, batches,
    prepare(sql) {
      return { sql, bind: (...args) => ({
        sql, args,
        first: async () => {
          if (/FROM conversations c WHERE c\.id=\?/.test(sql)) {
            const scoped = sql.includes('c.tenant_id = ?') ? (conv.tenant_id === args[1] ? conv : null) : conv;
            return scoped && scoped.id === args[0] ? { ...scoped } : null;
          }
          if (/FROM tenants WHERE id=\?/.test(sql)) return tenant;
          if (/MAX\(created_at\)/.test(sql)) return { last_in: lastIn };
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
      }) };
    },
    batch: async (stmts) => { batches.push(stmts.map((st) => ({ sql: st.sql, args: st.args }))); return stmts.map(() => ({})); },
  };
}

test('responder desde el panel: sale por el número de LLEGADA, se guarda como agent y calla al bot', async () => {
  const CID = '00000000-0000-4000-8000-0000000000f1';
  const conv = { id: CID, tenant_id: 't-mio', channel: 'whatsapp', external_id: 'whatsapp:+34600000000',
    inbox_address: 'whatsapp:+15550000002', demo: '', msgs: 4, state: 'humano', agent_email: 'agente@cliente.com' };
  // twilio_from DISTINTO de inbox_address a propósito: es el fallo que la migración 0023
  // viene a evitar — el cliente final vería la respuesta llegar desde otro número.
  const tenant = { id: 't-mio', slug: 'mio', name: 'Mío', twilio_from: 'whatsapp:+15559999999', twilio_subaccount_sid: null };
  const db = inboxDb(conv, tenant, new Date(Date.now() - 3600000).toISOString());
  const kv = mapKV();
  const env = { DB: db, KV: kv, TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 'tok' };
  const ctx = { waitUntil() {} };
  const OWN = { role: 'cliente', tenantId: 't-mio', email: 'agente@cliente.com' };
  const path = `/api/admin/conversations/${CID}/reply`;
  const twilio = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.twilio.com')) { twilio.push(new URLSearchParams(String(init.body))); return new Response('{}', { status: 201 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    const res = await testing.adminRouter(adminReq(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Te confirmo la cita' }) }), env, ctx, path, new URL('https://x' + path), {}, OWN);
    assert.equal((await res.json()).ok, true);
    assert.equal(twilio.length, 1);
    assert.equal(twilio[0].get('From'), 'whatsapp:+15550000002', 'el número de LLEGADA, no twilio_from');
    assert.equal(twilio[0].get('To'), 'whatsapp:+34600000000');
    assert.equal(twilio[0].get('Body'), 'Te confirmo la cita');
    // Se guarda como 'agent' CON quién respondió: si se confundiera con el bot, la tasa
    // de resolución y «lo que no supo contestar» mentirían.
    const msg = db.batches.flat().find((st) => /INSERT INTO conv_messages/.test(st.sql));
    assert.equal(msg.args[1], 'agent');
    assert.equal(msg.args[2], 'agente@cliente.com');
    assert.equal(msg.args[3], 'Te confirmo la cita');
    // Y el bot se calla: la MISMA pausa del centinela [[HUMANO]], sin mecanismo nuevo.
    assert.ok(kv.map.has('pause:t-mio:whatsapp:+34600000000'), 'dos voces es peor que ninguna');
  } finally { globalThis.fetch = realFetch; }
});

test('responder desde el panel: fuera de ventana es 409 SIN tocar Twilio, y la ajena es 404', async () => {
  const CID = '00000000-0000-4000-8000-0000000000f2';
  const conv = { id: CID, tenant_id: 't-mio', channel: 'whatsapp', external_id: 'whatsapp:+34600000000', inbox_address: 'whatsapp:+15550000002', demo: '', msgs: 2, state: 'humano', agent_email: 'agente@cliente.com' };
  const tenant = { id: 't-mio', slug: 'mio', name: 'Mío', twilio_from: 'whatsapp:+15550000002' };
  const db = inboxDb(conv, tenant, new Date(Date.now() - 30 * 3600000).toISOString());
  const env = { DB: db, KV: mapKV(), TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 'tok' };
  const ctx = { waitUntil() {} };
  const OWN = { role: 'cliente', tenantId: 't-mio', email: 'agente@cliente.com' };
  const path = `/api/admin/conversations/${CID}/reply`;
  let twilioTocado = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { if (String(url).includes('api.twilio.com')) twilioTocado = true; return new Response('{}', { status: 201 }); };
  try {
    await assert.rejects(
      testing.adminRouter(adminReq(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hola' }) }), env, ctx, path, new URL('https://x' + path), {}, OWN),
      (e) => e.status === 409 && e.code === 'window_closed');
    assert.equal(twilioTocado, false, 'la guarda va ANTES de gastar una llamada a Twilio');
    // Conversación de otro tenant: 404, nunca 403 — un 403 confirmaría que existe.
    const ajena = { role: 'cliente', tenantId: 't-otro', email: 'otro@x.com' };
    await assert.rejects(
      testing.adminRouter(adminReq(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hola' }) }), env, ctx, path, new URL('https://x' + path), {}, ajena),
      (e) => e.status === 404);
  } finally { globalThis.fetch = realFetch; }
});

// ── Truncado por max_tokens (GOgestión, 2026-08-26) ──────────────────────────
test('un corte por max_tokens acaba en frase completa, no a mitad de palabra', () => {
  // El caso real: la respuesta se cortó en «te recomiendo que» y eso llegó al cliente final.
  const cortada = 'Primero, revisa el correo del 22 de agosto. Segundo, llama a la Subdelegación. Ahora bien, para acreditar tu NIE te recomiendo que';
  const limpia = testing.trimToSentence(cortada);
  assert.ok(limpia.endsWith('llama a la Subdelegación.'), 'acaba donde acababa la última frase');
  assert.ok(!limpia.includes('te recomiendo que'));
  // Interrogación y puntos suspensivos cuentan como fin de frase.
  assert.ok(testing.trimToSentence('¿Necesitas el NIE en físico o te vale el electrónico? Porque si es el').endsWith('electrónico?'));
  // Una respuesta que ya está completa no se toca.
  const entera = 'Te confirmo la cita para el martes a las 10:00.';
  assert.equal(testing.trimToSentence(entera), entera);
  // Cortada muy pronto: peor que una frase a medias es un saludo suelto, así que se
  // devuelve tal cual en vez de recortar hasta dejarla inútil.
  const pronto = 'Hola, soy Faby y te ayudo con';
  assert.equal(testing.trimToSentence(pronto), pronto);
});

test('el cuerpo de WhatsApp respeta el límite del canal recortando por frases', () => {
  // WhatsApp corta en 1.600 y Twilio rechaza de largo (21617): sin este guarda, subir
  // max_tokens cambiaría un truncado por un envío fallido — y eso el cliente final no lo
  // recibe en absoluto.
  const corto = 'Perfecto, te confirmo la cita.';
  assert.equal(testing.waBody(corto), corto, 'lo corto pasa intacto');
  const largo = ('Esta es una frase de relleno para pasar del límite del canal. ').repeat(40);
  const out = testing.waBody(largo);
  assert.ok(out.length <= 1500, 'dentro del límite del canal: ' + out.length);
  assert.ok(out.endsWith('.'), 'y cortado por una frase, no por una palabra');
});

test('una respuesta truncada se REGISTRA: hasta ahora stop_reason solo se miraba para tool_use', async () => {
  const env = { ANTHROPIC_API_KEY: 'k' };
  const logs = [];
  const realLog = console.log; console.log = (line) => logs.push(String(line));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    stop_reason: 'max_tokens', model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text: 'Primero revisa el correo. Segundo llama a la Subdelegación. Y para el NIE te recomiendo que' }],
  }), { status: 200 });
  try {
    const reply = await testing.callAnthropic(env, { model: 'claude-sonnet-4-6', max_tokens: 400, messages: [{ role: 'user', content: 'hola' }] }, { tenant: { slug: 'gogestion' } });
    assert.ok(reply.includes('llama a la Subdelegación.'), 'recortada en frase completa');
    assert.ok(!reply.includes('te recomiendo que'), 'sin la frase a medias');
    // Y NO se queda ahí: cierra ofreciendo el siguiente paso. Nadie se queda a mitad.
    assert.ok(reply.endsWith('?'), 'acaba invitando a seguir: ' + reply.slice(-60));
    const aviso = logs.map((l) => { try { return JSON.parse(l); } catch (_) { return {}; } }).find((l) => l.code === 'reply_truncated');
    assert.ok(aviso, 'queda rastro: antes esto era invisible');
    assert.equal(aviso.tenant, 'gogestion', 'y se sabe A QUIÉN le pasa, para poder subirle el tope');
  } finally { globalThis.fetch = realFetch; console.log = realLog; }
});

// ── «No podemos dejar a un cliente a mitad de una conversación» (Juan, 2026-08-26) ──
test('la regla de ESPACIO Y CIERRE viaja en las reglas de sistema de TODOS los tenants', async () => {
  // Vive en código a propósito, igual que las antiinyección: nadie la desactiva editando
  // una fila de D1. Este test es el que impide que desaparezca en un refactor del prompt.
  const src = await readFile(new URL('../vai-worker.js', import.meta.url), 'utf8');
  assert.match(src, /== ESPACIO Y CIERRE ==/);
  assert.match(src, /se corta por la mitad/, 'le dice POR QUÉ importa, no solo el límite');
  assert.match(src, /CIERRA ofreciendo el siguiente paso/, 'y qué hacer en su lugar');
  assert.match(src, /agendar una cita/);
  assert.match(src, /Nunca dejes una enumeración a medias/);
});

test('si se corta igual, el cierre ofrece el siguiente paso y CABE en el canal', () => {
  const truncado = { stop_reason: 'max_tokens', model: 'claude-sonnet-4-6' };
  const largo = 'Para la nacionalidad por residencia necesitas varios documentos. '.repeat(40);

  // Con calendario conectado el cierre propone CITA: es el que cierra la venta.
  const conCita = testing.settleReply(truncado, { closing: 'cita', bodyLimit: 1500 }, largo);
  assert.match(conCita, /¿te agendo una cita\?$/);
  assert.ok(conCita.length <= 1500, 'cabe en WhatsApp: ' + conCita.length);

  // Sin calendario, propone que escriba el equipo: nunca se queda en el aire.
  const sinCita = testing.settleReply(truncado, { closing: 'equipo', bodyLimit: 1500 }, largo);
  assert.match(sinCita, /el equipo te escriba/);
  assert.ok(sinCita.length <= 1500);

  // Lo importante del presupuesto: el cierre se reserva ANTES de recortar. Si se añadiera
  // después, el guarda del canal lo cortaría y se comería justo el cierre.
  assert.equal(testing.waBody(conCita), conCita, 'el guarda del canal ya no tiene que tocarlo');

  // Sin truncado no se toca nada: no se le añade un cierre a una respuesta que ya cerró.
  const entera = 'Te confirmo la cita del martes a las 10:00.';
  assert.equal(testing.settleReply({ stop_reason: 'end_turn' }, { closing: 'cita' }, entera), entera);
});

// ── Saldo de IA visible para el cliente (migración 0024) ─────────────────────
function balanceDb(row, totals, serie = []) {
  return {
    prepare(sql) {
      return { bind: (...args) => ({
        first: async () => (/FROM tenants WHERE id=\?/.test(sql) ? (row && row.id === args[0] ? row : null) : totals),
        all: async () => ({ results: serie }),
        run: async () => ({ meta: { changes: 1 } }),
      }) };
    },
    batch: async () => [],
  };
}

test('saldo de IA: el cliente ve tokens y porcentaje, y NUNCA el coste', async () => {
  const TID = '00000000-0000-4000-8000-000000000a01';
  const env = { DB: balanceDb({ id: TID, name: 'Mío', ai_monthly_tokens: null }, { mes: 1207480, hoy: 48300, llamadas: 310 }),
    KV: mapKV(), AI_TENANT_MONTHLY_TOKENS: '3000000' };
  const ctx = { waitUntil() {} };
  const OWN = { role: 'cliente', tenantId: TID, email: 'cliente@x.com' };
  const path = '/api/admin/ai-balance';
  const d = await (await testing.adminRouter(adminReq(path), env, ctx, path, new URL('https://x' + path), {}, OWN)).json();
  assert.equal(d.included, 3000000, 'sin columna, el default del toml');
  assert.equal(d.used, 1207480);
  assert.equal(d.remaining, 1792520, 'el saldo BAJA: es lo que pidió Juan');
  assert.equal(d.pct, 40);
  assert.equal(d.usedToday, 48300);
  assert.equal(d.over, false);
  // Lo que NO puede salir nunca: enseñarle al cliente lo que pagamos por él es enseñarle
  // el margen. La tarjeta en dólares es velai-only por eso.
  const raw = JSON.stringify(d);
  assert.ok(!/cost|coste|usd|eur|\$/i.test(raw), 'ni una pista de coste: ' + raw.slice(0, 120));
});

test('saldo de IA: pasarse no rompe la barra ni deja el saldo en negativo', async () => {
  const TID = '00000000-0000-4000-8000-000000000a02';
  // Plan propio en la fila (pisa al default) y consumo por encima.
  const env = { DB: balanceDb({ id: TID, name: 'Mío', ai_monthly_tokens: 1000000 }, { mes: 1400000, hoy: 90000, llamadas: 500 }),
    KV: mapKV(), AI_TENANT_MONTHLY_TOKENS: '3000000' };
  const ctx = { waitUntil() {} };
  const OWN = { role: 'cliente', tenantId: TID, email: 'cliente@x.com' };
  const path = '/api/admin/ai-balance';
  const d = await (await testing.adminRouter(adminReq(path), env, ctx, path, new URL('https://x' + path), {}, OWN)).json();
  assert.equal(d.included, 1000000, 'la columna del cliente manda sobre el default');
  assert.equal(d.remaining, 0, 'nunca negativo');
  assert.equal(d.pct, 100, 'la barra se acota: un 140% no significa nada');
  assert.equal(d.over, true, 'pero se sabe que se pasó, para poder decírselo');
});

test('saldo de IA: un cliente no puede pedir el saldo de otro', async () => {
  const TID = '00000000-0000-4000-8000-000000000a03';
  const env = { DB: balanceDb({ id: TID, name: 'Mío', ai_monthly_tokens: null }, { mes: 10, hoy: 1, llamadas: 1 }), KV: mapKV() };
  const ctx = { waitUntil() {} };
  const OWN = { role: 'cliente', tenantId: TID, email: 'cliente@x.com' };
  const ajeno = '/api/admin/ai-balance?tenant=00000000-0000-4000-8000-000000000a99';
  await assert.rejects(
    testing.adminRouter(adminReq(ajeno), env, ctx, '/api/admin/ai-balance', new URL('https://x' + ajeno), {}, OWN),
    (e) => e.status === 404, 'el de otro es 404, no el suyo por defecto');
});

test('el plan de IA se edita desde la ficha: sin eso, el aviso al 80% mandaría a un sitio que no existe', () => {
  // El mensaje del aviso dice «súbele el límite en su ficha», así que el campo tiene que
  // existir y validar. Vacío = NULL = default del worker.
  assert.deepEqual(testing.validateTenant({ ai_monthly_tokens: '8000000', ai_daily_limit: '2500' }, { partial: true }),
    { ai_monthly_tokens: 8000000, ai_daily_limit: 2500 });
  assert.deepEqual(testing.validateTenant({ ai_monthly_tokens: '', ai_daily_limit: '' }, { partial: true }),
    { ai_monthly_tokens: null, ai_daily_limit: null });
  assert.throws(() => testing.validateTenant({ ai_monthly_tokens: 'muchos' }, { partial: true }));
  assert.throws(() => testing.validateTenant({ ai_daily_limit: '0' }, { partial: true }), 'un cupo de 0 dejaría al cliente mudo');
});

test('el panel no referencia ids que no existen: uno solo mata TODO el script', async () => {
  // Clase de fallo que el check del bundle NO puede cazar (su DOM stub devuelve un proxy
  // para cualquier querySelector) y que deja el panel entero en blanco: un $('#x').onclick
  // a nivel de módulo sobre un id que ya no está lanza y aborta el arranque.
  const js = await readFile(new URL('../worker/admin-panel.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../worker/admin-page.js', import.meta.url), 'utf8');
  const ids = new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));
  // Un id vale si está en el HTML estático O si el propio panel lo pinta (el modal del
  // lead y el cajón de la bandeja se construyen con innerHTML). Sin lista a mano: así el
  // test no se queda obsoleto cada vez que aparece un elemento dinámico.
  const huerfanos = [...ids].filter((id) => !html.includes(`id="${id}"`) && !js.includes(`id="${id}"`));
  assert.deepEqual(huerfanos, [], 'ids que el panel usa y NADIE crea');
});

test('el panel no pierde manejadores por el camino: inventario congelado', async () => {
  // Tripwire por el incidente del 2026-08-26: al sustituir la vista de Conversaciones por
  // la bandeja se reemplazó un bloque delimitado por dos comentarios y se llevó por delante
  // lo que había en medio — logout, cambio de tema, filtros y exportar de leads, el cerrar
  // del modal, la apertura de la ficha del lead y wireDetail. Todo dejó de funcionar EN
  // SILENCIO: el panel arrancaba perfectamente y ningún test se enteró.
  //
  // Este test no mira si funcionan: mira que SIGAN EXISTIENDO. Es un inventario, y si
  // añades una función o un manejador nuevo tienes que meterlo aquí a propósito — el
  // trabajo extra es justamente el punto: obliga a mirar qué desapareció.
  const js = await readFile(new URL('../worker/admin-panel.js', import.meta.url), 'utf8');
  const fns = new Set([...js.matchAll(/^(?:async )?function ([A-Za-z0-9_]+)/gm)].map((m) => m[1]));
  const handlers = new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)\.(?:onclick|onsubmit|onchange|oninput)/g)].map((m) => m[1]));

  // Funciones que sostienen una vista entera. Si falta una, esa vista está muerta.
  const FUNCIONES = ['applyTheme', 'openLead', 'wireDetail', 'load', 'loadStats', 'loadTenants',
    'loadAiUsage', 'loadInfra', 'loadSaldo', 'loadInbox', 'renderThread', 'composer', 'sendReply',
    'loadConexiones', 'cxMenu', 'loadChannels', 'loadTenantList', 'loadAdmins', 'loadConfig',
    'loadAvailability', 'control', 'shToForm', 'shFromForm', 'shSummary',
    'calMenu', 'loadEscalations', 'whoOf', 'prevPrefix', 'chTabs', 'convParams', 'api', 'toast', 'paint'];
  const sinFuncion = FUNCIONES.filter((f) => !fns.has(f));
  assert.deepEqual(sinFuncion, [], 'funciones del panel desaparecidas');

  // Elementos con manejador. Uno menos = un botón que no hace nada, y eso no lo cazan ni
  // node --check ni check-bundle ni el test de ids.
  const CLICABLES = ['logout', 'themeBtn', 'filters', 'more', 'export', 'close', 'rows',
    'saveStatus', 'retry', 'addNote', 'delete', 'convRows', 'convFilters', 'convExport', 'chTabs',
    'aiDays', 'escalations', 'tenantRows', 'newTenant', 'tenantSave', 'tenantClose', 'tenantPreview',
    'wizBack', 'wizNext', 'tDupSel', 'ttabs', 'tLogoUp', 'tVersions', 'tSyncDomains',
    'uAdd', 'tUsersList', 'aAdd', 'adminsList', 'cfgTokenSave', 'cfgTokenClear',
    'cxTenantSel', 'cxLogoUp', 'cxLogoApply', 'nfSave', 'wrToggle', 'wrTest', 'availToggle', 'shSave', 'shCopy',
    'tgLink', 'tgUnlink', 'tgWlToggle', 'tgBotSave', 'tgBotDel', 'tgSetup', 'tgTopicAdd', 'tgTopics',
    'calTenantSel', 'calGrid', 'calToday', 'calPrev', 'calNext', 'calBack',
    'calConnect', 'calReconnect', 'calDisconnect', 'calSave', 'calDayClose',
    'chQ', 'chTenant', 'chState', 'waSync', 'waProfile',
    'pSub', 'pTpl', 'pTplRe', 'pTplChk', 'pSender', 'pVerify'];
  const sinManejador = CLICABLES.filter((id) => !handlers.has(id));
  assert.deepEqual(sinManejador, [], 'elementos del panel que se quedaron sin manejador');
});
// ── Handoff con horario (migración 0025) ─────────────────────────────────────
// Regla de Juan: el BOT no tiene restricción horaria; hablar con una persona SÍ.
const L_A_V = '2026-08-26T12:00:00Z';   // miércoles 14:00 en Madrid
test('horario de asesores: el default es L-V 9-19 y la medianoche no se cuela', () => {
  const t = { support_hours: null, support_tz: 'Europe/Madrid' };
  assert.equal(testing.withinSupportHours(t, Date.parse(L_A_V)), true, 'miércoles 14:00');
  assert.equal(testing.withinSupportHours(t, Date.parse('2026-08-26T05:00:00Z')), false, 'miércoles 07:00, antes de abrir');
  assert.equal(testing.withinSupportHours(t, Date.parse('2026-08-26T18:00:00Z')), false, 'miércoles 20:00, ya cerrado');
  assert.equal(testing.withinSupportHours(t, Date.parse('2026-08-30T12:00:00Z')), false, 'domingo');
  // La medianoche es el caso que rompe si el formateador devuelve «24:00» en vez de «00:00»:
  // la comparación de cadenas dejaría fuera toda la primera hora del día.
  const nocturno = { support_hours: JSON.stringify({ thu: [['00:00', '02:00']] }), support_tz: 'Europe/Madrid' };
  assert.equal(testing.withinSupportHours(nocturno, Date.parse('2026-08-26T22:00:00Z')), true, 'jueves 00:00 en Madrid');

  // Horario propio del cliente, con dos ventanas (mañana y tarde).
  const partido = { support_hours: JSON.stringify({ wed: [['09:00', '13:00'], ['16:00', '19:00']] }), support_tz: 'Europe/Madrid' };
  assert.equal(testing.withinSupportHours(partido, Date.parse('2026-08-26T09:00:00Z')), true, '11:00, dentro de la mañana');
  assert.equal(testing.withinSupportHours(partido, Date.parse('2026-08-26T12:30:00Z')), false, '14:30, en la pausa');
  assert.equal(testing.withinSupportHours(partido, Date.parse('2026-08-26T15:00:00Z')), true, '17:00, dentro de la tarde');

  // Zona horaria basura en la fila: se cae al default en vez de dejar de atender.
  assert.equal(testing.withinSupportHours({ support_hours: null, support_tz: 'Marte/Olympus' }, Date.parse(L_A_V)), true);
  // Y un JSON corrupto también cae al default, no deja el horario vacío.
  assert.equal(testing.withinSupportHours({ support_hours: '{roto', support_tz: 'Europe/Madrid' }, Date.parse(L_A_V)), true);
});

test('asesor disponible = interruptor de alguien Y dentro de horario', async () => {
  const presencia = (n) => ({
    prepare: () => ({ bind: () => ({ first: async () => ({ n }), all: async () => ({ results: [] }), run: async () => ({}) }) }),
    batch: async () => [],
  });
  const dentro = { id: 't-1', support_hours: JSON.stringify({ wed: [['09:00', '19:00']] }), support_tz: 'Europe/Madrid' };
  // Nota: withinSupportHours usa Date.now(), así que estos dos casos comprueban la
  // combinación, no la hora — el horario ya está cubierto arriba con reloj inyectado.
  const fuera = { id: 't-1', support_hours: JSON.stringify({}), support_tz: 'Europe/Madrid' };
  assert.equal(await testing.advisorAvailable({ DB: presencia(1) }, fuera), false, 'fuera de horario, aunque haya interruptor');
  assert.equal(await testing.advisorAvailable({ DB: presencia(0) }, dentro), false, 'en horario pero sin nadie disponible');
  // Sin la tabla (deploy antes de migrar) no hay asesores y el bot sigue: el seguro es
  // que el cliente final NUNCA se quede sin quien le atienda.
  const revienta = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('no such table'); } }) }) };
  assert.equal(await testing.advisorAvailable({ DB: revienta }, dentro), false);
  assert.equal(await testing.advisorAvailable({}, dentro), false, 'sin DB tampoco');
});

function handoffDb(conv, tenantRow, presencia = { n: 0 }, mine = null) {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return { bind: (...args) => ({
        first: async () => {
          if (/FROM tenants WHERE id=\?/.test(sql)) return tenantRow && tenantRow.id === args[0] ? tenantRow : null;
          if (/FROM conversations c WHERE c\.id=\?/.test(sql)) {
            const scoped = sql.includes('c.tenant_id = ?') ? (conv.tenant_id === args[1] ? conv : null) : conv;
            return scoped && scoped.id === args[0] ? { ...scoped } : null;
          }
          if (/COUNT\(\*\) AS n FROM agent_presence/.test(sql)) return presencia;
          if (/SELECT available FROM agent_presence/.test(sql)) return mine;
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
      }) };
    },
    batch: async () => [],
  };
}

test('tomar el control: cerrojo por conversación, y si ya la tiene otra persona se dice quién', async () => {
  const CID = '00000000-0000-4000-8000-000000000b01';
  const conv = { id: CID, tenant_id: 't-mio', channel: 'whatsapp', external_id: 'whatsapp:+34600000000', state: 'esperando', agent_email: null };
  const db = handoffDb(conv, { id: 't-mio' });
  const kv = mapKV();
  const env = { DB: db, KV: kv };
  const ctx = { waitUntil() {} };
  const OWN = { role: 'cliente', tenantId: 't-mio', email: 'ana@cliente.com' };
  const call = (accion, scope) => { const p = `/api/admin/conversations/${CID}/${accion}`;
    return testing.adminRouter(adminReq(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), env, ctx, p, new URL('https://x' + p), {}, scope); };

  const d = await (await call('takeover', OWN)).json();
  assert.deepEqual({ state: d.state, quien: d.agent_email }, { state: 'humano', quien: 'ana@cliente.com' });
  const upd = db.writes.find((w) => /state='humano'/.test(w.sql));
  assert.equal(upd.args[0], 'ana@cliente.com', 'se guarda QUIÉN tomó el control');

  // Otra persona del mismo cliente no puede pisarla: dos escribiendo a la vez creyendo cada
  // una que la otra no está es peor que no poder entrar.
  conv.state = 'humano'; conv.agent_email = 'ana@cliente.com';
  await assert.rejects(call('takeover', { role: 'cliente', tenantId: 't-mio', email: 'luis@cliente.com' }),
    (e) => e.status === 409 && e.code === 'ya_tomada');
  // Quien ya la tiene puede volver a pulsar sin error (idempotente).
  assert.equal((await (await call('takeover', OWN)).json()).state, 'humano');

  // Devolver: la IA retoma, y la pausa se borra con el tenant y el destinatario REALES.
  kv.map.set('pause:t-mio:whatsapp:+34600000000', '1');
  assert.equal((await (await call('release', OWN)).json()).state, 'bot');
  assert.ok(!kv.map.has('pause:t-mio:whatsapp:+34600000000'), 'la pausa se levanta al devolver el control');

  // Una conversación que la IA atiende no tiene control que tomar.
  conv.state = 'bot'; conv.agent_email = null;
  await assert.rejects(call('takeover', OWN), (e) => e.status === 409 && e.code === 'nada_que_tomar');
  // Y la de otro cliente es 404, nunca 403.
  await assert.rejects(call('takeover', { role: 'cliente', tenantId: 't-otro', email: 'x@y.com' }), (e) => e.status === 404);
});

test('disponibilidad: el interruptor es por persona y el horario lo cierra por fuera', async () => {
  const TID = '00000000-0000-4000-8000-000000000b02';
  // Horario vacío = fuera de horario siempre: el interruptor no basta.
  const cerrado = { id: TID, support_hours: JSON.stringify({}), support_tz: 'Europe/Madrid' };
  const db = handoffDb({ id: 'x' }, cerrado, { n: 1 }, { available: 1 });
  const env = { DB: db, KV: mapKV() };
  const ctx = { waitUntil() {} };
  const OWN = { role: 'cliente', tenantId: TID, email: 'ana@cliente.com' };
  const path = '/api/admin/availability';
  const d = await (await testing.adminRouter(adminReq(path), env, ctx, path, new URL('https://x' + path), {}, OWN)).json();
  assert.equal(d.available, true, 'su interruptor está encendido');
  assert.equal(d.withinHours, false, 'pero fuera de horario');
  assert.equal(d.offering, false, 'así que NO se ofrece asesor: el bot atiende');
  assert.equal(d.graceMin, testing.TAKEOVER_GRACE_MIN);
  // El PATCH escribe la presencia de ESA persona, no del cliente entero.
  const patch = await testing.adminRouter(adminReq(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ available: true }) }), env, ctx, path, new URL('https://x' + path), {}, OWN);
  assert.equal((await patch.json()).available, true);
  const ins = db.writes.find((w) => /INSERT INTO agent_presence/.test(w.sql));
  assert.deepEqual([ins.args[0], ins.args[1], ins.args[2]], [TID, 'ana@cliente.com', 1]);
});

test('la espera de toma de control vence: la IA retoma y avisa de que no hay asesores', async () => {
  assert.equal(testing.graceExpired(new Date(Date.now() - 6 * 60000).toISOString()), true, '6 min: vencida');
  assert.equal(testing.graceExpired(new Date(Date.now() - 60000).toISOString()), false, '1 min: aún espera');
  // Sin marca de tiempo se considera VENCIDA: una fila a medias no puede dejar al cliente
  // final esperando para siempre.
  assert.equal(testing.graceExpired(null), true);
  assert.equal(testing.graceExpired('no es una fecha'), true);

  const conv = { id: 'c-1', tenant_id: 't-1', external_id: 'whatsapp:+34600000000', channel: 'whatsapp',
    inbox_address: 'whatsapp:+15550000001', demo: '', msgs: 4 };
  const tenant = { id: 't-1', slug: 'mio', name: 'Mío', twilio_from: 'whatsapp:+15550000001' };
  const writes = []; const batches = [];
  const env = {
    KV: mapKV(), TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 'tok',
    DB: {
      prepare(sql) {
        return { sql, bind: (...args) => ({
          sql, args,
          first: async () => (/FROM tenants WHERE id=\?/.test(sql) ? tenant : null),
          all: async () => ({ results: /FROM conversations WHERE state='esperando'/.test(sql) ? [conv] : [] }),
          run: async () => { writes.push({ sql, args }); return { meta: { changes: 1 } }; },
        }) };
      },
      batch: async (stmts) => { batches.push(stmts.map((st) => ({ sql: st.sql, args: st.args }))); return stmts.map(() => ({})); },
    },
  };
  env.KV.map.set('pause:t-1:whatsapp:+34600000000', '1');
  const enviados = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.twilio.com')) { enviados.push(new URLSearchParams(String(init.body))); return new Response('{}', { status: 201 }); }
    return new Response('{}', { status: 200 });
  };
  try {
    await testing.expireTakeovers(env);
    // 1) se libera: si no, la conversación quedaría congelada y el bot no volvería nunca.
    assert.ok(writes.some((w) => /state='bot'/.test(w.sql)), 'vuelve a estado bot');
    assert.ok(!env.KV.map.has('pause:t-1:whatsapp:+34600000000'), 'y se levanta la pausa');
    // 2) avisa al cliente final, por el número de LLEGADA.
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].get('From'), 'whatsapp:+15550000001');
    assert.equal(enviados[0].get('To'), 'whatsapp:+34600000000');
    assert.match(enviados[0].get('Body'), /no tengo a nadie del equipo disponible/);
    // 3) y queda en el historial: si no, el panel enseñaría un salto del silencio a la nada.
    const guardado = batches.flat().find((st) => /INSERT INTO conv_messages/.test(st.sql));
    assert.equal(guardado.args[1], 'assistant');
    assert.equal(guardado.args[3], testing.NO_ADVISOR_TEXT);
  } finally { globalThis.fetch = realFetch; }
});

test('el bot sabe si puede ofrecer una persona: va en el bloque VOLÁTIL del prompt', () => {
  const config = { SYSTEM: 'BASE', GUARDRAILS: 'REGLAS' };
  const tenant = { system_prompt: 'P'.repeat(60) };
  const con = testing.systemWithHandoff(config, tenant, true);
  const sin = testing.systemWithHandoff(config, tenant, false);
  // El bloque ESTABLE es idéntico en los dos: si el aviso de disponibilidad entrara ahí,
  // partiría el caché de prompt en dos por cliente y cada turno pagaría escritura.
  assert.equal(con[0].text, sin[0].text, 'el bloque cacheado no cambia');
  assert.equal(con[0].cache_control.type, 'ephemeral');
  assert.equal(con[1].cache_control, undefined, 'el volátil NO se cachea');
  // Y dice lo que toca: fuera de horario, que NO ofrezca pasar con una persona.
  assert.match(sin[1].text, /NO ofrezcas pasar la conversación a una persona/);
  assert.match(sin[1].text, /NO uses el marcador/);
  assert.match(con[1].text, /\[\[HUMANO\]\]/);
});

test('horario de atención humana: se valida como el del calendario, y vacío = default', () => {
  assert.deepEqual(testing.validateTenant({ support_hours: '', support_tz: '' }, { partial: true }),
    { support_hours: null, support_tz: null }, 'vacío = NULL = L-V 9-19');
  const ok = testing.validateTenant({ support_hours: '{"mon":[["09:00","14:00"],["16:00","19:00"]],"sat":[["10:00","13:00"]]}' }, { partial: true });
  assert.deepEqual(JSON.parse(ok.support_hours).sat, [['10:00', '13:00']]);
  // Basura dentro: si entrara, la interacción humana quedaría abierta o cerrada a lo loco.
  assert.throws(() => testing.validateTenant({ support_hours: '{roto' }, { partial: true }));
  assert.throws(() => testing.validateTenant({ support_hours: '{"lunes":[["09:00","14:00"]]}' }, { partial: true }), 'día inventado');
  assert.throws(() => testing.validateTenant({ support_hours: '{"mon":[["9:00","14:00"]]}' }, { partial: true }), 'hora sin dos dígitos');
  assert.throws(() => testing.validateTenant({ support_hours: '{"mon":[["19:00","09:00"]]}' }, { partial: true }), 'ventana al revés');
  assert.throws(() => testing.validateTenant({ support_hours: '[["09:00","14:00"]]' }, { partial: true }), 'array en vez de objeto');
});
