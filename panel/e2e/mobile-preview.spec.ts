import { expect, test } from '@playwright/test';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

test('copia móvil navega con API de lectura y menú completo, sin desbordamiento', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests: { method: string; path: string }[] = [];
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  await page.route('**/*', route => route.abort());
  await page.route('https://panel.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const relative = pathname.startsWith('/prueba-movil/assets/') || /\.(png|webmanifest)$/.test(pathname)
      ? pathname.slice(1) : 'prueba-movil/index.html';
    const path = normalize(join(dist, relative));
    if (!path.startsWith(dist + '/')) return route.abort();
    const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    return route.fulfill({ status: 200, path, contentType: types[extname(path)] ?? 'text/html' });
  });
  await page.route('**/api/admin/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    requests.push({ method: request.method(), path });
    const data: Record<string, unknown> = {
      '/api/admin/mobile-preview/me': { role: 'velai', socio: true, tenantId: null, tenantName: null, tenantLogo: null, modulos: [] },
      '/api/admin/mobile-preview/stats': { total30: 8, sinContactar: 2, fallidos7: 0, tenantsActivos: 2, porDia: [], porCanal: [], fuentes: [], captura: null },
      '/api/admin/mobile-preview/channels': { channels: [], unrouted: [] },
      '/api/admin/mobile-preview/tenants': { tenants: [
        { id: '11111111-1111-4111-8111-111111111111', name: 'NAYA · QA', slug: 'naya-qa', channel_address: 'web:naya-qa', updated_at: '2026-10-12', channels: 'web', sender_status: null, active: 1, lead_count: 2, prompt_len: 10 },
        { id: '22222222-2222-4222-8222-222222222222', name: 'GOgestión · QA', slug: 'gogestion-qa', channel_address: 'web:gogestion-qa', updated_at: '2026-10-12', channels: 'web', sender_status: null, active: 1, lead_count: 3, prompt_len: 10 },
      ] },
    };
    return route.fulfill({ status: path in data ? 200 : 404, contentType: 'application/json', body: JSON.stringify(data[path] ?? { error: 'not_found' }) });
  });
  await page.goto('/prueba-movil/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Solo lectura', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Navegación móvil' }).getByRole('button', { name: 'Más' }).click();
  await expect(page.getByRole('tab', { name: 'Finanzas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar menú', exact: true }).click();
  await page.getByRole('navigation', { name: 'Navegación móvil' }).getByRole('link', { name: 'Clientes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  await expect(page.getByText('NAYA · QA', { exact: true })).toBeVisible();
  await expect(page.getByText('GOgestión · QA', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(requests.every(r => r.method === 'GET' && r.path.startsWith('/api/admin/mobile-preview/'))).toBe(true);
  await page.screenshot({ path: test.info().outputPath('admin-movil.png'), fullPage: true });
});
