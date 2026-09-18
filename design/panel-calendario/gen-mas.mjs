import { artboard, sidebar, V } from './_base.mjs';
import { ic, svg, vhead, tabs } from './_piezas.mjs';

/* ── Ajustes: conexión + horario + excepciones + confirmaciones ───────────── */
const hora = (v, vacio) => `<span style="display:inline-flex;align-items:center;justify-content:center;width:82px;height:34px;border-radius:8px;
  border:1px solid rgba(${V.ink},.10);background:${vacio ? 'transparent' : V.bg3};font-size:13.5px;font-variant-numeric:tabular-nums;
  color:${vacio ? `rgba(${V.ink},.28)` : V.white}">${v}</span>`;
const fila = (dia, tramos) => `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid ${V.line}">
  <span style="width:86px;flex:none;font-size:13.5px;font-weight:${tramos ? 700 : 400};color:${tramos ? V.white : V.muted}">${dia}</span>
  <span class="sw${tramos ? ' on' : ''}" style="width:38px;height:22px"><i style="width:16px;height:16px;top:3px;left:${tramos ? '19px' : '3px'}"></i></span>
  ${tramos
    ? `<span style="display:flex;align-items:center;gap:7px">${hora(tramos[0])}<span class="sm muted">a</span>${hora(tramos[1])}
       ${tramos[2] ? `<span class="sm muted" style="margin:0 2px">y</span>${hora(tramos[2])}<span class="sm muted">a</span>${hora(tramos[3])}`
      : `<button class="btn alt btnsm" type="button" style="margin-left:6px;display:inline-flex;align-items:center;gap:5px">${svg(ic.mas, 12)} Segundo tramo</button>`}</span>`
    : '<span class="sm muted">Cerrado</span>'}
</div>`;

artboard({
  file: 'Ajustes.dc.html', w: 1440, h: 1040,
  body: `${sidebar()}
<main style="flex:1;padding:26px 30px 40px;min-width:0">
  ${vhead('Cómo y cuándo puede Vai dar cita en Diálogos que Enseñan')}
  ${tabs('Ajustes')}

  <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:16px">
    <section class="panel">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div><h2 style="font-size:17px;font-weight:900">Horario en el que atendéis</h2>
          <p class="sm muted" style="margin-top:3px">Fuera de estas horas, Vai no ofrece cita. En blanco: lunes a viernes de 9:00 a 19:00.</p></div>
        <button class="btn alt btnsm" type="button">Copiar lunes a L-V</button>
      </div>
      ${fila('Lunes', ['09:00', '14:00', '16:00', '20:00'])}
      ${fila('Martes', ['09:00', '14:00'])}
      ${fila('Miércoles', ['09:00', '14:00', '16:00', '20:00'])}
      ${fila('Jueves', ['09:00', '14:00'])}
      ${fila('Viernes', ['09:00', '14:00'])}
      ${fila('Sábado', null)}
      ${fila('Domingo', null)}
      <div style="display:flex;align-items:center;gap:10px;margin-top:14px">
        <button class="btn" type="button">Guardar horario</button>
        <span class="sm muted">Afecta a las citas nuevas, no a las ya agendadas.</span>
      </div>
    </section>

    <div style="display:flex;flex-direction:column;gap:16px">
      <!-- Conexión: un estado, no dos botones sueltos junto a la navegación del mes -->
      <section class="panel" style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div style="display:flex;gap:11px">
            <span style="width:38px;height:38px;flex:none;border-radius:10px;display:grid;place-items:center;background:${V.bg3};color:${V.chipT}">${svg(ic.cal, 19)}</span>
            <span style="display:flex;flex-direction:column;gap:2px">
              <span style="font-weight:700;font-size:14px">Google Calendar</span>
              <span class="sm muted">hola@dialogosqueensenan.com · calendario «primary»</span>
            </span>
          </div>
          <span class="pill"><b style="background:${V.ok}"></b>Conectado</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:flex;flex-direction:column;gap:6px"><span class="sm muted">Zona horaria</span>
            <span style="background:${V.bg3};border:1px solid rgba(${V.ink},.10);border-radius:8px;padding:9px 12px;font-size:14px">Europe/Madrid</span></label>
          <label style="display:flex;flex-direction:column;gap:6px"><span class="sm muted">Duración por defecto</span>
            <span style="background:${V.bg3};border:1px solid rgba(${V.ink},.10);border-radius:8px;padding:9px 12px;font-size:14px">30 min</span></label>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn alt btnsm" type="button">Reconectar</button>
          <button class="btn alt btnsm" type="button" style="color:${V.bad};border-color:rgba(230,103,103,.35)">Desconectar</button>
        </div>
      </section>

      <!-- Excepciones: hoy es un formulario suelto bajo la lista -->
      <section class="panel" style="display:flex;flex-direction:column;gap:11px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div><h2 style="font-size:17px;font-weight:900">Festivos y días especiales</h2>
            <p class="sm muted" style="margin-top:3px">Ganan al horario: cierran el día o lo acortan.</p></div>
          <button class="btn alt btnsm" type="button" style="display:inline-flex;align-items:center;gap:6px">${svg(ic.mas, 13)} Añadir</button>
        </div>
        ${[['25 dic 2026', 'Cerrado', 'Navidad'], ['6 ene 2027', 'Cerrado', 'Reyes'], ['24 dic 2026', '09:00 – 13:00', 'Nochebuena']].map(([f, q, n]) => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:10px;background:${V.bg2};border:1px solid ${V.line}">
          <span style="width:92px;flex:none;font-size:13px;font-weight:500">${f}</span>
          <span class="chip">${q}</span>
          <span class="sm muted" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</span>
          <span style="color:rgba(${V.ink},.45);cursor:pointer">${svg(ic.puntos, 17)}</span>
        </div>`).join('')}
      </section>

      <!-- Confirmaciones: estado del addon, sin párrafo largo -->
      <section class="panel" style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div style="display:flex;gap:11px">
            <span style="width:38px;height:38px;flex:none;border-radius:10px;display:grid;place-items:center;background:${V.bg3};color:${V.chipT}">${svg(ic.wa, 19)}</span>
            <span style="display:flex;flex-direction:column;gap:2px">
              <span style="font-weight:700;font-size:14px">Recordatorio por WhatsApp</span>
              <span class="sm muted">24 h antes, con botones para confirmar o cancelar</span>
            </span>
          </div>
          <span class="pill"><b style="background:${V.ok}"></b>Activo</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="chip">Plantilla aprobada por Meta</span>
          <span class="chip">Antelación: 24 h</span>
          <a href="#" class="sm">Pedir cambio</a>
        </div>
      </section>
    </div>
  </div>
</main>`,
});

/* ── Diálogo de servicio ──────────────────────────────────────────────────── */
const opcion = (texto, icono, sel) => `<span style="flex:1;display:flex;align-items:center;justify-content:center;gap:7px;height:44px;border-radius:10px;font-size:13.5px;
  ${sel ? `background:rgba(255,107,26,.10);border:1px solid ${V.orange};color:${V.chipT};font-weight:700` : `background:${V.bg3};border:1px solid rgba(${V.ink},.10);color:${V.muted}`}">${svg(icono, 16)}${texto}</span>`;

artboard({
  file: 'Servicio.dc.html', w: 860, h: 720, bg: 'rgba(39,30,25,.45)',
  body: `<div style="flex:1;display:grid;place-items:center;padding:28px">
  <div style="width:100%;max-width:620px;background:${V.bg2};border:1px solid ${V.border};border-radius:${V.r};padding:24px 26px;box-shadow:0 24px 70px rgba(39,30,25,.25);display:flex;flex-direction:column;gap:16px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between">
      <div><h2 style="font-size:20px;font-weight:900">Editar servicio</h2>
        <p class="sm muted" style="margin-top:4px">Así lo verá el cliente en la primera pantalla de la reserva.</p></div>
      <span style="color:${V.muted};font-size:20px;cursor:pointer">✕</span>
    </div>
    <label style="display:flex;flex-direction:column;gap:6px"><span class="sm muted">Nombre</span>
      <span style="background:${V.bg3};border:1px solid rgba(${V.ink},.10);border-radius:8px;padding:10px 12px;font-size:14px">Sesión presencial</span></label>
    <label style="display:flex;flex-direction:column;gap:6px"><span class="sm muted">Descripción (opcional)</span>
      <span style="background:${V.bg3};border:1px solid rgba(${V.ink},.10);border-radius:8px;padding:10px 12px;font-size:14px;color:rgba(${V.ink},.45)">Una línea que ayude a elegir</span></label>
    <div style="display:flex;flex-direction:column;gap:8px">
      <span class="sm muted">Modalidad</span>
      <div style="display:flex;gap:8px">${opcion('Presencial', ic.pin, true)}${opcion('Vídeo', ic.video, false)}${opcion('Teléfono', ic.tel, false)}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <span class="sm muted">Duración</span>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${[15, 30, 45, 60, 90].map((m) => `<span style="height:38px;padding:0 16px;display:grid;place-items:center;border-radius:999px;font-size:13.5px;
          ${m === 30 ? `background:${V.orange};color:#fff;font-weight:700` : `background:${V.bg3};border:1px solid rgba(${V.ink},.10);color:${V.muted}`}">${m} min</span>`).join('')}
        <span style="height:38px;padding:0 16px;display:grid;place-items:center;border-radius:999px;font-size:13.5px;background:${V.bg3};border:1px dashed rgba(${V.ink},.22);color:${V.muted}">Otra</span>
      </div>
    </div>
    <label style="display:flex;flex-direction:column;gap:6px"><span class="sm muted">Dónde</span>
      <span style="background:${V.bg3};border:1px solid rgba(${V.ink},.10);border-radius:8px;padding:10px 12px;font-size:14px">Calle de Prueba 1, Madrid</span></label>
    <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:10px;background:${V.surface};border:1px solid ${V.line}">
      <span class="sw on"><i></i></span>
      <span style="flex:1;display:flex;flex-direction:column">
        <span style="font-size:13.5px;font-weight:700">Visible en la página</span>
        <span class="sm muted">Ocúltalo para dejar de ofrecerlo sin borrar sus citas.</span>
      </span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:4px">
      <button class="btn alt btnsm" type="button" style="color:${V.bad};border-color:rgba(230,103,103,.35)">Eliminar</button>
      <span style="display:flex;gap:8px"><button class="btn alt" type="button">Cancelar</button><button class="btn" type="button">Guardar servicio</button></span>
    </div>
  </div>
</div>`,
});

/* ── Móvil ────────────────────────────────────────────────────────────────── */
artboard({
  file: 'Movil.dc.html', w: 390, h: 940,
  body: `<main style="flex:1;padding:16px 14px 26px;min-width:0;display:flex;flex-direction:column;gap:14px">
  <div style="display:flex;align-items:center;justify-content:space-between">
    <h1 style="font-size:21px;font-weight:900">Calendario</h1>
    <span class="chip">Diálogos ▾</span>
  </div>
  <div class="chtabs" style="width:100%">
    <button type="button" class="chtab" style="flex:1">Agenda</button>
    <button type="button" class="chtab on" style="flex:1">Reservas</button>
    <button type="button" class="chtab" style="flex:1">Ajustes</button>
  </div>
  <section class="panel" style="padding:14px 15px;display:flex;flex-direction:column;gap:12px">
    <div style="display:flex;align-items:center;gap:11px">
      <span class="sw on"><i></i></span>
      <span style="display:flex;flex-direction:column">
        <span style="font-weight:700;font-size:14px">Página activa</span>
        <span class="sm muted">Reservan sin escribirte</span>
      </span>
    </div>
    <div style="display:flex;align-items:center;gap:7px;padding:9px 11px;border-radius:10px;background:${V.bg3};border:1px solid ${V.line}">
      <span style="flex:1;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">citas.hirevai.com/dialogos/reservas</span>
      <span style="color:${V.muted}">${svg(ic.copy, 16)}</span>
      <span style="color:${V.muted}">${svg(ic.qr, 16)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:${V.amberT}">${svg(ic.alert, 14)} Falta autorizar su dominio</div>
  </section>
  <section class="panel" style="padding:14px 15px;display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <h2 style="font-size:15px;font-weight:900">Servicios</h2>
      <button class="btn btnsm" type="button">Añadir</button>
    </div>
    ${[['Sesión presencial', '30 min · Presencial', true], ['Sesión por vídeo', '30 min · Vídeo', true], ['Llamada rápida', '15 min · Teléfono', false]].map(([n, m, on]) => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 11px;border-radius:11px;background:${V.bg2};border:1px solid ${V.line}">
      <span style="width:34px;height:34px;flex:none;border-radius:9px;display:grid;place-items:center;background:${V.bg3};color:${V.chipT}">${svg(ic.pin, 16)}</span>
      <span style="flex:1;display:flex;flex-direction:column;min-width:0">
        <span style="font-size:13.5px;font-weight:700">${n}</span><span class="sm muted">${m}</span>
      </span>
      <span class="pill"><b style="background:${on ? V.ok : `rgba(${V.ink},.30)`}"></b>${on ? 'Activo' : 'Oculto'}</span>
    </div>`).join('')}
  </section>
  <section class="panel" style="padding:14px 15px;display:flex;flex-direction:column;gap:10px">
    <h2 style="font-size:15px;font-weight:900">Reglas</h2>
    ${[['Antelación mínima', '2 horas'], ['Se reserva hasta', '60 días'], ['Nota de cabecera', 'Sin nota']].map(([l, v]) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid ${V.line}">
      <span class="sm muted">${l}</span><span style="font-size:13.5px;font-weight:500">${v} ›</span></div>`).join('')}
  </section>
</main>`,
});
console.log('Ajustes + Servicio + Movil');
