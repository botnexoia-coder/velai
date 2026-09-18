import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ChannelAlerts } from './ChannelAlerts';
import { mockFetch } from '../test/fixtures';

afterEach(() => vi.unstubAllGlobals());

it('el Dashboard muestra el sender sin ruta y enlaza al WhatsApp de su cliente', async () => {
  vi.stubGlobal('fetch', mockFetch({ '/api/admin/channels': { channels: [], unrouted: [{
    tenant_id: 'gog', name: 'GOgestión', slug: 'gogestion', active: 1,
    twilio_from: 'whatsapp:+34910000001', sender_status: 'ONLINE', channel_address: 'web:gogestion',
  }] } }));
  render(<QueryClientProvider client={createQueryClient()}><MemoryRouter><ChannelAlerts /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText('WhatsApp sin enrutar')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Revisar WhatsApp: GOgestión' })).toHaveAttribute('href', '/conexiones?t=gog#whatsapp');
  expect(screen.getByRole('link', { name: 'Ver diagnóstico' })).toHaveAttribute('href', '/canales');
});

it('un error de consulta nunca se presenta como ausencia de incidencias', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not_found"}', { status: 404 })));
  render(<QueryClientProvider client={createQueryClient()}><MemoryRouter><ChannelAlerts /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText('Diagnóstico de canales no disponible')).toBeInTheDocument();
  expect(screen.getByText('No se pudo actualizar el diagnóstico.')).toBeInTheDocument();
});
