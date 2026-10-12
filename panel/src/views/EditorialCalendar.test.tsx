import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/Toasts';
import { api, ApiError } from '../api/client';
import { EditorialCalendar } from './EditorialCalendar';

const mode = vi.hoisted(() => ({ preview: false }));
vi.mock('../mobilePreview', () => ({ get MOBILE_PREVIEW() { return mode.preview; } }));
vi.mock('../api/client', async importOriginal => ({ ...await importOriginal<typeof import('../api/client')>(), api: vi.fn() }));
vi.mock('../components/Confirmar', () => ({ confirmar: vi.fn().mockResolvedValue(true) }));
const now = new Date();
const fecha = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
const entry = { id: 'entry-1', fecha, titulo: 'Grabación invitado', detalle: 'Tema del episodio', version: 3 };
function mount(canEdit = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><EditorialCalendar tenantId="tenant-1" canEdit={canEdit} /></ToastProvider></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); mode.preview = false; vi.mocked(api).mockResolvedValue({ entries: [] }); });
describe('Planificación editorial', () => {
  it('click en fecha abre evento y guarda sin crear una cita Google', async () => {
    const user = userEvent.setup(); mount();
    await screen.findByText('Sin planificación para este día.');
    await user.click(screen.getByRole('button', { name: fecha }));
    const dialog = screen.getByRole('dialog', { name: 'Añadir evento' });
    expect(within(dialog).getByLabelText('Fecha')).toHaveValue(fecha);
    await user.type(within(dialog).getByLabelText('Qué grabaremos / episodio'), 'Episodio migración');
    await user.type(within(dialog).getByLabelText('Detalles'), 'Invitado confirmado');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar planificación' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/admin/tenants/tenant-1/editorial', expect.objectContaining({ method: 'POST', body: JSON.stringify({ fecha, titulo: 'Episodio migración', detalle: 'Invitado confirmado' }) })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(vi.mocked(api).mock.calls.every(([path]) => path.includes('/editorial'))).toBe(true);
  });
  it('cliente y prueba móvil consultan sin controles de escritura', async () => {
    mode.preview = true; vi.mocked(api).mockResolvedValue({ entries: [entry] });
    const user = userEvent.setup(); mount();
    await user.click(await screen.findByRole('button', { name: `${fecha}, 1 registros` }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Añadir planificación' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Borrar' })).not.toBeInTheDocument();
  });
  it('conserva formulario al conflicto de versión y explica cómo recuperar', async () => {
    vi.mocked(api).mockImplementation(async (_path, init) => { if (init?.method === 'PATCH') throw new ApiError('version_conflicto', 409); return { entries: [entry] }; });
    const user = userEvent.setup(); mount();
    await user.click(await screen.findByRole('button', { name: `${fecha}, 1 registros` }));
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar planificación' });
    await user.click(within(dialog).getByRole('button', { name: 'Guardar planificación' }));
    await screen.findByText(/Este registro cambió/);
    expect(within(dialog).getByLabelText('Qué grabaremos / episodio')).toHaveValue(entry.titulo);
    expect(api).toHaveBeenCalledWith('/api/admin/tenants/tenant-1/editorial/entry-1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ fecha, titulo: entry.titulo, detalle: entry.detalle, version: 3 }) }));
  });
  it('confirma el borrado y envía la versión del registro', async () => {
    vi.mocked(api).mockResolvedValue({ entries: [entry] });
    const user = userEvent.setup(); mount();
    await user.click(await screen.findByRole('button', { name: `${fecha}, 1 registros` }));
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    await user.click(screen.getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/admin/tenants/tenant-1/editorial/entry-1?version=3', expect.objectContaining({ method: 'DELETE' })));
  });
  it('muestra fallo de consulta y permite reintentar', async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError('network_failed', 0)).mockResolvedValue({ entries: [] });
    const user = userEvent.setup(); mount(false);
    await user.click(await screen.findByRole('button', { name: 'Reintentar consulta' }));
    await screen.findByText('Sin planificación para este día.');
    expect(screen.queryByRole('button', { name: 'Añadir planificación' })).not.toBeInTheDocument();
  });
});
