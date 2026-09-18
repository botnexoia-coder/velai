import { sqliteD1 } from './sqlite-d1.js';
import { createWorker } from '../../worker/app.js';
export const BOOKING_TEST_TENANT = '00000000-0000-4000-8000-00000000000a';
export async function bookingFixture() {
  const DB = await sqliteD1();
  const now = new Date().toISOString();
  const hours = JSON.stringify(Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map((d)=>[d,[['09:00','14:00'],['16:00','20:00']]])));
  await DB.prepare("INSERT INTO tenants(id,slug,name,channel_address,system_prompt,web_origins,brand_color,brand_color_2,created_at,updated_at) VALUES (?,'dialogos','Diálogos que Enseñan','web:booking-test','test',?,'#0f766e','#134e4a',?,?)").bind(BOOKING_TEST_TENANT,JSON.stringify(['https://dialogosqueensenan.com','https://www.dialogosqueensenan.com']),now,now).run();
  await DB.prepare("INSERT INTO tenant_calendars(tenant_id,provider,refresh_token_enc,connected_by,connected_at,updated_at,booking_enabled,business_hours) VALUES (?,'google','test','test',?,?,1,?)").bind(BOOKING_TEST_TENANT,now,now,hours).run();
  for (const [i,slug,mode,minutes] of [[1,'presencial','presencial',30],[2,'video','video',60],[3,'telefono','telefono',30]]) {
    await DB.prepare('INSERT INTO tenant_services(id,tenant_id,slug,name,minutes,mode,location,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind('00000000-0000-4000-8000-00000000000'+i,BOOKING_TEST_TENANT,slug,'Sesión '+slug,minutes,mode,mode==='video'?'https://example.com/sala':'Lugar de prueba',now,now).run();
  }
  const origin = 'https://citas.hirevai.com';
  const cache = new Map([['caltoken:'+BOOKING_TEST_TENANT,'test-access-token']]);
  const env = { DB, BOOKING_ORIGIN:origin, ADMIN_ORIGIN:'https://admin.hirevai.com', APP_SECRET:'test-secret-for-booking-'.repeat(3),
    TURNSTILE_SITEKEY:'test-sitekey',TURNSTILE_SECRET_KEY:'test-secret',ALLOWED_WEB_ORIGINS:origin, GOOGLE_OAUTH_CLIENT_ID:'test-id',
    KV:{ get:async (k,type)=>{const v=cache.get(k)||null;return type==='json'&&v?JSON.parse(v):v;},put:async(k,v)=>cache.set(k,v),delete:async(k)=>cache.delete(k) } };
  const events = new Map(), requests = [], used = new Set(), waits = [];
  let tokenCount = 0;
  const worker = createWorker({SYSTEM:'test',GUARDRAILS:'test',DEMOS:{}});
  const ctx = {waitUntil(p){waits.push(p);}};
  const fetchProvider = async (url,init={}) => {
    const u=new URL(url); requests.push({url:u.href,method:init.method||'GET'});
    if(u.hostname==='challenges.cloudflare.com'){
      const token=init.body.get('response');
      if(used.has(token))return Response.json({success:false}); used.add(token);
      return Response.json({success:token!=='bad',action:token==='wrong-action'?'chat':'reserva',hostname:token==='wrong-host'?'hirevai.com':token==='no-host'?undefined:'citas.hirevai.com'});
    }
    if(u.hostname!=='www.googleapis.com')throw new Error('Unexpected network request');
    if(u.pathname.endsWith('/events')&&(!init.method||init.method==='GET'))return Response.json({items:[...events.values()]});
    if(init.method==='DELETE'){events.delete(u.pathname.split('/').pop());return new Response(null,{status:204});}
    if(!init.method||init.method==='GET'){const event=events.get(u.pathname.split('/').pop());return Response.json(event||{},{status:event?200:404});}
    const event=JSON.parse(init.body);
    if(events.has(event.id))return Response.json({},{status:409});
    events.set(event.id,{...event,status:'confirmed'}); return Response.json({id:event.id},{status:201});
  };
  const human = ()=>'token-'+(++tokenCount);
  const request = (path,body,headers={}) => worker.fetch(new Request(origin+path,body===undefined?{headers}:{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),env,ctx);
  return {env,DB,events,requests,worker,ctx,origin,human,fetchProvider,request,async close(){await Promise.allSettled(waits);DB.close();}};
}
