/* VAI LOADER · sin versión · caché 5 min. Versión vigente del widget. */
(function () {
  var V = '16';
  if (window.__vaiLoader || document.getElementById('vaiWidget')) return;
  window.__vaiLoader = true;
  var base = (document.currentScript && document.currentScript.src) || 'https://hirevai.com/assets/vai.js';
  var s = document.createElement('script');
  s.src = new URL('vai-widget.js?v=' + V, base).href;
  s.defer = true;
  document.head.appendChild(s);
})();
