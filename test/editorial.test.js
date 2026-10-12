import test from 'node:test';
import assert from 'node:assert/strict';
import { testing } from '../worker/app.js';
import { sqliteD1 } from './helpers/sqlite-d1.js';

const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';
const VELAI = { role: 'velai', email: 'editor@velai.test', tenantId: null };
const CLIENTE = { role: 'cliente', email: 'cliente@velai.test', tenantId: A, modulos: ['calendario'] };
const error = (status, code) => (e) => e.status === status && e.code === code;
async function fixture(t) {
  const DB = await sqliteD1(); t.after(() => DB.close());
  await DB.exec('PRAGMA foreign_keys=ON;');
  for (const [id, slug] of [[A, 'dialogos'], [B, 'otro']]) await DB.prepare('INSERT INTO tenants (id,slug,name,channel_address,system_prompt,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id, slug, slug, `web:${slug}`, 'test', '2026-01-01', '2026-01-01').run();
  const env = { DB };
  const call = async (path = '', method = 'GET', body, scope = VELAI, tenant = A, preview = false) => {
    const url = new URL(`https://admin.test/api/admin/${preview ? 'mobile-preview/' : ''}tenants/${tenant}/editorial${path}`);
    const req = new Request(url, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return testing.adminRouter(req, env, { waitUntil() { assert.fail('editorial no debe enviar tareas asíncronas'); } }, url.pathname, url, {}, scope);
  };
  const api = async (...args) => (await call(...args)).json();
  const create = (extra = {}, tenant = A) => api('', 'POST', { fecha: '2026-10-15', titulo: '  Grabar episodio  ', detalle: '  Preparar preguntas  ', ...extra }, VELAI, tenant);
  return { DB, env, api, call, create };
}

test('editorial guarda fechas civiles, filtra inclusivamente, edita con versión y borra sin crear citas', async (t) => {
  const { api, create, DB } = await fixture(t);
  const first = (await create()).entry;
  assert.equal(first.titulo, 'Grabar episodio'); assert.equal(first.detalle, 'Preparar preguntas');
  assert.equal(first.tenant_id, A); assert.equal(first.version, 1); assert.equal(first.created_by, VELAI.email);
  assert.equal((await create({ fecha: '2026-10-16' })).entry.version, 1);
  await create({ fecha: '2026-10-17' }); await create({}, B);
  const range = await api('?from=2026-10-15&to=2026-10-16');
  assert.deepEqual(range.entries.map((e) => e.fecha), ['2026-10-15', '2026-10-16']); assert.equal(range.mas, false);
  const update = await api(`/${first.id}`, 'PATCH', { version: 1, fecha: '2026-10-14', titulo: 'Emitir episodio', detalle: null });
  assert.equal(update.entry.version, 2); assert.equal(update.entry.fecha, '2026-10-14'); assert.equal(update.entry.detalle, null);
  assert.equal(update.entry.created_by, first.created_by); assert.equal(update.entry.created_at, first.created_at);
  await assert.rejects(api(`/${first.id}`, 'PATCH', { version: 1, titulo: 'Edición obsoleta' }), error(409, 'version_conflicto'));
  await assert.rejects(api(`/${first.id}?version=1`, 'DELETE'), error(409, 'version_conflicto'));
  assert.equal((await api()).entries.find((e) => e.id === first.id).titulo, 'Emitir episodio');
  assert.deepEqual(await api(`/${first.id}?version=2`, 'DELETE'), { ok: true });
  await assert.rejects(api(`/${first.id}?version=2`, 'DELETE'), error(404, 'not_found'));
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM appointments').first()).n, 0);
});

test('lectura cliente exige tenant propio y módulo antes de consultar datos', async (t) => {
  const { create, api, env } = await fixture(t);
  const own = (await create()).entry, foreign = (await create({ titulo: 'Privado del otro tenant' }, B)).entry;
  assert.deepEqual((await api('', 'GET', undefined, CLIENTE)).entries.map((e) => e.id), [own.id]);
  // No confirmar ni consultar datos ajenos, ni escrituras prohibidas.
  const db = env.DB; env.DB = { prepare() { assert.fail('permiso/alcance debe comprobarse antes de D1'); } };
  try {
    await assert.rejects(api('', 'GET', undefined, CLIENTE, B), error(404, 'not_found'));
    await assert.rejects(api('', 'GET', undefined, { ...CLIENTE, modulos: [] }), error(403, 'modulo_no_contratado'));
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      await assert.rejects(api(method === 'POST' ? '' : `/${own.id}`, method, {}, CLIENTE, B), error(404, 'not_found'));
      await assert.rejects(api(method === 'POST' ? '' : `/${own.id}`, method, {}, { ...CLIENTE, modulos: [] }), error(403, 'modulo_no_contratado'));
    }
  } finally { env.DB = db; }
  await assert.rejects(api(`/${foreign.id}`, 'PATCH', { version: 1, titulo: 'Intrusión' }), error(404, 'not_found'));
  await assert.rejects(api(`/${foreign.id}?version=1`, 'DELETE'), error(404, 'not_found'));
  await assert.rejects(api('', 'GET', undefined, VELAI, 'no-uuid'), error(404, 'not_found'));
  await assert.rejects(api('', 'POST', { fecha: '2026-10-15', titulo: 'Otro' }, VELAI, crypto.randomUUID()), error(404, 'not_found'));
});

test('valida rango, fechas reales, tamaños, cuerpo y versión antes de alterar contenido', async (t) => {
  const { create, api, call } = await fixture(t);
  for (const fecha of ['2026-02-29', '2026-04-31', '2026-1-01', '', 20261015, '2024-12-31', '2101-01-01']) await assert.rejects(create({ fecha }), error(400, 'fecha_invalida'));
  for (const titulo of ['', '   ', null, 123, 'x'.repeat(161)]) await assert.rejects(create({ titulo }), error(400, 'titulo_invalido'));
  for (const detalle of [false, {}, 'x'.repeat(4001)]) await assert.rejects(create({ detalle }), error(400, 'detalle_invalido'));
  assert.equal((await create({ fecha: '2028-02-29', titulo: 'x'.repeat(160), detalle: 'x'.repeat(4000) })).entry.titulo.length, 160);
  await assert.rejects(api('?from=2026-02-29'), error(400, 'fecha_invalida'));
  await assert.rejects(api('?from=2026-10-20&to=2026-10-15'), error(400, 'periodo_invalido'));
  for (const body of [null, [], 'texto']) await assert.rejects(api('', 'POST', body), error(400, 'invalid_json'));
  await assert.rejects(create({ tenant_id: B }), error(400, 'campo_desconocido'));
  await assert.rejects(create({ detalle: '😀'.repeat(13000) }), error(413, 'payload_too_large'));
  const { entry } = await create();
  for (const version of [undefined, 0, -1, 1.5, '1']) await assert.rejects(api(`/${entry.id}`, 'PATCH', { version, titulo: 'Editar' }), error(400, 'version_requerida'));
  for (const version of ['', '0', '-1', '1.5', '1e0', '9007199254740992']) await assert.rejects(call(`/${entry.id}?version=${version}`, 'DELETE'), error(400, 'version_requerida'));
});

test('versionado atómico permite una sola edición concurrente y preview GET no admite escrituras', async (t) => {
  const { create, api, call, env } = await fixture(t);
  const { entry } = await create();
  const results = await Promise.allSettled(['Primero', 'Segundo'].map((titulo) => api(`/${entry.id}`, 'PATCH', { version: 1, titulo })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'version_conflicto');
  const preview = await api('', 'GET', undefined, VELAI, A, true);
  assert.equal(preview.entries.length, 1); assert.equal(preview.entries[0].version, 2);
  const db = env.DB; env.DB = { prepare() { assert.fail('preview bloquea escritura antes de D1'); } };
  try {
    for (const method of ['POST', 'PATCH', 'DELETE']) await assert.rejects(call('', method, {}, VELAI, A, true), error(405, 'mobile_preview_read_only'));
  } finally { env.DB = db; }
});

test('cliente Diálogos puede crear editar y borrar solo su editorial, sin citas ni cambios de identidad', async(t)=>{
 const {api,DB}=await fixture(t);
 const created=(await api('','POST',{fecha:'2026-10-15',titulo:'Episodio del cliente',detalle:'Guion'},CLIENTE)).entry;
 assert.equal(created.created_by,CLIENTE.email);assert.equal(created.tenant_id,A);
 const edited=(await api(`/${created.id}`,'PATCH',{version:1,titulo:'Guion listo'},CLIENTE)).entry;
 assert.equal(edited.version,2);assert.equal(edited.titulo,'Guion listo');
 assert.deepEqual(await api(`/${created.id}?version=2`,'DELETE',undefined,CLIENTE),{ok:true});
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM tenant_editorial').first()).n,0);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM appointments').first()).n,0);
});

test('otros clientes conservan lectura editorial propia pero no escrituras', async(t)=>{
 const {api,create,DB}=await fixture(t);
 const other={...CLIENTE,tenantId:B};const entry=(await create({},B)).entry;
 assert.equal((await api('','GET',undefined,other,B)).entries[0].id,entry.id);
 for(const[method,path,body]of[['POST','',{fecha:'2026-10-15',titulo:'No'}],['PATCH',`/${entry.id}`,{version:1,titulo:'No'}],['DELETE',`/${entry.id}?version=1`,undefined]])await assert.rejects(api(path,method,body,other,B),error(403,'not_authorized'));
 assert.equal((await DB.prepare('SELECT version FROM tenant_editorial WHERE id=?').bind(entry.id).first()).version,1);
});

test('me comunica permisos editoriales según slug módulo rol y preview',async(t)=>{
 const {env}=await fixture(t);
 const me=async(scope,preview=false)=>{
  const path=`/api/admin/${preview?'mobile-preview/':''}me`,url=new URL('https://admin.test'+path);
  return(await testing.adminRouter(new Request(url),env,{waitUntil(){}},path,url,{},scope)).json();
 };
 const own=await me(CLIENTE);assert.equal(own.tenantSlug,'dialogos');assert.equal(own.editorialEditable,true);
 assert.equal((await me({...CLIENTE,modulos:[]})).editorialEditable,false);
 const other=await me({...CLIENTE,tenantId:B});assert.equal(other.tenantSlug,'otro');assert.equal(other.editorialEditable,false);
 assert.equal((await me(VELAI)).editorialEditable,true);
 assert.equal((await me(VELAI)).tenantSlug,null);
 assert.equal((await me(VELAI,true)).editorialEditable,false);
});
