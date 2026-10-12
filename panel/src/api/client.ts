// Cliente HTTP del panel. Mismo origen que la API (el worker sirve estos estáticos en
// admin.hirevai.com): rutas relativas, sin CORS y sin tokens propios — la cookie la pone
// Cloudflare Access y el worker valida el JWT en cada petición.
import { busyStart, busyEnd } from './activity';
import { markSessionExpired } from './session';
import { MOBILE_PREVIEW, adminReadHref } from '../mobilePreview';
import { workspaceChoice, storeWorkspace } from '../workspace';

export class ApiError extends Error {
  /** Código de error del worker (p. ej. 'stale_tenant'); se traduce con TERRS/WIN_WHY. */
  override readonly message: string;
  readonly status: number;
  /** Detalle opcional que algunos handlers añaden ({ why }). */
  readonly why: string;

  constructor(code: string, status: number, why = '') {
    super(code);
    this.name = 'ApiError';
    this.message = code;
    this.status = status;
    this.why = why;
  }
}

export interface ApiOptions {
  /** Sondeo de fondo: no enciende la barra de actividad ni bloquea botones. */
  quiet?: boolean;
  signal?: AbortSignal;
}

/**
 * fetch + JSON + errores del worker. Todas las llamadas del panel pasan por aquí:
 * es el punto único que alimenta la barra de actividad (salvo con quiet).
 */
export async function api<T>(path: string, init?: RequestInit, options?: ApiOptions): Promise<T> {
  if (MOBILE_PREVIEW) {
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET' || !path.startsWith('/api/admin/')) {
      throw new ApiError('mobile_preview_read_only', 405);
    }
    path = adminReadHref(path);
  }
  const quiet = options?.quiet === true;
  if (!quiet) busyStart();
  try {
    // redirect:'manual' va DESPUÉS del spread a propósito: ninguna llamada puede
    // pedir 'follow' y volver a esconder la sesión caducada tras un error de CSP.
    const workspace = workspaceChoice();
    const headers = new Headers(init?.headers);
    headers.delete('X-Velai-Workspace');
    if (!MOBILE_PREVIEW && workspace === 'dialogos' && path.startsWith('/api/admin/')) headers.set('X-Velai-Workspace', workspace);
    let response: Response;
    try {
      response = await fetch(path, { ...init, headers, signal: options?.signal ?? init?.signal ?? null, redirect: 'manual' });
    } catch (e) {
      // Un abort es intencionado (sondeos de fondo): sigue su camino sin traducirse.
      if ((e as { name?: string })?.name === 'AbortError') throw e;
      throw new ApiError('network_failed', 0);
    }
    // Access interceptó la petición: respuesta opaca, sin cuerpo ni estado que leer.
    if (response.type === 'opaqueredirect' || response.status === 0) {
      markSessionExpired();
      throw new ApiError('session_expired', 401);
    }
    if (workspaceChoice() !== workspace) throw new ApiError('workspace_changed', 409);
    if (response.status === 204) return null as T;
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ApiError('request_failed', response.status);
    }
    if (workspaceChoice() !== workspace) throw new ApiError('workspace_changed', 409);
    if (!response.ok) {
      const body = data as { error?: unknown; why?: unknown };
      // A later Access login may belong to a client; only /me may retry once in its base space.
      if (path === '/api/admin/me' && workspace === 'dialogos' && response.status === 403 && body?.error === 'not_authorized' && storeWorkspace('velai')) return api<T>(path, init, options);
      throw new ApiError(String(body?.error ?? 'request_failed'), response.status, String(body?.why ?? ''));
    }
    return data as T;
  } finally {
    if (!quiet) busyEnd();
  }
}

/** CSV protegido: el fetch conserva el espacio; la navegación directa perdería su cabecera. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  if (!path.startsWith('/api/admin/') || path.includes('..')) throw new ApiError('invalid_download', 400);
  const workspace = workspaceChoice();
  const headers = new Headers();
  if (!MOBILE_PREVIEW && workspace === 'dialogos') headers.set('X-Velai-Workspace', workspace);
  const target = MOBILE_PREVIEW ? adminReadHref(path) : path;
  busyStart();
  try {
    let response: Response;
    try { response = await fetch(target, { headers, redirect: 'manual' }); }
    catch { throw new ApiError('network_failed', 0); }
    if (response.type === 'opaqueredirect' || response.status === 0) {
      markSessionExpired(); throw new ApiError('session_expired', 401);
    }
    if (workspaceChoice() !== workspace) throw new ApiError('workspace_changed', 409);
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { error?: string; why?: string } | null;
      throw new ApiError(error?.error || 'request_failed', response.status, error?.why || '');
    }
    if (!(response.headers.get('Content-Type') || '').toLowerCase().includes('text/csv')) throw new ApiError('invalid_download', 502);
    const blob = await response.blob();
    if (workspaceChoice() !== workspace) throw new ApiError('workspace_changed', 409);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename.replace(/[\/\\]/g, '_');
    document.body.append(link);
    try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  } finally { busyEnd(); }
}

/** POST con cuerpo JSON (el molde de casi todas las acciones del panel). */
export function apiPost<T>(path: string, body?: unknown, options?: ApiOptions): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }, options);
}

export function apiPatch<T>(path: string, body: unknown, options?: ApiOptions): Promise<T> {
  return api<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, options);
}

export function apiDelete<T>(path: string, options?: ApiOptions): Promise<T> {
  return api<T>(path, { method: 'DELETE' }, options);
}

/** Query string sin claves vacías (como params() del panel v1). */
export function qs(params: Record<string, string | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
