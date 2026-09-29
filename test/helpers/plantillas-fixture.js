// Fixture del e2e de Plantillas (SPEC-NOTIFICACION-CITA): D1 real (migraciones
// incluidas), el router admin real con el scope de un CLIENTE resuelto como en
// producción (o el de un admin de Velai con `email: 'admin@velai.test'`) y Twilio simulado. Lo usa panel/e2e/plantillas.spec.ts.
import { bookingFixture, BOOKING_TEST_TENANT } from './booking-fixture.js';
import { testing } from '../../worker/app.js';
import { encryptSecret } from '../../worker/crypto.js';
export const PLANTILLAS_TENANT = BOOKING_TEST_TENANT;
export async function plantillasFixture({ email = 'cliente@dialogos.test' } = {}) {
  const f = await bookingFixture();
  f.env.ADMIN_EMAILS = 'admin@velai.test';
  f.env.SECRETS_KEK = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
  f.env.ADMIN_ORIGIN = 'https://panel.test';
  const enc = await encryptSecret(f.env, BOOKING_TEST_TENANT, 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
  await f.DB.prepare("UPDATE tenants SET plan='profesional', twilio_subaccount_sid=?, twilio_auth_token_enc=?, twilio_from='whatsapp:+34600000009' WHERE id=?")
    .bind('AC' + 's'.repeat(32), enc, BOOKING_TEST_TENANT).run();
  await f.DB.prepare("INSERT INTO tenant_users VALUES ('cliente@dialogos.test',?,'cliente','2026-09-29')").bind(BOOKING_TEST_TENANT).run();
  const now = new Date().toISOString();
  // Recordatorio ya aprobado (con botones elegidos) y la confirmación aún sin crear:
  // el estado real de un cliente de producción.
  await f.DB.prepare(`INSERT INTO tenant_templates (tenant_id,kind,sid,status,opciones,categoria,created_at,updated_at)
    VALUES (?,'recordatorio_cita',?,'approved',?,'UTILITY',?,?)`)
    .bind(BOOKING_TEST_TENANT, 'HX' + 'r'.repeat(32), JSON.stringify({ botones: 'si_voy_no_puedo', textos: { confirmar: 'Sí, voy', cancelar: 'No puedo ir' } }), now, now).run();
  const twilio = { content: [], approvals: [] };
  let n = 0;
  const twilioFetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://content.twilio.com/v1/Content') { twilio.content.push(JSON.parse(String(init.body))); return Response.json({ sid: 'HX' + String(++n).padStart(32, '0') }, { status: 201 }); }
    if (u.endsWith('/ApprovalRequests/whatsapp')) { twilio.approvals.push(JSON.parse(String(init.body))); return Response.json({}, { status: 201 }); }
    if (u.includes('api.telegram.org')) return Response.json({ ok: true });
    throw new Error('Unexpected network request: ' + u);
  };
  return {
    DB: f.DB, twilio, twilioFetch,
    async request(request) {
      const url = new URL(request.url);
      try {
        const scope = await testing.resolveScope(f.env, email);
        return await testing.adminRouter(request, f.env, f.ctx, url.pathname, url, {}, scope);
      } catch (e) { return new Response(JSON.stringify({ ok: false, error: e.code || 'internal_error' }), { status: e.status || 500, headers: { 'Content-Type': 'application/json' } }); }
    },
    close: () => f.close(),
  };
}
