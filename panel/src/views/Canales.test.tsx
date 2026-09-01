// Canales: la tabla de enrutado real, el filtro en cliente (sin acentos y sin prefijo
// whatsapp:) y los sin enrutar que NUNCA se esconden.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from '../components/Toasts';
import { chNorm, channelsBad, filterChannels } from '../lib/canales';
import { Canales } from './Canales';
import type { ChannelsResponse } from '../api/types';

const data: ChannelsResponse = {
  channels: [
    {
      address: 'whatsapp:+34910000001',
      kind: 'whatsapp',
      created_at: '2026-08-01T10:00:00.000Z',
      tenant_id: 't1',
      slug: 'gogestion',
      name: 'GOgestión',
      active: 1,
      twilio_from: 'whatsapp:+34910000001',
      sender_status: 'ONLINE',
      state: 'live',
    },
    {
      address: 'whatsapp:+34910000002',
      kind: 'whatsapp',
      created_at: '2026-08-02T10:00:00.000Z',
      tenant_id: 't2',
      slug: 'dialogos',
      name: 'Diálogos',
      active: 0,
      twilio_from: 'whatsapp:+34910000002',
      sender_status: 'ONLINE',
      state: 'inactive',
    },
  ],
  unrouted: [
    {
      tenant_id: 't3',
      slug: 'barberia',
      name: 'Barbería López',
      active: 1,
      channel_address: 'web:barberia',
      twilio_from: 'whatsapp:+34910000003',
      sender_status: 'ONLINE',
    },
  ],
};

describe('lógica pura de canales', () => {
  it('busca sin acentos y sin el prefijo whatsapp:', () => {
    expect(chNorm('GOgestión')).toBe('gogestion');
    const r = filterChannels(data, { q: 'gogestion', tenant: '', state: '' });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.slug).toBe('gogestion');
    // El número se encuentra tecleado sin prefijo.
    expect(filterChannels(data, { q: '+34910000002', tenant: '', state: '' }).rows).toHaveLength(1);
  });

  it('el filtro «requieren atención» excluye lo atendido pero NUNCA los sin enrutar', () => {
    const r = filterChannels(data, { q: '', tenant: '', state: 'alert' });
    expect(r.rows.map((c) => c.state)).toEqual(['inactive']);
    expect(r.unrouted).toHaveLength(1);
  });

  it('la píldora global cuenta lo que requiere atención (inactivo + sin enrutar)', () => {
    expect(channelsBad(data)).toBe(2);
  });
});

describe('vista Canales', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pinta la tabla, la alarma de sin enrutar y el contador «X de Y»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <Canales />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByText('GOgestión').length).toBeGreaterThan(0));
    expect(screen.getAllByText('atendido').length).toBeGreaterThan(1); // flag + leyenda
    expect(screen.getByText('cliente inactivo')).toBeInTheDocument();
    // La alarma del caso gogestion: sender vivo sin fila que lo enrute.
    expect(screen.getByText(/el worker NO atiende/)).toBeInTheDocument();
    expect(screen.getByText('+34910000003')).toBeInTheDocument();
    expect(screen.getByText(/2 canales requieren atención/)).toBeInTheDocument();

    // Filtrar: el contador pasa a «X de Y canales» con el TOTAL del sistema.
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/Buscar número/), 'dialogos');
    await waitFor(() => expect(screen.getByText('1 de 2 canales')).toBeInTheDocument());
    // En la tabla solo queda Diálogos (GOgestión sigue en el <select>, nada más).
    expect(screen.getAllByText('GOgestión')).toHaveLength(1);
  });
});
