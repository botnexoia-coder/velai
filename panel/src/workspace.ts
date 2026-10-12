import { MOBILE_PREVIEW } from './mobilePreview';

export type Workspace = 'velai' | 'dialogos';
export const WORKSPACE_KEY = 'velai-panel-workspace';
export function workspaceChoice(): Workspace {
  if (MOBILE_PREVIEW) return 'velai';
  try { return sessionStorage.getItem(WORKSPACE_KEY) === 'dialogos' ? 'dialogos' : 'velai'; }
  catch { return 'velai'; }
}
export function storeWorkspace(workspace: Workspace): boolean {
  if (MOBILE_PREVIEW) return false;
  try {
    if (workspace === 'dialogos') sessionStorage.setItem(WORKSPACE_KEY, workspace);
    else sessionStorage.removeItem(WORKSPACE_KEY);
    return true;
  } catch { return false; }
}
export function reloadWorkspace(workspace: Workspace) {
  window.location.assign(workspace === 'dialogos' ? '/calendario' : '/');
}
