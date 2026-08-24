// Aprovisionamiento de Twilio desde el panel. Regla de oro: los recursos DE una
// subcuenta se operan con las credenciales DE esa subcuenta — la doc de Twilio dice
// que las API Keys de la cuenta principal no acceden a recursos de subcuenta. Solo
// la CREACIÓN de la subcuenta usa las del padre. Ninguna función registra credenciales.

class TwilioError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

async function twilioRequest(url, credentials, { method = 'POST', form = null, json = null } = {}) {
  const headers = { Authorization: `Basic ${btoa(`${credentials.sid}:${credentials.token}`)}` };
  let body;
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form); }
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new TwilioError(502, `twilio_${response.status}_${data.code || 'error'}`);
    // El «message» de Twilio dice QUÉ campo falla: sin él, un 63100 (validación) obliga a
    // adivinar (pasó con el perfil de Diálogos). Nunca lleva credenciales.
    error.detail = String(data.message || '').slice(0, 200);
    throw error;
  }
  return data;
}

export async function createSubaccount(env, friendlyName) {
  const data = await twilioRequest('https://api.twilio.com/2010-04-01/Accounts.json',
    { sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN }, { form: { FriendlyName: friendlyName } });
  // data.auth_token solo viaja aquí: el llamante lo cifra inmediatamente y no vuelve al panel.
  return { sid: data.sid, authToken: data.auth_token };
}

// El padre puede LEER sus subcuentas (auth token incluido): permite ADOPTAR una
// subcuenta preexistente en vez de crear duplicados — pedido de Juan tras topar
// con la de gogestion ya creada en la era de los bots viejos.
export async function fetchSubaccount(env, sid) {
  const data = await twilioRequest(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
    { sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN }, { method: 'GET' });
  return { sid: data.sid, authToken: data.auth_token, friendlyName: data.friendly_name, status: data.status };
}

// Busca una subcuenta activa por nombre exacto (cliente-<slug>): si ya existe, se
// adopta; solo se crea cuando de verdad no hay ninguna.
export async function findSubaccountByName(env, friendlyName) {
  const data = await twilioRequest(`https://api.twilio.com/2010-04-01/Accounts.json?FriendlyName=${encodeURIComponent(friendlyName)}&Status=active`,
    { sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN }, { method: 'GET' });
  const hit = (data.accounts || []).find((a) => a.friendly_name === friendlyName && a.sid !== env.TWILIO_ACCOUNT_SID);
  return hit ? { sid: hit.sid, authToken: hit.auth_token, friendlyName: hit.friendly_name } : null;
}

// Plantilla de aviso de lead con las 4 variables en el orden fijado por
// leadTemplateVariables (1 WhatsApp, 2 Nombre, 3 Negocio, 4 Necesidad).
export async function createLeadTemplate(credentials, slug, businessName) {
  const data = await twilioRequest('https://content.twilio.com/v1/Content', credentials, {
    json: {
      friendly_name: `nuevo_lead_${slug}`.replace(/[^a-z0-9_]/g, '_'),
      language: 'es',
      variables: { 1: '34612345678', 2: 'María', 3: 'Barbería en Madrid', 4: 'Atender clientes fuera de horario' },
      types: {
        'twilio/text': {
          body: `🔥 Nuevo lead – ${businessName}\n\n📱 WhatsApp: {{1}}\n👤 Nombre: {{2}}\n🏪 Negocio: {{3}}\n🎯 Necesidad: {{4}}\n\n⚡ Contactar hoy mismo`,
        },
      },
    },
  });
  return { contentSid: data.sid };
}

export async function submitTemplateApproval(credentials, contentSid, name) {
  return twilioRequest(`https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests/whatsapp`, credentials, {
    json: { name: name.toLowerCase().replace(/[^a-z0-9_]/g, '_'), category: 'UTILITY' },
  });
}

// El estado lo pone Meta y Twilio lo expone aquí. Devuelve `raw` a propósito: con
// /v2/Channels/Senders ya aprendimos que la forma asumida de una respuesta de Twilio puede
// no ser la real, y aquí un desajuste devolvería 'unknown' PARA SIEMPRE — la fila se
// quedaría 'pending' en silencio y los avisos del cliente nunca saldrían. Con el crudo
// delante, el desajuste se ve en un vistazo en vez de deducirse.
export async function fetchApprovalStatus(credentials, contentSid) {
  const data = await twilioRequest(`https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests`, credentials, { method: 'GET' });
  const wa = data.whatsapp || {};
  return { status: String(wa.status || 'unknown').toLowerCase(), reason: wa.rejection_reason || null, raw: data };
}

export async function createWhatsAppSender(credentials, { phone, wabaId, callbackUrl }) {
  const data = await twilioRequest('https://messaging.twilio.com/v2/Channels/Senders', credentials, {
    json: {
      sender_id: `whatsapp:${phone}`,
      configuration: { waba_id: wabaId, verification_method: 'sms' },
      webhook: { callback_url: callbackUrl, callback_method: 'POST' },
    },
  });
  return { senderSid: data.sid, status: data.status };
}

// Lista los senders de WhatsApp de una subcuenta. Es la contraparte de LECTURA de
// createWhatsAppSender: cuando el sender lo creó el Self Sign-up (el cliente desde
// la consola de Twilio, no nuestro botón), la fila de D1 no sabe nada y hay que
// reconciliarla. Verificado contra la API real (gogestion, 2026-08-22): la ruta es
// /v2/Channels/Senders CON mayúsculas (en minúsculas responde 404 20404), el listado
// exige Channel=whatsapp, y el array de la respuesta se llama «senders».
export async function listWhatsAppSenders(credentials) {
  const data = await twilioRequest('https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=50', credentials, { method: 'GET' });
  const items = Array.isArray(data.senders) ? data.senders : (Array.isArray(data.data) ? data.data : []);
  return items
    .filter((s) => String(s.sender_id || '').startsWith('whatsapp:'))
    // El Sandbox de Twilio (+14155238886) aparece listado como un sender más en toda
    // subcuenta: en la primera sync real (gogestion) se coló como sender del cliente
    // (OFFLINE y sin WABA) y ensució la fila. Nunca es un sender de un cliente.
    .filter((s) => s.sender_id !== 'whatsapp:+14155238886')
    .map((s) => ({
      senderSid: s.sid,
      senderId: s.sender_id,                                        // 'whatsapp:+34624121930'
      status: s.status,                                             // CREATING|PENDING_VERIFICATION|VERIFYING|ONLINE|…
      wabaId: (s.configuration && s.configuration.waba_id) || null,
      webhookUrl: (s.webhook && s.webhook.callback_url) || null,
    }));
}

// El Self Sign-up NO configura nuestro webhook (queda el default de Twilio): sin
// esto, el sender está ONLINE pero los mensajes no llegan al worker y el bot calla.
// Es el fallo más probable de todo el alta (SPEC-CONEXIONES §2.4).
export async function updateSenderWebhook(credentials, senderSid, callbackUrl) {
  const data = await twilioRequest(`https://messaging.twilio.com/v2/Channels/Senders/${senderSid}`, credentials, {
    json: { webhook: { callback_url: callbackUrl, callback_method: 'POST' } },
  });
  return { status: data.status };
}


// Perfil de NEGOCIO del sender (la foto que ve el usuario en WhatsApp, descripción,
// web). OJO: nunca se envía profile.name — cambiar el display name dispara una
// revisión de Meta; solo campos cosméticos.
export async function updateSenderProfile(credentials, senderSid, profile) {
  const data = await twilioRequest(`https://messaging.twilio.com/v2/Channels/Senders/${senderSid}`, credentials, {
    json: { profile },
  });
  return { status: data.status };
}

export async function verifySender(credentials, senderSid, code) {
  const data = await twilioRequest(`https://messaging.twilio.com/v2/Channels/Senders/${senderSid}`, credentials, {
    json: { configuration: { verification_code: code } },
  });
  return { status: data.status };
}

export async function fetchSenderStatus(credentials, senderSid) {
  const data = await twilioRequest(`https://messaging.twilio.com/v2/Channels/Senders/${senderSid}`, credentials, { method: 'GET' });
  return { status: data.status };
}

// Igual que fetchSenderStatus pero devuelve TAMBIÉN el perfil: hace falta para no
// perder el display name al actualizar los campos cosméticos (la API pide profile.name
// en los senders de WhatsApp y cambiarlo dispara revisión de Meta).
export async function fetchSender(credentials, senderSid) {
  const data = await twilioRequest(`https://messaging.twilio.com/v2/Channels/Senders/${senderSid}`, credentials, { method: 'GET' });
  return { status: data.status, profile: data.profile || {} };
}
