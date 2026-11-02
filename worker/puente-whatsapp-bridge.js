// Narrow PUENTE -> Alma bridge. No inbound routing or credential export.
import { decryptSecret } from './crypto.js';
// Account identity is server configuration, never chosen by a caller.
export function bridgeAccountSid(env) {
  const value=env.PUENTE_BRIDGE_TWILIO_ACCOUNT_SID;
  return typeof value==='string'&&/^AC[0-9a-fA-F]{32}$/.test(value)?value:null;
}
export const ALMA_FROM = 'whatsapp:+34641586513';
const response = (status, error, extra = {}) => new Response(JSON.stringify(error ? { error } : extra), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const enabled = value => value === 'true';
async function digest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function equal(a, b) { return (await digest(a)) === (await digest(b)); }
export async function boundedBridgeText(stream, maximum, signal) {
  const reader = stream?.getReader(); if (!reader) return '';
  let total = 0; const chunks = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error('deadline');
      const next = await reader.read(); if (signal.aborted) throw new Error('deadline');
      if (next.done) break; total += next.value.byteLength;
      if (total > maximum) throw new Error('size'); chunks.push(next.value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); }
}

async function dispatch(request, env, { fetcher, controller }) {
  const account=bridgeAccountSid(env);
  // READY must remain absent until signed delivery/BAJA forwarding and both
  // approved templates have been independently tested end to end.
  if (!account || !enabled(env.PUENTE_BRIDGE_ENABLED) || !enabled(env.PUENTE_BRIDGE_READY) || !env.DB || !/^[A-Za-z0-9_-]{43,256}$/.test(env.PUENTE_BRIDGE_DESTINATION_HASH_SECRET || '') || env.PUENTE_BRIDGE_EVENTS_ENABLED !== 'true' || env.PUENTE_BRIDGE_EVENTS_VERIFIED !== 'true' || !/^[A-Za-z0-9_-]{43,256}$/.test(env.PUENTE_BRIDGE_EVENTS_SECRET || '') || typeof env.PUENTE_BRIDGE_SECRET !== 'string' || env.PUENTE_BRIDGE_SECRET.length < 32) return response(503, 'bridge_unavailable');
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || url.hostname !== 'api.hirevai.com' || url.search || request.headers.has('origin')) return response(403, 'bridge_forbidden');
  const auth = request.headers.get('authorization') || '';
  if (auth.length > 520 || !auth.startsWith('Bearer ') || !await equal(auth.slice(7), env.PUENTE_BRIDGE_SECRET)) return response(401, 'bridge_unauthorized');
  if (request.method !== 'POST') return response(405, 'method_not_allowed');
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) return response(415, 'content_type');
  const key = request.headers.get('idempotency-key') || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return response(400, 'idempotency_key');
  try {
    let body;
    try { body = JSON.parse(await boundedBridgeText(request.body, 512, controller.signal)); } catch { return response(400, 'invalid_body'); }
    if (!body || Array.isArray(body) || typeof body !== 'object') return response(400, 'invalid_body');
    const verification = body.type === 'verification';
    const fields = verification ? ['type', 'destination', 'verificationCode'] : ['type', 'destination'];
    if ((!verification && body.type !== 'opportunity') || Object.keys(body).length !== fields.length || Object.keys(body).some(k => !fields.includes(k)) || !/^\+[1-9]\d{7,14}$/.test(body.destination || '') || typeof body.destination !== 'string' || (verification && (typeof body.verificationCode !== 'string' || !/^[A-Za-z0-9]{14}$/.test(body.verificationCode)))) return response(400, 'invalid_body');
    const prefix = verification ? 'PUENTE_BRIDGE_VERIFICATION' : 'PUENTE_BRIDGE_OPPORTUNITY';
    const template = env[`${prefix}_CONTENT_SID`];
    if (!enabled(env[`${prefix}_VERIFIED`]) || !/^HX[0-9a-f]{32}$/i.test(template || '')) return response(503, 'template_unavailable');
    const tenant = await env.DB.prepare('SELECT id, slug, active, twilio_subaccount_sid, twilio_from, twilio_auth_token_enc FROM tenants WHERE slug=? AND active=1').bind('dialogos').first();
    if (!tenant || tenant.slug !== 'dialogos' || tenant.twilio_subaccount_sid !== account || tenant.twilio_from !== ALMA_FROM || !tenant.twilio_auth_token_enc) return response(503, 'alma_unavailable');
    const destinationHash = await bridgeDestinationHash(env,body.destination);
    if (await env.DB.prepare('SELECT event_id FROM puente_whatsapp_suppressions WHERE destination_hash=?').bind(destinationHash).first()) return response(409,'destination_suppressed');
    const requestHash = await digest(JSON.stringify([body.type, body.destination, body.verificationCode || '', template]));
    const now = Date.now();
    // One atomic reservation is both a concurrency-safe budget and the no-retry
    // boundary. Nothing deletes uncertain/reserved keys or sends them again.
    const reservation = await env.DB.prepare(`INSERT OR IGNORE INTO puente_whatsapp_dispatch (idempotency_key, request_hash, destination_hash, created_at, state)
      SELECT ?,?,?,?,'reserved' WHERE
      (SELECT COUNT(*) FROM puente_whatsapp_dispatch WHERE created_at>?)<10 AND
      (SELECT COUNT(*) FROM puente_whatsapp_dispatch WHERE created_at>?)<100 AND
      (SELECT COUNT(*) FROM puente_whatsapp_dispatch WHERE destination_hash=? AND created_at>?)<3`).bind(key, requestHash, destinationHash, now, now-60000, now-3600000, destinationHash, now-3600000).run();
    if (reservation.meta?.changes !== 1) {
      const previous = await env.DB.prepare('SELECT request_hash,state,message_id FROM puente_whatsapp_dispatch WHERE idempotency_key=?').bind(key).first();
      if (!previous) return response(429, 'bridge_rate_limited');
      if (previous.request_hash !== requestHash) return response(409, 'idempotency_conflict');
      if (previous.state === 'accepted' && /^SM[0-9a-f]{32}$/i.test(previous.message_id || '')) return response(200, null, { accepted: true, messageId: previous.message_id });
      return response(409, 'dispatch_not_repeatable');
    }
    if (controller.signal.aborted || await env.DB.prepare('SELECT event_id FROM puente_whatsapp_suppressions WHERE destination_hash=?').bind(destinationHash).first()) return response(409,'destination_suppressed');
    let token;
    try { token = (await decryptSecret(env, tenant.id, tenant.twilio_auth_token_enc))?.value; } catch { return response(503, 'alma_unavailable'); }
    if (!/^[a-f0-9]{32}$/i.test(token || '') || controller.signal.aborted) return response(503, 'alma_unavailable');
    const form = new URLSearchParams({ From: ALMA_FROM, To: `whatsapp:${body.destination}`, ContentSid: template, StatusCallback: 'https://api.hirevai.com/integrations/puente/whatsapp/status' });
    if (verification) form.set('ContentVariables', JSON.stringify({ '1': body.verificationCode }));
    let accepted;
    try {
      const result = await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`, { method: 'POST', redirect: 'manual', signal: controller.signal, headers: { Authorization: `Basic ${btoa(`${account}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      // No retry, redirect, provider text or destination returned to the caller.
      if (controller.signal.aborted || result.status !== 201) { void result.body?.cancel().catch(() => {}); return response(502, 'dispatch_uncertain'); }
      accepted = JSON.parse(await boundedBridgeText(result.body, 4096, controller.signal));
      if (controller.signal.aborted || !/^SM[0-9a-f]{32}$/i.test(accepted.sid || '') || accepted.account_sid !== account || accepted.from !== ALMA_FROM || accepted.to !== `whatsapp:${body.destination}`) return response(502, 'dispatch_uncertain');
      await env.DB.prepare("UPDATE puente_whatsapp_dispatch SET state='accepted',message_id=? WHERE idempotency_key=? AND state='reserved'").bind(accepted.sid, key).run();
    } catch { return response(502, 'dispatch_uncertain'); }
    return response(200, null, { accepted: true, messageId: accepted.sid });
  } catch { return response(503, 'bridge_unavailable'); }
}

// The outer race also fences fetch/read implementations that ignore AbortSignal.
export async function handlePuenteWhatsApp(request, env, {fetcher=fetch, timeoutMs=8000}={}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>8000) return response(503,'bridge_unavailable');
  const controller=new AbortController(); let timer;
  try {
    return await Promise.race([dispatch(request,env,{fetcher,controller}),new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(response(502,'dispatch_uncertain'));},timeoutMs);})]);
  } finally { clearTimeout(timer); controller.abort(); }
}

export async function bridgeDestinationHash(env,destination) {
  await verifyBridgeDestinationKey(env);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.PUENTE_BRIDGE_DESTINATION_HASH_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`puente-alma-destination-v1\0${destination}`)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}

export async function verifyBridgeDestinationKey(env) {
  const secret=env.PUENTE_BRIDGE_DESTINATION_HASH_SECRET;
  if(!/^[A-Za-z0-9_-]{43,256}$/.test(secret||''))throw new Error('puente_pseudonym_unavailable');
  const account=bridgeAccountSid(env);
  if(!account)throw new Error('puente_account_unavailable');
  const fingerprint=await digest(`puente-alma-destination-key-v1\0${secret}\0${account}`);
  await env.DB.prepare("INSERT OR IGNORE INTO puente_whatsapp_settings(setting_key,fingerprint) VALUES('destination_hash_fingerprint',?)").bind(fingerprint).run();
  const pinned=await env.DB.prepare("SELECT fingerprint FROM puente_whatsapp_settings WHERE setting_key='destination_hash_fingerprint'").first();
  if(!pinned||pinned.fingerprint!==fingerprint)throw new Error('puente_pseudonym_changed');
}
