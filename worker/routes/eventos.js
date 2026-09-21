// Eventos: una vista operativa pequeña para clientes como NAYA. Todo listado usa
// scopeClause; la mutación comprueba propiedad en el mismo UPDATE (ajeno = 404).
import { Hono } from 'hono';
import { partesAdmin, scopeClause } from '../middleware.js';
import { HttpError, json, NO_STORE, readJson, UUID_RE } from '../app.js';

export const eventos = new Hono();

eventos.get('/api/admin/events', async (c) => {
  const { env, scope } = partesAdmin(c);
  const sc = scopeClause(scope, 'e');
  const scc = scopeClause(scope, 'r');
  const conScope = scopeClause(scope, 'cc');
  const [events, reservations, consents] = await Promise.all([
    env.DB.prepare(`SELECT e.id,e.tenant_id,e.slug,e.name,e.starts_at,e.venue,e.address,e.status,e.updated_at,
      e.individual_price_cents,e.couple_price_cents,e.advance_discount_percent,e.advance_individual_price_cents,
      e.advance_couple_price_cents,e.promotion_label,e.promotion_terms,e.payment_method,e.payment_destination,e.payment_recipient,
      t.name AS tenant_name
      FROM tenant_events e LEFT JOIN tenants t ON t.id=e.tenant_id WHERE 1=1${sc.sql}
      ORDER BY CASE e.status WHEN 'active' THEN 0 ELSE 1 END,e.starts_at DESC`).bind(...sc.args).all(),
    env.DB.prepare(`SELECT r.id,r.tenant_id,r.event_id,r.conversation_id,r.lead_id,r.kind,r.name,r.contact,r.details,r.status,r.created_at,r.updated_at,
      r.individual_tickets,r.couple_tickets,r.quoted_total_cents,r.currency,r.promotion_applied,r.payment_status,
      e.name AS event_name,t.name AS tenant_name
      FROM event_reservations r LEFT JOIN tenant_events e ON e.id=r.event_id LEFT JOIN tenants t ON t.id=r.tenant_id
      WHERE 1=1${scc.sql} ORDER BY r.updated_at DESC LIMIT 500`).bind(...scc.args).all(),
    env.DB.prepare(`SELECT cc.id,cc.tenant_id,cc.contact,cc.purpose,cc.status,cc.channel,cc.evidence,cc.created_at
      FROM contact_consents cc
      JOIN (SELECT tenant_id,contact,purpose,MAX(id) id FROM contact_consents GROUP BY tenant_id,contact,purpose) latest ON latest.id=cc.id
      WHERE 1=1${conScope.sql} ORDER BY cc.created_at DESC LIMIT 500`).bind(...conScope.args).all(),
  ]);
  const eventRows = events.results || [];
  const reservationRows = reservations.results || [];
  const consentRows = consents.results || [];
  if (scope.role !== 'velai') {
    for (const row of [...eventRows, ...reservationRows]) { delete row.tenant_id; delete row.tenant_name; }
    for (const row of consentRows) delete row.tenant_id;
  }
  return json({ events: eventRows, reservations: reservationRows, consents: consentRows }, 200, NO_STORE);
});

eventos.patch('/api/admin/events/reservations/:id', async (c) => {
  const { request, env, scope } = partesAdmin(c);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
  const body = await readJson(request, 1000);
  const statuses = ['pending', 'confirmed', 'cancelled'];
  const paymentStatuses = ['pending', 'proof_received', 'verified', 'rejected', 'refunded'];
  if (body.status != null && !statuses.includes(body.status)) throw new HttpError(400, 'invalid_status');
  if (body.payment_status != null && !paymentStatuses.includes(body.payment_status)) throw new HttpError(400, 'invalid_payment_status');
  if (body.status == null && body.payment_status == null) throw new HttpError(400, 'invalid_status');
  // Para NAYA, confirmar la reserva significa que el equipo verificó el pago;
  // verificar el pago confirma también la plaza. Así no quedan estados contradictorios.
  const status = body.payment_status === 'verified' ? 'confirmed' : body.status;
  const paymentStatus = body.status === 'confirmed' ? 'verified' : body.payment_status;
  const sets = ['updated_at=?'];
  const args = [new Date().toISOString()];
  if (status != null) { sets.push('status=?'); args.push(status); }
  if (paymentStatus != null) { sets.push('payment_status=?'); args.push(paymentStatus); }
  const sc = scopeClause(scope, 'event_reservations');
  const result = await env.DB.prepare(`UPDATE event_reservations SET ${sets.join(',')} WHERE id=?${sc.sql}`)
    .bind(...args, id, ...sc.args).run();
  if (!result.meta.changes) throw new HttpError(404, 'not_found');
  return json({ ok: true }, 200, NO_STORE);
});
