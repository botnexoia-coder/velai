// El estado del cajón de respuesta, como dato puro. Es la lógica más delicada de la
// bandeja (ventana de Meta de 24 h, cola de espera con cuenta atrás, presencia del
// visitante web) y por eso vive fuera del componente: se testea con fixtures.
import { WIN_WHY } from '../api/errors';
import type { ConversationHead, ReplyWindow } from '../api/types';
import { minutesSince, queueRemaining, windowHoursLeft } from './format';

export type ComposerState =
  /** Alguien pidió asesor y espera: no se escribe, se TOMA el control (con cuenta atrás). */
  | { kind: 'waiting'; waitedMin: number | null; remainingMin: number | null }
  /** Cerrado con motivo (ventana de Meta caducada, atiende la IA, tomada por otro…). */
  | { kind: 'closed'; why: string }
  /** Abierto: se puede escribir. `status` dice si va a llegar. */
  | {
      kind: 'open';
      agentEmail: string | null;
      status:
        | { kind: 'web'; away: boolean }
        | { kind: 'whatsapp'; hoursLeft: number };
    };

export function composerState(
  win: ReplyWindow | undefined,
  conv: ConversationHead | undefined,
  queueMin: number,
  nowMs = Date.now(),
): ComposerState {
  if (!win || !win.open) {
    // En 'esperando' el cajón cerrado no basta: hay alguien esperando y hay que poder
    // entrar, con los minutos que lleva y la cuenta atrás a la vista — pasada esa marca
    // Vai retoma.
    if (conv && conv.state === 'esperando') {
      return {
        kind: 'waiting',
        waitedMin: minutesSince(conv.state_at, nowMs),
        remainingMin: queueRemaining(conv.state_at, queueMin, nowMs),
      };
    }
    // Con `reengage` el motivo que importa es la ventana de Meta, aunque aún atienda la
    // IA: tomar el control no serviría de nada y la salida es la plantilla.
    const reason = win?.reengage ? 'window_closed' : win?.reason;
    const why = (reason && WIN_WHY[reason]) || 'No se puede responder a esta conversación ahora mismo.';
    return { kind: 'closed', why };
  }
  // En WhatsApp lo que importa es cuánto queda de la ventana de Meta; en web, si el
  // visitante sigue delante. Son la misma pregunta —«¿esto va a llegar?»— y en los dos
  // casos se enseña el dato, no un semáforo verde.
  return {
    kind: 'open',
    agentEmail: conv?.agent_email ?? null,
    status: win.web
      ? { kind: 'web', away: Boolean(win.away) }
      : { kind: 'whatsapp', hoursLeft: windowHoursLeft(win.closesAt, nowMs) },
  };
}

/** El botón «Enviar plantilla para retomar» (WhatsApp con la ventana cerrada). */
export interface ReengageState {
  available: boolean;
  /** Motivo traducido por el que está apagado; null si se puede enviar. */
  why: string | null;
  /** Sin plantilla aprobada: el motivo lleva enlace a la vista Plantillas. */
  toPlantillas: boolean;
  /** «Plantilla enviada a las HH:MM · esperando respuesta» mientras no conteste. */
  sentAt: string | null;
}

export function reengageState(win: ReplyWindow | undefined): ReengageState | null {
  // Con la ventana abierta no hay nada que retomar, aunque llegara un dato viejo.
  if (!win || !win.reengage || win.open) return null;
  const r = win.reengage;
  return {
    available: r.available,
    why: r.available ? null : (r.reason && WIN_WHY[r.reason]) || 'Ahora mismo no se puede enviar la plantilla.',
    toPlantillas: r.reason === 'plantilla_retomar_no_aprobada',
    sentAt: r.lastSentAt,
  };
}

// Clave de cambio relevante del cajón (portada del v1): el componente solo debe
// reconstruirse cuando cambia lo que se ve, nunca por el polling en sí — así el texto
// a medio escribir no corre peligro.
export function composerKey(win: ReplyWindow | undefined, c: ConversationHead | undefined): string {
  return [
    win && win.open ? 1 : 0,
    (win && win.reason) || '',
    win && win.web ? (win.away ? 'away' : 'here') : '',
    (c && c.state) || '',
    (c && c.agent_email) || '',
  ].join('|');
}
