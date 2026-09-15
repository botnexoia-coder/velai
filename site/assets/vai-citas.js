/* VAI CITAS · v18 — one public page, inline and popup placements. */
(function () {
  if (window.__vaiCitas) return;
  window.__vaiCitas = true;
  var origins = ['https://citas.hirevai.com', 'https://citas-staging.hirevai.com'];
  function frame(node, slug) {
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug || '')) return null;
    var origin = node.getAttribute('data-origen') || origins[0];
    if (origins.indexOf(origin) === -1) return null;
    var service = node.getAttribute('data-servicio') || '';
    var iframe = document.createElement('iframe');
    iframe.src = origin + '/' + slug + '/reservas?embed=1' + (service ? '&s=' + encodeURIComponent(service) : '');
    iframe.title = 'Reservar cita'; iframe.referrerPolicy = 'no-referrer';
    iframe.style.width = '100%'; iframe.style.height = '640px'; iframe.style.border = '0';
    iframe.addEventListener('load', function () { iframe.contentWindow.postMessage({ type: 'vai-citas:init' }, origin); });
    var receive = function (e) {
      if (e.origin !== origin || e.source !== iframe.contentWindow || !e.data || e.data.type !== 'vai-citas:resize') return;
      var height = e.data.height;
      if (typeof height === 'number' && isFinite(height) && height >= 200 && height <= 2400) iframe.style.height = Math.ceil(height) + 'px';
    };
    window.addEventListener('message', receive);
    return { element: iframe, destroy: function () { window.removeEventListener('message', receive); iframe.remove(); } };
  }
  function install() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-vai-citas]'), function (node) {
      var result = frame(node, node.getAttribute('data-vai-citas')); if (result) node.appendChild(result.element);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-vai-citas-popup]'), function (node) {
      node.addEventListener('click', function () {
        var result = frame(node, node.getAttribute('data-vai-citas-popup')); if (!result) return;
        var dialog = document.createElement('dialog'), close = document.createElement('button');
        dialog.setAttribute('aria-label', 'Reservar cita'); dialog.style.width = 'min(960px, 96vw)'; dialog.style.maxHeight = '94vh'; dialog.style.padding = '12px'; dialog.style.border = '0'; dialog.style.borderRadius = '16px';
        close.textContent = 'Cerrar'; close.type = 'button';
        function done() { result.destroy(); dialog.remove(); node.focus(); }
        close.addEventListener('click', function () { dialog.close(); }); dialog.addEventListener('close', done);
        dialog.appendChild(close); dialog.appendChild(result.element); document.body.appendChild(dialog);
        if (dialog.showModal) { dialog.showModal(); close.focus(); } else { done(); window.open(result.element.src, '_blank', 'noopener,noreferrer'); }
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
