import { describe, expect, it } from 'vitest';
import { NB_TIP, ST_LABEL, TERRS, WIN_WHY, traducir } from './errors';
import { ApiError } from './client';

describe('mapa de errores (TERRS)', () => {
  it('traduce los códigos del worker a frases en español', () => {
    expect(traducir('stale_tenant')).toMatch(/Alguien modificó este cliente/);
    expect(traducir('rate_limited')).toMatch(/espera un minuto/i);
    expect(traducir('team_whatsapp_equals_from')).toMatch(/63031/);
  });

  it('traduce los motivos de la ventana de respuesta (WIN_WHY) con prioridad', () => {
    expect(traducir('window_closed')).toMatch(/24 h de WhatsApp/);
    expect(traducir('ya_tomada')).toMatch(/Otra persona del equipo/);
    expect(traducir('sin_control')).toMatch(/Toma el control/);
  });

  it('acepta un Error y usa su message como código', () => {
    expect(traducir(new ApiError('slug_taken', 409))).toBe('Ese slug ya existe.');
    expect(traducir(new Error('window_closed'))).toBe(WIN_WHY['window_closed']);
  });

  it('un código sin traducción se enseña tal cual (mejor que esconderlo)', () => {
    expect(traducir('twilio_500_99999')).toBe('twilio_500_99999');
    expect(traducir(undefined)).toBe('');
  });

  it('conserva el vocabulario del panel v1 (mismos códigos)', () => {
    // Muestra representativa de cada familia: provisión, Telegram, config, usuarios.
    for (const code of [
      'already_provisioned',
      'invalid_bot_token',
      'root_only',
      'email_taken',
      'cannot_remove_self',
      'webhook_secret_invalid',
      'turnstile_domains_limit',
    ]) {
      expect(TERRS[code], code).toBeTruthy();
    }
    expect(Object.keys(TERRS).length).toBeGreaterThanOrEqual(60);
  });

  it('etiquetas de estados y avisos en español', () => {
    expect(ST_LABEL['won']).toBe('ganado');
    expect(NB_TIP['skipped']).toMatch(/no está configurado/);
  });
});
