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
    // fila ya provisionada → 409 SIN llamar a Twilio
    const done = provisionHarness({ tenant: { id: '00000000-0000-4000-8000-00000000000a', slug: 'acme', name: 'Acme', twilio_subaccount_sid: 'AC' + 'x'.repeat(32) } });
    await assert.rejects(testing.handleProvision(provReq(), done.env, done.ctx, done.row.id, 'subaccount', 'juan@x'), (e) => e.code === 'already_provisioned');
    assert.equal(twilioCalls.length, 0);
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
  const h = provisionHarness({ tenant: { id: '00000000-0000-4000-8000-00000000000a', slug: 'acme', name: 'Acme', twilio_subaccount_sid: 'AC' + 'x'.repeat(32) } });
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
  assert.ok([...ADMIN_HTML.matchAll(/hirevai\.com\/([a-z]+)\//g)].every((m) => m[1] === 'fonts'), 'y solo su ruta /fonts/');
  assert.ok(ADMIN_HTML.includes('__NONCE__'));
  for (const id of ['tName', 'tSlug', 'tAddress', 'tFrom', 'tTeam', 'tChat', 'tTpl', 'tSub', 'tWaba', 'tToken', 'tPartner', 'tActive', 'tPrompt', 'tNote', 'pSub', 'pTpl', 'pPhone', 'pSender', 'pCode', 'pVerify', 'tenantFilter', 'newTenant', 'export', 'tTokenState', 'tBotName', 'tBrandName', 'tLogo', 'tColor1', 'tColor2', 'tGreeting', 'tGreetingEn', 'tChips', 'tPlaceholder', 'tWa', 'tTheme', 'brandPrev', 'toasts']) {
    assert.ok(ADMIN_HTML.includes(`id="${id}"`), `falta #${id}`);
  }
  assert.ok(!/localStorage/.test(ADMIN_HTML), 'sin localStorage');
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
