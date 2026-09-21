import { sqliteD1 } from './sqlite-d1.js';
import { createWorker, testing } from '../../worker/app.js';
import { encryptSecret } from '../../worker/crypto.js';
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
    async setupWhatsApp() {
      env.SECRETS_KEK = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
      const enc = await encryptSecret(env, PLAN_TENANT, 'synthetic-test-token');
      const address = 'whatsapp:+34600000002', senderSid = 'XE' + 'a'.repeat(32);
      await DB.prepare(`UPDATE tenants SET plan='profesional',channel_address='web:prueba',web_origins='["https://prueba.invalid"]',
        twilio_subaccount_sid=?,twilio_auth_token_enc=?,twilio_from=?,waba_id='12345',sender_sid=NULL,sender_status=NULL WHERE id=?`)
        .bind('AC' + 'b'.repeat(32), enc, address, PLAN_TENANT).run();
      await DB.prepare('DELETE FROM tenant_channels WHERE tenant_id=?').bind(PLAN_TENANT).run();
      const requests = [];
      const fetchProvider = async (url, init) => {
        const u = new URL(url), body = init.body ? JSON.parse(init.body) : null;
        requests.push({ path: u.pathname, method: init.method, body });
        if (u.hostname !== 'messaging.twilio.com') throw new Error('Unexpected provider');
        if (u.pathname === '/v2/Channels/Senders' && init.method === 'GET') {
          return Response.json({ senders: [{ sid: senderSid, sender_id: address, status: 'ONLINE', configuration: { waba_id: '12345' }, webhook: { callback_url: '' } }] });
        }
        if (u.pathname === `/v2/Channels/Senders/${senderSid}` && body?.webhook) return Response.json({ status: 'ONLINE' });
        throw new Error('Unexpected Twilio request: ' + u.pathname);
      };
      return { address, senderSid, requests, fetchProvider };
    },
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
