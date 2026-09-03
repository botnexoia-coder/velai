// Conexiones: el asistente de Telegram como dato puro, los dos vocabularios de la tira
// de canales, el estado del WhatsApp en lenguaje de negocio y la vista montada.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from '../components/Toasts';
import { cxTiles } from '../lib/canales';
import { wizState, WIZ_FIN } from '../lib/telegram';
import { logoEstado, waEstado } from '../lib/whatsapp';
import { availability, meCliente, mockFetch } from '../test/fixtures';
import { Conexiones } from './Conexiones';
import type { TelegramInfo, TenantChannel, WhatsappInfoResponse, WhatsappRow } from '../api/types';

function tgInfo(over: Partial<TelegramInfo> = {}): TelegramInfo {
  return {
    linked: false,
    title: null,
    linked_at: null,
    botUsername: null,
    whitelabel: false,
    topics: [],
    weeklyReport: true,
    lastReport: null,
    ...over,
  };
}

describe('el asistente de Telegram (wizState)', () => {
  it('básico = 2 pasos EXACTOS (grupo y conectar); la marca blanca añade bot y temas', () => {
    const basico = wizState(tgInfo(), {}, null);
    expect(basico.nodes.map((n) => n.id)).toEqual(['tgs2', 'tgs3']);
    expect(basico.progress).toBe('Paso 1 de 2');
    const wl = wizState(tgInfo({ whitelabel: true }), {}, null);
    expect(wl.nodes.map((n) => n.id)).toEqual(['tgs1', 'tgs2', 'tgs3', 'tgs4', 'tgs5']);
  });

  it('el estado del servidor marca lo hecho; lo confirmado a mano vive en memoria', () => {
    // Vinculado: los pasos 2 y 3 quedan hechos y el básico está completado.
    const done = wizState(tgInfo({ linked: true, title: 'Mi grupo' }), {}, null);
    expect(done.open).toBe(WIZ_FIN);
    expect(done.progress).toBe('Completado ✓');
    expect(done.finMsg).toContain('«Mi grupo»');
    // Confirmar el grupo a mano abre el paso de conectar.
    const conManual = wizState(tgInfo(), { '2': true }, null);
    expect(conManual.open).toBe('tgs3');
  });

  it('pinchar el riel abre ese paso; un paso oculto no se puede abrir', () => {
    expect(wizState(tgInfo({ whitelabel: true }), {}, 'tgs4').open).toBe('tgs4');
    // tgs1 no existe sin marca blanca: cae al pendiente.
    expect(wizState(tgInfo(), {}, 'tgs1').open).toBe('tgs2');
  });

  it('con marca blanca y temas, el final cuenta los temas', () => {
    const s = wizState(tgInfo({ whitelabel: true, linked: true, botUsername: 'MiBot', title: 'G', topics: [{ thread_id: 2, name: 'Presupuestos' }] }), {}, null);
    expect(s.open).toBe(WIZ_FIN);
    expect(s.finMsg).toContain('clasificados en 1 tema.');
  });
});

describe('la tira de canales (dos vocabularios)', () => {
  it('pinta TODOS los canales del producto, también los que no existen aún', () => {
    const channels: TenantChannel[] = [
      { kind: 'web', address: 'minegocio.com', state: 'on' },
      { kind: 'whatsapp', address: 'whatsapp:+34910000001', state: 'preparing' },
    ];
    const tiles = cxTiles(channels);
    expect(tiles.map((t) => t.kind)).toEqual(['web', 'whatsapp', 'telegram', 'messenger', 'instagram']);
    expect(tiles[1]).toMatchObject({ address: '+34910000001', stateLabel: 'Lo estamos dejando listo' });
    expect(tiles[4]).toMatchObject({ stateLabel: 'Sin activar', address: 'Canal todavía no disponible', off: true });
    // Velai ve el diagnóstico crudo si el worker lo manda sin colapsar.
    expect(cxTiles([{ kind: 'whatsapp', address: 'whatsapp:+34', state: 'unrouted' }])[1]?.stateLabel).toBe('Sin enrutar');
    expect(cxTiles([{ kind: 'messenger', address: 'messenger:1077804955422697', state: 'live', managed_by: 'Velai (Messenger)' }])[3])
      .toMatchObject({ address: '1077804955422697', stateLabel: 'Atendido', managedBy: 'Velai (Messenger)' });
  });
});

describe('el WhatsApp del negocio en lenguaje de negocio (waEstado)', () => {
  const row = (over: Partial<WhatsappRow>): WhatsappRow => ({
    channel_address: 'web:x',
    twilio_from: 'whatsapp:+34910000001',
    has_waba: 1,
    sender_status: null,
    lead_template_status: null,
    meta_partner_status: null,
    team_whatsapp: null,
    wa_number: null,
    logo_url: null,
    logo_wa_url: null,
    has_token: 1,
    has_subaccount: 1,
    routed: 1,
    ...over,
  });
  const alerts = { telegram: 'on' as const, whatsapp: 'off' as const, any: true };

  it('ONLINE sin enrutar NO es «activo»: es trabajo pendiente nuestro', () => {
    expect(waEstado(row({ sender_status: 'ONLINE', routed: 0 }), alerts).kind).toBe('alta_sin_enrutar');
  });
  it('la coletilla de Telegram solo se promete con un Telegram entregando DE VERDAD', () => {
    const conTg = waEstado(row({ sender_status: 'ONLINE', lead_template_status: 'pending' }), alerts);
    expect(conTg).toMatchObject({ kind: 'activo', sub: 'telegram_fallback' });
    const sinTg = waEstado(row({ sender_status: 'ONLINE', lead_template_status: 'pending' }), { ...alerts, telegram: 'off', any: false });
    expect(sinTg.sub).toBe('aprobando');
    const aprobada = waEstado(row({ sender_status: 'ONLINE', lead_template_status: 'approved' }), alerts);
    expect(aprobada.sub).toBeNull();
  });
  it('verificando y sin conectar', () => {
    expect(waEstado(row({ sender_status: 'VERIFYING' }), alerts).kind).toBe('verificando');
    expect(waEstado(row({ sender_status: null }), alerts).kind).toBe('sin_conectar');
  });
});

describe('el texto del logo (logoEstado)', () => {
  const tr = (c: string) => c;
  const f = () => '30/8/26';
  it('sin logo, sin botón de aplicar; con fallo del perfil, el motivo a la vista', () => {
    expect(logoEstado(null, true, null, tr, f)).toEqual({ texto: 'Aún no has subido tu imagen.', applyVisible: false });
    const conFallo = logoEstado('https://x/logo.png', true, { ok: false, error: 'twilio_400_63101' }, tr, f);
    expect(conFallo.texto).toContain('twilio_400_63101');
    expect(conFallo.applyVisible).toBe(true);
  });
  it('aplicado ✓: no se vuelve a pedir subir la misma imagen', () => {
    const ok = logoEstado('https://x/logo.png', true, { ok: true, at: '2026-08-30' }, tr, f);
    expect(ok.applyVisible).toBe(false);
    expect(ok.texto).toContain('en tu WhatsApp');
  });
});

describe('vista Conexiones (rol cliente)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('monta la tira, el asistente, el horario, los avisos y el informe', async () => {
    const tid = meCliente.tenantId as string;
    const wa: WhatsappInfoResponse = {
      whatsapp: {
        channel_address: 'web:barberia-lopez',
        twilio_from: null,
        has_waba: 0,
        sender_status: null,
        lead_template_status: null,
        meta_partner_status: null,
        team_whatsapp: 'whatsapp:+34600111222',
        wa_number: null,
        logo_url: null,
        logo_wa_url: null,
        has_token: 0,
        has_subaccount: 0,
        routed: 0,
      },
      alerts: { telegram: 'off', whatsapp: 'off', any: false },
      profileSync: null,
    };
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/admin/me': meCliente,
        [`/api/admin/tenants/${tid}/channels`]: { channels: [{ kind: 'web', address: 'barberia.com', state: 'on' }] },
        [`/api/admin/tenants/${tid}/telegram`]: { telegram: tgInfo() },
        [`/api/admin/tenants/${tid}/whatsapp`]: wa,
        '/api/admin/availability': availability,
      }),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <Conexiones />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Recibe tus leads en Telegram')).toBeInTheDocument());
    // Tira: el canal web activo y los que faltan, apagados pero visibles.
    expect(screen.getByText('barberia.com')).toBeInTheDocument();
    expect(screen.getByText('Sin activar')).toBeInTheDocument();
    // Asistente básico: abre en «El grupo» (paso 1 de 2) — sin marca blanca no hay bot.
    expect(screen.getByText('Paso 1 de 2')).toBeInTheDocument();
    expect(screen.getByText('Crea el grupo de tu equipo')).toBeInTheDocument();
    expect(screen.queryByText('Crea el bot de tu negocio')).toBeNull();
    // El cliente NO ve el conmutador de marca blanca ni el webhook del bot.
    expect(screen.queryByText('Registrar webhook')).toBeNull();
    // Horario con su interruptor por día y resumen en vigor.
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Lunes' })).toBeInTheDocument());
    expect(screen.getByText(/1 día con atención humana/)).toBeInTheDocument();
    // Avisos: nadie recibe aviso → se dice claro.
    expect(screen.getByText(/nadie recibe un aviso/)).toBeInTheDocument();
    // Informe semanal encendido pero sin grupo: se pide vincular primero.
    expect(screen.getByText(/Vincula primero el grupo de Telegram/)).toBeInTheDocument();
    // WhatsApp sin conectar, en lenguaje de negocio.
    expect(screen.getByText(/Sin conectar todavía/)).toBeInTheDocument();
  });
});
