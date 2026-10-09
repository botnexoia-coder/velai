import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../api/queryClient';
import { ConfirmarHost } from '../../components/Confirmar';
import { Pagos, type Pago } from './Pagos';

const payment = (extra: Partial<Pago> = {}): Pago => ({
  id: 'payment-one', objeto_tipo: 'compra', objeto_id: 'purchase-one', clase: 'pago', pago_id: null, numero: null,
  fecha: '2026-01-01', moneda: 'EUR', importe: 10000, capital: 0, interes: 0, comision: 0,
  pagador: 'socio', socio: 'persona@velai.test', cuenta_id: null, estado: 'activo', nota: null, motivo: null,
  registrado_por: 'registrador@velai.test', ...extra,
});
type Options = { socio?: boolean; tipo?: 'compra' | 'prestamo'; pagos?: Pago[]; retry?: boolean; failHistory?: boolean };
function mount({ socio = true, tipo = 'compra', pagos = [payment()], retry = false, failHistory = false }: Options = {}) {
  const calls: { path: string; method: string; body?: Record<string, unknown> }[] = [];
  const rows = pagos.map((p) => ({ ...p }));
  let failed = false;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'https://panel.test'), method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: url.pathname, method, body });
    if (method === 'POST') {
      if (retry && !failed) { failed = true; return Response.json({ error: 'network_failed' }, { status: 503 }); }
      if (url.pathname.endsWith('/reembolsos')) rows.push(payment({ ...body, clase: 'reembolso', pagador: 'cuenta', socio: null }));
      if (url.pathname.endsWith('/revertir')) {
        const original = rows.find((p) => url.pathname.includes(`/pagos/${p.id}/`));
        if (original) { original.estado = 'revertido'; rows.push(payment({ ...original, ...body, clase: 'reverso', pago_id: original.id, estado: 'activo' })); }
      }
      return Response.json({ item: { id: body?.id } });
    }
    if (url.pathname === '/api/admin/me') return Response.json({ role: 'velai', socio, tenantId: null });
    if (url.pathname.endsWith('/catalogos')) return Response.json({ entidades: [], negocios: [],
      socios: [{ email: 'persona@velai.test', nombre: 'Persona Uno' }, { email: 'registrador@velai.test', nombre: 'Persona Dos' }],
      cuentas: [{ id: 'eur-account', nombre: 'Cuenta común EUR', moneda: 'EUR' }, { id: 'cop-account', nombre: 'Cuenta COP', moneda: 'COP' }] });
    if (url.pathname.endsWith('/pagos') || url.pathname.endsWith('/resumen')) {
      if (failHistory) return Response.json({ error: 'not_authorized' }, { status: 403 });
      return Response.json(tipo === 'compra' ? { items: rows } : { pagos: rows });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }));
  const client = createQueryClient();
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/pagos']}><Routes>
    <Route path="/pagos" element={<Pagos tipo={tipo} objetoId={tipo === 'compra' ? 'purchase-one' : 'loan-one'}/>}/>
    <Route path="/" element={<h1>Inicio</h1>}/>
  </Routes><ConfirmarHost/></MemoryRouter></QueryClientProvider>);
  return { calls, rows, user: userEvent.setup() };
}

afterEach(() => vi.unstubAllGlobals());

it('no consulta el historial ni catálogos cuando la cuenta no tiene permiso financiero', async () => {
  const { calls } = mount({ socio: false });
  await screen.findByRole('heading', { name: 'Inicio' });
  expect(calls.some((c) => c.path.includes('/gestion/'))).toBe(false);
});

it('muestra origen y autor diferentes; un pago común no crea anticipo al comprador', async () => {
  mount({ pagos: [payment({ pagador: 'cuenta', cuenta_id: 'eur-account', socio: null })] });
  await screen.findByText('Pago al proveedor');
  expect(await screen.findByText('Cuenta común EUR')).toBeInTheDocument();
  expect(screen.getByText('Persona Dos')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reembolsar anticipo' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Revertir pago' })).toBeEnabled();
});

it('devuelve parcialmente el anticipo pendiente, conserva céntimos y filtra cuentas por moneda', async () => {
  const { calls, user } = mount({ pagos: [payment(), payment({ id: 'refund-old', clase: 'reembolso', pago_id: 'payment-one', importe: 2500, pagador: 'cuenta', socio: null, cuenta_id: 'eur-account' })] });
  await user.click(await screen.findByRole('button', { name: 'Reembolsar anticipo' }));
  const form = within(screen.getByRole('dialog', { name: 'Devolver anticipo al socio' }));
  expect(form.getByLabelText(/^Importe a devolver \(EUR\)/)).toHaveValue('75');
  expect(form.queryByRole('option', { name: 'Cuenta COP' })).not.toBeInTheDocument();
  await user.clear(form.getByLabelText(/^Importe a devolver \(EUR\)/));
  await user.type(form.getByLabelText(/^Importe a devolver \(EUR\)/), '50,29');
  await user.selectOptions(form.getByLabelText('Cuenta del proyecto que devuelve el dinero'), 'eur-account');
  await user.click(form.getByRole('button', { name: 'Registrar devolución' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const writes = calls.filter((c) => c.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(writes[0]?.path).toBe('/api/admin/gestion/compras/purchase-one/reembolsos');
  expect(writes[0]?.body).toMatchObject({ pago_id: 'payment-one', cuenta_id: 'eur-account', importe: 5029 });
  expect(calls.some((c) => c.method === 'POST' && /finanzas\/movimientos|\/compras$|\/pagos$/.test(c.path))).toBe(false);
  expect(await screen.findByText(/24,71/)).toBeInTheDocument();
});

it('no permite devolver por encima del adelanto y no revierte pagos con reembolsos activos', async () => {
  const { calls, user } = mount({ pagos: [payment(), payment({ id: 'refund-old', clase: 'reembolso', pago_id: 'payment-one', importe: 2500, pagador: 'cuenta', socio: null, cuenta_id: 'eur-account' })] });
  expect(await screen.findByRole('button', { name: 'Revertir pago' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Reembolsar anticipo' }));
  const form = within(screen.getByRole('dialog', { name: 'Devolver anticipo al socio' }));
  await user.clear(form.getByLabelText(/^Importe a devolver \(EUR\)/));
  await user.type(form.getByLabelText(/^Importe a devolver \(EUR\)/), '75,01');
  await user.selectOptions(form.getByLabelText('Cuenta del proyecto que devuelve el dinero'), 'eur-account');
  await user.click(form.getByRole('button', { name: 'Registrar devolución' }));
  expect(await form.findByRole('alert')).toHaveTextContent('reembolso_supera_anticipo');
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
});

it('un error de red conserva importe, referencia e ID del reembolso al reintentar', async () => {
  const { calls, user } = mount({ retry: true });
  await user.click(await screen.findByRole('button', { name: 'Reembolsar anticipo' }));
  const form = within(screen.getByRole('dialog', { name: 'Devolver anticipo al socio' }));
  await user.selectOptions(form.getByLabelText('Cuenta del proyecto que devuelve el dinero'), 'eur-account');
  await user.type(form.getByLabelText('Referencia de la transferencia'), 'Transferencia de ejemplo');
  await user.click(form.getByRole('button', { name: 'Registrar devolución' }));
  expect(await form.findByRole('alert')).toHaveTextContent('puedes reintentar');
  expect(form.getByLabelText('Referencia de la transferencia')).toHaveValue('Transferencia de ejemplo');
  await user.click(form.getByRole('button', { name: 'Registrar devolución' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const writes = calls.filter((c) => c.method === 'POST'); expect(writes).toHaveLength(2); expect(writes[0]?.body).toEqual(writes[1]?.body);
});

it('revierte una devolución con motivo, recupera el saldo del socio y desbloquea el pago original', async () => {
  const { calls, user } = mount({ pagos: [payment(), payment({ id: 'refund-old', clase: 'reembolso', pago_id: 'payment-one', importe: 10000, pagador: 'cuenta', socio: null, cuenta_id: 'eur-account' })] });
  expect(await screen.findByRole('button', { name: 'Revertir pago' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Reembolsar anticipo' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Revertir devolución' }));
  const form = within(screen.getByRole('dialog', { name: 'Revertir devolución registrada' }));
  expect(form.getByText(/vuelve a quedar pendiente/)).toBeInTheDocument();
  await user.type(form.getByLabelText(/^Motivo del reverso/), 'La devolución se registró por duplicado');
  await user.click(form.getByRole('button', { name: 'Registrar reverso' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/api/admin/gestion/compras/purchase-one/pagos/refund-old/revertir', body: { motivo: 'La devolución se registró por duplicado' } });
  expect(await screen.findByRole('button', { name: 'Revertir pago' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Reembolsar anticipo' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Revertir devolución' })).not.toBeInTheDocument();
  expect(screen.getByText('Reverso de devolución')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Reembolsar anticipo' }));
  expect(within(screen.getByRole('dialog', { name: 'Devolver anticipo al socio' })).getByLabelText(/^Importe a devolver/)).toHaveValue('100');
});

it('reverso exige motivo, conserva el original y registra en la ruta del préstamo', async () => {
  const { calls, user } = mount({ tipo: 'prestamo', pagos: [payment({ objeto_tipo: 'prestamo', objeto_id: 'loan-one', numero: 1, capital: 8000, interes: 2000, pagador: 'cuenta', cuenta_id: 'eur-account', socio: null })] });
  await user.click(await screen.findByRole('button', { name: 'Revertir pago' }));
  const form = within(screen.getByRole('dialog', { name: 'Revertir pago registrado' }));
  await user.click(form.getByRole('button', { name: 'Registrar reverso' }));
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  await user.type(form.getByLabelText(/^Motivo del reverso/), 'Pago registrado dos veces por error');
  await user.click(form.getByRole('button', { name: 'Registrar reverso' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const write = calls.find((c) => c.method === 'POST');
  expect(write?.path).toBe('/api/admin/gestion/prestamos/loan-one/pagos/payment-one/revertir');
  expect(write?.body).toMatchObject({ motivo: 'Pago registrado dos veces por error' });
  expect(write?.body?.id).toEqual(expect.any(String));
  expect(await screen.findByText('Revertido')).toBeInTheDocument();
  expect(screen.getByText('Reverso registrado')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Revertir pago' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reembolsar anticipo' })).not.toBeInTheDocument();
});

it('cancelar el diálogo sin cambios devuelve el foco al botón que lo abrió', async () => {
  const { user } = mount();
  const button = await screen.findByRole('button', { name: 'Revertir pago' });
  await user.click(button);
  const dialog = screen.getByRole('dialog', { name: 'Revertir pago registrado' });
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(button).toHaveFocus();
});

it('muestra error y permite reintentar cuando no se pudo leer el historial', async () => {
  mount({ failHistory: true });
  expect(await screen.findByRole('alert')).toHaveTextContent('no tiene permiso');
  expect(screen.getByRole('button', { name: 'Reintentar historial' })).toBeInTheDocument();
  expect(screen.queryByText(/Todavía no hay pagos/)).not.toBeInTheDocument();
});
