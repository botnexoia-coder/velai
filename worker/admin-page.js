// Panel admin — presentación alineada con hirevai.com (SPEC-REDISENO-PANEL.md).
// Reglas que NO se rompen (§7 de la spec): token write-only, provPost recarga la
// ficha entera, nada sensible en el DOM, sin recursos externos salvo las fuentes
// de hirevai.com, y los mismos id/TERRS que traducen los códigos del worker.
export const ADMIN_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Panel · Velai</title>
<style nonce="__NONCE__">
@font-face{font-family:'Cabinet Grotesk';src:url('https://hirevai.com/fonts/cabinet-grotesk-900.woff2') format('woff2');font-weight:900;font-display:swap}
@font-face{font-family:'Satoshi';src:url('https://hirevai.com/fonts/satoshi-400.woff2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'Satoshi';src:url('https://hirevai.com/fonts/satoshi-500.woff2') format('woff2');font-weight:500;font-display:swap}
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
#chart{flex:1;display:flex;align-items:flex-end;gap:3px;min-height:64px;margin-top:8px}
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
.meter{display:inline-block;width:64px;height:6px;background:rgba(255,248,244,.08);border-radius:3px;overflow:hidden;vertical-align:middle;margin-right:7px}
.meter i{display:block;height:100%;background:var(--orange);border-radius:3px}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:12px 4px 0;color:var(--muted);font-size:12px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend i{width:7px;height:7px;border-radius:50%}
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
</header>
<main><div id="viewLeads">
<div class="metrics">
<div class="stat"><b>Leads · 30 días</b><span class="n" id="mTotal">—</span></div>
<div class="stat"><b>Sin contactar</b><span class="n" id="mNew">—</span><small id="mNewSub"></small></div>
<div class="stat" id="mFailCard"><b>Avisos fallidos · 7 días</b><span class="n" id="mFail">—</span></div>
<div class="stat"><b>Clientes activos</b><span class="n" id="mTenants">—</span></div>
<div class="chartcard"><b>Leads por día · 14 días</b><div id="chart"></div><div class="chartlabels"><span id="chartFrom"></span><span id="chartTo"></span></div></div>
</div>
<form class="filters" id="filters"><input name="q" placeholder="Buscar nombre, teléfono, sector…"><select name="tenant" id="tenantFilter"><option value="">Todos los clientes</option></select><select name="status"><option value="">Todos los estados</option><option>new</option><option>contacted</option><option>qualified</option><option>won</option><option>lost</option><option>spam</option></select><select name="notification"><option value="">Todos los avisos</option><option>pending</option><option>sent</option><option>failed</option><option>skipped</option></select><input name="source" placeholder="Fuente"><input name="from" type="date"><input name="to" type="date"><button class="btn">Filtrar</button><span id="resultCount"></span></form>
<div id="message"></div><div class="table"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Estado</th><th>Nombre</th><th>WhatsApp</th><th>Sector</th><th>Fuente</th><th>Avisos</th></tr></thead><tbody id="rows"></tbody></table></div>
<div class="legend"><span><i style="background:var(--st-new)"></i>nuevo</span><span><i style="background:var(--st-contacted)"></i>contactado</span><span><i style="background:var(--st-qualified)"></i>cualificado</span><span><i style="background:var(--st-won)"></i>ganado</span><span><i style="background:var(--st-lost)"></i>perdido</span></div>
<div class="pager"><button class="btn alt" id="more" hidden>Cargar más</button></div></div>
<div id="viewTenants" hidden>
<div class="table"><table><thead><tr><th>Nombre</th><th>Canal</th><th>Leads</th><th>Contexto</th><th>Configuración</th><th>Estado</th></tr></thead><tbody id="tenantRows"></tbody></table></div></div></main>
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
<div class="card" style="margin-top:12px"><b>Contexto del negocio (system prompt) · <span id="tCount" class="muted"></span></b>
<div id="tDup" hidden style="margin:6px 0"><label class="muted">Duplicar de… <select id="tDupSel"><option value="">— empezar de cero —</option></select></label></div>
<textarea id="tPrompt" rows="14" style="width:100%;font-family:ui-monospace,monospace;font-size:12.5px"></textarea>
<small class="muted field-err" data-f="system_prompt"></small></div>
<div class="actions"><input id="tNote" placeholder="Nota del cambio (opcional)" style="flex:1;background:var(--bg);border:1px solid var(--border2);border-radius:var(--r-sm);padding:9px 12px"><button class="btn" id="tenantSave" type="button">Guardar</button></div>
<div class="card"><b>Probar el borrador (no guarda nada)</b>
<div class="note" style="margin-top:6px"><input id="tTestMsg" placeholder="Mensaje de prueba, p. ej. «hola, ¿tenéis hueco mañana?»" style="flex:1"><button class="btn alt" id="tenantPreview" type="button">Probar</button></div>
<article id="tPreviewOut" class="muted" style="white-space:pre-wrap;margin-top:8px"></article></div>
<div class="card" id="tProv" hidden><b>Aprovisionamiento Twilio (automático)</b>
<div id="tProvState" class="muted" style="margin:8px 0;white-space:pre-line"></div>
<div class="actions" style="margin:4px 0 0;align-items:center">
<button class="btn alt" id="pSub" type="button">1· Crear subcuenta</button>
<button class="btn alt" id="pTpl" type="button">2· Plantilla → aprobación</button>
<input id="pPhone" placeholder="+34910000000" style="max-width:150px">
<button class="btn alt" id="pSender" type="button">3· Crear sender</button>
<input id="pCode" placeholder="OTP" style="max-width:80px">
<button class="btn alt" id="pVerify" type="button">4· Verificar OTP</button>
</div></div>
<div class="timeline"><h3>Historial</h3><div id="tVersions" class="muted">—</div></div>
</div></dialog>
<script nonce="__NONCE__">
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let cursor=null,current=null,loadedCount=0;
const ST_LABEL={new:'nuevo',contacted:'contactado',qualified:'cualificado',won:'ganado',lost:'perdido',spam:'spam'};
const TENANT_COLORS=['#3987e5','#9085e9','#199e70','#c98500','#2aa8b8','#c96bb4','#8ba03f','#e66767'];
function tenantColor(id){let h=0;for(const c of String(id||''))h=(h*31+c.charCodeAt(0))>>>0;return TENANT_COLORS[h%TENANT_COLORS.length]}
function statusPill(s){return '<span class="pill s-'+esc(s)+'"><b></b>'+esc(ST_LABEL[s]||s)+'</span>'}
function tenantChip(id,name){return name?'<span class="tenant"><i style="background:'+tenantColor(id)+'"></i>'+esc(name)+'</span>':'<span class="muted">—</span>'}
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
 $('#chart').innerHTML=s.porDia.map(x=>'<div class="bar" style="height:'+Math.max(3,Math.round(x.n/max*100))+'%" title="'+esc(x.d)+': '+x.n+'"></div>').join('');
 $('#chartFrom').textContent=s.porDia[0]?s.porDia[0].d.slice(5):'';$('#chartTo').textContent=s.porDia.at(-1)?s.porDia.at(-1).d.slice(5):''}
 catch(e){/* las métricas no bloquean el listado */}}
async function load(append=false){try{const p=params();if(append&&cursor)p.set('cursor',cursor);const d=await api('/api/admin/leads?'+p);if(!append){$('#rows').innerHTML='';loadedCount=0}
 if(!d.leads.length&&!append)$('#rows').innerHTML='<tr><td colspan="8" class="empty">No hay leads con estos filtros.</td></tr>';
 for(const l of d.leads)$('#rows').insertAdjacentHTML('beforeend','<tr data-id="'+l.id+'"><td>'+fmt(l.created_at)+'</td><td>'+tenantChip(l.tenant_id,l.tenant_name)+'</td><td>'+statusPill(l.status)+'</td><td>'+esc(l.name||'—')+'</td><td class="tel">'+esc(l.whatsapp||'—')+'</td><td>'+esc(l.sector||'—')+'</td><td>'+esc(l.source)+'</td><td>'+nbChips(l.notification_summary)+'</td></tr>');
 loadedCount+=d.leads.length;cursor=d.nextCursor;$('#more').hidden=!cursor;
 $('#resultCount').textContent=loadedCount+(cursor?'+':'')+' resultado'+(loadedCount===1?'':'s');
 $('#message').textContent=''}catch(e){$('#message').innerHTML='<p class="error">'+esc(e.message)+'</p>'}}
async function loadTenants(){try{const d=await api('/api/admin/tenants');for(const t of d.tenants)$('#tenantFilter').insertAdjacentHTML('beforeend','<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>')}catch(e){/* sin tenants: el filtro queda en Todos */}}
$('#filters').onsubmit=e=>{e.preventDefault();cursor=null;load()};$('#more').onclick=()=>load(true);$('#export').onclick=()=>location.href='/api/admin/leads/export.csv?'+params();$('#close').onclick=()=>$('#detail').close();
$('#rows').onclick=e=>{const tr=e.target.closest('[data-id]');if(tr)openLead(tr.dataset.id)};
async function openLead(id){try{const d=await api('/api/admin/leads/'+id);current=d.lead;const l=d.lead;const cards=[['Fecha',fmt(l.created_at)],['Cliente',l.tenant_name],['Nombre',l.name],['WhatsApp',l.whatsapp],['Sector',l.sector],['Fuente',l.source],['Mensajes/día',l.messages_per_day],['Canal',l.channel],['Puntuación',l.score],['Nota',l.note],['Página',l.page_url]].map(x=>'<div class="card"><b>'+x[0]+'</b>'+esc(x[1]??'—')+'</div>').join('');const options=['new','contacted','qualified','won','lost','spam'].map(s=>'<option '+(s===l.status?'selected':'')+'>'+s+'</option>').join('');const notices=d.notifications.map(n=>'<article><b>Aviso '+esc(n.channel)+': '+esc(n.status)+'</b><div class="muted">Intentos: '+n.attempts+(n.last_error?' · '+esc(n.last_error):'')+'</div></article>').join('');const notes=d.notes.map(n=>'<article><b>'+esc(n.author_email)+'</b><div>'+esc(n.text)+'</div><small class="muted">'+fmt(n.created_at)+'</small></article>').join('');const events=d.events.map(n=>'<article><b>'+esc(n.event_type)+'</b><div>'+esc(n.detail||'')+'</div><small class="muted">'+fmt(n.created_at)+' · '+esc(n.actor_email)+'</small></article>').join('');$('#detailBody').innerHTML='<div class="grid">'+cards+'</div><div class="actions"><select id="status" style="background:var(--bg);border:1px solid var(--border2);border-radius:var(--r-sm);padding:9px 12px">'+options+'</select><button class="btn" id="saveStatus">Guardar estado</button><button class="btn alt" id="retry">Reintentar avisos</button><button class="btn bad" id="delete">Borrar lead</button></div><div class="note"><textarea id="note" rows="3" placeholder="Añadir nota…"></textarea><button class="btn" id="addNote">Añadir</button></div><div class="timeline"><h3>Actividad</h3>'+notices+notes+events+'</div>';wireDetail();$('#detail').showModal()}catch(e){alert(e.message)}}
function wireDetail(){$('#saveStatus').onclick=async()=>{await api('/api/admin/leads/'+current.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:$('#status').value})});$('#detail').close();load();loadStats()};$('#retry').onclick=async()=>{await api('/api/admin/leads/'+current.id+'/retry',{method:'POST'});openLead(current.id)};$('#addNote').onclick=async()=>{const text=$('#note').value.trim();if(!text)return;await api('/api/admin/leads/'+current.id+'/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});openLead(current.id)};$('#delete').onclick=async()=>{if(!confirm('¿Borrar definitivamente este lead y todos sus datos?'))return;await api('/api/admin/leads/'+current.id,{method:'DELETE'});$('#detail').close();load();loadStats()}}
// ── Pestaña Clientes ──
const TERRS={already_provisioned:'Ese paso ya está hecho (idempotente: un doble clic no crea recursos duplicados).',provision_in_progress:'Ese paso ya está en curso, espera unos segundos.',waba_required:'Rellena y guarda primero la WABA del cliente.',subaccount_required:'Crea primero la subcuenta (paso 1).',twilio_auth_token_missing:'La subcuenta no tiene auth token guardado.',provision_orphan:'Twilio creó el recurso pero D1 no lo guardó: revisa Telegram y reconcilia a mano.',invalid_code:'El OTP son 4-8 dígitos.',slug_taken:'Ese slug ya existe.',address_taken:'Ese canal ya está asignado a otro cliente: guardarlo desviaría sus conversaciones.',subaccount_taken:'Esa subcuenta de Twilio ya está asignada a otro cliente.',pending_tenant_cannot_be_active:'Un prospecto (canal pending:) no puede activarse: ponle primero su canal real.',invalid_twilio_auth_token:'El auth token debe ser 32 caracteres hexadecimales (Twilio → Keys & Credentials).',stale_tenant:'Alguien modificó este cliente mientras editabas. Recarga la ficha y vuelve a aplicar tus cambios.',nothing_to_update:'No hay cambios que guardar.',invalid_preview:'Escribe un mensaje de prueba y un contexto de al menos 50 caracteres.',rate_limited:'Demasiadas pruebas seguidas: espera un minuto.'};
let tenantList=[],editing=null;
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>{x.classList.toggle('is-on',x===b);x.setAttribute('aria-selected',x===b?'true':'false')});const v=b.dataset.view;$('#viewLeads').hidden=v!=='leads';$('#viewTenants').hidden=v!=='tenants';$('#export').hidden=v!=='leads';$('#newTenant').hidden=v!=='tenants';if(v==='tenants')loadTenantList();else loadStats()});
function flags(list,cls){return list.map(f=>'<span class="flag'+(cls?' '+cls:'')+'">'+esc(f)+'</span>').join('')}
function semaforo(t){if(!t.active&&String(t.channel_address).startsWith('pending:'))return '<span class="flag off">prospecto</span>';
 const long=t.prompt_len>8000?['contexto muy largo']:[];
 if(String(t.channel_address).startsWith('web:')){const f=[...long];if(t.prompt_len<200)f.push('contexto corto');if(!t.has_team&&!t.has_telegram)f.push('sin canal de aviso');return '<span class="flag web">solo web</span>'+(f.length?flags(f):' <span class="flag ok">listo</span>')}
 const f=[...long];if(!t.has_template)f.push('sin plantilla');if(!t.has_team)f.push('sin equipo');if(t.prompt_len<200)f.push('contexto corto');if(t.has_subaccount&&!t.has_twilio_token)f.push('sin token');if(t.has_subaccount&&!t.has_from)f.push('sin From');if(t.meta_partner_status==='pendiente'&&t.has_subaccount)f.push('socio pendiente');return f.length?flags(f):'<span class="flag ok">listo</span>'}
function meter(chars){const w=Math.min(100,Math.round(chars/12000*100));return '<span class="meter" title="El contexto viaja al modelo en CADA mensaje"><i style="width:'+w+'%"></i></span><span class="muted">'+chars+' car.</span>'}
async function loadTenantList(){try{const d=await api('/api/admin/tenants');tenantList=d.tenants;$('#tenantRows').innerHTML=d.tenants.map(t=>'<tr data-tid="'+t.id+'"><td>'+tenantChip(t.id,t.name)+'</td><td class="muted">'+esc(t.channel_address)+'</td><td>'+t.lead_count+'</td><td>'+meter(t.prompt_len)+'</td><td>'+semaforo(t)+'</td><td>'+(t.active?'<span class="flag ok">activo</span>':'<span class="flag off">inactivo</span>')+'</td></tr>').join('')||'<tr><td colspan="6" class="empty">Sin clientes.</td></tr>'}catch(e){alert(e.message)}}
$('#tenantRows').onclick=e=>{const tr=e.target.closest('[data-tid]');if(tr)openTenant(tr.dataset.tid)};
$('#newTenant').onclick=()=>openTenant(null);
$('#tenantClose').onclick=()=>$('#tenantModal').close();
const TF={name:'#tName',slug:'#tSlug',channel_address:'#tAddress',twilio_from:'#tFrom',team_whatsapp:'#tTeam',telegram_chat_id:'#tChat',lead_template_sid:'#tTpl',twilio_subaccount_sid:'#tSub',waba_id:'#tWaba',meta_partner_status:'#tPartner',system_prompt:'#tPrompt'};
function clearTenantErrs(){document.querySelectorAll('.field-err').forEach(x=>x.textContent='');$('#tenantMsg').innerHTML=''}
function updateCount(){const n=$('#tPrompt').value.length;$('#tCount').textContent=n+' caracteres · ≈'+Math.round(n/4)+' tokens en CADA mensaje'}
$('#tPrompt').oninput=updateCount;
async function openTenant(id){clearTenantErrs();$('#tPreviewOut').textContent='';$('#tTestMsg').value='';$('#tNote').value='';
 $('#tToken').value='';
 if(id){const d=await api('/api/admin/tenants/'+id);const t=d.tenant;editing={id:t.id,updated_at:t.updated_at};$('#tenantTitle').textContent=t.name;$('#tDup').hidden=true;for(const[k,sel]of Object.entries(TF))$(sel).value=t[k]??'';$('#tActive').checked=!!t.active;$('#tTokenState').textContent=t.has_twilio_token?'configurado ✓ (escribe solo para sustituirlo)':'sin configurar';$('#tProv').hidden=false;loadProv(id);loadVersions(id)}
 else{editing=null;$('#tenantTitle').textContent='Nuevo cliente';$('#tDup').hidden=false;$('#tDupSel').innerHTML='<option value="">— empezar de cero —</option>'+tenantList.map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('');for(const sel of Object.values(TF))$(sel).value='';$('#tPartner').value='pendiente';$('#tActive').checked=true;$('#tTokenState').textContent='sin configurar';$('#tProv').hidden=true;$('#tVersions').textContent='—'}
 updateCount();$('#tenantModal').showModal()}
$('#tDupSel').onchange=async e=>{if(!e.target.value)return;const d=await api('/api/admin/tenants/'+e.target.value);$('#tPrompt').value=d.tenant.system_prompt||'';updateCount()};
$('#tenantSave').onclick=async()=>{clearTenantErrs();
 const body={};for(const[k,sel]of Object.entries(TF))body[k]=$(sel).value;body.active=$('#tActive').checked;body.note=$('#tNote').value;
 if($('#tToken').value)body.twilio_auth_token=$('#tToken').value; // write-only: solo si se escribe
 try{
  if(editing){body.expected_updated_at=editing.updated_at;const r=await api('/api/admin/tenants/'+editing.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});editing.updated_at=r.updated_at;loadVersions(editing.id)}
  else{const r=await api('/api/admin/tenants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});editing={id:r.id,updated_at:r.updated_at};$('#tenantTitle').textContent=body.name;$('#tDup').hidden=true}
  $('#tenantMsg').innerHTML='<p style="color:var(--ok)">Guardado.</p>';loadTenantList()
 }catch(e){const c=e.message;const m=c.match(/^invalid_(.+)$/);
  if(m&&document.querySelector('.field-err[data-f="'+m[1]+'"]'))document.querySelector('.field-err[data-f="'+m[1]+'"]').textContent='Formato inválido — revisa el ejemplo del campo.';
  else $('#tenantMsg').innerHTML='<p class="error">'+esc(TERRS[c]||c)+'</p>'}};
$('#tenantPreview').onclick=async()=>{clearTenantErrs();$('#tPreviewOut').textContent='Pensando…';
 try{const anyId=editing?editing.id:'00000000-0000-4000-8000-000000000001';
  const r=await api('/api/admin/tenants/'+anyId+'/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:$('#tPrompt').value,message:$('#tTestMsg').value})});
  $('#tPreviewOut').textContent=r.reply}
 catch(e){$('#tPreviewOut').textContent='';$('#tenantMsg').innerHTML='<p class="error">'+esc(TERRS[e.message]||e.message)+'</p>'}};
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
  const keep=editing.id;await openTenant(keep);$('#tenantMsg').innerHTML='<p style="color:var(--ok)">Hecho.</p>';loadTenantList()}
 catch(e){$('#tenantMsg').innerHTML='<p class="error">'+esc(TERRS[e.message]||e.message)+'</p>'}}
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
  const r=e.target.closest('[data-ver-restore]');if(r&&confirm('¿Restaurar esta versión del contexto? Se crea una versión nueva (reversible).')){await api('/api/admin/tenants/'+id+'/versions/'+r.dataset.verRestore+'/restore',{method:'POST'});openTenant(id);loadTenantList()}}}
 catch(e){$('#tVersions').textContent=e.message}}

loadTenants();load();loadStats();
</script></body></html>`;

export const ADMIN_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};
