// Dominio SOLICITUDES del panel (SPEC de Juan, 2026-09-01): el cliente PIDE un cambio
// desde su vista de Plantillas y VELAI lo aprueba o rechaza — nada se aplica sin
// aprobación. La tabla tenant_solicitudes (0032) es genérica (tipo + payload JSON);
// hoy el único tipo es 'plantilla_recordatorio' (pareja de botones y/o antelación).
import { Hono } from 'hono';
import { partesAdmin } from '../middleware.js';
import { templateKind } from '../plantillas.js';
import {
  HttpError, json, NO_STORE, clean, readJson, rateLimited, sendTelegramText, escapeHtml,
  invalidateTenantCache, reminderHoursFor, tenantTemplate, recreateTemplateWithOptions,
} from '../app.js';

export const solicitudes = new Hono();

const TIPOS = new Set(['plantilla_recordatorio']);

// Copia local del parse seguro de opciones (la de routes/tenants.js es de su dominio):
// basura → null, nunca revienta.
function parseOpciones(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch (_) { return null; }
}

// Valida el payload de una solicitud CONTRA EL CATÁLOGO: pareja y antelación curadas
// — un valor hostil (id inventado, 'constructor', horas fuera de lista) es 400 sin
// efectos. Al menos un campo: una solicitud vacía no pide nada.
function validarPayload(body) {
  const def = templateKind('recordatorio_cita');
  const payload = {};
  if (body.botones !== undefined) {
    const pareja = typeof body.botones === 'string' ? (def.botones || []).find((b) => b.id === body.botones) || null : null;
    if (!pareja) throw new HttpError(400, 'invalid_botones');
    payload.botones = pareja.id;
  }
  if (body.antelacion !== undefined) {
    const n = Number(body.antelacion);
    if (!(def.antelaciones || []).includes(n)) throw new HttpError(400, 'invalid_antelacion');
    payload.antelacion = n;
  }
  if (!Object.keys(payload).length) throw new HttpError(400, 'empty_solicitud');
  return payload;
}

// Texto de→a del aviso y la auditoría, con lo ACTUAL delante para que Velai decida
// con contexto. `actual` = {hours, botones:{...}|null}.
function resumenCambio(payload, actual) {
  const def = templateKind('recordatorio_cita');
  const partes = [];
  if (payload.antelacion) partes.push(`antelación ${actual.hours} h → ${payload.antelacion} h`);
  if (payload.botones) {
    const de = actual.opciones?.textos ?? (def.botones || []).find((b) => b.id === def.botonesDefault);
    const a = (def.botones || []).find((b) => b.id === payload.botones);
    partes.push(`botones «${de?.confirmar}»/«${de?.cancelar}» → «${a?.confirmar}»/«${a?.cancelar}»`);
  }
  return partes.join(' · ');
}

// ── POST /api/admin/solicitudes: el cliente pide (entra en clienteAllowed) ────
solicitudes.post('/api/admin/solicitudes', async (c) => {
  const { env, request, ctx, scope, actor } = partesAdmin(c);
  // El tenant es SIEMPRE el del scope: Velai no solicita (aprueba), y un cliente no
  // puede nombrar a otro. Sin tenant en el scope no hay a quién atribuir la solicitud.
  if (!scope.tenantId) throw new HttpError(400, 'tenant_scope_required');
  if (await rateLimited(env, actor, 'solicitudes', 5)) throw new HttpError(429, 'rate_limited');
  const body = await readJson(request, 2000);
  const tipo = clean(body.tipo, 40);
  if (!TIPOS.has(tipo)) throw new HttpError(400, 'invalid_tipo');
  const payload = validarPayload(body);
  const tenant = await env.DB.prepare('SELECT id, slug, name, reminder_hours FROM tenants WHERE id = ?').bind(scope.tenantId).first();
  if (!tenant) throw new HttpError(404, 'not_found');
  const template = await tenantTemplate(env, scope.tenantId, 'recordatorio_cita');
  const actual = { hours: reminderHoursFor(tenant), opciones: parseOpciones(template && template.opciones) };
  const now = new Date().toISOString();
  let inserted;
  try {
    inserted = await env.DB.prepare('INSERT INTO tenant_solicitudes (tenant_id,tipo,payload,status,requested_by,created_at) VALUES (?,?,?,?,?,?)').bind(scope.tenantId, tipo, JSON.stringify(payload), 'pending', actor, now).run();
  } catch (error) {
    // El UNIQUE parcial de la 0032: máximo UNA pendiente por tenant y tipo — también
    // ante dos POST simultáneos (la carrera la corta D1, no una comprobación previa).
    if (/UNIQUE|constraint/i.test(String(error.message || error))) throw new HttpError(409, 'solicitud_pendiente');
    throw error;
  }
  const id = inserted.meta && inserted.meta.last_row_id;
  // Aviso a Velai por su Telegram operativo (molde de la casa): qué pidió quién.
  // En waitUntil con .catch — el aviso no puede tumbar la respuesta al cliente.
  ctx.waitUntil(sendTelegramText(env,
    `📝 <b>${escapeHtml(tenant.name)}</b> (${escapeHtml(tenant.slug)}) solicita un cambio de plantilla de recordatorios:\n${escapeHtml(resumenCambio(payload, actual))}\n<i>${escapeHtml(actor)}</i> — se aprueba en el panel → Plantillas.`)
    .catch(() => {}));
  console.log(JSON.stringify({ level: 'info', code: 'solicitud_creada', tenant: tenant.slug, tipo }));
  return json({ ok: true, id: id || null, status: 'pending' }, 201, NO_STORE);
});

// ── GET /api/admin/solicitudes: cliente = las suyas; velai = las pendientes ───
solicitudes.get('/api/admin/solicitudes', async (c) => {
  const { env, scope } = partesAdmin(c);
  if (scope.role !== 'velai') {
    // Sus solicitudes recientes (todas: la pendiente bloquea el form y la nota de un
    // rechazo se enseña). El id se ata desde el scope, jamás de la petición.
    const rows = (await env.DB.prepare('SELECT id, tipo, payload, status, nota, created_at, resolved_at FROM tenant_solicitudes WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 10').bind(scope.tenantId).all()).results || [];
    return json({ solicitudes: rows.map((r) => ({ ...r, payload: parseOpciones(r.payload) || {} })) }, 200, NO_STORE);
  }
  // Velai: las PENDIENTES de todos, con lo actual al lado para decidir de→a.
  // (La rama del cliente ya retornó: esta consulta no es alcanzable por él.)
  const rows = (await env.DB.prepare(`SELECT s.id, s.tenant_id, s.tipo, s.payload, s.requested_by, s.created_at,
      t.name AS tenant_name, t.reminder_hours, tt.opciones AS actual_opciones
    FROM tenant_solicitudes s
    JOIN tenants t ON t.id = s.tenant_id
    LEFT JOIN tenant_templates tt ON tt.tenant_id = s.tenant_id AND tt.kind = 'recordatorio_cita'
    WHERE s.status = 'pending' ORDER BY s.created_at ASC LIMIT 20`).all()).results || [];
  return json({
    solicitudes: rows.map((r) => ({
      id: r.id, tenant_id: r.tenant_id, tenant_name: r.tenant_name, tipo: r.tipo,
      payload: parseOpciones(r.payload) || {}, requested_by: r.requested_by, created_at: r.created_at,
      actual: { hours: reminderHoursFor(r), opciones: parseOpciones(r.actual_opciones) },
    })),
  }, 200, NO_STORE);
});

// ── Resolver (SOLO Velai — clienteAllowed no abre estas rutas) ────────────────
const resolver = async (c) => {
  const { env, request, ctx, scope, actor } = partesAdmin(c);
  if (scope.role !== 'velai') throw new HttpError(403, 'not_authorized');
  const id = Number(c.req.param('id'));
  const accion = c.req.param('accion');
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'not_found');
  const s = await env.DB.prepare('SELECT * FROM tenant_solicitudes WHERE id = ?').bind(id).first();
  if (!s) throw new HttpError(404, 'not_found');
  if (s.status !== 'pending') throw new HttpError(409, 'solicitud_resuelta');
  const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(s.tenant_id).first();
  if (!tenant) throw new HttpError(404, 'not_found');
  const now = new Date().toISOString();

  if (accion === 'rechazar') {
    const body = await readJson(request, 2000);
    // La nota es OBLIGATORIA: el cliente la ve en su panel — un rechazo mudo no le
    // dice qué corregir ni por qué.
    const nota = clean(body.nota, 300);
    if (nota.length < 3) throw new HttpError(400, 'invalid_nota');
    const res = await env.DB.prepare("UPDATE tenant_solicitudes SET status='rejected', nota=?, resolved_by=?, resolved_at=? WHERE id=? AND status='pending'").bind(nota, actor, now, id).run();
    if (!res.meta || !res.meta.changes) throw new HttpError(409, 'solicitud_resuelta');
    ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
      .bind(s.tenant_id, actor, 'config', s.payload, `solicitud del cliente RECHAZADA: ${nota}`, now).run().catch(() => {}));
    console.log(JSON.stringify({ level: 'info', code: 'solicitud_rechazada', tenant: tenant.slug, tipo: s.tipo }));
    return json({ ok: true, status: 'rejected' }, 200, NO_STORE);
  }

  // Aprobar = APLICAR. Orden pensado para fallar limpio: lo arriesgado (recrear la
  // plantilla en Twilio) va primero — si falla, NADA se aplicó y la solicitud SIGUE
  // pending con el código claro de siempre (subaccount_required, twilio_auth_token_missing…).
  const payload = parseOpciones(s.payload) || {};
  const def = templateKind('recordatorio_cita');
  const aplicado = {};
  if (payload.botones) {
    const pareja = (def.botones || []).find((b) => b.id === payload.botones);
    if (!pareja) throw new HttpError(400, 'invalid_botones'); // payload viejo con pareja retirada del catálogo
    const template = await tenantTemplate(env, s.tenant_id, 'recordatorio_cita');
    const actuales = parseOpciones(template && template.opciones);
    const actualId = (actuales && actuales.botones) || def.botonesDefault;
    // Solo se recrea si de verdad cambian: mismos botones = nada que enviar a Meta.
    if (pareja.id !== actualId || !template || !template.sid) {
      aplicado.sid = await recreateTemplateWithOptions(env, ctx, tenant, def, pareja, actor);
      aplicado.recreada = true;
    }
    aplicado.botones = pareja.id;
  }
  if (payload.antelacion) {
    if (!(def.antelaciones || []).includes(Number(payload.antelacion))) throw new HttpError(400, 'invalid_antelacion');
    await env.DB.prepare('UPDATE tenants SET reminder_hours=?, updated_at=? WHERE id=?').bind(String(payload.antelacion), now, s.tenant_id).run();
    await invalidateTenantCache(env, [tenant]);
    aplicado.antelacion = Number(payload.antelacion);
  }
  const res = await env.DB.prepare("UPDATE tenant_solicitudes SET status='approved', resolved_by=?, resolved_at=? WHERE id=? AND status='pending'").bind(actor, now, id).run();
  if (!res.meta || !res.meta.changes) throw new HttpError(409, 'solicitud_resuelta');
  ctx.waitUntil(env.DB.prepare('INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at) VALUES (?,?,?,?,?,?)')
    .bind(s.tenant_id, actor, 'config', s.payload, `solicitud del cliente APROBADA${aplicado.recreada ? ' (plantilla recreada, nueva revisión de Meta)' : ''}`, now).run().catch(() => {}));
  console.log(JSON.stringify({ level: 'info', code: 'solicitud_aprobada', tenant: tenant.slug, tipo: s.tipo, recreada: Boolean(aplicado.recreada) }));
  return json({ ok: true, status: 'approved', aplicado }, 200, NO_STORE);
};
solicitudes.post('/api/admin/solicitudes/:id/:accion{aprobar|rechazar}', resolver);
