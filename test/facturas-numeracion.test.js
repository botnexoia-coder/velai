// Numeración anual (migración 0062) sobre SQLite real: contador compartido F/R/PR
// probado con el helper, y la única ruta activa (muestras PR) por HTTP con el router
// Hono local. Todo ficticio; sin nube ni credenciales. Ninguna prueba compara textos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import '../worker/app.js';
import { fiscal } from '../worker/routes/fiscal.js';
import { digest, fromRow } from '../worker/fiscal.js';
import { ejercicioDe, numeroDe, serieDe, familiaDe, reservarNumero, insertarNumerado, errorNumeracion, SECUENCIA_MAX } from '../worker/facturas-numeracion.js';
import { sqliteD1 } from './helpers/sqlite-d1.js';

// Zona horaria deliberadamente lejos de UTC: un ejercicio calculado con Date se movería.
process.env.TZ = 'Pacific/Kiritimati';
const PERSON = { email: 'socio@velai.test', role: 'velai', tenantId: null };
const E1 = 'a7b23856-bea5-4322-8237-afc9c498050a', E2 = '2e6b0e4a-e47a-45a7-bd4f-8df30798dc01';
const PENDING = '389fd833-9b85-4d80-90b9-21a73239ae22';
const ctx = { waitUntil() {} };
const UUID = () => crypto.randomUUID();
const line = (extra = {}) => ({ descripcion: 'Servicio de ejemplo', cantidad: '1', precio_unitario: 10000, descuento: 0, iva_bp: 2100, retencion_bp: 0, ...extra });
// Borrador de venta: sin número, sin contraparte completa, origen borrador.
const borrador = (extra = {}) => ({ id: UUID(), entidad_id: E1, negocio: 'velai', tipo: 'emitida', estado: 'borrador', origen: 'borrador',
  contraparte_nombre: 'Cliente ficticio', moneda: 'EUR', tratamiento_fiscal: 'general', lineas: [line()], ...extra });
const prueba = (version = 1, fecha_emision = '2027-02-15') => ({ id: UUID(), version, fecha_emision });

async function fixture(t) {
  const DB = await sqliteD1(); t.after(() => DB.close());
  await DB.exec('PRAGMA foreign_keys=ON');
  await DB.prepare("INSERT INTO g_terceros(id,nombre,created_by,created_at) VALUES ('cliente-qa',?,'qa','2026-10-16')").bind('Cliente ficticio').run();
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
    return app.fetch(new Request(`https://admin.test/api/admin/gestion/${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }), env, ctx);
  };
  const api = async (path, method, body) => { const response = await call(path, method, body); return { status: response.status, ...await response.json() }; };
  const alta = async (values = {}) => { const r = await api('facturas', 'POST', borrador(values)); assert.equal(r.status, 201, JSON.stringify(r)); return r.item; };
  const contadores = async () => (await DB.prepare('SELECT entidad_id,familia,ejercicio,ultimo FROM g_factura_contadores ORDER BY entidad_id,familia,ejercicio').all()).results;
  const count = async (tabla, where = '1=1') => (await DB.prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${where}`).first()).n;
  const filaFactura = (id) => DB.prepare('SELECT * FROM g_facturas WHERE id=?').bind(id).first();
  return { DB, env, call, api, alta, contadores, count, filaFactura };
}

test('ejercicio sale del texto de la fecha (no de Date), formato de serie/número y límites', () => {
  assert.equal(ejercicioDe('2027-12-31'), 2027); assert.equal(ejercicioDe('2028-01-01'), 2028);
  assert.equal(ejercicioDe('2000-01-01'), 2000); assert.equal(ejercicioDe('9999-12-31'), 9999);
  for (const bad of ['1999-12-31', '2027-1-1', '2027-02-15T00:00:00Z', 20270215, null, undefined]) assert.throws(() => ejercicioDe(bad), (e) => e.status === 400 && e.code === 'fecha_invalida', String(bad));
  assert.equal(serieDe('PR', 2027), 'PR-2027'); assert.equal(numeroDe('PR', 2027, 1), 'PR-2027-001');
  assert.equal(numeroDe('F', 2027, 42), 'F-2027-042'); assert.equal(numeroDe('R', 2027, 1000), 'R-2027-1000');
  assert.equal(numeroDe('F', 2027, SECUENCIA_MAX), 'F-2027-999999');
  for (const bad of ['PRUEBA', 'f', '', null]) assert.throws(() => familiaDe(bad), (e) => e.code === 'familia_invalida');
  assert.throws(() => insertarNumerado({ prepare() {} }, 'g_facturas_prueba; DROP', ['id'], [1], { entidad_id: E1, familia: 'PR', ejercicio: 2027 }), /numeracion_sentencia_invalida/);
  assert.throws(() => insertarNumerado({ prepare() {} }, 'g_facturas_prueba', ['id', 'x'], [1], { entidad_id: E1, familia: 'PR', ejercicio: 2027 }), /numeracion_sentencia_invalida/);
  assert.throws(() => errorNumeracion(new Error('otro fallo')), /otro fallo/);
  assert.throws(() => errorNumeracion(new Error('CHECK constraint failed: g_factura_contador_tope')), (e) => e.status === 409 && e.code === 'secuencia_agotada');
});

test('contador compartido: F, R y PR separados por emisor y ejercicio; reinicio anual; el fallo del documento revierte la reserva', async (t) => {
  const { DB, alta, contadores } = await fixture(t);
  // Tabla SOLO de esta prueba: ninguna ruta emite F/R y las muestras PR no comparten registro real.
  await DB.exec('CREATE TABLE t_numerados (id TEXT PRIMARY KEY, entidad_id TEXT NOT NULL, familia TEXT NOT NULL, ejercicio INTEGER NOT NULL, secuencia INTEGER NOT NULL, serie TEXT NOT NULL, numero TEXT NOT NULL, UNIQUE(entidad_id,familia,ejercicio,secuencia))');
  const emitir = (id, entidad_id, familia, ejercicio) => DB.batch([
    reservarNumero(DB, { entidad_id, familia, ejercicio, now: '2027-01-01T00:00:00Z' }),
    insertarNumerado(DB, 't_numerados', ['id'], [id], { entidad_id, familia, ejercicio }),
  ]);
  const numero = async (id) => (await DB.prepare('SELECT * FROM t_numerados WHERE id=?').bind(id).first());
  const ids = Array.from({ length: 7 }, UUID);
  await emitir(ids[0], E1, 'F', 2027); await emitir(ids[1], E1, 'F', 2027);
  await emitir(ids[2], E1, 'R', 2027); await emitir(ids[3], E1, 'PR', 2027);
  await emitir(ids[4], E1, 'F', 2028); await emitir(ids[5], E1, 'F', 2027); await emitir(ids[6], E2, 'F', 2027);
  const esperado = [[ids[0], 'F-2027-001', 1], [ids[1], 'F-2027-002', 2], [ids[2], 'R-2027-001', 1], [ids[3], 'PR-2027-001', 1], [ids[4], 'F-2028-001', 1], [ids[5], 'F-2027-003', 3], [ids[6], 'F-2027-001', 1]];
  for (const [id, num, seq] of esperado) { const row = await numero(id); assert.equal(row.numero, num); assert.equal(row.secuencia, seq); assert.equal(row.serie, num.slice(0, -4)); }
  assert.deepEqual(await contadores(), [
    { entidad_id: E2, familia: 'F', ejercicio: 2027, ultimo: 1 },
    { entidad_id: E1, familia: 'F', ejercicio: 2027, ultimo: 3 }, { entidad_id: E1, familia: 'F', ejercicio: 2028, ultimo: 1 },
    { entidad_id: E1, familia: 'PR', ejercicio: 2027, ultimo: 1 }, { entidad_id: E1, familia: 'R', ejercicio: 2027, ultimo: 1 },
  ]);
  // Documento que no se puede insertar (id repetido): la transacción entera cae y el contador no avanza.
  await assert.rejects(emitir(ids[0], E1, 'F', 2027), /UNIQUE constraint failed: t_numerados\.id/);
  assert.equal((await DB.prepare("SELECT ultimo FROM g_factura_contadores WHERE entidad_id=? AND familia='F' AND ejercicio=2027").bind(E1).first()).ultimo, 3);
  const siguiente = UUID(); await emitir(siguiente, E1, 'F', 2027); assert.equal((await numero(siguiente)).numero, 'F-2027-004');
  // El contador no admite saltos, borrados ni desbordamiento; un documento sin reserva tampoco entra.
  await assert.rejects(DB.prepare("UPDATE g_factura_contadores SET ultimo=ultimo+2 WHERE entidad_id=? AND familia='F' AND ejercicio=2027").bind(E1).run(), /contador_salto/);
  await assert.rejects(DB.prepare("UPDATE g_factura_contadores SET ultimo=ultimo-1 WHERE entidad_id=? AND familia='F' AND ejercicio=2027").bind(E1).run(), /contador_salto/);
  await assert.rejects(DB.prepare('DELETE FROM g_factura_contadores').run(), /contador_inmutable/);
  await assert.rejects(DB.prepare("INSERT INTO g_factura_contadores (entidad_id,familia,ejercicio,ultimo,created_at,updated_at) VALUES (?,'R',2028,?,'x','x')").bind(E1, SECUENCIA_MAX + 1).run(), /g_factura_contador_tope/);
  await assert.rejects(DB.prepare("INSERT INTO g_factura_contadores (entidad_id,familia,ejercicio,ultimo,created_at,updated_at) VALUES (?,'X',2028,1,'x','x')").bind(E1).run(), /CHECK constraint failed/);
  await assert.rejects(DB.prepare("INSERT INTO g_factura_contadores (entidad_id,familia,ejercicio,ultimo,created_at,updated_at) VALUES (?,'F',1999,1,'x','x')").bind(E1).run(), /CHECK constraint failed/);
  // Borrador válido en su versión: lo único que falla es que nadie reservó la secuencia 7.
  const f = await alta();
  await assert.rejects(DB.prepare("INSERT INTO g_facturas_prueba (id,factura_id,entidad_id,ejercicio,secuencia,serie,numero,fecha_emision,version_origen,snapshot_json,sha256,request_hash,created_by,created_at) VALUES (?,?,?,2027,7,'PR-2027','PR-2027-007','2027-01-01',1,'{}','x','x','qa','x')").bind(UUID(), f.id, E1).run(), /secuencia_sin_contador/);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM g_facturas_prueba').first()).n, 0);
});

test('muestra PR: numera el borrador emitido, congela entidad y factura, y no toca g_facturas ni la caja', async (t) => {
  const { DB, api, alta, contadores, count, filaFactura } = await fixture(t);
  const f = await alta(); const antes = await filaFactura(f.id), caja = await count('fin_movimientos'), eventos = await count('g_fiscal_eventos');
  const body = prueba(1, '2027-02-15');
  const r = await api(`facturas/${f.id}/pruebas`, 'POST', body); assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(r.item.id, body.id); assert.equal(r.item.numero, 'PR-2027-001'); assert.equal(r.item.serie, 'PR-2027');
  assert.equal(r.item.ejercicio, 2027); assert.equal(r.item.secuencia, 1); assert.equal(r.item.fecha_emision, '2027-02-15');
  assert.equal(r.item.factura_id, f.id); assert.equal(r.item.familia, 'PR'); assert.equal(r.item.validez_fiscal, 'ninguna'); assert.equal(r.item.version_origen, 1);
  assert.equal(r.item.request_hash, undefined); assert.equal(r.item.snapshot_json, undefined);
  assert.deepEqual(r.item.snapshot.entidad, { nombre: 'Sociedad Uno', nif: 'FICTICIO-UNO', direccion: 'Dirección uno' });
  assert.deepEqual(r.item.snapshot.factura, fromRow(await DB.prepare("SELECT f.*, (SELECT COUNT(*) FROM g_documentos d WHERE d.tipo='factura' AND d.objeto_id=f.id) AS documentos_count, (SELECT COUNT(*) FROM g_documentos d WHERE d.tipo='factura' AND d.objeto_id=f.id AND d.clase='factura') AS originales_count FROM g_facturas f WHERE f.id=?").bind(f.id).first()));
  assert.equal(r.item.snapshot.factura.version, 1); assert.equal(r.item.snapshot.factura.numero, null); assert.equal(r.item.snapshot.factura.total, 12100);
  const stored = await DB.prepare('SELECT snapshot_json,sha256 FROM g_facturas_prueba WHERE id=?').bind(body.id).first();
  assert.equal(stored.sha256, await digest(stored.snapshot_json));
  // El borrador sigue siendo borrador sin número: ni versión, ni fecha, ni caja, ni libro.
  assert.deepEqual(await filaFactura(f.id), antes);
  assert.equal(await count('fin_movimientos'), caja);
  assert.equal(await count('g_fiscal_eventos'), eventos + 1); assert.equal(await count('g_fiscal_eventos', "tipo='factura_prueba'"), 1);
  assert.equal((await api(`facturas/${f.id}`)).item.estado, 'borrador');
  // Segunda muestra del mismo borrador: siguiente número, misma serie.
  const r2 = await api(`facturas/${f.id}/pruebas`, 'POST', prueba(1, '2027-02-16')); assert.equal(r2.status, 201); assert.equal(r2.item.numero, 'PR-2027-002');
  assert.deepEqual(await contadores(), [{ entidad_id: E1, familia: 'PR', ejercicio: 2027, ultimo: 2 }]);
  // El borrador y la entidad cambian después: la copia guardada no.
  assert.equal((await api(`facturas/${f.id}`, 'PATCH', { version: 1, nota: 'Edición posterior', lineas: [line({ precio_unitario: 99999 })] })).item.version, 2);
  await DB.prepare('UPDATE g_entidades SET nombre=?,direccion=?,version=version+1 WHERE id=?').bind('Nombre nuevo', 'Dirección nueva', E1).run();
  const leida = await api(`facturas-prueba/${body.id}`); assert.equal(leida.status, 200);
  assert.deepEqual(leida.item, r.item);
  assert.equal(leida.item.snapshot.entidad.nombre, 'Sociedad Uno'); assert.equal(leida.item.snapshot.factura.total, 12100); assert.equal(leida.item.snapshot.factura.version, 1);
  const lista = await api(`facturas/${f.id}/pruebas`); assert.equal(lista.status, 200);
  assert.deepEqual(lista.items.map((p) => p.numero).sort(), ['PR-2027-001', 'PR-2027-002']); assert.equal(lista.mas, false);
  // Leer el histórico no reserva números.
  assert.deepEqual(await contadores(), [{ entidad_id: E1, familia: 'PR', ejercicio: 2027, ultimo: 2 }]);
  assert.equal((await api(`facturas/${UUID()}/pruebas`)).status, 404);
});

test('reintento con el mismo ID devuelve la misma copia aunque el borrador cambie; otro cuerpo 409; versión obsoleta no consume', async (t) => {
  const { api, alta, contadores, count } = await fixture(t);
  const f = await alta(), body = prueba(1, '2027-03-01');
  const first = await api(`facturas/${f.id}/pruebas`, 'POST', body); assert.equal(first.status, 201);
  const again = await api(`facturas/${f.id}/pruebas`, 'POST', body); assert.equal(again.status, 200); assert.deepEqual(again.item, first.item);
  assert.equal((await api(`facturas/${f.id}`, 'PATCH', { version: 1, nota: 'Cambio' })).item.version, 2);
  // Misma petición tras el cambio: sigue devolviendo la copia guardada, no la versión nueva ni un 409.
  const later = await api(`facturas/${f.id}/pruebas`, 'POST', body); assert.equal(later.status, 200); assert.deepEqual(later.item, first.item);
  assert.equal((await api(`facturas/${f.id}/pruebas`, 'POST', { ...body, fecha_emision: '2027-03-02' })).error, 'id_reutilizado');
  assert.equal((await api(`facturas/${f.id}/pruebas`, 'POST', { ...body, version: 2 })).error, 'id_reutilizado');
  const otro = await alta(); assert.equal((await api(`facturas/${otro.id}/pruebas`, 'POST', body)).error, 'id_reutilizado');
  // Versión obsoleta (el borrador ya va por la 2): sin número consumido.
  assert.equal((await api(`facturas/${f.id}/pruebas`, 'POST', prueba(1, '2027-03-03'))).error, 'version_desactualizada');
  assert.equal((await api(`facturas/${f.id}/pruebas`, 'POST', prueba(3, '2027-03-03'))).error, 'version_desactualizada');
  assert.deepEqual(await contadores(), [{ entidad_id: E1, familia: 'PR', ejercicio: 2027, ultimo: 1 }]);
  assert.equal(await count('g_facturas_prueba'), 1); assert.equal(await count('g_fiscal_eventos', "tipo='factura_prueba'"), 1);
  const next = await api(`facturas/${f.id}/pruebas`, 'POST', prueba(2, '2027-03-03')); assert.equal(next.status, 201); assert.equal(next.item.numero, 'PR-2027-002');
  assert.equal(next.item.snapshot.factura.version, 2); assert.equal(next.item.snapshot.factura.nota, 'Cambio');
});

test('el ejercicio cambia y reinicia sin afectar a los anteriores; emisores separados; PR nunca toca F/R', async (t) => {
  const { DB, api, alta, contadores } = await fixture(t);
  const f1 = await alta(), f2 = await alta({ entidad_id: E2 });
  const numeros = [];
  for (const [f, fecha] of [[f1, '2027-12-31'], [f1, '2027-06-01'], [f1, '2028-01-01'], [f1, '2027-01-01'], [f2, '2027-05-05'], [f1, '2028-12-31']]) {
    const r = await api(`facturas/${f.id}/pruebas`, 'POST', prueba(1, fecha)); assert.equal(r.status, 201, JSON.stringify(r)); numeros.push(r.item.numero);
  }
  assert.deepEqual(numeros, ['PR-2027-001', 'PR-2027-002', 'PR-2028-001', 'PR-2027-003', 'PR-2027-001', 'PR-2028-002']);
  assert.deepEqual(await contadores(), [
    { entidad_id: E2, familia: 'PR', ejercicio: 2027, ultimo: 1 },
    { entidad_id: E1, familia: 'PR', ejercicio: 2027, ultimo: 3 }, { entidad_id: E1, familia: 'PR', ejercicio: 2028, ultimo: 2 },
  ]);
  // Una reserva F del mismo emisor y año (helper, sin ruta) no mueve PR, y PR no la mueve a ella.
  await DB.exec('CREATE TABLE t_numerados (id TEXT PRIMARY KEY, entidad_id TEXT, familia TEXT, ejercicio INTEGER, secuencia INTEGER, serie TEXT, numero TEXT)');
  const num = { entidad_id: E1, familia: 'F', ejercicio: 2027 };
  await DB.batch([reservarNumero(DB, { ...num, now: 'x' }), insertarNumerado(DB, 't_numerados', ['id'], [UUID()], num)]);
  assert.equal((await api(`facturas/${f1.id}/pruebas`, 'POST', prueba(1, '2027-07-07'))).item.numero, 'PR-2027-004');
  assert.deepEqual((await contadores()).filter((c) => c.entidad_id === E1 && c.ejercicio === 2027), [{ entidad_id: E1, familia: 'F', ejercicio: 2027, ultimo: 1 }, { entidad_id: E1, familia: 'PR', ejercicio: 2027, ultimo: 4 }]);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM g_facturas_prueba WHERE familia<>'PR'").first()).n, 0);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM g_facturas WHERE numero IS NOT NULL").first()).n, 0);
});

test('peticiones concurrentes: mismo ID una sola copia; IDs distintos sin duplicados ni huecos', async (t) => {
  const { api, alta, contadores, count } = await fixture(t);
  const f = await alta(), body = prueba(1, '2027-04-01');
  const same = await Promise.all([api(`facturas/${f.id}/pruebas`, 'POST', body), api(`facturas/${f.id}/pruebas`, 'POST', body)]);
  assert.deepEqual(same.map((r) => r.status).sort(), [200, 201]); assert.deepEqual(same[0].item, same[1].item);
  assert.equal(await count('g_facturas_prueba'), 1); assert.equal(await count('g_fiscal_eventos', "tipo='factura_prueba'"), 1);
  assert.deepEqual(await contadores(), [{ entidad_id: E1, familia: 'PR', ejercicio: 2027, ultimo: 1 }]);
  const many = await Promise.all(Array.from({ length: 6 }, () => api(`facturas/${f.id}/pruebas`, 'POST', prueba(1, '2027-04-02'))));
  assert.ok(many.every((r) => r.status === 201), JSON.stringify(many.map((r) => r.status)));
  assert.deepEqual(many.map((r) => r.item.secuencia).sort((a, b) => a - b), [2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(many.map((r) => r.item.numero)).size, 6);
  assert.deepEqual(await contadores(), [{ entidad_id: E1, familia: 'PR', ejercicio: 2027, ultimo: 7 }]);
  assert.equal(await count('g_facturas_prueba'), 7);
});

test('fecha obligatoria y válida, ejercicio de esa fecha, solo borrador emitida; entidad incompleta solo como PR marcada', async (t) => {
  const { api, alta, contadores, count } = await fixture(t);
  const f = await alta();
  for (const [body, code] of [
    [{ id: UUID(), version: 1 }, 'fecha_invalida'], [{ id: UUID(), version: 1, fecha_emision: '2027-02-30' }, 'fecha_invalida'],
    [{ id: UUID(), version: 1, fecha_emision: '1999-12-31' }, 'fecha_invalida'], [{ id: UUID(), version: 1, fecha_emision: '2101-01-01' }, 'fecha_invalida'],
    [{ id: UUID(), version: 1, fecha_emision: '2027-02-15T00:00:00Z' }, 'fecha_invalida'], [{ id: UUID(), version: 1, fecha_emision: 20270215 }, 'fecha_invalida'],
    [{ id: 'no-uuid', version: 1, fecha_emision: '2027-02-15' }, 'id_invalido'], [{ id: UUID(), version: 1, fecha_emision: '2027-02-15', numero: 'X' }, 'campo_no_editable'],
  ]) { const r = await api(`facturas/${f.id}/pruebas`, 'POST', body); assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.error, code); }
  assert.equal((await api(`facturas/${f.id}/pruebas`, 'POST', { id: UUID(), fecha_emision: '2027-02-15' })).status, 400);
  assert.equal((await api(`facturas/${f.id}/pruebas`, 'POST', { id: UUID(), version: 0, fecha_emision: '2027-02-15' })).status, 400);
  assert.equal((await api(`facturas/${UUID()}/pruebas`, 'POST', prueba())).status, 404);
  // Recibidas y originales externos registrados no generan muestras de venta.
  const recibida = await alta({ tipo: 'recibida' });
  assert.equal((await api(`facturas/${recibida.id}/pruebas`, 'POST', prueba())).error, 'prueba_solo_borrador_emitida');
  const externa = (await api('facturas', 'POST', borrador({ estado: 'registrada', origen: 'externa', numero: 'EXT-1', fecha_emision: '2026-10-09', contraparte_nif: 'FICTICIO-001', contraparte_direccion: 'Calle 1' }))).item;
  assert.equal((await api(`facturas/${externa.id}/pruebas`, 'POST', prueba())).error, 'prueba_solo_borrador_emitida');
  assert.deepEqual(await contadores(), []); assert.equal(await count('g_facturas_prueba'), 0);
  // Fechas límite del año: el ejercicio es el escrito, con TZ=Pacific/Kiritimati activo.
  assert.equal((await api(`facturas/${f.id}/pruebas`, 'POST', prueba(1, '2027-12-31'))).item.numero, 'PR-2027-001');
  assert.equal((await api(`facturas/${f.id}/pruebas`, 'POST', prueba(1, '2028-01-01'))).item.numero, 'PR-2028-001');
  // Entidad incompleta (promotores sin NIF ni dirección) y sin originales: solo PR, marcada sin validez.
  const incompleta = await alta({ entidad_id: PENDING, contraparte_nombre: null, lineas: [line({ iva_bp: null })] });
  const r = await api(`facturas/${incompleta.id}/pruebas`, 'POST', prueba(1, '2027-05-05')); assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(r.item.numero, 'PR-2027-001'); assert.equal(r.item.validez_fiscal, 'ninguna'); assert.equal(typeof r.item.marca, 'string');
  assert.deepEqual(r.item.snapshot.entidad, { nombre: 'Promotores', nif: null, direccion: null });
  assert.equal(r.item.snapshot.validez_fiscal, 'ninguna'); assert.equal(r.item.snapshot.factura.lineas[0].iva_bp, null);
  assert.equal((await api(`facturas/${incompleta.id}/validar`, 'POST', { version: 1, revision: 'Intento' })).error, 'entidad_fiscal_incompleta');
});

test('un fallo al insertar el documento revierte la reserva: versión cambiada dentro de la transacción y secuencia agotada', async (t) => {
  const { DB, api, alta, contadores, count } = await fixture(t);
  const f = await alta();
  const num = { entidad_id: E1, familia: 'PR', ejercicio: 2027 }, cols = ['id', 'factura_id', 'fecha_emision', 'version_origen', 'snapshot_json', 'sha256', 'request_hash', 'created_by', 'created_at'];
  // Carrera: el batch llega con una versión que ya no es la del borrador. El trigger aborta todo.
  await assert.rejects(DB.batch([reservarNumero(DB, { ...num, now: 'x' }), insertarNumerado(DB, 'g_facturas_prueba', cols, [UUID(), f.id, '2027-01-01', 99, '{}', 'x', 'x', 'qa', 'x'], num)]), /version_desactualizada/);
  assert.deepEqual(await contadores(), []); assert.equal(await count('g_facturas_prueba'), 0);
  // Tipo/origen incorrectos tampoco pasan por debajo de la ruta.
  const recibida = await alta({ tipo: 'recibida' });
  await assert.rejects(DB.batch([reservarNumero(DB, { ...num, now: 'x' }), insertarNumerado(DB, 'g_facturas_prueba', cols, [UUID(), recibida.id, '2027-01-01', 1, '{}', 'x', 'x', 'qa', 'x'], num)]), /version_desactualizada/);
  assert.deepEqual(await contadores(), []);
  assert.equal((await api(`facturas/${f.id}/pruebas`, 'POST', prueba(1, '2027-01-01'))).item.numero, 'PR-2027-001');
  // Contador en el tope: la ruta responde 409 sin documento ni avance.
  await DB.prepare("INSERT INTO g_factura_contadores (entidad_id,familia,ejercicio,ultimo,created_at,updated_at) VALUES (?,'PR',2029,?,'x','x')").bind(E1, SECUENCIA_MAX).run();
  const r = await api(`facturas/${f.id}/pruebas`, 'POST', prueba(1, '2029-01-01')); assert.equal(r.status, 409); assert.equal(r.error, 'secuencia_agotada');
  assert.equal((await DB.prepare("SELECT ultimo FROM g_factura_contadores WHERE entidad_id=? AND familia='PR' AND ejercicio=2029").bind(E1).first()).ultimo, SECUENCIA_MAX);
  assert.equal(await count('g_facturas_prueba'), 1); assert.equal(await count('g_fiscal_eventos', "tipo='factura_prueba'"), 1);
});

test('la copia guardada es inmutable en SQLite y la lectura no reserva ni expone referencias privadas', async (t) => {
  const { DB, api, alta, contadores } = await fixture(t);
  const f = await alta(), r = await api(`facturas/${f.id}/pruebas`, 'POST', prueba(1, '2027-02-15')); assert.equal(r.status, 201);
  await assert.rejects(DB.prepare('UPDATE g_facturas_prueba SET fecha_emision=? WHERE id=?').bind('2027-02-16', r.item.id).run(), /prueba_inmutable/);
  await assert.rejects(DB.prepare('UPDATE g_facturas_prueba SET snapshot_json=? WHERE id=?').bind('{}', r.item.id).run(), /prueba_inmutable/);
  await assert.rejects(DB.prepare('DELETE FROM g_facturas_prueba WHERE id=?').bind(r.item.id).run(), /prueba_inmutable/);
  await assert.rejects(DB.prepare('INSERT INTO g_facturas_prueba (id,factura_id,entidad_id,ejercicio,secuencia,serie,numero,fecha_emision,version_origen,snapshot_json,sha256,request_hash,created_by,created_at) VALUES (?,?,?,2027,1,\'PR-2027\',\'PR-2027-001\',\'2027-01-01\',1,\'{}\',\'x\',\'x\',\'qa\',\'x\')').bind(UUID(), f.id, E1).run(), /UNIQUE constraint failed/);
  await assert.rejects(DB.prepare('INSERT INTO g_facturas_prueba (id,factura_id,entidad_id,ejercicio,secuencia,serie,numero,fecha_emision,version_origen,snapshot_json,sha256,request_hash,created_by,created_at) VALUES (?,?,?,2027,1,\'PR-2027\',\'PR-2027-009\',\'2027-01-01\',1,\'{}\',\'x\',\'x\',\'qa\',\'x\')').bind(UUID(), f.id, E1).run(), /CHECK constraint failed/);
  for (let i = 0; i < 3; i++) {
    const read = await api(`facturas-prueba/${r.item.id}`); assert.equal(read.status, 200); assert.deepEqual(read.item, r.item);
    assert.equal(read.item.request_hash, undefined); assert.equal(read.item.snapshot_json, undefined);
    assert.equal((await api(`facturas/${f.id}/pruebas`)).items.length, 1);
  }
  assert.equal((await api(`facturas-prueba/${UUID()}`)).status, 404); assert.equal((await api('facturas-prueba/no-uuid')).error, 'id_invalido');
  assert.deepEqual(await contadores(), [{ entidad_id: E1, familia: 'PR', ejercicio: 2027, ultimo: 1 }]);
  // La factura de prueba no es un objeto adjuntable ni consultable como factura del libro.
  assert.equal((await api(`facturas/${r.item.id}`)).status, 404);
});

test('emisión real: 409 siempre tras autorizar, sin tocar D1 ni reservar, con o sin cuerpo o banderas', async (t) => {
  const { env, call, api, alta, contadores, count } = await fixture(t);
  const f = await alta(), DB = env.DB;
  env.DB = { prepare() { assert.fail('emitir no puede consultar'); }, batch() { assert.fail('emitir no puede escribir'); } };
  env.EMISION_FISCAL = '1'; env.SIF_ENABLED = 'true'; env.FACTURACION_REAL = 'on';
  try {
    for (const body of [undefined, {}, { version: 1 }, { version: 1, fecha_emision: '2027-02-15', forzar: true }, { modo: 'real' }]) {
      const response = await call(`facturas/${f.id}/emitir`, 'POST', body); assert.equal(response.status, 409, JSON.stringify(body));
      assert.equal((await response.json()).error, 'emision_fiscal_no_configurada');
    }
    assert.equal((await call(`facturas/${UUID()}/emitir`, 'POST', { version: 1 })).status, 409);
    assert.equal((await call('facturas/no-uuid/emitir', 'POST', { version: 1 })).status, 409);
  } finally { env.DB = DB; delete env.EMISION_FISCAL; delete env.SIF_ENABLED; delete env.FACTURACION_REAL; }
  assert.deepEqual(await contadores(), []); assert.equal(await count('g_facturas_prueba'), 0);
  assert.equal((await api(`facturas/${f.id}`)).item.version, 1); assert.equal((await api(`facturas/${f.id}`)).item.numero, null);
  assert.equal(await count('g_fiscal_eventos', "tipo<>'factura_alta'"), 0);
});

test('las rutas de numeración cierran a no socios antes de D1', async (t) => {
  const { env, call } = await fixture(t);
  env.DB = { prepare() { assert.fail('no puede consultar'); }, batch() { assert.fail('no puede escribir'); } };
  const rutas = [['POST', `facturas/${UUID()}/emitir`], ['POST', `facturas/${UUID()}/pruebas`], ['GET', `facturas/${UUID()}/pruebas`], ['GET', `facturas-prueba/${UUID()}`]];
  assert.ok(rutas.every(([m, p]) => fiscal.routes.some((r) => r.method === m && p.replace(/[0-9a-f-]{36}/, ':id') === r.path.replace('/api/admin/gestion/', ''))));
  for (const scope of [{ ...PERSON, email: 'ajeno@velai.test' }, { ...PERSON, role: 'cliente', tenantId: 'x' }, { ...PERSON, role: 'cliente', email: PERSON.email }]) {
    for (const [method, path] of rutas) {
      const response = await call(path, method, method === 'GET' ? undefined : prueba(), scope);
      assert.equal(response.status, 403, `${method} ${path}`); assert.equal((await response.json()).error, 'not_authorized');
    }
  }
});
