import { expect, test, type Page } from '@playwright/test';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const tid = '11111111-1111-4111-8111-111111111111';
const velai = '22222222-2222-4222-8222-222222222222';
const fecha = '2026-10-12';
type Entry = { id: string; fecha: string; titulo: string; detalle: string; version: number };
async function setup(page: Page, mobile = false, dialogosClient = false) {
  await page.clock.install({ time: new Date('2026-10-12T12:00:00Z') });
  const state = { entries: [] as Entry[], conflict: false, calls: [] as { path: string; method: string; body: Record<string, unknown> | null }[] };
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== 'https://panel.test') return route.abort();
    if (!url.pathname.startsWith('/api/admin/')) {
      const relative = url.pathname.includes('/assets/') ? url.pathname.slice(1) : mobile ? 'prueba-movil/index.html' : 'index.html';
      return route.fulfill({ path: join(dist, relative), contentType: ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' } as Record<string, string>)[extname(relative)] });
    }
    const path = url.pathname.replace('/api/admin/mobile-preview/', '/api/admin/');
    const body = req.postDataJSON() as Record<string, unknown> | null;
    state.calls.push({ path: url.pathname, method: req.method(), body });
    const respond = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path.endsWith('/me')) return respond(dialogosClient
      ? { role: 'cliente', socio: false, tenantId: tid, tenantName: 'Diálogos · QA', tenantSlug: 'dialogos', editorialEditable: true, modulos: ['calendario'] }
      : { role: 'velai', socio: true, tenantId: null, modulos: [] });
    if (path.endsWith('/tenants')) return respond({ tenants: [{ id: tid, slug: 'dialogos', name: 'Diálogos · QA', active: 1 }, { id: velai, slug: 'velai', name: 'Velai · QA', active: 1 }] });
    if (path.endsWith('/calendar')) return respond({ calendar: null, confirmaciones: null });
    if (!path.includes('/editorial')) return respond({ error: 'not_found' }, 404);
    if (req.method() === 'GET') return respond({ entries: state.entries.filter(e => e.fecha >= (url.searchParams.get('from') ?? '') && e.fecha <= (url.searchParams.get('to') ?? '9999')), mas: false });
    if (req.method() === 'POST') {
      const entry = { id: '33333333-3333-4333-8333-333333333333', fecha: String(body?.fecha), titulo: String(body?.titulo), detalle: String(body?.detalle ?? ''), version: 1 };
      state.entries.push(entry); return respond({ entry }, 201);
    }
    if (req.method() === 'PATCH') {
      if (state.conflict) return respond({ error: 'version_conflicto' }, 409);
      const entry = state.entries[0]!;
      expect(body?.version).toBe(entry.version);
      Object.assign(entry, { fecha: body?.fecha, titulo: body?.titulo, detalle: body?.detalle, version: entry.version + 1 }); return respond({ entry });
    }
    expect(url.searchParams.get('version')).toBe(String(state.entries[0]!.version));
    state.entries = []; return respond({ ok: true });
  });
  return state;
}
test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });
test('Diálogos abre planificación; click fecha crea, edición versionada y borrado, sin Google', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/calendario?t=${tid}`);
  await expect(page.getByRole('button', { name: 'Planificación', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const day = page.getByRole('button', { name: fecha, exact: true });
  await day.click();
  let dialog = page.getByRole('dialog', { name: 'Añadir evento' });
  await expect(dialog.getByLabel('Qué grabaremos / episodio')).toBeFocused();
  await expect(dialog.getByLabel('Fecha')).toHaveValue(fecha);
  await dialog.getByLabel('Qué grabaremos / episodio').fill('Grabación episodio · migración');
  await dialog.getByLabel('Detalles').fill('Invitado y preguntas para la entrevista');
  await dialog.getByRole('button', { name: 'Guardar planificación' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Grabación episodio · migración' })).toBeVisible();
  const edit = page.getByRole('button', { name: 'Editar', exact: true });
  await edit.click();
  dialog = page.getByRole('dialog', { name: 'Editar planificación' });
  await dialog.getByLabel('Detalles').fill('Guion revisado');
  state.conflict = true;
  await dialog.getByRole('button', { name: 'Guardar planificación' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Este registro cambió');
  await expect(dialog.getByLabel('Detalles')).toHaveValue('Guion revisado');
  state.conflict = false;
  await dialog.getByRole('button', { name: 'Guardar planificación' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
  expect(state.entries[0]?.version).toBe(2);
  await page.screenshot({ path: test.info().outputPath('editorial-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Borrar', exact: true }).click();
  await page.getByRole('dialog', { name: '¿Borrar esta planificación?' }).getByRole('button', { name: 'Borrar', exact: true }).click();
  await expect(page.getByText('Sin planificación para este día.')).toBeVisible();
  await page.getByRole('button', { name: 'Mes siguiente' }).click();
  await expect(page.getByRole('heading', { name: 'noviembre de 2026' })).toBeVisible();
  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await expect(page.getByRole('heading', { name: 'octubre de 2026' })).toBeVisible();
  await page.getByRole('button', { name: fecha, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: fecha, exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Citas', exact: true }).click();
  await expect(page.getByText('Conectar Google Calendar', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Cliente del calendario' }).selectOption(velai);
  await expect(page.getByRole('button', { name: 'Citas', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('combobox', { name: 'Cliente del calendario' }).selectOption(tid);
  await expect(page.getByRole('button', { name: 'Planificación', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(state.calls.filter(c => c.method !== 'GET').every(c => c.path.includes('/editorial'))).toBe(true);
});
test('planificación móvil sin desbordamiento y diálogo con foco contenido', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto(`/calendario?t=${tid}`);
  await page.getByRole('button', { name: fecha, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Añadir evento' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Qué grabaremos / episodio').fill('Grabación Diálogos');
  await page.screenshot({ path: test.info().outputPath('editorial-mobile-dialog.png'), fullPage: true });
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Guardar planificación' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('editorial-mobile.png'), fullPage: true });
});
test('prueba instalada consulta planificación sin escrituras', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page, true);
  await page.goto(`/prueba-movil/calendario?t=${tid}`);
  await page.getByRole('button', { name: fecha, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Añadir planificación' })).toHaveCount(0);
  expect(state.calls.every(c => c.method === 'GET' && c.path.startsWith('/api/admin/mobile-preview/'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('cuenta propia de Diálogos abre otra fecha y guarda su planificación en móvil', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page, false, true);
  await page.goto('/calendario');
  await expect(page.getByRole('button', { name: 'Planificación', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '2026-10-15', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Añadir evento' });
  await expect(dialog.getByLabel('Fecha')).toHaveValue('2026-10-15');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: '2026-10-16', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Añadir evento' });
  await expect(dialog.getByLabel('Fecha')).toHaveValue('2026-10-16');
  await dialog.getByLabel('Qué grabaremos / episodio').fill('Ensayo de grabación');
  await dialog.getByLabel('Detalles').fill('Preparar preguntas y cámaras');
  await dialog.getByRole('button', { name: 'Guardar planificación' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Ensayo de grabación' })).toBeVisible();
  expect(state.entries[0]?.fecha).toBe('2026-10-16');
  expect(state.calls.filter(c => c.method === 'POST').map(c => c.path)).toEqual([`/api/admin/tenants/${tid}/editorial`]);
  expect(state.calls.some(c => c.path === '/api/admin/tenants')).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
