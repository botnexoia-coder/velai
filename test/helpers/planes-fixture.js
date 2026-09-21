import { sqliteD1 } from './sqlite-d1.js';
import { createWorker, testing } from '../../worker/app.js';
export const PLAN_TENANT = '00000000-0000-4000-8000-000000000091';
export async function planesFixture() {
  const DB = await sqliteD1();
  await DB.prepare(`INSERT INTO tenants(id,slug,name,channel_address,system_prompt,plan,active,created_at,updated_at)
    VALUES (?,'prueba','Cuenta de prueba','whatsapp:+34600000001',?,'esencial',1,'2026-09-21','2026-09-21')`).bind(PLAN_TENANT, 'Contexto del negocio de prueba. Ayuda a los visitantes con sus consultas.').run();
  await DB.prepare("INSERT INTO tenant_channels VALUES ('whatsapp:+34600000001',?,'whatsapp','2026-09-21')").bind(PLAN_TENANT).run();
  await DB.prepare("INSERT INTO tenant_users VALUES ('cliente@test.invalid',?,'cliente','2026-09-21')").bind(PLAN_TENANT).run();
  const env = { DB, ADMIN_ORIGIN: 'https://panel.test', BOOKING_ORIGIN: 'https://citas.hirevai.com', DEFAULT_TENANT_SLUG: 'prueba' };
  const scope = { role: 'velai', tenantId: null, email: 'velai@test.invalid' };
  const waits = [];
  const ctx = { waitUntil(p) { waits.push(p); } };
  return { DB, scope, env,
    async request(request) {
      const url = new URL(request.url);
      try {
        if (url.origin === env.BOOKING_ORIGIN) return createWorker({}).fetch(request, env, ctx);
        const actualScope = scope.role === 'cliente' ? await testing.resolveScope(env, 'cliente@test.invalid') : scope;
        return await testing.adminRouter(request, env, ctx, url.pathname, url, {}, actualScope);
      } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.code || 'internal_error' }), { status: e.status || 500, headers: { 'Content-Type': 'application/json' } }); }
    },
    async close() { await Promise.allSettled(waits); DB.close(); },
  };
}
