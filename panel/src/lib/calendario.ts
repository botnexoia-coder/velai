// Lógica pura del calendario mensual (portada de admin-panel.js): el corte de día se
// hace con la ZONA HORARIA del calendario del negocio, no con la del navegador — una
// cita a las 23:30 de Madrid vista desde Bogotá seguiría siendo del día de Madrid.
import type { Appointment } from '../api/types';

export function calTzDay(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 10);
  }
}

export function calTzHm(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('es-ES', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  } catch {
    return '';
  }
}

/** Citas por día (clave yyyy-mm-dd en la tz del calendario), ordenadas por hora. */
export function apptsByDay(appts: Appointment[], tz: string): Map<string, Appointment[]> {
  const byDay = new Map<string, Appointment[]>();
  for (const a of appts) {
    const k = calTzDay(a.starts_at, tz);
    const list = byDay.get(k) ?? [];
    list.push(a);
    byDay.set(k, list);
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  return byDay;
}

/** Chip de Confirmaciones de una cita: qué hizo el cliente final (SPEC-CONFIRMACIONES).
 *  Prioridad: cancelada por el cliente > confirmada > recordada (recordatorio enviado). */
export function estadoConfirmacion(a: Appointment): { emoji: string; label: string } | null {
  if (a.status === 'cancelled' && a.cancelled_by === 'customer') return { emoji: '❌', label: 'cancelada por el cliente' };
  if (a.customer_confirmed_at) return { emoji: '✅', label: 'confirmada por el cliente' };
  if (a.reminder_status === 'sent') return { emoji: '⏳', label: 'recordada' };
  return null;
}

/** Línea del ledger del recordatorio para el detalle del día. Null = sin fila (aún no
 *  tocaba, o el addon está apagado): no se pinta nada, que es lo honesto. */
export function ledgerRecordatorio(a: Appointment, tz: string): string | null {
  if (!a.reminder_status) return null;
  if (a.reminder_status === 'sent') return `Recordatorio enviado${a.reminder_sent_at ? ` el ${calTzDay(a.reminder_sent_at, tz)} a las ${calTzHm(a.reminder_sent_at, tz)}` : ''}`;
  if (a.reminder_status === 'pending') return 'Recordatorio pendiente de envío';
  if (a.reminder_status === 'failed') return `Recordatorio fallido (${a.reminder_attempts ?? 0} intentos${a.reminder_error ? `: ${a.reminder_error}` : ''})`;
  return `Recordatorio omitido${a.reminder_error === 'creada_dentro_de_ventana' ? ' (cita agendada con menos de 24 h)' : a.reminder_error ? ` (${a.reminder_error})` : ''}`;
}

export interface MonthShape {
  /** Celdas vacías delante (la semana empieza en lunes). */
  lead: number;
  /** Días del mes. */
  days: number;
  /** Celdas vacías detrás: la rejilla tipo Google siempre cierra en domingo. */
  tail: number;
}

export function monthShape(year: number, month0: number): MonthShape {
  const lead = (new Date(year, month0, 1).getDay() + 6) % 7;
  const days = new Date(year, month0 + 1, 0).getDate();
  const tail = (7 - ((lead + days) % 7)) % 7;
  return { lead, days, tail };
}

export function dayKey(year: number, month0: number, day: number): string {
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Rango del mes con margen de ±1 día: el corte exacto por tz lo hace calTzDay al pintar. */
export function monthRange(year: number, month0: number): { from: string; to: string } {
  return {
    from: new Date(Date.UTC(year, month0, 1) - 86400000).toISOString(),
    to: new Date(Date.UTC(year, month0 + 1, 1) + 86400000).toISOString(),
  };
}
