# Plan de cambios — Chat web de Velai

> **El síntoma:** con 2,65k visitantes únicos en `hirevai.com`, el `vai-worker` recibió
> **1 sola solicitud** del 1 al 14 de agosto de 2026.
>
> **El hallazgo:** el chat no está roto. Está montado de forma que ese número es el
> resultado esperado. Y por el camino aparecieron cuatro cosas más que cuestan poco de
> arreglar y valen bastante.
>
> Este documento es la especificación ejecutable de todos esos arreglos, pensada para que
> Claude Code la lea desde la raíz del repo `botnexoia-coder/velai` y la aplique paso a
> paso. Todo el código necesario está aquí; no hace falta ningún archivo extra.
>
> Levantado el 2026-08-17 sobre el commit `4e2f8bb`.
>
> **Estado (act. 2026-08-17): PRs 1, 2 y 3 APLICADOS y validados en preview** (ramas
> `fix/chat-web-alcance-y-visibilidad`, `feat/demo-rol-play`, `feat/chat-ctas`), con dos
> extras: persistencia de la conversación entre páginas (sessionStorage) y `wrangler.toml`
> que fija la compatibility date y el binding KV del worker. El worker está redesplegado
> con las 4 demos. **Pendientes: PR 4** (variables TEAM_WHATSAPP / TWILIO_FROM /
> TELEGRAM_CHAT_ID + vaciar el fallback) **y PR 5** (NIF/CIF, Instagram del prompt, CSS
> muerto, TAREAS-PENDIENTES.md, tareas de Cloudflare). Tras el deploy: medir 7 días con
> el Anexo A.

---

## 1. Diagnóstico

### 1.1 Por qué el chat web recibe 1 solicitud

| # | Causa | Evidencia en el repo | Impacto |
|---|---|---|---|
| 1 | **El widget solo existe en la home** | `toggleVai` aparece únicamente en `index.html`. Las 4 landings verticales, las 4 de pauta (`lp/*`), los 8 posts del blog y los 6 lead magnets no tienen chat. | 25 de 26 páginas sin chat, y son justo las que reciben SEO y anuncios |
| 2 | **El botón queda tapado por el banner de cookies en móvil** | `.vai-fab` tiene `z-index:9999`; `#velai-consent` (`funnel.js:189`) también `9999` y se inserta con `document.body.appendChild` → gana el banner. Por debajo de ~900px de ancho lo cubre. | En móvil no hay botón hasta aceptar cookies |
| 3 | **El saludo es cliente, no worker** | `vaiGreet()` pinta un string hardcodeado. Abrir el chat = 0 solicitudes. | La métrica solo cuenta a quien *redacta y envía* — el último escalón |
| 4 | **Nada invita a usar el chat** | CTAs de la home: "Agenda tu demo", "Solicitar demo", "Hablar con ventas", "WhatsApp directo". El chat no se menciona. Único enlace `?chat=1`: `/que-es-velai/`. | Open rate de un FAB sin promocionar: 1–2% |
| 5 | **Cero instrumentación** | No hay ningún `velaiTrack('chat_*')` en el repo. | Imposible saber si el problema es visibilidad o abandono |

**La cuenta:** 2.650 × ~30% que caen en home × ~50% humanos × ~1,5% que abren × ~35% que
escriben ≈ **1–2 solicitudes**. Cuadra exactamente. Además, el `Content-Type: application/json`
del `fetch` dispara preflight CORS, así que un mensaje real serían **2** solicitudes (OPTIONS +
POST): esa única solicitud registrada probablemente ni siquiera fue una conversación completa.

### 1.2 Lo demás que apareció mirando el repo

| # | Hallazgo | Evidencia | Gravedad |
|---|---|---|---|
| 6 | **La demo rol-play está implementada en el worker y ninguna página la usa** | `vai-worker.js:299` acepta `body.demo` en el chat web y conmuta el system prompt (`DEMOS[demo]`). Ni `index.html` ni ninguna otra página envía ese campo jamás. | **Alta** — es la jugada diferencial del producto, ya construida y muerta en el código |
| 7 | **Solo existe la demo de `restaurante`** | `DEMOS` (`vai-worker.js:55`) tiene una única clave, pese a haber landing propia de clínicas, talleres e inmobiliarias. | Alta |
| 8 | **Los avisos de lead por WhatsApp a los fundadores no funcionan** | `sendWhatsApp()` (`vai-worker.js:160-164`) hace `return` temprano si faltan `TEAM_WHATSAPP` o `TWILIO_FROM`; ninguna de las dos está configurada en el Worker. | Alta — leads que llegan solo por un canal |
| 9 | **`TELEGRAM_CHAT_ID` tampoco está configurada** | Se usa el fallback hardcodeado `DEFAULT_TELEGRAM_CHAT_ID = '-5021568102'` (`vai-worker.js:95`), y el repo es **público**. | Media — cualquiera puede leer el id del grupo interno |
| 10 | **El system prompt promete un canal que no existe** | `vai-worker.js:9`: "Atiende 24/7 en WhatsApp, web e **Instagram**". Instagram no está implementado. Vai le promete a los prospectos algo que no se puede entregar. | Media |
| 11 | **`que-es-velai/index.html` no carga `funnel.js`** | Es la única de las 26 páginas que no lo hace. Sin banner de consentimiento, sin captura de UTM y sin `velaiTrack`. | Media — y es un agujero de RGPD, no solo de analítica |
| 12 | **Datos fiscales sin rellenar** | `privacidad/index.html` sigue con el placeholder `[NIF/CIF]`. | Media — requisito LSSI |
| 13 | **El KV de conversaciones está a 0 B / 0 operaciones** | Único namespace de la cuenta, `vai-conversations`. Significa que el canal WhatsApp tampoco ha tenido una sola conversación entrante. | Informativa, pero confirma que el problema no es solo del chat web |

---

## 2. Mapa de PRs

Cinco cambios independientes. **No los mezcles en un solo commit**: el PR 1 toca 27 archivos
y quieres poder revertirlo solo si algo se tuerce.

| PR | Qué | Archivos | Riesgo | Tiempo |
|---|---|---|---|---|
| **1** | Alcance y visibilidad del chat | `assets/vai-widget.js` (nuevo) + los 26 `*.html` | Bajo | ~30 min |
| **2** | Activar la demo rol-play en las 4 verticales | `vai-worker.js` + 4 landings + 4 `lp/*` | Medio (toca el worker) | ~1 h |
| **3** | CTAs textuales al chat | `index.html` + landings + blog | Bajo | ~40 min |
| **4** | Arreglar las notificaciones de lead | Config del Worker (sin código) | Bajo | ~10 min |
| **5** | Higiene y cumplimiento | `privacidad/`, `docs/`, DNS, `styles.scss` | Bajo | ~30 min |

El PR 1 es el que desbloquea la medición. **Haz el 1, deja pasar 3–4 días de datos, y decide
el resto con números en la mano** en vez de a ciegas. Los PRs 4 y 5 son independientes y se
pueden hacer en cualquier momento.

---
---

# PR 1 — Alcance y visibilidad del chat

Ataca las causas 1, 2, 3 y 5.

## 1.0 Rama

```bash
git checkout -b fix/chat-web-alcance-y-visibilidad
```

## 1.1 Crear `assets/vai-widget.js`

Archivo **nuevo**. Contenido íntegro (crear tal cual, sin modificar):

```javascript
/* ══════════════════════════════════════════════════════════════════════════
   VAI CHAT WIDGET — autocontenido (CSS + markup + lógica)
   ──────────────────────────────────────────────────────────────────────────
   Se carga en TODAS las páginas con una sola línea:
     <script src="/assets/vai-widget.js?v=1" defer></script>

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
          '<textarea id="vaiInput" placeholder="Escribe un mensaje..." rows="1" aria-label="Mensaje"></textarea>' +
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
  var open = false, started = false, sent = 0, busy = false;
  var demo = '';
  var history = [];
  var el = {};

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

    // Apertura automática con ?chat=1 (respeta ?demo=)
    try {
      if (/[?&]chat=1/.test(location.search)) {
        var d = demoFromQuery();
        setTimeout(function () { toggle(true, 'querystring', d); }, 500);
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
      started = false; sent = 0; history = [];
      el.msgs.innerHTML = '';
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
      setTimeout(function () {
        addMsg('bot', script().greeting);
        renderChips();
      }, 500);
    }
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
  function addMsg(role, text) {
    var isBot = role === 'bot';
    var d = new Date();
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
    history.push({ role: 'user', content: text });
    sent++;
    if (sent === 1) track('chat_first_message', { source: source || 'input', page: location.pathname, demo: demo || 'none' });
    track('chat_message', { n: sent, demo: demo || 'none' });

    busy = true;
    el.typing.classList.add('is-on');
    el.msgs.scrollTop = el.msgs.scrollHeight;

    try {
      var payload = { messages: history };
      if (demo) payload.demo = demo;   // el worker cambia el system prompt (DEMOS[demo])
      var res = await fetch(WORKER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var reply = data.reply || (data.content && data.content[0] ? data.content[0].text : null);
      if (!reply) throw new Error('empty');
      history.push({ role: 'assistant', content: reply });
      el.typing.classList.remove('is-on');
      addMsg('bot', reply);
      track('chat_reply', { n: sent });
    } catch (err) {
      el.typing.classList.remove('is-on');
      addMsg('bot', 'Ups, ahora mismo no puedo responder. Escríbenos por WhatsApp y te contestamos en minutos: https://wa.me/' + (window.VELAI_WA || '15706160059'));
      track('chat_error', { msg: String(err && err.message || err) });
    } finally {
      busy = false;
    }
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
```

Comprueba que compila:

```bash
node --check assets/vai-widget.js
```

### Decisión de diseño importante

El widget **inyecta su propio CSS**. Solo `index.html` carga `/assets/styles.css`; las otras
25 páginas llevan CSS inline. Si el widget dependiera de `styles.css`, se vería roto en 25
páginas. Por eso es autocontenido, exactamente igual que el banner de consentimiento de
`funnel.js`.

### Qué cambia respecto al widget actual

- **`z-index: 10000`** (el banner de cookies usa 9999) **y** además desplaza el FAB hacia
  arriba con la variable `--vai-lift` mientras el banner esté visible en pantallas `<900px`,
  para que no se solapen visualmente. Ganar el z-index no basta: el banner sigue ocupando ese
  espacio físico. Un `MutationObserver` lo recalcula cuando el banner desaparece.
- **Chips de respuesta rápida** ("¿Cuánto cuesta?", "Enséñame una demo", "¿Sirve para mi
  negocio?"). Ataca el mayor punto de fuga: hoy, para generar una sola solicitud al worker
  hay que redactar un mensaje desde cero; con los chips es un toque.
- **Teaser proactivo** a los 18 s, una vez por sesión (`sessionStorage`), descartable.
- **Soporte de modo demo** (`?demo=`, `data-vai-demo="…"`, `window.VaiChat.open({demo})`) —
  desactivado por defecto. Lo usa el PR 2.
- **Eventos de tracking**: `chat_view`, `chat_teaser_shown`, `chat_open`, `chat_first_message`,
  `chat_message`, `chat_reply`, `chat_error`. Sin esto seguimos a ciegas después del deploy.
- **Fallback honesto en error**: si el worker falla, ofrece el WhatsApp en vez de "Ups, algo
  salió mal" a secas.
- **Móvil**: el panel pasa a pantalla completa (`100dvh`) por debajo de 480px; el `font-size`
  del textarea es 16px para que iOS no haga zoom al enfocar.
- **Accesibilidad y limpieza**: `<button>` reales en vez de `<div onclick>`, `aria-label`,
  cierre con `Escape`, `role="dialog"`, sin handlers inline.
- **Guarda de idempotencia**: si ya existe un `#vaiWidget` en el DOM, no monta nada. Así el
  paso 1.3 es seguro aunque el 1.2 no se haya hecho todavía.

## 1.2 Limpiar el widget inline de `index.html`

**Borrar** el bloque completo del widget viejo: desde el comentario

```html
  <!-- VAI CHAT WIDGET -->
```

hasta el `</script>` que cierra la función `vaiSend()` — es decir, la línea inmediatamente
anterior a:

```html
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" ...
```

Ese bloque incluye tres cosas, todas se van: el markup `<div id="vaiWidget" class="vai-fab">…`,
el `<style>` con `@keyframes td{…}`, y el `<script>` con `VAI_WORKER_URL`, `toggleVai`,
`vaiGreet`, `vaiAddMsg`, `vaiKey`, `vaiResize` y `vaiSend`.

En el estado actual del repo son las **líneas 2166–2311**, pero **no borres por número de
línea**: localiza los marcadores. Verificación:

```bash
grep -c "toggleVai\|vaiGreet\|VAI_WORKER_URL\|vai-fab" index.html   # debe dar 0
```

> Las reglas CSS `.vai-fab`, `.vai-chat-panel`, `.vai-bubble*` siguen en `assets/styles.css`.
> **Déjalas en este PR** (son inertes, el widget nuevo usa selectores propios). Se limpian en
> el PR 5, que además tiene que regenerar el CSS desde `styles.scss`.

## 1.3 Cargar el widget en las 26 páginas

Insertar, justo antes de `</body>` en **todos** los `*.html`:

```html
<script src="/assets/vai-widget.js?v=1" defer></script>
```

Las 26 páginas tienen `</body>`, así que se puede automatizar:

```bash
python3 - <<'EOF'
import pathlib
TAG = '<script src="/assets/vai-widget.js?v=1" defer></script>\n'
n = 0
for p in sorted(pathlib.Path('.').rglob('*.html')):
    s = p.read_text(encoding='utf-8')
    if 'vai-widget.js' in s:
        print('ya lo tiene:', p); continue
    if '</body>' not in s:
        print('SIN </body>:', p); continue
    p.write_text(s.replace('</body>', TAG + '</body>', 1), encoding='utf-8')
    n += 1
    print('ok:', p)
print('modificados:', n)
EOF
```

Verificación:

```bash
grep -rl "vai-widget.js" --include=*.html . | wc -l    # debe dar 26
```

> **Excepción a considerar:** `privacidad/index.html` es la política de privacidad. Meter un
> chat de ventas ahí es discutible pero no incorrecto. Si prefieres excluirla, quita el tag de
> esa página y la cuenta pasa a 25.

## 1.4 `que-es-velai/index.html` no carga `funnel.js`

Es la **única** de las 26 páginas que no lo carga. Sin `funnel.js` no existe `window.velaiTrack`
(el widget no emitirá eventos ahí), pero sobre todo **no se pinta el banner de consentimiento
ni se capturan UTMs** — o sea, es un agujero de RGPD, no solo de analítica. Añade lo mismo que
llevan las demás:

```html
<script>window.VELAI_TRACK={ga4:'G-8HC3SQ0T0Q',ads:'AW-18250158066',adsLabel:'VMZdCLXFn8EcEPKfrf5D',pixel:'1928880717825520'};window.VELAI_WA='15706160059';</script>
<script src="/assets/funnel.js?v=3" defer></script>
```

> Copia los valores exactos desde otra página (p. ej. `blog/alternativa-a-cliengo/index.html`,
> línea 116) por si han cambiado.

Verificación:

```bash
grep -rl "assets/funnel.js" --include=*.html . | wc -l    # debe dar 26
```

## 1.5 Verificación local

```bash
node --check assets/vai-widget.js
python3 -m http.server 8080
```

En `http://localhost:8080`:

- [ ] La burbuja naranja aparece abajo a la derecha en **la home, un post del blog, una
      landing vertical y una `lp/*`**.
- [ ] En viewport móvil (DevTools, 390×844) **con el banner de cookies visible**: la burbuja
      se ve por encima del banner y es clicable. Al aceptar/rechazar, vuelve a su sitio.
- [ ] Al abrir: saludo + 3 chips. Al tocar un chip se envía el mensaje y aparece el "typing".
- [ ] `window.velaiTrack` existe en consola y los eventos `chat_open` / `chat_first_message`
      se disparan (visibles en el `dataLayer` de GA4, o con un `console.log` temporal dentro
      de `velaiTrack`).
- [ ] `Escape` cierra el panel.
- [ ] En `/que-es-velai/?chat=1` el chat se abre solo.
- [ ] Ninguna página muestra **dos** burbujas (si aparecen dos, el paso 1.2 no se completó).

> **Ojo con CORS en local:** el worker tiene allowlist `hirevai.com`, `www.hirevai.com` y
> `*.pages.dev` (`vai-worker.js:98`). Desde `localhost` el `fetch` fallará y verás el mensaje
> de fallback con el WhatsApp — **eso es lo correcto**. Para probar el chat de verdad, usa el
> preview de Cloudflare Pages (`*.pages.dev`), que sí está en la allowlist.

## 1.6 Commit y deploy

```bash
git add -A
git commit -m "fix(chat): widget en las 26 paginas, por encima del banner de cookies, con chips y tracking"
git push -u origin fix/chat-web-alcance-y-visibilidad
```

Cuerpo sugerido del commit:

```
- assets/vai-widget.js: widget autocontenido (CSS propio, no depende de styles.css)
- z-index 10000 + desplazamiento sobre el banner de consentimiento en <900px
- chips de respuesta rapida para eliminar la friccion de redactar el primer mensaje
- teaser proactivo a los 18s, una vez por sesion
- soporte de modo demo (?demo=, data-vai-demo, window.VaiChat), desactivado por defecto
- eventos chat_view/chat_open/chat_first_message/chat_message/chat_reply/chat_error
- fallback a WhatsApp si el worker falla
- funnel.js en que-es-velai (era la unica pagina sin banner de consentimiento)
- se elimina el widget inline de index.html
```

**Prueba el chat en la URL `*.pages.dev` del preview antes de mergear** — es la única forma de
validar CORS end-to-end.

---
---

# PR 2 — Activar la demo rol-play

Ataca los hallazgos 6 y 7. **Este es el de mayor retorno del documento.**

El worker ya acepta `body.demo` en el chat web y conmuta el system prompt
(`vai-worker.js:299` y `:315`). La infraestructura está construida y ninguna página la usa.
Falta: (a) escribir los tres prompts que faltan, (b) poner un CTA en cada landing que abra el
chat en su demo.

> **Por qué no se activa automáticamente por URL.** Sería tentador que `/clinicas/` abriera
> siempre en modo demo, pero entonces un prospecto que abre el chat para preguntar el precio
> se encuentra hablando con una clínica ficticia. El FAB sigue abriendo a Vai comercial; el
> modo demo se activa solo desde un CTA explícito que dice lo que va a pasar.

## 2.1 Añadir los tres prompts a `vai-worker.js`

En el objeto `DEMOS` (línea 55), **después** de la entrada `restaurante`, añadir:

```javascript
  clinica: `Eres Vai, el asistente de WhatsApp de "Clínica Bahía", una clínica dental ficticia de demostración (3 gabinetes, en una ciudad costera).

Tu trabajo: atender al paciente como lo haría la clínica real — con naturalidad, cercano, mensajes cortos tipo WhatsApp, tono tranquilizador, algún emoji con moderación.

== DATOS DE LA CLÍNICA (ficticios, úsalos con seguridad) ==
- Horario: lunes a viernes, 9:00–14:00 y 16:00–20:00. Sábados 9:00–14:00. Domingos cerrado.
- Servicios: odontología general, limpiezas e higiene, ortodoncia (brackets e invisible), implantes, estética dental, urgencias.
- Precios orientativos: primera visita y diagnóstico gratis, limpieza 55€, empaste desde 60€, ortodoncia invisible desde 2.900€, implante desde 950€.
- Citas: gestionas la cita pidiendo motivo, día y franja preferida, y un nombre. Confirmas disponibilidad (invéntala de forma razonable) y la das por hecha.
- Seguros: trabajáis con Adeslas, Sanitas y DKV. Financiación hasta 12 meses sin intereses.
- Urgencias: se atienden el mismo día, avisando por WhatsApp.

== CÓMO ACTUAR ==
1. Atiende la consulta o la cita con naturalidad, como la clínica real.
2. NUNCA des diagnóstico ni consejo clínico. Si describen un síntoma, muestra empatía, di que eso lo tiene que ver el odontólogo y ofrece cita — preferente si suena a urgencia.
3. Tras 3–4 intercambios, o si el paciente muestra que le ha gustado la experiencia, rompe el rol: "Por cierto 😊 soy Vai, una demo de Velai. Así de natural atendería yo el WhatsApp de TU clínica, 24/7, sin que se te escape una cita. ¿Quieres una Vai para lo tuyo?" y ofrece agendar una demo real o escribir al equipo de Velai.
4. Si preguntan por Velai directamente, explica brevemente: implantamos asistentes de IA llave en mano para PYMEs, funcionando en menos de 48h, desde 100€/mes.

Responde siempre en español. Mensajes cortos.`,

  taller: `Eres Vai, el asistente de WhatsApp de "Talleres Ribera", un taller mecánico ficticio de demostración (multimarca, 6 elevadores).

Tu trabajo: atender al cliente como lo haría el taller real — con naturalidad, directo y claro, sin tecnicismos innecesarios, mensajes cortos tipo WhatsApp.

== DATOS DEL TALLER (ficticios, úsalos con seguridad) ==
- Horario: lunes a viernes, 8:30–13:30 y 15:30–19:00. Sábados 9:00–13:00. Domingos cerrado.
- Servicios: mecánica general, revisión pre-ITV y gestión de la ITV, cambio de aceite y filtros, frenos, neumáticos, diagnosis electrónica, aire acondicionado, chapa y pintura.
- Precios orientativos: diagnosis 35€ (gratis si se hace la reparación), revisión pre-ITV 45€, cambio de aceite y filtro desde 79€, pastillas de freno delanteras desde 120€, equilibrado 12€/rueda.
- Citas: gestionas la cita pidiendo marca y modelo, matrícula o año, qué le pasa, y día preferido. Confirmas hueco (invéntalo de forma razonable) y lo das por hecho.
- Extras: vehículo de sustitución si la reparación pasa de 48h (sujeto a disponibilidad). Presupuesto sin compromiso y siempre antes de tocar nada.

== CÓMO ACTUAR ==
1. Atiende la consulta o la cita con naturalidad, como el taller real.
2. Si describen una avería, haz 1–2 preguntas útiles (ruido, cuándo pasa, testigo encendido) y da un rango de precio orientativo, dejando claro que el presupuesto cerrado sale tras la diagnosis. Nunca prometas un precio exacto sin ver el coche.
3. Tras 3–4 intercambios, o si el cliente muestra que le ha gustado la experiencia, rompe el rol: "Por cierto 😊 soy Vai, una demo de Velai. Así de natural atendería yo el WhatsApp de TU taller, 24/7, sin dejar de dar citas mientras estás bajo un coche. ¿Quieres una Vai para lo tuyo?" y ofrece agendar una demo real o escribir al equipo de Velai.
4. Si preguntan por Velai directamente, explica brevemente: implantamos asistentes de IA llave en mano para PYMEs, funcionando en menos de 48h, desde 100€/mes.

Responde siempre en español. Mensajes cortos.`,

  inmobiliaria: `Eres Vai, el asistente de WhatsApp de "Fincas Arenal", una inmobiliaria ficticia de demostración (agencia local, ~40 inmuebles en cartera).

Tu trabajo: atender al interesado como lo haría la agencia real — con naturalidad, resolutivo, mensajes cortos tipo WhatsApp.

== DATOS DE LA AGENCIA (ficticios, úsalos con seguridad) ==
- Horario: lunes a viernes, 9:30–14:00 y 16:30–20:00. Sábados con cita previa. Domingos cerrado.
- Cartera: pisos de 1 a 4 habitaciones (desde 120.000€), áticos, chalets adosados, locales y alquiler de larga temporada (desde 750€/mes). Zona: casco urbano y primera línea.
- Servicios: compraventa, alquiler, valoración gratuita de tu inmueble, gestión hipotecaria y de documentación.
- Honorarios: 3% + IVA al vendedor en compraventa; una mensualidad en alquiler. Valoración sin coste y sin compromiso.
- Visitas: gestionas la visita pidiendo qué busca (zona, habitaciones, presupuesto, compra o alquiler), día y franja preferida, y un nombre. Confirmas disponibilidad (invéntala de forma razonable) y la das por hecha.

== CÓMO ACTUAR ==
1. Atiende la consulta con naturalidad, como la agencia real. Cualifica siempre con 2–3 preguntas: compra o alquiler, zona, presupuesto.
2. Puedes describir inmuebles ficticios plausibles que encajen con lo que pide, pero no inventes direcciones reales ni des datos que suenen a un inmueble concreto verificable.
3. Si el interesado es propietario y quiere vender o alquilar, ofrécele la valoración gratuita.
4. Tras 3–4 intercambios, o si muestra que le ha gustado la experiencia, rompe el rol: "Por cierto 😊 soy Vai, una demo de Velai. Así de natural atendería yo el WhatsApp de TU inmobiliaria, 24/7, cualificando a cada interesado antes de que llegues tú. ¿Quieres una Vai para lo tuyo?" y ofrece agendar una demo real o escribir al equipo de Velai.
5. Si preguntan por Velai directamente, explica brevemente: implantamos asistentes de IA llave en mano para PYMEs, funcionando en menos de 48h, desde 100€/mes.

Responde siempre en español. Mensajes cortos.`
```

> **Cuidado con la coma:** la entrada `restaurante` actual termina en `` Mensajes cortos.` `` sin
> coma, porque es la última. Al añadir más claves hay que ponerle la coma. Verifica con
> `node --check vai-worker.js`.

Las claves (`clinica`, `taller`, `inmobiliaria`) coinciden exactamente con las de
`DEMO_SCRIPTS` en `assets/vai-widget.js`. Si cambias una, cambia las dos.

## 2.2 Desplegar el worker

```bash
npx wrangler deploy vai-worker.js --name vai-worker
```

Comprueba que las cuatro demos responden (desde un origen permitido, no desde localhost):

```bash
for d in restaurante clinica taller inmobiliaria; do
  echo "--- $d"
  curl -s -X POST https://vai-worker.botnexo-ia.workers.dev \
    -H "Origin: https://hirevai.com" -H "Content-Type: application/json" \
    -d "{\"demo\":\"$d\",\"messages\":[{\"role\":\"user\",\"content\":\"hola, buenas\"}]}" | head -c 400
  echo
done
```

Cada una debe contestar en el personaje del negocio ficticio, no como comercial de Velai.

## 2.3 Poner el CTA en cada landing

En las 4 landings verticales (`restaurantes/`, `clinicas/`, `talleres/`, `inmobiliarias/`) y en
las 4 de pauta (`lp/*`), añadir un botón en el hero o justo bajo el primer bloque de beneficios.
No hace falta nada de JavaScript: el widget engancha cualquier elemento con `data-vai-demo`.

```html
<button type="button" class="btn btn-secondary" data-vai-demo="clinica" data-conv="demo_chat_click">
  Habla con la Vai de una clínica →
</button>
<p class="small muted">Es una clínica ficticia. Pregúntale lo que te preguntan a ti cada día.</p>
```

Cambia `data-vai-demo` y el texto según la página:

| Página | `data-vai-demo` | Texto del botón |
|---|---|---|
| `restaurantes/`, `lp/restaurantes/` | `restaurante` | Habla con la Vai de un restaurante → |
| `clinicas/`, `lp/clinicas/` | `clinica` | Habla con la Vai de una clínica → |
| `talleres/`, `lp/talleres/` | `taller` | Habla con la Vai de un taller → |
| `inmobiliarias/`, `lp/inmobiliarias/` | `inmobiliaria` | Habla con la Vai de una inmobiliaria → |

Usa las clases de botón que ya existan en cada página (son distintas entre landings y `lp/*`;
míralo antes de pegar). El `data-conv="demo_chat_click"` lo recoge `funnel.js` automáticamente
(`wireEvents()` engancha todo `[data-conv]`) y lo manda a GA4.

También funciona como enlace compartible, útil para la pauta y para mandarlo por WhatsApp:

```
https://hirevai.com/clinicas/?chat=1&demo=clinica
```

## 2.4 Verificación

- [ ] `node --check vai-worker.js` pasa.
- [ ] El botón abre el chat y el saludo es el del negocio ficticio, no el comercial.
- [ ] La conversación responde en personaje y rompe la cuarta pared hacia el turno 3–4.
- [ ] El FAB normal (sin tocar el CTA) sigue abriendo a Vai comercial.
- [ ] Si abres primero el FAB normal y luego pulsas el CTA de demo, la conversación se
      reinicia (es intencional: el system prompt del worker cambia).
- [ ] En GA4 llegan `chat_open` con `demo: 'clinica'` y `demo_chat_click`.

> **Nota sobre leads:** en modo demo el worker **no notifica leads** (`vai-worker.js:342`,
> `if (!demoKey && phoneMatch …)`). Es deliberado y correcto: nadie deja su teléfono hablando
> con una parrilla ficticia. La conversión de la demo la tiene que recoger el CTA de después,
> no el chat.

---
---

# PR 3 — CTAs textuales al chat

Ataca la causa 4. Es la que más movería el open rate, y es puro copy.

Ahora mismo el chat es un botón naranja sin explicación. Nadie sabe que detrás hay
exactamente el producto que se está vendiendo. El argumento más fuerte de Velai —
*"no es una herramienta que montas, es un resultado entregado"* — se demuestra dejando que
el prospecto hable con el producto, no describiéndoselo.

## 3.1 Home (`index.html`)

Bajo el CTA principal del hero, añadir una línea de texto (no otro botón grande, para no
competir con "Agenda tu demo"):

```html
<p class="hero-sub-cta">
  ¿Prefieres verlo antes? <a href="#" data-vai-demo="" data-conv="chat_cta_click">Habla con Vai ahora →</a>
  Es el mismo asistente que instalamos en los negocios de nuestros clientes.
</p>
```

`data-vai-demo=""` (vacío) abre el chat en modo Vai normal.

En la sección de precios, junto a "Solicitar demo":

```html
<a href="#" data-vai-demo="" data-conv="chat_cta_pricing">¿Dudas sobre qué plan? Pregúntaselo a Vai →</a>
```

## 3.2 Blog (los 8 posts)

Los posts comparativos ("alternativa a X") son los que más tráfico frío traen y los que peor
convierten, porque el lector viene a informarse y se va. Un bloque al final de cada artículo:

```html
<aside class="post-cta">
  <p><strong>¿Y si lo pruebas en vez de leer sobre ello?</strong></p>
  <p>Vai es el asistente que instalamos en negocios reales. Está aquí mismo, en esta página.</p>
  <button type="button" data-vai-demo="" data-conv="chat_cta_blog">Hablar con Vai →</button>
</aside>
```

## 3.3 Lead magnets

En `diagnostico-whatsapp/`, `calculadora-roi/`, `calculadora-ventas-perdidas/` y
`cotizador-precio/`, **en la pantalla de resultado** (que es donde el usuario está más
caliente, ya ha visto su número):

```html
<button type="button" data-vai-demo="" data-conv="chat_cta_resultado">
  Pregúntale a Vai qué harías con estos números →
</button>
```

Estas páginas pintan el resultado con JS. Si el botón se inyecta dinámicamente, no hace falta
nada extra: el widget usa delegación de eventos en `document`, así que engancha también los
elementos creados después.

## 3.4 Verificación

- [ ] Todos los CTAs abren el chat sin recargar la página.
- [ ] Los eventos `chat_cta_*` llegan a GA4.
- [ ] En móvil los CTAs no se solapan con el FAB ni con el banner de cookies.

---
---

# PR 4 — Arreglar las notificaciones de lead

Ataca los hallazgos 8 y 9. **Sin código: es configuración del Worker.** 10 minutos, y hoy
mismo hay leads que llegan por un solo canal.

## 4.1 Lo que pasa

`sendWhatsApp()` (`vai-worker.js:160-164`) hace:

```javascript
var recipients = (env.TEAM_WHATSAPP || '').split(',')…filter(Boolean);
if (!recipients.length || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return;
var from = env.TWILIO_FROM || '';
if (!from) return;
```

Ni `TEAM_WHATSAPP` ni `TWILIO_FROM` están configuradas en el Worker → sale por el `return` y
**nunca se envía nada**. El aviso llega solo por Telegram, y encima usando el `chat_id` de
fallback hardcodeado porque `TELEGRAM_CHAT_ID` tampoco está puesta.

## 4.2 Configurar

Desde el dashboard de Cloudflare (**Workers → vai-worker → Settings → Variables**) o por CLI:

```bash
# Variables de texto plano (no son secretos)
npx wrangler secret put TEAM_WHATSAPP   # ej: whatsapp:+34600111222,whatsapp:+34600333444
npx wrangler secret put TWILIO_FROM     # ej: whatsapp:+14155238886  (el número/sandbox de Twilio)
npx wrangler secret put TELEGRAM_CHAT_ID # el id real del grupo del equipo
```

Formato importante: Twilio exige el prefijo `whatsapp:` **y** el número en E.164, tanto en
`From` como en `To`. Sin el prefijo la API devuelve 400 y el `catch` del worker se lo traga en
silencio (`vai-worker.js:176`).

## 4.3 `TELEGRAM_CHAT_ID` y el repo público

`DEFAULT_TELEGRAM_CHAT_ID = '-5021568102'` está hardcodeado en un repo **público**. Con el
token no se puede hacer nada (ese sí es secreto), pero es información interna que no pinta
ahí. Una vez configurada la variable de entorno, cambia el fallback por vacío:

```javascript
const DEFAULT_TELEGRAM_CHAT_ID = '';
```

y verifica que `sendTelegram()` no explota si llega vacío — hoy `handleLead` lo pasa tal cual
(`vai-worker.js:187`). Añade la guarda:

```javascript
if (!chatId) return { ok: false };
```

al principio de `sendTelegram()`.

## 4.4 Verificación

Manda un lead de prueba desde el formulario del sitio (o directamente a la ruta `/lead`) y
comprueba que llega **por los dos canales**. Ojo al rate limit: 5 leads/min por IP
(`vai-worker.js:258`).

---
---

# PR 5 — Higiene y cumplimiento

Cosas pequeñas, ninguna urgente, todas molestas si se quedan.

## 5.1 Datos fiscales en `/privacidad/` (LSSI)

`privacidad/index.html` sigue con el placeholder `[NIF/CIF]`. La LSSI exige identificación
completa del prestador. Rellenar con el NIF/CIF real.

```bash
grep -n "\[NIF/CIF\]" privacidad/index.html
```

## 5.2 El system prompt promete Instagram

`vai-worker.js:9`: *"Atiende 24/7 en WhatsApp, web e Instagram"*. Instagram **no está
implementado**. Vai le está prometiendo a los prospectos un canal que no se puede entregar en
48h. Dos salidas honestas:

- **Corto plazo:** quitar Instagram de esa línea → `"Atiende 24/7 en WhatsApp y web"`.
- **Mejor:** implementar Telegram como canal de cliente (Bot API directa, sin coste por
  mensaje, sin aprobación de Meta, y el token ya está en el Worker) y anunciar
  *"WhatsApp, web y Telegram"*, que sí es cierto.

La misma revisión hace falta en el copy de la web y en los planes: la página anuncia
"todos los canales" en el plan Profesional cuando hay dos implementados.

## 5.3 CSS muerto de `styles.scss`

Tras el PR 1, el bloque `.vai-fab` / `.vai-chat-*` / `.vai-bubble*` de `assets/styles.scss`
(**líneas ~270 a 497**, hasta el final del archivo) queda sin uso. Borrarlo y regenerar:

```bash
npx sass assets/styles.scss assets/styles.css --style=compressed --no-source-map
```

> **Cuidado:** el repo **no tiene `package.json`**, así que el CSS se ha venido compilando a
> mano. Antes de regenerar, comprueba que `npx sass` produce un `styles.css` equivalente al
> actual salvo por el bloque borrado (`git diff --stat`). Si el diff es enorme, es que la
> versión de sass no coincide con la que se usó — en ese caso **no lo hagas** y deja el CSS
> muerto, que no molesta a nadie. Este paso es opcional.

## 5.4 `docs/TAREAS-PENDIENTES.md` desactualizado

Marca como pendientes los IDs de GA4/Ads/Pixel y el redeploy del worker, que commits
posteriores ya hicieron. Está induciendo a error a cualquiera que lo lea. Actualízalo o
bórralo y deja este documento como la lista viva.

## 5.5 Cloudflare (no es repo)

- **`www.hirevai.com` figura como "Inactivo (Error)"** en los dominios personalizados de
  Pages, aunque en la práctica carga y redirige al apex. Quitarlo y volverlo a añadir, o
  eliminarlo si el apex ya cubre todo.
- **DMARC en `p=none`**: sin enforcement. Pasar a `p=quarantine` cuando lleves un par de
  semanas revisando los informes agregados.
- **Proyecto Pages `hirevai` legacy** apuntando a `botnexoia-coder/nexobot-nexo`, sin relación
  con el sitio actual y con un nombre que se confunde con el dominio real. Archivar o borrar.

---
---

# Anexo A — Qué medir después

Ventana de 7 días, en GA4 y en el dashboard del Worker.

| Métrica | Antes | Objetivo razonable |
|---|---|---|
| `chat_view` | — | ≈ nº de pageviews |
| `chat_open` / `chat_view` | desconocido | 2–5% |
| `chat_first_message` / `chat_open` | desconocido | 50–70% (los chips deberían empujarlo mucho) |
| Solicitudes a `vai-worker` | 1 / 14 días | 40–120 / 14 días |
| `chat_error` | desconocido | <2% |
| `demo_chat_click` (tras PR 2) | — | 3–8% de las visitas a landings verticales |

Cómo leer el resultado:

- **`chat_open` sube pero `chat_first_message` no** → el problema es el saludo. Hazlo más
  concreto o precarga una pregunta.
- **`chat_view` alto y `chat_open` plano** → el problema es visibilidad. Toca el copy de la
  página (PR 3), no el CSS.
- **`chat_error` > 5%** → mira los Workers Logs. Sospechosos: rate limit de 20/min por IP
  compartida (oficinas, operadores móviles con CGNAT) o timeouts de la API de Anthropic.
- **Nada se mueve en ninguna métrica** → el problema no es el chat, es que 2,65k "visitantes
  únicos" de Cloudflare son mayoritariamente crawlers. En ese caso el trabajo siguiente es de
  adquisición, no de producto.

> **Optimización opcional (hazla solo si quieres que el contador del Worker sea legible):**
> cambiar el `Content-Type` del `fetch` de `application/json` a `text/plain;charset=UTF-8`
> convierte la petición en *simple request* y elimina el preflight OPTIONS. El worker sigue
> funcionando igual (usa `request.json()`, que no mira el content-type, y la rama de Twilio
> discrimina por `x-www-form-urlencoded`). Ventaja: cada mensaje pasa a contar 1 solicitud en
> vez de 2, y se ahorra un round-trip de latencia. Riesgo: bajo, pero toca la ruta crítica —
> déjalo para un PR aparte y pruébalo en preview.

---

# Anexo B — Decisiones de negocio, no de código

No las puede resolver Claude Code. Van aquí para que no se pierdan.

1. **¿Telegram es oferta comercial o no?** Se menciona como canal objetivo, pero no aparece
   en la web, ni en los planes, ni en los prompts, y en el código solo se usa como canal
   interno de aviso. O se implementa y se anuncia, o se saca del discurso. Es el canal más
   barato de añadir de los tres que faltan.
2. **Casos de éxito reales con cifras.** `hiredatavision-bot` y `myxu-costura-bot` ya están
   entregados y funcionando. Son la prueba del modelo y no aparecen en la web.
3. **Localización a Colombia** (USD/COP en los precios, y revisar la promesa de "48h" con el
   huso horario).
4. **Autoagenda (Calendly / Cal.com).** Hoy el CTA fuerte es "Agenda tu demo" y detrás hay un
   formulario, no un calendario. Cada paso que se quita entre el interés y la reunión se nota.
5. **El KV a 0 operaciones dice que WhatsApp tampoco se usa.** Antes de invertir en más
   canales, merece la pena entender por qué el canal principal del producto no recibe tráfico:
   ¿el número no está publicado, no está verificado, o simplemente no llega nadie?
