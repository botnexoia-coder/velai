import { describe, expect, it } from 'vitest';
import { composerKey, composerState } from './composer';
import type { ConversationHead, ReplyWindow } from '../api/types';

function conv(over: Partial<ConversationHead> = {}): ConversationHead {
  return {
    id: 'bbbbbbbb-0000-4000-8000-000000000001',
    channel: 'whatsapp',
    external_id: 'whatsapp:+34600111222',
    msgs: 4,
    unanswered: 0,
    started_at: '2026-08-31T10:00:00.000Z',
    last_at: '2026-08-31T11:00:00.000Z',
    state: 'bot',
    state_at: null,
    agent_email: null,
    lead_id: null,
    expires_at: null,
    ...over,
  };
}

const NOW = Date.parse('2026-08-31T12:00:00.000Z');

describe('el cajón de respuesta (composerState)', () => {
  it('cerrado con la IA atendiendo: motivo en palabras, no un candado mudo', () => {
    const s = composerState({ open: false, reason: 'atiende_la_ia' }, conv(), 15, NOW);
    expect(s).toEqual({ kind: 'closed', why: expect.stringMatching(/Vai está atendiendo/) });
  });

  it('ventana de Meta cerrada: se explica la plantilla', () => {
    const s = composerState({ open: false, reason: 'window_closed' }, conv({ state: 'humano' }), 15, NOW);
    expect(s.kind).toBe('closed');
    if (s.kind === 'closed') expect(s.why).toMatch(/plantilla aprobada por Meta/);
  });

  it('esperando: NO es un cajón cerrado — es tomar el control, con cuenta atrás', () => {
    const s = composerState(
      { open: false, reason: 'sin_control' },
      conv({ state: 'esperando', state_at: '2026-08-31T11:56:00.000Z' }),
      15,
      NOW,
    );
    expect(s).toEqual({ kind: 'waiting', waitedMin: 4, remainingMin: 11 });
  });

  it('esperando con la cola agotada: quedan 0 (Vai está a punto de retomar)', () => {
    const s = composerState(
      { open: false, reason: 'sin_control' },
      conv({ state: 'esperando', state_at: '2026-08-31T11:30:00.000Z' }),
      15,
      NOW,
    );
    expect(s).toEqual({ kind: 'waiting', waitedMin: 30, remainingMin: 0 });
  });

  it('abierto por WhatsApp: enseña las horas que quedan de la ventana', () => {
    const win: ReplyWindow = { open: true, closesAt: '2026-09-01T09:00:00.000Z', lastIn: '2026-08-31T09:00:00.000Z' };
    const s = composerState(win, conv({ state: 'humano', agent_email: 'ana@velai.ai' }), 15, NOW);
    expect(s).toEqual({
      kind: 'open',
      agentEmail: 'ana@velai.ai',
      status: { kind: 'whatsapp', hoursLeft: 21 },
    });
  });

  it('abierto en web: el dato es si el visitante sigue delante', () => {
    const s = composerState({ open: true, web: true, away: true }, conv({ state: 'humano', channel: 'web' }), 15, NOW);
    expect(s.kind).toBe('open');
    if (s.kind === 'open') expect(s.status).toEqual({ kind: 'web', away: true });
  });

  it('sin ventana (hilo aún sin datos): cerrado con el motivo genérico', () => {
    const s = composerState(undefined, conv(), 15, NOW);
    expect(s.kind).toBe('closed');
    if (s.kind === 'closed') expect(s.why).toMatch(/ahora mismo/);
  });
});

describe('composerKey: el cajón solo se reconstruye cuando cambia lo que se ve', () => {
  it('estable frente al polling que no cambia nada relevante', () => {
    const w: ReplyWindow = { open: true, web: true, away: false };
    const a = composerKey(w, conv({ state: 'humano', agent_email: 'ana@velai.ai' }));
    const b = composerKey({ ...w, seenAt: 'otro-instante' }, conv({ state: 'humano', agent_email: 'ana@velai.ai', last_at: 'otro' }));
    expect(a).toBe(b);
  });
  it('cambia cuando el visitante se va, o cambia el estado o quién tiene el control', () => {
    const base = composerKey({ open: true, web: true, away: false }, conv({ state: 'humano' }));
    expect(composerKey({ open: true, web: true, away: true }, conv({ state: 'humano' }))).not.toBe(base);
    expect(composerKey({ open: false, reason: 'ya_tomada' }, conv({ state: 'humano' }))).not.toBe(base);
    expect(composerKey({ open: true, web: true, away: false }, conv({ state: 'humano', agent_email: 'x@y.z' }))).not.toBe(base);
  });
});
