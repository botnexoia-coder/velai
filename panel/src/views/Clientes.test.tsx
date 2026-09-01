// Clientes: el semáforo puro del listado, la ficha con UN solo Guardar (bloqueo
// optimista con expected_updated_at → stale_tenant explicado) y el alta por stepper.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { ToastProvider } from '../components/Toasts';
import { semaforo } from '../lib/semaforo';
import { tenants } from '../test/fixtures';
import { Clientes } from './Clientes';
import type { TenantDetail, TenantDetailResponse, TenantRow } from '../api/types';

function row(over: Partial<TenantRow> = {}): TenantRow {
  return { ...(tenants.tenants[0] as TenantRow), ...over };
}

describe('el semáforo del listado (puro)', () => {
  it('un prospecto (pending: inactivo) es UN solo chip', () => {
    expect(semaforo(row({ active: 0, channel_address: 'pending:x' }))).toEqual([{ cls: 'off', text: 'prospecto' }]);
  });
  it('whatsapp verde con sender ONLINE; verificando si no; sin enrutar si hay sender sin canal', () => {
    const conCanal = row({ channels: 'web,whatsapp', sender_status: 'ONLINE', has_template: 1, has_team: 1 });
    expect(semaforo(conCanal).map((c) => c.text)).toContain('whatsapp');
    const verificando = row({ channels: 'web,whatsapp', sender_status: 'CREATING', has_subaccount: 1, has_twilio_token: 1, has_from: 1 });
    expect(semaforo(verificando).map((c) => c.text)).toContain('whatsapp: verificando');
    // El caso gogestion: sender vivo y NINGÚN canal que lo enrute.
    const sinEnrutar = row({ channels: 'web', sender_status: 'ONLINE' });
    expect(semaforo(sinEnrutar).map((c) => c.text)).toContain('whatsapp: sin enrutar');
  });
  it('los avisos de configuración: contexto corto, sin canal de aviso, sin plantilla', () => {
    const chips = semaforo(row({ prompt_len: 100, has_team: 0, has_telegram: 0, channels: 'web,whatsapp', has_template: 0, sender_status: 'ONLINE' }));
    const textos = chips.map((c) => c.text);
    expect(textos).toContain('contexto corto');
    expect(textos).toContain('sin canal de aviso');
    expect(textos).toContain('sin plantilla');
    // Con avisos NO sale el «listo».
    expect(textos).not.toContain('listo');
  });
});

const detailTenant: TenantDetail = {
  id: tenants.tenants[0]!.id,
  slug: 'barberia-lopez',
  name: 'Barbería López',
  channel_address: 'web:barberia-lopez',
  team_whatsapp: 'whatsapp:+34600111222',
  telegram_chat_id: null,
  lead_template_sid: null,
  twilio_from: null,
  twilio_subaccount_sid: null,
  waba_id: null,
  meta_partner_status: 'pendiente',
  system_prompt: 'Eres el asistente de la barbería.',
  bot_name: 'Vai',
  brand_name: null,
  logo_url: null,
  brand_color: null,
  brand_color_2: null,
  agent_color: null,
  greeting: null,
  greeting_en: null,
  chips_json: '["Pedir cita"]',
  placeholder: null,
  wa_number: null,
  theme: null,
  web_origins: '["https://barberia.com"]',
  sender_sid: null,
  sender_status: null,
  telegram_chat_title: null,
  ai_monthly_tokens: null,
  ai_daily_limit: null,
  support_hours: null,
  support_tz: null,
  active: 1,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-20T00:00:00.000Z',
  has_twilio_token: 0,
};

const detail: TenantDetailResponse = {
  tenant: detailTenant,
  channels: [
    { kind: 'web', address: 'barberia.com', state: 'live' },
    { kind: 'whatsapp', address: null, state: 'off' },
  ],
};

function renderClientes(onFetch?: (url: string, init?: RequestInit) => Response | null) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const custom = onFetch?.(url, init);
      if (custom) return custom;
      const path = url.split('?')[0] ?? '';
      const routes: Record<string, unknown> = {
        '/api/admin/tenants': tenants,
        [`/api/admin/tenants/${detailTenant.id}`]: detail,
        [`/api/admin/tenants/${detailTenant.id}/versions`]: { versions: [] },
        [`/api/admin/tenants/${detailTenant.id}/users`]: { users: [{ email: 'gestora@cliente.com', created_at: '' }] },
        [`/api/admin/tenants/${detailTenant.id}/provision`]: {
          subaccount: { sid: null, hasToken: false },
          template: { sid: null, status: null },
          sender: { sid: null, status: null },
          provisioned_at: null,
          warnings: [],
        },
      };
      if (path in routes) {
        return new Response(JSON.stringify(routes[path]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  const utils = render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <MemoryRouter>
          <Clientes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe('vista Clientes', () => {
  it('el listado enseña semáforo, medidor de contexto y estado', async () => {
    renderClientes();
    await waitFor(() => expect(screen.getByText('Barbería López')).toBeInTheDocument());
    expect(screen.getByText('1200 car.')).toBeInTheDocument();
    expect(screen.getByText('activo')).toBeInTheDocument();
    expect(screen.getByText('web')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo cliente' })).toBeInTheDocument();
  });

  it('la ficha se abre poblada, marca la pestaña sucia y guarda con el bloqueo optimista', async () => {
    const { calls } = renderClientes();
    const user = userEvent.setup();
    await user.click(await screen.findByText('Barbería López'));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    // Poblada desde el GET (columnas explícitas del worker).
    await waitFor(() => expect(within(dialog).getByLabelText('Nombre')).toHaveValue('Barbería López'));
    expect(within(dialog).getByLabelText('Slug')).toHaveValue('barberia-lopez');
    // Los canales se PINTAN, no se editan.
    expect(within(dialog).getByText('atendido')).toBeInTheDocument();
    expect(within(dialog).getByText('sin conectar')).toBeInTheDocument();
    // Editar enciende el punto ámbar de SU pestaña.
    await user.type(within(dialog).getByLabelText('Nombre'), ' SL');
    expect(within(dialog).getByRole('button', { name: /identidad y canal/i }).className).toContain('dirty');
    // Guardar: PATCH con expected_updated_at (el 409 stale_tenant existe para esto).
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      const patch = calls.find((c) => c.init?.method === 'PATCH' && c.url.endsWith(`/api/admin/tenants/${detailTenant.id}`));
      expect(patch).toBeTruthy();
      const body = JSON.parse(String(patch?.init?.body)) as Record<string, unknown>;
      expect(body['expected_updated_at']).toBe('2026-08-20T00:00:00.000Z');
      expect(body['name']).toBe('Barbería López SL');
      expect(body['chips_json']).toEqual(['Pedir cita']);
      expect(body['web_origins']).toEqual(['https://barberia.com']);
      // El token NO viaja si no se escribió (write-only).
      expect('twilio_auth_token' in body).toBe(false);
    });
  });

  it('un 409 stale_tenant se traduce a palabras, no a un código', async () => {
    renderClientes((url, init) => {
      if (init?.method === 'PATCH' && url.endsWith(`/api/admin/tenants/${detailTenant.id}`)) {
        return new Response(JSON.stringify({ error: 'stale_tenant' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }
      return null;
    });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Barbería López'));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await waitFor(() => expect(within(dialog).getByLabelText('Nombre')).toHaveValue('Barbería López'));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.getByText(/Alguien modificó este cliente mientras editabas/)).toBeInTheDocument());
  });

  it('un invalid_<campo> aterriza en el campo, no en un toast genérico', async () => {
    renderClientes((url, init) => {
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ error: 'invalid_slug' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      return null;
    });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Barbería López'));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await waitFor(() => expect(within(dialog).getByLabelText('Slug')).toHaveValue('barberia-lopez'));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(within(dialog).getByText('Formato inválido — revisa el ejemplo del campo.')).toBeInTheDocument());
  });

  it('el alta abre el stepper y «Guardar y continuar» hace el POST del borrador', async () => {
    const { calls } = renderClientes((url, init) => {
      if (init?.method === 'POST' && url.endsWith('/api/admin/tenants')) {
        return new Response(JSON.stringify({ ok: true, id: detailTenant.id, updated_at: '2026-09-01T00:00:00.000Z' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return null;
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Nuevo cliente' }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    // Stepper con los 5 pasos y sin el Guardar de la cabecera.
    expect(within(dialog).getByText('Aprovisionamiento')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Guardar' })).toBeNull();
    await user.type(within(dialog).getByLabelText('Nombre'), 'Nuevo Negocio');
    await user.type(within(dialog).getByLabelText('Slug'), 'nuevo-negocio');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar y continuar' }));
    await waitFor(() => {
      const post = calls.find((c) => c.init?.method === 'POST' && c.url.endsWith('/api/admin/tenants'));
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post?.init?.body)) as Record<string, unknown>;
      expect(body['slug']).toBe('nuevo-negocio');
      // El borrador nace SIN activar: prospecto hasta el final del alta.
      expect(body['active']).toBe(false);
    });
    // Y avanza al paso de Contexto.
    await waitFor(() => expect(within(dialog).getByLabelText('Contexto del negocio')).toBeInTheDocument());
  });
});
