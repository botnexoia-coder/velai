// Generador de los artboards del rediseño de reservas.
// Los TOKENS son literalmente los del widget (site/assets/vai-widget.js:199-201):
// --l1 = brand_color · --l2 = brand_color_2 || brand_color · --acc = accent_color
// || color-mix(l1 55%, #fff) · tema light/dark/auto. Mismo aprovisionamiento que el chat.
import { readFileSync, writeFileSync } from 'node:fs';
export const FONTS = readFileSync(new URL('./_fonts.css', import.meta.url), 'utf8');

export const T = {
  l1: '#b83e08', l2: '#662a16', acc: '#ff914f', agent: '#5b3fa8',
  srf: '#f6f5f2', card: '#ffffff', text: '#172033', muted: '#5b6472',
  line: 'rgba(23,32,51,.10)', input: '#eeece7',
};
export const DARK = {
  srf: '#151b27', card: '#1b2230', text: '#ffffff', muted: '#ced7e5',
  line: 'rgba(255,255,255,.08)', input: '#182030',
};

export const CSS = `
*{box-sizing:border-box}
body{margin:0;font-family:'Satoshi',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;color:var(--text);background:var(--srf)}
h1,h2,h3,.display{font-family:'Cabinet Grotesk','Satoshi',system-ui,sans-serif;margin:0;letter-spacing:-.01em}
a{color:var(--l1);text-decoration:none}a:hover{color:var(--l2)}
.kicker{font-size:11px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:22px}
.pill{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 14px;border-radius:999px;
  border:1px solid var(--line);background:var(--card);font-size:13px;font-weight:500;color:var(--muted)}
.cta{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:52px;padding:0 28px;
  border:0;border-radius:999px;background:linear-gradient(135deg,var(--l1),var(--l2));color:#fff;
  font-family:'Cabinet Grotesk',system-ui,sans-serif;font-size:16px;font-weight:700;cursor:pointer;
  box-shadow:0 8px 18px color-mix(in srgb,var(--l1) 18%,transparent)}
.ghost{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:48px;padding:0 20px;
  border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--text);
  font-family:'Satoshi',system-ui,sans-serif;font-size:14px;font-weight:500;cursor:pointer}
.field{display:flex;flex-direction:column;gap:7px}
.field label{font-size:13px;font-weight:500;color:var(--muted)}
.field .box{height:50px;display:flex;align-items:center;padding:0 16px;border-radius:14px;
  background:var(--input);border:1px solid transparent;font-size:15px;color:var(--text)}
.field .box.is-focus{border-color:var(--acc);box-shadow:0 0 0 4px color-mix(in srgb,var(--acc) 22%,transparent);background:var(--card)}
.ph{color:color-mix(in srgb,var(--muted) 70%,transparent)}
`;

// Cabecera común: logo del cliente + nombre + pasos. La marca sale del MISMO
// aprovisionamiento del chat (logo_url, brand_name, brand_color…).
export function header({ paso = 2, name = 'Diálogos que Enseñan', initials = 'DE' } = {}) {
  const pasos = ['Servicio', 'Día y hora', 'Tus datos'];
  return `<header style="display:flex;flex-direction:column;gap:22px">
  <div style="display:flex;align-items:center;gap:14px">
    <div style="width:52px;height:52px;flex:none;border-radius:16px;display:grid;place-items:center;
      background:linear-gradient(135deg,var(--l1),var(--l2));color:#fff;font-family:'Cabinet Grotesk',sans-serif;
      font-size:19px;font-weight:800;letter-spacing:.02em;box-shadow:0 8px 20px color-mix(in srgb,var(--l1) 26%,transparent)">${initials}</div>
    <div style="display:flex;flex-direction:column;gap:3px">
      <h1 style="font-size:24px;font-weight:800;line-height:1.1">${name}</h1>
      <span style="font-size:13px;color:var(--muted)">Reserva tu cita en menos de un minuto</span>
    </div>
    <span style="flex:1"></span>
    ${marca()}
  </div>
  <div style="display:flex;align-items:center;gap:10px">
    ${pasos.map((p, i) => {
      const n = i + 1; const hecho = n < paso; const activo = n === paso;
      const fondo = activo ? 'var(--l1)' : (hecho ? 'color-mix(in srgb,var(--l1) 14%,var(--card))' : 'var(--input)');
      const color = activo ? '#fff' : (hecho ? 'var(--l1)' : 'var(--muted)');
      return `<div style="display:flex;align-items:center;gap:8px">
        <span style="width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:${fondo};
          color:${color};font-size:11px;font-weight:700">${hecho ? '✓' : n}</span>
        <span style="font-size:13px;font-weight:${activo ? 700 : 400};color:${activo ? 'var(--text)' : 'var(--muted)'}">${p}</span>
      </div>${n < 3 ? '<span style="flex:1;height:1px;background:var(--line)"></span>' : ''}`;
    }).join('')}
  </div>
</header>`;
}

export function marca() {
  return `<a href="https://hirevai.com" style="display:inline-flex;align-items:center;gap:9px;height:36px;padding:0 14px 0 11px;
    border:1px solid var(--line);border-radius:10px;background:var(--card);text-decoration:none;flex:none">
    <span style="display:grid;place-items:center;width:20px;height:20px;border-radius:6px;background:#172033;color:#fff">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 13.5 10 18 19 7"/></svg>
    </span>
    <span style="display:flex;flex-direction:column;line-height:1.15">
      <span style="font-size:8.5px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)">Tecnología</span>
      <span style="font-family:'Cabinet Grotesk',sans-serif;font-size:13px;font-weight:800;letter-spacing:.01em;color:var(--text)">Velai</span>
    </span>
  </a>`;
}

// Pie: lo que tranquiliza antes de reservar. La marca Velai ya va en el sello.
export function footer(extra = 'Cancela o cambia la cita tú mismo desde el enlace que te enviamos.') {
  return `<footer style="display:flex;align-items:center;justify-content:space-between;gap:16px;
    padding-top:18px;border-top:1px solid var(--line)">
    <span style="font-size:12px;color:var(--muted)">${extra}</span>
  </footer>`;
}

export function artboard({ file, body, props = null, logic = null, w = 1040, h = 780, pad = 40, dark = false }) {
  const tokens = dark
    ? `--l1:${T.l1};--l2:${T.l2};--acc:${T.acc};--srf:${DARK.srf};--card:${DARK.card};--text:${DARK.text};--muted:${DARK.muted};--line:${DARK.line};--input:${DARK.input}`
    : `--l1:${T.l1};--l2:${T.l2};--acc:${T.acc};--srf:${T.srf};--card:${T.card};--text:${T.text};--muted:${T.muted};--line:${T.line};--input:${T.input}`;
  const base = `position:relative;overflow:hidden;width:${w}px;padding:${pad}px;background:var(--srf)`;
  const root = props
    ? `<div class="root" style="{{tokens}};${base}">`
    : `<div class="root" style="${tokens};${base}">`;
  const script = props
    ? `\n<script data-dc-script data-props='${props}'>\n${logic}\n</script>`
    : '';
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
${root}
${body}
</div>
</x-dc>${script}
</body>
</html>
`);
}

// Lógica compartida de los artboards con palanca de marca: los MISMOS tokens del
// widget, con el acento derivado igual que allí cuando el cliente no lo define.
export const BRAND_PROPS = JSON.stringify({
  brand: { editor: 'color', default: T.l1, options: [T.l1, '#1f6f6b', '#2a4bd7', '#8a1c46'] },
  brand2: { editor: 'color', default: T.l2 },
  accent: { editor: 'color', default: T.acc },
  oscuro: { editor: 'boolean', default: false },
});
export const BRAND_LOGIC = `class Component extends DCLogic {
  renderVals() {
    const l1 = this.props.brand ?? '${T.l1}';
    const l2 = this.props.brand2 ?? '${T.l2}';
    const acc = this.props.accent ?? 'color-mix(in srgb, ' + l1 + ' 55%, #fff)';
    const d = this.props.oscuro === true;
    const p = d
      ? { srf: '${DARK.srf}', card: '${DARK.card}', text: '${DARK.text}', muted: '${DARK.muted}', line: '${DARK.line}', input: '${DARK.input}' }
      : { srf: '${T.srf}', card: '${T.card}', text: '${T.text}', muted: '${T.muted}', line: '${T.line}', input: '${T.input}' };
    return { tokens: '--l1:' + l1 + ';--l2:' + l2 + ';--acc:' + acc + ';--srf:' + p.srf + ';--card:' + p.card
      + ';--text:' + p.text + ';--muted:' + p.muted + ';--line:' + p.line + ';--input:' + p.input };
  }
}`;
