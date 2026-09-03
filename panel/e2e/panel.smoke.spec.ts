import { expect, test } from '@playwright/test';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const tenantId = '11111111-1111-4111-8111-111111111111';
const allowedBlockedExternal = new Set([
  'https://hirevai.com/fonts/cabinet-grotesk-900.woff2?v=2',
  'https://hirevai.com/fonts/satoshi-400.woff2?v=2',
  'https://hirevai.com/fonts/satoshi-500.woff2?v=2',
]);

const routes: Record<string, unknown> = {
  '/api/admin/me': {
    role: 'cliente', tenantName: 'Velai', tenantLogo: null, tenantId,
  },
  '/api/admin/stats': {
    total30: 9,
    sinContactar: 1,
    sinContactarDesde: '2026-08-30T10:00:00.000Z',
    fallidos7: 0,
    tenantsActivos: null,
    porDia: [{ d: '2026-09-01', n: 2, canales: [{ canal: 'formulario web', n: 2 }] }],
    porCanal: [{ canal: 'formulario web', n: 6 }, { canal: 'chat web', n: 3 }],
    fuentes: ['formulario web', 'chat web'],
    captura: {
      conversaciones: 5,
      leads: 3,
      porCanal: [
        { canal: 'messenger', convs: 2, leads: 1 },
        { canal: 'web', convs: 3, leads: 2 },
      ],
      desde: '2026-08-26',
      periodoCompleto: false,
    },
  },
  '/api/admin/ai-balance': {
    month: '2026-09', included: 500000, used: 12000, remaining: 488000,
    pct: 2, over: false, usedToday: 800, calls: 4, serie: [],
  },
  [`/api/admin/tenants/${tenantId}/channels`]: {
    channels: [
      { kind: 'web', address: 'hirevai.com', state: 'on' },
      { kind: 'messenger', address: 'messenger:1077804955422697', state: 'on', managed_by: 'Velai (Messenger)' },
    ],
  },
  [`/api/admin/tenants/${tenantId}/telegram`]: {
    telegram: {
      linked: false, title: null, linked_at: null, botUsername: null,
      whitelabel: false, topics: [], weeklyReport: true, lastReport: null,
    },
  },
  [`/api/admin/tenants/${tenantId}/whatsapp`]: {
    whatsapp: {
      channel_address: 'web:velai', twilio_from: null, has_waba: 0,
      sender_status: null, lead_template_status: null, meta_partner_status: null,
      team_whatsapp: null, wa_number: null, logo_url: null, logo_wa_url: null,
      has_token: 0, has_subaccount: 0, routed: 0,
    },
    alerts: { telegram: 'off', whatsapp: 'off', any: false },
    profileSync: null,
  },
  '/api/admin/availability': {
    available: false, withinHours: true, offering: false, advisors: 0,
    hours: { mon: [['09:00', '18:00']] }, tz: 'Europe/Madrid', graceMin: 5, forTenant: 'Velai',
  },
};

test('el panel v2 arranca con API simulada y recorre Dashboard → Conexiones sin mutaciones', async ({ page }) => {
  const methods: string[] = [];
  const missing: string[] = [];
  const blockedExternal: string[] = [];

  // Cinturón de seguridad: cualquier petición que no cubran los mocks posteriores
  // se bloquea en el propio navegador. El smoke nunca tiene una vía hacia Internet.
  await page.route('**/*', async (route) => {
    blockedExternal.push(route.request().url());
    return route.fulfill({ status: 418, body: '' });
  });

  // Sirve el build sin HTTP. BrowserRouter recibe el mismo index.html para rutas de
  // aplicación; assets conserva su path y el favicon ausente responde 404 inocuo.
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

  // Registrada después: Playwright evalúa primero la ruta más reciente, así la API
  // nunca cae al servidor estático ni escapa al host ficticio.
  await page.route('**/api/admin/**', async (route) => {
    const request = route.request();
    methods.push(request.method());
    const path = new URL(request.url()).pathname;
    if (!(path in routes)) {
      missing.push(path);
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(routes[path]) });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('3 de 5 conversaciones')).toBeVisible();
  await expect(page.getByText('1/2 · 50%')).toBeVisible();
  await expect(page.getByText(/los formularios se muestran en «Leads por canal»/)).toBeVisible();

  await page.getByRole('tab', { name: 'Conexiones' }).click();
  await expect(page.getByRole('heading', { name: 'Conexiones' })).toBeVisible();
  await expect(page.getByText('1077804955422697')).toBeVisible();
  await expect(page.getByText('Gestionado como Velai (Messenger)')).toBeVisible();

  expect(missing).toEqual([]);
  // Las fuentes de marca son externas por diseño, pero también se bloquean. El
  // invariante seguro es que no aparezca ningún destino fuera de esa lista conocida.
  expect(blockedExternal.filter((url) => !allowedBlockedExternal.has(url))).toEqual([]);
  expect([...new Set(methods)]).toEqual(['GET']);
});
