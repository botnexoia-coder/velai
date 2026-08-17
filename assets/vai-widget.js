/* ══════════════════════════════════════════════════════════════════════════
   VAI CHAT WIDGET — autocontenido (CSS + markup + lógica)
   ──────────────────────────────────────────────────────────────────────────
   Se carga en TODAS las páginas con una sola línea:
     <script src="/assets/vai-widget.js?v=2" defer></script>

   Autocontenido a propósito: solo index.html carga /assets/styles.css, el
   resto de páginas llevan CSS inline. Por eso este archivo inyecta su propio
   CSS y no depende de styles.css ni de variables CSS del tema.

   Config opcional (antes de cargar este script):
     window.VELAI_WORKER = 'https://vai-worker.botnexo-ia.workers.dev';
     window.VELAI_CHAT   = { teaserDelay: 18000, disabled: false };

   MODO DEMO (rol-play). El worker YA lo soporta en el chat web
   (`vai-worker.js:299` → `if (body.demo && DEMOS[body.demo])`), pero hasta
   ahora ninguna página enviaba el campo. Tres formas de activarlo:
     1. Query string:  /restaurantes/?chat=1&demo=restaurante
     2. Atributo HTML: <button data-vai-demo="clinica">Prueba la demo</button>
     3. API pública:   window.VaiChat.open({ demo: 'taller' })
   Por defecto está DESACTIVADO: el FAB abre a Vai normal (comercial de Velai).

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

  var WORKER = (window.VELAI_WORKER || 'https://vai-worker.botnexo-ia.workers.dev').replace(/\/$/, '');
  var TEASER_DELAY = typeof CFG.teaserDelay === 'number' ? CFG.teaserDelay : 18000;
  var SS_TEASER = 'velai-chat-teaser';
  var SS_OPENED = 'velai-chat-opened';
  var SS_STATE = 'velai-chat-state'; // conversación persistida entre páginas (muere al cerrar la pestaña)

  var ORANGE = '#FF6B1A';

  function track(name, params) {
    try { if (window.velaiTrack) window.velaiTrack(name, params || {}); } catch (e) {}
  }
  function ss(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function ssSet(key, val) { try { sessionStorage.setItem(key, val); } catch (e) {} }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── 1. CSS ─────────────────────────────────────────────────────────────
     z-index 10000: el banner de consentimiento de funnel.js usa 9999 y se
     inserta después en el DOM, así que con z-index empatado ganaba él y
     tapaba el botón en móvil. Además desplazamos el FAB hacia arriba
     mientras el banner esté visible (--vai-lift).                        */
  var CSS = '' +
    '#vaiWidget{position:fixed;bottom:calc(24px + var(--vai-lift,0px));right:24px;z-index:10000;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Satoshi,system-ui,sans-serif;' +
      'transition:bottom .25s ease}' +
    '#vaiBubble{width:60px;height:60px;border-radius:50%;background:' + ORANGE + ';display:flex;' +
      'align-items:center;justify-content:center;cursor:pointer;border:none;padding:0;' +
      'box-shadow:0 4px 20px rgba(255,107,26,.5);transition:transform .2s;position:relative}' +
    '#vaiBubble:hover{transform:scale(1.08)}' +
    '#vaiBubble:focus-visible{outline:3px solid #fff;outline-offset:3px}' +
    '#vaiPulse{position:absolute;top:-2px;right:-2px;width:16px;height:16px;border-radius:50%;' +
      'background:#25d366;border:2px solid #fff;animation:vaiPulse 2s infinite}' +
    '@keyframes vaiPulse{0%{box-shadow:0 0 0 0 rgba(37,211,102,.7)}70%{box-shadow:0 0 0 10px rgba(37,211,102,0)}100%{box-shadow:0 0 0 0 rgba(37,211,102,0)}}' +
    '@keyframes vaiDot{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-5px);opacity:1}}' +
    /* teaser */
    '#vaiTeaser{position:absolute;bottom:74px;right:0;width:250px;background:#fff;color:#111;' +
      'border-radius:14px 14px 4px 14px;padding:12px 34px 12px 14px;font-size:13.5px;line-height:1.45;' +
      'box-shadow:0 10px 34px rgba(0,0,0,.22);cursor:pointer;opacity:0;transform:translateY(8px);' +
      'transition:opacity .3s ease,transform .3s ease}' +
    '#vaiTeaser.is-on{opacity:1;transform:translateY(0)}' +
    '#vaiTeaserX{position:absolute;top:6px;right:8px;background:none;border:none;color:#8696a0;' +
      'font-size:15px;line-height:1;cursor:pointer;padding:4px}' +
    /* panel */
    '#vaiWindow{display:none;position:absolute;bottom:72px;right:0;width:340px;height:500px;' +
      'border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);' +
      'flex-direction:column;background:#fff}' +
    '#vaiWindow.is-open{display:flex}' +
    '.vai-h{background:#075e54;padding:12px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0}' +
    '.vai-h-av{width:38px;height:38px;border-radius:50%;background:' + ORANGE + ';display:flex;' +
      'align-items:center;justify-content:center;font-size:18px;flex-shrink:0}' +
    '.vai-h-id{flex:1}' +
    '.vai-h-name{color:#fff;font-size:14px;font-weight:600}' +
    '.vai-h-st{color:hsla(0,0%,100%,.75);font-size:12px;display:flex;align-items:center;gap:4px}' +
    '.vai-h-dot{width:6px;height:6px;border-radius:50%;background:#25d366}' +
    '.vai-h-x{color:hsla(0,0%,100%,.7);cursor:pointer;font-size:20px;line-height:1;background:none;border:none;padding:0 2px}' +
    '#vaiMessages{flex:1;overflow-y:auto;padding:12px;background:#ece5dd;display:flex;' +
      'flex-direction:column;gap:6px;scroll-behavior:smooth}' +
    '#vaiTyping{display:none;padding:0 12px 6px;background:#ece5dd}' +
    '#vaiTyping.is-on{display:block}' +
    '.vai-tb{background:#fff;border-radius:0 8px 8px 8px;padding:8px 12px;display:inline-flex;gap:4px;' +
      'align-items:center;box-shadow:0 1px 2px rgba(0,0,0,.1)}' +
    '.vai-td{width:7px;height:7px;background:#8696a0;border-radius:50%;animation:vaiDot 1.2s infinite}' +
    '.vai-td:nth-child(2){animation-delay:.2s}.vai-td:nth-child(3){animation-delay:.4s}' +
    /* chips de respuesta rápida */
    '#vaiChips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 10px;background:#ece5dd}' +
    '#vaiChips.is-off{display:none}' +
    '.vai-chip{background:#fff;border:1px solid rgba(7,94,84,.25);color:#075e54;border-radius:16px;' +
      'padding:7px 12px;font-size:12.5px;font-family:inherit;cursor:pointer;line-height:1.2}' +
    '.vai-chip:hover{background:#f0f7f5}' +
    /* input */
    '.vai-in-wrap{background:#f0f2f5;padding:8px 10px;display:flex;align-items:center;gap:8px;flex-shrink:0}' +
    '.vai-in-shell{flex:1;background:#fff;border-radius:22px;display:flex;align-items:center;padding:8px 14px}' +
    '#vaiInput{flex:1;border:none;outline:none;font-size:16px;font-family:inherit;color:#111;' +
      'background:transparent;resize:none;max-height:80px;line-height:1.4}' +
    '#vaiSend{width:42px;height:42px;border-radius:50%;background:#00a884;border:none;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;flex-shrink:0}' +
    /* burbujas */
    '.vai-row{display:flex}.vai-row.is-bot{justify-content:flex-start}.vai-row.is-user{justify-content:flex-end}' +
    '.vai-b{max-width:80%;padding:8px 10px 5px;box-shadow:0 1px 2px rgba(0,0,0,.1)}' +
    '.vai-b.is-bot{background:#fff;border-radius:0 8px 8px 8px}' +
    '.vai-b.is-user{background:#dcf8c6;border-radius:8px 8px 0 8px}' +
    '.vai-b-t{font-size:13.5px;color:#111;line-height:1.5;white-space:pre-wrap;word-break:break-word}' +
    '.vai-b-h{font-size:11px;color:#8696a0;text-align:right;margin-top:2px}' +
    /* móvil: panel a pantalla casi completa */
    '@media(max-width:480px){' +
      '#vaiWindow{position:fixed;bottom:0;right:0;left:0;width:100%;height:100dvh;border-radius:0}' +
      '#vaiTeaser{width:210px}' +
    '}' +
    '@media(prefers-reduced-motion:reduce){#vaiPulse,.vai-td{animation:none}}';

  /* ── 2. Markup ──────────────────────────────────────────────────────── */
  var HTML = '' +
    '<button id="vaiBubble" type="button" aria-label="Abrir chat con Vai">' +
      '<svg id="vaiIconChat" width="28" height="28" viewBox="0 0 24 24" fill="white" aria-hidden="true">' +
        '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>' +
      '<svg id="vaiIconClose" width="24" height="24" viewBox="0 0 24 24" fill="white" style="display:none" aria-hidden="true">' +
        '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
      '<span id="vaiPulse"></span>' +
    '</button>' +
    '<div id="vaiWindow" role="dialog" aria-label="Chat con Vai">' +
      '<div class="vai-h">' +
        '<div class="vai-h-av">🤖</div>' +
        '<div class="vai-h-id">' +
          '<div class="vai-h-name">Vai · Velai</div>' +
          '<div class="vai-h-st"><span class="vai-h-dot"></span>En línea ahora</div>' +
        '</div>' +
        '<button class="vai-h-x" type="button" aria-label="Cerrar chat">✕</button>' +
      '</div>' +
      '<div id="vaiMessages"></div>' +
      '<div id="vaiTyping"><div class="vai-tb"><span class="vai-td"></span><span class="vai-td"></span><span class="vai-td"></span></div></div>' +
      '<div id="vaiChips"></div>' +
      '<div class="vai-in-wrap">' +
        '<div class="vai-in-shell">' +
          '<textarea id="vaiInput" placeholder="Escribe un mensaje..." rows="1" maxlength="2000" aria-label="Mensaje"></textarea>' +
        '</div>' +
        '<button id="vaiSend" type="button" aria-label="Enviar">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden="true">' +
            '<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';

  /* ── 3. Guiones de apertura ─────────────────────────────────────────── */
  var DEFAULT_SCRIPT = {
    greeting: '¡Hola! Soy Vai 👋 Soy el mismo asistente que montamos para nuestros clientes. Pregúntame lo que quieras — o toca una de estas opciones:',
    chips: ['¿Cuánto cuesta?', 'Enséñame una demo', '¿Sirve para mi negocio?']
  };

  // Guiones de modo demo. La clave debe coincidir con DEMOS en vai-worker.js.
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
  var conversationId = ''; // se genera en el primer envío (o se restaura de la sesión)
  var demo = '';
  var history = [];
  var wasOpen = false; // el panel estaba abierto en la página anterior
  var el = {};

  function saveState() {
    try {
      sessionStorage.setItem(SS_STATE, JSON.stringify({ conversationId: conversationId, demo: demo, history: history, sent: sent, open: open, humanVerified: humanVerified }));
    } catch (e) {}
  }
  function loadState() {
    try {
      var s = JSON.parse(sessionStorage.getItem(SS_STATE));
      if (!s || !Array.isArray(s.history) || !s.history.length) return;
      history = s.history;
      if (typeof s.conversationId === 'string') conversationId = s.conversationId;
      humanVerified = !!s.humanVerified;
      sent = typeof s.sent === 'number' ? s.sent : history.length;
      demo = typeof s.demo === 'string' && DEMO_SCRIPTS[s.demo] ? s.demo : '';
      wasOpen = !!s.open;
    } catch (e) {}
  }
  // Repinta la conversación restaurada: saludo + historial (el saludo no viaja en history)
  function renderHistory() {
    el.msgs.innerHTML = '';
    addMsg('bot', script().greeting);
    history.forEach(function (m) {
      addMsg(m.role === 'assistant' ? 'bot' : 'user', m.content, m.t);
    });
  }

  function script() { return (demo && DEMO_SCRIPTS[demo]) || DEFAULT_SCRIPT; }

  function demoFromQuery() {
    try {
      var m = /[?&]demo=([a-z]+)/i.exec(location.search);
      if (m && DEMO_SCRIPTS[m[1].toLowerCase()]) return m[1].toLowerCase();
    } catch (e) {}
    return window.VELAI_DEMO && DEMO_SCRIPTS[window.VELAI_DEMO] ? window.VELAI_DEMO : '';
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
     Con data-vai-demo="" (vacío) abre a Vai normal. Sin JS en las páginas. */
  function wireDemoTriggers() {
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-vai-demo]') : null;
      if (!t) return;
      e.preventDefault();
      var key = (t.getAttribute('data-vai-demo') || '').toLowerCase();
      toggle(true, 'cta', DEMO_SCRIPTS[key] ? key : '');
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
      t.innerHTML = '<button id="vaiTeaserX" type="button" aria-label="Cerrar">✕</button>' +
        '¿Dudas? Pregúntame lo que quieras — respondo al momento.';
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
    el.iconChat.style.display = open ? 'none' : 'block';
    el.iconClose.style.display = open ? 'block' : 'none';
    el.bubble.setAttribute('aria-label', open ? 'Cerrar chat con Vai' : 'Abrir chat con Vai');
    var teaser = document.getElementById('vaiTeaser');
    if (open && teaser) teaser.remove();

    if (open && !started) {
      started = true;
      ssSet(SS_OPENED, '1');
      track('chat_open', { source: source || 'bubble', page: location.pathname, demo: demo || 'none' });
      if (history.length) {
        // conversación restaurada de otra página: repintar sin saludo demorado
        renderHistory();
        if (!sent) renderChips();
      } else {
        setTimeout(function () {
          addMsg('bot', script().greeting);
          renderChips();
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
    var isBot = role === 'bot';
    var d = t ? new Date(t) : new Date();
    var time = d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    var row = document.createElement('div');
    row.className = 'vai-row ' + (isBot ? 'is-bot' : 'is-user');
    row.innerHTML = '<div class="vai-b ' + (isBot ? 'is-bot' : 'is-user') + '">' +
      '<div class="vai-b-t">' + esc(text) + '</div>' +
      '<div class="vai-b-h">' + time + '</div></div>';
    el.msgs.appendChild(row);
    el.msgs.scrollTop = el.msgs.scrollHeight;
  }

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
      var reply;
      try {
        reply = await postChat(text);
      } catch (err) {
        // El servidor perdió el estado (KV caducado) y vuelve a exigir verificación:
        // reintentar UNA vez con token fresco en vez de dejar la sesión rota.
        if (err && err.status === 403 && humanVerified) {
          humanVerified = false; saveState();
          reply = await postChat(text);
        } else { throw err; }
      }
      humanVerified = true;
      history.push({ role: 'assistant', content: reply, t: Date.now() });
      saveState();
      el.typing.classList.remove('is-on');
      addMsg('bot', reply);
      track('chat_reply', { n: sent });
    } catch (err) {
      // Nunca dejar humanVerified bloqueado en true tras un fallo: el próximo
      // intento pide token nuevo y el usuario puede recuperarse solo.
      humanVerified = false;
      saveState();
      el.typing.classList.remove('is-on');
      addMsg('bot', 'Ups, ahora mismo no puedo responder. Escríbenos por WhatsApp y te contestamos en minutos: https://wa.me/' + (window.VELAI_WA || '15706160059'));
      track('chat_error', { msg: String(err && (err.code || err.message) || err) });
    } finally {
      busy = false;
    }
  }

  async function postChat(text) {
    var payload = {
      conversationId: conversationId,
      message: text,
      pageUrl: location.href.slice(0, 500),
      utm: (window.VELAI_getUTM && window.VELAI_getUTM()) || {}
    };
    if (demo) payload.demo = demo;
    if (!humanVerified) {
      if (!window.VELAI_HUMAN) throw new Error('human_check_unavailable');
      payload.turnstileToken = await window.VELAI_HUMAN.execute('chat');
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
    var reply = data.reply || (data.content && data.content[0] ? data.content[0].text : null);
    if (!reply) throw new Error('empty');
    return reply;
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
