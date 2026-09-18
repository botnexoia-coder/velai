// Shared booking engine. D1 owns claims; KV only caches provider busy intervals.
import { HttpError, clean, normalizePhone, calendarAccessToken, markAppointmentCancelled, timingSafeEqual } from './app.js';
import { DEFAULT_BUSINESS_HOURS, freeSlots, localDateStr, localWeekday, localToUtcMs, googleBusy, createGoogleEvent, deleteGoogleEvent } from './calendar.js';

export function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export function genericService(cal) { return { id: null, slug: '', name: 'Cita', minutes: Number(cal.slot_minutes) || 30, buffer_min: 0, mode: 'presencial', location: '' }; }
export async function serviceFor(env, cal, slug = '') {
  const rows = (await env.DB.prepare('SELECT id,slug,name,description,minutes,mode,location,buffer_min,position FROM tenant_services WHERE tenant_id=? AND active=1 ORDER BY position,name').bind(cal.tenant_id).all()).results || [];
  if (slug) {
    const service = rows.find((r) => r.slug === slug);
    if (!service) throw new HttpError(404, 'not_found');
    return service;
  }
  if (rows.length > 1) throw new HttpError(400, 'service_required');
  return rows[0] || genericService(cal);
}
export function windowsFor(cal, date, exceptions = []) {
  const exception = exceptions.find((e) => e.date === date);
  if (exception) return exception.windows ? JSON.parse(exception.windows) : [];
  const table = cal.business_hours ? JSON.parse(cal.business_hours) : DEFAULT_BUSINESS_HOURS;
  const day = localWeekday(cal.timezone, date);
  return Object.hasOwn(table, day) ? table[day] : [];
}
export function calculateAvailability(cal, { from, to, service, busy = [], exceptions = [], nowMs = Date.now() }) {
  if (!validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 31 * 86400000) throw new HttpError(400, 'invalid_range');
  const today = localDateStr(cal.timezone, nowMs);
  const max = localDateStr(cal.timezone, nowMs + (cal.max_days_ahead ?? 60) * 86400000);
  const days = {};
  for (let ms = Date.parse(from); ms <= Date.parse(to); ms += 86400000) {
    const date = new Date(ms).toISOString().slice(0, 10);
    days[date] = date < today || date > max ? [] : freeSlots({ date, busy, hours: windowsFor(cal, date, exceptions), slotMinutes: service.minutes,
      bufferMin: service.buffer_min, minNoticeMin: cal.min_notice_min ?? 15, timezone: cal.timezone, nowMs, limit: 144, stepMinutes: 30 });
  }
  return days;
}
export async function invalidateAvailability(env, tenantId) {
  // Versioned cache keys prevent stale replicas and in-flight fills resurrecting data.
  await env.DB.prepare('UPDATE tenant_calendars SET booking_revision=booking_revision+1 WHERE tenant_id=?').bind(tenantId).run();
  if (env.KV) await env.KV.delete(`calcfg:${tenantId}`).catch(() => {});
}
export async function monthAvailability(env, cal, { from, to, service, fresh = false, ignoreClaim = null }) {
  if (!validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 31 * 86400000) throw new HttpError(400, 'invalid_range');
  const now = new Date().toISOString();
  const endDate = new Date(Date.parse(to) + 86400000).toISOString().slice(0, 10);
  const startIso = new Date(localToUtcMs(cal.timezone, from, '00:00')).toISOString();
  const endIso = new Date(localToUtcMs(cal.timezone, endDate, '00:00')).toISOString();
  const revision = await env.DB.prepare('SELECT booking_revision FROM tenant_calendars WHERE tenant_id=?').bind(cal.tenant_id).first();
  const key = `calfree:${cal.tenant_id}:${service.id || 'generic'}:${from.slice(0, 7)}:${from}:${to}:${revision?.booking_revision || 0}`;
  let busy = null;
  if (!fresh && env.KV) { try { busy = JSON.parse(await env.KV.get(key)); } catch (_) {} }
  if (!Array.isArray(busy)) {
    busy = await googleBusy(env, await calendarAccessToken(env, cal), cal.calendar_id, startIso, endIso, cal.timezone);
    if (!fresh && env.KV) await env.KV.put(key, JSON.stringify(busy), { expirationTtl: 90 }).catch(() => {});
  }
  const exceptions = (await env.DB.prepare('SELECT date,windows FROM calendar_exceptions WHERE tenant_id=? AND date>=? AND date<=?').bind(cal.tenant_id, from, to).all()).results || [];
  // Overlay authoritative reservations on EVERY cache hit, including other services.
  const claims = (await env.DB.prepare("SELECT starts_at AS start,busy_until AS end FROM booking_claims WHERE tenant_id=? AND starts_at<? AND busy_until>? AND id<>? AND (state='booking' OR (state='hold' AND expires_at>?))").bind(cal.tenant_id, endIso, startIso, ignoreClaim || '', now).all()).results || [];
  const appointments = (await env.DB.prepare("SELECT starts_at AS start,strftime('%Y-%m-%dT%H:%M:%fZ',ends_at,'+' || buffer_min || ' minutes') AS end FROM appointments WHERE tenant_id=? AND status='confirmed' AND starts_at<? AND ends_at>?").bind(cal.tenant_id, endIso, new Date(Date.parse(startIso) - 120 * 60000).toISOString()).all()).results || [];
  return calculateAvailability(cal, { from, to, service, busy: [...busy, ...claims, ...appointments], exceptions });
}
export async function digest(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function manageToken(env, id) {
  if (!env.APP_SECRET || env.APP_SECRET.length < 32) throw new HttpError(503, 'booking_not_configured');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id))), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
export function slotInterval(cal, service, dateTime) {
  if (typeof dateTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(dateTime) || !validDate(dateTime.slice(0, 10))) throw new HttpError(400, 'invalid_date');
  if (!['00', '30'].includes(dateTime.slice(-2))) throw new HttpError(400, 'invalid_date');
  const start = localToUtcMs(cal.timezone, dateTime.slice(0, 10), dateTime.slice(11));
  return { startIso: new Date(start).toISOString(), endIso: new Date(start + service.minutes * 60000).toISOString(), busyUntil: new Date(start + (service.minutes + service.buffer_min) * 60000).toISOString() };
}
export async function createHold(env, cal, service, dateTime) {
  const interval = slotInterval(cal, service, dateTime);
  const date = dateTime.slice(0, 10);
  const days = await monthAvailability(env, cal, { from: date, to: date, service, fresh: true });
  if (!days[date].includes(dateTime.slice(11))) throw new HttpError(409, 'hueco_ocupado');
  const secret = crypto.randomUUID() + crypto.randomUUID();
  const id = await digest(secret);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 300000).toISOString();
  const result = await env.DB.prepare(`INSERT INTO booking_claims (id,tenant_id,service_id,starts_at,ends_at,busy_until,expires_at,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (
      SELECT 1 FROM booking_claims WHERE tenant_id=? AND starts_at<? AND busy_until>? AND (state='booking' OR (state='hold' AND expires_at>?))
    ) AND NOT EXISTS (
      SELECT 1 FROM appointments WHERE tenant_id=? AND status='confirmed' AND starts_at<? AND strftime('%Y-%m-%dT%H:%M:%fZ',ends_at,'+' || buffer_min || ' minutes')>?
    )`).bind(id, cal.tenant_id, service.id, interval.startIso, interval.endIso, interval.busyUntil, expires, now,
      cal.tenant_id, interval.busyUntil, interval.startIso, now, cal.tenant_id, interval.busyUntil, interval.startIso).run();
  if (!result.meta.changes) throw new HttpError(409, 'hueco_ocupado');
  return { hold: secret, expires_at: expires };
}
export async function appointmentByToken(env, token, tenantId = null) {
  if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) throw new HttpError(404, 'not_found');
  const row = await env.DB.prepare(`SELECT a.*,s.name AS service_name,s.location AS service_location,
    s.mode AS service_mode,s.minutes AS service_minutes FROM appointments a
    LEFT JOIN tenant_services s ON s.id=a.service_id AND s.tenant_id=a.tenant_id
    WHERE a.manage_token=?${tenantId ? ' AND a.tenant_id=?' : ''}`)
    .bind(...(tenantId ? [token, tenantId] : [token])).first();
  if (!row || !timingSafeEqual(await manageToken(env, row.id), token)) throw new HttpError(404, 'not_found');
  return row;
}
export async function bookAppointment(env, cal, service, input, meta) {
  const nombre = clean(input.nombre, 100);
  const telefono = normalizePhone(clean(input.telefono, 40));
  if (!nombre || !telefono) throw new HttpError(400, 'datos_incompletos');
  const email = clean(input.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'invalid_email');
  const interval = slotInterval(cal, service, input.fecha_hora);
  const phoneKey = await digest(telefono.replace(/\D/g, '').slice(-9));
  let requestId = meta.channel === 'web_reserva' ? `res:${cal.tenant_id}:${interval.startIso}:${phoneKey}` : `cita:${cal.tenant_id}:${clean(meta.conversationKey, 80)}:${input.fecha_hora}`;
  if (input.hold && typeof input.hold === 'string') {
    const old = await env.DB.prepare('SELECT status FROM appointments WHERE request_id=? AND tenant_id=?').bind(requestId,cal.tenant_id).first();
    if (old?.status === 'cancelled') requestId += ':after:' + await digest(input.hold);
  }
  const previousClaim = meta.channel !== 'web_reserva' ? await env.DB.prepare('SELECT id FROM booking_claims WHERE request_id=? AND tenant_id=?').bind(requestId, cal.tenant_id).first() : null;
  const holdSecret = input.hold || (previousClaim ? 'internal' : (await createHold(env, cal, service, input.fecha_hora)).hold);
  if (typeof holdSecret !== 'string' || holdSecret.length > 100) throw new HttpError(409, 'hold_expired');
  const claimId = previousClaim ? previousClaim.id : await digest(holdSecret);
  const claim = await env.DB.prepare('SELECT * FROM booking_claims WHERE id=? AND tenant_id=?').bind(claimId, cal.tenant_id).first();
  if (!claim || claim.service_id !== service.id || claim.starts_at !== interval.startIso || claim.busy_until !== interval.busyUntil || (claim.request_id && claim.request_id !== requestId)) throw new HttpError(409, 'hold_expired');
  if (claim.state === 'booked') {
    const existing = await env.DB.prepare('SELECT * FROM appointments WHERE id=? AND tenant_id=?').bind(claim.appointment_id, cal.tenant_id).first();
    if (!existing) throw new HttpError(409, 'booking_in_progress');
    return existing;
  }
  const id = claim.appointment_id || crypto.randomUUID();
  const token = meta.channel === 'web_reserva' || env.APP_SECRET ? await manageToken(env, id) : null;
  const now = new Date().toISOString();
  if (claim.state === 'hold') {
    if (claim.expires_at <= now) throw new HttpError(409, 'hold_expired');
    const date = input.fecha_hora.slice(0, 10);
    const days = await monthAvailability(env, cal, { from: date, to: date, service, fresh: true, ignoreClaim: claimId });
    if (!days[date].includes(input.fecha_hora.slice(11))) throw new HttpError(409, 'hueco_ocupado');
    // This single UPDATE atomically enforces the phone quota even across disjoint slots.
    let result;
    try {
      result = await env.DB.prepare(`UPDATE booking_claims SET state='booking',request_id=?,phone_key=?,appointment_id=?,rescheduled_from=?
        WHERE id=? AND tenant_id=? AND state='hold' AND expires_at>?
        AND (SELECT count(*) FROM appointments WHERE tenant_id=? AND status='confirmed' AND starts_at>? AND substr(replace(customer_phone,'+',''),-9)=? AND id<>?)
          + (SELECT count(*) FROM booking_claims WHERE tenant_id=? AND state='booking' AND phone_key=?) < 3`)
        .bind(requestId, phoneKey, id, meta.rescheduledFrom || null, claimId, cal.tenant_id, now, cal.tenant_id, now, telefono.replace(/\D/g, '').slice(-9), meta.rescheduledFrom || '', cal.tenant_id, phoneKey).run();
    } catch (error) {
      if (meta.rescheduledFrom && /UNIQUE/i.test(String(error.message))) throw new HttpError(409, 'reschedule_in_progress');
      throw error;
    }
    if (!result.meta.changes) throw new HttpError(409, 'booking_limit_or_in_progress');
  }
  // Google ids allow base32hex; a hex digest qualifies. Retries cannot add duplicates.
  const eventId = 'v' + await digest(`appointment:${id}`);
  // Persist the intent before crossing the network. If Google creates the event but
  // the response or the following D1 write is lost, the same hold can finish the
  // exact same appointment without losing its customer data or duplicating Google.
  await env.DB.prepare(`INSERT INTO appointments
    (id,tenant_id,request_id,channel,customer_name,customer_phone,reason,starts_at,ends_at,
     timezone,provider_event_id,status,created_at,service_id,customer_email,notes,
     manage_token,rescheduled_from,buffer_min)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'error',?,?,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING`)
    .bind(id, cal.tenant_id, requestId, meta.channel, nombre, telefono, service.name,
      interval.startIso, interval.endIso, cal.timezone, eventId, now, service.id,
      email || null, clean(input.nota || input.motivo, 1000) || null, token,
      meta.rescheduledFrom || null, service.buffer_min).run();
  const intent = await env.DB.prepare('SELECT id,status FROM appointments WHERE request_id=? AND tenant_id=?')
    .bind(requestId, cal.tenant_id).first();
  if (!intent || intent.id !== id || !['error', 'confirmed'].includes(intent.status)) throw new HttpError(409, 'booking_in_progress');
  await createGoogleEvent(env, await calendarAccessToken(env, cal), cal.calendar_id, {
    eventId, summary: `Cita: ${nombre} — ${service.name}`, description: `Teléfono: ${telefono}\n${clean(input.nota || input.motivo, 1000)}`,
    startIso: interval.startIso, endIso: interval.endIso, timezone: cal.timezone,
  });
  await env.DB.batch([
    env.DB.prepare("UPDATE appointments SET status='confirmed',provider_event_id=? WHERE id=? AND tenant_id=? AND request_id=? AND status IN ('error','confirmed')")
      .bind(eventId, id, cal.tenant_id, requestId),
    env.DB.prepare("INSERT INTO booking_notifications(appointment_id,tenant_id,updated_at) SELECT ?,id,? FROM tenants WHERE id=? AND reminders_enabled=1 AND ?='web_reserva' ON CONFLICT(appointment_id) DO NOTHING").bind(id, now, cal.tenant_id, meta.channel),
    env.DB.prepare("UPDATE booking_claims SET state='booked' WHERE id=? AND tenant_id=? AND appointment_id=?").bind(claimId, cal.tenant_id, id),
    env.DB.prepare('UPDATE tenant_calendars SET booking_revision=booking_revision+1 WHERE tenant_id=?').bind(cal.tenant_id),
  ]);
  const appt = await env.DB.prepare('SELECT * FROM appointments WHERE request_id=? AND tenant_id=?').bind(requestId, cal.tenant_id).first();
  if (!appt || appt.id !== id) throw new HttpError(409, 'booking_in_progress');
  return appt;
}
export async function cancelAppointment(env, tenant, cal, appt) {
  // Provider deletion first: errors keep the original appointment and slot intact.
  if (appt.status === 'confirmed' && appt.provider_event_id) await deleteGoogleEvent(env, await calendarAccessToken(env, cal), cal.calendar_id, appt.provider_event_id);
  await markAppointmentCancelled(env, tenant, appt);
}
