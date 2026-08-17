/* ════════════════════════════════════════════════════════════════════════
   Velai — funnel.js
   Fundación de medición para los funnels de pauta y SEO.

   Hace 4 cosas, todas respetando RGPD:
     1. Google Consent Mode v2 (por defecto DENEGADO hasta que el usuario acepta).
     2. Banner de consentimiento bilingüe (ES/EN), self-hosted, sin CMP externo.
     3. Captura y persistencia de UTM / gclid / fbclid (atribución end-to-end).
     4. Wiring de eventos de conversión + anexado de UTM a los enlaces wa.me.

   CONFIGURACIÓN: se lee de objetos globales definidos INLINE en cada HTML
   (que tiene cache corto), no aquí (este archivo es immutable 1 año):

     <script>
       window.VELAI_TRACK = { ga4:'', ads:'', adsLabel:'', pixel:'' };
       window.VELAI_WA    = '15706160059';   // número del bot Vai (Twilio)
     </script>
     <script src="/assets/funnel.js?v=4" defer></script>

   Mientras los IDs estén vacíos, el banner y los UTM funcionan igual; los
   tags de Google/Meta simplemente no se cargan. Rellena los IDs y redeploy.
   Si cambias la LÓGICA de este archivo, sube el ?v=N para bustear la caché.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CFG = window.VELAI_TRACK || {};
  var WA = window.VELAI_WA || '15706160059';
  var LS_CONSENT = 'velai-consent';      // 'granted' | 'denied'
  var SS_UTM = 'velai-utm';              // first-touch UTM (sessionStorage)

  // ── idioma (compartido con el resto del sitio) ──
  function lang() {
    var l = localStorage.getItem('velai-lang');
    if (l === 'en' || l === 'es') return l;
    return (document.documentElement.lang === 'en') ? 'en' : 'es';
  }

  // ── dataLayer / gtag stub (debe existir antes de cargar nada) ──
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  // ════ 1. CONSENT MODE v2 — denegado por defecto ════
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500
  });

  var storedConsent = null;
  try { storedConsent = localStorage.getItem(LS_CONSENT); } catch (e) {}

  // ════ UTM: capturar y persistir (first-touch) ════
  function captureUTM() {
    var params = new URLSearchParams(window.location.search);
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
    var fresh = {};
    var hasFresh = false;
    keys.forEach(function (k) {
      var v = params.get(k);
      if (v) { fresh[k] = v; hasFresh = true; }
    });
    var stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(SS_UTM) || '{}'); } catch (e) {}
    // first-touch: solo guardamos si aún no había nada
    if (hasFresh && !Object.keys(stored).length) {
      try { sessionStorage.setItem(SS_UTM, JSON.stringify(fresh)); } catch (e) {}
      return fresh;
    }
    return Object.keys(stored).length ? stored : fresh;
  }
  var UTM = captureUTM();
  window.VELAI_getUTM = function () { return UTM; };

  // Turnstile se carga solo cuando el usuario intenta enviar datos o el primer
  // mensaje del chat. La site key es pública y se define inline en el HTML.
  var turnstileLoader = null;
  var turnstileWidget = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (turnstileLoader) return turnstileLoader;
    turnstileLoader = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true; script.defer = true;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('turnstile_load_failed')); };
      document.head.appendChild(script);
    });
    return turnstileLoader;
  }
  window.VELAI_HUMAN = {
    execute: function (action) {
      var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
      var sitekey = window.VELAI_TURNSTILE_SITEKEY || '';
      // El marcador del repo cuenta como "sin configurar": mejor un error claro
      // que un widget que renderiza y falla en silencio.
      if (/^REPLACE_WITH/.test(sitekey)) sitekey = '';
      if (!sitekey && local) sitekey = '1x00000000000000000000AA';
      if (!sitekey) return Promise.reject(new Error('turnstile_not_configured'));
      return loadTurnstile().then(function () {
        return new Promise(function (resolve, reject) {
          var host = document.getElementById('velai-turnstile');
          if (!host) {
            host = document.createElement('div'); host.id = 'velai-turnstile';
            host.style.cssText = 'position:fixed;left:-9999px;bottom:0';
            document.body.appendChild(host);
          }
          if (turnstileWidget != null) window.turnstile.remove(turnstileWidget);
          var timer = setTimeout(function () { reject(new Error('turnstile_timeout')); }, 12000);
          // El modo invisible lo define el TIPO de widget creado en el dashboard de
          // Turnstile ('size' no admite 'invisible' en el API); execution:'execute'
          // difiere el challenge hasta este punto.
          turnstileWidget = window.turnstile.render(host, {
            sitekey: sitekey, execution: 'execute', action: action,
            callback: function (token) { clearTimeout(timer); resolve(token); },
            'error-callback': function () { clearTimeout(timer); reject(new Error('turnstile_failed')); },
            'expired-callback': function () { clearTimeout(timer); reject(new Error('turnstile_expired')); }
          });
          window.turnstile.execute(turnstileWidget);
        });
      });
    }
  };

  // anexa los UTM persistidos a un href wa.me como texto pre-rellenado opcional
  // (no rompe el enlace; solo añade ?text si no lo tenía y queremos trazar campaña)
  function decorateWaLinks() {
    var qs = Object.keys(UTM).map(function (k) { return k + '=' + encodeURIComponent(UTM[k]); }).join('&');
    document.querySelectorAll('a[href*="wa.me/"], a[data-wa]').forEach(function (a) {
      // normaliza el número al del bot si usa data-wa
      if (a.hasAttribute('data-wa')) a.href = 'https://wa.me/' + WA;
      a.setAttribute('data-utm', qs);  // disponible para el handler de click/analítica
    });
  }

  // ════ Carga de tags (solo si hay IDs configurados) ════
  var googleLoaded = false;
  function loadGoogle() {
    if (googleLoaded || (!CFG.ga4 && !CFG.ads)) return;
    googleLoaded = true;
    var id = CFG.ga4 || CFG.ads;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
    gtag('js', new Date());
    if (CFG.ga4) gtag('config', CFG.ga4, { anonymize_ip: true });
    if (CFG.ads) gtag('config', CFG.ads);
  }

  var pixelLoaded = false;
  function loadPixel() {
    if (pixelLoaded || !CFG.pixel) return;
    pixelLoaded = true;
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', CFG.pixel);
    window.fbq('track', 'PageView');
  }

  // Google Consent Mode permite cargar gtag bajo 'denied' (pings sin cookies →
  // conversiones modeladas). Meta Pixel lo cargamos solo tras aceptación (RGPD).
  function applyConsent(state) {
    if (state === 'granted') {
      gtag('consent', 'update', {
        ad_storage: 'granted', ad_user_data: 'granted',
        ad_personalization: 'granted', analytics_storage: 'granted'
      });
      loadGoogle();
      loadPixel();
    } else {
      // denegado explícito: cargamos Google en modo cookieless (opcional) y NO pixel
      loadGoogle();
    }
  }

  // ════ 4. EVENTOS DE CONVERSIÓN ════
  // Eventos de alta intención que cuentan como conversión en pauta.
  var CONV = { whatsapp_click: 1, demo_click: 1, lead_submit: 1, calc_complete: 1, quiz_complete: 1, quote_complete: 1 };

  window.velaiTrack = function (name, params) {
    params = params || {};
    if (Object.keys(UTM).length) params = Object.assign({}, params, UTM);
    try { gtag('event', name, params); } catch (e) {}
    // Google Ads: registra la conversión (necesita `ads` AND `adsLabel`).
    // Sin esto, Google Ads no puede medir ni optimizar a conversión → pauta a ciegas.
    if (CFG.ads && CFG.adsLabel && CONV[name]) {
      try { gtag('event', 'conversion', { send_to: CFG.ads + '/' + CFG.adsLabel }); } catch (e) {}
    }
    if (window.fbq) {
      var fbMap = { whatsapp_click: 'Contact', demo_click: 'Lead', lead_submit: 'Lead', calc_complete: 'Lead', quiz_complete: 'Lead', quote_complete: 'Lead' };
      try { window.fbq('trackCustom', name, params); if (fbMap[name]) window.fbq('track', fbMap[name], params); } catch (e) {}
    }
  };

  function wireEvents() {
    // clic en cualquier enlace de WhatsApp (idempotente: no re-vincula)
    document.querySelectorAll('a[href*="wa.me/"], a[data-wa]').forEach(function (a) {
      if (a.__vw) return; a.__vw = 1;
      a.addEventListener('click', function () {
        window.velaiTrack('whatsapp_click', { location: a.getAttribute('data-loc') || 'cta' });
      });
    });
    // elementos marcados con data-conv="evento"
    document.querySelectorAll('[data-conv]').forEach(function (el) {
      if (el.__vw) return; el.__vw = 1;
      el.addEventListener('click', function () {
        window.velaiTrack(el.getAttribute('data-conv'), {});
      });
    });
  }

  // re-procesar enlaces/CTAs añadidos dinámicamente (quiz, formularios, etc.)
  window.VELAI_decorate = function () { decorateWaLinks(); wireEvents(); };

  // ════ 2. BANNER DE CONSENTIMIENTO (bilingüe, self-hosted) ════
  var TXT = {
    es: {
      msg: 'Usamos cookies propias y de terceros para medir el tráfico y mejorar nuestra publicidad. Puedes aceptarlas o seguir solo con las esenciales.',
      accept: 'Aceptar', reject: 'Solo esenciales', more: 'Más info'
    },
    en: {
      msg: 'We use first- and third-party cookies to measure traffic and improve our advertising. You can accept them or keep only the essential ones.',
      accept: 'Accept', reject: 'Essentials only', more: 'Learn more'
    }
  };

  function injectStyles() {
    if (document.getElementById('velai-consent-style')) return;
    var css = '' +
      '#velai-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:760px;margin:0 auto;' +
      'background:rgba(17,13,19,0.97);color:#FFF8F4;border:1px solid rgba(255,107,26,0.28);border-radius:16px;' +
      'box-shadow:0 18px 50px rgba(0,0,0,0.45);backdrop-filter:blur(14px);padding:18px 20px;' +
      'font-family:Satoshi,system-ui,sans-serif;font-size:.9rem;line-height:1.55;' +
      'display:flex;gap:16px;align-items:center;flex-wrap:wrap;justify-content:space-between;' +
      'opacity:0;transform:translateY(12px);transition:opacity .3s ease,transform .3s ease;}' +
      '#velai-consent.show{opacity:1;transform:translateY(0);}' +
      'body.light #velai-consent{background:rgba(245,240,236,0.98);color:#1A0D05;border-color:rgba(160,70,15,0.28);}' +
      '#velai-consent p{margin:0;flex:1 1 280px;color:inherit;}' +
      '#velai-consent a{color:#FF8C40;text-decoration:underline;text-underline-offset:2px;}' +
      '#velai-consent .vc-btns{display:flex;gap:10px;flex-shrink:0;}' +
      '#velai-consent button{font-family:Satoshi,system-ui,sans-serif;font-weight:700;font-size:.85rem;' +
      'border-radius:9px;padding:.6rem 1.05rem;cursor:pointer;border:1px solid transparent;transition:all .18s ease;white-space:nowrap;}' +
      '#velai-consent .vc-accept{background:#FF6B1A;color:#fff;}' +
      '#velai-consent .vc-accept:hover{background:#FF8C40;}' +
      '#velai-consent .vc-reject{background:transparent;color:inherit;border-color:rgba(255,107,26,0.4);}' +
      '#velai-consent .vc-reject:hover{background:rgba(255,107,26,0.1);}' +
      '@media(max-width:560px){#velai-consent{flex-direction:column;align-items:stretch;}#velai-consent .vc-btns{justify-content:stretch;}#velai-consent button{flex:1;}}';
    var st = document.createElement('style');
    st.id = 'velai-consent-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function showBanner() {
    var t = TXT[lang()];
    injectStyles();
    var el = document.createElement('div');
    el.id = 'velai-consent';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookies');
    el.innerHTML =
      '<p>' + t.msg + ' <a href="/privacidad/" rel="nofollow">' + t.more + '</a></p>' +
      '<div class="vc-btns">' +
      '<button class="vc-reject" type="button">' + t.reject + '</button>' +
      '<button class="vc-accept" type="button">' + t.accept + '</button>' +
      '</div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    function close(decision) {
      try { localStorage.setItem(LS_CONSENT, decision); } catch (e) {}
      applyConsent(decision);
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 320);
      window.velaiTrack('consent_' + decision, {});
    }
    el.querySelector('.vc-accept').addEventListener('click', function () { close('granted'); });
    el.querySelector('.vc-reject').addEventListener('click', function () { close('denied'); });
  }

  // ════ INIT ════
  function init() {
    decorateWaLinks();
    wireEvents();
    // Consent Mode v2: cargamos Google de inmediato en modo cookieless (el
    // consentimiento sigue 'denied' por defecto, sin cookies). Así la etiqueta
    // es detectable por Google y mide desde la primera visita, aunque el
    // usuario aún no haya tocado el banner. El Pixel de Meta NO se carga aquí.
    loadGoogle();
    if (storedConsent === 'granted' || storedConsent === 'denied') {
      applyConsent(storedConsent);   // ya decidió antes: aplica (carga Pixel si aceptó)
    } else {
      showBanner();                  // primera visita: pedir consentimiento
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
