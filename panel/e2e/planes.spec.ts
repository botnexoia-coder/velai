import { test as base, expect } from '@playwright/test';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planesFixture, PLAN_TENANT } from '../../test/helpers/planes-fixture.js';

const test = base.extend<{ planes: Awaited<ReturnType<typeof planesFixture>> }>({
  planes: async ({ page }, use) => {
    const f = await planesFixture();
    const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
    await page.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== 'https://panel.test') return route.abort();
      if (url.pathname.startsWith('/api/admin/')) {
        const response = await f.request(new Request(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() || undefined }));
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      }
      const relative = url.pathname.startsWith('/assets/') ? url.pathname.slice(1) : 'index.html';
      return route.fulfill({ path: join(dist, relative), contentType: ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' } as Record<string, string>)[extname(relative)] });
    });
    try { await use(f); } finally { await f.close(); }
  },
});

test('alta, límite traducido y plan con excepciones: panel y worker reales', async ({ page, planes }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/clientes?t=${PLAN_TENANT}`);
  const dialog = page.getByRole('dialog', { name: 'Ficha del cliente' });
  await expect(dialog.getByLabel('Nombre', { exact: true })).toHaveValue('Cuenta de prueba');
  await dialog.getByRole('button', { name: 'Plan y módulos' }).click();
  await expect(dialog.getByLabel('Plan de la cuenta')).toHaveValue('esencial');
  await expect(dialog).toContainText('Canales: 1 de 1');
  await page.screenshot({ path: test.info().outputPath('planes-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath('planes-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await dialog.getByRole('button', { name: 'Marca del widget' }).click();
  await dialog.getByLabel('Dominios de la web').fill('https://prueba.invalid');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText(/Este plan no admite otro canal/)).toBeVisible();
  // Un único Guardar sube de plan y añade el canal de forma coherente.
  await dialog.getByRole('button', { name: 'Plan y módulos' }).click();
  await dialog.getByLabel('Plan de la cuenta').selectOption('profesional');
  await dialog.getByLabel('Habilitar Eventos').check();
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog).toContainText('Canales: 2 de sin límite');
  expect((await planes.DB.prepare('SELECT plan FROM tenants WHERE id=?').bind(PLAN_TENANT).first())?.plan).toBe('profesional');
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo cliente' }).click();
  await dialog.getByLabel('Nombre', { exact: true }).fill('Nuevo negocio');
  await dialog.getByLabel('Slug', { exact: true }).fill('nuevo-negocio');
  await dialog.getByRole('button', { name: 'Guardar y continuar' }).click();
  await expect(dialog.getByLabel('Plan de la cuenta')).toHaveValue('esencial');
  await dialog.getByLabel('Habilitar Citas').check();
  await expect(dialog.getByLabel('Habilitar Calendario')).toBeChecked();
  await dialog.getByRole('button', { name: 'Guardar y continuar' }).click();
  await dialog.getByLabel('Contexto del negocio').fill('Contexto suficiente para el nuevo negocio. Atiende las preguntas de los visitantes.');
  await dialog.getByRole('button', { name: 'Guardar y continuar' }).click();
  await expect(dialog.getByLabel('Nombre del bot')).toBeVisible();
  expect((await planes.DB.prepare("SELECT plan FROM tenants WHERE slug='nuevo-negocio'").first())?.plan).toBe('esencial');
  expect(errors).toEqual([]);
});

test('conceder y revocar Eventos sin sembrar eventos cambia navegación y rutas', async ({ page, planes }) => {
  planes.scope.role = 'cliente';
  await page.goto('/eventos');
  await expect(page).toHaveURL('https://panel.test/');
  await expect(page.getByRole('tab', { name: 'Eventos', exact: true })).toHaveCount(0);
  planes.scope.role = 'velai';
  await planes.request(new Request(`https://panel.test/api/admin/tenants/${PLAN_TENANT}/plan`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_revision: '', excepciones: [{ modulo: 'eventos', estado: 'on' }] }) }));
  planes.scope.role = 'cliente';
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Eventos', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Eventos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Eventos', exact: true })).toBeVisible();
  planes.scope.role = 'velai';
  const info = await (await planes.request(new Request(`https://panel.test/api/admin/tenants/${PLAN_TENANT}/plan`))).json();
  await planes.request(new Request(`https://panel.test/api/admin/tenants/${PLAN_TENANT}/plan`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_revision: info.revision, excepciones: [] }) }));
  planes.scope.role = 'cliente';
  await page.reload();
  await expect(page).toHaveURL('https://panel.test/');
  await expect(page.getByRole('tab', { name: 'Eventos', exact: true })).toHaveCount(0);
});
