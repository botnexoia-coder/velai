import { useState } from 'react';
import { MOBILE_PREVIEW } from '../../mobilePreview';
import { confirmar } from '../../components/Confirmar';
import { finDinero } from '../../lib/format';
import { Card, Notice, ErrorBox, FormModal, useGestion, useGuardar, amount, str, opt, type Field, type Compra } from './shared';
import './retiros.css';
import {
 clasificaciones, estadosCoste, estadosOrigen, evidencias, reembolsos, acciones, textoMotivo,
 type CandidatosRetiro, type DetalleRetiro, type FuenteRetiro, type ListaRetiros, type LoteRetiro, type TotalesRetiro, type UsoRetiro,
} from './retiros';

type Moneda='EUR'|'COP';
const dinero=(n:number,m:Moneda='EUR')=>finDinero(n,m);
const dia=(d?:string|null)=>d?d.split('-').reverse().join('/'):'Fecha pendiente';
const aTexto=(n:number|null|undefined,m:Moneda)=>n==null?'':m==='EUR'?(n/100).toFixed(2).replace('.',','):String(n);
// Un campo de importe vacío es "no se sabe", nunca 0.
const importeOpt=(d:FormData,k:string,m:Moneda)=>str(d,k)===''?null:amount(d,k,m);
const opciones=(pares:[string,string][])=>pares.map(([value,label])=>({value,label}));
const EVIDENCIA_FUENTE=opciones([['','Sin evidencia'],['extracto','Extracto del banco'],['captura','Captura'],['declaracion','Declaración de una persona']]);
const EVIDENCIA_USO=opciones([['ninguna','Sin documento'],['extracto','Extracto'],['captura','Captura'],['documento','Documento'],['declaracion','Declaración de una persona']]);
const REEMBOLSO=opciones([['','Sin indicar'],['no_reembolsable','No reembolsable'],['reembolsable','Reembolsable (solo informa)']]);

export function ConciliacionRetiros(){
 const lista=useGestion<ListaRetiros>('retiros');
 const [selected,setSelected]=useState<string|null>(null),[crear,setCrear]=useState(false);
 const save=useGuardar();
 const eur=lista.data?.totales.EUR;
 return <div className="gestion ret">
  <Card title="Conciliación de retiros" action={!MOBILE_PREVIEW?<button className="btn" type="button" onClick={()=>setCrear(true)}>Nuevo lote</button>:undefined}>
   <p>Junta las salidas del banco de un mismo retiro y lo que se hizo con el dinero. Aquí solo se enlazan operaciones que ya existen: no se crea, edita ni borra ningún movimiento ni pago, y un importe nunca se cuenta como retiro y como gasto a la vez.</p>
   <ErrorBox error={lista.error}/>{lista.isPending?<p role="status">Cargando lotes…</p>:null}
   {eur?<p className="ret-summary"><strong>{eur.lotes_abiertos}</strong> de {eur.lotes} {eur.lotes===1?'lote sigue abierto':'lotes siguen abiertos'} · en total quedan {dinero(eur.diferencia_por_explicar)} por explicar</p>:null}
   {lista.data?.items.length?<div className="g-table"><table><thead><tr><th>Lote</th><th>Salidas del banco</th><th>Confirmado en cajero</th><th>Usos</th><th>Por explicar</th><th>Estado</th></tr></thead><tbody>
    {lista.data.items.map(l=><tr key={l.id} className={selected===l.id?'ret-selected':''}>
     <td><button className="fin-row-open" type="button" onClick={()=>setSelected(l.id)}>{l.nombre}</button><small>{l.fuentes_count} salidas · {l.usos_count} usos</small></td>
     <td>{dinero(l.totales.total_salidas,l.moneda)}</td><td>{dinero(l.totales.efectivo_confirmado,l.moneda)}</td><td>{dinero(l.totales.usos_total,l.moneda)}</td>
     <td>{dinero(l.totales.diferencia_por_explicar,l.moneda)}</td>
     <td><span className={`g-badge ${l.estado==='abierta'?'warn':'done'}`}>{l.estado==='abierta'?`Abierta · ${l.motivos.length} ${l.motivos.length===1?'pendiente':'pendientes'}`:'Sin pendientes calculados'}</span></td>
    </tr>)}
   </tbody></table></div>:lista.data?<p className="g-empty">Todavía no hay lotes. Crea uno para agrupar las salidas de un mismo retiro.</p>:null}
  </Card>
  {selected?<DetalleLote id={selected} close={()=>setSelected(null)}/>:null}
  {crear?<FormModal title="Nuevo lote de retiros" close={()=>setCrear(false)} fields={[{name:'nombre',label:'Nombre del lote',required:true,help:'Por ejemplo, el retiro de una semana.'},{name:'nota',label:'Nota',type:'textarea'}]}
   submit={async(d,id)=>{await save.mutateAsync({path:'retiros',body:{id,nombre:str(d,'nombre'),nota:opt(d,'nota'),moneda:'EUR'}});}}><Notice>Crear un lote no mueve dinero ni registra nada en el libro.</Notice></FormModal>:null}
 </div>;
}

type Modal=null|{k:'lote'}|{k:'fuente'}|{k:'fuente_edit';f:FuenteRetiro}|{k:'uso_pago'}|{k:'uso_decl'}|{k:'uso_edit';u:UsoRetiro};

function DetalleLote({id,close}:{id:string;close:()=>void}){
 const detalle=useGestion<DetalleRetiro>(`retiros/${id}`);
 const save=useGuardar();
 const [modal,setModal]=useState<Modal>(null),[error,setError]=useState<unknown>(null);
 const d=detalle.data;
 const moneda:Moneda=d?.item.moneda??'EUR';
 const m=(n:number)=>dinero(n,moneda);
 async function cambiar(path:string,body:Record<string,unknown>,cuerpo?:{titulo:string;cuerpo:string;accion:string}){
  setError(null);
  try{
   if(cuerpo&&!await confirmar({...cuerpo,peligro:false}))return;
   await save.mutateAsync({path,method:'PATCH',body});
  }catch(e){setError(e);}
 }
 return <Card title={d?.item.nombre||'Detalle del lote'} action={<div className="g-inline">{d&&!MOBILE_PREVIEW?<button className="btn alt" type="button" onClick={()=>setModal({k:'lote'})}>Editar nombre y nota</button>:null}<button className="btn alt" type="button" onClick={close}>Cerrar detalle</button></div>}>
  <ErrorBox error={detalle.error||error}/>{detalle.isPending?<p role="status">Cargando detalle…</p>:null}
  {d?<>
   {d.item.nota?<p>{d.item.nota}</p>:null}
   <p><span className={`g-badge ${d.estado==='abierta'?'warn':'done'}`}>{d.estado==='abierta'?'Abierta':'Sin pendientes calculados'}</span> <small className="muted">El estado se calcula con los registros: no se puede marcar como cerrado a mano.</small></p>
   <Metricas t={d.totales} m={moneda}/>
   {d.motivos.length?<div className="ret-motivos"><h3>Qué queda por aclarar</h3><ul>{d.motivos.map(x=><li key={x.codigo}>{textoMotivo(x,m)}</li>)}</ul></div>:<p className="g-empty">No queda nada pendiente según los registros enlazados.</p>}

   <div className="g-card-head"><h3>Salidas del banco</h3>{!MOBILE_PREVIEW?<button className="btn alt" type="button" onClick={()=>setModal({k:'fuente'})}>Enlazar salida</button>:null}</div>
   {d.fuentes.length?<div className="g-table"><table><thead><tr><th>Operación original</th><th>Clasificación</th><th>Importe</th><th>Comisión</th><th>Evidencia</th><th>En el libro</th>{!MOBILE_PREVIEW?<th>Acciones</th>:null}</tr></thead><tbody>
    {d.fuentes.map(f=><tr key={f.id} className={f.estado==='retirada'||f.origen.estado==='anulado'?'ret-muted':''}>
     <td><strong>{f.origen_tipo==='traspaso'?'Traspaso':'Movimiento'} · {dia(f.origen.fecha)}</strong>{f.origen.nota?<small>{f.origen.nota}</small>:null}
      {f.origen.cuenta_origen?<small>Cuentas del libro: {f.origen.cuenta_origen}{f.origen.cuenta_destino?` → ${f.origen.cuenta_destino}`:''}</small>:null}<small>Ref. {f.origen_id.slice(0,8)}</small>{f.nota?<small>Nota: {f.nota}</small>:null}</td>
     <td>{clasificaciones[f.clasificacion]}{f.estado==='retirada'?<small>Retirada del control</small>:null}</td>
     <td>{dinero(f.importe,f.moneda)}</td>
     <td>{f.comision==null?'Desconocida':dinero(f.comision,f.moneda)}<small>{estadosCoste[f.coste_estado]}{f.coste_bancario_total!=null?` · coste bancario total ${dinero(f.coste_bancario_total,f.moneda)}`:''}</small></td>
     <td>{f.evidencia?evidencias[f.evidencia]:'Sin evidencia'}{f.declarado_por?<small>Declara: {f.declarado_por}</small>:null}</td>
     <td><span className={`g-badge ${f.origen.estado==='activo'?'done':'warn'}`}>{estadosOrigen[f.origen.estado]}</span></td>
     {!MOBILE_PREVIEW?<td><div className="g-inline"><button className="btn alt" type="button" onClick={()=>setModal({k:'fuente_edit',f})}>Editar</button>
      <button className="btn alt" type="button" onClick={()=>void cambiar(`retiros/${d.item.id}/fuentes/${f.id}`,{version:f.version,estado:f.estado==='activa'?'retirada':'activa'},f.estado==='activa'?{titulo:'¿Retirar esta salida del lote?',cuerpo:'Solo se quita del control: la operación original no cambia y el vínculo queda guardado.',accion:'Retirar'}:undefined)}>{f.estado==='activa'?'Retirar':'Volver a enlazar'}</button></div></td>:null}
    </tr>)}
   </tbody></table></div>:<p className="g-empty">Todavía no hay salidas enlazadas.</p>}

   <div className="g-card-head"><h3>Qué se hizo con el efectivo</h3>{!MOBILE_PREVIEW?<div className="g-inline"><button className="btn alt" type="button" onClick={()=>setModal({k:'uso_pago'})}>Enlazar pago registrado</button><button className="btn alt" type="button" onClick={()=>setModal({k:'uso_decl'})}>Declarar un uso</button></div>:null}</div>
   {d.usos.length?<div className="g-table"><table><thead><tr><th>Uso</th><th>Tipo</th><th>Fecha</th><th>Efectivo común</th><th>Aporte personal</th><th>Documento</th><th>Estado</th>{!MOBILE_PREVIEW?<th>Acciones</th>:null}</tr></thead><tbody>
    {d.usos.map(u=><tr key={u.id} className={u.estado==='anulado'||(u.tipo==='pago_existente'&&!u.pago_vigente)?'ret-muted':''}>
     <td><strong>{u.concepto}</strong>{u.compra?<small>Compra: {u.compra.concepto}</small>:null}{u.declarado_por?<small>Declara: {u.declarado_por}</small>:null}{u.nota?<small>Nota: {u.nota}</small>:null}</td>
     <td>{u.tipo==='pago_existente'?'Pago registrado':'Declarado'}{u.pago?.cuenta_nombre?<small>{u.pago.cuenta_nombre}</small>:null}</td>
     <td>{dia(u.fecha)}</td><td>{dinero(u.importe_efectivo,moneda)}</td>
     <td>{u.aporte_personal?dinero(u.aporte_personal,moneda):'—'}{u.aporte_personal?<small>{u.aporte_reembolso?reembolsos[u.aporte_reembolso]:'Sin indicar si se reembolsa'}</small>:null}</td>
     <td>{u.sin_documento?'Sin documento':evidencias[u.evidencia]||'Con documento'}</td>
     <td>{u.estado==='anulado'?<span className="g-badge">Anulado</span>:u.tipo==='pago_existente'&&!u.pago_vigente?<span className="g-badge warn">Pago revertido</span>:<span className="g-badge done">Activo</span>}</td>
     {!MOBILE_PREVIEW?<td><div className="g-inline"><button className="btn alt" type="button" onClick={()=>setModal({k:'uso_edit',u})}>Editar</button>
      <button className="btn alt" type="button" onClick={()=>void cambiar(`retiros/${d.item.id}/usos/${u.id}`,{version:u.version,estado:u.estado==='activo'?'anulado':'activo'},u.estado==='activo'?{titulo:'¿Anular este uso?',cuerpo:'Solo se anula en el control y se puede reactivar. El pago y el libro no cambian.',accion:'Anular'}:undefined)}>{u.estado==='activo'?'Anular':'Reactivar'}</button></div></td>:null}
    </tr>)}
   </tbody></table></div>:<p className="g-empty">Todavía no hay usos. Enlaza un pago ya registrado o declara lo que se pagó, aunque aún no tenga fecha ni documento.</p>}

   {d.historial?.length?<details className="ret-historial"><summary>Historial de cambios ({d.historial.length})</summary><ul>{d.historial.map(h=><li key={h.id}>{h.fecha.slice(0,16).replace('T',' ')} · {h.actor} · {acciones[h.accion]||h.accion}</li>)}</ul></details>:null}
  </>:null}
  {d&&modal?.k==='lote'?<FormModal title="Editar lote" close={()=>setModal(null)} fields={[{name:'nombre',label:'Nombre del lote',value:d.item.nombre,required:true},{name:'nota',label:'Nota',type:'textarea',value:d.item.nota}]}
   submit={async(f)=>{await save.mutateAsync({path:`retiros/${d.item.id}`,method:'PATCH',body:{version:d.item.version,nombre:str(f,'nombre'),nota:opt(f,'nota')}});}}><Notice>Los cambios quedan en el historial con quién y cuándo.</Notice></FormModal>:null}
  {d&&modal?.k==='fuente'?<FuenteForm lote={d.item} close={()=>setModal(null)}/>:null}
  {d&&modal?.k==='fuente_edit'?<FuenteForm lote={d.item} fuente={modal.f} close={()=>setModal(null)}/>:null}
  {d&&modal?.k==='uso_pago'?<UsoPagoForm lote={d.item} close={()=>setModal(null)}/>:null}
  {d&&modal?.k==='uso_decl'?<UsoDeclaradoForm lote={d.item} close={()=>setModal(null)}/>:null}
  {d&&modal?.k==='uso_edit'?<UsoEditForm lote={d.item} uso={modal.u} close={()=>setModal(null)}/>:null}
 </Card>;
}

function Metricas({t,m}:{t:TotalesRetiro;m:Moneda}){
 const d=(n:number)=>dinero(n,m);
 const comisiones=t.comisiones_por_confirmar?`${t.comisiones_por_confirmar} por confirmar${t.comisiones_desconocidas?` · ${t.comisiones_desconocidas} sin importe`:''}${t.comisiones_por_confirmar_importe?` · ${d(t.comisiones_por_confirmar_importe)}`:''}`:d(0);
 const filas:[string,string][]=[
  ['Total salidas bancarias',d(t.total_salidas)],['Efectivo confirmado',d(t.efectivo_confirmado)],['Efectivo declarado sin confirmar',d(t.efectivo_declarado)],
  ['Traspasos por identificar',d(t.traspasos_por_identificar)],['Usos registrados',d(t.usos_registrados)],['Usos declarados',d(t.usos_declarados)],
  ['Aportes personales',d(t.aportes_personales)],['Comisiones conocidas',d(t.comisiones_conocidas)],['Comisiones por confirmar',comisiones],
 ];
 return <>
  <dl className="ret-metrics">{filas.map(([l,v])=><div key={l}><dt>{l}</dt><dd>{v}</dd></div>)}</dl>
  <dl className="ret-metrics ret-pending">
   <div className={t.diferencia_por_explicar!==0?'ret-open':''}><dt>Diferencia pendiente de explicar</dt><dd>{d(t.diferencia_por_explicar)}</dd></div>
   {t.origen_no_trazado>0?<div className="ret-open"><dt>Efectivo usado sin origen confirmado</dt><dd>{d(t.origen_no_trazado)}</dd></div>:null}
  </dl>
  <p className="ret-hint">La diferencia es lo que falta por explicar entre las salidas del banco y los usos: no es efectivo sobrante ni disponible. Los traspasos por identificar no se cuentan como efectivo.</p>
 </>;
}

function FuenteForm({lote,fuente,close}:{lote:LoteRetiro;fuente?:FuenteRetiro;close:()=>void}){
 const cand=useGestion<CandidatosRetiro>('retiros/candidatos',!fuente),save=useGuardar();
 const m=lote.moneda;
 const origenes=[{value:'',label:cand.isPending?'Cargando operaciones…':'Elige una operación del libro'},
  ...(cand.data?.traspasos??[]).filter(t=>t.moneda===m).map(t=>({value:`traspaso:${t.id}`,label:`Traspaso · ${dia(t.fecha)} · ${dinero(t.importe,m)}${t.nota?` · ${t.nota}`:''}`})),
  ...(cand.data?.movimientos??[]).filter(x=>x.moneda===m).map(x=>({value:`movimiento:${x.id}`,label:`${x.tipo==='gasto'?'Gasto':'Salida'} · ${dia(x.fecha)} · ${dinero(x.importe,m)}${x.nota?` · ${x.nota}`:''}`}))];
 const fields:Field[]=[
  ...(fuente?[]:[{name:'origen',label:'Operación del libro',options:origenes,required:true}]),
  {name:'clasificacion',label:'Qué es esta salida',value:fuente?.clasificacion??'traspaso_por_identificar',options:opciones(Object.entries(clasificaciones) as [string,string][]),help:'«Cajero verificado» exige extracto o captura. Un traspaso por identificar no se toma como efectivo.'},
  {name:'evidencia',label:'Evidencia',value:fuente?.evidencia??'',options:EVIDENCIA_FUENTE},
  {name:'declarado_por',label:'Quién lo declara',value:fuente?.declarado_por,help:'Obligatorio si la evidencia es una declaración.'},
  {name:'comision',label:`Comisión incluida en esta salida (${m})`,value:aTexto(fuente?.comision,m),help:'Déjala vacía si no se conoce: vacío no significa 0.'},
  {name:'coste_bancario_total',label:`Coste bancario total, si se conoce (${m})`,value:aTexto(fuente?.coste_bancario_total,m)},
  {name:'coste_estado',label:'Estado del coste bancario',value:fuente?.coste_estado??'por_confirmar',options:opciones(Object.entries(estadosCoste) as [string,string][]),help:'Una autorización pendiente no es una comisión confirmada.'},
  {name:'nota',label:'Nota',type:'textarea',value:fuente?.nota},
 ];
 return <FormModal title={fuente?'Editar salida enlazada':'Enlazar una salida del banco'} close={close} fields={fields} submit={async(d,id)=>{
  const comun={clasificacion:str(d,'clasificacion'),evidencia:opt(d,'evidencia'),declarado_por:opt(d,'declarado_por'),nota:opt(d,'nota'),comision:importeOpt(d,'comision',m),coste_bancario_total:importeOpt(d,'coste_bancario_total',m),coste_estado:str(d,'coste_estado')};
  if(fuente){await save.mutateAsync({path:`retiros/${lote.id}/fuentes/${fuente.id}`,method:'PATCH',body:{version:fuente.version,...comun}});return;}
  const [origen_tipo,...resto]=str(d,'origen').split(':');
  await save.mutateAsync({path:`retiros/${lote.id}/fuentes`,body:{id,origen_tipo,origen_id:resto.join(':'),...comun}});
 }}><Notice>Enlazar no crea ni cambia el movimiento: solo lo referencia. Cada operación puede estar en un único lote.</Notice></FormModal>;
}

const camposImporte=(m:Moneda,uso?:UsoRetiro):Field[]=>[
 {name:'importe_efectivo',label:`Efectivo común usado (${m})`,value:aTexto(uso?.importe_efectivo,m),required:true},
 {name:'aporte_personal',label:`Aporte personal, si lo hubo (${m})`,value:aTexto(uso?.aporte_personal,m),help:'Dinero propio de quien pagó. Solo informa: no crea deuda ni reembolso.'},
 {name:'aporte_reembolso',label:'¿Se pidió reembolso del aporte?',value:uso?.aporte_reembolso??'',options:REEMBOLSO},
];
function comunesUso(d:FormData,m:Moneda){
 return {importe_efectivo:amount(d,'importe_efectivo',m),aporte_personal:importeOpt(d,'aporte_personal',m),aporte_reembolso:opt(d,'aporte_reembolso'),evidencia:str(d,'evidencia'),declarado_por:opt(d,'declarado_por'),nota:opt(d,'nota')};
}

function UsoPagoForm({lote,close}:{lote:LoteRetiro;close:()=>void}){
 const cand=useGestion<CandidatosRetiro>('retiros/candidatos'),save=useGuardar(),m=lote.moneda;
 const pagos=[{value:'',label:cand.isPending?'Cargando pagos…':'Elige un pago registrado'},...(cand.data?.pagos??[]).filter(p=>p.moneda===m).map(p=>({value:p.id,label:`${dia(p.fecha)} · ${p.concepto} · ${p.cuenta_nombre} · disponible ${dinero(p.disponible,m)}`}))];
 return <FormModal title="Enlazar un pago ya registrado" close={close} fields={[{name:'pago_id',label:'Pago de una compra, desde una cuenta',options:pagos,required:true},...camposImporte(m),
  {name:'evidencia',label:'Documento',value:'ninguna',options:EVIDENCIA_USO},{name:'declarado_por',label:'Quién lo declara'},{name:'nota',label:'Nota',type:'textarea'}]}
  submit={async(d,id)=>{await save.mutateAsync({path:`retiros/${lote.id}/usos`,body:{id,tipo:'pago_existente',pago_id:str(d,'pago_id'),...comunesUso(d,m)}});}}>
  <Notice>El pago ya existe en Compras: aquí solo se enlaza. Los usos de un pago no pueden sumar más que el propio pago.</Notice></FormModal>;
}
function UsoDeclaradoForm({lote,close}:{lote:LoteRetiro;close:()=>void}){
 const compras=useGestion<{items:Compra[]}>('compras'),save=useGuardar(),m=lote.moneda;
 const opcionesCompra=[{value:'',label:'Sin compra vinculada'},...(compras.data?.items??[]).filter(c=>c.moneda===m).map(c=>({value:c.id,label:c.concepto}))];
 return <FormModal title="Declarar un uso del efectivo" close={close} fields={[{name:'concepto',label:'En qué se usó',required:true},...camposImporte(m),
  {name:'fecha',label:'Fecha del pago',type:'date',help:'Déjala vacía si todavía no se conoce: no se inventa.'},{name:'compra_id',label:'Compra relacionada (opcional)',options:opcionesCompra},
  {name:'evidencia',label:'Documento',value:'declaracion',options:EVIDENCIA_USO},{name:'declarado_por',label:'Quién lo declara',required:true},{name:'nota',label:'Nota',type:'textarea'}]}
  submit={async(d,id)=>{await save.mutateAsync({path:`retiros/${lote.id}/usos`,body:{id,tipo:'declaracion',concepto:str(d,'concepto'),fecha:opt(d,'fecha'),compra_id:opt(d,'compra_id'),...comunesUso(d,m)}});}}>
  <Notice>Una declaración no crea ningún pago: queda anotada como declarada hasta que haya un registro que la respalde.</Notice></FormModal>;
}
function UsoEditForm({lote,uso,close}:{lote:LoteRetiro;uso:UsoRetiro;close:()=>void}){
 const save=useGuardar(),m=lote.moneda,declarado=uso.tipo==='declaracion';
 return <FormModal title="Editar uso" close={close} fields={[{name:'concepto',label:'En qué se usó',value:uso.concepto,required:true},...camposImporte(m,uso),
  ...(declarado?[{name:'fecha',label:'Fecha del pago',type:'date',value:uso.fecha,help:'Vacía si todavía no se conoce.'}]:[]),
  {name:'evidencia',label:'Documento',value:uso.evidencia,options:EVIDENCIA_USO},{name:'declarado_por',label:'Quién lo declara',value:uso.declarado_por},{name:'nota',label:'Nota',type:'textarea',value:uso.nota}]}
  submit={async(d)=>{await save.mutateAsync({path:`retiros/${lote.id}/usos/${uso.id}`,method:'PATCH',body:{version:uso.version,concepto:str(d,'concepto'),...(declarado?{fecha:opt(d,'fecha')}:{}),...comunesUso(d,m)}});}}>
  <Notice>La corrección queda en el historial con el valor anterior. Nada se borra.</Notice></FormModal>;
}
