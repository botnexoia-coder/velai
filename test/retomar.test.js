// Plantilla «Retomar conversación» (retomar_conversacion): el catálogo, su alta y edición
// de texto sin módulo extra, y el envío desde el hilo con la ventana de 24 h de Meta
// cerrada (POST /conversations/:id/reengage) contra D1 real y Twilio simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteD1 } from './helpers/sqlite-d1.js';
import { testing, createWorker, reengageTemplateVariables } from '../worker/app.js';
import { encryptSecret } from '../worker/crypto.js';
import { TEMPLATE_CATALOG, validarTexto, cuerpoNumerado, catalogKinds } from '../worker/plantillas.js';

const RET = TEMPLATE_CATALOG.retomar_conversacion;
const TID = '00000000-0000-4000-8000-000000000e01';
const OTRO = '00000000-0000-4000-8000-000000000e02';
const KEK = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const INBOX = 'whatsapp:+15550000001';
const CLIENTE = { role: 'cliente', tenantId: TID, email: 'ana@dialogos.test', modulos: [] };
const VELAI = { role: 'velai', tenantId: null, email: 'admin@velai' };
const ADMIN_EMAIL = 'estiven@velai.test';
const HX = 'HX' + 'f'.repeat(32);
const hace = (h) => new Date(Date.now() - h * 3600000).toISOString();
const error = (status, code) => (e) => e.status === status && e.code === code;

function mapKV(kv = new Map()) {
  return {
    map: kv,
    async get(k, t) { const v = kv.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { kv.set(k, v); },
    async delete(k) { kv.delete(k); },
    async list() { return { keys: [] }; },
  };
}

async function twilioRequest(url, params, authToken) {
  const data = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature },
    body: new URLSearchParams(params).toString(),
  });
}

// ── Catálogo ──────────────────────────────────────────────────────────────────
test('catálogo: retomar_conversacion con texto editable, quick-reply ret:si/ret:no y defecto válido', () => {
  assert.deepEqual(validarTexto(RET, RET.texto.defecto).errores, [], 'el defecto cumple las reglas de Meta');
  assert.ok(!/^\{\{/.test(RET.texto.defecto) && !/\}\}$/.test(RET.texto.defecto), 'ni empieza ni acaba en variable');
  assert.equal(RET.fuente, 'registro');
  assert.equal(RET.categoria, 'UTILITY');
  assert.equal(RET.modulo, undefined, 'sin módulo extra: todo plan con WhatsApp');
  assert.equal(RET.approvalName('Diálogos-1'), 'retomar_conversacion_di_logos_1');
  const c = RET.content('dialogos', 'Diálogos');
  const qr = c.types['twilio/quick-reply'];
  assert.equal(qr.body, cuerpoNumerado(RET.texto.defecto));
  assert.equal(qr.body, 'Hola {{1}}, te escribimos de {{2}} para seguir con tu consulta. ¿Te parece bien que continuemos por aquí?');
  assert.deepEqual(qr.actions, [{ title: 'Sí, sigamos', id: 'ret:si' }, { title: 'Ahora no', id: 'ret:no' }]);
  assert.deepEqual(c.variables, { 1: 'María', 2: 'Diálogos' });
  // La otra pareja curada y un texto propio: el cuerpo se renumera, los payloads no cambian.
  const otra = RET.content('dialogos', 'Diálogos', RET.botones[1], 'Buenas, somos {{negocio}}. ¿Seguimos con lo que hablamos, {{nombre}}? Un saludo.');
  assert.equal(otra.types['twilio/quick-reply'].body, 'Buenas, somos {{1}}. ¿Seguimos con lo que hablamos, {{2}}? Un saludo.');
  assert.deepEqual(otra.types['twilio/quick-reply'].actions, [{ title: 'Continuar', id: 'ret:si' }, { title: 'Más tarde', id: 'ret:no' }]);
  for (const b of RET.botones) assert.ok(b.confirmar.length <= 25 && b.cancelar.length <= 25, 'límite de WhatsApp por botón');
  // La vista Plantillas lo recibe entero del catálogo: sin nada por kind en el panel.
  const k = catalogKinds().find((x) => x.kind === 'retomar_conversacion');
  assert.equal(k.label, 'Retomar conversación');
  assert.match(k.descripcion, /más de 24 h/);
  assert.equal(k.config.botonesDefault, 'si_sigamos_ahora_no');
  assert.deepEqual(k.config.texto.campos.map((f) => [f.clave, f.obligatoria]), [['nombre', false], ['negocio', true]]);
  assert.match(k.config.preview, /^Hola María, te escribimos de Clínica Ejemplo/);
});

test('texto editado: negocio es obligatoria y solo valen nombre y negocio', () => {
  const codes = (t) => validarTexto(RET, t).errores.map((e) => e.code + (e.clave ? ':' + e.clave : ''));
  assert.deepEqual(codes('Hola {{nombre}}, seguimos con tu consulta cuando quieras. ¿Hablamos?'), ['falta_variable:negocio']);
  assert.ok(codes('Hola {{nombre}}, desde {{negocio}} retomamos tu cita del {{fecha}}. ¿Seguimos?').includes('variable_desconocida:fecha'));
  assert.ok(codes('{{nombre}}, te escribimos de {{negocio}} para seguir. ¿Te va bien?').includes('empieza_con_variable'));
  assert.deepEqual(codes('Te escribimos de {{negocio}} para seguir con tu consulta. ¿Continuamos?'), []);
  // Variables del envío: por orden de aparición del texto guardado.
  const vars = JSON.parse(reengageTemplateVariables({ name: 'Neg', brand_name: 'Marca' }, null, 'Te escribimos de {{negocio}}, {{nombre}}. ¿Seguimos por aquí?'));
  assert.deepEqual(vars, { 1: 'Marca', 2: 'de nuevo' }, 'sin nombre: «de nuevo»; negocio = brand_name || name');
});

// ── D1 real ───────────────────────────────────────────────────────────────────
async function fixture(t, { plantilla = 'approved', texto = null, atender = false, plan = 'profesional', twilioStatus = 201 } = {}) {
  const DB = await sqliteD1();
  const env = { DB, KV: mapKV(), SECRETS_KEK: KEK, ADMIN_EMAILS: 'raiz@velai.test', SOCIOS_EMAILS: 'raiz@velai.test',
    TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 'tok', ANTHROPIC_API_KEY: 'k' };
  const now = new Date().toISOString();
  const enc = await encryptSecret(env, TID, 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
  await DB.prepare(`INSERT INTO tenants (id,slug,name,brand_name,channel_address,system_prompt,plan,twilio_subaccount_sid,twilio_auth_token_enc,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(TID, 'dialogos', 'Diálogos SL', 'Diálogos', INBOX, 'test', plan, 'AC' + 's'.repeat(32), enc, now, now).run();
  await DB.prepare('INSERT INTO tenants (id,slug,name,channel_address,system_prompt,plan,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(OTRO, 'otro', 'Otro', 'whatsapp:+15550000009', 'test', 'profesional', now, now).run();
  await DB.prepare('UPDATE tenants SET espacio_velai=1, espacio_atender=? WHERE id=?').bind(atender ? 1 : 0, TID).run();
  await DB.prepare('INSERT INTO admin_users (email,created_by,created_at) VALUES (?,?,?)').bind(ADMIN_EMAIL, 'raiz@velai.test', now).run();
  if (plantilla) {
    await DB.prepare("INSERT INTO tenant_templates (tenant_id,kind,sid,status,texto,created_at,updated_at) VALUES (?,'retomar_conversacion',?,?,?,?,?)")
      .bind(TID, HX, plantilla, texto, now, now).run();
  }
  const twilio = { messages: [], content: [], approvals: [], status: twilioStatus };
  let n = 0;
  const old = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith('/Messages.json')) { twilio.messages.push({ url: u, params: new URLSearchParams(String(init.body)) }); return Response.json({}, { status: twilio.status }); }
    if (u === 'https://content.twilio.com/v1/Content') { twilio.content.push(JSON.parse(String(init.body))); return Response.json({ sid: 'HX' + String(++n).padStart(32, '0') }, { status: 201 }); }
    if (u.endsWith('/ApprovalRequests/whatsapp')) { twilio.approvals.push(JSON.parse(String(init.body))); return Response.json({}, { status: 201 }); }
    if (u.includes('api.telegram.org')) return Response.json({ ok: true });
    if (u.includes('api.anthropic.com')) throw new Error('el modelo no debe llamarse');
    throw new Error('Unexpected network request: ' + u);
  };
  t.after(() => { globalThis.fetch = old; DB.close(); });
  const ctx = { waitUntil() {} };
  const call = async (path, { method = 'GET', body, scope = CLIENTE, workspace = null } = {}) => {
    const url = new URL(`https://admin.test/api/admin/${path}`);
    const headers = {};
    if (workspace) headers['X-Velai-Workspace'] = workspace;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const req = new Request(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return testing.adminRouter(req, env, ctx, url.pathname, url, {}, scope);
  };
  const api = async (...args) => (await call(...args)).json();
  const reengage = (id, opts = {}) => api(`conversations/${id}/reengage`, { method: 'POST', body: {}, ...opts });
  const admin = () => testing.resolveScope(env, ADMIN_EMAIL);
  return { DB, env, twilio, call, api, reengage, admin };
}

async function conv(DB, { tenant = TID, channel = 'whatsapp', state = 'bot', agent = null, lastInH = 30, leadName = 'Marta' } = {}) {
  const id = crypto.randomUUID();
  let leadId = null;
  if (leadName) {
    leadId = crypto.randomUUID();
    await DB.prepare('INSERT INTO leads (id,request_id,source,name,status,tenant_id,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(leadId, leadId, 'whatsapp', leadName, 'new', tenant, hace(40), hace(40), '2099-01-01').run();
  }
  const ext = channel === 'web' ? id : 'whatsapp:+34600000077';
  await DB.prepare(`INSERT INTO conversations (id,tenant_id,lead_id,channel,external_id,inbox_address,msgs,started_at,last_at,expires_at,state,state_at,agent_email)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, tenant, leadId, channel, ext, channel === 'web' ? null : INBOX, 2, hace(lastInH + 1), hace(lastInH), '2099-01-01', state, hace(lastInH), agent).run();
  await DB.prepare('INSERT INTO conv_messages (conversation_id,role,text,created_at) VALUES (?,?,?,?)').bind(id, 'assistant', 'Hola, ¿en qué te ayudo?', hace(lastInH + 1)).run();
  await DB.prepare('INSERT INTO conv_messages (conversation_id,role,text,created_at) VALUES (?,?,?,?)').bind(id, 'user', 'Quería información', hace(lastInH)).run();
  return id;
}
const estado = (DB, id) => DB.prepare('SELECT state, agent_email FROM conversations WHERE id=?').bind(id).first();
const agentes = async (DB, id) => (await DB.prepare("SELECT agent_email, text FROM conv_messages WHERE conversation_id=? AND role='agent'").bind(id).all()).results;

test('alta: el POST genérico la crea en Twilio y la somete a Meta como las demás', async (t) => {
  const { DB, twilio, call } = await fixture(t, { plantilla: null });
  const res = await call(`tenants/${TID}/provision/plantillas/retomar_conversacion`, { method: 'POST', body: { botones: 'continuar_mas_tarde' }, scope: VELAI });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true, kind: 'retomar_conversacion', sid: 'HX' + '1'.padStart(32, '0'), status: 'pending', botones: 'continuar_mas_tarde' });
  const qr = twilio.content[0].types['twilio/quick-reply'];
  assert.deepEqual(qr.actions, [{ title: 'Continuar', id: 'ret:si' }, { title: 'Más tarde', id: 'ret:no' }]);
  assert.deepEqual([twilio.approvals[0].name, twilio.approvals[0].category], ['retomar_conversacion_dialogos', 'UTILITY']);
  const row = await DB.prepare("SELECT status, opciones FROM tenant_templates WHERE tenant_id=? AND kind='retomar_conversacion'").bind(TID).first();
  assert.equal(row.status, 'pending');
  assert.equal(JSON.parse(row.opciones).botones, 'continuar_mas_tarde');
});

test('texto: el cliente la edita y la crea desde Plantillas SIN el módulo Calendario', async (t) => {
  const { DB, twilio, call, api } = await fixture(t, { plantilla: null, plan: 'esencial' });
  const path = `tenants/${TID}/plantillas/retomar_conversacion`;
  const v = await api(path, { method: 'POST', body: { texto: 'Hola {{nombre}}, ¿seguimos con tu consulta? Escríbenos cuando quieras.', validar: true } });
  assert.deepEqual([v.ok, v.errores.map((e) => e.clave)], [false, ['negocio']]);
  await assert.rejects(call(path, { method: 'POST', body: { texto: 'Hola {{nombre}}, ¿seguimos con tu consulta? Escríbenos cuando quieras.' } }), (e) => e.status === 400 && e.code === 'falta_variable' && e.why === 'negocio');
  const texto = 'Hola {{nombre}}, somos {{negocio}}. ¿Seguimos con tu consulta por aquí?';
  const res = await call(path, { method: 'POST', body: { texto } });
  assert.equal(res.status, 201);
  assert.equal(twilio.content[0].types['twilio/quick-reply'].body, 'Hola {{1}}, somos {{2}}. ¿Seguimos con tu consulta por aquí?');
  assert.match(twilio.approvals[0].name, /^retomar_conversacion_dialogos_r\d{12}$/);
  assert.deepEqual({ ...(await DB.prepare("SELECT status, texto FROM tenant_templates WHERE tenant_id=? AND kind='retomar_conversacion'").bind(TID).first()) }, { status: 'pending', texto });
  // Las de citas siguen exigiendo Calendario: la puerta la decide el kind.
  await assert.rejects(call(`tenants/${TID}/plantillas/confirmacion_reserva`, { method: 'POST', body: { texto: 'Hola {{nombre}}, tu cita es el {{fecha}} a las {{hora}}: {{enlace}} Gracias.' } }), error(403, 'modulo_no_contratado'));
});

test('reengage: desde «bot» toma el control y envía la plantilla con sus variables; el mensaje queda en el hilo', async (t) => {
  const texto = 'Hola {{nombre}}, desde {{negocio}} queremos seguir con tu consulta. ¿Continuamos por aquí?';
  const { DB, env, twilio, reengage, api } = await fixture(t, { texto });
  const id = await conv(DB);
  const out = await reengage(id);
  assert.deepEqual([out.ok, out.state, out.agent_email], [true, 'humano', 'ana@dialogos.test']);
  assert.equal(twilio.messages.length, 1);
  const p = twilio.messages[0].params;
  assert.ok(twilio.messages[0].url.includes(`/Accounts/AC${'s'.repeat(32)}/`), 'con las credenciales de la SUBCUENTA');
  assert.deepEqual([p.get('From'), p.get('To'), p.get('ContentSid'), p.get('Body')], [INBOX, 'whatsapp:+34600000077', HX, null]);
  assert.deepEqual(JSON.parse(p.get('ContentVariables')), { 1: 'Marta', 2: 'Diálogos' }, 'variables del texto GUARDADO, por orden de aparición');
  assert.deepEqual({ ...(await estado(DB, id)) }, { state: 'humano', agent_email: 'ana@dialogos.test' });
  assert.deepEqual((await agentes(DB, id)).map((m) => ({ ...m })), [{ agent_email: 'ana@dialogos.test', text: 'Hola Marta, desde Diálogos queremos seguir con tu consulta. ¿Continuamos por aquí?' }]);
  assert.ok(env.KV.map.has('pause:' + TID + ':whatsapp:+34600000077'), 'el bot se calla como tras un reply');
  // Un segundo envío en 24 h: 429. Sin la marca de KV (otra instancia), lo para D1.
  await assert.rejects(reengage(id), error(429, 'reengage_reciente'));
  env.KV = mapKV();
  await assert.rejects(reengage(id), error(429, 'reengage_reciente'));
  assert.equal(twilio.messages.length, 1, 'Meta cobra cada envío: no se repite');
  const win = (await api(`inbox?conversation=${id}`)).thread.window;
  assert.equal(win.open, false);
  assert.equal(win.reason, 'window_closed');
  assert.deepEqual([win.reengage.available, win.reengage.reason], [false, 'reengage_reciente']);
  assert.ok(win.reengage.lastSentAt && Date.now() - Date.parse(win.reengage.lastSentAt) < 60000);
});

test('reengage: sin nombre de lead, «de nuevo»', async (t) => {
  const { DB, twilio, reengage } = await fixture(t);
  const id = await conv(DB, { leadName: null });
  await reengage(id);
  assert.deepEqual(JSON.parse(twilio.messages[0].params.get('ContentVariables')), { 1: 'de nuevo', 2: 'Diálogos' });
  assert.equal((await agentes(DB, id))[0].text, 'Hola de nuevo, te escribimos de Diálogos para seguir con tu consulta. ¿Te parece bien que continuemos por aquí?');
});

test('reengage: puertas ANTES de Twilio — ventana abierta, sin plantilla, tomada por otra persona, canal web, ajena', async (t) => {
  const { DB, twilio, reengage } = await fixture(t);
  await assert.rejects(reengage(await conv(DB, { lastInH: 2 })), error(409, 'ventana_abierta'));
  const otra = await conv(DB, { state: 'humano', agent: 'luis@dialogos.test' });
  await assert.rejects(reengage(otra), error(409, 'ya_tomada'));
  assert.deepEqual({ ...(await estado(DB, otra)) }, { state: 'humano', agent_email: 'luis@dialogos.test' });
  await assert.rejects(reengage(await conv(DB, { channel: 'web' })), error(400, 'reengage_canal_no_soportado'));
  // De otro tenant: 404, nunca 403.
  await assert.rejects(reengage(await conv(DB, { tenant: OTRO })), error(404, 'not_found'));
  // Sin la plantilla aprobada (pendiente o ausente).
  await DB.prepare("UPDATE tenant_templates SET status='pending' WHERE tenant_id=?").bind(TID).run();
  const sin = await conv(DB);
  await assert.rejects(reengage(sin), error(409, 'plantilla_retomar_no_aprobada'));
  await DB.prepare('DELETE FROM tenant_templates WHERE tenant_id=?').bind(TID).run();
  await assert.rejects(reengage(sin), error(409, 'plantilla_retomar_no_aprobada'));
  assert.equal((await estado(DB, sin)).state, 'bot', 'un rechazo no toma el control');
  assert.equal(twilio.messages.length, 0, 'ninguna puerta gasta una llamada a Twilio');
});

test('reengage: Twilio falla → 502 traducido, sin mensaje guardado y la conversación vuelve a la IA', async (t) => {
  const { DB, reengage } = await fixture(t, { twilioStatus: 400 });
  const id = await conv(DB);
  await assert.rejects(reengage(id), (e) => e.status === 502 && e.code === 'reengage_envio_fallido' && e.why === 'twilio_400');
  assert.deepEqual(await agentes(DB, id), []);
  assert.deepEqual({ ...(await estado(DB, id)) }, { state: 'bot', agent_email: null });
});

test('reengage en el Espacio de Velai sin atención: espacio_sin_atencion, y fuera del espacio velai_no_atiende_clientes', async (t) => {
  const { DB, twilio, reengage, admin } = await fixture(t);
  const id = await conv(DB);
  await assert.rejects(reengage(id, { scope: await admin(), workspace: 'dialogos' }), error(403, 'espacio_sin_atencion'));
  await assert.rejects(reengage(id, { scope: await admin() }), error(403, 'velai_no_atiende_clientes'));
  assert.equal(twilio.messages.length, 0);
});

test('reengage en el Espacio de Velai con atención: envía y firma con el correo real del admin', async (t) => {
  const { DB, twilio, reengage, admin } = await fixture(t, { atender: true });
  const id = await conv(DB);
  const out = await reengage(id, { scope: await admin(), workspace: 'dialogos' });
  assert.equal(out.agent_email, ADMIN_EMAIL);
  assert.equal(twilio.messages.length, 1);
  assert.equal((await agentes(DB, id))[0].agent_email, ADMIN_EMAIL);
});

test('inbox: thread.window.reengage en sus tres estados, y nada con la ventana abierta', async (t) => {
  const { DB, api, reengage } = await fixture(t, { plantilla: 'pending' });
  const id = await conv(DB);
  const win = async (cid = id) => (await api(`inbox?conversation=${cid}`)).thread.window;
  // La IA atiende: el motivo del cajón sigue siendo el suyo, pero la ventana REAL está cerrada.
  let w = await win();
  assert.equal(w.takeoverReason, 'window_closed');
  assert.deepEqual(w.reengage, { available: false, reason: 'plantilla_retomar_no_aprobada', lastSentAt: null });
  await DB.prepare("UPDATE tenant_templates SET status='approved' WHERE tenant_id=?").bind(TID).run();
  assert.deepEqual((await win()).reengage, { available: true, reason: null, lastSentAt: null });
  await reengage(id);
  w = await win();
  assert.deepEqual([w.reengage.available, w.reengage.reason, typeof w.reengage.lastSentAt], [false, 'reengage_reciente', 'string']);
  assert.equal((await win(await conv(DB, { lastInH: 2 }))).reengage, undefined, 'ventana abierta: no hay nada que retomar');
  assert.equal((await win(await conv(DB, { channel: 'web' }))).reengage, undefined, 'web: no aplica');
  // Quien no puede atender no recibe el bloque (Velai fuera de su tenant).
  const velai = (await api(`inbox?conversation=${id}`, { scope: VELAI })).thread.window;
  assert.equal(velai.reengage, undefined);
});

test('webhook: la respuesta ret:si NO la captura el parser de citas, se guarda como texto del cliente y abre la ventana', async (t) => {
  const { DB, env, reengage, api } = await fixture(t);
  const id = await conv(DB);
  await reengage(id);
  const worker = createWorker({ SYSTEM: 's', DEMOS: {}, SUMMARY_PROMPT: '', GUARDRAILS: '' });
  const waits = [];
  const ctx = { waitUntil(p) { waits.push(Promise.resolve(p).catch(() => {})); } };
  for (const [payload, body] of [['ret:si', 'Sí, sigamos'], ['ret:no', 'Ahora no']]) {
    const params = { AccountSid: env.TWILIO_ACCOUNT_SID, From: 'whatsapp:+34600000077', To: INBOX, Body: body, ButtonText: body,
      ButtonPayload: payload, MessageSid: 'SM' + crypto.randomUUID().replace(/-/g, '') };
    const res = await worker.fetch(await twilioRequest('https://worker.test/', params, 'tok'), env, ctx);
    assert.equal(res.status, 200);
    assert.ok(!(await res.text()).includes('<Message>'), 'sin respuesta automática: la persona del equipo decide');
  }
  await Promise.all(waits);
  const ultimos = (await DB.prepare('SELECT role, text FROM conv_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 2').bind(id).all()).results.map((m) => ({ ...m }));
  assert.deepEqual(ultimos, [{ role: 'user', text: 'Ahora no' }, { role: 'user', text: 'Sí, sigamos' }]);
  assert.equal((await estado(DB, id)).state, 'humano', 'sigue en manos de quien la retomó');
  const w = (await api(`inbox?conversation=${id}`)).thread.window;
  assert.equal(w.open, true, 'la respuesta del cliente reabre las 24 h');
  assert.equal(w.reengage, undefined);
});
