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

// ── SHARE BUTTONS ──
(function initShare() {
  var btns = document.querySelectorAll('.share-btn');
  if (!btns.length) return;
  var url = window.location.href;
  var title = document.title;
  var hooks = {
    x: function() {
      return 'https://twitter.com/intent/tweet?url=' + encodeURIComponent(url)
        + '&text=' + encodeURIComponent(title);
    },
    linkedin: function() {
      return 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url);
    },
    whatsapp: function() {
      return 'https://api.whatsapp.com/send?text=' + encodeURIComponent(title + ' ' + url);
    },
    email: function() {
      return 'mailto:?subject=' + encodeURIComponent(title)
        + '&body=' + encodeURIComponent(url);
    },
  };
  btns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var type = btn.getAttribute('data-share');
      if (type === 'copy') {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(function() {
            var orig = btn.innerHTML;
            btn.innerHTML = '✓';
            setTimeout(function() { btn.innerHTML = orig; }, 1400);
          });
        }
        return;
      }
      var target = hooks[type] && hooks[type]();
      if (target) window.open(target, '_blank', 'noopener,noreferrer');
    });
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
