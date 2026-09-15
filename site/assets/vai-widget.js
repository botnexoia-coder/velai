/* ══════════════════════════════════════════════════════════════════════════
   VAI CHAT WIDGET — autocontenido (CSS + markup + lógica) · v18
   ──────────────────────────────────────────────────────────────────────────
   OJO CON LA VERSIÓN: este archivo se sirve con Cache-Control immutable durante un
   año (_headers, /*.js), así que el `?v=N` de la URL ES la clave de caché. Cambiar el
   archivo SIN subir N deja un estado mixto: Pages purga edge y los visitantes nuevos
   reciben el nuevo; los recurrentes pueden conservar el anterior hasta un año.
   Toda modificación de este archivo sube N aquí Y en los HTML; `npm run check:site`
   falla si las dos no coinciden.

   Se carga en TODAS las páginas con una sola línea:
     <script src="/assets/vai-widget.js?v=18" defer></script>

   En la web de un CLIENTE van dos líneas (la primera declara el tenant):
     <script>window.VELAI_TENANT='zoe';</script>
     <script src="https://hirevai.com/assets/vai.js" defer></script>

   VENTANA (v16): panel lateral, bienvenida, cinco sugerencias y temas por tenant.
   Loader estable /assets/vai.js para las webs de clientes.

   LANZADOR DE MARCA (v15): retrato, acento y tarjeta de bienvenida por tenant.

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
    placeholder: 'Tell me what you need…',
    greeting: "Hi, I’m {bot}. How can I help you?",
    heroStatus: 'Online · instant replies',
    chips: ['How much does it cost?', 'Show me a demo', 'Will it work for my business?'],
    talk: 'Talk to ', closeConv: 'Close conversation', kicker: 'ASISTENTE IA · VELAI',
    teaserTitle: 'Does your business need more time?',
    teaserCopy: 'Tell me what you would like to automate and I can help you explore your options.',
    teaserTitleGen: 'How can I help?',
    teaserCopyGen: 'Tell me what you need and I can help you find the next step.',
    teaserCta: 'Start conversation',
    open: 'Open chat with ', close: 'Close chat with ', closeBtn: 'Close chat',
    chat: 'Chat with ', send: 'Send', msg: 'Message', dismiss: 'Dismiss',
    errHuman: "I couldn't verify you're human (an unstable network or a blocker can cause this). Reload the page and try again, or message us on WhatsApp: https://wa.me/",
    errGeneric: "Oops, I can't reply right now. Message us on WhatsApp and we'll answer in minutes: https://wa.me/",
    agentLabel: 'Team',
    liveWaiting: 'Waiting for someone from the team — stay on this window and their reply will appear here.',
    liveHuman: "You're now talking with someone from the team"
  } : {
    online: 'En línea ahora',
    placeholder: 'Cuéntame qué necesitas…',
    greeting: 'Hola, soy {bot}. ¿En qué puedo ayudarte?',
    heroStatus: 'En línea · respondo al momento',
    chips: ['¿Cuánto cuesta?', 'Enséñame una demo', '¿Sirve para mi negocio?'],
    talk: 'Hablar con ', closeConv: 'Cerrar conversación', kicker: 'ASISTENTE IA · VELAI',
    teaserTitle: '¿Tu negocio necesita más tiempo?',
    teaserCopy: 'Cuéntame qué tarea te gustaría automatizar y te ayudo a explorar las opciones.',
    teaserTitleGen: '¿En qué puedo ayudarte?',
    teaserCopyGen: 'Cuéntame qué necesitas y te ayudo a encontrar el siguiente paso.',
    teaserCta: 'Iniciar conversación',
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
  function waNumber() { return (BRAND && BRAND.wa_number) || window.VELAI_WA || '15706160059'; }
  function brandGreeting() {
    if (!BRAND) return T.greeting.replace('{bot}', botName());
    if (LANG === 'en') return BRAND.greeting_en || BRAND.greeting || T.greeting.replace('{bot}', botName());
    return BRAND.greeting || T.greeting.replace('{bot}', botName());
  }

  function portraitUrl() {
    if (BRAND && /^https:\/\/[^\s]+$/i.test(BRAND.portrait_url || '')) return BRAND.portrait_url;
    return !TENANT ? 'https://hirevai.com/assets/assistants/vai-v1.jpg' : '';
  }
  // Sin textos en la ficha, un tenant cae a copy GENÉRICO, nunca al de Velai:
  // el material comercial de hirevai.com solo aplica cuando no hay tenant.
  function teaserText() {
    return {
      title: (BRAND && ((LANG === 'en' && BRAND.teaser_title_en) || BRAND.teaser_title)) || (TENANT ? T.teaserTitleGen : T.teaserTitle),
      copy: (BRAND && ((LANG === 'en' && BRAND.teaser_copy_en) || BRAND.teaser_copy)) || (TENANT ? T.teaserCopyGen : T.teaserCopy)
    };
  }
  function renderPortrait(face, size) {
    face.textContent = botName().charAt(0).toUpperCase();
    var url = portraitUrl();
    if (url) {
      var img = document.createElement('img');
      img.alt = ''; img.width = size; img.height = size;
      img.onerror = function () { img.remove(); };
      img.src = url; face.appendChild(img);
    }
  }
  function renderFace() { renderPortrait(document.getElementById('vaiFace'), 46); }
  function renderWelcome() {
    document.getElementById('vaiGreeting').textContent = script().greeting;
    document.getElementById('vaiHeaderKicker').textContent = botName() + ' · ' + T.kicker;
  }
  function updateSend() { el.send.disabled = busy || !el.input.value.trim(); }

  function renderLauncher() {
    var title = open ? T.closeConv : T.talk + botName();
    document.getElementById('vaiLauncherTitle').textContent = title;
    el.bubble.setAttribute('aria-expanded', String(open));
    el.bubble.setAttribute('aria-label', title + ' · ' + T.kicker);
    el.iconClose.style.display = open ? 'block' : 'none';
  }

  /* ── 1. CSS ─────────────────────────────────────────────────────────────
     z-index 10000: el banner de consentimiento de funnel.js usa 9999 y se
     inserta después en el DOM, así que con z-index empatado ganaba él y
     tapaba el botón en móvil. Además desplazamos el FAB hacia arriba
     mientras el banner esté visible (--vai-lift).
     Colores en variables CSS sobre #vaiWidget: la marca del tenant se aplica
     por CSSOM (setProperty), nunca con style="" (lección de la CSP del panel).
     Defaults = la marca de Velai de siempre; .vai-dark = tema oscuro.       */
  var CSS = "#vaiWidget{position:fixed;bottom:calc(24px + var(--vai-lift,0px));right:24px;z-index:10000;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Satoshi,system-ui,sans-serif;transition:bottom .25s ease;--vai-l1:#b83e08;--vai-l2:#662a16;--vai-acc:#ff914f;--vai-agentac:#5b3fa8;--vai-srf:#f7f4ef;--vai-bot:#fff;--vai-text:#172033;--vai-muted:#5b6472;--vai-line:rgba(0,0,0,.08);--vai-in:#ece8e1}" +
    "#vaiWidget.vai-dark{--vai-srf:linear-gradient(145deg,#202736,#111722);--vai-bot:#1b2230;--vai-text:#fff;--vai-muted:#ced7e5;--vai-line:rgba(255,255,255,.08);--vai-in:#182030}" +
    "@media(prefers-color-scheme:dark){#vaiWidget:not(.vai-light){--vai-srf:linear-gradient(145deg,#202736,#111722);--vai-bot:#1b2230;--vai-text:#fff;--vai-muted:#ced7e5;--vai-line:rgba(255,255,255,.08);--vai-in:#182030}}" +
    '#vaiBubble{box-sizing:border-box;display:flex;position:relative;align-items:center;cursor:pointer;transition:transform .2s;width:auto;min-width:190px;max-width:calc(100vw - 48px);height:64px;padding:6px 17px 6px 7px;gap:10px;border:2px solid var(--vai-acc);border-radius:40px;background:linear-gradient(135deg,var(--vai-l1),var(--vai-l2));color:#fff;font-family:inherit;text-align:left;box-shadow:0 8px 28px #0003;isolation:isolate}' +
    '#vaiBubble::before{content:"";position:absolute;inset:0;border-radius:inherit;background:#0003;z-index:-1}' +
    '#vaiBubble:hover{transform:translateY(-2px)}' +
    '#vaiBubble:focus-visible,.vai-teaser-cta:focus-visible,#vaiTeaserX:focus-visible{outline:3px solid var(--vai-acc);outline-offset:4px}' +
    '.vai-face{position:relative;display:grid;place-items:center;width:46px;height:46px;flex:none;border-radius:50%;background:#fff;color:#172033;font-weight:800;font-size:21px}' +
    '.vai-face img{position:absolute;inset:0;display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;object-position:50% 25%}' +
    '.vai-face::after{content:"";position:absolute;right:-2px;bottom:0;width:12px;height:10px;border:2px solid #fff;border-radius:5px 5px 5px 0;background:var(--vai-acc)}' +
    '.vai-label{display:block;min-width:0;font-size:13px;font-weight:750;line-height:1.3}' +
    '.vai-label>span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.vai-label small{display:block;margin-top:3px;color:#fff;font-size:10px;font-weight:750;letter-spacing:.055em;white-space:nowrap}' +
    '#vaiBubble[aria-expanded="true"] .vai-face{display:none}' +
    '#vaiBubble[aria-expanded="true"] #vaiIconClose{flex:none;margin:0 9px}' +
    '#vaiTeaser{box-sizing:border-box;bottom:78px;width:min(312px,calc(100vw - 48px));padding:18px 42px 18px 20px;border:1px solid var(--vai-acc);border-radius:22px 22px 5px 22px;background:linear-gradient(145deg,#202736,#111722);color:#fff;box-shadow:0 16px 40px #0004;text-align:left;line-height:1.4;overflow:hidden}' +
    '#vaiTeaser::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:linear-gradient(var(--vai-acc),var(--vai-l1))}' +
    '#vaiTeaserX{top:6px;right:6px;width:32px;height:32px;color:#dbe3ef;border-radius:50%;font-size:18px}' +
    '.vai-teaser-kicker{display:block;margin-bottom:8px;color:#e2e8f2;font-size:10px;font-weight:750;letter-spacing:.06em}' +
    '.vai-teaser-title{display:block;font-size:18px;line-height:1.25;font-weight:800;color:#fff}' +
    '.vai-teaser-copy{display:block;margin-top:6px;color:#ced7e5;font-size:13px;line-height:1.5}' +
    '.vai-teaser-cta{display:inline-block;margin-top:12px;padding:0;border:0;background:none;color:#fff;font:inherit;font-size:13px;font-weight:750;text-decoration:underline;text-underline-offset:4px;cursor:pointer;text-align:left}' +
    '@media(max-width:767px){#vaiBubble{min-width:0;max-width:calc(100vw - 32px);height:58px;padding:5px 12px 5px 6px;gap:8px}.vai-face{width:42px;height:42px}.vai-label{font-size:12px}.vai-label small{font-size:9px;letter-spacing:.025em}#vaiTeaser{display:none!important;visibility:hidden!important;pointer-events:none!important}}' +
    '@media(prefers-reduced-motion:reduce){#vaiWidget,#vaiBubble,#vaiTeaser{transition:none!important;animation:none!important}#vaiBubble:hover{transform:none}}' +
    '@keyframes vaiDot{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-5px);opacity:1}}' +
    /* teaser */
    '#vaiTeaser{position:absolute;right:0;max-height:max(0px,calc(100dvh - 114px - var(--vai-lift,0px)));overflow-y:auto;opacity:0;transform:translateY(8px);transition:opacity .3s,transform .3s}' +
    '#vaiTeaser.is-on{opacity:1;transform:translateY(0)}' +
    '#vaiTeaserX{position:absolute;background:none;border:none;cursor:pointer}' +
    "#vaiWindow{box-sizing:border-box;display:none;position:fixed;top:16px;right:16px;bottom:calc(16px + var(--vai-lift,0px));width:min(400px,calc(100vw - 32px));height:auto;border:1px solid var(--vai-acc);border-radius:22px;overflow:hidden;box-shadow:0 20px 60px #0003;flex-direction:column;background:var(--vai-srf);color:var(--vai-text)}" +
    "#vaiWindow.is-open{display:flex}" +
    "@media(min-width:768px){#vaiWidget.is-open #vaiBubble{display:none}}" +
    ".vai-h{box-sizing:border-box;display:flex;align-items:center;gap:10px;min-height:52px;padding:4px 14px;border-bottom:1px solid var(--vai-line);flex-shrink:0}" +
    ".vai-h-av,.vai-hero-av{position:relative;display:grid;place-items:center;flex:none;border-radius:50%;background:var(--vai-l1);color:#fff;font-weight:800}" +
    ".vai-h-av{width:32px;height:32px;font-size:16px}" +
    ".vai-h-av img,.vai-hero-av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 25%;border-radius:50%}" +
    ".vai-h-av::after,.vai-hero-av::after{content:\"\";position:absolute;bottom:0;right:0;width:8px;height:8px;border:2px solid var(--vai-bot);border-radius:50%;background:var(--vai-acc)}" +
    ".vai-h-id{flex:1;min-width:0}.vai-h-name{font-size:14px;font-weight:750}.vai-h-st{font-size:10px;color:var(--vai-muted);letter-spacing:.05em}" +
    ".vai-h-kicker{display:none;flex:1;font-size:10px;font-weight:750;letter-spacing:.05em;color:var(--vai-muted)}" +
    ".vai-h-x{display:grid;place-items:center;width:44px;height:44px;flex:none;border:0;background:none;color:var(--vai-muted);font-size:22px;cursor:pointer;border-radius:50%}" +
    ".vai-h-x:focus-visible,.vai-chip:focus-visible,#vaiSend:focus-visible{outline:2px solid var(--vai-acc);outline-offset:-3px}" +
    "#vaiWindow.is-empty .vai-h-av,#vaiWindow.is-empty .vai-h-id{display:none}#vaiWindow.is-empty .vai-h-kicker{display:block}" +
    ".vai-hero{display:none;flex:1;min-height:0;overflow-y:auto;flex-direction:column;align-items:center;justify-content:safe center;text-align:center;padding:24px;gap:16px}" +
    "#vaiWindow.is-empty .vai-hero{display:flex}#vaiWindow.is-empty #vaiMessages{display:none}" +
    ".vai-hero-av{width:84px;height:84px;font-size:34px;border:2px solid var(--vai-acc);box-shadow:0 0 0 6px color-mix(in srgb,var(--vai-acc) 12%,transparent)}" +
    ".vai-hero-av::after{width:12px;height:12px}" +
    ".vai-hero h2{margin:0;font-size:22px;font-weight:800;line-height:1.3;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--vai-text)}" +
    ".vai-hero p{margin:0;color:var(--vai-muted);font-size:13px;line-height:1.5}" +
    "#vaiMessages{flex:1;min-height:0;overflow-y:auto;padding:20px 16px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}" +
    "#vaiMessages>:first-child{margin-top:auto}" +
    ".vai-row{display:flex;flex-shrink:0}.vai-row.is-user{justify-content:flex-end}" +
    ".vai-b{max-width:85%;padding:10px 12px 6px;background:var(--vai-bot);border-radius:4px 16px 16px 16px;color:var(--vai-text)}" +
    ".vai-b.is-user{background:linear-gradient(135deg,var(--vai-l1),var(--vai-l2));color:#fff;border-radius:16px 4px 16px 16px}" +
    ".vai-b.is-agent{border-left:3px solid var(--vai-agentac)}" +
    ".vai-b-who{font-size:11px;font-weight:750;color:var(--vai-agentac);margin-bottom:4px}" +
    ".vai-b-t{font-size:14px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}" +
    ".vai-b-h{font-size:11px;opacity:.6;text-align:right;margin-top:4px}" +
    ".vai-live{text-align:center;font-size:12px;color:var(--vai-muted);padding:6px 0;flex-shrink:0}" +
    "#vaiTyping{display:none;padding:0 16px 10px}#vaiTyping.is-on{display:block}" +
    ".vai-tb{display:inline-flex;gap:4px;align-items:center;padding:12px;background:var(--vai-bot);border-radius:4px 16px 16px 16px}" +
    ".vai-td{width:7px;height:7px;background:var(--vai-muted);border-radius:50%;animation:vaiDot 1.2s infinite}.vai-td:nth-child(2){animation-delay:.2s}.vai-td:nth-child(3){animation-delay:.4s}" +
    "#vaiChips{flex-shrink:0;padding:0 20px 12px;display:flex;flex-direction:column}#vaiChips.is-off{display:none}" +
    ".vai-chip{display:flex;align-items:center;gap:12px;min-height:48px;padding:10px 0;border:0;border-top:1px solid var(--vai-line);background:none;color:var(--vai-text);font:inherit;font-size:14px;font-weight:600;line-height:1.4;text-align:left;cursor:pointer}" +
    ".vai-chip svg{flex:none;color:var(--vai-acc)}.vai-chip:hover{color:var(--vai-acc)}" +
    ".vai-in-wrap{display:flex;align-items:flex-end;gap:8px;flex-shrink:0;padding:14px 16px;border-top:1px solid var(--vai-line)}" +
    ".vai-in-shell{box-sizing:border-box;min-height:44px;flex:1;display:flex;align-items:center;background:var(--vai-in);border-radius:22px;padding:10px 16px;min-width:0}" +
    "#vaiInput{width:100%;min-width:0;padding:0;border:0;outline:none;resize:none;max-height:80px;background:transparent;color:var(--vai-text);font:inherit;font-size:15px;line-height:24px}" +
    "#vaiInput::placeholder{color:var(--vai-muted);opacity:.8}.vai-in-shell:focus-within{outline:2px solid var(--vai-acc)}" +
    "#vaiSend{display:grid;place-items:center;width:44px;height:44px;flex:none;border:0;border-radius:50%;background:var(--vai-in);color:var(--vai-muted);cursor:default}" +
    "#vaiSend:not(:disabled){background:var(--vai-acc);color:#172033;cursor:pointer}" +
    "@media(max-width:767px){#vaiWindow{top:auto;left:0;right:0;bottom:calc(96px + var(--vai-lift,0px));width:100%;height:max(0px,calc(100dvh - 108px - var(--vai-lift,0px)));border-radius:16px 16px 0 0}.vai-chip{min-height:52px}.vai-hero{padding:16px;gap:12px}}" +
    "@media(prefers-reduced-motion:reduce){.vai-td{animation:none}#vaiMessages{scroll-behavior:auto}}";

  /* ── 2. Markup ──────────────────────────────────────────────────────── */
  var HTML = '' +
    '<button id="vaiBubble" type="button" aria-controls="vaiWindow" aria-haspopup="dialog" aria-expanded="false">' +
      '<span class="vai-face" id="vaiFace" aria-hidden="true"></span>' +
      '<span class="vai-label" aria-hidden="true"><span id="vaiLauncherTitle"></span><small>' + esc(T.kicker) + '</small></span>' +
      '<svg id="vaiIconClose" width="24" height="24" viewBox="0 0 24 24" fill="white" style="display:none" aria-hidden="true">' +
        '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
    '</button>' +
    '<div id="vaiWindow" class="is-empty" role="dialog" aria-label="' + esc(T.chat + 'Vai') + '">' +
      '<div class="vai-h"><div class="vai-h-av" id="vaiAvatar" aria-hidden="true"></div>' +
        '<div class="vai-h-id"><div class="vai-h-name" id="vaiName">Vai</div><div class="vai-h-st">' + esc(T.kicker) + '</div></div>' +
        '<span class="vai-h-kicker" id="vaiHeaderKicker"></span>' +
        '<button class="vai-h-x" type="button" aria-label="' + esc(T.closeBtn) + '">✕</button></div>' +
      '<div class="vai-hero"><div class="vai-hero-av" id="vaiHeroAvatar" aria-hidden="true"></div><h2 id="vaiGreeting"></h2><p>' + esc(T.heroStatus) + '</p></div>' +
      '<div id="vaiMessages" role="log" aria-live="polite"></div>' +
      '<div id="vaiTyping"><div class="vai-tb"><span class="vai-td"></span><span class="vai-td"></span><span class="vai-td"></span></div></div>' +
      '<div id="vaiChips"></div><div class="vai-in-wrap"><div class="vai-in-shell">' +
        '<textarea id="vaiInput" placeholder="' + esc(T.placeholder) + '" rows="1" maxlength="2000" aria-label="' + esc(T.msg) + '"></textarea></div>' +
        '<button id="vaiSend" type="button" disabled aria-label="' + esc(T.send) + '"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button>' +
      '</div></div>';

  /* Pinta la marca del tenant en el DOM y las variables CSS por CSSOM.
     Idempotente: se llama al llegar el boot y también al montar (por si el
     fetch resolvió antes que el DOMContentLoaded). */
  function applyBrand() {
    if (!el.root) return;
    var b = BRAND || {};
    if (b.brand_color) {
      el.root.style.setProperty('--vai-l1', b.brand_color);
      el.root.style.setProperty('--vai-l2', b.brand_color_2 || b.brand_color);
    }
    el.root.style.setProperty('--vai-acc', b.accent_color || (TENANT || b.brand_color ? 'color-mix(in srgb,var(--vai-l1) 55%,#fff)' : '#ff914f'));
    var ac = b.agent_color || b.brand_color;
    if (ac) el.root.style.setProperty('--vai-agentac', ac);
    var theme = TENANT ? b.theme : 'dark';
    el.root.classList.toggle('vai-dark', theme === 'dark');
    el.root.classList.toggle('vai-light', theme === 'light');
    renderFace();
    renderPortrait(document.getElementById('vaiAvatar'), 32);
    renderPortrait(document.getElementById('vaiHeroAvatar'), 84);
    document.getElementById('vaiName').textContent = botName();
    renderWelcome();
    if (b.placeholder) el.input.placeholder = b.placeholder;
    el.win.setAttribute('aria-label', T.chat + botName());
    renderLauncher();
  }

  /* ── 3. Guiones de apertura ─────────────────────────────────────────── */
  // El saludo y los chips por defecto salen de la marca del tenant (boot);
  // sin marca, los de Velai en el idioma de la página.
  function defaultScript() {
    return { greeting: brandGreeting(), chips: (BRAND && BRAND.chips) || (TENANT ? [] : T.chips) };
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
      addMsg(m.role === 'assistant' ? 'bot' : (m.role === 'agent' ? 'agent' : 'user'), m.content, m.t, m.agent_name, m.booking);
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
    el.iconClose = root.querySelector('#vaiIconClose');
    el.send = root.querySelector('#vaiSend');

    el.bubble.addEventListener('click', function () { toggle(); });
    root.querySelector('.vai-h-x').addEventListener('click', function (e) { e.stopPropagation(); toggle(false); });
    root.querySelector('#vaiSend').addEventListener('click', function () { send(); });
    el.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    el.input.addEventListener('input', function () {
      updateSend();
      el.input.style.height = 'auto';
      el.input.style.height = Math.min(el.input.scrollHeight, 80) + 'px';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) toggle(false);
    });

    renderFace();
    renderLauncher();
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
    var consentNodes = [];
    var consentFrame = 0;
    var consentResize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleConsentMeasure) : null;
    function measureConsent() {
      consentFrame = 0;
      var root = document.getElementById('vaiWidget');
      var bubble = document.getElementById('vaiBubble');
      if (!root || !bubble) return;
      var bubbleRect = (open && window.innerWidth >= 768 ? el.win : bubble).getBoundingClientRect();
      var viewportHeight = window.innerHeight;
      var lift = 0;
      consentNodes.forEach(function (banner) {
        if (!banner.isConnected || (banner.id === 'velai-consent' && window.innerWidth >= 900)) return;
        var computed = window.getComputedStyle(banner);
        var rect = banner.getBoundingClientRect();
        if (banner.hidden || computed.display === 'none' || computed.visibility === 'hidden' || Number(computed.opacity) === 0 || rect.width <= 0 || rect.height <= 0) return;
        if (rect.bottom <= 0 || rect.top >= viewportHeight || rect.right <= bubbleRect.left || rect.left >= bubbleRect.right) return;
        // Anchor from the viewport, not the already-lifted bubble's vertical
        // position, so observing a banner cannot cause lift/reset oscillation.
        lift = Math.max(lift, viewportHeight - Math.max(0, rect.top) + 12 - 24);
      });
      var value = Math.ceil(Math.max(0, lift)) + 'px';
      if (root.style.getPropertyValue('--vai-lift') !== value) root.style.setProperty('--vai-lift', value);
    }
    function scheduleConsentMeasure() {
      if (!consentFrame) consentFrame = requestAnimationFrame(measureConsent);
    }
    function discoverConsent() {
      ['velai-consent', 'cookieBanner', 'ckb'].forEach(function (id) {
        var banner = document.getElementById(id);
        if (!banner || consentNodes.indexOf(banner) !== -1) return;
        consentNodes.push(banner);
        var observer = new MutationObserver(scheduleConsentMeasure);
        observer.observe(banner, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
        if (consentResize) consentResize.observe(banner);
        banner.addEventListener('transitionend', scheduleConsentMeasure);
        banner.addEventListener('animationend', scheduleConsentMeasure);
        scheduleConsentMeasure();
      });
      if (consentNodes.some(function (banner) { return !banner.isConnected; })) scheduleConsentMeasure();
    }
    // Child-list discovery only: never observe the widget's own style mutations.
    var consentMount = new MutationObserver(discoverConsent);
    consentMount.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleConsentMeasure);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleConsentMeasure);
    discoverConsent();

  }

  /* ── 6. Teaser ──────────────────────────────────────────────────────── */
  function scheduleTeaser() {
    if (window.innerWidth < 768 || ss(SS_TEASER) || ss(SS_OPENED)) return;
    setTimeout(function () { withBrand(function () {
      if (window.innerWidth < 768 || open || ss(SS_OPENED) || ss(SS_TEASER) || !el.root) return;
      ssSet(SS_TEASER, '1');
      var t = document.createElement('div');
      t.id = 'vaiTeaser';
      t.innerHTML = '<button id="vaiTeaserX" type="button" aria-label="' + esc(T.dismiss) + '">✕</button>' +
        '<span class="vai-teaser-kicker">' + esc(botName() + ' · ' + T.kicker) + '</span>' +
        '<strong class="vai-teaser-title">' + esc(teaserText().title) + '</strong>' +
        '<span class="vai-teaser-copy">' + esc(teaserText().copy) + '</span>' +
        '<button type="button" class="vai-teaser-cta">' + esc(T.teaserCta) + ' →</button>';
      el.root.appendChild(t);
      requestAnimationFrame(function () { t.classList.add('is-on'); });
      t.addEventListener('click', function () { t.remove(); toggle(true, 'teaser'); });
      t.querySelector('#vaiTeaserX').addEventListener('click', function (e) { e.stopPropagation(); t.remove(); });
      track('chat_teaser_shown', {});
    }); }, TEASER_DELAY);
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
    el.root.classList.toggle('is-open', open);
    el.win.classList.toggle('is-empty', !history.length);
    // El sondeo vive con el panel: al abrir con una conversación en manos de una persona se
    // recupera lo que hayan escrito mientras estaba cerrado; al cerrar, se para.
    if (open && liveState !== 'bot') { startLive(); pollOnce(); } else if (!open) { stopLive(); }
    renderLauncher();
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
        withBrand(function () {
          if (!history.length) { renderWelcome(); renderChips(); }
        });
      }
    }
    saveState(); // persistir abierto/cerrado entre páginas
    if (!open) el.bubble.focus();
    else if (window.innerWidth >= 768) setTimeout(function () { if (open) el.input.focus(); }, 620);
  }

  function renderChips() {
    el.chips.innerHTML = '';
    script().chips.slice(0, 5).forEach(function (txt) {
      var b = document.createElement('button');
      b.className = 'vai-chip';
      b.type = 'button';
      b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg><span>' + esc(txt) + '</span>';
      b.addEventListener('click', function () { send(txt, 'chip'); });
      el.chips.appendChild(b);
    });
    el.chips.classList.remove('is-off');
  }

  /* ── 8. Mensajes ────────────────────────────────────────────────────── */
  function addMsg(role, text, t, agentName, booking) {
    el.win.classList.remove('is-empty');
    // 'agent' (v9) es una PERSONA del equipo: burbuja propia y con nombre. Disfrazarla de
    // bot sería mentirle al visitante sobre con quién está hablando.
    var kind = role === 'bot' ? 'is-bot' : (role === 'agent' ? 'is-agent' : 'is-user');
    var d = t ? new Date(t) : new Date();
    var time = d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    var row = document.createElement('div');
    row.className = 'vai-row ' + kind;
    row.innerHTML = '<div class="vai-b ' + kind + '">' +
      (role === 'agent' ? '<div class="vai-b-who">' + esc((agentName ? String(agentName).slice(0, 60) + ' · ' : '') + T.agentLabel + ' ' + ((BRAND && BRAND.brand_name) || 'Velai')) + '</div>' : '') +
      '<div class="vai-b-t">' + esc(text) + '</div>' +
      '<div class="vai-b-h">' + time + '</div></div>';
    if (role === 'bot' && booking && booking.type === 'booking') {
      try {
        var target = new URL(booking.url);
        var expectedTenant = TENANT || 'velai';
        if (['https://citas.hirevai.com', 'https://citas-staging.hirevai.com'].indexOf(target.origin) !== -1 && target.pathname === '/' + expectedTenant + '/reservas' && !target.username && !target.password && !target.hash) {
          var card = document.createElement('a'); card.href = target.href; card.target = '_blank'; card.rel = 'noopener noreferrer';
          card.textContent = LANG === 'en' ? 'Open booking calendar →' : 'Ver calendario de reservas →';
          card.style.display = 'block'; card.style.padding = '12px 0'; row.querySelector('.vai-b-t').appendChild(card);
        }
      } catch (_) {}
    }
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
    var antes = liveState;
    liveState = state || 'bot';
    liveNote(liveState === 'esperando' ? T.liveWaiting : (liveState === 'humano' ? T.liveHuman : ''));
    if (liveState === 'bot') {
      stopLive();
      // Un último sondeo al volver a 'bot': el servidor ya guarda el mensaje ANTES de cambiar
      // el estado, pero dejar de preguntar en el mismo instante en que algo cambia es
      // precisamente cómo se perdió el aviso de los 15 minutos. Cuesta una petición.
      if (antes && antes !== 'bot') setTimeout(pollOnce, 2500);
    } else { startLive(); }
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
        // Se pinta TODO lo que no haya visto ya, no solo lo de una persona. Al principio
        // filtraba por role==='agent' razonando que «las respuestas del bot ya las pintó
        // quien las pidió» — cierto para las síncronas, pero FALSO para las que manda el
        // servidor por su cuenta: los avisos de la cola de espera son 'assistant', y el
        // widget avanzaba el cursor por encima de ellos sin pintarlos nunca.
        // El cursor `lastId` es lo que evita duplicados, no el rol.
        var kind = m.role === 'agent' ? 'agent' : 'bot';
        history.push({ role: m.role === 'agent' ? 'agent' : 'assistant', content: m.text, t: Date.parse(m.at) || Date.now(), agent_name: m.role === 'agent' ? m.agent_name : null });
        addMsg(kind, m.text, m.at, m.agent_name);
      }
      if (data.state !== liveState) applyLive(data.state);
      else saveState();
    } catch (e) { /* un sondeo fallido no rompe nada: se reintenta al siguiente */ }
  }
  var pollEvery = 0;
  function startLive() {
    // 5 s con una persona al otro lado (ahí se nota el retardo) y 10 s mientras solo se
    // espera en cola, donde nadie está escribiendo todavía. A 15 clientes la diferencia son
    // miles de peticiones al día.
    var want = liveState === 'humano' ? 5000 : 10000;
    if (pollTimer && want === pollEvery) return;
    stopLive();
    pollEvery = want;
    pollTimer = setInterval(function () {
      // Solo con el panel abierto y la pestaña a la vista: sondear una pestaña de fondo es
      // gastar peticiones para nadie.
      if (open && document.visibilityState === 'visible') pollOnce();
    }, want);
  }
  function stopLive() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; pollEvery = 0; } }

  async function send(preset, source) {
    if (busy) return;
    var text = (preset || el.input.value).trim();
    if (!text) return;
    busy = true;
    updateSend();
    await new Promise(function (resolve) { withBrand(resolve); });
    if (!history.length) addMsg('bot', script().greeting);
    if (!preset) { el.input.value = ''; el.input.style.height = 'auto'; }
    el.chips.classList.add('is-off');

    addMsg('user', text);
    history.push({ role: 'user', content: text, t: Date.now() });
    sent++;
    saveState();
    if (sent === 1) track('chat_first_message', { source: source || 'input', page: location.pathname, demo: demo || 'none' });
    track('chat_message', { n: sent, demo: demo || 'none' });

    updateSend();
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
        history.push({ role: 'assistant', content: data.reply, t: Date.now(), booking: data.booking || null });
        addMsg('bot', data.reply, null, null, data.booking);
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
      updateSend();
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
