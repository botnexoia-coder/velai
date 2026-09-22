// Derechos y configuración del catálogo. El cupo de canales nunca limita mensajes.
import { PLANES, MODULOS, CANALES, esPlan, kindPermitido, modulosDe, canalesOcupados } from './planes.js';
import { HttpError } from './app.js';

export const catalogoPlanes = () => Object.entries(PLANES).map(([id, p]) => ({ id, ...p, canales: Number.isFinite(p.canales) ? p.canales : null }));

export function validarPlan(body, anterior = { plan: 'esencial', excepciones: [] }) {
  const plan = body.plan === undefined ? anterior.plan : body.plan;
  if (!esPlan(plan)) throw new HttpError(400, 'invalid_plan');
  const excepciones = body.excepciones === undefined ? anterior.excepciones : body.excepciones;
  if (!Array.isArray(excepciones) || excepciones.length > MODULOS.length) throw new HttpError(400, 'invalid_modulos');
  const seen = new Set();
  for (const r of excepciones) {
    if (!r || !MODULOS.includes(r.modulo) || !['on', 'off'].includes(r.estado) || seen.has(r.modulo)) throw new HttpError(400, 'invalid_modulos');
    seen.add(r.modulo);
  }
  const modulos = modulosDe(plan, excepciones);
  if (modulos.includes('citas') && !modulos.includes('calendario')) throw new HttpError(400, 'citas_requires_calendario');
  return { plan, excepciones: excepciones.map(({ modulo, estado }) => ({ modulo, estado })), modulos };
}

export async function tenantPlan(env, id) {
  const [tenant, excepciones, channels] = await env.DB.batch([
    env.DB.prepare('SELECT id,plan,plan_revision,updated_at,channel_address,web_origins FROM tenants WHERE id=?').bind(id),
    env.DB.prepare('SELECT modulo,estado,otorgado_por,otorgado_en FROM tenant_modulos WHERE tenant_id=? ORDER BY modulo').bind(id),
    env.DB.prepare('SELECT kind,address FROM tenant_channels WHERE tenant_id=?').bind(id),
  ]);
  const row = tenant.results?.[0];
  if (!row) throw new HttpError(404, 'not_found');
  const overrides = excepciones.results || [];
  return { plan: row.plan, revision: row.plan_revision, updated_at: row.updated_at,
    modulos: modulosDe(row.plan, overrides), excepciones: overrides,
    canales: canalesOcupados(row, channels.results || []), limite: esPlan(row.plan) && Number.isFinite(PLANES[row.plan].canales) ? PLANES[row.plan].canales : null,
    catalogo: catalogoPlanes(),
  };
}

async function derechoModulo(env, id, modulo) {
  return env.DB.prepare(`SELECT t.plan,t.plan_revision,m.estado FROM tenants t
    LEFT JOIN tenant_modulos m ON m.tenant_id=t.id AND m.modulo=? WHERE t.id=?`).bind(modulo, id).first();
}
function incluyeModulo(row, modulo) {
  return Boolean(row && modulosDe(row.plan, row.estado ? [{ modulo, estado: row.estado }] : []).includes(modulo));
}
export async function tieneModulo(env, id, modulo) {
  return incluyeModulo(await derechoModulo(env, id, modulo), modulo);
}
export async function assertTenantModulo(env, id, modulo) {
  const row = await derechoModulo(env, id, modulo);
  if (!incluyeModulo(row, modulo)) throw new HttpError(403, 'modulo_no_contratado');
  return row.plan_revision;
}

// Simula EXACTAMENTE syncPrimaryChannel: sustituir el primario no añade otro canal.
export async function assertPlanChannelLimit(env, tenantId, plan, cambio = {}, previous = null) {
  if (!esPlan(plan)) throw new HttpError(400, 'invalid_plan');
  // El TIPO se comprueba siempre, también en los planes sin tope: un Esencial no puede
  // llevarse Messenger ni aunque tenga su única plaza libre. Va antes que la cantidad y
  // con su propio código porque el arreglo es otro — subir de plan, no liberar un canal.
  const nuevo = cambio.addChannel?.kind
    || CANALES.find((k) => k !== 'web' && String(cambio.channel_address || '').startsWith(`${k}:`));
  if (nuevo && !kindPermitido(plan, nuevo)) throw new HttpError(409, 'plan_channel_kind');
  // Sin tope y con todos los tipos no hay nada que comprobar, y así el alta de un
  // Profesional no gasta dos consultas para averiguarlo.
  if (PLANES[plan].canales === Infinity && PLANES[plan].kinds.length === CANALES.length) return;
  const tenant = previous || (tenantId ? await env.DB.prepare('SELECT channel_address,web_origins FROM tenants WHERE id=?').bind(tenantId).first() : {});
  let filas = tenantId ? (await env.DB.prepare('SELECT kind,address FROM tenant_channels WHERE tenant_id=?').bind(tenantId).all()).results || [] : [];
  if (cambio.channel_address !== undefined && cambio.channel_address !== tenant.channel_address) {
    filas = filas.filter((r) => r.address !== tenant.channel_address);
  }
  if (cambio.addChannel) filas = [...filas, cambio.addChannel];
  const ocupados = canalesOcupados({ ...tenant, ...cambio }, filas);
  // También al BAJAR de plan: un cliente con Messenger que pasa a Esencial ocupa una sola
  // plaza y colaría por el cupo, pero su canal ya no entra en lo que el plan permite.
  if (ocupados.some((k) => !kindPermitido(plan, k))) throw new HttpError(409, 'plan_channel_kind');
  if (ocupados.length > PLANES[plan].canales) throw new HttpError(409, 'plan_channel_limit');
}

// Statements condicionadas a una revisión única: si el CAS falla, el resto del batch
// no cambia excepciones, flags ni auditoría. D1 ejecuta el batch en una transacción.
export function planStatements(env, id, config, actor, now, revision, previous = null) {
  const guard = 'EXISTS (SELECT 1 FROM tenants WHERE id=? AND plan_revision=?)';
  const keep = config.excepciones.map((r) => r.modulo);
  const excluded = keep.length ? ` AND modulo NOT IN (${keep.map(() => '?').join(',')})` : '';
  const statements = [env.DB.prepare(`DELETE FROM tenant_modulos WHERE tenant_id=?${excluded} AND ${guard}`).bind(id, ...keep, id, revision)];
  for (const { modulo, estado } of config.excepciones) statements.push(env.DB.prepare(
    `INSERT INTO tenant_modulos (tenant_id,modulo,estado,otorgado_por,otorgado_en) SELECT ?,?,?,?,? WHERE ${guard}
      ON CONFLICT(tenant_id,modulo) DO UPDATE SET estado=excluded.estado,otorgado_por=excluded.otorgado_por,otorgado_en=excluded.otorgado_en
      WHERE tenant_modulos.estado<>excluded.estado`
  ).bind(id, modulo, estado, actor, now, id, revision));
  if (!config.modulos.includes('citas')) {
    statements.push(env.DB.prepare(`UPDATE tenants SET reminders_enabled=0 WHERE id=? AND ${guard}`).bind(id, id, revision));
    statements.push(env.DB.prepare(`UPDATE tenant_calendars SET booking_enabled=0,booking_revision=booking_revision+1,updated_at=? WHERE tenant_id=? AND ${guard}`).bind(now, id, id, revision));
  }
  statements.push(env.DB.prepare(`INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at)
    SELECT ?,?,'plan',?,?,? WHERE ${guard}`).bind(id, actor, previous ? JSON.stringify({ plan: previous.plan, excepciones: previous.excepciones }) : null,
    JSON.stringify({ plan: config.plan, excepciones: config.excepciones }), now, id, revision));
  return statements;
}
