// Las dos vistas de trabajo, renderizadas con fixtures de la API real: la tabla de
// leads con su detalle, y la bandeja con su cola, sus pestañas de canal y su cajón.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from '../components/Toasts';
import {
  availability,
  inbox,
  inboxConThread,
  leadRow,
  leadsPage1,
  meVelai,
  mockFetch,
  stats,
  tenants,
} from '../test/fixtures';
import { Leads } from './Leads';
import { Conversaciones } from './Conversaciones';

function providers(children: ReactNode) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const baseRoutes = {
  '/api/admin/me': meVelai,
  '/api/admin/stats': stats,
  '/api/admin/tenants': tenants,
  '/api/admin/availability': availability,
  '/api/admin/escalations': { escalations: [] },
};

afterEach(() => vi.unstubAllGlobals());

describe('vista Leads', () => {
  it('pinta la tabla con estado, avisos y cliente, y pagina por cursor', async () => {
    vi.stubGlobal('fetch', mockFetch({ ...baseRoutes, '/api/admin/leads': leadsPage1 }));
    render(providers(<Leads />));
    await waitFor(() => expect(screen.getByText('Marta Ruiz')).toBeInTheDocument());
    expect(screen.getAllByText('Cita para color').length).toBeGreaterThan(0);
    // El chip de avisos con su globo (telegram:sent → verde «Telegram»).
    expect(screen.getAllByText('Telegram').length).toBeGreaterThan(0);
    // Con nextCursor hay «Cargar más» y el contador dice que hay más detrás.
    expect(screen.getByRole('button', { name: /cargar más/i })).toBeInTheDocument();
    expect(screen.getByText(/2\+ resultados/)).toBeInTheDocument();
    // La fuente del filtro sale de los DATOS (stats.fuentes), no de una lista fija.
    expect(within(screen.getByLabelText('Fuente')).getByText('landing-clinicas')).toBeInTheDocument();
  });

  it('abre el detalle en modal y deja cambiar el estado', async () => {
    const detail = {
      lead: leadRow(),
      notes: [],
      events: [],
      notifications: [{ id: 1, lead_id: 'x', channel: 'telegram', status: 'sent', attempts: 1, last_error: null, next_attempt_at: null, updated_at: '' }],
    };
    vi.stubGlobal(
      'fetch',
      mockFetch({
        ...baseRoutes,
        '/api/admin/leads': leadsPage1,
        [`/api/admin/leads/${leadRow().id}`]: detail,
      }),
    );
    render(providers(<Leads />));
    const user = userEvent.setup();
    await user.click(await screen.findByText('Marta Ruiz'));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await waitFor(() => expect(within(dialog).getByText('Qué buscaba')).toBeInTheDocument());
    expect(within(dialog).getByText(/Aviso telegram: sent/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /guardar estado/i, hidden: true })).toBeInTheDocument();
    // Solo velai puede borrar (RGPD) y reintentar avisos.
    expect(within(dialog).getByRole('button', { name: /borrar lead/i, hidden: true })).toBeInTheDocument();
  });
});

describe('vista Conversaciones', () => {
  it('bandeja: cola visible, pestañas por canal con contador y quién espera primero', async () => {
    vi.stubGlobal('fetch', mockFetch({ ...baseRoutes, '/api/admin/inbox': inbox }));
    render(providers(<Conversaciones />));
    // La cola en rojo: es lo que hace funcionar las multisesiones.
    await waitFor(() => expect(screen.getByText('1 esperando asesor')).toBeInTheDocument());
    // Pestañas: Todos + los 4 canales del producto aunque estén a 0.
    expect(screen.getByRole('button', { name: 'Todos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Messenger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Instagram' })).toBeInTheDocument();
    // La que espera enseña los minutos, no la hora del último mensaje.
    expect(screen.getByText(/4′ esperando/)).toBeInTheDocument();
    // Disponibilidad resuelta por el servidor.
    expect(screen.getByText('Asesor disponible')).toBeInTheDocument();
  });

  it('hilo abierto: mensajes con quién habló y cajón con el control tomado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const path = url.split('?')[0] ?? url;
        if (path === '/api/admin/inbox') {
          const body = url.includes('conversation=') ? inboxConThread : inbox;
          return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const routes: Record<string, unknown> = baseRoutes;
        return new Response(JSON.stringify(routes[path] ?? { error: 'not_found' }), {
          status: path in routes ? 200 : 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    render(providers(<Conversaciones />));
    const user = userEvent.setup();
    const fila = (await screen.findAllByText('¿Tenéis hueco mañana?'))[0]!;
    await user.click(fila);
    // El hilo: burbujas y ventana abierta con el control tomado.
    await waitFor(() => expect(screen.getByText('¡Claro! ¿Por la mañana o por la tarde?')).toBeInTheDocument());
    expect(screen.getByText('Tienes el control')).toBeInTheDocument();
    expect(screen.getByText(/ana@velai\.ai/)).toBeInTheDocument();
    expect(screen.getByText('El visitante está en la página.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /devolver a vai/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Escribe tu respuesta…')).toBeInTheDocument();
  });
});
