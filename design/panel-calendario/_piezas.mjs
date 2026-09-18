import { V } from './_base.mjs';
export const ic = {
  pin:'M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6"/>',
  video:'M3 7.5A2.5 2.5 0 0 1 5.5 5h7A2.5 2.5 0 0 1 15 7.5v9A2.5 2.5 0 0 1 12.5 19h-7A2.5 2.5 0 0 1 3 16.5Zm12 4.5 6-3.4v10.8Z',
  tel:'M6.5 3.5h3l1.5 4-2 1.6a12 12 0 0 0 5.9 5.9l1.6-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z',
  cal:'M3.5 8h17M8 3v4m8-4v4M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5Z',
  check:'m5 13 4.5 4.5L19 7',
  alert:'M12 8.5v5m0 3.2v.1M10.3 4l-7 12A2 2 0 0 0 5 19h14a2 2 0 0 0 1.7-3l-7-12a2 2 0 0 0-3.4 0Z',
  copy:'M9 9h9.5A1.5 1.5 0 0 1 20 10.5V20a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 20v-9.5A1.5 1.5 0 0 1 9 9Z" /><path d="M4.5 15V5A1.5 1.5 0 0 1 6 3.5h9.5',
  qr:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM17.5 14H20M14 17.5v2.5',
  abrir:'M14 4h6v6M20 4l-8.5 8.5M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5h5',
  drag:'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  mas:'M12 5v14M5 12h14',
  wa:'M4 20l1.3-4a7.8 7.8 0 1 1 3 2.8L4 20Z',
  reloj:'M12 7.5V12l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  mundo:'M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  puntos:'M6 12h.01M12 12h.01M18 12h.01',
};
export const svg = (d, s = 18, color = 'currentColor') =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

export const vhead = (sub) => `<div class="vhead">
  <div><h1>Calendario</h1><p>${sub}</p></div>
  <div style="display:flex;align-items:center;gap:10px">
    <span style="position:relative;display:inline-flex">
      <span style="appearance:none;background:${V.bg2};color:rgba(${V.ink},.80);border:1px solid rgba(${V.ink},.10);border-radius:${V.rsm};padding:10px 32px 10px 13px;font-size:13px">Diálogos que Enseñan</span>
      <span style="position:absolute;right:13px;top:50%;width:7px;height:7px;border-right:1.5px solid rgba(${V.ink},.45);border-bottom:1.5px solid rgba(${V.ink},.45);transform:translateY(-70%) rotate(45deg)"></span>
    </span>
  </div>
</div>`;

export const tabs = (activa) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px">
  <div class="chtabs">
    ${['Agenda', 'Reservas online', 'Ajustes'].map((t) => `<button type="button" class="chtab${t === activa ? ' on' : ''}">${t}</button>`).join('')}
  </div>
</div>`;
