/* ══════════════════════════════════════════════════════════════════════════
   VAI CHAT WIDGET — autocontenido (CSS + markup + lógica) · v11
   ──────────────────────────────────────────────────────────────────────────
   OJO CON LA VERSIÓN: este archivo se sirve con Cache-Control immutable durante un
   año (_headers, /*.js), así que el `?v=N` de la URL ES la clave de caché. Cambiar el
   archivo SIN subir N significa que el archivo nuevo NO LLEGA A NADIE: el CDN y los
   navegadores siguen dando el viejo. Pasó el 2026-08-26 con la burbuja del equipo.
   Toda modificación de este archivo sube N aquí Y en los HTML; `npm run check:site`
   falla si las dos no coinciden.

   Se carga en TODAS las páginas con una sola línea:
     <script src="/assets/vai-widget.js?v=11" defer></script>

   En la web de un CLIENTE van dos líneas (la primera declara el tenant):
     <script>window.VELAI_TENANT='zoe';</script>
     <script src="https://hirevai.com/assets/vai-widget.js?v=11" defer></script>

   Autocontenido a propósito: solo index.html carga /assets/styles.css, el
   resto de páginas llevan CSS inline. Por eso este archivo inyecta su propio
   CSS y no depende de styles.css ni de variables CSS del tema.

   AUTOSUFICIENTE fuera de hirevai.com (v6): si funnel.js no está en la página
   (webs de clientes), el widget carga Turnstile y ejecuta el challenge él
   mismo, con la sitekey pública de Velai por defecto (overridable con
   window.VELAI_TURNSTILE_SITEKEY). Si window.VELAI_HUMAN existe (hirevai.com)
   se usa tal cual: un solo widget de Turnstile por página, cero cambios aquí.

   ATENCIÓN HUMANA EN VIVO (v9): el widget declara `live:true` al worker y, SOLO
   cuando una conversación deja de llevarla el bot, pregunta cada 6 s por mensajes
   nuevos (GET /chat/poll). Con la IA atendiendo —el 99% del tráfico— no hace ni
   una petición extra. Un widget v8 cacheado NO manda `live`, así que el worker no
   le cede el turno a nadie y se comporta exactamente como antes: la IA atiende y
   captura el lead. Por eso se puede desplegar sin tocar las webs de los clientes.

   MARCA POR TENANT (v7): al montar se pide GET /widget/boot?tenant=<slug> y
   el chat pinta el logo, nombre, saludo, chips, placeholder, colores, tema y
   WhatsApp DEL CLIENTE. Sin marca configurada (o sin tenant): marca de Velai,
   idéntica a la de siempre. Bilingüe ES/EN por <html lang> o navigator.language.

   Config opcional (antes de cargar este script):
     window.VELAI_WORKER = 'https://api.hirevai.com';
     window.VELAI_CHAT   = { teaserDelay: 18000, disabled: false };

   MODO DEMO (rol-play). El worker YA lo soporta en el chat web
   (`vai-worker.js:299` → `if (body.demo && DEMOS[body.demo])`). Tres formas:
     1. Query string:  /restaurantes/?chat=1&demo=restaurante
     2. Atributo HTML: <button data-vai-demo="clinica">Prueba la demo</button>
     3. API pública:   window.VaiChat.open({ demo: 'taller' })
   Por defecto está DESACTIVADO: el FAB abre el asistente normal del tenant.

   Eventos que emite (vía window.velaiTrack de funnel.js, si existe):
     chat_view          — el widget se ha pintado
     chat_teaser_shown  — se mostró el globo teaser
     chat_open          — el usuario abrió el panel
     chat_first_message — primer mensaje enviado en la sesión
     chat_message       — cada mensaje enviado
     chat_reply         — respuesta recibida del worker
     chat_error         — fallo de red / worker
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CFG = window.VELAI_CHAT || {};
  if (CFG.disabled) return;

  var WORKER = (window.VELAI_WORKER || 'https://api.hirevai.com').replace(/\/$/, '');
  var TEASER_DELAY = typeof CFG.teaserDelay === 'number' ? CFG.teaserDelay : 18000;
  var SS_TEASER = 'velai-chat-teaser';
  var SS_OPENED = 'velai-chat-opened';
  var SS_STATE = 'velai-chat-state'; // conversación persistida entre páginas (muere al cerrar la pestaña)

  // Sitekey pública de Velai (la misma que va inline en el HTML de hirevai.com):
  // las webs de los clientes no tienen que declarar nada para que el chequeo funcione.
  var SITEKEY_FALLBACK = '0x4AAAAAAESkAwvlDVJD9Z1l';

  var TENANT = (typeof window.VELAI_TENANT === 'string' && window.VELAI_TENANT)
    ? window.VELAI_TENANT.slice(0, 40) : '';

  /* ── i18n: <html lang> manda; si no, el idioma del navegador ─────────── */
  var LANG = /^en/i.test(document.documentElement.lang || navigator.language || '') ? 'en' : 'es';
  var T = LANG === 'en' ? {
    online: 'Online now',
    placeholder: 'Type a message...',
    greeting: "Hi! I'm Vai 👋 I'm the same assistant we build for our clients. Ask me anything — or tap one of these options:",
    chips: ['How much does it cost?', 'Show me a demo', 'Will it work for my business?'],
    teaser: 'Questions? Ask me anything — I reply instantly.',
    open: 'Open chat with ', close: 'Close chat with ', closeBtn: 'Close chat',
    chat: 'Chat with ', send: 'Send', msg: 'Message', dismiss: 'Dismiss',
    errHuman: "I couldn't verify you're human (an unstable network or a blocker can cause this). Reload the page and try again, or message us on WhatsApp: https://wa.me/",
    errGeneric: "Oops, I can't reply right now. Message us on WhatsApp and we'll answer in minutes: https://wa.me/",
    agentLabel: 'Team',
    liveWaiting: 'Waiting for someone from the team — stay on this window and their reply will appear here.',
    liveHuman: "You're now talking with someone from the team"
  } : {
    online: 'En línea ahora',
    placeholder: 'Escribe un mensaje...',
    greeting: '¡Hola! Soy Vai 👋 Soy el mismo asistente que montamos para nuestros clientes. Pregúntame lo que quieras — o toca una de estas opciones:',
    chips: ['¿Cuánto cuesta?', 'Enséñame una demo', '¿Sirve para mi negocio?'],
    teaser: '¿Dudas? Pregúntame lo que quieras — respondo al momento.',
    open: 'Abrir chat con ', close: 'Cerrar chat con ', closeBtn: 'Cerrar chat',
    chat: 'Chat con ', send: 'Enviar', msg: 'Mensaje', dismiss: 'Cerrar',
    errHuman: 'No pude verificar que eres humano (a veces lo causa una red inestable o un bloqueador). Recarga la página e inténtalo de nuevo, o escríbenos por WhatsApp: https://wa.me/',
    errGeneric: 'Ups, ahora mismo no puedo responder. Escríbenos por WhatsApp y te contestamos en minutos: https://wa.me/',
    agentLabel: 'Equipo',
    liveWaiting: 'Esperando a alguien del equipo. Quédate en esta ventana: en cuanto se una, lo verás aquí.',
    liveHuman: 'Ahora hablas con una persona del equipo'
  };

  function track(name, params) {
    try { if (window.velaiTrack) window.velaiTrack(name, params || {}); } catch (e) {}
  }
  function ss(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function ssSet(key, val) { try { sessionStorage.setItem(key, val); } catch (e) {} }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── Marca del tenant (GET /widget/boot) ────────────────────────────────
     El endpoint devuelve null en lo no configurado; los defaults de Velai
     viven AQUÍ, así hirevai.com queda idéntico aunque el fetch falle.      */
  var BRAND = null;
  var bootPromise = fetch(WORKER + '/widget/boot' + (TENANT ? '?tenant=' + encodeURIComponent(TENANT) : ''))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (b) { BRAND = b; applyBrand(); return b; })
    .catch(function () { return null; });
  // Espera acotada a la marca antes de pintar textos: sin red, defaults a los 1500 ms.
  function withBrand(cb) { Promise.race([bootPromise, new Promise(function (r) { setTimeout(r, 1500); })]).then(cb, cb); }

  function botName() { return (BRAND && BRAND.bot_name) || 'Vai'; }
  function headerName() { return botName() + ' · ' + ((BRAND && BRAND.brand_name) || 'Velai'); }
  function waNumber() { return (BRAND && BRAND.wa_number) || window.VELAI_WA || '15706160059'; }
  function brandGreeting() {
    if (!BRAND) return T.greeting;
    if (LANG === 'en') return BRAND.greeting_en || BRAND.greeting || T.greeting;
    return BRAND.greeting || T.greeting;
  }

  /* ── 1. CSS ─────────────────────────────────────────────────────────────
     z-index 10000: el banner de consentimiento de funnel.js usa 9999 y se
     inserta después en el DOM, así que con z-index empatado ganaba él y
     tapaba el botón en móvil. Además desplazamos el FAB hacia arriba
     mientras el banner esté visible (--vai-lift).
     Colores en variables CSS sobre #vaiWidget: la marca del tenant se aplica
     por CSSOM (setProperty), nunca con style="" (lección de la CSP del panel).
     Defaults = la marca de Velai de siempre; .vai-dark = tema oscuro.       */
  var CSS = '' +
    '#vaiWidget{position:fixed;bottom:calc(24px + var(--vai-lift,0px));right:24px;z-index:10000;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Satoshi,system-ui,sans-serif;' +
      'transition:bottom .25s ease;' +
      '--vai-c1:#FF6B1A;--vai-head:#075e54;--vai-send:#00a884;' +
      '--vai-srf:#fff;--vai-msgbg:#ece5dd;--vai-bot:#fff;--vai-user:#dcf8c6;' +
      '--vai-agent:#f2eefb;--vai-agentac:#5b3fa8;' +
      '--vai-text:#111;--vai-in:#f0f2f5;--vai-inshell:#fff;' +
      '--vai-chipb:rgba(7,94,84,.25);--vai-chipc:#075e54;--vai-chiph:#f0f7f5}' +
    '#vaiWidget.vai-dark{--vai-srf:#141a1f;--vai-msgbg:#0b141a;--vai-bot:#1f2c34;--vai-user:#134d37;' +
      '--vai-agent:#2a2340;--vai-agentac:#bda8f5;' +
      '--vai-text:#e9edef;--vai-in:#1f2c34;--vai-inshell:#2a3942;' +
      '--vai-chipb:rgba(233,237,239,.3);--vai-chipc:#e9edef;--vai-chiph:#2a3942}' +
    '#vaiBubble{width:60px;height:60px;border-radius:50%;background:var(--vai-c1);display:flex;' +
      'align-items:center;justify-content:center;cursor:pointer;border:none;padding:0;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.35);transition:transform .2s;position:relative}' +
    '#vaiBubble{box-shadow:0 4px 20px color-mix(in srgb,var(--vai-c1) 50%,transparent)}' +
    '#vaiBubble:hover{transform:scale(1.08)}' +
    '#vaiBubble:focus-visible{outline:3px solid #fff;outline-offset:3px}' +
    '#vaiPulse{position:absolute;top:-2px;right:-2px;width:16px;height:16px;border-radius:50%;' +
      'background:#25d366;border:2px solid #fff;animation:vaiPulse 2s infinite}' +
    '@keyframes vaiPulse{0%{box-shadow:0 0 0 0 rgba(37,211,102,.7)}70%{box-shadow:0 0 0 10px rgba(37,211,102,0)}100%{box-shadow:0 0 0 0 rgba(37,211,102,0)}}' +
    '@keyframes vaiDot{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-5px);opacity:1}}' +
    /* teaser */
    '#vaiTeaser{position:absolute;bottom:74px;right:0;width:250px;background:var(--vai-srf);color:var(--vai-text);' +
      'border-radius:14px 14px 4px 14px;padding:12px 34px 12px 14px;font-size:13.5px;line-height:1.45;' +
      'box-shadow:0 10px 34px rgba(0,0,0,.22);cursor:pointer;opacity:0;transform:translateY(8px);' +
      'transition:opacity .3s ease,transform .3s ease}' +
    '#vaiTeaser.is-on{opacity:1;transform:translateY(0)}' +
    '#vaiTeaserX{position:absolute;top:6px;right:8px;background:none;border:none;color:#8696a0;' +
      'font-size:15px;line-height:1;cursor:pointer;padding:4px}' +
    /* panel */
    '#vaiWindow{display:none;position:absolute;bottom:72px;right:0;width:340px;height:500px;' +
      'border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);' +
      'flex-direction:column;background:var(--vai-srf)}' +
    '#vaiWindow.is-open{display:flex}' +
    '.vai-h{background:var(--vai-head);padding:12px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0}' +
    '.vai-h-av{width:38px;height:38px;border-radius:50%;background:var(--vai-c1);display:flex;overflow:hidden;' +
      'align-items:center;justify-content:center;font-size:18px;flex-shrink:0;color:#fff;font-weight:700}' +
    '.vai-h-av img{width:100%;height:100%;object-fit:cover;border-radius:50%}' +
    '.vai-h-id{flex:1}' +
    '.vai-h-name{color:#fff;font-size:14px;font-weight:600}' +
    '.vai-h-st{color:hsla(0,0%,100%,.75);font-size:12px;display:flex;align-items:center;gap:4px}' +
    '.vai-h-dot{width:6px;height:6px;border-radius:50%;background:#25d366}' +
    '.vai-h-x{color:hsla(0,0%,100%,.7);cursor:pointer;font-size:20px;line-height:1;background:none;border:none;padding:0 2px}' +
    '#vaiMessages{flex:1;overflow-y:auto;padding:12px;background:var(--vai-msgbg);display:flex;' +
      'flex-direction:column;gap:6px;scroll-behavior:smooth}' +
    '#vaiTyping{display:none;padding:0 12px 6px;background:var(--vai-msgbg)}' +
    '#vaiTyping.is-on{display:block}' +
    '.vai-tb{background:var(--vai-bot);border-radius:0 8px 8px 8px;padding:8px 12px;display:inline-flex;gap:4px;' +
      'align-items:center;box-shadow:0 1px 2px rgba(0,0,0,.1)}' +
    '.vai-td{width:7px;height:7px;background:#8696a0;border-radius:50%;animation:vaiDot 1.2s infinite}' +
    '.vai-td:nth-child(2){animation-delay:.2s}.vai-td:nth-child(3){animation-delay:.4s}' +
    /* chips de respuesta rápida */
    '#vaiChips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 10px;background:var(--vai-msgbg)}' +
    '#vaiChips.is-off{display:none}' +
    '.vai-chip{background:var(--vai-bot);border:1px solid var(--vai-chipb);color:var(--vai-chipc);border-radius:16px;' +
      'padding:7px 12px;font-size:12.5px;font-family:inherit;cursor:pointer;line-height:1.2}' +
    '.vai-chip:hover{background:var(--vai-chiph)}' +
    /* input */
    '.vai-in-wrap{background:var(--vai-in);padding:8px 10px;display:flex;align-items:center;gap:8px;flex-shrink:0}' +
    '.vai-in-shell{flex:1;background:var(--vai-inshell);border-radius:22px;display:flex;align-items:center;padding:8px 14px}' +
    '#vaiInput{flex:1;border:none;outline:none;font-size:16px;font-family:inherit;color:var(--vai-text);' +
      'background:transparent;resize:none;max-height:80px;line-height:1.4}' +
    '#vaiSend{width:42px;height:42px;border-radius:50%;background:var(--vai-send);border:none;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;flex-shrink:0}' +
    /* burbujas */
    '.vai-row{display:flex}.vai-row.is-bot{justify-content:flex-start}.vai-row.is-user{justify-content:flex-end}' +
    '.vai-b{max-width:80%;padding:8px 10px 5px;box-shadow:0 1px 2px rgba(0,0,0,.1)}' +
    '.vai-b.is-bot{background:var(--vai-bot);border-radius:0 8px 8px 8px}' +
    '.vai-b.is-user{background:var(--vai-user);border-radius:8px 8px 0 8px}' +
    '.vai-row.is-agent{justify-content:flex-start}' +
    '.vai-b.is-agent{background:var(--vai-agent);border-radius:0 8px 8px 8px;border-left:4px solid var(--vai-agentac)}' +
    '.vai-b-who{font-size:11px;font-weight:700;color:var(--vai-agentac);margin-bottom:2px}' +
    '.vai-live{font-size:12px;color:#8696a0;text-align:center;padding:6px 0}' +
    '.vai-b-t{font-size:13.5px;color:var(--vai-text);line-height:1.5;white-space:pre-wrap;word-break:break-word}' +
    '.vai-b-h{font-size:11px;color:#8696a0;text-align:right;margin-top:2px}' +
    /* móvil: panel a pantalla casi completa */
    '@media(max-width:480px){' +
      '#vaiWindow{position:fixed;bottom:0;right:0;left:0;width:100%;height:100dvh;border-radius:0}' +
      '#vaiTeaser{width:210px}' +
    '}' +
    '@media(prefers-reduced-motion:reduce){#vaiPulse,.vai-td{animation:none}}';

  /* ── 2. Markup ──────────────────────────────────────────────────────── */
  var HTML = '' +
    '<button id="vaiBubble" type="button" aria-label="' + esc(T.open + 'Vai') + '">' +
      '<svg id="vaiIconChat" width="28" height="28" viewBox="0 0 24 24" fill="white" aria-hidden="true">' +
        '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>' +
      '<svg id="vaiIconClose" width="24" height="24" viewBox="0 0 24 24" fill="white" style="display:none" aria-hidden="true">' +
        '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
      '<span id="vaiPulse"></span>' +
    '</button>' +
    '<div id="vaiWindow" role="dialog" aria-label="' + esc(T.chat + 'Vai') + '">' +
      '<div class="vai-h">' +
        '<div class="vai-h-av" id="vaiAvatar">🤖</div>' +
        '<div class="vai-h-id">' +
          '<div class="vai-h-name" id="vaiName">Vai · Velai</div>' +
          '<div class="vai-h-st"><span class="vai-h-dot"></span>' + esc(T.online) + '</div>' +
        '</div>' +
        '<button class="vai-h-x" type="button" aria-label="' + esc(T.closeBtn) + '">✕</button>' +
      '</div>' +
      '<div id="vaiMessages"></div>' +
      '<div id="vaiTyping"><div class="vai-tb"><span class="vai-td"></span><span class="vai-td"></span><span class="vai-td"></span></div></div>' +
      '<div id="vaiChips"></div>' +
      '<div class="vai-in-wrap">' +
        '<div class="vai-in-shell">' +
          '<textarea id="vaiInput" placeholder="' + esc(T.placeholder) + '" rows="1" maxlength="2000" aria-label="' + esc(T.msg) + '"></textarea>' +
        '</div>' +
        '<button id="vaiSend" type="button" aria-label="' + esc(T.send) + '">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">' +
            '<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';

  /* Pinta la marca del tenant en el DOM y las variables CSS por CSSOM.
     Idempotente: se llama al llegar el boot y también al montar (por si el
     fetch resolvió antes que el DOMContentLoaded). */
  function applyBrand() {
    if (!el.root || !BRAND) return;
    if (BRAND.brand_color) {
      var c1 = BRAND.brand_color, c2 = BRAND.brand_color_2 || BRAND.brand_color;
      el.root.style.setProperty('--vai-c1', c1);
      el.root.style.setProperty('--vai-send', c1);
      el.root.style.setProperty('--vai-chipc', c1);
      el.root.style.setProperty('--vai-head', 'linear-gradient(135deg,' + c1 + ',' + c2 + ')');
    }
    var dark = BRAND.theme === 'dark' ||
      (BRAND.theme !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    el.root.classList.toggle('vai-dark', !!dark);
    document.getElementById('vaiName').textContent = headerName();
    var av = document.getElementById('vaiAvatar');
    if (BRAND.logo_url && /^https:\/\//i.test(BRAND.logo_url)) {
      var img = document.createElement('img');
      img.src = BRAND.logo_url; img.alt = '';
      img.onerror = function () { av.textContent = avatarFallback(); };
      av.textContent = ''; av.appendChild(img);
    } else if (BRAND.bot_name) {
      av.textContent = avatarFallback();
    }
    if (BRAND.placeholder) el.input.placeholder = BRAND.placeholder;
    el.win.setAttribute('aria-label', T.chat + botName());
    el.bubble.setAttribute('aria-label', (open ? T.close : T.open) + botName());
  }
  function avatarFallback() { return (BRAND && BRAND.bot_name ? BRAND.bot_name : 'V').charAt(0).toUpperCase(); }

  /* ── 3. Guiones de apertura ─────────────────────────────────────────── */
  // El saludo y los chips por defecto salen de la marca del tenant (boot);
  // sin marca, los de Velai en el idioma de la página.
  function defaultScript() {
    return { greeting: brandGreeting(), chips: (BRAND && BRAND.chips) || T.chips };
  }

  // Guiones de modo demo (material comercial de Velai, solo en hirevai.com).
  // La clave debe coincidir con DEMOS en vai-worker.js.
  var DEMO_SCRIPTS = {
    restaurante: {
      greeting: 'Estás hablando con la Vai de "La Parrilla del Puerto", un restaurante ficticio. Trátala como tratarías al WhatsApp de tu negocio 👇',
      chips: ['Mesa para 4 el sábado', '¿Tenéis opciones sin gluten?', '¿A qué hora abrís?']
    },
    clinica: {
      greeting: 'Estás hablando con la Vai de "Clínica Bahía", una clínica ficticia. Pídele cita como lo haría un paciente tuyo 👇',
      chips: ['Quiero pedir cita', '¿Cuánto cuesta una limpieza?', '¿Trabajáis con seguros?']
    },
    taller: {
      greeting: 'Estás hablando con la Vai de "Talleres Ribera", un taller ficticio. Pregúntale lo que te preguntan a ti cada día 👇',
      chips: ['¿Cuánto cuesta la revisión?', 'Necesito cita para la ITV', '¿Cuánto tardáis?']
    },
    inmobiliaria: {
      greeting: 'Estás hablando con la Vai de "Fincas Arenal", una inmobiliaria ficticia. Pregúntale como lo haría un cliente tuyo 👇',
      chips: ['Busco piso de 2 habitaciones', 'Quiero visitar un inmueble', '¿Qué comisión cobráis?']
    }
  };

  /* ── 4. Estado ──────────────────────────────────────────────────────── */
  // randomUUID solo existe en secure contexts; con fallback, el widget monta siempre.
  function uuid() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    var b = new Uint8Array(16);
    try { crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  window.VELAI_UUID = window.VELAI_UUID || uuid; // reutilizable por leadform/quizzes

  var open = false, started = false, sent = 0, busy = false, humanVerified = false;
  // Parte viva (v9): estado de la conversación, último mensaje visto y temporizador.
  var liveState = 'bot', lastId = 0, pollTimer = null;
  var conversationId = ''; // se genera en el primer envío (o se restaura de la sesión)
  var demo = '';
  var history = [];
  var wasOpen = false; // el panel estaba abierto en la página anterior
  var el = {};

  function saveState() {
    try {
      sessionStorage.setItem(SS_STATE, JSON.stringify({ conversationId: conversationId, demo: demo, history: history, sent: sent, open: open, humanVerified: humanVerified, liveState: liveState, lastId: lastId }));
    } catch (e) {}
  }
  function loadState() {
    try {
      var s = JSON.parse(sessionStorage.getItem(SS_STATE));
      if (!s || !Array.isArray(s.history) || !s.history.length) return;
      history = s.history;
      if (typeof s.conversationId === 'string') conversationId = s.conversationId;
      if (typeof s.liveState === 'string') liveState = s.liveState;
      if (typeof s.lastId === 'number') lastId = s.lastId;
      humanVerified = !!s.humanVerified;
      sent = typeof s.sent === 'number' ? s.sent : history.length;
      demo = isDemo(s.demo) ? s.demo : '';
      wasOpen = !!s.open;
    } catch (e) {}
  }
  // Repinta la conversación restaurada: saludo + historial (el saludo no viaja en history)
  function renderHistory() {
    el.msgs.innerHTML = '';
    addMsg('bot', script().greeting);
    history.forEach(function (m) {
      addMsg(m.role === 'assistant' ? 'bot' : (m.role === 'agent' ? 'agent' : 'user'), m.content, m.t);
    });
  }

  // hasOwnProperty: '?demo=constructor' pintaba "undefined" como saludo y rompía los
  // chips; el worker ya se defiende (isDemoKey) — el cliente también debe hacerlo.
  function isDemo(key) {
    return typeof key === 'string' && key !== '' && Object.prototype.hasOwnProperty.call(DEMO_SCRIPTS, key);
  }

  function script() { return (isDemo(demo) && DEMO_SCRIPTS[demo]) || defaultScript(); }

  function demoFromQuery() {
    try {
      var m = /[?&]demo=([a-z]+)/i.exec(location.search);
      if (m && isDemo(m[1].toLowerCase())) return m[1].toLowerCase();
    } catch (e) {}
    return isDemo(window.VELAI_DEMO) ? window.VELAI_DEMO : '';
  }

  function mount() {
    if (document.getElementById('vaiWidget')) return; // ya montado (widget inline viejo)

    var st = document.createElement('style');
    st.id = 'vai-widget-style';
    st.textContent = CSS;
    document.head.appendChild(st);

    var root = document.createElement('div');
    root.id = 'vaiWidget';
    root.innerHTML = HTML;
    document.body.appendChild(root);

    el.root = root;
    el.bubble = root.querySelector('#vaiBubble');
    el.win = root.querySelector('#vaiWindow');
    el.msgs = root.querySelector('#vaiMessages');
    el.typing = root.querySelector('#vaiTyping');
    el.chips = root.querySelector('#vaiChips');
    el.input = root.querySelector('#vaiInput');
    el.iconChat = root.querySelector('#vaiIconChat');
    el.iconClose = root.querySelector('#vaiIconClose');

    el.bubble.addEventListener('click', function () { toggle(); });
    root.querySelector('.vai-h-x').addEventListener('click', function (e) { e.stopPropagation(); toggle(false); });
    root.querySelector('#vaiSend').addEventListener('click', function () { send(); });
    el.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    el.input.addEventListener('input', function () {
      el.input.style.height = 'auto';
      el.input.style.height = Math.min(el.input.scrollHeight, 80) + 'px';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) toggle(false);
    });

    applyBrand(); // por si el boot resolvió antes que el DOM
    wireDemoTriggers();
    watchConsentBanner();
    track('chat_view', { page: location.pathname });

    loadState();

    // Apertura automática con ?chat=1 (respeta ?demo=)
    try {
      if (/[?&]chat=1/.test(location.search)) {
        // sin &demo= no se pasa demoKey: abrir sin resetear una conversación restaurada
        var d = demoFromQuery();
        setTimeout(function () { toggle(true, 'querystring', d || undefined); }, 500);
      } else if (wasOpen && window.innerWidth > 480) {
        // conversación en curso con el panel abierto: reabrir al navegar
        // (en móvil no: el panel es pantalla completa y taparía la página)
        setTimeout(function () { toggle(true, 'restore'); }, 300);
      } else {
        scheduleTeaser();
      }
    } catch (e) { scheduleTeaser(); }
  }

  /* Cualquier elemento con data-vai-demo="clinica" abre el chat en esa demo.
     Con data-vai-demo="" (vacío) abre el asistente normal. Sin JS en las páginas. */
  function wireDemoTriggers() {
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-vai-demo]') : null;
      if (!t) return;
      e.preventDefault();
      var key = (t.getAttribute('data-vai-demo') || '').toLowerCase();
      toggle(true, 'cta', isDemo(key) ? key : '');
    });
  }

  /* ── 5. Banner de cookies: subir el FAB mientras esté visible ───────── */
  function watchConsentBanner() {
    function measure() {
      var b = document.getElementById('velai-consent');
      var lift = 0;
      if (b && window.innerWidth < 900) lift = b.offsetHeight + 12;
      document.documentElement.style.setProperty('--vai-lift', lift + 'px');
    }
    measure();
    var obs = new MutationObserver(measure);
    obs.observe(document.body, { childList: true });
    window.addEventListener('resize', measure);
    // el banner entra con animación: remedimos un par de veces
    setTimeout(measure, 400);
    setTimeout(measure, 1200);
  }

  /* ── 6. Teaser ──────────────────────────────────────────────────────── */
  function scheduleTeaser() {
    if (ss(SS_TEASER) || ss(SS_OPENED)) return;
    setTimeout(function () {
      if (open || ss(SS_TEASER) || !el.root) return;
      ssSet(SS_TEASER, '1');
      var t = document.createElement('div');
      t.id = 'vaiTeaser';
      t.innerHTML = '<button id="vaiTeaserX" type="button" aria-label="' + esc(T.dismiss) + '">✕</button>' +
        esc(T.teaser);
      el.root.appendChild(t);
      requestAnimationFrame(function () { t.classList.add('is-on'); });
      t.addEventListener('click', function () { t.remove(); toggle(true, 'teaser'); });
      t.querySelector('#vaiTeaserX').addEventListener('click', function (e) { e.stopPropagation(); t.remove(); });
      track('chat_teaser_shown', {});
    }, TEASER_DELAY);
  }

  /* ── 7. Abrir / cerrar ──────────────────────────────────────────────── */
  function toggle(force, source, demoKey) {
    open = typeof force === 'boolean' ? force : !open;

    // Cambiar de demo reinicia la conversación (el system prompt del worker cambia)
    if (open && typeof demoKey === 'string' && demoKey !== demo) {
      demo = demoKey;
      started = false; sent = 0; history = []; conversationId = ''; humanVerified = false;
      el.msgs.innerHTML = '';
      saveState();
    }

    el.win.classList.toggle('is-open', open);
    // El sondeo vive con el panel: al abrir con una conversación en manos de una persona se
    // recupera lo que hayan escrito mientras estaba cerrado; al cerrar, se para.
    if (open && liveState !== 'bot') { startLive(); pollOnce(); } else if (!open) { stopLive(); }
    el.iconChat.style.display = open ? 'none' : 'block';
    el.iconClose.style.display = open ? 'block' : 'none';
    el.bubble.setAttribute('aria-label', (open ? T.close : T.open) + botName());
    var teaser = document.getElementById('vaiTeaser');
    if (open && teaser) teaser.remove();

    if (open && !started) {
      started = true;
      ssSet(SS_OPENED, '1');
      track('chat_open', { source: source || 'bubble', page: location.pathname, demo: demo || 'none' });
      if (history.length) {
        // conversación restaurada de otra página: repintar sin saludo demorado
        // (con la marca cargada: el saludo del tenant, no el de Velai)
        withBrand(function () {
          renderHistory();
          if (!sent) renderChips();
          if (liveState !== 'bot') applyLive(liveState);
        });
      } else {
        setTimeout(function () {
          withBrand(function () {
            addMsg('bot', script().greeting);
            renderChips();
          });
        }, 500);
      }
    }
    saveState(); // persistir abierto/cerrado entre páginas
    if (open && window.innerWidth > 480) setTimeout(function () { el.input.focus(); }, 620);
  }

  function renderChips() {
    el.chips.innerHTML = '';
    script().chips.forEach(function (txt) {
      var b = document.createElement('button');
      b.className = 'vai-chip';
      b.type = 'button';
      b.textContent = txt;
      b.addEventListener('click', function () { send(txt, 'chip'); });
      el.chips.appendChild(b);
    });
    el.chips.classList.remove('is-off');
  }

  /* ── 8. Mensajes ────────────────────────────────────────────────────── */
  function addMsg(role, text, t) {
    // 'agent' (v9) es una PERSONA del equipo: burbuja propia y con nombre. Disfrazarla de
    // bot sería mentirle al visitante sobre con quién está hablando.
    var kind = role === 'bot' ? 'is-bot' : (role === 'agent' ? 'is-agent' : 'is-user');
    var d = t ? new Date(t) : new Date();
    var time = d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    var row = document.createElement('div');
    row.className = 'vai-row ' + kind;
    row.innerHTML = '<div class="vai-b ' + kind + '">' +
      (role === 'agent' ? '<div class="vai-b-who">' + esc(T.agentLabel) + '</div>' : '') +
      '<div class="vai-b-t">' + esc(text) + '</div>' +
      '<div class="vai-b-h">' + time + '</div></div>';
    el.msgs.appendChild(row);
    el.msgs.scrollTop = el.msgs.scrollHeight;
  }

  /* ── Parte viva (v9): recoger lo que escribe una persona desde el panel ──────
     Solo se pregunta cuando la conversación NO la lleva el bot. Con la IA
     atendiendo no hay ni una petición: es lo que hace que esto sea sostenible. */
  function liveNote(text) {
    var old = document.getElementById('vaiLive');
    if (old) old.remove();
    if (!text) return;
    var n = document.createElement('div');
    n.id = 'vaiLive'; n.className = 'vai-live'; n.textContent = text;
    el.msgs.appendChild(n);
    el.msgs.scrollTop = el.msgs.scrollHeight;
  }
  function applyLive(state) {
    liveState = state || 'bot';
    liveNote(liveState === 'esperando' ? T.liveWaiting : (liveState === 'humano' ? T.liveHuman : ''));
    if (liveState === 'bot') stopLive(); else startLive();
    saveState();
  }
  async function pollOnce() {
    if (!conversationId) return;
    try {
      var qs = '?conversationId=' + encodeURIComponent(conversationId) + '&after=' + lastId +
        (TENANT ? '&tenant=' + encodeURIComponent(TENANT) : '');
      var res = await fetch(WORKER + '/chat/poll' + qs);
      if (!res.ok) return;
      var data = await res.json();
      for (var i = 0; i < (data.messages || []).length; i++) {
        var m = data.messages[i];
        if (m.id > lastId) lastId = m.id;
        // Solo se pinta lo que viene de una PERSONA: las respuestas del bot ya las pintó
        // quien las pidió, y repetirlas duplicaría la conversación en pantalla.
        if (m.role !== 'agent') continue;
        history.push({ role: 'agent', content: m.text, t: Date.parse(m.at) || Date.now() });
        addMsg('agent', m.text, m.at);
      }
      if (data.state !== liveState) applyLive(data.state);
      else saveState();
    } catch (e) { /* un sondeo fallido no rompe nada: se reintenta al siguiente */ }
  }
  function startLive() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      // Solo con el panel abierto y la pestaña a la vista: sondear una pestaña de fondo es
      // gastar peticiones para nadie.
      if (open && document.visibilityState === 'visible') pollOnce();
    }, 6000);
  }
  function stopLive() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  async function send(preset, source) {
    if (busy) return;
    var text = (preset || el.input.value).trim();
    if (!text) return;
    if (!preset) { el.input.value = ''; el.input.style.height = 'auto'; }
    el.chips.classList.add('is-off');

    addMsg('user', text);
    history.push({ role: 'user', content: text, t: Date.now() });
    sent++;
    saveState();
    if (sent === 1) track('chat_first_message', { source: source || 'input', page: location.pathname, demo: demo || 'none' });
    track('chat_message', { n: sent, demo: demo || 'none' });

    busy = true;
    el.typing.classList.add('is-on');
    el.msgs.scrollTop = el.msgs.scrollHeight;

    try {
      if (!conversationId) { conversationId = uuid(); saveState(); }
      var data;
      try {
        data = await postChat(text);
      } catch (err) {
        // El servidor perdió el estado (KV caducado) y vuelve a exigir verificación:
        // reintentar UNA vez con token fresco en vez de dejar la sesión rota.
        if (err && err.status === 403 && humanVerified) {
          humanVerified = false; saveState();
          data = await postChat(text);
        } else { throw err; }
      }
      humanVerified = true;
      if (typeof data.lastId === 'number' && data.lastId > lastId) lastId = data.lastId;
      el.typing.classList.remove('is-on');
      // Sin reply el bot no ha hablado (lo lleva una persona): no se pinta una burbuja
      // vacía, se enseña el estado y el sondeo trae lo que escriba el equipo.
      if (data.reply) {
        history.push({ role: 'assistant', content: data.reply, t: Date.now() });
        addMsg('bot', data.reply);
        track('chat_reply', { n: sent });
      }
      applyLive(data.state);
    } catch (err) {
      // Nunca dejar humanVerified bloqueado en true tras un fallo: el próximo
      // intento pide token nuevo y el usuario puede recuperarse solo.
      humanVerified = false;
      saveState();
      el.typing.classList.remove('is-on');
      // Si el fallo es de la verificación humana (script de Turnstile bloqueado/red),
      // recargar la página sí lo arregla — decírselo al usuario. El WhatsApp de los
      // mensajes de error es el DEL TENANT (marca), nunca el de Velai en la web de un cliente.
      var code = String(err && (err.code || err.message) || err);
      addMsg('bot', (/turnstile|human/i.test(code) ? T.errHuman : T.errGeneric) + waNumber());
      track('chat_error', { msg: code });
    } finally {
      busy = false;
    }
  }

  /* ── 8b. Verificación humana autosuficiente ─────────────────────────────
     En hirevai.com existe window.VELAI_HUMAN (funnel.js) y se usa tal cual:
     un solo widget de Turnstile por página. Fuera (webs de clientes, donde
     funnel.js NO debe cargarse: cookies/GA4/pixel son de Velai), el widget
     carga Turnstile y ejecuta el challenge él mismo — misma mecánica que
     funnel.js: render explícito, execution:'execute', cola serializada.    */
  var ownLoader = null;
  var ownWidget = null;
  var ownQueue = Promise.resolve();
  function humanToken(action) {
    if (window.VELAI_HUMAN) return window.VELAI_HUMAN.execute(action);
    var run = function () { return ownExecute(action); };
    ownQueue = ownQueue.then(run, run);
    return ownQueue;
  }
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (ownLoader) return ownLoader;
    ownLoader = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true; script.defer = true;
      script.onload = resolve;
      script.onerror = function () {
        ownLoader = null;   // no cachear el fallo: el siguiente intento reinserta el script
        script.remove();
        reject(new Error('turnstile_load_failed'));
      };
      document.head.appendChild(script);
    });
    return ownLoader;
  }
  function ownExecute(action) {
    var sitekey = window.VELAI_TURNSTILE_SITEKEY || '';
    // El marcador del repo cuenta como "sin configurar".
    if (/^REPLACE_WITH/.test(sitekey)) sitekey = '';
    if (!sitekey) {
      sitekey = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
        ? '1x00000000000000000000AA'   // test key oficial: siempre valida en local
        : SITEKEY_FALLBACK;            // sitekey pública de Velai: cero config en la web del cliente
    }
    return loadTurnstile().then(function () {
      return new Promise(function (resolve, reject) {
        var host = document.getElementById('vai-turnstile');
        if (!host) {
          host = document.createElement('div'); host.id = 'vai-turnstile';
          host.style.cssText = 'position:fixed;left:-9999px;bottom:0';
          document.body.appendChild(host);
        }
        if (ownWidget != null) window.turnstile.remove(ownWidget);
        var timer = setTimeout(function () { reject(new Error('turnstile_timeout')); }, 12000);
        // El modo invisible lo define el TIPO de widget creado en el dashboard de
        // Turnstile ('size' no admite 'invisible' en el API); execution:'execute'
        // difiere el challenge hasta este punto.
        ownWidget = window.turnstile.render(host, {
          sitekey: sitekey, execution: 'execute', action: action,
          callback: function (token) { clearTimeout(timer); resolve(token); },
          'error-callback': function () { clearTimeout(timer); reject(new Error('turnstile_failed')); },
          'expired-callback': function () { clearTimeout(timer); reject(new Error('turnstile_expired')); }
        });
        window.turnstile.execute(ownWidget);
      });
    });
  }

  async function postChat(text) {
    var payload = {
      conversationId: conversationId,
      message: text,
      pageUrl: location.href.slice(0, 500),
      // VELAI_getUTM es de funnel.js: en la web de un cliente no existe y el utm va
      // vacío — correcto, la medición de Velai no pinta nada fuera de hirevai.com.
      utm: (window.VELAI_getUTM && window.VELAI_getUTM()) || {}
    };
    // Canal web multi-tenant: la web de un cliente declara su slug antes de cargar el
    // widget. Sin esto el worker cae en DEFAULT_TENANT_SLUG y contesta como Velai.
    if (typeof window.VELAI_TENANT === 'string' && window.VELAI_TENANT) {
      payload.tenant = window.VELAI_TENANT.slice(0, 40);
    }
    if (demo) payload.demo = demo;
    // Declara que este widget SABE recibir respuestas de una persona. Sin esta bandera el
    // worker no cede el turno — así un widget v8 cacheado en la web de un cliente sigue
    // funcionando igual que siempre en vez de dejar al visitante hablando a una pared.
    payload.live = true;
    if (!humanVerified) {
      payload.turnstileToken = await humanToken('chat');
    }
    var res = await fetch(WORKER + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      var err = new Error('HTTP ' + res.status);
      err.status = res.status;
      try { err.code = (await res.json()).error; } catch (e) {}
      throw err;
    }
    var data = await res.json();
    if (!data.reply && data.content && data.content[0]) data.reply = data.content[0].text;
    // reply null es LEGÍTIMO desde v9: significa que la conversación la lleva una persona y
    // el bot calla. Solo es un error si además no hay estado que explique el silencio.
    if (!data.reply && !data.state) throw new Error('empty');
    return data;
  }

  /* ── 9. API pública ─────────────────────────────────────────────────── */
  window.VaiChat = {
    open: function (opts) {
      opts = opts || {};
      toggle(true, opts.source || 'api', typeof opts.demo === 'string' ? opts.demo : undefined);
    },
    close: function () { toggle(false); },
    send: function (text) { send(text, 'api'); },
    isOpen: function () { return open; },
    demo: function () { return demo; }
  };

  /* ── 10. Init ────────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
