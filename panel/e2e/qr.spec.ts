// QR de reservas con logo, de punta a punta en un navegador real: el panel compilado,
// el handler REAL del worker (subida a R2 simulado + /media) y un lector QR real (jsQR)
// sobre los ficheros DESCARGADOS — el PNG y el SVG — con el logo puesto.
import { test as base, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { bibliotecaFixture, MEDIA_TENANT } from '../../test/helpers/biblioteca-fixture.js';

const JSQR = createRequire(import.meta.url).resolve('jsqr/dist/jsQR.js');
const URL_RESERVAS = 'https://citas.hirevai.com/dialogos/reservas';
const estaticos: Record<string, unknown> = {
  '/api/admin/me': { role: 'cliente', plan: 'profesional', modulos: ['calendario', 'citas'], tenantName: 'Diálogos', tenantLogo: null, tenantId: MEDIA_TENANT },
  '/api/admin/appointments': { appointments: [] },
  [`/api/admin/tenants/${MEDIA_TENANT}/calendar`]: {
    calendar: { provider: 'google', account_email: 'cliente@example.com', calendar_id: 'primary', timezone: 'Europe/Madrid', slot_minutes: 30,
      business_hours: { mon: [['09:00', '18:00']] }, status: 'connected', last_error: null, connected_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-01T10:00:00.000Z' },
    confirmaciones: { enabled: false, hours: 24, template: { sid: null, status: null } },
  },
  [`/api/admin/tenants/${MEDIA_TENANT}/booking`]: { config: { booking_enabled: 1, min_notice_min: 120, max_days_ahead: 60, booking_note: '' }, exceptions: [], url: URL_RESERVAS },
  [`/api/admin/tenants/${MEDIA_TENANT}/services`]: { services: [{ id: '1', slug: 'presencial', name: 'Sesión presencial', description: '', minutes: 30, mode: 'presencial', location: '', buffer_min: 0, active: 1, position: 10 }] },
};

const test = base.extend<{ qr: Awaited<ReturnType<typeof bibliotecaFixture>> }>({
  qr: async ({ page }, use) => {
    const f = await bibliotecaFixture();
    Object.assign(f.scope, { modulos: ['calendario', 'citas'] });
    const previos = (globalThis as { caches?: unknown }).caches;
    (globalThis as { caches?: unknown }).caches = { default: { match: async () => undefined, put: async () => {} } };
    const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
    await page.route('**/*', async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== 'https://panel.test') return route.abort();
      if (url.pathname in estaticos) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(estaticos[url.pathname]) });
      if (url.pathname.startsWith('/api/admin/')) {
        const bytes = req.postDataBuffer();
        const response = await f.request(new Request(req.url(), { method: req.method(), headers: { ...req.headers(), ...(bytes ? { 'Content-Length': String(bytes.byteLength) } : {}) }, body: bytes ? Uint8Array.from(bytes).buffer : undefined }));
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      }
      // /media lo sirve el worker en el MISMO host del panel (ruta relativa).
      if (url.pathname.startsWith('/media/')) {
        const response = await f.worker.fetch(new Request(req.url()), f.env, f.ctx);
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      }
      const relative = url.pathname.startsWith('/assets/') ? url.pathname.slice(1) : 'index.html';
      return route.fulfill({ path: join(dist, relative), contentType: ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' } as Record<string, string>)[extname(relative)] });
    });
    try { await use(f); } finally { await f.close(); (globalThis as { caches?: unknown }).caches = previos; }
  },
});
test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });

/**
 * Rasteriza en el navegador una imagen (data URI) y la lee con jsQR DENTRO de la página
 * (pasar millones de píxeles a Node por evaluate es lentísimo).
 */
async function leerQr(page: Page, src: string, lado = 800): Promise<string | null> {
  if (!(await page.evaluate(() => 'jsQR' in window))) await page.addScriptTag({ content: await readFile(JSQR, 'utf8') });
  return page.evaluate(async ({ src, lado }) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = lado;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, lado, lado);
    const lector = (window as unknown as { jsQR: (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null }).jsQR;
    return lector(ctx.getImageData(0, 0, lado, lado).data, lado, lado)?.data ?? null;
  }, { src, lado });
}

test('cliente: sube su logo para el QR, lo ve centrado y los ficheros descargados escanean', async ({ page, qr }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/calendario');
  await page.getByRole('tab', { name: 'Reservas online' }).click();
  await page.getByRole('button', { name: 'QR', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Código QR de reservas' });
  await expect(dlg.getByRole('button', { name: 'Sin logo', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Un logo «difícil»: cuadrado de color lleno, sin transparencia, que tapa todo su recuadro.
  const logoPng = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 300;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ff6b1a'; ctx.fillRect(0, 0, 300, 300);
    ctx.fillStyle = '#1b1320'; ctx.beginPath(); ctx.arc(150, 150, 95, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 120px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('D', 150, 158);
    return c.toDataURL('image/png').split(',')[1]!;
  });
  await dlg.getByLabel('Subir logo para el QR').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(logoPng, 'base64') });
  await expect(dlg.getByRole('button', { name: 'Logo del QR', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dlg.getByRole('img', { name: 'Vista previa del código QR con el logo en el centro' })).toBeVisible();
  expect(qr.objects.get(`qr/${MEDIA_TENANT}`)?.contentType).toBe('image/png');
  await page.screenshot({ path: test.info().outputPath('qr-claro.png') });

  // La vista previa (el mismo SVG que se descarga) escanea con el logo puesto.
  const preview = await dlg.getByRole('img', { name: /con el logo/ }).getAttribute('src');
  expect(await leerQr(page, preview!)).toBe(URL_RESERVAS);

  // SVG descargado: autocontenido (logo en data URI, ninguna URL externa) y escanea.
  const [svgDl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Descargar SVG' }).click()]);
  expect(svgDl.suggestedFilename()).toBe('reservas-qr-logo.svg');
  const svg = await readFile((await svgDl.path())!, 'utf8');
  expect(svg).toMatch(/<image [^>]*href="data:image\/png;base64,/);
  expect(svg).not.toMatch(/href="https?:/);
  expect(await leerQr(page, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg))).toBe(URL_RESERVAS);

  // PNG descargado: escanea.
  const [pngDl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Descargar PNG' }).click()]);
  expect(pngDl.suggestedFilename()).toBe('reservas-qr-logo.png');
  const png = await readFile((await pngDl.path())!);
  expect(await leerQr(page, 'data:image/png;base64,' + png.toString('base64'), 1200)).toBe(URL_RESERVAS);

  // Oscuro y móvil: la vista previa sigue sobre blanco y sin scroll horizontal.
  await page.evaluate(() => document.body.classList.add('dark'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath('qr-oscuro.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await dlg.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('qr-movil-oscuro.png') });
  await page.evaluate(() => document.body.classList.remove('dark'));
  await page.waitForTimeout(300); // .btn anima el fondo 150 ms al cambiar de tema
  await page.screenshot({ path: test.info().outputPath('qr-movil-claro.png') });

  // Quitar: vuelve a «Sin logo» (este negocio no tiene logo en la ficha) y R2 queda vacío.
  await dlg.getByRole('button', { name: 'Quitar' }).click();
  await expect(dlg.getByRole('button', { name: 'Sin logo', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(qr.objects.size).toBe(0);
  expect(errors).toEqual([]);
});
