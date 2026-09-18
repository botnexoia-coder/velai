import { artboard, sidebar, V } from './_base.mjs';
import { ic, svg, vhead, tabs } from './_piezas.mjs';

/* ── Reservas online ──────────────────────────────────────────────────────── */
const requisito = (ok, texto, accion) => `<div style="display:flex;align-items:center;gap:9px;font-size:13px">
  <span style="width:18px;height:18px;flex:none;border-radius:50%;display:grid;place-items:center;
    background:${ok ? 'rgba(25,158,112,.14)' : 'rgba(255,170,0,.16)'};color:${ok ? V.ok : V.amberT}">${svg(ok ? ic.check : ic.alert, 11)}</span>
  <span style="color:${ok ? V.white : V.amberT}">${texto}</span>
  ${accion ? `<a href="#" style="font-size:12.5px">${accion}</a>` : ''}
</div>`;

const servicio = (nombre, min, modo, lugar, activo) => `<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;
  background:${V.bg2};border:1px solid ${V.line}">
  <span style="color:rgba(${V.ink},.28);cursor:grab">${svg(ic.drag, 18)}</span>
  <span style="width:38px;height:38px;flex:none;border-radius:10px;display:grid;place-items:center;background:${V.bg3};color:${V.chipT}">${svg(ic[modo === 'Presencial' ? 'pin' : modo === 'Vídeo' ? 'video' : 'tel'], 18)}</span>
  <span style="flex:1;display:flex;flex-direction:column;gap:2px;min-width:0">
    <span style="font-weight:700;font-size:14px">${nombre}</span>
    <span class="sm muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${min} min · ${modo}${lugar ? ' · ' + lugar : ''}</span>
  </span>
  ${activo ? `<span class="pill"><b style="background:${V.ok}"></b>Activo</span>` : `<span class="pill"><b style="background:rgba(${V.ink},.30)"></b>Oculto</span>`}
  <button class="btn alt btnsm" type="button">Editar</button>
  <span style="color:rgba(${V.ink},.45);padding:0 2px;cursor:pointer">${svg(ic.puntos, 18)}</span>
</div>`;

const campo = (label, valor, ancho = '100%', select = false) => `<label style="display:flex;flex-direction:column;gap:6px;width:${ancho}">
  <span class="sm muted">${label}</span>
  <span style="display:flex;align-items:center;justify-content:space-between;background:${V.bg3};border:1px solid rgba(${V.ink},.10);border-radius:8px;padding:9px 12px;font-size:14px">
    ${valor}${select ? `<span style="width:6px;height:6px;border-right:1.5px solid rgba(${V.ink},.45);border-bottom:1.5px solid rgba(${V.ink},.45);transform:rotate(45deg) translateY(-2px)"></span>` : ''}
  </span>
</label>`;

artboard({
  file: 'Main.dc.html', w: 1440, h: 1180,
  body: `${sidebar()}
<main style="flex:1;padding:26px 30px 40px;min-width:0">
  ${vhead('Reservas online de Diálogos que Enseñan')}
  ${tabs('Reservas online')}

  <!-- Estado: lo primero es si la página está viva, con qué enlace y qué le falta -->
  <section class="panel" style="display:grid;grid-template-columns:1.35fr 1fr;gap:26px;margin-bottom:16px">
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:12px">
        <span class="sw on"><i></i></span>
        <span style="display:flex;flex-direction:column">
          <span style="font-weight:700;font-size:15px">Página de reservas activa</span>
          <span class="sm muted">Tus clientes pueden reservar sin escribirte. Apágala y el enlace deja de existir.</span>
        </span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:${V.rsm};background:${V.bg3};border:1px solid ${V.line}">
        <span style="color:${V.muted}">${svg(ic.mundo, 17)}</span>
        <span style="flex:1;font-size:13.5px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">citas.hirevai.com/dialogos/reservas</span>
        <button class="btn alt btnsm" type="button" style="display:inline-flex;align-items:center;gap:6px">${svg(ic.copy, 14)} Copiar</button>
        <button class="btn alt btnsm" type="button" style="display:inline-flex;align-items:center;gap:6px">${svg(ic.qr, 14)} QR</button>
        <button class="btn alt btnsm" type="button" style="display:inline-flex;align-items:center;gap:6px">${svg(ic.abrir, 14)} Abrir</button>
      </div>
      <span class="sm muted">La página usa el logo y los colores de la ficha del cliente, y lleva el distintivo «Tecnología Velai».</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;padding-left:26px;border-left:1px solid ${V.line}">
      <span class="lbl">Antes de compartir el enlace</span>
      ${requisito(true, 'Google Calendar conectado')}
      ${requisito(true, '3 servicios activos')}
      ${requisito(true, 'Horario definido (L-V)')}
      ${requisito(false, 'El dominio de su web no está autorizado', 'Añadirlo')}
    </div>
  </section>

  <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:16px;margin-bottom:16px">
    <!-- Servicios: tarjetas manipulables, no líneas de texto con el «orden 10» a la vista -->
    <section class="panel">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div><h2 style="font-size:17px;font-weight:900">Servicios</h2>
          <p class="sm muted" style="margin-top:3px">Lo que el cliente elige primero. Arrastra para ordenarlos.</p></div>
        <button class="btn" type="button" style="display:inline-flex;align-items:center;gap:7px">${svg(ic.mas, 15, '#fff')} Añadir</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${servicio('Sesión presencial', 30, 'Presencial', 'Calle de Prueba 1, Madrid', true)}
        ${servicio('Sesión por vídeo', 30, 'Vídeo', 'Enlace al confirmar', true)}
        ${servicio('Llamada rápida', 15, 'Teléfono', '', false)}
      </div>
    </section>

    <!-- Reglas: cada campo con su unidad y su consecuencia dicha en una línea -->
    <section class="panel" style="display:flex;flex-direction:column;gap:14px">
      <div><h2 style="font-size:17px;font-weight:900">Reglas</h2>
        <p class="sm muted" style="margin-top:3px">Qué huecos se ofrecen y con cuánta antelación.</p></div>
      ${campo('Antelación mínima', '2 horas', '100%', true)}
      ${campo('Se puede reservar hasta', '60 días vista', '100%', true)}
      <label style="display:flex;flex-direction:column;gap:6px">
        <span class="sm muted">Nota bajo el nombre del negocio (opcional)</span>
        <span style="min-height:64px;background:${V.bg3};border:1px solid rgba(${V.ink},.10);border-radius:8px;padding:9px 12px;font-size:14px;color:rgba(${V.ink},.45)">Ej.: «Las sesiones son en español»</span>
      </label>
      <div style="display:flex;align-items:center;gap:10px;margin-top:2px">
        <button class="btn" type="button">Guardar</button>
        <span class="sm muted">Se aplica al instante en la página.</span>
      </div>
    </section>
  </div>

  <!-- Insertar: un solo bloque, con la forma elegida arriba -->
  <section class="panel">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px;flex-wrap:wrap">
      <div><h2 style="font-size:17px;font-weight:900">Ponlo en su web</h2>
        <p class="sm muted" style="margin-top:3px">Copia una línea y pégala donde quiera que aparezca.</p></div>
      <div class="chtabs">
        <button type="button" class="chtab">Solo el enlace</button>
        <button type="button" class="chtab on">Calendario integrado</button>
        <button type="button" class="chtab">Botón emergente</button>
      </div>
    </div>
    <div style="display:flex;gap:16px;align-items:stretch;flex-wrap:wrap">
      <div style="flex:1;min-width:380px;position:relative;background:${V.bg3};border:1px solid ${V.line};border-radius:12px;padding:14px 16px">
        <button class="btn alt btnsm" type="button" style="position:absolute;top:10px;right:10px;display:inline-flex;align-items:center;gap:6px">${svg(ic.copy, 13)} Copiar</button>
        <code style="display:block;font-size:12.5px;line-height:1.9;color:rgba(${V.ink},.78);white-space:pre-wrap;padding-right:90px">&lt;div data-vai-citas="dialogos"&gt;&lt;/div&gt;
&lt;script src="https://hirevai.com/assets/vai-citas.js?v=18" defer&gt;&lt;/script&gt;</code>
        <div style="display:flex;align-items:center;gap:8px;margin-top:12px">
          <span class="sm" style="color:${V.amberT};display:inline-flex;align-items:center;gap:6px">${svg(ic.alert, 14)} dialogosqueensenan.com no está autorizado todavía</span>
          <a href="#" class="sm">Autorizar dominio</a>
        </div>
      </div>
      <div style="width:300px;flex:none;border:1px solid ${V.line};border-radius:12px;padding:12px;background:${V.bg2}">
        <span class="lbl" style="display:block;margin-bottom:8px">Así se verá</span>
        <div style="border:1px solid ${V.line};border-radius:9px;padding:10px;display:flex;flex-direction:column;gap:7px;background:#f7f4ef">
          <span style="font-family:'Cabinet Grotesk',sans-serif;font-size:12px;font-weight:700;color:#172033">Diálogos que Enseñan</span>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">
            ${Array.from({ length: 14 }, (_, i) => `<span style="height:16px;border-radius:4px;background:${i === 9 ? '#5AA0FF' : '#fff'};border:1px solid rgba(23,32,51,.08)"></span>`).join('')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">
            ${['09:00', '10:00', '10:30'].map((h) => `<span style="height:18px;border-radius:5px;border:1px solid rgba(23,32,51,.08);background:#fff;font-size:8px;display:grid;place-items:center;color:#5b6472">${h}</span>`).join('')}
          </div>
        </div>
      </div>
    </div>
  </section>
</main>`,
});

/* ── Agenda ───────────────────────────────────────────────────────────────── */
const metrica = (n, etiqueta, color) => `<div class="panel" style="padding:14px 16px;display:flex;flex-direction:column;gap:3px">
  <span style="font-family:'Cabinet Grotesk',sans-serif;font-size:26px;font-weight:900;letter-spacing:-.02em;color:${color || V.white}">${n}</span>
  <span class="sm muted">${etiqueta}</span>
</div>`;

const cita = (hora, nombre, servicio, canal, estado) => {
  const col = estado === 'cancelada' ? V.bad : estado === 'confirmada' ? V.ok : V.amber;
  return `<div style="display:flex;gap:12px;padding:11px 0;border-bottom:1px solid ${V.line}">
    <span style="width:52px;flex:none;font-weight:700;font-size:13.5px;font-variant-numeric:tabular-nums;${estado === 'cancelada' ? `color:${V.muted};text-decoration:line-through` : ''}">${hora}</span>
    <span style="flex:1;display:flex;flex-direction:column;gap:2px;min-width:0">
      <span style="font-size:13.5px;font-weight:500;${estado === 'cancelada' ? `color:${V.muted}` : ''}">${nombre}</span>
      <span class="sm muted">${servicio}</span>
      <span style="display:flex;align-items:center;gap:6px;margin-top:3px">
        <span class="chip" style="font-size:11px;padding:2px 9px">${canal}</span>
        <span class="pill" style="font-size:11px;padding:3px 9px"><b style="background:${col}"></b>${estado === 'confirmada' ? 'Confirmada' : estado === 'cancelada' ? 'Cancelada' : 'Sin confirmar'}</span>
      </span>
  </div>`;
};

const dia = (n, citas, sel, fuera) => {
  if (fuera) return `<div style="background:${V.bg2};min-height:92px;padding:6px 7px"><span class="sm" style="color:rgba(${V.ink},.25)">${n}</span></div>`;
  return `<div style="background:${V.bg2};min-height:92px;padding:6px 7px;display:flex;flex-direction:column;gap:3px;${sel ? `box-shadow:inset 0 0 0 2px ${V.orange}` : ''}">
    <span style="font-size:12.5px;font-weight:${sel ? 700 : 500};width:21px;height:21px;display:grid;place-items:center;border-radius:50%;${sel ? `background:${V.orange};color:#fff` : ''}">${n}</span>
    ${citas.map((c) => `<span style="display:flex;align-items:center;gap:5px;font-size:11px;padding:2px 6px;border-radius:5px;background:rgba(${V.ink},.04);${c[2] === 'cancelada' ? `color:${V.muted};text-decoration:line-through` : ''}">
      <b style="width:5px;height:5px;border-radius:50%;flex:none;background:${c[2] === 'cancelada' ? V.bad : c[2] === 'confirmada' ? V.ok : V.amber}"></b>
      <span style="font-variant-numeric:tabular-nums">${c[0]}</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c[1]}</span></span>`).join('')}
  </div>`;
};

artboard({
  file: 'Agenda.dc.html', w: 1440, h: 1000,
  body: `${sidebar()}
<main style="flex:1;padding:26px 30px 40px;min-width:0">
  ${vhead('Citas de Diálogos que Enseñan, agendadas por Vai o por su página de reservas')}
  ${tabs('Agenda')}

  <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px">
    ${metrica('7', 'Citas esta semana')}
    ${metrica('5', 'Confirmadas por el cliente', V.ok)}
    ${metrica('2', 'Sin confirmar', V.amberT)}
    ${metrica('1', 'Cancelada', V.bad)}
  </div>

  <div style="display:grid;grid-template-columns:1fr 340px;gap:16px">
    <section class="panel" style="padding:16px 18px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn alt btnsm" type="button">Hoy</button>
          <button class="btn alt btnsm" type="button" aria-label="Mes anterior">‹</button>
          <b style="font-size:16px;min-width:150px;text-align:center">Septiembre 2026</b>
          <button class="btn alt btnsm" type="button" aria-label="Mes siguiente">›</button>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="chip" style="display:inline-flex;align-items:center;gap:6px">${svg(ic.cal, 13)} hola@dialogosqueensenan.com</span>
          <span style="color:rgba(${V.ink},.45);cursor:pointer">${svg(ic.puntos, 18)}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:${V.line};border:1px solid ${V.line};border-radius:${V.rsm};overflow:hidden">
        ${['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'].map((d) => `<div style="background:${V.bg2};font-size:10.5px;color:${V.muted};letter-spacing:.07em;text-align:center;padding:7px 0">${d}</div>`).join('')}
        ${dia(31, [], false, true)}
        ${[1, 2, 3, 4, 5, 6].map((n) => dia(n, [], false, false)).join('')}
        ${[7, 8, 9, 10, 11, 12, 13].map((n) => dia(n, [], false, false)).join('')}
        ${[14, 15].map((n) => dia(n, [], false, false)).join('')}
        ${dia(16, [['10:00', 'Ana Pérez', 'confirmada'], ['12:00', 'Luis Gómez', 'pendiente']], true, false)}
        ${dia(17, [['09:00', 'María Ruiz', 'cancelada']], false, false)}
        ${dia(18, [['16:00', 'Pedro Sanz', 'pendiente'], ['17:00', 'Carla Vidal', 'confirmada']], false, false)}
        ${[19, 20].map((n) => dia(n, [], false, false)).join('')}
        ${[21, 22, 23, 24, 25, 26, 27].map((n) => dia(n, [], false, false)).join('')}
        ${[28, 29, 30].map((n) => dia(n, [], false, false)).join('')}
        ${[1, 2, 3, 4].map((n) => dia(n, [], false, true)).join('')}
      </div>
    </section>

    <!-- El día elegido, SIEMPRE a la vista: hoy hay que tocar y aparece debajo del mes -->
    <aside class="panel" style="padding:16px 18px;display:flex;flex-direction:column;gap:4px;align-self:start">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px">
        <h2 style="font-size:17px;font-weight:900">Miércoles 16</h2>
        <span class="sm muted">2 citas</span>
      </div>
      ${cita('10:00', 'Ana Pérez', 'Sesión presencial', 'Página de reservas', 'confirmada')}
      ${cita('12:00', 'Luis Gómez', 'Llamada rápida', 'WhatsApp', 'pendiente')}
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid ${V.line}">
        <span class="lbl">Ana Pérez · 10:00</span>
        <div style="display:flex;flex-direction:column;gap:7px">
          <span class="sm" style="display:flex;align-items:center;gap:8px">${svg(ic.tel, 15)} +34 612 345 678</span>
          <span class="sm" style="display:flex;align-items:center;gap:8px">${svg(ic.pin, 15)} Calle de Prueba 1, Madrid</span>
          <span class="sm" style="display:flex;align-items:center;gap:8px">${svg(ic.wa, 15)} Recordatorio enviado ayer 10:04</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn alt btnsm" type="button">Abrir conversación</button>
          <button class="btn alt btnsm" type="button">Cancelar cita</button>
        </div>
      </div>
    </aside>
  </div>
</main>`,
});
console.log('Main + Agenda');
