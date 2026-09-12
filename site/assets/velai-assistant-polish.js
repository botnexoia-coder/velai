(function () {
  'use strict';

  // Cosmetic opt-in only. The original widget owns all chat/network behavior.
  var config = window.VELAI_ASSISTANT_UI;
  if (!config || typeof config !== 'object' || window.__velaiAssistantPolish) return;
  if (/dialogos/i.test(String(window.VELAI_TENANT || config.tenant || ''))) return;
  window.__velaiAssistantPolish = true;

  var name = String(config.name || 'Vai').slice(0, 40);
  var language;
  var messages = {
    es: { talk: 'Hablar con ', close: 'Cerrar conversación', title: '¿En qué puedo ayudarte?', copy: 'Cuéntame qué necesitas y te ayudo a encontrar el siguiente paso.', cta: 'Iniciar conversación', dismiss: 'Cerrar sugerencia' },
    en: { talk: 'Talk to ', close: 'Close conversation', title: 'How can I help?', copy: 'Tell me what you need and I can help you find the next step.', cta: 'Start conversation', dismiss: 'Dismiss suggestion' },
    fr: { talk: 'Parler à ', close: 'Fermer la conversation', title: 'Comment puis-je vous aider ?', copy: 'Dites-moi ce dont vous avez besoin pour trouver la prochaine étape.', cta: 'Commencer la conversation', dismiss: 'Fermer la suggestion' }
  };
  var text;
  var teaserConfig;
  var syncLauncher = function () {};
  function selectLanguage() {
    language = (document.documentElement.lang || navigator.language || 'es').toLowerCase().split('-')[0];
    text = messages[language] || messages.es;
    teaserConfig = config.teaser && (config.teaser[language] || config.teaser.es || config.teaser);
    if (!teaserConfig || typeof teaserConfig !== 'object') teaserConfig = {};
  }
  selectLanguage();

  var style = document.createElement('style');
  style.id = 'velai-assistant-polish-style';
  style.textContent = [
    '#vaiWidget.va-ui{--va-primary:#b83e08;--va-secondary:#582b19;--va-accent:#ff914f;--va-consent-lift:0px;--va-effective-lift:max(var(--vai-lift,0px),var(--va-consent-lift,0px));bottom:calc(24px + var(--va-effective-lift))}',
    '#vaiWidget.va-ui #vaiWindow{max-height:max(0px,calc(100dvh - 108px - var(--va-effective-lift)));min-height:0}',
    '#vaiWidget.va-ui #vaiTeaser[data-va-polished]{max-height:max(0px,calc(100dvh - 114px - var(--va-effective-lift)));overflow-y:auto}',
    '@media(max-width:480px){#vaiWidget.va-ui #vaiWindow{bottom:calc(96px + var(--va-effective-lift));height:max(0px,calc(100dvh - 108px - var(--va-effective-lift)));border-radius:16px 16px 0 0}}',
    '#vaiWidget.va-ui #vaiBubble.va-launcher{box-sizing:border-box;display:flex;width:auto;min-width:190px;max-width:calc(100vw - 48px);height:64px;padding:6px 17px 6px 7px;gap:10px;border:2px solid var(--va-accent);border-radius:40px;background:linear-gradient(135deg,var(--va-primary),var(--va-secondary));color:#fff;font-family:inherit;text-align:left;box-shadow:0 8px 28px #0003;isolation:isolate}',
    '#vaiWidget.va-ui #vaiBubble.va-launcher::before{content:"";position:absolute;inset:0;border-radius:inherit;background:#0003;z-index:-1}',
    '#vaiWidget.va-ui #vaiBubble.va-launcher:hover{transform:translateY(-2px)}',
    '#vaiWidget.va-ui #vaiBubble.va-launcher:focus-visible,#vaiWidget.va-ui .va-teaser-cta:focus-visible,#vaiWidget.va-ui #vaiTeaserX:focus-visible{outline:3px solid var(--va-accent);outline-offset:4px}',
    '#vaiWidget.va-ui .va-launcher #vaiIconChat,#vaiWidget.va-ui .va-launcher #vaiPulse{display:none!important}',
    '#vaiWidget.va-ui .va-face{position:relative;display:grid;place-items:center;width:46px;height:46px;flex:none;border-radius:50%;background:#fff;color:#172033;font-weight:800;font-size:21px}',
    '#vaiWidget.va-ui .va-face img{position:absolute;inset:0;display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;object-position:50% 25%}',
    '#vaiWidget.va-ui .va-face::after{content:"";position:absolute;right:-2px;bottom:0;width:12px;height:10px;border:2px solid #fff;border-radius:5px 5px 5px 0;background:var(--va-accent)}',
    '#vaiWidget.va-ui .va-label{display:block;min-width:0;font-size:13px;font-weight:750;line-height:1.3}',
    '#vaiWidget.va-ui .va-label>span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#vaiWidget.va-ui .va-label small{display:block;margin-top:3px;color:#fff;font-size:10px;font-weight:750;letter-spacing:.055em;white-space:nowrap}',
    '#vaiWidget.va-ui .va-launcher[data-va-open="true"] .va-face{display:none}',
    '#vaiWidget.va-ui .va-launcher[data-va-open="true"] #vaiIconClose{flex:none;margin:0 9px}',
    '#vaiWidget.va-ui #vaiTeaser{box-sizing:border-box;bottom:78px;width:min(312px,calc(100vw - 48px));padding:18px 42px 18px 20px;border:1px solid var(--va-accent);border-radius:22px 22px 5px 22px;background:linear-gradient(145deg,#202736,#111722);color:#fff;box-shadow:0 16px 40px #0004;text-align:left;line-height:1.4;overflow:hidden}',
    '#vaiWidget.va-ui #vaiTeaser::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:linear-gradient(var(--va-accent),var(--va-primary))}',
    '#vaiWidget.va-ui #vaiTeaserX{top:6px;right:6px;width:32px;height:32px;color:#dbe3ef;border-radius:50%;font-size:18px}',
    '#vaiWidget.va-ui .va-teaser-kicker{display:block;margin-bottom:8px;color:#e2e8f2;font-size:10px;font-weight:750;letter-spacing:.06em}',
    '#vaiWidget.va-ui .va-teaser-title{display:block;font-size:18px;line-height:1.25;font-weight:800;color:#fff}',
    '#vaiWidget.va-ui .va-teaser-copy{display:block;margin-top:6px;color:#ced7e5;font-size:13px;line-height:1.5}',
    '#vaiWidget.va-ui .va-teaser-cta{display:inline-block;margin-top:12px;padding:0;border:0;background:none;color:#fff;font:inherit;font-size:13px;font-weight:750;text-decoration:underline;text-underline-offset:4px;cursor:pointer;text-align:left}',
    '@media(max-width:767px){#vaiWidget.va-ui #vaiBubble.va-launcher{min-width:0;max-width:calc(100vw - 32px);height:58px;padding:5px 12px 5px 6px;gap:8px}#vaiWidget.va-ui .va-face{width:42px;height:42px}#vaiWidget.va-ui .va-label{font-size:12px}#vaiWidget.va-ui .va-label small{font-size:9px;letter-spacing:.025em}#vaiWidget.va-ui #vaiTeaser{display:none!important;visibility:hidden!important;pointer-events:none!important}}',
    '@media(prefers-reduced-motion:reduce){#vaiWidget.va-ui,#vaiWidget.va-ui #vaiBubble.va-launcher,#vaiWidget.va-ui #vaiTeaser{transition:none!important;animation:none!important}#vaiWidget.va-ui #vaiBubble.va-launcher:hover{transform:none}}'
  ].join('\n');
  document.head.appendChild(style);

  function element(tag, className, content) {
    var node = document.createElement(tag);
    node.className = className;
    if (content) node.textContent = content;
    return node;
  }

  // External sites own their consent banners. Native #velai-consent already
  // contributes --vai-lift, so use max() rather than adding the two offsets.
  var consentNodes = [];
  var consentFrame = 0;
  var consentResize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleConsentMeasure) : null;
  function measureConsent() {
    consentFrame = 0;
    var root = document.getElementById('vaiWidget');
    var bubble = document.getElementById('vaiBubble');
    if (!root || !bubble) return;
    var bubbleRect = bubble.getBoundingClientRect();
    var viewportHeight = window.innerHeight;
    var lift = 0;
    consentNodes.forEach(function (banner) {
      if (!banner.isConnected) return;
      var computed = window.getComputedStyle(banner);
      var rect = banner.getBoundingClientRect();
      if (banner.hidden || computed.display === 'none' || computed.visibility === 'hidden' || Number(computed.opacity) === 0 || rect.width <= 0 || rect.height <= 0) return;
      if (rect.bottom <= 0 || rect.top >= viewportHeight || rect.right <= bubbleRect.left || rect.left >= bubbleRect.right) return;
      // Anchor from the viewport, not the already-lifted bubble's vertical
      // position, so observing a banner cannot cause lift/reset oscillation.
      lift = Math.max(lift, viewportHeight - Math.max(0, rect.top) + 12 - 24);
    });
    var value = Math.ceil(Math.max(0, lift)) + 'px';
    if (root.style.getPropertyValue('--va-consent-lift') !== value) root.style.setProperty('--va-consent-lift', value);
  }
  function scheduleConsentMeasure() {
    if (!consentFrame) consentFrame = requestAnimationFrame(measureConsent);
  }
  function discoverConsent() {
    ['cookieBanner', 'ckb'].forEach(function (id) {
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
  consentMount.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', scheduleConsentMeasure);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleConsentMeasure);
  discoverConsent();

  function decorateLauncher() {
    var root = document.getElementById('vaiWidget');
    var bubble = document.getElementById('vaiBubble');
    var panel = document.getElementById('vaiWindow');
    if (!root || !bubble || !panel) return false;
    if (bubble.dataset.vaPolished) return true;
    // Restrict tokens to valid CSS colors; no configuration is inserted into CSS text.
    ['primary', 'secondary', 'accent'].forEach(function (key) {
      if (typeof config[key] === 'string' && window.CSS && CSS.supports('color', config[key])) {
        root.style.setProperty('--va-' + key, config[key]);
      }
    });
    root.classList.add('va-ui');
    scheduleConsentMeasure();
    var face = element('span', 'va-face', name.charAt(0).toUpperCase());
    face.setAttribute('aria-hidden', 'true');
    if (typeof config.portrait === 'string' && config.portrait) {
      var portrait = document.createElement('img');
      portrait.alt = '';
      portrait.width = 46;
      portrait.height = 46;
      portrait.addEventListener('error', function () { portrait.remove(); }, { once: true });
      portrait.src = config.portrait;
      face.appendChild(portrait);
    }
    var label = element('span', 'va-label');
    label.setAttribute('aria-hidden', 'true');
    var title = element('span', 'va-launcher-title');
    label.appendChild(title);
    var badge = element('small', '', 'ASISTENTE IA · VELAI');
    badge.lang = 'es';
    label.appendChild(badge);
    // Append only: preserve the button, SVG nodes and all widget listeners.
    bubble.appendChild(face);
    bubble.appendChild(label);
    bubble.classList.add('va-launcher');
    if (consentResize) consentResize.observe(bubble);
    bubble.dataset.vaPolished = 'true';
    bubble.setAttribute('aria-controls', 'vaiWindow');
    bubble.setAttribute('aria-haspopup', 'dialog');
    function sync() {
      var open = panel.classList.contains('is-open');
      var value = String(open);
      var visible = open ? text.close : text.talk + name;
      var accessible = visible + ' · ASISTENTE IA · VELAI';
      // Equality guards prevent feedback loops when branding updates aria-label.
      if (bubble.dataset.vaOpen !== value) bubble.dataset.vaOpen = value;
      if (bubble.getAttribute('aria-expanded') !== value) bubble.setAttribute('aria-expanded', value);
      if (bubble.getAttribute('aria-label') !== accessible) bubble.setAttribute('aria-label', accessible);
      if (title.textContent !== visible) title.textContent = visible;
    }
    syncLauncher = sync;
    sync();
    var state = new MutationObserver(sync);
    state.observe(panel, { attributes: true, attributeFilter: ['class'] });
    state.observe(bubble, { attributes: true, attributeFilter: ['aria-label'] });
    return true;
  }

  function decorateTeaser() {
    var teaser = document.getElementById('vaiTeaser');
    if (!teaser) return false;
    if (teaser.dataset.vaPolished) return true;
    var close = teaser.querySelector('#vaiTeaserX');
    // Retain the original close button and its stopPropagation/dismiss handler.
    Array.prototype.slice.call(teaser.childNodes).forEach(function (node) {
      if (node !== close) teaser.removeChild(node);
    });
    if (close) close.setAttribute('aria-label', text.dismiss);
    var kicker = element('span', 'va-teaser-kicker', name + ' · ASISTENTE IA · VELAI');
    kicker.lang = 'es';
    teaser.appendChild(kicker);
    teaser.appendChild(element('strong', 'va-teaser-title', teaserConfig.title || text.title));
    teaser.appendChild(element('span', 'va-teaser-copy', teaserConfig.copy || text.copy));
    var cta = element('button', 'va-teaser-cta', (teaserConfig.cta || text.cta) + ' →');
    cta.type = 'button';
    cta.setAttribute('aria-label', teaserConfig.cta || text.cta);
    // Keyboard activation bubbles to the widget's existing teaser click handler.
    teaser.appendChild(cta);
    teaser.dataset.vaPolished = 'true';
    return true;
  }

  function syncTeaserLanguage() {
    var teaser = document.getElementById('vaiTeaser');
    if (!teaser || !teaser.dataset.vaPolished) return;
    var updates = {
      '.va-teaser-title': teaserConfig.title || text.title,
      '.va-teaser-copy': teaserConfig.copy || text.copy,
      '.va-teaser-cta': (teaserConfig.cta || text.cta) + ' →'
    };
    Object.keys(updates).forEach(function (selector) {
      var node = teaser.querySelector(selector);
      if (node && node.textContent !== updates[selector]) node.textContent = updates[selector];
    });
    var close = teaser.querySelector('#vaiTeaserX');
    var cta = teaser.querySelector('.va-teaser-cta');
    if (cta) cta.setAttribute('aria-label', teaserConfig.cta || text.cta);
    if (close && close.getAttribute('aria-label') !== text.dismiss) close.setAttribute('aria-label', text.dismiss);
  }

  // Language switches update copy in place: no duplicate nodes or event handlers.
  var localeObserver = new MutationObserver(function () {
    selectLanguage();
    syncLauncher();
    syncTeaserLanguage();
  });
  localeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  var launcherReady = decorateLauncher();
  var teaserReady = decorateTeaser();
  if (!launcherReady || !teaserReady) {
    var mount = new MutationObserver(function () {
      if (!launcherReady) launcherReady = decorateLauncher();
      if (!teaserReady) teaserReady = decorateTeaser();
      if (launcherReady && teaserReady) mount.disconnect();
    });
    mount.observe(document.documentElement, { childList: true, subtree: true });
    // Some visits suppress the teaser by session preference; do not observe forever.
    var delay = Number((window.VELAI_CHAT || {}).teaserDelay) || 18000;
    setTimeout(function () { mount.disconnect(); }, Math.max(60000, delay + 10000));
  }
})();
