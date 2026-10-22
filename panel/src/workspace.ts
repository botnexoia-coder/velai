import { MOBILE_PREVIEW } from './mobilePreview';

// 'velai' o el slug de un cliente con «Espacio de Velai» (migración 0058). La lista sale
// de /me (workspace.options), no del código; `naya` es el alias heredado que el worker
// sigue aceptando para las pestañas que lo guardaron antes de la migración.
export type Workspace = string;
export const WORKSPACE_KEY = 'velai-panel-workspace';
// El nombre se guarda junto al id para poder decir QUÉ espacio no se pudo abrir: en ese
// momento /me ha fallado y no hay opciones de las que sacarlo.
export const WORKSPACE_LABEL_KEY = 'velai-panel-workspace-label';
const WORKSPACE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
export function workspaceChoice(): Workspace {
  if (MOBILE_PREVIEW) return 'velai';
  try { const stored = sessionStorage.getItem(WORKSPACE_KEY); return stored && stored !== 'velai' && WORKSPACE_RE.test(stored) ? stored : 'velai'; }
  catch { return 'velai'; }
}
export function workspaceLabel(): string {
  const choice = workspaceChoice();
  try { return sessionStorage.getItem(WORKSPACE_LABEL_KEY) || choice; }
  catch { return choice; }
}
export function storeWorkspace(workspace: Workspace, label?: string): boolean {
  if (MOBILE_PREVIEW) return false;
  try {
    if (workspace !== 'velai') {
      sessionStorage.setItem(WORKSPACE_KEY, workspace);
      if (label) sessionStorage.setItem(WORKSPACE_LABEL_KEY, label); else sessionStorage.removeItem(WORKSPACE_LABEL_KEY);
    } else { sessionStorage.removeItem(WORKSPACE_KEY); sessionStorage.removeItem(WORKSPACE_LABEL_KEY); }
    return true;
  } catch { return false; }
}
export function reloadWorkspace(workspace: Workspace) {
  window.location.assign(workspace === 'dialogos' ? '/calendario' : '/');
}
