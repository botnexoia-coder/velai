import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from '../components/Toasts';
import { ConfirmarHost } from '../components/Confirmar';
import { Shell } from '../shell/Shell';
import { Finanzas } from './Finanzas';
import type { FinConceptos, FinCuenta, FinMovimiento, FinResumen } from '../api/types';

const conceptos: FinConceptos = { conceptos: {
  ingreso: [{ id: 1, tipo: 'ingreso', nombre: 'Cuota mensual', activo: 1, position: 0 }],
  gasto: [{ id: 2, tipo: 'gasto', nombre: 'Cloudflare', activo: 1, position: 0 }],
  egreso: [{ id: 3, tipo: 'egreso', nombre: 'Reparto a socios', activo: 1, position: 0, sistema: 1 }],
} };
const resumen: FinResumen = { monedas: {
  EUR: { ingresos: 150000, gastos: 20000, beneficio: 130000, egresos: 30000, caja: 100000, sin_repartir: 100000 },
  COP: { ingresos: 150000, gastos: 200000, beneficio: -50000, egresos: 0, caja: -50000, sin_repartir: -50000 },
}, conceptos: [], repartido: [] };
function mount({ socio = true, role = 'velai', path = '/finanzas', movimientos = [] as FinMovimiento[], cuentas = [ {id:'cuenta-eur',nombre:'Cuenta común EUR',moneda:'EUR',entidad_id:null}, {id:'cuenta-cop',nombre:'Cuenta COP',moneda:'COP',entidad_id:null} ] as FinCuenta[], extraConceptos = [] as FinConceptos['conceptos']['ingreso'] } = {}) {
  const calls: { path: string; method: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'https://panel.test'), method = init?.method || 'GET';
    calls.push({ path: url.pathname + url.search, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method !== 'GET') return Response.json({ ok: true, id: 'nuevo', ...(url.pathname.endsWith('/repartos') ? { aviso: 'caja_negativa' } : {}) });
    const data: Record<string, unknown> = {
      '/api/admin/me': { role, socio, tenantId: null, tenantName: null, tenantLogo: null },
      '/api/admin/tenants': { tenants: [{ id: 't1', name: 'Cliente Uno' }] },
      '/api/admin/finanzas/resumen': resumen,
      '/api/admin/finanzas/conceptos': {...conceptos,conceptos:{...conceptos.conceptos,ingreso:[...conceptos.conceptos.ingreso,...extraConceptos]}},
      '/api/admin/gestion/catalogos': {cuentas},
      '/api/admin/finanzas/movimientos': { movimientos, nextCursor: null },
      '/api/admin/finanzas/repartos': { socios: [{ email: 'uno@velai.test', nombre: 'Uno' }], repartido: [], repartos: [] },
      '/api/admin/finanzas/socios': { socios: [
        { email: 'uno+fin@velai.test', nombre: 'Uno', activo: 1, tiene_repartos: 1 },
        { email: 'dos@velai.test', nombre: 'Dos', activo: 0, tiene_repartos: 1 },
      ] },
    };
    return Response.json(data[url.pathname] || {});
  }));
  const result = render(<QueryClientProvider client={createQueryClient()}><ToastProvider><MemoryRouter initialEntries={[path]}><Routes><Route element={<Shell />}><Route path="/finanzas" element={<Finanzas />} /><Route path="/" element={<h1>Inicio</h1>} /></Route></Routes><ConfirmarHost /></MemoryRouter></ToastProvider></QueryClientProvider>);
  return { ...result, calls, user: userEvent.setup() };
}
afterEach(() => { vi.unstubAllGlobals(); document.body.className = ''; sessionStorage.clear(); });

it.each([{ socio: false, role: 'velai' }, { socio: true, role: 'cliente' }])('oculta Finanzas y cierra la URL directa para $role socio=$socio', async (opts) => {
  const { calls } = mount(opts);
  await screen.findByRole('heading', { name: 'Inicio' });
  expect(screen.queryByRole('tab', { name: 'Finanzas' })).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Administración' })).not.toBeInTheDocument();
  expect(calls.some((c) => c.path.includes('/finanzas/'))).toBe(false);
});
it('el socio tiene bloque Administración y tarjetas separadas con caja acumulada', async () => {
  mount();
  expect(await screen.findByRole('tab', { name: 'Finanzas' })).toBeInTheDocument();
  expect(within(screen.getByRole('navigation', { name: 'Administración' })).getByRole('tab', { name: 'Finanzas' })).toBeInTheDocument();
  const eur = await screen.findByRole('region', { name: 'Resumen EUR' }), cop = screen.getByRole('region', { name: 'Resumen COP' });
  await waitFor(() => expect(eur).toHaveTextContent('€ 1.500,00'));
  expect(cop).toHaveTextContent('$ 150.000'); expect(cop).toHaveTextContent('−$ 50.000');
  expect(eur).toHaveTextContent('Caja (acumulado)'); expect(cop.querySelector('.fin-negative')).toBeTruthy();
});
it('el tipo cambia el desplegable, oculta cliente en egresos y guarda EUR en céntimos exactos', async () => {
  const { user, calls } = mount();
  await user.click(await screen.findByRole('button', { name: 'Registrar movimiento' }));
  const modal = within(screen.getByRole('dialog', { name: 'Registrar movimiento' }));
  await waitFor(() => expect(modal.getByLabelText('Concepto')).toHaveValue('1'));
  expect(modal.getByRole('option', { name: 'Cuota mensual' })).toBeInTheDocument();
  await user.click(modal.getByRole('button', { name: 'Gasto' }));
  expect(modal.getByRole('option', { name: 'Cloudflare' })).toBeInTheDocument();
  expect(modal.queryByRole('option', { name: 'Cuota mensual' })).not.toBeInTheDocument();
  await user.click(modal.getByRole('button', { name: 'Egreso' }));
  expect(modal.queryByLabelText('Cliente (opcional)')).not.toBeInTheDocument();
  expect(modal.getByLabelText('Concepto')).toHaveValue('3');
  await user.type(modal.getByLabelText(/Importe \(EUR\)/), '0,29');
  await user.click(modal.getByRole('button', { name: 'Guardar movimiento' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ tipo: 'egreso', concepto_id: 3, moneda: 'EUR', importe: 29, tenant_id: null });
});
it('el reparto avisa en vivo de caja negativa, permite guardar y conserva aviso del servidor', async () => {
  const { user, calls } = mount({ path: '/finanzas?tab=repartos' });
  const nuevo = await screen.findByRole('button', { name: 'Nuevo reparto' });
  await waitFor(() => expect(nuevo).toBeEnabled()); await user.click(nuevo);
  const modal = within(screen.getByRole('dialog', { name: 'Nuevo reparto' }));
  await user.type(modal.getByLabelText('Importe 1 (EUR)'), '1200');
  expect(modal.getByRole('alert')).toHaveTextContent('La caja quedará negativa');
  expect(modal.getByText('−€ 200,00')).toBeInTheDocument();
  expect(modal.getByRole('button', { name: 'Guardar reparto' })).toBeEnabled();
  await user.click(modal.getByRole('button', { name: 'Guardar reparto' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('alert')).toHaveTextContent('Reparto guardado. La caja ha quedado negativa');
  expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ moneda: 'EUR', lineas: [{ beneficiario: 'uno@velai.test', importe: 120000 }] });
});
it('el reparto ignora las líneas en blanco y no deja guardar si no hay ninguna', async () => {
  const { user, calls } = mount({ path: '/finanzas?tab=repartos' });
  const nuevo = await screen.findByRole('button', { name: 'Nuevo reparto' });
  await waitFor(() => expect(nuevo).toBeEnabled()); await user.click(nuevo);
  const modal = within(screen.getByRole('dialog', { name: 'Nuevo reparto' }));
  await user.click(modal.getByRole('button', { name: 'Añadir línea' }));
  expect(modal.getByRole('button', { name: 'Guardar reparto' })).toBeDisabled();
  await user.type(modal.getByLabelText('Importe 2 (EUR)'), '300');
  await user.click(modal.getByRole('button', { name: 'Guardar reparto' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ lineas: [{ beneficiario: 'uno@velai.test', importe: 30000 }] });
});
it('filtra por cliente y exporta exactamente los mismos filtros', async () => {
  const { user, calls } = mount();
  await screen.findByRole('option', { name: 'Cliente Uno' });
  await user.selectOptions(screen.getByLabelText('Tipo'), 'gasto');
  await user.selectOptions(screen.getByLabelText('Moneda'), 'COP');
  await user.selectOptions(screen.getByLabelText('Concepto'), '2');
  await user.selectOptions(screen.getByLabelText('Cliente'), 't1');
  await waitFor(() => expect(calls.some((c) => c.path.includes('/movimientos?') && c.path.includes('tenant=t1'))).toBe(true));
  const href = screen.getByRole('link', { name: 'Exportar CSV' }).getAttribute('href')!;
  const p = new URL(href, 'https://panel.test').searchParams;
  expect(Object.fromEntries(p)).toMatchObject({ tipo: 'gasto', moneda: 'COP', concepto: '2', tenant: 't1' });
});
it('el catálogo permite añadir, renombrar y desactivar desde su pestaña', async () => {
  const { user, calls } = mount({ path: '/finanzas?tab=conceptos' });
  await user.type(await screen.findByLabelText('Nuevo concepto'), 'Asesoría');
  await user.selectOptions(screen.getByLabelText('Tipo de concepto'), 'gasto');
  await user.click(screen.getByRole('button', { name: 'Añadir concepto' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.body?.nombre === 'Asesoría')).toBe(true));
  const gasto = within(screen.getByRole('region', { name: 'Conceptos de gasto' }));
  await user.clear(gasto.getByLabelText('Nombre de Cloudflare'));
  await user.type(gasto.getByLabelText('Nombre de Cloudflare'), 'Infraestructura');
  await user.click(gasto.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.body?.nombre === 'Infraestructura')).toBe(true));
  await user.click(gasto.getByRole('button', { name: 'Desactivar' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.body?.activo === 0)).toBe(true));
  // El egreso que firman los repartos solo se mueve de sitio.
  const egreso = within(screen.getByRole('region', { name: 'Conceptos de egreso' }));
  expect(egreso.queryByLabelText('Nombre de Reparto a socios')).not.toBeInTheDocument();
  expect(egreso.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
  expect(egreso.queryByRole('button', { name: 'Borrar' })).not.toBeInTheDocument();
  expect(egreso.getByRole('button', { name: 'Subir Reparto a socios' })).toBeInTheDocument();
  expect(egreso.getByText('Lo usan los repartos del equipo: no se renombra ni se desactiva.')).toBeInTheDocument();
});

it('Socios permite dar de alta y corregir nombre/correo con URL codificada', async () => {
  const { user, calls } = mount({ path: '/finanzas?tab=socios' });
  await user.click(await screen.findByRole('button', { name: 'Añadir socio' }));
  let modal = within(screen.getByRole('dialog', { name: 'Añadir socio' }));
  await user.type(modal.getByLabelText('Nombre'), 'Eva');
  await user.type(modal.getByLabelText('Correo electrónico'), 'eva@velai.test');
  await user.click(modal.getByRole('button', { name: 'Guardar socio' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/socios'))?.body).toEqual({ nombre: 'Eva', email: 'eva@velai.test' });
  const socio = within(screen.getByRole('article', { name: 'Socio Uno' }));
  await user.click(socio.getByRole('button', { name: 'Editar' }));
  modal = within(screen.getByRole('dialog', { name: 'Editar socio' }));
  expect(modal.getByText(/sus repartos anteriores seguirán asociados/)).toBeInTheDocument();
  await user.clear(modal.getByLabelText('Nombre'));
  await user.type(modal.getByLabelText('Nombre'), 'Uno corregido');
  await user.clear(modal.getByLabelText('Correo electrónico'));
  await user.type(modal.getByLabelText('Correo electrónico'), 'nuevo@velai.test');
  await user.click(modal.getByRole('button', { name: 'Guardar socio' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.find((c) => c.method === 'PATCH')?.path).toBe('/api/admin/finanzas/socios/uno%2Bfin%40velai.test');
  expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ nombre: 'Uno corregido', email: 'nuevo@velai.test' });
});

it('la baja pide confirmación, permite cancelar y los socios inactivos se pueden reactivar', async () => {
  const { user, calls } = mount({ path: '/finanzas?tab=socios' });
  const socio = within(await screen.findByRole('article', { name: 'Socio Uno' }));
  await user.click(socio.getByRole('button', { name: 'Quitar' }));
  let dialog = within(screen.getByRole('dialog', { name: '¿Quitar a Uno?' }));
  expect(dialog.getByText(/Sus pagos anteriores se conservan/)).toBeInTheDocument();
  await user.click(dialog.getByRole('button', { name: 'Cancelar' }));
  expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  await user.click(socio.getByRole('button', { name: 'Quitar' }));
  dialog = within(screen.getByRole('dialog', { name: '¿Quitar a Uno?' }));
  await user.click(dialog.getByRole('button', { name: 'Quitar socio' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/uno%2Bfin%40velai.test'))).toBe(true));
  const inactivo = within(screen.getByRole('article', { name: 'Socio Dos' }));
  await user.click(inactivo.getByRole('button', { name: 'Reactivar' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.body?.activo === 1)).toBe(true));
});

const movimientoManual:FinMovimiento={id:'mov-manual',tipo:'gasto',concepto_id:2,concepto_nombre:'Cloudflare',fecha:'2026-10-09',moneda:'EUR',importe:2900,nota:'Nota inicial',tenant_id:null,tenant_name:null,beneficiario:null,reparto_id:null,created_by:'socio@velai.test',created_at:'2026-10-09T12:00:00Z',naturaleza:'operativo',signo:1,origen_tipo:null,origen_id:null,cuenta_id:null,entidad_id:null};
it('la cuenta queda pendiente por defecto y se limpia al cambiar de moneda',async()=>{const {user,calls}=mount();await user.click(await screen.findByRole('button',{name:'Registrar movimiento'}));const d=within(screen.getByRole('dialog',{name:'Registrar movimiento'}));const account=d.getByLabelText(/Cuenta del proyecto/);expect(account).toHaveValue('');expect(d.getByRole('option',{name:'Cuenta común EUR'})).toBeInTheDocument();expect(d.queryByRole('option',{name:'Cuenta COP'})).not.toBeInTheDocument();await user.selectOptions(account,'cuenta-eur');await user.selectOptions(d.getByLabelText('Moneda'),'COP');expect(account).toHaveValue('');expect(d.queryByRole('option',{name:'Cuenta común EUR'})).not.toBeInTheDocument();await user.selectOptions(account,'cuenta-cop');await user.type(d.getByLabelText(/Importe \(COP\)/),'50000');await user.click(d.getByRole('button',{name:'Guardar movimiento'}));await waitFor(()=>expect(calls.some(c=>c.method==='POST'&&c.path.endsWith('/movimientos'))).toBe(true));expect(calls.find(c=>c.method==='POST')?.body).toMatchObject({moneda:'COP',cuenta_id:'cuenta-cop',importe:50000});});
it('editar una nota histórica no asigna automáticamente cuenta',async()=>{const {user,calls}=mount({movimientos:[movimientoManual]});await user.click(await screen.findByRole('button',{name:'Cloudflare'}));const d=within(screen.getByRole('dialog',{name:'Detalle del movimiento'}));expect(d.getByLabelText(/Cuenta del proyecto/)).toHaveValue('');await user.clear(d.getByLabelText('Nota'));await user.type(d.getByLabelText('Nota'),'Nota corregida');await user.click(d.getByRole('button',{name:'Guardar movimiento'}));await waitFor(()=>expect(calls.some(c=>c.method==='PATCH')).toBe(true));expect(calls.find(c=>c.method==='PATCH')?.body).toMatchObject({cuenta_id:null,nota:'Nota corregida'});});
it('permite vincular expresamente un movimiento manual a una cuenta',async()=>{const {user,calls}=mount({movimientos:[movimientoManual]});await user.click(await screen.findByRole('button',{name:'Cloudflare'}));const d=within(screen.getByRole('dialog',{name:'Detalle del movimiento'}));await user.selectOptions(d.getByLabelText(/Cuenta del proyecto/),'cuenta-eur');await user.click(d.getByRole('button',{name:'Guardar movimiento'}));await waitFor(()=>expect(calls.some(c=>c.method==='PATCH')).toBe(true));expect(calls.find(c=>c.method==='PATCH')?.body?.cuenta_id).toBe('cuenta-eur');});
it.each([{origen:'prestamo_desembolso',naturaleza:'financiacion',ruta:'/credito',nombre:'Crédito',signo:1},{origen:'compra_pago',naturaleza:'operativo',ruta:'/compras',nombre:'Compras',signo:1},{origen:'reverso',naturaleza:'financiero',ruta:'/credito',nombre:'Crédito',signo:-1}] as const)('un movimiento $origen queda protegido y enlaza a su módulo',async({origen,naturaleza,ruta,nombre,signo})=>{const item:FinMovimiento={...movimientoManual,id:'gestión',concepto_nombre:'Operación generada',tipo:naturaleza==='financiacion'?'ingreso':'gasto',origen_tipo:origen,origen_id:'operación',naturaleza,signo,cuenta_id:'cuenta-eur'};const {user,calls}=mount({movimientos:[item]});await user.click(await screen.findByRole('button',{name:'Operación generada'}));const d=within(screen.getByRole('dialog',{name:'Detalle del movimiento'}));expect(d.queryByRole('button',{name:'Guardar movimiento'})).not.toBeInTheDocument();expect(d.queryByRole('button',{name:'Borrar movimiento'})).not.toBeInTheDocument();expect(d.getByRole('link',{name:`Abrir ${nombre}`})).toHaveAttribute('href',ruta);if(signo===-1)expect(d.getByText('−€ 29,00')).toBeInTheDocument();if(naturaleza==='financiacion')expect(d.getByText('Financiación')).toBeInTheDocument();expect(calls.some(c=>c.method!=='GET')).toBe(false);});
it('los conceptos propios de Gestión no se ofrecen para altas manuales',async()=>{const {user}=mount({extraConceptos:[{id:9,tipo:'ingreso',nombre:'Abono de préstamo',activo:1,position:9,sistema:1,clave:'g_financiacion'}]});await user.click(await screen.findByRole('button',{name:'Registrar movimiento'}));const d=within(screen.getByRole('dialog',{name:'Registrar movimiento'}));expect(d.queryByRole('option',{name:'Abono de préstamo'})).not.toBeInTheDocument();expect(d.getByRole('option',{name:'Cuota mensual'})).toBeInTheDocument();});
