// Avisos de mensajes nuevos (portado de admin-panel.js, migración 0029 del v1).
//
// Piezas puras (testeables) + los efectos de sonido/notificación:
//  - alertDelta: el primer sondeo solo fija la referencia — si no, al activar los
//    avisos sonaría por mensajes que ya estaban ahí desde hace horas.
//  - beep: Web Audio (un oscilador), NO un elemento <audio> — la CSP del panel no
//    declara media-src, así que cualquier archivo de audio caería en default-src 'none'
//    y quedaría bloqueado. Un oscilador no carga nada.
//  - notify: Notification API; el permiso SOLO puede pedirse dentro de un gesto del
//    usuario, por eso lo pide setAlerts (el clic del botón) y no el arranque.
import type { Alerts } from '../api/types';

export interface AlertDelta {
  nuevoMensaje: boolean;
  nuevaEspera: boolean;
}

/** Compara el sondeo nuevo con la referencia. Sin referencia previa no hay aviso. */
export function alertDelta(prev: Alerts | null, next: Alerts): AlertDelta {
  if (!prev) return { nuevoMensaje: false, nuevaEspera: false };
  return {
    nuevoMensaje: Boolean(next.lastInbound && next.lastInbound !== prev.lastInbound),
    nuevaEspera: next.waiting > prev.waiting,
  };
}

// El AudioContext se crea perezoso y se reutiliza (el navegador limita cuántos hay).
let alertCtx: AudioContext | null = null;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** Dos notas cortas: se reconoce sin ser estridente y no se confunde con un aviso del SO. */
export function beep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Ctx) return;
    if (!alertCtx) alertCtx = new Ctx();
    if (alertCtx.state === 'suspended') void alertCtx.resume();
    const notas: [number, number][] = [
      [880, 0],
      [1320, 0.12],
    ];
    for (const [hz, at] of notas) {
      const o = alertCtx.createOscillator();
      const g = alertCtx.createGain();
      o.type = 'sine';
      o.frequency.value = hz;
      const t = alertCtx.currentTime + at;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      o.connect(g);
      g.connect(alertCtx.destination);
      o.start(t);
      o.stop(t + 0.12);
    }
  } catch {
    /* sin audio disponible, la notificación sigue saliendo */
  }
}

export function notify(titulo: string, cuerpo: string, onClick: () => void): void {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const n = new Notification(titulo, { body: cuerpo, tag: 'velai-msg', icon: '/favicon.svg' });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    /* sin Notification API no pasa nada: el beep ya sonó */
  }
}

/** Textos del aviso (separados para testearlos sin Notification API). */
export function alertTexto(delta: AlertDelta, waiting: number): { titulo: string; cuerpo: string } {
  if (delta.nuevaEspera) {
    return {
      titulo: 'Alguien espera un asesor',
      cuerpo: waiting === 1 ? '1 conversación esperando que alguien la tome' : `${waiting} conversaciones esperando`,
    };
  }
  return { titulo: 'Mensaje nuevo', cuerpo: 'Ha llegado un mensaje nuevo a Conversaciones.' };
}
