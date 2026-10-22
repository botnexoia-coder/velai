import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { testing } from '../worker/app.js';
import { sqliteD1 } from './helpers/sqlite-d1.js';

const ADMIN_EMAIL='estiven@velai.test', DIALOGOS='00000000-0000-4000-8000-000000000d01', OTHER='00000000-0000-4000-8000-000000000d02', NAYA='00000000-0000-4000-8000-000000000d03';
// Los tenants de la casa vienen sembrados por la migración 0002.
const VELAI='00000000-0000-4000-8000-000000000001', MESSENGER='00000000-0000-4000-8000-000000000002';
const NAMES={dialogos:'Diálogos','otro-workspace':'Otro cliente','colegiale-sevilla':'Naya Eventos'};
const error=(status,code)=>(e)=>e.status===status&&e.code===code;
// Los tenants se insertan DESPUÉS de las migraciones, así que el backfill de 0058 no los
// toca: el fixture marca como espacio lo mismo que la migración (Diálogos y Naya).
async function fixture(t,{atender=false}={}){
 const DB=await sqliteD1();t.after(()=>DB.close());
 const env={DB,ADMIN_EMAILS:'raiz@velai.test',SOCIOS_EMAILS:'raiz@velai.test'};
 await DB.prepare('INSERT INTO admin_users (email,created_by,created_at) VALUES (?,?,?)').bind(ADMIN_EMAIL,'raiz@velai.test','2026-01-01').run();
 for(const[id,slug]of[[DIALOGOS,'dialogos'],[OTHER,'otro-workspace'],[NAYA,'colegiale-sevilla']])await DB.prepare('INSERT INTO tenants (id,slug,name,channel_address,system_prompt,plan,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
  .bind(id,slug,NAMES[slug],`web:${slug}`,'test','profesional','2026-01-01','2026-01-01').run();
 await DB.prepare("UPDATE tenants SET espacio_velai=1,espacio_atender=? WHERE slug IN ('dialogos','colegiale-sevilla')").bind(atender?1:0).run();
 const admin=await testing.resolveScope(env,ADMIN_EMAIL),client={role:'cliente',tenantId:DIALOGOS,email:'cliente@velai.test',modulos:['calendario']};
 const call=async(path,method='GET',body,choice='dialogos',scope=admin)=>{
  const url=new URL(`https://admin.test/api/admin/${path}`),headers={};if(choice!==undefined&&choice!==null)headers['X-Velai-Workspace']=choice;
  if(body!==undefined)headers['Content-Type']='application/json';
  const request=new Request(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  return testing.adminRouter(request,env,{waitUntil(){}},url.pathname,url,{},scope);
 };
 const api=async(...args)=>(await call(...args)).json();
 return{DB,env,admin,client,call,api};
}

test('administrador limitado rota al espacio Diálogos con actor real y recupera exactamente Velai',async t=>{
 const{api,admin}=await fixture(t);
 assert.equal(admin.raiz,false);assert.deepEqual(admin.permisos,[]);
 const base=await api('me','GET',undefined,null);
 assert.equal(base.role,'velai');assert.equal(base.socio,false);assert.equal(base.workspace.current,'velai');assert.equal(base.workspace.canSwitch,true);
 assert.deepEqual(base.workspace.options,[{id:'velai',label:'Velai · Admin'},{id:'dialogos',label:'Diálogos'},{id:'colegiale-sevilla',label:'Naya Eventos'}]);
 const selected=await api('me');
 assert.equal(selected.role,'cliente');assert.equal(selected.tenantId,DIALOGOS);assert.equal(selected.tenantSlug,'dialogos');assert.equal(selected.editorialEditable,true);assert.equal(selected.socio,false);
 assert.equal(selected.workspace.current,'dialogos');assert.equal(selected.workspace.canSwitch,true);assert.equal(selected.workspace.canAttend,false);
 const entry=(await api(`tenants/${DIALOGOS}/editorial`,'POST',{fecha:'2026-10-16',titulo:'Planificación propia'})).entry;
 assert.equal(entry.created_by,ADMIN_EMAIL);assert.equal(entry.tenant_id,DIALOGOS);
 const changed=(await api(`tenants/${DIALOGOS}/editorial/${entry.id}`,'PATCH',{version:1,titulo:'Título actualizado'})).entry;
 assert.equal(changed.version,2);assert.equal(changed.created_by,ADMIN_EMAIL);
 assert.deepEqual(await api(`tenants/${DIALOGOS}/editorial/${entry.id}?version=2`,'DELETE'),{ok:true});
 assert.deepEqual(await api('me','GET',undefined,'velai'),base);
 await assert.rejects(api('finanzas/resumen','GET',undefined,'velai'),error(403,'not_authorized'));
 await assert.rejects(api('finanzas/resumen'),error(403,'not_authorized'));
});

test('clientes reales no pueden usar header de espacio; destinos arbitrarios/inactivos/ausentes/configuración fallan cerrados',async t=>{
 const{api,env,DB,client}=await fixture(t),native=env.DB;
 env.DB={prepare(){assert.fail('Debe cerrar antes de tocar D1');}};
 try{
  for(const choice of['velai','dialogos','naya',OTHER,''])await assert.rejects(api('me','GET',undefined,choice,client),error(403,'not_authorized'));
  // Forma imposible de slug: se rechaza antes de consultar nada.
  for(const choice of['Velai','','x','-dialogos','dialogos;--','a'.repeat(41)])await assert.rejects(api('me','GET',undefined,choice),error(400,'workspace_invalido'));
  // Los tenants de la casa nunca son espacio, ni aunque alguien los marque a mano en D1.
  for(const choice of['velai-messenger'])await assert.rejects(api('me','GET',undefined,choice),error(403,'workspace_unavailable'));
 }finally{env.DB=native;}
 // Bien formado pero sin «Espacio de Velai», inexistente o de la casa: 403 igual para todos.
 await DB.prepare("UPDATE tenants SET espacio_velai=1 WHERE slug='velai'").run();
 for(const choice of[OTHER,'otro-workspace','no-existe','velai-messenger'])await assert.rejects(api('me','GET',undefined,choice),error(403,'workspace_unavailable'));
 assert.equal((await api('me','GET',undefined,'velai')).role,'velai');
 assert.equal((await api('me','GET',undefined,null,client)).workspace.canSwitch,false);
 await DB.prepare('UPDATE tenants SET active=0 WHERE id=?').bind(DIALOGOS).run();
 await assert.rejects(api('me'),error(403,'workspace_unavailable'));
 await DB.prepare("UPDATE tenants SET active=1,plan='esencial' WHERE id=?").bind(DIALOGOS).run();
 const limited=await api('me');assert.deepEqual(limited.modulos,[]);assert.equal(limited.editorialEditable,false);
 await assert.rejects(api(`tenants/${DIALOGOS}/editorial`),error(403,'modulo_no_contratado'));
 await DB.prepare('UPDATE tenants SET espacio_velai=0 WHERE id=?').bind(DIALOGOS).run();
 await assert.rejects(api('me'),error(403,'workspace_unavailable'));
 await DB.prepare("UPDATE tenants SET espacio_velai=1,slug='dialogos-ausente' WHERE id=?").bind(DIALOGOS).run();
 await assert.rejects(api('me'),error(403,'workspace_unavailable'));
 env.DB={prepare(){return {bind(){return this;},first:async()=>({id:DIALOGOS,slug:'dialogos',active:1,espacio_velai:1,plan:null})};}};
 await assert.rejects(api('me'),error(403,'workspace_unavailable'));
 env.DB={prepare(){throw Error('Almacenamiento temporalmente ausente');}};
 try{await assert.rejects(api('me'),error(503,'workspace_unavailable'));}finally{env.DB=native;}
});

test('alcance Diálogos aplica a CRUD, leads, inbox y ambos CSV; recursos globales y otro cliente permanecen cerrados',async t=>{
 const{DB,api,call}=await fixture(t),ownLead=crypto.randomUUID(),foreignLead=crypto.randomUUID(),ownConv=crypto.randomUUID(),foreignConv=crypto.randomUUID();
 for(const[id,tenant,name]of[[ownLead,DIALOGOS,'PROPIO_WORKSPACE'],[foreignLead,OTHER,'AJENO_WORKSPACE']])await DB.prepare('INSERT INTO leads (id,request_id,source,name,status,tenant_id,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)')
  .bind(id,id,'web',name,'new',tenant,'2026-10-01','2026-10-01','2099-01-01').run();
 for(const[id,tenant,lead]of[[ownConv,DIALOGOS,ownLead],[foreignConv,OTHER,foreignLead]])await DB.prepare('INSERT INTO conversations (id,tenant_id,lead_id,channel,external_id,started_at,last_at,expires_at) VALUES (?,?,?,?,?,?,?,?)')
  .bind(id,tenant,lead,'web',id,'2026-10-01','2026-10-01','2099-01-01').run();
 for(const[id,text]of[[ownConv,'PROPIO_WORKSPACE'],[foreignConv,'AJENO_WORKSPACE']])await DB.prepare('INSERT INTO conv_messages (conversation_id,role,text,created_at) VALUES (?,?,?,?)').bind(id,'user',text,'2026-10-01').run();
 const leads=await api('leads');assert.deepEqual(leads.leads.map(r=>r.id),[ownLead]);
 assert.equal((await api(`leads?tenant=${OTHER}`)).leads.length,0);
 assert.deepEqual((await api('conversations')).conversations.map(r=>r.id),[ownConv]);
 const inbox=await api('inbox');assert.equal(inbox.conversations.length,1);assert.equal(inbox.conversations[0].id,ownConv);
 for(const path of['leads/export.csv','conversations/export.csv']){
  const csv=await(await call(path)).text();assert.match(csv,/PROPIO_WORKSPACE/);assert.doesNotMatch(csv,/AJENO_WORKSPACE/);
 }
 await assert.rejects(api(`leads/${foreignLead}`),error(404,'not_found'));
 await assert.rejects(api(`tenants/${OTHER}/editorial`,'POST',{fecha:'2026-10-16',titulo:'Ajeno'}),error(404,'not_found'));
 const globalEntry=(await api(`tenants/${OTHER}/editorial`,'POST',{fecha:'2026-10-16',titulo:'Otro cliente'},'velai')).entry;
 await assert.rejects(api(`tenants/${DIALOGOS}/editorial/${globalEntry.id}`,'PATCH',{version:1,titulo:'Intrusión'}),error(404,'not_found'));
 for(const path of['tenants','config','admins','permisos','ai-usage','gestion/catalogos'])await assert.rejects(api(path),error(403,'not_authorized'));
 const unrestricted=await api('leads','GET',undefined,'velai');assert.equal(unrestricted.leads.length,2);
});

test('workspace conserva prohibición administrativa de atención y preview global solo lectura',async t=>{
 const{DB,api,call,env}=await fixture(t),id=crypto.randomUUID();
 await DB.prepare('INSERT INTO conversations (id,tenant_id,channel,external_id,started_at,last_at,expires_at) VALUES (?,?,?,?,?,?,?)').bind(id,DIALOGOS,'web',id,'2026-10-01','2026-10-01','2099-01-01').run();
 await assert.rejects(api(`conversations/${id}/takeover`,'POST',{}),error(403,'espacio_sin_atencion'));
 await assert.rejects(api('availability','PATCH',{available:true}),error(403,'espacio_sin_atencion'));
 // Sin cabecera, Velai sigue sin atender a los clientes con el motivo de siempre.
 await assert.rejects(api(`conversations/${id}/takeover`,'POST',{},null),error(403,'velai_no_atiende_clientes'));
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM agent_presence WHERE tenant_id=?').bind(DIALOGOS).first()).n,0);
 const preview=await api('mobile-preview/me','GET',undefined,null);assert.equal(preview.role,'velai');assert.equal(preview.workspace.canSwitch,false);assert.equal(preview.workspace.canAttend,false);assert.equal(preview.editorialEditable,false);
 const native=env.DB;env.DB={prepare(){assert.fail('Preview bloquea antes de consultar datos');}};
 try{
  await assert.rejects(call('mobile-preview/me','GET',undefined,'dialogos'),error(400,'workspace_preview_unavailable'));
  await assert.rejects(call(`mobile-preview/tenants/${DIALOGOS}/editorial`,'POST',{fecha:'2026-10-16',titulo:'No escribir'},'dialogos'),error(405,'mobile_preview_read_only'));
 }finally{env.DB=native;}
});

 test('Naya resuelve el slug propio, limita datos y conserva actor y permisos administrativos',async t=>{
 const {api,call,DB,client}=await fixture(t);
 const selected=await api('me','GET',undefined,'naya');
 assert.equal(selected.tenantId,NAYA);assert.equal(selected.tenantSlug,'colegiale-sevilla');
 assert.equal(selected.role,'cliente');assert.equal(selected.editorialEditable,false);
 // El alias heredado entra al slug real; el panel lo ve como su id en las opciones.
 assert.equal(selected.workspace.current,'colegiale-sevilla');assert.equal(selected.workspace.label,'Naya Eventos');assert.equal(selected.workspace.canSwitch,true);assert.equal(selected.workspace.canAttend,false);
 assert.deepEqual(await api('me','GET',undefined,'colegiale-sevilla'),selected);
 const ids=[crypto.randomUUID(),crypto.randomUUID()];
 for(const [id,tenant] of [[ids[0],NAYA],[ids[1],DIALOGOS]])await DB.prepare('INSERT INTO leads (id,request_id,source,name,status,tenant_id,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,id,'web',tenant===NAYA?'NAYA_PROPIO':'DIALOGOS_AJENO','new',tenant,'2026-10-01','2026-10-01','2099-01-01').run();
 assert.deepEqual((await api('leads','GET',undefined,'naya')).leads.map(r=>r.id),[ids[0]]);
 const csv=await(await call('leads/export.csv','GET',undefined,'naya')).text();assert.match(csv,/NAYA_PROPIO/);assert.doesNotMatch(csv,/DIALOGOS_AJENO/);
 await assert.rejects(api(`leads/${ids[1]}`,'GET',undefined,'naya'),error(404,'not_found'));
 await assert.rejects(api('gestion/catalogos','GET',undefined,'naya'),error(403,'not_authorized'));
 await assert.rejects(api('availability','PATCH',{available:true},'naya'),error(403,'espacio_sin_atencion'));
 await assert.rejects(api('me','GET',undefined,'naya',client),error(403,'not_authorized'));
 await assert.rejects(api('mobile-preview/me','GET',undefined,'naya'),error(400,'workspace_preview_unavailable'));
 await DB.prepare('UPDATE tenants SET active=0 WHERE id=?').bind(NAYA).run();
 await assert.rejects(api('me','GET',undefined,'naya'),error(403,'workspace_unavailable'));
 assert.equal((await api('me','GET',undefined,'velai')).role,'velai');
 });

async function conv(DB,tenant,state,agent=null){
 const id=crypto.randomUUID();
 await DB.prepare('INSERT INTO conversations (id,tenant_id,channel,external_id,started_at,last_at,expires_at,state,state_at,agent_email) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .bind(id,tenant,'web',id,'2026-10-01','2026-10-01','2099-01-01',state,new Date().toISOString(),agent).run();
 return id;
}

test('opciones del selector salen de D1: activas con espacio, por nombre y nunca la casa',async t=>{
 const{api,DB,client}=await fixture(t);
 await DB.prepare("UPDATE tenants SET espacio_velai=1 WHERE slug IN ('otro-workspace','velai')").run();
 const ids=async()=>(await api('me','GET',undefined,null)).workspace.options.map(o=>o.id);
 assert.deepEqual(await ids(),['velai','dialogos','colegiale-sevilla','otro-workspace']);
 const entered=await api('me','GET',undefined,'otro-workspace');
 assert.equal(entered.tenantId,OTHER);assert.equal(entered.workspace.current,'otro-workspace');assert.equal(entered.workspace.canAttend,false);
 assert.deepEqual(entered.workspace.options.map(o=>o.id),await ids());
 await DB.prepare("UPDATE tenants SET active=0 WHERE slug='colegiale-sevilla'").run();
 assert.deepEqual(await ids(),['velai','dialogos','otro-workspace']);
 assert.equal((await api('me','GET',undefined,null,client)).workspace.options,undefined);
});

test('con espacio_atender=1 Velai toma (cola y proactivo), responde y devuelve con su correo real; solo en ese tenant',async t=>{
 const{api,DB}=await fixture(t,{atender:true});
 assert.equal((await api('me')).workspace.canAttend,true);
 const id=await conv(DB,DIALOGOS,'esperando');
 assert.equal((await api(`conversations/${id}/takeover`,'POST',{})).agent_email,ADMIN_EMAIL);
 assert.equal((await api(`inbox?conversation=${id}`)).thread.window.open,true);
 assert.equal((await api(`conversations/${id}/reply`,'POST',{text:'Hola, soy del equipo'})).ok,true);
 assert.deepEqual(await DB.prepare("SELECT agent_email,text FROM conv_messages WHERE conversation_id=? AND role='agent'").bind(id).first(),{agent_email:ADMIN_EMAIL,text:'Hola, soy del equipo'});
 assert.equal((await api(`conversations/${id}/release`,'POST',{})).state,'bot');
 // Toma proactiva de una conversación que lleva la IA (web: el canal admite responder ya).
 assert.equal((await api(`inbox?conversation=${id}`)).thread.window.canTakeover,true);
 assert.equal((await api(`conversations/${id}/takeover`,'POST',{})).state,'humano');
 // Disponibilidad: por persona y tenant, acotada al tenant del espacio.
 const av=await api('availability','PATCH',{available:true});assert.equal(av.available,true);assert.equal(av.forTenant,'Diálogos');
 assert.deepEqual((await DB.prepare('SELECT tenant_id,email FROM agent_presence').all()).results,[{tenant_id:DIALOGOS,email:ADMIN_EMAIL}]);
 // Aislamiento: Naya también es atendible, pero desde el espacio Diálogos no existe.
 const naya=await conv(DB,NAYA,'esperando');
 for(const accion of['takeover','reply','release'])await assert.rejects(api(`conversations/${naya}/${accion}`,'POST',{text:'Intrusión'}),error(404,'not_found'));
 assert.equal((await api(`inbox?conversation=${naya}`)).thread,null);
 assert.equal((await DB.prepare('SELECT state FROM conversations WHERE id=?').bind(naya).first()).state,'esperando');
 assert.equal(await testing.canAttend({},{role:'cliente',tenantId:DIALOGOS,workspaceAdmin:true,workspaceAttend:true},NAYA),false);
 assert.equal(await testing.canAttend({},{role:'cliente',tenantId:DIALOGOS,workspaceAdmin:true,workspaceAttend:false},DIALOGOS),false);
 // Y Velai sin cabecera sigue sin atender a los clientes.
 await assert.rejects(api(`conversations/${naya}/takeover`,'POST',{},null),error(403,'velai_no_atiende_clientes'));
});

test('con espacio_atender=0 tomar y responder dan espacio_sin_atencion, pero devolver a Vai sí funciona',async t=>{
 const{api,DB}=await fixture(t);
 // La que atiende el equipo del cliente NO se puede devolver desde el espacio: es suya.
 await DB.prepare('INSERT INTO tenant_users (email,tenant_id,created_at) VALUES (?,?,?)').bind('persona@dialogos.test',DIALOGOS,'2026-01-01').run();
 const suya=await conv(DB,DIALOGOS,'humano','persona@dialogos.test');
 assert.notEqual((await api(`inbox?conversation=${suya}`)).thread.window.canRelease,true);
 await assert.rejects(api(`conversations/${suya}/release`,'POST',{}),error(403,'espacio_sin_atencion'));
 assert.deepEqual(await DB.prepare('SELECT state,agent_email FROM conversations WHERE id=?').bind(suya).first(),{state:'humano',agent_email:'persona@dialogos.test'});
 // La que tomó alguien de Velai sí, para que apagar la atención no la deje atascada.
 const id=await conv(DB,DIALOGOS,'humano','colega@velai.test');
 const win=(await api(`inbox?conversation=${id}`)).thread.window;
 assert.equal(win.open,false);assert.equal(win.reason,'espacio_sin_atencion');assert.equal(win.canRelease,true);
 await assert.rejects(api(`conversations/${id}/takeover`,'POST',{}),error(403,'espacio_sin_atencion'));
 await assert.rejects(api(`conversations/${id}/reply`,'POST',{text:'hola'}),error(403,'espacio_sin_atencion'));
 assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM conv_messages WHERE conversation_id=? AND role='agent'").bind(id).first()).n,0);
 assert.equal((await api(`conversations/${id}/release`,'POST',{})).state,'bot');
 assert.deepEqual(await DB.prepare('SELECT state,agent_email FROM conversations WHERE id=?').bind(id).first(),{state:'bot',agent_email:null});
 // Devolver no abre otros tenants ni a Velai sin espacio.
 const naya=await conv(DB,NAYA,'humano','persona@naya.test');
 await assert.rejects(api(`conversations/${naya}/release`,'POST',{}),error(404,'not_found'));
 await assert.rejects(api(`conversations/${naya}/release`,'POST',{},null),error(403,'velai_no_atiende_clientes'));
 assert.equal((await DB.prepare('SELECT state FROM conversations WHERE id=?').bind(naya).first()).state,'humano');
});

test('ficha: solo Velai cambia Espacio de Velai, se versiona y apagar el selector apaga la atención',async t=>{
 const{api,DB,client}=await fixture(t,{atender:true});
 const patch=async(id,body,choice=null,scope)=>{
  const row=await DB.prepare('SELECT updated_at FROM tenants WHERE id=?').bind(id).first();
  return api(`tenants/${id}`,'PATCH',{...body,expected_updated_at:row.updated_at},choice,scope);
 };
 const flags=async(id)=>DB.prepare('SELECT espacio_velai,espacio_atender FROM tenants WHERE id=?').bind(id).first();
 await assert.rejects(patch(DIALOGOS,{espacio_velai:false},null,client),error(403,'not_authorized'));
 await assert.rejects(patch(DIALOGOS,{espacio_velai:false},'dialogos'),error(403,'not_authorized'));
 // El autoservicio del cliente pasa un subconjunto fijo: los campos de espacio no viajan.
 await api(`tenants/${DIALOGOS}/notify`,'PATCH',{weekly_report:true,espacio_velai:false,espacio_atender:false},null,client);
 assert.deepEqual(await flags(DIALOGOS),{espacio_velai:1,espacio_atender:1});
 const detail=(await api(`tenants/${DIALOGOS}`,'GET',undefined,null)).tenant;
 assert.equal(detail.espacio_velai,1);assert.equal(detail.espacio_atender,1);
 await DB.prepare('INSERT INTO tenant_users (email,tenant_id,created_at) VALUES (?,?,?)').bind('persona@dialogos.test',DIALOGOS,'2026-01-01').run();
 for(const email of[ADMIN_EMAIL,'persona@dialogos.test'])await DB.prepare('INSERT INTO agent_presence (tenant_id,email,available,updated_at) VALUES (?,?,1,?)').bind(DIALOGOS,email,'2026-10-01').run();
 await patch(DIALOGOS,{espacio_velai:false,note:'fin del acuerdo'});
 assert.deepEqual(await flags(DIALOGOS),{espacio_velai:0,espacio_atender:0});
 const version=await DB.prepare('SELECT actor_email,field,previous_value,note FROM tenant_versions WHERE tenant_id=? ORDER BY id DESC LIMIT 1').bind(DIALOGOS).first();
 assert.equal(version.actor_email,ADMIN_EMAIL);assert.equal(version.field,'config');assert.equal(version.note,'fin del acuerdo');
 assert.deepEqual(JSON.parse(version.previous_value),{espacio_velai:1,espacio_atender:1});
 // La disponibilidad que Velai marcó dentro desaparece; la del equipo del cliente, no.
 assert.deepEqual((await DB.prepare('SELECT email FROM agent_presence WHERE tenant_id=?').bind(DIALOGOS).all()).results,[{email:'persona@dialogos.test'}]);
 await assert.rejects(api('me'),error(403,'workspace_unavailable'));
 await assert.rejects(patch(DIALOGOS,{espacio_atender:true}),error(400,'espacio_atender_sin_espacio'));
 await patch(DIALOGOS,{espacio_velai:true});
 assert.deepEqual(await flags(DIALOGOS),{espacio_velai:1,espacio_atender:0});
 assert.equal((await api('me')).workspace.canAttend,false);
 await patch(DIALOGOS,{espacio_atender:true});
 assert.equal((await api('me')).workspace.canAttend,true);
 await assert.rejects(patch(VELAI,{espacio_velai:true}),error(400,'espacio_tenant_casa'));
 await assert.rejects(patch(MESSENGER,{espacio_velai:true,espacio_atender:true}),error(400,'espacio_tenant_casa'));
 await assert.rejects(patch(MESSENGER,{espacio_atender:true}),error(400,'espacio_tenant_casa'));
 for(const id of[VELAI,MESSENGER])assert.deepEqual(await flags(id),{espacio_velai:0,espacio_atender:0});
});

test('migración 0058: Diálogos y Naya quedan como espacio atendible y el resto no cambia',async t=>{
 const DB=await sqliteD1({through:'0057'});t.after(()=>DB.close());
 for(const slug of['colegiale-sevilla','dialogos','gogestion'])await DB.prepare('INSERT INTO tenants (id,slug,name,channel_address,system_prompt,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
  .bind(crypto.randomUUID(),slug,slug,`web:${slug}`,'test','2026-01-01','2026-01-01').run();
 await DB.exec(await readFile(new URL('../migrations/0058_tenant_espacio.sql',import.meta.url),'utf8'));
 assert.deepEqual((await DB.prepare('SELECT slug,espacio_velai,espacio_atender FROM tenants ORDER BY slug').all()).results,[
  {slug:'colegiale-sevilla',espacio_velai:1,espacio_atender:1},{slug:'dialogos',espacio_velai:1,espacio_atender:1},
  {slug:'gogestion',espacio_velai:0,espacio_atender:0},{slug:'velai',espacio_velai:0,espacio_atender:0},
  {slug:'velai-messenger',espacio_velai:0,espacio_atender:0}]);
});
