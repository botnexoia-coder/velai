// Préstamos concedidos: separados de la financiación recibida y del gasto operativo.
import { Hono } from 'hono';
import { HttpError, json, NO_STORE, readJson } from './app.js';
import { esSocio, partesAdmin } from './middleware.js';
import { fail, uuid, socioEmail, texto, entero, fechaCivil, sumarMeses, soloCampos, versionDe, huella, idempotente, auditoria, conceptosGestion, tablaExiste } from './gestion-financiera.js';
export const equipoPrestamos=new Hono();
const BASE='/api/admin/gestion/equipo-prestamos';
const hoy=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Madrid'});
// Límite de principal pendiente por persona (céntimos). 0064 sube el CHECK y las guardas SQL a este valor.
export const LIMITE_PERSONA=100000;
// Texto que el libro conserva en la nota de la salida histórica: se ve en «Todos los movimientos».
export const PREFIJO_HISTORICO='Registro histórico pendiente de ratificación · ';
const histDe=async(env,id)=>await tablaExiste(env,'g_equipo_historico')?await env.DB.prepare('SELECT * FROM g_equipo_historico WHERE prestamo_id=?').bind(id).first():null;
async function abrir(c){const p=partesAdmin(c);if(!esSocio(p.env,p.scope))throw new HttpError(403,'not_authorized');if(!await tablaExiste(p.env,'g_equipo_prestamos'))throw new HttpError(503,'equipo_no_configurado');return {...p,now:new Date().toISOString()};}
async function body(request){const b=await readJson(request,32000);if(!b||typeof b!=='object'||Array.isArray(b))fail('cuerpo_invalido');return b;}
async function fila(env,id){const row=await env.DB.prepare('SELECT * FROM g_equipo_prestamos WHERE id=?').bind(id).first();if(!row)throw new HttpError(404,'not_found');return row;}
// Desglose de un histórico ligado a un crédito recibido. La reserva del crédito NO se
// reduce ni se marca pagada: solo se informa de cuánto de su importe está prestado.
// El principal pendiente se cuenta UNA vez; reserva_prestada + resto_libre = pendiente.
// Conservador: las devoluciones se imputan primero al resto libre, de modo que la parte
// tomada de la reserva se da por repuesta en último lugar.
function historicoItem(h,devuelto,pendiente){
 const credito=h.credito_id?{id:h.credito_id,cuota:h.credito_cuota,importe_cuota:h.importe_cuota,importe_adicional:h.importe_adicional,fecha_cuota_proyectada:h.fecha_cuota_proyectada,fecha_confirmada:false}:null;
 const entregado=h.estado==='confirmado',resto=credito&&entregado?Math.max(0,h.importe_adicional-devuelto):null;
 return {origen:'regularizacion_historica',estado:h.estado,deudor_declarado:h.deudor_declarado,destinatario:h.destinatario,motivo_excepcion:h.motivo_excepcion,ratificacion:h.ratificacion,ratificado_por:h.ratificado_por,ratificado_at:h.ratificado_at,desvios:JSON.parse(h.desvios||'[]'),confirmado_por:h.confirmado_por,confirmado_at:h.confirmado_at,credito,reserva_prestada:resto==null?null:Math.max(0,pendiente-resto),resto_libre:resto};
}
async function detalle(env,row,conHistorico){
 const hay=conHistorico??await tablaExiste(env,'g_equipo_historico');
 const [ps,ds,hs]=await env.DB.batch([env.DB.prepare('SELECT p.*,s.nombre FROM g_equipo_participantes p JOIN fin_socios s ON s.email=p.email WHERE p.prestamo_id=? ORDER BY s.nombre,p.email').bind(row.id),env.DB.prepare('SELECT * FROM g_equipo_devoluciones WHERE prestamo_id=? ORDER BY fecha,created_at,id').bind(row.id),...(hay?[env.DB.prepare('SELECT * FROM g_equipo_historico WHERE prestamo_id=?').bind(row.id)]:[])]);
 const devuelto=ds.results.reduce((s,d)=>s+d.importe,0),pendiente=row.importe-devuelto,h=hs?.results[0]||null;
 const estado=h&&h.estado==='borrador'&&row.estado==='solicitado'?'borrador_historico':row.estado==='vigente'?(pendiente===0?'devuelto':row.vencimiento<hoy()?'vencido':'vigente'):row.estado;
 return {item:{...row,fecha_solicitud:row.created_at.slice(0,10),devuelto,pendiente,estado,historico:h?historicoItem(h,devuelto,pendiente):null,participantes:ps.results.map(p=>{const pagado=ds.results.filter(d=>d.participante_email===p.email).reduce((s,d)=>s+d.importe,0);return {email:p.email,nombre:p.nombre,importe:p.importe,devuelto:pagado,pendiente:p.importe-pagado};})},pagos:ds.results.map(d=>({...d,estado:'verificado'}))};
}
async function capacidad(env){
 const [cs,k,ps]=await env.DB.batch([env.DB.prepare('SELECT * FROM g_equipo_cuentas ORDER BY nombre,id'),env.DB.prepare('SELECT importe FROM g_equipo_compromisos'),env.DB.prepare('SELECT email FROM fin_socios WHERE activo=1')]);
 const compromisos=k.results[0].importe,cuentas=cs.results.filter(c=>c.conciliada===1).map(c=>({id:c.id,nombre:c.nombre,disponible:c.saldo-c.reserva-c.aprobado}));
 return {disponible:cuentas.reduce((s,c)=>s+c.disponible,0)-compromisos,reserva:cs.results.reduce((s,c)=>s+c.reserva,0),compromisos,cuentas,miembros:ps.results.length};
}
function mapError(e){if(e instanceof HttpError)throw e;for(const code of ['version_conflicto','equipo_estado_invalido','equipo_autoaprobacion','equipo_participantes_invalidos','equipo_limite_persona','equipo_sin_liquidez','equipo_comprobante_requerido','equipo_pago_excesivo','equipo_id_duplicado','equipo_historico_invalido','equipo_historico_incompleto','equipo_reverso_requerido','equipo_inmutable'])if(e.message?.includes(code))throw new HttpError(409,code);if(e.message?.includes('g_equipo_devoluciones.comprobante_id'))throw new HttpError(409,'equipo_comprobante_usado');if(e.message?.includes('fin_movimientos.equipo_prestamo_id'))throw new HttpError(409,'equipo_estado_invalido');throw e;}
async function escribir(p,id,ruta,b,prestamoId,ops,extra={}){try{return await idempotente(p.env,{id,ruta,huella:await huella(b),actor:p.actor,now:p.now,resultado_id:prestamoId},async()=>[...await ops(),auditoria(p.env,{actor:p.actor,accion:ruta,objeto_tipo:'equipo_prestamo',objeto_id:prestamoId,detalle:{operacion:id,...extra},now:p.now})]);}catch(e){mapError(e);}}
async function repetida(p,id,ruta,b){const r=await p.env.DB.prepare('SELECT ruta,huella FROM g_idempotencia WHERE clave=?').bind(id).first();if(!r)return false;if(r.ruta!==ruta||r.huella!==await huella(b))throw new HttpError(409,'idempotencia_conflicto');return true;}
function fechaMovimiento(v){fechaCivil(v);if(v>hoy()||v<'2025-01-01')fail('fecha_invalida');return v;}
async function comprobarDoc(p,id,loan,clase){
 if(!p.env.FINANCE_DOCS)throw new HttpError(503,'documentos_no_configurados');
 const d=await p.env.DB.prepare('SELECT * FROM g_documentos WHERE id=? AND tipo=? AND objeto_id=? AND clase=?').bind(uuid(id,'equipo_comprobante_requerido'),'prestamo',loan,clase).first();
 if(!d)fail('equipo_comprobante_requerido');if(!await p.env.FINANCE_DOCS.get(d.key))throw new HttpError(409,'equipo_comprobante_requerido');return d;
}
function partida(env,l,p,id,fecha,importe,tipo,concepto,nota=l.titulo){
 return env.DB.prepare(`INSERT INTO fin_movimientos(id,tipo,concepto_id,fecha,moneda,importe,nota,created_by,created_at,naturaleza,signo,origen_tipo,origen_id,cuenta_id,equipo_prestamo_id,entidad_id)
 VALUES (?,?,?,?,'EUR',?,?,?,?,'financiacion',1,?,?,?,?,(SELECT entidad_id FROM g_cuentas WHERE id=?))`).bind(crypto.randomUUID(),tipo,concepto,fecha,importe,nota,p.actor,p.now,tipo==='egreso'?'prestamo_desembolso':'prestamo_pago',id,l.cuenta_id,l.id,l.cuenta_id);
}
equipoPrestamos.get(BASE,async c=>{
 const p=await abrir(c),rows=(await p.env.DB.prepare('SELECT * FROM g_equipo_prestamos ORDER BY created_at DESC,id').all()).results;
 const hay=await tablaExiste(p.env,'g_equipo_historico'),items=await Promise.all(rows.map(async r=>(await detalle(p.env,r,hay)).item)),cap=await capacidad(p.env);
 const vivos=items.filter(l=>['vigente','vencido'].includes(l.estado)),pendiente=vivos.reduce((s,l)=>s+l.pendiente,0);
 const aprobado=items.filter(l=>l.estado==='aprobado').reduce((s,l)=>s+l.importe,0),limite=cap.miembros*LIMITE_PERSONA;
 // Los históricos ya entregados cuentan en `pendiente` (principal único). Este bloque solo lo DESGLOSA.
 const hist=vivos.filter(l=>l.historico);
 const historicos={pendiente:hist.reduce((s,l)=>s+l.pendiente,0),reserva_prestada:hist.reduce((s,l)=>s+(l.historico.reserva_prestada||0),0),resto_libre:hist.reduce((s,l)=>s+(l.historico.resto_libre||0),0),pendiente_ratificacion:hist.filter(l=>l.historico.ratificacion==='pendiente').length,borradores:items.filter(l=>l.estado==='borrador_historico').length};
 return json({items,resumen:{limite,limite_persona:LIMITE_PERSONA,pendiente,aprobado,disponible_limite:Math.max(0,limite-pendiente-aprobado),vencido:vivos.filter(l=>l.estado==='vencido').reduce((s,l)=>s+l.pendiente,0),solicitudes:items.filter(l=>l.estado==='solicitado').length,historicos},capacidad:cap,storage_ready:!!p.env.FINANCE_DOCS},200,NO_STORE);
});
equipoPrestamos.get(`${BASE}/:id`,async c=>{const p=await abrir(c);return json(await detalle(p.env,await fila(p.env,uuid(c.req.param('id')))),200,NO_STORE);});
equipoPrestamos.post(BASE,async c=>{
 const p=await abrir(c),b=await body(p.request);soloCampos(b,['id','titulo','cuenta_id','importe','vencimiento','participantes','nota']);
 const id=uuid(b.id),ruta='equipo_solicitud';if(await repetida(p,id,ruta,b))return json(await detalle(p.env,await fila(p.env,id)),200,NO_STORE);
 const titulo=texto(b.titulo,160,'nombre_invalido'),cuenta=uuid(b.cuenta_id),importe=entero(b.importe,{min:1,max:5000000}),vencimiento=fechaCivil(b.vencimiento);
 if(vencimiento<hoy()||vencimiento>sumarMeses(hoy(),1))fail('equipo_plazo_invalido');
 if(!Array.isArray(b.participantes)||!b.participantes.length||b.participantes.length>100)fail('equipo_participantes_invalidos');
 const ps=b.participantes.map(x=>{if(!x||typeof x!=='object')fail('equipo_participantes_invalidos');soloCampos(x,['email','importe']);return {email:socioEmail(x.email),importe:entero(x.importe,{min:1,max:LIMITE_PERSONA,code:'equipo_limite_persona'})};});
 if(new Set(ps.map(x=>x.email)).size!==ps.length||ps.reduce((s,x)=>s+x.importe,0)!==importe)fail('equipo_participantes_invalidos');
 if(!await p.env.DB.prepare("SELECT id FROM g_cuentas WHERE id=? AND moneda='EUR'").bind(cuenta).first())fail('cuenta_invalida');
 const nota=texto(b.nota,2000,'nota_invalida',{opcional:true});
 const result=await escribir(p,id,ruta,b,id,async()=>[p.env.DB.prepare(`INSERT INTO g_equipo_prestamos(id,titulo,cuenta_id,importe,vencimiento,nota,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id,titulo,cuenta,importe,vencimiento,nota,p.actor,p.now,p.now),...ps.map(x=>p.env.DB.prepare('INSERT INTO g_equipo_participantes(prestamo_id,email,importe) VALUES (?,?,?)').bind(id,x.email,x.importe))]);
 return json(await detalle(p.env,await fila(p.env,id)),result.repetida?200:201,NO_STORE);
});
// ── Regularización histórica: un préstamo cuyo dinero YA salió ───────────────
// Separada de solicitar/aprobar/desembolsar. El alta crea un BORRADOR sin efecto
// financiero (no hay movimiento, ni exposición, ni reserva de capacidad). La
// confirmación registra UNA salida de principal ya ocurrida, con comprobante real. No
// finge aprobación independiente (aprobado_por queda NULL) ni conciliación bancaria:
// la ratificación queda «pendiente». Solo esta vía admite plazo > 1 mes y liquidez
// insuficiente, y deja los desvíos reconocidos en el registro y en la auditoría.
equipoPrestamos.post(`${BASE}/historicos`,async c=>{
 const p=await abrir(c);if(!await tablaExiste(p.env,'g_equipo_historico'))throw new HttpError(503,'equipo_no_configurado');
 const b=await body(p.request);soloCampos(b,['id','titulo','cuenta_id','importe','vencimiento','participantes','nota','deudor_declarado','destinatario','motivo_excepcion','credito']);
 const id=uuid(b.id),ruta='equipo_historico_alta';if(await repetida(p,id,ruta,b))return json(await detalle(p.env,await fila(p.env,id)),200,NO_STORE);
 const titulo=texto(b.titulo,160,'nombre_invalido'),cuenta=uuid(b.cuenta_id),importe=entero(b.importe,{min:1,max:LIMITE_PERSONA*100}),vencimiento=fechaCivil(b.vencimiento);
 const nota=texto(b.nota,2000,'nota_invalida'),deudor=texto(b.deudor_declarado,160,'equipo_deudor_requerido'),destinatario=texto(b.destinatario,160,'equipo_destinatario_requerido'),motivo=texto(b.motivo_excepcion,500,'equipo_motivo_requerido');
 if(!Array.isArray(b.participantes)||!b.participantes.length||b.participantes.length>100)fail('equipo_participantes_invalidos');
 const ps=b.participantes.map(x=>{if(!x||typeof x!=='object')fail('equipo_participantes_invalidos');soloCampos(x,['email','importe']);return {email:socioEmail(x.email),importe:entero(x.importe,{min:1,max:LIMITE_PERSONA,code:'equipo_limite_persona'})};});
 if(new Set(ps.map(x=>x.email)).size!==ps.length||ps.reduce((s,x)=>s+x.importe,0)!==importe)fail('equipo_participantes_invalidos');
 if(!await p.env.DB.prepare("SELECT id FROM g_cuentas WHERE id=? AND moneda='EUR'").bind(cuenta).first())fail('cuenta_invalida');
 let cr=null;
 if(b.credito!=null){
  if(typeof b.credito!=='object'||Array.isArray(b.credito))fail('equipo_credito_invalido');soloCampos(b.credito,['id','cuota','importe_cuota','importe_adicional','fecha_cuota_proyectada']);
  const credito=await p.env.DB.prepare('SELECT * FROM g_prestamos WHERE id=?').bind(uuid(b.credito.id,'equipo_credito_invalido')).first();
  // El crédito debe estar recibido y en la MISMA cuenta que la salida: solo así «cuota reservada» significa algo.
  if(!credito||!(credito.desembolsado>0)||credito.cuenta_id!==cuenta)fail('equipo_credito_invalido');
  const cuota=entero(b.credito.cuota,{min:1,max:credito.meses,code:'equipo_cuota_invalida'});if(cuota>credito.reserva_cuotas)fail('equipo_cuota_invalida');
  // El desglose parte del importe REAL de la cuota del crédito, no de un redondeo al importe prestado.
  const importeCuota=entero(b.credito.importe_cuota,{min:1,code:'equipo_desglose_invalido'}),adicional=entero(b.credito.importe_adicional,{min:0,code:'equipo_desglose_invalido'});
  if(importeCuota!==credito.cuota||importeCuota+adicional!==importe)fail('equipo_desglose_invalido');
  const proyectada=fechaCivil(b.credito.fecha_cuota_proyectada);if(vencimiento>=proyectada)fail('equipo_historico_plazo_invalido');
  cr={id:credito.id,cuota,importeCuota,adicional,proyectada};
 }
 const result=await escribir(p,id,ruta,b,id,async()=>[
  p.env.DB.prepare(`INSERT INTO g_equipo_prestamos(id,titulo,cuenta_id,importe,vencimiento,nota,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id,titulo,cuenta,importe,vencimiento,nota,p.actor,p.now,p.now),
  p.env.DB.prepare(`INSERT INTO g_equipo_historico(prestamo_id,deudor_declarado,destinatario,motivo_excepcion,credito_id,credito_cuota,importe_cuota,importe_adicional,fecha_cuota_proyectada,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id,deudor,destinatario,motivo,cr?.id??null,cr?.cuota??null,cr?.importeCuota??null,cr?.adicional??null,cr?.proyectada??null,p.actor,p.now),
  ...ps.map(x=>p.env.DB.prepare('INSERT INTO g_equipo_participantes(prestamo_id,email,importe) VALUES (?,?,?)').bind(id,x.email,x.importe))],{modalidad:'regularizacion_historica',estado:'borrador',importe});
 return json(await detalle(p.env,await fila(p.env,id)),result.repetida?200:201,NO_STORE);
});
equipoPrestamos.post(`${BASE}/:id/historico/confirmar`,async c=>{
 const p=await abrir(c),loanId=uuid(c.req.param('id')),b=await body(p.request),id=uuid(b.id),ruta=`equipo_historico_confirmar/${loanId}`;
 soloCampos(b,['id','version','fecha','destino_titular','destino_referencia','comprobante_id','comprobante_revisado','ya_ejecutada']);const version=versionDe(b);
 if(await repetida(p,id,ruta,b))return json(await detalle(p.env,await fila(p.env,loanId)),200,NO_STORE);
 const l=await fila(p.env,loanId),h=await histDe(p.env,loanId);if(!h)throw new HttpError(404,'not_found');
 if(l.version!==version)throw new HttpError(409,'version_conflicto');
 // Ya confirmado, cancelado o entregado por otra vía: no se vuelve a registrar la salida.
 if(l.estado!=='solicitado'||h.estado!=='borrador')throw new HttpError(409,'equipo_estado_invalido');
 if(b.ya_ejecutada!==true||b.comprobante_revisado!==true)fail('equipo_historico_confirmacion_requerida');
 const fecha=fechaMovimiento(b.fecha),titular=texto(b.destino_titular,160,'equipo_destino_requerido'),referencia=texto(b.destino_referencia,120,'equipo_destino_requerido');
 if(l.vencimiento<fecha||(h.fecha_cuota_proyectada&&l.vencimiento>=h.fecha_cuota_proyectada))fail('equipo_historico_plazo_invalido');
 const cuenta=await p.env.DB.prepare('SELECT fecha_saldo FROM g_cuentas WHERE id=?').bind(l.cuenta_id).first();
 if(cuenta.fecha_saldo&&fecha<=cuenta.fecha_saldo)fail('equipo_fecha_anterior_saldo');
 const doc=await comprobarDoc(p,b.comprobante_id,l.id,'entrega'),k=await conceptosGestion(p.env),cap=await capacidad(p.env),cc=cap.cuentas.find(x=>x.id===l.cuenta_id);
 // Desvíos de la política ordinaria que esta operación YA ejecutada reconoce (no se «arreglan»).
 const desvios=['sin_aprobacion_independiente',...(l.vencimiento>sumarMeses(fecha,1)?['plazo_superior_a_un_mes']:[]),...(!cc?['cuenta_no_conciliada']:(cc.disponible<l.importe||cap.disponible<l.importe)?['liquidez_insuficiente']:[]),...(h.credito_id?['fondos_de_cuota_prestados']:[])];
 const ops=()=>[
  p.env.DB.prepare("UPDATE g_equipo_historico SET estado='confirmado',desvios=?,confirmado_por=?,confirmado_at=? WHERE prestamo_id=? AND estado='borrador'").bind(JSON.stringify(desvios),p.actor,p.now,l.id),
  p.env.DB.prepare("UPDATE g_equipo_prestamos SET estado='vigente',fecha_desembolso=?,destino_titular=?,destino_referencia=?,comprobante_entrega=?,version=?,updated_at=? WHERE id=?").bind(fecha,titular,referencia,doc.id,version+1,p.now,l.id),
  partida(p.env,l,p,id,fecha,l.importe,'egreso',k.g_equipo_entrega,`${PREFIJO_HISTORICO}${l.titulo}`)];
 await escribir(p,id,ruta,b,l.id,ops,{modalidad:'regularizacion_historica',fecha,importe:l.importe,desvios,ratificacion:'pendiente'});
 return json(await detalle(p.env,await fila(p.env,l.id)),200,NO_STORE);
});
for(const accion of ['aprobar','desembolso','devoluciones','cancelar'])equipoPrestamos.post(`${BASE}/:id/${accion}`,async c=>{
 const p=await abrir(c),loanId=uuid(c.req.param('id')),b=await body(p.request),id=uuid(b.id),ruta=`equipo_${accion}/${loanId}`;
 const campos={aprobar:[],desembolso:['fecha','destino_titular','destino_referencia','comprobante_id','transferencia_verificada'],devoluciones:['fecha','importe','participante_email','comprobante_id','verificado'],cancelar:['motivo']};
 soloCampos(b,['id','version',...campos[accion]]);const version=versionDe(b);
 if(await repetida(p,id,ruta,b))return json(await detalle(p.env,await fila(p.env,loanId)),200,NO_STORE);
 const l=await fila(p.env,loanId);if(l.version!==version)throw new HttpError(409,'version_conflicto');
 // Un histórico tiene su propia ruta: nunca se aprueba ni se desembolsa de nuevo, y una vez entregado no se cancela sin reverso.
 if(['aprobar','desembolso','cancelar'].includes(accion)&&await histDe(p.env,l.id)){if(accion!=='cancelar')throw new HttpError(409,'equipo_historico_ruta_propia');if(l.estado!=='solicitado')throw new HttpError(409,'equipo_reverso_requerido');}
 const update=(set,args=[])=>p.env.DB.prepare(`UPDATE g_equipo_prestamos SET ${set},version=?,updated_at=? WHERE id=?`).bind(...args,version+1,p.now,l.id);
 let ops;
 if(accion==='aprobar'){
  if(l.estado!=='solicitado')fail('equipo_estado_invalido');if(l.vencimiento<hoy())fail('equipo_plazo_invalido');
  ops=()=>[update("estado='aprobado',aprobado_por=?",[p.actor])];
 }else if(accion==='cancelar'){
  if(!['solicitado','aprobado'].includes(l.estado))fail('equipo_estado_invalido');const motivo=texto(b.motivo,500,'motivo_requerido');
  ops=()=>[update("estado='cancelado',nota=?",[`${l.nota||''}\nCancelación: ${motivo}`.trim()])];
 }else if(accion==='desembolso'){
  if(l.estado!=='aprobado')fail('equipo_estado_invalido');const fecha=fechaMovimiento(b.fecha);
  const cuenta=await p.env.DB.prepare('SELECT fecha_saldo FROM g_cuentas WHERE id=?').bind(l.cuenta_id).first();
  if(cuenta.fecha_saldo&&fecha<=cuenta.fecha_saldo)fail('equipo_fecha_anterior_saldo');
  if(fecha<l.created_at.slice(0,10)||l.vencimiento<fecha||l.vencimiento>sumarMeses(fecha,1))fail('equipo_plazo_invalido');
  if(b.transferencia_verificada!==true)fail('equipo_transferencia_no_verificada');
  const titular=texto(b.destino_titular,160,'equipo_destino_requerido'),referencia=texto(b.destino_referencia,120,'equipo_destino_requerido');
  const doc=await comprobarDoc(p,b.comprobante_id,l.id,'entrega'),k=await conceptosGestion(p.env);
  ops=()=>[update("estado='vigente',fecha_desembolso=?,destino_titular=?,destino_referencia=?,comprobante_entrega=?",[fecha,titular,referencia,doc.id]),partida(p.env,l,p,id,fecha,l.importe,'egreso',k.g_equipo_entrega)];
 }else{
  if(l.estado!=='vigente')fail('equipo_estado_invalido');if(b.verificado!==true)fail('equipo_transferencia_no_verificada');
  const fecha=fechaMovimiento(b.fecha),importe=entero(b.importe,{min:1}),email=socioEmail(b.participante_email),doc=await comprobarDoc(p,b.comprobante_id,l.id,'devolucion'),k=await conceptosGestion(p.env);
  if(fecha<l.fecha_desembolso)fail('fecha_invalida');
  const cuenta=await p.env.DB.prepare('SELECT fecha_saldo FROM g_cuentas WHERE id=?').bind(l.cuenta_id).first();if(cuenta.fecha_saldo&&fecha<=cuenta.fecha_saldo)fail('equipo_fecha_anterior_saldo');
  ops=()=>[update('estado=estado'),p.env.DB.prepare('INSERT INTO g_equipo_devoluciones(id,prestamo_id,participante_email,importe,fecha,comprobante_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,l.id,email,importe,fecha,doc.id,p.actor,p.now),partida(p.env,l,p,id,fecha,importe,'ingreso',k.g_equipo_devolucion)];
 }
 await escribir(p,id,ruta,b,l.id,ops);return json(await detalle(p.env,await fila(p.env,l.id)),200,NO_STORE);
});
