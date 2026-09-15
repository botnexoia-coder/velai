import { artboard, header, footer, marca, BRAND_PROPS, BRAND_LOGIC, T, DARK } from './_base.mjs';
const svg = (d, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ic = {
  pin: '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  cal: '<rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  check: '<path d="m5 13 4.5 4.5L19 7"/>',
  wa: '<path d="M4 20l1.3-4a7.8 7.8 0 1 1 3 2.8L4 20Z"/>',
};

/* ── Paso 3 · datos ───────────────────────────────────────────────────── */
const campo = (label, valor, foco = false, ph = false) => `
<div class="field"><label>${label}</label>
  <div class="box${foco ? ' is-focus' : ''}"><span class="${ph ? 'ph' : ''}">${valor}</span></div>
</div>`;

artboard({
  file: 'Datos.dc.html', props: BRAND_PROPS, logic: BRAND_LOGIC, w: 1040, h: 760,
  body: `${header({ paso: 3 })}
<main style="display:grid;grid-template-columns:1.1fr .9fr;gap:30px;margin:32px 0 26px;align-items:start">
  <section style="position:relative;overflow:hidden;display:flex;flex-direction:column;gap:18px;padding:30px;border-radius:24px;
    background:var(--card);border:1px solid var(--line);box-shadow:0 24px 60px rgba(0,0,0,.06)">
    <div style="display:flex;flex-direction:column;gap:5px">
      <span class="kicker">Paso 3 de 3</span>
      <h2 class="display" style="font-size:24px;font-weight:800">¿Con quién hablamos?</h2>
    </div>
    ${campo('Nombre', 'Juan García')}
    ${campo('Teléfono', '+34 612 345 678', true)}
    ${campo('Email (opcional)', 'Para enviarte el recordatorio también por correo', false, true)}
    ${campo('¿Algo que debamos saber? (opcional)', 'Cuéntanos brevemente', false, true)}
    <label style="display:flex;align-items:flex-start;gap:11px;font-size:13px;color:var(--muted);line-height:1.5">
      <span style="width:20px;height:20px;flex:none;border-radius:6px;display:grid;place-items:center;margin-top:1px;
        background:var(--l1);color:#fff">${svg(ic.check, 13)}</span>
      <span>He leído la <a href="#">política de privacidad</a>. Usaremos tus datos solo para gestionar esta cita.</span>
    </label>
    <div style="display:flex;align-items:center;gap:14px;margin-top:4px">
      <button class="cta">Reservar cita</button>
      <span style="font-size:13px;color:var(--muted)">o <a href="#">cambiar la hora</a></span>
    </div>
  </section>
  <aside style="display:flex;flex-direction:column;gap:16px;padding:26px;border-radius:24px;
    background:linear-gradient(150deg,color-mix(in srgb,var(--l1) 9%,var(--card)),var(--card));border:1px solid var(--line)">
    <span class="kicker">Tu reserva</span>
    <div style="display:flex;flex-direction:column;gap:3px">
      <span class="display" style="font-size:27px;font-weight:800;line-height:1.15">Miércoles 16<br>a las 10:00</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:11px;padding-top:4px">
      <span style="display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text)">
        <span style="color:var(--l1)">${svg(ic.cal, 18)}</span> Sesión presencial · 30 min</span>
      <span style="display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text)">
        <span style="color:var(--l1)">${svg(ic.pin, 18)}</span> Calle de Prueba 1, Madrid</span>
      <span style="display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text)">
        <span style="color:var(--l1)">${svg(ic.reloj, 18)}</span> Hora de Madrid (tu misma hora)</span>
    </div>
    <div style="margin-top:6px;padding:14px 16px;border-radius:4px 16px 16px 16px;
      background:color-mix(in srgb,var(--acc) 16%,transparent);border:1px solid color-mix(in srgb,var(--acc) 40%,transparent)">
      <span style="font-size:13px;font-weight:500;color:var(--text)">Te guardamos esta hora 5 minutos</span>
      <div style="margin-top:9px;height:4px;border-radius:999px;background:color-mix(in srgb,var(--acc) 30%,transparent)">
        <div style="width:64%;height:100%;border-radius:999px;background:var(--l1)"></div>
      </div>
    </div>
  </aside>
</main>
${footer('Nadie más puede coger esta hora mientras rellenas tus datos.')}`,
});

/* ── Confirmación ─────────────────────────────────────────────────────── */
artboard({
  file: 'Confirmada.dc.html', props: BRAND_PROPS, logic: BRAND_LOGIC, w: 1040, h: 700,
  body: `${header({ paso: 3 })}
<main style="display:flex;flex-direction:column;align-items:center;gap:26px;margin:44px 0 34px;text-align:center">
  <span style="width:74px;height:74px;border-radius:50%;display:grid;place-items:center;color:#fff;
    background:var(--l1);box-shadow:0 0 0 10px color-mix(in srgb,var(--l1) 10%,transparent)">${svg(ic.check, 34)}</span>
  <div style="display:flex;flex-direction:column;gap:9px;align-items:center">
    <h2 class="display" style="font-size:32px;font-weight:800">Tu cita está reservada</h2>
    <span style="font-size:15px;color:var(--muted);max-width:430px">Te acabamos de escribir por WhatsApp. Te recordaremos la cita 24 horas antes.</span>
  </div>
  <div style="position:relative;display:flex;align-items:stretch;gap:0;border-radius:22px;overflow:hidden;border:1px solid var(--line);
    background:var(--card);box-shadow:0 24px 60px rgba(0,0,0,.06)">
    <div style="width:6px;background:var(--l1)"></div>
    <div style="display:flex;gap:40px;padding:26px 34px;text-align:left">
      <div style="display:flex;flex-direction:column;gap:4px">
        <span class="kicker">Cuándo</span>
        <span class="display" style="font-size:21px;font-weight:700">Miércoles 16 · 10:00</span>
        <span style="font-size:13px;color:var(--muted)">30 minutos · hora de Madrid</span>
      </div>
      <div style="width:1px;background:var(--line)"></div>
      <div style="display:flex;flex-direction:column;gap:4px">
        <span class="kicker">Dónde</span>
        <span class="display" style="font-size:21px;font-weight:700">Calle de Prueba 1</span>
        <span style="font-size:13px;color:var(--muted)">Madrid · Sesión presencial</span>
      </div>
    </div>
  </div>
  <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">
    <button class="ghost">${svg(ic.cal, 17)} Añadir a mi calendario</button>
    <button class="ghost">Gestionar mi cita</button>
    <button class="ghost" style="color:#a3352b;border-color:color-mix(in srgb,#a3352b 30%,transparent)">Cancelar cita</button>
  </div>
</main>
${footer('¿Te surge algo? Responde al WhatsApp y lo cambiamos al momento.')}`,
});

/* ── Móvil ────────────────────────────────────────────────────────────── */
const diaM = (n, estado) => estado === 'off'
  ? `<span style="height:44px;display:grid;place-items:center;font-size:15px;color:color-mix(in srgb,var(--muted) 45%,transparent)">${n}</span>`
  : estado === 'sel'
    ? `<span style="height:44px;display:grid;place-items:center;border-radius:13px;font-weight:700;font-size:15px;background:var(--l1);color:#fff">${n}</span>`
    : `<span style="height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:13px;border:1px solid var(--line);background:var(--card);font-size:15px">${n}<span style="width:4px;height:4px;border-radius:50%;background:var(--acc)"></span></span>`;

artboard({
  file: 'Movil.dc.html', props: BRAND_PROPS, logic: BRAND_LOGIC, w: 390, h: 844, pad: 18, selloEscala: 0.68,
  body: `<div style="display:flex;align-items:center;gap:11px;margin-bottom:18px">
  <span style="width:42px;height:42px;flex:none;border-radius:13px;display:grid;place-items:center;
    background:linear-gradient(135deg,var(--l1),var(--l2));color:#fff;font-family:'Cabinet Grotesk',sans-serif;font-size:15px;font-weight:800">DE</span>
  <span style="display:flex;flex-direction:column">
    <span class="display" style="font-size:17px;font-weight:800">Diálogos que Enseñan</span>
    <span style="font-size:12px;color:var(--muted)">Sesión presencial · 30 min</span>
  </span>
</div>
<div style="position:relative;overflow:hidden;display:flex;flex-direction:column;gap:16px;padding:18px;border-radius:20px;
  background:var(--card);border:1px solid var(--line)">
  <div style="display:flex;align-items:center;justify-content:space-between">
    <span class="display" style="font-size:16px;font-weight:700;text-transform:capitalize">septiembre 2026</span>
    <span style="display:flex;gap:6px">
      <span style="width:34px;height:34px;display:grid;place-items:center;border-radius:11px;border:1px solid var(--line);color:color-mix(in srgb,var(--muted) 55%,transparent)">${svg('<path d="m14 5-7 7 7 7"/>', 16)}</span>
      <span style="width:34px;height:34px;display:grid;place-items:center;border-radius:11px;border:1px solid var(--line)">${svg('<path d="m10 5 7 7-7 7"/>', 16)}</span>
    </span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(7, minmax(0, 1fr));gap:5px">
    ${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => `<span style="text-align:center;font-size:10px;letter-spacing:.08em;color:var(--muted)">${d}</span>`).join('')}
    <span></span>${[1, 2, 3, 4, 5, 6].map((n) => diaM(n, 'off')).join('')}
    ${[7, 8, 9, 10, 11, 12, 13].map((n) => diaM(n, 'off')).join('')}
    ${[14, 15].map((n) => diaM(n, 'off')).join('')}${diaM(16, 'sel')}${[17, 18, 19, 20].map((n) => diaM(n, 'on')).join('')}
    ${[21, 22, 23, 24, 25, 26, 27].map((n) => diaM(n, 'on')).join('')}
    ${[28, 29, 30].map((n) => diaM(n, 'on')).join('')}
  </div>
</div>
<div style="display:flex;flex-direction:column;gap:12px;margin-top:20px">
  <span class="display" style="font-size:16px;font-weight:700">Miércoles 16 · 8 horas libres</span>
  <span class="kicker">Mañana</span>
  <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:8px">
    ${['09:00', '09:30', '10:00'].map((h, i) => `<span style="height:46px;display:grid;place-items:center;border-radius:13px;font-size:15px;font-weight:500;${i === 2 ? 'background:color-mix(in srgb,var(--l1) 10%,var(--card));color:var(--l1);border:1px solid color-mix(in srgb,var(--l1) 38%,transparent);font-weight:700' : 'background:var(--card);border:1px solid var(--line)'}">${h}</span>`).join('')}
    ${['10:30', '11:00', '11:30'].map((h) => `<span style="height:46px;display:grid;place-items:center;border-radius:13px;font-size:15px;font-weight:500;background:var(--card);border:1px solid var(--line)">${h}</span>`).join('')}
  </div>
  <span class="kicker" style="margin-top:4px">Tarde</span>
  <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:8px">
    ${['16:00', '16:30', '17:00', '17:30', '18:00', '18:30'].map((h) => `<span style="height:46px;display:grid;place-items:center;border-radius:13px;font-size:15px;font-weight:500;background:var(--card);border:1px solid var(--line)">${h}</span>`).join('')}
  </div>
</div>
<button class="cta" style="width:100%;margin-top:22px">Continuar con las 10:00</button>
<div style="display:flex;justify-content:center;margin-top:18px">${marca()}</div>`,
});

/* ── Gestión de la cita (enlace con token) ────────────────────────────── */
artboard({
  file: 'Gestion.dc.html', props: BRAND_PROPS, logic: BRAND_LOGIC, w: 1040, h: 620,
  body: `${header({ paso: 0 })}
<main style="display:grid;grid-template-columns:1.2fr .8fr;gap:28px;margin:32px 0 26px;align-items:start">
  <section style="position:relative;overflow:hidden;display:flex;flex-direction:column;gap:20px;padding:30px;border-radius:24px;
    background:var(--card);border:1px solid var(--line);box-shadow:0 24px 60px rgba(0,0,0,.06)">
    <div style="display:flex;align-items:center;gap:12px">
      <span style="display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 13px;border-radius:999px;font-size:12px;font-weight:500;
        background:color-mix(in srgb,#1f7a4d 14%,transparent);color:#1f7a4d">${svg(ic.check, 14)} Confirmada</span>
      <span style="font-size:13px;color:var(--muted)">Reservada el 15 de septiembre</span>
    </div>
    <h2 class="display" style="font-size:30px;font-weight:800;line-height:1.15">Miércoles 16 de septiembre<br>a las 10:00</h2>
    <div style="display:flex;gap:26px;flex-wrap:wrap">
      <span style="display:flex;align-items:center;gap:9px;font-size:14px"><span style="color:var(--l1)">${svg(ic.cal, 17)}</span> Sesión presencial · 30 min</span>
      <span style="display:flex;align-items:center;gap:9px;font-size:14px"><span style="color:var(--l1)">${svg(ic.pin, 17)}</span> Calle de Prueba 1, Madrid</span>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;padding-top:4px">
      <button class="cta" style="height:48px;font-size:15px">Cambiar la hora</button>
      <button class="ghost">${svg(ic.cal, 17)} Añadir a mi calendario</button>
      <button class="ghost" style="color:#a3352b;border-color:color-mix(in srgb,#a3352b 30%,transparent)">Cancelar</button>
    </div>
  </section>
  <aside style="display:flex;flex-direction:column;gap:14px;padding:24px;border-radius:24px;border:1px solid var(--line);
    background:linear-gradient(150deg,color-mix(in srgb,var(--l1) 9%,var(--card)),var(--card))">
    <span style="width:40px;height:40px;border-radius:12px;display:grid;place-items:center;color:#fff;background:var(--l1)">${svg(ic.wa, 20)}</span>
    <span class="display" style="font-size:18px;font-weight:700;line-height:1.25">¿Prefieres escribirnos?</span>
    <span style="font-size:14px;color:var(--muted);line-height:1.55">Responde al WhatsApp de la cita y lo cambiamos hablando, sin formularios.</span>
    <button class="ghost" style="align-self:flex-start">Abrir WhatsApp</button>
  </aside>
</main>
${footer('Este enlace es solo tuyo: no lo compartas.')}`,
});
console.log('resto: Datos, Confirmada, Movil, Gestion');
