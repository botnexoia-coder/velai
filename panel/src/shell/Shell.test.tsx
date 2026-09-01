// El shell: la navegación la decide el rol (velai ve todo; el cliente solo lo suyo) y
// el tema de las vistas se conmuta y persiste por pestaña.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from '../components/Toasts';
import { availability, inbox, leadsPage1, meCliente, meVelai, mockFetch, stats, tenants } from '../test/fixtures';
import type { Me } from '../api/types';

function renderApp(me: Me, path = '/') {
  vi.stubGlobal(
    'fetch',
    mockFetch({
      '/api/admin/me': me,
      '/api/admin/stats': stats,
      '/api/admin/tenants': tenants,
      '/api/admin/leads': leadsPage1,
      '/api/admin/inbox': inbox,
      '/api/admin/availability': availability,
      '/api/admin/escalations': { escalations: [] },
      '/api/admin/ai-usage': { days: 30, total: { cost: 0, calls: 0, tokens: 0 }, clientes: [], porDia: [], moneda: 'USD' },
      '/api/admin/ai-balance': { month: '2026-08', included: 1, used: 0, remaining: 1, pct: 0, over: false, usedToday: 0, calls: 0, serie: [] },
    }),
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.className = '';
  sessionStorage.clear();
});

describe('shell y navegación por rol', () => {
  it('velai ve la gestión completa: Clientes, Canales y Configuración', async () => {
    renderApp(meVelai);
    await waitFor(() => expect(screen.getByRole('tab', { name: /clientes/i })).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /canales/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /configuración/i })).toBeInTheDocument();
    expect(document.body.classList.contains('cliente')).toBe(false);
  });

  it('el cliente NO ve las vistas de Velai, y su nombre viste la cabecera', async () => {
    renderApp(meCliente);
    // Las comunes están…
    await waitFor(() => expect(screen.getByRole('tab', { name: /conversaciones/i })).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /leads/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /calendario/i })).toBeInTheDocument();
    // …y las de Velai, no (la defensa real es del worker; esto es la interfaz).
    await waitFor(() => expect(document.body.classList.contains('cliente')).toBe(true));
    // Sus plantillas (solo lectura) también son suyas, tras Conexiones.
    expect(screen.getByRole('tab', { name: /plantillas/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /clientes/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /canales/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /configuración/i })).toBeNull();
    expect(screen.getByText('Barbería López')).toBeInTheDocument();
  });

  it('el tema de las vistas se conmuta y se recuerda POR PESTAÑA (sessionStorage)', async () => {
    renderApp(meVelai);
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: /tema oscuro/i });
    expect(document.body.classList.contains('dark')).toBe(false);
    await user.click(btn);
    expect(document.body.classList.contains('dark')).toBe(true);
    expect(sessionStorage.getItem('velai-panel-dark')).toBe('1');
    await user.click(screen.getByRole('button', { name: /tema claro/i }));
    expect(document.body.classList.contains('dark')).toBe(false);
  });

  it('Conversaciones es la única vista a pantalla completa (body.wide)', async () => {
    renderApp(meVelai, '/conversaciones');
    await waitFor(() => expect(document.body.classList.contains('wide')).toBe(true));
  });

  it('«Activar avisos»: preferencia por pestaña y aviso de que puede llegar mudo', async () => {
    renderApp(meVelai);
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: /activar avisos/i });
    // El tooltip explica que el navegador exige un clic antes de poder sonar.
    expect(btn.getAttribute('data-tip')).toMatch(/puede llegar mudo/);
    await user.click(btn);
    await waitFor(() => expect(screen.getByRole('button', { name: /avisos activados/i })).toBeInTheDocument());
    expect(sessionStorage.getItem('velai-panel-alerts')).toBe('1');
    // El toast dice la verdad: sin permiso de notificaciones, solo sonará.
    await waitFor(() => expect(screen.getByText(/Avisos activados ✓/)).toBeInTheDocument());
    // Apagar limpia la preferencia.
    await user.click(screen.getByRole('button', { name: /avisos activados/i }));
    expect(sessionStorage.getItem('velai-panel-alerts')).toBe('');
  });

  it('el pie firma de Velai aunque el panel sea de un cliente', async () => {
    const { container } = renderApp(meCliente);
    await waitFor(() => expect(screen.getByText(/todos los derechos reservados/i)).toBeInTheDocument());
    expect(container.querySelector('.foot')).toHaveTextContent('Velai');
  });
});

it('el pie firma la versión desplegada — es lo que distingue un deploy de otro a ojo', () => {
  renderApp(meVelai);
  // vX.Y.Z · commit: la semántica la sube una persona; el commit cambia solo en cada
  // deploy. Si esto desaparece del pie, volvemos al «¿estoy viendo el nuevo o el viejo?».
  expect(document.querySelector('.foot-ver')?.textContent).toMatch(/^v\d+\.\d+\.\d+ · \S+$/);
});
