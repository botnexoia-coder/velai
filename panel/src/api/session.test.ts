// Cuando Cloudflare Access caduca no hay 401: hay un 302 a otro origen que la CSP del
// panel bloquea. Estas pruebas clavan que el panel lo reconoce y lo dice con palabras,
// en vez de dejar un «la petición falló» que parece un botón roto.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './client';
import { isSessionExpired, resetSession, subscribeSession } from './session';

afterEach(() => {
  resetSession();
  vi.unstubAllGlobals();
});

describe('sesión de Access caducada', () => {
  it('la respuesta opaca del login se traduce a session_expired y avisa una sola vez', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'opaqueredirect', status: 0 }) as unknown as Response));
    let avisos = 0;
    subscribeSession(() => {
      avisos++;
    });

    await expect(api('/api/admin/tenants')).rejects.toMatchObject({ message: 'session_expired', status: 401 });
    expect(isSessionExpired()).toBe(true);
    expect(avisos).toBe(1);

    // Una segunda petición fallida no vuelve a notificar: el aviso ya está en pantalla.
    await expect(api('/api/admin/leads')).rejects.toBeInstanceOf(ApiError);
    expect(avisos).toBe(1);
  });

  it('pide redirect manual: seguir la redirección es lo que escondía el fallo tras la CSP', async () => {
    const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/api/admin/me');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('un fallo de red se traduce, pero un abort sigue siendo un abort', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    await expect(api('/api/admin/me')).rejects.toMatchObject({ message: 'network_failed', status: 0 });
    expect(isSessionExpired()).toBe(false);

    const abort = new DOMException('The operation was aborted.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw abort;
    }));
    await expect(api('/api/admin/me')).rejects.toBe(abort);
  });
});
