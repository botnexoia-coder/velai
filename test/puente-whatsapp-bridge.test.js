import { handlePuenteInboundOptout, handlePuenteTwilioStatus, dispatchPuenteWhatsAppEvent } from '../worker/puente-whatsapp-events.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.js';
import { encryptSecret } from '../worker/crypto.js';
import { handlePuenteWhatsApp, bridgeDestinationHash } from '../worker/puente-whatsapp-bridge.js';
import { createWorker, testing } from '../worker/app.js';
const ACCOUNT='AC'+'a'.repeat(32), FROM='whatsapp:+34641586513', SID=`SM${'a'.repeat(32)}`;
async function fixture(t) {
 const DB=await sqliteD1(); t.after(()=>DB.close());
 const env={DB,PUENTE_BRIDGE_TWILIO_ACCOUNT_SID:ACCOUNT,PUENTE_BRIDGE_DESTINATION_HASH_SECRET:'h'.repeat(43),PUENTE_BRIDGE_EVENTS_ENABLED:'true',PUENTE_BRIDGE_EVENTS_VERIFIED:'true',PUENTE_BRIDGE_EVENTS_SECRET:'e'.repeat(43),SECRETS_KEK:btoa('k'.repeat(32)),PUENTE_BRIDGE_SECRET:'s'.repeat(48),PUENTE_BRIDGE_ENABLED:'true',PUENTE_BRIDGE_READY:'true',PUENTE_BRIDGE_VERIFICATION_VERIFIED:'true',PUENTE_BRIDGE_OPPORTUNITY_VERIFIED:'true',PUENTE_BRIDGE_VERIFICATION_CONTENT_SID:`HX${'b'.repeat(32)}`,PUENTE_BRIDGE_OPPORTUNITY_CONTENT_SID:`HX${'c'.repeat(32)}`};
 await DB.prepare('INSERT INTO tenants (id,slug,name,channel_address,system_prompt,plan,created_at,updated_at,twilio_subaccount_sid,twilio_from,twilio_auth_token_enc) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind('alma-test','dialogos','Alma','web:dialogos','test','profesional','2026-01-01','2026-01-01',ACCOUNT,FROM,await encryptSecret(env,'alma-test','d'.repeat(32))).run();
 const body={type:'verification',destination:'+34000000001',verificationCode:'Ab123456789012'};
 let calls=0;
 const fetcher=async(url,options)=>{calls++; assert.equal(url,`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages.json`);assert.equal(options.redirect,'manual'); const form=new URLSearchParams(options.body);assert.equal(form.get('From'),FROM);assert.equal(form.has('Body'),false);return Response.json({sid:SID,account_sid:ACCOUNT,from:FROM,to:form.get('To')},{status:201});};
 const request=(payload=body,key='A'.repeat(43),headers={})=>new Request('https://api.hirevai.com/integrations/puente/whatsapp',{method:'POST',headers:{Authorization:`Bearer ${env.PUENTE_BRIDGE_SECRET}`,'Content-Type':'application/json','Idempotency-Key':key,...headers},body:JSON.stringify(payload)});
 return {env,DB,body,request,fetcher,calls:()=>calls};
}
test('bridge closed without READY and inaccessible to browser or invalid bearer',async t=>{
 const f=await fixture(t);delete f.env.PUENTE_BRIDGE_READY;
 assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher})).status,503);
 f.env.PUENTE_BRIDGE_READY='true';
 assert.equal((await handlePuenteWhatsApp(f.request(f.body,undefined,{Authorization:'Bearer wrong'}),f.env,{fetcher:f.fetcher})).status,401);
 assert.equal((await handlePuenteWhatsApp(f.request(f.body,undefined,{Origin:'https://puenteconalma.com'}),f.env,{fetcher:f.fetcher})).status,403);assert.equal(f.calls(),0);
});
test('bridge exact fields rejects arbitrary tenant sender text and malformed code/body',async t=>{
 const f=await fixture(t);
 for(const body of [{...f.body,tenant:'other'},{...f.body,from:FROM},{...f.body,text:'hello'},{...f.body,verificationCode:'bad'},{...f.body,verificationCode:'A'.repeat(15)},{type:'opportunity',destination:f.body.destination,verificationCode:'Ab123456789012'},Array(300).fill('x')]) assert.equal((await handlePuenteWhatsApp(f.request(body),f.env,{fetcher:f.fetcher})).status,400);
 assert.equal(f.calls(),0);
});
test('tenant or approved template mismatch fails closed before provider',async t=>{
 const f=await fixture(t);f.env.PUENTE_BRIDGE_VERIFICATION_VERIFIED='false';assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher})).status,503);
 f.env.PUENTE_BRIDGE_VERIFICATION_VERIFIED='true';await f.DB.prepare("UPDATE tenants SET twilio_subaccount_sid=? WHERE slug='dialogos'").bind(`AC${'e'.repeat(32)}`).run();
 assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher})).status,503);assert.equal(f.calls(),0);
});
test('accepted dispatch replay is idempotent; conflicting body never resends',async t=>{
 const f=await fixture(t);for(let i=0;i<2;i++) assert.deepEqual(await (await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher})).json(),{accepted:true,messageId:SID});
 assert.equal(f.calls(),1);assert.equal((await handlePuenteWhatsApp(f.request({...f.body,destination:'+34000000002'}),f.env,{fetcher:f.fetcher})).status,409);
 const row=await f.DB.prepare('SELECT * FROM puente_whatsapp_dispatch').first();assert.equal(JSON.stringify(row).includes(f.body.destination),false);assert.equal(JSON.stringify(row).includes(f.body.verificationCode),false);
});
test('redirect, network uncertainty and mismatched receipts are never retried',async t=>{
 const f=await fixture(t);
 for(const [i,fetcher] of [async()=>new Response(null,{status:302,headers:{Location:'https://evil.test'}}),async()=>{throw new Error('network');},async()=>Response.json({sid:SID,account_sid:'other',from:FROM,to:`whatsapp:${f.body.destination}`},{status:201})].entries()) {
  const key=`${i+1}${'A'.repeat(42)}`;let calls=0;const wrapped=async(...a)=>{calls++;return fetcher(...a);};
  assert.equal((await handlePuenteWhatsApp(f.request(f.body,key),f.env,{fetcher:wrapped})).status,502);
  assert.equal((await handlePuenteWhatsApp(f.request(f.body,key),f.env,{fetcher:wrapped})).status,409);assert.equal(calls,1);
 }
});
test('durable per-destination budget blocks fourth fresh request',async t=>{
 const f=await fixture(t);const body={type:'opportunity',destination:f.body.destination};
 for(let i=1;i<=4;i++){const result=await handlePuenteWhatsApp(f.request(body,`${i}${'A'.repeat(42)}`),f.env,{fetcher:f.fetcher});assert.equal(result.status,i===4?429:200);}assert.equal(f.calls(),3);
});
test('router exposes bridge behind dedicated auth without opening admin or inbound routes',async t=>{
 const f=await fixture(t);delete f.env.PUENTE_BRIDGE_READY;
 assert.equal((await createWorker({}).fetch(f.request(),f.env,{waitUntil(){}})).status,503);
});
test('concurrent same key permits exactly one provider invocation',async t=>{
 const f=await fixture(t);const results=await Promise.all(Array.from({length:5},()=>handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher})));
 assert.equal(f.calls(),1);assert.ok(results.every(r=>r.status===200||r.status===409));
});
test('invalid key and oversized provider receipt fail safely',async t=>{
 const f=await fixture(t);assert.equal((await handlePuenteWhatsApp(f.request(f.body,'bad'),f.env,{fetcher:f.fetcher})).status,400);
 let calls=0;const fetcher=async()=>{calls++;return new Response('x'.repeat(5000),{status:201});};
 assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher})).status,502);
 assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher})).status,409);assert.equal(calls,1);
});
test('only configured API host allowed and idempotency keys preserve case',async t=>{
 const f=await fixture(t);
 const wrong=new Request('https://vai-worker.botnexo-ia.workers.dev/integrations/puente/whatsapp',f.request());
 assert.equal((await handlePuenteWhatsApp(wrong,f.env,{fetcher:f.fetcher})).status,403);
 for(const key of ['A'.repeat(43),'a'.repeat(43)])assert.equal((await handlePuenteWhatsApp(f.request(f.body,key),f.env,{fetcher:f.fetcher})).status,200);
 assert.equal(f.calls(),2);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM puente_whatsapp_dispatch').first()).n,2);
});
test('outer deadline fences fetch ignoring abort and keeps reservation nonrepeatable',{timeout:60000},async t=>{
 const f=await fixture(t);let calls=0,started;const entered=new Promise(resolve=>{started=resolve;});
 const fetcher=()=>{calls++;started();return new Promise(()=>{});};
 t.mock.timers.enable({apis:['setTimeout']});
 let settled=false;const pending=handlePuenteWhatsApp(f.request(),f.env,{fetcher,timeoutMs:100});void pending.then(()=>{settled=true;});
 await entered;t.mock.timers.tick(99);await Promise.resolve();assert.equal(settled,false);
 t.mock.timers.tick(1);assert.equal((await pending).status,502);
 assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher})).status,409);assert.equal(calls,1);
});
test('outer deadline fences provider stream ignoring abort',{timeout:60000},async t=>{
 const f=await fixture(t);let calls=0,started;const reading=new Promise(resolve=>{started=resolve;});
 const fetcher=async()=>{calls++;return new Response(new ReadableStream({pull(){started();return new Promise(()=>{});},cancel(){return new Promise(()=>{});}},{highWaterMark:0}),{status:201});};
 t.mock.timers.enable({apis:['setTimeout']});
 let settled=false;const pending=handlePuenteWhatsApp(f.request(),f.env,{fetcher,timeoutMs:100});void pending.then(()=>{settled=true;});
 await reading;t.mock.timers.tick(99);await Promise.resolve();assert.equal(settled,false);
 t.mock.timers.tick(1);assert.equal((await pending).status,502);
 assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher})).status,409);assert.equal(calls,1);
});
async function eventsFixture(t){
 const f=await fixture(t);Object.assign(f.env,{PUENTE_BRIDGE_EVENTS_ENABLED:'true',PUENTE_BRIDGE_EVENTS_VERIFIED:'true',PUENTE_BRIDGE_EVENTS_SECRET:'e'.repeat(43)});
 const tenant=await f.DB.prepare("SELECT * FROM tenants WHERE slug='dialogos'").first();
 const inbound=(command='BAJA PUENTE',messageId=`SM${'f'.repeat(32)}`)=>new URLSearchParams({AccountSid:ACCOUNT,To:FROM,From:`whatsapp:${f.body.destination}`,Body:command,MessageSid:messageId});
 return {...f,tenant,inbound};
}
async function signedRequest(url,params,token='d'.repeat(32)) {
 const object=Object.fromEntries(params);const signed=url+Object.keys(object).sort().map(key=>key+object[key]).join('');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(signed)))));
 return new Request(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':signature},body:params.toString()});
}
test('reserved optout persists once encrypted and suppresses future dispatch before forwarding',async t=>{
 const f=await eventsFixture(t);
 for(let i=0;i<2;i++){const result=await handlePuenteInboundOptout(f.env,f.tenant,f.inbound());assert.equal(result.status,200);assert.equal((await result.text()).includes('<Message>'),false);}
 const rows=(await f.DB.prepare('SELECT * FROM puente_whatsapp_events').all()).results;assert.equal(rows.length,1);assert.equal(JSON.stringify(rows).includes(f.body.destination),false);assert.equal(JSON.stringify(rows).includes('BAJA'),false);
 assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher})).status,409);assert.equal(f.calls(),0);
});
test('ordinary Alma conversation unchanged; universal STOP forwards without intercepting Alma',async t=>{
 const f=await eventsFixture(t);assert.equal(await handlePuenteInboundOptout(f.env,f.tenant,f.inbound('Quiero hablar con Alma')),null);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM puente_whatsapp_events').first()).n,0);
 assert.equal(await handlePuenteInboundOptout(f.env,{...f.tenant,slug:'other'},f.inbound()),null);
 assert.equal(await handlePuenteInboundOptout(f.env,f.tenant,f.inbound('STOP')),null);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM puente_whatsapp_events').first()).n,1);
});
test('optout D1 failure does not acknowledge nor invoke AI; inbound signature checked before enqueue',async t=>{
 const f=await eventsFixture(t);await f.DB.prepare('UPDATE tenants SET channel_address=? WHERE id=?').bind(FROM,f.tenant.id).run();
 const worker=createWorker({}),ctx={waitUntil(){}};
 const invalid=new Request('https://api.hirevai.com/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':'invalid'},body:f.inbound().toString()});
 assert.equal((await worker.fetch(invalid,f.env,ctx)).status,403);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM puente_whatsapp_events').first()).n,0);
 const accepted=await worker.fetch(await signedRequest('https://api.hirevai.com/',f.inbound()),f.env,ctx);assert.equal(accepted.status,200);
 const broken={...f.env,DB:{batch(){throw new Error('DB down');},prepare:f.DB.prepare}};
 await assert.rejects(handlePuenteInboundOptout(broken,f.tenant,f.inbound()));
});
test('Twilio status authenticates and correlates sender destination SID before encrypted event',async t=>{
 const f=await eventsFixture(t);await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher});
 const url='https://api.hirevai.com/integrations/puente/whatsapp/status';
 const params=new URLSearchParams({AccountSid:ACCOUNT,From:FROM,To:`whatsapp:${f.body.destination}`,MessageSid:SID,MessageStatus:'delivered'});
 const request=()=>signedRequest(url,params);
 const invalid=await request();invalid.headers.set('X-Twilio-Signature','bad');assert.equal((await handlePuenteTwilioStatus(invalid,f.env,testing.validTwilioSignature)).status,403);
 for(let i=0;i<2;i++)assert.equal((await handlePuenteTwilioStatus(await request(),f.env,testing.validTwilioSignature)).status,200);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM puente_whatsapp_events').first()).n,1);
 params.set('To','whatsapp:+34000000002');assert.equal((await handlePuenteTwilioStatus(await request(),f.env,testing.validTwilioSignature)).status,409);
 params.set('AccountSid',`AC${'9'.repeat(32)}`);assert.equal((await handlePuenteTwilioStatus(await request(),f.env,testing.validTwilioSignature)).status,400);
});
test('durable dispatcher retries same event identity after failure, renews timestamp and signs exact body',async t=>{
 const f=await eventsFixture(t);await handlePuenteInboundOptout(f.env,f.tenant,f.inbound());let now=Date.now(),calls=0;const seen=[];
 const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://puenteconalma.com/api/webhooks/alma-whatsapp');assert.equal(options.redirect,'manual');
  const h=options.headers;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(f.env.PUENTE_BRIDGE_EVENTS_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const hex=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${h['X-Puente-Event-Id']}.${h['X-Puente-Timestamp']}.${options.body}`)))].map(x=>x.toString(16).padStart(2,'0')).join('');assert.equal(h['X-Puente-Signature'],`v1=${hex}`);
  seen.push({id:h['X-Puente-Event-Id'],timestamp:h['X-Puente-Timestamp'],body:options.body});return calls===1?new Response(null,{status:503}):Response.json({accepted:true,eventId:h['X-Puente-Event-Id']});};
 assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher,now:()=>now}),{attempted:true,accepted:false});
 assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher,now:()=>now}),{attempted:false});now+=61000;
 assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher,now:()=>now}),{attempted:true,accepted:true});
 assert.equal(seen[0].id,seen[1].id);assert.equal(seen[0].body,seen[1].body);assert.notEqual(seen[0].timestamp,seen[1].timestamp);
 assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher,now:()=>now}),{attempted:false});assert.equal(calls,2);
});
test('dispatcher closed gates, concurrent claims and redirect cannot lose or multiply events',async t=>{
 const f=await eventsFixture(t);await handlePuenteInboundOptout(f.env,f.tenant,f.inbound());let calls=0;const fetcher=async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://evil.test'}});};
 f.env.PUENTE_BRIDGE_EVENTS_VERIFIED='false';assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher}),{attempted:false});assert.equal(calls,0);f.env.PUENTE_BRIDGE_EVENTS_VERIFIED='true';
 await Promise.all(Array.from({length:4},()=>dispatchPuenteWhatsAppEvent(f.env,{fetcher})));assert.equal(calls,1);
 const row=await f.DB.prepare('SELECT state,attempts FROM puente_whatsapp_events').first();assert.equal(row.state,'pending');assert.equal(row.attempts,1);
});
test('only matching durable ACK clears suppression; acknowledged replay never suppresses again',async t=>{
 const f=await eventsFixture(t);await handlePuenteInboundOptout(f.env,f.tenant,f.inbound());let now=Date.now();
 const wrong=async()=>Response.json({accepted:true,eventId:'wrong'});
 assert.equal((await dispatchPuenteWhatsAppEvent(f.env,{fetcher:wrong,now:()=>now})).accepted,false);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM puente_whatsapp_suppressions').first()).n,1);
 now+=61000;const correct=async(_url,opts)=>Response.json({accepted:true,eventId:opts.headers['X-Puente-Event-Id']});
 assert.equal((await dispatchPuenteWhatsAppEvent(f.env,{fetcher:correct,now:()=>now})).accepted,true);
 assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM puente_whatsapp_suppressions').first()).n,0);
 await handlePuenteInboundOptout(f.env,f.tenant,f.inbound());assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM puente_whatsapp_suppressions').first()).n,0);
 assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher})).status,200);
});
test('multiple pending optouts retain suppression until all are acknowledged',async t=>{
 const f=await eventsFixture(t);await handlePuenteInboundOptout(f.env,f.tenant,f.inbound());await handlePuenteInboundOptout(f.env,f.tenant,f.inbound('BAJA PUENTE',`SM${'1'.repeat(32)}`));
 const correct=async(_url,opts)=>Response.json({accepted:true,eventId:opts.headers['X-Puente-Event-Id']});
 await dispatchPuenteWhatsAppEvent(f.env,{fetcher:correct});assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM puente_whatsapp_suppressions').first()).n,1);
 await dispatchPuenteWhatsAppEvent(f.env,{fetcher:correct});assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM puente_whatsapp_suppressions').first()).n,0);
});
test('event dispatcher timeout retains pending row and bounded retry lease',async t=>{
 const f=await eventsFixture(t);await handlePuenteInboundOptout(f.env,f.tenant,f.inbound());let calls=0;
 const fetcher=()=>{calls++;return new Promise(()=>{});};const now=Date.now();
 assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher,timeoutMs:50,now:()=>now}),{attempted:true,accepted:false});
 assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher,now:()=>now}),{attempted:false});assert.equal(calls,1);
 assert.equal((await f.DB.prepare('SELECT state FROM puente_whatsapp_events').first()).state,'pending');
});
test('exclusive two-minute tick is noop when closed, without touching other Velai jobs',async()=>{
 const env={DB:{prepare(){assert.fail('closed tick must not query D1');}},KV:{list(){assert.fail('no lead queue');}}};
 await testing.scheduled(env,'*/2 * * * *');
});
test('exclusive two-minute tick bounds seven D1 statements and one fetch with no other jobs',async t=>{
 const f=await eventsFixture(t);await handlePuenteInboundOptout(f.env,f.tenant,f.inbound());let statements=0,fetches=0;
 const wrap=statement=>({bind:(...args)=>wrap(statement.bind(...args)),async first(){statements++;return statement.first();},async all(){statements++;return statement.all();},async run(){statements++;return statement.run();},_original:statement});
 const env={...f.env,KV:{list(){assert.fail('no lead queue');},get(){assert.fail('no KV');},delete(){assert.fail('no takeover');}},DB:{prepare(sql){assert.match(sql,/puente_whatsapp_/);return wrap(f.DB.prepare(sql));},batch(stmts){statements+=stmts.length;return f.DB.batch(stmts.map(s=>s._original));}}};
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{fetches++;assert.equal(url,'https://puenteconalma.com/api/webhooks/alma-whatsapp');return Response.json({accepted:true,eventId:options.headers['X-Puente-Event-Id']});};
 try{await testing.scheduled(env,'*/2 * * * *');}finally{globalThis.fetch=original;}
 assert.equal(fetches,1);assert.equal(statements,7);
});
test('early authenticated status waits durable for matching accepted SID and destination, then forwards once',async t=>{
 const f=await eventsFixture(t);let forwarded=0;
 const forward=async(_url,opts)=>{forwarded++;return Response.json({accepted:true,eventId:opts.headers['X-Puente-Event-Id']});};
 const fetcher=async(url,options)=>{
  const params=new URLSearchParams({AccountSid:ACCOUNT,From:FROM,To:`whatsapp:${f.body.destination}`,MessageSid:SID,MessageStatus:'delivered'});
  const result=await handlePuenteTwilioStatus(await signedRequest('https://api.hirevai.com/integrations/puente/whatsapp/status',params),f.env,testing.validTwilioSignature);assert.equal(result.status,200);
  assert.equal((await f.DB.prepare('SELECT state FROM puente_whatsapp_events').first()).state,'pending');
  assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher:forward}),{attempted:false});assert.equal(forwarded,0);
  return f.fetcher(url,options);
 };
 assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher})).status,200);
 assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher:forward}),{attempted:true,accepted:true});
 assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher:forward}),{attempted:false});assert.equal(forwarded,1);
});
test('early wrong destination and unknown signed SID cannot forward merely by SID',async t=>{
 const f=await eventsFixture(t);const params=new URLSearchParams({AccountSid:ACCOUNT,From:FROM,To:'whatsapp:+34000000002',MessageSid:SID,MessageStatus:'delivered'});
 const callback=()=>signedRequest('https://api.hirevai.com/integrations/puente/whatsapp/status',params);
 assert.equal((await handlePuenteTwilioStatus(await callback(),f.env,testing.validTwilioSignature)).status,200);
 await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher});
 assert.equal((await handlePuenteTwilioStatus(await callback(),f.env,testing.validTwilioSignature)).status,409);
 const fetcher=()=>{assert.fail('wrong destination cannot leave Velai');};assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher}),{attempted:false});
 params.set('MessageSid',`SM${'2'.repeat(32)}`);params.set('To',`whatsapp:${f.body.destination}`);assert.equal((await handlePuenteTwilioStatus(await callback(),f.env,testing.validTwilioSignature)).status,200);
 assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher}),{attempted:false});
});
test('unknown authenticated status capacity is bounded at1000 and known replay remains acknowledged',async t=>{
 const f=await eventsFixture(t);const params=new URLSearchParams({AccountSid:ACCOUNT,From:FROM,To:`whatsapp:${f.body.destination}`,MessageSid:SID,MessageStatus:'delivered'});
 const callback=()=>signedRequest('https://api.hirevai.com/integrations/puente/whatsapp/status',params);
 assert.equal((await handlePuenteTwilioStatus(await callback(),f.env,testing.validTwilioSignature)).status,200);
 await f.DB.exec(`WITH RECURSIVE counter(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM counter WHERE n<999)
 INSERT INTO puente_whatsapp_events(event_id,message_id,event_type,destination_hash,payload_enc,created_at)
 SELECT 'cap-'||n,'SM'||printf('%032x',n),'status','hash','unreadable-test',${Date.now()} FROM counter;`);
 assert.equal((await handlePuenteTwilioStatus(await callback(),f.env,testing.validTwilioSignature)).status,200);
 params.set('MessageSid',`SM${'3'.repeat(32)}`);assert.equal((await handlePuenteTwilioStatus(await callback(),f.env,testing.validTwilioSignature)).status,503);
 assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM puente_whatsapp_events WHERE event_type='status' AND state='pending'").first()).n,1000);
 await handlePuenteInboundOptout(f.env,f.tenant,f.inbound());assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM puente_whatsapp_suppressions').first()).n,1);
});
test('bounded cleanup removes old unmatched statuses and preserves pending BAJA',async t=>{
 const f=await eventsFixture(t);const params=new URLSearchParams({AccountSid:ACCOUNT,From:FROM,To:`whatsapp:${f.body.destination}`,MessageSid:SID,MessageStatus:'failed'});
 await handlePuenteTwilioStatus(await signedRequest('https://api.hirevai.com/integrations/puente/whatsapp/status',params),f.env,testing.validTwilioSignature);
 await handlePuenteInboundOptout(f.env,f.tenant,f.inbound());await f.DB.prepare('UPDATE puente_whatsapp_events SET created_at=?').bind(Date.now()-8*86400000).run();
 await testing.scheduled(f.env,'*/2 * * * *');
 const rows=(await f.DB.prepare('SELECT event_type,state FROM puente_whatsapp_events').all()).results;assert.deepEqual(rows,[{event_type:'optout',state:'pending'}]);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM puente_whatsapp_suppressions').first()).n,1);
});
test('bearer rotation preserves pseudonyms, pending optout and status correlation',async t=>{
 const f=await eventsFixture(t);await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher});const before=await bridgeDestinationHash(f.env,f.body.destination);
 f.env.PUENTE_BRIDGE_SECRET='rotated'.repeat(8);assert.equal(await bridgeDestinationHash(f.env,f.body.destination),before);
 const params=new URLSearchParams({AccountSid:ACCOUNT,From:FROM,To:`whatsapp:${f.body.destination}`,MessageSid:SID,MessageStatus:'read'});
 assert.equal((await handlePuenteTwilioStatus(await signedRequest('https://api.hirevai.com/integrations/puente/whatsapp/status',params),f.env,testing.validTwilioSignature)).status,200);
 await handlePuenteInboundOptout(f.env,f.tenant,f.inbound());assert.equal((await handlePuenteWhatsApp(f.request(f.body,'b'.repeat(43)),f.env,{fetcher:f.fetcher})).status,409);assert.equal(f.calls(),1);
});
test('pseudonym key fingerprint mismatch fails closed before outbound send and inbound ACK',async t=>{
 const f=await eventsFixture(t);await handlePuenteInboundOptout(f.env,f.tenant,f.inbound());f.env.PUENTE_BRIDGE_DESTINATION_HASH_SECRET='j'.repeat(43);
 assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher})).status,503);assert.equal(f.calls(),0);
 await assert.rejects(handlePuenteInboundOptout(f.env,f.tenant,f.inbound('BAJA PUENTE',`SM${'7'.repeat(32)}`)));
 const params=new URLSearchParams({AccountSid:ACCOUNT,From:FROM,To:`whatsapp:${f.body.destination}`,MessageSid:SID,MessageStatus:'read'});
 assert.equal((await handlePuenteTwilioStatus(await signedRequest('https://api.hirevai.com/integrations/puente/whatsapp/status',params),f.env,testing.validTwilioSignature)).status,503);
 assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher:()=>assert.fail('no event may be forwarded')}),{attempted:true,accepted:false});
});
test('missing stable pseudonym key closes transport and event tick without DB work',async t=>{
 const f=await eventsFixture(t);delete f.env.PUENTE_BRIDGE_DESTINATION_HASH_SECRET;f.env.DB={prepare(){assert.fail('missing key must close before querying');}};
 assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher})).status,503);
 assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env),{attempted:false});await testing.scheduled(f.env,'*/2 * * * *');assert.equal(f.calls(),0);
});
test('absent or invalid server account closes send and events before any DB work',async t=>{
 const f=await eventsFixture(t);f.env.DB={prepare(){assert.fail('invalid account must close before D1');}};
 for(const value of [undefined,'invalid','AC'+'z'.repeat(32)]){
  f.env.PUENTE_BRIDGE_TWILIO_ACCOUNT_SID=value;
  assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher})).status,503);
  assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env),{attempted:false});await testing.scheduled(f.env,'*/2 * * * *');
 }assert.equal(f.calls(),0);
});
test('server account must match exact active Alma tenant and cannot be chosen in JSON',async t=>{
 const f=await eventsFixture(t);f.env.PUENTE_BRIDGE_TWILIO_ACCOUNT_SID='AC'+'b'.repeat(32);
 assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher})).status,503);
 assert.equal((await handlePuenteWhatsApp(f.request({...f.body,accountSid:ACCOUNT}),f.env,{fetcher:f.fetcher})).status,400);assert.equal(f.calls(),0);
 assert.equal(await handlePuenteInboundOptout(f.env,f.tenant,f.inbound()),null);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM puente_whatsapp_events').first()).n,0);
});
test('configured account rotation is pinned with pseudonym fingerprint and cannot bypass pending BAJA',async t=>{
 const f=await eventsFixture(t);await handlePuenteInboundOptout(f.env,f.tenant,f.inbound());
 f.env.PUENTE_BRIDGE_TWILIO_ACCOUNT_SID='AC'+'b'.repeat(32);await f.DB.prepare("UPDATE tenants SET twilio_subaccount_sid=? WHERE slug='dialogos'").bind(f.env.PUENTE_BRIDGE_TWILIO_ACCOUNT_SID).run();
 assert.equal((await handlePuenteWhatsApp(f.request(),f.env,{fetcher:f.fetcher})).status,503);assert.equal(f.calls(),0);
 assert.deepEqual(await dispatchPuenteWhatsAppEvent(f.env,{fetcher:()=>assert.fail('mismatched account must not forward')}),{attempted:true,accepted:false});
});
