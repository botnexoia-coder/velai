// ── Tooltip propio ────────────────────────────────────────────────────────────
// Portado de worker/admin-panel.js. Sustituye al title del navegador, que no se puede
// vestir, tarda ~1 s en salir, se corta a una línea en algunos navegadores y NUNCA
// aparece con el teclado.
//
// UN solo globo para toda la app, movido por JS y disparado por delegación con
// [data-tip]: sirve para el markup de cualquier vista presente o futura, y no hay un
// elemento por disparador ni riesgo de que un overflow:hidden lo recorte.
//
// El contenido va por textContent (con pre-line para los saltos) y JAMÁS por HTML:
// estos globos llevan nombres de cliente y de fuente — datos que escribe gente de
// fuera. Las filas clave/valor (data-tip-rows) se construyen con createElement y meten
// el texto también por textContent.
import { useEffect, useRef } from 'react';

const HOVER_DELAY_MS = 120;

export function TipHost() {
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tipEl = tipRef.current;
    if (!tipEl) return;
    let tipTimer: ReturnType<typeof setTimeout> | null = null;
    let tipFor: Element | null = null;

    function show(el: Element) {
      const texto = el.getAttribute('data-tip');
      if (!texto || !tipEl) return;
      tipFor = el;
      tipEl.hidden = false;
      // data-tip-rows = filas clave/valor separadas por | y con : dentro, para los
      // desgloses de las gráficas. Sin él, texto plano y ya.
      const filas = el.getAttribute('data-tip-rows');
      tipEl.textContent = '';
      if (filas) {
        const t = document.createElement('b');
        t.textContent = texto;
        tipEl.appendChild(t);
        for (const f of filas.split('|')) {
          const i = f.lastIndexOf(':');
          if (i < 0) continue;
          const row = document.createElement('div');
          row.className = 'tipk';
          const k = document.createElement('span');
          k.textContent = f.slice(0, i);
          const v = document.createElement('span');
          v.textContent = f.slice(i + 1);
          row.appendChild(k);
          row.appendChild(v);
          tipEl.appendChild(row);
        }
      } else {
        tipEl.textContent = texto;
      }
      // Colocar: encima y centrado; si no cabe arriba, debajo. Y siempre dentro del
      // viewport — donde fallan los tooltips caseros.
      const r = el.getBoundingClientRect();
      const t = tipEl.getBoundingClientRect();
      const arriba = r.top > t.height + 10;
      let x = r.left + r.width / 2 - t.width / 2;
      x = Math.max(8, Math.min(x, document.documentElement.clientWidth - t.width - 8));
      tipEl.style.left = `${Math.round(x)}px`;
      tipEl.style.top = `${Math.round(arriba ? r.top - t.height - 8 : r.bottom + 8)}px`;
      requestAnimationFrame(() => tipEl.classList.add('on'));
      // Lectores de pantalla: el globo describe al elemento mientras está abierto.
      el.setAttribute('aria-describedby', 'tip');
    }

    function hide() {
      if (tipTimer) {
        clearTimeout(tipTimer);
        tipTimer = null;
      }
      if (tipFor) {
        tipFor.removeAttribute('aria-describedby');
        tipFor = null;
      }
      if (tipEl) {
        tipEl.classList.remove('on');
        tipEl.hidden = true;
      }
    }

    const closest = (target: EventTarget | null): Element | null =>
      target instanceof Element ? target.closest('[data-tip]') : null;

    // 120 ms de espera con el ratón: sin ellos, pasar por una fila de barras dispara
    // catorce globos seguidos. Con el teclado sale al instante, que es lo que se espera.
    const onPointerOver = (e: Event) => {
      const el = closest(e.target);
      if (!el || el === tipFor) return;
      hide();
      tipTimer = setTimeout(() => show(el), HOVER_DELAY_MS);
    };
    const onPointerOut = (e: Event) => {
      if (closest(e.target)) hide();
    };
    const onFocusIn = (e: Event) => {
      const el = closest(e.target);
      if (el) show(el);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKeyDown);
    // Al hacer scroll el globo se quedaría flotando donde ya no está su elemento.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  return <div id="tip" role="tooltip" hidden ref={tipRef} />;
}
