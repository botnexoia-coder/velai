import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function mountWidget(page: Page, { width = 1200, lang = 'es', tenant = '', brand = {}, delay = 50 }:
  { width?: number; lang?: string; tenant?: string; brand?: Record<string, unknown>; delay?: number } = {}) {
  await page.setViewportSize({ width, height: 800 });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('/widget/boot')) return route.fulfill({ json: brand });
    if (url.endsWith('/vai-v1.jpg')) return route.fulfill({ contentType: 'image/jpeg', body: await readFile(new URL('../../site/assets/assistants/vai-v1.jpg', import.meta.url)) });
    if (url.endsWith('/widget-test')) return route.fulfill({ contentType: 'text/html', body: `<html lang="${lang}"><head><title>Widget</title></head><body></body></html>` });
    return route.abort();
  });
  await page.goto('https://panel.test/widget-test');
  await page.evaluate(({ tenant, delay }) => {
    Object.assign(window, { VELAI_TENANT: tenant, VELAI_CHAT: { teaserDelay: delay },
      widgetEvents: [], velaiTrack: (name: string) => (window as unknown as { widgetEvents: string[] }).widgetEvents.push(name) });
  }, { tenant, delay });
  await page.addScriptTag({ content: await readFile(new URL('../../site/assets/vai-widget.js', import.meta.url), 'utf8') });
  await expect(page.locator('#vaiBubble')).toBeVisible();
}

test('Vai por defecto: retrato, teaser y apertura/cierre accesibles', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mountWidget(page);
  await expect(page.locator('#vaiFace img')).toHaveAttribute('src', 'https://hirevai.com/assets/assistants/vai-v1.jpg');
  await expect(page.locator('#vaiLauncherTitle')).toHaveText('Hablar con Vai');
  await expect(page.locator('.vai-teaser-title')).toHaveText('¿Tu negocio necesita más tiempo?');
  await expect(page.locator('#vaiBubble')).toHaveCSS('border-top-color', 'rgb(255, 145, 79)');
  await page.screenshot({ path: test.info().outputPath('launcher-desktop.png') });
  await page.locator('.vai-teaser-cta').click();
  await expect(page.locator('#vaiBubble')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#vaiLauncherTitle')).toHaveText('Cerrar conversación');
  await expect(page.locator('#vaiFace')).toBeHidden();
  await expect(page.locator('#vaiWindow')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#vaiBubble')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => (window as unknown as { widgetEvents: string[] }).widgetEvents))
    .toEqual(['chat_view', 'chat_teaser_shown', 'chat_open']);
  expect(errors).toEqual([]);
});

test('tenant dialogos EN: inicial, marca y cascada de textos sin HTML inyectado', async ({ page }) => {
  await mountWidget(page, { lang: 'en', tenant: 'dialogos', brand: { bot_name: 'Luna', brand_color: '#123456',
    brand_color_2: '#234567', accent_color: '#abcdef', teaser_title: 'Título ES', teaser_title_en: 'Hello <img>', teaser_copy: 'Texto ES' } });
  await expect(page.locator('#vaiLauncherTitle')).toHaveText('Talk to Luna');
  await expect(page.locator('#vaiFace')).toHaveText('L');
  await expect(page.locator('#vaiFace img')).toHaveCount(0);
  await expect(page.locator('.vai-teaser-title')).toHaveText('Hello <img>');
  await expect(page.locator('.vai-teaser-copy')).toHaveText('Texto ES');
  await expect(page.locator('#vaiTeaser img')).toHaveCount(0);
  await expect(page.locator('#vaiBubble')).toHaveCSS('border-top-color', 'rgb(171, 205, 239)');
});

test('móvil: no crea teaser ni impresión; banner se eleva y se retira sin oscilar', async ({ page }) => {
  await mountWidget(page, { width: 390 });
  await page.evaluate(() => {
    const banner = document.createElement('div');
    banner.id = 'velai-consent';
    banner.style.cssText = 'position:fixed;bottom:0;left:0;width:100%;height:180px;background:white';
    document.body.appendChild(banner);
  });
  await expect(page.locator('#vaiWidget')).toHaveCSS('bottom', '192px');
  await page.waitForTimeout(150);
  await expect(page.locator('#vaiTeaser')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { widgetEvents: string[] }).widgetEvents)).toEqual(['chat_view']);
  await page.locator('#vaiBubble').click();
  await expect(page.locator('#vaiWindow')).toHaveCSS('bottom', '264px');
  await page.evaluate(() => { document.getElementById('velai-consent')!.hidden = true; });
  await expect(page.locator('#vaiWidget')).toHaveCSS('bottom', '24px');
  await expect(page.locator('#vaiWindow')).toHaveCSS('bottom', '96px');
});

test('banners externos: solo cuentan si están visibles y solapan horizontalmente', async ({ page }) => {
  await mountWidget(page, { delay: 60000 });
  await page.evaluate(() => {
    for (const [id, style] of [['cookieBanner', 'right:0;width:400px;height:140px'], ['ckb', 'left:0;width:100px;height:240px']]) {
      const banner = document.createElement('div'); banner.id = id!;
      banner.style.cssText = 'position:fixed;bottom:0;background:white;' + style;
      document.body.appendChild(banner);
    }
  });
  await expect(page.locator('#vaiWidget')).toHaveCSS('bottom', '152px');
  await page.evaluate(() => { document.getElementById('cookieBanner')!.style.display = 'none'; });
  await expect(page.locator('#vaiWidget')).toHaveCSS('bottom', '24px');
  await page.evaluate(() => { document.getElementById('ckb')!.style.width = '100%'; });
  await expect(page.locator('#vaiWidget')).toHaveCSS('bottom', '252px');
  await page.evaluate(() => { document.getElementById('ckb')!.remove(); });
  await expect(page.locator('#vaiWidget')).toHaveCSS('bottom', '24px');
});

test('ventana v16: geometría, bienvenida, saludo único e hilo desde abajo', async ({ page }) => {
  await mountWidget(page, { delay: 60000 });
  await page.evaluate(() => Object.assign(window, { VELAI_HUMAN: { execute: async () => 'human-test' } }));
  const payloads: Record<string, unknown>[] = [];
  await page.route('**/chat', async (route) => {
    payloads.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ json: { reply: 'Te ayudo con eso.', state: 'bot' } });
  });
  await page.locator('#vaiBubble').click();
  const win = page.locator('#vaiWindow');
  await expect(win).toHaveCSS('top', '16px');
  await expect(win).toHaveCSS('bottom', '16px');
  expect((await win.boundingBox())?.height).toBe(768);
  await expect(page.locator('#vaiBubble')).toBeHidden();
  await expect(page.locator('.vai-hero')).toBeVisible();
  await expect(page.locator('#vaiHeroAvatar img')).toHaveAttribute('src', 'https://hirevai.com/assets/assistants/vai-v1.jpg');
  await expect(page.locator('#vaiGreeting')).toHaveText('Hola, soy Vai. ¿En qué puedo ayudarte?');
  await expect(page.locator('.vai-chip')).toHaveCount(3);
  await expect(page.locator('#vaiMessages .vai-row')).toHaveCount(0);
  await expect(page.locator('#vaiSend')).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('welcome-desktop.png') });
  await page.locator('#vaiInput').fill('Hola');
  await expect(page.locator('#vaiSend')).toBeEnabled();
  await page.locator('#vaiSend').click();
  await expect(page.locator('.vai-hero')).toBeHidden();
  await expect(page.locator('#vaiMessages .vai-row')).toHaveCount(3);
  await expect(page.locator('.vai-b-t').first()).toHaveText('Hola, soy Vai. ¿En qué puedo ayudarte?');
  await expect(page.locator('.vai-row.is-user .vai-b')).toHaveCSS('background-image', /linear-gradient/);
  const geometry = await page.locator('#vaiMessages').evaluate((el) => ({
    first: el.firstElementChild!.getBoundingClientRect().top, last: el.lastElementChild!.getBoundingClientRect().bottom,
    top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom,
  }));
  expect(geometry.first - geometry.top).toBeGreaterThan(100);
  expect(geometry.bottom - geometry.last).toBeCloseTo(20, 0);
  expect(JSON.stringify(payloads[0])).not.toContain('Hola, soy Vai');
  await page.locator('#vaiInput').fill('Segundo mensaje');
  await page.locator('#vaiSend').click();
  await expect(page.locator('#vaiMessages .vai-row')).toHaveCount(5);
  await expect(page.locator('.vai-b-t').filter({ hasText: 'Hola, soy Vai' })).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('conversation-desktop.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#vaiBubble')).toBeFocused();
  // Una recarga conserva el transcript y no vuelve a introducir el hero.
  await page.reload();
  await page.addScriptTag({ content: await readFile(new URL('../../site/assets/vai-widget.js', import.meta.url), 'utf8') });
  await expect(page.locator('#vaiWindow')).toBeHidden();
  await page.locator('#vaiBubble').click();
  await expect(page.locator('#vaiMessages .vai-row')).toHaveCount(5);
  await expect(page.locator('.vai-hero')).toBeHidden();
});

for (const theme of ['light', 'dark', 'auto']) {
  test(`tema ${theme}: selección de plataforma y preferencia del visitante`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await mountWidget(page, { tenant: 'cliente', brand: { theme }, delay: 60000 });
    await page.locator('#vaiBubble').click();
    const win = page.locator('#vaiWindow');
    if (theme === 'light') await expect(win).toHaveCSS('background-color', 'rgb(247, 244, 239)');
    else await expect(win).toHaveCSS('background-image', /linear-gradient/);
    await page.emulateMedia({ colorScheme: 'light' });
    if (theme === 'dark') await expect(win).toHaveCSS('background-image', /linear-gradient/);
    else await expect(win).toHaveCSS('background-color', 'rgb(247, 244, 239)');
  });
}

test('sheet en 390 y 700: botón visible; consentimiento también desplaza escritorio abierto', async ({ page }) => {
  await mountWidget(page, { width: 390, delay: 60000 });
  await page.locator('#vaiBubble').click();
  await expect(page.locator('#vaiBubble')).toBeVisible();
  await expect(page.locator('#vaiLauncherTitle')).toHaveText('Cerrar conversación');
  await expect(page.locator('#vaiWindow')).toHaveCSS('bottom', '96px');
  await expect(page.locator('#vaiWindow')).toHaveCSS('height', '692px');
  await page.screenshot({ path: test.info().outputPath('welcome-mobile.png') });
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.locator('#vaiBubble')).toBeVisible();
  await expect(page.locator('#vaiWindow')).toHaveCSS('width', '700px');
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator('#vaiBubble')).toBeHidden();
  await page.evaluate(() => {
    const banner = document.createElement('div'); banner.id = 'cookieBanner';
    banner.style.cssText = 'position:fixed;bottom:0;left:0;width:100%;height:140px';
    document.body.appendChild(banner);
  });
  await expect(page.locator('#vaiWindow')).toHaveCSS('bottom', '144px');
});

test('loader: resuelve desde su propio origen y evita duplicados', async ({ page }) => {
  const loader = await readFile(new URL('../../site/assets/vai.js', import.meta.url), 'utf8');
  const scripts: string[] = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('/assets/vai.js')) return route.fulfill({ contentType: 'text/javascript', body: loader });
    if (url.includes('vai-widget.js')) { scripts.push(url); return route.fulfill({ contentType: 'text/javascript', body: '' }); }
    return route.fulfill({ contentType: 'text/html', body: '<html><head></head><body></body></html>' });
  });
  await page.goto('https://cliente.test/');
  await page.addScriptTag({ url: 'https://preview.pages.dev/assets/vai.js' });
  await expect.poll(() => scripts.length).toBe(1);
  expect(scripts[0]).toBe('https://preview.pages.dev/assets/vai-widget.js?v=16');
  await page.addScriptTag({ url: 'https://preview.pages.dev/assets/vai.js' });
  expect(await page.locator('script[src*="vai-widget.js"]').count()).toBe(1);
  await page.goto('https://cliente.test/already-mounted');
  await page.evaluate(() => { const root = document.createElement('div'); root.id = 'vaiWidget'; document.body.appendChild(root); });
  await page.addScriptTag({ url: 'https://preview.pages.dev/assets/vai.js' });
  await expect(page.locator('script[src*="vai-widget.js"]')).toHaveCount(0);
});

test('el nombre de cada agente se pinta sin HTML y sobrevive al restaurar', async ({ page }) => {
  await mountWidget(page, { tenant: 'cliente', brand: { brand_name: 'Acme' }, delay: 60000 });
  await page.evaluate(() => Object.assign(window, { VELAI_HUMAN: { execute: async () => 'human-test' } }));
  await page.route('**/chat', (route) => route.fulfill({ json: { state: 'humano', lastId: 1 } }));
  await page.route('**/chat/poll?**', (route) => route.fulfill({ json: { state: 'humano', messages:
    new URL(route.request().url()).searchParams.get('after') === '1' ? [
      { id: 2, role: 'agent', text: 'Hola desde el equipo', at: '2026-09-14T12:00:00Z', agent_name: 'Ana <b>' },
      { id: 3, role: 'agent', text: 'Continúo yo', at: '2026-09-14T12:01:00Z', agent_name: 'Juan' },
    ] : [] } }));
  await page.locator('#vaiBubble').click();
  await page.locator('#vaiInput').fill('Quiero hablar con una persona');
  await page.locator('#vaiSend').click();
  // Reabrir solicita inmediatamente los mensajes nuevos sin esperar el intervalo.
  await expect(page.locator('#vaiLive')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#vaiBubble').click();
  await expect(page.locator('.vai-b-who')).toHaveText(['Ana <b> · Equipo Acme', 'Juan · Equipo Acme']);
  await expect(page.locator('.vai-b-who b')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.evaluate(() => Object.assign(window, { VELAI_TENANT: 'cliente' }));
  await page.addScriptTag({ content: await readFile(new URL('../../site/assets/vai-widget.js', import.meta.url), 'utf8') });
  await page.locator('#vaiBubble').click();
  await expect(page.locator('.vai-b-who')).toHaveText(['Ana <b> · Equipo Acme', 'Juan · Equipo Acme']);
});
