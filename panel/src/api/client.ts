// Cliente HTTP del panel. Mismo origen que la API (el worker sirve estos estáticos en
// admin.hirevai.com): rutas relativas, sin CORS y sin tokens propios — la cookie la pone
// Cloudflare Access y el worker valida el JWT en cada petición.
import { busyStart, busyEnd } from './activity';
import { markSessionExpired } from './session';

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
  const quiet = options?.quiet === true;
  if (!quiet) busyStart();
  try {
    // redirect:'manual' va DESPUÉS del spread a propósito: ninguna llamada puede
    // pedir 'follow' y volver a esconder la sesión caducada tras un error de CSP.
    let response: Response;
    try {
      response = await fetch(path, { ...init, signal: options?.signal ?? init?.signal ?? null, redirect: 'manual' });
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
    if (response.status === 204) return null as T;
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ApiError('request_failed', response.status);
    }
    if (!response.ok) {
      const body = data as { error?: unknown; why?: unknown };
      throw new ApiError(String(body?.error ?? 'request_failed'), response.status, String(body?.why ?? ''));
    }
    return data as T;
  } finally {
    if (!quiet) busyEnd();
  }
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
