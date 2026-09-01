// Calendario: la lógica pura del mes (corte por tz, forma de la rejilla, «vacío ≠ {}»)
// y la vista con conexión, rejilla y citas.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from '../components/Toasts';
import { apptsByDay, calTzDay, dayKey, estadoConfirmacion, ledgerRecordatorio, monthRange, monthShape } from '../lib/calendario';
import { gridFromHours, hoursFromGrid, gridVacio, copyMonday, setDay, shSummary } from '../lib/horario';
import { meCliente, meVelai, mockFetch, tenants } from '../test/fixtures';
import { Calendario } from './Calendario';
import type { Appointment, CalendarRow } from '../api/types';

describe('lógica pura del calendario', () => {
  it('el corte de día usa la tz del CALENDARIO, no la del navegador', () => {
    // 23:30 UTC del día 1 = día 2 a la 01:30 en Madrid (verano).
    expect(calTzDay('2026-08-01T23:30:00.000Z', 'Europe/Madrid')).toBe('2026-08-02');
    expect(calTzDay('2026-08-01T23:30:00.000Z', 'America/Bogota')).toBe('2026-08-01');
  });

  it('la rejilla empieza en lunes y cierra en domingo', () => {
    // Agosto de 2026 empieza en sábado (lead 5) y tiene 31 días; 5+31=36 → tail 6.
    expect(monthShape(2026, 7)).toEqual({ lead: 5, days: 31, tail: 6 });
    expect(dayKey(2026, 7, 3)).toBe('2026-08-03');
  });

  it('el rango del mes lleva ±1 día de margen (el corte fino lo hace la tz)', () => {
    const r = monthRange(2026, 7);
    expect(r.from < '2026-08-01').toBe(true);
    expect(r.to > '2026-09-01').toBe(true);
  });

  it('agrupa y ordena las citas por día', () => {
    const appt = (id: string, iso: string): Appointment => ({
      id,
      channel: 'web',
      customer_name: 'X',
      customer_phone: '+34',
      reason: null,
      starts_at: iso,
      ends_at: iso,
      timezone: null,
      status: 'ok',
      created_at: iso,
    });
    const by = apptsByDay([appt('b', '2026-08-05T12:00:00Z'), appt('a', '2026-08-05T08:00:00Z')], 'Europe/Madrid');
    expect(by.get('2026-08-05')?.map((a) => a.id)).toEqual(['a', 'b']);
  });
});

describe('lógica pura del horario', () => {
  it('ida y vuelta de la rejilla: solo tramos completos y con a<b', () => {
    const grid = gridFromHours({ mon: [['09:00', '14:00'], ['16:00', '19:00']], sat: [['10:00', '13:00']] });
    expect(grid.mon).toEqual({ a1: '09:00', b1: '14:00', a2: '16:00', b2: '19:00' });
    const g2 = { ...grid, tue: { a1: '18:00', b1: '09:00', a2: '', b2: '' } }; // invertido: fuera
    expect(hoursFromGrid(g2)).toEqual({ mon: [['09:00', '14:00'], ['16:00', '19:00']], sat: [['10:00', '13:00']] });
  });

  it('apagar un día borra sus horas; encenderlo pone un tramo válido por defecto', () => {
    let g = gridVacio();
    g = setDay(g, 'mon', true);
    expect(g.mon).toEqual({ a1: '09:00', b1: '19:00', a2: '', b2: '' });
    g = setDay(g, 'mon', false);
    expect(hoursFromGrid(g)).toEqual({});
  });

  it('copiar el lunes a L-V y el resumen que no confunde vacío con sin configurar', () => {
    let g = setDay(gridVacio(), 'mon', true);
    g = copyMonday(g);
    expect(g.fri).toEqual(g.mon);
    expect(shSummary(hoursFromGrid(g))).toMatch(/5 días con atención humana/);
    expect(shSummary({})).toMatch(/NUNCA se ofrece asesor/);
  });
});

describe('vista Calendario', () => {
  afterEach(() => vi.unstubAllGlobals());

  const calRow: CalendarRow = {
    provider: 'google',
    account_email: 'negocio@gmail.com',
    calendar_id: 'primary',
    timezone: 'Europe/Madrid',
    slot_minutes: 30,
    business_hours: null,
    status: 'connected',
    last_error: null,
    connected_at: '2026-08-01T00:00:00.000Z',
    updated_at: null,
  };

  it('sin conexión: la tarjeta de conectar con la pantalla de permiso de Google', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/admin/me': meCliente,
        [`/api/admin/tenants/${meCliente.tenantId}/calendar`]: { calendar: null },
      }),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <Calendario />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Conectar Google Calendar')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Conectar Google' })).toBeInTheDocument();
  });

  it('conectado: quién, la rejilla del mes y la configuración de citas', async () => {
    const hoy = new Date();
    const cita: Appointment = {
      id: 'a1',
      channel: 'whatsapp',
      customer_name: 'Marta',
      customer_phone: '+34600111222',
      reason: 'corte',
      starts_at: new Date(hoy.getFullYear(), hoy.getMonth(), 15, 10, 0).toISOString(),
      ends_at: new Date(hoy.getFullYear(), hoy.getMonth(), 15, 10, 30).toISOString(),
      timezone: 'Europe/Madrid',
      status: 'confirmed',
      created_at: hoy.toISOString(),
    };
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/admin/me': meCliente,
        [`/api/admin/tenants/${meCliente.tenantId}/calendar`]: { calendar: calRow },
        '/api/admin/appointments': { appointments: [cita] },
      }),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <Calendario />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/negocio@gmail\.com/)).toBeInTheDocument());
    // La cita sale como chip en su día y el horario laboral por defecto se dice.
    await waitFor(() => expect(screen.getByText(/Marta/)).toBeInTheDocument());
    expect(screen.getByText(/Usando el horario por defecto/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar calendario' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeInTheDocument();
    // El toggle de días no aparece aquí (variant plain): el interruptor es de Conexiones.
    expect(screen.queryByRole('switch', { name: 'Lunes' })).toBeNull();
  });
});

describe('Confirmaciones (SPEC-CONFIRMACIONES)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const calRow: CalendarRow = {
    provider: 'google',
    account_email: 'negocio@gmail.com',
    calendar_id: 'primary',
    timezone: 'Europe/Madrid',
    slot_minutes: 30,
    business_hours: null,
    status: 'connected',
    last_error: null,
    connected_at: '2026-08-01T00:00:00.000Z',
    updated_at: null,
  };
  const hoy = new Date();
  const cita = (over: Partial<Appointment>): Appointment => ({
    id: 'a1',
    channel: 'whatsapp',
    customer_name: 'Marta',
    customer_phone: '+34600111222',
    reason: null,
    starts_at: new Date(hoy.getFullYear(), hoy.getMonth(), 15, 10, 0).toISOString(),
    ends_at: new Date(hoy.getFullYear(), hoy.getMonth(), 15, 10, 30).toISOString(),
    timezone: 'Europe/Madrid',
    status: 'confirmed',
    created_at: hoy.toISOString(),
    ...over,
  });

  it('el chip prioriza cancelada > confirmada > recordada, y el ledger habla claro', () => {
    expect(estadoConfirmacion(cita({}))).toBeNull();
    expect(estadoConfirmacion(cita({ reminder_status: 'sent' }))?.emoji).toBe('⏳');
    expect(estadoConfirmacion(cita({ reminder_status: 'sent', customer_confirmed_at: '2026-09-01T00:00:00Z' }))?.emoji).toBe('✅');
    expect(estadoConfirmacion(cita({ status: 'cancelled', cancelled_by: 'customer', customer_confirmed_at: '2026-09-01T00:00:00Z' }))?.emoji).toBe('❌');
    // Cancelada por el negocio NO es el chip del cliente.
    expect(estadoConfirmacion(cita({ status: 'cancelled', cancelled_by: 'business' }))).toBeNull();
    expect(ledgerRecordatorio(cita({}), 'Europe/Madrid')).toBeNull();
    expect(ledgerRecordatorio(cita({ reminder_status: 'sent', reminder_sent_at: '2026-09-14T08:00:00Z' }), 'Europe/Madrid')).toMatch(/enviado el 2026-09-14 a las 10:00/);
    expect(ledgerRecordatorio(cita({ reminder_status: 'failed', reminder_attempts: 3, reminder_error: 'twilio_500' }), 'Europe/Madrid')).toMatch(/fallido \(3 intentos: twilio_500\)/);
    expect(ledgerRecordatorio(cita({ reminder_status: 'skipped', reminder_error: 'creada_dentro_de_ventana' }), 'Europe/Madrid')).toMatch(/menos de 24 h/);
  });

  it('cliente: ve el estado del addon en texto (sin interruptor) y el chip en la cita', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/admin/me': meCliente,
        [`/api/admin/tenants/${meCliente.tenantId}/calendar`]: {
          calendar: calRow,
          confirmaciones: { enabled: true, hours: 24, template: { sid: 'HX1', status: 'approved' } },
        },
        '/api/admin/appointments': { appointments: [cita({ customer_confirmed_at: '2026-09-01T00:00:00Z' })] },
      }),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <Calendario />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Confirmaciones')).toBeInTheDocument());
    expect(screen.getByText('Activado')).toBeInTheDocument();
    expect(screen.getByText(/lo activa el equipo de Velai/)).toBeInTheDocument();
    expect(screen.getByText(/aprobada por Meta/)).toBeInTheDocument();
    // Sin botones: el interruptor y la plantilla son solo de Velai.
    expect(screen.queryByRole('button', { name: /Activar Confirmaciones|Desactivar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Crear plantilla de recordatorios' })).toBeNull();
    // El chip de la cita confirmada por el cliente.
    await waitFor(() => expect(screen.getByText(/✅/)).toBeInTheDocument());
  });

  it('velai: interruptor del addon y botón de crear la plantilla cuando no existe', async () => {
    const tid = tenants.tenants[0]!.id;
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/admin/me': meVelai,
        '/api/admin/tenants': tenants,
        [`/api/admin/tenants/${tid}/calendar`]: {
          calendar: calRow,
          confirmaciones: { enabled: false, hours: 24, template: { sid: null, status: null } },
        },
        '/api/admin/appointments': { appointments: [] },
      }),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <MemoryRouter>
            <Calendario />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Confirmaciones')).toBeInTheDocument());
    expect(screen.getByText('Desactivado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activar Confirmaciones' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear plantilla de recordatorios' })).toBeInTheDocument();
    expect(screen.getByText(/sin ella no puede salir ningún recordatorio/)).toBeInTheDocument();
  });
});
