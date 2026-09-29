// Plantillas del CLIENTE con el texto editable (SPEC-NOTIFICACION-CITA), de punta a
// punta: el build real del panel contra el router admin real y D1 real (con la 0047),
// Twilio simulado. Lo que se comprueba es que panel y worker CASAN: la validación que
// ve el cliente es la del worker y lo que se envía a Twilio va con {{1}}..{{n}}.
import { test as base, expect } from '@playwright/test';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plantillasFixture, PLANTILLAS_TENANT } from '../../test/helpers/plantillas-fixture.js';

const test = base.extend<{ pl: Awaited<ReturnType<typeof plantillasFixture>> }>({
  pl: async ({ page }, use) => {
    const f = await plantillasFixture();
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
    const originalFetch = globalThis.fetch;
    globalThis.fetch = f.twilioFetch;
    try { await use(f); } finally { globalThis.fetch = originalFetch; await f.close(); }
  },
});

const card = (page: import('@playwright/test').Page, label: string) => page.locator('.plk').filter({ hasText: label });

test('el cliente personaliza la confirmación de cita: chips, validación del worker y envío a revisión', async ({ page, pl }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/plantillas');
  const conf = card(page, 'Cita agendada (confirmación)');
  await expect(conf.getByText('Aún no creada')).toBeVisible();
  // La vista previa pinta el defecto con el nombre REAL del negocio.
  await expect(conf.locator('.wapre-body')).toContainText('tu cita con Diálogos que Enseñan está reservada');
  // El recordatorio, ya aprobado, enseña SUS botones y también se puede editar.
  const rec = card(page, 'Recordatorio de cita');
  await expect(rec.locator('.wapre-btns')).toContainText('Sí, voy');
  await expect(rec.getByRole('button', { name: 'Editar el texto' })).toBeEnabled();

  await conf.getByRole('button', { name: 'Personalizar y crear' }).click();
  const area = conf.getByRole('textbox');
  await area.fill('Hola, tu cita es el {{fecha}} a las {{hora}}');
  // Los errores salen del WORKER (validar:true), con la variable concreta.
  await expect(conf.getByText('Falta {{enlace}} (enlace para gestionar la cita): es obligatoria.')).toBeVisible();
  await expect(conf.getByRole('button', { name: 'Crear y enviar a WhatsApp' })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('plantillas-error-claro.png'), fullPage: true });

  await area.fill('Hola {{nombre}}, tu cita en {{negocio}} es el {{fecha}} a las {{hora}}. Si necesitas cambiarla: ');
  await area.press('End');
  await conf.getByRole('button', { name: /^\{\{enlace\}\}/ }).click();
  await area.press('End');
  await area.pressSequentially(' ¡Hasta pronto!');
  await expect(conf.getByText('Cumple las reglas de WhatsApp ✓')).toBeVisible();
  await expect(conf.locator('.wapre-body')).toContainText('Hola María, tu cita en Diálogos que Enseñan es el jueves, 4 de septiembre a las 10:00. Si necesitas cambiarla: https://citas.hirevai.com/');
  await page.screenshot({ path: test.info().outputPath('plantillas-editor-claro.png'), fullPage: true });

  // Oscuro y móvil, con el editor abierto (lo que más ocupa).
  await page.evaluate(() => document.body.classList.add('dark'));
  await page.waitForTimeout(400); // las transiciones de color del tema
  await page.screenshot({ path: test.info().outputPath('plantillas-editor-oscuro.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath('plantillas-editor-movil-oscuro.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => document.body.classList.remove('dark'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath('plantillas-editor-movil-claro.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  await conf.getByRole('button', { name: 'Crear y enviar a WhatsApp' }).click();
  await page.locator('dialog.cfm').getByRole('button', { name: 'Enviar a revisión' }).click();
  await expect(page.getByText('Texto enviado a revisión de WhatsApp ✓')).toBeVisible();
  // Twilio recibió el cuerpo NUMERADO por orden de aparición; D1 guarda el de nombres.
  expect(pl.twilio.content).toHaveLength(1);
  expect(pl.twilio.content[0]!.types['twilio/text']!.body).toBe('Hola {{1}}, tu cita en {{2}} es el {{3}} a las {{4}}. Si necesitas cambiarla: {{5}} ¡Hasta pronto!');
  expect(pl.twilio.approvals[0]!.name).toMatch(/^confirmacion_reserva_dialogos_r\d{12}$/);
  const row = await pl.DB.prepare("SELECT status, texto FROM tenant_templates WHERE tenant_id=? AND kind='confirmacion_reserva'").bind(PLANTILLAS_TENANT).first();
  expect(row).toMatchObject({ status: 'pending', texto: 'Hola {{nombre}}, tu cita en {{negocio}} es el {{fecha}} a las {{hora}}. Si necesitas cambiarla: {{enlace}} ¡Hasta pronto!' });
  // Tras el envío: en revisión, sin poder editar hasta que WhatsApp resuelva.
  await expect(conf.getByText('En revisión por WhatsApp')).toBeVisible();
  await expect(conf.getByRole('button', { name: 'Editar el texto' })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('plantillas-en-revision.png'), fullPage: true });
  expect(errors).toEqual([]);
});
