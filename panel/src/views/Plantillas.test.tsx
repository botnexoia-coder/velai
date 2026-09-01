// Plantillas (rediseño «por plantilla»): la lógica pura del filtrado y la vista —
// una tarjeta por kind, chips-píldora por estado, buscador sin acentos que atenúa,
// contador-filtro con «+N más», «Crear» solo donde toca y la legacy sin botón.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from '../components/Toasts';
import { chipsDeKind, cuentaPlantillas, estadoDeCelda, filtraChips, resumenKind, sinAcentos } from '../lib/plantillas';
import { meVelai, mockFetch } from '../test/fixtures';
import { Plantillas } from './Plantillas';
import type { PlantillasResponse } from '../api/types';

const RESP: PlantillasResponse = {
  kinds: [
    {
      kind: 'recordatorio_cita',
      label: 'Recordatorio de cita (Confirmaciones)',
      fuente: 'registro',
      categoria: 'UTILITY',
      descripcion: 'Recuerda la cita al cliente final 24 h antes.',
    },
    { kind: 'aviso_lead', label: 'Aviso de lead', fuente: 'columnas', categoria: 'UTILITY', descripcion: 'Avisa al equipo del negocio.' },
  ],
  tenants: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'alfa',
      name: 'Clínica Alfa',
      active: 1,
      plantillas: {
        recordatorio_cita: { sid: 'HX1', status: 'pending', updated_at: '2026-09-01T10:00:00Z' },
        aviso_lead: { sid: 'HX2', status: 'approved', updated_at: null },
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

  it('el buscador iguala sin acentos y OCULTA los chips que no casan (sin plegarlos)', () => {
    expect(sinAcentos('López')).toBe('lopez');
    const r = filtraChips(chips, 'lopez', '');
    expect(r.visibles.map((c) => c.name)).toEqual(['Barbería López']);
    expect(r.ocultos).toBe(0); // lo que quita el buscador NO va al «+N más»
    expect(r.atenuada).toBe(false);
    // Sin coincidencias en la tarjeta: se atenúa, nunca desaparece.
    expect(filtraChips(chips, 'zzz', '').atenuada).toBe(true);
  });

  it('el filtro de estado PLIEGA el resto en ocultos, y compone con el buscador', () => {
    const r = filtraChips(chips, '', 'rejected');
    expect(r.visibles.map((c) => c.name)).toEqual(['Barbería López']);
    expect(r.ocultos).toBe(2); // pending de Alfa + sin de Gama
    expect(r.atenuada).toBe(false); // el estado no atenúa: eso es solo del buscador
    // Compuestos: cliente Y estado a la vez.
    const both = filtraChips(chips, 'alfa', 'pending');
    expect(both.visibles.map((c) => c.name)).toEqual(['Clínica Alfa']);
    expect(both.ocultos).toBe(0);
    expect(filtraChips(chips, 'alfa', 'rejected')).toEqual({ visibles: [], ocultos: 1, atenuada: false });
  });

  it('resumen por tarjeta con plurales, y recuentos globales con «todas»', () => {
    expect(resumenKind(chips)).toBe('1 pendiente · 1 rechazada · 1 sin crear');
    expect(resumenKind(chipsDeKind(RESP, 'aviso_lead'))).toBe('1 aprobada · 2 sin crear');
    // 3 clientes × 2 kinds = 6 celdas.
    expect(cuentaPlantillas(RESP)).toEqual({ todas: 6, aprobadas: 1, pendientes: 1, rechazadas: 1, sinCrear: 3 });
  });
});

describe('vista Plantillas (rediseño por plantilla)', () => {
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
    expect(screen.getByText('Recuerda la cita al cliente final 24 h antes.')).toBeInTheDocument();
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
    expect(screen.getByText('Barbería López')).toBeInTheDocument();
    expect(screen.queryByText('Taller Gama')).toBeNull();
    expect(screen.getByRole('button', { name: '+2 más' })).toBeInTheDocument();
    // Los recuentos NO cambian al filtrar.
    expect(screen.getByRole('button', { name: /Todas 6/ })).toBeInTheDocument();
    // El «+N más» restaura «Todas».
    await user.click(screen.getByRole('button', { name: '+2 más' }));
    await waitFor(() => expect(screen.getAllByText('Taller Gama').length).toBe(2));
    expect(screen.getByRole('button', { name: /Todas 6/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('el buscador (sin acentos) filtra chips y atenúa la tarjeta sin coincidencias', async () => {
    const user = userEvent.setup();
    renderVista();
    await waitFor(() => expect(screen.getByPlaceholderText('Buscar cliente…')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Buscar cliente…'), 'lopez');
    // «lopez» (sin acento) encuentra a «Barbería López» en las dos tarjetas y
    // esconde a los demás — sin plegarlos: lo del buscador se OCULTA, no va al «+N más».
    expect(screen.getAllByText('Barbería López').length).toBe(2);
    expect(screen.queryByText('Clínica Alfa')).toBeNull();
    expect(screen.queryByText(/más$/)).toBeNull();
    expect(screen.getByText('Aviso de lead').closest('.plk')?.className).not.toContain('atenuada');
    // Sin coincidencias en NINGUNA tarjeta: se atenúan sin desaparecer — el catálogo
    // entero sigue a la vista.
    await user.clear(screen.getByPlaceholderText('Buscar cliente…'));
    await user.type(screen.getByPlaceholderText('Buscar cliente…'), 'zzz');
    expect(screen.getByText('Aviso de lead').closest('.plk')?.className).toContain('atenuada');
    expect(screen.getByText('Recordatorio de cita (Confirmaciones)').closest('.plk')?.className).toContain('atenuada');
  });

  it('«Crear» solo en celdas sin crear del registro; la legacy remite a su paso', async () => {
    renderVista();
    await waitFor(() => expect(screen.getAllByText('Taller Gama').length).toBe(2));
    // Gama sin recordatorio (registro) → botón Crear dentro del chip discontinuo.
    const botones = screen.getAllByRole('button', { name: 'Crear' });
    expect(botones.length).toBe(1);
    expect(botones[0]?.closest('.plchip')?.className).toContain('sin');
    // Las celdas sin crear de aviso_lead (columnas) NO llevan botón: remiten al paso 2.
    expect(screen.getAllByText('paso 2 del aprovisionamiento').length).toBe(2);
  });
});
