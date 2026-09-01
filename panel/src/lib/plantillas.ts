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


/** Un chip de cliente dentro de la tarjeta de un kind. */
export interface ChipCliente {
  id: string;
  name: string;
  active: number;
  estado: EstadoPlantilla;
  sid: string | null;
  /** La categoría REAL leída de Twilio (null = aún no leída). */
  categoria: string | null;
}

/** Los chips de la tarjeta de un kind: TODOS los clientes, con su estado en ese kind. */
export function chipsDeKind(data: PlantillasResponse, kind: string): ChipCliente[] {
  return data.tenants.map((t) => {
    const celda = t.plantillas[kind];
    return { id: t.id, name: t.name, active: t.active, estado: estadoDeCelda(celda), sid: celda?.sid ?? null, categoria: celda?.categoria ?? null };
  });
}

/** La categoría a ENSEÑAR de una plantilla existente: SIEMPRE la real de Twilio, jamás
 *  la intención del catálogo disfrazada de hecho (cazada de Juan: la de lead de
 *  gogestion es Marketing en Twilio y el panel pintaba Utility). null cuando no hay
 *  plantilla; label «—» cuando existe pero la categoría aún no se leyó; `distinta`
 *  marca la divergencia con el catálogo (aviso de coste: Marketing es más cara). */
export function categoriaReal(
  celda: { status?: string | null; categoria?: string | null } | undefined | null,
  kind: { categoria?: string },
): { label: string; distinta: boolean } | null {
  if (!celda || !celda.status) return null;
  if (!celda.categoria) return { label: '—', distinta: false };
  const real = String(celda.categoria).toUpperCase();
  const label = real.charAt(0) + real.slice(1).toLowerCase();
  return { label, distinta: Boolean(kind.categoria) && real !== String(kind.categoria).toUpperCase() };
}

/** Las líneas de→a de una solicitud, para la tarjeta de Velai (y sus tests): lo
 *  ACTUAL sale de la respuesta del worker y los textos de pareja, del catálogo. */
export function resumenSolicitud(
  payload: { botones?: string; antelacion?: number },
  actual: { hours: number; opciones: { botones?: string; textos?: { confirmar: string; cancelar: string } } | null } | undefined,
  kind: { config?: { botones?: { id: string; confirmar: string; cancelar: string }[]; botonesDefault?: string } } | undefined,
): string[] {
  const lineas: string[] = [];
  if (payload.antelacion) lineas.push(`Antelación: ${actual ? `${actual.hours} h` : '?'} → ${payload.antelacion} h`);
  if (payload.botones) {
    const parejas = kind?.config?.botones ?? [];
    const de = actual?.opciones?.textos ?? parejas.find((b) => b.id === kind?.config?.botonesDefault) ?? null;
    const a = parejas.find((b) => b.id === payload.botones) ?? null;
    lineas.push(`Botones: «${de ? `${de.confirmar} / ${de.cancelar}` : '?'}» → «${a ? `${a.confirmar} / ${a.cancelar}` : payload.botones}»`);
  }
  return lineas;
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

// El filtro de cliente es EXACTO por id (viene de un desplegable, no de texto libre):
// el patrón de cliente del resto del panel. La búsqueda sin acentos se fue con el
// buscador — un select no tiene faltas de ortografía.
export function filtraChips(chips: ChipCliente[], clienteId: string, estado: EstadoPlantilla | ''): ChipsFiltrados {
  const delCliente = clienteId ? chips.filter((c) => c.id === clienteId) : chips;
  const visibles = estado ? delCliente.filter((c) => c.estado === estado) : delCliente;
  return {
    visibles,
    ocultos: delCliente.length - visibles.length,
    atenuada: Boolean(clienteId) && delCliente.length === 0,
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
