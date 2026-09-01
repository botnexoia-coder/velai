// Plantillas: la lógica pura (chip por estado y recuentos) y la matriz — chips por
// celda, «Crear» SOLO donde falta y es del registro, y la legacy de columnas remitida
// a su paso de aprovisionamiento.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from '../components/Toasts';
import { chipPlantilla, cuentaPlantillas } from '../lib/plantillas';
import { meVelai, mockFetch } from '../test/fixtures';
import { Plantillas } from './Plantillas';
import type { PlantillasResponse } from '../api/types';

const RESP: PlantillasResponse = {
  kinds: [
    { kind: 'recordatorio_cita', label: 'Recordatorio de cita (Confirmaciones)', fuente: 'registro' },
    { kind: 'aviso_lead', label: 'Aviso de lead', fuente: 'columnas' },
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
      slug: 'beta',
      name: 'Taller Beta',
      active: 0,
      plantillas: { recordatorio_cita: { sid: 'HX3', status: 'rejected', updated_at: null } },
    },
  ],
};

describe('lógica pura de Plantillas', () => {
  it('el chip por estado: sin crear / pendiente / aprobada / rechazada, y el crudo si Twilio inventa', () => {
    expect(chipPlantilla(undefined)).toEqual({ emoji: '—', label: 'sin crear', cls: 'off' });
    expect(chipPlantilla({ sid: 'x', status: 'pending', updated_at: null }).emoji).toBe('⏳');
    expect(chipPlantilla({ sid: 'x', status: 'received', updated_at: null }).label).toBe('pendiente');
    expect(chipPlantilla({ sid: 'x', status: 'approved', updated_at: null })).toEqual({ emoji: '✅', label: 'aprobada', cls: 'ok' });
    expect(chipPlantilla({ sid: 'x', status: 'rejected', updated_at: null }).cls).toBe('bad');
    expect(chipPlantilla({ sid: 'x', status: 'paused', updated_at: null }).label).toBe('paused');
  });

  it('los recuentos cuentan TODAS las celdas de la matriz', () => {
    // 2 clientes × 2 kinds = 4 celdas: pending + approved + rejected + 1 sin crear.
    expect(cuentaPlantillas(RESP)).toEqual({ aprobadas: 1, pendientes: 1, rechazadas: 1, sinCrear: 1 });
  });
});

describe('vista Plantillas', () => {
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

  it('la matriz: una columna por kind, una fila por cliente y el chip de cada celda', async () => {
    renderVista();
    await waitFor(() => expect(screen.getByText('Clínica Alfa')).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: 'Recordatorio de cita (Confirmaciones)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Aviso de lead' })).toBeInTheDocument();
    expect(screen.getByText('Taller Beta')).toBeInTheDocument();
    expect(screen.getByText(/· inactivo/)).toBeInTheDocument();
    expect(screen.getByText(/⏳ pendiente/)).toBeInTheDocument();
    expect(screen.getByText(/✅ aprobada/)).toBeInTheDocument();
    expect(screen.getByText(/❌ rechazada/)).toBeInTheDocument();
    // Recuentos en cabecera + la nota del cron.
    expect(screen.getByText(/1 aprobadas · 1 pendientes · 1 rechazadas · 1 sin crear/)).toBeInTheDocument();
    expect(screen.getByText(/cada 5 minutos y avisa por Telegram/)).toBeInTheDocument();
  });

  it('«Crear» solo en la celda del registro que falta; la legacy remite a su paso', async () => {
    renderVista();
    await waitFor(() => expect(screen.getByText('Taller Beta')).toBeInTheDocument());
    // Beta no tiene aviso_lead (columnas): NO hay botón — texto que remite al paso 2.
    expect(screen.getByText(/paso 2 del aprovisionamiento/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear' })).toBeNull();
    // …y si a un cliente le falta la del REGISTRO, la celda sí trae el botón.
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    renderVista({
      ...RESP,
      tenants: [{ id: '3', slug: 'gama', name: 'Gama', active: 1, plantillas: {} }],
    });
    await waitFor(() => expect(screen.getByText('Gama')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Crear' })).toBeInTheDocument();
    expect(screen.getAllByText(/— sin crear/).length).toBeGreaterThan(0);
  });
});
