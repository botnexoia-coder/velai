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

// 4º argumento «busy»: enciende la barra de actividad (html.busy) para poder MIRARLA.
// Solo se ve durante una petición, así que sin esto no hay forma de revisarla sin
// cronometrar una captura a ojo mientras carga algo.
const [bundlePath, outPath = '/tmp/panel.png', view = 'conversaciones', busy = ''] = process.argv.slice(2);
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
const chSvg = (cls, d) => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CH = {
  wa: chSvg('ch-wa', '<path d="M12 3.2a8.8 8.8 0 0 0-7.5 13.4L3.2 20.8l4.4-1.3A8.8 8.8 0 1 0 12 3.2z"></path><path d="M9.3 9.1l1 1.8-.9.9a6.2 6.2 0 0 0 2.8 2.8l.9-.9 1.8 1"></path>'),
  web: chSvg('ch-web', '<circle cx="12" cy="12" r="8.6"></circle><path d="M3.4 12h17.2"></path><path d="M12 3.4c3.2 3.7 3.2 13.5 0 17.2c-3.2-3.7-3.2-13.5 0-17.2"></path>'),
  ms: chSvg('ch-ms', '<path d="M12 3.2c-4.85 0-8.8 3.63-8.8 8.13 0 2.55 1.28 4.82 3.28 6.32v3.15l3.02-1.65c.79.21 1.63.33 2.5.33 4.85 0 8.8-3.63 8.8-8.15S16.85 3.2 12 3.2z"></path><path d="M7.5 14.4l2.7-4.3 2.4 1.9 2.4-3.2"></path>'),
  ig: chSvg('ch-ig', '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="5"></rect><circle cx="12" cy="12" r="4"></circle><circle cx="16.9" cy="7.1" r="1.15" fill="currentColor" stroke="none"></circle>'),
  tg: chSvg('ch-tg', '<path d="M21.3 4.4 2.9 11.2c-.9.3-.9 1.6.1 1.8l4.4 1.1 1.6 4.7c.3.9 1.5.9 2 .2l2.1-3.1 4 3c.7.5 1.7.2 1.9-.7l2.9-12.5c.2-.9-.7-1.6-1.6-1.3z"></path><path d="M8.6 14.3 18 7.4"></path>'),
};
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
  // Conexiones (rediseño 2026-08-27): tira de estado, dos columnas y el asistente con un
  // paso ABIERTO. Sin inyectar nada se veía la mitad de la vista vacía, que es justo lo
  // que este render tiene que cazar.
  conexiones: (h) => {
    const tile = (k, name, addr, cls, st) => `<div class="cxtile${cls === 'on' ? '' : ' is-off'}">`
      + `<span class="cxti">${CH[k]}</span><span class="cxtm"><span class="cxtn">${name}</span>`
      + `<span class="cxta">${addr}</span><span class="cxts ${cls}"><i></i>${st}</span></span></div>`;
    const tiles = tile('web', 'Tu web', 'clinicasanz.es', 'on', 'Activo')
      + tile('wa', 'WhatsApp', '+34 910 55 44 21', 'on', 'Activo')
      + tile('tg', 'Telegram', 'Cl&iacute;nica Sanz &middot; Leads', 'on', 'Activo')
      + tile('ms', 'Messenger', 'Sin configurar', '', 'Sin conectar')
      + tile('ig', 'Instagram', 'Canal todav&iacute;a no disponible', '', 'Sin activar');
    const arow = (k, n, cls, st) => `<div class="cxarow"><span class="cxti">${CH[k]}</span>`
      + `<span class="cxan">${n}</span><span class="${cls}">${st}</span></div>`;
    const topic = (n, d) => `<div class="cxtrow"><span class="cxtn2">${n}</span><span class="cxtd">${d}</span>`
      + `<button class="cxibtn" type="button">${ICO}<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"></path><path d="m14.5 5.5 3 3"></path></svg></button>`
      + `<button class="cxibtn del" type="button">${ICO}<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div>`;
    // Horas de muestra en la rejilla: sin valores no se ve si los tramos caben.
    const HOR = { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 2, sun: 0 };
    for (const [d, modo] of Object.entries(HOR)) {
      const v = modo === 1 ? ['09:00', '14:00', '16:00', '19:00'] : modo === 2 ? ['10:00', '13:00', '', ''] : ['', '', '', ''];
      ['1a', '1b', '2a', '2b'].forEach((f, i) => {
        h = h.replace(`<input type="time" id="sh_${d}_${f}">`, `<input type="time" id="sh_${d}_${f}" value="${v[i]}">`);
      });
      if (!modo) h = h.replace(`<div class="shrow" id="shrow_${d}">`, `<div class="shrow off" id="shrow_${d}">`)
        .replace(`<span class="cxclosed" id="shoff_${d}" hidden>`, `<span class="cxclosed" id="shoff_${d}">`);
      else h = h.replace(`<button class="sw" type="button" role="switch" aria-checked="true" id="shsw_${d}"`,
        `<button class="sw on" type="button" role="switch" aria-checked="true" id="shsw_${d}"`);
    }
    return h
      .replace('<div class="cxtiles" id="cxChannels"></div>', `<div class="cxtiles" id="cxChannels">${tiles}</div>`)
      .replace('<div class="cxarows" id="cxAlerts"></div>', `<div class="cxarows" id="cxAlerts">`
        + arow('tg', 'Telegram', 'flag ok', 'recibe avisos') + arow('wa', 'WhatsApp', 'flag', 'WhatsApp est&aacute; aprobando la plantilla') + '</div>')
      .replace('<span class="tgchip" id="tgProgress">&mdash;</span>', '<span class="tgchip" id="tgProgress">Completado</span>')
      .replace('<span id="tgWlState" class="flag off">desactivada</span>', '<span id="tgWlState" class="flag ok">activada</span>')
      .replace('<div id="waState" class="cxrow muted">&mdash;</div>',
        '<div id="waState" class="cxrow muted"><span class="flag ok">Activo</span> <span class="muted">+34 910 55 44 21</span></div>')
      .replace('<span id="wrState" class="flag off">&mdash;</span>', '<span id="wrState" class="flag ok">activado</span>')
      .replace('<button class="sw" id="wrToggle"', '<button class="sw on" id="wrToggle"')
      .replace('<div id="tgTopics" class="muted mt6">\u2014</div>',
        `<div id="tgTopics"><div class="cxtopics">${topic('Presupuestos', 'clientes que piden precio o cotizaci&oacute;n')}${topic('Urgencias', 'dolor, flem&oacute;n o algo que no puede esperar')}</div></div>`)
      // El paso 5 abierto y el riel con lo hecho en verde: es el estado normal de la vista.
      .replace('<div class="tgstep" id="tgs5b" hidden>', '<div class="tgstep" id="tgs5b">')
      .replace(/<button class="tgnode" id="tgn([1-4])" type="button" data-tgo="tgs\1"><span class="tgnum">\1<\/span>/g,
        (m, n) => `<button class="tgnode done" id="tgn${n}" type="button" data-tgo="tgs${n}"><span class="tgnum">${ICO}<polyline points="20 6 9 17 4 12"></polyline></svg></span>`)
      .replace('<button class="tgnode" id="tgn5" type="button" data-tgo="tgs5">', '<button class="tgnode cur done" id="tgn5" type="button" data-tgo="tgs5">')
      .replace(/<i class="tgbar" id="tgbar([1-4])"><\/i>/g, (m, n) => `<i class="tgbar done" id="tgbar${n}"></i>`);
  },
  // Dashboard: la gráfica de leads por día CON el globo abierto encima de una barra.
  // El tooltip solo existe mientras el ratón está encima, así que sin esto no hay forma
  // de revisarlo: ni el contraste, ni si el desglose cabe, ni si se sale por el borde.
  dashboard: (h) => {
    const alturas = [22, 45, 12, 78, 34, 90, 56, 40, 66, 18, 100, 72, 28, 84];
    const barras = alturas.map((a) => `<div class="bar" data-h="${a}"></div>`).join('');
    // La altura la pone paint() por CSSOM en el panel real (la CSP con nonce bloquea los
    // style="" del markup). Aquí, sin scripts, se inyecta como regla o la gráfica sale
    // plana y parece rota cuando no lo está.
    const alturasCss = '<style nonce="n">' + alturas.map((a, i) => `#chart .bar:nth-child(${i + 1}){height:${a}%}`).join('') + '</style>';
    const fila = (k, v) => `<div class="tipk"><span>${k}</span><span>${v}</span></div>`;
    return h
      .replace('<div id="chart"></div>', `${alturasCss}<div id="chart">${barras}</div>`)
      .replace('<span id="chartFrom"></span>', '<span id="chartFrom">08-18</span>')
      .replace('<span id="chartTo"></span>', '<span id="chartTo">08-31</span>')
      .replace('<span class="n" id="mTotal">&mdash;</span>', '<span class="n" id="mTotal">24</span>')
      .replace('<span class="n" id="mNew">&mdash;</span>', '<span class="n" id="mNew">3</span>')
      // El globo, abierto sobre la barra alta del centro. La posición va por CSS porque la
      // CSP con nonce bloquea los style="" del markup (misma razón que paint()).
      .replace('<div id="tip" role="tooltip" hidden></div>',
        '<style nonce="n">#tip{opacity:1;transform:none;left:812px;top:262px}</style>'
        + '<div id="tip" role="tooltip"><b>jueves, 28 de agosto</b>'
        + fila('Leads', '7') + fila('whatsapp', '4') + fila('chat web', '2') + fila('calculadora-roi', '1')
        + '</div>');
  },
  // Leads: la barra de filtros con contenido real. El desplegable de «Fuente» lo rellena
  // fillSources() desde /api/admin/stats, así que sin scripts hay que sembrarlo a mano —
  // y es justo lo que hay que MIRAR: cabe en la barra sin romper la fila de filtros.
  leads: (h) => {
    const fuentes = ['chat web', 'formulario web', 'whatsapp', 'calculadora-roi', 'diagnostico-whatsapp'];
    const fila = (fecha, cliente, est, nombre, tel, asunto, fuente) =>
      `<tr><td>${fecha}</td><td><span class="tenant"><i data-c="#3987e5"></i>${cliente}</span></td>`
      + `<td><span class="pill s-${est}"><b></b>${({ new: 'nuevo', contacted: 'contactado', won: 'ganado' })[est]}</span></td><td>${nombre}</td><td class="tel">${tel}</td>`
      + `<td>${asunto}</td><td>${fuente}</td><td><span class="nb ok"><i></i>Telegram</span></td></tr>`;
    return h
      .replace('<option value="">Todas las fuentes</option>',
        '<option value="">Todas las fuentes</option>'
        + fuentes.map((f) => `<option${f === 'whatsapp' ? ' selected' : ''}>${f}</option>`).join(''))
      .replace('<select name="tenant" id="tenantFilter"><option value="">Todos los clientes</option></select>',
        '<select name="tenant" id="tenantFilter"><option value="">Todos los clientes</option><option selected>GOgesti&oacute;n</option></select>')
      .replace('<tbody id="rows"></tbody>', '<tbody id="rows">'
        + fila('31/08/26 14:02', 'GOgesti&oacute;n', 'new', 'Mar&iacute;a Ferr&aacute;ndez', '+34 612 345 678', 'quiere cita para el jueves', 'whatsapp')
        + fila('31/08/26 12:41', 'GOgesti&oacute;n', 'contacted', 'Juan Luis Escribano', '+34 655 433 803', 'pregunta por el precio del plan profesional', 'chat web')
        + fila('30/08/26 19:15', 'GOgesti&oacute;n', 'won', 'Carmen', '+34 602 608 940', 'reserva confirmada', 'calculadora-roi')
        + '</tbody>');
  },
  // Configuración: la tarjeta de integraciones solo se destapa para admins raíz (lo hace
  // loadConfig), así que aquí se destapa a mano. Lo que hay que MIRAR es el diagnóstico
  // del webhook con un fallo de verdad: es el estado que importa y el que no se ve nunca.
  config: (h) => {
    const fila = (k, v, cls) => `<div class="whrow"><b>${k}</b><span${cls ? ` class="${cls}"` : ''}>${v}</span></div>`;
    return h
      .replace('<div class="panelcard mt12" id="configCard" hidden>', '<div class="panelcard mt12" id="configCard">')
      .replace('<div id="adminsList" class="mt6 muted">&mdash;</div>',
        '<div id="adminsList" class="mt6"><div class="whrow"><b>botnexo.ia@gmail.com</b><span class="muted">ra&iacute;z</span></div></div>')
      .replace('<div id="whOut" class="mt6 muted">&mdash;</div>', '<div id="whOut" class="mt6">'
        + fila('URL', 'https://vai-worker.botnexo-ia.workers.dev/telegram/webhook', 'whok')
        + fila('En cola', '3 &mdash; se est&aacute;n acumulando', 'whbad')
        + fila('&Uacute;ltimo error', 'Wrong response from the webhook: 401 Unauthorized (31/08/26 12:14)', 'whbad')
        + fila('IP de Telegram', '91.108.6.51')
        + '</div>');
  },
  // El calendario esconde su configuración hasta que hay conexión: aquí se destapa para
  // poder mirar la rejilla del horario laboral sin montar un OAuth.
  calendario: (h) => h.replace('<div id="calViewWrap" hidden>', '<div id="calViewWrap">'),
};
if (!VISTAS[view]) { console.error(`render-panel: vista desconocida «${view}». Disponibles: ${Object.keys(VISTAS).join(', ')}`); process.exit(2); }
if (view !== 'dashboard') html = html.replace('<div id="viewDashboard">', '<div id="viewDashboard" hidden>');
if (view !== 'dashboard') html = html.replace(`<div id="view${view[0].toUpperCase()}${view.slice(1)}" hidden>`, `<div id="view${view[0].toUpperCase()}${view.slice(1)}">`);
html = VISTAS[view](html);
if (busy === 'busy') {
  html = html.replace('<html lang="es">', '<html lang="es" class="busy">');
  // Y un botón en curso: el estado que ve quien acaba de pulsar. En el panel real lo pone
  // busyStart() con document.activeElement; aquí, sin scripts, se marca a mano.
  html = html.replace('<button class="btn alt btnsm" id="tgSetup" type="button">',
    '<button class="btn alt btnsm loading" id="tgSetup" type="button" disabled>');
  html = html.replace('<button class="btn" id="tgTopicAdd" type="button">',
    '<button class="btn loading" id="tgTopicAdd" type="button" disabled>');
  html = html.replace('<button class="btn alt btnsm" id="wrTest" type="button">',
    '<button class="btn alt btnsm loading" id="wrTest" type="button" disabled>');
}

const tmpHtml = outPath.replace(/\.png$/, '') + '.html';
await writeFile(tmpHtml, html);
await promisify(execFile)(chrome, ['--headless', '--no-sandbox', '--disable-gpu',
  '--window-size=1600,900', `--screenshot=${outPath}`, pathToFileURL(tmpHtml).href], { timeout: 60000 });
console.log(`render-panel: ${outPath} (vista «${view}») — ábrelo y MIRA el layout.`);
