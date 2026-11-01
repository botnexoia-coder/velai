import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { Card, ErrorBox, Money, Notice, useGestion, hoy, type ResumenPrestamo } from './shared';
import type { FondoEquipo } from './equipo';

interface Fondos {
 cuentas:{id:string;nombre:string;saldo:number;conciliada:number}[];
 prestamos:{id:string;nombre:string;desembolsado:number}[];
 totales:{saldo:number;reservas:number;compromisos_pendientes:number;saldo_socios:number;disponible_tras_compromisos:number};
}

export function DashboardFinanzas(){
 const fondos=useGestion<Fondos>('resumen?moneda=EUR'),equipo=useGestion<FondoEquipo>('equipo-prestamos');
 const creditos=useQueries({queries:(fondos.data?.prestamos||[]).filter(p=>p.desembolsado>0).map(p=>({queryKey:['gestion',`prestamos/${p.id}/resumen`],queryFn:()=>api<ResumenPrestamo>(`/api/admin/gestion/prestamos/${p.id}/resumen`)}))});
 const data=fondos.data,total=data?.totales,now=hoy();
 const next=new Date(`${now}T12:00:00`);next.setDate(next.getDate()+30);const end=next.toLocaleDateString('sv-SE');
 const cuotas=creditos.flatMap(q=>q.data?.calendario.filter(c=>c.fecha&&c.fecha<=end&&c.cuota>c.pagado).map(c=>({nombre:q.data!.prestamo.nombre,fecha:c.fecha!,importe:c.cuota-c.pagado}))||[]).sort((a,b)=>a.fecha.localeCompare(b.fecha));
 const sinFecha=creditos.some(q=>q.data?.calendario.some(c=>!c.fecha&&c.cuota>c.pagado));
 const porPagar=cuotas.reduce((s,c)=>s+c.importe,0),listo=!!data&&creditos.every(q=>q.isSuccess)&&!sinFecha;
 const cubierto=listo&&total!.saldo-total!.compromisos_pendientes-total!.saldo_socios>=Math.max(total!.reservas,porPagar);
 const disponible=equipo.data?Math.max(0,Math.min(equipo.data.resumen.disponible_limite,equipo.data.capacidad.disponible)):undefined;
 return <div className="gestion fin-dashboard">
  <p className="fin-intro">Cómo está nuestro dinero, qué pagos vienen y cuánto podemos prestar sin depender de las devoluciones. Tesorería en EUR · todos los registros.</p>
  <ErrorBox error={fondos.error||equipo.error||creditos.find(q=>q.error)?.error}/>
  {fondos.isPending?<p role="status">Cargando tesorería…</p>:null}
  <div className="fin-dashboard-metrics">
   <Card title="Dinero en cuentas"><strong className="fin-big"><Money value={total?.saldo}/></strong><p>Saldo registrado; comprueba la conciliación de cada cuenta.</p></Card>
   <Card title="Reserva de cuotas"><strong className="fin-big"><Money value={total?.reservas}/></strong><p>Fondos protegidos para devolver los créditos recibidos.</p></Card>
   <Card title="Pendiente del equipo"><strong className="fin-big"><Money value={equipo.data?.resumen.pendiente}/></strong><p>Capital por recuperar. No se cuenta como efectivo disponible.</p></Card>
   <Card title="Capacidad del piloto"><strong className="fin-big"><Money value={disponible}/></strong><p>Según liquidez y límites individuales de 500 €. Cada solicitud vuelve a validarse.</p></Card>
  </div>
  <div className="fin-roadmap">
   <Card title="¿Y si las devoluciones se retrasan 30 días?">
    {!listo?<p>{sinFecha?'Evaluación incompleta: hay cuotas sin fecha confirmada.':'Evaluación pendiente de cargar los créditos y sus calendarios.'}</p>:<><p className={`fin-stress ${cubierto?'':'is-warning'}`}>{cubierto?'Las obligaciones registradas mantienen cobertura con el saldo actual.':'La cobertura registrada es insuficiente. Revisa las cuotas y compromisos antes de prestar.'}</p><p>Cuotas vencidas y de los próximos 30 días: <Money value={porPagar}/>.</p></>}
    <Notice>Esta comprobación no suma devoluciones ni ingresos futuros. Usa obligaciones registradas; no garantiza cubrir pagos todavía sin registrar ni sustituye el extracto bancario.</Notice>
    <Link to="/credito?vista=amortizacion">Revisar créditos recibidos →</Link>
   </Card>
   <Card title="De saldo a fondos disponibles">
    {total?<dl className="g-definition"><div><dt>Saldo registrado</dt><dd><Money value={total.saldo}/></dd></div><div><dt>Reserva protegida</dt><dd>− <Money value={total.reservas}/></dd></div><div><dt>Compras comprometidas</dt><dd>− <Money value={total.compromisos_pendientes}/></dd></div><div><dt>Adelantos que debemos al equipo</dt><dd>− <Money value={total.saldo_socios}/></dd></div><div><dt>Disponible tras obligaciones</dt><dd><Money value={total.disponible_tras_compromisos}/></dd></div></dl>:<p>Esperando datos de fondos.</p>}
    <p className="muted">El capital entregado al equipo ya ha salido de caja; no se descuenta por segunda vez.</p><Link to="/credito?vista=destino">Ver cuentas y fondos →</Link>
   </Card>
  </div>
  <div className="fin-roadmap"><Card title="Próximos pagos del crédito recibido">
   {listo?cuotas.length?<ul className="fin-due-list">{cuotas.map((c,i)=><li key={`${c.nombre}-${c.fecha}-${i}`}><span>{c.nombre}<small>{c.fecha}{c.fecha<now?' · vencida':''}</small></span><strong><Money value={c.importe}/></strong></li>)}</ul>:<p>Sin cuotas pendientes fechadas en los próximos 30 días.</p>:<p>Calendario pendiente de consultar.</p>}
   {creditos.some(q=>q.data?.calendario.some(c=>!c.fecha&&c.cuota>c.pagado))?<Notice>Hay cuotas sin fecha confirmada. La previsión está incompleta.</Notice>:null}
  </Card><Card title="Devoluciones del equipo">
   {equipo.data?equipo.data.items.filter(p=>['vigente','vencido'].includes(p.estado)).length?<ul className="fin-due-list">{equipo.data.items.filter(p=>['vigente','vencido'].includes(p.estado)).sort((a,b)=>a.vencimiento.localeCompare(b.vencimiento)).map(p=><li key={p.id}><span>{p.titulo}<small>{p.vencimiento}{p.estado==='vencido'?' · vencida':''}</small></span><strong><Money value={p.pendiente}/></strong></li>)}</ul>:<p>No hay préstamos entregados pendientes de devolución.</p>:<p>Esperando datos del equipo.</p>}
   <Link to="/finanzas?tab=prestamos">Gestionar préstamos al equipo →</Link>
  </Card></div>
  {data?<Card title="Distribución del saldo registrado por cuenta"><div className="g-chart">{data.cuentas.length?data.cuentas.map(c=><div className="g-chart-row" key={c.id}><span>{c.nombre}<small>{c.conciliada?'Ficha conciliada':'Por conciliar'}</small></span><meter aria-label={`Saldo registrado de ${c.nombre}`} min={Math.min(0,...data.cuentas.map(a=>a.saldo))} max={Math.max(1,...data.cuentas.map(a=>a.saldo))} value={c.saldo}/><Money value={c.saldo}/></div>):<p>Sin cuentas EUR registradas.</p>}</div></Card>:null}
 </div>;
}
