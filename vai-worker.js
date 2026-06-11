const SYSTEM = `Eres Vai, el asistente comercial de Velai — empresa de IA que implanta asistentes en negocios pequeños y medianos.

Tu misión: explicar qué hace Velai, resolver dudas y conseguir el WhatsApp del visitante para agendar una demo.

== SOBRE VELAI ==
Velai implanta Vai en cualquier negocio. Vai atiende clientes, gestiona reservas, procesa pedidos y notifica al equipo, 24/7, sin intervención humana. "Tu negocio funciona aunque tú estés durmiendo."

== QUÉ HACE VAI ==
- Atiende 24/7 en WhatsApp, web e Instagram
- Gestiona reservas, pedidos y ventas completas
- Notifica al equipo en tiempo real
- Panel de control unificado
- Seguimiento post-venta automático

== SECTORES ==
Barbería, restaurante, clínica, tienda, inmobiliaria, hotel, taller — cualquier PYME.

== PRECIOS ==
- Esencial: 1.000 euros setup + 100 euros/mes (1 canal)
- Profesional: 1.800 euros setup + 120 euros/mes (todos los canales)
- Empresa: a medida

== OBJECIONES ==
- Cuánto tarda: menos de 48h, nosotros lo configuramos todo
- Si se equivoca: avisa al equipo, siempre hay control humano
- Puedo pausarlo: sí, control total
- Reemplaza empleados: no, los libera de tareas repetitivas
- WhatsApp Business: sí, API oficial, mismo número
- Clientes sabrán que es IA: tú decides cómo presentarlo
- Datos: cumple RGPD, son tuyos

== CÓMO ACTUAR ==
1. Pregunta qué tipo de negocio tiene
2. Personaliza el ejemplo a su sector
3. Resuelve dudas
4. IMPORTANTE: Antes de pedir el WhatsApp asegúrate de saber el nombre del cliente, tipo de negocio y problema principal. Si no los sabes, pregúntalos primero.
5. Solo cuando tengas esos datos pide el WhatsApp.
6. Al confirmar di: "Perfecto [nombre], el equipo de Velai te llama hoy para la demo de tu [negocio]."

== ESTILO ==
- Mensajes cortos, máximo 3-4 líneas
- Tono cercano como en WhatsApp
- Algún emoji ocasional
- Nunca listas largas

Responde siempre en español.`;

// ── Personas de DEMO por sector ──
// El prospecto "juega" a ser cliente de un negocio ficticio y experimenta a
// Vai en acción. Tras unos turnos, Vai rompe la cuarta pared y ofrece la demo
// real de Velai. En modo demo NO se notifican leads (es un juego de rol).
const DEMOS = {
  restaurante: `Eres Vai, el asistente de WhatsApp de "La Parrilla del Puerto", un restaurante ficticio de demostración (mediterráneo, 60 cubiertos, en la costa).

Tu trabajo: atender al cliente como lo haría el restaurante real — con naturalidad, cercano, mensajes cortos tipo WhatsApp, algún emoji.

== DATOS DEL RESTAURANTE (ficticios, úsalos con seguridad) ==
- Horario: martes a domingo, 13:00–16:00 y 20:00–23:30. Lunes cerrado.
- Carta: arroces (paella marinera 18€, arroz negro 17€), pescado fresco del día, mariscos, entrantes para compartir (8–14€), postres caseros. Menú del día mediodía 16€.
- Reservas: gestionas la reserva pidiendo día, hora, nº de personas y un nombre. Confirmas disponibilidad (invéntala de forma razonable) y la das por hecha.
- Alérgenos y opciones: hay opciones sin gluten y vegetarianas. Terraza disponible.
- Ubicación: paseo marítimo (ficticio).

== CÓMO ACTUAR ==
1. Atiende la consulta o reserva con naturalidad, como el restaurante real.
2. Tras 3–4 intercambios, o si el cliente muestra que le ha gustado la experiencia, rompe el rol con algo como: "Por cierto 😊 soy Vai, una demo de Velai. Así de natural atendería yo el WhatsApp de TU negocio, 24/7. ¿Quieres una Vai para lo tuyo?" y ofrece agendar una demo real o escribir al equipo de Velai.
3. Si preguntan por Velai directamente, explica brevemente: implantamos asistentes de IA llave en mano para PYMEs, funcionando en menos de 48h, desde 100€/mes.

Responde siempre en español. Mensajes cortos.`
};

const SUMMARY_PROMPT = `Analiza esta conversación entre un cliente y Vai (asistente de Velai). Extrae los datos del lead.

Responde ÚNICAMENTE con un JSON válido, sin texto adicional antes ni después. Usa null (sin comillas) para campos desconocidos.

Ejemplo de respuesta:
{"nombre": "María", "negocio": "barbería en Madrid", "necesidad": "atender clientes fuera de horario", "contexto": "tiene 2 empleados y pierde reservas por las noches"}

Campos:
- nombre: nombre propio del cliente
- negocio: tipo o nombre del negocio
- necesidad: problema principal (máx 10 palabras)
- contexto: detalle relevante adicional (máx 15 palabras)`;

const TELEGRAM_CHAT_ID = '-5021568102';

const WA_FOUNDERS = [
  'whatsapp:+34655433803',
  'whatsapp:+34642650553',
  'whatsapp:+34602608940'
];

async function sendTelegram(token, text) {
  try {
    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'HTML'
      })
    });
  } catch(e) {}
}

async function sendWhatsApp(accountSid, authToken, text) {
  var plainText = text.replace(/<[^>]+>/g, '');
  await Promise.all(WA_FOUNDERS.map(async function(to) {
    try {
      var r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + accountSid + '/Messages.json', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(accountSid + ':' + authToken),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          From: 'whatsapp:+15706160059',
          To: to,
          Body: plainText
        }).toString()
      });
      var d = await r.json();
      console.log('WA ' + to + ' status=' + r.status + ' sid=' + (d.sid||d.code||JSON.stringify(d).slice(0,100)));
    } catch(e) {
      console.log('WA error ' + to + ': ' + e.message);
    }
  }));
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Lead de formulario/quiz del funnel (web). Notifica SOLO por Telegram
// (canal centralizado) — nada va a WhatsApp de founders.
async function handleLead(request, env, cors) {
  var jsonHeaders = Object.assign({ 'Content-Type': 'application/json' }, cors);
  try {
    var body = await request.json();
    var msg = '📨 <b>NUEVO LEAD — VELAI (' + escapeHtml(body.fuente || 'formulario') + ')</b>\n\n';
    if (body.nombre)        msg += '👤 Nombre: ' + escapeHtml(body.nombre) + '\n';
    if (body.whatsapp)      msg += '📱 WhatsApp: ' + escapeHtml(body.whatsapp) + '\n';
    if (body.sector)        msg += '🏪 Sector: ' + escapeHtml(body.sector) + '\n';
    if (body.mensajesDia)   msg += '💬 Mensajes/día: ' + escapeHtml(body.mensajesDia) + '\n';
    if (body.canal)         msg += '📡 Canal: ' + escapeHtml(body.canal) + '\n';
    if (body.quienResponde) msg += '🙋 Responde hoy: ' + escapeHtml(body.quienResponde) + '\n';
    if (body.score != null) msg += '📈 Puntaje diagnóstico: ' + escapeHtml(body.score) + '/100\n';
    if (body.nota)          msg += '📝 ' + escapeHtml(body.nota) + '\n';

    var utm = body.utm || {};
    var utmKeys = Object.keys(utm);
    if (utmKeys.length) {
      msg += '\n📊 <b>Atribución</b>\n';
      utmKeys.forEach(function (k) { msg += '· ' + escapeHtml(k) + ': ' + escapeHtml(utm[k]) + '\n'; });
    }
    msg += '\n⚡ <b>Contactar hoy mismo</b>';

    if (env.TELEGRAM_TOKEN) await sendTelegram(env.TELEGRAM_TOKEN, msg);
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: jsonHeaders });
  }
}

async function summarizeLead(apiKey, messages) {
  var conversation = messages.map(function(m) {
    var role = m.role === 'user' ? 'Cliente' : 'Vai';
    var text = typeof m.content === 'string' ? m.content : '';
    return role + ': ' + text;
  }).join('\n');

  try {
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: SUMMARY_PROMPT,
        messages: [{ role: 'user', content: conversation }],
      }),
    });
    var data = await res.json();
    var rawText = data.content && data.content[0] ? data.content[0].text.trim() : '{}';
    // Extrae el JSON aunque Claude añada texto extra antes/después
    var jsonMatch = rawText.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
  } catch(e) {
    return {};
  }
}

export default {
  async fetch(request, env) {
    var cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    // Ruta del funnel: lead de formulario/quiz (notifica por Telegram)
    if (new URL(request.url).pathname.replace(/\/$/, '') === '/lead') {
      return await handleLead(request, env, cors);
    }

    try {
      var messages = [];
      var fromWhatsApp = false;
      var twilioFrom = '';
      var demoKey = '';
      var contentType = request.headers.get('content-type') || '';

      if (contentType.includes('application/x-www-form-urlencoded')) {
        // Twilio WhatsApp
        fromWhatsApp = true;
        var formText = await request.text();
        var params = new URLSearchParams(formText);
        var userMsg = params.get('Body') || '';
        twilioFrom = params.get('From') || '';

        // Cargar historial de KV
        var history = [];
        if (env.KV) {
          var stored = await env.KV.get('conv:' + twilioFrom);
          if (stored) history = JSON.parse(stored);
        }
        history.push({ role: 'user', content: userMsg });
        messages = history;
      } else {
        var body = await request.json();
        messages = body.messages;
        if (body.demo && DEMOS[body.demo]) demoKey = body.demo;
      }

      if (!messages || !Array.isArray(messages)) return new Response('Invalid', { status: 400 });

      // Main Claude response
      var res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          system: demoKey ? DEMOS[demoKey] : SYSTEM,
          messages: messages,
        }),
      });

      var data = await res.json();
      var reply = data.content && data.content[0] ? data.content[0].text : '';

      // Guardar historial si es WhatsApp
      if (fromWhatsApp && env.KV) {
        var updatedHistory = messages.concat([{ role: 'assistant', content: reply }]);
        // Máximo 20 mensajes para no crecer infinito
        if (updatedHistory.length > 20) updatedHistory = updatedHistory.slice(-20);
        await env.KV.put('conv:' + twilioFrom, JSON.stringify(updatedHistory), { expirationTtl: 86400 });
      }

      // Check phone only in last user message
      var lastUserMsg = '';
      for (var i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          lastUserMsg = typeof messages[i].content === 'string' ? messages[i].content : '';
          break;
        }
      }

      // Detecta teléfonos con o sin espacios/guiones (ej: "612 345 678", "+34-612345678")
      var cleanMsg = lastUserMsg.replace(/[\s\-\.\(\)]/g, '');
      var phoneMatch = cleanMsg.match(/\+?[0-9]{6,}/);

      if (!demoKey && phoneMatch && env.TELEGRAM_TOKEN) {
        var phone = phoneMatch[0];
        var allMessages = messages.concat([{ role: 'assistant', content: reply }]);
        var lead = await summarizeLead(env.ANTHROPIC_API_KEY, allMessages);

        var msg = '🔥 <b>NUEVO LEAD — VELAI</b>\n\n';
        msg += '📱 <b>WhatsApp: ' + phone + '</b>\n';
        if (lead.nombre) msg += '👤 Nombre: ' + lead.nombre + '\n';
        if (lead.negocio) msg += '🏪 Negocio: ' + lead.negocio + '\n';
        if (lead.necesidad) msg += '🎯 Necesidad: ' + lead.necesidad + '\n';
        if (lead.contexto) msg += '📝 Contexto: ' + lead.contexto + '\n';
        msg += '\n⚡ <b>Contactar hoy mismo</b>';

        await sendTelegram(env.TELEGRAM_TOKEN, msg);
        if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
          await sendWhatsApp(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, msg);
        }
      }

      // Respuesta para Twilio WhatsApp
      if (fromWhatsApp) {
        var safe = reply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        var twiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Message>' + safe + '</Message></Response>';
        return new Response(twiml, {
          headers: { 'Content-Type': 'text/xml', 'Access-Control-Allow-Origin': '*' },
        });
      }

      return new Response(JSON.stringify({ reply }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};
