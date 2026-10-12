import test from 'node:test';
import assert from 'node:assert/strict';
import { testing } from '../worker/app.js';
import { sqliteD1 } from './helpers/sqlite-d1.js';

const ADMIN_EMAIL='estiven@velai.test', DIALOGOS='00000000-0000-4000-8000-000000000d01', OTHER='00000000-0000-4000-8000-000000000d02', NAYA='00000000-0000-4000-8000-000000000d03';
const error=(status,code)=>(e)=>e.status===status&&e.code===code;
async function fixture(t){
 const DB=await sqliteD1();t.after(()=>DB.close());
 const env={DB,ADMIN_EMAILS:'raiz@velai.test',SOCIOS_EMAILS:'raiz@velai.test'};
 await DB.prepare('INSERT INTO admin_users (email,created_by,created_at) VALUES (?,?,?)').bind(ADMIN_EMAIL,'raiz@velai.test','2026-01-01').run();
 for(const[id,slug]of[[DIALOGOS,'dialogos'],[OTHER,'otro-workspace'],[NAYA,'colegiale-sevilla']])await DB.prepare('INSERT INTO tenants (id,slug,name,channel_address,system_prompt,plan,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
  .bind(id,slug,slug==='dialogos'?'Diálogos':'Otro cliente',`web:${slug}`,'test','profesional','2026-01-01','2026-01-01').run();
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
  for(const choice of[OTHER,'otro-workspace','Velai',''])await assert.rejects(api('me','GET',undefined,choice),error(400,'workspace_invalido'));
 }finally{env.DB=native;}
 assert.equal((await api('me','GET',undefined,null,client)).workspace.canSwitch,false);
 await DB.prepare('UPDATE tenants SET active=0 WHERE id=?').bind(DIALOGOS).run();
 await assert.rejects(api('me'),error(403,'workspace_unavailable'));
 await DB.prepare("UPDATE tenants SET active=1,plan='esencial' WHERE id=?").bind(DIALOGOS).run();
 const limited=await api('me');assert.deepEqual(limited.modulos,[]);assert.equal(limited.editorialEditable,false);
 await assert.rejects(api(`tenants/${DIALOGOS}/editorial`),error(403,'modulo_no_contratado'));
 await DB.prepare("UPDATE tenants SET slug='dialogos-ausente' WHERE id=?").bind(DIALOGOS).run();
 await assert.rejects(api('me'),error(404,'workspace_not_found'));
 env.DB={prepare(){return {bind(){return this;},first:async()=>({id:DIALOGOS,slug:'dialogos',active:1,plan:null})};}};
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
 await assert.rejects(api(`conversations/${id}/takeover`,'POST',{}),error(403,'velai_no_atiende_clientes'));
 await assert.rejects(api('availability','PATCH',{available:true}),error(403,'velai_no_atiende_clientes'));
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
 assert.equal(selected.workspace.current,'naya');assert.equal(selected.workspace.canSwitch,true);assert.equal(selected.workspace.canAttend,false);
 const ids=[crypto.randomUUID(),crypto.randomUUID()];
 for(const [id,tenant] of [[ids[0],NAYA],[ids[1],DIALOGOS]])await DB.prepare('INSERT INTO leads (id,request_id,source,name,status,tenant_id,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,id,'web',tenant===NAYA?'NAYA_PROPIO':'DIALOGOS_AJENO','new',tenant,'2026-10-01','2026-10-01','2099-01-01').run();
 assert.deepEqual((await api('leads','GET',undefined,'naya')).leads.map(r=>r.id),[ids[0]]);
 const csv=await(await call('leads/export.csv','GET',undefined,'naya')).text();assert.match(csv,/NAYA_PROPIO/);assert.doesNotMatch(csv,/DIALOGOS_AJENO/);
 await assert.rejects(api(`leads/${ids[1]}`,'GET',undefined,'naya'),error(404,'not_found'));
 await assert.rejects(api('gestion/catalogos','GET',undefined,'naya'),error(403,'not_authorized'));
 await assert.rejects(api('availability','PATCH',{available:true},'naya'),error(403,'velai_no_atiende_clientes'));
 await assert.rejects(api('me','GET',undefined,'naya',client),error(403,'not_authorized'));
 await assert.rejects(api('mobile-preview/me','GET',undefined,'naya'),error(400,'workspace_preview_unavailable'));
 await DB.prepare('UPDATE tenants SET active=0 WHERE id=?').bind(NAYA).run();
 await assert.rejects(api('me','GET',undefined,'naya'),error(403,'workspace_unavailable'));
 assert.equal((await api('me','GET',undefined,'velai')).role,'velai');
 });
