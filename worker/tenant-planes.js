// Derechos y configuración del catálogo. El cupo de canales nunca limita mensajes.
import { PLANES, MODULOS, CANALES, REDES, esPlan, kindPermitido, modulosDe, redesDe, canalesOcupados } from './planes.js';
import { HttpError } from './app.js';

export const catalogoPlanes = () => Object.entries(PLANES).map(([id, p]) => ({ id, ...p, canales: Number.isFinite(p.canales) ? p.canales : null,
  redes: p.kinds.filter((k) => REDES.includes(k)) }));

// Las excepciones de redes viajan en su PROPIO campo (`excepciones_redes: [{kind,estado}]`)
// y no dentro de `excepciones` con un prefijo: el panel antiguo manda `excepciones` sin
// saber de redes y el worker las conserva (undefined = las que ya había), y cada lista
// valida contra su propio catálogo sin adivinar a cuál pertenece una clave.
export function validarPlan(body, anterior = { plan: 'esencial', excepciones: [], excepciones_redes: [] }) {
  const plan = body.plan === undefined ? anterior.plan : body.plan;
  if (!esPlan(plan)) throw new HttpError(400, 'invalid_plan');
  const excepciones = body.excepciones === undefined ? anterior.excepciones : body.excepciones;
  if (!Array.isArray(excepciones) || excepciones.length > MODULOS.length) throw new HttpError(400, 'invalid_modulos');
  const seen = new Set();
  for (const r of excepciones) {
    if (!r || !MODULOS.includes(r.modulo) || !['on', 'off'].includes(r.estado) || seen.has(r.modulo)) throw new HttpError(400, 'invalid_modulos');
    seen.add(r.modulo);
  }
  const excepcionesRedes = body.excepciones_redes === undefined ? (anterior.excepciones_redes ?? []) : body.excepciones_redes;
  if (!Array.isArray(excepcionesRedes) || excepcionesRedes.length > REDES.length) throw new HttpError(400, 'invalid_redes');
  const seenRedes = new Set();
  for (const r of excepcionesRedes) {
    if (!r || !REDES.includes(r.kind) || !['on', 'off'].includes(r.estado) || seenRedes.has(r.kind)) throw new HttpError(400, 'invalid_redes');
    seenRedes.add(r.kind);
  }
  const modulos = modulosDe(plan, excepciones);
  if (modulos.includes('citas') && !modulos.includes('calendario')) throw new HttpError(400, 'citas_requires_calendario');
  return { plan, excepciones: excepciones.map(({ modulo, estado }) => ({ modulo, estado })), modulos,
    excepciones_redes: excepcionesRedes.map(({ kind, estado }) => ({ kind, estado })), redes: redesDe(plan, excepcionesRedes) };
}

export async function tenantPlan(env, id) {
  const [tenant, excepciones, channels, redes] = await env.DB.batch([
    env.DB.prepare('SELECT id,plan,plan_revision,updated_at,channel_address,web_origins FROM tenants WHERE id=?').bind(id),
    env.DB.prepare('SELECT modulo,estado,otorgado_por,otorgado_en FROM tenant_modulos WHERE tenant_id=? ORDER BY modulo').bind(id),
    env.DB.prepare('SELECT kind,address FROM tenant_channels WHERE tenant_id=?').bind(id),
    env.DB.prepare('SELECT kind,estado,otorgado_por,otorgado_en FROM tenant_redes WHERE tenant_id=? ORDER BY kind').bind(id),
  ]);
  const row = tenant.results?.[0];
  if (!row) throw new HttpError(404, 'not_found');
  const overrides = excepciones.results || [];
  const overridesRedes = redes.results || [];
  const canales = canalesOcupados(row, channels.results || []);
  const efectivas = redesDe(row.plan, overridesRedes);
  return { plan: row.plan, revision: row.plan_revision, updated_at: row.updated_at,
    modulos: modulosDe(row.plan, overrides), excepciones: overrides,
    canales, limite: esPlan(row.plan) && Number.isFinite(PLANES[row.plan].canales) ? PLANES[row.plan].canales : null,
    excepciones_redes: overridesRedes,
    redes: REDES.map((kind) => ({ kind, incluido: kindPermitido(row.plan, kind),
      estado: overridesRedes.find((r) => r.kind === kind)?.estado ?? null,
      efectivo: efectivas.includes(kind), conectado: canales.includes(kind) })),
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

// ¿Atiende el webhook por esta red? Sin caché a propósito: solo se consulta para
// direcciones de red (Messenger hoy, sin tráfico) y así apagar surte efecto al instante
// aunque la fila del tenant siga en KV. El plan sí sale de la fila cacheada, que se
// invalida al guardar el plan. Sin plan (fila de un mock antiguo) = Profesional, el mismo
// valor por defecto que usa el resto del worker.
export async function redActiva(env, tenant, kind) {
  const row = await env.DB.prepare('SELECT estado FROM tenant_redes WHERE tenant_id=? AND kind=?').bind(tenant.id, kind).first();
  return redesDe(tenant.plan ?? 'profesional', row?.estado ? [{ kind, estado: row.estado }] : []).includes(kind);
}

// Simula EXACTAMENTE syncPrimaryChannel: sustituir el primario no añade otro canal.
// `excepcionesRedes`: las que van a quedar guardadas (al cambiar el plan); null = leer las
// de D1, y solo si hace falta, para que el alta y los guardados sin redes no paguen la consulta.
export async function assertPlanChannelLimit(env, tenantId, plan, cambio = {}, previous = null, excepcionesRedes = null) {
  if (!esPlan(plan)) throw new HttpError(400, 'invalid_plan');
  let excepciones = excepcionesRedes;
  const redEncendida = async (kind) => {
    if (!excepciones) excepciones = tenantId ? (await env.DB.prepare('SELECT kind,estado FROM tenant_redes WHERE tenant_id=?').bind(tenantId).all()).results || [] : [];
    return redesDe(plan, excepciones).includes(kind);
  };
  // El TIPO se comprueba siempre, también en los planes sin tope, antes que la cantidad y
  // con su propio código porque el arreglo es otro — encender la red, no liberar un canal.
  // Un canal secundario de red entra si la red está ENCENDIDA (plan o excepción `on`).
  const kindSecundario = cambio.addChannel?.kind;
  if (kindSecundario && (REDES.includes(kindSecundario) ? !await redEncendida(kindSecundario) : !kindPermitido(plan, kindSecundario))) {
    throw new HttpError(409, 'plan_channel_kind');
  }
  // El PRIMARIO nunca es una red concedida como add-on: no hay clientes solo-red (Juan,
  // 2026-09-22). Una red como primario exige que la traiga el plan y que no esté revocada;
  // eso cubre también bajar de plan o revocar Messenger a quien lo tiene de primario.
  const tenant = previous || (tenantId ? await env.DB.prepare('SELECT channel_address,web_origins FROM tenants WHERE id=?').bind(tenantId).first() : {}) || {};
  const primario = String((cambio.channel_address !== undefined ? cambio.channel_address : tenant.channel_address) || '');
  const kindPrimario = CANALES.find((k) => k !== 'web' && primario.startsWith(`${k}:`));
  if (kindPrimario && (!kindPermitido(plan, kindPrimario) || (REDES.includes(kindPrimario) && !await redEncendida(kindPrimario)))) {
    throw new HttpError(409, 'plan_channel_kind');
  }
  // Sin tope no queda nada que contar.
  if (PLANES[plan].canales === Infinity) return;
  let filas = tenantId ? (await env.DB.prepare('SELECT kind,address FROM tenant_channels WHERE tenant_id=?').bind(tenantId).all()).results || [] : [];
  if (cambio.channel_address !== undefined && cambio.channel_address !== tenant.channel_address) {
    filas = filas.filter((r) => r.address !== tenant.channel_address);
  }
  if (cambio.addChannel) filas = [...filas, cambio.addChannel];
  // Las redes NO ocupan plaza en un plan que no las incluye: una concedida es un add-on
  // (como Telegram), y una conectada pero apagada —p. ej. tras bajar a Esencial— deja de
  // atender sin bloquear la bajada (R7/R8 de redes-plan). La fila de enrutado se conserva.
  const plazas = canalesOcupados({ ...tenant, ...cambio }, filas).filter((k) => kindPermitido(plan, k));
  if (plazas.length > PLANES[plan].canales) throw new HttpError(409, 'plan_channel_limit');
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
  // Las redes, con el mismo molde. Apagar NO toca tenant_channels: la página sigue
  // conectada y re-encender no obliga a reconectarla; el webhook la deja de atender.
  const redesExc = config.excepciones_redes ?? [];
  const keepRedes = redesExc.map((r) => r.kind);
  const excludedRedes = keepRedes.length ? ` AND kind NOT IN (${keepRedes.map(() => '?').join(',')})` : '';
  statements.push(env.DB.prepare(`DELETE FROM tenant_redes WHERE tenant_id=?${excludedRedes} AND ${guard}`).bind(id, ...keepRedes, id, revision));
  for (const { kind, estado } of redesExc) statements.push(env.DB.prepare(
    `INSERT INTO tenant_redes (tenant_id,kind,estado,otorgado_por,otorgado_en) SELECT ?,?,?,?,? WHERE ${guard}
      ON CONFLICT(tenant_id,kind) DO UPDATE SET estado=excluded.estado,otorgado_por=excluded.otorgado_por,otorgado_en=excluded.otorgado_en
      WHERE tenant_redes.estado<>excluded.estado`
  ).bind(id, kind, estado, actor, now, id, revision));
  if (!config.modulos.includes('citas')) {
    statements.push(env.DB.prepare(`UPDATE tenants SET reminders_enabled=0 WHERE id=? AND ${guard}`).bind(id, id, revision));
    statements.push(env.DB.prepare(`UPDATE tenant_calendars SET booking_enabled=0,booking_revision=booking_revision+1,updated_at=? WHERE tenant_id=? AND ${guard}`).bind(now, id, id, revision));
  }
  const auditoria = (c) => JSON.stringify({ plan: c.plan, excepciones: c.excepciones,
    excepciones_redes: (c.excepciones_redes ?? []).map(({ kind, estado }) => ({ kind, estado })) });
  statements.push(env.DB.prepare(`INSERT INTO tenant_versions (tenant_id,actor_email,field,previous_value,note,created_at)
    SELECT ?,?,'plan',?,?,? WHERE ${guard}`).bind(id, actor, previous ? auditoria(previous) : null,
    auditoria(config), now, id, revision));
  return statements;
}
