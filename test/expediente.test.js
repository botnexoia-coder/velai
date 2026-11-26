import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { HttpError } from '../worker/app.js';
import { gestion } from '../worker/routes/gestion.js';
import { huella } from '../worker/gestion-financiera.js';
import { datosExpediente, hoyMadrid } from '../worker/expediente.js';
import { previewTarget } from '../worker/mobile-preview.js';
import { sqliteD1 } from './helpers/sqlite-d1.js';
const nuevo = () => crypto.randomUUID();
const SOCIO = {
  role: 'velai',
  tenantId: null,
  email: 'uno@velai.test'
};
const error = code => e => e.code === code;
async function fixture(t) {
  const DB = await sqliteD1();
  t.after(() => DB.close());
  await DB.exec('PRAGMA foreign_keys=ON;');
  const objects = new Map();
  const env = {
    DB,
    SOCIOS_EMAILS: SOCIO.email,
    FINANCE_DOCS: {
      async put(k, b) {
        objects.set(k, b);
      },
      async get(k) {
        return objects.has(k) ? {
          body: objects.get(k)
        } : null;
      },
      async delete(k) {
        objects.delete(k);
      }
    }
  };
  const scopes = new WeakMap();
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('scope', scopes.get(c.req.raw));
    c.set('config', {});
    await next();
  });
  app.route('/', gestion);
  app.onError(e => {
    throw e;
  });
  const call = async (path, method = 'GET', body, scope = SOCIO) => {
    const req = new Request(`https://admin.test/api/admin/gestion/${path}`, {
      method,
      ...(body instanceof FormData ? {
        body
      } : body === undefined ? {} : {
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json'
        }
      })
    });
    scopes.set(req, scope);
    return app.fetch(req, env, {
      waitUntil() {}
    });
  };
  const api = async (...a) => (await call(...a)).json();
  const vehicle = async (extra = {}) => (await api('vehiculos', 'POST', {
    id: nuevo(),
    referencia: nuevo(),
    ...extra
  })).item;
  const driver = async (extra = {}) => (await api('conductores', 'POST', {
    id: nuevo(),
    nombre: 'Conductor ficticio',
    telefono: '+34000000000',
    ...extra
  })).item;
  const upload = async (path, fields = {}, image = false) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({
      id: nuevo(),
      ...fields
    })) f.set(k, String(v));
    const bytes = new Uint8Array(64);
    bytes.set(image ? [137, 80, 78, 71, 13, 10, 26, 10] : new TextEncoder().encode('%PDF-1.7'));
    f.set('archivo', new Blob([bytes]), 'nombre-personal.pdf');
    return api(path, 'POST', f);
  };
  return {
    DB,
    env,
    api,
    call,
    vehicle,
    driver,
    upload,
    objects
  };
}
test('fecha efectiva Madrid, vencimiento inclusivo y revisión no implican aptitud', () => {
  assert.equal(hoyMadrid(new Date('2026-11-25T23:30:00Z')), '2026-11-26');
  assert.equal(datosExpediente({
    estado_revision: 'revisado',
    vence: '2026-11-26'
  }, '2026-11-26').estado_efectivo, 'revisado');
  assert.equal(datosExpediente({
    estado_revision: 'revisado',
    vence: '2026-11-25'
  }, '2026-11-26').estado_efectivo, 'caducado');
  assert.equal(datosExpediente({
    estado_revision: 'revisado',
    fecha_inicio: '2026-11-27'
  }, '2026-11-26').estado_efectivo, 'programado');
  assert.equal(datosExpediente({
    clase: 'permiso_circulacion'
  }).categoria_documental, 'permiso_circulacion');
  assert.equal(datosExpediente({
    clase: 'cualquier_cosa'
  }).categoria_documental, 'otros');
});
test('matrícula historial CAS, búsqueda anterior, catálogo y campos financieros preservados', async t => {
  const {
    api,
    vehicle,
    DB
  } = await fixture(t);
  const v = await vehicle({
    matricula: 'AA-123',
    matricula_tipo: 'provisional',
    matricula_pais: 'DE'
  });
  const n = (await api(`vehiculos/${v.id}`, 'PATCH', {
    version: 1,
    matricula: 'BB 987',
    matricula_tipo: 'definitiva',
    matricula_pais: 'ES'
  })).item;
  assert.equal(n.matriculas_anteriores[0].matricula, 'AA-123');
  await assert.rejects(api(`vehiculos/${v.id}`, 'PATCH', {
    version: 1,
    matricula: 'XX'
  }), error('version_conflicto'));
  assert.equal((await DB.prepare('SELECT count(*) n FROM g_vehiculo_matriculas').first()).n, 1);
  assert.equal((await api('vehiculos?q=AA123')).items[0].id, v.id);
  assert.equal((await api('catalogos')).vehiculos.find(r => r.id === v.id).matricula, 'BB 987');
  const changed = (await api(`vehiculos/${v.id}`, 'PATCH', {
    version: 2,
    matricula: 'CC'
  })).item;
  assert.equal(changed.matricula_tipo, 'desconocida');
  assert.equal(changed.matricula_pais, null);
  assert.equal(changed.moneda, v.moneda);
  assert.equal((await DB.prepare('SELECT count(*) n FROM fin_movimientos').first()).n, 0);
});
test('metadata independiente, revisión explícita, rechazo PDF foto, dedup y clave privada', async t => {
  const {
    api,
    vehicle,
    upload,
    DB
  } = await fixture(t);
  const v = await vehicle();
  const path = 'documentos';
  const fields = {
    tipo: 'vehiculo',
    objeto_id: v.id,
    clase: 'itv'
  };
  const doc = (await upload(path, fields)).item;
  assert.equal(doc.metadata_version, 1);
  assert.ok(!('key' in doc));
  const classified = (await api(`documentos/${doc.id}`, 'PATCH', {
    metadata_version: 1,
    categoria_documental: 'itv',
    vence: '2030-12-01',
    estado_revision: 'revisado',
    revision_confirmada: true
  })).item;
  assert.equal(classified.estado_revision, 'pendiente');
  await assert.rejects(api(`documentos/${doc.id}`, 'PATCH', {
    metadata_version: 2,
    estado_revision: 'revisado'
  }), error('revision_no_confirmada'));
  const reviewed = (await api(`documentos/${doc.id}`, 'PATCH', {
    metadata_version: 2,
    estado_revision: 'revisado',
    revision_confirmada: true
  })).item;
  assert.equal(reviewed.version, 1);
  assert.equal(reviewed.revisado_por, SOCIO.email);
  await assert.rejects(api(`documentos/${doc.id}`, 'PATCH', {
    metadata_version: 2,
    nota: 'tarde'
  }), error('version_conflicto'));
  const duplicate = await upload(path, fields);
  assert.equal(duplicate.duplicado, true);
  assert.equal(duplicate.item.id, doc.id);
  await assert.rejects(upload(path, {
    ...fields,
    clase: 'foto'
  }), error('foto_invalida'));
  assert.ok(!(await api(`vehiculos/${v.id}/resumen`)).documentos.some(d => 'key' in d));
  assert.equal((await DB.prepare('SELECT count(*) n FROM g_documentos').first()).n, 1);
  const image = (await upload(path, {...fields, clase:'otro'}, true)).item;
  const photo = (await api(`documentos/${image.id}`, 'PATCH', {
    metadata_version:1, categoria_documental:'foto', estado_revision:'pendiente'
  })).item;
  assert.equal(photo.categoria_documental, 'foto');
  assert.equal(photo.clase, 'otro');
  assert.equal(photo.sha256, image.sha256);
});
test('conductores minimizados, archivos scoped, dedup, retiro CAS y auditoría sin identidad', async t => {
  const {
    api,
    call,
    driver,
    upload,
    DB,
    objects
  } = await fixture(t);
  const d = await driver({
    identidad_tipo: 'dni',
    identidad_numero: 'FICTICIO-123',
    contacto_emergencia_nombre: 'Contacto ficticio'
  });
  const other = await driver();
  const list = await api('conductores');
  assert.ok(!('identidad_numero' in list.items[0]));
  assert.ok(!('contacto_emergencia_nombre' in list.items[0]));
  const doc = (await upload(`conductores/${d.id}/documentos`, {
    clase: 'identidad'
  })).item;
  assert.equal(doc.nombre, 'identidad.pdf');
  assert.equal(doc.clase, 'identidad');
  assert.equal(doc.categoria_documental, undefined);
  assert.ok(!('key' in doc));
  assert.equal(objects.size, 1);
  assert.equal((await upload(`conductores/${d.id}/documentos`, {
    clase: 'identidad'
  })).duplicado, true);
  assert.equal(objects.size, 1);
  await assert.rejects(call(`conductores/${other.id}/documentos/${doc.id}/archivo`), error('not_found'));
  assert.equal((await call(`conductores/${d.id}/documentos/${doc.id}/archivo`)).headers.get('Cache-Control'), 'no-store');
  await api(`conductores/${d.id}`, 'PATCH', {
    version: 1,
    identidad_numero: 'FICTICIO-456'
  });
  await assert.rejects(api(`conductores/${d.id}`, 'PATCH', {
    version: 1,
    nombre: 'Tarde'
  }), error('version_conflicto'));
  await api(`conductores/${d.id}/documentos/${doc.id}`, 'PATCH', {
    metadata_version: 1,
    retirado: true
  });
  await assert.rejects(call(`conductores/${d.id}/documentos/${doc.id}/archivo`), error('not_found'));
  assert.equal((await api(`conductores/${d.id}`)).documentos.length, 1);
  assert.ok((await api(`conductores/${d.id}`)).documentos[0].retirado_at);
  assert.equal(objects.size, 1);
  const audits = (await DB.prepare("SELECT detalle FROM g_auditoria WHERE objeto_tipo='conductor'").all()).results;
  assert.ok(!JSON.stringify(audits).includes('FICTICIO'));
  assert.ok(!JSON.stringify(audits).includes('nombre-personal'));
});
test('asignaciones UTC, solapes, adyacencia, actual derivado y baja concurrente protegida SQL', async t => {
  const {
    api,
    driver,
    vehicle,
    DB
  } = await fixture(t);
  const d = await driver(),
    v = await vehicle();
  const path = `conductores/${d.id}/asignaciones`;
  const data = {
    id: nuevo(),
    vehiculo_id: v.id,
    desde: '2026-01-01T00:00:00.000Z',
    hasta: '2026-02-01T00:00:00.000Z'
  };
  const a = (await api(path, 'POST', data)).item;
  assert.equal((await api(path, 'POST', data)).item.id, a.id);
  await assert.rejects(api(path, 'POST', {
    ...data,
    id: nuevo(),
    desde: '2026-01-15T00:00:00.000Z'
  }), error('asignacion_solapada'));
  await assert.rejects(api(path, 'POST', {
    ...data,
    id: nuevo(),
    desde: '2026-01-01T01:00:00+01:00'
  }), error('fecha_hora_invalida'));
  const next = (await api(path, 'POST', {
    ...data,
    id: nuevo(),
    desde: data.hasta,
    hasta: null
  })).item;
  assert.equal((await api(`vehiculos/${v.id}/conductores`)).actual.id, next.id);
  await assert.rejects(api(`conductor-asignaciones/${a.id}`, 'PATCH', {
    version: 1,
    hasta: '2026-03-01T00:00:00.000Z'
  }), error('asignacion_solapada'));
  await api(`conductores/${d.id}`, 'PATCH', {
    version: 1,
    estado: 'inactivo'
  });
  const v2 = await vehicle();
  const inactiveId = nuevo();
  await assert.rejects(api(path, 'POST', {
    id: inactiveId,
    vehiculo_id: v2.id,
    desde: '2026-01-01T00:00:00.000Z'
  }), error('conductor_inactivo'));
  assert.equal(await DB.prepare('SELECT * FROM g_idempotencia WHERE clave=?').bind(inactiveId).first(), null);
  await assert.rejects(DB.prepare('UPDATE g_vehiculo_conductores SET desde=? WHERE id=?').bind('2026-02-30T00:00:00.000Z', a.id).run(), /CHECK/);
  assert.equal((await DB.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
});
test('todas las rutas nuevas rechazan no socios antes DB/R2 y preview no expone conductores', async t => {
  const {
    call,
    env
  } = await fixture(t);
  env.DB = {
    prepare() {
      throw new Error('DB should not be called');
    }
  };
  const p = nuevo(),
    d = nuevo();
  const routes = [['conductores', 'GET'], ['conductores', 'POST'], [`conductores/${p}`, 'GET'], [`conductores/${p}`, 'PATCH'], [`conductores/${p}/asignaciones`, 'POST'], [`conductor-asignaciones/${p}`, 'PATCH'], [`vehiculos/${p}/conductores`, 'GET'], [`conductores/${p}/documentos`, 'GET'], [`conductores/${p}/documentos`, 'POST'], [`conductores/${p}/documentos/${d}`, 'PATCH'], [`conductores/${p}/documentos/${d}/archivo`, 'GET'], [`documentos/${d}`, 'PATCH']];
  for (const [path, method] of routes) await assert.rejects(call(path, method, method === 'GET' ? undefined : {}, {
    role: 'cliente',
    tenantId: 'other'
  }), error('not_authorized'));
  for (const suffix of ['conductores', `conductores/${p}/documentos/${d}/archivo`, `vehiculos/${p}/conductores`]) assert.throws(() => previewTarget(`/api/admin/mobile-preview/gestion/${suffix}`, 'GET', SOCIO), error('mobile_preview_unavailable'));
});
test('0066/0067 aditivas preservan documentos referenciados, pagos y versiones con FK activas', async t => {
  const DB = await sqliteD1({
    through: '0065'
  });
  t.after(() => DB.close());
  await DB.exec('PRAGMA foreign_keys=ON;');
  await DB.exec(`
 INSERT INTO fin_socios(email,nombre) VALUES('migration@velai.test','Ficticio');
 INSERT INTO g_cuentas(id,nombre,moneda,saldo_inicial,conciliada,fecha_saldo,created_by,created_at,updated_at) VALUES('account','Cuenta ficticia','EUR',1000000,1,'2025-12-31','test','2026-01-01','2026-01-01');
 INSERT INTO g_prestamos(id,nombre,cuenta_id,principal,cuota,tin_bp,tae_bp,meses,created_by,created_at,updated_at) VALUES('loan','Crédito ficticio','account',100000,10000,0,0,10,'test','2026-01-01','2026-01-01');
 INSERT INTO g_vehiculos(id,referencia,matricula,prestamo_id,version,created_by,created_at,updated_at) VALUES('vehicle','Vehículo ficticio','TEST-123','loan',7,'test','2026-01-01','2026-01-01');
 INSERT INTO g_documentos(id,tipo,objeto_id,clase,nombre,mime,ext,bytes,sha256,key,version,vence,autor,created_at) VALUES
 ('d1','prestamo','team','entrega','entrega.pdf','application/pdf','pdf',64,'sha-one','private/test/one',3,'2030-01-01','test','2026-01-01'),
 ('d2','prestamo','team','devolucion','devolucion.pdf','application/pdf','pdf',65,'sha-two','private/test/two',2,NULL,'test','2026-01-02'),
 ('d3','vehiculo','vehicle','itv','itv.pdf','application/pdf','pdf',66,'sha-three','private/test/three',4,'2027-01-01','test','2026-01-03');
 INSERT INTO g_equipo_prestamos(id,titulo,cuenta_id,importe,vencimiento,comprobante_entrega,created_by,created_at,updated_at) VALUES('team','Préstamo ficticio','account',10000,'2026-12-01','d1','test','2026-01-01','2026-01-01');
 INSERT INTO g_equipo_participantes(prestamo_id,email,importe) VALUES('team','migration@velai.test',10000);
 UPDATE g_equipo_prestamos SET estado='aprobado',aprobado_por='reviewer@velai.test',version=version+1 WHERE id='team';
 UPDATE g_equipo_prestamos SET estado='vigente',fecha_desembolso='2026-01-01',version=version+1 WHERE id='team';
 INSERT INTO g_equipo_devoluciones(id,prestamo_id,participante_email,importe,fecha,comprobante_id,created_by,created_at) VALUES('repay','team','migration@velai.test',1000,'2026-01-02','d2','test','2026-01-02');
 INSERT INTO g_pagos(id,objeto_tipo,objeto_id,clase,fecha,moneda,importe,capital,pagador,cuenta_id,created_by,created_at) VALUES('payment','prestamo','loan','pago','2026-01-03','EUR',10000,10000,'cuenta','account','test','2026-01-03');
 `);
  const tables = ['g_documentos', 'g_vehiculos', 'g_prestamos', 'g_equipo_prestamos', 'g_equipo_participantes', 'g_equipo_devoluciones', 'g_pagos', 'fin_movimientos'];
  const snapshot = {};
  for (const table of tables) snapshot[table] = (await DB.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results;
  const {
    readFile
  } = await import('node:fs/promises');
  for (const file of ['0066_vehiculos_expediente.sql', '0067_conductores.sql']) await DB.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  for (const table of tables) {
    const after = (await DB.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results;
    assert.deepEqual(after.map(r => Object.fromEntries(Object.keys(snapshot[table][0] || {}).map(k => [k, r[k]]))), snapshot[table]);
  }
  assert.equal((await DB.prepare("SELECT matricula_tipo FROM g_vehiculos WHERE id='vehicle'").first()).matricula_tipo, 'desconocida');
  assert.equal((await DB.prepare("SELECT metadata_version,estado_revision FROM g_documentos WHERE id='d3'").first()).estado_revision, 'pendiente');
  assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results, []);
});
test('CAS tardío no crea auditoría ni historial cuando otro escritor ya dejó la versión siguiente', async t => {
 const {DB,env,vehicle,api,upload}=await fixture(t);
 const v=await vehicle({matricula:'ORIGINAL'});
 const native=DB.batch.bind(DB);
 let race=true;
 env.DB.batch=async statements=>{
  if(race && statements[0].sql.startsWith('UPDATE g_vehiculos SET')){
   race=false;
   await native([DB.prepare('UPDATE g_vehiculos SET matricula=?,version=version+1,updated_at=? WHERE id=?').bind('GANADOR','2026-11-26',v.id)]);
  }
  return native(statements);
 };
 const before=(await DB.prepare('SELECT COUNT(*) n FROM g_auditoria').first()).n;
 await assert.rejects(api(`vehiculos/${v.id}`,'PATCH',{version:1,matricula:'PERDEDOR'}),error('version_conflicto'));
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM g_vehiculo_matriculas').first()).n,0);
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM g_auditoria').first()).n,before);
 assert.equal((await api(`vehiculos/${v.id}`)).item.matricula,'GANADOR');
 const doc=(await upload('documentos',{tipo:'vehiculo',objeto_id:v.id,clase:'itv'})).item;
 race=true;
 env.DB.batch=async statements=>{
  if(race && statements[0].sql.startsWith('UPDATE g_documentos SET')){
   race=false;
   await native([DB.prepare('UPDATE g_documentos SET nota=?,metadata_version=metadata_version+1 WHERE id=?').bind('Ganador',doc.id)]);
  }
  return native(statements);
 };
 const auditBefore=(await DB.prepare('SELECT COUNT(*) n FROM g_auditoria').first()).n;
 await assert.rejects(api(`documentos/${doc.id}`,'PATCH',{metadata_version:1,nota:'Perdedor'}),error('version_conflicto'));
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM g_auditoria').first()).n,auditBefore);
 assert.equal((await DB.prepare('SELECT nota,metadata_version,version FROM g_documentos WHERE id=?').bind(doc.id).first()).nota,'Ganador');
});
test('conductor corrige clase del duplicado, conserva historial de revisión y restaura retirado sin tocar bytes',async t=>{
 const {api,call,driver,upload,DB,objects}=await fixture(t);
 const d=await driver(),wrong=await driver();
 const doc=(await upload(`conductores/${d.id}/documentos`,{clase:'otros'})).item;
 const bytesBefore=await DB.prepare('SELECT key,sha256,bytes,version FROM g_conductor_documentos WHERE id=?').bind(doc.id).first();
 const dup=await upload(`conductores/${d.id}/documentos`,{clase:'identidad',vence:'2030-01-01'});
 assert.equal(dup.duplicado,true);assert.equal(dup.item.id,doc.id);assert.equal(dup.item.clase,'otros');
 const path=`conductores/${d.id}/documentos/${doc.id}`;
 await assert.rejects(api(`conductores/${wrong.id}/documentos/${doc.id}`,'PATCH',{metadata_version:1,clase:'identidad'}),error('not_found'));
 let item=(await api(path,'PATCH',{metadata_version:1,clase:'identidad',vence:'2030-01-01',estado_revision:'revisado',revision_confirmada:true})).item;
 assert.equal(item.clase,'identidad');assert.equal(item.nombre,'identidad.pdf');assert.equal(item.estado_revision,'pendiente');
 item=(await api(path,'PATCH',{metadata_version:item.metadata_version,estado_revision:'revisado',revision_confirmada:true})).item;
 const reviewer=item.revisado_por,reviewedAt=item.revisado_at;
 item=(await api(path,'PATCH',{metadata_version:item.metadata_version,estado_revision:'sustituido'})).item;
 assert.equal(item.revisado_por,reviewer);assert.equal(item.revisado_at,reviewedAt);
 item=(await api(path,'PATCH',{metadata_version:item.metadata_version,retirado:true})).item;
 const retiredVersion=item.metadata_version;assert.equal(item.revisado_at,reviewedAt);
 assert.ok((await api(`conductores/${d.id}/documentos`)).items[0].retirado_at);
 assert.ok((await api(`conductores/${d.id}`)).documentos[0].retirado_at);
 await assert.rejects(call(`${path}/archivo`),error('not_found'));
 await assert.rejects(api(`conductores/${wrong.id}/documentos/${doc.id}`,'PATCH',{metadata_version:item.metadata_version,retirado:false}),error('not_found'));
 item=(await api(path,'PATCH',{metadata_version:item.metadata_version,retirado:false})).item;
 assert.equal(item.retirado_at,null);assert.equal(item.estado_revision,'pendiente');assert.equal(item.revisado_por,null);assert.equal(item.ultima_revision_por,reviewer);assert.equal(item.ultima_revision_at,reviewedAt);
 await assert.rejects(api(path,'PATCH',{metadata_version:retiredVersion,retirado:false}),error('version_conflicto'));
 assert.equal((await call(`${path}/archivo`)).status,200);
 await assert.rejects(api(path,'PATCH',{metadata_version:item.metadata_version,clase:'foto'}),error('foto_invalida'));
 item=(await api(path,'PATCH',{metadata_version:item.metadata_version,estado_revision:'revisado',revision_confirmada:true})).item;
 item=(await api(path,'PATCH',{metadata_version:item.metadata_version,vence:'2031-01-01'})).item;
 assert.equal(item.estado_revision,'pendiente');assert.equal(item.revisado_at,null);assert.equal(item.ultima_revision_por,reviewer);
 assert.deepEqual(await DB.prepare('SELECT key,sha256,bytes,version FROM g_conductor_documentos WHERE id=?').bind(doc.id).first(),bytesBefore);assert.equal(objects.size,1);
});
test('vehículo sustituido conserva revisión e invalidar fechas conserva la última revisión anterior',async t=>{
 const {vehicle,upload,api}=await fixture(t);const v=await vehicle();let item=(await upload('documentos',{tipo:'vehiculo',objeto_id:v.id,clase:'itv'})).item;
 const path=`documentos/${item.id}`;
 item=(await api(path,'PATCH',{metadata_version:item.metadata_version,estado_revision:'revisado',revision_confirmada:true})).item;
 const at=item.revisado_at;
 item=(await api(path,'PATCH',{metadata_version:item.metadata_version,estado_revision:'sustituido'})).item;
 assert.equal(item.revisado_por,SOCIO.email);assert.equal(item.revisado_at,at);
 item=(await api(path,'PATCH',{metadata_version:item.metadata_version,vence:'2030-01-01',estado_revision:'revisado',revision_confirmada:true})).item;
 assert.equal(item.estado_revision,'pendiente');assert.equal(item.revisado_at,null);assert.equal(item.ultima_revision_por,SOCIO.email);assert.equal(item.ultima_revision_at,at);
});
test('reintento legado de vehículo mantiene la huella anterior y campos explícitos participan en idempotencia',async t=>{
 const {api,DB}=await fixture(t);const body={id:nuevo(),referencia:'LEGACY-RETRY',matricula:'TEST-000'};
 const oldBody={id:body.id,moneda:'EUR',estado:'previsto',referencia:body.referencia,tipo:'coche',marca:null,modelo:null,matricula:body.matricula,vin:null,fecha_compra:null,fecha_venta:null,precio_venta:null,prestamo_id:null,entidad_id:null,nota:null};
 const first=(await api('vehiculos','POST',body)).item;
 const previousHash=await huella(oldBody);
 assert.equal((await DB.prepare('SELECT huella FROM g_idempotencia WHERE clave=?').bind(body.id).first()).huella,previousHash);
 // Emula una operación idempotente almacenada por el Worker previo al despliegue.
 await DB.prepare('UPDATE g_idempotencia SET huella=? WHERE clave=?').bind(previousHash,body.id).run();
 const replay=await api('vehiculos','POST',body);assert.equal(replay.item.id,first.id);
 await assert.rejects(api('vehiculos','POST',{...body,matricula_tipo:'desconocida',matricula_pais:null}),error('idempotencia_conflicto'));
});
