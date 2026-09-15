// Rediseño del Calendario / Reservas online del panel v2.
// TOKENS Y COMPONENTES COPIADOS DE panel/src/styles/panel.css (vista clara): ningún valor
// inventado. Sidebar y pie mantienen los tokens OSCUROS de :root — la navegación va
// oscura siempre, aunque las vistas vayan claras (regla del sistema).
import { readFileSync, writeFileSync } from 'node:fs';
export const FONTS = readFileSync(new URL('./_fonts.css', import.meta.url), 'utf8');

export const V = {            // vista clara (main, dialog)
  bg: '#F7F3EF', bg2: '#FFFDFB', bg3: '#F1EBE5', surface: '#F3EDE7',
  ink: '39,30,25', white: '#271E19', muted: 'rgba(39,30,25,.62)', muted2: 'rgba(39,30,25,.60)',
  border: 'rgba(255,107,26,.18)', border2: 'rgba(39,30,25,.16)', line: 'rgba(39,30,25,.09)',
  orange: '#FF6B1A', orange2: '#FF8C40', amber: '#FFAA00', ok: '#199e70', bad: '#e66767',
  chipT: '#b84e08', amberT: '#8a5a00', r: '16px', rsm: '10px',
};
export const SIDE = { side: '#0D0A10', ink: '255,248,244', white: '#FFF8F4', muted: 'rgba(255,248,244,.62)', border: 'rgba(255,107,26,.10)', line: 'rgba(255,248,244,.06)' };

export const CSS = `
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 'Satoshi',system-ui,sans-serif;color:${V.white};background:${V.bg}}
h1,h2,h3{font-family:'Cabinet Grotesk',system-ui,sans-serif;margin:0;letter-spacing:-.02em}
a{color:${V.chipT};text-decoration:none}a:hover{color:${V.orange}}
p{margin:0}
/* Cabecera de vista — .vhead del panel */
.vhead{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 22px}
.vhead h1{font-weight:900;font-size:27px}
.vhead p{margin:6px 0 0;color:${V.muted};font-size:13.5px}
/* Pestañas — .chtabs del panel (píldora sobre bg3) */
.chtabs{display:inline-flex;gap:2px;padding:2px;border-radius:999px;background:${V.bg3}}
.chtab{border:0;background:none;border-radius:999px;padding:8px 16px;font-size:13px;font-weight:500;color:${V.muted};cursor:pointer;white-space:nowrap}
.chtab.on{background:${V.bg2};color:${V.white};font-weight:700;box-shadow:0 1px 2px rgba(39,30,25,.06)}
/* Tarjeta — .card del panel */
.card{background:${V.surface};border:1px solid ${V.border};border-radius:12px;padding:14px 16px}
.card>b.lbl{display:block;color:${V.muted};font-size:11px;font-weight:500;letter-spacing:.07em;text-transform:uppercase;margin-bottom:5px}
.panel{background:${V.bg2};border:1px solid ${V.line};border-radius:${V.r};padding:18px 20px}
.btn{border:0;border-radius:${V.rsm};padding:10px 17px;background:${V.orange};color:#fff;font-weight:700;cursor:pointer;box-shadow:0 4px 18px rgba(255,107,26,.22);font-size:14px}
.btn.alt{background:${V.bg2};border:1px solid ${V.border2};color:${V.white};font-weight:500;box-shadow:none}
.btnsm{padding:4px 10px;font-size:12px}
.pill{display:inline-flex;align-items:center;gap:7px;background:rgba(${V.ink},.03);border:1px solid rgba(${V.ink},.08);border-radius:999px;padding:4px 11px;font-size:12px;font-weight:500;white-space:nowrap}
.pill b{width:6px;height:6px;border-radius:50%;flex:none}
.chip{display:inline-flex;align-items:center;background:rgba(${V.ink},.05);border:1px solid rgba(${V.ink},.10);color:rgba(${V.ink},.70);border-radius:999px;padding:4px 12px;font-size:11.5px;font-weight:500;white-space:nowrap}
.muted{color:${V.muted}}
.sm{font-size:12.5px}
.lbl{font-size:11px;font-weight:500;letter-spacing:.07em;text-transform:uppercase;color:${V.muted}}
input,select,textarea{font:inherit;color:${V.white};background:${V.bg3};border:1px solid rgba(${V.ink},.10);border-radius:8px;padding:9px 12px;width:100%}
/* Interruptor real: hoy es un checkbox nativo suelto a la derecha de su etiqueta */
.sw{width:44px;height:26px;border-radius:999px;background:rgba(${V.ink},.14);position:relative;flex:none;transition:background .15s}
.sw i{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:left .15s}
.sw.on{background:${V.ok}}.sw.on i{left:21px}
`;

// Barra lateral del panel, con SUS tokens oscuros. Se dibuja para que el rediseño se
// juzgue en su sitio y no flotando en el vacío.
export function sidebar(activo = 'Calendario') {
  const item = (nombre, d, on) => `<div style="display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:9px;font-size:13.5px;
    ${on ? `background:rgba(255,107,26,.13);color:${V.orange2};font-weight:700` : `color:${SIDE.muted}`}">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>${nombre}</div>`;
  return `<aside style="width:230px;flex:none;background:${SIDE.side};border-right:1px solid ${SIDE.border};padding:24px 14px 16px;display:flex;flex-direction:column;gap:3px;color:${SIDE.white}">
  <div style="display:flex;align-items:center;gap:9px;padding:0 10px;margin-bottom:6px">
    <span style="width:9px;height:9px;border-radius:50%;background:${V.orange};box-shadow:0 0 10px rgba(255,107,26,.7)"></span>
    <span style="font-family:'Cabinet Grotesk',sans-serif;font-weight:900;font-size:19px;letter-spacing:-.02em">Velai</span>
    <span style="font-size:10.5px;letter-spacing:.18em;color:${SIDE.muted};text-transform:uppercase;line-height:1.2">Diálogos<br>que Enseñan</span>
  </div>
  <div style="height:1px;background:${SIDE.line};margin:12px 4px"></div>
  ${item('Dashboard', '<rect x="3" y="12" width="4" height="9"/><rect x="10" y="7" width="4" height="14"/><rect x="17" y="3" width="4" height="18"/>', activo === 'Dashboard')}
  ${item('Leads', '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0-1.5-5.6M21 20a5 5 0 0 0-3.5-4.8"/>', false)}
  ${item('Conversaciones', '<path d="M21 12a8 8 0 1 1-3.2-6.4"/><path d="M3 20l1.4-3.6"/>', false)}
  ${item('Calendario', '<rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>', activo === 'Calendario')}
  ${item('Conexiones', '<path d="M10 14a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>', false)}
  ${item('Plantillas', '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6M9 12h6M9 16h3"/>', false)}
</aside>`;
}

export function artboard({ file, body, w = 1440, h = 900, bg = V.bg, props = null, logic = null }) {
  writeFileSync(new URL(`./${file}`, import.meta.url),
`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>${FONTS}${CSS}</style>
</helmet>
<div class="root" style="display:flex;width:${w}px;min-height:${h}px;background:${bg}">
${body}
</div>
</x-dc>${props ? `\n<script data-dc-script data-props='${props}'>\n${logic}\n</script>` : ''}
</body>
</html>
`);
}
