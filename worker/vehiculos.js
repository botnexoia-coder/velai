// Control económico por vehículo y por viaje (negocio Coches, migración 0063).
// Enlaza registros que ya existen —compras, facturas, cobros, documentos— y calcula
// resúmenes. Enlazar o imputar NUNCA crea pagos, cobros ni movimientos de caja: el
// único asiento que escribe este módulo es el cobro explícito de una venta.
// Mismas reglas que gestion.js: puerta esSocio en cada handler antes de D1, UUID
// estable + idempotencia en POST, versión optimista en PATCH, auditoría en el batch.
import { Hono } from 'hono';
import { HttpError, json, NO_STORE, readJson } from './app.js';
import { esSocio, partesAdmin } from './middleware.js';
import {
  MONEDAS, TIPOS_VEHICULO, ESTADOS_VEHICULO, ESTADOS_VIAJE, REPARTOS_VIAJE, SELECT_COMPRA, SELECT_VEHICULO, SELECT_VIAJE,
  fail, uuid, uuidOpcional, fechaReal, fechaCivil, fechaOpcional, entero, importePositivo, importeNoNegativo, enumValor, texto, versionDe, soloCampos,
  compraItem, vehiculoItem, viajeItem, imputarViaje, auditoria, versionAplicada, errorEscrituraGestion, huella, idempotente,
} from './gestion-financiera.js';

export const vehiculos = new Hono();
const BASE = '/api/admin/gestion';

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
const idRuta = (c) => { const v = c.req.param('id'); return /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : null; };
async function fila(env, tabla, id) {
  if (!id) throw new HttpError(404, 'not_found');
  const row = await env.DB.prepare(`SELECT * FROM ${tabla} WHERE id=?`).bind(id).first();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}
// UPDATE con `AND version=?` y auditoría condicionada a changes(): un PATCH tardío
// recibe 409 y no deja rastro. Las sentencias `extra` deben ser no-ops por sí mismas
// cuando la versión no avanzó (ver participantesSql).
async function actualizar(env, tabla, id, version, set, args, audit, extra = []) {
  let result;
  try {
    result = await env.DB.batch([
      env.DB.prepare(`UPDATE ${tabla} SET ${set}, version=version+1, updated_at=? WHERE id=? AND version=?`).bind(...args, audit.now, id, version),
      auditoria(env, { ...audit, si: versionAplicada() }),
      ...extra,
    ]);
  } catch (e) { errorEscrituraGestion(e); }
  if (!result[0].meta.changes) throw new HttpError(409, 'version_conflicto');
}
const suma = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
const costeDe = (x) => x.estado === 'comprada' ? x.real : x.estimado;
const vehiculoCompleto = async (env, id) => vehiculoItem(await env.DB.prepare(`${SELECT_VEHICULO} WHERE v.id=?`).bind(id).first());
const viajeCompleto = async (env, id) => viajeItem(await env.DB.prepare(`${SELECT_VIAJE} WHERE t.id=?`).bind(id).first());
const participantesDe = async (env, viajeId) => (await env.DB.prepare(`SELECT vv.vehiculo_id, vv.peso_bp, v.referencia, v.tipo, v.marca, v.modelo, v.estado
  FROM g_viaje_vehiculos vv JOIN g_vehiculos v ON v.id=vv.vehiculo_id WHERE vv.viaje_id=? ORDER BY v.referencia COLLATE NOCASE, v.id`).bind(viajeId).all()).results;
const conjuntosDe = async (env, viajeId) => (await env.DB.prepare(`${SELECT_COMPRA} WHERE c.viaje_id=? AND c.vehiculo_id IS NULL ORDER BY COALESCE(c.fecha_compra,c.fecha_prevista,c.created_at), c.created_at, c.id`).bind(viajeId).all()).results.map(compraItem);
function porCategoria(compras) {
  const acc = {};
  for (const x of compras) { if (x.estado === 'cancelada') continue; const k = x.categoria || 'otros'; acc[k] = acc[k] || { categoria: k, importe: 0, pagado: 0, compras: 0 }; acc[k].importe += costeDe(x); acc[k].pagado += x.pagado; acc[k].compras += 1; }
  return Object.values(acc).sort((a, b) => b.importe - a.importe || a.categoria.localeCompare(b.categoria));
}

// ── Vehículos ────────────────────────────────────────────────────────────────
const mayus = (v, max, code) => { const t = texto(v, max, code, { opcional: true }); return t ? t.toUpperCase() : null; };
const campoVehiculo = {
  referencia: (v) => texto(v, 60, 'referencia_invalida'),
  tipo: (v) => v == null ? 'coche' : enumValor(v, TIPOS_VEHICULO, 'tipo_invalido'),
  marca: (v) => texto(v, 80, 'marca_invalida', { opcional: true }),
  modelo: (v) => texto(v, 80, 'modelo_invalido', { opcional: true }),
  matricula: (v) => mayus(v, 20, 'matricula_invalida'),
  vin: (v) => mayus(v, 30, 'vin_invalido'),
  fecha_compra: (v) => fechaOpcional(v, fechaReal, 'fecha_compra_invalida'),
  fecha_venta: (v) => fechaOpcional(v, fechaReal, 'fecha_venta_invalida'),
  // Precio acordado de venta: dato declarado. El cobro real se registra aparte.
  precio_venta: (v) => v == null ? null : importeNoNegativo(v, 'precio_venta_invalido'),
  prestamo_id: (v) => uuidOpcional(v, 'prestamo_invalido'),
  entidad_id: (v) => uuidOpcional(v, 'entidad_invalida'),
  nota: (v) => texto(v, 2000, 'nota_invalida', { opcional: true }),
};
async function referenciasVehiculo(env, n) {
  if (n.prestamo_id && !await env.DB.prepare('SELECT id FROM g_prestamos WHERE id=?').bind(n.prestamo_id).first()) fail('prestamo_invalido');
  if (n.entidad_id && !await env.DB.prepare('SELECT id FROM g_entidades WHERE id=?').bind(n.entidad_id).first()) fail('entidad_invalida');
  if (n.fecha_compra && n.fecha_venta && n.fecha_venta < n.fecha_compra) fail('fecha_venta_anterior');
}
const referenciaDuplicada = (e) => { if (/UNIQUE constraint failed: g_vehiculos\.referencia/.test(e.message)) throw new HttpError(409, 'referencia_duplicada'); throw e; };

vehiculos.get(`${BASE}/vehiculos`, async (c) => {
  const { env, url } = abrir(c);
  const clauses = ['1=1'], args = [];
  for (const [key, values] of [['estado', ESTADOS_VEHICULO], ['tipo', TIPOS_VEHICULO], ['moneda', MONEDAS]]) {
    const v = url.searchParams.get(key);
    if (v) { enumValor(v, values, `${key}_invalido`); clauses.push(`v.${key}=?`); args.push(v); }
  }
  const rows = (await env.DB.prepare(`${SELECT_VEHICULO} WHERE ${clauses.join(' AND ')} ORDER BY v.created_at DESC, v.id LIMIT 501`).bind(...args).all()).results;
  const mas = rows.length > 500; if (mas) rows.pop();
  return json({ items: rows.map(vehiculoItem), mas }, 200, NO_STORE);
});
vehiculos.post(`${BASE}/vehiculos`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const b = await bodyOf(request);
  soloCampos(b, ['id', 'moneda', 'estado', ...Object.keys(campoVehiculo)], 'campo_desconocido');
  const q = { id: uuid(b.id), moneda: b.moneda == null ? 'EUR' : enumValor(b.moneda, MONEDAS, 'moneda_invalida'), estado: b.estado == null ? 'previsto' : enumValor(b.estado, ESTADOS_VEHICULO, 'estado_invalido'),
    ...Object.fromEntries(Object.entries(campoVehiculo).map(([k, fn]) => [k, fn(b[k])])) };
  await referenciasVehiculo(env, q);
  let repetida;
  try {
    ({ repetida } = await idempotente(env, { id: q.id, ruta: 'vehiculos', huella: await huella(q), actor, now }, () => [
      env.DB.prepare(`INSERT INTO g_vehiculos (id,referencia,tipo,marca,modelo,matricula,vin,moneda,estado,fecha_compra,fecha_venta,precio_venta,prestamo_id,entidad_id,nota,version,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).bind(q.id, q.referencia, q.tipo, q.marca, q.modelo, q.matricula, q.vin, q.moneda, q.estado, q.fecha_compra, q.fecha_venta, q.precio_venta, q.prestamo_id, q.entidad_id, q.nota, actor, now, now),
      auditoria(env, { actor, accion: 'vehiculo_alta', objeto_tipo: 'vehiculo', objeto_id: q.id, detalle: { referencia: q.referencia, tipo: q.tipo, estado: q.estado, moneda: q.moneda }, now }),
    ]));
  } catch (e) { referenciaDuplicada(e); }
  return json({ item: await vehiculoCompleto(env, q.id) }, repetida ? 200 : 201, NO_STORE);
});
vehiculos.get(`${BASE}/vehiculos/:id`, async (c) => {
  const { env } = abrir(c);
  const item = await vehiculoCompleto(env, idRuta(c));
  if (!item) throw new HttpError(404, 'not_found');
  return json({ item }, 200, NO_STORE);
});
vehiculos.patch(`${BASE}/vehiculos/:id`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const old = await fila(env, 'g_vehiculos', idRuta(c));
  const b = await bodyOf(request);
  soloCampos(b, ['version', 'moneda', 'estado', ...Object.keys(campoVehiculo)]);
  const version = versionDe(b);
  if (version !== old.version) throw new HttpError(409, 'version_conflicto');
  const n = { moneda: b.moneda === undefined ? old.moneda : enumValor(b.moneda, MONEDAS, 'moneda_invalida'), estado: b.estado === undefined ? old.estado : enumValor(b.estado, ESTADOS_VEHICULO, 'estado_invalido'),
    ...Object.fromEntries(Object.entries(campoVehiculo).map(([k, fn]) => [k, b[k] === undefined ? old[k] : fn(b[k])])) };
  // La moneda fija la de todas sus operaciones: con registros enlazados no cambia.
  if (n.moneda !== old.moneda) {
    const uso = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM g_compras WHERE vehiculo_id=?)+(SELECT COUNT(*) FROM g_viaje_vehiculos WHERE vehiculo_id=?)
      +(SELECT COUNT(*) FROM fin_movimientos WHERE vehiculo_id=?)+(SELECT COUNT(*) FROM g_facturas WHERE vehiculo_id=?) AS n`).bind(old.id, old.id, old.id, old.id).first();
    if (uso.n) throw new HttpError(409, 'vehiculo_en_uso');
  }
  await referenciasVehiculo(env, n);
  try {
    await actualizar(env, 'g_vehiculos', old.id, version, 'referencia=?, tipo=?, marca=?, modelo=?, matricula=?, vin=?, moneda=?, estado=?, fecha_compra=?, fecha_venta=?, precio_venta=?, prestamo_id=?, entidad_id=?, nota=?',
      [n.referencia, n.tipo, n.marca, n.modelo, n.matricula, n.vin, n.moneda, n.estado, n.fecha_compra, n.fecha_venta, n.precio_venta, n.prestamo_id, n.entidad_id, n.nota],
      { actor, accion: 'vehiculo_cambio', objeto_tipo: 'vehiculo', objeto_id: old.id, detalle: { de: vehiculoItem(old), a: n }, now });
  } catch (e) { referenciaDuplicada(e); }
  return json({ item: await vehiculoCompleto(env, old.id) }, 200, NO_STORE);
});
// Ficha económica: directo (sus compras), imputado (su parte de cada viaje),
// gastos manuales del libro, venta declarada, facturas y cobros. Confirmado =
// solo pagos/cobros registrados; lo demás es estimación y se dice.
vehiculos.get(`${BASE}/vehiculos/:id/resumen`, async (c) => {
  const { env } = abrir(c);
  const id = idRuta(c);
  const row = id && await env.DB.prepare(`${SELECT_VEHICULO} WHERE v.id=?`).bind(id).first();
  if (!row) throw new HttpError(404, 'not_found');
  const v = vehiculoItem(row);
  const [compras, pagos, viajesRows, facturas, movimientos, documentos, prestamo] = await env.DB.batch([
    env.DB.prepare(`${SELECT_COMPRA} WHERE c.vehiculo_id=? ORDER BY COALESCE(c.fecha_compra,c.fecha_prevista,c.created_at), c.created_at, c.id`).bind(id),
    env.DB.prepare(`SELECT p.id,p.fecha,p.importe,p.pagador,p.socio,p.cuenta_id,p.objeto_id AS compra_id,c.concepto FROM g_pagos p JOIN g_compras c ON c.id=p.objeto_id
      WHERE p.objeto_tipo='compra' AND p.clase='pago' AND p.estado='activo' AND c.vehiculo_id=? ORDER BY p.fecha, p.created_at, p.id`).bind(id),
    env.DB.prepare(`${SELECT_VIAJE} WHERE t.id IN (SELECT viaje_id FROM g_viaje_vehiculos WHERE vehiculo_id=?) ORDER BY COALESCE(t.fecha_inicio,t.created_at), t.id`).bind(id),
    env.DB.prepare(`SELECT f.id,f.numero,f.tipo,f.estado,f.origen,f.total,f.moneda,f.fecha_emision,f.contraparte_nombre,f.compra_id FROM g_facturas f WHERE f.vehiculo_id=? ORDER BY COALESCE(f.fecha_emision,f.created_at), f.id`).bind(id),
    env.DB.prepare(`SELECT m.id,m.tipo,m.fecha,m.moneda,m.importe,m.signo,m.nota,m.cuenta_id,m.origen_tipo,m.naturaleza FROM fin_movimientos m WHERE m.vehiculo_id=? ORDER BY m.fecha, m.created_at, m.id`).bind(id),
    env.DB.prepare(`SELECT d.id,d.tipo,d.objeto_id,d.clase,d.nombre,d.mime,d.bytes,d.vence,d.created_at FROM g_documentos d
      WHERE (d.tipo='vehiculo' AND d.objeto_id=?) OR (d.tipo='compra' AND d.objeto_id IN (SELECT id FROM g_compras WHERE vehiculo_id=?))
         OR (d.tipo='factura' AND d.objeto_id IN (SELECT id FROM g_facturas WHERE vehiculo_id=?)) ORDER BY d.created_at, d.id`).bind(id, id, id),
    env.DB.prepare('SELECT id,nombre FROM g_prestamos WHERE id=?').bind(row.prestamo_id || ''),
  ]);
  const viajes = [];
  for (const t of viajesRows.results) {
    const participantes = await participantesDe(env, t.id);
    const imp = imputarViaje(t, participantes, await conjuntosDe(env, t.id));
    const mia = imp.por_vehiculo[id] || { coste: 0, pagado: 0 };
    viajes.push({ viaje: viajeItem(t), vehiculos: participantes.length, conjunto_total: imp.total, conjunto_pagado: imp.pagado, parte: mia.coste, parte_pagada: mia.pagado });
  }
  const activas = compras.results.map(compraItem).filter((x) => x.estado !== 'cancelada');
  const adquisicion = activas.filter((x) => x.categoria === 'adquisicion');
  const precio_compra = suma(adquisicion, costeDe), coste_directo = suma(activas, costeDe), pagado_directo = suma(activas, (x) => x.pagado);
  const imputado_viajes = suma(viajes, (t) => t.parte), imputado_viajes_pagado = suma(viajes, (t) => t.parte_pagada);
  const movs = movimientos.results;
  const gastos_manuales = suma(movs.filter((m) => m.tipo === 'gasto' && !m.origen_tipo), (m) => m.importe * m.signo);
  const cobros = movs.filter((m) => m.tipo === 'ingreso');
  const cobrado = suma(cobros, (m) => m.importe * m.signo), cobrado_en_cuenta = suma(cobros.filter((m) => m.cuenta_id), (m) => m.importe * m.signo);
  const facturado_venta = suma(facturas.results.filter((f) => f.tipo === 'emitida'), (f) => f.total);
  const coste_total = coste_directo + imputado_viajes + gastos_manuales;
  const invertido_confirmado = pagado_directo + imputado_viajes_pagado + gastos_manuales;
  const venta = v.precio_venta ?? (facturado_venta || null);
  const totales = {
    precio_compra, precio_compra_confirmado: adquisicion.length > 0 && adquisicion.every((x) => x.estado === 'comprada'),
    otros_costes_directos: coste_directo - precio_compra, coste_directo, pagado_directo, pendiente_directo: Math.max(0, coste_directo - pagado_directo),
    imputado_viajes, imputado_viajes_pagado, gastos_manuales, coste_total, invertido_confirmado, pendiente_pago: Math.max(0, coste_total - invertido_confirmado),
    precio_venta: v.precio_venta, facturado_venta, venta, cobrado, cobrado_en_cuenta, cobrado_pendiente_conciliar: cobrado - cobrado_en_cuenta,
    pendiente_cobro: venta == null ? null : Math.max(0, venta - cobrado),
    margen_estimado: venta == null ? null : venta - coste_total,
    margen_sin_viajes: venta == null ? null : venta - coste_directo - gastos_manuales,
    margen_confirmado: cobrado_en_cuenta - invertido_confirmado,
  };
  const fechaCompra = (x) => x.fecha_compra || x.fecha_prevista || null;
  const cronologia = [
    ...activas.map((x) => ({ fecha: fechaCompra(x), clase: 'compra', titulo: x.concepto, detalle: `${x.categoria} · ${x.estado}${x.viaje_id ? ' · en viaje' : ''}`, importe: costeDe(x), ref: { tipo: 'compra', id: x.id } })),
    ...pagos.results.map((p) => ({ fecha: p.fecha, clase: 'pago', titulo: `Pago: ${p.concepto}`, detalle: p.pagador === 'socio' ? `anticipo de ${p.socio}` : 'desde cuenta', importe: p.importe, ref: { tipo: 'compra', id: p.compra_id } })),
    ...viajes.map((t) => ({ fecha: t.viaje.fecha_inicio, clase: 'viaje', titulo: t.viaje.nombre, detalle: `${t.vehiculos} vehículo(s) · su parte de los gastos conjuntos`, importe: t.parte, ref: { tipo: 'viaje', id: t.viaje.id } })),
    ...facturas.results.map((f) => ({ fecha: f.fecha_emision, clase: 'factura', titulo: `${f.tipo === 'emitida' ? 'Factura de venta' : 'Factura recibida'} ${f.numero || ''}`.trim(), detalle: `${f.contraparte_nombre || ''} · ${f.estado}`.trim(), importe: f.total, ref: { tipo: 'factura', id: f.id } })),
    ...movs.map((m) => ({ fecha: m.fecha, clase: m.tipo === 'ingreso' ? 'cobro' : 'gasto', titulo: m.nota || (m.tipo === 'ingreso' ? 'Cobro' : 'Gasto'), detalle: m.cuenta_id ? 'en cuenta' : 'sin cuenta · pendiente de conciliar', importe: m.importe * m.signo, ref: { tipo: 'movimiento', id: m.id } })),
  ].sort((a, b) => String(a.fecha || '9999').localeCompare(String(b.fecha || '9999')) || a.clase.localeCompare(b.clase));
  return json({ vehiculo: v, prestamo: prestamo.results[0] || null, compras: compras.results.map(compraItem), viajes, facturas: facturas.results, cobros, gastos_manuales: movs.filter((m) => m.tipo === 'gasto'),
    documentos: documentos.results, por_categoria: porCategoria(activas), totales, cronologia }, 200, NO_STORE);
});
// Cobro de la venta: UNA entrada operativa con vehiculo_id, idempotente y auditada.
// Sin cuenta queda como cobro pendiente de conciliar; con cuenta, en su moneda.
vehiculos.post(`${BASE}/vehiculos/:id/cobros`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const v = await fila(env, 'g_vehiculos', idRuta(c));
  const b = await bodyOf(request);
  soloCampos(b, ['id', 'fecha', 'importe', 'cuenta_id', 'concepto_id', 'nota'], 'campo_desconocido');
  const pago = { id: uuid(b.id), fecha: fechaReal(b.fecha), importe: importePositivo(b.importe), cuenta_id: uuidOpcional(b.cuenta_id, 'cuenta_invalida'),
    concepto_id: entero(b.concepto_id, { min: 1, code: 'concepto_invalido' }), nota: texto(b.nota, 2000, 'nota_invalida', { opcional: true }) };
  const { repetida } = await idempotente(env, { id: pago.id, ruta: `vehiculos/${v.id}/cobros`, huella: await huella(pago), actor, now }, async () => {
    let cuenta = null;
    if (pago.cuenta_id) {
      cuenta = await env.DB.prepare('SELECT id,moneda,entidad_id FROM g_cuentas WHERE id=?').bind(pago.cuenta_id).first();
      if (!cuenta) fail('cuenta_invalida');
      if (cuenta.moneda !== v.moneda) fail('moneda_distinta');
    }
    const concepto = await env.DB.prepare('SELECT tipo,activo,clave FROM fin_conceptos WHERE id=?').bind(pago.concepto_id).first();
    if (!concepto || concepto.tipo !== 'ingreso') fail('concepto_invalido');
    if (concepto.clave) fail('concepto_de_gestion');
    if (!concepto.activo) fail('concepto_inactivo');
    return [
      env.DB.prepare(`INSERT INTO fin_movimientos (id,tipo,concepto_id,fecha,moneda,importe,nota,created_by,created_at,naturaleza,cuenta_id,entidad_id,vehiculo_id)
        VALUES (?,'ingreso',?,?,?,?,?,?,?,'operativo',?,?,?)`).bind(pago.id, pago.concepto_id, pago.fecha, v.moneda, pago.importe, pago.nota ?? `Cobro venta ${v.referencia}`, actor, now, cuenta?.id ?? null, cuenta?.entidad_id ?? null, v.id),
      auditoria(env, { actor, accion: 'vehiculo_cobro', objeto_tipo: 'vehiculo', objeto_id: v.id, detalle: pago, now }),
    ];
  });
  return json({ item: await fila(env, 'fin_movimientos', pago.id) }, repetida ? 200 : 201, NO_STORE);
});

// ── Viajes ───────────────────────────────────────────────────────────────────
const campoViaje = {
  nombre: (v) => texto(v, 160, 'nombre_invalido'),
  fecha_inicio: (v) => fechaOpcional(v, fechaCivil, 'fecha_inicio_invalida'),
  fecha_fin: (v) => fechaOpcional(v, fechaCivil, 'fecha_fin_invalida'),
  reparto: (v) => v == null ? 'igual' : enumValor(v, REPARTOS_VIAJE, 'reparto_invalido'),
  nota: (v) => texto(v, 2000, 'nota_invalida', { opcional: true }),
};
// Participantes del viaje. Con reparto 'igual' los pesos se ignoran (0); con
// 'manual' cada peso es positivo y suman exactamente 10000 bp.
function participantes(lista, reparto) {
  if (lista == null) return [];
  if (!Array.isArray(lista) || lista.length > 50) fail('vehiculos_invalidos');
  const out = lista.map((p) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) fail('vehiculos_invalidos');
    soloCampos(p, ['vehiculo_id', 'peso_bp'], 'vehiculos_invalidos');
    return { vehiculo_id: uuid(p.vehiculo_id, 'vehiculos_invalidos'), peso_bp: p.peso_bp == null ? 0 : entero(p.peso_bp, { min: 0, max: 10000, code: 'pesos_invalidos' }) };
  });
  if (new Set(out.map((p) => p.vehiculo_id)).size !== out.length) fail('vehiculos_repetidos');
  if (reparto === 'manual') { if (!out.length || out.some((p) => p.peso_bp <= 0) || out.reduce((s, p) => s + p.peso_bp, 0) !== 10000) fail('pesos_invalidos'); }
  else for (const p of out) p.peso_bp = 0;
  return out;
}
async function comprobarParticipantes(env, moneda, lista) {
  for (const p of lista) {
    const v = await env.DB.prepare('SELECT id,moneda FROM g_vehiculos WHERE id=?').bind(p.vehiculo_id).first();
    if (!v) fail('vehiculo_invalido');
    if (v.moneda !== moneda) fail('vehiculo_moneda_distinta');
  }
}
function validarFechas(n) { if (n.fecha_inicio && n.fecha_fin && n.fecha_fin < n.fecha_inicio) fail('fecha_fin_anterior'); }
// Sentencias de participantes condicionadas a la versión esperada del viaje: si el
// UPDATE del mismo batch no avanzó la versión, no borran ni insertan nada.
const participantesSql = (env, viajeId, versionEsperada, lista) => [
  env.DB.prepare('DELETE FROM g_viaje_vehiculos WHERE viaje_id=? AND (SELECT version FROM g_viajes WHERE id=?)=?').bind(viajeId, viajeId, versionEsperada),
  ...lista.map((p) => env.DB.prepare('INSERT INTO g_viaje_vehiculos (viaje_id,vehiculo_id,peso_bp) SELECT ?,?,? WHERE (SELECT version FROM g_viajes WHERE id=?)=?').bind(viajeId, p.vehiculo_id, p.peso_bp, viajeId, versionEsperada)),
];
async function detalleViaje(env, t) {
  const participantesViaje = await participantesDe(env, t.id);
  const conjuntos = await conjuntosDe(env, t.id);
  const directos = (await env.DB.prepare(`${SELECT_COMPRA} WHERE c.viaje_id=? AND c.vehiculo_id IS NOT NULL ORDER BY COALESCE(c.fecha_compra,c.fecha_prevista,c.created_at), c.created_at, c.id`).bind(t.id).all()).results.map(compraItem);
  const imp = imputarViaje(t, participantesViaje, conjuntos);
  const vehiculosDetalle = participantesViaje.map((p) => {
    const mios = directos.filter((x) => x.vehiculo_id === p.vehiculo_id && x.estado !== 'cancelada');
    const parte = imp.por_vehiculo[p.vehiculo_id];
    const directo = suma(mios, costeDe), directo_pagado = suma(mios, (x) => x.pagado);
    return { ...p, parte_conjunta: parte.coste, parte_conjunta_pagada: parte.pagado, directo, directo_pagado, total: parte.coste + directo, total_pagado: parte.pagado + directo_pagado };
  });
  const activas = [...conjuntos, ...directos].filter((x) => x.estado !== 'cancelada');
  const coste_directo = suma(directos.filter((x) => x.estado !== 'cancelada'), costeDe), pagado_directo = suma(directos, (x) => x.pagado);
  return { viaje: viajeItem(t), vehiculos: vehiculosDetalle, conjuntos, directos, por_categoria: porCategoria(activas),
    totales: { coste_conjunto: imp.total, pagado_conjunto: imp.pagado, coste_directo, pagado_directo, coste_total: imp.total + coste_directo, pagado: imp.pagado + pagado_directo,
      pendiente: Math.max(0, imp.total + coste_directo - imp.pagado - pagado_directo), sin_repartir: imp.sin_repartir, vehiculos: participantesViaje.length } };
}

vehiculos.get(`${BASE}/viajes`, async (c) => {
  const { env, url } = abrir(c);
  const clauses = ['1=1'], args = [];
  for (const [key, values] of [['estado', ESTADOS_VIAJE], ['moneda', MONEDAS]]) {
    const v = url.searchParams.get(key);
    if (v) { enumValor(v, values, `${key}_invalido`); clauses.push(`t.${key}=?`); args.push(v); }
  }
  const [rows, parts] = await env.DB.batch([
    env.DB.prepare(`${SELECT_VIAJE} WHERE ${clauses.join(' AND ')} ORDER BY COALESCE(t.fecha_inicio,t.created_at) DESC, t.id LIMIT 501`).bind(...args),
    env.DB.prepare('SELECT vv.viaje_id, vv.vehiculo_id, v.referencia FROM g_viaje_vehiculos vv JOIN g_vehiculos v ON v.id=vv.vehiculo_id ORDER BY v.referencia COLLATE NOCASE'),
  ]);
  const mas = rows.results.length > 500; if (mas) rows.results.pop();
  const porViaje = {};
  for (const p of parts.results) (porViaje[p.viaje_id] = porViaje[p.viaje_id] || []).push({ vehiculo_id: p.vehiculo_id, referencia: p.referencia });
  return json({ items: rows.results.map((r) => ({ ...viajeItem(r), vehiculos: porViaje[r.id] || [] })), mas }, 200, NO_STORE);
});
vehiculos.post(`${BASE}/viajes`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const b = await bodyOf(request);
  soloCampos(b, ['id', 'moneda', 'estado', 'vehiculos', ...Object.keys(campoViaje)], 'campo_desconocido');
  const q = { id: uuid(b.id), moneda: b.moneda == null ? 'EUR' : enumValor(b.moneda, MONEDAS, 'moneda_invalida'), estado: b.estado == null ? 'previsto' : enumValor(b.estado, ESTADOS_VIAJE, 'estado_invalido'),
    ...Object.fromEntries(Object.entries(campoViaje).map(([k, fn]) => [k, fn(b[k])])) };
  q.vehiculos = participantes(b.vehiculos, q.reparto);
  validarFechas(q);
  await comprobarParticipantes(env, q.moneda, q.vehiculos);
  const { repetida } = await idempotente(env, { id: q.id, ruta: 'viajes', huella: await huella(q), actor, now }, () => [
    env.DB.prepare(`INSERT INTO g_viajes (id,nombre,moneda,fecha_inicio,fecha_fin,estado,reparto,nota,version,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?,?)`)
      .bind(q.id, q.nombre, q.moneda, q.fecha_inicio, q.fecha_fin, q.estado, q.reparto, q.nota, actor, now, now),
    ...q.vehiculos.map((p) => env.DB.prepare('INSERT INTO g_viaje_vehiculos (viaje_id,vehiculo_id,peso_bp) VALUES (?,?,?)').bind(q.id, p.vehiculo_id, p.peso_bp)),
    auditoria(env, { actor, accion: 'viaje_alta', objeto_tipo: 'viaje', objeto_id: q.id, detalle: { nombre: q.nombre, reparto: q.reparto, vehiculos: q.vehiculos }, now }),
  ]);
  return json({ item: await viajeCompleto(env, q.id), vehiculos: await participantesDe(env, q.id) }, repetida ? 200 : 201, NO_STORE);
});
vehiculos.get(`${BASE}/viajes/:id`, async (c) => {
  const { env } = abrir(c);
  const item = await viajeCompleto(env, idRuta(c));
  if (!item) throw new HttpError(404, 'not_found');
  return json({ item, vehiculos: await participantesDe(env, item.id) }, 200, NO_STORE);
});
vehiculos.patch(`${BASE}/viajes/:id`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const old = await fila(env, 'g_viajes', idRuta(c));
  const b = await bodyOf(request);
  soloCampos(b, ['version', 'moneda', 'estado', 'vehiculos', ...Object.keys(campoViaje)]);
  const version = versionDe(b);
  if (version !== old.version) throw new HttpError(409, 'version_conflicto');
  const n = { moneda: b.moneda === undefined ? old.moneda : enumValor(b.moneda, MONEDAS, 'moneda_invalida'), estado: b.estado === undefined ? old.estado : enumValor(b.estado, ESTADOS_VIAJE, 'estado_invalido'),
    ...Object.fromEntries(Object.entries(campoViaje).map(([k, fn]) => [k, b[k] === undefined ? old[k] : fn(b[k])])) };
  validarFechas(n);
  const actuales = await participantesDe(env, old.id);
  const lista = b.vehiculos === undefined && n.reparto === old.reparto ? null : participantes(b.vehiculos === undefined ? actuales.map((p) => ({ vehiculo_id: p.vehiculo_id, peso_bp: p.peso_bp })) : b.vehiculos, n.reparto);
  if (n.moneda !== old.moneda && (await env.DB.prepare('SELECT COUNT(*) AS n FROM g_compras WHERE viaje_id=?').bind(old.id).first()).n) throw new HttpError(409, 'viaje_en_uso');
  const extra = [];
  if (lista) {
    await comprobarParticipantes(env, n.moneda, lista);
    // Un vehículo con gastos directos en este viaje no se quita: antes se reasignan.
    const quitados = actuales.filter((p) => !lista.some((q) => q.vehiculo_id === p.vehiculo_id));
    for (const p of quitados) {
      const uso = await env.DB.prepare('SELECT COUNT(*) AS n FROM g_compras WHERE viaje_id=? AND vehiculo_id=?').bind(old.id, p.vehiculo_id).first();
      if (uso.n) throw new HttpError(409, 'vehiculo_con_gastos_en_viaje');
    }
    extra.push(...participantesSql(env, old.id, version + 1, lista));
  }
  await actualizar(env, 'g_viajes', old.id, version, 'nombre=?, moneda=?, fecha_inicio=?, fecha_fin=?, estado=?, reparto=?, nota=?', [n.nombre, n.moneda, n.fecha_inicio, n.fecha_fin, n.estado, n.reparto, n.nota],
    { actor, accion: 'viaje_cambio', objeto_tipo: 'viaje', objeto_id: old.id, detalle: { de: { ...viajeItem(old), vehiculos: actuales.map((p) => ({ vehiculo_id: p.vehiculo_id, peso_bp: p.peso_bp })) }, a: { ...n, vehiculos: lista ?? undefined } }, now }, extra);
  return json({ item: await viajeCompleto(env, old.id), vehiculos: await participantesDe(env, old.id) }, 200, NO_STORE);
});
vehiculos.get(`${BASE}/viajes/:id/resumen`, async (c) => {
  const { env } = abrir(c);
  const id = idRuta(c);
  const t = id && await env.DB.prepare(`${SELECT_VIAJE} WHERE t.id=?`).bind(id).first();
  if (!t) throw new HttpError(404, 'not_found');
  return json(await detalleViaje(env, t), 200, NO_STORE);
});
