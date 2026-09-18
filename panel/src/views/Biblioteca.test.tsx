import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from '../components/Toasts';
import { ConfirmarHost } from '../components/Confirmar';
import { Biblioteca } from './Biblioteca';
import { Conexiones } from './Conexiones';
import { mediaHref, messageAttachments } from '../lib/media';

const url = 'https://api.hirevai.com/media/lib/00000000-0000-4000-8000-00000000000a/00000000-0000-4000-8000-000000000001abcdefab.pdf';
const item = { id: 'f1', name: 'Tarifas.pdf', description: 'Precios del negocio', url, kind: 'pdf', ext: 'pdf', bytes: 3 * 1024 * 1024, active: 1, channels: ['web', 'whatsapp'], position: 0, sent_count: 9, last_sent_at: '2026-09-17T10:00:00Z' };
function mount({ empty = false, ready = true, conexiones = false, uploadError = '' } = {}) {
  const calls: { url: string; method: string; body: BodyInit | null | undefined }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method || 'GET'; calls.push({ url: String(input), method, body: init?.body });
    if (String(input).endsWith('/me')) return Response.json({ role: 'cliente', tenantId: 't1' });
    if (method === 'POST' && uploadError) return Response.json({ error: uploadError }, { status: 413 });
    if (method !== 'GET') return Response.json({ ok: true });
    return Response.json({ items: empty ? [] : [item], quota: { bytes: 500 * 1024 * 1024, used: 34 * 1024 * 1024, files: 9 }, storage_ready: ready });
  }));
  render(<QueryClientProvider client={createQueryClient()}><ToastProvider><MemoryRouter initialEntries={['/conexiones?tab=biblioteca']}>
    {conexiones ? <Conexiones /> : <Biblioteca tenantId="t1" />}<ConfirmarHost />
  </MemoryRouter></ToastProvider></QueryClientProvider>);
  return { calls, user: userEvent.setup() };
}
afterEach(() => vi.unstubAllGlobals());
it('el cliente entra desde Conexiones y ve cuota, envíos y copia honesta de borrado', async () => {
  const { calls } = mount({ conexiones: true });
  expect(await screen.findByRole('tab', { name: 'Biblioteca' })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByText('34 de 500 MB · 9 archivos')).toBeInTheDocument();
  expect(screen.getByText(/Enviado 9 veces/)).toBeInTheDocument();
  expect(screen.getByText(/No desactiva inmediatamente su enlace/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Recalcular espacio' })).not.toBeInTheDocument();
  expect(calls.some((c) => c.url === '/api/admin/tenants/t1/media')).toBe(true);
});
it('subida binaria: descripción y canales en la URL, archivo como cuerpo', async () => {
  const { user, calls } = mount({ empty: true });
  const add = await screen.findByRole('button', { name: 'Subir archivo' });
  await waitFor(() => expect(add).toBeEnabled()); await user.click(add);
  const form = within(screen.getByRole('form', { name: 'Subir archivo' }));
  const file = new File(['%PDF-1.7 contenido'], 'tarifas.pdf', { type: 'application/pdf' });
  await user.upload(form.getByLabelText('Archivo'), file);
  await user.type(form.getByLabelText('Descripción para el bot'), 'Enviar al preguntar por tarifas.');
  await user.click(form.getByLabelText('Messenger'));
  // JSDOM marca valueMissing en inputs file aun con files; el E2E verifica el submit nativo.
  fireEvent.submit(screen.getByRole('form', { name: 'Subir archivo' }));
  await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument());
  const post = calls.find((c) => c.method === 'POST')!;
  expect(post.body).toBe(file); const query = new URL(post.url, 'https://panel.test').searchParams;
  expect(query.get('description')).toBe('Enviar al preguntar por tarifas.'); expect(query.get('channels')).toBe('web,whatsapp');
});
it('edición y baja confirmada usan únicamente el tenant actual y el archivo elegido', async () => {
  const { user, calls } = mount();
  await user.click(await screen.findByRole('button', { name: 'Editar' }));
  await user.clear(screen.getByLabelText('Nombre')); await user.type(screen.getByLabelText('Nombre'), 'Tarifas nuevas');
  await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument());
  expect(JSON.parse(String(calls.find((c) => c.method === 'PATCH')!.body)).name).toBe('Tarifas nuevas');
  await user.click(screen.getByRole('button', { name: 'Borrar' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText(/El espacio se libera a los 7 días/)).toBeInTheDocument();
  await user.click(dialog.getByRole('button', { name: 'Borrar archivo' }));
  await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/tenants/t1/media/f1' && c.method === 'DELETE')).toBe(true));
});
it('R2 sin configurar impide subir y explica cómo activar la biblioteca', async () => {
  mount({ ready: false });
  expect(await screen.findByText(/pendiente de activación por Velai/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Subir archivo' })).toBeDisabled();
});
it('chips del historial rechazan protocolos, hosts, credenciales y rutas peligrosas', () => {
  expect(mediaHref(url)).toBe(url);
  for (const bad of ['javascript:alert(1)', url.replace('https:', 'http:'), url.replace('api.hirevai.com','evil.test'), url+'#x', url+'?x=1', url.replace('api.hirevai.com','user@api.hirevai.com'), url.replace('/lib/', '/logos/')]) expect(mediaHref(bad)).toBeNull();
  expect(messageAttachments(JSON.stringify([{name:'Tarifas',url},{name:'Malo',url:'javascript:alert(1)'}]))).toEqual([{name:'Tarifas',url}]);
  expect(messageAttachments('garbage')).toEqual([]);
});
