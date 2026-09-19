import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { testing } from '../worker/app.js';
import { finanzas } from '../worker/routes/finanzas.js';
import { esSocio } from '../worker/middleware.js';
import { sqliteD1 } from './helpers/sqlite-d1.js';

const SOCIO = { role: 'velai', tenantId: null, email: 'uno@velai.test' };
const ctx = { waitUntil() {} };
async function fixture(t) {
  const DB = await sqliteD1(); t.after(() => DB.close());
  await DB.exec('PRAGMA foreign_keys=ON;');
  const env = { DB, SOCIOS_EMAILS: ' UNO@velai.test, dos@velai.test ' };
  await DB.exec("DELETE FROM fin_socios; INSERT INTO fin_socios (email,nombre) VALUES ('uno@velai.test','Uno'),('dos@velai.test','Dos');");
  const call = async (path, method = 'GET', body, scope = SOCIO) => {
    const url = new URL(`https://admin.test/api/admin/${path}`);
    const req = new Request(url, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return testing.adminRouter(req, env, ctx, url.pathname, url, {}, scope);
  };
  const api = async (path, method, body, scope) => (await call(path, method, body, scope)).json();
  const conceptos = (await api('finanzas/conceptos')).conceptos;
  const mov = (tipo = 'ingreso', moneda = 'EUR', importe = 10000, fecha = '2025-02-10', extra = {}) => api('finanzas/movimientos', 'POST', { tipo, moneda, importe, fecha, concepto_id: conceptos[tipo][0].id, ...extra });
  const reparto = (lineas = [{ beneficiario: SOCIO.email, importe: 500 }], extra = {}) => api('finanzas/repartos', 'POST', { fecha: '2025-02-10', moneda: 'EUR', lineas, ...extra });
  return { env, DB, api, call, conceptos, mov, reparto };
}
const error = (status, code) => (e) => e.status === status && e.code === code;

test('cada endpoint cierra a no-socios antes de consultar; fin_socios no concede acceso', async (t) => {
  const { DB, api, env } = await fixture(t);
  await DB.prepare('INSERT INTO fin_socios (email,nombre) VALUES (?,?)').bind('intruso@velai.test', 'Intruso').run();
  for (const scope of [{ ...SOCIO, email: 'intruso@velai.test' }, { ...SOCIO, role: 'cliente' }]) {
    for (const route of finanzas.routes) {
      const path = route.path.replace('/api/admin/', '').replace(':id', '1').replace(':email', 'uno%40velai.test');
      const original = env.DB;
      env.DB = { prepare() { assert.fail('no debe tocar D1'); }, batch() { assert.fail('no debe tocar D1'); } };
      try { await assert.rejects(api(path, route.method, route.method === 'GET' ? undefined : {}, scope), error(403, 'not_authorized')); }
      finally { env.DB = original; }
    }
  }
  assert.equal(esSocio({}, SOCIO), false);
  assert.equal(esSocio(env, { ...SOCIO, email: SOCIO.email.toUpperCase() }), true);
  assert.equal((await api('me')).socio, true);
  assert.equal((await api('me', 'GET', undefined, { ...SOCIO, email: 'intruso@velai.test' })).socio, false);
});

test('el permiso «finanzas» de admin_permisos abre el libro; quitarlo lo cierra (0040)', async (t) => {
  const { env, DB, api } = await fixture(t);
  // Admin del panel SIN entrada en SOCIOS_EMAILS: hoy no entra.
  const email = 'estiven@velai.test';
  await DB.prepare('INSERT INTO admin_users (email,created_by,created_at) VALUES (?,?,?)').bind(email, 'raiz@velai.test', '2026-09-19').run();
  env.ADMIN_EMAILS = 'raiz@velai.test';
  const sinPermiso = await testing.resolveScope(env, email);
  assert.equal(sinPermiso.role, 'velai');
  assert.deepEqual(sinPermiso.permisos, []);
  assert.equal(esSocio(env, sinPermiso), false);
  assert.equal((await api('me', 'GET', undefined, sinPermiso)).socio, false);

  await DB.prepare('INSERT INTO admin_permisos (email,permiso,otorgado_por,otorgado_en) VALUES (?,?,?,?)')
    .bind(email, 'finanzas', 'raiz@velai.test', '2026-09-19').run();
  const conPermiso = await testing.resolveScope(env, email.toUpperCase());
  assert.deepEqual(conPermiso.permisos, ['finanzas']);
  assert.equal(esSocio(env, conPermiso), true);
  assert.equal((await api('me', 'GET', undefined, conPermiso)).socio, true);
  assert.ok((await api('finanzas/resumen', 'GET', undefined, conPermiso)).monedas);

  // La raíz del entorno lleva todos los permisos sin fila que lo diga.
  const raiz = await testing.resolveScope(env, 'raiz@velai.test');
  assert.equal(raiz.raiz, true);
  assert.equal(esSocio({ ...env, SOCIOS_EMAILS: '' }, raiz), true);

  // Y revocarlo cierra: el scope se resuelve por petición, no se cachea.
  await DB.prepare('DELETE FROM admin_permisos WHERE email=?').bind(email).run();
  assert.equal(esSocio(env, await testing.resolveScope(env, email)), false);
});

test('aritmética de ambas monedas: caja de origen, beneficio del periodo y reparto por persona', async (t) => {
  const { mov, reparto, api } = await fixture(t);
  await mov('ingreso', 'EUR', 10000, '2025-01-01');
  await mov('ingreso', 'EUR', 5000); await mov('gasto', 'EUR', 2000); await mov('egreso', 'EUR', 300);
  await mov('ingreso', 'COP', 150000); await mov('gasto', 'COP', 200000);
  await reparto([{ beneficiario: SOCIO.email, importe: 700 }, { beneficiario: 'dos@velai.test', importe: 1000 }]);
  const r = await api('finanzas/resumen?desde=2025-02-01&hasta=2025-02-28');
  assert.deepEqual(r.monedas.EUR, { ingresos: 5000, gastos: 2000, beneficio: 3000, egresos: 2000, caja: 11000, sin_repartir: 11000 });
  assert.deepEqual(r.monedas.COP, { ingresos: 150000, gastos: 200000, beneficio: -50000, egresos: 0, caja: -50000, sin_repartir: -50000 });
  assert.equal(r.repartido.find((r) => r.email === SOCIO.email).importe, 700);
  assert.equal(r.conceptos.filter((r) => r.moneda === 'COP').length, 2);
  const vacio = await api('finanzas/resumen?desde=2025-03-01&hasta=2025-03-31');
  assert.equal(vacio.monedas.EUR.ingresos, 0); assert.equal(vacio.monedas.EUR.caja, 11000);
});

test('validación de tipo, concepto, importe, moneda y fechas reales', async (t) => {
  const { mov, conceptos } = await fixture(t);
  await assert.rejects(mov('ingreso', 'EUR', 1, '2025-02-10', { concepto_id: conceptos.gasto[0].id }), error(400, 'concepto_de_otro_tipo'));
  for (const n of [0, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(mov('ingreso', 'EUR', n), error(400, 'importe_invalido'));
  await assert.rejects(mov('ingreso', 'USD'), error(400, 'moneda_invalida'));
  for (const date of ['2025-02-29', '2025-04-31', '2024-12-31', '2025-2-01', '2099-01-01']) await assert.rejects(mov('ingreso', 'EUR', 1, date), error(400, 'fecha_invalida'));
  await mov('ingreso', 'EUR', 1, new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  await assert.rejects(mov('egreso', 'COP', 1, '2025-02-10', { tenant_id: 'ajeno' }), error(400, 'cliente_invalido'));
  await assert.rejects(mov('ingreso', 'EUR', 1, '2025-02-10', { beneficiario: SOCIO.email }), error(400, 'usar_repartos'));
});

test('catálogo: duplicados, renombrar, ordenar, desactivar y proteger el histórico', async (t) => {
  const { api, mov, conceptos } = await fixture(t);
  const id = conceptos.ingreso[0].id;
  await assert.rejects(api('finanzas/conceptos', 'POST', { tipo: 'ingreso', nombre: conceptos.ingreso[0].nombre }), error(409, 'concepto_duplicado'));
  const m = await mov();
  await assert.rejects(api(`finanzas/conceptos/${id}`, 'DELETE'), error(409, 'concepto_en_uso'));
  await api(`finanzas/conceptos/${id}`, 'PATCH', { activo: 0, nombre: 'Cuota corregida', position: 25 });
  assert.equal((await api('finanzas/conceptos')).conceptos.ingreso.some((r) => r.id === id), false);
  assert.equal((await api('finanzas/conceptos?todos=1')).conceptos.ingreso.find((r) => r.id === id).position, 25);
  assert.equal((await api('finanzas/movimientos')).movimientos[0].concepto_nombre, 'Cuota corregida');
  await assert.rejects(mov(), error(400, 'concepto_inactivo'));
  await api(`finanzas/movimientos/${m.id}`, 'PATCH', { nota: 'Corrección histórica', importe: 29 });
  assert.equal((await api('finanzas/resumen')).monedas.EUR.caja, 29);
  const nuevo = await api('finanzas/conceptos', 'POST', { tipo: 'gasto', nombre: 'Temporal' });
  await api(`finanzas/conceptos/${nuevo.id}`, 'DELETE');
  await api(`finanzas/movimientos/${m.id}`, 'DELETE');
  assert.equal((await api('finanzas/resumen')).monedas.EUR.caja, 0);
});

test('repartos: validación completa antes de escribir y rollback real si falla una línea del batch', async (t) => {
  const { DB, reparto } = await fixture(t);
  await assert.rejects(reparto([{ beneficiario: SOCIO.email, importe: 500 }, { beneficiario: SOCIO.email, importe: 0 }]), error(400, 'importe_invalido'));
  await assert.rejects(reparto([{ beneficiario: 'no@velai.test', importe: 100 }]), error(400, 'beneficiario_desconocido'));
  await assert.rejects(reparto([{ beneficiario: SOCIO.email, importe: 100, moneda: 'COP' }]), error(400, 'moneda_invalida'));
  await assert.rejects(reparto([]), error(400, 'lineas_invalidas'));
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM fin_repartos').first()).n, 0);
  // Fuerza un error SQL en la SEGUNDA línea: demuestra atomicidad de la transacción.
  await DB.exec("CREATE TRIGGER fallo_linea BEFORE INSERT ON fin_movimientos WHEN NEW.importe=777 BEGIN SELECT RAISE(ABORT,'fallo deliberado'); END;");
  await assert.rejects(reparto([{ beneficiario: SOCIO.email, importe: 500 }, { beneficiario: SOCIO.email, importe: 777 }]), /fallo deliberado/);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM fin_repartos').first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM fin_movimientos').first()).n, 0);
});

test('reparto negativo se registra, no se edita ni borra una línea suelta; borrar conjunto restaura caja', async (t) => {
  const { reparto, api, DB } = await fixture(t);
  const r = await reparto(); assert.equal(r.aviso, 'caja_negativa'); assert.equal(r.caja, -500);
  const h = await api('finanzas/repartos');
  assert.equal(h.socios.find((s) => s.email === SOCIO.email).nombre, 'Uno'); assert.equal(h.repartido[0].importe, 500);
  const linea = h.repartos[0].lineas[0];
  for (const method of ['PATCH', 'DELETE']) await assert.rejects(api(`finanzas/movimientos/${linea.id}`, method, { importe: 1 }), error(409, 'linea_de_reparto'));
  await DB.exec("CREATE TRIGGER fallo_borrado BEFORE DELETE ON fin_repartos BEGIN SELECT RAISE(ABORT,'no borrar'); END;");
  await assert.rejects(api(`finanzas/repartos/${r.id}`, 'DELETE'), /no borrar/);
  assert.equal((await api('finanzas/repartos')).repartos[0].lineas.length, 1);
  await DB.exec('DROP TRIGGER fallo_borrado;');
  await api(`finanzas/repartos/${r.id}`, 'DELETE');
  assert.equal((await api('finanzas/resumen')).monedas.EUR.caja, 0);
  assert.equal((await api('finanzas/repartos')).repartos.length, 0);
});

test('filtros y CSV completos, con unidades correctas y fórmulas neutralizadas', async (t) => {
  const { DB, api, call, mov, conceptos } = await fixture(t);
  await DB.prepare("INSERT INTO tenants (id,slug,name,channel_address,system_prompt,created_at,updated_at) VALUES ('fin-cliente','fin-cliente','Cliente Finanzas','web:fin-cliente','x','2025-01-01','2025-01-01')").run();
  await mov('ingreso', 'EUR', 150029, '2025-02-10', { tenant_id: 'fin-cliente', nota: '=SUM(A1)' });
  await mov('ingreso', 'COP', 150000);
  const query = `?desde=2025-02-01&hasta=2025-02-28&tipo=ingreso&moneda=EUR&concepto=${conceptos.ingreso[0].id}&tenant=fin-cliente`;
  const rows = (await api('finanzas/movimientos' + query)).movimientos;
  assert.equal(rows.length, 1); assert.equal(rows[0].tenant_name, 'Cliente Finanzas');
  const csv = await call('finanzas/export.csv' + query);
  assert.equal(csv.headers.get('Cache-Control'), 'no-store');
  const text = await csv.text();
  assert.match(text, /"1500.29"/); assert.match(text, /"'=SUM\(A1\)"/); assert.equal(text.includes('COP'), false);
  assert.match(await (await call('finanzas/export.csv?moneda=COP')).text(), /"150000"/);
  await assert.rejects(api('finanzas/movimientos?desde=2025-02-30'), error(400, 'fecha_invalida'));
  await assert.rejects(api('finanzas/resumen?desde=2025-03-01&hasta=2025-02-01'), error(400, 'periodo_invalido'));
});

test('paginación de 50 sin perder movimientos con la misma fecha y timestamp', async (t) => {
  const { DB, api, conceptos, call } = await fixture(t);
  await DB.batch(Array.from({ length: 55 }, (_, i) => DB.prepare(`INSERT INTO fin_movimientos
    (id,tipo,concepto_id,fecha,moneda,importe,created_by,created_at) VALUES (?,'ingreso',?,'2025-02-10','EUR',1,'test','2025-02-10T12:00:00Z')`).bind(`m-${String(i).padStart(3, '0')}`, conceptos.ingreso[0].id)));
  const a = await api('finanzas/movimientos'); assert.equal(a.movimientos.length, 50);
  const b = await api(`finanzas/movimientos?cursor=${encodeURIComponent(a.nextCursor)}`); assert.equal(b.movimientos.length, 5); assert.equal(b.nextCursor, null);
  assert.equal(new Set([...a.movimientos, ...b.movimientos].map((r) => r.id)).size, 55);
  assert.equal((await (await call('finanzas/export.csv')).text()).split('\r\n').length, 56);
});

test('flechas del catálogo desplazan el orden; un renombrado duplicado revierte el desplazamiento', async (t) => {
  const { api, conceptos } = await fixture(t);
  const [first, second] = conceptos.ingreso;
  await api(`finanzas/conceptos/${first.id}`, 'PATCH', { position: second.position });
  assert.deepEqual((await api('finanzas/conceptos')).conceptos.ingreso.slice(0, 2).map((c) => c.id), [second.id, first.id]);
  await assert.rejects(api(`finanzas/conceptos/${first.id}`, 'PATCH', { position: 0, nombre: second.nombre }), error(409, 'concepto_duplicado'));
  assert.deepEqual((await api('finanzas/conceptos')).conceptos.ingreso.slice(0, 2).map((c) => [c.id, c.position]), [[second.id, 0], [first.id, 1]]);
});

// El reparto busca su egreso por la MARCA del catálogo, no por el texto: renombrarlo
// desde la pestaña Conceptos dejaba el siguiente reparto en un 409 inexplicable.
test('el concepto que firma los repartos se reordena, pero no se renombra, apaga ni borra', async (t) => {
  const { api, conceptos, reparto } = await fixture(t);
  const concepto = conceptos.egreso.find((c) => c.nombre === 'Reparto a socios');
  assert.equal(concepto.sistema, 1);
  for (const body of [{ nombre: 'Otro nombre' }, { activo: 0 }, { nombre: 'Otro', activo: 0 }]) {
    await assert.rejects(api(`finanzas/conceptos/${concepto.id}`, 'PATCH', body), error(409, 'concepto_del_sistema'));
  }
  await assert.rejects(api(`finanzas/conceptos/${concepto.id}`, 'DELETE'), error(409, 'concepto_del_sistema'));
  const segundo = conceptos.egreso[1];
  await api(`finanzas/conceptos/${concepto.id}`, 'PATCH', { position: segundo.position });
  const egresos = (await api('finanzas/conceptos')).conceptos.egreso;
  assert.deepEqual(egresos.slice(0, 2).map((c) => c.id), [segundo.id, concepto.id]);
  assert.equal(egresos.find((c) => c.id === concepto.id).nombre, 'Reparto a socios');
  // Movido de sitio, el reparto sigue encontrándolo.
  await reparto([{ beneficiario: SOCIO.email, importe: 150000 }], { moneda: 'COP' });
  const resumen = await api('finanzas/resumen');
  assert.equal(resumen.monedas.COP.caja, -150000); assert.equal(resumen.monedas.EUR.caja, 0);
});

test('sin el concepto marcado en el catálogo, el reparto falla sin escribir nada', async (t) => {
  const { api, conceptos, reparto, DB } = await fixture(t);
  const concepto = conceptos.egreso.find((c) => c.nombre === 'Reparto a socios');
  // Retirado a mano en D1: la única vía que queda cuando el panel ya no lo permite.
  await DB.prepare('DELETE FROM fin_conceptos WHERE id=?').bind(concepto.id).run();
  await assert.rejects(reparto(), error(409, 'concepto_reparto_no_disponible'));
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM fin_repartos').first()).n, 0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM fin_movimientos').first()).n, 0);
  // Un concepto nuevo NO nace marcado: la marca solo la pone la migración.
  const nuevo = await api('finanzas/conceptos', 'POST', { tipo: 'egreso', nombre: 'Reparto a socios' });
  assert.equal((await DB.prepare('SELECT sistema FROM fin_conceptos WHERE id=?').bind(nuevo.id).first()).sistema, 0);
  await assert.rejects(reparto(), error(409, 'concepto_reparto_no_disponible'));
});

test('socios: alta desde el panel, normalización, duplicados y validación; no concede acceso', async (t) => {
  const { api, reparto, env, DB } = await fixture(t);
  const email = 'ana+fin@velai.test';
  await api('finanzas/socios', 'POST', { email: ' ANA+FIN@velai.test ', nombre: ' Ana ' });
  assert.deepEqual((await api('finanzas/socios')).socios.find((s) => s.email === email), { email, nombre: 'Ana', activo: 1, tiene_repartos: 0 });
  // Quién dio de alta a quién queda en la ficha, no solo en el log.
  const alta = await DB.prepare('SELECT created_by,created_at FROM fin_socios WHERE email=?').bind(email).first();
  assert.equal(alta.created_by, SOCIO.email); assert.match(alta.created_at, /^20\d\d-/);
  await assert.rejects(api('finanzas/socios', 'POST', { email: email.toUpperCase(), nombre: 'Otra' }), error(409, 'socio_duplicado'));
  for (const b of [{ email: 'no-es-correo', nombre: 'Ana' }, { email: 7, nombre: 'Ana' }, { email, nombre: '' }]) {
    await assert.rejects(api('finanzas/socios', 'POST', b), (e) => e.status === 400);
  }
  assert.equal(esSocio(env, { ...SOCIO, email }), false);
  await assert.rejects(api('finanzas/socios', 'GET', undefined, { ...SOCIO, email }), error(403, 'not_authorized'));
  await reparto([{ beneficiario: email, importe: 500 }]);
  assert.equal((await api('finanzas/repartos')).repartido.find((s) => s.email === email).importe, 500);
});

test('editar nombre y correo conserva repartos, histórico y caja en ambas monedas', async (t) => {
  const { api, reparto, env } = await fixture(t);
  await reparto([{ beneficiario: SOCIO.email, importe: 100 }]);
  await reparto([{ beneficiario: SOCIO.email, importe: 2000 }], { moneda: 'COP' });
  const caja = (await api('finanzas/resumen')).monedas;
  const nuevo = 'corregido+uno@velai.test';
  await api(`finanzas/socios/${encodeURIComponent(SOCIO.email)}`, 'PATCH', { email: nuevo, nombre: 'Uno corregido' });
  const r = await api('finanzas/repartos');
  assert.deepEqual(r.repartido.map((s) => [s.email, s.nombre, s.moneda, s.importe]).sort(), [[nuevo, 'Uno corregido', 'COP', 2000], [nuevo, 'Uno corregido', 'EUR', 100]].sort());
  assert.ok(r.repartos.every((r) => r.lineas.every((l) => l.beneficiario === nuevo)));
  assert.deepEqual((await api('finanzas/resumen')).monedas, caja);
  assert.equal(esSocio(env, SOCIO), true); assert.equal(esSocio(env, { ...SOCIO, email: nuevo }), false);
  await api(`finanzas/socios/${encodeURIComponent(nuevo)}`, 'PATCH', { nombre: 'Nombre final' });
  await assert.rejects(api(`finanzas/socios/${encodeURIComponent(nuevo)}`, 'PATCH', { email: 'dos@velai.test' }), error(409, 'socio_duplicado'));
  assert.equal((await api('finanzas/repartos')).repartido[0].nombre, 'Nombre final');
});

test('la corrección de correo revierte también la ficha si falla el cambio del histórico', async (t) => {
  const { api, reparto, DB } = await fixture(t);
  await reparto();
  await DB.exec("CREATE TRIGGER fallo_correo BEFORE UPDATE OF beneficiario ON fin_movimientos BEGIN SELECT RAISE(ABORT,'fallo historico'); END;");
  await assert.rejects(api(`finanzas/socios/${SOCIO.email}`, 'PATCH', { email: 'nuevo@velai.test', nombre: 'Nuevo' }), /fallo historico/);
  assert.equal((await api('finanzas/socios')).socios.some((s) => s.email === 'nuevo@velai.test'), false);
  assert.equal((await api('finanzas/repartos')).repartido[0].email, SOCIO.email);
});

test('quitar socio con pagos lo desactiva y conserva el histórico; reactivar permite volver a repartir', async (t) => {
  const { api, reparto, env } = await fixture(t);
  await reparto();
  const result = await api(`finanzas/socios/${SOCIO.email}`, 'DELETE');
  assert.equal(result.desactivado, true);
  assert.equal((await api('finanzas/socios')).socios.some((s) => s.email === SOCIO.email), false);
  const todos = await api('finanzas/socios?todos=1');
  assert.deepEqual(todos.socios.find((s) => s.email === SOCIO.email), { email: SOCIO.email, nombre: 'Uno', activo: 0, tiene_repartos: 1 });
  const r = await api('finanzas/repartos');
  assert.equal(r.socios.some((s) => s.email === SOCIO.email), false);
  assert.equal(r.repartido[0].nombre, 'Uno'); assert.equal(r.repartido[0].importe, 500);
  await assert.rejects(reparto(), error(400, 'beneficiario_desconocido'));
  assert.equal(esSocio(env, SOCIO), true);
  await api(`finanzas/socios/${SOCIO.email}`, 'PATCH', { activo: 1 });
  await reparto();
  assert.equal((await api('finanzas/resumen')).monedas.EUR.caja, -1000);
});

test('quitar socio sin pagos lo elimina incluso si su correo tiene permiso de acceso', async (t) => {
  const { api, env } = await fixture(t);
  assert.equal((await api(`finanzas/socios/${SOCIO.email}`, 'DELETE')).desactivado, false);
  assert.equal((await api('finanzas/socios?todos=1')).socios.some((s) => s.email === SOCIO.email), false);
  assert.equal((await api('finanzas/repartos')).socios.some((s) => s.email === SOCIO.email), false);
  assert.equal(esSocio(env, SOCIO), true);
});

test('baja concurrente al reparto: se rechaza el batch sin dejar cabecera ni líneas', async (t) => {
  const { DB, env, reparto } = await fixture(t);
  env.DB = { ...DB, async batch(statements) {
    await DB.prepare('UPDATE fin_socios SET activo=0 WHERE email=?').bind('dos@velai.test').run();
    return DB.batch(statements);
  } };
  await assert.rejects(reparto([{ beneficiario: SOCIO.email, importe: 100 }, { beneficiario: 'dos@velai.test', importe: 100 }]), error(400, 'beneficiario_desconocido'));
  assert.equal((await DB.prepare('SELECT count(*) AS n FROM fin_repartos').first()).n, 0);
  assert.equal((await DB.prepare('SELECT count(*) AS n FROM fin_movimientos').first()).n, 0);
});

test('migración 0038 sobre el libro desplegado conserva nombres, pagos y beneficiarios anteriores', async (t) => {
  const { DB } = await fixture(t);
  // Recrea el estado previo a 0038: la tabla de socios ya existe, pero todavía no
  // hay índice normalizado ni guarda de beneficiarios. Incluye un pago antiguo
  // a un correo que antes solo existía en SOCIOS_EMAILS.
  await DB.exec(`DROP TRIGGER fin_beneficiario_activo;
    DROP INDEX fin_socios_email_normalizado; DROP INDEX fin_mov_beneficiario;
    ALTER TABLE fin_socios DROP COLUMN created_by; ALTER TABLE fin_socios DROP COLUMN created_at;
    INSERT INTO fin_socios (email,nombre) VALUES ('juanesgarciag@gmail.com','Nombre conservado');
    INSERT INTO fin_repartos (id,fecha,moneda,created_by,created_at) VALUES ('legacy','2025-03-01','COP','test','2025-03-01');
    INSERT INTO fin_movimientos (id,tipo,concepto_id,fecha,moneda,importe,beneficiario,reparto_id,created_by,created_at)
    SELECT 'legacy','egreso',id,'2025-03-01','COP',150000,'historico@velai.test','legacy','test','2025-03-01'
    FROM fin_conceptos WHERE sistema=1;`);
  const before = await DB.prepare('SELECT * FROM fin_movimientos').all();
  await DB.exec(await readFile(new URL('../migrations/0038_fin_socios_gestion.sql', import.meta.url), 'utf8'));
  assert.deepEqual(await DB.prepare('SELECT * FROM fin_movimientos').all(), before);
  assert.equal((await DB.prepare("SELECT nombre FROM fin_socios WHERE email='juanesgarciag@gmail.com'").first()).nombre, 'Nombre conservado');
  assert.equal((await DB.prepare("SELECT activo FROM fin_socios WHERE email='historico@velai.test'").first()).activo, 1);
  assert.equal((await DB.prepare("SELECT activo FROM fin_socios WHERE email='botnexo.ia@gmail.com'").first()).activo, 1);
});
