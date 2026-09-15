import { artboard, header, footer, BRAND_PROPS, BRAND_LOGIC } from './_base.mjs';

const icono = {
  presencial: '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="3"/><path d="m15.5 12 6-3.4v10.8l-6-3.4Z"/>',
  telefono: '<path d="M6.5 3.5h3l1.5 4-2 1.6a12 12 0 0 0 5.9 5.9l1.6-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z"/>',
};
const svg = (d, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

/* ── Paso 1 · servicio ────────────────────────────────────────────────── */
const tarjeta = (nombre, desc, meta, ic, sel) => `
<button type="button" style="display:flex;align-items:center;gap:18px;width:100%;padding:20px 22px;text-align:left;
  border-radius:18px;cursor:pointer;background:var(--card);
  border:1px solid ${sel ? 'transparent' : 'var(--line)'};
  box-shadow:${sel ? '0 0 0 2px var(--acc), 0 14px 30px color-mix(in srgb,var(--l1) 14%,transparent)' : '0 1px 2px rgba(0,0,0,.03)'}">
  <span style="width:52px;height:52px;flex:none;border-radius:15px;display:grid;place-items:center;
    background:${sel ? 'var(--l1)' : 'var(--input)'};color:${sel ? '#fff' : 'var(--l1)'}">${svg(ic)}</span>
  <span style="flex:1;display:flex;flex-direction:column;gap:5px">
    <span class="display" style="font-size:18px;font-weight:700;color:var(--text)">${nombre}</span>
    <span style="font-size:14px;color:var(--muted)">${desc}</span>
  </span>
  <span style="display:flex;align-items:center;gap:14px">
    <span class="pill">${meta}</span>
    <span style="color:var(--muted)">${svg('<path d="m9 5 7 7-7 7"/>', 20)}</span>
  </span>
</button>`;

artboard({
  file: 'Servicio.dc.html', props: BRAND_PROPS, logic: BRAND_LOGIC, w: 1040, h: 700,
  body: `${header({ paso: 1 })}
<main style="position:relative;overflow:hidden;display:flex;flex-direction:column;gap:22px;margin:30px 0 26px;
  padding:30px;border-radius:24px;background:var(--card);border:1px solid var(--line);box-shadow:0 24px 60px rgba(0,0,0,.06)">
  <div style="display:flex;flex-direction:column;gap:6px">
    <span class="kicker">Paso 1 de 3</span>
    <h2 style="font-size:30px;font-weight:800">¿Cómo quieres tu cita?</h2>
  </div>
  <div style="display:flex;flex-direction:column;gap:12px">
    ${tarjeta('Sesión presencial', 'En nuestro espacio de Madrid, con café de por medio.', '30 min', icono.presencial, true)}
    ${tarjeta('Sesión por vídeo', 'Te enviamos el enlace al confirmar la reserva.', '60 min', icono.video, false)}
    ${tarjeta('Llamada rápida', 'Para dudas concretas. Te llamamos nosotros.', '15 min', icono.telefono, false)}
  </div>
</main>
${footer('Todas las horas son de Madrid. Puedes cambiar o cancelar la cita tú mismo.')}`,
});

/* ── Paso 2 · día y hora (la pantalla principal) ──────────────────────── */
const dia = (n, estado) => {
  if (estado === 'off') return `<span style="height:46px;display:grid;place-items:center;font-size:15px;color:color-mix(in srgb,var(--muted) 45%,transparent)">${n}</span>`;
  if (estado === 'sel') return `<span style="height:46px;display:grid;place-items:center;border-radius:14px;font-weight:700;font-size:15px;
    background:var(--l1);color:#fff">${n}</span>`;
  return `<span style="height:46px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border-radius:14px;
    border:1px solid var(--line);background:var(--card);font-size:15px;font-weight:500;color:var(--text)">${n}
    <span style="width:4px;height:4px;border-radius:50%;background:var(--acc)"></span></span>`;
};
const hora = (h, sel) => `<span style="height:46px;display:grid;place-items:center;border-radius:13px;font-size:15px;font-weight:${sel ? 700 : 500};
  ${sel ? 'background:color-mix(in srgb,var(--l1) 10%,var(--card));color:var(--l1);border:1px solid color-mix(in srgb,var(--l1) 38%,transparent)'
        : 'background:var(--card);color:var(--text);border:1px solid var(--line)'}">${h}</span>`;
const bloque = (titulo, horas, selIdx = -1) => `
<div style="display:flex;flex-direction:column;gap:10px">
  <span class="kicker">${titulo}</span>
  <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:9px">
    ${horas.map((h, i) => hora(h, i === selIdx)).join('')}
  </div>
</div>`;

const calendario = `
<div style="display:flex;flex-direction:column;gap:16px">
  <div style="display:flex;align-items:center;justify-content:space-between">
    <h3 class="display" style="font-size:18px;font-weight:700;text-transform:capitalize">septiembre 2026</h3>
    <div style="display:flex;gap:8px">
      <span style="width:38px;height:38px;display:grid;place-items:center;border-radius:12px;border:1px solid var(--line);color:color-mix(in srgb,var(--muted) 55%,transparent)">${svg('<path d="m14 5-7 7 7 7"/>', 18)}</span>
      <span style="width:38px;height:38px;display:grid;place-items:center;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--text)">${svg('<path d="m10 5 7 7-7 7"/>', 18)}</span>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(7, minmax(0, 1fr));gap:7px">
    ${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => `<span style="text-align:center;font-size:11px;font-weight:500;letter-spacing:.1em;color:var(--muted);padding-bottom:2px">${d}</span>`).join('')}
    ${['', '', '', '', '', '', ''].slice(0, 1).map(() => '<span></span>').join('')}
    ${[1, 2, 3, 4, 5, 6].map((n) => dia(n, 'off')).join('')}
    ${[7, 8, 9, 10, 11, 12, 13].map((n) => dia(n, 'off')).join('')}
    ${[14, 15].map((n) => dia(n, 'off')).join('')}${dia(16, 'sel')}${[17, 18, 19, 20].map((n) => dia(n, 'on')).join('')}
    ${[21, 22, 23, 24, 25, 26, 27].map((n) => dia(n, 'on')).join('')}
    ${[28, 29, 30].map((n) => dia(n, 'on')).join('')}
  </div>
</div>`;

const horarios = `
<div style="display:flex;flex-direction:column;gap:18px">
  <div style="display:flex;flex-direction:column;gap:4px">
    <h3 class="display" style="font-size:18px;font-weight:700">Miércoles, 16 de septiembre</h3>
    <span style="font-size:13px;color:var(--muted)">8 horas libres · hora de Madrid</span>
  </div>
  ${bloque('Mañana', ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'], 2)}
  ${bloque('Tarde', ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30'])}
  <button class="cta" style="width:100%;margin-top:2px">Continuar con las 10:00</button>
</div>`;

artboard({
  file: 'Main.dc.html', props: BRAND_PROPS, logic: BRAND_LOGIC, w: 1040, h: 900,
  body: `${header({ paso: 2 })}
<main style="max-width:620px;margin:30px auto 26px;display:flex;flex-direction:column;gap:18px">
  <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
    <span class="pill" style="color:var(--text)">${svg(icono.presencial, 16)} Sesión presencial</span>
    <span class="pill">30 min</span>
    <span class="pill">Calle de Prueba 1</span>
    <span style="flex:1"></span>
    <span style="font-size:13px;color:var(--muted)">Cambiar</span>
  </div>
  <section style="position:relative;overflow:hidden;display:flex;flex-direction:column;gap:22px;padding:26px;
    border-radius:24px;background:var(--card);border:1px solid var(--line);box-shadow:0 24px 60px rgba(0,0,0,.06)">
    ${calendario}
    <div style="height:1px;background:var(--line)"></div>
    ${horarios}
  </section>
</main>
${footer()}`,
});
console.log('flujo: Servicio, Main');
