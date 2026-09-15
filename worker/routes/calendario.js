// Dominio CALENDARIO del panel: las citas agendadas (/appointments) y la conexión
// de Google Calendar por tenant (conectar por OAuth, configurar, desconectar). El
// callback OAuth vive en routes/publico.js (no es /api/admin/*) y el proveedor puro
// en worker/calendar.js. Migrado tal cual del adminRouter monolítico.
import { bookingOrigin, bookingReadiness } from '../booking-security.js';
import { invalidateAvailability, validDate } from '../agenda.js';
import { Hono } from 'hono';
import { partesAdmin, scopeClause, assertOwnTenant, adminOrigin } from '../middleware.js';
import { googleAuthUrl, revokeGoogleToken } from '../calendar.js';
import { decryptSecret } from '../crypto.js';
import { HttpError, json, NO_STORE, clean, readJson, UUID_RE, reminderHoursFor, tenantTemplate, invalidateTenantCache } from '../app.js';
import { templateKind } from '../plantillas.js';

export const calendario = new Hono();

// ── Citas (SPEC-CALENDARIO): lista scoped — velai todo (con ?tenant=), cliente
// solo las suyas vía scopeClause (mismo único punto de paso que los leads).
calendario.get('/api/admin/appointments', async (c) => {
  const { env, url, scope } = partesAdmin(c);
  const sc = scopeClause(scope);
  const clauses = ['1=1']; const values = [];
  const tenantFilter = clean(url.searchParams.get('tenant'), 40);
  if (scope.role === 'velai' && tenantFilter && UUID_RE.test(tenantFilter)) { clauses.push('l.tenant_id = ?'); values.push(tenantFilter); }
  // Rango opcional (la vista de calendario del panel pide el mes visible).
  const fromIso = clean(url.searchParams.get('from'), 30);
  const toIso = clean(url.searchParams.get('to'), 30);
  if (fromIso) { clauses.push('l.starts_at >= ?'); values.push(fromIso); }
  if (toIso) { clauses.push('l.starts_at < ?'); values.push(toIso); }
  const hasRange = Boolean(fromIso || toIso);
  const limit = Math.min(hasRange ? 500 : 100, Math.max(1, Number(url.searchParams.get('limit')) || (hasRange ? 500 : 50)));
  // Confirmaciones (0030): qué hizo el cliente con su cita + el ledger del recordatorio
  // (para los chips y el detalle del día). appointment_reminders es tabla hija: entra por
  // el JOIN de esta MISMA consulta ya filtrada por scopeClause.
  const rows = (await env.DB.prepare(`SELECT l.id,l.tenant_id,t.name AS tenant_name,l.channel,l.customer_name,l.customer_phone,l.reason,l.starts_at,l.ends_at,l.timezone,l.status,l.created_at,l.customer_confirmed_at,l.cancelled_by,r.status AS reminder_status,r.sent_at AS reminder_sent_at,r.attempts AS reminder_attempts,r.last_error AS reminder_error FROM appointments l LEFT JOIN tenants t ON t.id=l.tenant_id LEFT JOIN appointment_reminders r ON r.appointment_id=l.id AND r.kind='previo' WHERE ${clauses.join(' AND ')}${sc.sql} ORDER BY l.starts_at ${hasRange ? 'ASC' : 'DESC'} LIMIT ?`)
    .bind(...values, ...sc.args, limit).all()).results;
  if (scope.role !== 'velai') for (const row of rows) { delete row.tenant_name; delete row.tenant_id; }
  return json({ appointments: rows }, 200, NO_STORE);
});

// ── Calendario del tenant (SPEC-CALENDARIO §6). El GET jamás devuelve el token
// cifrado. La conexión y la config comparten handler, como compartían regex.
const grupoCalendar = async (c) => {
  const { request, env, ctx, scope, actor } = partesAdmin(c);
  const tenantId = c.req.param('id');
  if (!UUID_RE.test(tenantId)) throw new HttpError(404, 'not_found');
  const sub = c.req.param('sub') || null;
  // Autoservicio del cliente: SOLO su propio calendario. Fuera de alcance = 404
  // (un 403 confirmaría que ese tenant existe), y ANTES de tocar D1.
  assertOwnTenant(scope, tenantId);
  const tenantRow = await env.DB.prepare('SELECT id, slug, name FROM tenants WHERE id=?').bind(tenantId).first();
  if (!tenantRow) throw new HttpError(404, 'not_found');
  if (sub === 'connect' && request.method === 'POST') {
    const body = await readJson(request, 2000);
    if (clean(body.provider, 20) !== 'google') throw new HttpError(400, 'invalid_provider'); // microsoft: fase futura
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) throw new HttpError(503, 'calendar_not_configured');
    if (!env.KV) throw new HttpError(503, 'calendar_not_configured');
    const state = crypto.randomUUID();
    await env.KV.put(`calstate:${state}`, JSON.stringify({ tenantId, provider: 'google', actor }), { expirationTtl: 600 });
    return json({ authUrl: googleAuthUrl(env, state, `${adminOrigin(env)}/oauth/calendar/callback`) }, 200, NO_STORE);
  }
  if (!sub && request.method === 'GET') {
    // Columnas explícitas, NUNCA SELECT * : refresh_token_enc no sale del worker.
    let row = null;
    try { row = await env.DB.prepare('SELECT provider,account_email,calendar_id,timezone,slot_minutes,business_hours,status,last_error,connected_at,updated_at FROM tenant_calendars WHERE tenant_id=?').bind(tenantId).first(); } catch (_) {}
    // Bloque de Confirmaciones (SPEC-CONFIRMACIONES): el cliente VE el estado del addon
    // (lo habilita Velai) y de su plantilla. Consultas en try/catch: un deploy antes de
    // aplicar la migración 0030 sirve el calendario igual, con el bloque en su default.
    let conf = null;
    try { conf = await env.DB.prepare('SELECT reminders_enabled, reminder_hours FROM tenants WHERE id=?').bind(tenantId).first(); } catch (_) {}
    const template = await tenantTemplate(env, tenantId, 'recordatorio_cita');
    return json({
      calendar: row || null,
      confirmaciones: {
        enabled: Boolean(conf && conf.reminders_enabled),
        hours: reminderHoursFor(conf || {}),
        template: { sid: (template && template.sid) || null, status: (template && template.status) || null },
      },
    }, 200, NO_STORE);
  }
  if (!sub && request.method === 'PATCH') {
    const body = await readJson(request, 4000);
    const sets = []; const args = [];
    if (body.calendar_id !== undefined) {
      const calendarId = clean(body.calendar_id, 200) || 'primary';
      sets.push('calendar_id=?'); args.push(calendarId);
    }
    if (body.timezone !== undefined) {
      const tz = clean(body.timezone, 60);
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (_) { throw new HttpError(400, 'invalid_timezone'); }
      sets.push('timezone=?'); args.push(tz);
    }
    if (body.slot_minutes !== undefined) {
      const minutes = Number(body.slot_minutes);
      if (!Number.isInteger(minutes) || minutes < 10 || minutes > 240) throw new HttpError(400, 'invalid_slot_minutes');
      sets.push('slot_minutes=?'); args.push(minutes);
    }
    if (body.business_hours !== undefined) {
      let stored = null;
      if (body.business_hours !== null && body.business_hours !== '') {
        const hours = body.business_hours;
        const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
        if (!hours || typeof hours !== 'object' || Array.isArray(hours)) throw new HttpError(400, 'invalid_business_hours');
        const outHours = {};
        for (const day of Object.keys(hours)) {
          if (!DAYS.includes(day)) throw new HttpError(400, 'invalid_business_hours');
          const windows = hours[day];
          if (!Array.isArray(windows) || windows.length > 4) throw new HttpError(400, 'invalid_business_hours');
          for (const w of windows) {
            if (!Array.isArray(w) || w.length !== 2 || !HHMM.test(w[0]) || !HHMM.test(w[1]) || w[0] >= w[1]) throw new HttpError(400, 'invalid_business_hours');
          }
          outHours[day] = windows;
        }
        stored = JSON.stringify(outHours);
      }
      sets.push('business_hours=?'); args.push(stored);
    }
    if (!sets.length) throw new HttpError(400, 'nothing_to_update');
    const now = new Date().toISOString();
    const updated = await env.DB.prepare(`UPDATE tenant_calendars SET ${sets.join(',')}, updated_at=? WHERE tenant_id=?`).bind(...args, now, tenantId).run();
    if (!updated.meta.changes) throw new HttpError(404, 'not_found');
    await invalidateAvailability(env, tenantId);
    ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
      .bind(tenantId, actor, 'calendar', null, 'config editada', now).run().catch(() => {}));
    return json({ ok: true }, 200, NO_STORE);
  }
  if (!sub && request.method === 'DELETE') {
    const row = await env.DB.prepare('SELECT refresh_token_enc FROM tenant_calendars WHERE tenant_id=?').bind(tenantId).first();
    if (!row) throw new HttpError(404, 'not_found');
    // Revocación best-effort en Google; borrar la fila ya inutiliza la conexión aquí.
    try {
      const secret = await decryptSecret(env, `calendar:${tenantId}`, row.refresh_token_enc);
      if (secret) ctx.waitUntil(revokeGoogleToken(secret.value));
    } catch (_) {}
    await env.DB.prepare('DELETE FROM tenant_calendars WHERE tenant_id=?').bind(tenantId).run();
    if (env.KV) { try { await env.KV.delete(`calcfg:${tenantId}`); await env.KV.delete(`caltoken:${tenantId}`); } catch (_) {} }
    const now = new Date().toISOString();
    ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
      .bind(tenantId, actor, 'calendar', null, 'desconectado', now).run().catch(() => {}));
    console.log(JSON.stringify({ level: 'info', code: 'calendar_disconnected', tenant: tenantId }));
    return json({ ok: true }, 200, NO_STORE);
  }
  throw new HttpError(405, 'method_not_allowed');
};
calendario.all('/api/admin/tenants/:id/calendar', grupoCalendar);
calendario.all('/api/admin/tenants/:id/calendar/:sub{connect}', grupoCalendar);

// ── Confirmaciones: interruptor del addon, SOLO Velai (SPEC-CONFIRMACIONES) ───
// clienteAllowed no abre esta ruta (clienteGate responde 403 antes de tocar datos) y
// el handler la veta ADEMÁS en código: es un addon que habilita Velai — el cliente
// solo lo VE, en el bloque `confirmaciones` del GET del calendario. La plantilla se
// crea con el paso genérico /provision/plantillas/recordatorio_cita (routes/tenants.js).
const grupoReminders = async (c) => {
  const { request, env, ctx, scope, actor } = partesAdmin(c);
  if (scope.role !== 'velai') throw new HttpError(403, 'not_authorized');
  const tenantId = c.req.param('id');
  if (!UUID_RE.test(tenantId)) throw new HttpError(404, 'not_found');
  if (request.method !== 'PATCH') throw new HttpError(405, 'method_not_allowed');
  const body = await readJson(request, 2000);
  const previous = await env.DB.prepare('SELECT id, slug, name, channel_address, reminders_enabled, reminder_hours FROM tenants WHERE id=?').bind(tenantId).first();
  if (!previous) throw new HttpError(404, 'not_found');
  const sets = []; const args = []; const cambios = [];
  let enabled = null;
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'invalid_enabled');
    enabled = body.enabled ? 1 : 0;
    sets.push('reminders_enabled=?'); args.push(enabled);
    cambios.push(enabled ? 'addon activado' : 'addon desactivado');
  }
  // Antelación EDITABLE sin nueva aprobación (es config del addon, no de la plantilla).
  // Solo valores de la lista curada del catálogo: nada arbitrario en reminder_hours.
  let hours = null;
  if (body.hours !== undefined) {
    const def = templateKind('recordatorio_cita');
    const n = Number(body.hours);
    if (!def || !Array.isArray(def.antelaciones) || !def.antelaciones.includes(n)) throw new HttpError(400, 'invalid_hours');
    hours = n;
    sets.push('reminder_hours=?'); args.push(String(n));
    cambios.push(`antelación ${n} h`);
  }
  if (!sets.length) throw new HttpError(400, 'nothing_to_update');
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE tenants SET ${sets.join(',')}, updated_at=? WHERE id=?`).bind(...args, now, tenantId).run();
  // La fila del tenant vive cacheada en KV (30 min): sin invalidar, los canales
  // seguirían viendo el valor viejo hasta que caducara.
  await invalidateTenantCache(env, [previous]);
  ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
    .bind(tenantId, actor, 'config', JSON.stringify({ reminders_enabled: previous.reminders_enabled, reminder_hours: previous.reminder_hours }),
      `confirmaciones: ${cambios.join(', ')}`, now).run().catch(() => {}));
  console.log(JSON.stringify({ level: 'info', code: 'reminders_toggled', tenant: previous.slug, enabled: enabled === null ? undefined : Boolean(enabled), hours: hours ?? undefined }));
  return json({ ok: true, ...(enabled === null ? {} : { enabled: Boolean(enabled) }), ...(hours === null ? {} : { hours }) }, 200, NO_STORE);
};
calendario.all('/api/admin/tenants/:id/reminders', grupoReminders);

// Autoagenda: every resource is addressed through its verified owner, before D1.
const bookingAdmin = async (c) => {
  const {request,env,ctx,scope,actor} = partesAdmin(c);
  const tenantId = c.req.param('id');
  if (!UUID_RE.test(tenantId)) throw new HttpError(404,'not_found');
  assertOwnTenant(scope,tenantId);
  const tenant = await env.DB.prepare('SELECT id,slug FROM tenants WHERE id=?').bind(tenantId).first();
  if (!tenant) throw new HttpError(404,'not_found');
  const services = c.req.path.includes('/services');
  const serviceId = c.req.param('serviceId');
  if (serviceId && !UUID_RE.test(serviceId)) throw new HttpError(404,'not_found');
  if (request.method === 'GET') {
    if (services) return json({services:(await env.DB.prepare('SELECT id,slug,name,description,minutes,mode,location,buffer_min,active,position FROM tenant_services WHERE tenant_id=? ORDER BY position,name').bind(tenantId).all()).results},200,NO_STORE);
    const config = await env.DB.prepare('SELECT booking_enabled,min_notice_min,max_days_ahead,booking_note FROM tenant_calendars WHERE tenant_id=?').bind(tenantId).first();
    const exceptions = (await env.DB.prepare('SELECT date,windows,note FROM calendar_exceptions WHERE tenant_id=? ORDER BY date').bind(tenantId).all()).results || [];
    return json({config,exceptions:exceptions.map((e)=>({...e,windows:e.windows?JSON.parse(e.windows):null})),url:bookingOrigin(env)?`${bookingOrigin(env)}/${tenant.slug}/reservas`:null,faltan:bookingReadiness(env)},200,NO_STORE);
  }
  if (services) {
    if (request.method==='DELETE') {
      if (!serviceId) throw new HttpError(400,'service_required');
      const result=await env.DB.prepare('UPDATE tenant_services SET active=0,updated_at=? WHERE id=? AND tenant_id=?').bind(new Date().toISOString(),serviceId,tenantId).run();
      if (!result.meta.changes) throw new HttpError(404,'not_found');
    } else {
      const body=await readJson(request,4000);
      let previous=null;
      if (serviceId) { previous=await env.DB.prepare('SELECT * FROM tenant_services WHERE id=? AND tenant_id=?').bind(serviceId,tenantId).first(); if(!previous)throw new HttpError(404,'not_found'); }
      const merged={...(previous||{}),...body};
      const name=clean(merged.name,100), slug=clean(merged.slug,60), description=clean(merged.description,500), location=clean(merged.location,500);
      const minutes=Number(merged.minutes), buffer=Number(merged.buffer_min||0), position=Number(merged.position||0), active=merged.active===undefined?1:Number(merged.active), mode=clean(merged.mode,20)||'presencial';
      if(!name||!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)||!Number.isInteger(minutes)||minutes<10||minutes>240||!Number.isInteger(buffer)||buffer<0||buffer>120||!Number.isInteger(position)||position<0||position>1000||![0,1].includes(active)||!['presencial','video','telefono'].includes(mode))throw new HttpError(400,'invalid_service');
      if(mode==='video'&&location&&!/^https:\/\//i.test(location))throw new HttpError(400,'invalid_location');
      const now=new Date().toISOString();
      try {
        if(previous) await env.DB.prepare('UPDATE tenant_services SET slug=?,name=?,description=?,minutes=?,mode=?,location=?,buffer_min=?,active=?,position=?,updated_at=? WHERE id=? AND tenant_id=?').bind(slug,name,description||null,minutes,mode,location||null,buffer,active,position,now,serviceId,tenantId).run();
        else await env.DB.prepare('INSERT INTO tenant_services(id,tenant_id,slug,name,description,minutes,mode,location,buffer_min,active,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),tenantId,slug,name,description||null,minutes,mode,location||null,buffer,active,position,now,now).run();
      } catch(e) { if(/UNIQUE/.test(String(e.message)))throw new HttpError(409,'service_slug_exists');throw e; }
    }
  } else {
    const body=await readJson(request,32000);
    const sets=[],args=[],statements=[];
    // Abrir (o cerrar) la página al PÚBLICO es de Velai, como el addon de Confirmaciones
    // (decisión de Juan, 2026-09-16). El cliente configura lo suyo —servicios, reglas,
    // festivos— pero no decide que su negocio aparezca en una URL pública. El veto va
    // AQUÍ, en el handler: la ruta sigue en la lista blanca del rol cliente porque el
    // resto del PATCH sí es suyo.
    if(body.booking_enabled!==undefined){
      if(scope.role!=='velai')throw new HttpError(403,'not_authorized');
      if(typeof body.booking_enabled!=='boolean')throw new HttpError(400,'invalid_enabled');
      if(body.booking_enabled){const faltan=bookingReadiness(env);if(faltan.length)throw new HttpError(503,`booking_falta_${faltan[0]}`);}
      sets.push('booking_enabled=?');args.push(body.booking_enabled?1:0);
    }
    for(const [field,min,max] of [['min_notice_min',0,43200],['max_days_ahead',1,365]])if(body[field]!==undefined){const n=Number(body[field]);if(!Number.isInteger(n)||n<min||n>max)throw new HttpError(400,'invalid_booking_rule');sets.push(`${field}=?`);args.push(n);}
    if(body.booking_note!==undefined){sets.push('booking_note=?');args.push(clean(body.booking_note,1000)||null);}
    if(body.exceptions!==undefined){
      if(!Array.isArray(body.exceptions)||body.exceptions.length>100)throw new HttpError(400,'invalid_exceptions');
      const seen=new Set();
      statements.push(env.DB.prepare('DELETE FROM calendar_exceptions WHERE tenant_id=?').bind(tenantId));
      for(const e of body.exceptions){
        if(!e||!validDate(e.date)||seen.has(e.date))throw new HttpError(400,'invalid_exceptions');seen.add(e.date);
        const windows=e.windows;
        if(windows!==null){if(!Array.isArray(windows)||windows.length>4)throw new HttpError(400,'invalid_exceptions');let last='';for(const w of windows){if(!Array.isArray(w)||w.length!==2||!/^([01]\d|2[0-3]):[0-5]\d$/.test(w[0])||!/^([01]\d|2[0-3]):[0-5]\d$/.test(w[1])||w[0]>=w[1]||w[0]<last)throw new HttpError(400,'invalid_exceptions');last=w[1];}}
        statements.push(env.DB.prepare('INSERT INTO calendar_exceptions(tenant_id,date,windows,note,created_at) VALUES (?,?,?,?,?)').bind(tenantId,e.date,windows===null?null:JSON.stringify(windows),clean(e.note,200)||null,new Date().toISOString()));
      }
    }
    const cal=await env.DB.prepare("SELECT tenant_id FROM tenant_calendars WHERE tenant_id=? AND status='connected'").bind(tenantId).first();
    if(!cal)throw new HttpError(404,'not_found');
    if(sets.length)statements.push(env.DB.prepare(`UPDATE tenant_calendars SET ${sets.join(',')},updated_at=? WHERE tenant_id=?`).bind(...args,new Date().toISOString(),tenantId));
    if(!statements.length)throw new HttpError(400,'nothing_to_update');
    await env.DB.batch(statements);
  }
  await invalidateAvailability(env,tenantId);
  ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions(tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)').bind(tenantId,actor,'calendar',null,services?'servicios editados':'reservas online editadas',new Date().toISOString()).run().catch(()=>{}));
  return json({ok:true},200,NO_STORE);
};
calendario.get('/api/admin/tenants/:id/booking',bookingAdmin);
calendario.patch('/api/admin/tenants/:id/booking',bookingAdmin);
calendario.get('/api/admin/tenants/:id/services',bookingAdmin);
calendario.post('/api/admin/tenants/:id/services',bookingAdmin);
calendario.patch('/api/admin/tenants/:id/services/:serviceId',bookingAdmin);
calendario.delete('/api/admin/tenants/:id/services/:serviceId',bookingAdmin);
