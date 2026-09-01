// El horario semanal como dato puro (portado de hoursToForm/hoursFromForm/shSummary de
// admin-panel.js). Una sola rejilla para dos horarios distintos — el de atención humana
// (Conexiones) y el laboral del calendario — con dos tramos por día: la jornada partida
// es la norma aquí.
import type { WeekHours } from '../api/types';

export const DIAS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Dia = (typeof DIAS)[number];

export const DIA_LABEL: Record<Dia, string> = {
  mon: 'Lunes',
  tue: 'Martes',
  wed: 'Miércoles',
  thu: 'Jueves',
  fri: 'Viernes',
  sat: 'Sábado',
  sun: 'Domingo',
};

/** Los cuatro campos de un día: tramo 1 (a1–b1) y tramo 2 (a2–b2), como texto HH:MM. */
export interface DiaGrid {
  a1: string;
  b1: string;
  a2: string;
  b2: string;
}
export type Grid = Record<Dia, DiaGrid>;

const VACIO: DiaGrid = { a1: '', b1: '', a2: '', b2: '' };

export function gridVacio(): Grid {
  return Object.fromEntries(DIAS.map((d) => [d, { ...VACIO }])) as Grid;
}

export function gridFromHours(hours: WeekHours | null | undefined): Grid {
  const grid = gridVacio();
  if (!hours) return grid;
  for (const d of DIAS) {
    const tramos = hours[d] ?? [];
    const [t1, t2] = [tramos[0] ?? ['', ''], tramos[1] ?? ['', '']];
    grid[d] = { a1: t1[0] ?? '', b1: t1[1] ?? '', a2: t2[0] ?? '', b2: t2[1] ?? '' };
  }
  return grid;
}

/** Solo cuentan los tramos completos y bien ordenados (a<b), como en el v1. */
export function hoursFromGrid(grid: Grid): WeekHours {
  const out: WeekHours = {};
  for (const d of DIAS) {
    const g = grid[d];
    const tramos: [string, string][] = [];
    if (g.a1 && g.b1 && g.a1 < g.b1) tramos.push([g.a1, g.b1]);
    if (g.a2 && g.b2 && g.a2 < g.b2) tramos.push([g.a2, g.b2]);
    if (tramos.length) out[d] = tramos;
  }
  return out;
}

export function copyMonday(grid: Grid): Grid {
  const out = { ...grid };
  for (const d of ['tue', 'wed', 'thu', 'fri'] as const) out[d] = { ...grid.mon };
  return out;
}

/** ¿El día está «abierto»? Cualquier campo con algo cuenta (como shSyncRows). */
export function dayOn(grid: Grid, d: Dia): boolean {
  const g = grid[d];
  return Boolean(g.a1 || g.b1 || g.a2 || g.b2);
}

/**
 * Apagar un día borra sus horas; encenderlo pone un tramo por defecto para que quede
 * válido de entrada (hoursFromGrid exige a<b para guardar el tramo).
 */
export function setDay(grid: Grid, d: Dia, on: boolean): Grid {
  return { ...grid, [d]: on ? { a1: '09:00', b1: '19:00', a2: '', b2: '' } : { ...VACIO } };
}

/**
 * Lo que de verdad está en vigor, en una frase. Un objeto vacío NO es lo mismo que
 * «sin configurar»: significa que nunca se ofrece asesor, y eso hay que decirlo o
 * parece un fallo.
 */
export function shSummary(hours: WeekHours): string {
  const abiertos = DIAS.filter((d) => hours[d] && hours[d].length);
  if (!abiertos.length) return 'Ahora mismo NUNCA se ofrece asesor: Vai atiende siempre y te deja el lead.';
  return `En vigor: ${abiertos.length}${abiertos.length === 1 ? ' día' : ' días'} con atención humana.`;
}
