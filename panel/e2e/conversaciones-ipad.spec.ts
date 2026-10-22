import { expect, test, type Page } from '@playwright/test';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bandeja de Conversaciones en iPad (bug de Juanes, 2026-10-22): en Safari no había
// scroll en la lista ni en el hilo, y el cajón con «Responder como humano» quedaba fuera
// de la pantalla. Solo hay Chromium instalado, así que esto no reproduce el 100vh de
// WebKit; lo que sí fija es el contrato del layout: con el viewport que sea (incluido uno
// recortado como el de Safari con sus barras), lista e hilo scrollean POR DENTRO y el
// botón queda dentro de lo visible, por encima del pie fijo de 30 px.

const tenantId = '11111111-1111-4111-8111-111111111111';
const convId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOOT = 30;

const rows = Array.from({ length: 40 }, (_, i) => ({
  id: i === 0 ? convId : `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, '0')}`,
  channel: i % 2 ? 'whatsapp' : 'web',
  external_id: `whatsapp:+3460000${String(i).padStart(4, '0')}`,
  msgs: 60, unanswered: 0, last_at: '2026-10-20T10:00:00.000Z', lead_id: null, unread: 0,
  state: 'bot', state_at: null, agent_email: null, lead_name: `Cliente ${i + 1}`, lead_status: null,
  preview: 'Hola, quería información sobre el servicio', preview_role: 'user',
}));

const messages = Array.from({ length: 60 }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user',
  agent_email: null,
  text: `Mensaje ${i + 1}: ${'texto de relleno para que la burbuja ocupe varias líneas '.repeat(2)}`,
  created_at: new Date(Date.UTC(2026, 9, 20, 9, i)).toISOString(),
}));

const thread = {
  conversation: {
    id: convId, channel: 'whatsapp', external_id: 'whatsapp:+34600000000', msgs: 60, unanswered: 0,
    started_at: '2026-10-20T09:00:00.000Z', last_at: '2026-10-20T10:00:00.000Z', state: 'bot', state_at: null,
    agent_email: null, lead_id: null, expires_at: '2027-01-18T10:00:00.000Z',
  },
  messages,
  // Cajón cerrado porque atiende la IA, pero el cliente PUEDE tomarla (worker/routes/conversaciones.js:141-145).
  window: { open: false, reason: 'bot', canTakeover: true, takeoverReason: null },
};

const api: Record<string, unknown> = {
  '/api/admin/me': { role: 'cliente', plan: 'profesional', modulos: [], tenantName: 'Velai', tenantLogo: null, tenantId },
  '/api/admin/availability': {
    available: true, withinHours: true, offering: true, advisors: 1,
    hours: { mon: [['09:00', '18:00']] }, tz: 'Europe/Madrid', graceMin: 5, forTenant: 'Velai',
  },
};

async function serve(page: Page) {
  // Nada sale a la red: lo que no cubren las rutas de abajo se contesta 418 aquí mismo.
  await page.route('**/*', (route) => route.fulfill({ status: 418, body: '' }));
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const types: Record<string, string> = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  };
  await page.route('https://panel.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const relative = pathname === '/' || !extname(pathname) ? 'index.html' : pathname.replace(/^\/+/, '');
    const path = normalize(join(dist, relative));
    if (!path.startsWith(`${dist}/`)) return route.fulfill({ status: 404, body: '' });
    try {
      return await route.fulfill({ status: 200, path, contentType: types[extname(path)] ?? 'application/octet-stream' });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });
  await page.route('**/api/admin/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/inbox') {
      const open = url.searchParams.get('conversation') === convId;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          conversations: rows,
          counts: [{ channel: 'whatsapp', n: 20, unread: 0, waiting: 0 }, { channel: 'web', n: 20, unread: 0, waiting: 0 }],
          thread: open ? thread : null, queueMin: 15, pingMin: 5,
        }),
      });
    }
    const body = api[url.pathname];
    return route.fulfill({
      status: body ? 200 : 404, contentType: 'application/json',
      body: JSON.stringify(body ?? { error: 'not_found' }),
    });
  });
}

/** El panel scrollea por dentro: hay más contenido que caja y moverlo cambia scrollTop. */
async function expectScrolls(page: Page, selector: string, delta: number) {
  const el = page.locator(selector);
  await expect(el).toBeVisible();
  const before = await el.evaluate((n) => ({ sh: n.scrollHeight, ch: n.clientHeight, top: n.scrollTop }));
  expect(before.sh, `${selector} debe tener más contenido que caja`).toBeGreaterThan(before.ch);
  await el.evaluate((n, d) => n.scrollBy(0, d), delta);
  await expect.poll(() => el.evaluate((n) => n.scrollTop)).not.toBe(before.top);
}

/** El botón está DENTRO de lo visible y por encima del pie fijo. */
async function expectTakeoverVisible(page: Page) {
  const btn = page.getByRole('button', { name: 'Responder como humano' });
  await expect(btn).toBeVisible();
  await expect(btn).toBeEnabled();
  const box = await btn.boundingBox();
  const vp = page.viewportSize();
  expect(box).not.toBeNull();
  expect(vp).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp!.height - FOOT);
  // Nada por encima del botón en su centro (ni el pie ni otra capa).
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent?.trim() ?? null,
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
  expect(hit).toBe('Responder como humano');
}

/** Sin zoom de Safari al enfocar: con puntero grueso los campos de la bandeja van a 16 px. */
async function expectNoZoomFields(page: Page, selectors: string[]) {
  // hasTouch hace que Chromium emule el puntero táctil (Emulation.setTouchEmulationEnabled),
  // así que (pointer:coarse) casa como en un iPad. Si un día dejara de hacerlo, este assert
  // lo dice claro en vez de dejar pasar el de 16 px por casualidad.
  expect(await page.evaluate(() => matchMedia('(pointer:coarse)').matches)).toBe(true);
  for (const sel of selectors) {
    await expect(page.locator(sel).first()).toHaveCSS('font-size', '16px');
  }
}

const viewports = [
  { name: 'iPad vertical 820×1180', width: 820, height: 1180 },
  { name: 'iPad horizontal 1180×820', width: 1180, height: 820 },
  // Lo visible de Safari con sus barras arriba y abajo: la caja tiene que caber AQUÍ.
  { name: 'iPad vertical con barras del navegador 820×1050', width: 820, height: 1050 },
];

test.describe('escritorio con ratón 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });

  test('el anti-zoom táctil no cambia los tamaños del escritorio', async ({ page }) => {
    await serve(page);
    await page.goto(`/conversaciones?conversation=${convId}`);
    await expectTakeoverVisible(page);
    expect(await page.evaluate(() => matchMedia('(pointer:coarse)').matches)).toBe(false);
    await expect(page.locator('.lsearch>input')).toHaveCSS('font-size', '13px');
    await expect(page.locator('.cvfield textarea')).toHaveCSS('font-size', '13px');
  });
});

for (const vp of viewports) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true });

    test('cliente: la lista y el hilo scrollean y «Responder como humano» se ve', async ({ page }) => {
      await serve(page);
      const twoCols = vp.width > 900;

      // Lista (en vertical se ve sola; en horizontal, junto al hilo).
      await page.goto('/conversaciones');
      await expect(page.getByRole('heading', { name: 'Conversaciones' })).toBeVisible();
      await expect(page.locator('.cvrow')).toHaveCount(40);
      await expectScrolls(page, '.inbox-list', 400);
      await expectNoZoomFields(page, ['.lsearch>input']);

      // Hilo: abre al final, así que se scrollea hacia arriba.
      await page.goto(`/conversaciones?conversation=${convId}`);
      await expect(page.getByText('Mensaje 60:', { exact: false })).toBeVisible();
      if (twoCols) await expect(page.locator('.inbox-list')).toBeVisible();
      else await expect(page.locator('.inbox-list')).toBeHidden();
      await expectTakeoverVisible(page);
      await expectScrolls(page, '.thread-log', -400);
      // Tras scrollear el hilo, el cajón sigue en su sitio.
      await expectTakeoverVisible(page);
      // El textarea del cajón (cerrado mientras atiende la IA) tampoco provoca zoom.
      await expectNoZoomFields(page, ['.cvfield textarea']);

      // La página en sí no scrollea: todo el scroll es interno.
      expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true);
      await page.screenshot({ path: test.info().outputPath('conversaciones-ipad.png') });
    });
  });
}
