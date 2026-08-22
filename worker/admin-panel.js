// JS del panel admin, como FUNCIÓN REAL y no como texto dentro de un template
// literal: así node --check y los tests lo validan de verdad (antes un typo aquí
// compilaba, desplegaba y solo explotaba en el navegador del cliente).
// admin-page.js lo serializa al HTML con panelApp.toString() — de ahí las reglas:
//  - AUTOCONTENIDA: solo APIs del navegador; no puede capturar nada de este módulo.
//  - sin la subcadena de cierre de script ni backticks (romperían el HTML del panel).
export function panelApp() {
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
// Tema de las VISTAS (canvas «Panel Velai — Tema claro»): claro por defecto, el
// botón del pie de la barra alterna a oscuro. La barra lateral no cambia nunca
// (los tokens oscuros de :root no entran en el ámbito de main/dialog). La elección
// se recuerda POR PESTAÑA en sessionStorage — la invariante del panel prohíbe el
// almacenamiento persistente del navegador.
function applyTheme(dark){document.body.classList.toggle('dark',!!dark);
 $('#thSun').hidden=!dark;$('#thMoon').hidden=!!dark;
 $('#themeLabel').textContent=dark?'Tema claro':'Tema oscuro';
 try{sessionStorage.setItem('velai-panel-dark',dark?'1':'')}catch(e){}}
$('#themeBtn').onclick=()=>applyTheme(!document.body.classList.contains('dark'));
(function(){let dark=false;try{dark=sessionStorage.getItem('velai-panel-dark')==='1'}catch(e){}if(dark)applyTheme(true)})();
$('#filters').onsubmit=e=>{e.preventDefault();cursor=null;load()};$('#more').onclick=()=>load(true);$('#export').onclick=()=>location.href='/api/admin/leads/export.csv?'+params();$('#close').onclick=()=>$('#detail').close();
$('#rows').onclick=e=>{const tr=e.target.closest('[data-id]');if(tr)openLead(tr.dataset.id)};
async function openLead(id){try{const d=await api('/api/admin/leads/'+id);current=d.lead;const l=d.lead;
 $('#detailTitle').textContent=l.name||'Lead sin nombre';
 // Contexto arriba en píldoras; abajo SOLO las tarjetas con dato (nada de parrilla de guiones).
 const meta='<div class="lead-meta">'+statusPill(l.status)+tenantChip(l.tenant_id,l.tenant_name)+'<span class="chip">'+fmt(l.created_at)+'</span><span class="chip">fuente: '+esc(l.source)+'</span></div>';
 const waCard='<div class="card"><b>WhatsApp</b><span class="tel">'+esc(l.whatsapp||'—')+'</span></div>';
 const cards=[['Sector',l.sector],['Canal',l.channel],['Mensajes/día',l.messages_per_day],['Puntuación',l.score],['Nota del lead',l.note],['Página',l.page_url]]
  .filter(x=>x[1]!=null&&x[1]!=='').map(x=>'<div class="card"><b>'+x[0]+'</b>'+esc(x[1])+'</div>').join('');
 const options=['new','contacted','qualified','won','lost','spam'].map(s=>'<option value="'+s+'"'+(s===l.status?' selected':'')+'>'+ST_LABEL[s]+'</option>').join('');
 const notices=d.notifications.map(n=>'<article><b>Aviso '+esc(n.channel)+': '+esc(n.status)+'</b><div class="muted">Intentos: '+n.attempts+(n.last_error?' · '+esc(n.last_error):'')+'</div></article>').join('');
 const notes=d.notes.map(n=>'<article><b>'+esc(n.author_email)+'</b><div>'+esc(n.text)+'</div><small class="muted">'+fmt(n.created_at)+'</small></article>').join('');
 const events=d.events.map(n=>'<article><b>'+esc(n.event_type)+'</b><div>'+esc(n.detail||'')+'</div><small class="muted">'+fmt(n.created_at)+' · '+esc(n.actor_email)+'</small></article>').join('');
 const acts=notices+notes+events;
 const velaiBtns=ME.role==='velai'?'<button class="btn alt" id="retry">Reintentar avisos</button><button class="btn bad" id="delete">Borrar lead</button>':'';
 $('#detailBody').innerHTML=meta+'<div class="grid mt12">'+waCard+cards+'</div>'
 +'<div class="actions"><span class="sel"><select id="status">'+options+'</select></span><button class="btn" id="saveStatus">Guardar estado</button><span class="grow"></span>'+velaiBtns+'</div>'
 +'<div class="card"><b>Añadir nota</b><div class="note mt6"><textarea id="note" rows="2" placeholder="Escribe la nota…"></textarea><button class="btn" id="addNote">Añadir</button></div></div>'
 +'<div class="timeline"><h3>Actividad</h3>'+(acts||'<p class="muted">Sin actividad todavía: ni avisos, ni notas, ni cambios.</p>')+'</div>';
 paint($('#detailBody'));wireDetail();$('#detail').showModal()}catch(e){toast('No se pudo abrir el lead: '+e.message,false)}}
// Cada acción confirma con toast; sin el try/catch un fallo del PATCH era INVISIBLE
// (la promesa moría sin aviso y el usuario creía que había guardado).
function wireDetail(){$('#saveStatus').onclick=async()=>{try{await api('/api/admin/leads/'+current.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:$('#status').value})});toast('Estado guardado ✓ («'+(ST_LABEL[$('#status').value]||$('#status').value)+'»)');$('#detail').close();load();loadStats()}catch(e){toast('Estado NO guardado: '+e.message,false)}};if($('#retry'))$('#retry').onclick=async()=>{try{await api('/api/admin/leads/'+current.id+'/retry',{method:'POST'});toast('Reintento de avisos lanzado ✓');openLead(current.id)}catch(e){toast('Reintento fallido: '+e.message,false)}};$('#addNote').onclick=async()=>{const text=$('#note').value.trim();if(!text)return;try{await api('/api/admin/leads/'+current.id+'/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});toast('Nota guardada ✓');openLead(current.id)}catch(e){toast('Nota NO guardada: '+e.message,false)}};if($('#delete'))$('#delete').onclick=async()=>{if(!confirm('¿Borrar definitivamente este lead y todos sus datos?'))return;try{await api('/api/admin/leads/'+current.id,{method:'DELETE'});toast('Lead borrado ✓');$('#detail').close();load();loadStats()}catch(e){toast('Lead NO borrado: '+e.message,false)}}}
// ── Vistas (barra lateral) ──
const TERRS={already_provisioned:'Ese paso ya está hecho (idempotente: un doble clic no crea recursos duplicados).',provision_in_progress:'Ese paso ya está en curso, espera unos segundos.',waba_required:'Rellena y guarda primero la WABA del cliente.',subaccount_required:'Crea primero la subcuenta (paso 1).',subaccount_unusable:'Esa subcuenta no existe en Twilio o no está activa: revisa el SID pegado en la ficha.',twilio_auth_token_missing:'La subcuenta no tiene auth token guardado.',provision_orphan:'Twilio creó el recurso pero D1 no lo guardó: revisa Telegram y reconcilia a mano.',invalid_code:'El OTP son 4-8 dígitos.',slug_taken:'Ese slug ya existe.',address_taken:'Ese canal ya está asignado a otro cliente: guardarlo desviaría sus conversaciones.',subaccount_taken:'Esa subcuenta de Twilio ya está asignada a otro cliente.',pending_tenant_cannot_be_active:'Un prospecto (canal pending:) no puede activarse: ponle primero su canal real.',invalid_twilio_auth_token:'El auth token debe ser 32 caracteres hexadecimales (Twilio → Keys & Credentials).',stale_tenant:'Alguien modificó este cliente mientras editabas. Recarga la ficha y vuelve a aplicar tus cambios.',nothing_to_update:'No hay cambios que guardar.',invalid_preview:'Escribe un mensaje de prueba y un contexto de al menos 50 caracteres.',rate_limited:'Demasiadas pruebas seguidas: espera un minuto.',email_taken:'Ese correo ya tiene acceso al panel de OTRO cliente (un correo pertenece a un solo cliente).',email_is_admin:'Ese correo es admin de Velai (ADMIN_EMAILS): ya ve todo, no puede ser usuario de un cliente.',invalid_email:'Eso no parece un correo válido.',cloudflare_api_not_configured:'Falta CF_API_TOKEN (secret) o CF_ACCOUNT_ID en el worker: la sincronización con Cloudflare no está activa.',turnstile_sync_failed:'El PUT a Turnstile falló DESPUÉS de guardar en D1: el worker acepta el origen pero Turnstile no emitirá token. Reintenta Sincronizar Turnstile.',turnstile_domains_limit:'Turnstile admite 10 dominios por widget y ya se superan incluso plegando los www: toca pasar a un widget por cliente (alternativa §4 de la spec).',already_admin:'Ese correo ya es admin.',email_is_client:'Ese correo es usuario de un CLIENTE: primero quítalo de la ficha del cliente y luego dale admin.',admin_is_root:'Ese admin es raíz (vive en la configuración del worker): no se puede quitar desde el panel.',cannot_remove_self:'No puedes quitarte a ti mismo (que lo haga otro admin): evita el cierre accidental.',root_only:'Solo los admins raíz (los de la configuración del worker) pueden tocar la configuración.',invalid_token_format:'Eso no parece un token de API de Cloudflare.',token_invalid:'Cloudflare rechazó el token (no está activo): NO se guardó.',token_verify_unavailable:'No se pudo validar contra Cloudflare (red): NO se guardó.',sender_not_found:'La subcuenta no tiene ningún sender de WhatsApp aún: haz primero el Self Sign-up con el cliente.',multiple_senders:'La subcuenta tiene VARIOS senders: reconcíliala a mano desde la ficha.',team_whatsapp_equals_from:'Ese número es el DEL BOT: si se avisa a sí mismo, WhatsApp rechaza todos los avisos (error 63031). Usa los números del equipo.',telegram_not_configured:'Falta configurar Telegram en el worker (token del bot o secreto del webhook).',telegram_no_vinculado:'Vincula primero el grupo de Telegram (botón Conectar Telegram).',marca_blanca_requerida:'Los Temas son parte de la marca blanca: actívala en el paso 1 para este cliente.',group_sin_temas:'El grupo no tiene «Temas» activados: actívalos en los ajustes del grupo de Telegram y reintenta.',bot_sin_permisos:'El bot necesita ser ADMIN del grupo con permiso «Gestionar temas»: dáselo y reintenta.',telegram_topic_failed:'Telegram no pudo crear el tema: reintenta en unos segundos.',demasiados_temas:'Máximo 25 temas por grupo.',invalid_topic_name:'Ponle nombre al tema.',invalid_bot_token:'Ese token no parece de @BotFather o Telegram lo rechazó.',telegram_setup_failed:'Telegram rechazó el registro del webhook: reintenta.'};
let tenantList=[],editing=null;
document.querySelectorAll('.tab[data-view]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab[data-view]').forEach(x=>{x.classList.toggle('is-on',x===b);x.setAttribute('aria-selected',x===b?'true':'false')});const v=b.dataset.view;$('#viewLeads').hidden=v!=='leads';$('#viewTenants').hidden=v!=='tenants';$('#viewConfig').hidden=v!=='config';$('#viewCalendario').hidden=v!=='calendario';$('#viewConexiones').hidden=v!=='conexiones';if(v==='tenants')loadTenantList();else if(v==='config'){loadAdmins();loadConfig()}else if(v==='calendario'){calMenu()}else if(v==='conexiones'){cxMenu()}else loadStats()});
// ── Conexiones (SPEC-CONEXIONES PR1): Telegram de avisos en autoservicio ──
// El cliente abre SU tarjeta; Velai elige tenant con el selector de la cabecera.
let cxTenant=null;
async function cxMenu(){tgWizOpen=null;if(ME&&ME.tenantId){cxTenant=ME.tenantId;return loadConexiones()}
 try{if(!tenantList.length){const d=await api('/api/admin/tenants');tenantList=d.tenants}
  if(!tenantList.length)return toast('Aún no hay clientes dados de alta',false);
  cxTenant=cxTenant||((tenantList.find(t=>t.slug==='velai')||tenantList[0]).id);
  $('#cxTenantSel').innerHTML=tenantList.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===cxTenant?' selected':'')+'>'+esc(x.name)+'</option>').join('');
  loadConexiones()}
 catch(e){toast('No se pudieron cargar las conexiones: '+e.message,false)}}
$('#cxTenantSel').onchange=e=>{cxTenant=e.target.value;tgWizOpen=null;loadConexiones()};
async function loadConexiones(){$('#tgLinkBox').hidden=true;
 try{const d=await api('/api/admin/tenants/'+cxTenant+'/telegram');const t=d.telegram;
  $('#tgState').innerHTML=t.linked
   ?'<span class="flag ok">Conectado'+(t.title?': '+esc(t.title):'')+'</span>'+(t.linked_at?' <span class="muted">desde '+fmt(t.linked_at)+'</span>':'')
   :'Aún sin conectar: genera el enlace y ábrelo desde el móvil.';
  $('#tgLink').textContent=t.linked?'Vincular otro chat':'Generar enlace de conexión';
  $('#tgUnlink').hidden=!t.linked;
  cxWl=!!t.whitelabel;
  $('#tgWlState').textContent=t.whitelabel?'activada':'desactivada';
  $('#tgWlState').className='flag velai-only '+(t.whitelabel?'ok':'off');
  $('#tgWlToggle').textContent=t.whitelabel?'Desactivar':'Activar';
  $('#tgBotState').innerHTML=t.botUsername?'<span class="flag ok">Bot del negocio: @'+esc(t.botUsername)+' ✓</span>':'<span class="flag off">Aún sin bot propio (se usa el bot de Velai)</span>';
  $('#tgBotDel').hidden=!t.botUsername;$('#tgBotToken').value='';
  $('#tgTopics').innerHTML=(t.topics&&t.topics.length)
   ?t.topics.map(tp=>'<div class="mb6"><span class="flag off">'+esc(tp.name)+' <a href="#" data-tdel="'+esc(String(tp.thread_id))+'" title="Quitar del enrutado">✕</a></span> <span class="muted">'+(tp.description?esc(tp.description):'sin descripción')+' · <a href="#" data-tdesc="'+esc(String(tp.thread_id))+'">editar</a></span></div>').join('')
   :'Aún no hay temas: crea el primero arriba.';
  tgRenderWiz(t)}
 catch(e){$('#tgState').textContent=e.message}
 // Tarjeta de WhatsApp (PR2): estado en lenguaje de negocio, nunca jerga de Twilio.
 try{const w=(await api('/api/admin/tenants/'+cxTenant+'/whatsapp')).whatsapp;
  const st=w.sender_status;
  let msg;
  if(!st)msg='Sin conectar todavía. La conexión la hacemos juntos en una sesión corta — te avisaremos para agendarla.';
  else if(st==='ONLINE')msg='<span class="flag ok">Activo</span>'+(w.lead_template_status==='approved'?'':' <span class="muted">· los avisos de leads llegan por Telegram mientras WhatsApp aprueba la plantilla</span>');
  else if(['CREATING','PENDING_VERIFICATION','VERIFYING'].indexOf(st)>=0)msg='<span class="flag">Verificando tu número con WhatsApp…</span>';
  else msg='<span class="flag off">Revisando un problema con tu número.</span>';
  $('#waState').innerHTML=msg+(w.twilio_from?' <span class="muted">· '+esc(String(w.twilio_from).replace('whatsapp:',''))+'</span>':'');
  $('#nfTeam').value=w.team_whatsapp||'';$('#nfWa').value=w.wa_number||''}
 catch(e){$('#waState').textContent=e.message}}
// ── Asistente horizontal (canvas «Conexión de Telegram guiada», 2026-08-21): el
// estado real del servidor (bot, vínculo, temas) marca los pasos hechos; los pasos
// sin señal del servidor (grupo, permisos) se confirman con su botón; el riel de
// arriba salta a cualquier paso. Solo clases — la CSP no cubre style="" dinámico.
const tgManual={};let tgWizOpen=null;
function tgRenderWiz(t){
 const soyVelai=!(ME&&ME.tenantId);
 const wl=!!t.whitelabel;
 const nTemas=(t.topics&&t.topics.length)||0;
 const steps=[
  // Básico = 2 pasos EXACTOS (grupo y conectar) para AMBOS roles: el paso del bot
  // solo existe con la marca blanca activa — si no, básico tendría marca blanca.
  {id:'tgs1',visible:wl,done:!!t.botUsername||!!tgManual[cxTenant+':1']},
  {id:'tgs2',visible:true,done:!!t.linked||!!tgManual[cxTenant+':2']},
  {id:'tgs3',visible:true,done:!!t.linked},
  {id:'tgs4',visible:wl,done:nTemas>0||!!tgManual[cxTenant+':4']},
  {id:'tgs5',visible:wl,done:nTemas>0},
 ];
 const vis=steps.filter(s=>s.visible);
 const pending=vis.find(s=>!s.done);
 let open=tgWizOpen||(pending?pending.id:'tgsFin');
 if(open!=='tgsFin'&&!vis.some(s=>s.id===open))open=pending?pending.id:'tgsFin';
 let num=0;
 for(let i=0;i<steps.length;i++){const s=steps[i];const node=$('#tgn'+(i+1));
  node.hidden=!s.visible;
  if(i<4)$('#tgbar'+(i+1)).hidden=!s.visible;
  if(!s.visible){$('#'+s.id+'b').hidden=true;continue}
  num++;
  node.className='tgnode'+(s.done?' done':'')+(s.id===open?' cur':'');
  node.querySelector('.tgnum').textContent=s.done?'✓':String(num);
  if(i<4)$('#tgbar'+(i+1)).className='tgbar'+(s.done?' done':'');
  $('#'+s.id+'b').hidden=s.id!==open}
 $('#tgsFinb').hidden=open!=='tgsFin';
 $('#tgProgress').textContent=pending?('Paso '+(vis.indexOf(pending)+1)+' de '+vis.length):'Completado ✓';
 if(open==='tgsFin'){$('#tgFinMsg').textContent='Los próximos leads llegarán a '+(t.title?('«'+t.title+'»'):'tu grupo')+(wl&&nTemas?(', clasificados en '+nTemas+(nTemas===1?' tema.':' temas.')):'.');$('#tgMoreTopics').hidden=!wl}
}
document.querySelectorAll('.tgnode').forEach(n=>{n.onclick=()=>{tgWizOpen=n.dataset.tgo;loadConexiones()}});
function tgGoto(id){tgWizOpen=id;loadConexiones()}
$('#tgSkipBot').onclick=()=>{tgManual[cxTenant+':1']=1;tgWizOpen=null;loadConexiones()};
$('#tgs2ok').onclick=()=>{tgManual[cxTenant+':2']=1;tgWizOpen=null;loadConexiones()};
$('#tgs4ok').onclick=()=>{tgManual[cxTenant+':4']=1;tgWizOpen=null;loadConexiones()};
$('#tgBack2').onclick=()=>tgGoto('tgs1');
$('#tgBack3').onclick=()=>tgGoto('tgs2');
$('#tgBack4').onclick=()=>tgGoto('tgs3');
$('#tgBack5').onclick=()=>tgGoto('tgs4');
$('#tgFinish').onclick=()=>{tgWizOpen=null;loadConexiones()};
$('#tgMoreTopics').onclick=()=>tgGoto('tgs5');
$('#tgTopicAdd').onclick=async()=>{const name=$('#tgTopicName').value.trim();const description=$('#tgTopicDesc').value.trim();
 if(!name)return toast('Ponle nombre al tema',false);
 try{await api('/api/admin/tenants/'+cxTenant+'/telegram/topics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description})});
  $('#tgTopicName').value='';$('#tgTopicDesc').value='';toast('Tema creado en el grupo de Telegram ✓');tgWizOpen='tgs5';loadConexiones()}
 catch(e){toast('No se pudo crear el tema: '+(TERRS[e.message]||e.message),false)}};
$('#tgTopics').onclick=async e=>{const t=e.target;if(!t||!t.dataset)return;
 if(t.dataset.tdesc){e.preventDefault();
  const description=prompt('Descripción del tema (lo que Vai usará para clasificar):')||'';
  try{await api('/api/admin/tenants/'+cxTenant+'/telegram/topics/'+t.dataset.tdesc,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({description:description.trim()})});
   toast('Descripción guardada ✓');loadConexiones()}catch(e2){toast('No se pudo guardar: '+(TERRS[e2.message]||e2.message),false)}
  return}
 if(t.dataset.tdel){e.preventDefault();
  if(!confirm('¿Quitar este tema del enrutado? El tema sigue en Telegram, pero los leads dejarán de clasificarse hacia él.'))return;
  try{await api('/api/admin/tenants/'+cxTenant+'/telegram/topics/'+t.dataset.tdel,{method:'DELETE'});toast('Tema quitado del enrutado');loadConexiones()}
  catch(e2){toast('No se pudo quitar: '+(TERRS[e2.message]||e2.message),false)}}};
let cxWl=false;
$('#tgWlToggle').onclick=async()=>{const enable=!cxWl;
 if(!enable&&!confirm('¿Desactivar la marca blanca? Si el cliente tiene bot propio, se retira y se desvincula su chat.'))return;
 try{await api('/api/admin/tenants/'+cxTenant+'/telegram',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({whitelabel:enable})});
  toast(enable?'Marca blanca activada ✓ — el cliente ya ve el paso de bot propio':'Marca blanca desactivada');tgWizOpen='tgs1';loadConexiones()}
 catch(e){toast('No se pudo cambiar: '+(TERRS[e.message]||e.message),false)}};
$('#tgBotSave').onclick=async()=>{const token=$('#tgBotToken').value.trim();if(!token)return toast('Pega primero el token de @BotFather',false);
 try{const d=await api('/api/admin/tenants/'+cxTenant+'/telegram/bot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  toast('Bot propio guardado ✓ (@'+d.botUsername+'). Ahora vincula el chat: el bot NUEVO es el que debe entrar al grupo.');tgWizOpen=null;loadConexiones()}
 catch(e){toast('No se pudo guardar el bot: '+(TERRS[e.message]||e.message),false)}};
$('#tgBotDel').onclick=async()=>{if(!confirm('¿Quitar el bot propio? Se desvincula el chat y los avisos volverán a salir por el bot de Velai cuando se vuelva a vincular.'))return;
 try{await api('/api/admin/tenants/'+cxTenant+'/telegram/bot',{method:'DELETE'});toast('Bot propio retirado');tgWizOpen='tgs1';loadConexiones()}
 catch(e){toast('No se pudo quitar: '+(TERRS[e.message]||e.message),false)}};
$('#tgLink').onclick=async()=>{try{const d=await api('/api/admin/tenants/'+cxTenant+'/telegram/link',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 $('#tgGroupUrl').href=d.groupUrl;$('#tgDmUrl').href=d.dmUrl;$('#tgCmd').textContent='/start '+d.token;tgWizOpen='tgs3';$('#tgLinkBox').hidden=false}
 catch(e){toast('No se pudo generar el enlace: '+(TERRS[e.message]||e.message),false)}};
$('#tgUnlink').onclick=async()=>{if(!confirm('¿Desvincular el Telegram? Los avisos de leads dejarán de llegar a ese chat.'))return;
 try{await api('/api/admin/tenants/'+cxTenant+'/telegram',{method:'DELETE'});toast('Telegram desvinculado');tgWizOpen=null;loadConexiones()}
 catch(e){toast('No se pudo desvincular: '+(TERRS[e.message]||e.message),false)}};
$('#tgSetup').onclick=async()=>{try{const d=await api('/api/admin/telegram/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 $('#tgSetupOut').textContent='Webhook registrado ✓ (bot @'+(d.botUsername||'?')+')'}
 catch(e){$('#tgSetupOut').textContent='Error: '+(TERRS[e.message]||e.message)}};
// El ítem Calendario del menú: el cliente abre SU calendario; Velai abre el del
// tenant velai (su propio negocio también agenda citas) con selector para saltar
// al de cualquier cliente sin pasar por la lista.
async function calMenu(){if(ME&&ME.tenantId)return openCalendar(ME.tenantId,ME.tenantName);
 try{if(!tenantList.length){const d=await api('/api/admin/tenants');tenantList=d.tenants}
  const mine=tenantList.find(t=>t.slug==='velai')||tenantList[0];
  if(mine)openCalendar(mine.id);else toast('Aún no hay clientes dados de alta',false)}
 catch(e){toast('No se pudo abrir el calendario: '+e.message,false)}}
// ── Configuración (solo raíz): el servidor decide con 403 root_only; el panel solo pinta ──
// Los mismos datos de /api/admin/config, pero como tarjetas de estado con semáforo:
// verde operativo · ámbar requiere atención (sin configurar) · rojo error (token rechazado, binding ausente).
const CFG_ICONS={cloud:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19a4.5 4.5 0 1 0-.42-8.98 6 6 0 1 0-11.4 2.38A3.5 3.5 0 0 0 6.5 19h11z"></path></svg>',shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path></svg>',lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',db:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"></path><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"></path></svg>'};
function stPill(state,label,sm){return '<span class="stpill '+state+(sm?' sm':'')+'"><i></i>'+esc(label)+'</span>'}
function cfgTile(icon,name,pills,detail){return '<div class="tile"><div class="trow"><span class="tico '+icon+'">'+CFG_ICONS[icon]+'</span><span class="tname">'+esc(name)+'</span></div><div class="trow">'+pills+'</div><span class="tdetail">'+esc(detail)+'</span></div>'}
async function loadConfig(){try{const c=await api('/api/admin/config');$('#configCard').hidden=false;$('#configOnly').hidden=true;
 const t=c.cf_token;
 const tokenState=t.source==='none'?'warn':(t.valid===true?'ok':'bad');
 const tokenLabel=t.source==='none'?'sin configurar':(t.valid===true?'válido · '+(t.status||'activo'):'NO válido ✗ ('+(t.status||'?')+')');
 $('#cfgTokenCard').className='cfgtoken '+tokenState;
 const tk=$('#cfgTokenState');tk.className='stpill '+tokenState;tk.innerHTML='<i></i>'+esc(tokenLabel);
 $('#cfgOrigin').textContent='origen: '+(t.source==='none'?'—':(t.source==='panel'?'panel · cifrado en D1':'secret del worker'));
 const acc=String(c.account_id||'');
 $('#configState').innerHTML=
  cfgTile('cloud','Cuenta de Cloudflare',stPill(acc?'ok':'warn',acc?'conectada':'sin CF_ACCOUNT_ID',true),acc?('cuenta '+acc.slice(0,4)+'…'+acc.slice(-4)):'necesaria para sincronizar con Cloudflare')+
  cfgTile('shield','Turnstile',stPill(c.turnstile_sitekey?'ok':'warn',c.turnstile_sitekey?'sitekey configurada':'sin sitekey',true),'protege el widget del chat web')+
  cfgTile('lock','Grupos de Access',stPill(c.groups.clientes?'ok':'warn','clientes',true)+stPill(c.groups.admins?'ok':'warn','admins',true),'las puertas de entrada al panel')+
  cfgTile('db','Bindings del worker',stPill(c.d1?'ok':'bad','D1',true)+stPill(c.kv?'ok':'bad','KV',true),'leads (D1) y rate limit del chat (KV)');
 const oks=[t.source!=='none'&&t.valid===true,!!acc,!!c.turnstile_sitekey,!!(c.groups.clientes&&c.groups.admins),!!(c.d1&&c.kv)];
 const n=oks.filter(Boolean).length,all=n===oks.length;
 const ov=$('#cfgOverall');ov.hidden=false;ov.className='stpill '+(all?'ok':'warn');ov.innerHTML='<i></i>'+esc((all?'Todo operativo':'Requiere atención')+' · '+n+' de '+oks.length)}
 catch(e){$('#cfgOverall').hidden=true;if(e.message==='root_only'){$('#configCard').hidden=true;$('#configOnly').hidden=false}else{$('#configCard').hidden=false;$('#configOnly').hidden=true;$('#configState').textContent=TERRS[e.message]||e.message}}}
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
 $('#adminsList').innerHTML=d.admins.map(a=>'<span class="flag '+(a.root?'ok':'off')+'">'+esc(a.email)+(a.root?' · raíz':' <a href="#" data-adel="'+esc(a.email)+'" title="Quitar admin">✕</a>')+'</span>').join(' ');
 const roots=d.admins.filter(a=>a.root).length;
 $('#adminsCount').textContent=d.admins.length+(d.admins.length===1?' admin':' admins')+' · '+roots+(roots===1?' raíz':' raíces')}
 catch(e){$('#adminsList').textContent=TERRS[e.message]||e.message;$('#adminsCount').textContent=''}}
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
async function loadTenantList(){try{const d=await api('/api/admin/tenants');tenantList=d.tenants;$('#tenantRows').innerHTML=d.tenants.map(t=>'<tr data-tid="'+t.id+'"><td>'+tenantChip(t.id,t.name)+'</td><td class="muted">'+esc(t.channel_address)+'</td><td>'+t.lead_count+'</td><td>'+meter(t.prompt_len)+'</td><td>'+semaforo(t)+'</td><td>'+(t.active?'<span class="flag ok">activo</span>':'<span class="flag off">inactivo</span>')+'</td><td><button type="button" class="btn alt btnsm" data-cal="'+t.id+'">Abrir</button></td></tr>').join('')||'<tr><td colspan="7" class="empty">Sin clientes.</td></tr>';paint($('#tenantRows'))}catch(e){toast('No se pudo cargar la lista de clientes: '+e.message,false)}}
$('#tenantRows').onclick=e=>{const cal=e.target.closest('[data-cal]');if(cal)return openCalendar(cal.dataset.cal);const tr=e.target.closest('[data-tid]');if(tr)openTenant(tr.dataset.tid)};
$('#newTenant').onclick=()=>openTenant(null);
// ── Pestañas de la ficha: un solo Guardar; el punto ámbar marca cambios sin guardar por pestaña ──
function showPane(k){document.querySelectorAll('.ttab').forEach(x=>x.classList.toggle('is-on',x.dataset.tt===k));document.querySelectorAll('.tpane').forEach(p=>{p.hidden=p.dataset.tp!==k})}
function clearDirtyDots(){document.querySelectorAll('.ttab').forEach(x=>x.classList.remove('dirty'))}
$('#ttabs').onclick=e=>{const b=e.target.closest('.ttab');if(!b||wizard)return;showPane(b.dataset.tt)};
// Cambios sin guardar: cerrar el modal (botón o ESC) pide confirmación antes de descartar.
let tenantDirty=false;
$('#tenantModal').addEventListener('input',e=>{if(e.target.id==='tTestMsg')return;tenantDirty=true;
 const p=e.target.closest('.tpane');if(p){const t=document.querySelector('.ttab[data-tt="'+p.dataset.tp+'"]');if(t)t.classList.add('dirty')}});
function confirmDiscard(){return !tenantDirty||confirm('Hay cambios sin guardar en esta ficha. ¿Cerrar y descartarlos?')}
$('#tenantClose').onclick=()=>{if(confirmDiscard()){tenantDirty=false;$('#tenantModal').close()}};
$('#tenantModal').addEventListener('cancel',e=>{if(!confirmDiscard())e.preventDefault();else tenantDirty=false});
const TF={name:'#tName',slug:'#tSlug',channel_address:'#tAddress',twilio_from:'#tFrom',team_whatsapp:'#tTeam',telegram_chat_id:'#tChat',lead_template_sid:'#tTpl',twilio_subaccount_sid:'#tSub',waba_id:'#tWaba',meta_partner_status:'#tPartner',system_prompt:'#tPrompt',bot_name:'#tBotName',brand_name:'#tBrandName',logo_url:'#tLogo',brand_color:'#tColor1',brand_color_2:'#tColor2',greeting:'#tGreeting',greeting_en:'#tGreetingEn',placeholder:'#tPlaceholder',wa_number:'#tWa',theme:'#tTheme'};
// chips_json y web_origins van aparte: en el form son una línea por valor; al worker
// viajan como array (el servidor valida y guarda JSON).
function jsonToLines(json){try{const a=JSON.parse(json||'[]');return Array.isArray(a)?a.join('\n'):''}catch(e){return ''}}
function linesFrom(sel,max){return $(sel).value.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,max)}
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
 $('#brandPrev').innerHTML='<div class="bp-h" data-c="linear-gradient(135deg,'+esc(c1)+','+esc(c2)+')"><span class="bp-av" data-c="'+esc(c1)+'">'+(/^https:\/\//i.test(logo)?'<img src="'+esc(logo)+'" alt="">':esc(bot.charAt(0).toUpperCase()))+'</span><span class="bp-n">'+esc(bot)+' · '+esc(brand)+'</span></div><div class="bp-g">'+esc(greet)+'</div>'+(chips.length?'<div class="bp-c">'+chips.map(c=>'<span data-fg="'+esc(c1)+'">'+esc(c)+'</span>').join('')+'</div>':'');
 paint($('#brandPrev'))}
['#tBotName','#tBrandName','#tLogo','#tColor1','#tColor2','#tGreeting','#tChips','#tTheme'].forEach(s=>{$(s).addEventListener('input',brandPreview);$(s).addEventListener('change',brandPreview)});
function clearTenantErrs(){document.querySelectorAll('.field-err').forEach(x=>x.textContent='');$('#tenantMsg').innerHTML=''}
function updateCount(){const n=$('#tPrompt').value.length;$('#tCount').textContent=n+' caracteres · ≈'+Math.round(n/4)+' tokens en CADA mensaje'}
$('#tPrompt').oninput=updateCount;
// ── Alta guiada (stepper): el borrador se guarda al pasar de paso; se activa al final ──
const WIZ=['identidad','contexto','marca','prov','usuarios'];let wizard=false,wizStep=0;
const WIZ_NAMES={identidad:'Identidad y canal',contexto:'Contexto',marca:'Marca del widget',prov:'Aprovisionamiento',usuarios:'Usuarios'};
const WIZ_CHECK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';
function renderWizSteps(){$('#wizSteps').innerHTML=WIZ.map((k,i)=>{const st=i<wizStep?'done':(i===wizStep?'on':'');
 return (i?'<span class="wline'+(i<=wizStep?' past':'')+'"></span>':'')+'<span class="wstep '+st+'"><span class="wdot">'+(st==='done'?WIZ_CHECK:String(i+1))+'</span><span class="wlab">'+WIZ_NAMES[k]+'</span></span>'}).join('')}
function wizShow(){showPane(WIZ[wizStep]);renderWizSteps();$('#wizBack').hidden=wizStep===0;$('#wizNext').textContent=wizStep===WIZ.length-1?'Finalizar':'Guardar y continuar';
 $('#wizHint').textContent=wizStep===WIZ.length-1?'Al finalizar, revisa la pestaña «Identidad y canal» y márcalo Activo cuando su canal real esté listo.':'El borrador se guarda al pasar de paso, sin activar nada hasta el final.'}
function setWizard(on){wizard=on;$('#wizBar').hidden=!on;$('#ttabs').hidden=on;$('#wizSteps').hidden=!on;$('#tenantSave').hidden=on;$('#tNote').hidden=on;if(on){wizStep=0;wizShow()}}
$('#wizBack').onclick=()=>{if(wizStep>0){wizStep--;wizShow()}};
$('#wizNext').onclick=async()=>{
 // Paso 1 sin canal: se rellena pending:<slug> — un prospecto que no enruta (y no puede activarse).
 if(wizStep===0&&!$('#tAddress').value.trim()&&$('#tSlug').value.trim())$('#tAddress').value='pending:'+$('#tSlug').value.trim();
 const wasNew=!editing;
 if(tenantDirty||wasNew){const ok=await saveTenant();if(!ok)return}
 if(wasNew&&editing){$('#ttabProv').hidden=false;$('#ttabUsers').hidden=false;$('#ttabHist').hidden=false;$('#tProv').hidden=false;$('#tUsersCard').hidden=false;$('#tDup').hidden=true;loadProv(editing.id);loadUsers(editing.id);loadVersions(editing.id)}
 if(wizStep===WIZ.length-1){setWizard(false);showPane('identidad');toast('Alta completada ✓ — actívalo en «Identidad y canal» cuando su canal esté listo');return}
 wizStep++;wizShow()};
async function openTenant(id){clearTenantErrs();$('#tPreviewOut').textContent='';$('#tTestMsg').value='';$('#tNote').value='';
 $('#tToken').value='';clearDirtyDots();
 // provPost recarga la ficha del MISMO cliente en mitad del alta: se conserva el paso.
 const stayWiz=wizard&&editing&&editing.id===id;
 if(id){const d=await api('/api/admin/tenants/'+id);const t=d.tenant;editing={id:t.id,updated_at:t.updated_at};$('#tenantTitle').textContent=t.name;$('#tDup').hidden=true;for(const[k,sel]of Object.entries(TF))$(sel).value=t[k]??'';$('#tChips').value=chipsToLines(t.chips_json);$('#tOrigins').value=jsonToLines(t.web_origins);$('#tActive').checked=!!t.active;$('#tTokenState').textContent=t.has_twilio_token?'configurado ✓ (escribe solo para sustituirlo)':'sin configurar';$('#tProv').hidden=false;$('#tUsersCard').hidden=false;$('#ttabProv').hidden=false;$('#ttabUsers').hidden=false;$('#ttabHist').hidden=false;if(stayWiz)wizShow();else{setWizard(false);showPane('identidad')}loadProv(id);loadVersions(id);loadUsers(id)}
 else{editing=null;$('#tenantTitle').textContent='Nuevo cliente';$('#tDup').hidden=false;$('#tDupSel').innerHTML='<option value="">— empezar de cero —</option>'+tenantList.map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('');for(const sel of Object.values(TF))$(sel).value='';$('#tChips').value='';$('#tOrigins').value='';$('#tPartner').value='pendiente';$('#tActive').checked=false;$('#tTokenState').textContent='sin configurar';$('#tProv').hidden=true;$('#tUsersCard').hidden=true;$('#ttabProv').hidden=true;$('#ttabUsers').hidden=true;$('#ttabHist').hidden=true;$('#tVersions').textContent='—';setWizard(true)}
 updateCount();brandPreview();tenantDirty=false;$('#tenantModal').showModal()}
$('#tDupSel').onchange=async e=>{if(!e.target.value)return;const d=await api('/api/admin/tenants/'+e.target.value);$('#tPrompt').value=d.tenant.system_prompt||'';updateCount()};
async function saveTenant(){clearTenantErrs();
 const body={};for(const[k,sel]of Object.entries(TF))body[k]=$(sel).value;body.chips_json=chipsFromLines();body.web_origins=linesFrom('#tOrigins',6);body.active=$('#tActive').checked;body.note=$('#tNote').value;
 if($('#tToken').value)body.twilio_auth_token=$('#tToken').value; // write-only: solo si se escribe
 try{
  if(editing){body.expected_updated_at=editing.updated_at;const r=await api('/api/admin/tenants/'+editing.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});editing.updated_at=r.updated_at;loadVersions(editing.id)}
  else{const r=await api('/api/admin/tenants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});editing={id:r.id,updated_at:r.updated_at};$('#tenantTitle').textContent=body.name}
  toast('Cliente guardado ✓ (el widget lo ve en ≤5 min por la caché)');tenantDirty=false;clearDirtyDots();loadTenantList();return true
 }catch(e){const c=e.message;const m=c.match(/^invalid_(.+)$/);
  if(m&&document.querySelector('.field-err[data-f="'+m[1]+'"]')){document.querySelector('.field-err[data-f="'+m[1]+'"]').textContent='Formato inválido — revisa el ejemplo del campo.';toast('NO guardado: revisa el campo «'+m[1]+'»',false)}
  else toast('NO guardado: '+(TERRS[c]||c),false);return false}}
$('#tenantSave').onclick=saveTenant;
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
 $('#tProvState').textContent=lines.join('\n')}catch(e){$('#tProvState').textContent=e.message}}
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

// ── Calendario por cliente (SPEC-CALENDARIO): modal con conexión, rejilla mensual y config ──
// Se abre desde la columna «Calendario» de la lista de clientes: si el cliente ya
// conectó su Google, muestra el calendario del mes con sus citas; si no, la conexión.
let calTenant=null,calCur=null,calMonth=null,calAppts=[];
function calTz(){return (calCur&&calCur.timezone)||'Europe/Madrid'}
function calTzDay(iso){try{return new Intl.DateTimeFormat('en-CA',{timeZone:calTz(),year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso))}catch(e){return String(iso).slice(0,10)}}
function calTzHm(iso){try{return new Intl.DateTimeFormat('es-ES',{timeZone:calTz(),hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso))}catch(e){return ''}}
async function openCalendar(id,name){calTenant=id;calMonth=new Date();calMonth.setDate(1);
 const t=tenantList.find(x=>x.id===id);$('#calTitle').textContent='Calendario — '+((t&&t.name)||name||'mi negocio');
 // Es una VISTA (no un modal): sustituye a la que esté abierta.
 $('#viewLeads').hidden=true;$('#viewTenants').hidden=true;$('#viewConfig').hidden=true;$('#viewCalendario').hidden=false;
 if(tenantList.length)$('#calTenantSel').innerHTML=tenantList.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===id?' selected':'')+'>'+esc(x.name)+'</option>').join('');
 await calRefresh()}
$('#calTenantSel').onchange=e=>openCalendar(e.target.value);
async function calRefresh(){try{const d=await api('/api/admin/tenants/'+calTenant+'/calendar');calCur=d.calendar;
 const c=d.calendar;const conn=c&&c.status==='connected';
 $('#calConnCard').hidden=!!conn;$('#calViewWrap').hidden=!conn;
 if(!conn){$('#calState').innerHTML=c?'<span class="flag off">La conexión está en error ('+esc(c.last_error||c.status)+'): vuelve a conectar.</span>':'';
  $('#calConnect').textContent=c?'Reconectar Google':'Conectar Google';return}
 $('#calWho').innerHTML='Conectado como <b>'+esc(c.account_email||'cuenta de Google')+'</b> · las citas se crean en su calendario «'+esc(c.calendar_id||'primary')+'»';
 $('#calId').value=c.calendar_id||'primary';$('#calTz').value=c.timezone||'';$('#calSlot').value=c.slot_minutes||30;$('#calHours').value=c.business_hours||'';
 await calLoadMonth()}
 catch(e){toast('No se pudo cargar el calendario: '+(TERRS[e.message]||e.message),false)}}
async function calLoadMonth(){const y=calMonth.getFullYear(),m=calMonth.getMonth();
 // margen de ±1 día alrededor del mes: el corte exacto por tz lo hace calTzDay al pintar
 const from=new Date(Date.UTC(y,m,1)-86400000).toISOString(),to=new Date(Date.UTC(y,m+1,1)+86400000).toISOString();
 try{const d=await api('/api/admin/appointments?tenant='+calTenant+'&from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to));calAppts=d.appointments}catch(e){calAppts=[]}
 calRender()}
function calByDay(){const byDay={};for(const a of calAppts){const k=calTzDay(a.starts_at);(byDay[k]=byDay[k]||[]).push(a)}
 for(const k of Object.keys(byDay))byDay[k].sort((a,b)=>a.starts_at<b.starts_at?-1:1);return byDay}
function calRender(){const y=calMonth.getFullYear(),m=calMonth.getMonth();
 $('#calMonthTitle').textContent=new Intl.DateTimeFormat('es-ES',{month:'long',year:'numeric'}).format(calMonth);
 const byDay=calByDay();
 const lead=(new Date(y,m,1).getDay()+6)%7; // semana empieza en lunes
 const days=new Date(y,m+1,0).getDate();
 const today=calTzDay(new Date().toISOString());
 let html=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d=>'<div class="caldow">'+d+'</div>').join('');
 for(let i=0;i<lead;i++)html+='<div class="calcell out"></div>';
 for(let day=1;day<=days;day++){const k=y+'-'+String(m+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  const list=byDay[k]||[];
  const chips=list.slice(0,3).map(a=>'<span class="calchip">'+calTzHm(a.starts_at)+' '+esc(a.customer_name)+'</span>').join('')
   +(list.length>3?'<span class="calmore">+'+(list.length-3)+' más</span>':'');
  html+='<div class="calcell'+(k===today?' today':'')+'" data-day="'+k+'"><span class="dnum">'+day+'</span>'+chips+'</div>'}
 // completar la última semana: la rejilla tipo Google siempre cierra en domingo
 const tail=(7-((lead+days)%7))%7;
 for(let i=0;i<tail;i++)html+='<div class="calcell out"></div>';
 $('#calGrid').innerHTML=html;
 $('#calHint').textContent=calAppts.length?'Toca un día para ver sus citas.':'Sin citas este mes. Vai las creará aquí (y en el Google Calendar del negocio) cuando las agende por chat o WhatsApp.'}
// El detalle del día se abre en modal (pedido de Juan, estilo Google Calendar).
function openCalDay(k){const list=calByDay()[k]||[];
 $('#calDayTitle').textContent=new Intl.DateTimeFormat('es-ES',{dateStyle:'full'}).format(new Date(k+'T12:00:00Z'));
 $('#calDayBody').innerHTML=list.length
  ?list.map(a=>'<div><b>'+calTzHm(a.starts_at)+'–'+calTzHm(a.ends_at)+'</b> · <b>'+esc(a.customer_name)+'</b><br><span class="muted">'+esc(a.customer_phone)+(a.reason?' · '+esc(a.reason):'')+' · '+esc(a.channel)+'</span></div>').join('')
  :'<div class="muted">Sin citas ese día. Vai las agenda desde el chat web y WhatsApp.</div>';
 $('#calDayDlg').showModal()}
$('#calGrid').onclick=e=>{const c=e.target.closest('[data-day]');if(!c||!c.dataset.day)return;openCalDay(c.dataset.day)};
$('#calDayClose').onclick=()=>$('#calDayDlg').close();
$('#calToday').onclick=()=>{calMonth=new Date();calMonth.setDate(1);calLoadMonth()};
$('#calPrev').onclick=()=>{calMonth.setMonth(calMonth.getMonth()-1);calLoadMonth()};
$('#calNext').onclick=()=>{calMonth.setMonth(calMonth.getMonth()+1);calLoadMonth()};
// «Volver» es de Velai (que llega desde la lista de Clientes); el cliente navega por su menú.
$('#calBack').onclick=()=>{$('#viewCalendario').hidden=true;$('#viewTenants').hidden=false};
async function calStartOAuth(){try{const d=await api('/api/admin/tenants/'+calTenant+'/calendar/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'google'})});
 location.href=d.authUrl}
 catch(e){toast('No se pudo iniciar la conexión: '+(TERRS[e.message]||e.message),false)}}
$('#calConnect').onclick=calStartOAuth;$('#calReconnect').onclick=calStartOAuth;
$('#calDisconnect').onclick=async()=>{if(!confirm('¿Desconectar el calendario? Vai dejará de consultar huecos y agendar citas para este cliente.'))return;
 try{await api('/api/admin/tenants/'+calTenant+'/calendar',{method:'DELETE'});toast('Calendario desconectado');calRefresh()}
 catch(e){toast('No se pudo desconectar: '+(TERRS[e.message]||e.message),false)}};
$('#calSave').onclick=async()=>{let hours=null;const rawHours=$('#calHours').value.trim();
 if(rawHours){try{hours=JSON.parse(rawHours)}catch(e){toast('El horario no es JSON válido',false);return}}
 try{await api('/api/admin/tenants/'+calTenant+'/calendar',{method:'PATCH',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({calendar_id:$('#calId').value.trim()||'primary',timezone:$('#calTz').value.trim()||'Europe/Madrid',slot_minutes:Number($('#calSlot').value)||30,business_hours:hours})});
  toast('Calendario guardado ✓');calRefresh()}
 catch(e){toast('No se pudo guardar: '+(TERRS[e.message]||e.message),false)}};
// Al volver del OAuth el callback redirige con #calendar=ok:<tenantId>: se reabre SU calendario.
(async function(){const h=String(location.hash||'');if(!h.startsWith('#calendar='))return;const r=h.slice(10);try{location.hash=''}catch(e){}
 if(!r.startsWith('ok')){toast('Conexión de calendario fallida: '+r,false);return}
 toast('Google Calendar conectado ✓');const tid=r.split(':')[1];if(!tid)return;
 try{const me=await api('/api/admin/me');
  if(me.role==='velai'&&!tenantList.length){const d=await api('/api/admin/tenants');tenantList=d.tenants}
  openCalendar(me.role==='velai'?tid:(me.tenantId||tid),me.tenantName)}catch(e){}})();
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
// Sincronización del sender desde Twilio (solo Velai): rellena la fila tras el
// Self Sign-up y repara el webhook si quedó en el default de Twilio.
$('#waSync').onclick=async()=>{$('#waSyncOut').textContent='sincronizando…';
 try{const d=await api('/api/admin/tenants/'+cxTenant+'/provision/sender/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  let out='Sincronizado ✓ · '+d.applied+' campos'+(d.webhookFixed?' · webhook reparado':'');
  if(!d.webhookOk)out+=' · ⚠ WEBHOOK MAL: los mensajes NO llegan al worker';
  if(d.conflicts&&d.conflicts.length)out+=' · conflictos: '+d.conflicts.map(c=>c.field+' (fila '+c.current+' / Twilio '+c.fromTwilio+')').join('; ');
  $('#waSyncOut').textContent=out;loadConexiones()}
 catch(e){$('#waSyncOut').textContent='Error: '+(TERRS[e.message]||e.message)}};
// Números de aviso (PR3): autoservicio con la guarda del 63031 en el worker.
$('#nfSave').onclick=async()=>{try{
 await api('/api/admin/tenants/'+cxTenant+'/notify',{method:'PATCH',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({team_whatsapp:$('#nfTeam').value.trim(),wa_number:$('#nfWa').value.trim()})});
 toast('Números de aviso guardados ✓');loadConexiones()}
 catch(e){toast('No se pudo guardar: '+(TERRS[e.message]||e.message),false)}};
}
