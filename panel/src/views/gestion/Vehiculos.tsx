// Control económico por vehículo y por viaje (negocio Coches). Todo lo que se ve
// aquí son registros ya existentes (compras, pagos, facturas, cobros, documentos)
// relacionados por vehículo o viaje. Enlazar e imputar no mueve dinero.
import { MOBILE_PREVIEW } from '../../mobilePreview';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import type { FinConceptos } from '../../api/types';
import { Card, Notice, Money, ErrorBox, FormModal, Modal, Documentos, GestionGate, useGestion, useGuardar, amount, str, opt, options, hoy, fecha, tiposVehiculo, estadosVehiculo, estadosViaje, categoriasVehiculo, vehiculoNombre, claseDocumentoLabel, type Catalogos, type Compra, type Moneda, type Prestamo, type Documento } from './shared';

export interface Vehiculo { id:string;referencia:string;tipo:string;marca:string|null;modelo:string|null;matricula:string|null;vin:string|null;moneda:Moneda;estado:string;fecha_compra:string|null;fecha_venta:string|null;precio_venta:number|null;prestamo_id:string|null;entidad_id:string|null;nota:string|null;version:number;compras_count:number;viajes_count:number;documentos_count:number;coste_directo:number;pagado_directo:number;pendiente_directo:number }
export interface Viaje { id:string;nombre:string;moneda:Moneda;fecha_inicio:string|null;fecha_fin:string|null;estado:string;reparto:'igual'|'manual';nota:string|null;version:number;vehiculos_count:number;documentos_count:number;coste_conjunto:number;coste_directo:number;coste_total:number;pagado:number;pendiente:number;parte_conjunta:number|null;vehiculos?:{vehiculo_id:string;referencia:string}[] }
interface Participante { vehiculo_id:string;peso_bp:number;referencia:string;tipo:string;marca:string|null;modelo:string|null;estado:string;parte_conjunta:number;parte_conjunta_pagada:number;directo:number;directo_pagado:number;total:number;total_pagado:number }
interface Totales { precio_compra:number;precio_compra_confirmado:boolean;otros_costes_directos:number;coste_directo:number;pagado_directo:number;pendiente_directo:number;imputado_viajes:number;imputado_viajes_pagado:number;gastos_manuales:number;coste_total:number;invertido_confirmado:number;pendiente_pago:number;precio_venta:number|null;facturado_venta:number;venta:number|null;cobrado:number;cobrado_en_cuenta:number;cobrado_pendiente_conciliar:number;pendiente_cobro:number|null;margen_estimado:number|null;margen_sin_viajes:number|null;margen_confirmado:number }
interface ResumenVehiculo { vehiculo:Vehiculo;prestamo:{id:string;nombre:string}|null;compras:Compra[];viajes:{viaje:Viaje;vehiculos:number;conjunto_total:number;conjunto_pagado:number;parte:number;parte_pagada:number}[];facturas:{id:string;numero:string|null;tipo:string;estado:string;total:number;fecha_emision:string|null;contraparte_nombre:string|null}[];cobros:{id:string;fecha:string;importe:number;signo:number;cuenta_id:string|null;nota:string|null}[];documentos:(Documento&{tipo:string;objeto_id:string})[];por_categoria:{categoria:string;importe:number;pagado:number;compras:number}[];totales:Totales;cronologia:{fecha:string|null;clase:string;titulo:string;detalle:string;importe:number;ref:{tipo:string;id:string}}[] }
interface ResumenViaje { viaje:Viaje;vehiculos:Participante[];conjuntos:Compra[];directos:Compra[];por_categoria:{categoria:string;importe:number;pagado:number;compras:number}[];totales:{coste_conjunto:number;pagado_conjunto:number;coste_directo:number;pagado_directo:number;coste_total:number;pagado:number;pendiente:number;sin_repartir:number;vehiculos:number} }
const claseCrono:Record<string,string>={compra:'Gasto',pago:'Pago',viaje:'Viaje',factura:'Factura',cobro:'Cobro',gasto:'Gasto manual'};

export function Vehiculos(){
 const [params,setParams]=useSearchParams();
 const vista=params.get('vista')==='viajes'?'viajes':'vehiculos';
 function change(k:string,v:string|null){setParams(old=>{const next=new URLSearchParams(old);if(v)next.set(k,v);else next.delete(k);return next;});}
 return <GestionGate><header className="g-header"><div><h1>Vehículos y viajes</h1><p>Cuánto costó cada vehículo, cuánto se cobró al venderlo y qué parte de cada viaje le corresponde.</p></div></header>
  <nav className="g-tabs" aria-label="Vistas de Coches">{([['vehiculos','Vehículos'],['viajes','Viajes']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={vista===key} className={vista===key?'active':''} onClick={()=>{change('vista',key);change('vehiculo',null);change('viaje',null);}}>{label}</button>)}</nav>
  {vista==='viajes'?<ViajesPanel abierto={params.get('viaje')} abrir={id=>change('viaje',id)}/>:<VehiculosPanel abierto={params.get('vehiculo')} abrir={id=>change('vehiculo',id)}/>}
 </GestionGate>;
}

function VehiculosPanel({abierto,abrir}:{abierto:string|null;abrir:(id:string|null)=>void}){
 const list=useGestion<{items:Vehiculo[];mas?:boolean}>('vehiculos'),cat=useGestion<Catalogos>('catalogos');
 const [creating,setCreating]=useState(false),[estado,setEstado]=useState('todos'),[tipo,setTipo]=useState('todos');
 const all=list.data?.items||[];const rows=all.filter(v=>(estado==='todos'||v.estado===estado)&&(tipo==='todos'||v.tipo===tipo));
 const vivos=all.filter(v=>v.estado!=='cancelado');
 return <>
  <div className="g-metrics"><div><strong>{vivos.length}</strong><span>vehículos</span></div><div><strong>{vivos.filter(v=>v.estado==='vendido').length}</strong><span>vendidos</span></div><div><strong><Money value={vivos.filter(v=>v.moneda==='EUR').reduce((s,v)=>s+v.pagado_directo,0)}/></strong><span>pagado en gastos directos · EUR</span></div><div><strong><Money value={vivos.filter(v=>v.moneda==='EUR').reduce((s,v)=>s+v.pendiente_directo,0)}/></strong><span>pendiente de pagar · EUR</span></div></div>
  <Card title="Listado de vehículos" action={<div className="g-inline"><label>Estado<select value={estado} onChange={e=>setEstado(e.target.value)}><option value="todos">Todos</option>{Object.entries(estadosVehiculo).map(([k,l])=><option value={k} key={k}>{l}</option>)}</select></label><label>Tipo<select value={tipo} onChange={e=>setTipo(e.target.value)}><option value="todos">Todos</option>{Object.entries(tiposVehiculo).map(([k,l])=><option value={k} key={k}>{l}</option>)}</select></label>{!MOBILE_PREVIEW?<button className="btn" onClick={()=>setCreating(true)}>Añadir vehículo</button>:null}</div>}>
   <ErrorBox error={list.error||cat.error}/>
   {list.isPending?<p role="status">Cargando vehículos…</p>:rows.length?<div className="g-table"><table><thead><tr><th>Vehículo</th><th>Tipo</th><th>Estado</th><th>Gastos directos</th><th>Pagado</th><th>Pendiente</th><th>Viajes</th></tr></thead><tbody>{rows.map(v=><tr key={v.id}><td><button type="button" className="g-row-button" onClick={()=>abrir(v.id)}><strong>{v.referencia}</strong><small>{[v.marca,v.modelo,v.matricula].filter(Boolean).join(' · ')||'Sin datos'}</small></button></td><td>{tiposVehiculo[v.tipo]||v.tipo}</td><td>{estadosVehiculo[v.estado]||v.estado}</td><td><Money value={v.coste_directo} moneda={v.moneda}/></td><td><Money value={v.pagado_directo} moneda={v.moneda}/></td><td><Money value={v.pendiente_directo} moneda={v.moneda}/></td><td>{v.viajes_count}</td></tr>)}</tbody></table></div>:<p className="g-empty">Todavía no hay vehículos. Crea la ficha de cada uno y luego relaciona sus compras, viajes, facturas y cobros.</p>}
   <Notice>La parte de los gastos de viaje no aparece en este listado: se calcula en la ficha de cada vehículo según los vehículos de cada viaje.</Notice>
  </Card>
  {creating?<VehicleForm cat={cat.data} close={()=>setCreating(false)} saved={id=>{setCreating(false);abrir(id);}}/>:null}
  {abierto?<VehicleDetail id={abierto} cat={cat.data} close={()=>abrir(null)}/>:null}
 </>;
}
function VehicleForm({item,cat,close,saved}:{item?:Vehiculo;cat?:Catalogos;close:()=>void;saved:(id:string)=>void}){
 const save=useGuardar(),loans=useGestion<{items:Prestamo[]}>('prestamos');
 const moneda=item?.moneda||'EUR';
 return <FormModal title={item?`Editar ${item.referencia}`:'Nueva ficha de vehículo'} close={close} fields={[
  {name:'referencia',label:'Referencia (cómo lo llamáis)',value:item?.referencia,required:true,help:'Única y fácil de reconocer. Ej.: Camioneta azul 2024.'},
  {name:'tipo',label:'Tipo',value:item?.tipo||'camioneta',options:Object.entries(tiposVehiculo).map(([value,label])=>({value,label}))},
  {name:'marca',label:'Marca',value:item?.marca},{name:'modelo',label:'Modelo',value:item?.modelo},
  {name:'matricula',label:'Matrícula o placas (si ya existe)',value:item?.matricula},{name:'vin',label:'Bastidor / VIN (opcional)',value:item?.vin},
  ...(item?[{name:'estado',label:'Estado',value:item.estado,options:Object.entries(estadosVehiculo).map(([value,label])=>({value,label}))}]:[{name:'moneda',label:'Moneda de sus operaciones',value:'EUR',options:[{value:'EUR',label:'EUR'},{value:'COP',label:'COP'}]}]),
  {name:'prestamo_id',label:'Origen principal de los fondos',value:item?.prestamo_id,options:options(loans.data?.items||[],'Sin préstamo asignado')},
  {name:'fecha_compra',label:'Fecha de compra',type:'date',value:item?.fecha_compra},{name:'fecha_venta',label:'Fecha de venta',type:'date',value:item?.fecha_venta},
  {name:'precio_venta',label:`Precio de venta acordado (${moneda})`,value:item?.precio_venta!=null?item.precio_venta/(moneda==='EUR'?100:1):'',help:'Solo el precio acordado. El cobro real se registra aparte.'},
  {name:'nota',label:'Notas',type:'textarea',value:item?.nota},
 ]} submit={async(d,id)=>{
  const precio=str(d,'precio_venta');
  const body={referencia:str(d,'referencia'),tipo:str(d,'tipo'),marca:opt(d,'marca'),modelo:opt(d,'modelo'),matricula:opt(d,'matricula'),vin:opt(d,'vin'),prestamo_id:opt(d,'prestamo_id'),fecha_compra:opt(d,'fecha_compra'),fecha_venta:opt(d,'fecha_venta'),precio_venta:precio?amount(d,'precio_venta',moneda):null,nota:opt(d,'nota')};
  if(item){await save.mutateAsync({path:`vehiculos/${item.id}`,method:'PATCH',body:{version:item.version,estado:str(d,'estado'),...body}});saved(item.id);}
  else{await save.mutateAsync({path:'vehiculos',body:{id,moneda:str(d,'moneda'),...body}});saved(id);}
 }}><Notice>La ficha no registra compras ni pagos. Después relaciona desde Compras su adquisición, reparaciones y viajes, y desde aquí el cobro de la venta.</Notice>{!cat?.cuentas.length?null:null}</FormModal>;
}
function CobroForm({v,cat,close}:{v:Vehiculo;cat?:Catalogos;close:()=>void}){
 const save=useGuardar();const conceptos=useQuery({queryKey:['finanzas','conceptos'],queryFn:()=>api<FinConceptos>('/api/admin/finanzas/conceptos')});
 const ingresos=(conceptos.data?.conceptos.ingreso||[]).filter(c=>!c.clave);
 return <FormModal title={`Registrar cobro de la venta · ${v.referencia}`} close={close} fields={[
  {name:'fecha',label:'Fecha del cobro',type:'date',value:hoy(),required:true},
  {name:'importe',label:`Importe cobrado (${v.moneda})`,value:v.precio_venta!=null?v.precio_venta/(v.moneda==='EUR'?100:1):'',required:true},
  {name:'cuenta_id',label:'Cuenta donde entró el dinero',options:options((cat?.cuentas||[]).filter(c=>c.moneda===v.moneda),'Sin cuenta · pendiente de conciliar')},
  {name:'concepto_id',label:'Concepto de ingreso',options:ingresos.map(c=>({value:String(c.id),label:c.nombre})),required:true},
  {name:'nota',label:'Nota (comprador, referencia bancaria…)'},
 ]} submit={(d,id)=>save.mutateAsync({path:`vehiculos/${v.id}/cobros`,body:{id,fecha:str(d,'fecha'),importe:amount(d,'importe',v.moneda),cuenta_id:opt(d,'cuenta_id'),concepto_id:Number(str(d,'concepto_id')),nota:opt(d,'nota')}})}><Notice>Se registra UNA entrada en el libro con este vehículo. Un cobro sin cuenta queda como pendiente de conciliar. Si fueron varios pagos, registra cada uno.</Notice><ErrorBox error={conceptos.error}/></FormModal>;
}
function VehicleDetail({id,cat,close}:{id:string;cat?:Catalogos;close:()=>void}){
 const query=useGestion<ResumenVehiculo>(`vehiculos/${encodeURIComponent(id)}/resumen`);const [action,setAction]=useState<'editar'|'cobro'|null>(null);
 const r=query.data;const v=r?.vehiculo;const t=r?.totales;const m=v?.moneda||'EUR';
 return <Modal key={id} title={v?`${v.referencia} · ${tiposVehiculo[v.tipo]||v.tipo}`:'Ficha del vehículo'} close={close}><ErrorBox error={query.error}/>{query.isPending?<p role="status">Cargando ficha…</p>:r&&v&&t?<>
  <dl className="g-definition"><div><dt>Datos</dt><dd>{[v.marca,v.modelo].filter(Boolean).join(' ')||'Sin marca'} · {v.matricula||'sin matrícula'}{v.vin?` · ${v.vin}`:''}</dd></div><div><dt>Estado</dt><dd>{estadosVehiculo[v.estado]||v.estado}</dd></div><div><dt>Compra / venta</dt><dd>{fecha(v.fecha_compra)} / {fecha(v.fecha_venta)}</dd></div><div><dt>Fondos</dt><dd>{r.prestamo?`Préstamo ${r.prestamo.nombre} (financiación, no es coste ni venta)`:'Sin préstamo asignado'}</dd></div>{v.nota?<div><dt>Notas</dt><dd>{v.nota}</dd></div>:null}</dl>
  <div className="g-metrics"><div><strong><Money value={t.precio_compra} moneda={m}/></strong><span>{t.precio_compra_confirmado?'precio de compra':'compra prevista (sin confirmar)'}</span></div><div><strong><Money value={t.otros_costes_directos} moneda={m}/></strong><span>otros gastos propios</span></div><div><strong><Money value={t.imputado_viajes} moneda={m}/></strong><span>su parte de los viajes</span></div><div><strong><Money value={t.coste_total} moneda={m}/></strong><span>coste total (estimación)</span></div></div>
  <div className="g-metrics"><div><strong><Money value={t.invertido_confirmado} moneda={m}/></strong><span>invertido confirmado (pagos reales)</span></div><div><strong><Money value={t.pendiente_pago} moneda={m}/></strong><span>registrado pendiente de pago</span></div><div><strong><Money value={t.venta} moneda={m}/></strong><span>{t.precio_venta!=null?'precio de venta acordado':t.facturado_venta?'facturado en venta':'venta por definir'}</span></div><div><strong><Money value={t.cobrado} moneda={m}/></strong><span>cobrado{t.cobrado_pendiente_conciliar?` · ${Math.round(t.cobrado_pendiente_conciliar/(m==='EUR'?100:1))} sin cuenta`:''}</span></div></div>
  <div className="g-metrics"><div><strong><Money value={t.margen_estimado} moneda={m}/></strong><span>margen estimado (venta − coste total)</span></div><div><strong><Money value={t.margen_sin_viajes} moneda={m}/></strong><span>margen sin la parte de viajes</span></div><div><strong><Money value={t.venta==null?null:t.margen_confirmado} moneda={m}/></strong><span>margen confirmado (cobrado en cuenta − pagado)</span></div><div><strong><Money value={t.pendiente_cobro} moneda={m}/></strong><span>pendiente de cobro</span></div></div>
  <Notice>Estimación: incluye compras previstas y gastos registrados sin pagar. Confirmado: solo pagos y cobros reales en cuenta. El préstamo no cuenta como venta ni como beneficio, y devolver su capital no es un gasto del vehículo.</Notice>
  <div className="g-inline">{!MOBILE_PREVIEW?<><button className="btn" onClick={()=>setAction('cobro')}>Registrar cobro de la venta</button><button className="btn alt" onClick={()=>setAction('editar')}>Editar ficha</button></>:null}<Link className="btn alt" to={`/compras?vehiculo=${v.id}`}>Ver y añadir gastos</Link></div>
  {r.viajes.length?<Card title="Viajes en los que participó"><div className="g-table"><table><thead><tr><th>Viaje</th><th>Vehículos</th><th>Gastos conjuntos</th><th>Su parte</th><th>Pagado de su parte</th></tr></thead><tbody>{r.viajes.map(x=><tr key={x.viaje.id}><td><strong>{x.viaje.nombre}</strong><small>{fecha(x.viaje.fecha_inicio)} · {x.viaje.reparto==='igual'?'partes iguales':'reparto manual'}</small></td><td>{x.vehiculos}</td><td><Money value={x.conjunto_total} moneda={m}/></td><td><Money value={x.parte} moneda={m}/></td><td><Money value={x.parte_pagada} moneda={m}/></td></tr>)}</tbody></table></div></Card>:null}
  {r.por_categoria.length?<Card title="Gastos propios por tipo"><div className="g-chart">{r.por_categoria.map(c=><div className="g-chart-row" key={c.categoria}><span>{categoriasVehiculo[c.categoria]||c.categoria}</span><meter min="0" max={Math.max(1,t.coste_directo)} value={c.importe} aria-label={categoriasVehiculo[c.categoria]||c.categoria}/><Money value={c.importe} moneda={m}/></div>)}</div></Card>:null}
  <Card title="Cronología"><div className="g-table"><table><thead><tr><th>Fecha</th><th>Qué</th><th>Importe</th></tr></thead><tbody>{r.cronologia.length?r.cronologia.map((e,i)=><tr key={i}><td>{fecha(e.fecha)}</td><td><strong>{claseCrono[e.clase]||e.clase}: {e.titulo}</strong><small>{e.detalle}</small></td><td><Money value={e.importe} moneda={m}/></td></tr>):<tr><td colSpan={3}><p className="g-empty">Aún no hay operaciones relacionadas con este vehículo.</p></td></tr>}</tbody></table></div><Notice>Cada línea es un registro original de Compras, Facturación o Finanzas. Para corregirlo, hazlo desde su origen; aquí no se duplica.</Notice></Card>
  {r.facturas.length?<Card title="Facturas relacionadas"><div className="g-table"><table><thead><tr><th>Factura</th><th>Tipo</th><th>Estado</th><th>Importe</th></tr></thead><tbody>{r.facturas.map(f=><tr key={f.id}><td><Link to={`/facturacion?factura=${f.id}`}>{f.numero||'Sin número'}</Link><small>{f.contraparte_nombre||''}</small></td><td>{f.tipo==='emitida'?'Venta':'Recibida'}</td><td>{f.estado}</td><td><Money value={f.total} moneda={m}/></td></tr>)}</tbody></table></div></Card>:null}
  <Documentos tipo="vehiculo" objetoId={v.id}/>
  {r.documentos.some(d=>d.tipo!=='vehiculo')?<Card title="Documentos de sus compras y facturas"><div className="g-table"><table><thead><tr><th>Documento</th><th>Tipo</th><th>Origen</th></tr></thead><tbody>{r.documentos.filter(d=>d.tipo!=='vehiculo').map(d=><tr key={d.id}><td><strong>{d.nombre}</strong></td><td>{claseDocumentoLabel(d.clase)}</td><td>{d.tipo==='compra'?<Link to={`/compras?vehiculo=${v.id}`}>Compra</Link>:<Link to={`/facturacion?factura=${d.objeto_id}`}>Factura</Link>}</td></tr>)}</tbody></table></div></Card>:null}
  {action==='editar'?<VehicleForm item={v} cat={cat} close={()=>setAction(null)} saved={()=>setAction(null)}/>:action==='cobro'?<CobroForm v={v} cat={cat} close={()=>setAction(null)}/>:null}
 </>:null}</Modal>;
}

function ViajesPanel({abierto,abrir}:{abierto:string|null;abrir:(id:string|null)=>void}){
 const list=useGestion<{items:Viaje[];mas?:boolean}>('viajes'),cat=useGestion<Catalogos>('catalogos');
 const [creating,setCreating]=useState(false),[estado,setEstado]=useState('todos');
 const rows=(list.data?.items||[]).filter(v=>estado==='todos'||v.estado===estado);
 return <>
  <Card title="Viajes" action={<div className="g-inline"><label>Estado<select value={estado} onChange={e=>setEstado(e.target.value)}><option value="todos">Todos</option>{Object.entries(estadosViaje).map(([k,l])=><option value={k} key={k}>{l}</option>)}</select></label>{!MOBILE_PREVIEW?<button className="btn" onClick={()=>setCreating(true)}>Añadir viaje</button>:null}</div>}>
   <ErrorBox error={list.error||cat.error}/>
   {list.isPending?<p role="status">Cargando viajes…</p>:rows.length?<div className="g-table"><table><thead><tr><th>Viaje</th><th>Vehículos</th><th>Costó</th><th>Por vehículo</th><th>Pagado</th><th>Pendiente</th></tr></thead><tbody>{rows.map(v=><tr key={v.id}><td><button type="button" className="g-row-button" onClick={()=>abrir(v.id)}><strong>{v.nombre}</strong><small>{fecha(v.fecha_inicio)}{v.fecha_fin?` → ${fecha(v.fecha_fin)}`:''} · {estadosViaje[v.estado]||v.estado}</small></button></td><td>{v.vehiculos_count}{v.vehiculos?.length?<small>{v.vehiculos.map(x=>x.referencia).join(', ')}</small>:null}</td><td><Money value={v.coste_total} moneda={v.moneda}/></td><td>{v.vehiculos_count?v.reparto==='igual'?<Money value={v.parte_conjunta} moneda={v.moneda}/>:'según pesos':'sin vehículos'}</td><td><Money value={v.pagado} moneda={v.moneda}/></td><td><Money value={v.pendiente} moneda={v.moneda}/></td></tr>)}</tbody></table></div>:<p className="g-empty">Todavía no hay viajes. Crea uno, elige los vehículos que fueron y registra sus gastos desde Compras eligiendo el viaje.</p>}
   <Notice>«Costó» suma los gastos conjuntos y los directos de cada vehículo. «Por vehículo» es la parte de los gastos conjuntos que le toca a cada uno.</Notice>
  </Card>
  {creating?<TripForm cat={cat.data} close={()=>setCreating(false)} saved={id=>{setCreating(false);abrir(id);}}/>:null}
  {abierto?<TripDetail id={abierto} cat={cat.data} close={()=>abrir(null)}/>:null}
 </>;
}
function TripForm({item,participantes=[],cat,close,saved}:{item?:Viaje;participantes?:Participante[];cat?:Catalogos;close:()=>void;saved:(id:string)=>void}){
 const save=useGuardar();const [moneda,setMoneda]=useState<Moneda>(item?.moneda||'EUR'),[reparto,setReparto]=useState(item?.reparto||'igual');
 const candidatos=(cat?.vehiculos||[]).filter(v=>v.moneda===moneda&&v.estado!=='cancelado');
 const pesoDe=(id:string)=>participantes.find(p=>p.vehiculo_id===id)?.peso_bp;
 return <FormModal title={item?`Editar ${item.nombre}`:'Nuevo viaje'} close={close} fields={[
  {name:'nombre',label:'Nombre del viaje',value:item?.nombre,required:true,help:'Ej.: Viaje Alemania noviembre.'},
  {name:'fecha_inicio',label:'Fecha de inicio',type:'date',value:item?.fecha_inicio},{name:'fecha_fin',label:'Fecha de fin',type:'date',value:item?.fecha_fin},
  ...(item?[{name:'estado',label:'Estado',value:item.estado,options:Object.entries(estadosViaje).map(([value,label])=>({value,label}))}]:[]),
  {name:'nota',label:'Notas',type:'textarea',value:item?.nota},
 ]} submit={async(d,id)=>{
  const vehiculos=d.getAll('vehiculos').map(String).map(vid=>reparto==='manual'?{vehiculo_id:vid,peso_bp:Math.round(Number(String(d.get(`peso_${vid}`)||'0').replace(',','.'))*100)}:{vehiculo_id:vid});
  const body={nombre:str(d,'nombre'),fecha_inicio:opt(d,'fecha_inicio'),fecha_fin:opt(d,'fecha_fin'),reparto,nota:opt(d,'nota'),vehiculos};
  if(item){await save.mutateAsync({path:`viajes/${item.id}`,method:'PATCH',body:{version:item.version,estado:str(d,'estado'),...body}});saved(item.id);}
  else{await save.mutateAsync({path:'viajes',body:{id,moneda,...body}});saved(id);}
 }}>
  {!item?<div className="g-fields"><label>Moneda del viaje<select value={moneda} onChange={e=>setMoneda(e.target.value as Moneda)}><option value="EUR">EUR</option><option value="COP">COP</option></select></label></div>:null}
  <div className="g-fields"><label>Cómo se reparten los gastos conjuntos<select value={reparto} onChange={e=>setReparto(e.target.value as 'igual'|'manual')}><option value="igual">A partes iguales entre los vehículos</option><option value="manual">Por porcentajes (manual)</option></select></label></div>
  <h3>Vehículos que van en este viaje</h3>
  {candidatos.length?<div className="g-account-list">{candidatos.map(v=><div className="g-account-row" key={v.id}><label className="fin-check"><input type="checkbox" name="vehiculos" value={v.id} defaultChecked={participantes.some(p=>p.vehiculo_id===v.id)}/> <span><strong>{vehiculoNombre(v)}</strong><small> · {tiposVehiculo[v.tipo]||v.tipo} · {estadosVehiculo[v.estado]||v.estado}</small></span></label>{reparto==='manual'?<label>% <input name={`peso_${v.id}`} inputMode="decimal" defaultValue={pesoDe(v.id)?String(pesoDe(v.id)!/100):''} style={{width:'6em'}}/></label>:null}</div>)}</div>:<p className="g-empty">No hay vehículos en {moneda}. Crea primero su ficha en la pestaña Vehículos.</p>}
  <Notice>{reparto==='manual'?'Los porcentajes de los vehículos marcados deben sumar 100.':'Cada gasto conjunto se divide entre los vehículos marcados; los céntimos sobrantes se asignan uno a uno.'} Un vehículo con gastos directos en el viaje no se puede quitar hasta reasignarlos.</Notice>
 </FormModal>;
}
function TripDetail({id,cat,close}:{id:string;cat?:Catalogos;close:()=>void}){
 const query=useGestion<ResumenViaje>(`viajes/${encodeURIComponent(id)}/resumen`);const [edit,setEdit]=useState(false);
 const r=query.data;const t=r?.viaje;const m=t?.moneda||'EUR';
 return <Modal key={id} title={t?t.nombre:'Detalle del viaje'} close={close}><ErrorBox error={query.error}/>{query.isPending?<p role="status">Cargando viaje…</p>:r&&t?<>
  <p className="muted">{r.totales.vehiculos} vehículo(s) · {fecha(t.fecha_inicio)}{t.fecha_fin?` → ${fecha(t.fecha_fin)}`:''} · {estadosViaje[t.estado]||t.estado} · {t.reparto==='igual'?'a partes iguales':'reparto por porcentajes'}</p>
  <div className="g-metrics"><div><strong><Money value={r.totales.coste_total} moneda={m}/></strong><span>costó en total</span></div><div><strong><Money value={r.totales.coste_conjunto} moneda={m}/></strong><span>gastos conjuntos</span></div><div><strong><Money value={r.totales.vehiculos?Math.floor(r.totales.coste_conjunto/r.totales.vehiculos):null} moneda={m}/></strong><span>{t.reparto==='igual'?'por vehículo (parte conjunta)':'media por vehículo'}</span></div><div><strong><Money value={r.totales.pendiente} moneda={m}/></strong><span>pendiente de pagar</span></div></div>
  {r.totales.sin_repartir?<Notice>Hay gastos conjuntos por <Money value={r.totales.sin_repartir} moneda={m}/> sin repartir porque el viaje no tiene vehículos. Añádelos para imputarlos.</Notice>:null}
  <div className="g-inline">{!MOBILE_PREVIEW?<button className="btn alt" onClick={()=>setEdit(true)}>Editar viaje y vehículos</button>:null}<Link className="btn" to={`/compras?viaje=${t.id}`}>Ver y añadir gastos del viaje</Link></div>
  <Card title="Lo que le toca a cada vehículo"><div className="g-table"><table><thead><tr><th>Vehículo</th><th>Parte conjunta</th><th>Gastos propios en el viaje</th><th>Total</th><th>Pagado</th></tr></thead><tbody>{r.vehiculos.length?r.vehiculos.map(p=><tr key={p.vehiculo_id}><td><Link to={`/vehiculos?vehiculo=${p.vehiculo_id}`}>{vehiculoNombre(p)}</Link>{t.reparto==='manual'?<small>{p.peso_bp/100} %</small>:null}</td><td><Money value={p.parte_conjunta} moneda={m}/></td><td><Money value={p.directo} moneda={m}/></td><td><Money value={p.total} moneda={m}/></td><td><Money value={p.total_pagado} moneda={m}/></td></tr>):<tr><td colSpan={5}><p className="g-empty">Sin vehículos todavía.</p></td></tr>}</tbody></table></div></Card>
  <Card title="Gastos conjuntos del viaje"><div className="g-table"><table><thead><tr><th>Gasto</th><th>Tipo</th><th>Importe</th><th>Pagado</th></tr></thead><tbody>{r.conjuntos.length?r.conjuntos.map(c=><tr key={c.id}><td><strong>{c.concepto}</strong><small>{fecha(c.fecha_compra||c.fecha_prevista)} · {c.estado}</small></td><td>{categoriasVehiculo[c.categoria]||c.categoria}</td><td><Money value={c.real??c.estimado} moneda={m}/></td><td><Money value={c.pagado} moneda={m}/></td></tr>):<tr><td colSpan={4}><p className="g-empty">Aún no hay gastos conjuntos. Regístralos desde Compras eligiendo este viaje y dejando el vehículo vacío.</p></td></tr>}</tbody></table></div></Card>
  {r.directos.length?<Card title="Gastos de un vehículo concreto en el viaje"><div className="g-table"><table><thead><tr><th>Gasto</th><th>Vehículo</th><th>Importe</th></tr></thead><tbody>{r.directos.map(c=><tr key={c.id}><td><strong>{c.concepto}</strong><small>{categoriasVehiculo[c.categoria]||c.categoria}</small></td><td>{vehiculoNombre(r.vehiculos.find(p=>p.vehiculo_id===c.vehiculo_id))||'—'}</td><td><Money value={c.real??c.estimado} moneda={m}/></td></tr>)}</tbody></table></div></Card>:null}
  {r.por_categoria.length?<Card title="Gastos del viaje por tipo"><div className="g-chart">{r.por_categoria.map(c=><div className="g-chart-row" key={c.categoria}><span>{categoriasVehiculo[c.categoria]||c.categoria}</span><meter min="0" max={Math.max(1,r.totales.coste_total)} value={c.importe} aria-label={categoriasVehiculo[c.categoria]||c.categoria}/><Money value={c.importe} moneda={m}/></div>)}</div></Card>:null}
  <Documentos tipo="viaje" objetoId={t.id}/>
  {edit?<TripForm item={t} participantes={r.vehiculos} cat={cat} close={()=>setEdit(false)} saved={()=>setEdit(false)}/>:null}
 </>:null}</Modal>;
}
