import { expect, test, type Page } from '@playwright/test';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availability, meCliente, meVelai, stats, tenants } from '../src/test/fixtures';
import type { ChannelsResponse, Me } from '../src/api/types';

const root = fileURLToPath(new URL('../..', import.meta.url));
const ownId = tenants.tenants[0]!.id;
const otherId = '22222222-2222-4222-8222-222222222222';
const routed = {
  address: 'whatsapp:+34910000001', kind: 'whatsapp', created_at: '2026-09-16T12:00:00Z',
  tenant_id: ownId, name: 'Barbería López', slug: 'barberia-lopez', active: 1,
  twilio_from: 'whatsapp:+34910000001', sender_status: 'ONLINE', state: 'live' as const,
};

async function panel(page: Page, me: Me = meVelai) {
  const state = {
    channels: { channels: [], unrouted: [{
      tenant_id: ownId, name: 'Barbería López', slug: 'barberia-lopez', active: 1,
      channel_address: 'web:barberia-lopez', twilio_from: routed.address, sender_status: 'ONLINE',
    }] } as ChannelsResponse,
    linked: false, requests: [] as string[], mutations: [] as string[], missing: [] as string[],
  };
  const summary = () => [
    { kind: 'web', address: 'barberia.com', state: 'live' },
    { kind: 'whatsapp', address: routed.address, state: state.channels.unrouted.length ? 'unrouted' : 'live' },
    { kind: 'telegram', address: state.linked ? 'Equipo Barbería' : null, state: state.linked ? 'live' : 'off' },
    { kind: 'messenger', address: null, state: 'off' },
  ];
  const tenantList = () => ({ tenants: [
    { ...tenants.tenants[0]!, connection_summary: summary() },
    { ...tenants.tenants[0]!, id: otherId, name: 'Velai', slug: 'velai', connection_summary: [
      { kind: 'web', address: 'hirevai.com', state: 'live' },
      { kind: 'messenger', address: 'messenger:1077804955422697', state: 'live', managed_by: 'Velai (Messenger)' },
    ] },
  ] });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.hostname === 'hirevai.com' && u.pathname.startsWith('/fonts/')) {
      return route.fulfill({ path: join(root, 'site', u.pathname), contentType: 'font/woff2' });
    }
    if (u.hostname !== 'panel.test') return route.abort();
    if (!u.pathname.startsWith('/api/')) {
      try { return await route.fulfill({ path: join(root, 'panel/dist', extname(u.pathname) ? u.pathname : '/index.html') }); }
      catch { return route.fulfill({ status: 404, body: '' }); }
    }
    state.requests.push(u.pathname);
    if (req.method() !== 'GET') {
      state.mutations.push(u.pathname);
      if (u.pathname === `/api/admin/tenants/${ownId}/provision/sender/sync`) {
        state.channels = { channels: [routed], unrouted: [] };
        return route.fulfill({ json: { ok: true, applied: 1, conflicts: [], webhookOk: true, webhookFixed: false } });
      }
      return route.abort();
    }
    const routes: Record<string, unknown> = {
      '/api/admin/me': me,
      '/api/admin/stats': stats,
      '/api/admin/ai-usage': { days: 30, total: { cost: 0, calls: 0, tokens: 0 }, clientes: [], porDia: [], moneda: 'USD' },
      '/api/admin/ai-balance': { month: '2026-09', included: 100, used: 0, remaining: 100, pct: 0, over: false, usedToday: 0, calls: 0, serie: [] },
      '/api/admin/channels': state.channels,
      '/api/admin/tenants': tenantList(),
      '/api/admin/availability': availability,
      [`/api/admin/tenants/${ownId}/channels`]: { channels: summary() },
      [`/api/admin/tenants/${ownId}/telegram`]: { telegram: { linked: state.linked, title: state.linked ? 'Equipo Barbería' : null, botUsername: null, whitelabel: false, topics: [], weeklyReport: false } },
      [`/api/admin/tenants/${ownId}/whatsapp`]: { whatsapp: {
        channel_address: 'web:barberia-lopez', twilio_from: routed.address, has_waba: 1, has_token: 1, has_subaccount: 1,
        sender_status: 'ONLINE', lead_template_status: null, meta_partner_status: null, team_whatsapp: null,
        wa_number: null, logo_url: null, logo_wa_url: null, routed: state.channels.unrouted.length ? 0 : 1,
      }, alerts: { telegram: state.linked ? 'on' : 'off', whatsapp: 'off', any: state.linked }, profileSync: null },
    };
    if (u.pathname in routes) return route.fulfill({ json: routes[u.pathname] });
    state.missing.push(u.pathname);
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  return state;
}

test('Dashboard → diagnóstico → WhatsApp del cliente → incidencia resuelta, sin esperar a que caduque la caché', async ({ page }, info) => {
  const state = await panel(page);
  await page.goto('/');
  await expect(page.getByText('WhatsApp sin enrutar', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Revisar WhatsApp: Barbería López' })).toHaveAttribute('href', `/conexiones?t=${ownId}#whatsapp`);
  await page.screenshot({ path: info.outputPath('dashboard-desktop.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Diagnóstico de canales' }).click();
  await page.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('live');
  await expect(page.getByText('Números de WhatsApp sin enrutar')).toBeVisible();
  await expect(page.getByText('Última consulta:', { exact: false })).toBeVisible();
  await page.screenshot({ path: info.outputPath('diagnostico-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('diagnostico-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: 'Revisar WhatsApp de Barbería López' }).click();
  await expect(page.getByRole('combobox', { name: 'Cliente de las conexiones' })).toHaveValue(ownId);
  await expect(page.locator('#whatsapp')).toBeInViewport();
  await expect(page.getByRole('region', { name: 'Destinos de avisos' })).toContainText('Telegram');
  await expect(page.getByRole('region', { name: 'Canales de conversación' })).not.toContainText('Telegram');
  await page.getByRole('button', { name: 'Sincronizar desde Twilio' }).click();
  await expect(page.getByText('Sincronizado ✓ · 1 campos')).toBeVisible();
  await page.getByRole('tab', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Incidencias de canales' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Clientes', exact: true }).click();
  const client = page.getByRole('link', { name: 'Ver conexiones de Barbería López' });
  await expect(client).toContainText('WhatsApp · Configurado');
  await client.click();
  await expect(page.getByRole('combobox', { name: 'Cliente de las conexiones' })).toHaveValue(ownId);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.mutations).toEqual([`/api/admin/tenants/${ownId}/provision/sender/sync`]);
  expect(state.missing).toEqual([]);
});

test('los cambios externos llegan por sondeo a Diagnóstico, Clientes y Conexiones; Actualizar fuerza otra consulta', async ({ page }, info) => {
  await page.clock.install();
  const state = await panel(page);
  await page.goto('/canales');
  await expect(page.getByText('1 incidencia', { exact: true })).toBeVisible();
  state.channels = { channels: [routed], unrouted: [] };
  await page.clock.fastForward(31_000);
  await expect(page.getByText('Sin incidencias de configuración', { exact: true })).toBeVisible();
  const before = state.requests.filter((p) => p === '/api/admin/channels').length;
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect.poll(() => state.requests.filter((p) => p === '/api/admin/channels').length).toBe(before + 1);
  await page.getByRole('tab', { name: 'Clientes', exact: true }).click();
  const client = page.getByRole('link', { name: 'Ver conexiones de Barbería López' });
  await expect(client).toContainText('Telegram · Sin conectar');
  state.linked = true;
  await page.clock.fastForward(31_000);
  await expect(client).toContainText('Telegram · Vinculado');
  await page.screenshot({ path: info.outputPath('clientes-desktop.png'), fullPage: true });
  await client.click();
  await expect(page.getByRole('region', { name: 'Destinos de avisos' })).toContainText('Equipo Barbería');
  await page.screenshot({ path: info.outputPath('conexiones-desktop.png'), fullPage: true });
  state.linked = false;
  await page.clock.fastForward(31_000);
  await expect(page.getByRole('region', { name: 'Destinos de avisos' })).toContainText('Sin conectar');
  expect(state.missing).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test('un cliente ignora el tenant ajeno del enlace y no consulta inventarios globales', async ({ page }) => {
  const state = await panel(page, meCliente);
  await page.goto(`/conexiones?t=${otherId}`);
  await expect(page.getByRole('region', { name: 'Canales de conversación' })).toContainText('barberia.com');
  expect(state.requests.some((path) => path.includes(otherId) || path === '/api/admin/tenants' || path === '/api/admin/channels')).toBe(false);
  expect(state.missing).toEqual([]);
});

test('un enlace a un cliente inexistente no abre silenciosamente otro negocio', async ({ page }) => {
  const state = await panel(page);
  await page.goto('/conexiones?t=missing');
  await expect(page.getByText('El cliente del enlace ya no está disponible. Selecciona otro cliente.')).toBeVisible();
  expect(state.requests.some((path) => path.startsWith('/api/admin/tenants/'))).toBe(false);
});

test('el aviso huérfano lleva a su registro sin ofrecer una ficha inexistente', async ({ page }) => {
  const state = await panel(page);
  state.channels = { channels: [{ ...routed, state: 'orphan', name: null, slug: null, tenant_id: 'deleted' }], unrouted: [] };
  await page.goto('/');
  await page.getByRole('link', { name: 'Ver registro: Cliente inexistente' }).click();
  await expect(page.getByRole('heading', { name: 'Diagnóstico de canales' })).toBeVisible();
  await expect(page.getByPlaceholder('Buscar número, cliente o tipo…')).toHaveValue(routed.address);
  await expect(page.getByRole('cell', { name: routed.address, exact: true })).toBeVisible();
  await expect(page.getByText('Revisar asignación: el cliente ya no existe.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ficha', exact: true })).toHaveCount(0);
});
