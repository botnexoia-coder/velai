import { Hono } from 'hono';
import { HttpError, json, readJson, clean, processBookingNotifications } from '../app.js';
import { localDateStr } from '../calendar.js';
import { monthAvailability, serviceFor, genericService, createHold, bookAppointment, appointmentByToken, cancelAppointment } from '../agenda.js';
import { bookingOrigin } from '../booking-security.js';
import { reservaPage, appointmentIcs } from '../reserva-page.js';
import { mwBookingHost, bookingRateLimit, bookingWriteOrigin, bookingHuman, BOOKING_HEADERS } from '../booking-security.js';

export const reserva = new Hono();
reserva.use('*', mwBookingHost);
reserva.use('*', async (c, next) => {
  await next();
  for (const [key, value] of Object.entries(BOOKING_HEADERS)) if (key !== 'Cache-Control' || !c.res.headers.has(key)) c.res.headers.set(key, value);
});
export async function bookingTenant(env, slug, enabled = true) {
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug || '')) throw new HttpError(404, 'not_found');
  const tenant = await env.DB.prepare('SELECT id,slug,name,brand_name,logo_url,brand_color,brand_color_2,accent_color,theme,web_origins,reminders_enabled FROM tenants WHERE slug=? AND active=1').bind(slug).first();
  if (!tenant) throw new HttpError(404, 'not_found');
  const cal = await env.DB.prepare("SELECT * FROM tenant_calendars WHERE tenant_id=? AND status='connected'").bind(tenant.id).first();
  if (!cal || (enabled && cal.booking_enabled !== 1)) throw new HttpError(404, 'not_found');
  return { tenant, cal };
}
async function boot(env, tenant, cal) {
  const services = (await env.DB.prepare('SELECT id,slug,name,description,minutes,mode,location,buffer_min,position FROM tenant_services WHERE tenant_id=? AND active=1 ORDER BY position,name').bind(tenant.id).all()).results || [];
  // Marca: los MISMOS campos que ya sirve /widget/boot al chat (decisión de Juan,
  // 2026-09-15: el aprovisionamiento del chat vale para el calendario, sin config nueva).
  // La derivación del acento cuando el cliente no lo define vive en la página, igual
  // que en site/assets/vai-widget.js.
  return { slug: tenant.slug, name: tenant.brand_name || tenant.name, logo_url: tenant.logo_url,
    brand_color: tenant.brand_color, brand_color_2: tenant.brand_color_2, accent_color: tenant.accent_color, theme: tenant.theme,
    timezone: cal.timezone, min_notice_min: cal.min_notice_min, max_days_ahead: cal.max_days_ahead, booking_note: cal.booking_note,
    services: services.length ? services : [genericService(cal)], sitekey: env.TURNSTILE_SITEKEY || '' };
}
function publicAppointment(appt, tenant, cal, env) {
  return { starts_at: appt.starts_at, ends_at: appt.ends_at, timezone: appt.timezone, status: appt.status, name: appt.customer_name,
    service_id: appt.service_id, service_name: appt.service_name || appt.reason,
    location: appt.service_location || null, mode: appt.service_mode || null,
    manage_url: `${bookingOrigin(env)}/${tenant.slug}/cita/${appt.manage_token}`,
    ics_url: `${bookingOrigin(env)}/${tenant.slug}/cita/${appt.manage_token}/calendario.ics` };
}
async function writeBody(c, bucket, limit, human = false) {
  bookingWriteOrigin(c.req.raw, c.env);
  await bookingRateLimit(c.env, c.req.raw, bucket, limit);
  const body = await readJson(c.req.raw, 4000);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_body');
  if (human) await bookingHuman(c.env, c.req.raw, body);
  return body;
}
reserva.get('/:cliente/reservas', async (c) => {
  await bookingRateLimit(c.env,c.req.raw,'respage',60);
  const {tenant,cal} = await bookingTenant(c.env,c.req.param('cliente'));
  return reservaPage(c.env, tenant, await boot(c.env,tenant,cal));
});
reserva.get('/api/reservas/:cliente', async (c) => {
  await bookingRateLimit(c.env,c.req.raw,'resboot',60);
  const {tenant,cal} = await bookingTenant(c.env,c.req.param('cliente'));
  return json(await boot(c.env,tenant,cal),200,{'Cache-Control':'public, max-age=300'});
});
reserva.get('/api/reservas/:cliente/huecos', async (c) => {
  await bookingRateLimit(c.env,c.req.raw,'resfree',60);
  const {cal} = await bookingTenant(c.env,c.req.param('cliente'));
  const month = c.req.query('mes') || '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400,'invalid_month');
  const today = new Date();
  if (month < localDateStr(cal.timezone,today.getTime()).slice(0,7) || Date.parse(month+'-01') > Date.now() + (cal.max_days_ahead+32)*86400000) throw new HttpError(400,'invalid_month');
  const to = new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
  const service = await serviceFor(c.env,cal,clean(c.req.query('s'),60));
  return json({ days: await monthAvailability(c.env,cal,{from:month+'-01',to,service}), timezone:cal.timezone });
});
reserva.post('/api/reservas/:cliente/hold', async (c) => {
  const body = await writeBody(c,'reshold',10,true);
  const {cal} = await bookingTenant(c.env,c.req.param('cliente'));
  return json(await createHold(c.env,cal,await serviceFor(c.env,cal,clean(body.servicio,60)),clean(body.fecha_hora,16)));
});
reserva.post('/api/reservas/:cliente', async (c) => {
  const body = await writeBody(c,'reserva',5,true);
  const {tenant,cal} = await bookingTenant(c.env,c.req.param('cliente'));
  if (body.privacy !== true || !body.hold) throw new HttpError(400,'consent_and_hold_required');
  const service = await serviceFor(c.env,cal,clean(body.servicio,60));
  const appt = await bookAppointment(c.env,cal,service,body,{channel:'web_reserva'});
  c.executionCtx.waitUntil(processBookingNotifications(c.env,appt.id).catch(()=>{}));
  return json({ok:true,appointment:{...publicAppointment(appt,tenant,cal,c.env),location:service.location,mode:service.mode}});
});
reserva.get('/:cliente/cita/:token', async (c) => {
  await bookingRateLimit(c.env,c.req.raw,'resmanage',30);
  const {tenant,cal} = await bookingTenant(c.env,c.req.param('cliente'),false);
  const appt = await appointmentByToken(c.env,c.req.param('token'),tenant.id);
  return reservaPage(c.env,tenant,await boot(c.env,tenant,cal),publicAppointment(appt,tenant,cal,c.env));
});
reserva.get('/:cliente/cita/:token/calendario.ics', async (c) => {
  await bookingRateLimit(c.env,c.req.raw,'resmanage',30);
  const {tenant} = await bookingTenant(c.env,c.req.param('cliente'),false);
  const appt = await appointmentByToken(c.env,c.req.param('token'),tenant.id);
  return new Response(appointmentIcs(appt),{headers:{...BOOKING_HEADERS,'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="cita.ics"'}});
});
reserva.post('/api/cita/:token/:action', async (c) => {
  const action = c.req.param('action');
  if (!['cancelar','reagendar'].includes(action)) throw new HttpError(404,'not_found');
  const body = await writeBody(c,'resmanagewrite',5,action==='reagendar');
  const appt = await appointmentByToken(c.env,c.req.param('token'));
  const row = await c.env.DB.prepare('SELECT slug FROM tenants WHERE id=? AND active=1').bind(appt.tenant_id).first();
  if (!row) throw new HttpError(404,'not_found');
  const {tenant,cal} = await bookingTenant(c.env,row.slug,false);
  if (action === 'cancelar') {
    if (appt.starts_at <= new Date().toISOString()) throw new HttpError(409,'appointment_past');
    await cancelAppointment(c.env,tenant,cal,appt);
    return json({ok:true});
  }
  if (!cal.booking_enabled || appt.starts_at <= new Date().toISOString()) throw new HttpError(409,'reschedule_unavailable');
  const linked = await c.env.DB.prepare('SELECT * FROM appointments WHERE tenant_id=? AND rescheduled_from=?').bind(tenant.id,appt.id).first();
  if (linked) {
    await cancelAppointment(c.env,tenant,cal,appt);
    return json({ok:true,appointment:publicAppointment(linked,tenant,cal,c.env)});
  }
  if (appt.status !== 'confirmed' || !body.hold) throw new HttpError(409,'reschedule_unavailable');
  const service = await serviceFor(c.env,cal,clean(body.servicio,60));
  if (service.id !== appt.service_id) throw new HttpError(400,'invalid_service');
  const next = await bookAppointment(c.env,cal,service,{...body,nombre:appt.customer_name,telefono:appt.customer_phone,email:appt.customer_email,nota:appt.notes},{channel:'web_reserva',rescheduledFrom:appt.id});
  await cancelAppointment(c.env,tenant,cal,appt);
  c.executionCtx.waitUntil(processBookingNotifications(c.env,next.id).catch(()=>{}));
  return json({ok:true,appointment:publicAppointment(next,tenant,cal,c.env)});
});
reserva.all('*', () => { throw new HttpError(404, 'not_found'); });
// No request path or body in errors: management tokens are bearer credentials.
reserva.onError((error) => json({ ok: false, error: error instanceof HttpError ? error.code : 'booking_unavailable' }, error instanceof HttpError ? error.status : 503, BOOKING_HEADERS));
