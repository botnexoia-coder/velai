// Valida CONTRA EL BUNDLE REAL de wrangler las dos páginas que sirven una función
// serializada con toString(): el panel admin (incidente 2026-08-20) y la página de
// reservas (mismo fallo reproducido el 2026-09-15 y visto EN STAGING: página en blanco
// con «__name is not defined»). esbuild inyecta __name(...) dentro del cuerpo y el helper
// vive en la cabecera del bundle, así que no viaja con toString(). Uso:
//   npx wrangler@4 deploy --dry-run --outdir dist && node scripts/check-bundle.mjs dist/vai-worker.js
// Extrae el ADMIN_HTML que produce el bundle, saca el <script> del panel y lo
// ejecuta en un contexto vm con un DOM stub: si el arranque lanza (ReferenceError
// de un helper del bundler, typo, etc.), esto falla ANTES de desplegar.
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createContext, Script } from 'node:vm';
import { pathToFileURL } from 'node:url';

const bundlePath = process.argv[2];
if (!bundlePath) { console.error('uso: node scripts/check-bundle.mjs <bundle.js>'); process.exit(2); }

// El bundle no exporta ADMIN_HTML: se importa una copia con un export añadido.
// Si esbuild algún día renombra la constante, esto falla con mensaje claro (mejor
// rojo en CI que un panel muerto en producción).
const source = await readFile(bundlePath, 'utf8');
if (!source.includes('var ADMIN_HTML')) { console.error('check-bundle: no encuentro ADMIN_HTML en el bundle (¿renombrada?)'); process.exit(1); }
const probePath = bundlePath.replace(/\.js$/, '.probe.mjs');
await writeFile(probePath, source + '\nexport { ADMIN_HTML as __TEST_ADMIN_HTML };\n');
let html;
try {
  ({ __TEST_ADMIN_HTML: html } = await import(pathToFileURL(probePath).href));
} finally { await unlink(probePath).catch(() => {}); }

const OPEN = '<script nonce="__NONCE__">';
const CLOSE = '</scr' + 'ipt>';
const start = html.indexOf(OPEN);
const end = html.lastIndexOf(CLOSE);
if (start < 0 || end < 0) { console.error('check-bundle: marcadores del script del panel no encontrados'); process.exit(1); }
const scriptText = html.slice(start + OPEN.length, end);

// DOM stub mínimo (el mismo enfoque que el smoke de test/worker.test.js): no simula
// un navegador, caza excepciones de arranque.
const listNoop = () => [];
let element;
const handler = {
  get(_, prop) {
    if (prop === 'then' || prop === Symbol.toPrimitive) return undefined;
    if (prop === 'querySelectorAll') return listNoop;
    if (prop === 'children') return [];
    if (prop === 'querySelector' || prop === 'closest' || prop === 'createElement' || prop === 'getElementById') return () => element;
    if (prop === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
    if (prop === 'dataset' || prop === 'style') return new Proxy({}, { get: () => '', set: () => true });
    if (prop === 'value' || prop === 'textContent' || prop === 'innerHTML' || prop === 'id') return '';
    if (prop === 'checked' || prop === 'hidden' || prop === 'disabled') return false;
    if (prop === 'matches') return () => false;
    return () => undefined;
  },
  set: () => true,
};
element = new Proxy(function () {}, handler);
const fetched = [];
const rejections = [];
process.on('unhandledRejection', (reason) => rejections.push(reason));
const context = createContext({
  document: element,
  location: { href: '' },
  fetch: async (path) => { fetched.push(String(path)); return new Response('{"role":"velai","leads":[],"tenants":[],"escalations":[]}', { status: 200 }); },
  FormData: class { *[Symbol.iterator]() {} },
  URLSearchParams, Intl, Response,
  // window: el panel lo usa para scroll/resize (tooltip), el AudioContext del aviso y
  // focus(). Faltaba en el stub y solo se notaba si el uso estaba al ARRANQUE — un
  // window.loQueSea mal escrito dentro de un handler seguía colándose hasta el navegador.
  window: { addEventListener: () => {}, focus: () => {}, AudioContext: null, webkitAudioContext: null },
  setTimeout: () => 0, requestAnimationFrame: () => {}, confirm: () => false,
});
try {
  new Script(scriptText).runInContext(context);
} catch (error) {
  console.error(`check-bundle: el script del panel LANZA en el arranque: ${error.name}: ${error.message}`);
  process.exit(1);
}
for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
if (rejections.length) { console.error(`check-bundle: promesas rotas en el arranque: ${rejections.map((r) => r && r.message).join(' | ')}`); process.exit(1); }
if (!fetched.some((p) => p.startsWith('/api/admin/me'))) { console.error('check-bundle: el arranque no pidió /api/admin/me'); process.exit(1); }
console.log(`check-bundle OK: panel del bundle arranca (${fetched.length} llamadas de arranque)`);

// ── Página de reservas (SPEC-AUTOAGENDA) ─────────────────────────────────────
// Mismo método y mismo motivo que arriba: se saca el <script> INLINE que produce el
// bundle y se arranca en un vm con un DOM stub. Aquí el HTML no es una constante sino
// lo que devuelve reservaPage(), así que la sonda exporta la función y la llama.
if (!/(?:var|function) reservaPage\b/.test(source)) {
  console.error('check-bundle: no encuentro reservaPage en el bundle (¿renombrada?)');
  process.exit(1);
}
const reservaProbe = bundlePath.replace(/\.js$/, '.reserva.probe.mjs');
await writeFile(reservaProbe, source + '\nexport { reservaPage as __TEST_RESERVA_PAGE };\n');
let reservaHtml;
try {
  const { __TEST_RESERVA_PAGE: reservaPage } = await import(pathToFileURL(reservaProbe).href);
  const env = { BOOKING_ORIGIN: 'https://citas.hirevai.com', ADMIN_ORIGIN: 'https://admin.hirevai.com', TURNSTILE_SITEKEY: 'test' };
  const tenant = { slug: 'check', name: 'Check', web_origins: JSON.stringify(['https://check.test']) };
  const boot = { slug: 'check', name: 'Check', timezone: 'Europe/Madrid', min_notice_min: 120, max_days_ahead: 60,
    services: [{ id: 's1', slug: 'presencial', name: 'Servicio', minutes: 30, mode: 'presencial' }], sitekey: 'test' };
  reservaHtml = await reservaPage(env, tenant, boot).text();
} finally { await unlink(reservaProbe).catch(() => {}); }

// El <script> del nonce es el PRIMERO con cuerpo (el segundo es el de Turnstile, externo).
const inline = [...reservaHtml.matchAll(new RegExp('<script nonce="[^"]+">([\\s\\S]*?)<\\/scr' + 'ipt>', 'g'))]
  .map((m) => m[1]).filter(Boolean);
if (!inline.length) { console.error('check-bundle: no encuentro el script inline de la página de reservas'); process.exit(1); }
const reservaFetched = [];
const reservaContext = createContext({
  document: element,
  navigator: { language: 'es-ES' },
  location: { href: 'https://citas.hirevai.com/check/reservas', search: '' },
  fetch: async (path) => { reservaFetched.push(String(path)); return new Response('{"days":{},"timezone":"Europe/Madrid"}', { status: 200 }); },
  URLSearchParams, Intl, Response, Date, JSON,
  window: { addEventListener: () => {}, parent: {}, ResizeObserver: null, location: { search: '' } },
  setTimeout: () => 0, clearTimeout: () => {}, encodeURIComponent, Promise,
});
try {
  new Script(inline[inline.length - 1]).runInContext(reservaContext);
} catch (error) {
  console.error(`check-bundle: el script de la página de RESERVAS lanza en el arranque: ${error.name}: ${error.message}`);
  process.exit(1);
}
for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
if (rejections.length) { console.error(`check-bundle: promesas rotas en reservas: ${rejections.map((r) => r && r.message).join(' | ')}`); process.exit(1); }
console.log('check-bundle OK: la página de reservas del bundle arranca');
