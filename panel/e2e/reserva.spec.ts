import { test as base, expect, type Page } from '@playwright/test';
import { bookingFixture, BOOKING_TEST_TENANT } from '../../test/helpers/booking-fixture.js';
import { readFile } from 'node:fs/promises';
const test = base.extend<{ booking: Awaited<ReturnType<typeof bookingFixture>> }>({
  booking: async ({ page }, use) => {
    const f = await bookingFixture();
    const original = globalThis.fetch; globalThis.fetch = f.fetchProvider;
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'challenges.cloudflare.com') return route.fulfill({ contentType: 'application/javascript', body: 'window.turnstile={render:function(selector,options){setTimeout(function(){options.callback("browser-"+crypto.randomUUID());},10);return "test";},remove:function(){}};' });
      if (url.origin !== f.origin) return route.abort();
      const request = route.request();
      const headers = { ...request.headers(), 'cf-connecting-ip': '198.51.100.1' };
      const response = await f.worker.fetch(new Request(request.url(), { method: request.method(), headers, body: request.postData() || undefined }), f.env, f.ctx);
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    try { await use(f); } finally { await f.close(); globalThis.fetch = original; }
  },
});
test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });
function futureDay() { return new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10); }
async function chooseTime(page: Page, hour = '10:00') {
  const day = futureDay();
  if (!(await page.getByRole('button', { name: day, exact: true }).count())) await page.getByRole('button', { name: 'Mes siguiente' }).click();
  await page.getByRole('button', { name: day, exact: true }).click();
  await page.getByRole('button', { name: hour, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirma tu cita' })).toBeVisible();
}

test('móvil: modalidades secuenciales, reserva real, .ics y cancelación por token', async ({ page, booking }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(booking.origin + '/dialogos/reservas');
  await expect(page.getByRole('heading', { name: '¿Cómo quieres tu cita?' })).toBeVisible();
  for (const label of ['Presencial', 'Vídeo', 'Teléfono']) await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Presencial', exact: true }).click();
  await expect(page.locator('.grid .available').first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('reserva-mobile-calendar.png'), fullPage: true });
  await chooseTime(page);
  await page.locator('#name').fill('Ana de prueba'); await page.locator('#phone').fill('+34612345678');
  await page.locator('#email').fill('ana@example.test'); await page.locator('#notes').fill('Sesión de prueba');
  await page.locator('#privacy').check(); await page.getByRole('button', { name: 'Reservar cita', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu cita está reservada' })).toBeVisible();
  expect(booking.events.size).toBe(1);
  const calendarLink = await page.getByRole('link', { name: 'Añadir a mi calendario' }).getAttribute('href');
  const ics = await booking.request(new URL(calendarLink!).pathname); expect(await ics.text()).toContain('BEGIN:VCALENDAR');
  await page.getByRole('link', { name: 'Gestionar mi cita' }).click();
  await expect(page).toHaveURL(/\/dialogos\/cita\/[a-f0-9]{32}$/);
  await page.screenshot({ path: test.info().outputPath('reserva-mobile-confirmation.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  page.once('dialog', (d) => void d.accept()); await page.getByRole('button', { name: 'Cancelar cita', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cita cancelada' })).toBeVisible();
  expect(booking.events.size).toBe(0); expect(errors).toEqual([]);
});

test('escritorio: servicio de 60 minutos sigue ofreciendo inicios cada 30 y reagenda', async ({ page, booking }) => {
  await page.goto(booking.origin + '/dialogos/reservas?s=video');
  await expect(page.locator('.grid .available').first()).toBeVisible();
  await chooseTime(page, '10:30');
  await page.locator('#name').fill('Ana'); await page.locator('#phone').fill('+34612345678'); await page.locator('#privacy').check();
  await page.getByRole('button', { name: 'Reservar cita', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu cita está reservada' })).toBeVisible();
  await page.getByRole('button', { name: 'Reagendar', exact: true }).click();
  await expect(page.locator('.grid .available').first()).toBeVisible();
  await chooseTime(page, '12:00');
  expect((await booking.DB.prepare("SELECT count(*) AS n FROM appointments WHERE status='confirmed' AND tenant_id=?").bind(BOOKING_TEST_TENANT).first())?.n).toBe(1);
  await page.locator('#privacy').check(); await page.getByRole('button', { name: 'Confirmar cambio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu cita está reservada' })).toBeVisible();
  expect(booking.events.size).toBe(1);
  const rows = (await booking.DB.prepare('SELECT status,rescheduled_from FROM appointments WHERE tenant_id=? ORDER BY starts_at').bind(BOOKING_TEST_TENANT).all()).results;
  expect(rows.map((r) => r.status)).toEqual(['cancelled', 'confirmed']); expect(rows[1]?.rescheduled_from).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath('reserva-desktop-confirmation.png'), fullPage: true });
});

test('loader: inline y popup usan la misma página; mensajes de otro origen no cambian altura', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/test') return route.fulfill({ contentType: 'text/html', body: '<div data-vai-citas="dialogos" data-servicio="video"></div><button data-vai-citas-popup="dialogos">Reservar</button>' });
    if (url.hostname === 'citas.hirevai.com') return route.fulfill({ contentType: 'text/html', body: '<h1>Reservas</h1>' });
    return route.abort();
  });
  await page.goto('https://dialogosqueensenan.com/test');
  await page.addScriptTag({ content: await readFile(new URL('../../site/assets/vai-citas.js', import.meta.url), 'utf8') });
  const frame = page.locator('[data-vai-citas] iframe');
  await expect(frame).toHaveAttribute('src', 'https://citas.hirevai.com/dialogos/reservas?embed=1&s=video');
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { origin: 'https://attacker.test', data: { type: 'vai-citas:resize', height: 2000 }, source: document.querySelector('iframe')!.contentWindow })));
  await expect(frame).toHaveCSS('height', '640px');
  await page.getByRole('button', { name: 'Reservar', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('dialog').locator('iframe')).toHaveAttribute('src', 'https://citas.hirevai.com/dialogos/reservas?embed=1');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Reservar', exact: true })).toBeFocused();
});

test.describe('visitante en otra zona horaria', () => {
  test.use({ timezoneId: 'America/Bogota' });

  test('muestra cada hora del negocio con su equivalencia local', async ({ page, booking }) => {
    await page.goto(booking.origin + '/dialogos/reservas');
    await page.getByRole('button', { name: 'Vídeo', exact: true }).click();
    await expect(page.getByText('Tu hora: America/Bogota')).toBeVisible();
    const day = futureDay();
    if (!(await page.getByRole('button', { name: day, exact: true }).count())) await page.getByRole('button', { name: 'Mes siguiente' }).click();
    await page.getByRole('button', { name: day, exact: true }).click();
    await expect(page.getByRole('button', { name: /^10:00 · \d{2}:\d{2} en tu zona$/ })).toBeVisible();
  });
});
