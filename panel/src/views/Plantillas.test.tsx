// Plantillas (rediseño «por plantilla»): la lógica pura del filtrado y la vista —
// una tarjeta por kind, chips-píldora por estado, desplegable de cliente que atenúa,
// contador-filtro con «+N más», «Crear» solo donde toca y la legacy sin botón.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ConfirmarHost } from '../components/Confirmar';
import { ToastProvider } from '../components/Toasts';
import { categoriaReal, chipsDeKind, cuentaPlantillas, estadoDeCelda, filtraChips, resumenKind, resumenSolicitud } from '../lib/plantillas';
import { meCliente, meVelai, mockFetch } from '../test/fixtures';
import { Plantillas } from './Plantillas';
import type { PlantillasResponse } from '../api/types';

const RESP: PlantillasResponse = {
  kinds: [
    {
      kind: 'recordatorio_cita',
      label: 'Recordatorio de cita (Confirmaciones)',
      fuente: 'registro',
      categoria: 'UTILITY',
      descripcion: 'Recuerda la cita al cliente final con antelación.',
      config: {
        preview: 'Hola María, te escribimos de Clínica Ejemplo para recordarte tu cita.',
        antelaciones: [12, 24, 48],
        antelacionDefault: 24,
        botones: [
          { id: 'confirmo_cancelar', confirmar: 'Confirmo', cancelar: 'Cancelar' },
          { id: 'si_voy_no_puedo', confirmar: 'Sí, voy', cancelar: 'No puedo ir' },
        ],
        botonesDefault: 'confirmo_cancelar',
      },
    },
    {
      kind: 'aviso_lead', label: 'Aviso de lead', fuente: 'columnas', categoria: 'UTILITY',
      descripcion: 'Avisa al equipo del negocio.',
      config: { preview: '🔥 Nuevo lead – Clínica Ejemplo\n\n📱 WhatsApp: 34612345678\n👤 Nombre: María' },
    },
  ],
  tenants: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'alfa',
      name: 'Clínica Alfa',
      active: 1,
      plantillas: {
        recordatorio_cita: { sid: 'HX1', status: 'pending', updated_at: '2026-09-01T10:00:00Z', categoria: 'UTILITY' },
        // Categoría REAL distinta de la intención del catálogo: el caso gogestion.
        aviso_lead: { sid: 'HX2', status: 'approved', updated_at: null, categoria: 'MARKETING' },
      },
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'lopez',
      name: 'Barbería López',
      active: 1,
      plantillas: { recordatorio_cita: { sid: 'HX3', status: 'rejected', updated_at: null } },
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      slug: 'gama',
      name: 'Taller Gama',
      active: 0,
      plantillas: {},
    },
  ],
};

describe('lógica pura del filtrado de Plantillas', () => {
  const chips = chipsDeKind(RESP, 'recordatorio_cita');

  it('estadoDeCelda: sin/pendiente/aprobada/rechazada, con received y desconocidos como pendiente', () => {
    expect(estadoDeCelda(undefined)).toBe('sin');
    expect(estadoDeCelda({ sid: 'x', status: null, updated_at: null })).toBe('sin');
    expect(estadoDeCelda({ sid: 'x', status: 'approved', updated_at: null })).toBe('approved');
    expect(estadoDeCelda({ sid: 'x', status: 'rejected', updated_at: null })).toBe('rejected');
    expect(estadoDeCelda({ sid: 'x', status: 'received', updated_at: null })).toBe('pending');
    expect(estadoDeCelda({ sid: 'x', status: 'inventado', updated_at: null })).toBe('pending');
  });

  it('el desplegable de cliente filtra EXACTO por id y OCULTA los chips que no casan (sin plegarlos)', () => {
    // Desplegable, no texto libre (pedido de Juan): patrón de cliente del resto del panel.
    const r = filtraChips(chips, '22222222-2222-4222-8222-222222222222', '');
    expect(r.visibles.map((c) => c.name)).toEqual(['Barbería López']);
    expect(r.ocultos).toBe(0); // lo que quita el filtro de cliente NO va al «+N más»
    expect(r.atenuada).toBe(false);
    // Un id que no está en esta tarjeta: se atenúa, nunca desaparece.
    expect(filtraChips(chips, 'ffffffff-ffff-4fff-8fff-ffffffffffff', '').atenuada).toBe(true);
  });

  it('el filtro de estado PLIEGA el resto en ocultos, y compone con el de cliente', () => {
    const r = filtraChips(chips, '', 'rejected');
    expect(r.visibles.map((c) => c.name)).toEqual(['Barbería López']);
    expect(r.ocultos).toBe(2); // pending de Alfa + sin de Gama
    expect(r.atenuada).toBe(false); // el estado no atenúa: eso es solo del filtro de cliente
    // Compuestos: cliente Y estado a la vez.
    const both = filtraChips(chips, '11111111-1111-4111-8111-111111111111', 'pending');
    expect(both.visibles.map((c) => c.name)).toEqual(['Clínica Alfa']);
    expect(both.ocultos).toBe(0);
    expect(filtraChips(chips, '11111111-1111-4111-8111-111111111111', 'rejected')).toEqual({ visibles: [], ocultos: 1, atenuada: false });
  });

  it('resumen por tarjeta con plurales, y recuentos globales con «todas»', () => {
    expect(resumenKind(chips)).toBe('1 pendiente · 1 rechazada · 1 sin crear');
    expect(resumenKind(chipsDeKind(RESP, 'aviso_lead'))).toBe('1 aprobada · 2 sin crear');
    // 3 clientes × 2 kinds = 6 celdas.
    expect(cuentaPlantillas(RESP)).toEqual({ todas: 6, aprobadas: 1, pendientes: 1, rechazadas: 1, sinCrear: 3 });
  });
});

describe('vista Plantillas (rediseño por plantilla)', () => {
  // El desplegable de cliente mete cada nombre TAMBIÉN como <option>: las consultas por
  // texto deben contar solo los chips, no las opciones del select.
  const chipsDe = (nombre: string) => screen.getAllByText(nombre).filter((e) => e.tagName !== 'OPTION');
  const sinChips = (nombre: string) => screen.queryAllByText(nombre).filter((e) => e.tagName !== 'OPTION').length === 0;

  afterEach(() => vi.unstubAllGlobals());

  function renderVista(resp: PlantillasResponse = RESP) {
    vi.stubGlobal('fetch', mockFetch({ '/api/admin/me': meVelai, '/api/admin/plantillas': resp }));
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <Plantillas />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  it('una tarjeta por kind con label, categoría, descripción y su resumen', async () => {
    renderVista();
    await waitFor(() => expect(screen.getByText('Recordatorio de cita (Confirmaciones)')).toBeInTheDocument());
    expect(screen.getByText('Aviso de lead')).toBeInTheDocument();
    expect(screen.getAllByText('UTILITY').length).toBe(2);
    expect(screen.getByText('Recuerda la cita al cliente final con antelación.')).toBeInTheDocument();
    expect(screen.getByText('1 pendiente · 1 rechazada · 1 sin crear')).toBeInTheDocument();
    expect(screen.getByText('1 aprobada · 2 sin crear')).toBeInTheDocument();
    // Chips por estado con su clase de color.
    const alfa = screen.getAllByText('Clínica Alfa');
    expect(alfa.some((el) => el.closest('.plchip')?.className.includes('wait'))).toBe(true);
    expect(alfa.some((el) => el.closest('.plchip')?.className.includes('ok'))).toBe(true);
    // López sale en las DOS tarjetas: rechazada en recordatorio y sin crear en aviso.
    const lopez = screen.getAllByText('Barbería López');
    expect(lopez.some((el) => el.closest('.plchip')?.className.includes('bad'))).toBe(true);
    expect(lopez.some((el) => el.closest('.plchip')?.className.includes('sin'))).toBe(true);
    // La nota del cron, al pie.
    expect(screen.getByText(/cada 5 minutos y avisa por Telegram/)).toBeInTheDocument();
  });

  it('los contadores-filtro son globales, filtran chips y el «+N más» restaura Todas', async () => {
    const user = userEvent.setup();
    renderVista();
    await waitFor(() => expect(screen.getByRole('button', { name: /Todas 6/ })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Rechazadas 1/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Rechazadas 1/ }));
    // En la tarjeta del recordatorio queda solo López; el resto plegado en «+2 más».
    expect(chipsDe('Barbería López').length).toBeGreaterThan(0);
    expect(sinChips('Taller Gama')).toBe(true);
    expect(screen.getByRole('button', { name: '+2 más' })).toBeInTheDocument();
    // Los recuentos NO cambian al filtrar.
    expect(screen.getByRole('button', { name: /Todas 6/ })).toBeInTheDocument();
    // El «+N más» restaura «Todas».
    await user.click(screen.getByRole('button', { name: '+2 más' }));
    await waitFor(() => expect(chipsDe('Taller Gama').length).toBe(2));
    expect(screen.getByRole('button', { name: /Todas 6/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('el desplegable de cliente filtra chips en todas las tarjetas', async () => {
    const user = userEvent.setup();
    renderVista();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Filtrar por cliente' })).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por cliente' }), 'Barbería López');
    // Elegir a López lo deja solo en las dos tarjetas y esconde a los demás — sin
    // plegarlos: lo del filtro de cliente se OCULTA, no va al «+N más».
    expect(chipsDe('Barbería López').length).toBe(2);
    expect(sinChips('Clínica Alfa')).toBe(true);
    expect(screen.queryByText(/más$/)).toBeNull();
    expect(screen.getByText('Aviso de lead').closest('.plk')?.className).not.toContain('atenuada');
    // El desplegable enseña TODOS los clientes como opciones.
    expect(screen.getAllByRole('option').length).toBe(1 + 3); // «Todos» + 3 clientes
  });

  it('«Crear» solo en celdas sin crear del registro; la legacy remite a su paso', async () => {
    renderVista();
    await waitFor(() => expect(chipsDe('Taller Gama').length).toBe(2));
    // Gama sin recordatorio (registro) → botón Crear dentro del chip discontinuo.
    const botones = screen.getAllByRole('button', { name: 'Crear' });
    expect(botones.length).toBe(1);
    expect(botones[0]?.closest('.plchip')?.className).toContain('sin');
    // Las celdas sin crear de aviso_lead (columnas) NO llevan botón: remiten al paso 2.
    expect(screen.getAllByText('paso 2 del aprovisionamiento').length).toBe(2);
  });

  it('«Crear» abre el diálogo configurable (antelación + botones + preview), no un confirmar a ciegas', async () => {
    const user = userEvent.setup();
    renderVista();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Crear' }).length).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Crear' }));
    // Los tres bloques del diálogo, con lo curado que viene del catálogo del endpoint.
    expect(await screen.findByRole('button', { name: 'Enviar a aprobación' })).toBeInTheDocument();
    expect(screen.getByLabelText('Antelación del recordatorio')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').length).toBe(2);
    expect(screen.getByText(/Hola María, te escribimos de Clínica Ejemplo/)).toBeInTheDocument();
  });
});

describe('vista Plantillas del CLIENTE (solo lectura)', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Lo que el worker devuelve al rol cliente: SOLO su fila, sin sids, con sus opciones.
  const RESP_CLIENTE: PlantillasResponse = {
    kinds: RESP.kinds,
    tenants: [
      {
        id: meCliente.tenantId!,
        slug: 'barberia-lopez',
        name: 'Barbería López',
        active: 1,
        plantillas: {
          recordatorio_cita: {
            status: 'approved',
            updated_at: '2026-09-01T10:00:00Z',
            opciones: { botones: 'si_voy_no_puedo', textos: { confirmar: 'Sí, voy', cancelar: 'No puedo ir' } },
          },
          // aviso_lead sin crear: ni celda.
        },
      },
    ],
  };

  function renderCliente(resp: PlantillasResponse = RESP_CLIENTE) {
    vi.stubGlobal('fetch', mockFetch({ '/api/admin/me': meCliente, '/api/admin/plantillas': resp }));
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <Plantillas />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  it('una tarjeta por kind con el estado en SU idioma y la preview con SUS botones', async () => {
    renderCliente();
    await waitFor(() => expect(screen.getByText('Recordatorio de cita (Confirmaciones)')).toBeInTheDocument());
    // Estado en palabras del cliente, no jerga de Meta.
    expect(screen.getByText('Activa ✓')).toBeInTheDocument();
    expect(screen.getByText('Aún no creada')).toBeInTheDocument();
    // La pieza central: la preview estilo WhatsApp con LOS BOTONES QUE ÉL eligió.
    expect(screen.getByText(/Hola María, te escribimos de Clínica Ejemplo/)).toBeInTheDocument();
    const botones = [...document.querySelectorAll('.wapre-btns span')].map((e) => e.textContent);
    expect(botones).toEqual(['Sí, voy', 'No puedo ir']);
    // aviso_lead también se previsualiza (sin botones: es texto), con su nota de sin crear.
    expect(screen.getByText(/Nuevo lead – Clínica Ejemplo/)).toBeInTheDocument();
    expect(screen.getByText(/Así se verá cuando se cree/)).toBeInTheDocument();
    expect(screen.getByText(/Escríbenos y lo dejamos listo/)).toBeInTheDocument();
  });

  it('cero gestión: sin crear, sin enviar, sin interruptores ni filtros de la matriz', async () => {
    renderCliente();
    await waitFor(() => expect(screen.getByText('Activa ✓')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Crear/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Enviar a aprobación/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Activar|Desactivar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Todas/ })).toBeNull();
    expect(screen.queryByLabelText('Filtrar por cliente')).toBeNull();
    // El subtítulo habla en su idioma.
    expect(screen.getByText('Los mensajes automáticos que enviamos por WhatsApp en tu nombre')).toBeInTheDocument();
  });

  it('sin opciones guardadas, la preview usa la pareja por defecto del catálogo', async () => {
    renderCliente({
      kinds: RESP.kinds,
      tenants: [{
        id: meCliente.tenantId!, slug: 'barberia-lopez', name: 'Barbería López', active: 1,
        plantillas: { recordatorio_cita: { status: 'pending', updated_at: null, opciones: null } },
      }],
    });
    await waitFor(() => expect(screen.getByText('En revisión por WhatsApp')).toBeInTheDocument());
    const botones = [...document.querySelectorAll('.wapre-btns span')].map((e) => e.textContent);
    expect(botones).toEqual(['Confirmo', 'Cancelar']);
  });
});

describe('categoría real de Twilio y solicitudes en la vista de Velai', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('categoriaReal: la de Twilio manda, «—» si no se leyó, warn si difiere del catálogo, null sin plantilla', () => {
    const kind = { categoria: 'UTILITY' };
    expect(categoriaReal(undefined, kind)).toBeNull();
    expect(categoriaReal({ status: null }, kind)).toBeNull();
    expect(categoriaReal({ status: 'approved', categoria: null }, kind)).toEqual({ label: '—', distinta: false });
    expect(categoriaReal({ status: 'approved', categoria: 'UTILITY' }, kind)).toEqual({ label: 'Utility', distinta: false });
    expect(categoriaReal({ status: 'approved', categoria: 'MARKETING' }, kind)).toEqual({ label: 'Marketing', distinta: true });
    // Sin intención en el catálogo no hay con qué divergir.
    expect(categoriaReal({ status: 'approved', categoria: 'MARKETING' }, {})).toEqual({ label: 'Marketing', distinta: false });
  });

  it('resumenSolicitud: el de→a con lo actual delante y los textos del catálogo', () => {
    const kind = RESP.kinds[0]!;
    const actual = { hours: 24, opciones: { botones: 'confirmo_cancelar', textos: { confirmar: 'Confirmo', cancelar: 'Cancelar' } } };
    expect(resumenSolicitud({ antelacion: 12 }, actual, kind)).toEqual(['Antelación: 24 h → 12 h']);
    expect(resumenSolicitud({ botones: 'si_voy_no_puedo' }, actual, kind)).toEqual(['Botones: «Confirmo / Cancelar» → «Sí, voy / No puedo ir»']);
    // Sin opciones guardadas, el «de» es la pareja default del catálogo.
    expect(resumenSolicitud({ botones: 'si_voy_no_puedo' }, { hours: 24, opciones: null }, kind)[0]).toContain('«Confirmo / Cancelar»');
  });

  function renderVelai(solicitudes: unknown[]) {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/admin/me': meVelai,
        '/api/admin/plantillas': RESP,
        '/api/admin/solicitudes': { solicitudes },
      }),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <Plantillas />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
  }

  it('el chip enseña la categoría REAL («—» sin leer, ámbar si difiere) y nunca la del catálogo', async () => {
    renderVelai([]);
    await waitFor(() => expect(screen.getAllByText('Clínica Alfa').length).toBeGreaterThan(0));
    // Alfa/recordatorio: categoria real UTILITY (fixture) → texto sin warn.
    // Alfa/aviso_lead: categoria real MARKETING difiere de UTILITY → warn (ámbar).
    const cats = [...document.querySelectorAll('.plcat')].map((e) => ({ t: e.textContent, warn: e.className.includes('warn') }));
    expect(cats).toContainEqual({ t: 'Utility', warn: false });
    expect(cats).toContainEqual({ t: 'Marketing', warn: true });
    // López/recordatorio existe pero sin categoría leída → «—», jamás la del catálogo.
    expect(cats).toContainEqual({ t: '—', warn: false });
  });

  it('sin pendientes el bloque de solicitudes NO ocupa sitio; con ellas, de→a y resolver', async () => {
    const user = userEvent.setup();
    const posts: string[] = [];
    const base = mockFetch({
      '/api/admin/me': meVelai,
      '/api/admin/plantillas': RESP,
      '/api/admin/solicitudes': {
        solicitudes: [{
          id: 7, tenant_id: 'x', tenant_name: 'Clínica Alfa', tipo: 'plantilla_recordatorio',
          payload: { botones: 'si_voy_no_puedo', antelacion: 12 }, requested_by: 'gestora@alfa.com',
          created_at: '2026-09-01T10:00:00Z',
          actual: { hours: 24, opciones: { botones: 'confirmo_cancelar', textos: { confirmar: 'Confirmo', cancelar: 'Cancelar' } } },
        }],
      },
    });
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'POST') {
        posts.push(url);
        return new Response(JSON.stringify({ ok: true, status: 'approved' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return base(url, init);
    }) as typeof fetch);
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <Plantillas />
          </MemoryRouter>
          <ConfirmarHost />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Solicitudes de clientes/)).toBeInTheDocument());
    expect(screen.getByText('Antelación: 24 h → 12 h')).toBeInTheDocument();
    expect(screen.getByText('Botones: «Confirmo / Cancelar» → «Sí, voy / No puedo ir»')).toBeInTheDocument();
    expect(screen.getByText(/gestora@alfa\.com/)).toBeInTheDocument();
    // Aprobar pasa por el diálogo propio (nunca window.confirm) y hace el POST.
    await user.click(screen.getByRole('button', { name: 'Aprobar' }));
    await user.click(await screen.findByRole('button', { name: 'Aprobar y aplicar' }));
    await waitFor(() => expect(posts.some((u) => u.includes('/api/admin/solicitudes/7/aprobar'))).toBe(true));
  });

  it('rechazar pide la nota con el diálogo propio y la manda en el POST', async () => {
    const user = userEvent.setup();
    const posts: { url: string; body: unknown }[] = [];
    const base = mockFetch({
      '/api/admin/me': meVelai,
      '/api/admin/plantillas': RESP,
      '/api/admin/solicitudes': {
        solicitudes: [{
          id: 9, tenant_id: 'x', tenant_name: 'Taller Beta', tipo: 'plantilla_recordatorio',
          payload: { antelacion: 48 }, requested_by: 'beta@x.com', created_at: '2026-09-01T10:00:00Z',
          actual: { hours: 24, opciones: null },
        }],
      },
    });
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ ok: true, status: 'rejected' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return base(url, init);
    }) as typeof fetch);
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <Plantillas />
          </MemoryRouter>
          <ConfirmarHost />
        </ToastProvider>
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Rechazar' }));
    // El diálogo propio (pedirTexto) pide el motivo — nunca window.prompt.
    const input = await screen.findByPlaceholderText('Motivo breve del rechazo');
    await user.type(input, 'Mejor 24 h por ahora');
    const dlg = document.querySelector('dialog.cfm')!;
    await user.click(within(dlg as HTMLElement).getByRole('button', { name: 'Rechazar' }));
    await waitFor(() => expect(posts.length).toBeGreaterThan(0));
    expect(posts[0]!.url).toContain('/api/admin/solicitudes/9/rechazar');
    expect(posts[0]!.body).toEqual({ nota: 'Mejor 24 h por ahora' });
  });
});
