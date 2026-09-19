import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../App';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from '../components/Toasts';
import { availability, inbox, leadsPage1, meVelai, mockFetch, stats, tenants } from '../test/fixtures';

const naya = '653aaff5-8b17-4d71-a181-aa4b3c9f688d';
const otro = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.className = '';
});

it('Velai ve Eventos y la selección activa no mezcla datos de otros clientes', async () => {
  vi.stubGlobal('fetch', vi.fn(mockFetch({
    '/api/admin/me': meVelai,
    '/api/admin/stats': stats,
    '/api/admin/channels': { channels: [], unrouted: [] },
    '/api/admin/tenants': tenants,
    '/api/admin/leads': leadsPage1,
    '/api/admin/inbox': inbox,
    '/api/admin/availability': availability,
    '/api/admin/escalations': { escalations: [] },
    '/api/admin/ai-usage': { days: 30, total: { cost: 0, calls: 0, tokens: 0 }, clientes: [], porDia: [], moneda: 'USD' },
    '/api/admin/ai-balance': { month: '2026-09', included: 1, used: 0, remaining: 1, pct: 0, over: false, usedToday: 0, calls: 0, serie: [] },
    '/api/admin/events': {
      events: [
        { id: '70000000-0000-4000-8000-000000000001', tenant_id: naya, tenant_name: 'Naya Eventos', slug: 'solteros', name: 'Noche de Solteros', starts_at: '2026-10-30T22:00:00.000Z', venue: "Co'legiale", address: 'Calle Geología 53', status: 'active', updated_at: '2026-09-19T10:00:00.000Z' },
        { id: '70000000-0000-4000-8000-000000000002', tenant_id: otro, tenant_name: 'Otro cliente', slug: 'otro', name: 'Otro evento', starts_at: null, venue: null, address: null, status: 'closed', updated_at: '2026-09-19T10:00:00.000Z' },
      ],
      reservations: [
        { id: '80000000-0000-4000-8000-000000000001', tenant_id: naya, event_id: '70000000-0000-4000-8000-000000000001', event_name: 'Noche de Solteros', conversation_id: null, lead_id: null, kind: 'event_reservation', name: 'Reserva NAYA', contact: '+34600000001', details: '2 personas', status: 'pending', created_at: '2026-09-19T10:00:00.000Z', updated_at: '2026-09-19T10:00:00.000Z' },
        { id: '80000000-0000-4000-8000-000000000002', tenant_id: otro, event_id: null, event_name: null, conversation_id: null, lead_id: null, kind: 'own_event', name: 'Evento ajeno', contact: '+34600000002', details: 'No debe verse', status: 'pending', created_at: '2026-09-19T10:00:00.000Z', updated_at: '2026-09-19T10:00:00.000Z' },
      ],
      consents: [
        { id: 1, tenant_id: naya, contact: '+34600000001', purpose: 'future_events', status: 'accepted', channel: 'whatsapp', evidence: 'sí', created_at: '2026-09-19T10:00:00.000Z' },
        { id: 2, tenant_id: otro, contact: '+34600000002', purpose: 'future_events', status: 'accepted', channel: 'whatsapp', evidence: 'sí', created_at: '2026-09-19T10:00:00.000Z' },
      ],
    },
  })));

  render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider><MemoryRouter initialEntries={['/eventos']}><App /></MemoryRouter></ToastProvider>
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByRole('tab', { name: 'Eventos' })).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText('Reserva NAYA')).toBeInTheDocument());
  expect(screen.getByText('Naya Eventos · Noche de Solteros')).toBeInTheDocument();
  expect(screen.getAllByText('+34600000001')).toHaveLength(2);
  expect(screen.queryByText('Evento ajeno')).toBeNull();
  expect(screen.queryByText('+34600000002')).toBeNull();
});
