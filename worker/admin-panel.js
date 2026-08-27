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
async function api(path,options){const r=await fetch(path,options);if(r.status===204)return null;const d=await r.json();if(!r.ok){const e=Error(d.error||'request_failed');e.why=d.why||'';throw e}return d}
function fmt(v){return v?new Intl.DateTimeFormat('es-ES',{dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'—'}
async function loadStats(){try{const s=await api('/api/admin/stats');
 $('#mTotal').textContent=s.total30;$('#mNew').textContent=s.sinContactar;
 $('#mNewSub').textContent=s.sinContactar&&s.sinContactarDesde?('el más antiguo, del '+new Intl.DateTimeFormat('es-ES',{dateStyle:'short'}).format(new Date(s.sinContactarDesde))):'';
 $('#mFail').textContent=s.fallidos7;$('#mFailCard').classList.toggle('alerta',s.fallidos7>0);
 $('#mTenants').textContent=s.tenantsActivos;
 const max=Math.max(1,...s.porDia.map(x=>x.n));
 $('#chart').innerHTML=s.porDia.map(x=>'<div class="bar" data-h="'+(x.n===0?6:Math.max(12,Math.round(x.n/max*100)))+'" title="'+esc(x.d)+': '+x.n+'"></div>').join('');paint($('#chart'));
 $('#chartFrom').textContent=s.porDia[0]?s.porDia[0].d.slice(5):'';$('#chartTo').textContent=s.porDia.at(-1)?s.porDia.at(-1).d.slice(5):'';
 // Leads por canal: barra horizontal proporcional al canal que más aporta.
 const cmax=Math.max(1,...(s.porCanal||[]).map(x=>x.n));
 $('#canalRows').innerHTML=(s.porCanal||[]).length?s.porCanal.map(x=>bar(x.canal,x.n,Math.round(x.n/cmax*100),x.n+' leads')).join(''):'<span class="muted">Sin leads en el periodo.</span>';
 // Tasa de captura: leads / conversaciones atendidas. El denominador solo existe desde
 // que se registran conversaciones — si el periodo lo cruza, se advierte en vez de dar
 // un porcentaje inflado.
 const cap=s.captura||{},convs=cap.conversaciones||0;
 $('#capConv').textContent=miles(convs);
 const pct=convs?Math.round(s.total30/convs*100):null;
 $('#capPct').textContent=pct===null?'—':pct+'%';
 $('#capSub').textContent=convs?(s.total30+' de '+convs+' conversaciones'):'Aún no hay conversaciones contadas';
 const desde=cap.desde||'';
 $('#capRows').innerHTML=(cap.porCanal||[]).map(x=>{const l=(s.porCanal||[]).find(c=>String(c.canal).toLowerCase().includes(x.canal))||{n:0};
   const p=x.convs?Math.round(l.n/x.convs*100):0;return bar(x.canal,p,Math.min(100,p),l.n+'/'+x.convs+' · '+p+'%')}).join('')
  +(desde?'<small class="muted">Conversaciones contadas desde el '+esc(desde)+'.</small>':'');
 paint($('#canalRows'));paint($('#capRows'))}
 catch(e){/* las métricas no bloquean el listado */}}
// Gasto de IA por cliente (solo Velai): reutiliza el componente de barras del
// dashboard. El coste lo calcula el worker con las tarifas por modelo.
const usd=(n)=>'$'+(n<1?n.toFixed(4):n.toFixed(2));
const miles=(n)=>new Intl.NumberFormat('es-ES').format(n);
// Barra horizontal etiquetada (canales, captura, límites de Cloudflare): un solo
// componente para las tres tarjetas.
function bar(label,val,pct,right,cls){return '<div class="brow'+(cls?' '+cls:'')+'"><span>'+esc(label)+'</span><span class="bt"><i data-w="'+Math.max(1,Math.min(100,pct))+'"></i></span><span class="bv">'+esc(right)+'</span></div>'}
// Consumo de Cloudflare frente a los límites del plan gratuito.
const INFRA_LABELS={worker_requests:['Peticiones al worker','worker.requests'],kv_reads:['Lecturas de KV','kv.read'],kv_writes:['Escrituras de KV','kv.write'],kv_lists:['Listados de KV','kv.list'],kv_deletes:['Borrados de KV','kv.delete'],d1_rows_read:['Filas leídas en D1','d1.rowsRead'],d1_rows_written:['Filas escritas en D1','d1.rowsWritten']};
// Saldo de IA del mes, en el panel del CLIENTE. Nunca coste: eso es la tarjeta velai-only.
// El saldo baja hasta cero (decisión de Juan, 2026-08-26) y al llegar NO corta nada — así
// que la tarjeta lo dice con letra clara, o el primer cliente que lo cruce va a pensar que
// le llega una factura.
const MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
async function loadSaldo(){if(!ME||ME.role==='velai')return;
 try{const d=await api('/api/admin/ai-balance');
  $('#saldoTitle').textContent='Saldo de IA · '+(MESES[Number(String(d.month).slice(5,7))-1]||d.month);
  $('#saldoLeft').textContent=miles(d.remaining)+' tokens';
  $('#saldoOf').textContent='de '+miles(d.included)+' de este mes';
  // La barra pinta lo CONSUMIDO, no lo que queda: es lo que se lee de un vistazo.
  $('#saldoBar').className='bigbar'+(d.pct>=80?' hot':'');
  $('#saldoBar').innerHTML='<i data-w="'+Math.max(1,d.pct)+'"></i>';
  $('#saldoToday').textContent='Consumido hoy: '+miles(d.usedToday)+' tokens';
  $('#saldoPct').textContent=d.pct+'% del mes';
  const max=Math.max(1,...(d.serie||[]).map(x=>x.n));
  $('#saldoChart').innerHTML=(d.serie||[]).map(x=>'<div class="bar" data-h="'+(x.n===0?6:Math.max(12,Math.round(x.n/max*100)))+'" title="'+esc(x.d)+': '+miles(x.n)+' tokens"></div>').join('');
  $('#saldoNote').textContent=d.over
   ?'Has pasado del saldo incluido este mes. No se ha cortado nada ni se te cobra de más: lo revisamos juntos y ajustamos tu plan si hace falta.'
   :'Al agotarse no se corta nada ni se te cobra de más: es un contador para que sepas cuánto usas.';
  paint($('#saldoCard'))}
 catch(e){$('#saldoLeft').textContent='—';$('#saldoNote').textContent='No se pudo cargar el saldo: '+(TERRS[e.message]||e.message)}}
async function loadInfra(){if(!ME||ME.role!=='velai')return;
 try{const d=await api('/api/admin/infra-usage');
  if(d.error){$('#infraNote').textContent='';
   $('#infraRows').innerHTML='<p class="as-ctx">'+(d.error==='cloudflare_analytics_denied'
    ?'El token de Cloudflare no tiene permiso para leer analíticas. Añádele <b>Account Analytics: Read</b> en el panel de Cloudflare (My Profile → API Tokens → editar el token) y esta tarjeta se llena sola.'
    :d.error==='cloudflare_api_not_configured'?'Falta el token de Cloudflare en el worker.'
    :'No se pudo consultar a Cloudflare ahora mismo.')+'</p>'
    +Object.entries(d.limits||{}).map(([k,v])=>bar((INFRA_LABELS[k]||[k])[0],0,0,'límite '+miles(v)+'/día')).join('');
   return paint($('#infraRows'))}
  $('#infraNote').textContent='últimas '+d.ventana;
  const get=(path)=>path.split('.').reduce((o,k)=>(o||{})[k],d)||0;
  $('#infraRows').innerHTML=Object.entries(INFRA_LABELS).map(([k,[label,path]])=>{
   const used=get(path),lim=(d.limits||{})[k]||1,p=Math.round(used/lim*100);
   return bar(label,used,p,miles(used)+' / '+miles(lim)+' · '+p+'%',p>=80?'bad':p>=50?'warn':'')}).join('')
   +(d.worker&&d.worker.errors?'<small class="muted">'+miles(d.worker.errors)+' peticiones con error en la ventana.</small>':'');
  paint($('#infraRows'))}
 catch(e){$('#infraRows').textContent='No se pudo cargar: '+(TERRS[e.message]||e.message)}}
async function loadAiUsage(){if(!ME||ME.role!=='velai')return;
 try{const d=await api('/api/admin/ai-usage?days='+($('#aiDays').value||30));
  $('#aiCost').textContent=usd(d.total.cost);
  $('#aiCostSub').textContent=d.total.calls?('≈ '+usd(d.total.cost/d.total.calls)+' por llamada'):'';
  $('#aiCalls').textContent=miles(d.total.calls);
  $('#aiTokens').textContent=miles(d.total.tokens);
  const max=Math.max(0.000001,...d.porDia.map(x=>x.cost));
  $('#aiChart').innerHTML=d.porDia.map(x=>'<div class="bar" data-h="'+(x.cost===0?4:Math.max(10,Math.round(x.cost/max*100)))+'" title="'+esc(x.d)+': '+usd(x.cost)+' · '+x.calls+' llamadas"></div>').join('');
  $('#aiFrom').textContent=d.porDia[0]?d.porDia[0].d.slice(5):'';
  $('#aiTo').textContent=d.porDia.at(-1)?d.porDia.at(-1).d.slice(5):'';
  const tot=d.total.cost||1;
  $('#aiRows').innerHTML=d.clientes.map(c=>{const pct=Math.round(c.cost/tot*100);
   return '<tr><td>'+esc(c.name)+(c.slug?' <span class="muted">'+esc(c.slug)+'</span>':'')+'</td><td>'+miles(c.calls)+'</td><td>'+miles(c.tokens)+'</td><td>'+usd(c.cost)+'</td>'
    +'<td><span class="share"><i data-w="'+pct+'"></i>'+pct+'%</span></td></tr>'}).join('')
   ||'<tr><td colspan="5" class="empty">Todavía no hay consumo registrado.</td></tr>';
  paint($('#aiChart'));paint($('#aiRows'))}
 catch(e){$('#aiCost').textContent='—';$('#aiCostSub').textContent='No se pudo cargar el gasto: '+(TERRS[e.message]||e.message)}}
$('#aiDays').onchange=loadAiUsage;
async function load(append=false){try{const p=params();if(append&&cursor)p.set('cursor',cursor);const d=await api('/api/admin/leads?'+p);if(!append){$('#rows').innerHTML='';loadedCount=0}
 if(!d.leads.length&&!append)$('#rows').innerHTML='<tr><td colspan="8" class="empty">No hay leads con estos filtros.</td></tr>';
 for(const l of d.leads)$('#rows').insertAdjacentHTML('beforeend','<tr data-id="'+l.id+'"><td>'+fmt(l.created_at)+'</td><td>'+tenantChip(l.tenant_id,l.tenant_name)+'</td><td>'+statusPill(l.status)+'</td><td>'+esc(l.name||'—')+'</td><td class="tel">'+esc(l.whatsapp||'—')+'</td><td>'+esc(l.need||l.sector||'—')+'</td><td>'+esc(l.source)+'</td><td>'+nbChips(l.notification_summary)+'</td></tr>');
 paint($('#rows'));
 loadedCount+=d.leads.length;cursor=d.nextCursor;$('#more').hidden=!cursor;
 $('#resultCount').textContent=loadedCount+(cursor?'+':'')+' resultado'+((loadedCount===1&&!cursor)?'':'s');
 $('#message').textContent=''}catch(e){$('#message').innerHTML='<p class="error">'+esc(e.message)+'</p>'}}
async function loadTenants(){try{const d=await api('/api/admin/tenants');for(const t of d.tenants){const opt='<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>';$('#tenantFilter').insertAdjacentHTML('beforeend',opt);$('#convTenant').insertAdjacentHTML('beforeend',opt)}}catch(e){/* sin tenants: los filtros quedan en Todos */}}

// ── Bandeja de conversaciones (migraciones 0021 y 0023) ──────────────────────
// Dos paneles: lista a la izquierda, hilo y cajón de escritura a la derecha. Una sola
// llamada (/api/admin/inbox) porque esto hace polling — dos llamadas cada 5 s con seis
// paneles abiertos serían un tercio del plan gratuito de Workers en refrescar una pantalla.
let convOpen=null,inboxPoll=null,convCount=0;
const CH_LABEL={web:'Web',whatsapp:'WhatsApp',messenger:'Messenger',instagram:'Instagram'};
// Logos de canal (rediseño 2026-08-27): mismo trazo y misma rejilla de 24 que el resto de
// iconos del panel, y el color lo pone la clase — la paleta del panel, no la de la marca.
const CH_ICON={
 whatsapp:'<path d="M12 3.2a8.8 8.8 0 0 0-7.5 13.4L3.2 20.8l4.4-1.3A8.8 8.8 0 1 0 12 3.2z"></path><path d="M9.3 9.1l1 1.8-.9.9a6.2 6.2 0 0 0 2.8 2.8l.9-.9 1.8 1"></path>',
 web:'<circle cx="12" cy="12" r="8.6"></circle><path d="M3.4 12h17.2"></path><path d="M12 3.4c3.2 3.7 3.2 13.5 0 17.2c-3.2-3.7-3.2-13.5 0-17.2"></path>',
 messenger:'<path d="M12 3.2c-4.85 0-8.8 3.63-8.8 8.13 0 2.55 1.28 4.82 3.28 6.32v3.15l3.02-1.65c.79.21 1.63.33 2.5.33 4.85 0 8.8-3.63 8.8-8.15S16.85 3.2 12 3.2z"></path><path d="M7.5 14.4l2.7-4.3 2.4 1.9 2.4-3.2"></path>',
 instagram:'<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="5"></rect><circle cx="12" cy="12" r="4"></circle><circle cx="16.9" cy="7.1" r="1.15" fill="currentColor" stroke="none"></circle>',
 telegram:'<path d="M21.3 4.4 2.9 11.2c-.9.3-.9 1.6.1 1.8l4.4 1.1 1.6 4.7c.3.9 1.5.9 2 .2l2.1-3.1 4 3c.7.5 1.7.2 1.9-.7l2.9-12.5c.2-.9-.7-1.6-1.6-1.3z"></path><path d="M8.6 14.3 18 7.4"></path>'};
const CH_CLS={whatsapp:'ch-wa',web:'ch-web',messenger:'ch-ms',instagram:'ch-ig',telegram:'ch-tg'};
const ICO_PEN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"></path><path d="m14.5 5.5 3 3"></path></svg>';
const ICO_X='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
const ICO_TICK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
function chIcon(ch){const d=CH_ICON[ch];if(!d)return '';
 return '<svg class="'+CH_CLS[ch]+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+d+'</svg>'}
const ICO_SEND='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13"></path><path d="m12.5 5.5 6.5 6.5-6.5 6.5"></path></svg>';
const ICO_BACK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.5 6-6 6 6 6"></path></svg>';
// Por qué NO se puede responder, en palabras del dueño. El cajón se cierra ANTES de que
// alguien escriba: el 63016 de Twilio llega cuando el mensaje ya se dio por enviado.
const WIN_WHY={
 inbox_address_unknown:'No sabemos por qué número responder (conversación anterior a la bandeja). En cuanto el cliente vuelva a escribir, se podrá.',
 no_inbound:'Todavía no hay ningún mensaje del cliente en esta conversación.',
 window_closed:'La ventana de 24 h de WhatsApp se cerró. Para escribir ahora hace falta una plantilla aprobada por Meta.',
 atiende_la_ia:'Vai está atendiendo esta conversación. El cajón se abre cuando la persona pide un asesor y alguien toma el control.',
 sin_control:'Esta persona pidió hablar con alguien del equipo y está esperando. Toma el control para poder escribirle.',
 ya_tomada:'Otra persona del equipo tomó el control de esta conversación.',
 nada_que_tomar:'Aquí no hay ningún control que tomar: la está atendiendo Vai.',
 velai_no_atiende_clientes:'Esta conversación es de un cliente y la atiende su equipo, no Velai. La ves para dar soporte, pero no puedes escribir en ella.',
 velai_tenant_missing:'No encuentro el cliente «velai» en la base: sin él no se puede resolver la disponibilidad de Velai.'};
function fmtShort(v){if(!v)return '';const d=new Date(v),now=new Date();
 return (d.toDateString()===now.toDateString())
  ?new Intl.DateTimeFormat('es-ES',{hour:'2-digit',minute:'2-digit'}).format(d)
  :new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'short'}).format(d)}
function fmtDia(v){return v?new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'short'}).format(new Date(v)):'—'}
function fmtHora(v){return v?new Intl.DateTimeFormat('es-ES',{hour:'2-digit',minute:'2-digit'}).format(new Date(v)):''}
// Etiqueta de la divisoria de día: «Hoy» y «Ayer» se leen mucho mejor que una fecha.
function dayLabel(v){if(!v)return '';const d=new Date(v),hoy=new Date();
 const ayer=new Date(hoy.getTime()-86400000),mismo=(a,b)=>a.toDateString()===b.toDateString();
 return mismo(d,hoy)?'Hoy':mismo(d,ayer)?'Ayer':new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'long'}).format(d)}
function convParams(){const p=new URLSearchParams(new FormData($('#convFilters')));for(const[k,v]of[...p])if(!v)p.delete(k);return p}
function initials(v){const t=String(v||'').replace(/^(whatsapp:|messenger:)/,'').replace(/[^A-Za-z0-9]/g,'');return (t.slice(0,2)||'··').toUpperCase()}
// Quién es la persona del otro lado. En web el external_id es el id de conversación que
// genera el navegador: como título es un UUID ilegible, así que se dice lo que de verdad
// se sabe. El id sigue a la vista en la cabecera del hilo, para poder rastrearlo.
function whoOf(c){
 if(c.lead_name)return c.lead_name;
 if(c.channel==='web')return 'Visitante de la web';
 return String(c.external_id||'').replace(/^(whatsapp:|messenger:)/,'')||'sin identificar'}
// Quién escribió el último mensaje. 'tú' es la PERSONA del equipo, no el bot: ahora que
// existe role='agent' confundirlos sería justo lo que la migración 0023 vino a evitar.
function prevPrefix(role){return role==='user'?'':role==='agent'?'tú: ':'Vai: '}
// Todos los canales del producto, en el orden en que se miran. Los que aún no reciben
// nada TAMBIÉN se pintan, a 0 y apagados (.is-zero): esconderlos dejaba la duda de si el
// canal existe, y el filtro por ese canal devuelve vacío de verdad, no «todo».
const CH_ORDER=['whatsapp','web','messenger','instagram'];
function chTabs(counts){const cur=$('#convChannel').value;
 const by={};for(const c of counts||[])if(c&&c.channel)by[c.channel]={n:c.n||0,u:c.unread||0};
 const canales=CH_ORDER.concat(Object.keys(by)).filter((k,i,a)=>a.indexOf(k)===i);
 const suma=campo=>Object.keys(by).reduce((a,k)=>a+by[k][campo],0);
 const tabs=[{k:'',label:'Todos',n:suma('n'),u:suma('u')}]
  .concat(canales.map(k=>({k:k,label:CH_LABEL[k]||k,n:(by[k]||{}).n||0,u:(by[k]||{}).u||0})));
 $('#chTabs').innerHTML=tabs.map(t=>'<button type="button" class="chtab'+(t.k===cur?' is-on':'')+(t.n?'':' is-zero')
  +'" data-ch="'+esc(t.k)+'" title="'+esc(t.label)+'" aria-label="'+esc(t.label)+'">'
  +(t.k?chIcon(t.k):'<span>'+esc(t.label)+'</span>')+' <b>'+esc(t.n)+'</b>'
  +(t.u?'<i></i>':'')+'</button>').join('')}
$('#chTabs').onclick=e=>{const b=e.target.closest('[data-ch]');if(!b)return;$('#convChannel').value=b.dataset.ch;loadInbox()};
// El sondeo llama a esto cada 15 s. Repintar el cajón a ciegas BORRA lo que la persona
// está escribiendo (lo sufrió Juan: «se borran los caracteres y toca volver a escribir»).
// Dos defensas: no repintar si nada relevante cambió, y si hay que repintar, conservar el
// texto, el foco y la posición del cursor.
function composerKey(win,c){return [win&&win.open?1:0,(win&&win.reason)||'',
 (win&&win.web)?(win.away?'away':'here'):'',(c&&c.state)||'',(c&&c.agent_email)||''].join('|')}
function composer(win,c){const box=$('#composer');
 const key=composerKey(win,c);
 if(box.dataset.ckey===key)return;
 const prev=$('#cmsg');
 const keep=prev?{v:prev.value,s:prev.selectionStart,e:prev.selectionEnd,f:document.activeElement===prev}:null;
 box.dataset.ckey=key;
 const restore=()=>{const t=$('#cmsg');if(!keep||!t)return;t.value=keep.v;
  if(keep.f){t.focus();try{t.setSelectionRange(keep.s,keep.e)}catch(e){}}};
 if(!win||!win.open){const why=WIN_WHY[win&&win.reason]||'No se puede responder a esta conversación ahora mismo.';
  // En 'esperando' el cajón cerrado no basta: hay alguien esperando y hay que poder entrar.
  // Con los minutos que lleva y la cuenta atrás a la vista, porque pasada esa marca Vai
  // retoma. Aquí NO se pinta campo de texto: lo que toca es entrar, no escribir.
  const puede=c&&c.state==='esperando';
  const mins=c&&c.state_at?Math.max(0,Math.floor((Date.now()-new Date(c.state_at))/60000)):null;
  const quedan=puede&&c.state_at?Math.max(0,QUEUE_MIN-Math.floor((Date.now()-new Date(c.state_at))/60000)):null;
  if(puede){
   box.innerHTML='<div class="cvstrip"><span class="grow">'
    +'<b>'+(mins!==null?mins+String.fromCharCode(8242)+' esperando · ':'')+'Pidió hablar con una persona del equipo</b>'
    +(quedan!==null?'<small>Vai retoma en '+quedan+' min si nadie entra.</small>':'')+'</span>'
    +'<button class="btn" id="takeover" type="button">Tomo el control</button></div>';
   $('#takeover').onclick=()=>control('takeover');
   restore();
   return}
  box.innerHTML='<div class="cvfield shut"><textarea rows="1" disabled placeholder="Cajón cerrado"></textarea>'
   +'<button class="cvsend" type="button" disabled tabindex="-1" aria-hidden="true">'+ICO_SEND+'</button></div>'
   +'<div class="crow"><span class="cwin shut">'+esc(why)+'</span></div>';
  restore();
  return}
 // En WhatsApp lo que importa es cuánto queda de la ventana de Meta; en web, si el
 // visitante sigue delante. Son la misma pregunta —«¿esto va a llegar?»— con distinta
 // respuesta, y en los dos casos se enseña el dato, no un semáforo verde.
 const estado=win.web
  ?(win.away
    ?'<span class="cwin shut">El visitante no está en la página ahora mismo. Tu mensaje se guarda y lo verá si vuelve durante su visita.</span>'
    :'<span class="cwin">El visitante está en la página.</span>')
  :'<span class="cwin">Quedan <b>'+Math.max(0,Math.round((new Date(win.closesAt)-new Date())/3600000))+' h</b> de la ventana de WhatsApp.</span>';
 box.innerHTML='<div class="cvfield"><textarea id="cmsg" rows="1" placeholder="Escribe tu respuesta…"></textarea>'
  +'<button class="cvsend" id="csend" type="button" title="Enviar" aria-label="Enviar">'+ICO_SEND+'</button></div>'
  +'<div class="crow"><span class="cwin"><b>Tienes el control</b>'+(c&&c.agent_email?' · '+esc(c.agent_email):'')+'</span>'
  +'<span class="sp"></span>'+estado
  +'<span class="sp"></span><button class="btn alt btnsm" id="release" type="button">Devolver a Vai</button></div>';
 $('#csend').onclick=sendReply;
 $('#release').onclick=()=>control('release');
 restore();
 // El campo crece con lo escrito (una línea de base, tope en 112 px y luego scroll): con
 // rows fijo, una respuesta larga se leía por una rendija.
 $('#cmsg').oninput=cgrow;cgrow();
 $('#cmsg').onkeydown=ev=>{if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();sendReply()}}}
// La altura se toca por CSSOM, no con style="": la CSP del panel bloquea los inline.
function cgrow(){const t=$('#cmsg');if(!t)return;t.style.height='auto';t.style.height=Math.min(112,t.scrollHeight)+'px'}
async function sendReply(){const el=$('#cmsg');const text=(el.value||'').trim();if(!text||!convOpen)return;
 $('#csend').disabled=true;el.disabled=true;
 try{await api('/api/admin/conversations/'+convOpen+'/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
  el.value='';cgrow();toast('Enviado ✓');await loadInbox(true)}
 catch(e){toast('NO se envió: '+(WIN_WHY[e.message]||TERRS[e.message]||e.message),false);
  // Si falló por la ventana, el estado de la pantalla estaba viejo: se refresca para que
  // el cajón se cierre y no se vuelva a intentar a ciegas.
  if(WIN_WHY[e.message])await loadInbox(true)}
 finally{$('#csend')&&($('#csend').disabled=false);el.disabled=false;el.focus()}}
function renderThread(t){
 if(!t){$('#thread').hidden=true;$('#threadEmpty').hidden=false;threadSeen=null;return}
 $('#threadEmpty').hidden=true;$('#thread').hidden=false;
 const c=t.conversation;
 const quien=whoOf(c);
 $('#threadHead').innerHTML='<button class="cvback" id="convBack" type="button" title="Volver a la lista" aria-label="Volver a la lista">'+ICO_BACK+'</button>'
  +'<span class="cvav" data-c="'+tenantColor(c.external_id)+'">'+esc(initials(quien))+'<span class="cvch">'+chIcon(c.channel)+'</span></span>'
  +'<span class="grow"><span class="thwho">'+esc(quien)+'</span>'
  +'<span class="thmeta"><b>'+esc(CH_LABEL[c.channel]||c.channel)+'</b>'
  +(c.tenant_name?'·<b>'+esc(c.tenant_name)+'</b>':'')
  +'·<span class="mono">'+esc(String(c.external_id||'').replace(/^(whatsapp:|messenger:)/,'').slice(0,8))+'</span></span></span>'
  +(c.unanswered>0?'<span class="chip warn">'+esc(c.unanswered)+' sin respuesta</span>':'')
  +'<span class="chip">se borra el '+esc(fmtDia(c.expires_at))+'</span>';
 const log=$('#threadLog');const atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<60;
 // Divisoria de día: sin ella, con la hora suelta en cada burbuja no se sabe si el «11:52»
 // es de hoy o de la semana pasada. El espaciador elástico apoya el hilo corto abajo.
 let dia='';
 log.innerHTML='<i class="cvfill"></i>'+(t.messages.map(m=>{
  const kind=m.role==='user'?'user':(m.role==='agent'?'agent':'bot');
  const clave=m.created_at?new Date(m.created_at).toDateString():'';
  const sep=(clave&&clave!==dia)?'<div class="cvday"><span>'+esc(dayLabel(m.created_at))+'</span></div>':'';
  if(clave)dia=clave;
  return sep+'<div class="bub '+kind+'">'+(m.role==='agent'?'<span class="who">'+esc(m.agent_email||'equipo')+'</span>':'')
   +'<span class="txt">'+esc(m.text)+'</span><time>'+esc(fmtHora(m.created_at))+'</time></div>'}).join('')
  ||'<p class="muted">Sin mensajes guardados.</p>');
 paint($('#threadHead'));
 // Al ABRIR un hilo se baja al último mensaje; después manda el atBottom de abajo.
 if(convOpen!==threadSeen){threadSeen=convOpen;log.scrollTop=log.scrollHeight}
 // Solo se baja el scroll si el lector YA estaba abajo: en un polling cada 15 s, saltar al
 // final mientras alguien lee hacia arriba es insoportable.
 if(atBottom)log.scrollTop=log.scrollHeight;
 composer(t.window,c)}
let GRACE_MIN=5,QUEUE_MIN=15,threadSeen=null;
async function control(accion){if(!convOpen)return;
 // El botón se apaga mientras va: sin eso, un clic en una red lenta parecía «no hace nada»
 // y se pulsaba dos veces.
 const b=$(accion==='takeover'?'#takeover':'#release');
 if(b)b.disabled=true;
 try{await api('/api/admin/conversations/'+convOpen+'/'+accion,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  toast(accion==='takeover'
   ?'Control tomado ✓ — ya puedes escribirle'
   :'Devuelta a Vai ✓ — se le ha avisado de que vuelve a atenderle el asistente');
  await loadInbox(true)}
 catch(e){toast('No se pudo: '+(WIN_WHY[e.message]||TERRS[e.message]||e.message),false);await loadInbox(true)}
 finally{const c=$(accion==='takeover'?'#takeover':'#release');if(c)c.disabled=false}}
// Disponibilidad: el interruptor es de esta persona, el horario es del cliente y lo cierra
// por fuera. Se dice cuál de los dos manda, para que nadie crea que está cubriendo y no.
async function loadAvailability(){if(!ME)return;
 // Velai solo atiende las conversaciones de Velai (decisión del 2026-08-26), así que su
 // disponibilidad no depende del selector de cliente: el worker la resuelve solo.
 $('#availToggle').hidden=false;
 try{const d=await api('/api/admin/availability');
  GRACE_MIN=d.graceMin||5;
  $('#availState').textContent=d.offering?'Asesor disponible':(d.available?'Fuera de horario':'No disponible');
  $('#availToggle').classList.toggle('off',!d.offering);
  $('#availSw').classList.toggle('on',!!d.available);
  $('#availSw').setAttribute('aria-checked',d.available?'true':'false');
  $('#availHours').textContent=(d.withinHours?'Dentro del horario de atención':'Fuera del horario de atención')+' · '+d.tz;
  const para=(ME.role==='velai'&&d.forTenant)?' Solo cubres las conversaciones de '+esc(d.forTenant)+': las de los clientes las atienden ellos.':'';
  $('#availNote').textContent=(d.available&&!d.withinHours
   ?'Estás marcado como disponible, pero fuera del horario de atención ('+esc(d.tz)+') no se ofrecen asesores: Vai atiende y captura el lead.'
   :(d.offering?(d.advisors===1?'Vai puede pasar una conversación a una persona.':d.advisors+' personas disponibles.')
     :'Vai atiende todo y captura leads. Nadie va a recibir conversaciones.'))+para}
 catch(e){$('#availState').textContent='—';$('#availNote').textContent=''}}
// El botón de la barra ABRE el panel; el interruptor de dentro es el que cambia el estado.
$('#availToggle').onclick=()=>popAvail($('#availPop').hidden);
$('#availSw').onclick=async()=>{$('#availSw').disabled=true;
 try{const cur=$('#availSw').classList.contains('on');
  await api('/api/admin/availability',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({available:!cur})});
  await loadAvailability()}
 catch(e){toast('No se pudo cambiar la disponibilidad: '+(TERRS[e.message]||e.message),false)}
 finally{$('#availSw').disabled=false}};
async function loadInbox(quiet=false){
 try{const p=convParams();if(convOpen)p.set('conversation',convOpen);
  const d=await api('/api/admin/inbox?'+p);
  if(d.queueMin)QUEUE_MIN=d.queueMin;
  if(d.pingMin)GRACE_MIN=d.pingMin;
  chTabs(d.counts||[]);
  // Cuántas esperan a que alguien las tome. Es lo único que hace que las multisesiones
  // funcionen de verdad: se puede atender a varias a la vez, pero no si no se ven.
  const enCola=(d.counts||[]).reduce((a,c)=>a+(c.waiting||0),0);
  $('#waitPill').hidden=!enCola;
  $('#waitPillTxt').textContent=enCola?(enCola===1?'1 esperando asesor':enCola+' esperando asesor'):'';
  const rows=d.conversations||[];
  $('#convRows').innerHTML=rows.length?rows.map(c=>{
   const who=whoOf(c);
   // Los minutos que lleva esperando, no la hora del último mensaje: con varias en cola es
   // el único dato con el que se decide a quién atender primero.
   const espera=c.state==='esperando'?Math.max(0,Math.floor((Date.now()-new Date(c.state_at))/60000)):null;
   const marca=espera!==null
    ?'<span class="cvwait">'+espera+"' esperando</span>"
    :(c.state==='humano'?'<span class="cvwhen">'+esc(c.agent_email?c.agent_email.split('@')[0]:'en curso')+'</span>':'<span class="cvwhen">'+esc(fmtShort(c.last_at))+'</span>');
   // El cliente va en la MISMA línea que la vista previa: con la columna a 340 px no caben
   // tres líneas por fila, y para Velai —que ve conversaciones de todos— saber de quién es
   // no es opcional. Para un cliente, tenant_name no viaja y la etiqueta no se pinta.
   const ten=c.tenant_name?'<span class="cvten"><i data-c="'+tenantColor(c.tenant_id||c.tenant_name)+'"></i><span>'+esc(c.tenant_name)+'</span></span>':'';
   return '<button type="button" class="cvrow'+(c.id===convOpen?' is-on':'')+(c.state==='esperando'?' is-wait':'')+'" data-id="'+esc(c.id)+'">'
    +'<span class="cvav" data-c="'+tenantColor(c.external_id)+'">'+esc(initials(who))+'<span class="cvch">'+chIcon(c.channel)+'</span></span>'
    +'<span class="cvmain"><span class="cvtop"><span class="cvwho">'+esc(who)+'</span>'+marca+'</span>'
    +'<span class="cvbot"><span class="cvprev"><i>'+esc(prevPrefix(c.preview_role))+'</i>'+esc(String(c.preview||''))+'</span>'+ten+'</span></span>'
    +(c.unread?'<i class="cvdot"></i>':'')+'</button>'}).join('')
   :'<p class="cvempty">No hay conversaciones con estos filtros. Solo se guardan desde el 26 de agosto de 2026.</p>';
  paint($('#convRows'));
  convCount=rows.length;
  // Un tope que no se dice se lee como «esto es todo». La bandeja trae las 40 más
  // recientes: si vienen 40, hay más detrás y se avisa.
  $('#convCount').textContent=convCount+' conversaci'+(convCount===1?'ón':'ones')
   +(convCount>=40?' — las más recientes; filtra por fecha o canal para ver más atrás':'');
  renderThread(d.thread);
  // 15 s solo cuando hay algo vivo (alguien esperando o una conversación tomada); si no, un
  // minuto. Con 15 clientes eso baja el gasto de ~28.800 peticiones/día a ~11.500.
  const vivo=enCola>0||rows.some(c=>c.state==='humano');
  inboxPolling(true,vivo?15000:60000);
  $('#convMessage').textContent=''}
 catch(e){if(!quiet)$('#convMessage').innerHTML='<p class="error">'+esc(TERRS[e.message]||e.message)+'</p>'}}
$('#convRows').onclick=e=>{const r=e.target.closest('[data-id]');if(r){convOpen=r.dataset.id;$('#inbox').classList.add('is-thread');loadInbox()}};
// En móvil los dos paneles no caben: la lista y el hilo se turnan, y el hilo trae su botón
// de volver. Delegado en la cabecera porque el hilo se repinta en cada sondeo.
$('#threadHead').onclick=e=>{if(!e.target.closest('#convBack'))return;
 convOpen=null;$('#inbox').classList.remove('is-thread');renderThread(null);loadInbox()};
$('#convFilters').onsubmit=e=>{e.preventDefault();popFiltros(false);convOpen=null;loadInbox();loadAvailability()};
$('#convTenant').onchange=()=>{convOpen=null;loadInbox();loadAvailability()};
$('#convExport').onclick=()=>{location.href='/api/admin/conversations/export.csv?'+convParams()};
// Buscador: se espera a que se deje de teclear. Sin esto, cada tecla es una consulta a D1.
let convQT=null;
$('#convQ').oninput=()=>{clearTimeout(convQT);convQT=setTimeout(()=>{convOpen=null;loadInbox()},350)};
// Filtros y disponibilidad son cajones anclados: uno abierto a la vez, y se cierran al
// pulsar fuera o con Escape. No son diálogos — no bloquean la bandeja detrás.
function popFiltros(on){$('#convPop').hidden=!on;$('#convMore').classList.toggle('is-on',!!on);
 $('#convMore').setAttribute('aria-expanded',on?'true':'false');if(on)$('#availPop').hidden=true}
function popAvail(on){$('#availPop').hidden=!on;$('#availToggle').setAttribute('aria-expanded',on?'true':'false');
 if(on)popFiltros(false)}
$('#convMore').onclick=()=>popFiltros($('#convPop').hidden);
$('#convClear').onclick=()=>{const f=$('#convFilters');
 f.querySelectorAll('input[type=date],input[name=q]').forEach(i=>{i.value=''});
 f.querySelectorAll('input[type=checkbox]').forEach(i=>{i.checked=false});
 $('#convTenant').value='';
 convOpen=null;popFiltros(false);loadInbox();loadAvailability()};
document.addEventListener('click',e=>{
 if(!e.target.closest('#convPop,#convMore'))popFiltros(false);
 if(!e.target.closest('#availPop,#availToggle'))popAvail(false)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){popFiltros(false);popAvail(false)}});
// Polling solo con la pestaña visible Y la vista abierta: 15 s en vez de 5 baja el gasto
// de ~35.000 peticiones/día a ~11.500 con seis paneles abiertos.
let inboxEvery=0;
function inboxPolling(on,ms){const want=on?(ms||60000):0;
 if(want===inboxEvery)return;
 inboxEvery=want;
 if(inboxPoll){clearInterval(inboxPoll);inboxPoll=null}
 if(want)inboxPoll=setInterval(()=>{if(document.visibilityState==='visible')loadInbox(true)},want)}

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
 $('#detailTitle').textContent=l.name||(l.need?'Sin nombre · '+l.need:'Lead sin nombre');
 // Contexto arriba en píldoras; abajo SOLO las tarjetas con dato (nada de parrilla de guiones).
 const meta='<div class="lead-meta">'+statusPill(l.status)+tenantChip(l.tenant_id,l.tenant_name)+'<span class="chip">'+fmt(l.created_at)+'</span><span class="chip">fuente: '+esc(l.source)+'</span></div>';
 const waCard='<div class="card"><b>WhatsApp</b><span class="tel">'+esc(l.whatsapp||'—')+'</span></div>';
 // Lo PRIMERO que necesita quien atiende: qué buscaba la persona. Se guardaba en D1 desde
 // el principio (need/context del resumen) y no se pintaba en ningún sitio.
 const asunto=(l.need||l.context)?'<div class="card asunto mt12"><b>Qué buscaba</b>'
  +(l.need?'<p class="as-need">'+esc(l.need)+'</p>':'')
  +(l.context?'<p class="as-ctx">'+esc(l.context)+'</p>':'')+'</div>':'';
 const cards=[['Sector',l.sector],['Canal',l.channel],['Mensajes/día',l.messages_per_day],['Puntuación',l.score],['Nota del lead',l.note],['Página',l.page_url]]
  .filter(x=>x[1]!=null&&x[1]!=='').map(x=>'<div class="card"><b>'+x[0]+'</b>'+esc(x[1])+'</div>').join('');
 const options=['new','contacted','qualified','won','lost','spam'].map(s=>'<option value="'+s+'"'+(s===l.status?' selected':'')+'>'+ST_LABEL[s]+'</option>').join('');
 const notices=d.notifications.map(n=>'<article><b>Aviso '+esc(n.channel)+': '+esc(n.status)+'</b><div class="muted">Intentos: '+n.attempts+(n.last_error?' · '+esc(n.last_error):'')+'</div></article>').join('');
 const notes=d.notes.map(n=>'<article><b>'+esc(n.author_email)+'</b><div>'+esc(n.text)+'</div><small class="muted">'+fmt(n.created_at)+'</small></article>').join('');
 const events=d.events.map(n=>'<article><b>'+esc(n.event_type)+'</b><div>'+esc(n.detail||'')+'</div><small class="muted">'+fmt(n.created_at)+' · '+esc(n.actor_email)+'</small></article>').join('');
 const acts=notices+notes+events;
 const velaiBtns=ME.role==='velai'?'<button class="btn alt" id="retry">Reintentar avisos</button><button class="btn bad" id="delete">Borrar lead</button>':'';
 $('#detailBody').innerHTML=meta+asunto+'<div class="grid mt12">'+waCard+cards+'</div>'
 +'<div class="actions"><span class="sel"><select id="status">'+options+'</select></span><button class="btn" id="saveStatus">Guardar estado</button><span class="grow"></span>'+velaiBtns+'</div>'
 +'<div class="card"><b>Añadir nota</b><div class="note mt6"><textarea id="note" rows="2" placeholder="Escribe la nota…"></textarea><button class="btn" id="addNote">Añadir</button></div></div>'
 +'<div class="timeline"><h3>Actividad</h3>'+(acts||'<p class="muted">Sin actividad todavía: ni avisos, ni notas, ni cambios.</p>')+'</div>';
 paint($('#detailBody'));wireDetail();$('#detail').showModal()}catch(e){toast('No se pudo abrir el lead: '+e.message,false)}}
// Cada acción confirma con toast; sin el try/catch un fallo del PATCH era INVISIBLE
// (la promesa moría sin aviso y el usuario creía que había guardado).
function wireDetail(){$('#saveStatus').onclick=async()=>{try{await api('/api/admin/leads/'+current.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:$('#status').value})});toast('Estado guardado ✓ («'+(ST_LABEL[$('#status').value]||$('#status').value)+'»)');$('#detail').close();load();loadStats()}catch(e){toast('Estado NO guardado: '+e.message,false)}};if($('#retry'))$('#retry').onclick=async()=>{try{await api('/api/admin/leads/'+current.id+'/retry',{method:'POST'});toast('Reintento de avisos lanzado ✓');openLead(current.id)}catch(e){toast('Reintento fallido: '+e.message,false)}};$('#addNote').onclick=async()=>{const text=$('#note').value.trim();if(!text)return;try{await api('/api/admin/leads/'+current.id+'/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});toast('Nota guardada ✓');openLead(current.id)}catch(e){toast('Nota NO guardada: '+e.message,false)}};if($('#delete'))$('#delete').onclick=async()=>{if(!confirm('¿Borrar definitivamente este lead y todos sus datos?'))return;try{await api('/api/admin/leads/'+current.id,{method:'DELETE'});toast('Lead borrado ✓');$('#detail').close();load();loadStats()}catch(e){toast('Lead NO borrado: '+e.message,false)}}}
// ── Avisos de mensajes nuevos (migración 0029) ───────────────────────────────
// Suena y notifica aunque la pestaña esté en segundo plano o el panel esté en otra vista:
// era el caso que pidió Juan. Por eso este sondeo NO mira visibilityState, al contrario que
// el de la bandeja — pero es una sola consulta agregada cada 30 s.
// El sonido va con Web Audio (un oscilador), NO con <audio>: la CSP del panel no declara
// media-src, así que cae en default-src 'none' y cualquier archivo de audio quedaría
// bloqueado. Un oscilador no carga nada.
const SS_ALERTS='velai-panel-alerts';
let alertsOn=false,alertTimer=null,alertCtx=null,alertSeen=null;
function beep(){
 try{
  if(!alertCtx)alertCtx=new (window.AudioContext||window.webkitAudioContext)();
  if(alertCtx.state==='suspended')alertCtx.resume();
  // Dos notas cortas: se reconoce sin ser estridente y no se confunde con un aviso del SO.
  [[880,0],[1320,.12]].forEach(([hz,at])=>{
   const o=alertCtx.createOscillator(),g=alertCtx.createGain();
   o.type='sine';o.frequency.value=hz;
   const t=alertCtx.currentTime+at;
   g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.18,t+.01);
   g.gain.exponentialRampToValueAtTime(.001,t+.11);
   o.connect(g);g.connect(alertCtx.destination);o.start(t);o.stop(t+.12)})}
 catch(e){/* sin audio disponible, la notificación sigue saliendo */}}
function notify(titulo,cuerpo){
 try{
  if(!('Notification' in window)||Notification.permission!=='granted')return;
  const n=new Notification(titulo,{body:cuerpo,tag:'velai-msg',icon:'/favicon.svg'});
  n.onclick=()=>{window.focus();const b=document.querySelector('.tab[data-view="conversaciones"]');if(b)b.click();n.close()}}
 catch(e){}}
async function checkAlerts(){
 try{const d=await api('/api/admin/alerts');
  // El primer sondeo solo fija la referencia: si no, al activar los avisos sonaría por
  // mensajes que ya estaban ahí desde hace horas.
  if(alertSeen===null){alertSeen=d;return}
  const nuevoMensaje=d.lastInbound&&d.lastInbound!==alertSeen.lastInbound;
  const nuevaEspera=d.waiting>alertSeen.waiting;
  alertSeen=d;
  if(!nuevoMensaje&&!nuevaEspera)return;
  beep();
  // Con la bandeja delante ya lo está viendo: el sonido basta y una notificación del
  // sistema encima sería ruido.
  const mirando=document.visibilityState==='visible'&&!$('#viewConversaciones').hidden;
  if(!mirando)notify(nuevaEspera?'Alguien espera un asesor':'Mensaje nuevo',
   nuevaEspera?(d.waiting===1?'1 conversación esperando que alguien la tome':d.waiting+' conversaciones esperando'):'Ha llegado un mensaje nuevo a Conversaciones.');
  $('#alertDot').hidden=false}
 catch(e){/* un sondeo fallido no apaga los avisos: se reintenta al siguiente */}}
function alertsPolling(on){
 if(alertTimer){clearInterval(alertTimer);alertTimer=null}
 if(on)alertTimer=setInterval(checkAlerts,30000)}
async function setAlerts(on){
 alertsOn=!!on;
 try{sessionStorage.setItem(SS_ALERTS,alertsOn?'1':'')}catch(e){}
 $('#alertLabel').textContent=alertsOn?'Avisos activados':'Activar avisos';
 $('#alertDot').hidden=!alertsOn;
 if(!alertsOn){alertsPolling(false);alertSeen=null;return}
 // El permiso y el AudioContext SOLO se pueden pedir dentro de un gesto del usuario: por eso
 // esto vive en el clic del botón y no en el arranque del panel.
 try{if('Notification' in window&&Notification.permission==='default')await Notification.requestPermission()}catch(e){}
 beep();
 alertSeen=null;
 await checkAlerts();
 alertsPolling(true);
 toast(('Notification' in window&&Notification.permission==='granted')
  ?'Avisos activados ✓ — sonarán aunque estés en otra pestaña'
  :'Avisos activados ✓ (sin permiso de notificaciones: solo sonará)')}
$('#alertBtn').onclick=()=>setAlerts(!alertsOn);

// ── Vistas (barra lateral) ──
const TERRS={already_provisioned:'Ese paso ya está hecho (idempotente: un doble clic no crea recursos duplicados).',provision_in_progress:'Ese paso ya está en curso, espera unos segundos.',waba_required:'Rellena y guarda primero la WABA del cliente.',subaccount_required:'Crea primero la subcuenta (paso 1).',subaccount_unusable:'Esa subcuenta no existe en Twilio o no está activa: revisa el SID pegado en la ficha.',sender_required:'Este cliente aún no tiene número de WhatsApp: haz primero el alta y sincroniza.',template_required:'Este cliente aún no tiene plantilla creada: haz primero el paso 2.',brand_empty:'Rellena al menos el nombre de marca o el logo en la ficha antes de aplicar el perfil.',logo_missing:'Sube primero tu imagen.',channels_required:'Marca al menos un canal para esa imagen.',sender_profile_failed:'Twilio rechazó la actualización del perfil (mira el detalle).',twilio_400_63100:'Twilio rechazó los datos del perfil (validación). El detalle dice qué campo falla.',twilio_400_63101:'La foto no es válida para WhatsApp: prueba una cuadrada de 640×640 en PNG o JPG.',invalid_image:'Solo PNG, JPG o WebP (y que sea una imagen de verdad).',image_too_large:'La imagen pesa más de 2 MB.',media_not_configured:'El almacenamiento de imágenes no está disponible en el worker.',twilio_auth_token_missing:'La subcuenta no tiene auth token guardado.',provision_orphan:'Twilio creó el recurso pero D1 no lo guardó: revisa Telegram y reconcilia a mano.',invalid_code:'El OTP son 4-8 dígitos.',slug_taken:'Ese slug ya existe.',address_taken:'Ese canal ya está asignado a otro cliente: guardarlo desviaría sus conversaciones.',subaccount_taken:'Esa subcuenta de Twilio ya está asignada a otro cliente.',pending_tenant_cannot_be_active:'Un prospecto (canal pending:) no puede activarse: ponle primero su canal real.',invalid_twilio_auth_token:'El auth token debe ser 32 caracteres hexadecimales (Twilio → Keys & Credentials).',stale_tenant:'Alguien modificó este cliente mientras editabas. Recarga la ficha y vuelve a aplicar tus cambios.',nothing_to_update:'No hay cambios que guardar.',invalid_preview:'Escribe un mensaje de prueba y un contexto de al menos 50 caracteres.',rate_limited:'Demasiadas pruebas seguidas: espera un minuto.',email_taken:'Ese correo ya tiene acceso al panel de OTRO cliente (un correo pertenece a un solo cliente).',email_is_admin:'Ese correo es admin de Velai (ADMIN_EMAILS): ya ve todo, no puede ser usuario de un cliente.',invalid_email:'Eso no parece un correo válido.',cloudflare_api_not_configured:'Falta CF_API_TOKEN (secret) o CF_ACCOUNT_ID en el worker: la sincronización con Cloudflare no está activa.',turnstile_sync_failed:'El PUT a Turnstile falló DESPUÉS de guardar en D1: el worker acepta el origen pero Turnstile no emitirá token. Reintenta Sincronizar Turnstile.',turnstile_domains_limit:'Turnstile admite 10 dominios por widget y ya se superan incluso plegando los www: toca pasar a un widget por cliente (alternativa §4 de la spec).',already_admin:'Ese correo ya es admin.',email_is_client:'Ese correo es usuario de un CLIENTE: primero quítalo de la ficha del cliente y luego dale admin.',admin_is_root:'Ese admin es raíz (vive en la configuración del worker): no se puede quitar desde el panel.',cannot_remove_self:'No puedes quitarte a ti mismo (que lo haga otro admin): evita el cierre accidental.',root_only:'Solo los admins raíz (los de la configuración del worker) pueden tocar la configuración.',invalid_token_format:'Eso no parece un token de API de Cloudflare.',token_invalid:'Cloudflare rechazó el token (no está activo): NO se guardó.',token_verify_unavailable:'No se pudo validar contra Cloudflare (red): NO se guardó.',sender_not_found:'La subcuenta no tiene ningún sender de WhatsApp aún: haz primero el Self Sign-up con el cliente.',multiple_senders:'La subcuenta tiene VARIOS senders: reconcíliala a mano desde la ficha.',team_whatsapp_equals_from:'Ese número es el DEL BOT: si se avisa a sí mismo, WhatsApp rechaza todos los avisos (error 63031). Usa los números del equipo.',telegram_not_configured:'Falta configurar Telegram en el worker (token del bot o secreto del webhook).',telegram_no_vinculado:'Vincula primero el grupo de Telegram (botón Conectar Telegram).',marca_blanca_requerida:'Los Temas son parte de la marca blanca: actívala en el paso 1 para este cliente.',group_sin_temas:'El grupo no tiene «Temas» activados: actívalos en los ajustes del grupo de Telegram y reintenta.',bot_sin_permisos:'El bot necesita ser ADMIN del grupo con permiso «Gestionar temas»: dáselo y reintenta.',telegram_topic_failed:'Telegram no pudo crear el tema: reintenta en unos segundos.',demasiados_temas:'Máximo 25 temas por grupo.',invalid_topic_name:'Ponle nombre al tema.',invalid_bot_token:'Ese token no parece de @BotFather o Telegram lo rechazó.',telegram_setup_failed:'Telegram rechazó el registro del webhook: reintenta.'};
let tenantList=[],editing=null;
// Dashboard (2026-08-25): las gráficas viven en su propia vista; Leads se queda con la
// bandeja de trabajo (filtros, tabla, exportar) y sus avisos de chats en pausa.
const VIEWS={dashboard:'#viewDashboard',leads:'#viewLeads',conversaciones:'#viewConversaciones',tenants:'#viewTenants',config:'#viewConfig',calendario:'#viewCalendario',conexiones:'#viewConexiones',canales:'#viewCanales'};
document.querySelectorAll('.tab[data-view]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab[data-view]').forEach(x=>{x.classList.toggle('is-on',x===b);x.setAttribute('aria-selected',x===b?'true':'false')});const v=b.dataset.view;
 Object.entries(VIEWS).forEach(([k,sel])=>{$(sel).hidden=k!==v});
 // Conversaciones es la única vista a pantalla completa: la clase quita el padding de
 // main y fija el alto para que scrollen los paneles y no la página.
 document.body.classList.toggle('wide',v==='conversaciones');
 if(v==='conversaciones')$('#inbox').classList.remove('is-thread');
 inboxPolling(v==='conversaciones');
 if(v==='dashboard'){loadStats();loadAiUsage();loadInfra();loadSaldo()}else if(v==='leads'){load();loadEscalations()}else if(v==='conversaciones'){loadInbox();loadAvailability()}else if(v==='tenants')loadTenantList();else if(v==='config'){loadAdmins();loadConfig()}else if(v==='calendario'){calMenu()}else if(v==='conexiones'){cxMenu()}else if(v==='canales'){loadChannels()}});
// ── Conexiones (SPEC-CONEXIONES PR1): Telegram de avisos en autoservicio ──
// El cliente abre SU tarjeta; Velai elige tenant con el selector de la cabecera.
let cxTenant=null;
let cxLogo='';  // logo actual del cliente en Conexiones (para la miniatura)
let cxWeekly=true;  // informe semanal del cliente abierto en Conexiones
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
  // Informe semanal: el interruptor solo tiene sentido con el grupo vinculado — sin
  // Telegram no hay a dónde mandarlo, y decirlo es mejor que ofrecer un botón inútil.
  cxWeekly=t.weeklyReport!==false;
  $('#wrState').textContent=cxWeekly?'activado':'desactivado';
  $('#wrState').className='flag '+(cxWeekly?'ok':'off');
  $('#wrToggle').className='sw'+(cxWeekly?' on':'');
  $('#wrToggle').setAttribute('aria-checked',cxWeekly?'true':'false');
  $('#wrNote').textContent=t.linked?'':'Vincula primero el grupo de Telegram: es por donde llega el informe.';
  $('#wrTest').hidden=!t.linked;
  // El horario se lee de /availability, que ya devuelve el que está en vigor (con el
  // default aplicado) y la zona horaria.
  try{const av=await api('/api/admin/availability'+(ME&&ME.tenantId?'':'?tenant='+encodeURIComponent(cxTenant)));
   hoursToForm('sh',av.hours);shSyncRows();$('#shTz').value=av.tz||'Europe/Madrid';$('#shOut').textContent=shSummary(av.hours)}
  catch(e){$('#shOut').textContent=''}
  // «¿Salió el informe?» se responde aquí y no abriendo Telegram. Un skipped o un failed
  // deja de ser invisible.
  const WR_ST={sent:'entregado',skipped:'no enviado',failed:'falló',sending:'en curso'};
  $('#wrLast').textContent=t.lastReport
   ?('Último informe (semana del '+esc(t.lastReport.period_start)+'): '+(WR_ST[t.lastReport.status]||t.lastReport.status)+(t.lastReport.detail?' — '+esc(t.lastReport.detail):''))
   :(t.linked?'Todavía no se ha enviado ninguno: el primero sale el lunes por la mañana.':'');
  $('#tgTopics').innerHTML=(t.topics&&t.topics.length)
   ?'<div class="cxtopics">'+t.topics.map(tp=>'<div class="cxtrow"><span class="cxtn2">'+esc(tp.name)+'</span>'
     +'<span class="cxtd">'+(tp.description?esc(tp.description):'sin descripción')+'</span>'
     +'<button class="cxibtn" type="button" data-tdesc="'+esc(String(tp.thread_id))+'" title="Editar la descripción" aria-label="Editar la descripción">'+ICO_PEN+'</button>'
     +'<button class="cxibtn del" type="button" data-tdel="'+esc(String(tp.thread_id))+'" title="Quitar del enrutado" aria-label="Quitar del enrutado">'+ICO_X+'</button></div>').join('')+'</div>'
   :'<p class="muted">Aún no hay temas: crea el primero arriba.</p>';
  tgRenderWiz(t)}
 catch(e){$('#tgState').textContent=e.message}
 // Tus canales: el worker ya colapsó los estados según el rol; aquí solo se les pone
 // palabras. Dos vocabularios a propósito — el cliente nunca lee un diagnóstico.
 try{const ch=(await api('/api/admin/tenants/'+cxTenant+'/channels')).channels;
  $('#cxChannels').innerHTML=cxTiles(ch)}
 catch(e){$('#cxChannels').innerHTML='<div class="cxtile is-off"><span class="cxtm"><span class="cxta">'+esc(e.message)+'</span></span></div>'}
 // Tarjeta de WhatsApp (PR2): estado en lenguaje de negocio, nunca jerga de Twilio.
 try{const wr=await api('/api/admin/tenants/'+cxTenant+'/whatsapp');const w=wr.whatsapp,al=wr.alerts;
  const AL={on:['flag ok','recibe avisos'],
   pending_template:['flag','WhatsApp está aprobando la plantilla'],
   off:['flag off','sin configurar']};
  $('#cxAlerts').innerHTML=al?['telegram','whatsapp'].map(k=>{const s=AL[al[k]]||AL.off;
    return '<div class="cxarow"><span class="cxti">'+chIcon(k)+'</span>'
     +'<span class="cxan">'+(k==='telegram'?'Telegram':'WhatsApp')+'</span>'
     +'<span class="'+s[0]+'">'+esc(s[1])+'</span></div>'}).join('')
   +(al.any?'':'<p class="as-ctx mt6">Ahora mismo <b>nadie recibe un aviso</b> cuando entra un lead: se guardan aquí en el panel, pero hay que entrar a mirarlos. Conecta tu Telegram arriba y los tendrás al momento — es lo único que no depende de que WhatsApp apruebe nada.</p>'):'';
  const st=w.sender_status;
  let msg;
  if(!st)msg='Sin conectar todavía. La conexión la hacemos juntos en una sesión corta — te avisaremos para agendarla.';
  else if(st==='ONLINE'&&!w.routed)msg='<span class="flag off">Tu número está dado de alta pero aún no recibe mensajes</span> <span class="muted">· lo dejamos atendido en unos minutos; no hace falta que hagas nada</span>';
  // La coletilla prometía Telegram SIN comprobar que hubiera un Telegram vinculado. Con
  // gogestión era mentira: los dos canales salían skipped y nadie veía sus leads. Ahora la
  // promesa depende del estado real de entrega, y si no hay ninguno se dice claro.
  else if(st==='ONLINE')msg='<span class="flag ok">Activo</span>'+(w.lead_template_status==='approved'?''
   :(al&&al.telegram==='on'?' <span class="muted">· mientras WhatsApp aprueba la plantilla, los avisos de leads te llegan por Telegram</span>'
    :' <span class="muted">· WhatsApp aún está aprobando la plantilla de avisos</span>'));
  else if(['CREATING','PENDING_VERIFICATION','VERIFYING'].indexOf(st)>=0)msg='<span class="flag">Verificando tu número con WhatsApp…</span>';
  else msg='<span class="flag off">Revisando un problema con tu número.</span>';
  $('#waState').innerHTML=msg+(w.twilio_from?' <span class="muted">· '+esc(String(w.twilio_from).replace('whatsapp:',''))+'</span>':'');
  $('#nfTeam').value=w.team_whatsapp||'';$('#nfWa').value=w.wa_number||'';
  cxLogo=w.logo_url||'';
  const cxLogoWa=w.logo_wa_url||w.logo_url||'';
  $('#cxLogoPrev').innerHTML=/^https:\/\//i.test(cxLogo)?'<img src="'+esc(cxLogo)+'" alt="">':'web';
  $('#cxLogoPrevWa').innerHTML=/^https:\/\//i.test(cxLogoWa)?'<img src="'+esc(cxLogoWa)+'" alt="">':'wa';
  const ps=wr.profileSync,tieneWa=!!w.sender_status;
  // Nunca se pide subir la misma imagen dos veces: si falta aplicarla a WhatsApp,
  // aparece el botón que usa la que YA está guardada.
  $('#cxLogoApply').hidden=!(cxLogo&&tieneWa&&!(ps&&ps.ok));
  $('#cxLogoOut').textContent=!cxLogo?'Aún no has subido tu imagen.'
   :(!tieneWa?'Ya se ve en el chat de tu web. Cuando tu WhatsApp esté activo, se aplicará también ahí.'
    :ps?(ps.ok?'Ya se ve en el chat de tu web y en tu WhatsApp ('+fmt(ps.at)+').':'⚠ No se pudo aplicar a WhatsApp ('+esc(TERRS[ps.error]||ps.error||'motivo desconocido')+(ps.why?' — '+esc(ps.why):'')+')')
     :'Ya se ve en el chat de tu web. Pulsa «Aplicar a mi WhatsApp» para usarla también ahí.')}
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
  node.querySelector('.tgnum').innerHTML=s.done?ICO_TICK:esc(String(num));
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
$('#tgTopics').onclick=async e=>{const t=e.target&&e.target.closest?e.target.closest('[data-tdesc],[data-tdel]'):null;
 if(!t||!t.dataset)return;
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
$('#wrToggle').onclick=async()=>{const next=!cxWeekly;
 try{await api('/api/admin/tenants/'+cxTenant+'/notify',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({weekly_report:next})});
  toast(next?'Informe semanal activado ✓ (llega el lunes)':'Informe semanal desactivado ✓');loadConexiones()}
 catch(e){toast('No se pudo cambiar el informe: '+(TERRS[e.message]||e.message),false)}};
const SUP_DAYS=['mon','tue','wed','thu','fri','sat','sun'];
// Una sola rejilla para dos horarios distintos (asesores y laboral del calendario): el
// prefijo del id decide cuál. Antes los dos eran un textarea de JSON.
function hoursToForm(pfx,h){for(const d of SUP_DAYS){const t=(h&&h[d])||[];
 for(const i of [1,2]){const w=t[i-1]||[];$('#'+pfx+'_'+d+'_'+i+'a').value=w[0]||'';$('#'+pfx+'_'+d+'_'+i+'b').value=w[1]||''}}}
function hoursFromForm(pfx){const out={};
 for(const d of SUP_DAYS){const tramos=[];
  for(const i of [1,2]){const a=$('#'+pfx+'_'+d+'_'+i+'a').value,b=$('#'+pfx+'_'+d+'_'+i+'b').value;
   if(a&&b&&a<b)tramos.push([a,b])}
  if(tramos.length)out[d]=tramos}
 return out}
function hoursCopyMon(pfx){for(const i of [1,2]){const a=$('#'+pfx+'_mon_'+i+'a').value,b=$('#'+pfx+'_mon_'+i+'b').value;
 for(const d of ['tue','wed','thu','fri']){$('#'+pfx+'_'+d+'_'+i+'a').value=a;$('#'+pfx+'_'+d+'_'+i+'b').value=b}}}
// Lo que de verdad está en vigor, en una frase. Un objeto vacío NO es lo mismo que «sin
// configurar»: significa que nunca se ofrece asesor, y eso hay que decirlo o parece un fallo.
function shSummary(h){const abiertos=SUP_DAYS.filter(d=>h&&h[d]&&h[d].length);
 if(!abiertos.length)return 'Ahora mismo NUNCA se ofrece asesor: Vai atiende siempre y te deja el lead.';
 return 'En vigor: '+abiertos.length+(abiertos.length===1?' día':' días')+' con atención humana.'}
// Un día «cerrado» no es un dato nuevo: es un día sin tramos. El interruptor lee la
// rejilla y al apagarlo borra sus horas; al encenderlo pone un tramo por defecto para que
// quede válido de entrada (hoursFromForm exige a<b para guardar el tramo).
function shSyncRows(){for(const d of SUP_DAYS){
 const lleno=['1a','1b','2a','2b'].some(f=>$('#sh_'+d+'_'+f).value);
 $('#shsw_'+d).classList.toggle('on',lleno);
 $('#shsw_'+d).setAttribute('aria-checked',lleno?'true':'false');
 $('#shrow_'+d).classList.toggle('off',!lleno);
 $('#shoff_'+d).hidden=lleno}}
function shSetDay(d,on){
 if(!on){for(const f of ['1a','1b','2a','2b'])$('#sh_'+d+'_'+f).value=''}
 else{$('#sh_'+d+'_1a').value='09:00';$('#sh_'+d+'_1b').value='19:00'}
 shSyncRows()}
$('#shGrid').onclick=e=>{const b=e.target.closest&&e.target.closest('[data-shd]');if(!b)return;
 shSetDay(b.dataset.shd,!b.classList.contains('on'))};
$('#shGrid').oninput=shSyncRows;
$('#shCopy').onclick=()=>{hoursCopyMon('sh');shSyncRows();$('#shOut').textContent='Copiado — recuerda Guardar.'};
$('#calCopy').onclick=()=>{hoursCopyMon('cal');$('#calHoursOut').textContent='Copiado — recuerda Guardar calendario.'};
$('#shSave').onclick=async()=>{$('#shSave').disabled=true;
 try{const hours=hoursFromForm('sh');
  await api('/api/admin/tenants/'+cxTenant+'/notify',{method:'PATCH',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({support_hours:JSON.stringify(hours),support_tz:$('#shTz').value})});
  $('#shOut').textContent=shSummary(hours);toast('Horario guardado ✓');
  if(typeof loadAvailability==='function')loadAvailability()}
 catch(e){toast('Horario NO guardado: '+(TERRS[e.message]||e.message),false)}
 finally{$('#shSave').disabled=false}};
$('#wrTest').onclick=async()=>{$('#wrTest').disabled=true;
 try{await api('/api/admin/tenants/'+cxTenant+'/report/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  toast('Prueba enviada ✓ — míralo en tu grupo de Telegram')}
 catch(e){toast('La prueba NO salió: '+(TERRS[e.message]||e.message),false)}
 finally{$('#wrTest').disabled=false}};
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
// Cabecera del panel con el logo del cliente: solo cuando la imagen CARGA de verdad,
// para no dejar un hueco roto si la URL falla.
function brandLogo(url,name){if(!url)return;const img=$('#brandLogo');
 img.onload=()=>{$('#brandName').textContent=name||'';$('#brand').classList.add('haslogo')};
 img.onerror=()=>{$('#brand').classList.remove('haslogo')};
 img.src=url}
function flags(list,cls){return list.map(f=>'<span class="flag'+(cls?' '+cls:'')+'">'+esc(f)+'</span>').join('')}
// Un chip por canal REAL (la web entra por slug y está siempre) + avisos de configuración.
// El viejo «socio pendiente» (era Ruta B con socio Meta) se retiró: con Self Sign-up el
// estado veraz del canal WhatsApp es el del sender.
function semaforo(t){if(!t.active&&String(t.channel_address).startsWith('pending:'))return '<span class="flag off">prospecto</span>';
 const kinds=new Set(String(t.channels||'').split(',').filter(Boolean));
 const m=/^(whatsapp|messenger):/.exec(String(t.channel_address));if(m)kinds.add(m[1]);
 let chips='<span class="flag web">web</span>';
 if(kinds.has('whatsapp'))chips+=(t.sender_status==='ONLINE'||(t.has_from&&!t.has_subaccount))?'<span class="flag ok">whatsapp</span>':'<span class="flag">whatsapp: verificando</span>';
 // Sender vivo en Twilio y NINGÚN canal que lo enrute: el bot calla en verde (gogestion,
 // 2026-08-24). Antes no se pintaba nada y el cliente pasaba por «solo web».
 else if(t.sender_status==='ONLINE'||t.has_from)chips+='<span class="flag off">whatsapp: sin enrutar</span>';
 if(kinds.has('messenger'))chips+='<span class="flag ok">messenger</span>';
 const f=[];if(t.prompt_len>8000)f.push('contexto muy largo');if(t.prompt_len<200)f.push('contexto corto');
 if(!t.has_team&&!t.has_telegram)f.push('sin canal de aviso');
 if(kinds.has('whatsapp')){if(!t.has_template)f.push('sin plantilla');if(t.has_subaccount&&!t.has_twilio_token)f.push('sin token');if(t.has_subaccount&&!t.has_from)f.push('sin From')}
 return chips+(f.length?flags(f):' <span class="flag ok">listo</span>')}
// ── Canales: la tabla de ENRUTADO, no la opinión de Twilio ───────────────────
// Los estados los decide el worker (misma pregunta que tenantByAddress); aquí solo se
// pintan, para que panel y enrutado real no puedan discrepar.
const CHST={live:['ok','atendido'],inactive:['off','cliente inactivo'],from_mismatch:['','responde con otro número'],orphan:['off','cliente borrado']};
// El filtrado es en cliente sobre lo ya cargado: la tabla tiene una fila por canal y
// cliente, así que cabe entera en una respuesta y filtrar sin ir al servidor es instantáneo.
// La píldora de arriba sigue contando el TOTAL, no lo filtrado: es el estado del sistema.
let chData={channels:[],unrouted:[]};
// El buscador casa contra el número CON y SIN prefijo (nadie teclea «whatsapp:») y sin
// acentos en los dos lados: buscar «gogestion» tiene que encontrar «GOgestión».
const chNorm=(v)=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const chHay=(o)=>[o.address,o.twilio_from,o.name,o.slug,o.kind].map(v=>chNorm(v).replace(/^whatsapp:/,'')).join(' ');
function chPaint(){const q=chNorm($('#chQ').value.trim()),tid=$('#chTenant').value,st=$('#chState').value;
 const keep=(o,state)=>(!q||chHay(o).includes(q))&&(!tid||o.tenant_id===tid)
  &&(!st||(st==='alert'?state!=='live':state===st));
 const rows=chData.channels.filter(c=>keep(c,c.state));
 // Los sin enrutar son SIEMPRE «requieren atención»: nunca los esconde el filtro de estado.
 const un=chData.unrouted.filter(u=>keep(u,'unrouted'));
 $('#chRows').innerHTML=rows.map(c=>{const s=CHST[c.state]||['','—'];
  const who=c.name?tenantChip(c.tenant_id,c.name):'<span class="muted">— (id '+esc(String(c.tenant_id))+')</span>';
  const extra=c.state==='from_mismatch'?' <span class="muted">· responde desde '+esc(String(c.twilio_from).replace('whatsapp:',''))+'</span>':'';
  return '<tr><td class="tel">'+esc(c.address)+'</td><td>'+who+'</td><td class="muted">'+esc(c.kind)+'</td><td><span class="flag '+s[0]+'">'+s[1]+'</span>'+extra+'</td><td class="muted">'+fmt(c.created_at)+'</td></tr>'}).join('')
  ||'<tr><td colspan="5" class="empty">'+(chData.channels.length?'Ningún canal casa con el filtro.':'Ninguna dirección enrutada todavía.')+'</td></tr>';
 $('#chAlarm').innerHTML=un.length?'<div class="panelcard mt12"><b>Números vivos en Twilio que el worker NO atiende<span class="pt-count">'+un.length+'</span></b>'
  +'<p class="muted mt6">El sender está de alta y en verde, pero ninguna fila lo enruta: el webhook responde 404 y el bot calla. Se arregla con «Sincronizar sender» en Conexiones → WhatsApp de esa ficha, que registra el canal.</p>'
  +un.map(u=>'<div class="mb6"><span class="flag off">'+esc(String(u.twilio_from).replace('whatsapp:',''))+'</span> '+tenantChip(u.tenant_id,u.name)
   +' <span class="muted">· sender '+esc(u.sender_status||'—')+(u.active?'':' · cliente inactivo')+'</span></div>').join('')+'</div>':'';
 const tot=chData.channels.length,filtered=q||tid||st;
 $('#chCount').textContent=filtered?rows.length+' de '+tot+(tot===1?' canal':' canales'):tot+(tot===1?' canal':' canales')}
async function loadChannels(){try{const d=await api('/api/admin/channels');chData=d;
 // El selector se puebla con los clientes que TIENEN canales: los demás no dicen nada aquí.
 const who=new Map();for(const o of d.channels.concat(d.unrouted))if(o.tenant_id&&o.name)who.set(o.tenant_id,o.name);
 const sel=$('#chTenant'),keepSel=sel.value;
 sel.innerHTML='<option value="">Todos los clientes</option>'+[...who.entries()].sort((a,b)=>a[1].localeCompare(b[1],'es'))
  .map(([id,name])=>'<option value="'+esc(id)+'">'+esc(name)+'</option>').join('');
 if(who.has(keepSel))sel.value=keepSel;
 const bad=d.unrouted.length+d.channels.filter(c=>c.state!=='live').length;
 const pill=$('#chOverall');pill.hidden=false;pill.className='stpill '+(bad?'warn':'ok');
 pill.innerHTML='<i></i>'+(bad?bad+(bad===1?' canal requiere atención':' canales requieren atención'):'todo atendido');
 chPaint()}
 catch(e){$('#chRows').innerHTML='<tr><td colspan="5" class="empty">'+esc(e.message)+'</td></tr>'}}
$('#chQ').oninput=chPaint;$('#chTenant').onchange=chPaint;$('#chState').onchange=chPaint;
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
// channel_address NO está aquí a propósito: dejó de ser un campo que se teclea. El alta
// lo deriva del slug en el worker y se promueve a web:<slug> al marcar Activo; los canales
// de mensajería se dan de alta en Conexiones. La ficha solo los MUESTRA (renderChannels).
const TF={name:'#tName',slug:'#tSlug',twilio_from:'#tFrom',team_whatsapp:'#tTeam',telegram_chat_id:'#tChat',lead_template_sid:'#tTpl',twilio_subaccount_sid:'#tSub',waba_id:'#tWaba',meta_partner_status:'#tPartner',system_prompt:'#tPrompt',bot_name:'#tBotName',brand_name:'#tBrandName',logo_url:'#tLogo',brand_color:'#tColor1',brand_color_2:'#tColor2',agent_color:'#tAgentColor',greeting:'#tGreeting',greeting_en:'#tGreetingEn',placeholder:'#tPlaceholder',wa_number:'#tWa',theme:'#tTheme',ai_monthly_tokens:'#tAiMonth',ai_daily_limit:'#tAiDay'};
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
// Subida del logo al almacenamiento propio: rellena #tLogo con la URL servida por
// api.hirevai.com. La ficha NO necesita guardarse para que la URL quede (el endpoint
// ya la escribe en D1), pero se refleja en el campo para que se vea y previsualice.
$('#tLogoUp').onclick=async()=>{const f=$('#tLogoFile').files&&$('#tLogoFile').files[0];
 if(!f)return $('#tLogoOut').textContent='Elige una imagen primero.';
 if(!editing||!editing.id)return $('#tLogoOut').textContent='Guarda el cliente antes de subir su logo.';
 if(f.size>2*1024*1024)return $('#tLogoOut').textContent='Máximo 2 MB.';
 $('#tLogoOut').textContent='subiendo…';
 try{const d=await api('/api/admin/tenants/'+editing.id+'/logo',{method:'POST',headers:{'Content-Type':f.type||'application/octet-stream'},body:f});
  $('#tLogo').value=d.logo_url;brandPreview();$('#tLogoOut').textContent='Subido ✓';toast('Logo guardado')}
 catch(e){$('#tLogoOut').textContent='Error: '+(TERRS[e.message]||e.message)}};
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
 // El canal ya no se teclea: el worker deriva pending:<slug> (prospecto que no enruta) y
 // lo promueve a web:<slug> en cuanto se marca Activo.
 const wasNew=!editing;
 if(tenantDirty||wasNew){const ok=await saveTenant();if(!ok)return}
 if(wasNew&&editing){$('#ttabProv').hidden=false;$('#ttabUsers').hidden=false;$('#ttabHist').hidden=false;$('#tProv').hidden=false;$('#tUsersCard').hidden=false;$('#tDup').hidden=true;loadProv(editing.id);loadUsers(editing.id);loadVersions(editing.id)}
 if(wizStep===WIZ.length-1){setWizard(false);showPane('identidad');toast('Alta completada ✓ — actívalo en «Identidad y canal» cuando su canal esté listo');return}
 wizStep++;wizShow()};
// Los canales de la ficha se PINTAN, no se editan: el estado lo decide el worker leyendo
// tenant_channels / twilio_from / telegram_chat_id. El estado «sin enrutar» es el caso
// gogestion — sender propio en Twilio sin fila que lo enrute — y aquí se ve en la ficha.
const CHK={web:'web',whatsapp:'whatsapp',telegram:'telegram',messenger:'messenger'};
// Vocabulario del CLIENTE: nada que no pueda accionar. «preparing» es su WhatsApp de alta
// pero sin enrutar — trabajo pendiente NUESTRO, así que se dice así y no «sin enrutar».
// Todos los canales del producto, en el orden en que se miran. Los que AÚN NO EXISTEN se
// pintan igual, apagados y con «sin activar»: esconderlos dejaba la duda de si el canal
// existe, y pintarlos como si funcionaran sería peor (decisión de Juan, 2026-08-27).
const CX_CAT=[['web','Tu web'],['whatsapp','WhatsApp'],['telegram','Telegram'],
 ['messenger','Messenger'],['instagram','Instagram']];
const CX_SOON={instagram:1};
// Estado → [clase del punto, palabras]. Dos vocabularios a propósito: el cliente nunca
// lee un diagnóstico; Velai sí, porque a él le sirve.
const CXST={on:['on','Activo'],live:['on','Atendido'],
 preparing:['wait','Lo estamos dejando listo'],unrouted:['bad','Sin enrutar'],
 paused:['','En pausa'],inactive:['','Cliente inactivo'],
 off:['','Sin conectar'],soon:['','Sin activar']};
function cxTiles(channels){const by={};for(const c of channels||[])if(c&&c.kind)by[c.kind]=c;
 return CX_CAT.map(function(par){const k=par[0];
  const c=by[k]||{kind:k,state:CX_SOON[k]?'soon':'off',address:null};
  const st=CXST[c.state]||CXST.off;
  const dir=c.address?String(c.address).replace(/^(whatsapp:|messenger:)/,'')
   :(CX_SOON[k]?'Canal todav\u00eda no disponible':'Sin configurar');
  return '<div class="cxtile'+(st[0]?'':' is-off')+'"><span class="cxti">'+chIcon(k)+'</span>'
   +'<span class="cxtm"><span class="cxtn">'+esc(par[1])+'</span><span class="cxta">'+esc(dir)+'</span>'
   +'<span class="cxts '+st[0]+'"><i></i>'+esc(st[1])+'</span></span></div>'}).join('')}
const CHSTATE={live:['on','<span class="flag ok">atendido</span>'],inactive:['','<span class="flag">cliente inactivo</span>'],
 unrouted:['bad','<span class="flag off">sin enrutar</span>'],off:['','<span class="muted">sin conectar</span>']};
function renderChannels(list){$('#tChannels').innerHTML=(list||[]).map(c=>{const st=CHSTATE[c.state]||CHSTATE.off;
 const addr=c.address?esc(String(c.address).replace(/^whatsapp:/,'')):'—';
 return '<div class="chrow"><i class="'+st[0]+'"></i><span class="chk">'+esc(CHK[c.kind]||c.kind)+'</span><span class="chaddr">'+addr+'</span>'+st[1]+'</div>'}).join('')
 ||'<div class="chrow"><i></i><span class="chaddr">Sin canales todavía.</span></div>'}
async function openTenant(id){clearTenantErrs();$('#tPreviewOut').textContent='';$('#tTestMsg').value='';$('#tNote').value='';
 $('#tToken').value='';clearDirtyDots();
 // provPost recarga la ficha del MISMO cliente en mitad del alta: se conserva el paso.
 const stayWiz=wizard&&editing&&editing.id===id;
 if(id){const d=await api('/api/admin/tenants/'+id);const t=d.tenant;renderChannels(d.channels);editing={id:t.id,updated_at:t.updated_at};$('#tenantTitle').textContent=t.name;$('#tDup').hidden=true;for(const[k,sel]of Object.entries(TF))$(sel).value=t[k]??'';$('#tChips').value=chipsToLines(t.chips_json);$('#tOrigins').value=jsonToLines(t.web_origins);$('#tActive').checked=!!t.active;$('#tTokenState').textContent=t.has_twilio_token?'configurado ✓ (escribe solo para sustituirlo)':'sin configurar';$('#tProv').hidden=false;$('#tUsersCard').hidden=false;$('#ttabProv').hidden=false;$('#ttabUsers').hidden=false;$('#ttabHist').hidden=false;if(stayWiz)wizShow();else{setWizard(false);showPane('identidad')}loadProv(id);loadVersions(id);loadUsers(id)}
 else{editing=null;renderChannels([{kind:'web',address:'se activa con el slug',state:'off'}]);$('#tenantTitle').textContent='Nuevo cliente';$('#tDup').hidden=false;$('#tDupSel').innerHTML='<option value="">— empezar de cero —</option>'+tenantList.map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('');for(const sel of Object.values(TF))$(sel).value='';$('#tChips').value='';$('#tOrigins').value='';$('#tPartner').value='pendiente';$('#tActive').checked=false;$('#tTokenState').textContent='sin configurar';$('#tProv').hidden=true;$('#tUsersCard').hidden=true;$('#ttabProv').hidden=true;$('#ttabUsers').hidden=true;$('#ttabHist').hidden=true;$('#tVersions').textContent='—';setWizard(true)}
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
 $('#calId').value=c.calendar_id||'primary';$('#calTz').value=c.timezone||'';$('#calSlot').value=c.slot_minutes||30;
 try{hoursToForm('cal',c.business_hours?JSON.parse(c.business_hours):null)}catch(e){hoursToForm('cal',null)}
 $('#calHoursOut').textContent=c.business_hours?'':'Usando el horario por defecto: L-V de 9:00 a 19:00.';
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
$('#calSave').onclick=async()=>{const grid=hoursFromForm('cal');
 // OJO: la rejilla vacía se manda como null, NO como {}. Con el textarea, vacío significaba
 // «el default L-V 9-19»; un {} en el calendario significa «ningún hueco jamás» y habría
 // matado las citas en silencio al borrar la rejilla sin querer.
 const hours=Object.keys(grid).length?grid:null;
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
// Comprobar a demanda, con la respuesta CRUDA de Twilio a la vista: si el estado no viene
// donde lo leemos, se ve aquí en vez de deducirse de una fila que no cambia nunca.
// Reenviar: la plantilla existe en Twilio pero puede no haber llegado a Meta (le pasó a
// gogestión, con la WABA a 0 plantillas). El paso 2 no sirve: lanza 409 si ya hay SID.
$('#pTplRe').onclick=async()=>{const out=$('#tTplRaw');out.hidden=false;out.textContent='Reenviando a aprobación…';
 try{const r=await api('/api/admin/tenants/'+editing.id+'/provision/template/resubmit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  out.textContent='Reenviada ✓ — Twilio la aceptó otra vez. Comprueba en WhatsApp Manager que ahora SÍ aparece en la WABA;\nsi sigue a 0 plantillas, el problema está entre Twilio y Meta y toca ticket a Twilio.\n\n'+JSON.stringify(r.raw,null,1);
  toast('Plantilla reenviada a aprobación ✓');loadProv(editing.id)}
 catch(e){out.textContent='Twilio rechazó el reenvío: '+(TERRS[e.message]||e.message);toast('Reenvío fallido: '+e.message,false)}};
$('#pTplChk').onclick=async()=>{const out=$('#tTplRaw');out.hidden=false;out.textContent='Consultando a Twilio…';
 try{const r=await api('/api/admin/tenants/'+editing.id+'/provision/template/check',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const lines=['Estado según Twilio: '+r.status+(r.reason?' · '+r.reason:''),'Estado guardado: '+(r.stored||'—'),'Plantilla: '+r.sid];
  if(r.applied)lines.push('→ la ficha se ha actualizado con este estado.');
  if(r.status==='unknown')lines.push('⚠️ Twilio contestó pero SIN el estado donde lo leemos: mira el crudo de abajo, la forma de la respuesta ha cambiado.');
  out.textContent=lines.join('\n')+'\n\n'+JSON.stringify(r.raw,null,1);
  if(r.applied){toast('Plantilla '+r.status+' ✓');loadProv(editing.id);loadTenantList()}else toast('Twilio dice: '+r.status)}
 catch(e){out.textContent='Fallo al consultar: '+(TERRS[e.message]||e.message);toast('Comprobación fallida: '+e.message,false)}};
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
 $('#footYear').textContent=new Date().getFullYear();
 if(ME.role!=='velai'){document.body.classList.add('cliente');if(ME.tenantName)document.querySelector('.brand small').textContent=ME.tenantName;
  // Su logo manda en la cabecera del panel; sin logo, se queda la marca de Velai.
  if(ME.tenantLogo)brandLogo(ME.tenantLogo,ME.tenantName)}
 else loadTenants();
 // Arranca en Dashboard (es la primera pestaña): sus datos primero, y los leads en
 // segundo plano para que la bandeja esté lista al pulsar Leads.
 loadStats();loadAiUsage();loadInfra();loadSaldo();load();loadEscalations();
 // La preferencia se recuerda por pestaña, como el tema. No se puede reactivar sola sin un
 // gesto (el navegador no deja crear el AudioContext), así que solo se deja el botón
 // preparado y el sondeo en marcha: el sonido llegará al primer clic en cualquier parte.
 let quiere=false;try{quiere=sessionStorage.getItem(SS_ALERTS)==='1'}catch(e){}
 if(quiere){alertsOn=true;$('#alertLabel').textContent='Avisos activados';$('#alertDot').hidden=false;alertSeen=null;checkAlerts();alertsPolling(true)}})();
// Sincronización del sender desde Twilio (solo Velai): rellena la fila tras el
// Self Sign-up y repara el webhook si quedó en el default de Twilio.
$('#waSync').onclick=async()=>{$('#waSyncOut').textContent='sincronizando…';
 try{const d=await api('/api/admin/tenants/'+cxTenant+'/provision/sender/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  let out='Sincronizado ✓ · '+d.applied+' campos'+(d.webhookFixed?' · webhook reparado':'');
  if(!d.webhookOk)out+=' · ⚠ WEBHOOK MAL: los mensajes NO llegan al worker';
  if(d.conflicts&&d.conflicts.length)out+=' · conflictos: '+d.conflicts.map(c=>c.field+' (fila '+c.current+' / Twilio '+c.fromTwilio+')').join('; ');
  $('#waSyncOut').textContent=out;loadConexiones()}
 catch(e){$('#waSyncOut').textContent='Error: '+(TERRS[e.message]||e.message)}};
// Perfil de negocio de WhatsApp (solo Velai): la marca de la ficha pasa a ser la foto
// y los datos que ve el cliente final. El nombre visible no se toca.
$('#waProfile').onclick=async()=>{$('#waSyncOut').textContent='aplicando marca…';
 try{const d=await api('/api/admin/tenants/'+cxTenant+'/provision/sender/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  $('#waSyncOut').textContent='Perfil actualizado ✓'+(d.applied&&d.applied.logo?' · con foto':' · SIN foto (sube el logo en la ficha)')+(d.applied&&d.applied.websites?' · con web':'');
  toast('Perfil de WhatsApp actualizado')}
 catch(e){$('#waSyncOut').textContent='Error: '+(TERRS[e.message]||e.message)}};
// El <label> abre el selector nativo; aquí solo se refleja qué archivo eligió.
[['#cxLogoFile','#cxLogoName'],['#tLogoFile','#tLogoName']].forEach(([f,n])=>{const el=$(f);if(el)el.onchange=()=>{const x=el.files&&el.files[0];$(n).textContent=x?x.name:'ninguna elegida'}});
// Reaplicar a WhatsApp la imagen YA guardada: no hay que volver a subirla.
$('#cxLogoApply').onclick=async()=>{$('#cxLogoOut').textContent='aplicando a WhatsApp…';
 try{await api('/api/admin/tenants/'+cxTenant+'/logo/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  $('#cxLogoOut').textContent='Aplicada a tu WhatsApp ✓ (puede tardar unos minutos en verse)';$('#cxLogoApply').hidden=true;toast('Foto aplicada a WhatsApp')}
 catch(e){$('#cxLogoOut').textContent='No se pudo aplicar: '+(TERRS[e.message]||e.message)+(e.why?' — '+e.why:'')}};
// Logo en AUTOSERVICIO (pedido de Juan, 2026-08-24): es su marca, la sube el propio
// cliente. Al guardarse, el worker se lo aplica también a su foto de WhatsApp.
$('#cxLogoUp').onclick=async()=>{const f=$('#cxLogoFile').files&&$('#cxLogoFile').files[0];
 if(!f)return $('#cxLogoOut').textContent='Elige una imagen primero.';
 if(f.size>2*1024*1024)return $('#cxLogoOut').textContent='La imagen no puede pasar de 2 MB.';
 const ch=[...($('#cxChWeb').checked?['web']:[]),...($('#cxChWa').checked?['whatsapp']:[])];
 if(!ch.length)return $('#cxLogoOut').textContent='Marca al menos un canal.';
 $('#cxLogoOut').textContent='subiendo…';
 try{const d=await api('/api/admin/tenants/'+cxTenant+'/logo?channels='+ch.join(','),{method:'POST',headers:{'Content-Type':f.type||'application/octet-stream'},body:f});
  if(d.canales.web)$('#cxLogoPrev').innerHTML='<img src="'+esc(d.logo_url)+'" alt="">';
  if(d.canales.whatsapp)$('#cxLogoPrevWa').innerHTML='<img src="'+esc(d.logo_url)+'" alt="">';
  $('#cxLogoOut').textContent='Listo ✓ '+(d.canales.web?'Ya se ve en el chat de tu web':'Guardada para WhatsApp')+(d.whatsapp?' y en tu WhatsApp (puede tardar unos minutos en actualizarse).':'.');
  if(ME.role!=='velai'&&d.canales.web)brandLogo(d.logo_url,ME.tenantName);
  toast('Logo actualizado')}
 catch(e){$('#cxLogoOut').textContent='Error: '+(TERRS[e.message]||e.message)}};
// Números de aviso (PR3): autoservicio con la guarda del 63031 en el worker.
$('#nfSave').onclick=async()=>{try{
 await api('/api/admin/tenants/'+cxTenant+'/notify',{method:'PATCH',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({team_whatsapp:$('#nfTeam').value.trim(),wa_number:$('#nfWa').value.trim()})});
 toast('Números de aviso guardados ✓');loadConexiones()}
 catch(e){toast('No se pudo guardar: '+(TERRS[e.message]||e.message),false)}};
}
