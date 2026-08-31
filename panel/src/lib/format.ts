// Helpers de formato y de lectura de datos, portados de worker/admin-panel.js.
// Puros a propósito: son la mitad de la «lógica sutil» de la bandeja y así se testean
// sin montar DOM.
import type { ConversationHead, InboxRow, MsgRole } from '../api/types';

export function fmt(v: string | null | undefined): string {
  return v ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)) : '—';
}

export function fmtShort(v: string | null | undefined, now = new Date()): string {
  if (!v) return '';
  const d = new Date(v);
  return d.toDateString() === now.toDateString()
    ? new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(d)
    : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(d);
}

export function fmtDia(v: string | null | undefined): string {
  return v ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(new Date(v)) : '—';
}

export function fmtHora(v: string | null | undefined): string {
  return v ? new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : '';
}

// Etiqueta de la divisoria de día: «Hoy» y «Ayer» se leen mucho mejor que una fecha.
export function dayLabel(v: string | null | undefined, now = new Date()): string {
  if (!v) return '';
  const d = new Date(v);
  const ayer = new Date(now.getTime() - 86400000);
  const mismo = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mismo(d, now)) return 'Hoy';
  if (mismo(d, ayer)) return 'Ayer';
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'long' }).format(d);
}

export const miles = (n: number): string => new Intl.NumberFormat('es-ES').format(n);

export const usd = (n: number): string => '$' + (n < 1 ? n.toFixed(4) : n.toFixed(2));

// La fecha «como se dice»: el día de la semana es la mitad de la lectura de una gráfica diaria.
export function diaLargo(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso + 'T12:00:00'));
  } catch {
    return iso;
  }
}

// Color estable por tenant (misma paleta y mismo hash que el v1: los colores no cambian
// al migrar).
const TENANT_COLORS = ['#3987e5', '#9085e9', '#199e70', '#c98500', '#2aa8b8', '#c96bb4', '#8ba03f', '#e66767'] as const;
export function tenantColor(id: string | null | undefined): string {
  let h = 0;
  for (const c of String(id ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TENANT_COLORS[h % TENANT_COLORS.length] as string;
}

export function initials(v: string | null | undefined): string {
  const t = String(v ?? '').replace(/^(whatsapp:|messenger:)/, '').replace(/[^A-Za-z0-9]/g, '');
  return (t.slice(0, 2) || '··').toUpperCase();
}

// Quién es la persona del otro lado. En web el external_id es un UUID ilegible: se dice
// lo que de verdad se sabe (el id sigue a la vista en la cabecera del hilo).
export function whoOf(c: Pick<InboxRow | ConversationHead, 'external_id' | 'channel'> & { lead_name?: string | null }): string {
  if (c.lead_name) return c.lead_name;
  if (c.channel === 'web') return 'Visitante de la web';
  return String(c.external_id ?? '').replace(/^(whatsapp:|messenger:)/, '') || 'sin identificar';
}

// Quién escribió el último mensaje. 'tú' es la PERSONA del equipo, no el bot.
export function prevPrefix(role: MsgRole | null | undefined): string {
  return role === 'user' ? '' : role === 'agent' ? 'tú: ' : 'Vai: ';
}

// Filas clave/valor para el globo. El separador es | y las etiquetas pueden traer datos
// de fuera (nombres de canal y de cliente), así que se les quita el | antes de unir: si
// no, una fuente llamada «web|movil» partiría la fila en dos.
export function tipRows(pares: [string, string | number][]): string {
  return pares.map(([k, v]) => String(k).replace(/\|/g, ' ') + ':' + v).join('|');
}

/** Minutos enteros transcurridos desde un ISO (nunca negativos). */
export function minutesSince(iso: string | null | undefined, nowMs = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60000));
}

/** Minutos que quedan de cola antes de que Vai retome (queueMin viene del servidor). */
export function queueRemaining(stateAt: string | null | undefined, queueMin: number, nowMs = Date.now()): number | null {
  const waited = minutesSince(stateAt, nowMs);
  return waited === null ? null : Math.max(0, queueMin - waited);
}

/** Horas enteras que quedan de la ventana de WhatsApp. */
export function windowHoursLeft(closesAt: string | undefined, nowMs = Date.now()): number {
  if (!closesAt) return 0;
  return Math.max(0, Math.round((new Date(closesAt).getTime() - nowMs) / 3600000));
}
