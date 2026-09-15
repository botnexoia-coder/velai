import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingFixture, BOOKING_TEST_TENANT as TID } from './helpers/booking-fixture.js';
import { testing, processBookingNotifications } from '../worker/app.js';
import { frameOrigins } from '../worker/booking-security.js';
import { appointmentIcs } from '../worker/reserva-page.js';
const date = ()=>new Date(Date.now()+7*86400000).toISOString().slice(0,10);
async function fixture(t){const f=await bookingFixture(),old=globalThis.fetch;globalThis.fetch=f.fetchProvider;t.after(async()=>{await f.close();globalThis.fetch=old;});return f;}
async function book(f,hour='10:00',phone='+34612345678'){
 const start=date()+'T'+hour;
 const h=await f.request('/api/reservas/dialogos/hold',{fecha_hora:start,servicio:'presencial',turnstileToken:f.human()});
 assert.equal(h.status,200,await h.clone().text());
 return f.request('/api/reservas/dialogos',{...(await h.json()),fecha_hora:start,servicio:'presencial',nombre:'Ana <script>',telefono:phone,privacy:true,turnstileToken:f.human()});
}

test('público: reserva y gestión reales con D1 y Google mockeado; token de otro tenant = 404',async(t)=>{
 const f=await fixture(t);
 const response=await book(f);assert.equal(response.status,200,await response.clone().text());
 const {appointment:a}=await response.json();assert.equal(f.events.size,1);assert.equal(a.name,'Ana <script>');
 const page=await f.request(new URL(a.manage_url).pathname);assert.equal(page.status,200);assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.equal(page.headers.get('cache-control'),'no-store');
 const html=await page.text();assert.ok(!html.includes('Ana <script>'));assert.ok(html.includes('Ana \\u003cscript>'));
 const token=a.manage_url.split('/').pop();
 await f.DB.prepare("INSERT INTO tenants(id,slug,name,channel_address,system_prompt,created_at,updated_at) VALUES ('other','otro','Otro','web:otro','test',?,?)").bind(new Date().toISOString(),new Date().toISOString()).run();
 await f.DB.exec("INSERT INTO tenant_calendars(tenant_id,provider,refresh_token_enc,connected_by,connected_at,updated_at,booking_enabled) VALUES ('other','google','test','test','2026-01-01','2026-01-01',1)");
 assert.equal((await f.request('/otro/cita/'+token)).status,404);
 const ics=await f.request(new URL(a.ics_url).pathname);assert.equal(ics.status,200);assert.match(await ics.text(),/BEGIN:VCALENDAR/);
 const cancel=await f.request('/api/cita/'+token+'/cancelar',{});assert.equal(cancel.status,200);assert.equal(f.events.size,0);
});

test('apagado/inexistente indistinguibles; servicio ajeno e intento de cambiar tenant ignorados',async(t)=>{
 const f=await fixture(t);
 await f.DB.exec("UPDATE tenant_calendars SET booking_enabled=0");
 for(const suffix of ['/reservas','']){const path=suffix?'/dialogos'+suffix:'/api/reservas/dialogos';const missing=suffix?'/inventado'+suffix:'/api/reservas/inventado';const a=await f.request(path),b=await f.request(missing);assert.equal(a.status,404);assert.deepEqual(await a.json(),await b.json());}
 await f.DB.exec("UPDATE tenant_calendars SET booking_enabled=1");
 const r=await f.request('/api/reservas/dialogos/huecos?mes='+date().slice(0,7)+'&s=otro-servicio');assert.equal(r.status,404);
 const rows=await (await f.request('/api/reservas/dialogos?tenant=other')).json();assert.equal(rows.name,'Diálogos que Enseñan');assert.ok(!JSON.stringify(rows).includes('refresh_token'));
 // La marca sale del MISMO aprovisionamiento que el chat: si un campo deja de viajar,
 // la página pinta el color por defecto de Velai y nadie se entera hasta verla.
 assert.equal(rows.brand_color,'#0f766e');assert.equal(rows.brand_color_2,'#134e4a');assert.ok('accent_color' in rows);
});

test('escrituras públicas: Origin exacto, JSON acotado, Turnstile hostname/action exactos y tokens de un uso',async(t)=>{
 const f=await fixture(t);const body={fecha_hora:date()+'T10:00',servicio:'presencial',turnstileToken:f.human()};
 for(const Origin of ['https://attacker.test','null',''])assert.equal((await f.request('/api/reservas/dialogos/hold',body,{Origin})).status,403);
 const wrongType=await f.worker.fetch(new Request(f.origin+'/api/reservas/dialogos/hold',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/jsonp'},body:JSON.stringify(body)}),f.env,f.ctx);assert.equal(wrongType.status,415);
 for(const token of ['bad','wrong-host','wrong-action','no-host'])assert.equal((await f.request('/api/reservas/dialogos/hold',{...body,turnstileToken:token})).status,403);
 const token=f.human();assert.equal((await f.request('/api/reservas/dialogos/hold',{...body,turnstileToken:token})).status,200);
 assert.equal((await f.request('/api/reservas/dialogos/hold',{...body,fecha_hora:date()+'T11:00',turnstileToken:token})).status,403);
 const oversized=await f.worker.fetch(new Request(f.origin+'/api/reservas/dialogos',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json'},body:JSON.stringify({junk:'x'.repeat(5000)})}),f.env,f.ctx);assert.equal(oversized.status,413);
 assert.equal(f.events.size,0);
});

test('reagendar conserva la anterior si no hay hueco y la cancela solo tras asegurar otra',async(t)=>{
 const f=await fixture(t);const response=await book(f);const {appointment:a}=await response.json(),token=a.manage_url.split('/').pop();
 const bad=await f.request('/api/cita/'+token+'/reagendar',{fecha_hora:date()+'T10:00',servicio:'presencial',hold:'inventado',turnstileToken:f.human()});assert.equal(bad.status,409);assert.equal(f.events.size,1);
 const hold=await (await f.request('/api/reservas/dialogos/hold',{fecha_hora:date()+'T11:00',servicio:'presencial',turnstileToken:f.human()})).json();
 const res=await f.request('/api/cita/'+token+'/reagendar',{...hold,fecha_hora:date()+'T11:00',servicio:'presencial',turnstileToken:f.human()});assert.equal(res.status,200,await res.clone().text());assert.equal(f.events.size,1);
 const rows=(await f.DB.prepare('SELECT status,rescheduled_from FROM appointments WHERE tenant_id=? ORDER BY starts_at').bind(TID).all()).results;
 assert.equal(rows[0].status,'cancelled');assert.equal(rows[1].status,'confirmed');assert.ok(rows[1].rescheduled_from);
});

test('dos reagendas simultáneas de la misma cita producen una sola sustituta',async(t)=>{
 const f=await fixture(t);const response=await book(f);const {appointment:a}=await response.json(),token=a.manage_url.split('/').pop();
 const holds=[];
 for(const hour of ['11:00','12:00']) holds.push(await (await f.request('/api/reservas/dialogos/hold',{fecha_hora:date()+'T'+hour,servicio:'presencial',turnstileToken:f.human()})).json());
 const results=await Promise.all([
   f.request('/api/cita/'+token+'/reagendar',{...holds[0],fecha_hora:date()+'T11:00',servicio:'presencial',turnstileToken:f.human()}),
   f.request('/api/cita/'+token+'/reagendar',{...holds[1],fecha_hora:date()+'T12:00',servicio:'presencial',turnstileToken:f.human()}),
 ]);
 assert.deepEqual(results.map((r)=>r.status).sort(),[200,409]);
 assert.equal(f.events.size,1);
 assert.equal((await f.DB.prepare("SELECT count(*) AS n FROM appointments WHERE tenant_id=? AND status='confirmed'").bind(TID).first()).n,1);
});

test('CSP admite solo orígenes HTTPS exactos del tenant y panel; JSON y .ics resisten inyección',async(t)=>{
 const f=await fixture(t);
 // El formato es el que ESCRIBE el panel (validateTenant: array JSON). Leerlo como CSV
 // dejaba la página sin los dominios del cliente y el embed muerto, con los tests en verde.
 assert.deepEqual(frameOrigins(f.env,{web_origins:JSON.stringify(['https://ok.test','https://*.evil.test','https://ok.test/path','https://bad.test;script-src *','http://insecure.test'])}),['https://ok.test','https://admin.hirevai.com']);
 assert.deepEqual(frameOrigins(f.env,{web_origins:'https://csv.test,https://otro.test'}),['https://admin.hirevai.com']);
 const page=await f.request('/dialogos/reservas');const csp=page.headers.get('content-security-policy');assert.match(csp,/frame-ancestors https:\/\/dialogosqueensenan.com https:\/\/www.dialogosqueensenan.com https:\/\/admin.hirevai.com$/);assert.ok(!csp.includes('unsafe-inline'));
 const ics=appointmentIcs({id:'test',created_at:new Date().toISOString(),starts_at:new Date().toISOString(),ends_at:new Date().toISOString(),reason:'a\r\nBEGIN:VEVENT\rX-INJECTED: yes\n'+('é'.repeat(100)),status:'confirmed'});
 assert.equal(ics.split('\r\nBEGIN:VEVENT').length,2);for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
 assert.ok(!ics.includes('\rX-INJECTED'));
});

test('CRUD admin: cliente crea/configura solo lo suyo, valida excepciones y desactiva servicios',async(t)=>{
 const f=await fixture(t);const scope={role:'cliente',tenantId:TID,email:'test@example.com'};
 const call=async(path,method='GET',body)=>{const req=new Request('https://admin.hirevai.com'+path,{method,body:body?JSON.stringify(body):undefined,headers:{'Content-Type':'application/json'}});return testing.adminRouter(req,f.env,f.ctx,path,new URL(req.url),{},scope);};
 const base='/api/admin/tenants/'+TID;
 assert.equal((await call(base+'/services','POST',{slug:'extra',name:'Extra',minutes:90,buffer_min:30})).status,200);
 const rows=await (await call(base+'/services')).json();assert.equal(rows.services.length,4);
 await assert.rejects(call('/api/admin/tenants/00000000-0000-4000-8000-00000000000b/services'),(e)=>e.status===404);
 assert.equal((await call(base+'/booking','PATCH',{min_notice_min:60,exceptions:[{date:date(),windows:null}]})).status,200);
 await assert.rejects(call(base+'/booking','PATCH',{exceptions:[{date:date(),windows:[['10:00','12:00'],['11:00','13:00']]}]}),(e)=>e.status===400);
 const extra=rows.services.find((s)=>s.slug==='extra');await call(base+'/services/'+extra.id,'DELETE');
 assert.equal((await f.DB.prepare('SELECT active FROM tenant_services WHERE id=?').bind(extra.id).first()).active,0);
});

test('confirmación WhatsApp espera plantilla aprobada y no duplica entre entregas simultáneas',async(t)=>{
 const f=await fixture(t);await f.DB.exec("UPDATE tenants SET reminders_enabled=1,twilio_from='whatsapp:+15005550006' WHERE slug='dialogos'");
 await book(f);assert.equal((await f.DB.prepare('SELECT status FROM booking_notifications').first()).status,'pending');
 await processBookingNotifications(f.env);assert.equal((await f.DB.prepare('SELECT attempts FROM booking_notifications').first()).attempts,0);
 await f.DB.prepare("INSERT INTO tenant_templates(tenant_id,kind,sid,status,created_at,updated_at) VALUES (?,'confirmacion_reserva',?,'approved',?,?)").bind(TID,'HX'+'a'.repeat(32),new Date().toISOString(),new Date().toISOString()).run();
 Object.assign(f.env,{TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'test'});const deliveries=[];
 globalThis.fetch=async(url,init)=>{if(String(url).includes('api.twilio.com')){deliveries.push(new URLSearchParams(init.body));return Response.json({sid:'SMtest'});}return f.fetchProvider(url,init);};
 await Promise.all([processBookingNotifications(f.env),processBookingNotifications(f.env)]);assert.equal(deliveries.length,1);
 assert.match(JSON.parse(deliveries[0].get('ContentVariables'))['5'],/^https:\/\/citas.hirevai.com\/dialogos\/cita\/[a-f0-9]{32}$/);
});

test('el chat solo emite la tarjeta estructurada desde la tool habilitada del tenant',async(t)=>{
 const f=await fixture(t);const meta={channel:'web',conversationKey:'c1',defaultPhone:''};
 const cal=await f.DB.prepare('SELECT * FROM tenant_calendars WHERE tenant_id=?').bind(TID).first();
 const exec=testing.calendarExecutor(f.env,{id:TID,slug:'dialogos'},cal,meta);
 const result=JSON.parse(await exec('enviar_enlace_reserva',{servicio:'video'}));
 assert.equal(result.url,'https://citas.hirevai.com/dialogos/reservas?s=video');
 assert.deepEqual(meta.bookingCard,{type:'booking',url:result.url,label:'Ver calendario'});
 await f.DB.prepare('UPDATE tenant_calendars SET booking_enabled=0 WHERE tenant_id=?').bind(TID).run();
 const disabled=testing.calendarExecutor(f.env,{id:TID,slug:'dialogos'},cal,{channel:'web',conversationKey:'c2',defaultPhone:''});
 assert.equal(JSON.parse(await disabled('enviar_enlace_reserva',{})).error,'tool_desconocida');
});
