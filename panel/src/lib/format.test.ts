import { describe, expect, it } from 'vitest';
import {
  dayLabel,
  initials,
  minutesSince,
  prevPrefix,
  queueRemaining,
  tenantColor,
  tipRows,
  whoOf,
  windowHoursLeft,
} from './format';

describe('quién es la persona del otro lado (whoOf)', () => {
  it('prefiere el nombre del lead', () => {
    expect(whoOf({ lead_name: 'Marta', channel: 'web', external_id: 'uuid' })).toBe('Marta');
  });
  it('en web sin lead dice lo que se sabe, no un UUID', () => {
    expect(whoOf({ lead_name: null, channel: 'web', external_id: 'c0ffee00-…' })).toBe('Visitante de la web');
  });
  it('en WhatsApp quita el prefijo del número', () => {
    expect(whoOf({ lead_name: null, channel: 'whatsapp', external_id: 'whatsapp:+34600111222' })).toBe('+34600111222');
  });
  it('sin nada, lo dice', () => {
    expect(whoOf({ lead_name: null, channel: 'whatsapp', external_id: '' })).toBe('sin identificar');
  });
});

describe('prefijo del último mensaje (prevPrefix)', () => {
  it('«tú» es la PERSONA del equipo, no el bot', () => {
    expect(prevPrefix('agent')).toBe('tú: ');
    expect(prevPrefix('assistant')).toBe('Vai: ');
    expect(prevPrefix('user')).toBe('');
  });
});

describe('iniciales del avatar', () => {
  it('quita prefijos de canal y no alfanuméricos', () => {
    expect(initials('whatsapp:+34600111222')).toBe('34');
    expect(initials('Marta Ruiz')).toBe('MA');
    expect(initials('')).toBe('··');
  });
});

describe('filas del globo (tipRows)', () => {
  it('une con | y quita el | de las etiquetas — son datos de fuera', () => {
    expect(tipRows([['Leads', 7], ['web|movil', 3]])).toBe('Leads:7|web movil:3');
  });
});

describe('la cola de espera y la ventana', () => {
  const now = Date.parse('2026-08-31T12:00:00.000Z');
  it('minutos esperando, nunca negativos', () => {
    expect(minutesSince('2026-08-31T11:56:30.000Z', now)).toBe(3);
    expect(minutesSince('2026-08-31T12:05:00.000Z', now)).toBe(0);
    expect(minutesSince(null, now)).toBeNull();
  });
  it('cuenta atrás con el queueMin DEL SERVIDOR', () => {
    expect(queueRemaining('2026-08-31T11:56:30.000Z', 15, now)).toBe(12);
    expect(queueRemaining('2026-08-31T11:30:00.000Z', 15, now)).toBe(0);
    expect(queueRemaining(null, 15, now)).toBeNull();
  });
  it('horas de la ventana de Meta, redondeadas y nunca negativas', () => {
    expect(windowHoursLeft('2026-09-01T09:00:00.000Z', now)).toBe(21);
    expect(windowHoursLeft('2026-08-31T11:00:00.000Z', now)).toBe(0);
  });
});

describe('divisoria de día (dayLabel)', () => {
  // Fechas relativas a «hoy» para que el test no dependa de la zona horaria del CI.
  const hoy = new Date('2026-08-31T12:00:00.000Z');
  it('Hoy y Ayer se leen mejor que una fecha', () => {
    expect(dayLabel(hoy.toISOString(), hoy)).toBe('Hoy');
    expect(dayLabel(new Date(hoy.getTime() - 86400000).toISOString(), hoy)).toBe('Ayer');
    expect(dayLabel('2026-08-20T12:00:00.000Z', hoy)).toMatch(/agosto/);
  });
});

describe('color estable por tenant', () => {
  it('mismo id, mismo color (los colores no cambian al migrar)', () => {
    expect(tenantColor('abc')).toBe(tenantColor('abc'));
    expect(tenantColor('abc')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
