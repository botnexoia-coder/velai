// ── THEME (compartido con la home vía localStorage) ──
function toggleTheme() {
  var light = document.body.classList.toggle('light');
  var btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = light ? '🌙' : '☀️';
  localStorage.setItem('velai-theme', light ? 'light' : 'dark');
}
(function initTheme() {
  if (localStorage.getItem('velai-theme') === 'light') {
    document.body.classList.add('light');
    var btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = '🌙';
  }
})();

// ── LANG ──
// El blog está solo en ES. Si el usuario pulsa EN, guardamos su preferencia
// y lo enviamos a la home (que sí tiene traducción completa).
function setLang(lang) {
  localStorage.setItem('velai-lang', lang);
  if (lang === 'en') {
    window.location.href = '/';
  } else {
    var es = document.getElementById('btnEs');
    var en = document.getElementById('btnEn');
    if (es) es.classList.add('active');
    if (en) en.classList.remove('active');
  }
}
(function initLang() {
  // El blog solo existe en ES, el botón ES siempre se ve activo
  var es = document.getElementById('btnEs');
  if (es) es.classList.add('active');
})();

// ── MENU MÓVIL ──
function toggleMenu() {
  var links = document.querySelector('.nav-links');
  var btn = document.getElementById('hamburger');
  if (!links || !btn) return;
  var open = links.classList.toggle('open');
  btn.textContent = open ? '✕' : '☰';
}
document.querySelectorAll('.nav-links a').forEach(function(a) {
  a.addEventListener('click', function() {
    var links = document.querySelector('.nav-links');
    var btn = document.getElementById('hamburger');
    if (links) links.classList.remove('open');
    if (btn) btn.textContent = '☰';
  });
});

// ── SHARE: COPY LINK ──
// X / LinkedIn / WhatsApp / email son <a target="_blank"> nativos (más
// robustos: no dependen de JS ni los bloquea el popup blocker).
// Solo "copy" necesita JS.
(function initCopyShare() {
  var btn = document.querySelector('.share-btn[data-share="copy"]');
  if (!btn) return;
  btn.addEventListener('click', function() {
    var url = btn.getAttribute('data-share-url') || window.location.href;
    var orig = btn.innerHTML;
    var done = function() {
      btn.innerHTML = '✓';
      setTimeout(function() { btn.innerHTML = orig; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function() {
        window.prompt('Copia el enlace:', url);
      });
    } else {
      window.prompt('Copia el enlace:', url);
    }
  });
})();

// ── NAV SCROLL ──
window.addEventListener('scroll', function() {
  var nav = document.querySelector('nav.site-nav');
  if (!nav) return;
  nav.style.borderBottomColor = window.scrollY > 20
    ? 'rgba(255,107,26,0.2)'
    : 'rgba(255,107,26,0.12)';
});
