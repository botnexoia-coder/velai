import { BOOKING_HEADERS, frameOrigins } from './booking-security.js';

export function appointmentIcs(appt) {
  const esc = (v) => String(v || '').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  const stamp = (v) => new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Velai//Reservas//ES','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${appt.id}@hirevai.com`,`DTSTAMP:${stamp(appt.created_at)}`,`DTSTART:${stamp(appt.starts_at)}`,`DTEND:${stamp(appt.ends_at)}`,`SUMMARY:${esc(appt.service_name || appt.reason || 'Cita')}`,`LOCATION:${esc(appt.service_location || appt.location)}`,`STATUS:${appt.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,'END:VEVENT','END:VCALENDAR'];
  return lines.map((line) => {
    let bytes = 0, folded = '';
    for (const char of line) { const n = new TextEncoder().encode(char).length; if (bytes+n>75) { folded+='\r\n '; bytes=1; } folded+=char; bytes+=n; }
    return folded;
  }).join('\r\n')+'\r\n';
}

// Hoja de estilo del rediseño aprobado (lienzo «Reservas Velai», 2026-09-15). Las piezas
// que la gobiernan, para no reinventarlas al tocar aquí:
//  · Tipografías de marca servidas desde hirevai.com (las mismas del sitio; el CSP lleva
//    font-src para ese origen y Pages las sirve con CORS).
//  · Tokens con el MISMO contrato que el widget: --l1/--l2/--acc los pisa la marca del
//    cliente en reservationApp. El color va con cuentagotas — degradado SOLO en el botón
//    principal; día elegido en plano; hora elegida en tinte. Es lo que lo aleja del look
//    saturado y del azul de Calendly.
const CSS = `
@font-face{font-family:'Cabinet Grotesk';src:url(https://hirevai.com/fonts/cabinet-grotesk-700.woff2) format('woff2');font-weight:700;font-display:swap}
@font-face{font-family:'Cabinet Grotesk';src:url(https://hirevai.com/fonts/cabinet-grotesk-800.woff2) format('woff2');font-weight:800;font-display:swap}
@font-face{font-family:'Satoshi';src:url(https://hirevai.com/fonts/satoshi-400.woff2) format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'Satoshi';src:url(https://hirevai.com/fonts/satoshi-500.woff2) format('woff2');font-weight:500;font-display:swap}
:root{color-scheme:light dark;--l1:#b83e08;--l2:#662a16;--acc:#ff914f;--bg:#f6f5f2;--card:#fff;--ink:#172033;--muted:#5b6472;--line:rgba(23,32,51,.10);--in:#eeece7;--bad:#a3352b}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#151b27;--card:#1b2230;--ink:#fff;--muted:#ced7e5;--line:rgba(255,255,255,.10);--in:#182030;--bad:#ff9d92}}
:root[data-theme=dark]{--bg:#151b27;--card:#1b2230;--ink:#fff;--muted:#ced7e5;--line:rgba(255,255,255,.10);--in:#182030;--bad:#ff9d92}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 'Satoshi',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1040px;margin:0 auto;padding:28px 16px 36px}
h1,h2,h3{font-family:'Cabinet Grotesk','Satoshi',system-ui,sans-serif;letter-spacing:-.01em;margin:0}
p{margin:0}
a{color:var(--l1);text-decoration:none}a:hover{color:var(--l2)}
button,input,textarea{font:inherit;color:inherit}
button{cursor:pointer}
button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--acc);outline-offset:3px}
[hidden]{display:none!important}
.top{display:flex;align-items:center;gap:14px;margin-bottom:22px}
.mark{width:52px;height:52px;flex:none;border-radius:16px;display:grid;place-items:center;background:var(--l1);color:#fff;font-family:'Cabinet Grotesk',sans-serif;font-size:19px;font-weight:800}
#logo{width:52px;height:52px;flex:none;object-fit:contain;border-radius:16px;background:var(--card)}
.who{display:flex;flex-direction:column;gap:3px;min-width:0}
h1{font-size:24px;font-weight:800;line-height:1.1}
#note{font-size:13px;color:var(--muted)}
.velai{margin-left:auto;display:inline-flex;align-items:center;gap:9px;height:36px;padding:0 14px 0 11px;border:1px solid var(--line);border-radius:10px;background:var(--card);flex:none}
.velai:hover{color:inherit}
.velai i{display:grid;place-items:center;width:20px;height:20px;border-radius:6px;background:#172033;color:#fff}
.velai s{display:flex;flex-direction:column;line-height:1.15;text-decoration:none}
.velai u{font-size:8.5px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);text-decoration:none}
.velai b{font-family:'Cabinet Grotesk',sans-serif;font-size:13px;font-weight:800;color:var(--ink)}
.steps{display:flex;align-items:center;gap:10px;margin-bottom:24px}
.step{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);white-space:nowrap}
.step i{width:22px;height:22px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--in);color:var(--muted);font-size:11px;font-weight:700;font-style:normal}
.step.done i{background:color-mix(in srgb,var(--l1) 14%,var(--card));color:var(--l1)}
.step.on{color:var(--ink);font-weight:700}.step.on i{background:var(--l1);color:#fff}
.rule{flex:1;height:1px;background:var(--line);min-width:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:24px;padding:26px;box-shadow:0 24px 60px rgba(0,0,0,.06)}
.col{max-width:620px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
.stack{display:flex;flex-direction:column;gap:12px;width:100%}
.chips{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);font-size:13px;color:var(--muted)}
.chip.is-strong{color:var(--ink)}
.kick{font-size:11px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.svc{display:flex;align-items:center;gap:18px;width:100%;padding:18px 20px;text-align:left;border-radius:18px;border:1px solid var(--line);background:var(--card)}
.svc:hover{border-color:color-mix(in srgb,var(--l1) 40%,transparent)}
.svc i{width:52px;height:52px;flex:none;border-radius:15px;display:grid;place-items:center;background:var(--in);color:var(--l1)}
.svc s{flex:1;display:flex;flex-direction:column;gap:4px;text-decoration:none}
.svc b{font-family:'Cabinet Grotesk',sans-serif;font-size:18px;font-weight:700}
.svc small{font-size:14px;color:var(--muted)}
.monthbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.monthbar h2{font-size:18px;font-weight:700}
.nav{display:flex;gap:8px}
.nav button{width:38px;height:38px;border-radius:12px;border:1px solid var(--line);background:var(--card);display:grid;place-items:center;font-size:17px;line-height:1}
.nav button:disabled{color:color-mix(in srgb,var(--muted) 50%,transparent);cursor:default}
.grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px}
.weekday{text-align:center;font-size:11px;font-weight:500;letter-spacing:.1em;color:var(--muted);padding-bottom:2px}
.grid button{position:relative;height:46px;border-radius:14px;border:1px solid var(--line);background:var(--card);font-size:15px;font-weight:500}
.grid button:disabled{border-color:transparent;background:transparent;color:color-mix(in srgb,var(--muted) 45%,transparent);cursor:default}
.grid button.available::after{content:'';position:absolute;left:50%;bottom:7px;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:var(--acc)}
.grid button[aria-pressed=true]{background:var(--l1);border-color:var(--l1);color:#fff;font-weight:700}
.grid button[aria-pressed=true]::after{display:none}
.sep{height:1px;background:var(--line);margin:4px 0}
.dayhead{display:flex;flex-direction:column;gap:3px;margin-bottom:6px}
.dayhead h2{font-size:18px;font-weight:700}
.dayhead small{font-size:13px;color:var(--muted)}
.times{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:10px 0 16px}
.times button{min-height:46px;padding:4px 6px;border-radius:13px;border:1px solid var(--line);background:var(--card);font-size:15px;font-weight:500;line-height:1.25}
.times button:hover{border-color:color-mix(in srgb,var(--l1) 45%,transparent)}
.primary{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:52px;padding:0 28px;border:0;border-radius:999px;background:linear-gradient(135deg,var(--l1),var(--l2));color:#fff;font-family:'Cabinet Grotesk',sans-serif;font-size:16px;font-weight:700;box-shadow:0 8px 18px color-mix(in srgb,var(--l1) 18%,transparent)}
.ghost{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 20px;border:1px solid var(--line);border-radius:999px;background:var(--card);font-size:14px;font-weight:500}
.ghost.danger{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 30%,transparent)}
.link{background:none;border:0;padding:0;color:var(--l1);font-size:13px}
.two{display:grid;grid-template-columns:1.1fr .9fr;gap:24px;align-items:start}
.field{display:flex;flex-direction:column;gap:7px;margin-bottom:14px}
.field label{font-size:13px;font-weight:500;color:var(--muted)}
input:not([type=checkbox]),textarea{width:100%;min-height:50px;padding:13px 16px;border-radius:14px;border:1px solid transparent;background:var(--in);font-size:15px}
textarea{min-height:88px;resize:vertical}
input:not([type=checkbox]):focus,textarea:focus{background:var(--card);border-color:var(--acc);outline:none;box-shadow:0 0 0 4px color-mix(in srgb,var(--acc) 22%,transparent)}
.consent{display:flex;align-items:flex-start;gap:11px;font-size:13px;color:var(--muted);line-height:1.5;margin:4px 0 18px}
.consent input{width:20px;height:20px;flex:none;margin:1px 0 0;accent-color:var(--l1)}
.aside{display:flex;flex-direction:column;gap:14px;padding:24px;border-radius:24px;border:1px solid var(--line);background:linear-gradient(150deg,color-mix(in srgb,var(--l1) 9%,var(--card)),var(--card))}
.aside h3{font-size:26px;font-weight:800;line-height:1.15}
.aside .row{display:flex;align-items:center;gap:10px;font-size:14px}
.aside .row i{color:var(--l1);flex:none;display:grid;place-items:center}
.tag{padding:13px 15px;border-radius:4px 16px 16px 16px;background:color-mix(in srgb,var(--acc) 15%,transparent);border:1px solid color-mix(in srgb,var(--acc) 38%,transparent);font-size:13px;font-weight:500}
.hero{display:flex;flex-direction:column;align-items:center;gap:22px;text-align:center;padding:14px 0 6px}
.hero .tick{width:74px;height:74px;border-radius:50%;display:grid;place-items:center;background:var(--l1);color:#fff;box-shadow:0 0 0 10px color-mix(in srgb,var(--l1) 10%,transparent)}
.hero h2{font-size:30px;font-weight:800}
.hero p{font-size:15px;color:var(--muted);max-width:440px}
.slab{display:flex;align-items:stretch;border-radius:22px;overflow:hidden;border:1px solid var(--line);background:var(--card);box-shadow:0 24px 60px rgba(0,0,0,.06);text-align:left}
.slab .spine{width:6px;flex:none;background:var(--l1)}
.slab .cols{display:flex;gap:36px;padding:22px 30px;flex-wrap:wrap}
.slab .cols>div{display:flex;flex-direction:column;gap:4px}
.slab h3{font-size:21px;font-weight:700}
.slab small{font-size:13px;color:var(--muted)}
.actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.state{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 13px;border-radius:999px;font-size:12px;font-weight:500;background:color-mix(in srgb,#1f7a4d 14%,transparent);color:#1f7a4d}
.state.off{background:color-mix(in srgb,var(--bad) 14%,transparent);color:var(--bad)}
@keyframes vaispin{to{transform:rotate(360deg)}}
.is-busy{position:relative;color:transparent!important}
.is-busy::after{content:'';position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:2px solid color-mix(in srgb,var(--l1) 25%,transparent);border-top-color:var(--l1);animation:vaispin .7s linear infinite}
.primary.is-busy::after{border-color:rgba(255,255,255,.35);border-top-color:#fff}
#content.is-waiting{pointer-events:none}
#content.is-waiting .times button:not(.is-busy),#content.is-waiting .grid button,#content.is-waiting .nav button{opacity:.45}
@media(prefers-reduced-motion:reduce){.is-busy::after{animation-duration:2s}}
#error{color:var(--bad);margin:0 0 14px}
#status{color:var(--muted);margin:0 0 14px}
#challenge{margin:14px 0}
footer{max-width:1040px;margin:0 auto;padding:18px 16px 28px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
@media(max-width:720px){
  main{padding:18px 14px 28px}
  .two{grid-template-columns:1fr}
  .velai{display:none}
  .velai.foot{display:inline-flex;margin:0 auto}
  .step span{display:none}.step.on span{display:inline}
  h1{font-size:20px}
  .card{padding:18px;border-radius:20px}
  .hero h2{font-size:25px}
  .slab .cols{gap:18px;padding:18px 20px}
}
`;

// El shim de __name NO es decorativo (mismo incidente que costó scripts/check-bundle.mjs
// el 2026-08-20, ver worker/admin-page.js): esbuild inyecta llamadas a su helper
// __name(fn,'fn') DENTRO del cuerpo de reservationApp, el helper vive en la cabecera del
// bundle y NO viaja con toString(). Sin el shim la página se sirve con 200, el navegador
// lanza «__name is not defined» y el visitante ve una página EN BLANCO — invisible para
// los tests, que ejecutan el fuente sin bundlear.
// Página de «aquí no hay reservas»: la que ve quien abre un enlace de un negocio sin el
// calendario público encendido — o un slug que no existe. Es DELIBERADAMENTE la misma para
// los dos casos y con el mismo 404: si dijera «este negocio no tiene el servicio», el
// enlace serviría para averiguar qué clientes existen (SPEC-AUTOAGENDA §6, «el slug no se
// enumera»). Sin JS y sin datos: solo copy, la marca y por dónde escribirnos.
const CSS_AVISO = `
@font-face{font-family:'Cabinet Grotesk';src:url(https://hirevai.com/fonts/cabinet-grotesk-800.woff2) format('woff2');font-weight:800;font-display:swap}
@font-face{font-family:'Satoshi';src:url(https://hirevai.com/fonts/satoshi-400.woff2) format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'Satoshi';src:url(https://hirevai.com/fonts/satoshi-500.woff2) format('woff2');font-weight:500;font-display:swap}
:root{color-scheme:light dark;--acc:#ff6b1a;--bg:#f6f5f2;--card:#fff;--ink:#172033;--muted:#5b6472;--line:rgba(23,32,51,.10)}
@media(prefers-color-scheme:dark){:root{--bg:#151b27;--card:#1b2230;--ink:#fff;--muted:#ced7e5;--line:rgba(255,255,255,.10)}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink);font:400 16px/1.6 'Satoshi',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
main{width:min(520px,100%);padding:40px 32px;border:1px solid var(--line);border-radius:22px;background:var(--card);text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.10)}
.marca{display:inline-flex;align-items:center;gap:8px;margin-bottom:28px;color:var(--muted);font-size:12px;font-weight:500;letter-spacing:.14em;text-transform:uppercase}
.marca i{display:grid;place-items:center;width:24px;height:24px;border-radius:8px;background:var(--acc);color:#fff}
h1{margin:0;font-family:'Cabinet Grotesk',sans-serif;font-weight:800;font-size:28px;line-height:1.15;letter-spacing:-.03em}
p{margin:14px 0 0;color:var(--muted)}
.botones{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:28px}
a{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 22px;border-radius:12px;font-weight:500;text-decoration:none}
a.primario{background:var(--acc);color:#fff}
a.primario:hover{background:#e55f14}
a.secundario{border:1px solid var(--line);color:var(--ink)}
a.secundario:hover{border-color:var(--acc);color:var(--acc)}
.en{margin-top:26px;padding-top:18px;border-top:1px solid var(--line);font-size:14px;color:var(--muted)}
`;

export function paginaSinReservas(nonce = null) {
  const n = nonce || btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="robots" content="noindex,nofollow"><title>Reservas no disponibles</title><style nonce="${n}">${CSS_AVISO}</style></head>`
    + `<body><main>`
    + `<span class="marca"><i aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 13.5 10 18 19 7"/></svg></i>Velai</span>`
    + `<h1>Aquí todavía no se puede reservar</h1>`
    + `<p>Este enlace no corresponde a ninguna página de reservas activa. Si venías a pedir cita, escribe al negocio por su canal de siempre.</p>`
    + `<p>¿Eres el negocio y la esperabas encendida? Escríbenos y la activamos.</p>`
    + `<div class="botones"><a class="primario" href="mailto:equipo@hirevai.com?subject=Reservas%20online">Escribir a Velai</a>`
    + `<a class="secundario" href="https://hirevai.com" target="_blank" rel="noopener noreferrer">Ver qué es Velai</a></div>`
    + `<p class="en">This booking page isn\u2019t active. Write to <a href="mailto:equipo@hirevai.com" style="min-height:0;padding:0;color:var(--acc)">equipo@hirevai.com</a> and we\u2019ll look into it.</p>`
    + `</main></body></html>`;
  // frame-ancestors abierto a https: a propósito: si un cliente dejó el embed puesto, dentro
  // del iframe tiene que verse el aviso y no un marco en blanco. La página no lleva datos ni
  // formularios, así que enmarcarla no expone nada.
  return new Response(html, { status: 404, headers: { ...BOOKING_HEADERS, 'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${n}'; font-src https://hirevai.com; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors https:` } });
}

export function reservaPage(env, tenant, boot, appointment = null) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const origins = frameOrigins(env, tenant);
  const data = JSON.stringify({ boot, appointment, origins }).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Reserva tu cita</title><style nonce="${nonce}">${CSS}</style></head><body><main><header class="top"><span id="mark" class="mark" aria-hidden="true"></span><img id="logo" hidden alt=""><div class="who"><h1 id="business"></h1><p id="note"></p></div><a class="velai" href="https://hirevai.com" target="_blank" rel="noopener noreferrer"><i aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 13.5 10 18 19 7"/></svg></i><s><u>Tecnología</u><b>Velai</b></s></a></header><nav id="steps" class="steps" hidden></nav><p id="error" role="alert"></p><p id="status" role="status" aria-live="polite"></p><div id="content"></div><div id="challenge"></div><noscript>Activa JavaScript para consultar horarios y reservar. / Enable JavaScript to book.</noscript></main><footer><span id="foot"></span></footer><script nonce="${nonce}">var __name=(t,v)=>Object.defineProperty(t,"name",{value:v,configurable:true});(${reservationApp.toString()})(${data});</script><script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script></body></html>`, {headers:{...BOOKING_HEADERS,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; style-src 'nonce-${nonce}'; font-src https://hirevai.com; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; img-src https: data:; base-uri 'none'; form-action 'self'; frame-ancestors ${origins.length ? origins.join(' ') : "'none'"}`}});
}

// ES5 syntax intentionally: no transpilation/bundle required on the public page.
export function reservationApp(data) {
  var boot=data.boot, appointment=data.appointment, english=/^en/i.test(navigator.language), locale=english?'en-GB':'es-ES';
  var root=document.getElementById('content'), error=document.getElementById('error'), status=document.getElementById('status');
  var stepsBar=document.getElementById('steps');
  var service=null, chosen='', hold=null, rescheduling=false, busy=false, challengeId=null, parentOrigin=null;
  var browserZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  var today=new Intl.DateTimeFormat('en-CA',{timeZone:boot.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  var month=today.slice(0,7), days={}, selectedDay='';
  function tr(es,en){return english?en:es;}
  document.documentElement.lang=english?'en':'es';
  document.title=boot.name+' · '+tr('Reservas','Booking');
  document.getElementById('business').textContent=boot.name;
  document.getElementById('note').textContent=boot.booking_note||'';
  document.getElementById('foot').textContent=tr('Cancela o cambia la cita tú mismo desde el enlace que te enviamos.','Cancel or change your appointment yourself from the link we send you.');
  // Marca del cliente con el MISMO contrato que el widget (site/assets/vai-widget.js):
  // --l1 = brand_color · --l2 = brand_color_2 o el propio brand_color · --acc =
  // accent_color o, si no lo definió, derivado del color de marca. Los valores llegan
  // validados de D1, pero entran en CSS: se comprueban igualmente antes de aplicarlos.
  var hex=function(v){return /^#[0-9a-f]{6}$/i.test(v||'')?v:'';};
  var l1=hex(boot.brand_color), l2=hex(boot.brand_color_2)||l1, acc=hex(boot.accent_color);
  if(l1){document.documentElement.style.setProperty('--l1',l1);document.documentElement.style.setProperty('--l2',l2);}
  if(acc)document.documentElement.style.setProperty('--acc',acc);
  else if(l1)document.documentElement.style.setProperty('--acc','color-mix(in srgb,var(--l1) 55%,#fff)');
  if (boot.theme==='light'||boot.theme==='dark') document.documentElement.setAttribute('data-theme',boot.theme);
  // Sin logo del cliente, iniciales del negocio sobre su color de marca (nunca un hueco).
  if (/^https:\/\//.test(boot.logo_url||'')) {var logo=document.getElementById('logo');logo.src=boot.logo_url;logo.hidden=false;document.getElementById('mark').hidden=true;}
  else document.getElementById('mark').textContent=boot.name.split(/\s+/).slice(0,2).map(function(w){return w.charAt(0).toUpperCase();}).join('');
  function el(tag,text,parent){var e=document.createElement(tag);if(text)e.textContent=text;(parent||root).appendChild(e);return e;}
  function button(text,fn,parent){var b=el('button',text,parent);b.type='button';b.addEventListener('click',fn);return b;}
  function link(text,url,parent){var a=el('a',text,parent);a.href=url;a.className='ghost';a.rel='noopener noreferrer';return a;}
  function icon(path,size,parent){var s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('width',size);s.setAttribute('height',size);s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','1.7');s.setAttribute('stroke-linecap','round');s.setAttribute('stroke-linejoin','round');s.setAttribute('aria-hidden','true');var p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',path);s.appendChild(p);if(parent)parent.appendChild(s);return s;}
  var ICON={presencial:'M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z',video:'M3 7.5A2.5 2.5 0 0 1 5.5 5h7A2.5 2.5 0 0 1 15 7.5v9A2.5 2.5 0 0 1 12.5 19h-7A2.5 2.5 0 0 1 3 16.5Zm12 4.5 6-3.4v10.8Z',telefono:'M6.5 3.5h3l1.5 4-2 1.6a12 12 0 0 0 5.9 5.9l1.6-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z',cal:'M3.5 8h17M8 3v4m8-4v4M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5Z',reloj:'M12 7.5V12l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',tick:'m5 13 4.5 4.5L19 7'};
  // Barra de pasos (1 servicio · 2 día y hora · 3 tus datos). n=0 la oculta: la página de
  // gestión de una cita ya reservada no está «a medio camino» de nada.
  function setStep(n){
    stepsBar.textContent='';stepsBar.hidden=!n;if(!n)return;
    [tr('Servicio','Service'),tr('Día y hora','Date & time'),tr('Tus datos','Your details')].forEach(function(name,i){
      var num=i+1,d=el('div','',stepsBar);d.className='step'+(num<n?' done':num===n?' on':'');
      var mark=el('i',num<n?'✓':String(num),d);mark.setAttribute('aria-hidden','true');
      el('span',name,d);
      if(num<3)el('span','',stepsBar).className='rule';
    });
  }
  function clear(){root.textContent='';error.textContent='';status.textContent='';root.classList.remove('is-waiting');}
  // Indicador de espera en el elemento pulsado: entre elegir la hora y ver el formulario
  // hay un reto de Turnstile y la reserva del hueco, y sin esto la página parece muerta.
  function spin(node){
    if(!node)return function(){};
    node.classList.add('is-busy');node.setAttribute('aria-busy','true');root.classList.add('is-waiting');
    return function(){node.classList.remove('is-busy');node.removeAttribute('aria-busy');root.classList.remove('is-waiting');};
  }
  function withSpin(node,fn){var stop=spin(node);var t=task(fn);if(t&&t.then)t.then(stop,stop);else stop();return t;}
  function notifySize(){if(parentOrigin&&window.parent!==window)window.parent.postMessage({type:'vai-citas:resize',height:document.documentElement.scrollHeight},parentOrigin);}
  window.addEventListener('message',function(e){if(e.source===window.parent&&data.origins.indexOf(e.origin)!==-1&&e.data&&e.data.type==='vai-citas:init'){parentOrigin=e.origin;notifySize();}});
  if(window.ResizeObserver)new ResizeObserver(notifySize).observe(document.body);
  function fail(err){var messages={hueco_ocupado:tr('Ese horario acaba de ocuparse. Elige otro.','That time is no longer available. Choose another.'),hold_expired:tr('La reserva temporal ha caducado. Vuelve a elegir hora.','Your temporary reservation expired. Choose a time again.'),rate_limited:tr('Demasiados intentos. Espera un minuto.','Too many attempts. Wait a minute.'),booking_limit_or_in_progress:tr('No se pudo completar: límite de citas o reserva en curso.','Unable to complete: appointment limit or booking in progress.'),human_verification_failed:tr('No se pudo verificar. Inténtalo de nuevo.','Verification failed. Please retry.'),
      invalid_email:tr('Revisa el email: falta el dominio (por ejemplo nombre@dominio.com).','Check the email: the domain is missing (e.g. name@domain.com).'),
      datos_incompletos:tr('Faltan el nombre o el teléfono.','Name or phone is missing.'),
      consent_and_hold_required:tr('Marca la casilla de privacidad y vuelve a elegir la hora.','Tick the privacy box and choose the time again.'),
      invalid_date:tr('Esa fecha ya no es válida. Elige otra.','That date is no longer valid. Choose another.'),
      invalid_service:tr('Ese servicio ya no está disponible.','That service is no longer available.'),
      booking_in_progress:tr('Esa reserva se está completando. Espera unos segundos y recarga.','That booking is being completed. Wait a few seconds and reload.'),
      reschedule_unavailable:tr('No se puede cambiar esta cita. Cancélala y reserva otra hora.','This appointment cannot be changed. Cancel it and book another time.'),
      appointment_past:tr('Esa cita ya ha pasado.','That appointment is in the past.'),
      not_found:tr('No encontramos esa cita.','We could not find that appointment.')};error.textContent=messages[err.message]||tr('No se pudo completar. Inténtalo de nuevo; si estabas reservando, conserva esta pantalla.','Unable to complete. Please retry; if booking, keep this page open.');notifySize();}
  function request(path,body){var init={credentials:'omit',referrerPolicy:'no-referrer'};if(body){init.method='POST';init.headers={'Content-Type':'application/json'};init.body=JSON.stringify(body);}return fetch(path,init).then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||'unavailable');return d;});});}
  function task(fn){if(busy)return;busy=true;error.textContent='';status.textContent=tr('Un momento…','One moment…');return Promise.resolve().then(fn).catch(fail).then(function(){busy=false;status.textContent='';notifySize();});}
  function human(){return new Promise(function(resolve,reject){if(!window.turnstile||!boot.sitekey){reject(new Error('verification_unavailable'));return;}if(challengeId!==null)window.turnstile.remove(challengeId);var timer=setTimeout(function(){reject(new Error('verification_unavailable'));},60000);challengeId=window.turnstile.render('#challenge',{sitekey:boot.sitekey,action:'reserva',callback:function(token){clearTimeout(timer);resolve(token);},'error-callback':function(){clearTimeout(timer);reject(new Error('human_verification_failed'));},'expired-callback':function(){clearTimeout(timer);reject(new Error('human_verification_failed'));}});});}
  function api(){return '/api/reservas/'+encodeURIComponent(boot.slug);}
  function serviceLabel(s){return s.minutes+' min · '+modeName(s.mode);}
  // Intl devuelve el día y el mes en minúscula en español: se sube la primera letra a
  // mano (text-transform:capitalize pondría mayúscula también a «de»).
  function cap(t){return t.charAt(0).toUpperCase()+t.slice(1);}
  function modeName(mode){return {presencial:tr('Presencial','In person'),video:tr('Vídeo','Video'),telefono:tr('Teléfono','Phone')}[mode]||mode;}
  // Tarjeta de elección (modalidad o servicio): icono, nombre y meta. El nombre va el
  // PRIMERO en el DOM porque es el nombre accesible del botón.
  function pick(name,meta,desc,mode,fn,parent){
    var b=button('',fn,parent);b.className='svc';
    var box=el('i','',b);icon(ICON[mode]||ICON.cal,22,box);
    var s=el('s','',b);el('b',name,s);if(desc)el('small',desc,s);
    if(meta){var chip=el('span',meta,b);chip.className='chip';}
    return b;
  }
  function chooseMode(){
    var modes=[];boot.services.forEach(function(s){if(modes.indexOf(s.mode)===-1)modes.push(s.mode);});
    if(modes.length<2){chooseService(modes[0]);return;}
    clear();setStep(1);
    var col=el('div');col.className='col';
    el('span',tr('Paso 1 de 3','Step 1 of 3'),col).className='kick';
    el('h2',tr('¿Cómo quieres tu cita?','How would you like your appointment?'),col);
    var list=el('div','',col);list.className='stack';
    modes.forEach(function(mode){var b=pick(modeName(mode),'','',mode,function(){chooseService(mode,b);},list);});
  }
  function chooseService(mode,btn){
    var options=boot.services.filter(function(s){return !mode||s.mode===mode;});
    if(options.length===1){service=options[0];loadMonth(btn);return;}
    clear();setStep(1);
    var col=el('div');col.className='col';
    el('span',tr('Paso 1 de 3','Step 1 of 3'),col).className='kick';
    el('h2',tr('Elige un servicio','Choose a service'),col);
    var list=el('div','',col);list.className='stack';
    options.forEach(function(s){var b=pick(s.name,serviceLabel(s),s.description||'',s.mode,function(){service=s;loadMonth(b);},list);});
    var back=button(tr('Cambiar modalidad','Change appointment mode'),chooseMode,col);back.className='link';
  }
  function localInstant(dateTime){var bits=dateTime.split(/[-T:]/).map(Number),naive=Date.UTC(bits[0],bits[1]-1,bits[2],bits[3],bits[4]),guess=naive;for(var i=0;i<2;i++){var p={};new Intl.DateTimeFormat('en-US',{timeZone:boot.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date(guess)).forEach(function(part){p[part.type]=part.value;});var formatted=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour)%24,Number(p.minute),Number(p.second));guess=naive-(formatted-guess);}return new Date(guess);}
  function loadMonth(btn){return withSpin(btn,function(){return request(api()+'/huecos?mes='+month+'&s='+encodeURIComponent(service.slug)).then(function(d){days=d.days;selectedDay='';calendar();});});}
  function changeMonth(delta,btn){var p=month.split('-'),d=new Date(Date.UTC(Number(p[0]),Number(p[1])-1+delta,1));month=d.toISOString().slice(0,7);loadMonth(btn);}
  // Día y hora en UNA columna (dirección elegida por Juan sobre el boceto B): el móvil
  // es la misma maqueta, no otra. Las horas van agrupadas en mañana y tarde — una lista
  // de veinte botones idénticos era lo que hacía ilegible la pantalla anterior.
  function calendar(){
    clear();setStep(2);
    var col=el('div');col.className='col';
    var chips=el('div','',col);chips.className='chips';
    var svc=el('span','',chips);svc.className='chip is-strong';icon(ICON[service.mode]||ICON.cal,16,svc);el('span',service.name,svc);
    el('span',serviceLabel(service),chips).className='chip';
    if(service.location)el('span',service.location,chips).className='chip';
    var tz=el('span','',chips);tz.className='chip';icon(ICON.reloj,16,tz);el('span',boot.timezone,tz);
    if(browserZone!==boot.timezone)el('span',tr('Tu hora: ','Your time: ')+browserZone,chips).className='chip';
    if(!rescheduling&&boot.services.length>1){var chg=button(tr('Cambiar servicio','Change service'),chooseMode,chips);chg.className='link';}
    var card=el('section','',col);card.className='card';
    var bar=el('div','',card);bar.className='monthbar';
    el('h2',cap(new Date(month+'-15T12:00:00Z').toLocaleDateString(locale,{month:'long',year:'numeric'})),bar);
    var nav=el('div','',bar);nav.className='nav';
    var prev=button('‹',function(){changeMonth(-1,prev);},nav);prev.setAttribute('aria-label',tr('Mes anterior','Previous month'));prev.disabled=month<=today.slice(0,7);
    var next=button('›',function(){changeMonth(1,next);},nav);next.setAttribute('aria-label',tr('Mes siguiente','Next month'));next.disabled=Date.parse(month+'-01')+31*86400000>Date.now()+boot.max_days_ahead*86400000;
    var grid=el('div','',card);grid.className='grid';
    (english?['M','T','W','T','F','S','S']:['L','M','X','J','V','S','D']).forEach(function(d){el('span',d,grid).className='weekday';});
    var offset=(new Date(month+'-01T12:00:00Z').getUTCDay()+6)%7;
    for(var i=0;i<offset;i++)el('span','',grid);
    Object.keys(days).forEach(function(date){
      var b=button(String(Number(date.slice(-2))),function(){selectedDay=date;calendar();},grid);
      b.disabled=!days[date].length;b.className=b.disabled?'':'available';
      b.setAttribute('aria-label',date);b.setAttribute('aria-pressed',String(selectedDay===date));
    });
    el('div','',card).className='sep';
    var slots=el('section','',card);slots.id='slots';
    var head=el('div','',slots);head.className='dayhead';
    el('h2',selectedDay?cap(new Date(selectedDay+'T12:00:00Z').toLocaleDateString(locale,{weekday:'long',day:'numeric',month:'long'})):tr('Elige un día','Choose a day'),head);
    var libres=(days[selectedDay]||[]).length;
    if(selectedDay)el('small',libres+' '+(libres===1?tr('hora libre','free time'):tr('horas libres','free times'))+' · '+boot.timezone,head);
    [[tr('Mañana','Morning'),function(h){return h<'14:00';}],[tr('Tarde','Afternoon'),function(h){return h>='14:00';}]].forEach(function(bloque){
      var horas=(days[selectedDay]||[]).filter(bloque[1]);
      if(!horas.length)return;
      el('span',bloque[0],slots).className='kick';
      var box=el('div','',slots);box.className='times';
      horas.forEach(function(hour){
        var label=hour;
        if(browserZone!==boot.timezone)label+=' · '+localInstant(selectedDay+'T'+hour).toLocaleTimeString(locale,{timeZone:browserZone,hour:'2-digit',minute:'2-digit'})+tr(' en tu zona',' your time');
        var b=button(label,function(){selectHour(selectedDay+'T'+hour,b);},box);
      });
    });
    if(rescheduling){var back=button(tr('Volver a mi cita','Back to my appointment'),function(){rescheduling=false;confirmation(appointment);},col);back.className='ghost';back.style.alignSelf='flex-start';}
  }
  function selectHour(dateTime,btn){withSpin(btn,function(){return human().then(function(token){return request(api()+'/hold',{fecha_hora:dateTime,servicio:service.slug,turnstileToken:token});}).then(function(h){chosen=dateTime;hold=h;form();});});}
  function field(form,id,title,type,required){var wrap=el('div','',form);wrap.className='field';var label=el('label',title,wrap);label.htmlFor=id;var input=el(type==='textarea'?'textarea':'input','',wrap);input.id=id;if(type!=='textarea')input.type=type;input.required=required;input.maxLength=id==='notes'?1000:id==='email'?254:100;return input;}
  function form(){
    clear();setStep(3);
    var two=el('div');two.className='two';
    var card=el('section','',two);card.className='card';
    el('span',tr('Paso 3 de 3','Step 3 of 3'),card).className='kick';
    el('h2',tr('Confirma tu cita','Confirm your appointment'),card).style.margin='6px 0 16px';
    var f=el('form','',card);
    var name,phone,email,notes;
    if(!rescheduling){
      name=field(f,'name',tr('Nombre','Name'),'text',true);name.autocomplete='name';
      phone=field(f,'phone',tr('Teléfono con prefijo de país','Phone including country code'),'tel',true);phone.autocomplete='tel';
      email=field(f,'email',tr('Email (opcional)','Email (optional)'),'email',false);email.autocomplete='email';
      email.pattern='[^\\s@]+@[^\\s@]+\\.[^\\s@]+';
      email.title=tr('Escribe el email completo, por ejemplo nombre@dominio.com','Enter the full email, e.g. name@domain.com');
      notes=field(f,'notes',tr('Nota (opcional)','Note (optional)'),'textarea',false);
    }
    var consentLabel=el('label','',f);consentLabel.className='consent';
    var consent=el('input','',consentLabel);consent.type='checkbox';consent.required=true;consent.id='privacy';
    var text=el('span','',consentLabel);
    text.appendChild(document.createTextNode(tr('He leído la ','I have read the ')));
    var priv=el('a',tr('política de privacidad','privacy policy'),text);priv.href='https://hirevai.com/privacidad/';priv.target='_blank';priv.rel='noopener noreferrer';
    text.appendChild(document.createTextNode(tr('. Usaremos tus datos solo para gestionar esta cita.','. We will use your details only to manage this appointment.')));
    var actions=el('div','',f);actions.className='actions';
    var submit=el('button',rescheduling?tr('Confirmar cambio','Confirm change'):tr('Reservar cita','Book appointment'),actions);submit.type='submit';submit.className='primary';
    var change=button(tr('Cambiar hora','Change time'),function(){loadMonth();},actions);change.className='link';
    // Resumen: la misma información que antes iba suelta en párrafos, agrupada donde el
    // visitante la busca —qué, cuándo, dónde— y con el aviso del hueco retenido.
    var aside=el('aside','',two);aside.className='aside';
    el('span',tr('Tu reserva','Your booking'),aside).className='kick';
    el('h3',cap(new Date(chosen.slice(0,10)+'T12:00:00Z').toLocaleDateString(locale,{weekday:'long',day:'numeric',month:'long'}))+' · '+chosen.slice(11),aside);
    var r1=el('div','',aside);r1.className='row';icon(ICON.cal,18,el('i','',r1));el('span',service.name+' · '+serviceLabel(service),r1);
    if(service.location){var r2=el('div','',aside);r2.className='row';icon(ICON.presencial,18,el('i','',r2));el('span',service.location,r2);}
    var r3=el('div','',aside);r3.className='row';icon(ICON.reloj,18,el('i','',r3));
    el('span',boot.timezone+(browserZone!==boot.timezone?' · '+tr('en tu zona: ','your time: ')+localInstant(chosen).toLocaleString(locale,{timeZone:browserZone,dateStyle:'short',timeStyle:'short'}):''),r3);
    el('p',tr('Te guardamos esta hora hasta las ','We hold this time until ')+new Date(hold.expires_at).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'}),aside).className='tag';
    f.addEventListener('submit',function(e){
      e.preventDefault();if(!f.reportValidity())return;
      var stop=spin(submit);
      var t=task(function(){
        submit.disabled=true;
        return human().then(function(token){
          var body={fecha_hora:chosen,servicio:service.slug,hold:hold.hold,privacy:consent.checked,turnstileToken:token};
          if(!rescheduling){body.nombre=name.value;body.telefono=phone.value;body.email=email.value;body.nota=notes.value;}
          var path=rescheduling?'/api/cita/'+appointment.manage_url.split('/').pop()+'/reagendar':api();
          return request(path,body);
        }).then(function(d){appointment=d.appointment;rescheduling=false;confirmation(appointment);})
          .then(function(){submit.disabled=false;},function(err){submit.disabled=false;throw err;});
      });
      if(t&&t.then)t.then(stop,stop);else stop();
    });
  }
  function when(appt,zone){return new Date(appt.starts_at).toLocaleString(locale,{timeZone:zone,dateStyle:'full',timeStyle:'short'});}
  function confirmation(appt){
    clear();setStep(0);
    var cancelada=appt.status==='cancelled';
    var hero=el('div');hero.className='hero';
    if(!cancelada){var tick=el('span','',hero);tick.className='tick';icon(ICON.tick,34,tick);}
    el('h2',cancelada?tr('Cita cancelada','Appointment cancelled'):tr('Tu cita está reservada','Your appointment is booked'),hero);
    el('p',cancelada?tr('Puedes reservar otra hora cuando quieras.','You can book another time whenever you want.'):tr('Te lo confirmamos por WhatsApp y te recordaremos la cita antes.','We confirm by WhatsApp and will remind you before the appointment.'),hero);
    var slab=el('div','',hero);slab.className='slab';
    el('div','',slab).className='spine';
    var cols=el('div','',slab);cols.className='cols';
    var c1=el('div','',cols);
    el('span',tr('Cuándo','When'),c1).className='kick';
    el('h3',cap(when(appt,appt.timezone)),c1);
    el('small',Math.round((Date.parse(appt.ends_at)-Date.parse(appt.starts_at))/60000)+' min · '+appt.timezone+(browserZone!==appt.timezone?' · '+tr('en tu zona: ','your time: ')+when(appt,browserZone):''),c1);
    var c2=el('div','',cols);
    el('span',tr('Qué','What'),c2).className='kick';
    el('h3',appt.service_name||service&&service.name||tr('Cita','Appointment'),c2);
    if(appt.location)el('small',appt.location,c2);
    var actions=el('div','',hero);actions.className='actions';
    actions.style.justifyContent='center';
    if(appt.status==='confirmed'){
      link(tr('Añadir a mi calendario','Add to my calendar'),appt.ics_url,actions);
      link(tr('Gestionar mi cita','Manage appointment'),appt.manage_url,actions);
      var re=button(tr('Reagendar','Reschedule'),function(){
        service=boot.services.filter(function(s){return s.id===appt.service_id;})[0];
        if(!service){fail(new Error('service_unavailable'));return;}
        rescheduling=true;loadMonth(re);
      },actions);re.className='ghost';
      var cancel=button(tr('Cancelar cita','Cancel appointment'),function(){
        if(!window.confirm(tr('¿Cancelar esta cita?','Cancel this appointment?')))return;
        task(function(){return request('/api/cita/'+appt.manage_url.split('/').pop()+'/cancelar',{}).then(function(){appt.status='cancelled';confirmation(appt);});});
      },actions);cancel.className='ghost danger';
    }
  }
  if(appointment)confirmation(appointment);else{var s=new URLSearchParams(window.location.search).get('s');service=boot.services.filter(function(v){return v.slug===s;})[0]||(boot.services.length===1?boot.services[0]:null);if(service)loadMonth();else chooseMode();}
}
