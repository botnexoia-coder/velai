// El indicador de actividad global: contador con 180 ms de gracia, botón pulsado
// bloqueado y latiendo, y los sondeos de fondo en silencio.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUSY_GRACE_MS, busyEnd, busyStart, resetActivity } from './activity';
import { api } from './client';

const busyOn = () => document.documentElement.classList.contains('busy');

beforeEach(() => {
  vi.useFakeTimers();
  resetActivity();
});
afterEach(() => {
  resetActivity();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('barra de actividad', () => {
  it('180 ms de gracia: lo rápido no parpadea', () => {
    busyStart();
    expect(busyOn()).toBe(false);
    vi.advanceTimersByTime(BUSY_GRACE_MS - 1);
    expect(busyOn()).toBe(false);
    busyEnd();
    vi.advanceTimersByTime(50);
    expect(busyOn()).toBe(false);
  });

  it('pasada la gracia, la barra se enciende y se apaga al terminar', () => {
    busyStart();
    vi.advanceTimersByTime(BUSY_GRACE_MS + 1);
    expect(busyOn()).toBe(true);
    busyEnd();
    expect(busyOn()).toBe(false);
  });

  it('contador, no booleano: la corta no apaga la barra con la larga en vuelo', () => {
    busyStart(); // larga
    busyStart(); // corta
    vi.advanceTimersByTime(BUSY_GRACE_MS + 1);
    busyEnd(); // acaba la corta
    expect(busyOn()).toBe(true);
    busyEnd(); // acaba la larga
    expect(busyOn()).toBe(false);
  });

  it('el botón pulsado queda bloqueado y latiendo hasta que no quede nada en vuelo', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    busyStart();
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains('loading')).toBe(true);
    busyEnd();
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains('loading')).toBe(false);
    btn.remove();
  });
});

describe('api() y el silencio de los sondeos', () => {
  function pendingFetch() {
    let resolve!: (r: Response) => void;
    const promise = new Promise<Response>((r) => {
      resolve = r;
    });
    vi.stubGlobal('fetch', vi.fn(() => promise));
    return () => resolve(new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }

  it('una llamada normal enciende la barra mientras vuela', async () => {
    const settle = pendingFetch();
    const p = api('/api/admin/stats');
    vi.advanceTimersByTime(BUSY_GRACE_MS + 1);
    expect(busyOn()).toBe(true);
    settle();
    await p;
    expect(busyOn()).toBe(false);
  });

  it('un sondeo de fondo (quiet) NO la enciende: si no, dejaría de significar algo', async () => {
    const settle = pendingFetch();
    const p = api('/api/admin/inbox', undefined, { quiet: true });
    vi.advanceTimersByTime(BUSY_GRACE_MS + 100);
    expect(busyOn()).toBe(false);
    settle();
    await p;
    expect(busyOn()).toBe(false);
  });

  it('los errores del worker llegan como código traducible ({error, why})', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"stale_tenant","why":"detalle"}', { status: 409, headers: { 'Content-Type': 'application/json' } })),
    );
    await expect(api('/api/admin/tenants/x')).rejects.toMatchObject({ message: 'stale_tenant', status: 409, why: 'detalle' });
    expect(busyOn()).toBe(false); // el finally apaga la barra también al fallar
  });
});
