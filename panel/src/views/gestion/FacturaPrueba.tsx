import { useState, type FormEvent } from 'react';
import { Modal, Money, Notice, useGestion, useGuardar } from './shared';
import type { Factura } from './Facturacion';
import './factura-prueba.css';

export interface PruebaFactura {
 id:string; numero:string; serie:string; ejercicio:number; secuencia:number; fecha_emision:string;
 snapshot:{entidad:{nombre:string;nif:string|null;direccion:string|null};factura:Factura};
}
const errores:Record<string,string>={
 version_desactualizada:'El borrador cambió. Cierra esta ventana, revisa sus datos y vuelve a generar la prueba.',
 id_reutilizado:'Este intento ya se utilizó con otros datos. Cierra la ventana para iniciar una prueba nueva.',
 fecha_invalida:'Revisa la fecha de la prueba.',fecha_emision_invalida:'Revisa la fecha de la prueba.',
 prueba_solo_borrador_emitida:'Solo se generan pruebas de borradores de venta.',
 network_failed:'No pudimos confirmar el resultado. Conservamos este intento para que reintentar no duplique la prueba.',
 emision_fiscal_no_configurada:'La emisión fiscal real aún no está configurada.',
 secuencia_agotada:'Esta serie alcanzó su límite. No se ha consumido ningún número; contacta con el administrador.',
 prueba_no_encontrada:'No se encontró esa copia de prueba.',
};
function ErrorPrueba({error}:{error:unknown}){if(!error)return null;const code=error instanceof Error?error.message:String(error);return <p role="alert" className="g-error">{errores[code]||`No se pudo completar la prueba (${code}).`}</p>;}
export function fechaMadrid(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid'}).format(new Date());}
export function GenerarPrueba({factura,close,open}:{factura:Factura;close:()=>void;open:(id:string)=>void}){
 const save=useGuardar();const [id]=useState(()=>crypto.randomUUID());const [fecha,setFecha]=useState(factura.fecha_emision||fechaMadrid());
 const [sent,setSent]=useState(false),[error,setError]=useState<unknown>(null);
 async function send(e:FormEvent){e.preventDefault();if(save.isPending)return;setError(null);setSent(true);
  try{const response=await save.mutateAsync({path:`facturas/${factura.id}/pruebas`,body:{id,version:factura.version,fecha_emision:fecha}}) as {item:PruebaFactura};open(response.item.id);}
  catch(e){setError(e);}
 }
 return <Modal title="Generar factura de prueba" close={close} busy={save.isPending} dirty={!sent}><form onSubmit={e=>void send(e)}>
  <Notice>Se guarda una copia con número automático PR, independiente de las facturas reales. No registra una venta, un cobro ni impuestos.</Notice>
  <label className="fiscal-full-label">Fecha de la prueba<input type="date" required min="2000-01-01" max="2100-12-31" value={fecha} disabled={sent} onChange={e=>setFecha(e.target.value)}/></label>
  <p className="fiscal-help">El año de esta fecha determina la serie: PR-{fecha.slice(0,4)||'AAAA'}-001, PR-{fecha.slice(0,4)||'AAAA'}-002… El número queda fijo al guardar. Si falta algún dato, la impresión muestra datos ficticios de relleno.</p>
  <ErrorPrueba error={error}/><div className="g-form-actions"><button type="submit" className="btn" disabled={save.isPending}>{save.isPending?'Guardando prueba…':sent?'Reintentar el mismo intento':'Guardar y ver prueba'}</button></div>
 </form></Modal>;
}
export function HistorialPruebas({facturaId,open}:{facturaId:string;open:(id:string)=>void}){
 const query=useGestion<{items:PruebaFactura[];mas?:boolean}>(`facturas/${facturaId}/pruebas`);
 return <section aria-label="Pruebas guardadas"><h3>Pruebas guardadas</h3><ErrorPrueba error={query.error}/>{query.isPending?<p role="status">Cargando pruebas…</p>:query.error?null:query.data?.items?.length?<ul className="invoice-trial-history">{query.data.items.map(p=><li key={p.id}><button type="button" className="btn alt" onClick={()=>open(p.id)}>Ver {p.numero}</button><span>{p.fecha_emision}</span></li>)}</ul>:<p className="fiscal-help">Todavía no hay pruebas guardadas de este borrador.</p>}{query.data?.mas?<p className="fiscal-help">Se muestran las 100 pruebas más recientes. Las anteriores se conservan y pueden abrirse con su enlace guardado.</p>:null}</section>;
}
function fechaImpresion(s:string){const [y,m,d]=s.split('-');return `${d}/${m}/${y}`;}
export function HojaPrueba({item}:{item:PruebaFactura}){
 const {factura:f,entidad:e}=item.snapshot;
 return <article className="invoice-trial-sheet" aria-label={`Factura de prueba ${item.numero}`}>
  <span className="invoice-trial-print-mark">{item.numero} · PRUEBA SIN VALIDEZ FISCAL</span>
  <header className="invoice-trial-header"><img src="/formatos/velai-logo.png" alt="Velai" width="192" height="80"/><div><strong>PRUEBA · SIN VALIDEZ FISCAL</strong><span>Muestra para revisión</span></div></header>
  <p className="invoice-trial-eyebrow">{f.negocio==='coches'?'VEHÍCULOS':'VENTA'} · {f.tratamiento_fiscal==='rebu'?'REBU · BIENES USADOS':f.tratamiento_fiscal==='general'?'RÉGIMEN GENERAL':'TRATAMIENTO POR REVISAR'}</p>
  <h2>Factura</h2><div className="invoice-trial-number"><div><span>REFERENCIA DE PRUEBA</span><strong>{item.numero}</strong></div><div><span>FECHA SIMULADA</span><strong>{fechaImpresion(item.fecha_emision)}</strong></div></div>
  <div className="invoice-trial-parties"><section><h3>EMISOR</h3><strong>{e.nombre}</strong><p>NIF: {e.nif||'B00000000'}</p><p>{e.direccion||'Calle de Ejemplo, 0 · 00000 Sevilla, España'}</p></section><section><h3>CLIENTE</h3><strong>{f.contraparte_nombre||'CLIENTE DE EJEMPLO, S.L.'}</strong><p>NIF: {f.contraparte_nif||'B00000000'}</p><p>{f.contraparte_direccion||'Calle de Ejemplo, 0 · 00000 Sevilla, España'}</p></section></div>
  {f.fecha_operacion&&f.fecha_operacion!==item.fecha_emision?<p className="invoice-trial-operation">Fecha de operación: {fechaImpresion(f.fecha_operacion)}</p>:null}
  <div className="invoice-trial-table-wrap"><table><thead><tr><th>DESCRIPCIÓN</th><th>UD.</th><th>{f.tratamiento_fiscal==='rebu'?'PRECIO FINAL':'PRECIO'}</th><th>DTO.</th><th>IMPORTE</th></tr></thead><tbody>{f.lineas.map((l,i)=><tr key={i}><td>{l.descripcion}</td><td>{l.cantidad}</td><td><Money value={l.precio_unitario} moneda={f.moneda}/></td><td><Money value={l.descuento} moneda={f.moneda}/></td><td><Money value={l.base} moneda={f.moneda}/></td></tr>)}</tbody></table></div>
  <div className="invoice-trial-totals">{f.tratamiento_fiscal==='rebu'?<p>Régimen especial de los bienes usados. IVA incluido; cuota no desglosada.</p>:<><div><span>Base imponible</span><strong><Money value={f.base} moneda={f.moneda}/></strong></div>{[...new Set(f.lineas.map(l=>l.iva_bp))].map(rate=><div key={String(rate)}><span>{rate===null?'IVA pendiente':`IVA (${rate/100} %)`}</span><strong>{rate===null?'Por revisar':<Money value={f.lineas.filter(l=>l.iva_bp===rate).reduce((n,l)=>n+l.iva,0)} moneda={f.moneda}/>}</strong></div>)}</>}{f.retencion!==0?<div><span>Retención</span><strong><Money value={-f.retencion} moneda={f.moneda}/></strong></div>:null}<div className="invoice-trial-total"><span>{f.lineas.some(l=>l.iva_bp===null)&&f.tratamiento_fiscal!=='rebu'?'TOTAL PROVISIONAL':'TOTAL'}</span><strong><Money value={f.total} moneda={f.moneda}/></strong></div></div>
  {f.nota_fiscal?<p className="invoice-trial-note">{f.nota_fiscal}</p>:null}
  <footer>Documento de prueba con datos de relleno ficticios donde faltan datos. No acredita una venta ni un pago y no consume numeración fiscal. El tratamiento tributario debe revisarse antes de una emisión real.</footer>
 </article>;
}
export function VerPrueba({id,close}:{id:string;close:()=>void}){
 const query=useGestion<{item:PruebaFactura}>(`facturas-prueba/${encodeURIComponent(id)}`);
 return <Modal title="Factura de prueba guardada" close={close}><ErrorPrueba error={query.error}/>{query.isPending?<p role="status">Cargando prueba…</p>:query.data?.item?<><div className="invoice-trial-actions"><button type="button" className="btn" onClick={()=>window.print()}>Imprimir / Guardar PDF</button><span>Reimprimir conserva el número y los datos de esta copia.</span></div><HojaPrueba item={query.data.item}/></>:null}</Modal>;
}
