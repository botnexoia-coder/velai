import { test as base, expect } from '@playwright/test';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finanzasFixture } from '../../test/helpers/finanzas-fixture.js';

const test = base.extend<{ fin: Awaited<ReturnType<typeof finanzasFixture>> }>({
  fin: async ({ page }, use) => {
    const f = await finanzasFixture();
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
test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });

test('libro real: registrar, corregir, repartir, catálogo y borrar con caja actualizada', async ({ page, fin }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/finanzas');
  await expect(page.getByRole('navigation', { name: 'Administración' })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar movimiento' }).click();
  let dialog = page.getByRole('dialog', { name: 'Registrar movimiento' });
  await dialog.getByLabel('Importe (EUR)').fill('1500,29');
  await dialog.getByRole('textbox', { name: 'Nota', exact: true }).fill('Cuota de septiembre');
  await dialog.getByRole('button', { name: 'Guardar movimiento' }).click();
  await expect(dialog).toHaveCount(0);
  const eur = page.getByRole('region', { name: 'Resumen EUR' });
  await expect(eur.locator('.fin-caja')).toContainText('€ 1.500,29');
  expect((await fin.DB.prepare('SELECT importe FROM fin_movimientos').first())?.importe).toBe(150029);
  await page.getByRole('button', { name: 'Cuota mensual de cliente', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Detalle del movimiento' });
  await dialog.getByLabel('Importe (EUR)').fill('1200');
  await dialog.getByRole('button', { name: 'Guardar movimiento' }).click();
  await expect(eur.locator('.fin-caja')).toContainText('€ 1.200,00');

  await page.getByRole('button', { name: 'Registrar movimiento' }).click();
  dialog = page.getByRole('dialog', { name: 'Registrar movimiento' });
  await dialog.getByRole('button', { name: 'Gasto', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Moneda', exact: true }).selectOption('COP');
  await dialog.getByLabel('Importe (COP)').fill('150000');
  await dialog.getByRole('button', { name: 'Guardar movimiento' }).click();
  await expect(page.getByRole('region', { name: 'Resumen COP' }).locator('.fin-caja')).toContainText('−$ 150.000');
  await page.screenshot({ path: test.info().outputPath('finanzas-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Repartos', exact: true }).click();
  await expect(page).toHaveURL(/tab=repartos/);
  await page.getByRole('button', { name: 'Nuevo reparto' }).click();
  dialog = page.getByRole('dialog', { name: 'Nuevo reparto' });
  await dialog.getByLabel('Importe 1 (EUR)').fill('1000');
  await dialog.getByLabel('Importe 2 (EUR)').fill('300');
  await expect(dialog.getByRole('alert')).toContainText('La caja quedará negativa');
  await expect(dialog.locator('.fin-preview')).toContainText('−€ 100,00');
  await page.screenshot({ path: test.info().outputPath('finanzas-reparto.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Guardar reparto' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Reparto guardado');
  expect((await fin.DB.prepare('SELECT COUNT(*) AS n FROM fin_movimientos WHERE reparto_id IS NOT NULL').first())?.n).toBe(2);
  await page.getByRole('button', { name: 'Borrar reparto', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar reparto', exact: true }).click();
  await expect(page.locator('.fin-reparto')).toHaveCount(0);
  expect((await fin.DB.prepare('SELECT COUNT(*) AS n FROM fin_repartos').first())?.n).toBe(0);

  await page.getByRole('button', { name: 'Conceptos', exact: true }).click();
  const ingresos = page.getByRole('region', { name: 'Conceptos de ingreso' });
  await ingresos.getByRole('button', { name: 'Bajar Cuota mensual de cliente' }).click();
  await expect(ingresos.locator('input').first()).toHaveValue('Alta / implantación');
  await ingresos.getByRole('button', { name: 'Subir Cuota mensual de cliente' }).click();
  await expect(ingresos.locator('input').first()).toHaveValue('Cuota mensual de cliente');
  const concepto = ingresos.locator('.fin-concepto').filter({ has: page.getByLabel('Nombre de Cuota mensual de cliente', { exact: true }) });
  await concepto.getByRole('button', { name: 'Borrar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar concepto', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Este concepto tiene movimientos');
  await page.getByRole('dialog').getByRole('button', { name: 'Desactivar', exact: true }).click();
  await expect(concepto).toContainText('Inactivo');

  await page.getByRole('button', { name: 'Movimientos', exact: true }).click();
  await page.getByRole('button', { name: 'Cuota mensual de cliente', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Detalle del movimiento' });
  await expect(dialog.getByLabel('Concepto')).toContainText('(inactivo)');
  await dialog.getByRole('textbox', { name: 'Nota', exact: true }).fill('Corregido con concepto desactivado');
  await dialog.getByRole('button', { name: 'Guardar movimiento' }).click();
  await expect(eur.locator('.fin-caja')).toContainText('€ 1.200,00');
  await page.getByRole('button', { name: 'Cuota mensual de cliente', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar movimiento', exact: true }).click();
  await page.getByRole('dialog', { name: '¿Borrar este movimiento?' }).getByRole('button', { name: 'Borrar movimiento' }).click();
  await expect(eur.locator('.fin-caja')).toContainText('€ 0,00');
  expect(errors).toEqual([]);
});

test('móvil, tema oscuro y acceso cerrado a un administrador no socio', async ({ page, fin }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/finanzas');
  await expect(page.getByRole('region', { name: 'Resumen EUR' }).locator('.fin-caja')).toContainText('€ 0,00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('finanzas-mobile.png'), fullPage: true });
  const sideColor = await page.locator('.side').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.getByRole('button', { name: 'Tema oscuro' }).click();
  await expect(page.locator('body')).toHaveClass(/dark/);
  expect(await page.locator('.side').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(sideColor);
  await page.screenshot({ path: test.info().outputPath('finanzas-dark.png'), fullPage: true });
  fin.scope.email = 'colaborador@velai.test';
  const calls: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/admin/finanzas/')) calls.push(r.url()); });
  await page.reload();
  await expect(page).toHaveURL('https://panel.test/');
  await expect(page.getByRole('tab', { name: 'Finanzas' })).toHaveCount(0);
  expect(calls).toEqual([]);
});

test('tablet: permite corregir el tipo desde Detalle del movimiento', async ({ page, fin }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/finanzas');
  await page.getByRole('button', { name: 'Registrar movimiento' }).click();
  let dialog = page.getByRole('dialog', { name: 'Registrar movimiento' });
  await dialog.getByLabel('Importe (EUR)').fill('25');
  await dialog.getByRole('button', { name: 'Guardar movimiento' }).click();
  await page.getByRole('button', { name: 'Cuota mensual de cliente', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Detalle del movimiento' });
  await expect(dialog.getByRole('button', { name: 'Gasto', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Gasto', exact: true }).click();
  await expect(dialog.getByLabel('Concepto')).toContainText('Anthropic (IA)');
  await dialog.getByRole('button', { name: 'Guardar movimiento' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await fin.DB.prepare('SELECT tipo FROM fin_movimientos').first())?.tipo).toBe('gasto');
  await expect(page.getByRole('region', { name: 'Resumen EUR' })).toContainText('−€ 25,00');
});

test('tablet: avisa y limpia los datos sin guardar al cambiar de tipo o cerrar', async ({ page, fin }) => {
  void fin;
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/finanzas');
  await page.getByRole('button', { name: 'Registrar movimiento' }).click();
  let dialog = page.getByRole('dialog', { name: 'Registrar movimiento' });
  await dialog.getByLabel('Importe (EUR)').fill('87,50');
  await dialog.getByRole('textbox', { name: 'Nota', exact: true }).fill('Dato todavía sin guardar');
  await dialog.getByRole('button', { name: 'Gasto', exact: true }).click();
  let confirm = page.getByRole('dialog', { name: '¿Cambiar el tipo de movimiento?' });
  await expect(confirm).toContainText('si continúas, se borrarán');
  await confirm.getByRole('button', { name: 'Seguir editando' }).click();
  await expect(dialog.getByLabel('Importe (EUR)')).toHaveValue('87,50');
  await dialog.getByRole('button', { name: 'Gasto', exact: true }).click();
  confirm = page.getByRole('dialog', { name: '¿Cambiar el tipo de movimiento?' });
  await confirm.getByRole('button', { name: 'Descartar y cambiar' }).click();
  await expect(dialog.getByRole('button', { name: 'Gasto', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByLabel('Importe (EUR)')).toHaveValue('');
  await expect(dialog.getByRole('textbox', { name: 'Nota', exact: true })).toHaveValue('');
  await dialog.getByLabel('Importe (EUR)').fill('12');
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  confirm = page.getByRole('dialog', { name: '¿Cerrar sin guardar?' });
  await confirm.getByRole('button', { name: 'Descartar y cerrar' }).click();
  await expect(dialog).toHaveCount(0);
});

test('Socios: alta, edición, reparto, baja conservando histórico y reactivación', async ({ page, fin }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/finanzas?tab=socios');
  await expect(page.getByRole('heading', { name: 'Socios del equipo' })).toBeVisible();
  await page.getByRole('button', { name: 'Añadir socio' }).click();
  let dialog = page.getByRole('dialog', { name: 'Añadir socio' });
  await dialog.getByLabel('Nombre', { exact: true }).fill('Eva');
  await dialog.getByLabel('Correo electrónico').fill('eva+fin@velai.test');
  await dialog.getByRole('button', { name: 'Guardar socio' }).click();
  let card = page.getByRole('article', { name: 'Socio Eva', exact: true });
  await expect(card).toContainText('eva+fin@velai.test');
  await card.getByRole('button', { name: 'Editar' }).click();
  dialog = page.getByRole('dialog', { name: 'Editar socio' });
  await dialog.getByLabel('Nombre', { exact: true }).fill('Eva García');
  await dialog.getByLabel('Correo electrónico').fill('eva@velai.test');
  await dialog.getByRole('button', { name: 'Guardar socio' }).click();
  card = page.getByRole('article', { name: 'Socio Eva García', exact: true });
  await expect(card).toContainText('eva@velai.test');
  await page.getByRole('button', { name: 'Repartos', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo reparto' }).click();
  dialog = page.getByRole('dialog', { name: 'Nuevo reparto' });
  const line = dialog.locator('.fin-line').filter({ has: page.locator('select', { has: page.locator('option:checked', { hasText: /^Eva García$/ }) }) });
  await line.getByRole('textbox').fill('12,34');
  await dialog.getByRole('button', { name: 'Guardar reparto' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await fin.DB.prepare('SELECT importe FROM fin_movimientos WHERE beneficiario=?').bind('eva@velai.test').first())?.importe).toBe(1234);

  await page.getByRole('button', { name: 'Socios', exact: true }).click();
  await card.getByRole('button', { name: 'Editar' }).click();
  dialog = page.getByRole('dialog', { name: 'Editar socio' });
  await dialog.getByLabel('Correo electrónico').fill('eva.nuevo@velai.test');
  await dialog.getByRole('button', { name: 'Guardar socio' }).click();
  await expect(card).toContainText('eva.nuevo@velai.test');
  expect((await fin.DB.prepare('SELECT beneficiario FROM fin_movimientos').first())?.beneficiario).toBe('eva.nuevo@velai.test');
  await card.getByRole('button', { name: 'Quitar', exact: true }).click();
  await page.getByRole('dialog', { name: '¿Quitar a Eva García?' }).getByRole('button', { name: 'Quitar socio' }).click();
  await expect(card).toContainText('Inactivo');
  await expect(card.getByRole('button', { name: 'Reactivar' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('socios-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Repartos', exact: true }).click();
  await expect(page.locator('.fin-reparto')).toContainText('Eva García');
  await expect(page.locator('.fin-reparto')).toContainText('€ 12,34');
  await page.getByRole('button', { name: 'Nuevo reparto' }).click();
  dialog = page.getByRole('dialog', { name: 'Nuevo reparto' });
  await expect(dialog.getByRole('option', { name: 'Eva García', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Socios', exact: true }).click();
  await card.getByRole('button', { name: 'Reactivar' }).click();
  await expect(card.getByRole('button', { name: 'Quitar', exact: true })).toBeVisible();

  // Una persona sin pagos se quita completamente y desaparece del selector.
  const luis = page.getByRole('article', { name: 'Socio Luis', exact: true });
  await luis.getByRole('button', { name: 'Quitar', exact: true }).click();
  await page.getByRole('dialog', { name: '¿Quitar a Luis?' }).getByRole('button', { name: 'Quitar socio' }).click();
  await expect(luis).toHaveCount(0);
  await page.reload();
  await expect(card).toContainText('eva.nuevo@velai.test');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('socios-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});
