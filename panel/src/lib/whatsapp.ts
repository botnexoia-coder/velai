// El estado del WhatsApp del negocio y del logo, en lenguaje de negocio — nunca jerga
// de Twilio (portado de loadConexiones en admin-panel.js). Puro para poder testear las
// frases: la coletilla de «los avisos te llegan por Telegram» SOLO se promete si hay un
// Telegram entregando de verdad (con gogestión era mentira y nadie veía sus leads).
import type { LeadAlerts, ProfileSync, WhatsappRow } from '../api/types';

export type WaEstadoKind = 'sin_conectar' | 'alta_sin_enrutar' | 'activo' | 'verificando' | 'problema';

export interface WaEstado {
  kind: WaEstadoKind;
  /** Coletilla del estado 'activo' cuando la plantilla aún no está aprobada. */
  sub: 'telegram_fallback' | 'aprobando' | null;
  /** El número, sin el prefijo whatsapp:. */
  from: string | null;
}

const VERIFICANDO = ['CREATING', 'PENDING_VERIFICATION', 'VERIFYING'];

export function waEstado(w: WhatsappRow, alerts: LeadAlerts | null): WaEstado {
  const from = w.twilio_from ? String(w.twilio_from).replace('whatsapp:', '') : null;
  const st = w.sender_status;
  if (!st) return { kind: 'sin_conectar', sub: null, from };
  if (st === 'ONLINE' && !w.routed) return { kind: 'alta_sin_enrutar', sub: null, from };
  if (st === 'ONLINE') {
    const sub = w.lead_template_status === 'approved' ? null : alerts && alerts.telegram === 'on' ? 'telegram_fallback' : 'aprobando';
    return { kind: 'activo', sub, from };
  }
  if (VERIFICANDO.includes(st)) return { kind: 'verificando', sub: null, from };
  return { kind: 'problema', sub: null, from };
}

/**
 * El texto bajo la tarjeta del logo: dónde se ve ya la imagen y qué falta. Nunca se
 * pide subir la misma imagen dos veces — si falta aplicarla a WhatsApp, para eso está
 * el botón que usa la que YA está guardada (applyVisible).
 */
export function logoEstado(
  logoUrl: string | null,
  tieneWa: boolean,
  ps: ProfileSync | null,
  traducir: (code: string) => string,
  fmt: (v: string | null | undefined) => string,
): { texto: string; applyVisible: boolean } {
  const hay = Boolean(logoUrl);
  const applyVisible = Boolean(hay && tieneWa && !(ps && ps.ok));
  if (!hay) return { texto: 'Aún no has subido tu imagen.', applyVisible: false };
  if (!tieneWa) return { texto: 'Ya se ve en el chat de tu web. Cuando tu WhatsApp esté activo, se aplicará también ahí.', applyVisible };
  if (ps) {
    return {
      texto: ps.ok
        ? `Ya se ve en el chat de tu web y en tu WhatsApp (${fmt(ps.at)}).`
        : `⚠ No se pudo aplicar a WhatsApp (${traducir(ps.error ?? 'motivo desconocido')}${ps.why ? ` — ${ps.why}` : ''})`,
      applyVisible,
    };
  }
  return { texto: 'Ya se ve en el chat de tu web. Pulsa «Aplicar a mi WhatsApp» para usarla también ahí.', applyVisible };
}
