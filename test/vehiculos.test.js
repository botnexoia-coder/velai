// Control por vehículo y viaje (0063): reparto exacto, imputación de gastos
// conjuntos, ficha económica y guardas. Importes ficticios y redondos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { HttpError } from '../worker/app.js';
import { gestion } from '../worker/routes/gestion.js';
import { finanzas } from '../worker/routes/finanzas.js';
import { fiscal } from '../worker/routes/fiscal.js';
import { repartir, imputarViaje } from '../worker/gestion-financiera.js';
import { sqliteD1 } from './helpers/sqlite-d1.js';

const SOCIO = { role: 'velai', tenantId: null, email: 'uno@velai.test' };
const ctx = { waitUntil() {} };
const error = (status, code) => (e) => e.status === status && e.code === code;
const nuevo = () => crypto.randomUUID();
const INYECTADO = new WeakMap();
const app = new Hono();
app.use('*', async (c, next) => { c.set('scope', INYECTADO.get(c.req.raw)); c.set('config', {}); await next(); });
app.route('/', gestion); app.route('/', finanzas); app.route('/', fiscal);
app.notFound(() => { throw new HttpError(404, 'not_found'); });
app.onError((e) => { throw e; });

async function fixture(t) {
  const DB = await sqliteD1(); t.after(() => DB.close());
  await DB.exec('PRAGMA foreign_keys=ON;');
  await DB.exec("DELETE FROM fin_socios; INSERT INTO fin_socios (email,nombre) VALUES ('uno@velai.test','Uno');");
  await DB.exec("INSERT INTO g_terceros(id,nombre,created_by,created_at) VALUES ('qa-p1','Proveedor ejemplo','qa','2026-10-16');");
  const objects = new Map();
  const env = { DB, SOCIOS_EMAILS: 'uno@velai.test', FINANCE_DOCS: {
    async put(key, bytes, options) { objects.set(key, { bytes: new Uint8Array(bytes), contentType: options.httpMetadata.contentType }); },
    async get(key) { const r = objects.get(key); return r ? { body: r.bytes, httpMetadata: { contentType: r.contentType } } : null; },
    async delete(key) { objects.delete(key); },
  } };
  const call = async (path, method = 'GET', body, scope = SOCIO) => {
    const init = { method, headers: {} };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const req = new Request(`https://admin.test/api/admin/${path}`, init);
    INYECTADO.set(req, scope);
    return app.fetch(req, env, ctx);
  };
  const api = async (...args) => (await call(...args)).json();
  const cuenta = (extra = {}) => api('gestion/cuentas', 'POST', { id: nuevo(), nombre: 'Cuenta operativa', moneda: 'EUR', saldo_inicial: 0, ...extra });
  const vehiculo = (extra = {}) => api('gestion/vehiculos', 'POST', { id: nuevo(), referencia: `V-${nuevo().slice(0, 8)}`, tipo: 'camioneta', ...extra });
  const compra = (extra = {}) => api('gestion/compras', 'POST', { id: nuevo(), concepto: 'Gasto ejemplo', negocio: 'coches', moneda: 'EUR', estimado: 10000, estado: 'comprometida', categoria: 'gasolina', ...extra });
  const pagar = (compraId, importe, cuentaId, fecha = '2026-03-01') => api(`gestion/compras/${compraId}/pagos`, 'POST', { id: nuevo(), fecha, importe, pagador: 'cuenta', cuenta_id: cuentaId });
  const conceptoIngreso = async () => (await DB.prepare("SELECT id FROM fin_conceptos WHERE tipo='ingreso' AND clave IS NULL AND activo=1 LIMIT 1").first()).id;
  return { DB, env, call, api, cuenta, vehiculo, compra, pagar, conceptoIngreso };
}

test('repartir: suma exacta, resto céntimo a céntimo, pesos manuales y casos vacíos', () => {
  const partes = (lista) => lista.map((p) => p.importe);
  const dos = [{ vehiculo_id: 'a', peso_bp: 1 }, { vehiculo_id: 'b', peso_bp: 1 }];
  assert.deepEqual(partes(repartir(30000, dos)), [15000, 15000]);
  const impar = repartir(30001, dos);
  assert.equal(impar[0].importe + impar[1].importe, 30001); assert.equal(Math.abs(impar[0].importe - impar[1].importe), 1);
  assert.deepEqual(partes(repartir(100, [{ vehiculo_id: 'a', peso_bp: 1 }, { vehiculo_id: 'b', peso_bp: 1 }, { vehiculo_id: 'c', peso_bp: 1 }])), [34, 33, 33]);
  // Manual 70/30 sobre 1.000,01 €: 70.000,7 → el céntimo sobrante va a la mayor fracción.
  assert.deepEqual(partes(repartir(100001, [{ vehiculo_id: 'a', peso_bp: 7000 }, { vehiculo_id: 'b', peso_bp: 3000 }])), [70001, 30000]);
  // Importes grandes sin perder precisión (BigInt).
  const grande = repartir(10 ** 13 - 1, [{ vehiculo_id: 'a', peso_bp: 3333 }, { vehiculo_id: 'b', peso_bp: 3333 }, { vehiculo_id: 'c', peso_bp: 3334 }]);
  assert.equal(grande.reduce((s, p) => s + p.importe, 0), 10 ** 13 - 1);
  assert.deepEqual(repartir(500, []), []);
  assert.deepEqual(partes(repartir(0, dos)), [0, 0]);
  // Imputación gasto a gasto: canceladas fuera; sin participantes queda sin repartir.
  const viaje = { reparto: 'igual' };
  const conjuntos = [{ estado: 'comprada', real: 30001, estimado: 1, pagado: 30001 }, { estado: 'comprometida', estimado: 999, pagado: 0 }, { estado: 'cancelada', estimado: 5000, pagado: 0 }];
  const imp = imputarViaje(viaje, dos, conjuntos);
  assert.equal(imp.total, 31000); assert.equal(imp.pagado, 30001); assert.equal(imp.sin_repartir, 0);
  assert.equal(imp.por_vehiculo.a.coste + imp.por_vehiculo.b.coste, 31000); assert.equal(imp.por_vehiculo.a.pagado + imp.por_vehiculo.b.pagado, 30001);
  assert.equal(imputarViaje(viaje, [], conjuntos).sin_repartir, 31000);
});

test('vehículos y viajes: gasto conjunto repartido entre dos coches, compra directa, venta y cobro; margen sin duplicar caja', async (t) => {
  const { api, cuenta, vehiculo, compra, pagar, conceptoIngreso, DB } = await fixture(t);
  const E = nuevo();
  await DB.prepare("INSERT INTO g_entidades (id,nombre,tipo,estado,nif,direccion,version,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,1,'qa','2026-01-01','2026-01-01')").bind(E, 'Promotores QA', 'sociedad', 'activa', 'B12345678', 'Calle 1').run();
  const q = (await cuenta({ entidad_id: E })).item;
  const a = (await vehiculo({ referencia: 'CAMIONETA-A', marca: 'Fiat', modelo: 'Doblò', matricula: '1234 abc' })).item;
  const b = (await vehiculo({ referencia: 'COCHE-B', tipo: 'coche' })).item;
  assert.equal(a.matricula, '1234 ABC'); assert.equal(a.estado, 'previsto'); assert.equal(a.moneda, 'EUR');
  await assert.rejects(vehiculo({ referencia: 'CAMIONETA-A' }), error(409, 'referencia_duplicada'));
  await assert.rejects(vehiculo({ tipo: 'tractor' }), error(400, 'tipo_invalido'));
  // Viaje con dos vehículos a partes iguales.
  const viaje = (await api('gestion/viajes', 'POST', { id: nuevo(), nombre: 'Viaje Alemania', fecha_inicio: '2026-03-01', fecha_fin: '2026-03-04', vehiculos: [{ vehiculo_id: a.id }, { vehiculo_id: b.id }] }));
  assert.equal(viaje.item.vehiculos_count, 2); assert.equal(viaje.item.reparto, 'igual'); assert.equal(viaje.vehiculos.length, 2);
  await assert.rejects(api('gestion/viajes', 'POST', { id: nuevo(), nombre: 'Mal', reparto: 'manual', vehiculos: [{ vehiculo_id: a.id, peso_bp: 6000 }, { vehiculo_id: b.id, peso_bp: 3000 }] }), error(400, 'pesos_invalidos'));
  await assert.rejects(api('gestion/viajes', 'POST', { id: nuevo(), nombre: 'Mal', vehiculos: [{ vehiculo_id: a.id }, { vehiculo_id: a.id }] }), error(400, 'vehiculos_repetidos'));
  // Gasto conjunto del viaje (gasolina de los dos coches): UNA compra, sin vehículo.
  const gasolina = (await compra({ concepto: 'Gasolina ida', viaje_id: viaje.item.id, estimado: 30001, entidad_id:E })).item;
  assert.equal(gasolina.viaje_id, viaje.item.id); assert.equal(gasolina.vehiculo_id, null);
  await pagar(gasolina.id, 30001, q.id);
  // Guardas: tipología cerrada, negocio, moneda y pertenencia al viaje.
  await assert.rejects(compra({ viaje_id: viaje.item.id, categoria: 'equipamiento' }), error(400, 'categoria_invalida'));
  await assert.rejects(compra({ vehiculo_id: a.id, negocio: 'velai' }), error(400, 'vehiculo_negocio_incoherente'));
  await assert.rejects(compra({ vehiculo_id: a.id, moneda: 'COP' }), error(400, 'vehiculo_moneda_distinta'));
  const c = (await vehiculo({ referencia: 'COCHE-C', tipo: 'coche' })).item;
  await assert.rejects(compra({ vehiculo_id: c.id, viaje_id: viaje.item.id }), error(400, 'vehiculo_fuera_del_viaje'));
  await assert.rejects(compra({ vehiculo_id: nuevo() }), error(400, 'vehiculo_invalido'));
  // Compra del vehículo A (adquisición) y un gasto directo de A dentro del viaje.
  const adq = (await compra({ concepto: 'Compra camioneta', vehiculo_id: a.id, categoria: 'adquisicion', estimado: 500000, entidad_id: E })).item;
  await api(`gestion/compras/${adq.id}/comprar`, 'POST', { version: adq.version, real: 500000, fecha: '2026-03-02', proveedor: 'Proveedor ejemplo' });
  await pagar(adq.id, 500000, q.id, '2026-03-02');
  const peaje = (await compra({ concepto: 'Peaje camioneta', vehiculo_id: a.id, viaje_id: viaje.item.id, categoria: 'peajes', estimado: 2000 })).item;
  // Resumen del viaje: 2 vehículos, conjunto 300,01 repartido al céntimo, directo 20,00 de A.
  const rv = await api(`gestion/viajes/${viaje.item.id}/resumen`);
  assert.equal(rv.totales.vehiculos, 2); assert.equal(rv.totales.coste_conjunto, 30001); assert.equal(rv.totales.coste_directo, 2000); assert.equal(rv.totales.coste_total, 32001);
  assert.equal(rv.totales.pagado, 30001); assert.equal(rv.totales.pendiente, 2000);
  const partes = rv.vehiculos.map((v) => v.parte_conjunta);
  assert.equal(partes[0] + partes[1], 30001); assert.equal(Math.abs(partes[0] - partes[1]), 1);
  assert.equal(rv.vehiculos.find((v) => v.vehiculo_id === a.id).directo, 2000);
  assert.deepEqual(rv.por_categoria.map((r) => r.categoria), ['gasolina', 'peajes']);
  const fila = (await api('gestion/viajes')).items.find((v) => v.id === viaje.item.id);
  assert.equal(fila.coste_total, 32001); assert.equal(fila.parte_conjunta, 15000); assert.equal(fila.vehiculos.length, 2);
  // Ficha de A: directo + su parte del viaje; el préstamo no aparece como coste ni como venta.
  const parteA = rv.vehiculos.find((v) => v.vehiculo_id === a.id).parte_conjunta;
  let ra = await api(`gestion/vehiculos/${a.id}/resumen`);
  assert.equal(ra.totales.precio_compra, 500000); assert.equal(ra.totales.precio_compra_confirmado, true);
  assert.equal(ra.totales.coste_directo, 502000); assert.equal(ra.totales.pagado_directo, 500000); assert.equal(ra.totales.pendiente_directo, 2000);
  assert.equal(ra.totales.imputado_viajes, parteA); assert.equal(ra.totales.imputado_viajes_pagado, parteA);
  assert.equal(ra.totales.coste_total, 502000 + parteA); assert.equal(ra.totales.invertido_confirmado, 500000 + parteA);
  assert.equal(ra.costes.reduce((s,c)=>s+c.importe,0),ra.totales.coste_total);
  assert.equal(ra.pagos.reduce((s,p)=>s+p.importe,0),ra.totales.invertido_confirmado);
  assert.equal(ra.costes.find(c=>c.id===gasolina.id).importe,parteA);
  assert.equal(ra.costes.filter(c=>c.id===peaje.id).length,1);
  assert.equal(ra.pagos.find(p=>p.compra_id===adq.id).cuenta_nombre,q.nombre);
  assert.equal(ra.totales.venta, null); assert.equal(ra.totales.margen_estimado, null); assert.equal(ra.viajes.length, 1); assert.equal(ra.viajes[0].parte, parteA);
  // Viaje (01/03), compra y pago de la adquisición (02/03) y el peaje sin fecha al final.
  assert.deepEqual(ra.cronologia.map((e) => e.clase), ['viaje', 'compra', 'pago', 'compra']);
  // Venta declarada y cobro: una sola entrada de caja con vehiculo_id.
  const vendido = await api(`gestion/vehiculos/${a.id}`, 'PATCH', { version: a.version, estado: 'vendido', precio_venta: 700000, fecha_venta: '2026-04-01' });
  assert.equal(vendido.item.estado, 'vendido'); assert.equal(vendido.item.version, 2);
  const cobro = { id: nuevo(), fecha: '2026-04-02', importe: 700000, cuenta_id: q.id, concepto_id: await conceptoIngreso() };
  assert.equal((await api(`gestion/vehiculos/${a.id}/cobros`, 'POST', cobro)).item.vehiculo_id, a.id);
  await api(`gestion/vehiculos/${a.id}/cobros`, 'POST', cobro);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM fin_movimientos WHERE vehiculo_id=?').bind(a.id).first()).n, 1);
  ra = await api(`gestion/vehiculos/${a.id}/resumen`);
  assert.equal(ra.totales.cobrado, 700000); assert.equal(ra.totales.cobrado_en_cuenta, 700000); assert.equal(ra.totales.pendiente_cobro, 0);
  assert.equal(ra.totales.margen_estimado, 700000 - 502000 - parteA); assert.equal(ra.totales.margen_confirmado, 700000 - 500000 - parteA);
  assert.equal(ra.totales.margen_sin_viajes, 700000 - 502000);
  // Enlazar no movió caja: solo pagos reales + el cobro.
  const libro = (await DB.prepare("SELECT tipo, SUM(importe) AS s FROM fin_movimientos GROUP BY tipo ORDER BY tipo").all()).results;
  assert.deepEqual(libro, [{ tipo: 'gasto', s: 530001 }, { tipo: 'ingreso', s: 700000 }]);
  // La moneda de un vehículo con registros no cambia; quitar del viaje un vehículo con gastos directos tampoco.
  await assert.rejects(api(`gestion/vehiculos/${a.id}`, 'PATCH', { version: 2, moneda: 'COP' }), error(409, 'vehiculo_en_uso'));
  await assert.rejects(api(`gestion/viajes/${viaje.item.id}`, 'PATCH', { version: 1, vehiculos: [{ vehiculo_id: b.id }] }), error(409, 'vehiculo_con_gastos_en_viaje'));
  const ampliado = await api(`gestion/viajes/${viaje.item.id}`, 'PATCH', { version: 1, vehiculos: [{ vehiculo_id: a.id }, { vehiculo_id: b.id }, { vehiculo_id: c.id }] });
  assert.equal(ampliado.item.version, 2); assert.equal(ampliado.vehiculos.length, 3);
  assert.equal((await api(`gestion/viajes/${viaje.item.id}/resumen`)).vehiculos.reduce((s, v) => s + v.parte_conjunta, 0), 30001);
  await assert.rejects(api(`gestion/viajes/${viaje.item.id}`, 'PATCH', { version: 1, nombre: 'Tardío' }), error(409, 'version_conflicto'));
  assert.equal((await api(`gestion/viajes/${viaje.item.id}`)).vehiculos.length, 3);
  // Factura de venta y recibida con vehículo: la recibida enlazada a una compra de otro vehículo se rechaza.
  const factura = (extra = {}) => ({ id: nuevo(), entidad_id: E, negocio: 'coches', tipo: 'emitida', estado: 'registrada', origen: 'externa', numero: nuevo(), fecha_emision: '2026-04-01', moneda: 'EUR', tratamiento_fiscal: 'general',
    contraparte_nombre: 'Proveedor ejemplo', contraparte_nif: 'X1', lineas: [{ descripcion: 'Venta', cantidad: '1', precio_unitario: 700000, descuento: 0, iva_bp: 0, retencion_bp: 0 }], ...extra });
  const venta = await api('gestion/facturas', 'POST', factura({ vehiculo_id: a.id }));
  assert.equal(venta.item.vehiculo_id, a.id);
  await assert.rejects(api('gestion/facturas', 'POST', factura({ vehiculo_id: nuevo() })), error(400, 'vehiculo_incompatible'));
  await assert.rejects(api('gestion/facturas', 'POST', factura({ tipo: 'recibida', compra_id: adq.id, vehiculo_id: b.id })), error(400, 'vehiculo_incompatible'));
  ra = await api(`gestion/vehiculos/${a.id}/resumen`);
  assert.equal(ra.facturas.length, 1); assert.equal(ra.totales.facturado_venta, 700000);
  assert.equal(ra.facturas[0].iva_informado,true);assert.equal(ra.facturas[0].iva,0);
  const recibida=await api('gestion/facturas','POST',factura({tipo:'recibida',compra_id:adq.id,vehiculo_id:a.id,tratamiento_fiscal:'pendiente',lineas:[{descripcion:'Original con IVA no informado',cantidad:'1',precio_unitario:450000,iva_bp:null}]}));
  ra=await api(`gestion/vehiculos/${a.id}/resumen`);
  const coste=ra.costes.find(c=>c.id===adq.id),f=coste.facturas.find(f=>f.id===recibida.item.id);
  assert.equal(f.iva_informado,false);assert.equal(f.originales_count,0);assert.equal(f.total,450000);
  assert.equal(coste.importe,500000);assert.equal(ra.totales.coste_total,502000+ra.totales.imputado_viajes);
  assert.equal(ra.totales.facturado_venta,700000);
  const compartida=await api('gestion/facturas','POST',factura({tipo:'recibida',compra_id:gasolina.id,tratamiento_fiscal:'general',lineas:[{descripcion:'Viaje completo',cantidad:'1',precio_unitario:30001,iva_bp:0}]}));
  for(const veh of [a,b]){
    const r=await api(`gestion/vehiculos/${veh.id}/resumen`);
    assert.equal(r.facturas.some(f=>f.id===compartida.item.id),false);
    assert.equal(r.cronologia.some(e=>e.ref.id===compartida.item.id),false);
    assert.equal(r.costes.find(c=>c.id===gasolina.id).facturas[0].total,30001);
  }
  // El esquema exige texto no NULL, pero un JSON literal null puede proceder de un histórico.
  await DB.prepare('UPDATE g_facturas SET lineas_json=? WHERE id=?').bind('null',recibida.item.id).run();
  const defensivo=await api(`gestion/vehiculos/${a.id}/resumen`);
  assert.equal(defensivo.costes.find(c=>c.id===adq.id).facturas[0].iva_informado,false);
  // La API impide cancelar una compra con pagos: no hay desaparición por ese flujo.
  await assert.rejects(api(`gestion/compras/${gasolina.id}`,'PATCH',{version:(await DB.prepare('SELECT version FROM g_compras WHERE id=?').bind(gasolina.id).first()).version,estado:'cancelada'}),error(409,'compra_con_pagos'));

});

test('documentos del vehículo: tipo propio con vencimiento, y la ficha reúne los suyos y los de sus compras', async (t) => {
  const { api, call, vehiculo, compra } = await fixture(t);
  const a = (await vehiculo({ referencia: 'DOC-A' })).item;
  const adq = (await compra({ concepto: 'Compra', vehiculo_id: a.id, categoria: 'adquisicion', estimado: 100 })).item;
  const subir = async (tipo, objeto_id, clase, vence) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ id: nuevo(), tipo, objeto_id, clase, nombre: `${clase}.pdf`, vence })) if (v != null) form.set(k, v);
    const b = new Uint8Array(64); b.set(new TextEncoder().encode('%PDF-1.7'));
    form.set('archivo', new File([b], 'x.bin', { type: 'application/octet-stream' }));
    return (await call('gestion/documentos', 'POST', form)).json();
  };
  const seguro = await subir('vehiculo', a.id, 'seguro', '2027-03-31');
  assert.equal(seguro.item.vence, '2027-03-31'); assert.equal(seguro.item.tipo, 'vehiculo');
  await assert.rejects(subir('vehiculo', a.id, 'placas', '2027-02-30'), error(400, 'vence_invalida'));
  await assert.rejects(subir('vehiculo', nuevo(), 'placas'), error(404, 'not_found'));
  await subir('compra', adq.id, 'factura');
  const lista = await api(`gestion/documentos?tipo=vehiculo&objeto_id=${a.id}`);
  assert.equal(lista.items.length, 1); assert.equal(lista.items[0].key, undefined);
  const ra = await api(`gestion/vehiculos/${a.id}/resumen`);
  assert.deepEqual(ra.documentos.map((d) => [d.tipo, d.clase, d.vence]), [['vehiculo', 'seguro', '2027-03-31'], ['compra', 'factura', null]]);
  assert.equal(ra.vehiculo.documentos_count, 1);
});


test('desglose: pagos compartidos por cuenta cuadran al céntimo; otros y avance provisional conservados',async(t)=>{
 const {api,vehiculo,compra,cuenta,pagar}=await fixture(t);
 const a=(await vehiculo({referencia:'DEMO-A'})).item,b=(await vehiculo({referencia:'DEMO-B'})).item,z=(await vehiculo({referencia:'DEMO-C'})).item;
 const q1=(await cuenta({nombre:'Origen uno'})).item,q2=(await cuenta({nombre:'Origen dos'})).item;
 const trip=(await api('gestion/viajes','POST',{id:nuevo(),nombre:'Viaje QA',vehiculos:[{vehiculo_id:a.id},{vehiculo_id:b.id},{vehiculo_id:z.id}]})).item;
 const c=(await compra({viaje_id:trip.id,estimado:3})).item;
 await pagar(c.id,1,q1.id);await pagar(c.id,2,q2.id);
 const provisional=(await compra({vehiculo_id:a.id,categoria:'otros',estimado:987,nota:'Nota histórica sin clasificación'})).item;
 await api(`gestion/compras/${provisional.id}`,'PATCH',{version:provisional.version,hecho:true});
 const porCuenta={};
 for(const v of [a,b,z]){
  const r=await api(`gestion/vehiculos/${v.id}/resumen`);
  for(const p of r.pagos)porCuenta[p.cuenta_id]=(porCuenta[p.cuenta_id]||0)+p.importe;
  assert.equal(r.costes.reduce((s,x)=>s+x.importe,0),r.totales.coste_total);
  assert.equal(r.pagos.reduce((s,x)=>s+x.importe,0),r.totales.invertido_confirmado);
  assert.deepEqual(new Set(r.pagos.map(p=>p.cuenta_nombre)),new Set(['Origen uno','Origen dos']));
  if(v.id===a.id){const x=r.costes.find(x=>x.id===provisional.id);assert.equal(x.hecho,true);assert.equal(x.estado,'comprometida');assert.equal(x.pagado,0);assert.equal(x.nota,'Nota histórica sin clasificación');assert.deepEqual(x.facturas,[]);}
 }
 assert.equal(porCuenta[q1.id],1);assert.equal(porCuenta[q2.id],2);
});
