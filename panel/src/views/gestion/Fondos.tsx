import { useState } from 'react';
import { Link } from 'react-router';
import { Card, EntityOptions, ErrorBox, GestionGate, Money, Notice, negocios, useGestion, type Cuenta, type Moneda, type Negocio } from './shared';

interface CuentaFondos extends Cuenta {movimientos:number;saldo:number;reserva:number;disponible:number;estado_saldo:'conciliado'|'pendiente'}
interface Destino {negocio:Negocio;previsto:number;comprometido:number;comprado:number;pagado:number;pendiente:number}
interface SaldoSocio {email:string;nombre:string;adelantado:number;reembolsado:number;saldo:number}
interface ResumenFondos {
 moneda:Moneda;cuentas:CuentaFondos[];compras:{por_negocio:Destino[];previsto:number;pendiente:number};socios:SaldoSocio[];
 totales:{saldo:number;saldo_conciliado:number;saldo_pendiente_conciliar:number;reservas:number;disponible:number;deuda_pendiente:number;deuda_sin_desembolsar:number;compromisos_pendientes:number;previsto:number;saldo_socios:number;disponible_tras_compromisos:number};
}
type Medida='comprado'|'pagado'|'pendiente'|'previsto';
const medidas:Record<Medida,string>={comprado:'Compras realizadas',pagado:'Pagado a proveedores',pendiente:'Compromisos pendientes',previsto:'Previsiones sin comprometer'};

/** Resumen interno de todas las cuentas del proyecto, separado por moneda. */
export function Fondos(){return <GestionGate><FondosContent/></GestionGate>;}
function FondosContent(){
 const [moneda,setMoneda]=useState<Moneda>('EUR'),[medida,setMedida]=useState<Medida>('comprado');
 const query=useGestion<ResumenFondos>(`resumen?moneda=${moneda}`),data=query.data;
 const values=data?.compras.por_negocio||[];const max=Math.max(1,...values.map(n=>n[medida]));
 return <>
  <Card title="Fondos del proyecto" action={<label>Moneda de los fondos<select value={moneda} onChange={e=>setMoneda(e.target.value as Moneda)}><option value="EUR">EUR · euros</option><option value="COP">COP · pesos colombianos</option></select></label>}>
   <p className="muted">Un resumen de la cuenta común, las reservas y lo que ya está comprometido.</p>
   <ErrorBox error={query.error}/>{query.isPending?<p role="status">Cargando fondos registrados…</p>:null}
   {data?<>
    <div className="g-metrics" aria-label="Fondos registrados"><div><strong><Money value={data.totales.saldo} moneda={moneda}/></strong><span>saldo registrado en cuentas</span></div><div><strong><Money value={data.totales.reservas} moneda={moneda}/></strong><span>reservado para cuotas</span></div><div><strong><Money value={data.totales.disponible_tras_compromisos} moneda={moneda}/></strong><span>disponible tras obligaciones</span></div></div>
    <dl className="g-definition"><div><dt>Saldo registrado</dt><dd><Money value={data.totales.saldo} moneda={moneda}/></dd></div><div><dt>Menos reserva de cuotas</dt><dd><Money value={data.totales.reservas} moneda={moneda}/></dd></div><div><dt>Menos compras comprometidas o pendientes de pago</dt><dd><Money value={data.totales.compromisos_pendientes} moneda={moneda}/></dd></div><div><dt>Menos adelantos por devolver a socios</dt><dd><Money value={data.totales.saldo_socios} moneda={moneda}/></dd></div><div><dt><strong>Disponible tras obligaciones registradas</strong></dt><dd><strong><Money value={data.totales.disponible_tras_compromisos} moneda={moneda}/></strong></dd></div></dl>
    <Notice>El saldo se calcula con las cuentas y los movimientos registrados. Contrástalo con el extracto bancario. Las reservas apartan dinero para pagos futuros; no son pagos ya efectuados ni un cálculo de impuestos.</Notice>
    {data.totales.disponible_tras_compromisos<0?<p className="g-error" role="alert">Las obligaciones registradas superan el dinero disponible. Revisa los compromisos y los saldos antes de añadir nuevas compras.</p>:null}
    {data.totales.previsto>0?<p className="muted">También hay <Money value={data.totales.previsto} moneda={moneda}/> en ideas o compras previstas. Todavía no se descuentan: se reservarán cuando se comprometa su presupuesto.</p>:null}
   </>:null}
  </Card>
  <Card title="Cuentas y conciliación" action={<div className="g-inline"><EntityOptions onDone={()=>void query.refetch()}/></div>}>
   {data?.cuentas.length?<><div className="g-table"><table><caption className="g-sr-only">Cuentas registradas en {moneda} y estado de su ficha</caption><thead><tr><th>Cuenta</th><th>Saldo registrado</th><th>Reserva de cuotas</th><th>Tras reserva</th><th>Conciliación</th></tr></thead><tbody>{data.cuentas.map(c=><tr key={c.id}><td><strong>{c.nombre}</strong><small>{c.fecha_saldo?`Saldo inicial a ${c.fecha_saldo}`:'Fecha del saldo inicial pendiente'}</small></td><td><Money value={c.saldo} moneda={moneda}/></td><td><Money value={c.reserva} moneda={moneda}/></td><td><Money value={c.disponible} moneda={moneda}/></td><td><span className={`g-badge ${c.estado_saldo==='conciliado'?'done':''}`}>{c.estado_saldo==='conciliado'?'Ficha marcada como conciliada':'Pendiente de conciliar'}</span></td></tr>)}</tbody></table></div><p className="muted">«Tras reserva» corresponde a cada cuenta. Las compras pendientes y los adelantos a socios se descuentan una sola vez en el disponible global.</p>{data.cuentas.some(c=>c.estado_saldo!=='conciliado')?<Notice>Hay cuentas pendientes de conciliar. Sus importes siguen siendo provisionales hasta contrastarlos con el banco.</Notice>:null}</>:query.isPending?<p role="status">Cargando cuentas…</p>:query.error?<p className="g-empty">Las cuentas no están disponibles en este momento. Puedes reintentar la consulta.</p>:<p className="g-empty">No hay cuentas en esta moneda. Añade una cuenta y su saldo inicial para empezar a controlar los fondos.</p>}
   {query.error?<button type="button" className="btn alt" onClick={()=>void query.refetch()} disabled={query.isFetching}>Reintentar consulta</button>:null}
  </Card>
  {data?<>
   <div className="g-credit-grid"><Card title="Destino por negocio" action={<label>Importes del gráfico<select value={medida} onChange={e=>setMedida(e.target.value as Medida)}>{Object.entries(medidas).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>}><div className="g-chart">{values.some(n=>n[medida]>0)?values.map(n=><div className="g-chart-row" key={n.negocio}><span>{negocios[n.negocio]}</span><meter value={n[medida]} min={0} max={max} aria-label={`${medidas[medida]} de ${negocios[n.negocio]} (${moneda})`}/><Money value={n[medida]} moneda={moneda}/></div>):<p className="g-empty">No hay {medidas[medida].toLocaleLowerCase('es-ES')} en esta moneda.</p>}</div><p className="muted">Las compras realizadas muestran su valor real. «Pagado» incluye pagos desde cuentas y adelantos de socios; no es beneficio ni dinero repartible.</p><Link to="/compras">Abrir el detalle de las compras →</Link></Card>
    <Card title="Adelantos de socios"><div className="g-metrics"><div><strong><Money value={data.totales.saldo_socios} moneda={moneda}/></strong><span>pendiente de devolver</span></div></div>{data.socios.length?<div className="g-table"><table><caption className="g-sr-only">Dinero personal adelantado y reembolsado a los socios</caption><thead><tr><th>Socio</th><th>Adelantado</th><th>Devuelto</th><th>Pendiente</th></tr></thead><tbody>{data.socios.map(s=><tr key={s.email}><td>{s.nombre}</td><td><Money value={s.adelantado} moneda={moneda}/></td><td><Money value={s.reembolsado} moneda={moneda}/></td><td><Money value={s.saldo} moneda={moneda}/></td></tr>)}</tbody></table></div>:<p className="g-empty">No hay adelantos personales registrados en esta moneda.</p>}<Notice>Hacer una compra con la cuenta común no genera una deuda con quien compró. Aquí aparecen únicamente pagos realizados con dinero personal de un socio.</Notice></Card></div>
  </>:null}
 </>;
}
