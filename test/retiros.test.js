// Conciliación de retiros (0065): control separado del libro. Todo ficticio, en céntimos.
// Importes redondos de ejemplo; ningún dato bancario real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { HttpError } from '../worker/app.js';
import { gestion } from '../worker/routes/gestion.js';
import { calcularLote } from '../worker/retiros.js';
import { previewTarget, readOnlyEnv } from '../worker/mobile-preview.js';
import { sqliteD1 } from './helpers/sqlite-d1.js';

const SOCIO = { role: 'velai', tenantId: null, email: 'uno@velai.test' };
const NO_SOCIO = { role: 'velai', tenantId: null, email: 'otro@velai.test', permisos: [] };
const CLIENTE = { role: 'cliente', tenantId: 'tenant-ejemplo', email: 'cliente@ejemplo.test', permisos: [] };
const ctx = { waitUntil() {} };
const error = (status, code) => (e) => e.status === status && e.code === code;
const nuevo = () => crypto.randomUUID();
const EUR = 100;
const INYECTADO = new WeakMap();
const app = new Hono();
app.use('*', async (c, next) => { c.set('scope', INYECTADO.get(c.req.raw)); c.set('config', {}); await next(); });
app.route('/', gestion);
app.notFound(() => { throw new HttpError(404, 'not_found'); });
app.onError((e) => { throw e; });

async function fixture(t) {
  const DB = await sqliteD1(); t.after(() => DB.close());
  await DB.exec('PRAGMA foreign_keys=ON;');
  await DB.exec("DELETE FROM fin_socios; INSERT INTO fin_socios (email,nombre) VALUES ('uno@velai.test','Uno');");
  const env = { DB, SOCIOS_EMAILS: 'uno@velai.test' };
  const call = (path, method = 'GET', body, scope = SOCIO, entorno = env) => {
    const init = { method, headers: {} };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const req = new Request(`https://admin.test/api/admin/${path}`, init);
    INYECTADO.set(req, scope);
    return app.fetch(req, entorno, ctx);
  };
  const api = async (...args) => (await call(...args)).json();
  const run = (sql, ...args) => DB.prepare(sql).bind(...args).run();
  const cuenta = async (nombre) => { const id = nuevo(); await run("INSERT INTO g_cuentas (id,nombre,moneda,saldo_inicial,version,created_by,created_at,updated_at) VALUES (?,?,'EUR',0,1,'qa','2026-11-01','2026-11-01')", id, nombre); return id; };
  const banco = await cuenta('Banco ejemplo'), caja = await cuenta('Caja ejemplo'), destino = await cuenta('Destino por identificar · fondos no disponibles');
  const traspaso = async (origen, dest, importe, nota = null, fecha = '2026-11-12') => { const id = nuevo();
    await run("INSERT INTO fin_traspasos (id,fecha,moneda,importe,cuenta_origen_id,cuenta_destino_id,nota,signo,reverso_de,created_by,created_at) VALUES (?,?,'EUR',?,?,?,?,1,NULL,'qa','2026-11-13T00:00:00.000Z')", id, fecha, importe, origen, dest, nota); return id; };
  const anularTraspaso = async (orig) => { const o = await DB.prepare('SELECT * FROM fin_traspasos WHERE id=?').bind(orig).first(); const id = nuevo();
    await run("INSERT INTO fin_traspasos (id,fecha,moneda,importe,cuenta_origen_id,cuenta_destino_id,nota,signo,reverso_de,created_by,created_at) VALUES (?,?,'EUR',?,?,?,'reverso ficticio',-1,?,'qa','2026-11-14T00:00:00.000Z')", id, '2026-11-14', o.importe, o.cuenta_origen_id, o.cuenta_destino_id, orig); return id; };
  const movimiento = async (tipo, importe, nota = 'Salida ficticia') => { const id = nuevo();
    await run("INSERT OR IGNORE INTO fin_conceptos (tipo,nombre,position,created_by,created_at) VALUES (?,'Concepto ficticio',99,'qa','2026-11-01')", tipo);
    const concepto = (await DB.prepare("SELECT id FROM fin_conceptos WHERE tipo=? AND nombre='Concepto ficticio'").bind(tipo).first()).id;
    await run("INSERT INTO fin_movimientos (id,tipo,concepto_id,fecha,moneda,importe,nota,created_by,created_at) VALUES (?,?,?,'2026-11-12','EUR',?,?,'qa','2026-11-13T00:00:00.000Z')", id, tipo, concepto, importe, nota); return id; };
  const compra = async (concepto = 'Compra en efectivo ejemplo') => { const id = nuevo();
    await run("INSERT INTO g_compras (id,concepto,negocio,moneda,estimado,estado,version,created_by,created_at,updated_at) VALUES (?,?,'velai','EUR',500000,'prevista',1,'qa','2026-11-01','2026-11-01')", id, concepto); return id; };
  const pago = async (compraId, cuentaId, importe, pagador = 'cuenta') => { const id = nuevo();
    if (pagador === 'cuenta') await run("INSERT INTO g_pagos (id,objeto_tipo,objeto_id,clase,fecha,moneda,importe,pagador,cuenta_id,created_by,created_at) VALUES (?,'compra',?,'pago','2026-11-12','EUR',?,'cuenta',?,'qa','2026-11-12T00:00:00.000Z')", id, compraId, importe, cuentaId);
    else await run("INSERT INTO g_pagos (id,objeto_tipo,objeto_id,clase,fecha,moneda,importe,pagador,socio,created_by,created_at) VALUES (?,'compra',?,'pago','2026-11-12','EUR',?,'socio','uno@velai.test','qa','2026-11-12T00:00:00.000Z')", id, compraId, importe);
    return id; };
  const libro = async () => JSON.stringify(await DB.prepare(`SELECT (SELECT COUNT(*) FROM fin_movimientos) AS m,(SELECT COALESCE(SUM(importe),0) FROM fin_movimientos) AS mi,
    (SELECT COUNT(*) FROM fin_traspasos) AS t,(SELECT COALESCE(SUM(importe*signo),0) FROM fin_traspasos) AS ti,(SELECT COUNT(*) FROM g_pagos) AS p,(SELECT COALESCE(SUM(importe),0) FROM g_pagos) AS pi,
    (SELECT COUNT(*) FROM g_compras) AS c`).first());
  const auditorias = async () => (await DB.prepare("SELECT accion FROM g_auditoria WHERE objeto_tipo LIKE 'retiro_%' ORDER BY id").all()).results.map((r) => r.accion);
  const crearLote = (extra = {}) => api('gestion/retiros', 'POST', { id: nuevo(), nombre: 'Lote ficticio', ...extra });
  const fuente = (loteId, origen_tipo, origen_id, extra = {}) => api(`gestion/retiros/${loteId}/fuentes`, 'POST', { id: nuevo(), origen_tipo, origen_id, clasificacion: 'traspaso_por_identificar', evidencia: 'extracto', ...extra });
  const atm = (loteId, origen_id, extra = {}) => fuente(loteId, 'traspaso', origen_id, { clasificacion: 'cajero_verificado', evidencia: 'extracto', ...extra });
  const uso = (loteId, extra) => api(`gestion/retiros/${loteId}/usos`, 'POST', { id: nuevo(), ...extra });
  const detalle = (id) => api(`gestion/retiros/${id}`);
  const codigos = (d) => d.motivos.map((m) => m.codigo);
  return { DB, env, call, api, run, banco, caja, destino, traspaso, anularTraspaso, movimiento, compra, pago, libro, auditorias, crearLote, fuente, atm, uso, detalle, codigos };
}

test('cálculo puro: solo queda sin pendientes con todo registrado, probado y cuadrado; un uso declarado lo mantiene abierto', () => {
  const f = (o) => ({ estado: 'activa', origen: { estado: 'activo' }, clasificacion: 'cajero_verificado', importe: 8000, comision: 290, coste_estado: 'confirmado', evidencia: 'extracto', ...o });
  const u = (o) => ({ estado: 'activo', tipo: 'pago_existente', pago_vigente: true, importe_efectivo: 7710, aporte_personal: null, aporte_reembolso: null, fecha: '2026-11-12', sin_documento: false, ...o });
  const cerrado = calcularLote([f()], [u()]);
  assert.equal(cerrado.totales.diferencia_por_explicar, 0); assert.deepEqual(cerrado.motivos, []); assert.equal(cerrado.estado, 'sin_pendientes');
  const declarado = calcularLote([f()], [u({ tipo: 'declaracion', pago_vigente: false })]);
  assert.equal(declarado.estado, 'abierta'); assert.ok(declarado.motivos.some((m) => m.codigo === 'usos_declarados'));
  // Una comisión sin confirmar nunca se suma como conocida ni se trata como 0.
  const sinConfirmar = calcularLote([f({ comision: null, coste_estado: 'autorizacion_pendiente', coste_bancario_total: 8290 })], [u({ importe_efectivo: 8000 })]);
  assert.equal(sinConfirmar.totales.comisiones_conocidas, 0); assert.equal(sinConfirmar.totales.comisiones_desconocidas, 1); assert.equal(sinConfirmar.estado, 'abierta');
  // Fuente anulada fuera de los totales, pero señalada. Uso con pago anulado también.
  const roto = calcularLote([f({ origen: { estado: 'anulado' } })], [u({ pago_vigente: false })]);
  assert.equal(roto.totales.total_salidas, 0); assert.equal(roto.totales.usos_total, 0);
  assert.deepEqual(roto.motivos.map((m) => m.codigo).sort(), ['fuentes_anuladas', 'sin_fuentes', 'usos_con_pago_anulado']);
  // Usos mayores que las salidas no se disfrazan de saldo.
  assert.ok(calcularLote([f({ comision: 0 })], [u({ importe_efectivo: 9000 })]).motivos.some((m) => m.codigo === 'usos_superan_salidas'));
});

test('lote de cinco salidas: 1.000 € de cajero y 3.900 € en cuatro traspasos por identificar; usos 4.400 €, 500 € por explicar y origen no trazado', async (t) => {
  const f = await fixture(t);
  const atm = await f.traspaso(f.banco, f.caja, 1000 * EUR, 'RETIRO CAJERO');
  const cuatro = []; for (const importe of [1000 * EUR, 900 * EUR, 1000 * EUR, 1000 * EUR]) cuatro.push(await f.traspaso(f.banco, f.destino, importe, 'TRASPASO, beneficiario no consta'));
  const compra = await f.compra(); const pago = await f.pago(compra, f.caja, 3200 * EUR);
  const antes = await f.libro();
  const lote = (await f.crearLote({ nombre: 'Lote A ficticio' })).item;
  await f.atm(lote.id, atm);
  for (const id of cuatro) await f.fuente(lote.id, 'traspaso', id);
  await f.uso(lote.id, { tipo: 'pago_existente', pago_id: pago, importe_efectivo: 3200 * EUR });
  await f.uso(lote.id, { tipo: 'declaracion', concepto: 'Entrega declarada sin fecha', importe_efectivo: 1200 * EUR, declarado_por: 'Persona declarante' });
  const d = await f.detalle(lote.id);
  assert.equal(d.fuentes.length, 5);
  const t_ = d.totales;
  assert.equal(t_.total_salidas, 4900 * EUR); assert.equal(t_.efectivo_confirmado, 1000 * EUR); assert.equal(t_.efectivo_declarado, 0);
  assert.equal(t_.traspasos_por_identificar, 3900 * EUR); assert.equal(t_.usos_registrados, 3200 * EUR); assert.equal(t_.usos_declarados, 1200 * EUR); assert.equal(t_.usos_total, 4400 * EUR);
  // La diferencia es trabajo pendiente de explicar, nunca "saldo de efectivo".
  assert.equal(t_.diferencia_por_explicar, 500 * EUR);
  assert.ok(!Object.keys(t_).some((k) => /saldo/.test(k)));
  // El déficit de origen sigue a la vista: 4.400 usados frente a 1.000 confirmados.
  assert.equal(t_.origen_no_trazado, 3400 * EUR);
  assert.equal(d.estado, 'abierta');
  for (const c of ['traspasos_por_identificar', 'diferencia_por_explicar', 'origen_no_trazado', 'fechas_desconocidas', 'usos_declarados']) assert.ok(f.codigos(d).includes(c), c);
  // La referencia a un traspaso no afirma quién lo recibió.
  const pendiente = d.fuentes.find((x) => x.clasificacion === 'traspaso_por_identificar');
  assert.equal(pendiente.nota, null); assert.equal(pendiente.origen.nota, 'TRASPASO, beneficiario no consta'); assert.equal(pendiente.declarado_por, null);
  // El control no creó ni cambió nada en el libro.
  assert.equal(await f.libro(), antes);
  const lista = await f.api('gestion/retiros');
  assert.equal(lista.items.length, 1); assert.equal(lista.totales.EUR.total_salidas, 4900 * EUR); assert.equal(lista.totales.EUR.lotes_abiertos, 1);
});

test('retiro de 80 € con comisión desconocida: la autorización pendiente no es comisión confirmada; 75 + 5 declarados y compra de 5,60 con 0,60 personal', async (t) => {
  const f = await fixture(t);
  const cajero = await f.traspaso(f.banco, f.caja, 80 * EUR, 'RETIRO CAJERO');
  const cajeroPequeno = await f.traspaso(f.banco, f.caja, 5 * EUR, 'RETIRO CAJERO');
  const compraPequena = await f.compra('Otra compra ficticia');
  const antes = await f.libro();
  const lote = (await f.crearLote({ nombre: 'Lote B ficticio' })).item;
  const alta = await f.atm(lote.id, cajero, { coste_bancario_total: 8290, coste_estado: 'autorizacion_pendiente' });
  assert.equal(alta.item.comision, null); assert.equal(alta.item.coste_estado, 'autorizacion_pendiente');
  await f.uso(lote.id, { tipo: 'declaracion', concepto: 'Pago a Persona A', importe_efectivo: 75 * EUR, declarado_por: 'Persona B' });
  await f.uso(lote.id, { tipo: 'declaracion', concepto: 'Otro consumo', importe_efectivo: 5 * EUR, declarado_por: 'Persona B' });
  let d = await f.detalle(lote.id);
  assert.equal(d.totales.diferencia_por_explicar, 0);
  assert.equal(d.totales.comisiones_conocidas, 0); assert.equal(d.totales.comisiones_por_confirmar, 1); assert.equal(d.totales.comisiones_desconocidas, 1);
  assert.equal(d.estado, 'abierta'); assert.ok(f.codigos(d).includes('comisiones_por_confirmar'));
  // Compra de 5,60: 5,00 de efectivo común y 0,60 personal sin indicar si se reembolsa.
  const lote2 = (await f.crearLote({ nombre: 'Lote compra pequeña' })).item;
  await f.atm(lote2.id, cajeroPequeno);
  await f.uso(lote2.id, { tipo: 'declaracion', concepto: 'Compra de 5,60', compra_id: compraPequena, importe_efectivo: 5 * EUR, aporte_personal: 60, declarado_por: 'Persona C' });
  d = await f.detalle(lote2.id);
  assert.equal(d.totales.usos_total, 5 * EUR); assert.equal(d.totales.aportes_personales, 60); assert.equal(d.totales.aportes_sin_indicar, 60); assert.equal(d.totales.diferencia_por_explicar, 0);
  assert.equal(d.usos[0].compra.concepto, 'Otra compra ficticia');
  // Confirmar después la comisión: queda conocida, sin tocar el libro.
  const fuenteId = alta.item.id;
  const nueva = await f.api(`gestion/retiros/${lote.id}/fuentes/${fuenteId}`, 'PATCH', { version: 1, comision: 290, coste_estado: 'confirmado' });
  assert.equal(nueva.item.version, 2);
  d = await f.detalle(lote.id);
  assert.equal(d.totales.comisiones_conocidas, 290); assert.equal(d.totales.comisiones_por_confirmar, 0);
  assert.equal(d.totales.diferencia_por_explicar, -290); assert.ok(f.codigos(d).includes('usos_superan_salidas'));
  // Una comisión confirmada exige un importe: desconocido no es 0.
  await assert.rejects(f.api(`gestion/retiros/${lote.id}/fuentes/${fuenteId}`, 'PATCH', { version: 2, comision: null }), error(400, 'coste_confirmado_sin_importe'));
  const cero = await f.api(`gestion/retiros/${lote.id}/fuentes/${fuenteId}`, 'PATCH', { version: 2, comision: 0 });
  assert.equal(cero.item.comision, 0);
  assert.equal(await f.libro(), antes);
});

test('servicio de taller de 84 €: 80 € de efectivo común y 4 € personales no reembolsables, fecha pendiente, sin escribir en el libro', async (t) => {
  const f = await fixture(t);
  const cajero = await f.traspaso(f.banco, f.caja, 80 * EUR, 'RETIRO CAJERO');
  const compra = await f.compra('Servicio de taller ficticio');
  const antes = await f.libro();
  const lote = (await f.crearLote({ nombre: 'Lote C ficticio' })).item;
  await f.atm(lote.id, cajero);
  const u = await f.uso(lote.id, { tipo: 'declaracion', concepto: 'Servicio de taller', compra_id: compra, importe_efectivo: 80 * EUR, aporte_personal: 4 * EUR, aporte_reembolso: 'no_reembolsable', declarado_por: 'Persona D' });
  assert.equal(u.item.fecha, null); assert.equal(u.item.aporte_reembolso, 'no_reembolsable');
  const d = await f.detalle(lote.id);
  assert.equal(d.totales.usos_total, 80 * EUR); assert.equal(d.totales.aportes_personales, 4 * EUR); assert.equal(d.totales.aportes_no_reembolsables, 4 * EUR); assert.equal(d.totales.aportes_reembolsables, 0);
  assert.equal(d.totales.diferencia_por_explicar, 0); assert.ok(f.codigos(d).includes('fechas_desconocidas')); assert.equal(d.estado, 'abierta');
  // El aporte personal solo informa: no hay pagos, movimientos ni deudas nuevas.
  assert.equal(await f.libro(), antes);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM g_pagos').first()).n, 0);
  await assert.rejects(f.uso(lote.id, { tipo: 'declaracion', concepto: 'Sin aporte', importe_efectivo: 100, aporte_reembolso: 'reembolsable', declarado_por: 'X' }), error(400, 'reembolso_sin_aporte'));
  // Con fecha cuando se conozca; una fecha futura no vale.
  const fechado = await f.api(`gestion/retiros/${lote.id}/usos/${u.item.id}`, 'PATCH', { version: 1, fecha: '2026-11-12' });
  assert.equal(fechado.item.fecha, '2026-11-12');
  await assert.rejects(f.api(`gestion/retiros/${lote.id}/usos/${u.item.id}`, 'PATCH', { version: 2, fecha: '2100-01-01' }), error(400, 'fecha_invalida'));
});

test('cero de diferencia no cierra el lote: declarados, fechas y origen siguen señalados', async (t) => {
  const f = await fixture(t);
  const lote = (await f.crearLote()).item;
  await f.atm(lote.id, await f.traspaso(f.banco, f.caja, 80 * EUR), { comision: 0, coste_estado: 'confirmado' });
  await f.uso(lote.id, { tipo: 'declaracion', concepto: 'Gasto declarado', importe_efectivo: 80 * EUR, declarado_por: 'Persona E' });
  const d = await f.detalle(lote.id);
  assert.equal(d.totales.diferencia_por_explicar, 0); assert.equal(d.totales.origen_no_trazado, 0);
  assert.equal(d.estado, 'abierta'); assert.deepEqual(f.codigos(d).sort(), ['fechas_desconocidas', 'usos_declarados', 'usos_sin_documento']);
});

test('una operación no puede estar en dos lotes; retirarla del control la libera sin borrar el vínculo', async (t) => {
  const f = await fixture(t);
  const tr = await f.traspaso(f.banco, f.destino, 100 * EUR);
  const a = (await f.crearLote({ nombre: 'Lote 1' })).item, b = (await f.crearLote({ nombre: 'Lote 2' })).item;
  const primera = await f.fuente(a.id, 'traspaso', tr);
  await assert.rejects(f.fuente(a.id, 'traspaso', tr), error(409, 'operacion_ya_vinculada'));
  await assert.rejects(f.fuente(b.id, 'traspaso', tr), error(409, 'operacion_ya_vinculada'));
  const candidatos = await f.api('gestion/retiros/candidatos');
  assert.ok(!candidatos.traspasos.some((x) => x.id === tr));
  const retirada = await f.api(`gestion/retiros/${a.id}/fuentes/${primera.item.id}`, 'PATCH', { version: 1, estado: 'retirada', nota: 'Enlazada por error' });
  assert.equal(retirada.item.estado, 'retirada');
  assert.equal((await f.detalle(a.id)).fuentes.length, 1); assert.equal((await f.detalle(a.id)).totales.total_salidas, 0);
  await f.fuente(b.id, 'traspaso', tr);
  await assert.rejects(f.api(`gestion/retiros/${a.id}/fuentes/${primera.item.id}`, 'PATCH', { version: 2, estado: 'activa' }), error(409, 'operacion_ya_vinculada'));
  // El vínculo es inmutable y nada se borra: tampoco por SQL directo.
  await assert.rejects(f.run('UPDATE g_retiro_fuentes SET origen_id=? WHERE id=?', nuevo(), primera.item.id), /retiro_vinculo_inmutable/);
  await assert.rejects(f.run('DELETE FROM g_retiro_fuentes WHERE id=?', primera.item.id), /retiro_sin_borrado/);
  await assert.rejects(f.run('DELETE FROM g_retiro_lotes WHERE id=?', a.id), /retiro_sin_borrado/);
});

test('si el traspaso se anula, el vínculo queda marcado como anulado y no se pierde', async (t) => {
  const f = await fixture(t);
  const atm = await f.traspaso(f.banco, f.caja, 100 * EUR), pendiente = await f.traspaso(f.banco, f.destino, 300 * EUR);
  const lote = (await f.crearLote()).item;
  await f.atm(lote.id, atm); await f.fuente(lote.id, 'traspaso', pendiente);
  assert.equal((await f.detalle(lote.id)).totales.total_salidas, 400 * EUR);
  await f.anularTraspaso(pendiente);
  const d = await f.detalle(lote.id);
  assert.equal(d.fuentes.length, 2);
  const marcada = d.fuentes.find((x) => x.origen_id === pendiente);
  assert.equal(marcada.origen.estado, 'anulado'); assert.ok(marcada.origen.reverso_id);
  assert.equal(d.totales.total_salidas, 100 * EUR); assert.equal(d.totales.traspasos_por_identificar, 0);
  assert.ok(f.codigos(d).includes('fuentes_anuladas')); assert.equal(d.estado, 'abierta');
  // Un traspaso ya anulado no se puede enlazar.
  const otro = (await f.crearLote({ nombre: 'Otro' })).item;
  await assert.rejects(f.fuente(otro.id, 'traspaso', pendiente), error(400, 'operacion_anulada'));
  const reverso = (await f.DB.prepare('SELECT id FROM fin_traspasos WHERE reverso_de=?').bind(pendiente).first()).id;
  await assert.rejects(f.fuente(otro.id, 'traspaso', reverso), error(400, 'operacion_no_enlazable'));
});

test('pago existente: no se aplica más que el pago, un pago revertido deja el uso señalado y la anulación del uso es reversible', async (t) => {
  const f = await fixture(t);
  const atm = await f.traspaso(f.banco, f.caja, 500 * EUR);
  const compra = await f.compra(); const pago = await f.pago(compra, f.caja, 300 * EUR); const delSocio = await f.pago(compra, null, 50 * EUR, 'socio');
  const lote = (await f.crearLote()).item;
  await f.atm(lote.id, atm);
  const primero = await f.uso(lote.id, { tipo: 'pago_existente', pago_id: pago, importe_efectivo: 200 * EUR });
  assert.equal(primero.item.fecha, '2026-11-12'); assert.equal(primero.item.compra_id, compra); assert.equal(primero.item.pago_vigente, true);
  await assert.rejects(f.uso(lote.id, { tipo: 'pago_existente', pago_id: pago, importe_efectivo: 100 * EUR + 1 }), error(409, 'uso_supera_pago'));
  const segundo = await f.uso(lote.id, { tipo: 'pago_existente', pago_id: pago, importe_efectivo: 100 * EUR });
  await assert.rejects(f.api(`gestion/retiros/${lote.id}/usos/${segundo.item.id}`, 'PATCH', { version: 1, importe_efectivo: 100 * EUR + 1 }), error(409, 'uso_supera_pago'));
  await assert.rejects(f.uso(lote.id, { tipo: 'pago_existente', pago_id: delSocio, importe_efectivo: 100 }), error(400, 'pago_no_enlazable'));
  await assert.rejects(f.uso(lote.id, { tipo: 'pago_existente', pago_id: nuevo(), importe_efectivo: 100 }), error(400, 'pago_invalido'));
  await assert.rejects(f.uso(lote.id, { tipo: 'pago_existente', pago_id: pago, importe_efectivo: 100, fecha: '2026-11-01' }), error(400, 'fecha_del_pago'));
  assert.equal((await f.detalle(lote.id)).totales.usos_registrados, 300 * EUR);
  // Anular el uso libera el pago y se puede reactivar; el pago no cambia.
  const anulado = await f.api(`gestion/retiros/${lote.id}/usos/${segundo.item.id}`, 'PATCH', { version: 1, estado: 'anulado', nota: 'Aplicado por error' });
  assert.equal(anulado.item.estado, 'anulado');
  assert.equal((await f.detalle(lote.id)).totales.usos_registrados, 200 * EUR);
  const reactivado = await f.api(`gestion/retiros/${lote.id}/usos/${segundo.item.id}`, 'PATCH', { version: 2, estado: 'activo' });
  assert.equal(reactivado.item.estado, 'activo');
  // Si el pago original se revierte, el uso queda señalado y deja de sumar.
  await f.run("UPDATE g_pagos SET estado='revertido' WHERE id=?", pago);
  const d = await f.detalle(lote.id);
  assert.equal(d.totales.usos_registrados, 0); assert.ok(f.codigos(d).includes('usos_con_pago_anulado')); assert.equal(d.usos.length, 2);
  await assert.rejects(f.uso(lote.id, { tipo: 'pago_existente', pago_id: pago, importe_efectivo: 100 }), error(409, 'pago_no_vigente'));
  const cand = await f.api('gestion/retiros/candidatos');
  assert.ok(!cand.pagos.some((p) => p.id === pago));
});

test('movimientos del libro como fuente: solo salidas vigentes; los ingresos no se enlazan', async (t) => {
  const f = await fixture(t);
  const salida = await f.movimiento('egreso', 60 * EUR), ingreso = await f.movimiento('ingreso', 10 * EUR);
  const lote = (await f.crearLote()).item;
  const alta = await f.fuente(lote.id, 'movimiento', salida, { clasificacion: 'efectivo_declarado', evidencia: 'declaracion', declarado_por: 'Persona F' });
  assert.equal(alta.item.importe, 60 * EUR); assert.equal(alta.item.origen.estado, 'activo');
  await assert.rejects(f.fuente(lote.id, 'movimiento', ingreso), error(400, 'operacion_no_enlazable'));
  await assert.rejects(f.fuente(lote.id, 'movimiento', 'no-existe'), error(400, 'origen_no_encontrado'));
  const d = await f.detalle(lote.id);
  assert.equal(d.totales.efectivo_declarado, 60 * EUR); assert.equal(d.totales.efectivo_confirmado, 0);
});

test('validaciones: cajero verificado exige extracto o captura, quien declara se nombra, moneda, comisión y campos desconocidos', async (t) => {
  const f = await fixture(t);
  const tr = await f.traspaso(f.banco, f.caja, 100 * EUR);
  const lote = (await f.crearLote()).item;
  await assert.rejects(f.fuente(lote.id, 'traspaso', tr, { clasificacion: 'cajero_verificado', evidencia: null }), error(400, 'cajero_requiere_evidencia'));
  await assert.rejects(f.fuente(lote.id, 'traspaso', tr, { clasificacion: 'cajero_verificado', evidencia: 'declaracion', declarado_por: 'X' }), error(400, 'cajero_requiere_evidencia'));
  await assert.rejects(f.fuente(lote.id, 'traspaso', tr, { evidencia: 'declaracion' }), error(400, 'declarante_requerido'));
  await assert.rejects(f.fuente(lote.id, 'traspaso', tr, { comision: 100 * EUR + 1 }), error(400, 'comision_invalida'));
  await assert.rejects(f.fuente(lote.id, 'traspaso', tr, { comision: 1.5 }), error(400, 'comision_invalida'));
  await assert.rejects(f.fuente(lote.id, 'traspaso', tr, { clasificacion: 'efectivo_inventado' }), error(400, 'clasificacion_invalida'));
  await assert.rejects(f.fuente(lote.id, 'traspaso', tr, { importe: 1 }), error(400, 'campo_desconocido'));
  await assert.rejects(f.fuente(lote.id, 'cuenta', tr), error(400, 'origen_invalido'));
  const cop = (await f.crearLote({ nombre: 'Pesos', moneda: 'COP' })).item;
  await assert.rejects(f.fuente(cop.id, 'traspaso', tr), error(400, 'moneda_distinta'));
  await assert.rejects(f.uso(lote.id, { tipo: 'declaracion', importe_efectivo: 100, declarado_por: 'X' }), error(400, 'concepto_invalido'));
  await assert.rejects(f.uso(lote.id, { tipo: 'declaracion', concepto: 'Sin autor', importe_efectivo: 100 }), error(400, 'declarante_requerido'));
  await assert.rejects(f.uso(lote.id, { tipo: 'declaracion', concepto: 'Cero', importe_efectivo: 0, declarado_por: 'X' }), error(400, 'importe_invalido'));
  await assert.rejects(f.uso(lote.id, { tipo: 'declaracion', concepto: 'Compra rara', compra_id: nuevo(), importe_efectivo: 100, declarado_por: 'X' }), error(400, 'compra_invalida'));
  await assert.rejects(f.uso(lote.id, { tipo: 'declaracion', concepto: 'Con pago', pago_id: nuevo(), importe_efectivo: 100, declarado_por: 'X' }), error(400, 'pago_no_aplica'));
});

test('idempotencia y versiones: repetir no duplica, otro cuerpo es conflicto, una versión vieja no escribe ni audita', async (t) => {
  const f = await fixture(t);
  const id = nuevo(), cuerpo = { id, nombre: 'Lote idempotente', nota: 'Primera nota' };
  const primera = await f.call('gestion/retiros', 'POST', cuerpo);
  assert.equal(primera.status, 201);
  assert.equal((await f.call('gestion/retiros', 'POST', cuerpo)).status, 200);
  await assert.rejects(f.call('gestion/retiros', 'POST', { ...cuerpo, nombre: 'Otro nombre' }), error(409, 'idempotencia_conflicto'));
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM g_retiro_lotes').first()).n, 1);
  // Misma idempotencia en fuentes y usos.
  const tr = await f.traspaso(f.banco, f.destino, 10 * EUR);
  const fuente = { id: nuevo(), origen_tipo: 'traspaso', origen_id: tr, clasificacion: 'traspaso_por_identificar', evidencia: 'extracto' };
  assert.equal((await f.call(`gestion/retiros/${id}/fuentes`, 'POST', fuente)).status, 201);
  assert.equal((await f.call(`gestion/retiros/${id}/fuentes`, 'POST', fuente)).status, 200);
  const declaracion = { id: nuevo(), tipo: 'declaracion', concepto: 'Gasto ficticio', importe_efectivo: 500, declarado_por: 'Persona G' };
  assert.equal((await f.call(`gestion/retiros/${id}/usos`, 'POST', declaracion)).status, 201);
  assert.equal((await f.call(`gestion/retiros/${id}/usos`, 'POST', declaracion)).status, 200);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM g_retiro_fuentes').first()).n, 1); assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM g_retiro_usos').first()).n, 1);
  // Versión optimista con auditoría del valor previo.
  await assert.rejects(f.api(`gestion/retiros/${id}`, 'PATCH', { nota: 'Sin versión' }), error(400, 'version_requerida'));
  const editado = await f.api(`gestion/retiros/${id}`, 'PATCH', { version: 1, nota: 'Nota corregida' });
  assert.equal(editado.item.version, 2); assert.equal(editado.item.nota, 'Nota corregida'); assert.equal(editado.item.updated_by, 'uno@velai.test');
  const auditoriasAntes = (await f.auditorias()).length;
  await assert.rejects(f.api(`gestion/retiros/${id}`, 'PATCH', { version: 1, nota: 'Versión vieja' }), error(409, 'version_conflicto'));
  assert.equal((await f.auditorias()).length, auditoriasAntes);
  assert.equal((await f.detalle(id)).item.nota, 'Nota corregida');
  const cambio = (await f.detalle(id)).historial.find((h) => h.accion === 'retiro_lote_cambio');
  assert.equal(cambio.detalle.de.nota, 'Primera nota'); assert.equal(cambio.detalle.a.nota, 'Nota corregida'); assert.equal(cambio.actor, 'uno@velai.test');
  assert.deepEqual((await f.auditorias()).sort(), ['retiro_fuente_alta', 'retiro_lote_alta', 'retiro_lote_cambio', 'retiro_uso_alta']);
  await assert.rejects(f.api(`gestion/retiros/${id}`, 'PATCH', { version: 2, moneda: 'COP' }), error(400, 'campo_no_editable'));
});

test('solo socios de Velai: el resto recibe 403 sin tocar D1, y la vista previa móvil no lo expone ni escribe', async (t) => {
  const f = await fixture(t);
  const sinDB = { SOCIOS_EMAILS: 'uno@velai.test', DB: new Proxy({}, { get() { throw new Error('D1 no debería consultarse'); } }) };
  const lote = nuevo();
  const rutas = [['gestion/retiros', 'GET'], ['gestion/retiros', 'POST', { id: nuevo(), nombre: 'X' }], ['gestion/retiros/candidatos', 'GET'], [`gestion/retiros/${lote}`, 'GET'], [`gestion/retiros/${lote}`, 'PATCH', { version: 1 }],
    [`gestion/retiros/${lote}/fuentes`, 'POST', {}], [`gestion/retiros/${lote}/fuentes/${nuevo()}`, 'PATCH', { version: 1 }], [`gestion/retiros/${lote}/usos`, 'POST', {}], [`gestion/retiros/${lote}/usos/${nuevo()}`, 'PATCH', { version: 1 }]];
  for (const scope of [NO_SOCIO, CLIENTE]) for (const [ruta, metodo, cuerpo] of rutas) await assert.rejects(f.call(ruta, metodo, cuerpo, scope, sinDB), error(403, 'not_authorized'), `${metodo} ${ruta}`);
  // Un lote creado por un socio no es visible para otro rol, y las listas no mezclan nada ajeno.
  await f.crearLote();
  await assert.rejects(f.call('gestion/retiros', 'GET', undefined, CLIENTE), error(403, 'not_authorized'));
  // Vista previa: la ruta no está en la lista de lectura y toda mutación queda bloqueada antes.
  for (const sufijo of ['gestion/retiros', `gestion/retiros/${lote}`, 'gestion/retiros/candidatos', `gestion/retiros/${lote}/fuentes`]) {
    assert.throws(() => previewTarget(`/api/admin/mobile-preview/${sufijo}`, 'GET', { role: 'velai' }), { status: 403 });
    for (const metodo of ['POST', 'PATCH', 'PUT', 'DELETE']) assert.throws(() => previewTarget(`/api/admin/mobile-preview/${sufijo}`, metodo, { role: 'velai' }), { status: 405 });
  }
  // Aunque un handler llegara a ejecutarse con el entorno de solo lectura, ninguna sentencia de escritura sale.
  const ro = readOnlyEnv(f.env);
  const antes = (await f.DB.prepare('SELECT COUNT(*) AS n FROM g_retiro_lotes').first()).n;
  await assert.rejects(f.call('gestion/retiros', 'POST', { id: nuevo(), nombre: 'Escritura bloqueada' }, SOCIO, ro), { status: 405 });
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM g_retiro_lotes').first()).n, antes);
  assert.equal((await f.call('gestion/retiros', 'GET', undefined, SOCIO, ro)).status, 200);
});

test('candidatos: solo traspasos y salidas sin enlazar, sin anulados; pagos con efectivo disponible', async (t) => {
  const f = await fixture(t);
  const libre = await f.traspaso(f.banco, f.destino, 10 * EUR), enlazado = await f.traspaso(f.banco, f.destino, 20 * EUR), anulado = await f.traspaso(f.banco, f.destino, 30 * EUR);
  await f.anularTraspaso(anulado);
  const compra = await f.compra(); const pago = await f.pago(compra, f.caja, 100 * EUR);
  const lote = (await f.crearLote()).item;
  await f.fuente(lote.id, 'traspaso', enlazado);
  await f.uso(lote.id, { tipo: 'pago_existente', pago_id: pago, importe_efectivo: 40 * EUR });
  const c = await f.api('gestion/retiros/candidatos');
  assert.deepEqual(c.traspasos.map((x) => x.id), [libre]);
  assert.equal(c.pagos.find((p) => p.id === pago).disponible, 60 * EUR);
});


test('una salida enlazada que cambia a ingreso deja de contar como fuente y mantiene la alerta', async (t) => {
  const f = await fixture(t);
  const mid = await f.movimiento('egreso', 8000);
  const lote = (await f.crearLote()).item;
  await f.fuente(lote.id, 'movimiento', mid, { clasificacion: 'cajero_verificado', evidencia: 'extracto', comision: 0, coste_estado: 'confirmado' });
  assert.equal((await f.detalle(lote.id)).totales.efectivo_confirmado, 8000);
  await f.run("INSERT INTO fin_conceptos (tipo,nombre,position,created_by,created_at) VALUES ('ingreso','Cambio ficticio',99,'qa','2026-11-01')");
  const concepto = await f.DB.prepare("SELECT id FROM fin_conceptos WHERE nombre='Cambio ficticio'").first();
  await f.run("UPDATE fin_movimientos SET tipo='ingreso',concepto_id=? WHERE id=?", concepto.id, mid);
  const d = await f.detalle(lote.id);
  assert.equal(d.totales.total_salidas, 0);
  assert.equal(d.totales.efectivo_confirmado, 0);
  assert.equal(d.fuentes.length, 1);
  assert.ok(f.codigos(d).includes('fuentes_anuladas'));
  assert.equal(d.estado, 'abierta');
});
