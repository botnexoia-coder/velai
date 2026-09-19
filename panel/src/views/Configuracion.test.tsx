// Configuración: admins con la puerta de Access, integraciones solo raíz (403
// root_only con su aviso) y el diagnóstico del webhook bajo demanda.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from '../components/Toasts';
import { Configuracion } from './Configuracion';
import type { AdminsResponse, ConfigInfo, PermisosResponse, WebhookInfo } from '../api/types';

const admins: AdminsResponse = {
  admins: [
    { email: 'juan@velai.ai', root: true },
    { email: 'ana@velai.ai', root: false, created_by: 'juan@velai.ai', created_at: '2026-08-01T00:00:00.000Z' },
  ],
};

// Por defecto, un catálogo sin nadie: los tests de admins e integraciones no tienen
// por qué cargar con los permisos. El test de permisos manda los suyos.
const CATALOGO = [{ id: 'finanzas', nombre: 'Finanzas', detalle: 'El libro interno de Velai.' }];
const permisos: PermisosResponse = { catalogo: CATALOGO, concedidos: [], fijos: [] };

const config: ConfigInfo = {
  cf_token: { source: 'panel', valid: true, status: 'active' },
  account_id: 'abcd1234efgh5678',
  turnstile_sitekey: null,
  groups: { clientes: true, admins: true },
  d1: true,
  kv: true,
};

const webhook: WebhookInfo = {
  configured: true,
  url: 'https://api.hirevai.com/telegram/webhook',
  esperada: 'https://api.hirevai.com/telegram/webhook',
  coincide: true,
  pendientes: 3,
  ultimoError: { mensaje: 'connection refused', cuando: '2026-08-30T10:00:00.000Z' },
  ip: '149.154.167.220',
};

function renderView(routes: Record<string, { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).split('?')[0] ?? '';
      const r: { status?: number; body: unknown } | undefined = { '/api/admin/permisos': { body: permisos }, ...routes }[path];
      if (!r) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <MemoryRouter>
          <Configuracion />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('vista Configuración', () => {
  it('lista los admins: los raíz sin quitar, los del panel con su ✕', async () => {
    renderView({ '/api/admin/admins': { body: admins }, '/api/admin/config': { body: config } });
    await waitFor(() => expect(screen.getByText(/juan@velai\.ai/)).toBeInTheDocument());
    expect(screen.getByText(/· raíz/)).toBeInTheDocument();
    expect(screen.getByLabelText('Quitar a ana@velai.ai')).toBeInTheDocument();
    expect(screen.getByText(/2 admins · 1 raíz/)).toBeInTheDocument();
  });

  it('integraciones con semáforo y píldora global «n de 5»', async () => {
    renderView({ '/api/admin/admins': { body: admins }, '/api/admin/config': { body: config } });
    // Turnstile sin sitekey → ámbar, y el global dice 4 de 5.
    await waitFor(() => expect(screen.getByText('sin sitekey')).toBeInTheDocument());
    expect(screen.getByText(/Requiere atención · 4 de 5/)).toBeInTheDocument();
    expect(screen.getByText(/válido · active/)).toBeInTheDocument();
    expect(screen.getByText(/panel · cifrado en D1/)).toBeInTheDocument();
    expect(screen.getByText('D1')).toBeInTheDocument();
  });

  it('403 root_only: se explica en vez de romper (el 403 tiene entrada en TERRS)', async () => {
    renderView({
      '/api/admin/admins': { body: admins },
      '/api/admin/config': { status: 403, body: { error: 'root_only' } },
    });
    await waitFor(() => expect(screen.getByText(/solo para admins raíz/)).toBeInTheDocument());
    expect(screen.queryByText('Estado de las integraciones')).toBeNull();
  });

  it('permisos: los del worker se ven pero no se quitan; a un admin del panel se le da y se le quita', async () => {
    renderView({
      '/api/admin/admins': { body: admins },
      '/api/admin/config': { body: config },
      '/api/admin/permisos': {
        body: {
          catalogo: CATALOGO,
          concedidos: [{ email: 'estiven@velai.ai', permiso: 'finanzas', otorgado_por: 'juan@velai.ai', otorgado_en: '2026-09-19T00:00:00.000Z' }],
          fijos: [{ email: 'botnexo@velai.ai', permiso: 'finanzas', motivo: 'entorno' }],
        } satisfies PermisosResponse,
      },
    });
    await waitFor(() => expect(screen.getByText(/botnexo@velai\.ai · worker/)).toBeInTheDocument());
    // El del worker no lleva ✕ y el concedido desde el panel sí.
    expect(screen.queryByLabelText('Quitar Finanzas a botnexo@velai.ai')).toBeNull();
    expect(screen.getByLabelText('Quitar Finanzas a estiven@velai.ai')).toBeInTheDocument();
    // Solo se ofrece a admins del panel: ana sí, la raíz juan no.
    const select = screen.getByLabelText('Admin al que dar Finanzas') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'ana@velai.ai']);
  });

  it('permisos: con 403 root_only la tarjeta no existe (un admin normal ni se entera)', async () => {
    renderView({
      '/api/admin/admins': { body: admins },
      '/api/admin/config': { status: 403, body: { error: 'root_only' } },
      '/api/admin/permisos': { status: 403, body: { error: 'root_only' } },
    });
    await waitFor(() => expect(screen.getByText(/solo para admins raíz/)).toBeInTheDocument());
    expect(screen.queryByText('Permisos')).toBeNull();
    expect(screen.queryByLabelText('Admin al que dar Finanzas')).toBeNull();
  });

  it('el webhook de Telegram se comprueba BAJO DEMANDA y compara la URL', async () => {
    renderView({
      '/api/admin/admins': { body: admins },
      '/api/admin/config': { body: config },
      '/api/admin/config/telegram-webhook': { body: webhook },
    });
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: 'Comprobar' });
    await user.click(btn);
    await waitFor(() => expect(screen.getByText(webhook.url as string)).toBeInTheDocument());
    // 3 en cola = se están acumulando (rojo); el último error se enseña con su fecha.
    expect(screen.getByText(/3 — se están acumulando/)).toBeInTheDocument();
    expect(screen.getByText(/connection refused/)).toBeInTheDocument();
  });
});
