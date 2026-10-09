import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
// app.js es el punto de entrada del repositorio y contiene utilidades compartidas;
// iniciarlo primero mantiene el mismo orden de módulos que el Worker real.
import '../worker/app.js';
import { fiscal } from '../worker/routes/fiscal.js';
import { calculateLines, roundedRatio, csvSafe, digest } from '../worker/fiscal.js';
import { sqliteD1 } from './helpers/sqlite-d1.js';

const PERSON = { email: 'socio@velai.test', role: 'velai', tenantId: null };
const E1 = 'a7b23856-bea5-4322-8237-afc9c498050a', E2 = '2e6b0e4a-e47a-45a7-bd4f-8df30798dc01';
const PENDING = '389fd833-9b85-4d80-90b9-21a73239ae22';
const ctx = { waitUntil() {} };
const UUID = () => crypto.randomUUID();
const line = (extra = {}) => ({ descripcion: 'Servicio de ejemplo', cantidad: '1', precio_unitario: 10000, descuento: 0, iva_bp: 2100, retencion_bp: 0, ...extra });
const draft = (extra = {}) => ({ id: UUID(), entidad_id: E1, negocio: 'velai', tipo: 'emitida', estado: 'registrada', origen: 'externa',
  contraparte_nombre: 'Cliente ficticio', contraparte_nif: 'FICTICIO-001', contraparte_direccion: 'Calle de prueba 1',
  numero: UUID(), fecha_emision: '2026-10-09', fecha_operacion: '2026-10-09', moneda: 'EUR', tratamiento_fiscal: 'general', lineas: [line()], ...extra });
const query = (entidad = E1, moneda = 'EUR') => `entidad_id=${entidad}&moneda=${moneda}&desde=2026-10-01&hasta=2026-12-31`;

async function fixture(t) {
  const DB = await sqliteD1(); t.after(() => DB.close());
  await DB.exec('PRAGMA foreign_keys=ON');
  // Estos campos siguen la migración real0050; ningún dato personal de producción.
  for (const [id, nombre, tipo, estado, nif, direccion] of [
    [E1, 'Sociedad Uno', 'sociedad', 'activa', 'FICTICIO-UNO', 'Dirección uno'],
    [E2, 'Sociedad Dos', 'sociedad', 'activa', 'FICTICIO-DOS', 'Dirección dos'],
    [PENDING, 'Promotores', 'promotores', 'pendiente', null, null],
  ]) {
    await DB.prepare('INSERT INTO g_entidades (id,nombre,tipo,estado,nif,direccion,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, nombre, tipo, estado, nif, direccion, PERSON.email, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z').run();
  }
  const env = { DB, SOCIOS_EMAILS: PERSON.email };
  const app = new Hono();
  let currentScope = PERSON;
  app.use('*', async (c, next) => { c.set('scope', currentScope); c.set('config', {}); await next(); });
  app.route('/', fiscal);
  app.onError((e) => new Response(JSON.stringify({ error: e.code ?? e.message }), { status: e.status ?? 500, headers: { 'Content-Type': 'application/json' } }));
  const call = async (path, method = 'GET', body, scope = PERSON) => {
    currentScope = scope;
    const response = await app.fetch(new Request(`https://admin.test/api/admin/gestion/${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }), env, ctx);
    return response;
  };
  const api = async (path, method, body) => { const response = await call(path, method, body); return { status: response.status, ...await response.json() }; };
  const doc = async (id, clase = 'factura') => {
    await DB.prepare('INSERT INTO g_documentos (id,tipo,objeto_id,clase,nombre,mime,ext,bytes,sha256,key,autor,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(UUID(), 'factura', id, clase, 'original-ficticio.pdf', 'application/pdf', 'pdf', 20, await digest(`${id}/${clase}`), `test/${UUID()}.pdf`, PERSON.email, '2026-10-09T00:00:00Z').run();
  };
  const saved = async (values = {}, validate = true) => {
    const result = await api('facturas', 'POST', draft(values)); assert.equal(result.status, 201, JSON.stringify(result));
    await doc(result.item.id);
    if (!validate) return result.item;
    const valid = await api(`facturas/${result.item.id}/validar`, 'POST', { version: 1, iva_deducible: 0, revision: 'Original y clasificación revisados.' });
    assert.equal(valid.status, 200, JSON.stringify(valid)); return valid.item;
  };
  return { DB, env, call, api, doc, saved };
}

test('aritmética exacta: 100+21, cantidades decimales, descuentos, retenciones y signos', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(calculateLines([line()])).filter(([k]) => k !== 'lineas')), { base: 10000, iva: 2100, retencion: 0, total: 12100 });
  const amount = calculateLines([line({ cantidad: '1.5', precio_unitario: 10001, descuento: 2, retencion_bp: 1500 })]);
  assert.equal(amount.base, 15000); assert.equal(amount.iva, 3150); assert.equal(amount.retencion, 2250); assert.equal(amount.total, 15900);
  assert.equal(roundedRatio(5n, 10n), 1); assert.equal(roundedRatio(-5n, 10n), -1);
  assert.equal(calculateLines([line({ cantidad: '0.0001', precio_unitario: 5000 })]).base, 1);
  const credit = calculateLines([line({ precio_unitario: -10000 })], 'rectificativa');
  assert.equal(credit.total, -12100); assert.equal(credit.iva, -2100);
  assert.throws(() => calculateLines([line({ cantidad: 1.1 })]));
  assert.throws(() => calculateLines([line({ cantidad: '1e5' })]));
  assert.throws(() => calculateLines([line({ descuento: 10001 })]));
  assert.throws(() => calculateLines([line({ precio_unitario: -1 })]));
  assert.throws(() => calculateLines([line({ cantidad: '9999999', precio_unitario: 1000000000000 })]));
  assert.equal(calculateLines([line({ iva_bp: null })]).lineas[0].iva_bp, null);
});

test('CSV protege fórmulas incluso después de espacios y conserva comillas', () => {
  for (const value of ['=HYPERLINK("x")', '  +SUM(1)', '\t=1', '\r@SUM(1)', '\n-1']) assert.ok(csvSafe(value).startsWith('"\''), value);
  assert.equal(csvSafe('Texto "normal"'), '"Texto ""normal"""');
});

test('todos los handlers deniegan a no socios antes de DB', async (t) => {
  const { env, call } = await fixture(t);
  env.DB = { prepare() { assert.fail('no puede consultar'); }, batch() { assert.fail('no puede escribir'); } };
  for (const scope of [{ ...PERSON, email: 'ajeno@velai.test' }, { ...PERSON, role: 'cliente' }]) {
    for (const route of fiscal.routes) {
      const path = route.path.replace('/api/admin/gestion/', '').replace(':id', UUID());
      const result = await call(path, route.method, route.method === 'GET' ? undefined : {}, scope);
      assert.equal(result.status, 403, `${route.method} ${path}`);
    }
  }
});

test('alta idempotente: reintento conserva original, ID cambiado no duplica número y nunca mueve caja', async (t) => {
  const { DB, api } = await fixture(t), body = draft();
  const before = (await DB.prepare('SELECT COUNT(*) AS n FROM fin_movimientos').first()).n;
  const result = await api('facturas', 'POST', body); assert.equal(result.status, 201);
  assert.equal(result.item.total, 12100); assert.equal(result.item.iva_deducible, 0); assert.equal(result.item.lineas[0].base, 10000);
  assert.equal(result.item.lineas_json, undefined); assert.equal(result.item.request_hash, undefined);
  assert.equal((await api('facturas', 'POST', body)).status, 200);
  assert.equal((await api('facturas', 'POST', { ...body, negocio: 'coches' })).error, 'id_reutilizado');
  assert.equal((await api('facturas', 'POST', { ...body, id: UUID() })).error, 'factura_externa_duplicada');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM g_facturas').first()).n, 1);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM fin_movimientos').first()).n, before);
});

test('altas simultáneas y ediciones concurrentes tienen un único ganador', async (t) => {
  const { DB, api } = await fixture(t), body = draft();
  const requests = await Promise.all([api('facturas', 'POST', body), api('facturas', 'POST', body)]);
  assert.deepEqual(requests.map((r) => r.status).sort(), [200, 201]);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM g_fiscal_eventos WHERE tipo='factura_alta'").first()).n, 1);
  const edits = await Promise.all([
    api(`facturas/${body.id}`, 'PATCH', { version: 1, nota: 'Edición A' }),
    api(`facturas/${body.id}`, 'PATCH', { version: 1, nota: 'Edición B' }),
  ]);
  assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM g_fiscal_eventos WHERE tipo='factura_edicion'").first()).n, 1);
});

test('borradores y recibidas sin original conservan importe y deducción0, fuera del libro', async (t) => {
  const { api } = await fixture(t);
  const f = (await api('facturas', 'POST', draft({ tipo: 'recibida', tratamiento_fiscal: 'pendiente', lineas: [line({ precio_unitario: 79675, iva_bp: null })] }))).item;
  assert.equal(f.iva_deducible, 0); assert.equal(f.total, 79675);
  assert.equal((await api(`facturas/${f.id}/validar`, 'POST', { version: 1, revision: 'Revisión' })).error, 'original_pendiente');
  const result = await api(`fiscal/resumen?${query()}`);
  assert.equal(result.totales.base_recibida, 0); assert.equal(result.totales.iva_deducible, 0); assert.equal(result.pendientes, 1);
  assert.ok(result.incidencias.some((i) => i.codigo === 'original_pendiente'));
  const incomplete = await api('facturas', 'POST', draft({ entidad_id: PENDING, estado: 'borrador', origen: 'borrador', numero: null, fecha_emision: null, fecha_operacion: null, contraparte_nif: null }));
  assert.equal(incomplete.status, 201);
  assert.equal((await api(`facturas/${incomplete.item.id}/validar`, 'POST', { version: 1, revision: 'Intento' })).error, 'entidad_fiscal_incompleta');
});

test('revisión fiscal explícita: pendientes y REBU no se validan comoIVA0; exento necesita fundamento', async (t) => {
  const { api, doc } = await fixture(t);
  for (const [treatment, code, rate, note] of [['pendiente', 'tratamiento_fiscal_pendiente', null, null], ['rebu', 'regimen_requiere_asesoria', null, null], ['inversion', 'regimen_requiere_asesoria', null, null], ['general', 'tipo_iva_pendiente', null, null], ['exento', 'fundamento_fiscal_pendiente', 0, null]]) {
    const item = (await api('facturas', 'POST', draft({ tratamiento_fiscal: treatment, nota_fiscal: note, lineas: [line({ iva_bp: rate })] }))).item;
    await doc(item.id);
    const result = await api(`facturas/${item.id}/validar`, 'POST', { version: 1, revision: 'Revisado' }); assert.equal(result.error, code);
  }
  const item = (await api('facturas', 'POST', draft({ tratamiento_fiscal: 'exento', nota_fiscal: 'Fundamento revisado en el original de ejemplo.', lineas: [line({ iva_bp: 0 })] }))).item;
  await doc(item.id);
  assert.equal((await api(`facturas/${item.id}/validar`, 'POST', { version: 1, revision: 'Exención revisada' })).status, 200);
});

test('un recibo de pago no reemplaza original; no se deduce más IVA que la cuota ni en emitidas', async (t) => {
  const { api, doc } = await fixture(t);
  const received = (await api('facturas', 'POST', draft({ tipo: 'recibida' }))).item;
  await doc(received.id, 'recibo');
  assert.equal((await api(`facturas/${received.id}/validar`, 'POST', { version: 1, iva_deducible: 2100, revision: 'Revisión' })).error, 'original_pendiente');
  await doc(received.id);
  assert.equal((await api(`facturas/${received.id}/validar`, 'POST', { version: 1, iva_deducible: 2101, revision: 'Revisión' })).error, 'importe_invalido');
  const issued = (await api('facturas', 'POST', draft())).item; await doc(issued.id);
  assert.equal((await api(`facturas/${issued.id}/validar`, 'POST', { version: 1, iva_deducible: 1, revision: 'Revisión' })).error, 'deduccion_solo_recibidas');
});

test('validación congela entidad y original; modificación del perfil no reescribe facturas', async (t) => {
  const { DB, api, saved } = await fixture(t), item = await saved();
  assert.equal(item.snapshot.entidad.nombre, 'Sociedad Uno');
  await DB.prepare('UPDATE g_entidades SET nombre=?,direccion=?,version=version+1 WHERE id=?').bind('Nombre nuevo', 'Dirección nueva', E1).run();
  const stored = (await api(`facturas/${item.id}`)).item;
  assert.equal(stored.snapshot.entidad.nombre, 'Sociedad Uno'); assert.equal(stored.snapshot.entidad.nif, 'FICTICIO-UNO');
  assert.equal(stored.snapshot.entidad.direccion, 'Dirección uno');
  await assert.rejects(DB.prepare('UPDATE g_entidades SET nif=? WHERE id=?').bind('NIF-NUEVO', E1).run(), /entidad_con_historico_fiscal/);
  await assert.rejects(DB.prepare('UPDATE g_entidades SET tipo=? WHERE id=?').bind('autonomo', E1).run(), /entidad_con_historico_fiscal/);
  assert.equal((await api(`facturas/${item.id}`, 'PATCH', { version: 2, negocio: 'coches' })).error, 'factura_inmutable');
  await assert.rejects(DB.prepare('UPDATE g_facturas SET base=0 WHERE id=?').bind(item.id).run(), /factura_inmutable/);
  await assert.rejects(DB.prepare('DELETE FROM g_facturas WHERE id=?').bind(item.id).run(), /factura_no_borrable/);
});

test('edición requiere versión, valida fechas y rechaza cambios ocultos de estado/importe', async (t) => {
  const { api } = await fixture(t), item = (await api('facturas', 'POST', draft())).item;
  assert.equal((await api(`facturas/${item.id}`, 'PATCH', { version: 9, nota: 'x' })).error, 'version_desactualizada');
  assert.equal((await api(`facturas/${item.id}`, 'PATCH', { version: 1, total: 1 })).error, 'campo_no_editable');
  assert.equal((await api(`facturas/${item.id}`, 'PATCH', { version: 1, estado: 'validada' })).error, 'estado_invalido');
  assert.equal((await api(`facturas/${item.id}`, 'PATCH', { version: 1, fecha_emision: '2026-02-30' })).error, 'fecha_invalida');
  assert.equal((await api(`facturas/${item.id}`, 'PATCH', { version: 1, nota: 'Nueva nota' })).item.version, 2);
  assert.equal((await api(`facturas/${item.id}`, 'PATCH', { version: 1, nota: 'Pisando' })).error, 'version_desactualizada');
});

test('separación por entidad/moneda y soportado diferente de deducible', async (t) => {
  const { api, saved } = await fixture(t);
  await saved(); await saved({ entidad_id: E2, lineas: [line({ precio_unitario: 50000 })] });
  await saved({ moneda: 'COP', lineas: [line({ precio_unitario: 1000000, iva_bp: 1900 })] });
  const received = await saved({ tipo: 'recibida' }, false);
  const validated = await api(`facturas/${received.id}/validar`, 'POST', { version: 1, iva_deducible: 1050, revision: 'Deducción parcial revisada.' }); assert.equal(validated.status, 200);
  const result = await api(`fiscal/resumen?${query()}`);
  assert.equal(result.validadas, 2); assert.equal(result.totales.base_emitida, 10000); assert.equal(result.totales.base_recibida, 10000);
  assert.equal(result.totales.iva_repercutido, 2100); assert.equal(result.totales.iva_soportado, 2100); assert.equal(result.totales.iva_deducible, 1050);
  assert.equal(result.totales.saldo_iva_provisional, 1050);
  assert.equal((await api(`fiscal/resumen?${query(E2)}`)).totales.base_emitida, 50000);
  assert.equal((await api(`fiscal/resumen?${query(E1, 'COP')}`)).totales.base_emitida, 1000000);
  assert.equal((await api('fiscal/resumen?desde=2026-10-01&hasta=2026-12-31')).status, 400);
});

test('corrección interna conserva original; sólo revisión validada lo sustituye, sin duplicar', async (t) => {
  const { DB, api, doc, saved } = await fixture(t), original = await saved();
  const request = { id: UUID(), version: 2, motivo: 'Error de transcripción de importe', lineas: [line({ precio_unitario: 20000 })] };
  const correction = await api(`facturas/${original.id}/corregir`, 'POST', request); assert.equal(correction.status, 201, JSON.stringify(correction));
  assert.equal((await api(`facturas/${original.id}/corregir`, 'POST', request)).status, 200);
  assert.equal((await api(`fiscal/resumen?${query()}`)).totales.base_emitida, 10000);
  await doc(correction.item.id);
  assert.equal((await api(`facturas/${correction.item.id}/validar`, 'POST', { version: 1, revision: 'Importe original comprobado.' })).status, 200);
  const report = await api(`fiscal/resumen?${query()}`); assert.equal(report.totales.base_emitida, 20000); assert.equal(report.validadas, 1);
  const old = (await api(`facturas/${original.id}`)).item; assert.equal(old.base, 10000); assert.equal(old.estado, 'validada');
  assert.equal((await api(`facturas/${original.id}/corregir`, 'POST', { ...request, id: UUID() })).error, 'correccion_ya_existe');
  await assert.rejects(DB.prepare('UPDATE g_entidades SET nif=? WHERE id=?').bind('OTRA-IDENTIDAD', E1).run(), /entidad_con_historico_fiscal/);
});

test('rectificativa externa negativa compensa con su signo y no sustituye original', async (t) => {
  const { api, call, saved } = await fixture(t), original = await saved();
  await saved({ clase: 'rectificativa', rectifica_id: original.id, nota_fiscal: 'Abono externo documentado.', lineas: [line({ precio_unitario: -10000 })] });
  const result = await api(`fiscal/resumen?${query()}`);
  assert.equal(result.validadas, 2); assert.equal(result.totales.base_emitida, 0); assert.equal(result.totales.iva_repercutido, 0);
  const csv = await (await call(`fiscal/export.csv?${query()}`)).text();
  assert.ok(csv.includes('"-100.00"')); assert.ok(csv.includes('"-21.00"')); assert.ok(!csv.includes('"\'-21.00"'));
});

test('CSV incluye líneas revisadas, neutraliza fórmulas y deja pendientes sin cifras fiscales', async (t) => {
  const { api, call, saved } = await fixture(t);
  await saved({ contraparte_nombre: ' =HYPERLINK("x")', lineas: [line({ descripcion: '=SUM(1)' }), line({ descripcion: 'Segunda línea' })] });
  await api('facturas', 'POST', draft({ numero: 'PENDIENTE', estado: 'borrador', origen: 'borrador', lineas: [line({ precio_unitario: 77777 })] }));
  await api('facturas', 'POST', draft({ numero: null, fecha_emision: null, fecha_operacion: null, estado: 'borrador', origen: 'borrador' }));
  const response = await call(`fiscal/export.csv?${query()}`), csv = await response.text();
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.ok(csv.includes('"LIBRO_INTERNO"')); assert.ok(csv.includes('"INCIDENCIA"')); assert.ok(csv.includes('"\'=SUM(1)"'));
  assert.ok(csv.includes('"100.00"')); assert.ok(csv.includes('"21.00"')); assert.ok(csv.includes('"PENDIENTE"'));
  assert.ok(csv.includes('"AVISO_SIN_FECHA"'));
  // El precio presupuestado se conserva como dato de línea; base/cuotas/total no entran al libro.
  const pending = csv.split('\r\n').find((s) => s.includes('"PENDIENTE"'));
  assert.ok(pending.includes('"NO"')); assert.ok(pending.includes('borrador_sin_valor_fiscal'));
});

test('cierre snapshot hash, bloquea retroactividad y permite reapertura trazada sin presentación', async (t) => {
  const { DB, api, saved } = await fixture(t); await saved();
  const body = { id: UUID(), entidad_id: E1, moneda: 'EUR', desde: '2026-10-01', hasta: '2026-12-31' };
  const closed = await api('cierres', 'POST', body); assert.equal(closed.status, 201, JSON.stringify(closed));
  const raw = await DB.prepare('SELECT snapshot_json FROM g_fiscal_cierres WHERE id=?').bind(body.id).first();
  assert.equal(closed.item.sha256, await digest(raw.snapshot_json)); assert.equal(closed.item.estado, 'cerrado');
  assert.equal((await api('cierres', 'POST', body)).status, 200);
  assert.equal((await api('facturas', 'POST', draft())).error, 'periodo_cerrado');
  assert.equal((await api('cierres', 'POST', { ...body, id: UUID() })).error, 'periodo_ya_cerrado');
  assert.equal((await api(`cierres/${body.id}/reabrir`, 'POST', { version: 1, motivo: 'Corregir un documento pendiente' })).item.estado, 'reabierto');
  const after = await DB.prepare('SELECT snapshot_json FROM g_fiscal_cierres WHERE id=?').bind(body.id).first(); assert.equal(after.snapshot_json, raw.snapshot_json);
  assert.equal((await api('facturas', 'POST', draft())).status, 201);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM g_fiscal_eventos WHERE tipo='periodo_reabierto'").first()).n, 1);
});

test('cierre no omite pendientes; versión alterada del snapshot se rechaza dentro de SQLite', async (t) => {
  const { DB, api } = await fixture(t), item = (await api('facturas', 'POST', draft())).item;
  const body = { id: UUID(), entidad_id: E1, moneda: 'EUR', desde: '2026-10-01', hasta: '2026-12-31' };
  assert.equal((await api('cierres', 'POST', body)).error, 'cierre_con_pendientes');
  const fake = JSON.stringify({ facturas: [{ id: item.id, version: 99 }] });
  await assert.rejects(DB.prepare('INSERT INTO g_fiscal_cierres (id,entidad_id,moneda,desde,hasta,snapshot_json,sha256,request_hash,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(UUID(), E1, 'EUR', body.desde, body.hasta, fake, 'hash', 'hash', PERSON.email, '2026-10-09').run(), /cierre_desactualizado/);
  assert.equal((await api('cierres', 'POST', { ...body, aceptar_pendientes: true })).status, 201);
  assert.equal((await api(`facturas/${item.id}`, 'PATCH', { version: 1, fecha_operacion: '2027-01-01' })).error, 'periodo_cerrado');
});

test('invalidación de rangos y auditoría inmutable', async (t) => {
  const { DB, api, saved } = await fixture(t); await saved();
  assert.equal((await api(`fiscal/resumen?entidad_id=${E1}&moneda=EUR&desde=2026-02-30&hasta=2026-10-09`)).error, 'fecha_invalida');
  assert.equal((await api(`fiscal/resumen?entidad_id=${E1}&moneda=EUR&desde=2026-12-31&hasta=2026-10-01`)).error, 'periodo_invalido');
  await assert.rejects(DB.prepare('DELETE FROM g_fiscal_eventos').run(), /auditoria_inmutable/);
});

test('lista aplica filtro de tipo en SQL y no mezcla entidades', async (t) => {
  const { api } = await fixture(t);
  await api('facturas', 'POST', draft());
  await api('facturas', 'POST', draft({ tipo: 'recibida' }));
  await api('facturas', 'POST', draft({ entidad_id: E2, tipo: 'recibida' }));
  const received = await api(`facturas?entidad_id=${E1}&moneda=EUR&tipo=recibida`);
  assert.equal(received.items.length, 1); assert.equal(received.items[0].tipo, 'recibida'); assert.equal(received.items[0].entidad_id, E1);
  assert.equal((await api(`facturas?entidad_id=${E1}&moneda=EUR&tipo=arbitrario`)).error, 'tipo_invalido');
});
