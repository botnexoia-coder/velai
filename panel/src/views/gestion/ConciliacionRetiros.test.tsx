import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../api/queryClient';
import { finDinero } from '../../lib/format';
import { Finanzas } from '../Finanzas';
import { ToastProvider } from '../../components/Toasts';
import type { DetalleRetiro, FuenteRetiro, ListaRetiros, TotalesRetiro, UsoRetiro } from './retiros';

// Todo ficticio, en céntimos. Lote A: 1.000 € de cajero y cuatro traspasos por identificar (3.900 €).
const L = 'lote-a';
const eur = (n: number) => finDinero(n, 'EUR');
const totalesBase: TotalesRetiro = { total_salidas: 490000, efectivo_confirmado: 100000, efectivo_declarado: 0, traspasos_por_identificar: 390000, usos_registrados: 320000, usos_declarados: 120000, usos_total: 440000,
  aportes_personales: 0, aportes_reembolsables: 0, aportes_no_reembolsables: 0, aportes_sin_indicar: 0, comisiones_conocidas: 0, comisiones_por_confirmar: 0, comisiones_desconocidas: 0, comisiones_por_confirmar_importe: 0,
  diferencia_por_explicar: 50000, origen_no_trazado: 340000 };
const fuente = (o: Partial<FuenteRetiro>): FuenteRetiro => ({ id: 'f1', lote_id: L, origen_tipo: 'traspaso', origen_id: '11111111-aaaa-4aaa-8aaa-111111111111', importe: 100000, moneda: 'EUR', clasificacion: 'traspaso_por_identificar',
  evidencia: 'extracto', declarado_por: null, nota: null, comision: null, coste_bancario_total: null, coste_estado: 'por_confirmar', estado: 'activa', version: 1,
  origen: { estado: 'activo', fecha: '2026-11-12', nota: 'TRASPASO, beneficiario no consta', cuenta_origen: 'Banco ejemplo', cuenta_destino: 'Destino por identificar · fondos no disponibles' }, ...o });
const uso = (o: Partial<UsoRetiro>): UsoRetiro => ({ id: 'u1', lote_id: L, tipo: 'declaracion', pago_id: null, compra_id: null, concepto: 'Entrega declarada', importe_efectivo: 120000, aporte_personal: null, aporte_reembolso: null,
  fecha: null, evidencia: 'declaracion', declarado_por: 'Persona declarante', nota: null, estado: 'activo', version: 1, pago: null, compra: null, pago_vigente: false, sin_documento: true, ...o });
const detalleA = (extra: Partial<DetalleRetiro> = {}): DetalleRetiro => ({
  item: { id: L, nombre: 'Lote A ficticio', moneda: 'EUR', nota: null, version: 1, created_by: 'uno@velai.test', created_at: '2026-11-13T10:00:00.000Z', updated_by: 'uno@velai.test', updated_at: '2026-11-13T10:00:00.000Z' },
  fuentes: [fuente({ id: 'atm', clasificacion: 'cajero_verificado', origen: { estado: 'activo', fecha: '2026-11-12', nota: 'RETIRO CAJERO' } }),
    ...[1, 2, 3, 4].map((n) => fuente({ id: `t${n}`, origen_id: `2222222${n}-aaaa-4aaa-8aaa-111111111111` }))],
  usos: [uso({ id: 'p1', tipo: 'pago_existente', concepto: 'Compra en efectivo ejemplo', importe_efectivo: 320000, fecha: '2026-11-12', evidencia: 'ninguna', declarado_por: null, pago_vigente: true }), uso({})],
  totales: totalesBase,
  motivos: [{ codigo: 'traspasos_por_identificar', cantidad: 4, importe: 390000 }, { codigo: 'diferencia_por_explicar', cantidad: 1, importe: 50000 }, { codigo: 'origen_no_trazado', cantidad: 1, importe: 340000 },
    { codigo: 'fechas_desconocidas', cantidad: 1, importe: null }, { codigo: 'usos_declarados', cantidad: 1, importe: 120000 }],
  estado: 'abierta', historial: [], ...extra });
const listaDe = (d: DetalleRetiro): ListaRetiros => ({ mas: false, items: [{ ...d.item, estado: d.estado, motivos: d.motivos, totales: d.totales, fuentes_count: d.fuentes.length, usos_count: d.usos.length }],
  totales: { EUR: { ...d.totales, lotes: 1, lotes_abiertos: 1 } } });

function mount(detalle: DetalleRetiro = detalleA(), path = '/finanzas?tab=retiros') {
  const calls: { url: URL; method: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'http://panel.test'); const method = init?.method || 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    const datos: Record<string, unknown> = {
      '/api/admin/me': { role: 'velai', socio: true, email: 'uno@velai.test', tenantId: null },
      '/api/admin/gestion/retiros': listaDe(detalle),
      [`/api/admin/gestion/retiros/${L}`]: detalle,
      '/api/admin/gestion/retiros/candidatos': { traspasos: [], movimientos: [], pagos: [] },
    };
    return Response.json(method === 'GET' ? (datos[url.pathname] || {}) : { item: {} });
  }));
  render(<QueryClientProvider client={createQueryClient()}><ToastProvider><MemoryRouter initialEntries={[path]}><Finanzas /></MemoryRouter></ToastProvider></QueryClientProvider>);
  return { calls, user: userEvent.setup() };
}
const valor = (label: string) => screen.getByText(label).closest('div')!.querySelector('dd')!.textContent;
afterEach(() => vi.unstubAllGlobals());

it('añade la pestaña «Conciliación de retiros» y lista el lote con su estado calculado', async () => {
  mount();
  expect(await screen.findByRole('heading', { name: 'Conciliación de retiros' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Conciliación de retiros' })).toHaveAttribute('aria-pressed', 'true');
  expect(await screen.findByRole('button', { name: 'Lote A ficticio' })).toBeInTheDocument();
  expect(screen.getByText(/Abierta · 5 pendientes/)).toBeInTheDocument();
  expect(screen.getByText(/en total quedan/)).toHaveTextContent(eur(50000));
});

it('muestra cada total por separado y la diferencia como pendiente de explicar, nunca como saldo de efectivo', async () => {
  const { user } = mount();
  await user.click(await screen.findByRole('button', { name: 'Lote A ficticio' }));
  await screen.findByText('Total salidas bancarias');
  expect(valor('Total salidas bancarias')).toBe(eur(490000));
  expect(valor('Efectivo confirmado')).toBe(eur(100000));
  expect(valor('Efectivo declarado sin confirmar')).toBe(eur(0));
  expect(valor('Traspasos por identificar')).toBe(eur(390000));
  expect(valor('Usos registrados')).toBe(eur(320000));
  expect(valor('Usos declarados')).toBe(eur(120000));
  expect(valor('Aportes personales')).toBe(eur(0));
  expect(valor('Comisiones conocidas')).toBe(eur(0));
  expect(valor('Comisiones por confirmar')).toBe(eur(0));
  expect(valor('Diferencia pendiente de explicar')).toBe(eur(50000));
  // El origen no trazado (4.400 usados frente a 1.000 confirmados) no se esconde.
  expect(valor('Efectivo usado sin origen confirmado')).toBe(eur(340000));
  expect(screen.queryByText(/saldo (de|del) efectivo/i)).not.toBeInTheDocument();
  expect(screen.getByText(/no es efectivo sobrante ni disponible/)).toBeInTheDocument();
  expect(screen.getByText(/4 traspasos por identificar/)).toBeInTheDocument();
  expect(screen.getByText(/Los traspasos por identificar no se cuentan como efectivo/)).toBeInTheDocument();
  // Los cuatro traspasos quedan «Por identificar» y se muestra literal lo que consta del libro.
  expect(screen.getAllByText('Por identificar')).toHaveLength(4);
  expect(screen.getAllByText('TRASPASO, beneficiario no consta')).toHaveLength(4);
  expect(screen.getByText('Abierta')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /cerrar lote|marcar como conciliado/i })).not.toBeInTheDocument();
});

it('crea un lote con id propio y sin tocar otros endpoints', async () => {
  const { user, calls } = mount();
  await user.click(await screen.findByRole('button', { name: 'Nuevo lote' }));
  const d = within(screen.getByRole('dialog', { name: 'Nuevo lote de retiros' }));
  await user.type(d.getByLabelText(/Nombre del lote/), 'Lote ficticio nuevo');
  await user.click(d.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ nombre: 'Lote ficticio nuevo', moneda: 'EUR', nota: null }));
  const escrituras = calls.filter((c) => c.method !== 'GET');
  expect(escrituras).toHaveLength(1);
  expect(escrituras[0]!.url.pathname).toBe('/api/admin/gestion/retiros');
  expect(typeof escrituras[0]!.body?.id).toBe('string');
});

it('declara un uso sin fecha ni compra: se envía como declaración y no crea pagos ni movimientos', async () => {
  const { user, calls } = mount();
  await user.click(await screen.findByRole('button', { name: 'Lote A ficticio' }));
  await user.click(await screen.findByRole('button', { name: 'Declarar un uso' }));
  const d = within(screen.getByRole('dialog', { name: 'Declarar un uso del efectivo' }));
  await user.type(d.getByLabelText(/En qué se usó/), 'Servicio declarado');
  await user.type(d.getByLabelText(/Efectivo común usado/), '1200');
  await user.type(d.getByLabelText(/Quién lo declara/), 'Persona declarante');
  await user.click(d.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
  const post = calls.find((c) => c.method === 'POST')!;
  expect(post.url.pathname).toBe(`/api/admin/gestion/retiros/${L}/usos`);
  expect(post.body).toMatchObject({ tipo: 'declaracion', concepto: 'Servicio declarado', importe_efectivo: 120000, fecha: null, compra_id: null, aporte_personal: null, aporte_reembolso: null, declarado_por: 'Persona declarante' });
  expect(post.body).not.toHaveProperty('pago_id');
  expect(calls.filter((c) => c.method !== 'GET').every((c) => c.url.pathname.startsWith('/api/admin/gestion/retiros/'))).toBe(true);
});

it('conserva a la vista la salida anulada en el libro y explica por qué no suma', async () => {
  const base = detalleA();
  const anulada = { ...base, fuentes: base.fuentes.map((f) => f.id === 't1' ? { ...f, origen: { ...f.origen, estado: 'anulado' as const, reverso_id: 'rev-1' } } : f),
    totales: { ...base.totales, total_salidas: 390000, traspasos_por_identificar: 290000 }, motivos: [...base.motivos, { codigo: 'fuentes_anuladas', cantidad: 1, importe: 100000 }] };
  const { user } = mount(anulada);
  await user.click(await screen.findByRole('button', { name: 'Lote A ficticio' }));
  expect(await screen.findByText('Anulado en el libro')).toBeInTheDocument();
  expect(screen.getByText(/1 salida anulada en el libro .*siguen enlazadas, pero no suman/)).toBeInTheDocument();
  expect(valor('Total salidas bancarias')).toBe(eur(390000));
  expect(screen.getAllByRole('row').filter((r) => within(r).queryByText('Anulado en el libro'))).toHaveLength(1);
});

it('muestra el aporte personal no reembolsable como información y la fecha pendiente', async () => {
  const taller = detalleA({ fuentes: [fuente({ id: 'atm', importe: 8000, clasificacion: 'cajero_verificado' })], usos: [uso({ concepto: 'Servicio de taller', importe_efectivo: 8000, aporte_personal: 400, aporte_reembolso: 'no_reembolsable' })],
    totales: { ...totalesBase, total_salidas: 8000, efectivo_confirmado: 8000, traspasos_por_identificar: 0, usos_registrados: 0, usos_declarados: 8000, usos_total: 8000, aportes_personales: 400, aportes_no_reembolsables: 400, diferencia_por_explicar: 0, origen_no_trazado: 0 },
    motivos: [{ codigo: 'fechas_desconocidas', cantidad: 1, importe: null }, { codigo: 'usos_declarados', cantidad: 1, importe: 8000 }] });
  const { user } = mount(taller);
  await user.click(await screen.findByRole('button', { name: 'Lote A ficticio' }));
  await screen.findByText('Servicio de taller');
  expect(valor('Aportes personales')).toBe(eur(400));
  expect(screen.getByText('No reembolsable')).toBeInTheDocument();
  expect(screen.getByText('Fecha pendiente')).toBeInTheDocument();
  expect(valor('Diferencia pendiente de explicar')).toBe(eur(0));
  expect(screen.getByText('Abierta')).toBeInTheDocument();
});
