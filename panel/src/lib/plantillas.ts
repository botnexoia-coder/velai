// Lógica pura de la vista «Plantillas»: el chip de cada celda y los recuentos de la
// cabecera. Los estados son los del ciclo de aprobación de Meta que guarda el worker
// (pending/approved/rejected; 'received' es cómo llama Twilio a un pending recién
// entregado — aquí es lo mismo: esperando).
import type { PlantillaCelda, PlantillasResponse } from '../api/types';

export interface ChipPlantilla {
  emoji: string;
  label: string;
  /** Sufijo de la clase .flag del sistema ('' = ámbar de espera). */
  cls: string;
}

export function chipPlantilla(celda: PlantillaCelda | undefined | null): ChipPlantilla {
  const status = celda?.status ?? null;
  if (!status) return { emoji: '—', label: 'sin crear', cls: 'off' };
  if (status === 'approved') return { emoji: '✅', label: 'aprobada', cls: 'ok' };
  if (status === 'rejected') return { emoji: '❌', label: 'rechazada', cls: 'bad' };
  if (status === 'pending' || status === 'received') return { emoji: '⏳', label: 'pendiente', cls: '' };
  // Estado que no conocemos (Twilio cambia formas): se enseña crudo, nunca se esconde.
  return { emoji: '⏳', label: status, cls: '' };
}

export interface CuentaPlantillas {
  aprobadas: number;
  pendientes: number;
  rechazadas: number;
  sinCrear: number;
}

/** Recuentos de la cabecera sobre TODAS las celdas de la matriz (clientes × kinds). */
export function cuentaPlantillas(data: PlantillasResponse): CuentaPlantillas {
  const out: CuentaPlantillas = { aprobadas: 0, pendientes: 0, rechazadas: 0, sinCrear: 0 };
  for (const t of data.tenants) {
    for (const k of data.kinds) {
      const status = t.plantillas[k.kind]?.status ?? null;
      if (!status) out.sinCrear++;
      else if (status === 'approved') out.aprobadas++;
      else if (status === 'rejected') out.rechazadas++;
      else out.pendientes++;
    }
  }
  return out;
}
