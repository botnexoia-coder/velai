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
  const env = { ALLOWED_WEB_ORIGINS: 'https://hirevai.com' };
  const publicResponse = await worker.fetch(new Request('https://worker.test/lead', { method: 'POST', headers: { Origin: 'https://evil.test' } }), env, ctx);
  assert.equal(publicResponse.status, 403);
  assert.equal((await publicResponse.json()).error, 'origin_not_allowed');
  const adminResponse = await worker.fetch(new Request('https://admin.hirevai.com/api/admin/leads'), env, ctx);
  assert.equal(adminResponse.status, 401);
});
