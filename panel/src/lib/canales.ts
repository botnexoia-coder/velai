// Lógica pura de las dos vistas de canales:
//  - la GLOBAL (solo velai): la tabla de ENRUTADO real, filtrada 100% en cliente —
//    cabe entera en una respuesta y filtrar sin ir al servidor es instantáneo;
//  - la tira del CLIENTE (Conexiones): todos los canales del producto, también los que
//    no existen aún, apagados y con «sin activar» — esconderlos dejaba la duda de si
//    el canal existe, y pintarlos como si funcionaran sería peor.
import type { ChannelsResponse, GlobalChannel, GlobalChannelState, TenantChannel, UnroutedSender } from '../api/types';

// Estados de la tabla global: los decide el worker; aquí solo se les pone palabras.
export const CHST: Record<GlobalChannelState, { cls: string; label: string }> = {
  live: { cls: 'ok', label: 'atendido' },
  inactive: { cls: 'off', label: 'cliente inactivo' },
  from_mismatch: { cls: '', label: 'responde con otro número' },
  orphan: { cls: 'off', label: 'cliente borrado' },
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

/** Los sin enrutar son SIEMPRE «requieren atención»: nunca los esconde el filtro de estado. */
export function filterChannels(data: ChannelsResponse, f: ChannelFilter): { rows: GlobalChannel[]; unrouted: UnroutedSender[] } {
  const q = chNorm(f.q.trim());
  const keep = (o: Parameters<typeof chHay>[0] & { tenant_id?: string | null }, state: string) =>
    (!q || chHay(o).includes(q)) && (!f.tenant || o.tenant_id === f.tenant) && (!f.state || (f.state === 'alert' ? state !== 'live' : state === f.state));
  return {
    rows: data.channels.filter((c) => keep(c, c.state)),
    unrouted: data.unrouted.filter((u) => keep(u, 'unrouted')),
  };
}

/** «X de Y canales» con el TOTAL del sistema, no lo filtrado. */
export function channelCountLabel(shown: number, total: number, filtered: boolean): string {
  const unidad = total === 1 ? ' canal' : ' canales';
  return filtered ? `${shown} de ${total}${unidad}` : `${total}${unidad}`;
}

/** Cuántos canales requieren atención (para la píldora global). */
export function channelsBad(data: ChannelsResponse): number {
  return data.unrouted.length + data.channels.filter((c) => c.state !== 'live').length;
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
  live: ['on', 'Atendido'],
  preparing: ['wait', 'Lo estamos dejando listo'],
  unrouted: ['bad', 'Sin enrutar'],
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
}

export function cxTiles(channels: TenantChannel[]): CxTile[] {
  const by = new Map(channels.map((c) => [c.kind as string, c]));
  return CX_CAT.map(([kind, label]) => {
    const c = by.get(kind) ?? { kind, state: CX_SOON[kind] ? 'soon' : 'off', address: null };
    const st = CXST[c.state] ?? CXST['off']!;
    const address = c.address
      ? String(c.address).replace(/^(whatsapp:|messenger:)/, '')
      : CX_SOON[kind]
        ? 'Canal todavía no disponible'
        : 'Sin configurar';
    return { kind, label, address, stateCls: st[0], stateLabel: st[1], off: !st[0] };
  });
}
