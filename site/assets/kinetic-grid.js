// Kinetic grid · prueba visual reversible para el hero de index.html.
// Reversión: quitar el <canvas data-kinetic-grid>, el bloque CSS .kinetic-grid-canvas y este <script>.
// Sin dependencias. Dibuja una malla naranja→violeta que se deforma con el puntero (solo dentro de
// el hero) y emite una onda al hacer clic. Solo anima mientras hay algo que animar: en reposo,
// fuera de viewport, con la pestaña oculta, con prefers-reduced-motion o en pantallas táctiles
// deja un único fotograma estático.
(() => {
  'use strict';

  const canvas = document.querySelector('[data-kinetic-grid]');
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const surface = canvas.closest('[data-kinetic-surface]');
  if (!(surface instanceof HTMLElement)) return;

  const context = canvas.getContext('2d');
  if (!context || typeof ResizeObserver !== 'function' || typeof IntersectionObserver !== 'function') return;

  const ORANGE = [255, 113, 56];
  const VIOLET = [151, 103, 255];
  const RADIUS = 210;          // alcance del puntero (px CSS)
  const MAX_PIXEL_RATIO = 2;   // tope de devicePixelRatio
  const RIPPLE_SPEED = 300;    // px/s
  const RIPPLE_FADE = 1.4;     // 1/s
  const RIPPLE_WIDTH = 42;

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarseQuery = window.matchMedia('(pointer: coarse)');
  const isStatic = () => motionQuery.matches || coarseQuery.matches;

  const pointer = { x: -1000, y: -1000 }; // posición suavizada
  const target = { x: -1000, y: -1000 };  // última posición real del puntero
  const ripples = [];
  let energy = 0;              // 0 = reposo, 1 = puntero dentro (suaviza entrada/salida)
  let pointerInside = false;
  let visible = false;
  let frame = 0;
  let width = 0;
  let height = 0;
  let grid = null;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (from, to, amount) => from + (to - from) * amount;

  function brandColor(x, alpha) {
    const mix = clamp(x / Math.max(width, 1), 0, 1);
    const r = Math.round(ORANGE[0] + (VIOLET[0] - ORANGE[0]) * mix);
    const g = Math.round(ORANGE[1] + (VIOLET[1] - ORANGE[1]) * mix);
    const b = Math.round(ORANGE[2] + (VIOLET[2] - ORANGE[2]) * mix);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // La malla base solo se recalcula al cambiar el tamaño; el borde queda "anclado" (pin→0)
  // para que la deformación nunca deje huecos contra el recorte de la tarjeta.
  function buildGrid() {
    const cellSize = width < 620 ? 44 : 52;
    const columns = Math.max(3, Math.ceil(width / cellSize) + 1);
    const rows = Math.max(3, Math.ceil(height / cellSize) + 1);
    const cellWidth = width / (columns - 1);
    const cellHeight = height / (rows - 1);
    const points = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const edgeX = Math.min(column / 1.4, (columns - 1 - column) / 1.4, 1);
        const edgeY = Math.min(row / 1.4, (rows - 1 - row) / 1.4, 1);
        points.push({
          baseX: column * cellWidth,
          baseY: row * cellHeight,
          pin: Math.max(0, edgeX * edgeX * edgeY * edgeY),
          x: 0,
          y: 0,
          influence: 0,
        });
      }
    }
    grid = { columns, rows, points };
  }

  function setCanvasSize() {
    // Se mide el propio canvas (la capa visual del hero):
    // así el búfer coincide 1:1 con los píxeles CSS y no hay reescalado.
    const bounds = canvas.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    buildGrid();
    draw(performance.now());
  }

  function warpPoints(now) {
    const { points } = grid;
    for (const point of points) {
      const dx = pointer.x - point.baseX;
      const dy = pointer.y - point.baseY;
      const distance = Math.hypot(dx, dy);
      const influence = Math.max(0, 1 - distance / RADIUS) * energy;
      const warp = influence * influence * 22 * point.pin;
      let offsetX = distance ? (dx / distance) * warp : 0;
      let offsetY = distance ? (dy / distance) * warp : 0;

      for (const ripple of ripples) {
        const age = (now - ripple.born) / 1000;
        const opacity = Math.max(0, 1 - age * RIPPLE_FADE);
        if (!opacity) continue;
        const rippleDx = point.baseX - ripple.x;
        const rippleDy = point.baseY - ripple.y;
        const rippleDistance = Math.hypot(rippleDx, rippleDy);
        const delta = Math.abs(rippleDistance - age * RIPPLE_SPEED);
        if (delta < RIPPLE_WIDTH && rippleDistance) {
          const strength = (1 - delta / RIPPLE_WIDTH) * opacity * 10 * point.pin;
          offsetX += (rippleDx / rippleDistance) * strength;
          offsetY += (rippleDy / rippleDistance) * strength;
        }
      }

      point.x = point.baseX + offsetX;
      point.y = point.baseY + offsetY;
      point.influence = influence;
    }
  }

  function drawSegment(start, end) {
    const strength = Math.max(start.influence, end.influence);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = strength > 0.02
      ? brandColor((start.x + end.x) / 2, 0.12 + strength * 0.62)
      : 'rgba(255,255,255,0.075)';
    context.lineWidth = 0.7 + strength * 0.9;
    context.stroke();
  }

  function draw(now) {
    if (!grid) return;
    context.clearRect(0, 0, width, height);
    warpPoints(now);

    const { columns, rows, points } = grid;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const point = points[row * columns + column];
        if (column + 1 < columns) drawSegment(point, points[row * columns + column + 1]);
        if (row + 1 < rows) drawSegment(point, points[(row + 1) * columns + column]);

        const radius = 1.05 + point.influence * 2.25;
        if (point.influence > 0.16) {
          const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius + 7);
          glow.addColorStop(0, brandColor(point.x, point.influence * 0.46));
          glow.addColorStop(1, brandColor(point.x, 0));
          context.fillStyle = glow;
          context.beginPath();
          context.arc(point.x, point.y, radius + 7, 0, Math.PI * 2);
          context.fill();
        }
        context.fillStyle = point.influence > 0.02
          ? brandColor(point.x, 0.3 + point.influence * 0.7)
          : 'rgba(255,255,255,0.18)';
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
      }
    }

    for (let index = ripples.length - 1; index >= 0; index -= 1) {
      const ripple = ripples[index];
      const age = (now - ripple.born) / 1000;
      const opacity = Math.max(0, 1 - age * RIPPLE_FADE);
      if (!opacity) {
        ripples.splice(index, 1);
        continue;
      }
      context.beginPath();
      context.arc(ripple.x, ripple.y, Math.max(0, age * RIPPLE_SPEED), 0, Math.PI * 2);
      context.strokeStyle = brandColor(ripple.x, opacity * 0.32);
      context.lineWidth = 1.4;
      context.stroke();
    }
  }

  function animate(now) {
    frame = 0;
    if (!visible || document.hidden || isStatic()) return;
    pointer.x = lerp(pointer.x, target.x, 0.12);
    pointer.y = lerp(pointer.y, target.y, 0.12);
    energy = lerp(energy, pointerInside ? 1 : 0, 0.08);
    // Sin puntero dentro, sin ondas vivas y con la energía agotada no hay nada que animar:
    // se pinta el fotograma de reposo y se suelta el rAF hasta la próxima interacción.
    const settled = !pointerInside && energy < 0.01 && ripples.length === 0;
    if (settled) energy = 0;
    draw(now);
    if (!settled) frame = requestAnimationFrame(animate);
  }

  function start() {
    if (frame) return;
    if (!visible || document.hidden || isStatic()) {
      draw(performance.now());
      return;
    }
    frame = requestAnimationFrame(animate);
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function resetPointer() {
    pointerInside = false;
  }

  function updateMotionMode() {
    if (isStatic()) {
      stop();
      resetPointer();
      energy = 0;
      ripples.length = 0;
      draw(performance.now());
    } else {
      start();
    }
  }

  function localPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  // La interacción escucha en el hero, no en window: fuera de él el grid no reacciona.
  // El canvas lleva pointer-events:none, así que nunca intercepta clics del contenido.
  surface.addEventListener('pointermove', (event) => {
    if (isStatic()) return;
    const point = localPoint(event);
    if (!pointerInside && energy < 0.05) {
      pointer.x = point.x;
      pointer.y = point.y;
    }
    target.x = point.x;
    target.y = point.y;
    pointerInside = true;
    start();
  }, { passive: true });

  surface.addEventListener('pointerleave', () => {
    resetPointer();
    start(); // deja que la energía decaiga suavemente hasta el reposo
  }, { passive: true });
  surface.addEventListener('pointercancel', resetPointer, { passive: true });

  surface.addEventListener('pointerdown', (event) => {
    if (isStatic()) return;
    const point = localPoint(event);
    ripples.push({ x: point.x, y: point.y, born: performance.now() });
    if (ripples.length > 4) ripples.shift();
    start();
  }, { passive: true });

  new ResizeObserver(setCanvasSize).observe(surface);

  new IntersectionObserver(([entry]) => {
    visible = Boolean(entry && entry.isIntersecting);
    if (visible) start();
    else stop();
  }, { rootMargin: '120px 0px' }).observe(surface);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
  motionQuery.addEventListener('change', updateMotionMode);
  coarseQuery.addEventListener('change', updateMotionMode);

  setCanvasSize();
})();
