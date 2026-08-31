// ── Señal de «estoy pensando» ────────────────────────────────────────────────
// Portada de worker/admin-panel.js. Va en api() y no en cada botón a propósito: es el
// único paso por el que van todas las llamadas del panel, así que una sola pieza cubre
// todas — y ninguna vista futura se queda sin indicador por olvido.
//
// Dos decisiones que importan:
//  - Contador, no booleano: dos peticiones a la vez y la que acaba primero apagaría la
//    barra con la otra aún en vuelo.
//  - 180 ms de gracia: casi todo el panel responde antes, y una barra que aparece y
//    desaparece en 80 ms se lee como un parpadeo defectuoso, no como progreso.
//
// Los sondeos de fondo (bandeja cada 15 s) pasan quiet y NO la encienden: sin eso la
// barra viviría encendida sola y dejaría de significar nada.

export const BUSY_GRACE_MS = 180;

let busyN = 0;
let busyTimer: ReturnType<typeof setTimeout> | null = null;
const busyBtns = new Set<HTMLButtonElement>();

export function busyStart(): void {
  busyN++;
  // El botón que acaba de pulsarse ES el activeElement: se marca latiendo y bloqueado
  // sin tocar cada llamada. Cuando alguien pulsa «Guardar» mira el botón, no el borde
  // de la pantalla — la barra sola no responde a «¿lo he pulsado bien?».
  const el = document.activeElement;
  if (el instanceof HTMLButtonElement && !el.disabled && !busyBtns.has(el)) {
    busyBtns.add(el);
    el.classList.add('loading');
    el.disabled = true;
  }
  if (busyN === 1 && !busyTimer) {
    busyTimer = setTimeout(() => {
      document.documentElement.classList.add('busy');
    }, BUSY_GRACE_MS);
  }
}

export function busyEnd(): void {
  busyN = Math.max(0, busyN - 1);
  if (busyN) return;
  if (busyTimer) {
    clearTimeout(busyTimer);
    busyTimer = null;
  }
  document.documentElement.classList.remove('busy');
  // Se sueltan solo cuando NO queda nada en vuelo: si no, la petición corta
  // desbloquearía el botón de la larga y volveríamos a poder pulsar dos veces.
  for (const b of busyBtns) {
    b.classList.remove('loading');
    b.disabled = false;
  }
  busyBtns.clear();
}

/** Solo para tests: deja el módulo como recién cargado. */
export function resetActivity(): void {
  busyN = 0;
  if (busyTimer) {
    clearTimeout(busyTimer);
    busyTimer = null;
  }
  busyBtns.clear();
  document.documentElement.classList.remove('busy');
}
