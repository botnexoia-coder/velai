// Panel admin — presentación alineada con hirevai.com (SPEC-REDISENO-PANEL.md).
// Reglas que NO se rompen (§7 de la spec): token write-only, provPost recarga la
// ficha entera, nada sensible en el DOM, sin recursos externos salvo las fuentes
// de hirevai.com, y los mismos id/TERRS que traducen los códigos del worker.
export const ADMIN_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Panel · Velai</title>
<style nonce="__NONCE__">
@font-face{font-family:'Cabinet Grotesk';src:url('https://hirevai.com/fonts/cabinet-grotesk-900.woff2?v=2') format('woff2');font-weight:900;font-display:swap}
@font-face{font-family:'Satoshi';src:url('https://hirevai.com/fonts/satoshi-400.woff2?v=2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'Satoshi';src:url('https://hirevai.com/fonts/satoshi-500.woff2?v=2') format('woff2');font-weight:500;font-display:swap}
:root{color-scheme:dark;
--orange:#FF6B1A;--orange2:#FF8C40;--amber:#FFAA00;
--bg:#09070A;--bg2:#110D13;--surface:#181220;
--border:rgba(255,107,26,.12);--border2:rgba(255,107,26,.22);
--white:#FFF8F4;--muted:rgba(255,248,244,.62);--muted2:rgba(255,248,244,.40);
--font-d:'Cabinet Grotesk',system-ui,sans-serif;--font-b:'Satoshi',system-ui,sans-serif;
--r:14px;--r-sm:9px;--header-h:57px;
--ok:#199e70;--bad:#e66767;
--st-new:#3987e5;--st-contacted:#c98500;--st-qualified:#9085e9;--st-won:#199e70;--st-lost:#e66767;--st-spam:#8b8b95}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--white);font:14px/1.5 var(--font-b)}
body::before{content:'';position:fixed;inset:0;pointer-events:none;background:linear-gradient(rgba(255,248,244,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,248,244,.04) 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(ellipse 80% 60% at 50% 0%,#000 40%,transparent 100%);mask-image:radial-gradient(ellipse 80% 60% at 50% 0%,#000 40%,transparent 100%)}
button,input,select,textarea{font:inherit;color:var(--white)}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--orange);outline-offset:2px}
header{position:sticky;top:0;z-index:20;height:var(--header-h);padding:0 max(20px,3vw);display:flex;align-items:center;gap:18px;background:rgba(9,7,10,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:9px;font-family:var(--font-d);font-weight:900;font-size:19px;letter-spacing:-.02em}
.brand i{width:9px;height:9px;border-radius:50%;background:var(--orange);box-shadow:0 0 10px rgba(255,107,26,.7)}
.brand small{font-family:var(--font-b);font-weight:500;font-size:10px;letter-spacing:.18em;color:var(--muted);text-transform:uppercase;margin-top:3px}
.tabs{display:flex;background:var(--bg2);border:1px solid var(--border);border-radius:999px;padding:3px;gap:2px}
.tab{border:0;background:none;border-radius:999px;padding:6px 16px;color:var(--muted);cursor:pointer;font-weight:500}
.tab.is-on{background:var(--orange);color:#fff;font-weight:700}
.spacer{flex:1}
.btn{border:0;border-radius:var(--r-sm);padding:9px 15px;background:var(--orange);color:#fff;cursor:pointer;font-weight:700;transition:background .15s ease}
.btn:hover{background:var(--orange2)}
.btn.alt{background:var(--bg2);border:1px solid var(--border2);color:var(--white);font-weight:500}
.btn.alt:hover{border-color:var(--orange);color:var(--orange2)}
.btn.bad{background:#5d2626;border:1px solid rgba(230,103,103,.4)}
main{position:relative;padding:22px max(20px,3vw) 60px;max-width:1360px;margin:0 auto}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr)) minmax(260px,1.6fr);gap:12px;margin-bottom:18px}
.stat{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px 18px}
.stat b{display:block;font-size:11px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.stat .n{font-family:var(--font-d);font-weight:900;font-size:38px;line-height:1;letter-spacing:-.02em}
.stat small{display:block;margin-top:5px;color:var(--muted2);font-size:11.5px}
.stat.alerta{border-color:rgba(230,103,103,.45);background:linear-gradient(180deg,rgba(230,103,103,.10),var(--bg2))}
.stat.alerta .n{color:var(--bad)}
.chartcard{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:14px 18px 10px;display:flex;flex-direction:column}
.chartcard b{font-size:11px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
#chart{height:74px;display:flex;align-items:flex-end;gap:3px;margin-top:8px}
#chart .bar{flex:1;min-height:2px;background:var(--orange);opacity:.75;border-radius:4px 4px 0 0;transition:opacity .12s}
#chart .bar:hover{opacity:1}
.chartlabels{display:flex;justify-content:space-between;color:var(--muted2);font-size:10.5px;margin-top:4px}
.filters{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}
.filters input,.filters select,.note textarea{background:var(--bg2);color:var(--white);border:1px solid var(--border2);border-radius:var(--r-sm);padding:9px 12px}
.filters input:hover,.filters select:hover{border-color:var(--orange)}
.filters input[name=q]{flex:1;min-width:220px}
#resultCount{margin-left:auto;color:var(--muted);font-size:12.5px;white-space:nowrap}
.table{border:1px solid var(--border);border-radius:var(--r);overflow:auto;background:var(--bg2)}
table{width:100%;border-collapse:collapse;min-width:960px}
th{position:sticky;top:0;background:var(--bg2);z-index:5;color:var(--muted);font-size:11px;font-weight:500;letter-spacing:.07em;text-transform:uppercase}
th,td{padding:14px;text-align:left;border-bottom:1px solid var(--border)}
td.tel{font-variant-numeric:tabular-nums}
tr[data-id],tr[data-tid]{cursor:pointer}
tr[data-id]:hover,tr[data-tid]:hover{background:rgba(255,107,26,.05)}
.pill{display:inline-flex;align-items:center;gap:6px;background:var(--bg2);border:1px solid var(--border);border-radius:999px;padding:3px 10px;font-size:12.5px;white-space:nowrap}
.pill b{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.s-new b{background:var(--st-new)}.s-new{color:#9cc4ee}
.s-contacted b{background:var(--st-contacted)}.s-contacted{color:#ecc27c}
.s-qualified b{background:var(--st-qualified)}.s-qualified{color:#c3bdf5}
.s-won b{background:var(--st-won)}.s-won{color:#7fd7b2}
.s-lost b{background:var(--st-lost)}.s-lost{color:#f2a4a4}
.s-spam b{background:var(--st-spam)}.s-spam{color:#b9b9c2}
.tenant{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.tenant i{width:6px;height:22px;border-radius:3px;flex-shrink:0}
.nb{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);margin-right:8px;white-space:nowrap}
.nb i{width:7px;height:7px;border-radius:50%}
.nb.ok i{background:var(--ok)}.nb.wait i{background:var(--amber)}.nb.bad i{background:var(--bad)}
.flag{display:inline-block;border-radius:6px;padding:2px 8px;font-size:11.5px;margin:1px 3px 1px 0;background:rgba(255,170,0,.12);color:#ffce7a;border:1px solid rgba(255,170,0,.25)}
.flag.ok{background:rgba(25,158,112,.12);color:#7fd7b2;border-color:rgba(25,158,112,.3)}
.flag.off{background:rgba(255,248,244,.06);color:var(--muted);border-color:rgba(255,248,244,.12)}
.flag.web{background:rgba(57,135,229,.12);color:#9cc4ee;border-color:rgba(57,135,229,.3)}
.flag a{color:inherit;text-decoration:none;margin-left:4px;font-weight:700}
.flag a:hover{color:var(--bad)}
.meter{display:inline-block;width:64px;height:6px;background:rgba(255,248,244,.08);border-radius:3px;overflow:hidden;vertical-align:middle;margin-right:7px}
.meter i{display:block;height:100%;background:var(--orange);border-radius:3px}
/* Rol cliente: la interfaz oculta lo que no le aplica, pero la DEFENSA es del worker
   (cada endpoint valida el scope por su cuenta — SPEC-HANDOFF §B.3.5). */
body.cliente .tabs,body.cliente #tenantFilter,body.cliente #mTenantsCard{display:none}
body.cliente th:nth-child(2),body.cliente td:nth-child(2){display:none}
#escalations{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}
#escalations:empty{display:none}
.esc{display:inline-flex;align-items:center;gap:8px;background:rgba(255,170,0,.1);border:1px solid rgba(255,170,0,.3);border-radius:999px;padding:5px 6px 5px 12px;font-size:12.5px;color:#ffce7a}
.esc button{border:0;border-radius:999px;background:var(--bg2);color:var(--white);padding:3px 10px;cursor:pointer;font-size:11.5px}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:12px 4px 0;color:var(--muted);font-size:12px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend i{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0}
.muted{color:var(--muted)}.error{color:var(--bad)}
.pager{text-align:center;margin:18px}
.empty{text-align:center;padding:36px;color:var(--muted)}
dialog{width:min(780px,calc(100% - 24px));max-height:92vh;overflow:auto;background:var(--bg2);color:var(--white);border:1px solid var(--border2);border-radius:var(--r);padding:0}
dialog::backdrop{background:rgba(5,3,6,.78);backdrop-filter:blur(3px)}
.modal-h{position:sticky;top:0;z-index:5;background:var(--bg2);display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border)}
.modal-h strong{font-family:var(--font-d);font-weight:900;font-size:18px;letter-spacing:-.01em}
.modal-b{padding:20px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:calc(var(--r) - 4px);padding:12px}
.card b{display:block;color:var(--muted);font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;margin-bottom:5px}
.card input,.card textarea,.card select{width:100%;background:var(--bg);color:var(--white);border:1px solid var(--border2);border-radius:8px;padding:8px;margin-top:4px}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}
.note{display:flex;gap:8px}
.timeline{margin-top:20px}
.timeline h3{font-family:var(--font-d);font-weight:900;letter-spacing:-.01em}
.timeline article{border-left:2px solid var(--border2);padding:0 0 14px 12px}
.field-err{display:block;margin-top:4px;color:var(--bad)}.field-err:empty{display:none}
/* La CSP (style-src con nonce) BLOQUEA los atributos style="" inline: todo estilo
   estático va en clases y todo valor dinámico se aplica por CSSOM (paint()). */
.mt12{margin-top:12px}.grow{flex:1}.w150{max-width:150px}.w80{max-width:80px}
.prewrap{white-space:pre-wrap;margin-top:8px}.preline{margin:8px 0;white-space:pre-line}
.promptbox{width:100%;font-family:ui-monospace,monospace;font-size:12.5px}
.inpill{background:var(--bg);border:1px solid var(--border2);border-radius:var(--r-sm);padding:9px 12px}
.mt6{margin-top:6px}.okmsg{color:var(--ok)}.mb6{margin:6px 0}.actions0{margin:4px 0 0;align-items:center}
.legend .d-new{background:var(--st-new)}.legend .d-contacted{background:var(--st-contacted)}.legend .d-qualified{background:var(--st-qualified)}.legend .d-won{background:var(--st-won)}.legend .d-lost{background:var(--st-lost)}
/* Previsualización de la marca del widget: mini-mock del chat con los valores del form */
#brandPrev{margin-top:8px;max-width:300px;border-radius:12px;overflow:hidden;border:1px solid var(--border2);background:#ece5dd}
#brandPrev .bp-h{display:flex;align-items:center;gap:8px;padding:8px 10px;color:#fff;background:#075e54}
#brandPrev .bp-av{width:26px;height:26px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#FF6B1A;color:#fff;font-weight:700;font-size:12px;flex-shrink:0}
#brandPrev .bp-av img{width:100%;height:100%;object-fit:cover}
#brandPrev .bp-n{font-size:12px;font-weight:600}
#brandPrev .bp-g{margin:8px;background:#fff;color:#111;border-radius:0 8px 8px 8px;padding:6px 8px;font-size:12px;width:fit-content;max-width:85%}
#brandPrev .bp-c{display:flex;flex-wrap:wrap;gap:4px;margin:0 8px 8px}
#brandPrev .bp-c span{border:1px solid rgba(0,0,0,.2);border-radius:10px;padding:3px 8px;font-size:10.5px;background:#fff;color:#075e54}
#brandPrev.bp-dark{background:#0b141a}
#brandPrev.bp-dark .bp-g{background:#1f2c34;color:#e9edef}
#brandPrev.bp-dark .bp-c span{background:#1f2c34;color:#e9edef;border-color:rgba(255,255,255,.2)}
/* Toasts de resultado (guardado ✓ / error): contenedor popover para quedar en el top
   layer POR ENCIMA de los <dialog> abiertos — un fixed normal quedaría detrás. */
#toasts{position:fixed;top:14px;right:14px;left:auto;bottom:auto;margin:0;border:0;padding:0;background:transparent;overflow:visible;flex-direction:column;align-items:flex-end;gap:8px}
#toasts:popover-open{display:flex}
.toast{background:var(--bg2);border:1px solid var(--ok);color:var(--white);border-radius:var(--r-sm);padding:10px 14px;box-shadow:0 8px 30px rgba(0,0,0,.45);font-size:13px;max-width:360px;opacity:0;transform:translateY(-6px);transition:opacity .2s ease,transform .2s ease}
.toast.on{opacity:1;transform:none}
.toast.err{border-color:var(--bad);background:linear-gradient(180deg,rgba(230,103,103,.12),var(--bg2))}
#tVersions article{margin-bottom:10px}
#tVersions pre{white-space:pre-wrap;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px;font-size:11.5px;max-height:220px;overflow:auto}
@media(max-width:1000px){.metrics{grid-template-columns:1fr 1fr}.chartcard{grid-column:1/-1}}
@media(max-width:700px){.grid{grid-template-columns:1fr}header{gap:10px}.brand small{display:none}}
</style></head><body>
<header>
<div class="brand"><i></i>Velai <small>Panel</small></div>
<nav class="tabs" role="tablist"><button class="tab is-on" role="tab" aria-selected="true" data-view="leads" type="button">Leads</button><button class="tab" role="tab" aria-selected="false" data-view="tenants" type="button">Clientes</button></nav>
<span class="spacer"></span>
<button class="btn alt" id="export" type="button">Exportar CSV</button>
<button class="btn" id="newTenant" type="button" hidden>Nuevo cliente</button>
<button class="btn alt" id="logout" type="button" title="Cerrar la sesión de Cloudflare Access">Salir</button>
</header>
<main><div id="viewLeads">
<div class="metrics">
<div class="stat"><b>Leads · 30 días</b><span class="n" id="mTotal">—</span></div>
<div class="stat"><b>Sin contactar</b><span class="n" id="mNew">—</span><small id="mNewSub"></small></div>
<div class="stat" id="mFailCard"><b>Avisos fallidos · 7 días</b><span class="n" id="mFail">—</span></div>
<div class="stat" id="mTenantsCard"><b>Clientes activos</b><span class="n" id="mTenants">—</span></div>
<div class="chartcard"><b>Leads por día · 14 días</b><div id="chart"></div><div class="chartlabels"><span id="chartFrom"></span><span id="chartTo"></span></div></div>
</div>
<div id="escalations"></div>
<form class="filters" id="filters"><input name="q" placeholder="Buscar nombre, teléfono, sector…"><select name="tenant" id="tenantFilter"><option value="">Todos los clientes</option></select><select name="status"><option value="">Todos los estados</option><option>new</option><option>contacted</option><option>qualified</option><option>won</option><option>lost</option><option>spam</option></select><select name="notification"><option value="">Todos los avisos</option><option>pending</option><option>sent</option><option>failed</option><option>skipped</option></select><input name="source" placeholder="Fuente"><input name="from" type="date"><input name="to" type="date"><button class="btn">Filtrar</button><span id="resultCount"></span></form>
<div id="message"></div><div class="table"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Estado</th><th>Nombre</th><th>WhatsApp</th><th>Sector</th><th>Fuente</th><th>Avisos</th></tr></thead><tbody id="rows"></tbody></table></div>
<div class="legend"><span><i class="d-new"></i>nuevo</span><span><i class="d-contacted"></i>contactado</span><span><i class="d-qualified"></i>cualificado</span><span><i class="d-won"></i>ganado</span><span><i class="d-lost"></i>perdido</span></div>
<div class="pager"><button class="btn alt" id="more" hidden>Cargar más</button></div></div>
<div id="viewTenants" hidden>
<div class="table"><table><thead><tr><th>Nombre</th><th>Canal</th><th>Leads</th><th>Contexto</th><th>Configuración</th><th>Estado</th></tr></thead><tbody id="tenantRows"></tbody></table></div>
<div class="card mt12" id="adminsCard"><b>Admins de Velai (ven TODO)</b>
<p class="muted mt6">Entran en admin.hirevai.com con código por correo (One-time PIN). El alta y la baja actualizan también la puerta de Cloudflare Access — sin CLI ni dashboard. Los marcados «raíz» viven en la configuración del worker y no se pueden quitar desde aquí (a propósito: nada del panel puede dejar a Velai fuera de su propio panel).</p>
<div id="adminsList" class="mt6 muted">—</div>
<div class="actions actions0"><input id="aEmail" type="email" placeholder="nuevo-admin@correo.com" class="grow inpill"><button class="btn alt" id="aAdd" type="button">Añadir admin</button></div></div>
<div class="card mt12" id="configCard" hidden><b>Configuración (solo admins raíz)</b>
<p class="muted mt6">Estado de las integraciones y rotación del token de API de Cloudflare. El token nuevo se valida contra Cloudflare ANTES de guardarse, se cifra con la KEK y nunca se vuelve a mostrar (write-only). La KEK, la API key de Anthropic y las credenciales maestras de Twilio no se gestionan aquí a propósito: viven como secrets del worker.</p>
<div id="configState" class="mt6 muted preline">—</div>
<div class="actions actions0"><input id="cfgToken" type="password" autocomplete="new-password" placeholder="nuevo token de API de Cloudflare" class="grow inpill"><button class="btn alt" id="cfgTokenSave" type="button">Validar y guardar</button><button class="btn alt" id="cfgTokenClear" type="button">Volver al secret del worker</button></div></div></div></main>
<dialog id="detail"><div class="modal-h"><strong>Detalle del lead</strong><button class="btn alt" id="close">Cerrar</button></div><div class="modal-b" id="detailBody"></div></dialog>
<dialog id="tenantModal"><div class="modal-h"><strong id="tenantTitle">Cliente</strong><button class="btn alt" id="tenantClose" type="button">Cerrar</button></div><div class="modal-b">
<div id="tenantMsg"></div>
<div class="grid">
<div class="card"><b>Nombre</b><input id="tName" placeholder="Barbería López"><small class="muted field-err" data-f="name"></small></div>
<div class="card"><b>Slug</b><input id="tSlug" placeholder="barberia-lopez"><small class="muted field-err" data-f="slug"></small></div>
<div class="card"><b>Canal (To de Twilio)</b><input id="tAddress" placeholder="whatsapp:+34910000000 · messenger:12345 · web:mi-cliente · pending:mi-cliente"><small class="muted field-err" data-f="channel_address"></small></div>
<div class="card"><b>Twilio From</b><input id="tFrom" placeholder="whatsapp:+34910000000"><small class="muted field-err" data-f="twilio_from"></small></div>
<div class="card"><b>Equipo WhatsApp (coma)</b><input id="tTeam" placeholder="whatsapp:+34600111222,whatsapp:+34600333444"><small class="muted field-err" data-f="team_whatsapp"></small></div>
<div class="card"><b>Telegram chat_id</b><input id="tChat" placeholder="-100123456789"><small class="muted field-err" data-f="telegram_chat_id"></small></div>
<div class="card"><b>Plantilla de aviso (SID)</b><input id="tTpl" placeholder="HX seguido de 32 hex"><small class="muted field-err" data-f="lead_template_sid"></small></div>
<div class="card"><b>Subcuenta Twilio</b><input id="tSub" placeholder="AC seguido de 32 hex"><small class="muted field-err" data-f="twilio_subaccount_sid"></small></div>
<div class="card"><b>WABA del cliente</b><input id="tWaba" placeholder="solo dígitos, 10-20"><small class="muted field-err" data-f="waba_id"></small></div>
<div class="card"><b>Auth token de la subcuenta</b><input id="tToken" type="password" autocomplete="new-password" placeholder="solo para cambiarlo"><small class="muted" id="tTokenState"></small><small class="muted field-err" data-f="twilio_auth_token"></small></div>
<div class="card"><b>Socio en Meta</b><select id="tPartner"><option>pendiente</option><option>concedido</option><option>revocado</option></select></div>
<div class="card"><b>Estado</b><label><input type="checkbox" id="tActive" checked> Activo (enruta y atiende)</label></div>
</div>
<div class="card mt12"><b>Contexto del negocio (system prompt) · <span id="tCount" class="muted"></span></b>
<div id="tDup" hidden class="mb6"><label class="muted">Duplicar de… <select id="tDupSel"><option value="">— empezar de cero —</option></select></label></div>
<textarea id="tPrompt" rows="14" class="promptbox"></textarea>
<small class="muted field-err" data-f="system_prompt"></small></div>
<div class="card mt12"><b>Marca del widget (chat en la web del cliente)</b>
<p class="muted mt6">Lo que ve el visitante: logo, nombre, saludo, colores. Vacío = marca de Velai (hirevai.com no cambia). Se sirve por <code>/widget/boot</code> y se aplica sin deploy (caché 5 min).</p>
<div class="grid mt6">
<div class="card"><b>Nombre del bot</b><input id="tBotName" placeholder="Zoe"><small class="muted field-err" data-f="bot_name"></small></div>
<div class="card"><b>Nombre de marca</b><input id="tBrandName" placeholder="Zoe Travel Spain"><small class="muted field-err" data-f="brand_name"></small></div>
<div class="card"><b>Logo (URL https)</b><input id="tLogo" placeholder="https://… (el logo que ya usa su web)"><small class="muted field-err" data-f="logo_url"></small></div>
<div class="card"><b>Colores (#rrggbb · el 2º opcional, degradado)</b><div class="note mt6"><input id="tColor1" placeholder="#1a4fd0" class="w150"><input id="tColor2" placeholder="#f57a1f" class="w150"></div><small class="muted field-err" data-f="brand_color"></small><small class="muted field-err" data-f="brand_color_2"></small></div>
<div class="card"><b>Saludo (ES)</b><textarea id="tGreeting" rows="2" placeholder="¡Hola! Soy Zoe 🐱 ¿A dónde sueñas viajar?"></textarea><small class="muted field-err" data-f="greeting"></small></div>
<div class="card"><b>Saludo (EN, opcional)</b><textarea id="tGreetingEn" rows="2" placeholder="Hi! I'm Zoe 🐱 Where do you dream of travelling?"></textarea><small class="muted field-err" data-f="greeting_en"></small></div>
<div class="card"><b>Sugerencias (hasta 3, una por línea)</b><textarea id="tChips" rows="3" placeholder="Vuelos a Colombia&#10;Paquetes con hotel"></textarea><small class="muted field-err" data-f="chips_json"></small></div>
<div class="card"><b>Placeholder del input</b><input id="tPlaceholder" placeholder="Escribe tu mensaje..."><small class="muted field-err" data-f="placeholder"></small></div>
<div class="card"><b>WhatsApp de contacto (wa.me, solo dígitos)</b><input id="tWa" placeholder="34644280183"><small class="muted field-err" data-f="wa_number"></small></div>
<div class="card"><b>Tema del chat</b><select id="tTheme"><option value="">auto (según el visitante)</option><option value="light">light</option><option value="dark">dark</option></select></div>
<div class="card"><b>Dominios de la web (https, uno por línea, máx. 6)</b><textarea id="tOrigins" rows="2" placeholder="https://… (apex y su www, uno por línea)"></textarea><small class="muted">Entran en la allowlist de CORS al Guardar (sin deploy). Después pulsa Sincronizar Turnstile.</small><small class="muted field-err" data-f="web_origins"></small></div>
</div>
<div class="mt12"><b class="muted">Previsualización</b><div id="brandPrev"></div></div>
<div class="actions actions0"><button class="btn alt" id="tSyncDomains" type="button">Sincronizar Turnstile</button><span class="muted">Reescribe los hostnames del widget de Turnstile desde D1 (idempotente: también reconcilia).</span></div></div>
<div class="actions"><input id="tNote" placeholder="Nota del cambio (opcional)" class="grow inpill"><button class="btn" id="tenantSave" type="button">Guardar</button></div>
<div class="card mt12"><b>Probar el borrador (no guarda nada)</b>
<div class="note mt6"><input id="tTestMsg" placeholder="Mensaje de prueba, p. ej. «hola, ¿tenéis hueco mañana?»" class="grow"><button class="btn alt" id="tenantPreview" type="button">Probar</button></div>
<article id="tPreviewOut" class="muted prewrap"></article></div>
<div class="card" id="tProv" hidden><b>Aprovisionamiento Twilio (automático)</b>
<div id="tProvState" class="muted preline"></div>
<div class="actions actions0">
<button class="btn alt" id="pSub" type="button">1· Crear subcuenta</button>
<button class="btn alt" id="pTpl" type="button">2· Plantilla → aprobación</button>
<input id="pPhone" placeholder="+34910000000" class="w150">
<button class="btn alt" id="pSender" type="button">3· Crear sender</button>
<input id="pCode" placeholder="OTP" class="w80">
<button class="btn alt" id="pVerify" type="button">4· Verificar OTP</button>
</div></div>
<div class="card" id="tUsersCard" hidden><b>Usuarios del panel</b>
<p class="muted mt6">Correos con acceso a los leads de ESTE cliente (entran con OTP en admin.hirevai.com). Alta y baja surten efecto inmediato.</p>
<div id="tUsersList" class="mt6 muted">—</div>
<div class="actions actions0"><input id="uEmail" type="email" placeholder="gestora@cliente.com" class="grow inpill"><button class="btn alt" id="uAdd" type="button">Añadir</button></div>
<small class="muted field-err" data-f="panel_email"></small></div>
<div class="timeline"><h3>Historial</h3><div id="tVersions" class="muted">—</div></div>
</div></dialog>
<div id="toasts" popover="manual"></div>
<script nonce="__NONCE__">
function paint(root){(root||document).querySelectorAll('[data-w]').forEach(e=>{e.style.width=e.dataset.w+'%'});(root||document).querySelectorAll('[data-h]').forEach(e=>{e.style.height=e.dataset.h+'%'});(root||document).querySelectorAll('[data-c]').forEach(e=>{e.style.background=e.dataset.c});(root||document).querySelectorAll('[data-fg]').forEach(e=>{e.style.color=e.dataset.fg})}
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let cursor=null,current=null,loadedCount=0;
// Aviso de resultado de CADA acción que guarda: éxito verde (2,6 s) o error rojo (6 s).
// showPopover con try/catch: si el navegador no soporta popover, el div es visible igual.
function toast(msg,ok=true){const box=$('#toasts');const t=document.createElement('div');t.className='toast'+(ok?'':' err');t.textContent=msg;box.appendChild(t);
 try{if(!box.matches(':popover-open'))box.showPopover()}catch(e){}
 requestAnimationFrame(()=>t.classList.add('on'));
 setTimeout(()=>{t.classList.remove('on');setTimeout(()=>{t.remove();if(!box.children.length){try{box.hidePopover()}catch(e){}}},250)},ok?2600:6000)}
const ST_LABEL={new:'nuevo',contacted:'contactado',qualified:'cualificado',won:'ganado',lost:'perdido',spam:'spam'};
const TENANT_COLORS=['#3987e5','#9085e9','#199e70','#c98500','#2aa8b8','#c96bb4','#8ba03f','#e66767'];
function tenantColor(id){let h=0;for(const c of String(id||''))h=(h*31+c.charCodeAt(0))>>>0;return TENANT_COLORS[h%TENANT_COLORS.length]}
function statusPill(s){return '<span class="pill s-'+esc(s)+'"><b></b>'+esc(ST_LABEL[s]||s)+'</span>'}
function tenantChip(id,name){return name?'<span class="tenant"><i data-c="'+tenantColor(id)+'"></i>'+esc(name)+'</span>':'<span class="muted">—</span>'}
function nbChips(summary){if(!summary)return '<span class="muted">—</span>';
 return String(summary).split(',').map(p=>{const[ch,st]=p.split(':');const cls=st==='sent'?'ok':st==='failed'?'bad':'wait';
  return '<span class="nb '+cls+'"><i></i>'+esc(ch==='telegram'?'Telegram':'WhatsApp')+'</span>'}).join('')}
function params(){const p=new URLSearchParams(new FormData($('#filters')));for(const[k,v]of[...p])if(!v)p.delete(k);return p}
async function api(path,options){const r=await fetch(path,options);if(r.status===204)return null;const d=await r.json();if(!r.ok)throw Error(d.error||'request_failed');return d}
function fmt(v){return v?new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—'}
async function loadStats(){try{const s=await api('/api/admin/stats');
 $('#mTotal').textContent=s.total30;$('#mNew').textContent=s.sinContactar;
 $('#mNewSub').textContent=s.sinContactar&&s.sinContactarDesde?('el más antiguo, del '+new Intl.DateTimeFormat('es-ES',{dateStyle:'short'}).format(new Date(s.sinContactarDesde))):'';
 $('#mFail').textContent=s.fallidos7;$('#mFailCard').classList.toggle('alerta',s.fallidos7>0);
 $('#mTenants').textContent=s.tenantsActivos;
 const max=Math.max(1,...s.porDia.map(x=>x.n));
 $('#chart').innerHTML=s.porDia.map(x=>'<div class="bar" data-h="'+(x.n===0?6:Math.max(12,Math.round(x.n/max*100)))+'" title="'+esc(x.d)+': '+x.n+'"></div>').join('');paint($('#chart'));
 $('#chartFrom').textContent=s.porDia[0]?s.porDia[0].d.slice(5):'';$('#chartTo').textContent=s.porDia.at(-1)?s.porDia.at(-1).d.slice(5):''}
 catch(e){/* las métricas no bloquean el listado */}}
async function load(append=false){try{const p=params();if(append&&cursor)p.set('cursor',cursor);const d=await api('/api/admin/leads?'+p);if(!append){$('#rows').innerHTML='';loadedCount=0}
 if(!d.leads.length&&!append)$('#rows').innerHTML='<tr><td colspan="8" class="empty">No hay leads con estos filtros.</td></tr>';
 for(const l of d.leads)$('#rows').insertAdjacentHTML('beforeend','<tr data-id="'+l.id+'"><td>'+fmt(l.created_at)+'</td><td>'+tenantChip(l.tenant_id,l.tenant_name)+'</td><td>'+statusPill(l.status)+'</td><td>'+esc(l.name||'—')+'</td><td class="tel">'+esc(l.whatsapp||'—')+'</td><td>'+esc(l.sector||'—')+'</td><td>'+esc(l.source)+'</td><td>'+nbChips(l.notification_summary)+'</td></tr>');
 paint($('#rows'));
 loadedCount+=d.leads.length;cursor=d.nextCursor;$('#more').hidden=!cursor;
 $('#resultCount').textContent=loadedCount+(cursor?'+':'')+' resultado'+((loadedCount===1&&!cursor)?'':'s');
 $('#message').textContent=''}catch(e){$('#message').innerHTML='<p class="error">'+esc(e.message)+'</p>'}}
async function loadTenants(){try{const d=await api('/api/admin/tenants');for(const t of d.tenants)$('#tenantFilter').insertAdjacentHTML('beforeend','<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>')}catch(e){/* sin tenants: el filtro queda en Todos */}}
// Cerrar sesión = logout de Cloudflare Access (borra la cookie CF_Authorization de
// esta app y redirige al login). La ruta la atiende Access, nunca llega al worker.
$('#logout').onclick=()=>{location.href='/cdn-cgi/access/logout'};
$('#filters').onsubmit=e=>{e.preventDefault();cursor=null;load()};$('#more').onclick=()=>load(true);$('#export').onclick=()=>location.href='/api/admin/leads/export.csv?'+params();$('#close').onclick=()=>$('#detail').close();
$('#rows').onclick=e=>{const tr=e.target.closest('[data-id]');if(tr)openLead(tr.dataset.id)};
async function openLead(id){try{const d=await api('/api/admin/leads/'+id);current=d.lead;const l=d.lead;const cards=[['Fecha',fmt(l.created_at)],['Cliente',l.tenant_name],['Nombre',l.name],['WhatsApp',l.whatsapp],['Sector',l.sector],['Fuente',l.source],['Mensajes/día',l.messages_per_day],['Canal',l.channel],['Puntuación',l.score],['Nota',l.note],['Página',l.page_url]].map(x=>'<div class="card"><b>'+x[0]+'</b>'+esc(x[1]??'—')+'</div>').join('');const options=['new','contacted','qualified','won','lost','spam'].map(s=>'<option '+(s===l.status?'selected':'')+'>'+s+'</option>').join('');const notices=d.notifications.map(n=>'<article><b>Aviso '+esc(n.channel)+': '+esc(n.status)+'</b><div class="muted">Intentos: '+n.attempts+(n.last_error?' · '+esc(n.last_error):'')+'</div></article>').join('');const notes=d.notes.map(n=>'<article><b>'+esc(n.author_email)+'</b><div>'+esc(n.text)+'</div><small class="muted">'+fmt(n.created_at)+'</small></article>').join('');const events=d.events.map(n=>'<article><b>'+esc(n.event_type)+'</b><div>'+esc(n.detail||'')+'</div><small class="muted">'+fmt(n.created_at)+' · '+esc(n.actor_email)+'</small></article>').join('');const velaiBtns=ME.role==='velai'?'<button class="btn alt" id="retry">Reintentar avisos</button><button class="btn bad" id="delete">Borrar lead</button>':'';$('#detailBody').innerHTML='<div class="grid">'+cards+'</div><div class="actions"><select id="status" class="inpill">'+options+'</select><button class="btn" id="saveStatus">Guardar estado</button>'+velaiBtns+'</div><div class="note"><textarea id="note" rows="3" placeholder="Añadir nota…"></textarea><button class="btn" id="addNote">Añadir</button></div><div class="timeline"><h3>Actividad</h3>'+notices+notes+events+'</div>';wireDetail();$('#detail').showModal()}catch(e){toast('No se pudo abrir el lead: '+e.message,false)}}
// Cada acción confirma con toast; sin el try/catch un fallo del PATCH era INVISIBLE
// (la promesa moría sin aviso y el usuario creía que había guardado).
function wireDetail(){$('#saveStatus').onclick=async()=>{try{await api('/api/admin/leads/'+current.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:$('#status').value})});toast('Estado guardado ✓ («'+$('#status').value+'»)');$('#detail').close();load();loadStats()}catch(e){toast('Estado NO guardado: '+e.message,false)}};if($('#retry'))$('#retry').onclick=async()=>{try{await api('/api/admin/leads/'+current.id+'/retry',{method:'POST'});toast('Reintento de avisos lanzado ✓');openLead(current.id)}catch(e){toast('Reintento fallido: '+e.message,false)}};$('#addNote').onclick=async()=>{const text=$('#note').value.trim();if(!text)return;try{await api('/api/admin/leads/'+current.id+'/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});toast('Nota guardada ✓');openLead(current.id)}catch(e){toast('Nota NO guardada: '+e.message,false)}};if($('#delete'))$('#delete').onclick=async()=>{if(!confirm('¿Borrar definitivamente este lead y todos sus datos?'))return;try{await api('/api/admin/leads/'+current.id,{method:'DELETE'});toast('Lead borrado ✓');$('#detail').close();load();loadStats()}catch(e){toast('Lead NO borrado: '+e.message,false)}}}
// ── Pestaña Clientes ──
const TERRS={already_provisioned:'Ese paso ya está hecho (idempotente: un doble clic no crea recursos duplicados).',provision_in_progress:'Ese paso ya está en curso, espera unos segundos.',waba_required:'Rellena y guarda primero la WABA del cliente.',subaccount_required:'Crea primero la subcuenta (paso 1).',twilio_auth_token_missing:'La subcuenta no tiene auth token guardado.',provision_orphan:'Twilio creó el recurso pero D1 no lo guardó: revisa Telegram y reconcilia a mano.',invalid_code:'El OTP son 4-8 dígitos.',slug_taken:'Ese slug ya existe.',address_taken:'Ese canal ya está asignado a otro cliente: guardarlo desviaría sus conversaciones.',subaccount_taken:'Esa subcuenta de Twilio ya está asignada a otro cliente.',pending_tenant_cannot_be_active:'Un prospecto (canal pending:) no puede activarse: ponle primero su canal real.',invalid_twilio_auth_token:'El auth token debe ser 32 caracteres hexadecimales (Twilio → Keys & Credentials).',stale_tenant:'Alguien modificó este cliente mientras editabas. Recarga la ficha y vuelve a aplicar tus cambios.',nothing_to_update:'No hay cambios que guardar.',invalid_preview:'Escribe un mensaje de prueba y un contexto de al menos 50 caracteres.',rate_limited:'Demasiadas pruebas seguidas: espera un minuto.',email_taken:'Ese correo ya tiene acceso al panel de OTRO cliente (un correo pertenece a un solo cliente).',email_is_admin:'Ese correo es admin de Velai (ADMIN_EMAILS): ya ve todo, no puede ser usuario de un cliente.',invalid_email:'Eso no parece un correo válido.',cloudflare_api_not_configured:'Falta CF_API_TOKEN (secret) o CF_ACCOUNT_ID en el worker: la sincronización con Cloudflare no está activa.',turnstile_sync_failed:'El PUT a Turnstile falló DESPUÉS de guardar en D1: el worker acepta el origen pero Turnstile no emitirá token. Reintenta Sincronizar Turnstile.',turnstile_domains_limit:'Turnstile admite 10 dominios por widget y ya se superan incluso plegando los www: toca pasar a un widget por cliente (alternativa §4 de la spec).',already_admin:'Ese correo ya es admin.',email_is_client:'Ese correo es usuario de un CLIENTE: primero quítalo de la ficha del cliente y luego dale admin.',admin_is_root:'Ese admin es raíz (vive en la configuración del worker): no se puede quitar desde el panel.',cannot_remove_self:'No puedes quitarte a ti mismo (que lo haga otro admin): evita el cierre accidental.',root_only:'Solo los admins raíz (los de la configuración del worker) pueden tocar la configuración.',invalid_token_format:'Eso no parece un token de API de Cloudflare.',token_invalid:'Cloudflare rechazó el token (no está activo): NO se guardó.',token_verify_unavailable:'No se pudo validar contra Cloudflare (red): NO se guardó.'};
let tenantList=[],editing=null;
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>{x.classList.toggle('is-on',x===b);x.setAttribute('aria-selected',x===b?'true':'false')});const v=b.dataset.view;$('#viewLeads').hidden=v!=='leads';$('#viewTenants').hidden=v!=='tenants';$('#export').hidden=v!=='leads';$('#newTenant').hidden=v!=='tenants';if(v==='tenants'){loadTenantList();loadAdmins();loadConfig()}else loadStats()});
// ── Configuración (solo raíz): el servidor decide con 403 root_only; el panel solo oculta ──
async function loadConfig(){try{const c=await api('/api/admin/config');$('#configCard').hidden=false;
 const t=c.cf_token;
 $('#configState').textContent=[
  'Token de API de Cloudflare: '+(t.source==='none'?'— sin configurar':('origen '+(t.source==='panel'?'PANEL (cifrado en D1)':'secret del worker')+' · '+(t.valid===true?'válido ✓ ('+t.status+')':'NO VÁLIDO ✗ ('+(t.status||'?')+')'))),
  'Cuenta: '+(c.account_id||'—')+' · Sitekey de Turnstile: '+(c.turnstile_sitekey?'✓':'—'),
  'Grupos de Access: clientes '+(c.groups.clientes?'✓':'—')+' · admins '+(c.groups.admins?'✓':'—'),
  'Bindings: D1 '+(c.d1?'✓':'✗')+' · KV '+(c.kv?'✓':'✗')].join('\\n')}
 catch(e){if(e.message==='root_only')$('#configCard').hidden=true;else{$('#configCard').hidden=false;$('#configState').textContent=TERRS[e.message]||e.message}}}
$('#cfgTokenSave').onclick=async()=>{const token=$('#cfgToken').value.trim();if(!token)return;
 if(!confirm('El token se validará contra Cloudflare y pasará a usarse para TODAS las sincronizaciones (Turnstile y puertas de Access). ¿Continuar?'))return;
 try{const r=await api('/api/admin/config/cf-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  $('#cfgToken').value='';toast('Token validado y guardado ✓ ('+r.status+') — origen: panel');loadConfig()}
 catch(e){toast('Token NO guardado: '+(TERRS[e.message]||e.message),false)}};
$('#cfgTokenClear').onclick=async()=>{if(!confirm('¿Retirar el token del panel y volver al secret del worker?'))return;
 try{const r=await api('/api/admin/config/cf-token',{method:'DELETE'});toast('Hecho ✓ — origen: '+(r.source==='worker'?'secret del worker':'SIN token: las sincronizaciones quedan en manual'),r.source==='worker');loadConfig()}
 catch(e){toast('No se pudo: '+(TERRS[e.message]||e.message),false)}};
// ── Admins de Velai: alta/baja desde el panel, con la puerta de Access incluida ──
async function loadAdmins(){try{const d=await api('/api/admin/admins');
 $('#adminsList').innerHTML=d.admins.map(a=>'<span class="flag '+(a.root?'ok':'off')+'">'+esc(a.email)+(a.root?' · raíz':' <a href="#" data-adel="'+esc(a.email)+'" title="Quitar admin">✕</a>')+'</span>').join(' ')}
 catch(e){$('#adminsList').textContent=TERRS[e.message]||e.message}}
$('#aAdd').onclick=async()=>{const email=$('#aEmail').value.trim();if(!email)return;
 if(!confirm('Un ADMIN ve TODOS los clientes y TODOS los leads, y puede gestionar usuarios. ¿Dar acceso total a '+email+'?'))return;
 try{const r=await api('/api/admin/admins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
  $('#aEmail').value='';
  if(r.gate==='sincronizado')toast('Admin añadido ✓ — puerta de Access actualizada, ya puede entrar con OTP');
  else if(r.gate==='pendiente')toast('Admin guardado, pero la puerta de Access NO se sincronizó (revisa Telegram y reintenta)',false);
  else toast('Admin añadido ✓ — añade su correo a la política «Equipo Velai» en Zero Trust (modo manual)');
  loadAdmins()}
 catch(e){toast('Admin NO añadido: '+(TERRS[e.message]||e.message),false)}};
$('#adminsList').onclick=async e=>{const email=e.target&&e.target.dataset&&e.target.dataset.adel;if(!email)return;e.preventDefault();
 if(!confirm('¿Quitar el acceso de ADMIN de '+email+'?'))return;
 try{const r=await api('/api/admin/admins/'+encodeURIComponent(email),{method:'DELETE'});
  if(r.gate==='pendiente')toast('Fila borrada, pero la puerta de Access NO se sincronizó: ese correo aún puede autenticarse (el worker le da 403). Revisa Telegram.',false);
  else toast('Admin quitado ✓'+(r.gate==='sincronizado'?' — puerta de Access actualizada':''));
  loadAdmins()}
 catch(e2){toast('NO quitado: '+(TERRS[e2.message]||e2.message),false)}};
function flags(list,cls){return list.map(f=>'<span class="flag'+(cls?' '+cls:'')+'">'+esc(f)+'</span>').join('')}
function semaforo(t){if(!t.active&&String(t.channel_address).startsWith('pending:'))return '<span class="flag off">prospecto</span>';
 const long=t.prompt_len>8000?['contexto muy largo']:[];
 if(String(t.channel_address).startsWith('web:')){const f=[...long];if(t.prompt_len<200)f.push('contexto corto');if(!t.has_team&&!t.has_telegram)f.push('sin canal de aviso');return '<span class="flag web">solo web</span>'+(f.length?flags(f):' <span class="flag ok">listo</span>')}
 const f=[...long];if(!t.has_template)f.push('sin plantilla');if(!t.has_team)f.push('sin equipo');if(t.prompt_len<200)f.push('contexto corto');if(t.has_subaccount&&!t.has_twilio_token)f.push('sin token');if(t.has_subaccount&&!t.has_from)f.push('sin From');if(t.meta_partner_status==='pendiente'&&t.has_subaccount)f.push('socio pendiente');return f.length?flags(f):'<span class="flag ok">listo</span>'}
function meter(chars){const w=Math.min(100,Math.round(chars/12000*100));return '<span class="meter" title="El contexto viaja al modelo en CADA mensaje"><i data-w="'+w+'"></i></span><span class="muted">'+chars+' car.</span>'}
async function loadTenantList(){try{const d=await api('/api/admin/tenants');tenantList=d.tenants;$('#tenantRows').innerHTML=d.tenants.map(t=>'<tr data-tid="'+t.id+'"><td>'+tenantChip(t.id,t.name)+'</td><td class="muted">'+esc(t.channel_address)+'</td><td>'+t.lead_count+'</td><td>'+meter(t.prompt_len)+'</td><td>'+semaforo(t)+'</td><td>'+(t.active?'<span class="flag ok">activo</span>':'<span class="flag off">inactivo</span>')+'</td></tr>').join('')||'<tr><td colspan="6" class="empty">Sin clientes.</td></tr>';paint($('#tenantRows'))}catch(e){toast('No se pudo cargar la lista de clientes: '+e.message,false)}}
$('#tenantRows').onclick=e=>{const tr=e.target.closest('[data-tid]');if(tr)openTenant(tr.dataset.tid)};
$('#newTenant').onclick=()=>openTenant(null);
// Cambios sin guardar: cerrar el modal (botón o ESC) pide confirmación antes de descartar.
let tenantDirty=false;
$('#tenantModal').addEventListener('input',e=>{if(e.target.id!=='tTestMsg')tenantDirty=true});
function confirmDiscard(){return !tenantDirty||confirm('Hay cambios sin guardar en esta ficha. ¿Cerrar y descartarlos?')}
$('#tenantClose').onclick=()=>{if(confirmDiscard()){tenantDirty=false;$('#tenantModal').close()}};
$('#tenantModal').addEventListener('cancel',e=>{if(!confirmDiscard())e.preventDefault();else tenantDirty=false});
const TF={name:'#tName',slug:'#tSlug',channel_address:'#tAddress',twilio_from:'#tFrom',team_whatsapp:'#tTeam',telegram_chat_id:'#tChat',lead_template_sid:'#tTpl',twilio_subaccount_sid:'#tSub',waba_id:'#tWaba',meta_partner_status:'#tPartner',system_prompt:'#tPrompt',bot_name:'#tBotName',brand_name:'#tBrandName',logo_url:'#tLogo',brand_color:'#tColor1',brand_color_2:'#tColor2',greeting:'#tGreeting',greeting_en:'#tGreetingEn',placeholder:'#tPlaceholder',wa_number:'#tWa',theme:'#tTheme'};
// chips_json y web_origins van aparte: en el form son una línea por valor; al worker
// viajan como array (el servidor valida y guarda JSON).
function jsonToLines(json){try{const a=JSON.parse(json||'[]');return Array.isArray(a)?a.join('\\n'):''}catch(e){return ''}}
function linesFrom(sel,max){return $(sel).value.split('\\n').map(s=>s.trim()).filter(Boolean).slice(0,max)}
function chipsToLines(json){return jsonToLines(json)}
function chipsFromLines(){return linesFrom('#tChips',3)}
// Previsualización de la marca: mini-mock del chat con los valores actuales del form.
function brandPreview(){
 const c1=$('#tColor1').value.trim()||'#FF6B1A',c2=$('#tColor2').value.trim()||c1;
 const bot=$('#tBotName').value.trim()||'Vai',brand=$('#tBrandName').value.trim()||'Velai';
 const logo=$('#tLogo').value.trim();
 const greet=$('#tGreeting').value.trim()||'¡Hola! Soy '+bot+' 👋 ¿En qué te puedo ayudar?';
 const chips=chipsFromLines();
 $('#brandPrev').classList.toggle('bp-dark',$('#tTheme').value==='dark');
 $('#brandPrev').innerHTML='<div class="bp-h" data-c="linear-gradient(135deg,'+esc(c1)+','+esc(c2)+')"><span class="bp-av" data-c="'+esc(c1)+'">'+(/^https:\\/\\//i.test(logo)?'<img src="'+esc(logo)+'" alt="">':esc(bot.charAt(0).toUpperCase()))+'</span><span class="bp-n">'+esc(bot)+' · '+esc(brand)+'</span></div><div class="bp-g">'+esc(greet)+'</div>'+(chips.length?'<div class="bp-c">'+chips.map(c=>'<span data-fg="'+esc(c1)+'">'+esc(c)+'</span>').join('')+'</div>':'');
 paint($('#brandPrev'))}
['#tBotName','#tBrandName','#tLogo','#tColor1','#tColor2','#tGreeting','#tChips','#tTheme'].forEach(s=>{$(s).addEventListener('input',brandPreview);$(s).addEventListener('change',brandPreview)});
function clearTenantErrs(){document.querySelectorAll('.field-err').forEach(x=>x.textContent='');$('#tenantMsg').innerHTML=''}
function updateCount(){const n=$('#tPrompt').value.length;$('#tCount').textContent=n+' caracteres · ≈'+Math.round(n/4)+' tokens en CADA mensaje'}
$('#tPrompt').oninput=updateCount;
async function openTenant(id){clearTenantErrs();$('#tPreviewOut').textContent='';$('#tTestMsg').value='';$('#tNote').value='';
 $('#tToken').value='';
 if(id){const d=await api('/api/admin/tenants/'+id);const t=d.tenant;editing={id:t.id,updated_at:t.updated_at};$('#tenantTitle').textContent=t.name;$('#tDup').hidden=true;for(const[k,sel]of Object.entries(TF))$(sel).value=t[k]??'';$('#tChips').value=chipsToLines(t.chips_json);$('#tOrigins').value=jsonToLines(t.web_origins);$('#tActive').checked=!!t.active;$('#tTokenState').textContent=t.has_twilio_token?'configurado ✓ (escribe solo para sustituirlo)':'sin configurar';$('#tProv').hidden=false;$('#tUsersCard').hidden=false;loadProv(id);loadVersions(id);loadUsers(id)}
 else{editing=null;$('#tenantTitle').textContent='Nuevo cliente';$('#tDup').hidden=false;$('#tDupSel').innerHTML='<option value="">— empezar de cero —</option>'+tenantList.map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('');for(const sel of Object.values(TF))$(sel).value='';$('#tChips').value='';$('#tOrigins').value='';$('#tPartner').value='pendiente';$('#tActive').checked=true;$('#tTokenState').textContent='sin configurar';$('#tProv').hidden=true;$('#tUsersCard').hidden=true;$('#tVersions').textContent='—'}
 updateCount();brandPreview();tenantDirty=false;$('#tenantModal').showModal()}
$('#tDupSel').onchange=async e=>{if(!e.target.value)return;const d=await api('/api/admin/tenants/'+e.target.value);$('#tPrompt').value=d.tenant.system_prompt||'';updateCount()};
$('#tenantSave').onclick=async()=>{clearTenantErrs();
 const body={};for(const[k,sel]of Object.entries(TF))body[k]=$(sel).value;body.chips_json=chipsFromLines();body.web_origins=linesFrom('#tOrigins',6);body.active=$('#tActive').checked;body.note=$('#tNote').value;
 if($('#tToken').value)body.twilio_auth_token=$('#tToken').value; // write-only: solo si se escribe
 try{
  if(editing){body.expected_updated_at=editing.updated_at;const r=await api('/api/admin/tenants/'+editing.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});editing.updated_at=r.updated_at;loadVersions(editing.id)}
  else{const r=await api('/api/admin/tenants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});editing={id:r.id,updated_at:r.updated_at};$('#tenantTitle').textContent=body.name;$('#tDup').hidden=true}
  toast('Cliente guardado ✓ (el widget lo ve en ≤5 min por la caché)');tenantDirty=false;loadTenantList()
 }catch(e){const c=e.message;const m=c.match(/^invalid_(.+)$/);
  if(m&&document.querySelector('.field-err[data-f="'+m[1]+'"]')){document.querySelector('.field-err[data-f="'+m[1]+'"]').textContent='Formato inválido — revisa el ejemplo del campo.';toast('NO guardado: revisa el campo «'+m[1]+'»',false)}
  else toast('NO guardado: '+(TERRS[c]||c),false)}};
$('#tenantPreview').onclick=async()=>{clearTenantErrs();$('#tPreviewOut').textContent='Pensando…';
 try{const anyId=editing?editing.id:'00000000-0000-4000-8000-000000000001';
  const r=await api('/api/admin/tenants/'+anyId+'/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:$('#tPrompt').value,message:$('#tTestMsg').value})});
  $('#tPreviewOut').textContent=r.reply}
 catch(e){$('#tPreviewOut').textContent='';toast('Prueba fallida: '+(TERRS[e.message]||e.message),false)}};
async function loadProv(id){try{const p=await api('/api/admin/tenants/'+id+'/provision');
 const lines=['Subcuenta: '+(p.subaccount.sid?p.subaccount.sid+(p.subaccount.hasToken?' · token cifrado ✓':' · SIN token'):'—'),
  'Plantilla: '+(p.template.sid?p.template.sid+' · '+(p.template.status||'manual'):'—'),
  'Sender: '+(p.sender.sid?p.sender.sid+' · '+(p.sender.status||'?'):'—')];
 if(p.warnings&&p.warnings.length)lines.push('⚠️ '+p.warnings.join(' '));
 $('#tProvState').textContent=lines.join('\\n')}catch(e){$('#tProvState').textContent=e.message}}
async function provPost(step,body){clearTenantErrs();
 try{await api('/api/admin/tenants/'+editing.id+'/provision/'+step,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  // Recargar la ficha ENTERA: refresca updated_at (evita stale_tenant en el siguiente
  // Guardar) y repuebla los inputs con el SID recién creado (un input vacío guardado
  // habría borrado la subcuenta de la fila).
  const keep=editing.id;await openTenant(keep);toast('Hecho ✓ — paso «'+step+'» completado');loadTenantList()}
 catch(e){toast('Paso «'+step+'» fallido: '+(TERRS[e.message]||e.message),false)}}
let panelUsers=[];
async function loadUsers(id){try{const d=await api('/api/admin/tenants/'+id+'/users');panelUsers=d.users;
 $('#tUsersList').innerHTML=d.users.map(u=>'<span class="flag off">'+esc(u.email)+' <a href="#" data-udel="'+esc(u.email)+'" title="Quitar acceso">✕</a></span>').join(' ')||'Sin usuarios: este cliente no tiene acceso al panel.'}
 catch(e){$('#tUsersList').textContent=e.message}}
$('#uAdd').onclick=async()=>{clearTenantErrs();const email=$('#uEmail').value.trim();if(!email)return;
 try{const r=await api('/api/admin/tenants/'+editing.id+'/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
  $('#uEmail').value='';
  if(r.gate==='sincronizado')toast('Acceso concedido ✓ a '+email+' — puerta de Access actualizada');
  else if(r.gate==='pendiente')toast('Fila guardada, pero la puerta de Access NO se sincronizó (reintenta con otra alta/baja o revisa Telegram)',false);
  else toast('Acceso concedido ✓ a '+email+' — la puerta de Access se gestiona a mano (sin CF_API_TOKEN)');
  loadUsers(editing.id)}
 catch(e){const c=e.message;const el=document.querySelector('.field-err[data-f="panel_email"]');
  if(el&&TERRS[c])el.textContent=TERRS[c];
  toast('Acceso NO concedido: '+(TERRS[c]||c),false)}};
$('#tUsersList').onclick=async e=>{const email=e.target&&e.target.dataset&&e.target.dataset.udel;if(!email)return;e.preventDefault();
 // Quitar al último se permite (a veces es lo que se quiere) pero avisando: sin filas, ese cliente no entra.
 if(panelUsers.length===1&&!confirm('Es el ÚNICO usuario: este cliente se queda sin acceso al panel. ¿Quitarlo igualmente?'))return;
 clearTenantErrs();try{const r=await api('/api/admin/tenants/'+editing.id+'/users/'+encodeURIComponent(email),{method:'DELETE'});
  if(r.gate==='pendiente')toast('Fila borrada, pero la puerta de Access NO se sincronizó: ese correo aún puede autenticarse (el worker le da 403). Revisa Telegram.',false);
  else toast('Acceso revocado ✓ a '+email+(r.gate==='sincronizado'?' — puerta de Access actualizada':''));
  loadUsers(editing.id)}
 catch(e2){toast('Acceso NO revocado: '+(TERRS[e2.message]||e2.message),false)}};
$('#tSyncDomains').onclick=()=>{if(!editing){toast('Guarda primero el cliente: los dominios se leen de D1.',false);return}provPost('domains')};
$('#pSub').onclick=()=>provPost('subaccount');
$('#pTpl').onclick=()=>provPost('template');
$('#pSender').onclick=()=>provPost('sender',{phone:$('#pPhone').value.trim()});
$('#pVerify').onclick=()=>provPost('sender/verify',{code:$('#pCode').value.trim()});
async function loadVersions(id){try{const d=await api('/api/admin/tenants/'+id+'/versions');
 $('#tVersions').innerHTML=d.versions.map(v=>'<article><b>'+esc(v.field)+'</b> · '+esc(v.actor_email)+' · '+fmt(v.created_at)+(v.note?' · '+esc(v.note):'')+
  ' <button class="btn alt" data-ver-show="'+v.id+'" type="button">Ver</button>'+
  (v.field==='system_prompt'&&v.previous_value?' <button class="btn alt" data-ver-restore="'+v.id+'" type="button">Restaurar</button>':'')+
  '<pre hidden id="verval-'+v.id+'">'+esc(v.previous_value||'—')+'</pre></article>').join('')||'—';
 $('#tVersions').onclick=async e=>{const s=e.target.closest('[data-ver-show]');if(s){const p=$('#verval-'+s.dataset.verShow);p.hidden=!p.hidden;return}
  const r=e.target.closest('[data-ver-restore]');if(r&&confirm('¿Restaurar esta versión del contexto? Se crea una versión nueva (reversible).')){try{await api('/api/admin/tenants/'+id+'/versions/'+r.dataset.verRestore+'/restore',{method:'POST'});toast('Contexto restaurado ✓ (se creó una versión nueva)');openTenant(id);loadTenantList()}catch(e2){toast('NO restaurado: '+e2.message,false)}}}}
 catch(e){$('#tVersions').textContent=e.message}}

// Handoff: conversaciones con el bot en pausa (un humano las atiende). Reanudar borra la pausa.
async function loadEscalations(){try{const d=await api('/api/admin/escalations');
 $('#escalations').innerHTML=d.escalations.map(e=>{const tn=(tenantList.find(t=>t.id===e.tenantId)||{}).name;
  return '<span class="esc">⏸ '+esc(e.from)+(tn?' · '+esc(tn):'')+' <button type="button" data-resume-t="'+esc(e.tenantId)+'" data-resume-f="'+esc(e.from)+'">Reanudar bot</button></span>'}).join('')}
 catch(e){/* sin escaladas visibles no bloqueamos el panel */}}
$('#escalations').onclick=async e=>{const b=e.target.closest('[data-resume-t]');if(!b)return;
 try{await api('/api/admin/escalations/resume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId:b.dataset.resumeT,from:b.dataset.resumeF})});toast('Bot reanudado ✓ para '+b.dataset.resumeF)}catch(e2){toast('No se pudo reanudar: '+e2.message,false)}
 loadEscalations()};

// El rol decide la interfaz, pero la DEFENSA es del worker en cada endpoint.
let ME={role:'velai'};
(async()=>{try{ME=await api('/api/admin/me')}catch(e){}
 if(ME.role!=='velai'){document.body.classList.add('cliente');if(ME.tenantName)document.querySelector('.brand small').textContent=ME.tenantName}
 else loadTenants();
 load();loadStats();loadEscalations()})();
</script></body></html>`;

export const ADMIN_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};
