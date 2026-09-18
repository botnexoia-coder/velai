import { artboard } from './_base.mjs';
const svg = (d, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

/* ── La misma pantalla, tres marcas: el aprovisionamiento del chat, reutilizado ── */
const muestra = ({ titulo, nota, l1, l2, acc, dark, iniciales, nombre }) => {
  const p = dark
    ? { srf: '#151b27', card: '#1b2230', text: '#fff', muted: '#ced7e5', line: 'rgba(255,255,255,.08)' }
    : { srf: '#f7f4ef', card: '#fff', text: '#172033', muted: '#5b6472', line: 'rgba(0,0,0,.08)' };
  const tok = `--l1:${l1};--l2:${l2};--acc:${acc};--srf:${p.srf};--card:${p.card};--text:${p.text};--muted:${p.muted};--line:${p.line}`;
  return `<div style="display:flex;flex-direction:column;gap:12px">
  <div style="${tok};position:relative;overflow:hidden;width:400px;padding:22px;border-radius:22px;background:var(--srf);
    border:1px solid var(--line);color:var(--text)">
    <div style="display:flex;align-items:center;gap:11px;margin-bottom:18px">
      <span style="width:42px;height:42px;border-radius:13px;display:grid;place-items:center;color:#fff;
        background:linear-gradient(135deg,var(--l1),var(--l2));font-family:'Cabinet Grotesk',sans-serif;font-size:15px;font-weight:800">${iniciales}</span>
      <span style="display:flex;flex-direction:column">
        <span class="display" style="font-size:16px;font-weight:800">${nombre}</span>
        <span style="font-size:12px;color:var(--muted)">Sesión presencial · 30 min</span>
      </span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7, minmax(0, 1fr));gap:6px;padding:14px;border-radius:16px;background:var(--card);border:1px solid var(--line)">
      ${[14, 15].map((n) => `<span style="height:36px;display:grid;place-items:center;font-size:13px;color:color-mix(in srgb,var(--muted) 45%,transparent)">${n}</span>`).join('')}
      <span style="height:36px;display:grid;place-items:center;border-radius:11px;font-size:13px;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--l1),var(--l2))">16</span>
      ${[17, 18, 19, 20].map((n) => `<span style="height:36px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:11px;border:1px solid var(--line);font-size:13px">${n}<span style="width:3px;height:3px;border-radius:50%;background:var(--acc)"></span></span>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:7px;margin-top:12px">
      ${['09:00', '10:00', '10:30'].map((h, i) => `<span style="height:40px;display:grid;place-items:center;border-radius:11px;font-size:13px;font-weight:500;${i === 1 ? 'background:linear-gradient(135deg,var(--l1),var(--l2));color:#fff' : 'background:var(--card);border:1px solid var(--line)'}">${h}</span>`).join('')}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px">
      <span style="display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 20px;border-radius:999px;color:#fff;
        background:linear-gradient(135deg,var(--l1),var(--l2));font-family:'Cabinet Grotesk',sans-serif;font-size:14px;font-weight:700">Continuar</span>
      <span style="display:inline-flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.06em;color:var(--muted)">
        <span style="display:grid;place-items:center;width:15px;height:15px;border-radius:4px;background:#172033;color:#fff">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 13.5 10 18 19 7"/></svg>
        </span>Tecnología Velai</span>
    </div>
  </div>
  <div style="width:400px;display:flex;flex-direction:column;gap:3px">
    <span style="font-size:13px;font-weight:700;color:#172033;font-family:'Cabinet Grotesk',sans-serif">${titulo}</span>
    <span style="font-size:12px;color:#5b6472;line-height:1.5">${nota}</span>
  </div>
</div>`;
};

artboard({
  file: 'Marca.dc.html', w: 1400, h: 620, pad: 36, selloEscala: 0,
  body: `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:26px">
  <span class="kicker">Una sola pantalla, la marca de cada cliente</span>
  <h2 class="display" style="font-size:26px;font-weight:800">Los colores salen del mismo sitio que los del chat</h2>
  <span style="font-size:14px;color:#5b6472;max-width:760px">Sin configuración nueva: la página lee <code>brand_color</code>, <code>brand_color_2</code>, <code>accent_color</code>, <code>logo_url</code> y <code>theme</code> de la ficha del cliente, exactamente como hace el widget. Si el cliente no define acento, se deriva del color de marca.</span>
</div>
<div style="display:flex;gap:26px;flex-wrap:wrap">
  ${muestra({ titulo: 'Velai (valores por defecto)', nota: 'brand_color #b83e08 · brand_color_2 #662a16 · accent_color #ff914f', l1: '#b83e08', l2: '#662a16', acc: '#ff914f', dark: false, iniciales: 'VA', nombre: 'Velai' })}
  ${muestra({ titulo: 'Cliente con marca propia, sin acento', nota: 'brand_color #0f766e · el acento se deriva: color-mix(brand 55%, blanco)', l1: '#0f766e', l2: '#134e4a', acc: 'color-mix(in srgb,#0f766e 55%,#fff)', dark: false, iniciales: 'DE', nombre: 'Diálogos que Enseñan' })}
  ${muestra({ titulo: 'Cliente con tema oscuro', nota: 'theme = dark · mismos tokens, superficies invertidas', l1: '#c2185b', l2: '#6d0f33', acc: '#ff7aa8', dark: true, iniciales: 'ZT', nombre: 'Zoe Travel' })}
</div>`,
});

console.log('marca');
