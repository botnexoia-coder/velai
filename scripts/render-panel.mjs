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
const ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const VISTAS = {
  conversaciones: (h) => {
    // Rediseño 2026-08-27: la vista ocupa el viewport (body.wide y los colores de avatar se
    // ponen a mano porque este render va SIN scripts: en el panel real los pone paint()
    // por CSSOM, ya que la CSP con nonce bloquea los style="" del markup).
    // (body.wide, que aquí se pone a mano
    // porque este render va SIN scripts), chips de canal con logo, filas de dos líneas con
    // cliente, y el cajón con sus tres estados. Es el markup que pinta admin-panel.js.
    const wa = `${ICO.replace('<svg', '<svg class="ch-wa"')}<path d="M12 3.2a8.8 8.8 0 0 0-7.5 13.4L3.2 20.8l4.4-1.3A8.8 8.8 0 1 0 12 3.2z"></path><path d="M9.3 9.1l1 1.8-.9.9a6.2 6.2 0 0 0 2.8 2.8l.9-.9 1.8 1"></path></svg>`;
    const web = `${ICO.replace('<svg', '<svg class="ch-web"')}<circle cx="12" cy="12" r="8.6"></circle><path d="M3.4 12h17.2"></path><path d="M12 3.4c3.2 3.7 3.2 13.5 0 17.2c-3.2-3.7-3.2-13.5 0-17.2"></path></svg>`;
    const ms = `${ICO.replace('<svg', '<svg class="ch-ms"')}<path d="M12 3.2c-4.85 0-8.8 3.63-8.8 8.13 0 2.55 1.28 4.82 3.28 6.32v3.15l3.02-1.65c.79.21 1.63.33 2.5.33 4.85 0 8.8-3.63 8.8-8.15S16.85 3.2 12 3.2z"></path><path d="M7.5 14.4l2.7-4.3 2.4 1.9 2.4-3.2"></path></svg>`;
    const send = `${ICO}<path d="M5 12h13"></path><path d="m12.5 5.5 6.5 6.5-6.5 6.5"></path></svg>`;
    const row = (i) => `<button type="button" class="cvrow${i === 1 ? ' is-on' : ''}${i === 0 ? ' is-wait' : ''}">`
      + `<span class="cvav" style="background:${i % 2 ? '#3987e5' : '#199e70'}">VI<span class="cvch">${i % 2 ? web : wa}</span></span>`
      + `<span class="cvmain"><span class="cvtop"><span class="cvwho">Visitante de la web</span>`
      + (i === 0 ? '<span class="cvwait">7&#8242; esperando</span>' : '<span class="cvwhen">16:14</span>')
      + `</span><span class="cvbot"><span class="cvprev"><i>Vai: </i>un texto de vista previa deliberadamente largo para comprobar que se recorta con puntos suspensivos</span>`
      + `<span class="cvten"><i style="background:#9085e9"></i><span>Di&aacute;logos que Ense&ntilde;an</span></span></span></span>`
      + (i === 0 ? '<i class="cvdot"></i>' : '') + '</button>';
    const rows = Array.from({ length: 7 }, (_, i) => row(i)).join('');
    const bubs = '<i class="cvfill"></i><div class="cvday"><span>Ayer</span></div>'
      + Array.from({ length: 14 }, (_, i) => (i % 2
        ? '<div class="bub bot"><span class="txt">Con ese tiempo en Espa&ntilde;a puede haber opciones como el arraigo social u otras v&iacute;as, pero los detalles importan mucho para no darte informaci&oacute;n que no aplique a tu caso.</span><time>16:14</time></div>'
        : '<div class="bub user"><span class="txt">necesito regularizarme, llevo a&ntilde;o y medio aqu&iacute;</span><time>16:13</time></div>')).join('')
      + '<div class="cvday"><span>Hoy</span></div>'
      + '<div class="bub agent"><span class="who">juan@velai.ai</span><span class="txt">Te confirmo la cita: ma&ntilde;ana a las 10:00.</span><time>16:20</time></div>';
    return h
      .replace('<body>', '<body class="wide">')
      .replace('<div class="thread-empty" id="threadEmpty">', '<div class="thread-empty" id="threadEmpty" hidden>')
      .replace('<div class="thread" id="thread" hidden>', '<div class="thread" id="thread">')
      .replace('<span id="waitPill" class="pill-wait" hidden>', '<span id="waitPill" class="pill-wait">')
      .replace('<span id="waitPillTxt">&mdash;</span>', '<span id="waitPillTxt">2 esperando asesor</span>')
      .replace('<span id="availState">&mdash;</span>', '<span id="availState">Asesor disponible</span>')
      .replace('<span id="convCount"></span>', '<span id="convCount">7 conversaciones</span>')
      .replace('<div class="chtabs" id="chTabs"></div>',
        `<div class="chtabs" id="chTabs"><button class="chtab is-on"><span>Todos</span> <b>7</b><i></i></button>`
        + `<button class="chtab">${wa} <b>4</b><i></i></button><button class="chtab">${web} <b>2</b></button>`
        + `<button class="chtab">${ms} <b>1</b></button></div>`)
      .replace('<div class="inbox-list" id="convRows"></div>', `<div class="inbox-list" id="convRows">${rows}</div>`)
      .replace('<div class="thread-h" id="threadHead"></div>',
        '<div class="thread-h" id="threadHead"><button class="cvback" id="convBack" type="button">'
        + `${ICO}<path d="m14.5 6-6 6 6 6"></path></svg></button>`
        + `<span class="cvav" style="background:#3987e5">VI<span class="cvch">${web}</span></span>`
        + '<span class="grow"><span class="thwho">Visitante de la web</span>'
        + '<span class="thmeta"><b>Web</b>&middot;<b>Di&aacute;logos que Ense&ntilde;an</b>&middot;<span class="mono">f8d09ce9</span></span></span>'
        + '<span class="chip warn">2 sin respuesta</span><span class="chip">se borra el 24 nov</span></div>')
      .replace('<div class="chatlog thread-log" id="threadLog"></div>', `<div class="chatlog thread-log" id="threadLog">${bubs}</div>`)
      .replace('<div class="composer" id="composer"></div>',
        '<div class="composer" id="composer">'
        + `<div class="cvfield"><textarea rows="1" placeholder="Escribe tu respuesta&hellip;"></textarea><button class="cvsend">${send}</button></div>`
        + '<div class="crow"><span class="cwin"><b>Tienes el control</b> &middot; juan@velai.ai</span><span class="sp"></span>'
        + '<span class="cwin">Quedan <b>23 h</b> de la ventana de WhatsApp.</span><span class="sp"></span>'
        + '<button class="btn alt btnsm">Devolver a Vai</button></div></div>');
  },
  // Conexiones no necesita inyectar nada: la rejilla de horario es markup estático, y es
  // justo lo que hay que MIRAR (un cliente tiene que entenderla sin explicación).
  conexiones: (h) => h,
  // El calendario esconde su configuración hasta que hay conexión: aquí se destapa para
  // poder mirar la rejilla del horario laboral sin montar un OAuth.
  calendario: (h) => h.replace('<div id="calViewWrap" hidden>', '<div id="calViewWrap">'),
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
