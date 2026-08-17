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
  if (!response.ok) throw new TwilioError(502, `twilio_${response.status}_${data.code || 'error'}`);
  return data;
}

export async function createSubaccount(env, friendlyName) {
  const data = await twilioRequest('https://api.twilio.com/2010-04-01/Accounts.json',
    { sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN }, { form: { FriendlyName: friendlyName } });
  // data.auth_token solo viaja aquí: el llamante lo cifra inmediatamente y no vuelve al panel.
  return { sid: data.sid, authToken: data.auth_token };
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

export async function fetchApprovalStatus(credentials, contentSid) {
  const data = await twilioRequest(`https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests`, credentials, { method: 'GET' });
  const wa = data.whatsapp || {};
  return { status: String(wa.status || 'unknown').toLowerCase(), reason: wa.rejection_reason || null };
}

export async function createWhatsAppSender(credentials, { phone, wabaId, callbackUrl }) {
  const data = await twilioRequest('https://messaging.twilio.com/v2/channels/senders', credentials, {
    json: {
      sender_id: `whatsapp:${phone}`,
      configuration: { waba_id: wabaId, verification_method: 'sms' },
      webhook: { callback_url: callbackUrl, callback_method: 'POST' },
    },
  });
  return { senderSid: data.sid, status: data.status };
}

export async function verifySender(credentials, senderSid, code) {
  const data = await twilioRequest(`https://messaging.twilio.com/v2/channels/senders/${senderSid}`, credentials, {
    json: { configuration: { verification_code: code } },
  });
  return { status: data.status };
}

export async function fetchSenderStatus(credentials, senderSid) {
  const data = await twilioRequest(`https://messaging.twilio.com/v2/channels/senders/${senderSid}`, credentials, { method: 'GET' });
  return { status: data.status };
}
