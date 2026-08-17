export const ADMIN_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Leads · Velai</title>
<style nonce="__NONCE__">
:root{color-scheme:dark;--bg:#0c0d10;--panel:#17191f;--line:#2b2e37;--muted:#9298a8;--orange:#ff6b1a;--ok:#46d18c;--bad:#ff6b6b}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#f7f7f8;font:14px system-ui,sans-serif}button,input,select,textarea{font:inherit}header{padding:22px max(20px,4vw);display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)}h1{margin:0;font-size:22px}main{padding:24px max(20px,4vw)}.filters{display:grid;grid-template-columns:2fr repeat(6,1fr) auto;gap:10px;margin-bottom:18px}.filters input,.filters select,.note textarea{width:100%;background:var(--panel);color:#fff;border:1px solid var(--line);border-radius:9px;padding:10px}.btn{border:0;border-radius:9px;padding:10px 14px;background:var(--orange);color:#fff;cursor:pointer;font-weight:700}.btn.alt{background:#292d37}.btn.bad{background:#8d3030}.table{border:1px solid var(--line);border-radius:12px;overflow:auto;background:var(--panel)}table{width:100%;border-collapse:collapse;min-width:920px}th,td{padding:12px;text-align:left;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:12px}tr[data-id]{cursor:pointer}tr[data-id]:hover{background:#20232b}.pill{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:3px 8px}.muted{color:var(--muted)}.pager{text-align:center;margin:18px}.empty{text-align:center;padding:36px;color:var(--muted)}dialog{width:min(760px,calc(100% - 24px));max-height:90vh;overflow:auto;background:var(--panel);color:#fff;border:1px solid var(--line);border-radius:14px;padding:0}dialog::backdrop{background:#000b}.modal-h{position:sticky;top:0;background:var(--panel);display:flex;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--line)}.modal-b{padding:20px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{background:#111319;border:1px solid var(--line);border-radius:10px;padding:12px}.card b{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;margin-bottom:5px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}.note{display:flex;gap:8px}.timeline{margin-top:20px}.timeline article{border-left:2px solid var(--line);padding:0 0 14px 12px}.error{color:var(--bad)}.tabs{display:flex;gap:8px}.tab.is-on{background:var(--orange)}.card input,.card textarea,.card select{width:100%;background:#111319;color:#fff;border:1px solid var(--line);border-radius:8px;padding:8px;margin-top:4px}.field-err{display:block;margin-top:4px;color:var(--bad)}.field-err:empty{display:none}#tVersions article{margin-bottom:10px}#tVersions pre{white-space:pre-wrap;background:#111319;border:1px solid var(--line);border-radius:8px;padding:8px;font-size:11.5px;max-height:220px;overflow:auto}@media(max-width:850px){.filters{grid-template-columns:1fr 1fr}.filters input{grid-column:1/-1}.grid{grid-template-columns:1fr}}
</style></head><body>
<header><h1>Velai · Panel</h1><nav class="tabs"><button class="btn alt tab is-on" data-view="leads" type="button">Leads</button><button class="btn alt tab" data-view="tenants" type="button">Clientes</button></nav><button class="btn alt" id="export">Exportar CSV</button></header>
<main><div id="viewLeads"><form class="filters" id="filters"><input name="q" placeholder="Buscar nombre, teléfono, sector…"><select name="tenant" id="tenantFilter"><option value="">Todos los clientes</option></select><select name="status"><option value="">Todos los estados</option><option>new</option><option>contacted</option><option>qualified</option><option>won</option><option>lost</option><option>spam</option></select><select name="notification"><option value="">Todos los avisos</option><option>pending</option><option>sent</option><option>failed</option><option>skipped</option></select><input name="source" placeholder="Fuente"><input name="from" type="date"><input name="to" type="date"><button class="btn">Filtrar</button></form>
<div id="message"></div><div class="table"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Estado</th><th>Nombre</th><th>WhatsApp</th><th>Sector</th><th>Fuente</th><th>Avisos</th></tr></thead><tbody id="rows"></tbody></table></div><div class="pager"><button class="btn alt" id="more" hidden>Cargar más</button></div></div>
<div id="viewTenants" hidden><div class="actions" style="margin:0 0 14px"><button class="btn" id="newTenant" type="button">Nuevo cliente</button></div>
<div class="table"><table><thead><tr><th>Nombre</th><th>Canal</th><th>Leads</th><th>Contexto</th><th>Configuración</th><th>Estado</th></tr></thead><tbody id="tenantRows"></tbody></table></div></div></main>
<dialog id="detail"><div class="modal-h"><strong>Detalle del lead</strong><button class="btn alt" id="close">Cerrar</button></div><div class="modal-b" id="detailBody"></div></dialog>
<dialog id="tenantModal"><div class="modal-h"><strong id="tenantTitle">Cliente</strong><button class="btn alt" id="tenantClose" type="button">Cerrar</button></div><div class="modal-b">
<div id="tenantMsg"></div>
<div class="grid">
<div class="card"><b>Nombre</b><input id="tName" placeholder="Barbería López"><small class="muted field-err" data-f="name"></small></div>
<div class="card"><b>Slug</b><input id="tSlug" placeholder="barberia-lopez"><small class="muted field-err" data-f="slug"></small></div>
<div class="card"><b>Canal (To de Twilio)</b><input id="tAddress" placeholder="whatsapp:+34910000000 · messenger:12345 · pending:mi-cliente"><small class="muted field-err" data-f="channel_address"></small></div>
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
<div class="actions"><input id="tNote" placeholder="Nota del cambio (opcional)" style="flex:1"><button class="btn" id="tenantSave" type="button">Guardar</button></div>
<div class="card"><b>Probar el borrador (no guarda nada)</b>
<div class="note" style="margin-top:6px"><input id="tTestMsg" placeholder="Mensaje de prueba, p. ej. «hola, ¿tenéis hueco mañana?»" style="flex:1"><button class="btn alt" id="tenantPreview" type="button">Probar</button></div>
<article id="tPreviewOut" class="muted" style="white-space:pre-wrap;margin-top:8px"></article></div>
<div class="timeline"><h3>Historial</h3><div id="tVersions" class="muted">—</div></div>
</div></dialog>
<script nonce="__NONCE__">
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let cursor=null,current=null;
function params(){const p=new URLSearchParams(new FormData($('#filters')));for(const[k,v]of[...p])if(!v)p.delete(k);return p}
async function api(path,options){const r=await fetch(path,options);if(r.status===204)return null;const d=await r.json();if(!r.ok)throw Error(d.error||'request_failed');return d}
function fmt(v){return v?new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—'}
async function load(append=false){try{const p=params();if(append&&cursor)p.set('cursor',cursor);const d=await api('/api/admin/leads?'+p);if(!append)$('#rows').innerHTML='';if(!d.leads.length&&!append)$('#rows').innerHTML='<tr><td colspan="8" class="empty">No hay leads con estos filtros.</td></tr>';for(const l of d.leads)$('#rows').insertAdjacentHTML('beforeend','<tr data-id="'+l.id+'"><td>'+fmt(l.created_at)+'</td><td>'+esc(l.tenant_name||'—')+'</td><td><span class="pill">'+esc(l.status)+'</span></td><td>'+esc(l.name||'—')+'</td><td>'+esc(l.whatsapp||'—')+'</td><td>'+esc(l.sector||'—')+'</td><td>'+esc(l.source)+'</td><td class="muted">'+esc(l.notification_summary||'—')+'</td></tr>');cursor=d.nextCursor;$('#more').hidden=!cursor;$('#message').textContent=''}catch(e){$('#message').innerHTML='<p class="error">'+esc(e.message)+'</p>'}}
async function loadTenants(){try{const d=await api('/api/admin/tenants');for(const t of d.tenants)$('#tenantFilter').insertAdjacentHTML('beforeend','<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>')}catch(e){/* sin tenants: el filtro queda en Todos */}}
$('#filters').onsubmit=e=>{e.preventDefault();cursor=null;load()};$('#more').onclick=()=>load(true);$('#export').onclick=()=>location.href='/api/admin/leads/export.csv?'+params();$('#close').onclick=()=>$('#detail').close();
$('#rows').onclick=e=>{const tr=e.target.closest('[data-id]');if(tr)openLead(tr.dataset.id)};
async function openLead(id){try{const d=await api('/api/admin/leads/'+id);current=d.lead;const l=d.lead;const cards=[['Fecha',fmt(l.created_at)],['Cliente',l.tenant_name],['Nombre',l.name],['WhatsApp',l.whatsapp],['Sector',l.sector],['Fuente',l.source],['Mensajes/día',l.messages_per_day],['Canal',l.channel],['Puntuación',l.score],['Nota',l.note],['Página',l.page_url]].map(x=>'<div class="card"><b>'+x[0]+'</b>'+esc(x[1]??'—')+'</div>').join('');const options=['new','contacted','qualified','won','lost','spam'].map(s=>'<option '+(s===l.status?'selected':'')+'>'+s+'</option>').join('');const notices=d.notifications.map(n=>'<article><b>Aviso '+esc(n.channel)+': '+esc(n.status)+'</b><div class="muted">Intentos: '+n.attempts+(n.last_error?' · '+esc(n.last_error):'')+'</div></article>').join('');const notes=d.notes.map(n=>'<article><b>'+esc(n.author_email)+'</b><div>'+esc(n.text)+'</div><small class="muted">'+fmt(n.created_at)+'</small></article>').join('');const events=d.events.map(n=>'<article><b>'+esc(n.event_type)+'</b><div>'+esc(n.detail||'')+'</div><small class="muted">'+fmt(n.created_at)+' · '+esc(n.actor_email)+'</small></article>').join('');$('#detailBody').innerHTML='<div class="grid">'+cards+'</div><div class="actions"><select id="status">'+options+'</select><button class="btn" id="saveStatus">Guardar estado</button><button class="btn alt" id="retry">Reintentar avisos</button><button class="btn bad" id="delete">Borrar lead</button></div><div class="note"><textarea id="note" rows="3" placeholder="Añadir nota…"></textarea><button class="btn" id="addNote">Añadir</button></div><div class="timeline"><h3>Actividad</h3>'+notices+notes+events+'</div>';wireDetail();$('#detail').showModal()}catch(e){alert(e.message)}}
function wireDetail(){$('#saveStatus').onclick=async()=>{await api('/api/admin/leads/'+current.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:$('#status').value})});$('#detail').close();load()};$('#retry').onclick=async()=>{await api('/api/admin/leads/'+current.id+'/retry',{method:'POST'});openLead(current.id)};$('#addNote').onclick=async()=>{const text=$('#note').value.trim();if(!text)return;await api('/api/admin/leads/'+current.id+'/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});openLead(current.id)};$('#delete').onclick=async()=>{if(!confirm('¿Borrar definitivamente este lead y todos sus datos?'))return;await api('/api/admin/leads/'+current.id,{method:'DELETE'});$('#detail').close();load()}}
// ── Pestaña Clientes ──
const TERRS={slug_taken:'Ese slug ya existe.',address_taken:'Ese canal ya está asignado a otro cliente: guardarlo desviaría sus conversaciones.',subaccount_taken:'Esa subcuenta de Twilio ya está asignada a otro cliente.',pending_tenant_cannot_be_active:'Un prospecto (canal pending:) no puede activarse: ponle primero su canal real.',invalid_twilio_auth_token:'El auth token debe ser 32 caracteres hexadecimales (Twilio → Keys & Credentials).',stale_tenant:'Alguien modificó este cliente mientras editabas. Recarga la ficha y vuelve a aplicar tus cambios.',nothing_to_update:'No hay cambios que guardar.',invalid_preview:'Escribe un mensaje de prueba y un contexto de al menos 50 caracteres.',rate_limited:'Demasiadas pruebas seguidas: espera un minuto.'};
let tenantList=[],editing=null;
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('is-on',x===b));const v=b.dataset.view;$('#viewLeads').hidden=v!=='leads';$('#viewTenants').hidden=v!=='tenants';$('#export').hidden=v!=='leads';if(v==='tenants')loadTenantList()});
function semaforo(t){if(!t.active&&String(t.channel_address).startsWith('pending:'))return '<span class="muted">prospecto</span>';const f=[];if(!t.has_template)f.push('sin plantilla');if(!t.has_team)f.push('sin equipo');if(t.prompt_len<200)f.push('contexto corto');if(t.has_subaccount&&!t.has_twilio_token)f.push('sin token');if(t.meta_partner_status==='pendiente'&&t.has_subaccount)f.push('socio pendiente');return f.length?'<span class="error">'+esc(f.join(' · '))+'</span>':'✓'}
async function loadTenantList(){try{const d=await api('/api/admin/tenants');tenantList=d.tenants;$('#tenantRows').innerHTML=d.tenants.map(t=>'<tr data-tid="'+t.id+'"><td>'+esc(t.name)+'</td><td class="muted">'+esc(t.channel_address)+'</td><td>'+t.lead_count+'</td><td>'+t.prompt_len+' car.</td><td>'+semaforo(t)+'</td><td><span class="pill'+(t.active?'':' error')+'">'+(t.active?'activo':'inactivo')+'</span></td></tr>').join('')||'<tr><td colspan="6" class="empty">Sin clientes.</td></tr>'}catch(e){alert(e.message)}}
$('#tenantRows').onclick=e=>{const tr=e.target.closest('[data-tid]');if(tr)openTenant(tr.dataset.tid)};
$('#newTenant').onclick=()=>openTenant(null);
$('#tenantClose').onclick=()=>$('#tenantModal').close();
const TF={name:'#tName',slug:'#tSlug',channel_address:'#tAddress',twilio_from:'#tFrom',team_whatsapp:'#tTeam',telegram_chat_id:'#tChat',lead_template_sid:'#tTpl',twilio_subaccount_sid:'#tSub',waba_id:'#tWaba',meta_partner_status:'#tPartner',system_prompt:'#tPrompt'};
function clearTenantErrs(){document.querySelectorAll('.field-err').forEach(x=>x.textContent='');$('#tenantMsg').innerHTML=''}
function updateCount(){const n=$('#tPrompt').value.length;$('#tCount').textContent=n+' caracteres · ≈'+Math.round(n/4)+' tokens en CADA mensaje'}
$('#tPrompt').oninput=updateCount;
async function openTenant(id){clearTenantErrs();$('#tPreviewOut').textContent='';$('#tTestMsg').value='';$('#tNote').value='';
 $('#tToken').value='';
 if(id){const d=await api('/api/admin/tenants/'+id);const t=d.tenant;editing={id:t.id,updated_at:t.updated_at};$('#tenantTitle').textContent=t.name;$('#tDup').hidden=true;for(const[k,sel]of Object.entries(TF))$(sel).value=t[k]??'';$('#tActive').checked=!!t.active;$('#tTokenState').textContent=t.has_twilio_token?'configurado ✓ (escribe solo para sustituirlo)':'sin configurar';loadVersions(id)}
 else{editing=null;$('#tenantTitle').textContent='Nuevo cliente';$('#tDup').hidden=false;$('#tDupSel').innerHTML='<option value="">— empezar de cero —</option>'+tenantList.map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('');for(const sel of Object.values(TF))$(sel).value='';$('#tPartner').value='pendiente';$('#tActive').checked=true;$('#tTokenState').textContent='sin configurar';$('#tVersions').textContent='—'}
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
async function loadVersions(id){try{const d=await api('/api/admin/tenants/'+id+'/versions');
 $('#tVersions').innerHTML=d.versions.map(v=>'<article><b>'+esc(v.field)+'</b> · '+esc(v.actor_email)+' · '+fmt(v.created_at)+(v.note?' · '+esc(v.note):'')+
  ' <button class="btn alt" data-ver-show="'+v.id+'" type="button">Ver</button>'+
  (v.field==='system_prompt'&&v.previous_value?' <button class="btn alt" data-ver-restore="'+v.id+'" type="button">Restaurar</button>':'')+
  '<pre hidden id="verval-'+v.id+'">'+esc(v.previous_value||'—')+'</pre></article>').join('')||'—';
 $('#tVersions').onclick=async e=>{const s=e.target.closest('[data-ver-show]');if(s){const p=$('#verval-'+s.dataset.verShow);p.hidden=!p.hidden;return}
  const r=e.target.closest('[data-ver-restore]');if(r&&confirm('¿Restaurar esta versión del contexto? Se crea una versión nueva (reversible).')){await api('/api/admin/tenants/'+id+'/versions/'+r.dataset.verRestore+'/restore',{method:'POST'});openTenant(id);loadTenantList()}}}
 catch(e){$('#tVersions').textContent=e.message}}

loadTenants();load();
</script></body></html>`;

export const ADMIN_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};
