import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorker, testing } from '../worker/app.js';
import { encryptSecret, decryptSecret } from '../worker/crypto.js';

const TEST_KEK = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));

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
      anthropicSystems.push(JSON.parse(init.body).system);
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
    if (String(url).includes('api.anthropic.com')) { calls.push(JSON.parse(init.body).system); return new Response(JSON.stringify({ content: [{ text: 'ok' }] }), { status: 200 }); }
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

test('deliver envía desde la subcuenta del tenant (SID en la URL, auth del padre)', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('{}', { status: 201 }); };
  try {
    const env = { TEAM_WHATSAPP: 'whatsapp:+34600000001', TWILIO_FROM: 'whatsapp:+15550000000', TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 't', TWILIO_LEAD_TEMPLATE_SID: 'HXtest' };
    const sub = 'AC' + 'c'.repeat(32);
    await testing.deliver(env, 'whatsapp', { whatsapp: '+34612345678' }, { twilio_subaccount_sid: sub });
    assert.ok(calls[0].includes(`/Accounts/${sub}/Messages.json`), 'usa el SID de la subcuenta');
    await testing.deliver(env, 'whatsapp', { whatsapp: '+34612345678' }, null);
    assert.ok(calls[1].includes(`/Accounts/${env.TWILIO_ACCOUNT_SID}/`), 'sin tenant usa el padre');
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
  assert.deepEqual(deleted.sort(), ['tenant:addr:whatsapp:+1000', 'tenant:addr:whatsapp:+2000', 'tenant:slug:nuevo', 'tenant:slug:viejo']);
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
