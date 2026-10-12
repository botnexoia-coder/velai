import { MOBILE_PREVIEW } from './mobilePreview';

export type Workspace = 'velai' | 'dialogos' | 'naya';
export const WORKSPACE_KEY = 'velai-panel-workspace';
export function workspaceChoice(): Workspace {
  if (MOBILE_PREVIEW) return 'velai';
  try { const stored = sessionStorage.getItem(WORKSPACE_KEY); return stored === 'dialogos' || stored === 'naya' ? stored : 'velai'; }
  catch { return 'velai'; }
}
export function storeWorkspace(workspace: Workspace): boolean {
  if (MOBILE_PREVIEW) return false;
  try {
    if (workspace !== 'velai') sessionStorage.setItem(WORKSPACE_KEY, workspace);
    else sessionStorage.removeItem(WORKSPACE_KEY);
    return true;
  } catch { return false; }
}
export function reloadWorkspace(workspace: Workspace) {
  window.location.assign(workspace === 'dialogos' ? '/calendario' : '/');
}
