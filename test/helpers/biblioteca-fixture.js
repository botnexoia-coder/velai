import { sqliteD1 } from './sqlite-d1.js';
import { testing, createWorker } from '../../worker/app.js';
export const MEDIA_TENANT = '00000000-0000-4000-8000-00000000000a';
export const MEDIA_OTHER = '00000000-0000-4000-8000-00000000000b';
export function mediaBytes(signature = '%PDF-1.7', size = 64) {
  const bytes = new Uint8Array(size); bytes.set(new TextEncoder().encode(signature)); return bytes;
}
export async function bibliotecaFixture() {
  const DB = await sqliteD1();
  await DB.exec('PRAGMA foreign_keys=ON;');
  const now = new Date().toISOString();
  for (const [id, slug, address] of [[MEDIA_TENANT, 'biblioteca', 'whatsapp:+34910000001'], [MEDIA_OTHER, 'ajeno', 'whatsapp:+34910000002']]) {
    await DB.prepare('INSERT INTO tenants(id,slug,name,channel_address,system_prompt,web_origins,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, slug, slug, address, 'Ayuda con las tarifas del negocio.', '["https://library.test"]', now, now).run();
  }
  const objects = new Map(), kv = new Map(), waits = [];
  const env = { DB, MEDIA_QUOTA_BYTES: '524288000', PUBLIC_MEDIA_BASE: 'https://api.hirevai.com', ADMIN_ORIGIN: 'https://admin.hirevai.com',
    ALLOWED_WEB_ORIGINS: 'https://library.test', DEFAULT_TENANT_SLUG: 'biblioteca', TURNSTILE_SECRET_KEY: 'test', ANTHROPIC_API_KEY: 'test', TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'test-token',
    KV: { get: async (key, type) => { const v = kv.get(key) || null; return type === 'json' && v ? JSON.parse(v) : v; }, put: async (key, value) => kv.set(key, value), delete: async (key) => kv.delete(key), getWithMetadata: async () => null },
    MEDIA: {
      async put(key, bytes, options) { objects.set(key, { bytes: new Uint8Array(bytes), contentType: options.httpMetadata.contentType }); },
      async get(key) { const r = objects.get(key); return r ? { body: r.bytes, httpMetadata: { contentType: r.contentType }, httpEtag: '"test"' } : null; },
      async delete(key) { objects.delete(key); },
    },
  };
  const scope = { role: 'cliente', email: 'cliente@test.local', tenantId: MEDIA_TENANT };
  const ctx = { waitUntil(p) { waits.push(p); } };
  const config = { SYSTEM: 'Eres el asistente.', GUARDRAILS: 'Sé útil.', DEMOS: {} };
  const worker = createWorker(config);
  const call = (path = '', method = 'GET', body, as = scope, headers = {}) => {
    const url = new URL(`https://admin.hirevai.com/api/admin/tenants/${MEDIA_TENANT}/media${path}`);
    const binary = body instanceof Uint8Array;
    const request = new Request(url, { method, ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body), headers: { 'Content-Type': binary ? 'application/octet-stream' : 'application/json', ...(binary ? { 'Content-Length': String(body.length) } : {}), ...headers } }) });
    return testing.adminRouter(request, env, ctx, url.pathname, url, config, as);
  };
  const upload = async (bytes = mediaBytes(), query = {}) => (await call('?' + new URLSearchParams({ name: 'Tarifas.pdf', description: 'Tarifas actuales para quien pregunte por precios.', ...query }), 'POST', bytes)).json();
  return { DB, env, scope, ctx, worker, config, objects, call, upload, waits,
    async request(request) {
      const url = new URL(request.url);
      try { return await testing.adminRouter(request, env, ctx, url.pathname, url, config, scope); }
      catch (e) { return Response.json({ error: e.code || e.message }, { status: e.status || 500 }); }
    },
    async drain() { while (waits.length) await Promise.allSettled(waits.splice(0)); }, async close() { while (waits.length) await Promise.allSettled(waits.splice(0)); DB.close(); } };
}
