// Conciliación de retiros (migración 0065): control SEPARADO del libro.
// Agrupa por lote salidas bancarias YA registradas (fin_traspasos / fin_movimientos) y los
// usos del efectivo (pagos de compra ya registrados o declaraciones pendientes).
// Este módulo NUNCA escribe en fin_traspasos, fin_movimientos, g_pagos ni g_compras:
// solo las lee para enlazarlas. Una salida no se suma como retiro y como gasto a la vez
// porque aquí no existe ningún importe propio: todo cuelga de una referencia.
// Mismas reglas que vehiculos.js: puerta esSocio antes de D1, UUID de cliente +
// idempotencia en POST, versión optimista en PATCH, auditoría en el mismo batch.
import { Hono } from 'hono';
import { HttpError, json, NO_STORE, readJson } from './app.js';
import { esSocio, partesAdmin } from './middleware.js';
import {
  MONEDAS, fail, uuid, fechaReal, importePositivo, importeNoNegativo, enumValor, texto, versionDe, soloCampos,
  auditoria, versionAplicada, huella, idempotente,
} from './gestion-financiera.js';

export const retiros = new Hono();
const BASE = '/api/admin/gestion/retiros';

export const ORIGENES = ['traspaso', 'movimiento'];
export const CLASIFICACIONES = ['cajero_verificado', 'efectivo_declarado', 'traspaso_por_identificar'];
export const EVIDENCIAS_FUENTE = ['extracto', 'captura', 'declaracion'];
export const EVIDENCIAS_USO = ['extracto', 'captura', 'declaracion', 'documento', 'ninguna'];
export const ESTADOS_COSTE = ['confirmado', 'por_confirmar', 'autorizacion_pendiente'];
export const TIPOS_USO = ['pago_existente', 'declaracion'];
export const REEMBOLSOS = ['reembolsable', 'no_reembolsable'];
const MAX_FUENTES = 50, MAX_USOS = 100;

// ── Cálculo puro (sin D1): se puede probar con fuentes y usos ya cargados ─────
const suma = (xs, fn) => xs.reduce((s, x) => s + fn(x), 0);
const ORIGEN_VIGENTE = new Set(['activo', 'corregido']);
export const CLAVES_TOTALES = ['total_salidas', 'efectivo_confirmado', 'efectivo_declarado', 'traspasos_por_identificar', 'usos_registrados', 'usos_declarados', 'usos_total',
  'aportes_personales', 'aportes_reembolsables', 'aportes_no_reembolsables', 'aportes_sin_indicar', 'comisiones_conocidas', 'comisiones_por_confirmar',
  'comisiones_desconocidas', 'comisiones_por_confirmar_importe', 'diferencia_por_explicar', 'origen_no_trazado'];

// Una fuente cuenta si sigue activa en el control Y su operación original sigue vigente.
// Un uso cuenta si no está anulado y, si enlaza un pago, ese pago sigue activo.
// La diferencia NO es "efectivo sobrante": es lo que falta por explicar. Los traspasos
// por identificar nunca se convierten en efectivo, y el origen no trazado se muestra
// siempre (usos mayores que el efectivo confirmado) en vez de compensarse.
export function calcularLote(fuentes, usos) {
  const enControl = fuentes.filter((f) => f.estado === 'activa');
  const vivas = enControl.filter((f) => ORIGEN_VIGENTE.has(f.origen.estado));
  const anuladas = enControl.filter((f) => !ORIGEN_VIGENTE.has(f.origen.estado));
  const corregidas = vivas.filter((f) => f.origen.estado === 'corregido');
  const activos = usos.filter((u) => u.estado === 'activo');
  const usosVivos = activos.filter((u) => u.tipo !== 'pago_existente' || u.pago_vigente);
  const usosRotos = activos.filter((u) => u.tipo === 'pago_existente' && !u.pago_vigente);
  const de = (clase) => suma(vivas.filter((f) => f.clasificacion === clase), (f) => f.importe);
  const aporte = (u) => u.aporte_personal || 0;
  // Las comisiones solo se conocen si están confirmadas. Un traspaso por identificar no
  // es un retiro de efectivo y no se cuenta como comisión desconocida.
  const conocidas = vivas.filter((f) => f.comision != null && f.coste_estado === 'confirmado');
  const porConfirmar = vivas.filter((f) => f.clasificacion !== 'traspaso_por_identificar' && (f.comision == null || f.coste_estado !== 'confirmado'));
  const t = {
    total_salidas: suma(vivas, (f) => f.importe),
    efectivo_confirmado: de('cajero_verificado'),
    efectivo_declarado: de('efectivo_declarado'),
    traspasos_por_identificar: de('traspaso_por_identificar'),
    usos_registrados: suma(usosVivos.filter((u) => u.tipo === 'pago_existente'), (u) => u.importe_efectivo),
    usos_declarados: suma(usosVivos.filter((u) => u.tipo === 'declaracion'), (u) => u.importe_efectivo),
    aportes_personales: suma(usosVivos, aporte),
    aportes_reembolsables: suma(usosVivos.filter((u) => u.aporte_reembolso === 'reembolsable'), aporte),
    aportes_no_reembolsables: suma(usosVivos.filter((u) => u.aporte_reembolso === 'no_reembolsable'), aporte),
    aportes_sin_indicar: suma(usosVivos.filter((u) => aporte(u) > 0 && !u.aporte_reembolso), aporte),
    comisiones_conocidas: suma(conocidas, (f) => f.comision),
    comisiones_por_confirmar: porConfirmar.length,
    comisiones_desconocidas: porConfirmar.filter((f) => f.comision == null).length,
    comisiones_por_confirmar_importe: suma(porConfirmar, (f) => f.comision || 0),
  };
  t.usos_total = t.usos_registrados + t.usos_declarados;
  t.diferencia_por_explicar = t.total_salidas - t.usos_total - t.comisiones_conocidas;
  t.origen_no_trazado = Math.max(0, t.usos_total - t.efectivo_confirmado);
  // Abierta mientras quede cualquiera de estos motivos. No hay botón de "cerrada".
  const motivos = [];
  const motivo = (codigo, cantidad, importe) => motivos.push({ codigo, cantidad, importe: importe ?? null });
  if (!vivas.length) motivo('sin_fuentes', 0);
  if (t.traspasos_por_identificar > 0) motivo('traspasos_por_identificar', vivas.filter((f) => f.clasificacion === 'traspaso_por_identificar').length, t.traspasos_por_identificar);
  if (t.diferencia_por_explicar > 0) motivo('diferencia_por_explicar', 1, t.diferencia_por_explicar);
  if (t.diferencia_por_explicar < 0) motivo('usos_superan_salidas', 1, -t.diferencia_por_explicar);
  if (t.origen_no_trazado > 0) motivo('origen_no_trazado', 1, t.origen_no_trazado);
  if (anuladas.length) motivo('fuentes_anuladas', anuladas.length, suma(anuladas, (f) => f.importe));
  if (corregidas.length) motivo('fuentes_corregidas', corregidas.length, suma(corregidas, (f) => f.importe));
  if (vivas.some((f) => !f.evidencia)) motivo('fuentes_sin_evidencia', vivas.filter((f) => !f.evidencia).length);
  if (porConfirmar.length) motivo('comisiones_por_confirmar', porConfirmar.length, t.comisiones_por_confirmar_importe);
  if (usosVivos.some((u) => !u.fecha)) motivo('fechas_desconocidas', usosVivos.filter((u) => !u.fecha).length);
  if (usosVivos.some((u) => u.sin_documento)) motivo('usos_sin_documento', usosVivos.filter((u) => u.sin_documento).length);
  const declarados = usosVivos.filter((u) => u.tipo === 'declaracion');
  if (declarados.length) motivo('usos_declarados', declarados.length, t.usos_declarados);
  if (usosRotos.length) motivo('usos_con_pago_anulado', usosRotos.length, suma(usosRotos, (u) => u.importe_efectivo));
  return { totales: t, motivos, estado: motivos.length ? 'abierta' : 'sin_pendientes' };
}

// ── Utilidades de ruta ───────────────────────────────────────────────────────
function abrir(c) {
  const partes = partesAdmin(c);
  if (!esSocio(partes.env, partes.scope)) throw new HttpError(403, 'not_authorized');
  return { ...partes, now: new Date().toISOString() };
}
async function bodyOf(request) {
  const body = await readJson(request, 32000);
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('cuerpo_invalido');
  return body;
}
const idDe = (c, nombre = 'id') => { const v = c.req.param(nombre); return /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : null; };
const TABLAS = { g_retiro_lotes: 1, g_retiro_fuentes: 1, g_retiro_usos: 1 };
async function fila(env, tabla, id) {
  if (!id || !TABLAS[tabla]) throw new HttpError(404, 'not_found');
  const row = await env.DB.prepare(`SELECT * FROM ${tabla} WHERE id=?`).bind(id).first();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}
const MAPA_ERRORES = [['version_conflicto', 'version_conflicto', 409], ['retiro_uso_supera_pago', 'uso_supera_pago', 409], ['retiro_pago_no_vigente', 'pago_no_vigente', 409],
  ['retiro_moneda_distinta', 'moneda_distinta', 400], ['retiro_vinculo_inmutable', 'vinculo_inmutable', 409], ['retiro_sin_borrado', 'sin_borrado', 409]];
function traducir(e) {
  if (e instanceof HttpError) return e;
  const mensaje = String(e?.message || '');
  for (const [fragmento, code, status] of MAPA_ERRORES) if (mensaje.includes(fragmento)) return new HttpError(status, code);
  if (/UNIQUE constraint failed/.test(mensaje) && /g_retiro_fuentes/.test(mensaje)) return new HttpError(409, 'operacion_ya_vinculada');
  return e;
}
async function conTraduccion(fn) { try { return await fn(); } catch (e) { throw traducir(e); } }
// UPDATE con `AND version=?`; la auditoría solo se escribe si el UPDATE aplicó.
async function actualizar(env, tabla, id, version, set, args, audit) {
  let result;
  try {
    result = await env.DB.batch([
      env.DB.prepare(`UPDATE ${tabla} SET ${set}, version=version+1, updated_by=?, updated_at=? WHERE id=? AND version=?`).bind(...args, audit.actor, audit.now, id, version),
      auditoria(env, { ...audit, si: versionAplicada() }),
    ]);
  } catch (e) { throw traducir(e); }
  if (!result[0].meta.changes) throw new HttpError(409, 'version_conflicto');
}

// ── Lectura viva de los registros originales (solo SELECT) ───────────────────
const loteItem = (l) => ({ id: l.id, nombre: l.nombre, moneda: l.moneda, nota: l.nota, version: l.version, created_by: l.created_by, created_at: l.created_at, updated_by: l.updated_by, updated_at: l.updated_at });
const PAGOS_REVERTIBLES = "('compra_pago','prestamo_pago','compra_reembolso')";
async function origenVivo(env, f) {
  if (f.origen_tipo === 'traspaso') {
    const t = await env.DB.prepare(`SELECT t.id,t.fecha,t.moneda,t.importe,t.signo,t.nota,o.nombre AS cuenta_origen,d.nombre AS cuenta_destino,
      (SELECT r.id FROM fin_traspasos r WHERE r.reverso_de=t.id) AS reverso_id
      FROM fin_traspasos t JOIN g_cuentas o ON o.id=t.cuenta_origen_id JOIN g_cuentas d ON d.id=t.cuenta_destino_id WHERE t.id=?`).bind(f.origen_id).first();
    if (!t) return { estado: 'no_encontrado' };
    const estado = t.reverso_id || t.signo !== 1 ? 'anulado' : t.importe !== f.importe || t.moneda !== f.moneda ? 'corregido' : 'activo';
    return { estado, fecha: t.fecha, nota: t.nota, importe_actual: t.importe, cuenta_origen: t.cuenta_origen, cuenta_destino: t.cuenta_destino, reverso_id: t.reverso_id };
  }
  const m = await env.DB.prepare(`SELECT m.id,m.tipo,m.fecha,m.moneda,m.importe,m.signo,m.nota,cu.nombre AS cuenta,
    CASE WHEN m.origen_tipo IN ${PAGOS_REVERTIBLES} THEN (SELECT p.estado FROM g_pagos p WHERE p.id=m.origen_id) END AS pago_estado
    FROM fin_movimientos m LEFT JOIN g_cuentas cu ON cu.id=m.cuenta_id WHERE m.id=?`).bind(f.origen_id).first();
  if (!m) return { estado: 'no_encontrado' };
  const estado = m.signo !== 1 || m.tipo === 'ingreso' || m.pago_estado === 'revertido' ? 'anulado' : m.importe !== f.importe || m.moneda !== f.moneda ? 'corregido' : 'activo';
  return { estado, fecha: m.fecha, nota: m.nota, importe_actual: m.importe, tipo: m.tipo, cuenta_origen: m.cuenta, cuenta_destino: null, reverso_id: null };
}
const pagoVivo = (env, id) => env.DB.prepare(`SELECT p.id,p.fecha,p.importe,p.moneda,p.clase,p.estado,p.pagador,p.objeto_tipo,p.objeto_id,cu.nombre AS cuenta_nombre,c.concepto AS compra_concepto,
  (SELECT COALESCE(SUM(u.importe_efectivo),0) FROM g_retiro_usos u WHERE u.pago_id=p.id AND u.estado='activo') AS aplicado
  FROM g_pagos p LEFT JOIN g_cuentas cu ON cu.id=p.cuenta_id LEFT JOIN g_compras c ON p.objeto_tipo='compra' AND c.id=p.objeto_id WHERE p.id=?`).bind(id).first();
const compraViva = (env, id) => env.DB.prepare(`SELECT c.id,c.concepto,c.moneda,c.estado,(SELECT COUNT(*) FROM g_documentos d WHERE d.tipo='compra' AND d.objeto_id=c.id) AS documentos FROM g_compras c WHERE c.id=?`).bind(id).first();

const fuenteItem = (f, origen) => ({ id: f.id, lote_id: f.lote_id, origen_tipo: f.origen_tipo, origen_id: f.origen_id, importe: f.importe, moneda: f.moneda, clasificacion: f.clasificacion,
  evidencia: f.evidencia, declarado_por: f.declarado_por, nota: f.nota, comision: f.comision, coste_bancario_total: f.coste_bancario_total, coste_estado: f.coste_estado, estado: f.estado,
  version: f.version, created_by: f.created_by, created_at: f.created_at, updated_by: f.updated_by, updated_at: f.updated_at, origen });
async function usoItem(env, u) {
  const pago = u.pago_id ? await pagoVivo(env, u.pago_id) : null;
  const compraId = u.compra_id || (pago?.objeto_tipo === 'compra' ? pago.objeto_id : null);
  const compra = compraId ? await compraViva(env, compraId) : null;
  const pagoVigente = Boolean(pago && pago.clase === 'pago' && pago.estado === 'activo');
  const conPrueba = ['extracto', 'captura', 'documento'].includes(u.evidencia) || (compra?.documentos || 0) > 0;
  return { id: u.id, lote_id: u.lote_id, tipo: u.tipo, pago_id: u.pago_id, compra_id: compraId, concepto: u.concepto, importe_efectivo: u.importe_efectivo, aporte_personal: u.aporte_personal,
    aporte_reembolso: u.aporte_reembolso, fecha: u.fecha, evidencia: u.evidencia, declarado_por: u.declarado_por, nota: u.nota, estado: u.estado, version: u.version,
    created_by: u.created_by, created_at: u.created_at, updated_by: u.updated_by, updated_at: u.updated_at,
    pago: pago ? { fecha: pago.fecha, importe: pago.importe, estado: pago.estado, cuenta_nombre: pago.cuenta_nombre, aplicado: pago.aplicado } : null,
    compra: compra ? { id: compra.id, concepto: compra.concepto, documentos: compra.documentos } : null, pago_vigente: pagoVigente, sin_documento: !conPrueba };
}
async function cargar(env, lote) {
  const [fs, us] = (await env.DB.batch([
    env.DB.prepare('SELECT * FROM g_retiro_fuentes WHERE lote_id=? ORDER BY created_at, id').bind(lote.id),
    env.DB.prepare('SELECT * FROM g_retiro_usos WHERE lote_id=? ORDER BY created_at, id').bind(lote.id),
  ])).map((r) => r.results);
  const fuentes = [], usos = [];
  for (const f of fs) fuentes.push(fuenteItem(f, await origenVivo(env, f)));
  for (const u of us) usos.push(await usoItem(env, u));
  return { item: loteItem(lote), fuentes, usos, ...calcularLote(fuentes, usos) };
}
const fuenteCompleta = async (env, id) => { const f = await fila(env, 'g_retiro_fuentes', id); return fuenteItem(f, await origenVivo(env, f)); };

// ── Lotes ────────────────────────────────────────────────────────────────────
retiros.get(BASE, async (c) => {
  const { env } = abrir(c);
  const lotes = (await env.DB.prepare('SELECT * FROM g_retiro_lotes ORDER BY created_at DESC, id LIMIT 201').all()).results;
  const mas = lotes.length > 200; if (mas) lotes.pop();
  const items = [], totales = {};
  for (const l of lotes) {
    const d = await cargar(env, l);
    items.push({ ...d.item, estado: d.estado, motivos: d.motivos, totales: d.totales, fuentes_count: d.fuentes.length, usos_count: d.usos.length });
    const acc = totales[l.moneda] = totales[l.moneda] || Object.fromEntries([...CLAVES_TOTALES.map((k) => [k, 0]), ['lotes', 0], ['lotes_abiertos', 0]]);
    for (const k of CLAVES_TOTALES) acc[k] += d.totales[k];
    acc.lotes += 1; if (d.estado === 'abierta') acc.lotes_abiertos += 1;
  }
  return json({ items, mas, totales }, 200, NO_STORE);
});
retiros.post(BASE, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const b = await bodyOf(request);
  soloCampos(b, ['id', 'nombre', 'moneda', 'nota'], 'campo_desconocido');
  const q = { id: uuid(b.id), nombre: texto(b.nombre, 120, 'nombre_invalido'), moneda: b.moneda == null ? 'EUR' : enumValor(b.moneda, MONEDAS, 'moneda_invalida'), nota: texto(b.nota, 2000, 'nota_invalida', { opcional: true }) };
  const h = await huella(q);
  const { repetida } = await conTraduccion(() => idempotente(env, { id: q.id, ruta: 'retiros', huella: h, actor, now }, () => [
    env.DB.prepare('INSERT INTO g_retiro_lotes (id,nombre,moneda,nota,version,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,?,1,?,?,?,?)').bind(q.id, q.nombre, q.moneda, q.nota, actor, now, actor, now),
    auditoria(env, { actor, accion: 'retiro_lote_alta', objeto_tipo: 'retiro_lote', objeto_id: q.id, detalle: q, now }),
  ]));
  return json(await cargar(env, await fila(env, 'g_retiro_lotes', q.id)), repetida ? 200 : 201, NO_STORE);
});

// Operaciones del libro que se pueden enlazar (sin enlazar aún) y pagos con efectivo por aplicar.
retiros.get(`${BASE}/candidatos`, async (c) => {
  const { env } = abrir(c);
  const [traspasos, movimientos, pagos] = await env.DB.batch([
    env.DB.prepare(`SELECT t.id,t.fecha,t.moneda,t.importe,t.nota,o.nombre AS cuenta_origen,d.nombre AS cuenta_destino
      FROM fin_traspasos t JOIN g_cuentas o ON o.id=t.cuenta_origen_id JOIN g_cuentas d ON d.id=t.cuenta_destino_id
      WHERE t.signo=1 AND NOT EXISTS(SELECT 1 FROM fin_traspasos r WHERE r.reverso_de=t.id)
        AND NOT EXISTS(SELECT 1 FROM g_retiro_fuentes f WHERE f.origen_tipo='traspaso' AND f.origen_id=t.id AND f.estado='activa')
      ORDER BY t.fecha DESC,t.created_at DESC,t.id DESC LIMIT 200`),
    env.DB.prepare(`SELECT m.id,m.tipo,m.fecha,m.moneda,m.importe,m.nota,cu.nombre AS cuenta FROM fin_movimientos m LEFT JOIN g_cuentas cu ON cu.id=m.cuenta_id
      WHERE m.signo=1 AND m.tipo<>'ingreso'
        AND NOT (m.origen_tipo IN ${PAGOS_REVERTIBLES} AND COALESCE((SELECT p.estado FROM g_pagos p WHERE p.id=m.origen_id),'')='revertido')
        AND NOT EXISTS(SELECT 1 FROM g_retiro_fuentes f WHERE f.origen_tipo='movimiento' AND f.origen_id=m.id AND f.estado='activa')
      ORDER BY m.fecha DESC,m.created_at DESC,m.id DESC LIMIT 200`),
    env.DB.prepare(`SELECT * FROM (SELECT p.id,p.fecha,p.moneda,p.importe,cu.nombre AS cuenta_nombre,p.objeto_id AS compra_id,c.concepto,
        p.importe-(SELECT COALESCE(SUM(u.importe_efectivo),0) FROM g_retiro_usos u WHERE u.pago_id=p.id AND u.estado='activo') AS disponible
      FROM g_pagos p JOIN g_cuentas cu ON cu.id=p.cuenta_id JOIN g_compras c ON c.id=p.objeto_id
      WHERE p.objeto_tipo='compra' AND p.clase='pago' AND p.estado='activo' AND p.pagador='cuenta') WHERE disponible>0 ORDER BY fecha DESC,id LIMIT 200`),
  ]);
  return json({ traspasos: traspasos.results, movimientos: movimientos.results, pagos: pagos.results }, 200, NO_STORE);
});

retiros.get(`${BASE}/:id`, async (c) => {
  const { env } = abrir(c);
  const lote = await fila(env, 'g_retiro_lotes', idDe(c));
  const detalle = await cargar(env, lote);
  const historial = (await env.DB.prepare(`SELECT id,fecha,actor,accion,objeto_tipo,objeto_id,detalle FROM g_auditoria
    WHERE (objeto_tipo='retiro_lote' AND objeto_id=?) OR (objeto_tipo='retiro_fuente' AND objeto_id IN (SELECT id FROM g_retiro_fuentes WHERE lote_id=?))
      OR (objeto_tipo='retiro_uso' AND objeto_id IN (SELECT id FROM g_retiro_usos WHERE lote_id=?)) ORDER BY id DESC LIMIT 200`).bind(lote.id, lote.id, lote.id).all()).results
    .map((h) => { let d = null; try { d = h.detalle ? JSON.parse(h.detalle) : null; } catch { d = null; } return { ...h, detalle: d }; });
  return json({ ...detalle, historial }, 200, NO_STORE);
});
retiros.patch(`${BASE}/:id`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const old = await fila(env, 'g_retiro_lotes', idDe(c));
  const b = await bodyOf(request);
  soloCampos(b, ['version', 'nombre', 'nota']);
  const version = versionDe(b);
  if (version !== old.version) throw new HttpError(409, 'version_conflicto');
  const n = { nombre: b.nombre === undefined ? old.nombre : texto(b.nombre, 120, 'nombre_invalido'), nota: b.nota === undefined ? old.nota : texto(b.nota, 2000, 'nota_invalida', { opcional: true }) };
  await actualizar(env, 'g_retiro_lotes', old.id, version, 'nombre=?, nota=?', [n.nombre, n.nota],
    { actor, accion: 'retiro_lote_cambio', objeto_tipo: 'retiro_lote', objeto_id: old.id, detalle: { de: { nombre: old.nombre, nota: old.nota }, a: n }, now });
  return json(await cargar(env, await fila(env, 'g_retiro_lotes', old.id)), 200, NO_STORE);
});

// ── Fuentes: una operación existente del libro ───────────────────────────────
const CAMPOS_FUENTE = ['clasificacion', 'evidencia', 'declarado_por', 'nota', 'comision', 'coste_bancario_total', 'coste_estado'];
function camposFuente(b, base, importe) {
  const n = { ...base };
  if (b.clasificacion !== undefined) n.clasificacion = enumValor(b.clasificacion, CLASIFICACIONES, 'clasificacion_invalida');
  if (b.evidencia !== undefined) n.evidencia = b.evidencia == null ? null : enumValor(b.evidencia, EVIDENCIAS_FUENTE, 'evidencia_invalida');
  if (b.declarado_por !== undefined) n.declarado_por = texto(b.declarado_por, 120, 'declarante_invalido', { opcional: true });
  if (b.nota !== undefined) n.nota = texto(b.nota, 2000, 'nota_invalida', { opcional: true });
  // Comisión desconocida = null; un 0 solo vale si se indica expresamente.
  if (b.comision !== undefined) n.comision = b.comision == null ? null : importeNoNegativo(b.comision, 'comision_invalida');
  if (b.coste_bancario_total !== undefined) n.coste_bancario_total = b.coste_bancario_total == null ? null : importeNoNegativo(b.coste_bancario_total, 'coste_invalido');
  if (b.coste_estado !== undefined) n.coste_estado = enumValor(b.coste_estado, ESTADOS_COSTE, 'coste_estado_invalido');
  if (!n.clasificacion) fail('clasificacion_invalida');
  if (n.comision != null && n.comision > importe) fail('comision_invalida');
  if (n.clasificacion === 'cajero_verificado' && !['extracto', 'captura'].includes(n.evidencia)) fail('cajero_requiere_evidencia');
  if (n.evidencia === 'declaracion' && !n.declarado_por) fail('declarante_requerido');
  if (n.coste_estado === 'confirmado' && n.comision == null) fail('coste_confirmado_sin_importe');
  return n;
}
// La operación debe existir, ser una salida vigente y estar en la moneda del lote.
async function validarOrigen(env, lote, tipo, id) {
  let r;
  if (tipo === 'traspaso') {
    r = await env.DB.prepare('SELECT t.id,t.moneda,t.importe,t.signo,(SELECT x.id FROM fin_traspasos x WHERE x.reverso_de=t.id) AS reverso_id FROM fin_traspasos t WHERE t.id=?').bind(id).first();
    if (!r) fail('origen_no_encontrado');
    if (r.signo !== 1) fail('operacion_no_enlazable');
    if (r.reverso_id) fail('operacion_anulada');
  } else {
    r = await env.DB.prepare(`SELECT m.id,m.moneda,m.importe,m.signo,m.tipo,CASE WHEN m.origen_tipo IN ${PAGOS_REVERTIBLES} THEN (SELECT p.estado FROM g_pagos p WHERE p.id=m.origen_id) END AS pago_estado
      FROM fin_movimientos m WHERE m.id=?`).bind(id).first();
    if (!r) fail('origen_no_encontrado');
    if (r.signo !== 1 || r.tipo === 'ingreso') fail('operacion_no_enlazable');
    if (r.pago_estado === 'revertido') fail('operacion_anulada');
  }
  if (r.moneda !== lote.moneda) fail('moneda_distinta');
  return r;
}
const vinculadaActiva = (env, tipo, id, salvo = '') => env.DB.prepare("SELECT id FROM g_retiro_fuentes WHERE origen_tipo=? AND origen_id=? AND estado='activa' AND id<>?").bind(tipo, id, salvo).first();

retiros.post(`${BASE}/:id/fuentes`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const lote = await fila(env, 'g_retiro_lotes', idDe(c));
  const b = await bodyOf(request);
  soloCampos(b, ['id', 'origen_tipo', 'origen_id', ...CAMPOS_FUENTE], 'campo_desconocido');
  const q = { id: uuid(b.id), lote_id: lote.id, origen_tipo: enumValor(b.origen_tipo, ORIGENES, 'origen_invalido'), origen_id: texto(b.origen_id, 64, 'origen_invalido') };
  if (!/^[A-Za-z0-9_-]+$/.test(q.origen_id)) fail('origen_invalido');
  // Sin importe conocido aún: la validación de comisión contra el importe se repite al leer el original.
  const base = { clasificacion: null, evidencia: null, declarado_por: null, nota: null, comision: null, coste_bancario_total: null, coste_estado: 'por_confirmar' };
  const parcial = camposFuente(b, base, Number.MAX_SAFE_INTEGER);
  const h = await huella({ ...q, ...parcial });
  const { repetida } = await conTraduccion(() => idempotente(env, { id: q.id, ruta: `retiros/${lote.id}/fuentes`, huella: h, actor, now }, async () => {
    const origen = await validarOrigen(env, lote, q.origen_tipo, q.origen_id);
    camposFuente(b, base, origen.importe);
    if (await vinculadaActiva(env, q.origen_tipo, q.origen_id)) throw new HttpError(409, 'operacion_ya_vinculada');
    if ((await env.DB.prepare('SELECT COUNT(*) AS n FROM g_retiro_fuentes WHERE lote_id=?').bind(lote.id).first()).n >= MAX_FUENTES) throw new HttpError(409, 'lote_lleno');
    return [
      env.DB.prepare(`INSERT INTO g_retiro_fuentes (id,lote_id,origen_tipo,origen_id,importe,moneda,clasificacion,evidencia,declarado_por,nota,comision,coste_bancario_total,coste_estado,estado,version,created_by,created_at,updated_by,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'activa',1,?,?,?,?)`).bind(q.id, lote.id, q.origen_tipo, q.origen_id, origen.importe, lote.moneda, parcial.clasificacion, parcial.evidencia, parcial.declarado_por, parcial.nota,
        parcial.comision, parcial.coste_bancario_total, parcial.coste_estado, actor, now, actor, now),
      auditoria(env, { actor, accion: 'retiro_fuente_alta', objeto_tipo: 'retiro_fuente', objeto_id: q.id, detalle: { lote_id: lote.id, origen_tipo: q.origen_tipo, origen_id: q.origen_id, importe: origen.importe, ...parcial }, now }),
    ];
  }));
  return json({ item: await fuenteCompleta(env, q.id) }, repetida ? 200 : 201, NO_STORE);
});
retiros.patch(`${BASE}/:id/fuentes/:fid`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const old = await fila(env, 'g_retiro_fuentes', idDe(c, 'fid'));
  if (old.lote_id !== idDe(c)) throw new HttpError(404, 'not_found');
  const b = await bodyOf(request);
  soloCampos(b, ['version', 'estado', ...CAMPOS_FUENTE]);
  const version = versionDe(b);
  if (version !== old.version) throw new HttpError(409, 'version_conflicto');
  const n = camposFuente(b, Object.fromEntries(CAMPOS_FUENTE.map((k) => [k, old[k]])), old.importe);
  n.estado = b.estado === undefined ? old.estado : enumValor(b.estado, ['activa', 'retirada'], 'estado_invalido');
  if (n.estado === 'activa' && old.estado === 'retirada' && await vinculadaActiva(env, old.origen_tipo, old.origen_id, old.id)) throw new HttpError(409, 'operacion_ya_vinculada');
  await actualizar(env, 'g_retiro_fuentes', old.id, version, 'clasificacion=?, evidencia=?, declarado_por=?, nota=?, comision=?, coste_bancario_total=?, coste_estado=?, estado=?',
    [n.clasificacion, n.evidencia, n.declarado_por, n.nota, n.comision, n.coste_bancario_total, n.coste_estado, n.estado],
    { actor, accion: 'retiro_fuente_cambio', objeto_tipo: 'retiro_fuente', objeto_id: old.id, detalle: { de: Object.fromEntries([...CAMPOS_FUENTE, 'estado'].map((k) => [k, old[k]])), a: n }, now });
  return json({ item: await fuenteCompleta(env, old.id) }, 200, NO_STORE);
});

// ── Usos: pago ya registrado o declaración ───────────────────────────────────
const CAMPOS_USO = ['concepto', 'importe_efectivo', 'aporte_personal', 'aporte_reembolso', 'fecha', 'compra_id', 'evidencia', 'declarado_por', 'nota'];
function camposUso(b, base, tipo) {
  const n = { ...base };
  if (b.concepto !== undefined) n.concepto = texto(b.concepto, 160, 'concepto_invalido');
  if (b.importe_efectivo !== undefined) n.importe_efectivo = importePositivo(b.importe_efectivo, 'importe_invalido');
  // Aporte personal: dinero propio de quien pagó. 0 o ausente = sin aporte. Solo informa.
  if (b.aporte_personal !== undefined) { const v = b.aporte_personal == null ? null : importeNoNegativo(b.aporte_personal, 'aporte_invalido'); n.aporte_personal = v || null; }
  if (b.aporte_reembolso !== undefined) n.aporte_reembolso = b.aporte_reembolso == null ? null : enumValor(b.aporte_reembolso, REEMBOLSOS, 'aporte_reembolso_invalido');
  if (b.evidencia !== undefined) n.evidencia = enumValor(b.evidencia, EVIDENCIAS_USO, 'evidencia_invalida');
  if (b.declarado_por !== undefined) n.declarado_por = texto(b.declarado_por, 120, 'declarante_invalido', { opcional: true });
  if (b.nota !== undefined) n.nota = texto(b.nota, 2000, 'nota_invalida', { opcional: true });
  if (tipo === 'pago_existente') {
    // Fecha y compra salen del pago registrado: no se redeclaran.
    if (b.fecha !== undefined) fail('fecha_del_pago');
    if (b.compra_id !== undefined) fail('compra_del_pago');
  } else {
    if (b.fecha !== undefined) n.fecha = b.fecha == null ? null : fechaReal(b.fecha, 'fecha_invalida');
    if (b.compra_id !== undefined) n.compra_id = b.compra_id == null ? null : uuid(b.compra_id, 'compra_invalida');
  }
  if (n.importe_efectivo == null) fail('importe_invalido');
  if (n.aporte_reembolso && !n.aporte_personal) fail('reembolso_sin_aporte');
  if (n.evidencia === 'declaracion' && !n.declarado_por) fail('declarante_requerido');
  return n;
}
const usoCompleto = async (env, id) => usoItem(env, await fila(env, 'g_retiro_usos', id));
async function comprobarCompra(env, lote, compraId) {
  if (!compraId) return;
  const compra = await env.DB.prepare('SELECT id,moneda FROM g_compras WHERE id=?').bind(compraId).first();
  if (!compra) fail('compra_invalida');
  if (compra.moneda !== lote.moneda) fail('moneda_distinta');
}

retiros.post(`${BASE}/:id/usos`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const lote = await fila(env, 'g_retiro_lotes', idDe(c));
  const b = await bodyOf(request);
  soloCampos(b, ['id', 'tipo', 'pago_id', ...CAMPOS_USO], 'campo_desconocido');
  const tipo = enumValor(b.tipo, TIPOS_USO, 'tipo_invalido');
  const q = { id: uuid(b.id), lote_id: lote.id, tipo, pago_id: null };
  if (tipo === 'pago_existente') q.pago_id = uuid(b.pago_id, 'pago_invalido');
  else if (b.pago_id != null) fail('pago_no_aplica');
  const base = { concepto: null, importe_efectivo: null, aporte_personal: null, aporte_reembolso: null, fecha: null, compra_id: null, evidencia: tipo === 'declaracion' ? 'declaracion' : 'ninguna', declarado_por: null, nota: null };
  const n = camposUso(b, base, tipo);
  if (tipo === 'declaracion' && !n.concepto) fail('concepto_invalido');
  const h = await huella({ ...q, ...n });
  const { repetida } = await conTraduccion(() => idempotente(env, { id: q.id, ruta: `retiros/${lote.id}/usos`, huella: h, actor, now }, async () => {
    if ((await env.DB.prepare('SELECT COUNT(*) AS n FROM g_retiro_usos WHERE lote_id=?').bind(lote.id).first()).n >= MAX_USOS) throw new HttpError(409, 'lote_lleno');
    if (tipo === 'pago_existente') {
      const pago = await pagoVivo(env, q.pago_id);
      if (!pago) fail('pago_invalido');
      if (pago.clase !== 'pago' || pago.estado !== 'activo') throw new HttpError(409, 'pago_no_vigente');
      if (pago.pagador !== 'cuenta' || pago.objeto_tipo !== 'compra') fail('pago_no_enlazable');
      if (pago.moneda !== lote.moneda) fail('moneda_distinta');
      if (pago.aplicado + n.importe_efectivo > pago.importe) throw new HttpError(409, 'uso_supera_pago');
      n.fecha = pago.fecha; n.compra_id = pago.objeto_id; n.concepto = n.concepto || pago.compra_concepto || 'Pago registrado';
    } else await comprobarCompra(env, lote, n.compra_id);
    return [
      env.DB.prepare(`INSERT INTO g_retiro_usos (id,lote_id,tipo,pago_id,compra_id,concepto,importe_efectivo,aporte_personal,aporte_reembolso,fecha,evidencia,declarado_por,nota,estado,version,created_by,created_at,updated_by,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'activo',1,?,?,?,?)`).bind(q.id, lote.id, tipo, q.pago_id, n.compra_id, n.concepto, n.importe_efectivo, n.aporte_personal, n.aporte_reembolso, n.fecha, n.evidencia, n.declarado_por, n.nota, actor, now, actor, now),
      auditoria(env, { actor, accion: 'retiro_uso_alta', objeto_tipo: 'retiro_uso', objeto_id: q.id, detalle: { lote_id: lote.id, tipo, pago_id: q.pago_id, ...n }, now }),
    ];
  }));
  return json({ item: await usoCompleto(env, q.id) }, repetida ? 200 : 201, NO_STORE);
});
// Corregir una anotación o anular/reactivar el uso. Anular no toca el pago ni el libro.
retiros.patch(`${BASE}/:id/usos/:uid`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const lote = await fila(env, 'g_retiro_lotes', idDe(c));
  const old = await fila(env, 'g_retiro_usos', idDe(c, 'uid'));
  if (old.lote_id !== lote.id) throw new HttpError(404, 'not_found');
  const b = await bodyOf(request);
  soloCampos(b, ['version', 'estado', ...CAMPOS_USO]);
  const version = versionDe(b);
  if (version !== old.version) throw new HttpError(409, 'version_conflicto');
  const n = camposUso(b, Object.fromEntries(CAMPOS_USO.map((k) => [k, old[k]])), old.tipo);
  n.estado = b.estado === undefined ? old.estado : enumValor(b.estado, ['activo', 'anulado'], 'estado_invalido');
  if (old.tipo === 'declaracion' && n.compra_id !== old.compra_id) await comprobarCompra(env, lote, n.compra_id);
  await actualizar(env, 'g_retiro_usos', old.id, version, 'concepto=?, importe_efectivo=?, aporte_personal=?, aporte_reembolso=?, fecha=?, compra_id=?, evidencia=?, declarado_por=?, nota=?, estado=?',
    [n.concepto, n.importe_efectivo, n.aporte_personal, n.aporte_reembolso, n.fecha, n.compra_id, n.evidencia, n.declarado_por, n.nota, n.estado],
    { actor, accion: 'retiro_uso_cambio', objeto_tipo: 'retiro_uso', objeto_id: old.id, detalle: { de: Object.fromEntries([...CAMPOS_USO, 'estado'].map((k) => [k, old[k]])), a: n }, now });
  return json({ item: await usoCompleto(env, old.id) }, 200, NO_STORE);
});
