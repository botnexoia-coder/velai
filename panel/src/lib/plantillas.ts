// Lógica pura de la vista «Plantillas» (rediseño «por plantilla», 2026-09-01): el
// estado de cada celda, los chips por cliente de cada tarjeta, el filtrado (buscador
// por cliente + contador-filtro por estado, que COMPONEN) y los recuentos.
//
// Estados = el ciclo de aprobación de Meta que guarda el worker (pending/approved/
// rejected; 'received' es cómo llama Twilio a un pending recién entregado). Un estado
// desconocido cuenta como pendiente: mejor «esperando» que esconderlo.
import type { PlantillaCelda, PlantillasResponse } from '../api/types';

export type EstadoPlantilla = 'approved' | 'pending' | 'rejected' | 'sin';

export function estadoDeCelda(celda: PlantillaCelda | undefined | null): EstadoPlantilla {
  const status = celda?.status ?? null;
  if (!status) return 'sin';
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  return 'pending';
}

/** Comparación de nombres sin acentos ni mayúsculas (mismo criterio que chNorm de
 *  lib/canales: buscar «lopez» tiene que encontrar «López»). */
export function sinAcentos(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Un chip de cliente dentro de la tarjeta de un kind. */
export interface ChipCliente {
  id: string;
  name: string;
  active: number;
  estado: EstadoPlantilla;
  sid: string | null;
}

/** Los chips de la tarjeta de un kind: TODOS los clientes, con su estado en ese kind. */
export function chipsDeKind(data: PlantillasResponse, kind: string): ChipCliente[] {
  return data.tenants.map((t) => {
    const celda = t.plantillas[kind];
    return { id: t.id, name: t.name, active: t.active, estado: estadoDeCelda(celda), sid: celda?.sid ?? null };
  });
}

export interface ChipsFiltrados {
  /** Chips que pasan el buscador Y el filtro de estado. */
  visibles: ChipCliente[];
  /** Los que pasan el buscador pero NO el estado: se pliegan en «+N más». */
  ocultos: number;
  /** La tarjeta se atenúa cuando el BUSCADOR no encuentra a nadie en ella (el
   *  catálogo siempre se ve entero; el filtro de estado nunca atenúa). */
  atenuada: boolean;
}

export function filtraChips(chips: ChipCliente[], q: string, estado: EstadoPlantilla | ''): ChipsFiltrados {
  const needle = sinAcentos(q.trim());
  const delCliente = needle ? chips.filter((c) => sinAcentos(c.name).includes(needle)) : chips;
  const visibles = estado ? delCliente.filter((c) => c.estado === estado) : delCliente;
  return {
    visibles,
    ocultos: delCliente.length - visibles.length,
    atenuada: Boolean(needle) && delCliente.length === 0,
  };
}

// Etiquetas con su plural; «sin crear» es invariante.
const NOMBRES: [EstadoPlantilla, string, string][] = [
  ['approved', 'aprobada', 'aprobadas'],
  ['pending', 'pendiente', 'pendientes'],
  ['rejected', 'rechazada', 'rechazadas'],
  ['sin', 'sin crear', 'sin crear'],
];

function porEstado(chips: ChipCliente[]): Record<EstadoPlantilla, number> {
  const n: Record<EstadoPlantilla, number> = { approved: 0, pending: 0, rejected: 0, sin: 0 };
  for (const c of chips) n[c.estado]++;
  return n;
}

/** Resumen de la cabecera de una tarjeta: «1 pendiente · 4 sin crear» (solo lo que hay). */
export function resumenKind(chips: ChipCliente[]): string {
  const n = porEstado(chips);
  return NOMBRES.filter(([e]) => n[e] > 0)
    .map(([e, sing, plur]) => `${n[e]} ${n[e] === 1 ? sing : plur}`)
    .join(' · ');
}

export interface CuentaPlantillas {
  todas: number;
  aprobadas: number;
  pendientes: number;
  rechazadas: number;
  sinCrear: number;
}

/** Recuentos GLOBALES de las pills (clientes × kinds). No cambian al filtrar. */
export function cuentaPlantillas(data: PlantillasResponse): CuentaPlantillas {
  const out: CuentaPlantillas = { todas: 0, aprobadas: 0, pendientes: 0, rechazadas: 0, sinCrear: 0 };
  for (const t of data.tenants) {
    for (const k of data.kinds) {
      const e = estadoDeCelda(t.plantillas[k.kind]);
      out.todas++;
      if (e === 'approved') out.aprobadas++;
      else if (e === 'rejected') out.rechazadas++;
      else if (e === 'pending') out.pendientes++;
      else out.sinCrear++;
    }
  }
  return out;
}
