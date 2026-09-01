// Los avisos sonoros: la referencia inicial es MUDA (activarlos no puede sonar por
// mensajes que ya estaban ahí desde hace horas) y el sonido va con Web Audio — un
// oscilador — y NO con <audio>: la CSP del panel no declara media-src, así que
// cualquier archivo de audio caería en default-src 'none' y quedaría bloqueado.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertDelta, alertTexto, beep } from './alertas';
import type { Alerts } from '../api/types';

const a = (over: Partial<Alerts> = {}): Alerts => ({ waiting: 0, unread: 0, lastInbound: null, ...over });

describe('alertDelta: la referencia inicial no suena', () => {
  it('sin referencia previa, jamás hay aviso', () => {
    expect(alertDelta(null, a({ waiting: 3, lastInbound: '2026-08-31T10:00:00Z' }))).toEqual({
      nuevoMensaje: false,
      nuevaEspera: false,
    });
  });
  it('mensaje nuevo = cambió el último entrante', () => {
    const prev = a({ lastInbound: '2026-08-31T10:00:00Z' });
    expect(alertDelta(prev, a({ lastInbound: '2026-08-31T10:05:00Z' })).nuevoMensaje).toBe(true);
    expect(alertDelta(prev, a({ lastInbound: '2026-08-31T10:00:00Z' })).nuevoMensaje).toBe(false);
    // Sin lastInbound en el nuevo sondeo, no hay nada que anunciar.
    expect(alertDelta(prev, a()).nuevoMensaje).toBe(false);
  });
  it('nueva espera = la cola CRECIÓ (que baje no es noticia)', () => {
    expect(alertDelta(a({ waiting: 1 }), a({ waiting: 2 })).nuevaEspera).toBe(true);
    expect(alertDelta(a({ waiting: 2 }), a({ waiting: 1 })).nuevaEspera).toBe(false);
  });
});

describe('alertTexto', () => {
  it('la espera manda sobre el mensaje y cuenta la cola', () => {
    expect(alertTexto({ nuevoMensaje: true, nuevaEspera: true }, 2)).toEqual({
      titulo: 'Alguien espera un asesor',
      cuerpo: '2 conversaciones esperando',
    });
    expect(alertTexto({ nuevoMensaje: true, nuevaEspera: true }, 1).cuerpo).toMatch(/^1 conversación/);
    expect(alertTexto({ nuevoMensaje: true, nuevaEspera: false }, 0).titulo).toBe('Mensaje nuevo');
  });
});

describe('beep: Web Audio, no <audio>', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('usa un oscilador (nada que cargar, nada que la CSP pueda bloquear)', () => {
    const start = vi.fn();
    const osc = {
      type: '',
      frequency: { value: 0 },
      connect: vi.fn().mockReturnValue({ connect: vi.fn() }),
      start,
      stop: vi.fn(),
    };
    const gain = {
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
    class FakeCtx {
      state = 'running';
      currentTime = 0;
      destination = {};
      createOscillator() {
        return osc;
      }
      createGain() {
        return gain;
      }
      resume() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioContext', FakeCtx as unknown as typeof AudioContext);
    beep();
    // Dos notas cortas: se reconoce sin ser estridente.
    expect(start).toHaveBeenCalledTimes(2);
    // Y jamás se crea un elemento <audio>.
    expect(document.querySelector('audio')).toBeNull();
  });

  it('sin AudioContext no revienta: la notificación sigue saliendo', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => beep()).not.toThrow();
  });
});
