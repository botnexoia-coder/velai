// Fixed Alma -> PUENTE event bridge. Twilio authenticity is checked before enqueue.
import { encryptSecret, decryptSecret } from './crypto.js';
import { bridgeAccountSid, ALMA_FROM, bridgeDestinationHash, verifyBridgeDestinationKey, boundedBridgeText } from './puente-whatsapp-bridge.js';
const ENDPOINT='https://puenteconalma.com/api/webhooks/alma-whatsapp';
const STATUS_PATH='/integrations/puente/whatsapp/status';
const phone=v=>typeof v==='string'&&/^\+[1-9]\d{7,14}$/.test(v);
const sid=v=>typeof v==='string'&&/^SM[0-9a-f]{32}$/i.test(v);
const statuses=new Set(['delivered','read','failed','undelivered']);
const json=(status,error)=>Response.json(error?{error}:{accepted:true},{status,headers:{'Cache-Control':'no-store'}});
export const bridgeEventsReady=env=>!!bridgeAccountSid(env)&&/^[A-Za-z0-9_-]{43,256}$/.test(env.PUENTE_BRIDGE_DESTINATION_HASH_SECRET||'')&&env.PUENTE_BRIDGE_EVENTS_ENABLED==='true'&&env.PUENTE_BRIDGE_EVENTS_VERIFIED==='true'&&/^[A-Za-z0-9_-]{43,256}$/.test(env.PUENTE_BRIDGE_EVENTS_SECRET||'')&&typeof env.PUENTE_BRIDGE_SECRET==='string'&&env.PUENTE_BRIDGE_SECRET.length>=32&&!!env.DB;
async function eventId(event) {
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['alma-puente-v1',event.type,event.messageId,event.status||'']))));
 return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function persistEvent(env,event) {
 const id=await eventId(event),encrypted=await encryptSecret(env,`puente-event:${id}`,JSON.stringify(event));
 const hash=await bridgeDestinationHash(env,event.destination);
 const insert=env.DB.prepare(`INSERT OR IGNORE INTO puente_whatsapp_events(event_id,message_id,event_type,destination_hash,payload_enc,created_at)
  SELECT ?,?,?,?,?,? WHERE ?='optout' OR (SELECT COUNT(*) FROM puente_whatsapp_events WHERE event_type='status' AND state='pending')<1000`).bind(id,event.messageId,event.type,hash,encrypted,event.occurredAt,event.type);
 if(event.type==='optout') {
  // D1 batch is transactional: suppression and durable forwarding either both exist
  // or fail before acknowledging the inbound command to Twilio.
  await env.DB.batch([insert,env.DB.prepare("INSERT OR IGNORE INTO puente_whatsapp_suppressions(destination_hash,event_id,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM puente_whatsapp_events WHERE event_id=? AND state='pending')").bind(hash,id,event.occurredAt,id)]);
 } else {
  const result=await insert.run();
  if(result.meta?.changes!==1&&!await env.DB.prepare('SELECT event_id FROM puente_whatsapp_events WHERE event_id=?').bind(id).first())throw new Error('puente_event_capacity');
 }
 return id;
}
/** Called only AFTER the existing inbound handler has authenticated Twilio.
 * Reserved BAJA PUENTE stops the AI path. Universal BAJA/STOP also suppresses PUENTE
 * but returns null, preserving Alma's existing universal-consent behaviour. */
export async function handlePuenteInboundOptout(env,tenant,params) {
 const account=bridgeAccountSid(env);
 if(!bridgeEventsReady(env)||tenant?.slug!=='dialogos'||tenant.twilio_subaccount_sid!==account||tenant.twilio_from!==ALMA_FROM||params.get('AccountSid')!==account||params.get('To')!==ALMA_FROM)return null;
 const command=(params.get('Body')||'').trim().toUpperCase();
 if(!['BAJA PUENTE','BAJA','STOP','UNSUBSCRIBE'].includes(command))return null;
 const from=params.get('From')||'',messageId=params.get('MessageSid')||params.get('SmsMessageSid');
 if(!from.startsWith('whatsapp:')||!phone(from.slice(9))||!sid(messageId))throw new Error('puente_optout_invalid');
 await persistEvent(env,{type:'optout',sender:ALMA_FROM.slice(9),destination:from.slice(9),messageId,occurredAt:Date.now()});
 if(command!=='BAJA PUENTE')return null;
 // No outbound Message element: acknowledge transport without claiming that the
 // remote account was already modified or charging an extra reply.
 return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>',{headers:{'Content-Type':'text/xml; charset=utf-8','Cache-Control':'no-store'}});
}
async function deadline(work,timeoutMs=8000) {
 const controller=new AbortController();let timer;
 try{return await Promise.race([work(controller.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('deadline'));},timeoutMs);})]);}
 finally{clearTimeout(timer);controller.abort();}
}
export async function handlePuenteTwilioStatus(request,env,validTwilioSignature) {
 const account=bridgeAccountSid(env);
 if(!bridgeEventsReady(env))return json(503,'bridge_events_unavailable');
 const url=new URL(request.url);
 if(request.method!=='POST'||url.protocol!=='https:'||url.host!=='api.hirevai.com'||url.pathname!==STATUS_PATH||url.search||request.headers.has('origin'))return json(403,'bridge_forbidden');
 if(!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||''))return json(415,'content_type');
 try{return await deadline(async signal=>{
  const raw=await boundedBridgeText(request.body,4096,signal),params=new URLSearchParams(raw),object={};
  for(const[key,value]of params){if(Object.hasOwn(object,key))return json(400,'invalid_status');object[key]=value;}
  if(params.get('AccountSid')!==account||params.get('From')!==ALMA_FROM||!phone((params.get('To')||'').replace(/^whatsapp:/,''))||!params.get('To')?.startsWith('whatsapp:')||!sid(params.get('MessageSid')))return json(400,'invalid_status');
  const tenant=await env.DB.prepare('SELECT id,slug,twilio_subaccount_sid,twilio_from,twilio_auth_token_enc FROM tenants WHERE slug=? AND active=1').bind('dialogos').first();
  if(!tenant||tenant.slug!=='dialogos'||tenant.twilio_subaccount_sid!==account||tenant.twilio_from!==ALMA_FROM)return json(503,'alma_unavailable');
  let token;try{token=(await decryptSecret(env,tenant.id,tenant.twilio_auth_token_enc))?.value;}catch{return json(503,'alma_unavailable');}
  if(!token||!await validTwilioSignature(token,request.url,object,request.headers.get('X-Twilio-Signature')||''))return json(403,'invalid_twilio_signature');
  const status=params.get('MessageStatus')||params.get('SmsStatus');
  if(!statuses.has(status))return json(200); // Sent/queued are not delivery evidence.
  const destination=params.get('To').slice(9),destinationHash=await bridgeDestinationHash(env,destination);
  const dispatch=await env.DB.prepare("SELECT destination_hash,created_at FROM puente_whatsapp_dispatch WHERE state='accepted' AND message_id=?").bind(params.get('MessageSid')).first();
  if(dispatch&&dispatch.destination_hash!==destinationHash)return json(409,'dispatch_not_correlated');
  if(dispatch&&dispatch.created_at<Date.now()-7*86400000)return json(200);
  // A signed callback may beat the Twilio201 receipt. Persist it, but the drain
  // cannot forward until BOTH its SID and destination match an accepted dispatch.
  if(signal.aborted)return json(503,'bridge_events_unavailable');
  await persistEvent(env,{type:'status',sender:ALMA_FROM.slice(9),destination,messageId:params.get('MessageSid'),occurredAt:Date.now(),status});
  return json(200);
 });}catch{return json(503,'bridge_events_unavailable');}
}
/** Bounded drain called exclusively by the separate PUENTE two-minute tick. */
export async function dispatchPuenteWhatsAppEvent(env,{fetcher=fetch,timeoutMs=8000,now=Date.now}={}) {
 if(!bridgeEventsReady(env)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>8000)return {attempted:false};
 try{return await deadline(async signal=>{
  await verifyBridgeDestinationKey(env);
  const at=now();
  // Atomic UPDATE RETURNING claims one row even with overlapping invocations.
  const event=await env.DB.prepare(`UPDATE puente_whatsapp_events SET attempts=attempts+1,next_attempt_at=?
   WHERE event_id=(SELECT event_id FROM puente_whatsapp_events WHERE state='pending' AND attempts<24 AND next_attempt_at<=? AND created_at>=?
    AND (event_type='optout' OR EXISTS(SELECT 1 FROM puente_whatsapp_dispatch d WHERE d.state='accepted' AND d.message_id=puente_whatsapp_events.message_id AND d.destination_hash=puente_whatsapp_events.destination_hash AND d.created_at>=?))
    ORDER BY created_at,event_id LIMIT 1)
   AND state='pending' AND next_attempt_at<=? RETURNING event_id,destination_hash,payload_enc,attempts`).bind(at+60000,at,at-7*86400000,at-7*86400000,at).first();
  if(!event)return {attempted:false};
  const decoded=await decryptSecret(env,`puente-event:${event.event_id}`,event.payload_enc);
  if(!decoded||signal.aborted)return {attempted:true,accepted:false};
  const raw=decoded.value,timestamp=String(Math.floor(now()/1000));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.PUENTE_BRIDGE_EVENTS_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${event.event_id}.${timestamp}.${raw}`)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(signal.aborted)return {attempted:true,accepted:false};
  let accepted=false;
  try{
   const result=await fetcher(ENDPOINT,{method:'POST',redirect:'manual',signal,headers:{'Content-Type':'application/json','X-Puente-Event-Id':event.event_id,'X-Puente-Timestamp':timestamp,'X-Puente-Signature':`v1=${signature}`},body:raw});
   if(result.status>=200&&result.status<300&&!signal.aborted){const reply=JSON.parse(await boundedBridgeText(result.body,512,signal));accepted=!!reply&&Object.keys(reply).sort().join(',')==='accepted,eventId'&&reply.accepted===true&&reply.eventId===event.event_id;}
   else void result.body?.cancel().catch(()=>{});
  }catch{/* Receiver deduplicates event_id; a later attempt is safe. */}
  if(signal.aborted)return {attempted:true,accepted:false};
  if(accepted)await env.DB.batch([env.DB.prepare("UPDATE puente_whatsapp_events SET state='accepted',accepted_at=? WHERE event_id=? AND state='pending'").bind(now(),event.event_id),env.DB.prepare("DELETE FROM puente_whatsapp_suppressions WHERE destination_hash=? AND NOT EXISTS(SELECT 1 FROM puente_whatsapp_events WHERE destination_hash=? AND event_type='optout' AND state='pending')").bind(event.destination_hash,event.destination_hash)]);
  else await env.DB.prepare("UPDATE puente_whatsapp_events SET next_attempt_at=? WHERE event_id=? AND state='pending'").bind(now()+Math.min(3600000,60000*2**Math.min(event.attempts-1,6)),event.event_id).run();
  return {attempted:true,accepted};
 },timeoutMs);}catch{return {attempted:true,accepted:false};}
}

export const PUENTE_EVENTS_CRON='*/2 * * * *';
export async function runPuenteEventsTick(env) {
 if(!bridgeEventsReady(env))return {attempted:false};
 const outcome=await dispatchPuenteWhatsAppEvent(env);
 // Keep replay tombstones but clear encrypted PII of acknowledged events after7d.
 // Pending/uncertain optouts are never deleted or silently unsuppressed.
 try {await env.DB.prepare("DELETE FROM puente_whatsapp_events WHERE event_id IN (SELECT event_id FROM puente_whatsapp_events WHERE event_type='status' AND created_at<? LIMIT 10)").bind(Date.now()-7*86400000).run();}catch{/* Old unmatched status rows can retry cleanup. */}
 try {await env.DB.prepare("UPDATE puente_whatsapp_events SET payload_enc='' WHERE event_id IN (SELECT event_id FROM puente_whatsapp_events WHERE state='accepted' AND created_at<? AND payload_enc!='' LIMIT 10)").bind(Date.now()-7*86400000).run();}catch{/* Retention can retry without affecting event acceptance. */}
 if(outcome.attempted&&!outcome.accepted)console.log(JSON.stringify({level:'warn',code:'puente_event_pending'}));
 return outcome;
}
