// Valida el panel admin CONTRA EL BUNDLE REAL de wrangler (incidente 2026-08-20:
// esbuild inyecta __name(...) dentro de panelApp y el helper no viaja con
// toString() — los tests sin bundlear no pueden verlo). Uso:
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
    if (prop === 'querySelector' || prop === 'closest' || prop === 'createElement') return () => element;
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
