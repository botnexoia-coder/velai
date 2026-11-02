// Préstamos concedidos: separados de la financiación recibida y del gasto operativo.
import { Hono } from 'hono';
import { HttpError, json, NO_STORE, readJson } from './app.js';
import { esSocio, partesAdmin } from './middleware.js';
import { fail, uuid, socioEmail, texto, entero, fechaCivil, sumarMeses, soloCampos, versionDe, huella, idempotente, auditoria, conceptosGestion, tablaExiste } from './gestion-financiera.js';
export const equipoPrestamos=new Hono();
const BASE='/api/admin/gestion/equipo-prestamos';
const hoy=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Madrid'});
async function abrir(c){const p=partesAdmin(c);if(!esSocio(p.env,p.scope))throw new HttpError(403,'not_authorized');if(!await tablaExiste(p.env,'g_equipo_prestamos'))throw new HttpError(503,'equipo_no_configurado');return {...p,now:new Date().toISOString()};}
async function body(request){const b=await readJson(request,32000);if(!b||typeof b!=='object'||Array.isArray(b))fail('cuerpo_invalido');return b;}
async function fila(env,id){const row=await env.DB.prepare('SELECT * FROM g_equipo_prestamos WHERE id=?').bind(id).first();if(!row)throw new HttpError(404,'not_found');return row;}
async function detalle(env,row){
 const [ps,ds]=await env.DB.batch([env.DB.prepare('SELECT p.*,s.nombre FROM g_equipo_participantes p JOIN fin_socios s ON s.email=p.email WHERE p.prestamo_id=? ORDER BY s.nombre,p.email').bind(row.id),env.DB.prepare('SELECT * FROM g_equipo_devoluciones WHERE prestamo_id=? ORDER BY fecha,created_at,id').bind(row.id)]);
 const devuelto=ds.results.reduce((s,d)=>s+d.importe,0),pendiente=row.importe-devuelto;
 return {item:{...row,fecha_solicitud:row.created_at.slice(0,10),devuelto,pendiente,estado:row.estado==='vigente'?(pendiente===0?'devuelto':row.vencimiento<hoy()?'vencido':'vigente'):row.estado,participantes:ps.results.map(p=>{const pagado=ds.results.filter(d=>d.participante_email===p.email).reduce((s,d)=>s+d.importe,0);return {email:p.email,nombre:p.nombre,importe:p.importe,devuelto:pagado,pendiente:p.importe-pagado};})},pagos:ds.results.map(d=>({...d,estado:'verificado'}))};
}
async function capacidad(env){
 const [cs,k,ps]=await env.DB.batch([env.DB.prepare('SELECT * FROM g_equipo_cuentas ORDER BY nombre,id'),env.DB.prepare('SELECT importe FROM g_equipo_compromisos'),env.DB.prepare('SELECT email FROM fin_socios WHERE activo=1')]);
 const compromisos=k.results[0].importe,cuentas=cs.results.filter(c=>c.conciliada===1).map(c=>({id:c.id,nombre:c.nombre,disponible:c.saldo-c.reserva-c.aprobado}));
 return {disponible:cuentas.reduce((s,c)=>s+c.disponible,0)-compromisos,reserva:cs.results.reduce((s,c)=>s+c.reserva,0),compromisos,cuentas,miembros:ps.results.length};
}
function mapError(e){if(e instanceof HttpError)throw e;for(const code of ['version_conflicto','equipo_estado_invalido','equipo_autoaprobacion','equipo_participantes_invalidos','equipo_limite_persona','equipo_sin_liquidez','equipo_comprobante_requerido','equipo_pago_excesivo','equipo_id_duplicado'])if(e.message?.includes(code))throw new HttpError(409,code);if(e.message?.includes('g_equipo_devoluciones.comprobante_id'))throw new HttpError(409,'equipo_comprobante_usado');throw e;}
async function escribir(p,id,ruta,b,prestamoId,ops){try{return await idempotente(p.env,{id,ruta,huella:await huella(b),actor:p.actor,now:p.now,resultado_id:prestamoId},async()=>[...await ops(),auditoria(p.env,{actor:p.actor,accion:ruta,objeto_tipo:'equipo_prestamo',objeto_id:prestamoId,detalle:{operacion:id},now:p.now})]);}catch(e){mapError(e);}}
async function repetida(p,id,ruta,b){const r=await p.env.DB.prepare('SELECT ruta,huella FROM g_idempotencia WHERE clave=?').bind(id).first();if(!r)return false;if(r.ruta!==ruta||r.huella!==await huella(b))throw new HttpError(409,'idempotencia_conflicto');return true;}
function fechaMovimiento(v){fechaCivil(v);if(v>hoy()||v<'2025-01-01')fail('fecha_invalida');return v;}
async function comprobarDoc(p,id,loan,clase){
 if(!p.env.FINANCE_DOCS)throw new HttpError(503,'documentos_no_configurados');
 const d=await p.env.DB.prepare('SELECT * FROM g_documentos WHERE id=? AND tipo=? AND objeto_id=? AND clase=?').bind(uuid(id,'equipo_comprobante_requerido'),'prestamo',loan,clase).first();
 if(!d)fail('equipo_comprobante_requerido');if(!await p.env.FINANCE_DOCS.get(d.key))throw new HttpError(409,'equipo_comprobante_requerido');return d;
}
function partida(env,l,p,id,fecha,importe,tipo,concepto){
 return env.DB.prepare(`INSERT INTO fin_movimientos(id,tipo,concepto_id,fecha,moneda,importe,nota,created_by,created_at,naturaleza,signo,origen_tipo,origen_id,cuenta_id,equipo_prestamo_id,entidad_id)
 VALUES (?,?,?,?,'EUR',?,?,?,?,'financiacion',1,?,?,?,?,(SELECT entidad_id FROM g_cuentas WHERE id=?))`).bind(crypto.randomUUID(),tipo,concepto,fecha,importe,l.titulo,p.actor,p.now,tipo==='egreso'?'prestamo_desembolso':'prestamo_pago',id,l.cuenta_id,l.id,l.cuenta_id);
}
equipoPrestamos.get(BASE,async c=>{
 const p=await abrir(c),rows=(await p.env.DB.prepare('SELECT * FROM g_equipo_prestamos ORDER BY created_at DESC,id').all()).results;
 const items=await Promise.all(rows.map(async r=>(await detalle(p.env,r)).item)),cap=await capacidad(p.env);
 const vivos=items.filter(l=>['vigente','vencido'].includes(l.estado)),pendiente=vivos.reduce((s,l)=>s+l.pendiente,0);
 const aprobado=items.filter(l=>l.estado==='aprobado').reduce((s,l)=>s+l.importe,0),limite=cap.miembros*50000;
 return json({items,resumen:{limite,pendiente,aprobado,disponible_limite:Math.max(0,limite-pendiente-aprobado),vencido:vivos.filter(l=>l.estado==='vencido').reduce((s,l)=>s+l.pendiente,0),solicitudes:items.filter(l=>l.estado==='solicitado').length},capacidad:cap,storage_ready:!!p.env.FINANCE_DOCS},200,NO_STORE);
});
equipoPrestamos.get(`${BASE}/:id`,async c=>{const p=await abrir(c);return json(await detalle(p.env,await fila(p.env,uuid(c.req.param('id')))),200,NO_STORE);});
equipoPrestamos.post(BASE,async c=>{
 const p=await abrir(c),b=await body(p.request);soloCampos(b,['id','titulo','cuenta_id','importe','vencimiento','participantes','nota']);
 const id=uuid(b.id),ruta='equipo_solicitud';if(await repetida(p,id,ruta,b))return json(await detalle(p.env,await fila(p.env,id)),200,NO_STORE);
 const titulo=texto(b.titulo,160,'nombre_invalido'),cuenta=uuid(b.cuenta_id),importe=entero(b.importe,{min:1,max:5000000}),vencimiento=fechaCivil(b.vencimiento);
 if(vencimiento<hoy()||vencimiento>sumarMeses(hoy(),1))fail('equipo_plazo_invalido');
 if(!Array.isArray(b.participantes)||!b.participantes.length||b.participantes.length>100)fail('equipo_participantes_invalidos');
 const ps=b.participantes.map(x=>{if(!x||typeof x!=='object')fail('equipo_participantes_invalidos');soloCampos(x,['email','importe']);return {email:socioEmail(x.email),importe:entero(x.importe,{min:1,max:50000,code:'equipo_limite_persona'})};});
 if(new Set(ps.map(x=>x.email)).size!==ps.length||ps.reduce((s,x)=>s+x.importe,0)!==importe)fail('equipo_participantes_invalidos');
 if(!await p.env.DB.prepare("SELECT id FROM g_cuentas WHERE id=? AND moneda='EUR'").bind(cuenta).first())fail('cuenta_invalida');
 const nota=texto(b.nota,2000,'nota_invalida',{opcional:true});
 const result=await escribir(p,id,ruta,b,id,async()=>[p.env.DB.prepare(`INSERT INTO g_equipo_prestamos(id,titulo,cuenta_id,importe,vencimiento,nota,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id,titulo,cuenta,importe,vencimiento,nota,p.actor,p.now,p.now),...ps.map(x=>p.env.DB.prepare('INSERT INTO g_equipo_participantes(prestamo_id,email,importe) VALUES (?,?,?)').bind(id,x.email,x.importe))]);
 return json(await detalle(p.env,await fila(p.env,id)),result.repetida?200:201,NO_STORE);
});
for(const accion of ['aprobar','desembolso','devoluciones','cancelar'])equipoPrestamos.post(`${BASE}/:id/${accion}`,async c=>{
 const p=await abrir(c),loanId=uuid(c.req.param('id')),b=await body(p.request),id=uuid(b.id),ruta=`equipo_${accion}/${loanId}`;
 const campos={aprobar:[],desembolso:['fecha','destino_titular','destino_referencia','comprobante_id','transferencia_verificada'],devoluciones:['fecha','importe','participante_email','comprobante_id','verificado'],cancelar:['motivo']};
 soloCampos(b,['id','version',...campos[accion]]);const version=versionDe(b);
 if(await repetida(p,id,ruta,b))return json(await detalle(p.env,await fila(p.env,loanId)),200,NO_STORE);
 const l=await fila(p.env,loanId);if(l.version!==version)throw new HttpError(409,'version_conflicto');
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
