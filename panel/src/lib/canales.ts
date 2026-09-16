// Lógica pura de las dos vistas de canales:
//  - la GLOBAL (solo velai): la tabla de ENRUTADO real, filtrada 100% en cliente —
//    cabe entera en una respuesta y filtrar sin ir al servidor es instantáneo;
//  - la tira del CLIENTE (Conexiones): todos los canales del producto, también los que
//    no existen aún, apagados y con «sin activar» — esconderlos dejaba la duda de si
//    el canal existe, y pintarlos como si funcionaran sería peor.
import type { ChannelsResponse, GlobalChannel, GlobalChannelState, TenantChannel, UnroutedSender } from '../api/types';

// Estados de la tabla global: los decide el worker; aquí solo se les pone palabras.
export const CHST: Record<GlobalChannelState, { cls: string; label: string }> = {
  live: { cls: 'ok', label: 'Enrutado' },
  inactive: { cls: 'off', label: 'cliente inactivo' },
  from_mismatch: { cls: '', label: 'responde con otro número' },
  orphan: { cls: 'bad', label: 'Cliente inexistente' },
};

// El buscador casa contra el número CON y SIN prefijo (nadie teclea «whatsapp:») y sin
// acentos en los dos lados: buscar «gogestion» tiene que encontrar «GOgestión».
export const chNorm = (v: unknown): string =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const chHay = (o: { address?: string | null; twilio_from?: string | null; name?: string | null; slug?: string | null; kind?: string }): string =>
  [o.address, o.twilio_from, o.name, o.slug, o.kind].map((v) => chNorm(v).replace(/^whatsapp:/, '')).join(' ');

export interface ChannelFilter {
  q: string;
  tenant: string;
  state: string; // '' | 'alert' | 'live' | ...
}

/** La advertencia de números sin enrutar es independiente del filtro de estado. */
export function filterChannels(data: ChannelsResponse, f: ChannelFilter): { rows: GlobalChannel[]; unrouted: UnroutedSender[] } {
  const q = chNorm(f.q.trim()).replace(/^(whatsapp|messenger):/, '');
  const keep = (o: Parameters<typeof chHay>[0] & { tenant_id?: string | null }) =>
    (!q || chHay(o).includes(q)) && (!f.tenant || o.tenant_id === f.tenant);
  return {
    rows: data.channels.filter((c) => keep(c) && (!f.state || (f.state === 'alert' ? c.state === 'orphan' || c.state === 'from_mismatch' : c.state === f.state))),
    // El estado filtra la tabla, pero no oculta la advertencia independiente.
    unrouted: data.unrouted.filter(keep),
  };
}

/** «X de Y rutas» con el TOTAL de registros, no lo filtrado. */
export function channelCountLabel(shown: number, total: number, filtered: boolean): string {
  const unidad = total === 1 ? ' ruta' : ' rutas';
  return filtered ? `${shown} de ${total}${unidad}` : `${total}${unidad}`;
}

/** Cuántos canales requieren atención (para la píldora global). */
export function channelsBad(data: ChannelsResponse): number {
  return channelIncidents(data).length;
}

export const connectionsPath = (id: string) => `/conexiones?t=${encodeURIComponent(id)}`;
export const clientPath = (id: string) => `/clientes?t=${encodeURIComponent(id)}`;

/** Las pausas deliberadas no son incidencias. Las filas huérfanas se conservan para diagnóstico. */
export function channelIncidents(data: ChannelsResponse) {
  return [
    ...data.unrouted.filter((u) => u.active).map((u) => ({
      key: `unrouted:${u.tenant_id}:${u.twilio_from}`,
      name: u.name, address: u.twilio_from,
      reason: 'WhatsApp sin enrutar',
      href: `${connectionsPath(u.tenant_id)}#whatsapp`, action: 'Revisar WhatsApp',
    })),
    ...data.channels.filter((c) => c.state === 'orphan' || c.state === 'from_mismatch').map((c) => ({
      key: c.address, name: c.name || 'Cliente inexistente', address: c.address,
      reason: c.state === 'orphan' ? 'Dirección asociada a un cliente inexistente' : 'WhatsApp responde con otro número',
      href: c.state === 'orphan' || !c.tenant_id ? `/canales?q=${encodeURIComponent(c.address)}` : `${connectionsPath(c.tenant_id)}#whatsapp`,
      action: c.state === 'orphan' ? 'Ver registro' : 'Revisar WhatsApp',
    })),
  ];
}

// ── Tira de canales del cliente (Conexiones) ─────────────────────────────────
export const CX_CAT: [string, string][] = [
  ['web', 'Tu web'],
  ['whatsapp', 'WhatsApp'],
  ['telegram', 'Telegram'],
  ['messenger', 'Messenger'],
  ['instagram', 'Instagram'],
];
const CX_SOON: Record<string, 1> = { instagram: 1 };
// Estado → [clase del punto, palabras]. Dos vocabularios a propósito: el cliente nunca
// lee un diagnóstico; Velai sí, porque a él le sirve.
const CXST: Record<string, [string, string]> = {
  on: ['on', 'Activo'],
  live: ['on', 'Configurado'],
  preparing: ['wait', 'Lo estamos dejando listo'],
  unrouted: ['bad', 'Sin enrutar'],
  from_mismatch: ['wait', 'Responde con otro número'],
  paused: ['', 'En pausa'],
  inactive: ['', 'Cliente inactivo'],
  off: ['', 'Sin conectar'],
  soon: ['', 'Sin activar'],
};

export interface CxTile {
  kind: string;
  label: string;
  /** Dirección legible o el texto de relleno. */
  address: string;
  stateCls: string;
  stateLabel: string;
  off: boolean;
  managedBy: string | null;
}

export function cxTiles(channels: TenantChannel[]): CxTile[] {
  const by = new Map(channels.map((c) => [c.kind as string, c]));
  return CX_CAT.map(([kind, label]) => {
    const c = by.get(kind) ?? { kind, state: CX_SOON[kind] ? 'soon' : 'off', address: null };
    const st: [string, string] = kind === 'telegram' && (c.state === 'on' || c.state === 'live')
      ? ['on', 'Vinculado'] : CXST[c.state] ?? CXST['off']!;
    const address = c.address
      ? String(c.address).replace(/^(whatsapp:|messenger:)/, '')
      : CX_SOON[kind]
        ? 'Canal todavía no disponible'
        : 'Sin configurar';
    const managedBy = 'managed_by' in c ? c.managed_by ?? null : null;
    return { kind, label, address, stateCls: st[0], stateLabel: st[1], off: !st[0], managedBy };
  });
}
