// Administración financiera (docs/SPEC-ADMINISTRACION-FINANCIERA.md): entidades,
// cuentas, préstamos, compras, resumen y documentos privados. Como en Finanzas, la
// guarda esSocio vive en CADA handler antes de tocar D1 o R2, además de clienteGate.
// Contrato: GET listas {items:[...]}; POST/PATCH {item:{...}}; errores HttpError.
import { Hono } from 'hono';
import { esSocio, partesAdmin } from '../middleware.js';
import { HttpError, json, NO_STORE, readJson } from '../app.js';
import {
  NEGOCIOS, MONEDAS, MONEDAS_PRESTAMO, TIPOS_ENTIDAD, ESTADOS_ENTIDAD, ESTADOS_COMPRA, TIPOS_DOCUMENTO, PAGADORES,
  DOC_MAX_BYTES, DOC_HEADERS, PRINCIPAL_MAX, TIN_BP_MAX, SELECT_COMPRA,
  fail, uuid, uuidOpcional, fechaCivil, fechaReal, fechaOpcional, entero, importePositivo, importeNoNegativo, enumValor, texto,
  versionDe, soloCampos, socioEmail, condiciones, validarCalendario, prestamoItem, pagoItem, resumenPrestamo, compraItem,
  detectarDocumento, nombreSeguro, documentoItem, sha256Hex, objetoExiste, conceptosGestion, partidaCaja, partidasEspejo,
  auditoria, versionAplicada, reclamarVersion, errorEscrituraGestion, huella, idempotente,
} from '../gestion-financiera.js';

export const gestion = new Hono();
const BASE = '/api/admin/gestion';

// La puerta, idéntica en todos los handlers: 403 sin una sola consulta.
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
async function fila(env, tabla, id) {
  if (!id) throw new HttpError(404, 'not_found');
  const row = await env.DB.prepare(`SELECT * FROM ${tabla} WHERE id=?`).bind(id).first();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}
// Un id de ruta que no es UUID no existe (404), no es un 400: no se filtra el motivo.
const idRuta = (c, nombre = 'id') => { const v = c.req.param(nombre); return /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : null; };
const nif = (v) => { const t = texto(v, 20, 'nif_invalido', { opcional: true }); if (t && !/^[A-Za-z0-9-]+$/.test(t)) fail('nif_invalido'); return t ? t.toUpperCase() : null; };
const entidadItem = (r) => r && ({ id: r.id, nombre: r.nombre, tipo: r.tipo, nif: r.nif, direccion: r.direccion, estado: r.estado, version: r.version });
const cuentaItem = (r) => r && ({ id: r.id, nombre: r.nombre, entidad_id: r.entidad_id, moneda: r.moneda, saldo_inicial: r.saldo_inicial, fecha_saldo: r.fecha_saldo, conciliada: r.conciliada, version: r.version });
const compraCompleta = async (env, id) => compraItem(await env.DB.prepare(`${SELECT_COMPRA} WHERE c.id=?`).bind(id).first());
const pagosDe = async (env, tipo, id) => (await env.DB.prepare('SELECT * FROM g_pagos WHERE objeto_tipo=? AND objeto_id=? ORDER BY fecha, created_at, id').bind(tipo, id).all()).results;
const resumenDe = async (env, id) => resumenPrestamo(await fila(env, 'g_prestamos', id), await pagosDe(env, 'prestamo', id));
async function entidadExiste(env, id) { if (id && !await env.DB.prepare('SELECT id FROM g_entidades WHERE id=?').bind(id).first()) fail('entidad_invalida'); return id; }
async function cuentaDe(env, id, code = 'cuenta_invalida') {
  const row = await env.DB.prepare('SELECT * FROM g_cuentas WHERE id=?').bind(id).first();
  if (!row) fail(code);
  return row;
}
// Versión optimista: el UPDATE lleva `AND version=?` y la auditoría solo se escribe si
// aplicó; cero cambios = alguien guardó antes (409), nunca una sobreescritura muda.
async function actualizar(env, tabla, id, version, set, args, audit) {
  let result;
  try { result = await env.DB.batch([
    env.DB.prepare(`UPDATE ${tabla} SET ${set}, version=version+1, updated_at=? WHERE id=? AND version=?`).bind(...args, audit.now, id, version),
    auditoria(env, { ...audit, si: versionAplicada(tabla, id, version + 1) }),
  ]); } catch (e) { errorEscrituraGestion(e); }
  if (!result[0].meta.changes) throw new HttpError(409, 'version_conflicto');
}

// ── Catálogos ────────────────────────────────────────────────────────────────
gestion.get(`${BASE}/catalogos`, async (c) => {
  const { env } = abrir(c);
  const [entidades, cuentas, socios] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM g_entidades ORDER BY nombre COLLATE NOCASE, id'),
    env.DB.prepare('SELECT * FROM g_cuentas ORDER BY moneda, nombre COLLATE NOCASE, id'),
    // Solo nombre y correo de los socios internos: no concede ni refleja accesos.
    env.DB.prepare('SELECT email,nombre FROM fin_socios WHERE activo=1 ORDER BY nombre COLLATE NOCASE, email'),
  ]);
  return json({ entidades: entidades.results.map(entidadItem), cuentas: cuentas.results.map(cuentaItem), socios: socios.results, negocios: NEGOCIOS }, 200, NO_STORE);
});

// ── Entidades ────────────────────────────────────────────────────────────────
gestion.get(`${BASE}/entidades`, async (c) => {
  const { env } = abrir(c);
  const rows = (await env.DB.prepare('SELECT * FROM g_entidades ORDER BY nombre COLLATE NOCASE, id').all()).results;
  return json({ items: rows.map(entidadItem) }, 200, NO_STORE);
});
gestion.post(`${BASE}/entidades`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const b = await bodyOf(request);
  soloCampos(b, ['id', 'nombre', 'tipo', 'nif', 'direccion'], 'campo_desconocido');
  const e = { id: uuid(b.id), nombre: texto(b.nombre, 160, 'nombre_invalido'), tipo: enumValor(b.tipo, TIPOS_ENTIDAD, 'tipo_invalido'), nif: nif(b.nif), direccion: texto(b.direccion, 300, 'direccion_invalida', { opcional: true }) };
  const { repetida } = await idempotente(env, { id: e.id, ruta: 'entidades', huella: await huella(e), actor, now }, () => [
    env.DB.prepare("INSERT INTO g_entidades (id,nombre,tipo,nif,direccion,estado,version,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'pendiente',1,?,?,?)").bind(e.id, e.nombre, e.tipo, e.nif, e.direccion, actor, now, now),
    auditoria(env, { actor, accion: 'entidad_alta', objeto_tipo: 'entidad', objeto_id: e.id, detalle: { nombre: e.nombre, tipo: e.tipo }, now }),
  ]);
  return json({ item: entidadItem(await fila(env, 'g_entidades', e.id)) }, repetida ? 200 : 201, NO_STORE);
});
gestion.patch(`${BASE}/entidades/:id`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const old = await fila(env, 'g_entidades', idRuta(c));
  const b = await bodyOf(request);
  soloCampos(b, ['version', 'nombre', 'tipo', 'nif', 'direccion', 'estado']);
  const version = versionDe(b);
  if (version !== old.version) throw new HttpError(409, 'version_conflicto');
  const n = {
    nombre: b.nombre === undefined ? old.nombre : texto(b.nombre, 160, 'nombre_invalido'),
    tipo: b.tipo === undefined ? old.tipo : enumValor(b.tipo, TIPOS_ENTIDAD, 'tipo_invalido'),
    nif: b.nif === undefined ? old.nif : nif(b.nif),
    direccion: b.direccion === undefined ? old.direccion : texto(b.direccion, 300, 'direccion_invalida', { opcional: true }),
    estado: b.estado === undefined ? old.estado : enumValor(b.estado, ESTADOS_ENTIDAD, 'estado_invalido'),
  };
  // Activar exige identificación fiscal. El tipo de una entidad activa no se cambia
  // por PATCH: afecta a lo que puede emitir (promotores no factura).
  if (n.estado === 'activa' && !n.nif) fail('nif_requerido');
  if (n.tipo !== old.tipo && old.estado === 'activa') throw new HttpError(409, 'entidad_activa');
  await actualizar(env, 'g_entidades', old.id, version, 'nombre=?, tipo=?, nif=?, direccion=?, estado=?', [n.nombre, n.tipo, n.nif, n.direccion, n.estado],
    { actor, accion: 'entidad_cambio', objeto_tipo: 'entidad', objeto_id: old.id, detalle: { de: entidadItem(old), a: n }, now });
  return json({ item: entidadItem(await fila(env, 'g_entidades', old.id)) }, 200, NO_STORE);
});

// ── Cuentas ──────────────────────────────────────────────────────────────────
gestion.get(`${BASE}/cuentas`, async (c) => {
  const { env } = abrir(c);
  const rows = (await env.DB.prepare('SELECT * FROM g_cuentas ORDER BY moneda, nombre COLLATE NOCASE, id').all()).results;
  return json({ items: rows.map(cuentaItem) }, 200, NO_STORE);
});
const saldoInicial = (v) => v == null ? 0 : entero(v, { min: -(10 ** 13), code: 'saldo_invalido' });
const bandera = (v, code) => v == null ? 0 : [0, 1].includes(v) ? v : fail(code);
gestion.post(`${BASE}/cuentas`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const b = await bodyOf(request);
  soloCampos(b, ['id', 'nombre', 'entidad_id', 'moneda', 'saldo_inicial', 'fecha_saldo', 'conciliada'], 'campo_desconocido');
  const q = { id: uuid(b.id), nombre: texto(b.nombre, 160, 'nombre_invalido'), entidad_id: uuidOpcional(b.entidad_id, 'entidad_invalida'), moneda: enumValor(b.moneda, MONEDAS, 'moneda_invalida'),
    saldo_inicial: saldoInicial(b.saldo_inicial), fecha_saldo: fechaOpcional(b.fecha_saldo, fechaReal, 'fecha_saldo_invalida'), conciliada: bandera(b.conciliada, 'conciliada_invalida') };
  // Sin fecha del extracto no hay saldo verificado que mostrar como tal.
  if (q.conciliada && !q.fecha_saldo) fail('fecha_saldo_requerida');
  await entidadExiste(env, q.entidad_id);
  const { repetida } = await idempotente(env, { id: q.id, ruta: 'cuentas', huella: await huella(q), actor, now }, () => [
    env.DB.prepare('INSERT INTO g_cuentas (id,nombre,entidad_id,moneda,saldo_inicial,fecha_saldo,conciliada,version,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)')
      .bind(q.id, q.nombre, q.entidad_id, q.moneda, q.saldo_inicial, q.fecha_saldo, q.conciliada, actor, now, now),
    auditoria(env, { actor, accion: 'cuenta_alta', objeto_tipo: 'cuenta', objeto_id: q.id, detalle: { nombre: q.nombre, moneda: q.moneda, saldo_inicial: q.saldo_inicial }, now }),
  ]);
  return json({ item: cuentaItem(await fila(env, 'g_cuentas', q.id)) }, repetida ? 200 : 201, NO_STORE);
});
gestion.patch(`${BASE}/cuentas/:id`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const old = await fila(env, 'g_cuentas', idRuta(c));
  const b = await bodyOf(request);
  soloCampos(b, ['version', 'nombre', 'entidad_id', 'moneda', 'saldo_inicial', 'fecha_saldo', 'conciliada']);
  const version = versionDe(b);
  if (version !== old.version) throw new HttpError(409, 'version_conflicto');
  const n = {
    nombre: b.nombre === undefined ? old.nombre : texto(b.nombre, 160, 'nombre_invalido'),
    entidad_id: b.entidad_id === undefined ? old.entidad_id : uuidOpcional(b.entidad_id, 'entidad_invalida'),
    moneda: b.moneda === undefined ? old.moneda : enumValor(b.moneda, MONEDAS, 'moneda_invalida'),
    saldo_inicial: b.saldo_inicial === undefined ? old.saldo_inicial : saldoInicial(b.saldo_inicial),
    fecha_saldo: b.fecha_saldo === undefined ? old.fecha_saldo : fechaOpcional(b.fecha_saldo, fechaReal, 'fecha_saldo_invalida'),
    conciliada: b.conciliada === undefined ? old.conciliada : bandera(b.conciliada, 'conciliada_invalida'),
  };
  if (n.conciliada && !n.fecha_saldo) fail('fecha_saldo_requerida');
  if (n.entidad_id !== old.entidad_id) await entidadExiste(env, n.entidad_id);
  if (n.moneda !== old.moneda) {
    const uso = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM fin_movimientos WHERE cuenta_id=?) + (SELECT COUNT(*) FROM g_prestamos WHERE cuenta_id=?) + (SELECT COUNT(*) FROM g_pagos WHERE cuenta_id=?) AS n`).bind(old.id, old.id, old.id).first();
    if (uso.n) throw new HttpError(409, 'cuenta_en_uso');
  }
  await actualizar(env, 'g_cuentas', old.id, version, 'nombre=?, entidad_id=?, moneda=?, saldo_inicial=?, fecha_saldo=?, conciliada=?',
    [n.nombre, n.entidad_id, n.moneda, n.saldo_inicial, n.fecha_saldo, n.conciliada],
    { actor, accion: 'cuenta_cambio', objeto_tipo: 'cuenta', objeto_id: old.id, detalle: { de: cuentaItem(old), a: n }, now });
  return json({ item: cuentaItem(await fila(env, 'g_cuentas', old.id)) }, 200, NO_STORE);
});

// ── Préstamos ────────────────────────────────────────────────────────────────
gestion.get(`${BASE}/prestamos`, async (c) => {
  const { env } = abrir(c);
  const rows = (await env.DB.prepare('SELECT * FROM g_prestamos ORDER BY created_at, id').all()).results;
  return json({ items: rows.map(prestamoItem) }, 200, NO_STORE);
});
function condicionesPrestamo(b, base = {}) {
  const p = {
    principal: b.principal === undefined ? base.principal : entero(b.principal, { min: 1, max: PRINCIPAL_MAX, code: 'principal_invalido' }),
    apertura: b.apertura === undefined ? base.apertura ?? 0 : entero(b.apertura, { min: 0, max: PRINCIPAL_MAX, code: 'apertura_invalida' }),
    cuota: b.cuota === undefined ? base.cuota : entero(b.cuota, { min: 1, max: PRINCIPAL_MAX, code: 'cuota_invalida' }),
    tin_bp: b.tin_bp === undefined ? base.tin_bp : entero(b.tin_bp, { min: 0, max: TIN_BP_MAX, code: 'tin_invalido' }),
    tae_bp: b.tae_bp === undefined ? base.tae_bp : entero(b.tae_bp, { min: 0, max: TIN_BP_MAX, code: 'tae_invalido' }),
    meses: b.meses === undefined ? base.meses : entero(b.meses, { min: 1, max: 600, code: 'meses_invalidos' }),
    reserva_cuotas: b.reserva_cuotas === undefined ? base.reserva_cuotas ?? 0 : entero(b.reserva_cuotas, { min: 0, max: 600, code: 'reserva_invalida' }),
    primer_vencimiento: b.primer_vencimiento === undefined ? base.primer_vencimiento ?? null : fechaOpcional(b.primer_vencimiento, fechaCivil, 'primer_vencimiento_invalido'),
  };
  for (const k of ['principal', 'cuota', 'tin_bp', 'tae_bp', 'meses']) if (p[k] === undefined) fail(`${k}_requerido`);
  if (p.reserva_cuotas > p.meses) fail('reserva_invalida');
  validarCalendario(p);
  return p;
}
gestion.post(`${BASE}/prestamos`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const b = await bodyOf(request);
  // El abono real llega por /desembolso: el alta no asume fechas ni mueve caja.
  if (b.fecha_abono !== undefined) fail('usar_desembolso');
  soloCampos(b, ['id', 'nombre', 'cuenta_id', 'principal', 'apertura', 'cuota', 'tin_bp', 'tae_bp', 'meses', 'reserva_cuotas', 'primer_vencimiento', 'condiciones'], 'campo_desconocido');
  const p = { id: uuid(b.id), nombre: texto(b.nombre, 160, 'nombre_invalido'), cuenta_id: uuid(b.cuenta_id, 'cuenta_invalida'), ...condicionesPrestamo(b), condiciones: condiciones(b.condiciones) };
  const cuenta = await cuentaDe(env, p.cuenta_id);
  if (!MONEDAS_PRESTAMO.includes(cuenta.moneda)) fail('moneda_no_admitida');
  const { repetida } = await idempotente(env, { id: p.id, ruta: 'prestamos', huella: await huella(p), actor, now }, () => [
    env.DB.prepare(`INSERT INTO g_prestamos (id,nombre,cuenta_id,principal,apertura,cuota,tin_bp,tae_bp,meses,reserva_cuotas,primer_vencimiento,condiciones,version,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).bind(p.id, p.nombre, p.cuenta_id, p.principal, p.apertura, p.cuota, p.tin_bp, p.tae_bp, p.meses, p.reserva_cuotas, p.primer_vencimiento, JSON.stringify(p.condiciones), actor, now, now),
    auditoria(env, { actor, accion: 'prestamo_alta', objeto_tipo: 'prestamo', objeto_id: p.id, detalle: { nombre: p.nombre, principal: p.principal, cuota: p.cuota, meses: p.meses, tin_bp: p.tin_bp }, now }),
  ]);
  return json({ item: prestamoItem(await fila(env, 'g_prestamos', p.id)) }, repetida ? 200 : 201, NO_STORE);
});
gestion.get(`${BASE}/prestamos/:id`, async (c) => {
  const { env } = abrir(c);
  return json({ item: prestamoItem(await fila(env, 'g_prestamos', idRuta(c))) }, 200, NO_STORE);
});
gestion.get(`${BASE}/prestamos/:id/resumen`, async (c) => {
  const { env } = abrir(c);
  return json(await resumenDe(env, idRuta(c)), 200, NO_STORE);
});
gestion.patch(`${BASE}/prestamos/:id`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const old = await fila(env, 'g_prestamos', idRuta(c));
  const b = await bodyOf(request);
  soloCampos(b, ['version', 'nombre', 'cuenta_id', 'principal', 'apertura', 'cuota', 'tin_bp', 'tae_bp', 'meses', 'reserva_cuotas', 'primer_vencimiento', 'condiciones']);
  const version = versionDe(b);
  if (version !== old.version) throw new HttpError(409, 'version_conflicto');
  const cambia = (k) => b[k] !== undefined && b[k] !== old[k];
  // Con el abono confirmado, principal, apertura y cuenta ya son hechos; con pagos
  // reales, el calendario que los valida tampoco se reescribe.
  if (['principal', 'apertura', 'cuenta_id'].some(cambia) && old.fecha_abono) throw new HttpError(409, 'prestamo_desembolsado');
  if (['cuota', 'meses', 'tin_bp', 'principal'].some(cambia)) {
    const pagos = await env.DB.prepare("SELECT COUNT(*) AS n FROM g_pagos WHERE objeto_tipo='prestamo' AND objeto_id=? AND clase='pago' AND estado='activo'").bind(old.id).first();
    if (pagos.n) throw new HttpError(409, 'prestamo_con_pagos');
  }
  const n = { nombre: b.nombre === undefined ? old.nombre : texto(b.nombre, 160, 'nombre_invalido'), cuenta_id: b.cuenta_id === undefined ? old.cuenta_id : uuid(b.cuenta_id, 'cuenta_invalida'),
    ...condicionesPrestamo(b, old), condiciones: b.condiciones === undefined ? JSON.parse(old.condiciones || '[]') : condiciones(b.condiciones) };
  if (n.cuenta_id !== old.cuenta_id && !MONEDAS_PRESTAMO.includes((await cuentaDe(env, n.cuenta_id)).moneda)) fail('moneda_no_admitida');
  await actualizar(env, 'g_prestamos', old.id, version, 'nombre=?, cuenta_id=?, principal=?, apertura=?, cuota=?, tin_bp=?, tae_bp=?, meses=?, reserva_cuotas=?, primer_vencimiento=?, condiciones=?',
    [n.nombre, n.cuenta_id, n.principal, n.apertura, n.cuota, n.tin_bp, n.tae_bp, n.meses, n.reserva_cuotas, n.primer_vencimiento, JSON.stringify(n.condiciones)],
    { actor, accion: 'prestamo_cambio', objeto_tipo: 'prestamo', objeto_id: old.id, detalle: { de: prestamoItem(old), a: { ...n } }, now });
  return json({ item: prestamoItem(await fila(env, 'g_prestamos', old.id)) }, 200, NO_STORE);
});
// Confirma el abono real UNA vez: entrada de financiación (no venta) por el principal
// y, si la hubo, la comisión de apertura como gasto financiero. Las dos partidas y la
// marca del préstamo van en la misma transacción.
gestion.post(`${BASE}/prestamos/:id/desembolso`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const old = await fila(env, 'g_prestamos', idRuta(c));
  const b = await bodyOf(request);
  soloCampos(b, ['id', 'fecha', 'importe', 'apertura'], 'campo_desconocido');
  const d = { id: uuid(b.id), fecha: fechaReal(b.fecha), importe: importePositivo(b.importe), apertura: b.apertura == null ? 0 : importeNoNegativo(b.apertura, 'apertura_invalida') };
  let repetida;
  try {
    ({ repetida } = await idempotente(env, { id: d.id, ruta: `prestamos/${old.id}/desembolso`, huella: await huella(d), actor, now }, async () => {
      // Abono bruto (principal) o neto (principal − apertura): en ambos casos la cuenta
      // recibe principal y paga apertura; cualquier otra cifra no es este préstamo.
      if (d.importe !== old.principal && d.importe + d.apertura !== old.principal) fail('desembolso_no_coincide');
      if (old.desembolso_id && old.desembolso_id !== d.id) throw new HttpError(409, 'ya_desembolsado');
      const cuenta = await cuentaDe(env, old.cuenta_id);
      const k = await conceptosGestion(env);
      const comun = { fecha: d.fecha, moneda: cuenta.moneda, origen_tipo: 'prestamo_desembolso', origen_id: d.id, cuenta_id: cuenta.id, entidad_id: cuenta.entidad_id };
      return [
        reclamarVersion(env, 'g_prestamos', old, now),
        env.DB.prepare('UPDATE g_prestamos SET fecha_abono=?, desembolso_id=?, desembolsado=?, apertura_cobrada=?, updated_at=? WHERE id=?')
          .bind(d.fecha, d.id, old.principal, d.apertura, now, old.id),
        partidaCaja(env, { ...comun, tipo: 'ingreso', concepto_id: k.g_financiacion, importe: old.principal, naturaleza: 'financiacion', nota: `Abono préstamo ${old.nombre}` }, actor, now),
        ...(d.apertura ? [partidaCaja(env, { ...comun, tipo: 'gasto', concepto_id: k.g_financiero, importe: d.apertura, naturaleza: 'financiero', nota: `Comisión de apertura ${old.nombre}` }, actor, now)] : []),
        auditoria(env, { actor, accion: 'prestamo_desembolso', objeto_tipo: 'prestamo', objeto_id: old.id, detalle: d, now }),
      ];
    }));
  } catch (e) {
    if (/g_prestamo_ya_desembolsado/.test(e.message)) throw new HttpError(409, 'ya_desembolsado');
    throw e;
  }
  return json({ item: prestamoItem(await fila(env, 'g_prestamos', old.id)), resumen: await resumenDe(env, old.id) }, repetida ? 200 : 201, NO_STORE);
});
// Pago real de una cuota (o parte): capital devuelto = salida de financiación, no
// gasto; intereses y comisiones = gasto financiero. Consume la reserva sin tratarla
// como salida: la salida es el propio pago.
gestion.post(`${BASE}/prestamos/:id/pagos`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const old = await fila(env, 'g_prestamos', idRuta(c));
  const b = await bodyOf(request);
  soloCampos(b, ['id', 'numero', 'fecha', 'importe', 'capital', 'interes', 'comision', 'nota'], 'campo_desconocido');
  const p = { id: uuid(b.id), numero: entero(b.numero, { min: 1, max: 600, code: 'numero_invalido' }), fecha: fechaReal(b.fecha), importe: importePositivo(b.importe),
    capital: b.capital == null ? 0 : importeNoNegativo(b.capital, 'capital_invalido'), interes: b.interes == null ? 0 : importeNoNegativo(b.interes, 'interes_invalido'),
    comision: b.comision == null ? 0 : importeNoNegativo(b.comision, 'comision_invalida'), nota: texto(b.nota, 500, 'nota_invalida', { opcional: true }) };
  const { repetida } = await idempotente(env, { id: p.id, ruta: `prestamos/${old.id}/pagos`, huella: await huella(p), actor, now }, async () => {
    if (p.numero > old.meses) fail('numero_invalido');
    if (p.capital + p.interes + p.comision !== p.importe) fail('desglose_no_cuadra');
    if (!old.fecha_abono) throw new HttpError(409, 'prestamo_sin_desembolso');
    if (p.fecha < old.fecha_abono) fail('fecha_anterior_al_abono');
    const pagos = await pagosDe(env, 'prestamo', old.id);
    const previo = resumenPrestamo(old, pagos);
    if (p.capital > previo.principal_pendiente) fail('capital_excede_principal');
    const cuota = previo.calendario[p.numero - 1];
    if (cuota.pagado + p.capital + p.interes > cuota.cuota) fail('cuota_sobrepagada');
    const cuenta = await cuentaDe(env, old.cuenta_id);
    const k = await conceptosGestion(env);
    const comun = { fecha: p.fecha, moneda: cuenta.moneda, origen_tipo: 'prestamo_pago', origen_id: p.id, cuenta_id: cuenta.id, entidad_id: cuenta.entidad_id };
    return [
      reclamarVersion(env, 'g_prestamos', old, now),
      env.DB.prepare(`INSERT INTO g_pagos (id,objeto_tipo,objeto_id,clase,numero,fecha,moneda,importe,capital,interes,comision,pagador,cuenta_id,nota,created_by,created_at)
        VALUES (?,'prestamo',?,'pago',?,?,?,?,?,?,?,'cuenta',?,?,?,?)`).bind(p.id, old.id, p.numero, p.fecha, cuenta.moneda, p.importe, p.capital, p.interes, p.comision, cuenta.id, p.nota, actor, now),
      ...(p.capital ? [partidaCaja(env, { ...comun, tipo: 'egreso', concepto_id: k.g_capital, importe: p.capital, naturaleza: 'financiacion', nota: `Cuota ${p.numero} ${old.nombre}: capital` }, actor, now)] : []),
      ...(p.interes ? [partidaCaja(env, { ...comun, tipo: 'gasto', concepto_id: k.g_financiero, importe: p.interes, naturaleza: 'financiero', nota: `Cuota ${p.numero} ${old.nombre}: intereses` }, actor, now)] : []),
      ...(p.comision ? [partidaCaja(env, { ...comun, tipo: 'gasto', concepto_id: k.g_financiero, importe: p.comision, naturaleza: 'financiero', nota: `Cuota ${p.numero} ${old.nombre}: comisión` }, actor, now)] : []),
      auditoria(env, { actor, accion: 'prestamo_pago', objeto_tipo: 'prestamo', objeto_id: old.id, detalle: p, now }),
    ];
  });
  return json({ item: pagoItem(await fila(env, 'g_pagos', p.id)), resumen: await resumenDe(env, old.id) }, repetida ? 200 : 201, NO_STORE);
});

// Reverso explícito y auditado (nunca borrado): fila espejo en g_pagos, partidas de
// caja con signo contrario y el pago original marcado. Un pago se revierte UNA vez.
async function revertirPago(env, { actor, now }, objeto, pagoId, b) {
  soloCampos(b, ['id', 'fecha', 'motivo'], 'campo_desconocido');
  const r = { id: uuid(b.id), fecha: fechaReal(b.fecha), motivo: texto(b.motivo, 500, 'motivo_invalido') };
  const pago = await env.DB.prepare("SELECT * FROM g_pagos WHERE id=? AND objeto_tipo=? AND objeto_id=? AND clase IN ('pago','reembolso')").bind(pagoId, objeto.tipo, objeto.id).first();
  if (!pago) throw new HttpError(404, 'not_found');
  let repetida;
  try {
    ({ repetida } = await idempotente(env, { id: r.id, ruta: `${objeto.tipo}/${objeto.id}/pagos/${pago.id}/revertir`, huella: await huella(r), actor, now }, async () => {
      if (pago.estado !== 'activo' && pago.reverso_id !== r.id) throw new HttpError(409, 'pago_revertido');
      if (r.fecha < pago.fecha) fail('fecha_anterior_al_pago');
      if (objeto.tipo === 'compra' && pago.clase === 'pago') {
        const reembolsos = await env.DB.prepare("SELECT COUNT(*) AS n FROM g_pagos WHERE clase='reembolso' AND pago_id=? AND estado='activo'").bind(pago.id).first();
        if (reembolsos.n) throw new HttpError(409, 'pago_con_reembolsos');
      }
      const partidas = (await env.DB.prepare('SELECT * FROM fin_movimientos WHERE origen_tipo=? AND origen_id=?').bind(objeto.tipo === 'prestamo' ? 'prestamo_pago' : pago.clase === 'reembolso' ? 'compra_reembolso' : 'compra_pago', pago.id).all()).results;
      return [
        reclamarVersion(env, objeto.tipo === 'prestamo' ? 'g_prestamos' : 'g_compras', objeto, now),
        env.DB.prepare(`INSERT INTO g_pagos (id,objeto_tipo,objeto_id,clase,pago_id,numero,fecha,moneda,importe,capital,interes,comision,pagador,cuenta_id,socio,motivo,created_by,created_at)
          VALUES (?,?,?,'reverso',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(r.id, objeto.tipo, objeto.id, pago.id, pago.numero, r.fecha, pago.moneda, pago.importe, pago.capital, pago.interes, pago.comision, pago.pagador, pago.cuenta_id, pago.socio, r.motivo, actor, now),
        env.DB.prepare("UPDATE g_pagos SET estado='revertido', reverso_id=? WHERE id=? AND estado='activo'").bind(r.id, pago.id),
        ...partidasEspejo(env, partidas, r.id, actor, now, r.fecha),
        auditoria(env, { actor, accion: `${objeto.tipo}_pago_reverso`, objeto_tipo: objeto.tipo, objeto_id: objeto.id, detalle: { pago_id: pago.id, ...r }, now }),
      ];
    }));
  } catch (e) {
    if (/UNIQUE constraint failed: g_pagos/.test(e.message) || /g_pago_inmutable/.test(e.message)) throw new HttpError(409, 'pago_revertido');
    throw e;
  }
  return { item: pagoItem(await fila(env, 'g_pagos', r.id)), repetida };
}
gestion.post(`${BASE}/prestamos/:id/pagos/:pagoId/revertir`, async (c) => {
  const partes = abrir(c);
  const old = await fila(partes.env, 'g_prestamos', idRuta(c));
  const { item, repetida } = await revertirPago(partes.env, partes, { tipo: 'prestamo', id: old.id, version: old.version }, idRuta(c, 'pagoId'), await bodyOf(partes.request));
  return json({ item, resumen: await resumenDe(partes.env, old.id) }, repetida ? 200 : 201, NO_STORE);
});

// ── Compras ──────────────────────────────────────────────────────────────────
gestion.get(`${BASE}/compras`, async (c) => {
  const { env, url } = abrir(c);
  const clauses = ['1=1'], args = [];
  for (const [key, values] of [['estado', ESTADOS_COMPRA], ['negocio', NEGOCIOS], ['moneda', MONEDAS]]) {
    const v = url.searchParams.get(key);
    if (v) { enumValor(v, values, `${key}_invalido`); clauses.push(`c.${key}=?`); args.push(v); }
  }
  for (const key of ['entidad_id', 'prestamo_id']) {
    const value = url.searchParams.get(key);
    if (value) { clauses.push(`c.${key}=?`); args.push(uuid(value, `${key}_invalido`)); }
  }
  // Acotada: si hay más de 500, se dice (los totales salen de /resumen, no de aquí).
  const rows = (await env.DB.prepare(`${SELECT_COMPRA} WHERE ${clauses.join(' AND ')} ORDER BY COALESCE(c.fecha_compra, c.fecha_prevista, c.created_at) DESC, c.created_at DESC, c.id LIMIT 501`).bind(...args).all()).results;
  const mas = rows.length > 500; if (mas) rows.pop();
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM g_compras c WHERE ${clauses.join(' AND ')}`).bind(...args).first()).n;
  return json({ items: rows.map(compraItem), mas, total, limite: 500 }, 200, NO_STORE);
});
async function referenciasCompra(env, n) {
  await entidadExiste(env, n.entidad_id);
  if (n.prestamo_id && !await env.DB.prepare('SELECT id FROM g_prestamos WHERE id=?').bind(n.prestamo_id).first()) fail('prestamo_invalido');
}
const campoCompra = {
  concepto: (v) => texto(v, 200, 'concepto_invalido'), negocio: (v) => enumValor(v, NEGOCIOS, 'negocio_invalido'),
  entidad_id: (v) => uuidOpcional(v, 'entidad_invalida'), prestamo_id: (v) => uuidOpcional(v, 'prestamo_invalido'),
  comprador: (v) => texto(v, 120, 'comprador_invalido', { opcional: true }), proveedor: (v) => texto(v, 160, 'proveedor_invalido', { opcional: true }),
  fecha_prevista: (v) => fechaOpcional(v, fechaCivil, 'fecha_prevista_invalida'), categoria: (v) => v == null ? 'otros' : texto(v, 60, 'categoria_invalida'),
  nota: (v) => texto(v, 2000, 'nota_invalida', { opcional: true }),
};
gestion.post(`${BASE}/compras`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const b = await bodyOf(request);
  soloCampos(b, ['id', 'estado', 'moneda', 'estimado', ...Object.keys(campoCompra)], 'campo_desconocido');
  const q = { id: uuid(b.id), moneda: enumValor(b.moneda, MONEDAS, 'moneda_invalida'), estimado: importeNoNegativo(b.estimado, 'estimado_invalido'),
    estado: b.estado == null ? 'prevista' : enumValor(b.estado, ['prevista', 'comprometida'], 'estado_invalido'),
    ...Object.fromEntries(Object.entries(campoCompra).map(([k, fn]) => [k, fn(b[k])])) };
  await referenciasCompra(env, q);
  const { repetida } = await idempotente(env, { id: q.id, ruta: 'compras', huella: await huella(q), actor, now }, () => [
    env.DB.prepare(`INSERT INTO g_compras (id,concepto,negocio,entidad_id,prestamo_id,moneda,estimado,estado,comprador,proveedor,fecha_prevista,categoria,nota,version,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).bind(q.id, q.concepto, q.negocio, q.entidad_id, q.prestamo_id, q.moneda, q.estimado, q.estado, q.comprador, q.proveedor, q.fecha_prevista, q.categoria, q.nota, actor, now, now),
    auditoria(env, { actor, accion: 'compra_alta', objeto_tipo: 'compra', objeto_id: q.id, detalle: { concepto: q.concepto, negocio: q.negocio, estimado: q.estimado, estado: q.estado }, now }),
  ]);
  return json({ item: await compraCompleta(env, q.id) }, repetida ? 200 : 201, NO_STORE);
});
gestion.get(`${BASE}/compras/:id`, async (c) => {
  const { env } = abrir(c);
  const item = await compraCompleta(env, idRuta(c));
  if (!item) throw new HttpError(404, 'not_found');
  return json({ item }, 200, NO_STORE);
});
gestion.patch(`${BASE}/compras/:id`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const old = await env.DB.prepare(`${SELECT_COMPRA} WHERE c.id=?`).bind(idRuta(c)).first();
  if (!old) throw new HttpError(404, 'not_found');
  const b = await bodyOf(request);
  soloCampos(b, ['version', 'estado', 'moneda', 'estimado', 'fecha_compra', ...Object.keys(campoCompra)]);
  const version = versionDe(b);
  if (version !== old.version) throw new HttpError(409, 'version_conflicto');
  if (old.estado === 'cancelada') throw new HttpError(409, 'compra_cancelada');
  // Comprada: solo metadatos. Importe real, pagado y estado no se tocan por PATCH.
  if (old.estado === 'comprada' && ['estado', 'moneda', 'estimado'].some((k) => b[k] !== undefined && b[k] !== old[k])) throw new HttpError(409, 'compra_cerrada');
  if (b.estado !== undefined && b.estado !== old.estado) {
    enumValor(b.estado, ESTADOS_COMPRA, 'estado_invalido');
    if (b.estado === 'comprada') fail('usar_comprar');
    // Cancelar libera el compromiso sin borrar; con pagos vivos primero se revierten.
    if (b.estado === 'cancelada' && old.pagado) throw new HttpError(409, 'compra_con_pagos');
  }
  if (b.fecha_compra !== undefined && old.estado !== 'comprada') fail('usar_comprar');
  const n = { estado: b.estado === undefined ? old.estado : b.estado,
    fecha_compra: b.fecha_compra === undefined ? old.fecha_compra : fechaOpcional(b.fecha_compra, fechaReal, 'fecha_compra_invalida'),
    moneda: b.moneda === undefined ? old.moneda : enumValor(b.moneda, MONEDAS, 'moneda_invalida'),
    estimado: b.estimado === undefined ? old.estimado : importeNoNegativo(b.estimado, 'estimado_invalido'),
    ...Object.fromEntries(Object.entries(campoCompra).map(([k, fn]) => [k, b[k] === undefined ? old[k] : fn(b[k])])) };
  if ((n.moneda !== old.moneda || n.entidad_id !== old.entidad_id) && old.pagado) throw new HttpError(409, 'compra_con_pagos');
  if (n.estado === 'prevista' && old.pagado) throw new HttpError(409, 'compra_con_pagos');
  if (n.estado !== 'comprada' && n.estimado < old.pagado) fail('estimado_inferior_a_pagado');
  if (n.entidad_id !== old.entidad_id || n.prestamo_id !== old.prestamo_id) await referenciasCompra(env, n);
  await actualizar(env, 'g_compras', old.id, version, 'concepto=?, negocio=?, entidad_id=?, prestamo_id=?, moneda=?, estimado=?, estado=?, comprador=?, proveedor=?, fecha_prevista=?, categoria=?, nota=?, fecha_compra=?',
    [n.concepto, n.negocio, n.entidad_id, n.prestamo_id, n.moneda, n.estimado, n.estado, n.comprador, n.proveedor, n.fecha_prevista, n.categoria, n.nota, n.fecha_compra],
    { actor, accion: 'compra_cambio', objeto_tipo: 'compra', objeto_id: old.id, detalle: { de: compraItem(old), a: n }, now });
  return json({ item: await compraCompleta(env, old.id) }, 200, NO_STORE);
});
// Efectúa la compra: fija precio real, libera el compromiso y guarda quién compró.
// Puede faltar fecha o factura: se conserva la compra real y se completa después.
// El registro de un pago sí requiere su propia fecha bancaria real.
gestion.post(`${BASE}/compras/:id/comprar`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const old = await env.DB.prepare(`${SELECT_COMPRA} WHERE c.id=?`).bind(idRuta(c)).first();
  if (!old) throw new HttpError(404, 'not_found');
  const b = await bodyOf(request);
  soloCampos(b, ['version', 'real', 'fecha', 'comprador', 'proveedor'], 'campo_desconocido');
  const version = versionDe(b);
  if (version !== old.version) throw new HttpError(409, 'version_conflicto');
  const n = { real: importeNoNegativo(b.real, 'real_invalido'), fecha: fechaOpcional(b.fecha, fechaReal),
    comprador: b.comprador === undefined ? old.comprador : campoCompra.comprador(b.comprador), proveedor: b.proveedor === undefined ? old.proveedor : campoCompra.proveedor(b.proveedor) };
  if (!['prevista', 'comprometida'].includes(old.estado)) throw new HttpError(409, old.estado === 'comprada' ? 'compra_cerrada' : 'compra_cancelada');
  if (n.real < old.pagado) fail('real_inferior_a_pagado');
  await actualizar(env, 'g_compras', old.id, version, "estado='comprada', real=?, fecha_compra=?, comprador=?, proveedor=?", [n.real, n.fecha, n.comprador, n.proveedor],
    { actor, accion: 'compra_efectuada', objeto_tipo: 'compra', objeto_id: old.id, detalle: { estimado: old.estimado, ...n }, now });
  return json({ item: await compraCompleta(env, old.id) }, 200, NO_STORE);
});
// Pago de una compra. Desde cuenta común: UNA salida de tesorería; su
// tratamiento fiscal depende del registro revisado, nunca del medio de pago. Por un socio: anticipo reconocido en la compra, sin tocar caja común.
gestion.post(`${BASE}/compras/:id/pagos`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const old = await env.DB.prepare(`${SELECT_COMPRA} WHERE c.id=?`).bind(idRuta(c)).first();
  if (!old) throw new HttpError(404, 'not_found');
  const b = await bodyOf(request);
  soloCampos(b, ['id', 'fecha', 'importe', 'pagador', 'cuenta_id', 'socio', 'nota'], 'campo_desconocido');
  const p = { id: uuid(b.id), fecha: fechaReal(b.fecha), importe: importePositivo(b.importe), pagador: enumValor(b.pagador, PAGADORES, 'pagador_invalido'),
    cuenta_id: b.pagador === 'cuenta' ? uuid(b.cuenta_id, 'cuenta_invalida') : null, socio: b.pagador === 'socio' ? socioEmail(b.socio) : null, nota: texto(b.nota, 500, 'nota_invalida', { opcional: true }) };
  const { repetida } = await idempotente(env, { id: p.id, ruta: `compras/${old.id}/pagos`, huella: await huella(p), actor, now }, async () => {
    if ((p.pagador === 'cuenta' && b.socio != null) || (p.pagador === 'socio' && b.cuenta_id != null)) fail('pagador_invalido');
    if (!['comprometida', 'comprada'].includes(old.estado)) throw new HttpError(409, 'compra_no_comprometida');
    const pendiente = compraItem(old).pendiente;
    if (p.importe > pendiente) fail('importe_supera_pendiente');
    let cuenta = null;
    if (p.pagador === 'cuenta') {
      cuenta = await cuentaDe(env, p.cuenta_id);
      if (cuenta.moneda !== old.moneda) fail('moneda_distinta');
      if (old.entidad_id && cuenta.entidad_id && old.entidad_id !== cuenta.entidad_id) fail('entidad_cuenta_distinta');
    } else if (!await env.DB.prepare('SELECT email FROM fin_socios WHERE lower(email)=? AND activo=1').bind(p.socio).first()) fail('socio_desconocido');
    const k = cuenta ? await conceptosGestion(env) : null;
    return [
      reclamarVersion(env, 'g_compras', old, now),
      env.DB.prepare(`INSERT INTO g_pagos (id,objeto_tipo,objeto_id,clase,fecha,moneda,importe,pagador,cuenta_id,socio,nota,created_by,created_at)
        VALUES (?,'compra',?,'pago',?,?,?,?,?,?,?,?,?)`).bind(p.id, old.id, p.fecha, old.moneda, p.importe, p.pagador, p.cuenta_id, p.socio, p.nota, actor, now),
      ...(cuenta ? [partidaCaja(env, { tipo: 'gasto', concepto_id: k.g_compra, fecha: p.fecha, moneda: old.moneda, importe: p.importe, naturaleza: 'compra', origen_tipo: 'compra_pago', origen_id: p.id,
        cuenta_id: cuenta.id, entidad_id: cuenta.entidad_id, nota: `Compra: ${old.concepto}` }, actor, now)] : []),
      auditoria(env, { actor, accion: 'compra_pago', objeto_tipo: 'compra', objeto_id: old.id, detalle: p, now }),
    ];
  });
  return json({ item: pagoItem(await fila(env, 'g_pagos', p.id)), compra: await compraCompleta(env, old.id) }, repetida ? 200 : 201, NO_STORE);
});
gestion.get(`${BASE}/compras/:id/pagos`, async (c) => {
  const { env } = abrir(c);
  const old = await fila(env, 'g_compras', idRuta(c));
  return json({ items: (await pagosDe(env, 'compra', old.id)).map(pagoItem) }, 200, NO_STORE);
});
gestion.post(`${BASE}/compras/:id/pagos/:pagoId/revertir`, async (c) => {
  const partes = abrir(c);
  const old = await fila(partes.env, 'g_compras', idRuta(c));
  const { item, repetida } = await revertirPago(partes.env, partes, { tipo: 'compra', id: old.id, version: old.version }, idRuta(c, 'pagoId'), await bodyOf(partes.request));
  return json({ item, compra: await compraCompleta(partes.env, old.id) }, repetida ? 200 : 201, NO_STORE);
});
// Devuelve (total o parcialmente) un anticipo de socio desde una cuenta común: UNA
// salida de caja clasificada como reembolso. La compra ya reconoce el pago del
// socio; su tratamiento fiscal se revisa por separado.
gestion.post(`${BASE}/compras/:id/reembolsos`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  const old = await fila(env, 'g_compras', idRuta(c));
  const b = await bodyOf(request);
  soloCampos(b, ['id', 'pago_id', 'cuenta_id', 'fecha', 'importe', 'nota'], 'campo_desconocido');
  const r = { id: uuid(b.id), pago_id: uuid(b.pago_id, 'pago_invalido'), cuenta_id: uuid(b.cuenta_id, 'cuenta_invalida'), fecha: fechaReal(b.fecha), importe: importePositivo(b.importe), nota: texto(b.nota, 500, 'nota_invalida', { opcional: true }) };
  const { repetida } = await idempotente(env, { id: r.id, ruta: `compras/${old.id}/reembolsos`, huella: await huella(r), actor, now }, async () => {
    const pago = await env.DB.prepare("SELECT * FROM g_pagos WHERE id=? AND objeto_tipo='compra' AND objeto_id=? AND clase='pago'").bind(r.pago_id, old.id).first();
    if (!pago) fail('pago_invalido');
    if (pago.pagador !== 'socio') fail('pago_no_es_anticipo');
    if (pago.estado !== 'activo') throw new HttpError(409, 'pago_revertido');
    const devuelto = (await env.DB.prepare("SELECT COALESCE(SUM(importe),0) AS n FROM g_pagos WHERE clase='reembolso' AND pago_id=? AND estado='activo'").bind(pago.id).first()).n;
    if (devuelto + r.importe > pago.importe) fail('reembolso_supera_anticipo');
    const cuenta = await cuentaDe(env, r.cuenta_id);
    if (cuenta.moneda !== pago.moneda) fail('moneda_distinta');
    if (r.fecha < pago.fecha) fail('fecha_anterior_al_pago');
    if (old.entidad_id && cuenta.entidad_id && old.entidad_id !== cuenta.entidad_id) fail('entidad_cuenta_distinta');
    const k = await conceptosGestion(env);
    return [
      reclamarVersion(env, 'g_compras', old, now),
      env.DB.prepare(`INSERT INTO g_pagos (id,objeto_tipo,objeto_id,clase,pago_id,fecha,moneda,importe,pagador,cuenta_id,nota,created_by,created_at)
        VALUES (?,'compra',?,'reembolso',?,?,?,?,'cuenta',?,?,?,?)`).bind(r.id, old.id, pago.id, r.fecha, pago.moneda, r.importe, cuenta.id, r.nota, actor, now),
      partidaCaja(env, { tipo: 'egreso', concepto_id: k.g_reembolso_socio, fecha: r.fecha, moneda: pago.moneda, importe: r.importe, naturaleza: 'reembolso_socio', origen_tipo: 'compra_reembolso', origen_id: r.id,
        cuenta_id: cuenta.id, entidad_id: cuenta.entidad_id, nota: `Reembolso a ${pago.socio}: ${old.concepto}` }, actor, now),
      auditoria(env, { actor, accion: 'compra_reembolso', objeto_tipo: 'compra', objeto_id: old.id, detalle: { ...r, socio: pago.socio }, now }),
    ];
  });
  return json({ item: pagoItem(await fila(env, 'g_pagos', r.id)), compra: await compraCompleta(env, old.id) }, repetida ? 200 : 201, NO_STORE);
});

// ── Resumen por moneda: confirmado separado de pendiente ─────────────────────
// Saldo de cuenta = saldo inicial + partidas de caja con cuenta (signo incluido).
// Reserva = cuotas apartadas de préstamos YA abonados, restada UNA vez (disponible).
// Compromisos = lo pendiente de compras comprometidas y compradas (la compra
// sustituye al compromiso; no se suman ambos). Lo previsto se informa aparte.
gestion.get(`${BASE}/resumen`, async (c) => {
  const { env, url } = abrir(c);
  const moneda = enumValor(url.searchParams.get('moneda') || 'EUR', MONEDAS, 'moneda_invalida');
  const [cuentas, movimientos, prestamos, pagosPrestamo, compras, adelantos, reembolsos, nombres] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM g_cuentas WHERE moneda=? ORDER BY nombre COLLATE NOCASE, id').bind(moneda),
    env.DB.prepare("SELECT cuenta_id, SUM(CASE WHEN tipo='ingreso' THEN importe*signo ELSE -importe*signo END) AS neto FROM fin_movimientos WHERE cuenta_id IS NOT NULL AND moneda=? GROUP BY cuenta_id").bind(moneda),
    env.DB.prepare('SELECT p.* FROM g_prestamos p JOIN g_cuentas c ON c.id=p.cuenta_id WHERE c.moneda=? ORDER BY p.created_at, p.id').bind(moneda),
    env.DB.prepare("SELECT g.* FROM g_pagos g JOIN g_prestamos p ON p.id=g.objeto_id JOIN g_cuentas c ON c.id=p.cuenta_id WHERE g.objeto_tipo='prestamo' AND c.moneda=?").bind(moneda),
    env.DB.prepare(`${SELECT_COMPRA} WHERE c.moneda=?`).bind(moneda),
    env.DB.prepare("SELECT socio, SUM(importe) AS importe FROM g_pagos WHERE objeto_tipo='compra' AND clase='pago' AND pagador='socio' AND estado='activo' AND moneda=? GROUP BY socio").bind(moneda),
    env.DB.prepare("SELECT o.socio, SUM(r.importe) AS importe FROM g_pagos r JOIN g_pagos o ON o.id=r.pago_id WHERE r.clase='reembolso' AND r.estado='activo' AND r.moneda=? GROUP BY o.socio").bind(moneda),
    env.DB.prepare('SELECT email,nombre FROM fin_socios'),
  ]);
  const neto = Object.fromEntries(movimientos.results.map((r) => [r.cuenta_id, r.neto]));
  const resumenes = prestamos.results.map((p) => resumenPrestamo(p, pagosPrestamo.results.filter((g) => g.objeto_id === p.id)));
  const reservaPorCuenta = {};
  for (const r of resumenes) reservaPorCuenta[r.prestamo.cuenta_id] = (reservaPorCuenta[r.prestamo.cuenta_id] || 0) + r.reserva_restante;
  const items = cuentas.results.map((q) => {
    const saldo = q.saldo_inicial + (neto[q.id] || 0), reserva = reservaPorCuenta[q.id] || 0;
    return { ...cuentaItem(q), movimientos: neto[q.id] || 0, saldo, reserva, disponible: saldo - reserva, estado_saldo: q.conciliada ? 'conciliado' : 'pendiente' };
  });
  const suma = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
  const porNegocio = NEGOCIOS.map((negocio) => {
    const de = compras.results.filter((r) => r.negocio === negocio).map(compraItem);
    const en = (estado) => de.filter((r) => r.estado === estado);
    return { negocio, previsto: suma(en('prevista'), (r) => r.estimado), comprometido: suma(en('comprometida'), (r) => r.pendiente), comprado: suma(en('comprada'), (r) => r.real),
      pagado: suma(de, (r) => r.pagado), pendiente: suma([...en('comprometida'), ...en('comprada')], (r) => r.pendiente) };
  });
  const nombreDe = Object.fromEntries(nombres.results.map((s) => [s.email.toLowerCase(), s.nombre]));
  const devuelto = Object.fromEntries(reembolsos.results.map((r) => [r.socio, r.importe]));
  const socios = adelantos.results.map((a) => ({ email: a.socio, nombre: nombreDe[a.socio] || a.socio, adelantado: a.importe, reembolsado: devuelto[a.socio] || 0, saldo: a.importe - (devuelto[a.socio] || 0) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const totales = {
    saldo: suma(items, (q) => q.saldo), saldo_conciliado: suma(items.filter((q) => q.conciliada), (q) => q.saldo), saldo_pendiente_conciliar: suma(items.filter((q) => !q.conciliada), (q) => q.saldo),
    reservas: suma(items, (q) => q.reserva), disponible: suma(items, (q) => q.disponible),
    deuda_pendiente: suma(resumenes.filter((r) => r.desembolsado), (r) => r.principal_pendiente), deuda_sin_desembolsar: suma(resumenes.filter((r) => !r.desembolsado), (r) => r.prestamo.principal),
    compromisos_pendientes: suma(porNegocio, (n) => n.pendiente), previsto: suma(porNegocio, (n) => n.previsto), saldo_socios: suma(socios, (s) => s.saldo),
  };
  totales.disponible_tras_compromisos = totales.disponible - totales.compromisos_pendientes - totales.saldo_socios;
  return json({ moneda, cuentas: items, prestamos: resumenes.map((r) => ({ id: r.prestamo.id, nombre: r.prestamo.nombre, cuenta_id: r.prestamo.cuenta_id, estado: r.estado, principal: r.prestamo.principal,
    desembolsado: r.desembolsado, principal_pendiente: r.principal_pendiente, reserva_inicial: r.reserva_inicial, reserva_restante: r.reserva_restante, pagado_cuotas: r.pagado_cuotas })),
  compras: { por_negocio: porNegocio, previsto: totales.previsto, pendiente: totales.compromisos_pendientes }, socios, totales }, 200, NO_STORE);
});

// ── Documentos privados (binding FINANCE_DOCS) ───────────────────────────────
// Metadatos en D1, bytes en un bucket privado distinto de MEDIA. El cliente nunca
// nombra una clave: pide por id y el worker sirve, con cabeceras no-store/nosniff.
const claseDoc = (v) => { if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(v)) fail('clase_invalida'); return v; };
gestion.get(`${BASE}/documentos`, async (c) => {
  const { env, url } = abrir(c);
  const tipo = enumValor(url.searchParams.get('tipo'), TIPOS_DOCUMENTO, 'tipo_invalido');
  const objetoId = uuid(url.searchParams.get('objeto_id'), 'objeto_invalido');
  const rows = (await env.DB.prepare('SELECT * FROM g_documentos WHERE tipo=? AND objeto_id=? ORDER BY created_at, id').bind(tipo, objetoId).all()).results;
  return json({ items: rows.map(documentoItem), storage_ready: Boolean(env.FINANCE_DOCS) }, 200, NO_STORE);
});
async function limpiarIntentoDocumento(env, key, id) {
  try {
    const adoptado = await env.DB.prepare('SELECT id FROM g_documentos WHERE key=?').bind(key).first();
    if (!adoptado) await env.FINANCE_DOCS.delete(key);
  } catch (_) { console.log(JSON.stringify({ level: 'error', code: 'finance_doc_cleanup_failed', id })); }
}
gestion.post(`${BASE}/documentos`, async (c) => {
  const { env, request, actor, now } = abrir(c);
  if (!env.FINANCE_DOCS) throw new HttpError(503, 'finance_docs_not_configured');
  const declarado = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declarado) && declarado > DOC_MAX_BYTES + 65536) throw new HttpError(413, 'archivo_demasiado_grande');
  if (!/^multipart\/form-data/i.test(request.headers.get('Content-Type') || '')) throw new HttpError(415, 'unsupported_media_type');
  let form;
  try { form = await request.formData(); } catch (_) { fail('multipart_invalido'); }
  const archivo = form.get('archivo');
  if (!archivo || typeof archivo === 'string' || typeof archivo.arrayBuffer !== 'function') fail('archivo_requerido');
  const d = { id: uuid(form.get('id')), tipo: enumValor(form.get('tipo'), TIPOS_DOCUMENTO, 'tipo_invalido'), objeto_id: uuid(form.get('objeto_id'), 'objeto_invalido'), clase: claseDoc(form.get('clase')) };
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (!bytes.byteLength) fail('archivo_vacio');
  if (bytes.byteLength > DOC_MAX_BYTES) throw new HttpError(413, 'archivo_demasiado_grande');
  const formato = detectarDocumento(bytes);
  if (!formato) fail('formato_invalido');
  d.nombre = nombreSeguro(typeof form.get('nombre') === 'string' ? form.get('nombre') : archivo.name, formato.ext);
  if (!await objetoExiste(env, d.tipo, d.objeto_id)) throw new HttpError(404, 'not_found');
  d.sha256 = await sha256Hex(bytes);
  const h = await huella(d);
  const previa = await env.DB.prepare('SELECT ruta,huella,resultado_id FROM g_idempotencia WHERE clave=?').bind(d.id).first();
  if (previa) {
    if (previa.ruta !== 'documentos' || previa.huella !== h) throw new HttpError(409, 'idempotencia_conflicto');
    return json({ item: documentoItem(await fila(env, 'g_documentos', previa.resultado_id || d.id)) }, 200, NO_STORE);
  }
  // Un ID distinto que deduplica también queda vinculado a su resultado: reutilizarlo
  // después con otro archivo/cuerpo sigue siendo un conflicto, sin otra copia R2.
  const devolverDuplicado = async (existente) => {
    await idempotente(env, { id: d.id, ruta: 'documentos', huella: h, actor, now, resultado_id: existente.id }, () => []);
    return json({ item: documentoItem(existente), duplicado: true }, 200, NO_STORE);
  };
  // Mismo archivo para el mismo propietario: se devuelve el existente, sin otra copia.
  const existente = await env.DB.prepare('SELECT * FROM g_documentos WHERE tipo=? AND objeto_id=? AND sha256=?').bind(d.tipo, d.objeto_id, d.sha256).first();
  if (existente) return devolverDuplicado(existente);
  const key = `gestion/${d.tipo}/${d.objeto_id}/${d.id}/${crypto.randomUUID()}.${formato.ext}`;
  try { await env.FINANCE_DOCS.put(key, bytes, { httpMetadata: { contentType: formato.mime } }); }
  catch (_) { throw new HttpError(503, 'documento_no_guardado'); }
  try {
    const resultado = await idempotente(env, { id: d.id, ruta: 'documentos', huella: h, actor, now }, () => [
      env.DB.prepare(`INSERT INTO g_documentos (id,tipo,objeto_id,clase,nombre,mime,ext,bytes,sha256,key,version,autor,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(version),0)+1 FROM g_documentos WHERE tipo=? AND objeto_id=? AND clase=? AND nombre=?),?,?)`)
        .bind(d.id, d.tipo, d.objeto_id, d.clase, d.nombre, formato.mime, formato.ext, bytes.byteLength, d.sha256, key, d.tipo, d.objeto_id, d.clase, d.nombre, actor, now),
      auditoria(env, { actor, accion: 'documento_alta', objeto_tipo: d.tipo, objeto_id: d.objeto_id, detalle: { documento_id: d.id, clase: d.clase, nombre: d.nombre, bytes: bytes.byteLength, sha256: d.sha256 }, now }),
    ]);
    if (resultado.repetida) {
      const operacion = await env.DB.prepare('SELECT resultado_id FROM g_idempotencia WHERE clave=?').bind(d.id).first();
      const guardado = await fila(env, 'g_documentos', operacion?.resultado_id || d.id);
      if (guardado.key !== key) await limpiarIntentoDocumento(env, key, d.id);
      return json({ item: documentoItem(guardado) }, 200, NO_STORE);
    }
  } catch (e) {
    // Si no podemos confirmar la escritura, preservar bytes; nunca borrar un objeto
    // que D1 pudo haber adoptado antes de una respuesta de red perdida.
    await limpiarIntentoDocumento(env, key, d.id);
    if (e instanceof HttpError) throw e;
    if (/UNIQUE constraint failed: g_documentos/.test(e.message)) {
      const otro = await env.DB.prepare('SELECT * FROM g_documentos WHERE tipo=? AND objeto_id=? AND sha256=?').bind(d.tipo, d.objeto_id, d.sha256).first();
      if (otro) return devolverDuplicado(otro);
    }
    throw new HttpError(503, 'documento_no_guardado');
  }
  return json({ item: documentoItem(await fila(env, 'g_documentos', d.id)) }, 201, NO_STORE);
});
gestion.get(`${BASE}/documentos/:id/archivo`, async (c) => {
  const { env, url } = abrir(c);
  const row = await fila(env, 'g_documentos', idRuta(c));
  if (!env.FINANCE_DOCS) throw new HttpError(503, 'finance_docs_not_configured');
  const obj = await env.FINANCE_DOCS.get(row.key);
  if (!obj) throw new HttpError(404, 'archivo_no_disponible');
  const descargar = url.searchParams.get('descargar') === '1';
  return new Response(obj.body, { headers: { ...DOC_HEADERS, 'Content-Type': row.mime, 'Content-Length': String(row.bytes),
    'Content-Disposition': `${descargar ? 'attachment' : 'inline'}; filename="${row.nombre}"` } });
});
