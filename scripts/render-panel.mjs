// Renderiza el panel admin a PNG para VER un cambio de layout antes de desplegarlo.
// Existe porque el mismo bug de la bandeja (el cajón de escritura fuera de la caja por un
// min-height:auto) se desplegó DOS VECES: check-bundle solo caza excepciones de arranque,
// su DOM es un stub y no calcula layout. Razonar sobre flexbox no basta; hay que mirarlo.
//
//   npx wrangler@4 deploy --dry-run --outdir /tmp/dist
//   node scripts/render-panel.mjs /tmp/dist/vai-worker.js /tmp/panel.png [vista]
//
// Sin navegador instalado no falla: avisa y sale con 0 (es una herramienta, no un test).
import { readFile, writeFile, unlink, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

const [bundlePath, outPath = '/tmp/panel.png', view = 'conversaciones'] = process.argv.slice(2);
if (!bundlePath) { console.error('uso: node scripts/render-panel.mjs <bundle.js> [out.png] [vista]'); process.exit(2); }

// Los navegadores de Playwright son lo que suele haber a mano; CHROME_PATH lo pisa.
const candidatos = [process.env.CHROME_PATH,
  `${homedir()}/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell`,
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
let chrome = null;
for (const c of candidatos) { try { await access(c); chrome = c; break; } catch (_) {} }
if (!chrome) { console.log('render-panel: sin navegador (define CHROME_PATH). No se renderiza.'); process.exit(0); }

const source = await readFile(bundlePath, 'utf8');
const probe = bundlePath.replace(/\.js$/, '.render.mjs');
await writeFile(probe, source + '\nexport { ADMIN_HTML as H };\n');
let html;
try { ({ H: html } = await import(pathToFileURL(probe).href)); } finally { await unlink(probe).catch(() => {}); }

const CLOSE = '</scr' + 'ipt>';
html = html.replaceAll('__NONCE__', 'n');
// Sin scripts: aquí se mide el CSS, no se simula la API.
for (;;) { const a = html.indexOf('<script'); if (a < 0) break; html = html.slice(0, a) + html.slice(html.indexOf(CLOSE, a) + CLOSE.length); }

// Estado de la vista pedida, con contenido representativo (LARGO a propósito: los bugs de
// layout solo aparecen cuando el contenido desborda).
const VISTAS = {
  conversaciones: (h) => {
    const rows = Array.from({ length: 6 }, (_, i) => `<div class="cvrow${i ? '' : ' is-on'}"><span class="cvav">VI</span><span class="cvmain"><span class="cvtop"><span class="cvwho">Visitante de la web</span><span class="cvwhen">16:14</span></span><span class="cvprev">bot: un texto de vista previa deliberadamente largo para comprobar que se recorta con puntos suspensivos</span></span></div>`).join('');
    const bubs = Array.from({ length: 14 }, (_, i) => (i % 2
      ? '<div class="bub bot">Con ese tiempo en España puede haber opciones como el arraigo social u otras vías, pero los detalles importan mucho para no darte información que no aplique a tu caso.<time>16:14</time></div>'
      : '<div class="bub user">necesito regularizarme, llevo año y medio aquí<time>16:13</time></div>')).join('')
      + '<div class="bub agent"><span class="who">juan@velai.ai</span>Te confirmo la cita: mañana a las 10:00.<time>16:20</time></div>';
    return h
      .replace('<div class="thread-empty" id="threadEmpty">', '<div class="thread-empty" id="threadEmpty" hidden>')
      .replace('<div class="thread" id="thread" hidden>', '<div class="thread" id="thread">')
      .replace('<div class="chtabs" id="chTabs"></div>', '<div class="chtabs" id="chTabs"><button class="chtab is-on">Todos <b>6</b></button><button class="chtab">Web <b>4</b></button><button class="chtab">WhatsApp <b>2</b></button></div>')
      .replace('<div class="inbox-list" id="convRows"></div>', `<div class="inbox-list" id="convRows">${rows}</div>`)
      .replace('<div class="thread-h" id="threadHead"></div>', '<div class="thread-h" id="threadHead"><span class="cvav">VI</span><span><b>Visitante de la web</b><div class="muted">Web · Diálogos que Enseñan · <span class="mono">f8d09ce9</span></div></span><span class="grow"></span><span class="chip">se borra el 24/11/26</span></div>')
      .replace('<div class="chatlog thread-log" id="threadLog"></div>', `<div class="chatlog thread-log" id="threadLog">${bubs}</div>`)
      .replace('<div class="composer" id="composer"></div>', '<div class="composer" id="composer"><textarea rows="2" placeholder="Escribe tu respuesta…"></textarea><div class="crow"><button class="btn">Enviar</button><span class="cwin">Quedan <b>23 h</b> de la ventana de WhatsApp.</span></div></div>');
  },
  // Conexiones no necesita inyectar nada: la rejilla de horario es markup estático, y es
  // justo lo que hay que MIRAR (un cliente tiene que entenderla sin explicación).
  conexiones: (h) => h,
};
if (!VISTAS[view]) { console.error(`render-panel: vista desconocida «${view}». Disponibles: ${Object.keys(VISTAS).join(', ')}`); process.exit(2); }
html = html.replace('<div id="viewDashboard">', '<div id="viewDashboard" hidden>');
html = html.replace(`<div id="view${view[0].toUpperCase()}${view.slice(1)}" hidden>`, `<div id="view${view[0].toUpperCase()}${view.slice(1)}">`);
html = VISTAS[view](html);

const tmpHtml = outPath.replace(/\.png$/, '') + '.html';
await writeFile(tmpHtml, html);
await promisify(execFile)(chrome, ['--headless', '--no-sandbox', '--disable-gpu',
  '--window-size=1600,900', `--screenshot=${outPath}`, pathToFileURL(tmpHtml).href], { timeout: 60000 });
console.log(`render-panel: ${outPath} (vista «${view}») — ábrelo y MIRA el layout.`);
