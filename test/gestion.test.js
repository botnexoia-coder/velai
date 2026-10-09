// Administración financiera: handlers reales sobre SQLite real (todas las migraciones,
// 0050 incluida) y un bucket privado simulado. Importes ficticios y redondos; ningún
// dato bancario ni archivo real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { HttpError } from '../worker/app.js';
import { gestion } from '../worker/routes/gestion.js';
import { finanzas } from '../worker/routes/finanzas.js';
import { calendario, sumarMeses, interesMensual, nombreSeguro, verificarAdjuntoFactura, validarCalendario } from '../worker/gestion-financiera.js';
import { sqliteD1 } from './helpers/sqlite-d1.js';

const SOCIO = { role: 'velai', tenantId: null, email: 'uno@velai.test' };
const ctx = { waitUntil() {} };
const error = (status, code) => (e) => e.status === status && e.code === code;
const nuevo = () => crypto.randomUUID();
const bytesDe = (firma = '%PDF-1.7', size = 64) => { const b = new Uint8Array(size); b.set(new TextEncoder().encode(firma)); return b; };
// Mismo molde que adminRouter: el scope llega inyectado, los errores salen lanzados.
const INYECTADO = new WeakMap();
const app = new Hono();
app.use('*', async (c, next) => { c.set('scope', INYECTADO.get(c.req.raw)); c.set('config', {}); await next(); });
app.route('/', gestion);
app.route('/', finanzas);
app.notFound(() => { throw new HttpError(404, 'not_found'); });
app.onError((e) => { throw e; });

// Préstamo de ejemplo: 12.000 € a 12 meses al 12 % TIN (1 % mensual), cuota 1.066,19 €.
const PRESTAMO = { nombre: 'Préstamo ejemplo', principal: 1200000, apertura: 12000, cuota: 106619, tin_bp: 1200, tae_bp: 1268, meses: 12, reserva_cuotas: 3, primer_vencimiento: '2026-01-31',
  condiciones: [{ concepto: 'TIN', valor: '12,00 %', fuente: 'oferta vinculante' }] };

async function fixture(t, options = {}) {
  const DB = await sqliteD1(options); t.after(() => DB.close());
  await DB.exec('PRAGMA foreign_keys=ON;');
  await DB.exec("DELETE FROM fin_socios; INSERT INTO fin_socios (email,nombre) VALUES ('uno@velai.test','Uno'),('dos@velai.test','Dos');");
  const objects = new Map();
  const env = { DB, SOCIOS_EMAILS: 'uno@velai.test', FINANCE_DOCS: {
    async put(key, bytes, options) { objects.set(key, { bytes: new Uint8Array(bytes), contentType: options.httpMetadata.contentType }); },
    async get(key) { const r = objects.get(key); return r ? { body: r.bytes, httpMetadata: { contentType: r.contentType } } : null; },
    async delete(key) { objects.delete(key); },
  } };
  const call = async (path, method = 'GET', body, scope = SOCIO, headers = {}) => {
    const url = new URL(`https://admin.test/api/admin/${path}`);
    const init = { method, headers: { ...headers } };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const req = new Request(url, init);
    INYECTADO.set(req, scope);
    return app.fetch(req, env, ctx);
  };
  const api = async (...args) => (await call(...args)).json();
  const cuenta = (extra = {}) => api('gestion/cuentas', 'POST', { id: nuevo(), nombre: 'Cuenta operativa', moneda: 'EUR', saldo_inicial: 0, ...extra });
  const prestamo = (cuenta_id, extra = {}) => api('gestion/prestamos', 'POST', { id: nuevo(), cuenta_id, ...PRESTAMO, ...extra });
  const compra = (extra = {}) => api('gestion/compras', 'POST', { id: nuevo(), concepto: 'Equipo de ejemplo', negocio: 'coches', moneda: 'EUR', estimado: 50000, categoria: 'equipamiento', ...extra });
  const legado = () => api('finanzas/resumen');
  const movimientos = async () => (await DB.prepare('SELECT * FROM fin_movimientos ORDER BY created_at, rowid').all()).results;
  const contar = async (tabla, where = '1=1') => (await DB.prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${where}`).first()).n;
  return { DB, env, objects, call, api, cuenta, prestamo, compra, legado, movimientos, contar };
}

test('cada ruta de gestión cierra a no-socios antes de tocar D1 o el bucket privado', async (t) => {
  const { env, api } = await fixture(t);
  const vigilado = { prepare() { assert.fail('no debe tocar D1'); }, batch() { assert.fail('no debe tocar D1'); } };
  const bucket = { get() { assert.fail('no debe tocar R2'); }, put() { assert.fail('no debe tocar R2'); } };
  const [DB, docs] = [env.DB, env.FINANCE_DOCS];
  env.DB = vigilado; env.FINANCE_DOCS = bucket;
  try {
    for (const scope of [{ ...SOCIO, email: 'intruso@velai.test' }, { ...SOCIO, role: 'cliente', tenantId: 'x' }]) {
      for (const route of gestion.routes) {
        const path = route.path.replace('/api/admin/', '').replace(':id', nuevo()).replace(':pagoId', nuevo());
        await assert.rejects(api(path, route.method, route.method === 'GET' ? undefined : {}, scope), error(403, 'not_authorized'), `${route.method} ${path}`);
      }
    }
  } finally { env.DB = DB; env.FINANCE_DOCS = docs; }
});

test('catálogos y entidades: alta idempotente, activar exige NIF, versión optimista y auditoría', async (t) => {
  const { api, contar, DB } = await fixture(t);
  const id = nuevo();
  const alta = await api('gestion/entidades', 'POST', { id, nombre: 'Promotores ejemplo', tipo: 'promotores' });
  assert.deepEqual(alta, { item: { id, nombre: 'Promotores ejemplo', tipo: 'promotores', nif: null, direccion: null, estado: 'pendiente', version: 1 } });
  // Repetir el POST con el MISMO cuerpo no duplica; con otro cuerpo es 409.
  const repetida = await api('gestion/entidades', 'POST', { id, nombre: 'Promotores ejemplo', tipo: 'promotores' });
  assert.equal(repetida.item.id, id); assert.equal(await contar('g_entidades'), 1);
  await assert.rejects(api('gestion/entidades', 'POST', { id, nombre: 'Otro nombre', tipo: 'promotores' }), error(409, 'idempotencia_conflicto'));
  await assert.rejects(api('gestion/entidades', 'POST', { id: 'no-es-uuid', nombre: 'X', tipo: 'autonomo' }), error(400, 'id_invalido'));
  await assert.rejects(api('gestion/entidades', 'POST', { id: nuevo(), nombre: 'X', tipo: 'autonomo', extra: 1 }), error(400, 'campo_desconocido'));
  // Activar sin identificación fiscal no es posible; el perfil incompleto sigue visible.
  await assert.rejects(api(`gestion/entidades/${id}`, 'PATCH', { version: 1, estado: 'activa' }), error(400, 'nif_requerido'));
  await assert.rejects(api(`gestion/entidades/${id}`, 'PATCH', { estado: 'activa' }), error(400, 'version_requerida'));
  const activa = await api(`gestion/entidades/${id}`, 'PATCH', { version: 1, estado: 'activa', nif: ' b12345678 ' });
  assert.equal(activa.item.estado, 'activa'); assert.equal(activa.item.nif, 'B12345678'); assert.equal(activa.item.version, 2);
  // Versión antigua: 409 sin pisar y sin fila de auditoría fantasma.
  const auditadas = await contar('g_auditoria');
  await assert.rejects(api(`gestion/entidades/${id}`, 'PATCH', { version: 1, nombre: 'Pisado' }), error(409, 'version_conflicto'));
  assert.equal(await contar('g_auditoria'), auditadas);
  assert.equal((await api(`gestion/entidades`)).items[0].nombre, 'Promotores ejemplo');
  await assert.rejects(api(`gestion/entidades/${nuevo()}`, 'PATCH', { version: 1 }), error(404, 'not_found'));
  await assert.rejects(api('gestion/entidades/abc', 'PATCH', { version: 1 }), error(404, 'not_found'));
  const cat = await api('gestion/catalogos');
  assert.deepEqual(cat.negocios, ['velai', 'coches', 'dialogos', 'comun']);
  assert.deepEqual(cat.socios, [{ email: 'dos@velai.test', nombre: 'Dos' }, { email: 'uno@velai.test', nombre: 'Uno' }]);
  assert.equal(cat.entidades.length, 1); assert.deepEqual(cat.cuentas, []);
  // La auditoría es append-only también por debajo del código.
  assert.ok(await contar('g_auditoria') >= 2);
  await assert.rejects(DB.exec("UPDATE g_auditoria SET actor='x'"), /g_auditoria_inmutable/);
  await assert.rejects(DB.exec('DELETE FROM g_auditoria'), /g_auditoria_inmutable/);
});

test('cuentas: moneda, saldo pendiente de conciliar y entidad; cambiar moneda con uso es 409', async (t) => {
  const { api, cuenta, prestamo } = await fixture(t);
  await assert.rejects(cuenta({ moneda: 'USD' }), error(400, 'moneda_invalida'));
  await assert.rejects(cuenta({ conciliada: 1 }), error(400, 'fecha_saldo_requerida'));
  await assert.rejects(cuenta({ saldo_inicial: 10.5 }), error(400, 'saldo_invalido'));
  await assert.rejects(cuenta({ entidad_id: nuevo() }), error(400, 'entidad_invalida'));
  const q = (await cuenta({ saldo_inicial: 100000, fecha_saldo: '2026-01-01', conciliada: 1 })).item;
  assert.equal(q.conciliada, 1);
  const cop = (await cuenta({ nombre: 'Caja COP', moneda: 'COP' })).item;
  assert.deepEqual((await api('gestion/cuentas')).items.map((c) => c.moneda), ['COP', 'EUR']);
  await assert.rejects(prestamo(cop.id), error(400, 'moneda_no_admitida'));
  await prestamo(q.id);
  await assert.rejects(api(`gestion/cuentas/${q.id}`, 'PATCH', { version: 1, moneda: 'COP' }), error(409, 'cuenta_en_uso'));
  const r = await api(`gestion/cuentas/${q.id}`, 'PATCH', { version: 1, conciliada: 0 });
  assert.equal(r.item.conciliada, 0); assert.equal(r.item.version, 2);
  // Sin conciliar, el resumen lo dice: pendiente, no verificado.
  assert.equal((await api('gestion/resumen?moneda=EUR')).cuentas[0].estado_saldo, 'pendiente');
});

test('calendario francés: interés entero por mes, última cuota cierra el principal, fechas con clamping', () => {
  const filas = calendario({ ...PRESTAMO });
  assert.equal(filas.length, 12);
  assert.deepEqual({ ...filas[0], fecha: filas[0].fecha }, { numero: 1, fecha: '2026-01-31', cuota: 106619, interes: 12000, capital: 94619, saldo: 1105381, pagado: 0, capital_pagado: 0, estado: 'pendiente' });
  assert.deepEqual(filas.slice(0, 4).map((f) => f.fecha), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  let saldo = PRESTAMO.principal;
  for (const f of filas) { assert.equal(f.interes, interesMensual(saldo, PRESTAMO.tin_bp)); assert.equal(f.cuota, f.capital + f.interes); saldo -= f.capital; assert.equal(f.saldo, saldo); }
  assert.equal(filas.reduce((s, f) => s + f.capital, 0), PRESTAMO.principal);
  assert.equal(filas.at(-1).saldo, 0); assert.equal(filas.at(-1).capital, 105558); assert.equal(filas.at(-1).cuota, 106614);
  assert.equal(calendario({ ...PRESTAMO, primer_vencimiento: null })[3].fecha, null);
  assert.equal(sumarMeses('2024-01-31', 1), '2024-02-29'); assert.equal(sumarMeses('2026-11-30', 3), '2027-02-28'); assert.equal(sumarMeses('2026-12-15', 1), '2027-01-15');
  assert.throws(() => validarCalendario({ ...PRESTAMO, cuota: 12000 }), error(400, 'cuota_insuficiente'));
  assert.throws(() => validarCalendario({ ...PRESTAMO, cuota: 1200000 }), error(400, 'cuota_excesiva'));
});

test('préstamo: alta sin caja, desembolso único como financiación, pagos con desglose y reverso espejo', async (t) => {
  const { api, cuenta, prestamo, legado, movimientos, contar, DB } = await fixture(t);
  const q = (await cuenta()).item;
  await assert.rejects(prestamo(q.id, { fecha_abono: '2026-01-15' }), error(400, 'usar_desembolso'));
  await assert.rejects(prestamo(q.id, { cuota: 12000 }), error(400, 'cuota_insuficiente'));
  await assert.rejects(prestamo(q.id, { reserva_cuotas: 13 }), error(400, 'reserva_invalida'));
  const p = (await prestamo(q.id)).item;
  assert.equal(p.fecha_abono, null); assert.deepEqual(p.condiciones, PRESTAMO.condiciones); assert.equal(p.version, 1);
  // El alta no toca el libro: ni ingreso, ni gasto, ni caja.
  assert.equal((await movimientos()).length, 0);
  let r = await api(`gestion/prestamos/${p.id}/resumen`);
  assert.equal(r.estado, 'pendiente_desembolso'); assert.equal(r.desembolsado, 0); assert.equal(r.reserva_restante, 0); assert.equal(r.principal_pendiente, 1200000);
  assert.equal(r.calendario.length, 12); assert.equal(r.reserva_inicial, 3 * 106619);
  await assert.rejects(api(`gestion/prestamos/${p.id}/pagos`, 'POST', { id: nuevo(), numero: 1, fecha: '2026-01-31', importe: 106619, capital: 94619, interes: 12000 }), error(409, 'prestamo_sin_desembolso'));

  // Desembolso: la cifra tiene que ser el principal (bruto) o principal − apertura (neto).
  await assert.rejects(api(`gestion/prestamos/${p.id}/desembolso`, 'POST', { id: nuevo(), fecha: '2026-01-15', importe: 1000000, apertura: 12000 }), error(400, 'desembolso_no_coincide'));
  const dId = nuevo();
  const d = await api(`gestion/prestamos/${p.id}/desembolso`, 'POST', { id: dId, fecha: '2026-01-15', importe: 1188000, apertura: 12000 });
  assert.equal(d.item.fecha_abono, '2026-01-15'); assert.equal(d.resumen.desembolsado, 1200000); assert.equal(d.resumen.estado, 'vigente'); assert.equal(d.resumen.reserva_restante, 319857);
  let movs = await movimientos();
  assert.deepEqual(movs.map((m) => [m.tipo, m.naturaleza, m.importe, m.signo, m.origen_tipo, m.cuenta_id]),
    [['ingreso', 'financiacion', 1200000, 1, 'prestamo_desembolso', q.id], ['gasto', 'financiero', 12000, 1, 'prestamo_desembolso', q.id]]);
  // Repetir el mismo desembolso no duplica; otro id es 409; otro cuerpo con el mismo id es 409.
  await api(`gestion/prestamos/${p.id}/desembolso`, 'POST', { id: dId, fecha: '2026-01-15', importe: 1188000, apertura: 12000 });
  await assert.rejects(api(`gestion/prestamos/${p.id}/desembolso`, 'POST', { id: nuevo(), fecha: '2026-01-15', importe: 1200000, apertura: 12000 }), error(409, 'ya_desembolsado'));
  await assert.rejects(api(`gestion/prestamos/${p.id}/desembolso`, 'POST', { id: dId, fecha: '2026-01-16', importe: 1188000, apertura: 12000 }), error(409, 'idempotencia_conflicto'));
  assert.equal((await movimientos()).length, 2);
  // Libro legado: la financiación no es venta ni beneficio, pero sí caja; la apertura es gasto.
  let l = await legado();
  assert.deepEqual(l.monedas.EUR, { ingresos: 0, gastos: 12000, egresos: 0, beneficio: -12000, caja: 1188000, sin_repartir: -12000 });
  assert.deepEqual(l.financiacion.EUR, { entradas: 1200000, salidas: 0, neto: 1200000 });
  // Con el abono confirmado, principal y cuenta ya son hechos.
  await assert.rejects(api(`gestion/prestamos/${p.id}`, 'PATCH', { version: 2, principal: 1 }), error(409, 'prestamo_desembolsado'));

  // Pago de la cuota 1: desglose que cuadra, sin sobrepagar la cuota ni el principal.
  const pago = (b) => api(`gestion/prestamos/${p.id}/pagos`, 'POST', { id: nuevo(), numero: 1, fecha: '2026-01-31', importe: 106619, capital: 94619, interes: 12000, ...b });
  await assert.rejects(pago({ importe: 106618 }), error(400, 'desglose_no_cuadra'));
  await assert.rejects(pago({ capital: 1200001, importe: 1212001 }), error(400, 'capital_excede_principal'));
  await assert.rejects(pago({ capital: 94620, importe: 106620 }), error(400, 'cuota_sobrepagada'));
  await assert.rejects(pago({ fecha: '2026-01-10' }), error(400, 'fecha_anterior_al_abono'));
  await assert.rejects(pago({ numero: 13 }), error(400, 'numero_invalido'));
  const pagoId = nuevo();
  const pg = await pago({ id: pagoId, nota: 'Cargo en cuenta' });
  assert.equal(pg.item.estado, 'activo'); assert.equal(pg.item.registrado_por, SOCIO.email);
  assert.equal(pg.resumen.principal_pendiente, 1105381); assert.equal(pg.resumen.pagado_cuotas, 106619); assert.equal(pg.resumen.reserva_restante, 319857 - 106619);
  assert.equal(pg.resumen.calendario[0].estado, 'pagada'); assert.equal(pg.resumen.calendario[0].capital_pagado, 94619); assert.equal(pg.resumen.calendario[1].estado, 'pendiente');
  await assert.rejects(pago({ capital: 1, interes: 0, importe: 1 }), error(400, 'cuota_sobrepagada'));
  movs = await movimientos();
  assert.deepEqual(movs.slice(2).map((m) => [m.tipo, m.naturaleza, m.importe, m.origen_tipo, m.origen_id]), [['egreso', 'financiacion', 94619, 'prestamo_pago', pagoId], ['gasto', 'financiero', 12000, 'prestamo_pago', pagoId]]);
  l = await legado();
  assert.deepEqual(l.monedas.EUR, { ingresos: 0, gastos: 24000, egresos: 0, beneficio: -24000, caja: 1081381, sin_repartir: -24000 });
  assert.deepEqual(l.financiacion.EUR, { entradas: 1200000, salidas: 94619, neto: 1105381 });
  // Pago parcial de la cuota 2 y bloqueo del calendario mientras haya pagos.
  const parcial = await pago({ numero: 2, fecha: '2026-02-28', importe: 50000, capital: 38946, interes: 11054 });
  assert.equal(parcial.resumen.calendario[1].estado, 'parcial'); assert.equal(parcial.resumen.calendario[1].pagado, 50000);
  await assert.rejects(api(`gestion/prestamos/${p.id}`, 'PATCH', { version: parcial.resumen.prestamo.version, cuota: 106620 }), error(409, 'prestamo_con_pagos'));
  const renombrado = await api(`gestion/prestamos/${p.id}`, 'PATCH', { version: parcial.resumen.prestamo.version, nombre: 'Préstamo renombrado', condiciones: [] });
  assert.equal(renombrado.item.nombre, 'Préstamo renombrado'); assert.deepEqual(renombrado.item.condiciones, []); assert.equal(renombrado.item.version, parcial.resumen.prestamo.version + 1);

  // Las partidas de gestión son inmutables desde el panel legado, por código y por trigger.
  const partida = movs[2];
  for (const method of ['PATCH', 'DELETE']) await assert.rejects(api(`finanzas/movimientos/${partida.id}`, method, { importe: 1 }), error(409, 'movimiento_de_gestion'));
  await assert.rejects(DB.prepare("UPDATE fin_movimientos SET nota='x' WHERE id=?").bind(partida.id).run(), /fin_movimiento_gestion/);
  await assert.rejects(DB.prepare('DELETE FROM fin_movimientos WHERE id=?').bind(partida.id).run(), /fin_movimiento_gestion/);
  assert.equal(await contar('fin_movimientos'), 6);

  // Reverso explícito: fila espejo, partidas con signo -1 y el pago marcado; una sola vez.
  const revId = nuevo();
  const rev = await api(`gestion/prestamos/${p.id}/pagos/${pagoId}/revertir`, 'POST', { id: revId, fecha: '2026-02-01', motivo: 'Cargo duplicado por el banco' });
  assert.equal(rev.item.clase, 'reverso'); assert.equal(rev.item.pago_id, pagoId); assert.equal(rev.item.importe, 106619);
  assert.equal(rev.resumen.principal_pendiente, 1200000 - 38946); assert.equal(rev.resumen.calendario[0].estado, 'pendiente'); assert.equal(rev.resumen.calendario[0].pagado, 0);
  assert.equal(rev.resumen.reserva_restante, 319857 - 50000);
  assert.equal(rev.resumen.pagos.find((x) => x.id === pagoId).estado, 'revertido');
  const espejo = (await movimientos()).filter((m) => m.origen_tipo === 'reverso');
  assert.deepEqual(espejo.map((m) => [m.tipo, m.naturaleza, m.importe, m.signo, m.origen_id, m.fecha]), [['egreso', 'financiacion', 94619, -1, revId, '2026-02-01'], ['gasto', 'financiero', 12000, -1, revId, '2026-02-01']]);
  l = await legado();
  assert.deepEqual(l.monedas.EUR, { ingresos: 0, gastos: 12000 + 11054, egresos: 0, beneficio: -(12000 + 11054), caja: 1188000 - 50000, sin_repartir: -(12000 + 11054) });
  assert.deepEqual(l.financiacion.EUR, { entradas: 1200000, salidas: 38946, neto: 1200000 - 38946 });
  await api(`gestion/prestamos/${p.id}/pagos/${pagoId}/revertir`, 'POST', { id: revId, fecha: '2026-02-01', motivo: 'Cargo duplicado por el banco' });
  await assert.rejects(api(`gestion/prestamos/${p.id}/pagos/${pagoId}/revertir`, 'POST', { id: nuevo(), fecha: '2026-02-01', motivo: 'otra vez' }), error(409, 'pago_revertido'));
  await assert.rejects(api(`gestion/prestamos/${p.id}/pagos/${revId}/revertir`, 'POST', { id: nuevo(), fecha: '2026-02-01', motivo: 'reverso del reverso' }), error(404, 'not_found'));
  assert.equal(await contar('g_pagos', "clase='reverso'"), 1);
  // Nada se borra: ni el pago, ni el reverso, ni sus importes se corrigen a mano.
  await assert.rejects(DB.prepare('DELETE FROM g_pagos WHERE id=?').bind(pagoId).run(), /g_pago_inmutable/);
  await assert.rejects(DB.prepare('UPDATE g_pagos SET importe=1 WHERE id=?').bind(revId).run(), /g_pago_inmutable/);
});

test('CSV y listado legados clasifican las partidas de gestión y firman los reversos en negativo', async (t) => {
  const { call, api, cuenta, prestamo } = await fixture(t);
  const q = (await cuenta()).item, p = (await prestamo(q.id)).item;
  await api(`gestion/prestamos/${p.id}/desembolso`, 'POST', { id: nuevo(), fecha: '2026-01-15', importe: 1200000, apertura: 0 });
  const pagoId = nuevo();
  await api(`gestion/prestamos/${p.id}/pagos`, 'POST', { id: pagoId, numero: 1, fecha: '2026-01-31', importe: 106619, capital: 94619, interes: 12000 });
  await api(`gestion/prestamos/${p.id}/pagos/${pagoId}/revertir`, 'POST', { id: nuevo(), fecha: '2026-02-01', motivo: 'error' });
  const text = await (await call('finanzas/export.csv')).text();
  assert.match(text.split('\r\n')[0], /,naturaleza,origen_tipo$/);
  assert.match(text, /"-946\.19"/); assert.match(text, /"-120\.00"/); assert.match(text, /"12000\.00"/); assert.match(text, /"financiacion"/);
  const lista = (await api('finanzas/movimientos')).movimientos;
  assert.equal(lista.length, 5); assert.ok(lista.every((m) => m.origen_tipo && m.naturaleza));
  // Un movimiento manual sigue naciendo 'operativo' y editable, como siempre.
  const conceptos = (await api('finanzas/conceptos')).conceptos;
  const manual = await api('finanzas/movimientos', 'POST', { tipo: 'ingreso', moneda: 'EUR', importe: 5000, fecha: '2026-02-10', concepto_id: conceptos.ingreso[0].id });
  await api(`finanzas/movimientos/${manual.id}`, 'PATCH', { importe: 6000 });
  const r = await api('finanzas/resumen');
  assert.equal(r.monedas.EUR.ingresos, 6000); assert.equal(r.monedas.EUR.caja, 1200000 + 6000);
  // Los conceptos que firman gestión existen con clave estable y salen en el catálogo.
  assert.ok(conceptos.ingreso.some((c) => c.clave === 'g_financiacion'));
  assert.ok(conceptos.gasto.some((c) => c.clave === 'g_financiero') && conceptos.gasto.some((c) => c.clave === 'g_compra'));
  assert.ok(conceptos.egreso.some((c) => c.clave === 'g_capital') && conceptos.egreso.some((c) => c.clave === 'g_reembolso_socio'));
});

test('un fallo en la segunda partida revierte el pago entero: ni g_pagos, ni caja, ni idempotencia', async (t) => {
  const { api, cuenta, prestamo, contar, DB } = await fixture(t);
  const q = (await cuenta()).item, p = (await prestamo(q.id)).item;
  await api(`gestion/prestamos/${p.id}/desembolso`, 'POST', { id: nuevo(), fecha: '2026-01-15', importe: 1200000, apertura: 12000 });
  await DB.exec("CREATE TRIGGER fallo_partida BEFORE INSERT ON fin_movimientos WHEN NEW.importe=777 BEGIN SELECT RAISE(ABORT,'fallo deliberado'); END;");
  const id = nuevo();
  await assert.rejects(api(`gestion/prestamos/${p.id}/pagos`, 'POST', { id, numero: 1, fecha: '2026-01-31', importe: 94619 + 777, capital: 94619, interes: 777 }), /fallo deliberado/);
  assert.equal(await contar('g_pagos'), 0); assert.equal(await contar('fin_movimientos'), 2); assert.equal(await contar('g_idempotencia', `clave='${id}'`), 0);
  assert.equal(await contar('g_auditoria', "accion='prestamo_pago'"), 0);
  await DB.exec('DROP TRIGGER fallo_partida;');
  // Y el mismo id, ya sin fallo, entra limpio (no quedó una idempotencia a medias).
  const ok = await api(`gestion/prestamos/${p.id}/pagos`, 'POST', { id, numero: 1, fecha: '2026-01-31', importe: 94619 + 777, capital: 94619, interes: 777 });
  assert.equal(ok.item.id, id); assert.equal(await contar('fin_movimientos'), 4);
});

test('dos POST simultáneos con el mismo id crean UNA fila y los dos reciben el mismo item', async (t) => {
  const { api, contar } = await fixture(t);
  const id = nuevo(), body = { id, nombre: 'Cuenta carrera', moneda: 'EUR', saldo_inicial: 0 };
  const [a, b] = await Promise.all([api('gestion/cuentas', 'POST', body), api('gestion/cuentas', 'POST', body)]);
  assert.deepEqual(a, b); assert.equal(await contar('g_cuentas'), 1); assert.equal(await contar('g_idempotencia'), 1);
  // El mismo id en OTRA ruta tampoco cuela: la clave es global.
  await assert.rejects(api('gestion/entidades', 'POST', { id, nombre: 'X', tipo: 'autonomo' }), error(409, 'idempotencia_conflicto'));
});

test('compras: compromiso, pago de socio sin caja común, pago de cuenta con UNA salida, compra real y reembolso', async (t) => {
  const { api, cuenta, compra, legado, movimientos, contar } = await fixture(t);
  const q = (await cuenta({ saldo_inicial: 100000 })).item;
  const cop = (await cuenta({ nombre: 'Caja COP', moneda: 'COP' })).item;
  await assert.rejects(compra({ negocio: 'otro' }), error(400, 'negocio_invalido'));
  await assert.rejects(compra({ estado: 'comprada' }), error(400, 'estado_invalido'));
  await assert.rejects(compra({ prestamo_id: nuevo() }), error(400, 'prestamo_invalido'));
  const c = (await compra({ fecha_prevista: '2026-03-01' })).item;
  assert.deepEqual([c.estado, c.estimado, c.real, c.pagado, c.pendiente, c.categoria, c.documentos_count, c.version], ['prevista', 50000, null, 0, 50000, 'equipamiento', 0, 1]);
  const pagar = (b) => api(`gestion/compras/${c.id}/pagos`, 'POST', { id: nuevo(), fecha: '2026-03-01', importe: 10000, pagador: 'cuenta', cuenta_id: q.id, ...b });
  // Prevista no se paga: primero se compromete.
  await assert.rejects(pagar({}), error(409, 'compra_no_comprometida'));
  await assert.rejects(api(`gestion/compras/${c.id}`, 'PATCH', { version: 1, estado: 'comprada' }), error(400, 'usar_comprar'));
  const comprometida = await api(`gestion/compras/${c.id}`, 'PATCH', { version: 1, estado: 'comprometida' });
  assert.equal(comprometida.item.estado, 'comprometida'); assert.equal(comprometida.item.version, 2);
  // Un socio adelanta 300 €: reconocido en la compra, sin salida de caja común.
  await assert.rejects(pagar({ pagador: 'socio', socio: 'nadie@velai.test', cuenta_id: undefined }), error(400, 'socio_desconocido'));
  await assert.rejects(pagar({ pagador: 'socio', socio: 'dos@velai.test' }), error(400, 'pagador_invalido'));
  const anticipoId = nuevo();
  const anticipo = await api(`gestion/compras/${c.id}/pagos`, 'POST', { id: anticipoId, fecha: '2026-03-01', importe: 30000, pagador: 'socio', socio: 'DOS@velai.test' });
  assert.equal(anticipo.item.socio, 'dos@velai.test'); assert.equal(anticipo.compra.pagado, 30000); assert.equal(anticipo.compra.pendiente, 20000);
  assert.equal((await movimientos()).length, 0);
  // La cuenta común paga 100 €: una sola partida, gasto operativo con cuenta.
  await assert.rejects(pagar({ importe: 25000 }), error(400, 'importe_supera_pendiente'));
  await assert.rejects(pagar({ cuenta_id: cop.id }), error(400, 'moneda_distinta'));
  const cuentaPagoId = nuevo();
  const pc = await pagar({ id: cuentaPagoId });
  assert.equal(pc.compra.pagado, 40000); assert.equal(pc.compra.pendiente, 10000);
  let movs = await movimientos();
  assert.deepEqual(movs.map((m) => [m.tipo, m.naturaleza, m.importe, m.origen_tipo, m.cuenta_id]), [['gasto', 'compra', 10000, 'compra_pago', q.id]]);
  let l = await legado(); assert.equal(l.monedas.EUR.gastos, 0); assert.equal(l.monedas.EUR.caja, -10000);
  // Comprar fija el precio real y libera el compromiso; no puede ser menor que lo pagado.
  await assert.rejects(api(`gestion/compras/${c.id}/comprar`, 'POST', { version: pc.compra.version, real: 30000, fecha: '2026-03-02' }), error(400, 'real_inferior_a_pagado'));
  const comprada = await api(`gestion/compras/${c.id}/comprar`, 'POST', { version: pc.compra.version, real: 60000, fecha: '2026-03-02', comprador: 'Uno', proveedor: 'Proveedor ejemplo' });
  assert.deepEqual([comprada.item.estado, comprada.item.real, comprada.item.fecha_compra, comprada.item.comprador, comprada.item.pendiente, comprada.item.version], ['comprada', 60000, '2026-03-02', 'Uno', 20000, pc.compra.version + 1]);
  await assert.rejects(api(`gestion/compras/${c.id}/comprar`, 'POST', { version: comprada.item.version, real: 60000, fecha: '2026-03-02' }), error(409, 'compra_cerrada'));
  // Comprada: metadatos sí; importes, moneda y estado no.
  await assert.rejects(api(`gestion/compras/${c.id}`, 'PATCH', { version: comprada.item.version, estimado: 1 }), error(409, 'compra_cerrada'));
  await assert.rejects(api(`gestion/compras/${c.id}`, 'PATCH', { version: comprada.item.version, estado: 'cancelada' }), error(409, 'compra_cerrada'));
  await assert.rejects(api(`gestion/compras/${c.id}`, 'PATCH', { version: comprada.item.version, real: 1 }), error(400, 'campo_no_editable'));
  const nota = await api(`gestion/compras/${c.id}`, 'PATCH', { version: comprada.item.version, nota: 'Falta la factura del proveedor', proveedor: 'Proveedor corregido' });
  assert.equal(nota.item.nota, 'Falta la factura del proveedor'); assert.equal(nota.item.real, 60000); assert.equal(nota.item.version, comprada.item.version + 1);
  // Reembolso parcial al socio desde caja: UNA salida clasificada, sin segundo gasto.
  const reembolsar = (b) => api(`gestion/compras/${c.id}/reembolsos`, 'POST', { id: nuevo(), pago_id: anticipoId, cuenta_id: q.id, fecha: '2026-03-05', importe: 20000, ...b });
  await assert.rejects(reembolsar({ pago_id: cuentaPagoId }), error(400, 'pago_no_es_anticipo'));
  await assert.rejects(reembolsar({ importe: 30001 }), error(400, 'reembolso_supera_anticipo'));
  await assert.rejects(reembolsar({ cuenta_id: cop.id }), error(400, 'moneda_distinta'));
  const re = await reembolsar({});
  assert.equal(re.item.clase, 'reembolso'); assert.equal(re.compra.pagado, 40000);
  await assert.rejects(reembolsar({ importe: 10001 }), error(400, 'reembolso_supera_anticipo'));
  movs = await movimientos();
  assert.deepEqual(movs.at(-1) && [movs.at(-1).tipo, movs.at(-1).naturaleza, movs.at(-1).importe, movs.at(-1).origen_tipo], ['egreso', 'reembolso_socio', 20000, 'compra_reembolso']);
  l = await legado(); assert.deepEqual(l.monedas.EUR, { ingresos: 0, gastos: 0, egresos: 20000, beneficio: 0, caja: -30000, sin_repartir: -30000 });
  // Un anticipo con reembolsos no se revierte; el pago de cuenta sí, con su espejo.
  await assert.rejects(api(`gestion/compras/${c.id}/pagos/${anticipoId}/revertir`, 'POST', { id: nuevo(), fecha: '2026-03-06', motivo: 'x' }), error(409, 'pago_con_reembolsos'));
  const rev = await api(`gestion/compras/${c.id}/pagos/${cuentaPagoId}/revertir`, 'POST', { id: nuevo(), fecha: '2026-03-06', motivo: 'Cargo devuelto' });
  assert.equal(rev.compra.pagado, 30000); assert.equal(rev.compra.pendiente, 30000);
  l = await legado(); assert.equal(l.monedas.EUR.gastos, 0); assert.equal(l.monedas.EUR.caja, -20000);
  assert.equal(await contar('fin_movimientos'), 3);
  // Resumen: saldos por cuenta, por negocio y por socio; previsto aparte de comprometido.
  const prevista = (await compra({ negocio: 'velai', estimado: 7000 })).item;
  const r = await api('gestion/resumen?moneda=EUR');
  const cuentaR = r.cuentas.find((x) => x.id === q.id);
  assert.deepEqual([cuentaR.saldo, cuentaR.reserva, cuentaR.disponible, cuentaR.estado_saldo], [100000 - 20000, 0, 80000, 'pendiente']);
  assert.deepEqual(r.compras.por_negocio.find((n) => n.negocio === 'coches'), { negocio: 'coches', previsto: 0, comprometido: 0, comprado: 60000, pagado: 30000, pendiente: 30000 });
  assert.deepEqual(r.compras.por_negocio.find((n) => n.negocio === 'velai'), { negocio: 'velai', previsto: 7000, comprometido: 0, comprado: 0, pagado: 0, pendiente: 0 });
  assert.deepEqual(r.socios, [{ email: 'dos@velai.test', nombre: 'Dos', adelantado: 30000, reembolsado: 20000, saldo: 10000 }]);
  assert.equal(r.totales.compromisos_pendientes, 30000); assert.equal(r.totales.previsto, 7000); assert.equal(r.totales.saldo_socios, 10000);
  assert.equal(r.totales.disponible_tras_compromisos, 80000 - 30000 - 10000);
  assert.equal((await api('gestion/resumen?moneda=COP')).cuentas.length, 1);
  // Cancelar libera el compromiso sin borrar: solo sin pagos vivos.
  const cancelada = await api(`gestion/compras/${prevista.id}`, 'PATCH', { version: 1, estado: 'cancelada' });
  assert.equal(cancelada.item.estado, 'cancelada'); assert.equal(cancelada.item.pendiente, 0);
  await assert.rejects(api(`gestion/compras/${prevista.id}`, 'PATCH', { version: 2, nota: 'x' }), error(409, 'compra_cancelada'));
  assert.equal((await api('gestion/compras?estado=cancelada')).items.length, 1);
  assert.equal((await api('gestion/compras?negocio=coches')).items[0].id, c.id);
  await assert.rejects(api('gestion/compras?estado=rara'), error(400, 'estado_invalido'));
  assert.equal((await api(`gestion/compras/${c.id}`)).item.pagado, 30000);
  await assert.rejects(api(`gestion/compras/${nuevo()}`), error(404, 'not_found'));
});

test('resumen: la reserva de cuotas se resta UNA vez del disponible y solo con el abono confirmado', async (t) => {
  const { api, cuenta, prestamo } = await fixture(t);
  const q = (await cuenta({ saldo_inicial: 50000 })).item;
  const p = (await prestamo(q.id)).item;
  let r = await api('gestion/resumen');
  assert.deepEqual([r.cuentas[0].saldo, r.cuentas[0].reserva, r.cuentas[0].disponible], [50000, 0, 50000]);
  assert.deepEqual(r.prestamos[0], { id: p.id, nombre: p.nombre, cuenta_id: q.id, estado: 'pendiente_desembolso', principal: 1200000, desembolsado: 0, principal_pendiente: 1200000, reserva_inicial: 319857, reserva_restante: 0, pagado_cuotas: 0 });
  assert.equal(r.totales.deuda_pendiente, 0); assert.equal(r.totales.deuda_sin_desembolsar, 1200000);
  await api(`gestion/prestamos/${p.id}/desembolso`, 'POST', { id: nuevo(), fecha: '2026-01-15', importe: 1200000, apertura: 12000 });
  r = await api('gestion/resumen');
  assert.deepEqual([r.cuentas[0].saldo, r.cuentas[0].reserva, r.cuentas[0].disponible], [50000 + 1200000 - 12000, 319857, 50000 + 1200000 - 12000 - 319857]);
  assert.deepEqual([r.totales.saldo, r.totales.reservas, r.totales.disponible, r.totales.deuda_pendiente], [1238000, 319857, 1238000 - 319857, 1200000]);
  await api(`gestion/prestamos/${p.id}/pagos`, 'POST', { id: nuevo(), numero: 1, fecha: '2026-01-31', importe: 106619, capital: 94619, interes: 12000 });
  r = await api('gestion/resumen');
  // El pago sale de la cuenta y consume reserva: no se resta dos veces.
  assert.deepEqual([r.cuentas[0].saldo, r.cuentas[0].reserva, r.cuentas[0].disponible], [1238000 - 106619, 319857 - 106619, 1238000 - 319857]);
  assert.equal(r.prestamos[0].principal_pendiente, 1105381);
});

test('documentos privados: multipart validado por bytes, clave propia, descarga protegida, dedupe y limpieza', async (t) => {
  const { api, call, cuenta, prestamo, objects, env, DB, contar } = await fixture(t);
  const q = (await cuenta()).item, p = (await prestamo(q.id)).item;
  const subir = (campos = {}, bytes = bytesDe(), headers = {}) => {
    const form = new FormData();
    const todos = { id: nuevo(), tipo: 'prestamo', objeto_id: p.id, clase: 'contrato', nombre: 'Contrato préstamo ñ.PDF', ...campos };
    for (const [k, v] of Object.entries(todos)) if (v != null) form.set(k, v);
    form.set('archivo', new File([bytes], 'subida.bin', { type: 'application/octet-stream' }));
    return call('gestion/documentos', 'POST', form, SOCIO, headers);
  };
  const docId = nuevo();
  const r = await (await subir({ id: docId })).json();
  assert.deepEqual([r.item.id, r.item.nombre, r.item.mime, r.item.ext, r.item.bytes, r.item.version, r.item.autor, r.item.clase], [docId, 'Contrato-prestamo-n.pdf', 'application/pdf', 'pdf', 64, 1, SOCIO.email, 'contrato']);
  assert.equal(r.item.key, undefined); assert.match(r.item.sha256, /^[0-9a-f]{64}$/);
  assert.equal(objects.size, 1);
  assert.ok([...objects.keys()][0].startsWith(`gestion/prestamo/${p.id}/${docId}/`));
  // Listado por propietario; el bucket listo se informa.
  const lista = await api(`gestion/documentos?tipo=prestamo&objeto_id=${p.id}`);
  assert.equal(lista.items.length, 1); assert.equal(lista.storage_ready, true); assert.equal(lista.items[0].key, undefined);
  await assert.rejects(api('gestion/documentos?objeto_id=' + p.id), error(400, 'tipo_invalido'));
  // Descarga: por id, nunca por clave; no-store, nosniff, sandbox; inline o adjunto.
  const inline = await call(`gestion/documentos/${docId}/archivo`);
  assert.equal(inline.status, 200); assert.equal(inline.headers.get('Content-Type'), 'application/pdf'); assert.equal(inline.headers.get('Cache-Control'), 'no-store');
  assert.equal(inline.headers.get('X-Content-Type-Options'), 'nosniff'); assert.equal(inline.headers.get('Content-Security-Policy'), "default-src 'none'; sandbox");
  assert.equal(inline.headers.get('Content-Disposition'), 'inline; filename="Contrato-prestamo-n.pdf"'); assert.equal(inline.headers.get('Content-Length'), '64');
  assert.equal((await call(`gestion/documentos/${docId}/archivo?descargar=1`)).headers.get('Content-Disposition'), 'attachment; filename="Contrato-prestamo-n.pdf"');
  await assert.rejects(call(`gestion/documentos/${nuevo()}/archivo`), error(404, 'not_found'));
  await assert.rejects(call(`gestion/documentos/gestion%2Fprestamo%2Fx.pdf/archivo`), error(404, 'not_found'));
  // Mismo archivo para el mismo propietario: no se guarda otra copia.
  const dup = await (await subir({ id: nuevo() })).json();
  assert.equal(dup.duplicado, true); assert.equal(dup.item.id, docId); assert.equal(objects.size, 1);
  // Mismo id y mismos campos: repetición; mismo id con otra clase: 409.
  assert.equal((await (await subir({ id: docId })).json()).item.id, docId);
  await assert.rejects(subir({ id: docId, clase: 'anexo' }), error(409, 'idempotencia_conflicto'));
  // Otro archivo con el mismo nombre y clase: versión 2 del mismo documento.
  const v2 = await (await subir({ id: nuevo() }, bytesDe('%PDF-1.7 segunda'))).json();
  assert.equal(v2.item.version, 2); assert.equal(objects.size, 2);
  // Formato por bytes y tamaño: HTML camuflado, GIF, vacío y >10 MiB se rechazan sin escribir.
  await assert.rejects(subir({ id: nuevo() }, bytesDe('<html>%PDF-')), error(400, 'formato_invalido'));
  await assert.rejects(subir({ id: nuevo() }, bytesDe('GIF89a')), error(400, 'formato_invalido'));
  await assert.rejects(subir({ id: nuevo() }, new Uint8Array(0)), error(400, 'archivo_vacio'));
  await assert.rejects(subir({ id: nuevo() }, bytesDe(), { 'Content-Length': String(11 * 1024 * 1024) }), error(413, 'archivo_demasiado_grande'));
  const grande = new Uint8Array(10 * 1024 * 1024 + 1); grande.set([137, 80, 78, 71, 13, 10, 26, 10]);
  await assert.rejects(subir({ id: nuevo() }, grande), error(413, 'archivo_demasiado_grande'));
  await assert.rejects(subir({ id: nuevo(), clase: 'Mal Clase' }), error(400, 'clase_invalida'));
  await assert.rejects(subir({ id: nuevo(), objeto_id: nuevo() }), error(404, 'not_found'));
  await assert.rejects(subir({ id: nuevo(), tipo: 'otro' }), error(400, 'tipo_invalido'));
  await assert.rejects(call('gestion/documentos', 'POST', { id: nuevo() }), error(415, 'unsupported_media_type'));
  assert.equal(objects.size, 2); assert.equal(await contar('g_documentos'), 2);
  // Un PNG real se acepta y recibe su extensión aunque el nombre diga otra cosa.
  const png = new Uint8Array(64); png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const foto = await (await subir({ id: nuevo(), clase: 'foto', nombre: '../../etc/passwd.exe' }, png)).json();
  assert.equal(foto.item.nombre, 'etc-passwd.png'); assert.equal(foto.item.mime, 'image/png');
  // Si D1 falla tras subir, se borra SOLO el objeto nuevo; los anteriores siguen.
  await DB.exec("CREATE TRIGGER fallo_doc BEFORE INSERT ON g_documentos BEGIN SELECT RAISE(ABORT,'fallo deliberado'); END;");
  await assert.rejects(subir({ id: nuevo(), clase: 'otro' }, bytesDe('%PDF-1.7 tercera')), error(503, 'documento_no_guardado'));
  assert.equal(objects.size, 3); assert.equal(await contar('g_documentos'), 3);
  await DB.exec('DROP TRIGGER fallo_doc;');
  // Sin binding: 503 claro para subir y para servir; el listado sigue funcionando.
  delete env.FINANCE_DOCS;
  await assert.rejects(subir({ id: nuevo() }), error(503, 'finance_docs_not_configured'));
  await assert.rejects(call(`gestion/documentos/${docId}/archivo`), error(503, 'finance_docs_not_configured'));
  assert.equal((await api(`gestion/documentos?tipo=prestamo&objeto_id=${p.id}`)).storage_ready, false);
  assert.equal(nombreSeguro('', 'pdf'), 'documento.pdf'); assert.equal(nombreSeguro('a'.repeat(100) + '.jpg', 'jpg').length, 64);
});

test('adjuntos de factura: sin tabla g_facturas no existe el objeto; con ella, el helper informa del estado', async (t) => {
  const { env, DB, call, api } = await fixture(t, { through: '0050' });
  const facturaId = nuevo();
  const subir = () => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ id: nuevo(), tipo: 'factura', objeto_id: facturaId, clase: 'original', nombre: 'factura.pdf' })) form.set(k, v);
    form.set('archivo', new File([bytesDe()], 'factura.pdf'));
    return call('gestion/documentos', 'POST', form);
  };
  assert.deepEqual(await verificarAdjuntoFactura(env, facturaId), { estado: 'not_found', documentos: 0 });
  assert.deepEqual(await verificarAdjuntoFactura(env, 'no-uuid'), { estado: 'not_found', documentos: 0 });
  await assert.rejects(subir(), error(404, 'not_found'));
  assert.deepEqual((await api(`gestion/documentos?tipo=factura&objeto_id=${facturaId}`)).items, []);
  // El módulo fiscal creará la tabla en su migración: aquí se simula lo mínimo.
  await DB.exec(`CREATE TABLE g_facturas (id TEXT PRIMARY KEY); INSERT INTO g_facturas (id) VALUES ('${facturaId}');`);
  assert.deepEqual(await verificarAdjuntoFactura(env, facturaId), { estado: 'sin_adjunto', documentos: 0 });
  assert.equal((await subir()).status, 201);
  assert.deepEqual(await verificarAdjuntoFactura(env, facturaId.toUpperCase()), { estado: 'adjunta', documentos: 1 });
  assert.deepEqual(await verificarAdjuntoFactura(env, nuevo()), { estado: 'not_found', documentos: 0 });
});

test('pagos completos y reversos conservan idempotencia aunque ya no quede saldo pendiente', async (t) => {
  const { api, cuenta, prestamo, compra, contar } = await fixture(t);
  const q = (await cuenta()).item;
  const p = (await prestamo(q.id, { principal: 10000, cuota: 10000, apertura: 0, tin_bp: 0, tae_bp: 0, meses: 1, reserva_cuotas: 1 })).item;
  const d = { id: nuevo(), fecha: '2026-01-01', importe: 10000, apertura: 0 };
  await api(`gestion/prestamos/${p.id}/desembolso`, 'POST', d);
  const pago = { id: nuevo(), numero: 1, fecha: '2026-01-31', importe: 10000, capital: 10000, interes: 0 };
  const path = `gestion/prestamos/${p.id}/pagos`;
  const [a, b] = await Promise.all([api(path, 'POST', pago), api(path, 'POST', pago)]);
  assert.equal(a.item.id, b.item.id);
  assert.equal((await api(path, 'POST', pago)).item.id, pago.id);
  await assert.rejects(api(path, 'POST', { ...pago, importe: 9999, capital: 9999 }), error(409, 'idempotencia_conflicto'));
  const reverso = { id: nuevo(), fecha: '2026-02-01', motivo: 'Corrección de ejemplo' };
  const revpath = `${path}/${pago.id}/revertir`;
  await Promise.all([api(revpath, 'POST', reverso), api(revpath, 'POST', reverso)]);
  assert.equal((await api(path, 'POST', pago)).item.estado, 'revertido');
  assert.equal(await contar('g_pagos'), 2);
  const c = (await compra({ estado: 'comprometida', estimado: 10000 })).item;
  const cp = { id: nuevo(), fecha: '2026-02-01', importe: 10000, pagador: 'cuenta', cuenta_id: q.id };
  const cpPath = `gestion/compras/${c.id}/pagos`;
  await Promise.all([api(cpPath, 'POST', cp), api(cpPath, 'POST', cp)]);
  assert.equal((await api(cpPath, 'POST', cp)).compra.pagado, 10000);
  await assert.rejects(api(cpPath, 'POST', { ...cp, importe: 1 }), error(409, 'idempotencia_conflicto'));
  assert.equal(await contar('g_pagos'), 3);
});

test('dos UUID distintos nunca sobrepagan compra, cuota, principal ni anticipo', async (t) => {
  const { api, cuenta, prestamo, compra, contar } = await fixture(t);
  const q = (await cuenta()).item;
  const unoGana = async (path, body) => {
    const responses = await Promise.allSettled([api(path, 'POST', { ...body, id: nuevo() }), api(path, 'POST', { ...body, id: nuevo() })]);
    assert.equal(responses.filter((r) => r.status === 'fulfilled').length, 1);
    assert.ok([400, 409].includes(responses.find((r) => r.status === 'rejected').reason.status));
  };
  const c = (await compra({ estado: 'comprometida', estimado: 10000 })).item;
  await unoGana(`gestion/compras/${c.id}/pagos`, { fecha: '2026-01-01', importe: 7000, pagador: 'cuenta', cuenta_id: q.id });
  assert.equal((await api(`gestion/compras/${c.id}`)).item.pagado, 7000);
  const p = (await prestamo(q.id, { principal: 10000, cuota: 10000, apertura: 0, tin_bp: 0, tae_bp: 0, meses: 1, reserva_cuotas: 1 })).item;
  await unoGana(`gestion/prestamos/${p.id}/desembolso`, { fecha: '2026-01-01', importe: 10000, apertura: 0 });
  await unoGana(`gestion/prestamos/${p.id}/pagos`, { numero: 1, fecha: '2026-01-31', importe: 7000, capital: 7000, interes: 0 });
  const rp = await api(`gestion/prestamos/${p.id}/resumen`);
  assert.equal(rp.calendario[0].pagado, 7000); assert.equal(rp.principal_pendiente, 3000);
  const cs = (await compra({ estado: 'comprometida', estimado: 10000 })).item;
  const anticipo = { id: nuevo(), fecha: '2026-01-01', importe: 10000, pagador: 'socio', socio: SOCIO.email };
  await api(`gestion/compras/${cs.id}/pagos`, 'POST', anticipo);
  await unoGana(`gestion/compras/${cs.id}/reembolsos`, { pago_id: anticipo.id, cuenta_id: q.id, fecha: '2026-01-02', importe: 7000 });
  assert.equal((await api('gestion/resumen')).socios[0].saldo, 3000);
  assert.equal(await contar('g_pagos'), 4);
  // No quedan idempotencias del perdedor de ninguna operación.
  assert.equal(await contar('g_idempotencia'), 9); // cuenta, 2 compras, préstamo, abono y 4 pagos
});

test('revertir reembolso restaura anticipo, caja e historial; el disponible no cambia dos veces', async (t) => {
  const { api, cuenta, compra, contar, movimientos } = await fixture(t);
  const q = (await cuenta({ saldo_inicial: 20000 })).item;
  const c = (await compra({ estado: 'comprometida', estimado: 10000 })).item;
  const p = { id: nuevo(), fecha: '2026-01-01', importe: 10000, pagador: 'socio', socio: SOCIO.email };
  await api(`gestion/compras/${c.id}/pagos`, 'POST', p);
  let r = await api('gestion/resumen');
  assert.equal(r.totales.disponible_tras_compromisos, 10000);
  const re = { id: nuevo(), pago_id: p.id, cuenta_id: q.id, fecha: '2026-01-02', importe: 10000 };
  await Promise.all([api(`gestion/compras/${c.id}/reembolsos`, 'POST', re), api(`gestion/compras/${c.id}/reembolsos`, 'POST', re)]);
  await api(`gestion/compras/${c.id}/reembolsos`, 'POST', re);
  assert.equal(await contar('g_pagos'), 2);
  assert.equal((await api('gestion/resumen')).totales.saldo_socios, 0);
  const body = { id: nuevo(), fecha: '2026-01-03', motivo: 'Se cargó una cuenta equivocada' };
  const path = `gestion/compras/${c.id}/pagos/${re.id}/revertir`;
  await api(path, 'POST', body); await api(path, 'POST', body);
  r = await api('gestion/resumen');
  assert.equal(r.totales.saldo_socios, 10000); assert.equal(r.totales.saldo, 20000);
  assert.equal(r.totales.disponible_tras_compromisos, 10000);
  const historial = (await api(`gestion/compras/${c.id}/pagos`)).items;
  assert.equal(historial.length, 3); assert.equal(historial.find((x) => x.id === re.id).estado, 'revertido');
  assert.equal((await movimientos()).reduce((n, x) => n + x.importe * x.signo, 0), 0);
  // Después del reverso puede volver a reembolsarse con otra operación.
  await api(`gestion/compras/${c.id}/reembolsos`, 'POST', { ...re, id: nuevo() });
  assert.equal((await api('gestion/resumen')).totales.saldo_socios, 0);
});

test('carrera entre reembolso y reverso del anticipo no deja dinero devuelto de un pago anulado', async (t) => {
  const { api, cuenta, compra } = await fixture(t);
  const q = (await cuenta()).item, c = (await compra({ estado: 'comprometida', estimado: 10000 })).item;
  const p = { id: nuevo(), fecha: '2026-01-01', importe: 10000, pagador: 'socio', socio: SOCIO.email };
  await api(`gestion/compras/${c.id}/pagos`, 'POST', p);
  const result = await Promise.allSettled([
    api(`gestion/compras/${c.id}/reembolsos`, 'POST', { id: nuevo(), pago_id: p.id, cuenta_id: q.id, fecha: '2026-01-02', importe: 7000 }),
    api(`gestion/compras/${c.id}/pagos/${p.id}/revertir`, 'POST', { id: nuevo(), fecha: '2026-01-02', motivo: 'Corrección' }),
  ]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  const rows = (await api(`gestion/compras/${c.id}/pagos`)).items;
  assert.ok(!(rows.find((x) => x.id === p.id).estado === 'revertido' && rows.some((x) => x.clase === 'reembolso' && x.estado === 'activo')));
});

// Inject a competing mutation after JS validation but before the original batch.
function antesDelBatch(t, env, match, mutation) {
  const original = env.DB.batch;
  let invoked = false;
  env.DB.batch = async (statements) => {
    if (!invoked && statements.some(match)) { invoked = true; await mutation(); }
    return original(statements);
  };
  t.after(() => { env.DB.batch = original; });
  return () => invoked;
}

test('desembolso no usa principal ni cuenta obsoletos si otra edición gana justo antes del batch', async (t) => {
  const { api, cuenta, prestamo, env, contar } = await fixture(t);
  const q = (await cuenta()).item, p = (await prestamo(q.id)).item;
  const disparado = antesDelBatch(t, env, (s) => s.sql.startsWith('INSERT INTO g_idempotencia') && s.args[1].endsWith('/desembolso'),
    () => api(`gestion/prestamos/${p.id}`, 'PATCH', { version: p.version, principal: 1300000 }));
  const d = { id: nuevo(), fecha: '2026-01-01', importe: PRESTAMO.principal, apertura: 0 };
  await assert.rejects(api(`gestion/prestamos/${p.id}/desembolso`, 'POST', d), error(409, 'version_conflicto'));
  assert.equal(disparado(), true); assert.equal(await contar('fin_movimientos'), 0);
  assert.equal(await contar('g_idempotencia', `clave='${d.id}'`), 0);
  assert.equal((await api(`gestion/prestamos/${p.id}`)).item.principal, 1300000);
});

test('pago no usa pendiente antiguo si cancelar o reducir compra gana antes del batch', async (t) => {
  const { api, cuenta, compra, env, contar } = await fixture(t);
  const q = (await cuenta()).item, c = (await compra({ estado: 'comprometida', estimado: 10000 })).item;
  const disparado = antesDelBatch(t, env, (s) => s.sql.startsWith('INSERT INTO g_idempotencia') && s.args[1].endsWith('/pagos'),
    () => api(`gestion/compras/${c.id}`, 'PATCH', { version: c.version, estado: 'cancelada' }));
  await assert.rejects(api(`gestion/compras/${c.id}/pagos`, 'POST', { id: nuevo(), fecha: '2026-01-01', importe: 7000, pagador: 'cuenta', cuenta_id: q.id }), error(409, 'version_conflicto'));
  assert.equal(disparado(), true); assert.equal(await contar('g_pagos'), 0); assert.equal(await contar('fin_movimientos'), 0);
  assert.equal((await api(`gestion/compras/${c.id}`)).item.estado, 'cancelada');
});

test('editar compra no reduce importe por debajo de pagos ni devuelve a prevista una compra pagada', async (t) => {
  const { api, cuenta, compra } = await fixture(t);
  const q = (await cuenta()).item, c = (await compra({ estado: 'comprometida', estimado: 10000 })).item;
  const pagada = (await api(`gestion/compras/${c.id}/pagos`, 'POST', { id: nuevo(), fecha: '2026-01-01', importe: 7000, pagador: 'cuenta', cuenta_id: q.id })).compra;
  await assert.rejects(api(`gestion/compras/${c.id}`, 'PATCH', { version: pagada.version, estimado: 6000 }), error(400, 'estimado_inferior_a_pagado'));
  await assert.rejects(api(`gestion/compras/${c.id}`, 'PATCH', { version: pagada.version, estado: 'prevista' }), error(409, 'compra_con_pagos'));
  assert.equal((await api(`gestion/compras/${c.id}`)).item.pendiente, 3000);
});

test('adjuntos concurrentes conservan siempre bytes del ganador: mismo UUID, distinto UUID y mismo hash', async (t) => {
  const { api, call, compra, objects, contar } = await fixture(t);
  const c = (await compra()).item;
  const subir = (id, firma, clase = 'factura') => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ id, tipo: 'compra', objeto_id: c.id, clase, nombre: 'Prueba.pdf' })) form.set(key, value);
    form.set('archivo', new File([bytesDe(firma)], 'Prueba.pdf'));
    return api('gestion/documentos', 'POST', form);
  };
  const conflictId = nuevo();
  const conflict = await Promise.allSettled([subir(conflictId, '%PDF-1.7 A'), subir(conflictId, '%PDF-1.7 B')]);
  assert.equal(conflict.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(conflict.find((r) => r.status === 'rejected').reason.code, 'idempotencia_conflicto');
  assert.equal(objects.size, 1); assert.equal(await contar('g_documentos'), 1);
  const served = new Uint8Array(await (await call(`gestion/documentos/${conflictId}/archivo`)).arrayBuffer());
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', served)), (b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(hash, conflict.find((r) => r.status === 'fulfilled').value.item.sha256);
  const sameId = nuevo();
  const same = await Promise.all([subir(sameId, '%PDF-1.7 C'), subir(sameId, '%PDF-1.7 C')]);
  assert.equal(same[0].item.id, same[1].item.id); assert.equal(objects.size, 2);
  const aliasIds = [nuevo(), nuevo()];
  const duplicate = await Promise.all(aliasIds.map((id) => subir(id, '%PDF-1.7 D')));
  assert.equal(duplicate[0].item.id, duplicate[1].item.id);
  assert.equal(objects.size, 3); assert.equal(await contar('g_documentos'), 3);
  for (const id of aliasIds) {
    assert.equal((await subir(id, '%PDF-1.7 D')).item.id, duplicate[0].item.id);
    await assert.rejects(subir(id, '%PDF-1.7 archivo cambiado'), error(409, 'idempotencia_conflicto'));
  }
  const metadataId = nuevo();
  const metadata = await Promise.allSettled([subir(metadataId, '%PDF-1.7 E', 'factura'), subir(metadataId, '%PDF-1.7 E', 'contrato')]);
  assert.equal(metadata.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(metadata.find((r) => r.status === 'rejected').reason.code, 'idempotencia_conflicto');
  assert.equal(objects.size, 4);
});

test('movimientos manuales llevan cuenta opcional; preservan NULL histórico y no admiten conceptos internos', async (t) => {
  const { api, cuenta, DB } = await fixture(t);
  const q = (await cuenta({ saldo_inicial: 10000 })).item;
  const cop = (await cuenta({ moneda: 'COP' })).item;
  const conceptos = (await api('finanzas/conceptos')).conceptos;
  const libre = conceptos.ingreso.find((c) => !c.clave);
  const body = { tipo: 'ingreso', importe: 5000, moneda: 'EUR', fecha: '2026-01-01', concepto_id: libre.id };
  const historico = await api('finanzas/movimientos', 'POST', body);
  await api(`finanzas/movimientos/${historico.id}`, 'PATCH', { nota: 'Solo nota' });
  assert.equal((await DB.prepare('SELECT cuenta_id FROM fin_movimientos WHERE id=?').bind(historico.id).first()).cuenta_id, null);
  const nuevoMov = await api('finanzas/movimientos', 'POST', { ...body, cuenta_id: q.id });
  assert.equal((await api('gestion/resumen')).cuentas.find((x) => x.id === q.id).saldo, 15000);
  await assert.rejects(api('finanzas/movimientos', 'POST', { ...body, cuenta_id: cop.id }), error(400, 'moneda_distinta'));
  await assert.rejects(api('finanzas/movimientos', 'POST', { ...body, cuenta_id: nuevo() }), error(400, 'cuenta_invalida'));
  for (const concepto of Object.values(conceptos).flat().filter((x) => x.clave)) {
    await assert.rejects(api('finanzas/movimientos', 'POST', { ...body, tipo: concepto.tipo, concepto_id: concepto.id }), error(400, 'concepto_de_gestion'));
  }
  await api(`finanzas/movimientos/${nuevoMov.id}`, 'PATCH', { cuenta_id: null });
  assert.equal((await api('gestion/resumen')).cuentas.find((x) => x.id === q.id).saldo, 10000);
  assert.ok((await api('finanzas/resumen')).conceptos.every((x) => x.naturaleza));
});

test('SQLite protege cuenta frente a cambio concurrente de moneda/titular, y el API conserva 400/409', async (t) => {
  const { api, cuenta, compra, env, DB } = await fixture(t);
  const q = (await cuenta()).item, c = (await compra({ estado: 'comprometida', estimado: 10000 })).item;
  const disparado = antesDelBatch(t, env, (s) => s.sql.startsWith('INSERT INTO g_idempotencia') && s.args[1].endsWith('/pagos'),
    () => api(`gestion/cuentas/${q.id}`, 'PATCH', { version: q.version, moneda: 'COP' }));
  await assert.rejects(api(`gestion/compras/${c.id}/pagos`, 'POST', { id: nuevo(), fecha: '2026-01-01', importe: 10000, pagador: 'cuenta', cuenta_id: q.id }), error(400, 'moneda_distinta'));
  assert.equal(disparado(), true); assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM g_pagos').first()).n, 0);
  const q2 = (await cuenta()).item;
  await api(`gestion/compras/${c.id}/pagos`, 'POST', { id: nuevo(), fecha: '2026-01-01', importe: 10000, pagador: 'cuenta', cuenta_id: q2.id });
  const entidad = (await api('gestion/entidades', 'POST', { id: nuevo(), nombre: 'Titular prueba', tipo: 'sociedad' })).item;
  const completada = (await api(`gestion/cuentas/${q2.id}`, 'PATCH', { version: q2.version, entidad_id: entidad.id })).item;
  await assert.rejects(api(`gestion/cuentas/${q2.id}`, 'PATCH', { version: completada.version, entidad_id: null }), error(409, 'cuenta_en_uso'));
});

test('identidad con histórico fiscal responde 409 por el endpoint de entidades', async (t) => {
  const { api, DB } = await fixture(t);
  const e = (await api('gestion/entidades', 'POST', { id: nuevo(), nombre: 'Titular prueba', tipo: 'sociedad', nif: 'B12345678' })).item;
  const f = nuevo();
  await DB.prepare(`INSERT INTO g_facturas(id,entidad_id,negocio,tipo,estado,origen,moneda,base,iva,retencion,total,lineas_json,root_id,request_hash,created_by,created_at,updated_by,updated_at)
    VALUES (?,?,'velai','emitida','validada','externa','EUR',0,0,0,0,'[]',?,'test','test','2026-01-01','test','2026-01-01')`).bind(f, e.id, f).run();
  await assert.rejects(api(`gestion/entidades/${e.id}`, 'PATCH', { version: e.version, nif: 'B87654321' }), error(409, 'entidad_con_historico_fiscal'));
});

test('lista de más de 500 compras informa total y mantiene completos los importes del resumen', async (t) => {
  const { api, DB } = await fixture(t);
  await DB.exec(`WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n<501)
    INSERT INTO g_compras(id,concepto,negocio,moneda,estimado,estado,created_by,created_at,updated_at)
    SELECT 'prueba-'||n,'Compra '||n,'velai','EUR',1,'comprometida','test','2026-01-01','2026-01-01' FROM nums;`);
  const lista = await api('gestion/compras');
  assert.equal(lista.items.length, 500); assert.equal(lista.mas, true); assert.equal(lista.total, 501);
  assert.equal((await api('gestion/resumen')).totales.compromisos_pendientes, 501);
});


test('respuesta D1 perdida después de confirmar conserva el adjunto adoptado y permite reintento', async (t) => {
  const { api, call, compra, objects, env, contar } = await fixture(t);
  const c = (await compra()).item;
  const original = env.DB.batch;
  let perdido = false;
  env.DB.batch = async (statements) => {
    const result = await original(statements);
    if (!perdido && statements.some((s) => s.sql.startsWith('INSERT INTO g_documentos'))) {
      perdido = true; throw new Error('Respuesta de commit perdida');
    }
    return result;
  };
  t.after(() => { env.DB.batch = original; });
  const id = nuevo();
  const form = () => {
    const f = new FormData();
    for (const [key, value] of Object.entries({ id, tipo: 'compra', objeto_id: c.id, clase: 'factura', nombre: 'Prueba.pdf' })) f.set(key, value);
    f.set('archivo', new File([bytesDe()], 'Prueba.pdf'));
    return f;
  };
  assert.equal((await api('gestion/documentos', 'POST', form())).item.id, id);
  assert.equal(perdido, true); assert.equal(objects.size, 1); assert.equal(await contar('g_documentos'), 1);
  assert.equal((await api('gestion/documentos', 'POST', form())).item.id, id);
  assert.equal((await call(`gestion/documentos/${id}/archivo`)).status, 200);
});


test('compra real sin fecha conserva importe y permite completar fecha después sin inventar pago', async (t) => {
  const { api, compra, cuenta, DB, contar } = await fixture(t);
  const c = (await compra({ estimado: 79675 })).item;
  const comprada = (await api(`gestion/compras/${c.id}/comprar`, 'POST', { version: c.version, real: 79675, fecha: null, comprador: 'Juan', proveedor: 'Amazon' })).item;
  assert.equal(comprada.estado, 'comprada'); assert.equal(comprada.real, 79675); assert.equal(comprada.fecha_compra, null);
  assert.equal(comprada.documentos_count, 0); assert.equal(comprada.pendiente, 79675);
  assert.equal(await contar('fin_movimientos'), 0);
  const resumen = await api('gestion/resumen');
  assert.equal(resumen.compras.por_negocio.find((x) => x.negocio === 'coches').comprado, 79675);
  assert.equal(resumen.compras.previsto, 0);
  const q = (await cuenta()).item;
  await assert.rejects(api(`gestion/compras/${c.id}/pagos`, 'POST', { id: nuevo(), fecha: null, importe: 79675, pagador: 'cuenta', cuenta_id: q.id }), error(400, 'fecha_invalida'));
  const corregida = (await api(`gestion/compras/${c.id}`, 'PATCH', { version: comprada.version, fecha_compra: '2026-09-30' })).item;
  assert.equal(corregida.fecha_compra, '2026-09-30'); assert.equal(corregida.version, comprada.version + 1);
  assert.equal(corregida.real, 79675); assert.equal(corregida.pagado, 0);
  const detalle = JSON.parse((await DB.prepare("SELECT detalle FROM g_auditoria WHERE objeto_id=? AND accion='compra_cambio' ORDER BY id DESC LIMIT 1").bind(c.id).first()).detalle);
  assert.equal(detalle.de.fecha_compra, null); assert.equal(detalle.a.fecha_compra, '2026-09-30');
  await assert.rejects(api(`gestion/compras/${c.id}`, 'PATCH', { version: comprada.version, fecha_compra: '2026-09-29' }), error(409, 'version_conflicto'));
  await assert.rejects(api(`gestion/compras/${c.id}`, 'PATCH', { version: corregida.version, fecha_compra: '2026-02-30' }), error(400, 'fecha_compra_invalida'));
  const prevista = (await compra()).item;
  await assert.rejects(api(`gestion/compras/${prevista.id}`, 'PATCH', { version: prevista.version, fecha_compra: '2026-09-30' }), error(400, 'usar_comprar'));
});

test('completar titular NULL preserva historia sin atribuir, admite reversos y bloquea reasignación posterior', async (t) => {
  const { api, cuenta, compra, prestamo, DB } = await fixture(t);
  const q = (await cuenta()).item;
  const c = (await compra({ estado: 'comprometida', estimado: 10000 })).item;
  const p = (await prestamo(q.id)).item;
  await api(`gestion/prestamos/${p.id}/desembolso`, 'POST', { id: nuevo(), fecha: '2026-01-01', importe: PRESTAMO.principal, apertura: 0 });
  const pago = (await api(`gestion/compras/${c.id}/pagos`, 'POST', { id: nuevo(), fecha: '2026-01-01', importe: 10000, pagador: 'cuenta', cuenta_id: q.id })).item;
  const cuota = (await api(`gestion/prestamos/${p.id}/pagos`, 'POST', { id: nuevo(), numero: 1, fecha: '2026-01-31', importe: 106619, capital: 94619, interes: 12000 })).item;
  const entidad = (await api('gestion/entidades', 'POST', { id: nuevo(), nombre: 'Titular completado', tipo: 'sociedad' })).item;
  const otra = (await api('gestion/entidades', 'POST', { id: nuevo(), nombre: 'Otro titular', tipo: 'sociedad' })).item;
  const completada = (await api(`gestion/cuentas/${q.id}`, 'PATCH', { version: q.version, entidad_id: entidad.id })).item;
  assert.equal(completada.entidad_id, entidad.id);
  assert.ok((await DB.prepare('SELECT entidad_id FROM fin_movimientos').all()).results.every((m) => m.entidad_id === null));
  await api(`gestion/compras/${c.id}/pagos/${pago.id}/revertir`, 'POST', { id: nuevo(), fecha: '2026-02-01', motivo: 'Corrección después de completar titular' });
  await api(`gestion/prestamos/${p.id}/pagos/${cuota.id}/revertir`, 'POST', { id: nuevo(), fecha: '2026-02-01', motivo: 'Corrección de cuota anterior' });
  assert.ok((await DB.prepare("SELECT entidad_id FROM fin_movimientos WHERE origen_tipo='reverso'").all()).results.every((m) => m.entidad_id === null));
  await api(`gestion/compras/${c.id}/pagos`, 'POST', { id: nuevo(), fecha: '2026-02-01', importe: 10000, pagador: 'cuenta', cuenta_id: q.id });
  assert.equal((await DB.prepare('SELECT entidad_id FROM fin_movimientos ORDER BY rowid DESC LIMIT 1').first()).entidad_id, entidad.id);
  await assert.rejects(api(`gestion/cuentas/${q.id}`, 'PATCH', { version: completada.version, entidad_id: otra.id }), error(409, 'cuenta_en_uso'));
  await assert.rejects(api(`gestion/cuentas/${q.id}`, 'PATCH', { version: completada.version, entidad_id: null }), error(409, 'cuenta_en_uso'));
});


test('guardas SQL de cuenta mantienen errores y rechazan INSERT/UPDATE incompatibles por debajo del API', async (t) => {
  const { api, cuenta, DB, contar } = await fixture(t);
  const e1 = (await api('gestion/entidades', 'POST', { id: nuevo(), nombre: 'Titular uno', tipo: 'sociedad' })).item;
  const e2 = (await api('gestion/entidades', 'POST', { id: nuevo(), nombre: 'Titular dos', tipo: 'sociedad' })).item;
  const eur = (await cuenta({ entidad_id: e1.id })).item;
  const cop = (await cuenta({ moneda: 'COP', entidad_id: e1.id })).item;
  const concepto = (await DB.prepare("SELECT id FROM fin_conceptos WHERE tipo='ingreso' AND clave IS NULL LIMIT 1").first()).id;
  const insertar = (cuentaId, entidadId) => DB.prepare(`INSERT INTO fin_movimientos
    (id,tipo,concepto_id,fecha,moneda,importe,cuenta_id,entidad_id,created_by,created_at)
    VALUES (?,'ingreso',?,'2026-01-01','EUR',100,?,?,'test','2026-01-01')`).bind(nuevo(), concepto, cuentaId, entidadId).run();
  await assert.rejects(insertar(nuevo(), e1.id), /cuenta_invalida/);
  await assert.rejects(insertar(cop.id, e1.id), /moneda_distinta/);
  await assert.rejects(insertar(eur.id, e2.id), /entidad_cuenta_distinta/);
  await assert.rejects(insertar(eur.id, null), /entidad_cuenta_distinta/);
  await insertar(eur.id, e1.id);
  const mov = await DB.prepare('SELECT id FROM fin_movimientos').first();
  await assert.rejects(DB.prepare('UPDATE fin_movimientos SET cuenta_id=? WHERE id=?').bind(cop.id, mov.id).run(), /moneda_distinta/);
  await assert.rejects(DB.prepare('UPDATE fin_movimientos SET entidad_id=? WHERE id=?').bind(e2.id, mov.id).run(), /entidad_cuenta_distinta/);
  assert.equal(await contar('fin_movimientos'), 1);
  assert.deepEqual(await DB.prepare('SELECT cuenta_id,entidad_id FROM fin_movimientos WHERE id=?').bind(mov.id).first(), { cuenta_id: eur.id, entidad_id: e1.id });
});
