/* ════════════════════════════════════════════════════════════════════════
   Velai — leadform.js
   Formulario cualificador de demo, reutilizable en home y landings.

   Uso: coloca un contenedor en cualquier página y carga este script:
     <div data-velai-leadform data-sector="Restaurante"></div>
     <script src="/assets/leadform.js?v=2" defer></script>

   - data-sector (opcional): pre-selecciona el sector (para landings verticales).
   - Bilingüe ES/EN (lee 'velai-lang').
   - Descalificación honesta: si el negocio recibe <10 mensajes/día, NO envía
     lead; muestra un mensaje honesto + enlace a guía gratuita.
   - Envía el lead a la ruta /lead del worker (que notifica por Telegram).
   - Incluye los UTM capturados por funnel.js (window.VELAI_getUTM) para
     atribución de campañas de pauta.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var WORKER = (window.VELAI_WORKER || 'https://vai-worker.botnexo-ia.workers.dev').replace(/\/$/, '');
  var WA = window.VELAI_WA || '15706160059';

  function lang() {
    var l = localStorage.getItem('velai-lang');
    if (l === 'en' || l === 'es') return l;
    return (document.documentElement.lang === 'en') ? 'en' : 'es';
  }

  var T = {
    es: {
      title: 'Pide tu demo personalizada',
      sub: 'Cuéntanos de tu negocio y te mostramos cómo lo atendería Vai. Sin compromiso.',
      name: 'Tu nombre', namePh: 'Ej. María García',
      wa: 'Tu WhatsApp', waPh: 'Ej. 612 345 678',
      sector: 'Sector', sectorPh: 'Elige tu sector',
      vol: 'Mensajes que recibes al día', volPh: 'Elige un rango',
      channel: 'Canal principal', channelPh: 'Elige un canal',
      who: '¿Quién responde hoy?', whoPh: 'Elige una opción',
      submit: 'Pedir demo →', sending: 'Enviando…',
      legal: 'Al enviar aceptas nuestra <a href="/privacidad/" target="_blank" rel="noopener">Política de Privacidad</a>. Usamos tus datos solo para contactarte sobre Velai.',
      okTitle: '¡Recibido! 🎉', okMsg: 'Te contactamos hoy mismo por WhatsApp. Si quieres, escríbenos ya:',
      okWa: 'Abrir WhatsApp →',
      errMsg: 'Ups, algo falló al enviar. Escríbenos directo por WhatsApp:',
      errRetry: 'No pudimos enviar tus datos. Vuelve a intentarlo o escríbenos por WhatsApp.',
      errHuman: 'No pudimos verificar que eres humano. Recarga la página e inténtalo de nuevo.',
      errRate: 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.',
      retry: 'Reintentar →',
      dqTitle: 'Sé honesto contigo: aún no nos necesitas',
      dqMsg: 'Con menos de 10 mensajes al día, automatizar todavía no te compensa. Mejor empieza por aquí — y vuelve cuando crezcas:',
      dqLink: 'Guía: cuánto cuesta (y cuándo conviene) un chatbot de IA →',
      required: 'Completa este campo',
      sectors: ['Restaurante / Hostelería', 'Clínica / Salud', 'Taller / Automoción', 'Inmobiliaria', 'Tienda / Retail', 'Barbería / Belleza', 'Hotel / Turismo', 'Otro'],
      vols: ['Menos de 10', '10 – 30', '30 – 60', '60 – 100', 'Más de 100'],
      channels: ['WhatsApp', 'Instagram', 'Web', 'Teléfono', 'Varios'],
      whos: ['Yo mismo/a', 'Un empleado', 'Varias personas', 'Nadie fijo']
    },
    en: {
      title: 'Get your personalized demo',
      sub: 'Tell us about your business and we’ll show you how Vai would handle it. No commitment.',
      name: 'Your name', namePh: 'e.g. María García',
      wa: 'Your WhatsApp', waPh: 'e.g. +34 612 345 678',
      sector: 'Industry', sectorPh: 'Choose your industry',
      vol: 'Messages you get per day', volPh: 'Choose a range',
      channel: 'Main channel', channelPh: 'Choose a channel',
      who: 'Who replies today?', whoPh: 'Choose an option',
      submit: 'Request demo →', sending: 'Sending…',
      legal: 'By submitting you accept our <a href="/privacidad/" target="_blank" rel="noopener">Privacy Policy</a>. We use your data only to contact you about Velai.',
      okTitle: 'Got it! 🎉', okMsg: 'We’ll contact you on WhatsApp today. If you like, message us now:',
      okWa: 'Open WhatsApp →',
      errMsg: 'Oops, something failed. Message us directly on WhatsApp:',
      errRetry: 'We couldn’t send your details. Try again or message us on WhatsApp.',
      errHuman: 'We couldn’t verify you’re human. Reload the page and try again.',
      errRate: 'Too many attempts in a row. Wait a minute and try again.',
      retry: 'Retry →',
      dqTitle: 'Honest take: you don’t need us yet',
      dqMsg: 'With fewer than 10 messages a day, automating isn’t worth it yet. Start here instead — and come back when you grow:',
      dqLink: 'Guide: how much an AI chatbot costs (and when it’s worth it) →',
      required: 'Please fill this field',
      sectors: ['Restaurant / Hospitality', 'Clinic / Health', 'Auto shop', 'Real estate', 'Shop / Retail', 'Barber / Beauty', 'Hotel / Tourism', 'Other'],
      vols: ['Fewer than 10', '10 – 30', '30 – 60', '60 – 100', 'More than 100'],
      channels: ['WhatsApp', 'Instagram', 'Web', 'Phone', 'Several'],
      whos: ['Myself', 'An employee', 'Several people', 'No one fixed']
    }
  };

  function injectStyles() {
    if (document.getElementById('velai-lf-style')) return;
    var css = '' +
      '.lf{max-width:560px;margin:0 auto;text-align:left;background:linear-gradient(180deg,var(--bg2),var(--surface));' +
      'border:1px solid var(--border2);border-radius:18px;padding:28px 26px;}' +
      '.lf h3{font-family:var(--font-d);font-weight:800;font-size:1.4rem;margin:0 0 6px;color:var(--white);letter-spacing:-.01em;}' +
      '.lf .lf-sub{color:var(--muted);font-size:.95rem;margin:0 0 20px;}' +
      '.lf .lf-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;}' +
      '.lf .lf-f{margin-bottom:14px;}' +
      '.lf label{display:block;font-size:.82rem;font-weight:600;color:var(--white);margin-bottom:6px;}' +
      '.lf input,.lf select{width:100%;background:var(--bg);border:1px solid var(--border2);border-radius:10px;' +
      'padding:11px 12px;color:var(--white);font-family:var(--font-b);font-size:.95rem;transition:border-color .15s ease;}' +
      'body.light .lf input,body.light .lf select{background:rgba(255,255,255,0.6);}' +
      '.lf input:focus,.lf select:focus{outline:none;border-color:var(--orange);}' +
      '.lf select{appearance:none;-webkit-appearance:none;cursor:pointer;' +
      'background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23FF8C40\' stroke-width=\'3\'%3E%3Cpath d=\'M6 9l6 6 6-6\'/%3E%3C/svg%3E");' +
      'background-repeat:no-repeat;background-position:right 12px center;padding-right:32px;}' +
      '.lf .lf-err{color:#ff6b6b;font-size:.76rem;margin-top:4px;display:none;}' +
      '.lf .lf-f.invalid .lf-err{display:block;}' +
      '.lf .lf-f.invalid input,.lf .lf-f.invalid select{border-color:#ff6b6b;}' +
      '.lf button.lf-submit{width:100%;margin-top:6px;background:var(--orange);color:#fff;border:none;border-radius:999px;' +
      'padding:14px 24px;font-family:var(--font-b);font-weight:700;font-size:1rem;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,background .18s ease;}' +
      '.lf button.lf-submit:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(255,107,26,.34);background:var(--orange2);}' +
      '.lf button.lf-submit:disabled{opacity:.6;cursor:default;transform:none;box-shadow:none;}' +
      '.lf .lf-legal{margin:10px 2px 0;font-size:.74rem;line-height:1.5;color:var(--muted);text-align:center;}' +
      '.lf .lf-legal a{color:var(--orange2);text-decoration:underline;text-underline-offset:2px;}' +
      '.lf .lf-result{text-align:center;padding:8px 0;}' +
      '.lf .lf-result h3{font-size:1.4rem;}' +
      '.lf .lf-result p{color:var(--muted);margin:0 0 18px;}' +
      '.lf .lf-result a.lf-wa{display:inline-block;background:var(--orange);color:#fff;padding:12px 24px;border-radius:999px;font-weight:700;}' +
      '.lf .lf-result a.lf-wa:hover{color:#fff;background:var(--orange2);}' +
      '.lf .lf-result a.lf-guide{color:var(--orange2);font-weight:600;text-decoration:underline;text-underline-offset:3px;}' +
      '@media(max-width:520px){.lf .lf-row{grid-template-columns:1fr;}}';
    var st = document.createElement('style');
    st.id = 'velai-lf-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function opts(arr, ph) {
    return '<option value="" disabled selected>' + ph + '</option>' +
      arr.map(function (o) { return '<option value="' + o.replace(/"/g, '&quot;') + '">' + o + '</option>'; }).join('');
  }

  function field(id, label, inner) {
    return '<div class="lf-f" data-f="' + id + '"><label for="lf-' + id + '">' + label + '</label>' + inner +
      '<div class="lf-err"></div></div>';
  }

  function render(container) {
    var t = T[lang()];
    var presetSector = container.getAttribute('data-sector') || '';
    injectStyles();

    var html = '<form class="lf" novalidate>' +
      '<h3>' + t.title + '</h3>' +
      '<p class="lf-sub">' + t.sub + '</p>' +
      '<div class="lf-row">' +
        field('nombre', t.name, '<input id="lf-nombre" type="text" autocomplete="name" placeholder="' + t.namePh + '">') +
        field('whatsapp', t.wa, '<input id="lf-whatsapp" type="tel" inputmode="tel" autocomplete="tel" placeholder="' + t.waPh + '">') +
      '</div>' +
      field('sector', t.sector, '<select id="lf-sector">' + opts(t.sectors, t.sectorPh) + '</select>') +
      '<div class="lf-row">' +
        field('mensajesDia', t.vol, '<select id="lf-mensajesDia">' + opts(t.vols, t.volPh) + '</select>') +
        field('canal', t.channel, '<select id="lf-canal">' + opts(t.channels, t.channelPh) + '</select>') +
      '</div>' +
      field('quienResponde', t.who, '<select id="lf-quienResponde">' + opts(t.whos, t.whoPh) + '</select>') +
      '<button type="submit" class="lf-submit">' + t.submit + '</button>' +
      '<p class="lf-legal">' + t.legal + '</p>' +
      '</form>';
    container.innerHTML = html;

    var form = container.querySelector('form');
    if (presetSector) {
      var sel = form.querySelector('#lf-sector');
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === presetSector) { sel.selectedIndex = i; break; }
      }
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(container, form, t); });
  }

  function validate(form, t) {
    var ok = true;
    ['nombre', 'whatsapp', 'sector', 'mensajesDia', 'canal', 'quienResponde'].forEach(function (id) {
      var f = form.querySelector('[data-f="' + id + '"]');
      var input = form.querySelector('#lf-' + id);
      var val = (input.value || '').trim();
      var bad = !val;
      if (id === 'whatsapp' && val) bad = (val.replace(/[^0-9]/g, '').length < 6);
      f.classList.toggle('invalid', bad);
      f.querySelector('.lf-err').textContent = t.required;
      if (bad) ok = false;
    });
    return ok;
  }

  function showResult(container, t, kind) {
    var waHref = 'https://wa.me/' + WA;
    var html = '<div class="lf lf-result">';
    if (kind === 'ok') {
      html += '<h3>' + t.okTitle + '</h3><p>' + t.okMsg + '</p>' +
        '<a class="lf-wa" href="' + waHref + '" data-wa data-loc="leadform-ok" target="_blank" rel="noopener noreferrer">' + t.okWa + '</a>';
    } else if (kind === 'dq') {
      html += '<h3>' + t.dqTitle + '</h3><p>' + t.dqMsg + '</p>' +
        '<a class="lf-guide" href="/blog/cuanto-cuesta-chatbot-ia-negocio-pequeno/">' + t.dqLink + '</a>';
    } else {
      html += '<h3>' + t.okTitle.replace('🎉', '') + '</h3><p>' + t.errMsg + '</p>' +
        '<a class="lf-wa" href="' + waHref + '" data-wa data-loc="leadform-err" target="_blank" rel="noopener noreferrer">' + t.okWa + '</a>';
    }
    html += '</div>';
    container.innerHTML = html;
  }

  async function submit(container, form, t) {
    if (!validate(form, t)) return;
    var get = function (id) { return (form.querySelector('#lf-' + id).value || '').trim(); };
    var vol = get('mensajesDia');

    // Descalificación honesta: <10 mensajes/día → no enviamos lead
    if (vol === t.vols[0]) {
      if (window.velaiTrack) window.velaiTrack('lead_disqualified', { sector: get('sector') });
      showResult(container, t, 'dq');
      return;
    }

    var payload = {
      // Mismo requestId en los reintentos del mismo formulario: el worker deduplica.
      requestId: form.dataset.requestId || (form.dataset.requestId = window.VELAI_UUID ? window.VELAI_UUID() : crypto.randomUUID()),
      fuente: 'formulario web',
      nombre: get('nombre'),
      whatsapp: get('whatsapp'),
      sector: get('sector'),
      mensajesDia: vol,
      canal: get('canal'),
      quienResponde: get('quienResponde'),
      utm: (window.VELAI_getUTM && window.VELAI_getUTM()) || {},
      pageUrl: location.href.slice(0, 500)
    };

    var btn = form.querySelector('.lf-submit');
    btn.disabled = true; btn.textContent = t.sending;

    try {
      if (!window.VELAI_HUMAN) throw new Error('human_check_unavailable');
      payload.turnstileToken = await window.VELAI_HUMAN.execute('lead');
      var response = await fetch(WORKER + '/lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      var data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'bad');
      if (window.velaiTrack) window.velaiTrack('lead_submit', { sector: payload.sector, volume: vol, stored: data.stored || 'd1' });
      showResult(container, t, 'ok');
    } catch (error) {
      // No destruir el formulario: mensaje según la causa y reintento con el mismo requestId.
      var code = String(error && error.message || '');
      var slot = form.querySelector('.lf-form-error');
      if (!slot) {
        slot = document.createElement('p');
        slot.className = 'lf-form-error';
        slot.style.cssText = 'color:#ff6b6b;font-size:.85rem;margin-top:10px';
        btn.parentNode.insertBefore(slot, btn.nextSibling);
      }
      slot.textContent = /human|turnstile/.test(code) ? t.errHuman : /rate_limited/.test(code) ? t.errRate : t.errRetry;
      btn.disabled = false; btn.textContent = t.retry;
      if (window.velaiTrack) window.velaiTrack('lead_error', { code: code.slice(0, 60) });
    }
  }

  function init() {
    var containers = document.querySelectorAll('[data-velai-leadform]');
    if (!containers.length) return;
    containers.forEach(render);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
