/* ════════════════════════════════════════════════════════════════════════
   Velai — funnel.js
   Fundación de medición para los funnels de pauta y SEO.

   Medición con consentimiento separado y minimización de parámetros:
     1. Google Consent Mode v2 (por defecto DENEGADO hasta que el usuario acepta).
     2. Banner de consentimiento bilingüe (ES/EN), self-hosted, sin CMP externo.
     3. Captura de campaña acotada después del permiso, sin texto libre.
     4. Eventos de embudo y conversiones en los destinos propios de VELAI.

   CONFIGURACIÓN: se lee de objetos globales definidos INLINE en cada HTML
   (que tiene cache corto), no aquí (este archivo es immutable 1 año):

     <script>
       window.VELAI_TRACK = { ga4:'', ads:'', adsLabel:'', pixel:'' };
       window.VELAI_WA    = '15706160059';   // número del bot Vai (Twilio)
     </script>
     <script src="/assets/funnel.js?v=10" defer></script>

   Mientras los IDs estén vacíos, el banner y los UTM funcionan igual; los
   tags de Google/Meta simplemente no se cargan. Rellena los IDs y redeploy.
   Si cambias la LÓGICA de este archivo, sube el ?v=N para bustear la caché.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CFG = window.VELAI_TRACK || {};
  var WA = window.VELAI_WA || '15706160059';
  var LS_CONSENT = 'velai-consent-v2';
  var consent = { analytics: false, advertising: false };
  var SS_UTM = 'velai-utm';              // first-touch UTM (sessionStorage)

  // ── idioma (compartido con el resto del sitio) ──
  function lang() {
    // Safari con cookies bloqueadas lanza SecurityError en localStorage: sin el
    // try/catch no se pintaba ni el banner de consentimiento.
    var l = null;
    try { l = localStorage.getItem('velai-lang'); } catch (e) {}
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
  try { var saved = JSON.parse(localStorage.getItem(LS_CONSENT)); if (saved && saved.version === 2) storedConsent = saved; } catch (e) {}
  gtag('set', 'ads_data_redaction', true);
  gtag('set', 'url_passthrough', false);

  // ════ UTM: capturar y persistir (first-touch) ════
  function captureUTM() {
    var params = new URLSearchParams(window.location.search);
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
    var fresh = {};
    var hasFresh = false;
    keys.forEach(function (k) {
      var v = params.get(k);
      if (v && /^[a-zA-Z0-9_.~-]{1,160}$/.test(v) && !/\d{7,}/.test(v) && (consent.advertising || (k !== 'gclid' && k !== 'fbclid'))) { fresh[k] = v; hasFresh = true; }
    });
    var stored = {};
    try { stored = JSON.parse(sessionStorage.getItem(SS_UTM) || '{}'); } catch (e) {}
    // first-touch: solo guardamos si aún no había nada
    if (hasFresh && !Object.keys(stored).length) {
      try { sessionStorage.setItem(SS_UTM, JSON.stringify(fresh)); } catch (e) {}
      return fresh;
    }
    var result = Object.keys(stored).length ? stored : fresh;
    var clean = {};
    keys.forEach(function(k){ var v=result[k]; if(typeof v==='string' && /^[a-zA-Z0-9_.~-]{1,160}$/.test(v) && !/\d{7,}/.test(v) && (consent.advertising || (k!=='gclid' && k!=='fbclid'))) clean[k]=v; });
    return clean;
  }
  var UTM = {};
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
      script.onerror = function () {
        turnstileLoader = null;   // no cachear el fallo: el siguiente intento reinserta el script
        script.remove();
        reject(new Error('turnstile_load_failed'));
      };
      document.head.appendChild(script);
    });
    return turnstileLoader;
  }
  // Un solo widget Turnstile en la página: dos execute() solapados (formulario + chat)
  // se pisaban el widget y el segundo mataba el callback del primero. Se serializan.
  var humanQueue = Promise.resolve();
  window.VELAI_HUMAN = {
    execute: function (action) {
      var run = function () { return doHumanExecute(action); };
      humanQueue = humanQueue.then(run, run);
      return humanQueue;
    }
  };
  function doHumanExecute(action) {
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
  var googleLoaded = false, gaConfigured = false, adsConfigured = false;
  function safePage() {
    var u = new URL(location.origin + location.pathname);
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function(k){if(UTM[k])u.searchParams.set(k,UTM[k]);});
    return u.href;
  }
  function safeReferrer(){try{var u=new URL(document.referrer);return u.origin+u.pathname;}catch(_){return '';}}
  function loadGoogle() {
    if (!googleLoaded && ((consent.analytics && CFG.ga4) || (consent.advertising && CFG.ads))) {
      googleLoaded = true;
      var s = document.createElement('script');s.async=true;
      s.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(consent.analytics && CFG.ga4 ? CFG.ga4 : CFG.ads);
      document.head.appendChild(s);gtag('js',new Date());
    }
    if(consent.analytics && CFG.ga4 && !gaConfigured){
      gaConfigured=true;
      gtag('config',CFG.ga4,{send_page_view:false,page_location:safePage(),page_referrer:safeReferrer(),allow_google_signals:false,allow_ad_personalization_signals:false,allow_enhanced_conversions:false});
      gtag('event','page_view',{send_to:CFG.ga4,page_location:safePage(),page_referrer:safeReferrer()});
    }
    if(consent.advertising && CFG.ads && !adsConfigured){adsConfigured=true;gtag('config',CFG.ads,{send_page_view:false,allow_enhanced_conversions:false});}
  }
  var pixelLoaded = false;
  function loadPixel() {
    if(pixelLoaded || !CFG.pixel || !consent.advertising)return;
    pixelLoaded=true;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=true;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=true;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('set','autoConfig',false,CFG.pixel);window.fbq('consent','grant');window.fbq('init',CFG.pixel);window.fbq('trackSingle',CFG.pixel,'PageView');
  }
  var cloudflareLoaded=false;
  function loadCloudflareAnalytics(){
    if(!consent.analytics || cloudflareLoaded || document.querySelector('script[data-cf-beacon]'))return;
    cloudflareLoaded=true;var s=document.createElement('script');s.defer=true;s.src='https://static.cloudflareinsights.com/beacon.min.js';s.dataset.cfBeacon=JSON.stringify({token:'cfa66a7600f94512ac2e595181c8d04d'});document.head.appendChild(s);
  }
  function clearMeasurementCookies(){
    document.cookie.split(';').forEach(function(part){var name=part.trim().split('=')[0];if(!/^(_ga($|_)|_gid$|_gat($|_)|_gcl_|_fbp$|_fbc$)/.test(name))return;
      ['',location.hostname,'.'+location.hostname,'.hirevai.com'].forEach(function(domain){document.cookie=name+'=; Max-Age=0; path=/'+(domain?'; domain='+domain:'')+'; SameSite=Lax';});
    });
  }
  function applyConsent(next,persist){
    var old=consent;consent={analytics:next.analytics===true,advertising:next.advertising===true};
    window['ga-disable-'+CFG.ga4]=!consent.analytics;
    gtag('consent','update',{analytics_storage:consent.analytics?'granted':'denied',ad_storage:consent.advertising?'granted':'denied',ad_user_data:consent.advertising?'granted':'denied',ad_personalization:consent.advertising?'granted':'denied'});
    if(!consent.advertising && window.fbq)window.fbq('consent','revoke');
    var persisted=!persist;
    if(persist){try{localStorage.setItem(LS_CONSENT,JSON.stringify({version:2,analytics:consent.analytics,advertising:consent.advertising}));persisted=true;}catch(_){}}
    if((old.analytics&&!consent.analytics)||(old.advertising&&!consent.advertising)){
      clearMeasurementCookies();try{sessionStorage.removeItem(SS_UTM);}catch(_){}UTM={};
      if(persisted){location.reload();return;}
    }
    if(consent.analytics || consent.advertising)UTM=captureUTM();
    decorateWaLinks();loadGoogle();loadPixel();loadCloudflareAnalytics();
  }
  var CONV={whatsapp_click:1,demo_click:1,lead_submit:1,calc_complete:1,quiz_complete:1,quote_complete:1};
  var EVENTS=['whatsapp_click','demo_click','lead_submit','lead_disqualified','lead_error','calc_complete','quiz_complete','quote_complete','quiz_lead_saved','wa_link_generated','wa_link_test','chat_view','chat_teaser_shown','chat_open','chat_first_message','chat_message','chat_reply','chat_error','chat_cta_blog','chat_cta_resultado','demo_chat_click','chat_cta_click','chat_cta_pricing','geo_chatgpt','geo_claude','geo_perplexity'];
  function cleanParams(params){
    var clean={page_location:safePage(),page_referrer:safeReferrer()};
    ['location','source','demo','sector','plan','stored','test'].forEach(function(k){var v=params[k];if(typeof v==='string' && /^[a-zA-Z0-9_. -]{1,60}$/.test(v) && !/\d{7,}/.test(v))clean[k]=v;});
    ['n','score','volume'].forEach(function(k){if(typeof params[k]==='number' && Number.isFinite(params[k]))clean[k]=params[k];});
    return clean;
  }
  window.VELAI_measurementPreferences=function(){return Object.assign({},consent);};
  window.velaiTrack=function(name,params){
    if(!EVENTS.includes(name))return;
    var clean=cleanParams(params||{});
    if(consent.analytics && CFG.ga4)gtag('event',name,Object.assign({send_to:CFG.ga4},clean));
    if(consent.advertising && CFG.ads && CFG.adsLabel && CONV[name])gtag('event','conversion',{send_to:CFG.ads+'/'+CFG.adsLabel,page_location:safePage(),page_referrer:safeReferrer()});
    if(consent.advertising && window.fbq){var fbMap={whatsapp_click:'Contact',demo_click:'Lead',lead_submit:'Lead',calc_complete:'Lead',quiz_complete:'Lead',quote_complete:'Lead'};window.fbq('trackSingleCustom',CFG.pixel,name,clean);if(fbMap[name])window.fbq('trackSingle',CFG.pixel,fbMap[name],clean);}
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

  // ════ Preferencias: categorías independientes, sin proveedores antes del permiso ════
  var TXT={es:{msg:'Tú decides: la analítica mide visitas e interacciones; la publicidad mide campañas con Google Ads y Meta. Son opcionales.',accept:'Aceptar todas',reject:'Solo esenciales',settings:'Configurar',save:'Guardar preferencias',close:'Cerrar',analytics:'Analítica',advertising:'Publicidad',more:'Privacidad y cookies',manage:'Configurar cookies'},en:{msg:'Your choice: analytics measures visits and interactions; advertising measures campaigns with Google Ads and Meta. Both are optional.',accept:'Accept all',reject:'Essentials only',settings:'Settings',save:'Save preferences',close:'Close',analytics:'Analytics',advertising:'Advertising',more:'Privacy and cookies',manage:'Cookie settings'}};
  var returnFocus=null;
  function injectStyles(){if(document.getElementById('velai-consent-style'))return;var st=document.createElement('style');st.id='velai-consent-style';st.textContent='#velai-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:10001;max-width:760px;margin:auto;background:#170f17;color:#fff8f4;border:1px solid #e68b60;border-radius:16px;padding:20px;font:15px/1.55 system-ui;box-shadow:0 18px 50px #0007;max-height:calc(100dvh - 32px);overflow:auto}#velai-consent p{margin:0 0 14px}#velai-consent a{color:#ffb48b}#velai-consent .vc-btns{display:flex;gap:10px;flex-wrap:wrap}#velai-consent button{font:700 14px system-ui;min-height:44px;padding:10px 14px;cursor:pointer;border:1px solid #ffb48b;border-radius:9px;background:#fff4ed;color:#54230e}#velai-consent button:focus-visible,#velai-consent input:focus-visible{outline:3px solid #ffa53e;outline-offset:3px}#velai-consent label{display:flex;justify-content:space-between;gap:20px;padding:12px 0;border-top:1px solid #ffffff30}#velai-consent input{width:24px;height:24px;accent-color:#ef6d2c}html:has(#velai-consent) #vaiWidget{visibility:hidden!important}#velai-cookie-manage{position:fixed;left:12px;bottom:8px;z-index:10000;min-height:34px;background:#fff4ed;color:#54230e;border:1px solid #b76a3e;border-radius:8px;font:12px system-ui;padding:7px 10px;cursor:pointer}@media(max-width:560px){#velai-consent{padding:16px}#velai-consent .vc-btns button{flex:1 1 120px}}';document.head.appendChild(st);}
  function showBanner(settings){
    if(document.getElementById('velai-consent'))return;
    injectStyles();returnFocus=document.activeElement;var t=TXT[lang()],el=document.createElement('section');el.id='velai-consent';el.className='show';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label',t.manage);
    el.innerHTML='<p>'+t.msg+' <a href="/privacidad/">'+t.more+'</a>.</p>'+(settings?'<label>'+t.analytics+'<input type="checkbox" name="analytics" '+(consent.analytics?'checked':'')+'></label><label>'+t.advertising+'<input type="checkbox" name="advertising" '+(consent.advertising?'checked':'')+'></label>':'')+'<div class="vc-btns">'+(settings?'<button type="button" data-action="save">'+t.save+'</button><button type="button" data-action="close">'+t.close+'</button>':'<button type="button" data-action="accept">'+t.accept+'</button><button type="button" data-action="reject">'+t.reject+'</button><button type="button" data-action="settings">'+t.settings+'</button>')+'</div>';
    function close(){el.remove();if(returnFocus&&returnFocus.isConnected)returnFocus.focus();}
    el.querySelectorAll('[data-action]').forEach(function(b){b.onclick=function(){var a=b.dataset.action;if(a==='settings'){close();showBanner(true);return;}if(a==='close'){close();return;}var next=a==='accept'?{analytics:true,advertising:true}:a==='save'?{analytics:el.querySelector('[name=analytics]').checked,advertising:el.querySelector('[name=advertising]').checked}:{};applyConsent(next,true);close();};});
    el.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){var nodes=el.querySelectorAll('a,input,button'),first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
    document.body.appendChild(el);el.querySelector('input,button').focus();
  }
  window.VELAI_openConsent=function(){showBanner(true);};
  function init(){
    decorateWaLinks();wireEvents();injectStyles();
    var manage=document.createElement('button');manage.id='velai-cookie-manage';manage.type='button';manage.textContent=TXT[lang()].manage;manage.onclick=window.VELAI_openConsent;document.body.appendChild(manage);
    if(storedConsent)applyConsent(storedConsent,false);else showBanner(false);
    window.addEventListener('storage',function(e){if(e.key===LS_CONSENT){try{var next=JSON.parse(e.newValue);if(next&&next.version===2)applyConsent(next,false);}catch(_){}}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
