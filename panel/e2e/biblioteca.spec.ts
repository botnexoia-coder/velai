import { test as base, expect } from '@playwright/test';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bibliotecaFixture, mediaBytes, MEDIA_TENANT } from '../../test/helpers/biblioteca-fixture.js';

const test = base.extend<{ biblioteca: Awaited<ReturnType<typeof bibliotecaFixture>> }>({
  biblioteca: async ({ page }, use) => {
    const f = await bibliotecaFixture();
    const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
    await page.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== 'https://panel.test') return route.abort();
      if (url.pathname.startsWith('/api/admin/')) {
        const bytes = req.postDataBuffer();
        const response = await f.request(new Request(req.url(), { method: req.method(), headers: { ...req.headers(), ...(bytes ? { 'Content-Length': String(bytes.byteLength) } : {}) }, body: bytes ? Uint8Array.from(bytes).buffer : undefined }));
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      }
      const relative = url.pathname.startsWith('/assets/') ? url.pathname.slice(1) : 'index.html';
      return route.fulfill({ path: join(dist, relative), contentType: ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' } as Record<string,string>)[extname(relative)] });
    });
    try { await use(f); } finally { await f.close(); }
  },
});
test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });

test('cliente: PDF de 3 MB, edición, pausa, papelera y cuota persistente en escritorio y móvil', async ({ page, biblioteca }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/conexiones?tab=biblioteca');
  await expect(page.getByRole('tab', { name: 'Biblioteca' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Subir archivo' }).click();
  const form = page.getByRole('form', { name: 'Subir archivo' });
  await form.getByLabel('Archivo', { exact: true }).setInputFiles({ name: 'tarifas.pdf', mimeType: 'application/pdf', buffer: Buffer.from(mediaBytes('%PDF-1.7', 3 * 1024 * 1024)) });
  await form.getByLabel('Descripción para el bot').fill('Tarifas vigentes para quien pregunte por precios.');
  await form.getByRole('button', { name: 'Guardar archivo' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByText('3 de 500 MB · 1 archivo')).toBeVisible();
  expect(biblioteca.objects.size).toBe(1);
  let card = page.getByRole('article', { name: 'Archivo tarifas.pdf' });
  await expect(card.getByText('Enviado 0 veces')).toBeVisible();
  await card.getByRole('button', { name: 'Editar' }).click();
  const edit = page.getByRole('form', { name: 'Editar archivo' });
  await edit.getByLabel('Nombre').fill('Tarifas de septiembre');
  await edit.getByLabel('Messenger').uncheck();
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  card = page.getByRole('article', { name: 'Archivo Tarifas de septiembre' });
  await card.getByRole('button', { name: 'Desactivar' }).click();
  await expect(card).toContainText('Inactivo');
  await card.getByRole('button', { name: 'Activar', exact: true }).click();
  await expect(card).toContainText('Activo');
  await page.screenshot({ path: test.info().outputPath('biblioteca-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('biblioteca-mobile.png'), fullPage: true });
  await card.getByRole('button', { name: 'Borrar', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('7 días');
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar archivo' }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('3 de 500 MB · 1 archivo')).toBeVisible();
  expect((await biblioteca.DB.prepare('SELECT active,deleted_at FROM tenant_media WHERE tenant_id=?').bind(MEDIA_TENANT).first())?.active).toBe(0);
  expect(errors).toEqual([]);
});
