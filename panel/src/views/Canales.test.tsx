// Canales: la tabla de enrutado real, el filtro en cliente (sin acentos y sin prefijo
// whatsapp:) y los sin enrutar que NUNCA se esconden.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from '../components/Toasts';
import { chNorm, channelIncidents, channelsBad, filterChannels } from '../lib/canales';
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
    // Los enlaces del Dashboard conservan la dirección completa, incluido el prefijo.
    expect(filterChannels(data, { q: 'whatsapp:+34910000001', tenant: '', state: '' }).rows).toHaveLength(1);
  });

  it('el filtro «requieren atención» excluye lo atendido pero NUNCA los sin enrutar', () => {
    const r = filterChannels(data, { q: '', tenant: '', state: 'alert' });
    expect(r.rows).toHaveLength(0); // una pausa deliberada no es una incidencia
    expect(r.unrouted).toHaveLength(1);
  });

  it('cuenta incidencias, sin tratar clientes inactivos como averías', () => {
    expect(channelsBad(data)).toBe(1);
    expect(channelsBad({ channels: data.channels, unrouted: [{ ...data.unrouted[0]!, active: 0 }] })).toBe(0);
  });

  it('Enrutados conserva la alerta sin enrutar y respeta la búsqueda y el cliente', () => {
    expect(filterChannels(data, { q: '', tenant: '', state: 'live' }).unrouted).toHaveLength(1);
    expect(filterChannels(data, { q: '', tenant: 't1', state: 'live' }).unrouted).toHaveLength(0);
  });

  it('el diagnóstico de huérfanos no enlaza a una ficha inexistente; los desajustes abren el WhatsApp correcto', () => {
    const incidents = channelIncidents({ channels: [
      { ...data.channels[0]!, state: 'orphan', name: null, slug: null },
      { ...data.channels[1]!, state: 'from_mismatch', active: 1 },
    ], unrouted: [] });
    expect(incidents[0]?.href).toBe('/canales?q=whatsapp%3A%2B34910000001');
    expect(incidents[1]?.href).toBe('/conexiones?t=t2#whatsapp');
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
          <MemoryRouter><Canales /></MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByText('GOgestión').length).toBeGreaterThan(0));
    expect(screen.getByText('Enrutado')).toBeInTheDocument();
    expect(screen.getByText('cliente inactivo')).toBeInTheDocument();
    // La alarma del caso gogestion: sender vivo sin fila que lo enrute.
    expect(screen.getByText(/Números de WhatsApp sin enrutar/)).toBeInTheDocument();
    expect(screen.getByText('+34910000003')).toBeInTheDocument();
    expect(screen.getByText('1 incidencia')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Revisar WhatsApp de Barbería López' })).toHaveAttribute('href', '/conexiones?t=t3#whatsapp');

    // Filtrar: el contador pasa a «X de Y canales» con el TOTAL del sistema.
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'live');
    expect(screen.getByText('+34910000003')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), '');
    await user.type(screen.getByPlaceholderText(/Buscar número/), 'dialogos');
    await waitFor(() => expect(screen.getByText('1 de 2 rutas')).toBeInTheDocument());
    // En la tabla solo queda Diálogos (GOgestión sigue en el <select>, nada más).
    expect(screen.getAllByText('GOgestión')).toHaveLength(1);
  });

  it('Actualizar consulta aunque la caché esté fresca y retira una incidencia resuelta', async () => {
    let current = data;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(current)));
    vi.stubGlobal('fetch', fetchMock);
    render(<QueryClientProvider client={createQueryClient()}><MemoryRouter><Canales /></MemoryRouter></QueryClientProvider>);
    await screen.findByText('1 incidencia');
    current = { channels: data.channels, unrouted: [] };
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(await screen.findByText('Sin incidencias de configuración')).toBeInTheDocument();
    expect(screen.queryByText('+34910000003')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Última consulta:/)).toBeInTheDocument();
  });
});
