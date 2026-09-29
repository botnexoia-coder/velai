// SPEC-NOTIFICACION-CITA: el cliente edita el TEXTO de sus plantillas de citas.
// Reglas (validarTexto), traducción a {{n}} y el ciclo completo contra D1 real:
// guardar → Twilio (mockeado) → revisión → poll → promoción o rechazo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingFixture, BOOKING_TEST_TENANT as TID } from './helpers/booking-fixture.js';
import { testing } from '../worker/app.js';
import { encryptSecret } from '../worker/crypto.js';
import { TEMPLATE_CATALOG, validarTexto, cuerpoNumerado, clavesDe, variablesPara, catalogKinds, renderTexto } from '../worker/plantillas.js';

const CONF = TEMPLATE_CATALOG.confirmacion_reserva;
const REC = TEMPLATE_CATALOG.recordatorio_cita;
const codes = (def, t) => validarTexto(def, t).errores.map((e) => e.code + (e.clave ? ':' + e.clave : ''));

test('texto: los defectos del catálogo son válidos y el del recordatorio conserva el cuerpo ya aprobado', () => {
  assert.deepEqual(codes(CONF, CONF.texto.defecto), []);
  assert.deepEqual(codes(REC, REC.texto.defecto), []);
  // La plantilla de dialogos (texto NULL) se aprobó con ESTE cuerpo y estas variables:
  // si cambiara, sus recordatorios se desalinearían.
  assert.equal(cuerpoNumerado(REC.texto.defecto), 'Hola {{1}}, te escribimos de {{2}} para recordarte tu cita del {{3}} a las {{4}} ({{5}}). ¿Podrás venir?');
  const vars = JSON.parse(testing.reminderTemplateVariables({ name: 'Neg' }, { id: 'cita-1', customer_name: 'Ana', reason: 'Corte', starts_at: '2026-10-01T08:00:00.000Z', timezone: 'Europe/Madrid' }));
  assert.deepEqual(Object.keys(vars), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual([vars[1], vars[2], vars[5], vars[6]], ['Ana', 'Neg', 'Corte', 'cita-1']);
});

test('texto: reglas de Meta y contrato de variables', () => {
  const ok = 'Hola {{nombre}}, tu cita es el {{fecha}} a las {{hora}}. Gestiónala aquí: {{enlace}} Gracias.';
  assert.deepEqual(codes(CONF, ok), []);
  assert.deepEqual(codes(CONF, ''), ['texto_vacio']);
  assert.deepEqual(codes(CONF, 'Hola {{nombre}}, tu cita es el {{fecha}} a las {{hora}}. Nos vemos pronto.'), ['falta_variable:enlace']);
  assert.ok(codes(CONF, ok.replace('{{nombre}}', '{{telefono}}')).includes('variable_desconocida:telefono'));
  assert.ok(codes(CONF, ok.replace('{{nombre}}', '{{1}}')).includes('variable_desconocida:1'), 'los números no se aceptan: solo nombres');
  assert.ok(codes(CONF, ok + ' Repito: {{fecha}}.').includes('variable_repetida:fecha'));
  assert.ok(codes(CONF, '{{nombre}}, tu cita es el {{fecha}} a las {{hora}}. Aquí: {{enlace}} Gracias.').includes('empieza_con_variable'));
  assert.ok(codes(CONF, 'Hola, tu cita es el {{fecha}} a las {{hora}}. Gestiónala aquí: {{enlace}}').includes('termina_con_variable'));
  assert.ok(codes(CONF, 'Hola, tu cita es el {{fecha}} {{hora}}. Gestiónala aquí: {{enlace}} Gracias.').includes('variables_juntas'));
  assert.ok(codes(CONF, ok.replace('Gracias.', 'Gracias }}')).includes('llaves_sueltas'));
  assert.ok(codes(CONF, ok.replace('. Gestiónala', '.\n\n\n\nGestiónala')).includes('saltos_excesivos'));
  assert.ok(codes(CONF, ok.replace('Gracias', 'Gracias\tya')).includes('espacios_excesivos'));
  assert.ok(codes(CONF, 'Ok {{fecha}} y {{hora}}, {{enlace}} ya').includes('pocas_palabras'));
  assert.ok(codes(CONF, ok.replace('Gracias.', 'x'.repeat(1100))).includes('texto_largo'));
  // El recordatorio NO admite el enlace (sus botones ya gestionan la cita) ni el id.
  assert.ok(codes(REC, 'Hola, te recordamos la cita del {{fecha}} a las {{hora}}: {{enlace}} ¿Vienes?').includes('variable_desconocida:enlace'));
  assert.ok(codes(REC, 'Hola, te recordamos la cita del {{fecha}} a las {{hora}} con id {{id}} ¿Vienes?').includes('variable_desconocida:id'));
  // Normaliza saltos de Windows y espacios de cola.
  assert.equal(validarTexto(CONF, ok.replace('. Gestiónala', '.  \r\nGestiónala')).texto, ok.replace('. Gestiónala', '.\nGestiónala'));
});

test('texto: numeración por orden de aparición y botones del recordatorio en la siguiente', () => {
  const t = 'Te esperamos el {{fecha}} a las {{hora}}, {{nombre}}. ¿Confirmas tu cita?';
  assert.deepEqual(clavesDe(t), ['fecha', 'hora', 'nombre']);
  const c = REC.content('mio', 'Mi Negocio', null, t);
  const qr = c.types['twilio/quick-reply'];
  assert.equal(qr.body, 'Te esperamos el {{1}} a las {{2}}, {{3}}. ¿Confirmas tu cita?');
  assert.deepEqual(qr.actions.map((a) => a.id), ['conf:{{4}}', 'canc:{{4}}']);
  assert.deepEqual(Object.keys(c.variables), ['1', '2', '3', '4']);
  const vars = variablesPara(REC, t, { fecha: 'F', hora: 'H', nombre: 'N', negocio: 'X', servicio: 'S' }, ['id-1']);
  assert.deepEqual(vars, { 1: 'F', 2: 'H', 3: 'N', 4: 'id-1' });
  assert.equal(renderTexto(t, 'Neg'), 'Te esperamos el jueves, 4 de septiembre a las 10:00, María. ¿Confirmas tu cita?');
  const kinds = catalogKinds();
  const conf = kinds.find((k) => k.kind === 'confirmacion_reserva');
  assert.ok(conf.config.texto.campos.find((f) => f.clave === 'enlace').obligatoria);
  assert.equal(kinds.find((k) => k.kind === 'aviso_lead').config.texto, undefined, 'el aviso de lead no es editable');
});

// ── Ciclo completo contra D1 ───────────────────────────────────────────────────
const KEK = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
async function fixture(t) {
  const f = await bookingFixture();
  const old = globalThis.fetch;
  f.env.SECRETS_KEK = KEK;
  const enc = await encryptSecret(f.env, TID, 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
  await f.DB.prepare("UPDATE tenants SET twilio_subaccount_sid=?, twilio_auth_token_enc=?, plan='profesional' WHERE id=?").bind('AC' + 's'.repeat(32), enc, TID).run();
  const twilio = { content: [], approvals: [], status: {} };
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://content.twilio.com/v1/Content') { twilio.content.push(JSON.parse(String(init.body))); return Response.json({ sid: 'HX' + String(++n).padStart(32, '0') }, { status: 201 }); }
    if (u.endsWith('/ApprovalRequests/whatsapp')) { twilio.approvals.push(JSON.parse(String(init.body))); return Response.json({}, { status: 201 }); }
    if (u.endsWith('/ApprovalRequests')) { const sid = u.split('/Content/')[1].split('/')[0]; return Response.json({ whatsapp: twilio.status[sid] || { status: 'pending' } }); }
    if (u.includes('api.telegram.org')) return Response.json({ ok: true });
    return f.fetchProvider(url, init);
  };
  t.after(async () => { await f.close(); globalThis.fetch = old; });
  const cliente = { role: 'cliente', tenantId: TID, email: 'cliente@dialogos.test', modulos: ['calendario'] };
  const call = async (kind, body, scope = cliente, tenant = TID) => {
    const path = `/api/admin/tenants/${tenant}/plantillas/${kind}`;
    const req = new Request('https://admin.hirevai.com' + path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    return testing.adminRouter(req, f.env, f.ctx, path, new URL(req.url), {}, scope);
  };
  const fila = (kind) => f.DB.prepare('SELECT * FROM tenant_templates WHERE tenant_id=? AND kind=?').bind(TID, kind).first();
  return { f, twilio, call, fila, cliente };
}
const TEXTO = 'Hola {{nombre}}, tu cita con {{negocio}} es el {{fecha}} a las {{hora}}. Gestiónala aquí: {{enlace}} ¡Gracias!';

test('guardar texto: validar no toca Twilio; errores con su código; tenant ajeno = 404', async (t) => {
  const { twilio, call } = await fixture(t);
  const v = await (await call('confirmacion_reserva', { texto: TEXTO, validar: true })).json();
  assert.equal(v.ok, true);
  assert.match(v.preview, /^Hola María, tu cita con Diálogos que Enseñan es el jueves/);
  const malo = await (await call('confirmacion_reserva', { texto: 'Hola {{nombre}}, tu cita es pronto y ya está.', validar: true })).json();
  assert.deepEqual(malo.errores.map((e) => e.clave), ['fecha', 'hora', 'enlace']);
  await assert.rejects(call('confirmacion_reserva', { texto: 'Hola {{nombre}}, tu cita es pronto y ya está.' }), (e) => e.status === 400 && e.code === 'falta_variable' && e.why === 'fecha');
  await assert.rejects(call('confirmacion_reserva', { texto: TEXTO }, undefined, '00000000-0000-4000-8000-00000000000b'), (e) => e.status === 404);
  await assert.rejects(call('aviso_lead', { texto: TEXTO }), (e) => e.status === 404, 'solo los kinds editables');
  await assert.rejects(call('confirmacion_reserva', { texto: 42 }), (e) => e.code === 'invalid_texto');
  assert.equal(twilio.content.length, 0, 'nada de esto crea plantillas');
});

test('guardar texto sin plantilla: la crea con ese texto; con una aprobada entra como REVISIÓN y la aprobada sigue', async (t) => {
  const { f, twilio, call, fila } = await fixture(t);
  const r1 = await call('confirmacion_reserva', { texto: TEXTO });
  assert.equal(r1.status, 201);
  assert.equal((await r1.json()).modo, 'principal');
  assert.equal(twilio.content[0].types['twilio/text'].body, 'Hola {{1}}, tu cita con {{2}} es el {{3}} a las {{4}}. Gestiónala aquí: {{5}} ¡Gracias!');
  assert.match(twilio.approvals[0].name, /^confirmacion_reserva_dialogos_r\d{12}$/);
  let row = await fila('confirmacion_reserva');
  assert.deepEqual([row.status, row.texto], ['pending', TEXTO]);
  // Mientras está pendiente no se somete otra.
  await assert.rejects(call('confirmacion_reserva', { texto: TEXTO.replace('¡Gracias!', 'Un saludo.') }), (e) => e.status === 409 && e.code === 'plantilla_en_revision');
  // Meta la aprueba (poll): ya es la activa.
  twilio.status[row.sid] = { status: 'approved', category: 'UTILITY' };
  await testing.pollTemplateApprovals(f.env);
  row = await fila('confirmacion_reserva');
  assert.equal(row.status, 'approved');
  const activa = row.sid;
  // Mismo texto que el vigente: nada que someter.
  await assert.rejects(call('confirmacion_reserva', { texto: TEXTO }), (e) => e.code === 'nothing_to_update');
  // Texto nuevo con una aprobada: REVISIÓN, la activa no se toca.
  const nuevo = 'Reserva confirmada para el {{fecha}} a las {{hora}}. Si necesitas cambiarla: {{enlace}} Hasta pronto.';
  const r2 = await call('confirmacion_reserva', { texto: nuevo });
  assert.equal((await r2.json()).modo, 'revision');
  row = await fila('confirmacion_reserva');
  assert.deepEqual([row.sid, row.status, row.texto, row.revision_status, row.revision_texto], [activa, 'approved', TEXTO, 'pending', nuevo]);
  const plantilla = await testing.tenantTemplate(f.env, TID, 'confirmacion_reserva');
  assert.deepEqual([plantilla.sid, plantilla.texto], [activa, TEXTO], 'quien envía sigue usando la aprobada y su texto');
  // Rechazada: la activa sigue; el motivo queda para el cliente.
  twilio.status[row.revision_sid] = { status: 'rejected', rejection_reason: 'INVALID_FORMAT' };
  await testing.pollTemplateApprovals(f.env);
  row = await fila('confirmacion_reserva');
  assert.deepEqual([row.sid, row.status, row.revision_status, row.revision_motivo], [activa, 'approved', 'rejected', 'INVALID_FORMAT']);
  // Otra revisión (la rechazada no bloquea) y esta vez Meta la aprueba: se promueve entera.
  const r3 = await call('confirmacion_reserva', { texto: nuevo });
  assert.equal(r3.status, 201);
  row = await fila('confirmacion_reserva');
  twilio.status[row.revision_sid] = { status: 'approved', category: 'UTILITY' };
  const revisionSid = row.revision_sid;
  await testing.pollTemplateApprovals(f.env);
  row = await fila('confirmacion_reserva');
  assert.deepEqual([row.sid, row.status, row.texto, row.revision_sid, row.revision_status, row.categoria], [revisionSid, 'approved', nuevo, null, null, 'UTILITY']);
  // Y el GET del cliente lo enseña (sin sids).
  const path = '/api/admin/plantillas';
  const req = new Request('https://admin.hirevai.com' + path);
  const out = await (await testing.adminRouter(req, f.env, f.ctx, path, new URL(req.url), {}, { role: 'cliente', tenantId: TID, email: 'c@x', modulos: ['calendario'] })).json();
  const celda = out.tenants[0].plantillas.confirmacion_reserva;
  assert.deepEqual([celda.texto, celda.revision, celda.sid], [nuevo, null, undefined]);
});

test('recordatorio: el texto nuevo conserva los botones vigentes y el id va detrás de las variables del cuerpo', async (t) => {
  const { f, twilio, call, fila } = await fixture(t);
  const opciones = JSON.stringify({ botones: 'si_voy_no_puedo', textos: { confirmar: 'Sí, voy', cancelar: 'No puedo ir' } });
  await f.DB.prepare("INSERT INTO tenant_templates(tenant_id,kind,sid,status,opciones,created_at,updated_at) VALUES (?,'recordatorio_cita',?,'approved',?,?,?)")
    .bind(TID, 'HX' + 'r'.repeat(32), opciones, new Date().toISOString(), new Date().toISOString()).run();
  const texto = 'Te esperamos el {{fecha}} a las {{hora}} en {{negocio}}. ¿Nos confirmas tu asistencia?';
  assert.equal((await call('recordatorio_cita', { texto })).status, 201);
  const qr = twilio.content[0].types['twilio/quick-reply'];
  assert.deepEqual(qr.actions, [{ title: 'Sí, voy', id: 'conf:{{4}}' }, { title: 'No puedo ir', id: 'canc:{{4}}' }]);
  const row = await fila('recordatorio_cita');
  assert.equal(row.revision_opciones, opciones);
  twilio.status[row.revision_sid] = { status: 'approved', category: 'UTILITY' };
  await testing.pollTemplateApprovals(f.env);
  const activa = await testing.tenantTemplate(f.env, TID, 'recordatorio_cita');
  const vars = JSON.parse(testing.reminderTemplateVariables({ name: 'Diálogos' }, { id: 'cita-9', customer_name: 'Ana', starts_at: '2026-10-01T08:00:00.000Z', timezone: 'Europe/Madrid' }, activa.texto));
  assert.deepEqual(Object.keys(vars), ['1', '2', '3', '4']);
  assert.deepEqual([vars[3], vars[4]], ['Diálogos', 'cita-9']);
});

test('guardar texto exige el módulo Calendario', async (t) => {
  const { f, call } = await fixture(t);
  await f.DB.prepare("UPDATE tenants SET plan='esencial' WHERE id=?").bind(TID).run();
  await assert.rejects(call('confirmacion_reserva', { texto: TEXTO }, { role: 'velai', email: 'a@velai' }), (e) => e.status === 403 && e.code === 'modulo_no_contratado');
});
