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
import { Dashboard } from './Dashboard';

function providers(children: ReactNode, initialEntry = '/') {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
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

describe('vista Dashboard', () => {
  it('calcula captura con conversaciones enlazadas, sin mezclar formularios ni ocultar un 115% con clamp', async () => {
    const audited = {
      ...stats,
      total30: 138, // el cálculo antiguo habría pintado 115% sobre 120 conversaciones
      porCanal: [
        { canal: 'chat web', n: 17 },
        { canal: 'formulario web', n: 79 },
        { canal: 'whatsapp', n: 42 },
      ],
      captura: {
        conversaciones: 120,
        leads: 42,
        porCanal: [
          { canal: 'messenger', convs: 10, leads: 4 },
          { canal: 'web', convs: 70, leads: 18 },
          { canal: 'whatsapp', convs: 40, leads: 20 },
        ],
        desde: '2026-08-26',
        periodoCompleto: false,
      },
    };
    vi.stubGlobal('fetch', mockFetch({
      '/api/admin/me': meVelai,
      '/api/admin/stats': audited,
      '/api/admin/ai-usage': { days: 30, total: { cost: 0, calls: 0, tokens: 0 }, clientes: [], porDia: [], moneda: 'USD' },
    }));
    render(providers(<Dashboard />));

    expect(await screen.findByText('42 de 120 conversaciones')).toBeInTheDocument();
    expect(screen.getByText('4/10 · 40%')).toBeInTheDocument();
    expect(screen.getByText('18/70 · 26%')).toBeInTheDocument();
    expect(screen.getByText('20/40 · 50%')).toBeInTheDocument();
    expect(screen.queryByText('115%')).not.toBeInTheDocument();
    expect(screen.getByText(/los formularios se muestran en «Leads por canal»/)).toBeInTheDocument();
  });

  it('señala una captura incoherente en vez de convertirla en 100%', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/api/admin/me': meVelai,
      '/api/admin/stats': {
        ...stats,
        captura: {
          conversaciones: 100,
          leads: 115,
          porCanal: [{ canal: 'whatsapp', convs: 100, leads: 115 }],
          desde: '2026-08-26',
          periodoCompleto: false,
        },
      },
      '/api/admin/ai-usage': { days: 30, total: { cost: 0, calls: 0, tokens: 0 }, clientes: [], porDia: [], moneda: 'USD' },
    }));
    render(providers(<Dashboard />));

    expect(await screen.findByRole('alert')).toHaveTextContent('Datos de captura incoherentes');
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  it('no rompe si una respuesta antigua todavía no trae el bloque de captura', async () => {
    const antigua = { ...stats } as Partial<typeof stats>;
    delete antigua.captura;
    vi.stubGlobal('fetch', mockFetch({
      '/api/admin/me': meVelai,
      '/api/admin/stats': antigua,
      '/api/admin/ai-usage': { days: 30, total: { cost: 0, calls: 0, tokens: 0 }, clientes: [], porDia: [], moneda: 'USD' },
    }));
    render(providers(<Dashboard />));

    expect(await screen.findByText('Tasa de captura · desde el inicio del registro')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

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

  it('abre directamente el hilo enlazado desde un aviso de Messenger', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const path = url.split('?')[0] ?? url;
        if (path === '/api/admin/inbox') {
          const body = url.includes(`conversation=${inboxConThread.thread?.conversation.id}`) ? inboxConThread : inbox;
          return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const routes: Record<string, unknown> = baseRoutes;
        return new Response(JSON.stringify(routes[path] ?? { error: 'not_found' }), {
          status: path in routes ? 200 : 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const conversationId = inboxConThread.thread!.conversation.id;
    render(providers(<Conversaciones />, `/conversaciones?conversation=${conversationId}`));

    expect(await screen.findByText('¡Claro! ¿Por la mañana o por la tarde?')).toBeInTheDocument();
    expect(screen.getByText('Tienes el control')).toBeInTheDocument();
  });
});
