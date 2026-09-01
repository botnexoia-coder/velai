// El asistente de Telegram como dato puro (portado de tgRenderWiz en admin-panel.js).
// El estado real del servidor (bot, vínculo, temas) marca los pasos hechos; los pasos
// SIN señal del servidor (crear el grupo, dar permisos) se confirman con su botón y
// viven solo en memoria (tgManual): al recargar vuelven a preguntarse, a propósito.
import type { TelegramInfo } from '../api/types';

export type WizId = 'tgs1' | 'tgs2' | 'tgs3' | 'tgs4' | 'tgs5';
export const WIZ_FIN = 'tgsFin';

export interface WizNode {
  id: WizId;
  /** Número visible (los pasos ocultos no numeran). */
  num: number;
  done: boolean;
  current: boolean;
  label: string;
}

export interface WizState {
  nodes: WizNode[];
  /** Paso abierto: un WizId o WIZ_FIN. */
  open: WizId | typeof WIZ_FIN;
  /** «Paso X de Y» o «Completado ✓». */
  progress: string;
  finished: boolean;
  /** Mensaje del paso final, con el nombre del grupo y los temas. */
  finMsg: string;
}

const LABELS: Record<WizId, string> = {
  tgs1: 'Tu bot',
  tgs2: 'El grupo',
  tgs3: 'Conectar',
  tgs4: 'Permisos',
  tgs5: 'Temas',
};

/**
 * @param t          estado del servidor (GET /tenants/:id/telegram)
 * @param manual     pasos confirmados a mano en esta sesión (claves '1','2','4')
 * @param requested  paso que la persona abrió pinchando el riel (o null = automático)
 *
 * Básico = 2 pasos EXACTOS (grupo y conectar) para AMBOS roles: el paso del bot solo
 * existe con la marca blanca activa — si no, básico tendría marca blanca.
 */
export function wizState(t: TelegramInfo, manual: Record<string, boolean>, requested: string | null): WizState {
  const wl = t.whitelabel;
  const nTemas = t.topics.length;
  const steps: { id: WizId; visible: boolean; done: boolean }[] = [
    { id: 'tgs1', visible: wl, done: Boolean(t.botUsername) || Boolean(manual['1']) },
    { id: 'tgs2', visible: true, done: t.linked || Boolean(manual['2']) },
    { id: 'tgs3', visible: true, done: t.linked },
    { id: 'tgs4', visible: wl, done: nTemas > 0 || Boolean(manual['4']) },
    { id: 'tgs5', visible: wl, done: nTemas > 0 },
  ];
  const vis = steps.filter((s) => s.visible);
  const pending = vis.find((s) => !s.done);
  let open: WizId | typeof WIZ_FIN = (requested as WizId | null) ?? (pending ? pending.id : WIZ_FIN);
  if (open !== WIZ_FIN && !vis.some((s) => s.id === open)) open = pending ? pending.id : WIZ_FIN;
  let num = 0;
  const nodes: WizNode[] = vis.map((s) => {
    num++;
    return { id: s.id, num, done: s.done, current: s.id === open, label: LABELS[s.id] };
  });
  const finished = open === WIZ_FIN;
  const finMsg = `Los próximos leads llegarán a ${t.title ? `«${t.title}»` : 'tu grupo'}${
    wl && nTemas ? `, clasificados en ${nTemas}${nTemas === 1 ? ' tema.' : ' temas.'}` : '.'
  }`;
  return {
    nodes,
    open,
    progress: pending ? `Paso ${vis.indexOf(pending) + 1} de ${vis.length}` : 'Completado ✓',
    finished,
    finMsg,
  };
}
