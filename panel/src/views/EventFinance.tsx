import { useState } from 'react';
import { Link } from 'react-router';
import { useMe, useFinConceptos } from '../hooks/queries';
import { MOBILE_PREVIEW } from '../mobilePreview';
import { useToast } from '../components/Toasts';
import { ComprasPanel } from './gestion/Compras';
import { Card, ErrorBox, Fields, FormModal, Money, Notice, amount, hoy, opt, str, useGestion, useGuardar, type Catalogos, type Compra, type Moneda } from './gestion/shared';

interface EventTotals {
  proyectado:number; realizado:number; pagado_proveedores:number; pendiente_proveedores:number;
  desembolsado_fondo_comun:number; ingresos_registrados:number; inversion_pendiente:number;
  saldo_proyectado:number; gastos_operativos_manuales:number; gastos_sin_cuenta?:number; anticipos_socios_pendientes?:number;
}
interface EventSummary { evento:{id:string;name:string;tenant_id:string};items:Compra[];monedas:Record<Moneda,EventTotals>;mas?:boolean }

export function EventFinance({eventId}:{eventId:string}) {
  const me=useMe();
  if (me.error) return <ErrorBox error={me.error}/>;
  if (!me.data) return <p role="status">Comprobando acceso…</p>;
  if (me.data.role!=='velai'||me.data.socio!==true) return null;
  return <EventFinanceBody key={eventId} eventId={eventId}/>;
}
function EventFinanceBody({eventId}:{eventId:string}) {
  const query=useGestion<EventSummary>(`eventos/${encodeURIComponent(eventId)}/resumen`);
  const [income,setIncome]=useState(false);
  const totals=query.data?.monedas.EUR;
  return <section className="gestion" aria-label="Presupuesto del evento">
    <div className="g-toolbar"><div><h2>Presupuesto y gastos</h2><p className="muted">Solo este evento. La producción habitual de Diálogos tiene su propio presupuesto.</p></div>
      {!MOBILE_PREVIEW?<button className="btn" type="button" disabled={!query.data} onClick={()=>setIncome(true)}>Registrar cobro del evento</button>:<span className="muted">Solo lectura</span>}
    </div>
    <ErrorBox error={query.error}/>
    {query.isPending?<p role="status">Cargando presupuesto…</p>:null}
    {totals?<>
      <div className="g-metrics">
        <div><strong><Money value={totals.proyectado}/></strong><span>presupuesto total previsto</span></div>
        <div><strong><Money value={totals.realizado}/></strong><span>compras y gastos realizados</span></div>
        <div><strong><Money value={totals.desembolsado_fondo_comun}/></strong><span>adelantado por el fondo común</span></div>
        <div><strong><Money value={totals.ingresos_registrados}/></strong><span>cobros del evento registrados</span></div>
        <div><strong><Money value={totals.inversion_pendiente}/></strong><span>adelanto pendiente de cubrir con cobros</span></div>
        <div><strong><Money value={Math.max(0,-totals.saldo_proyectado)}/></strong><span>presupuesto por cubrir con cobros</span></div>
      </div>
      {(totals.gastos_sin_cuenta||0)>0?<Notice>Hay <Money value={totals.gastos_sin_cuenta}/> de gastos sin cuenta asignada. Se incluyen en el presupuesto, pero no se atribuyen al fondo común.</Notice>:null}
      {(totals.anticipos_socios_pendientes||0)>0?<Notice>Pendiente de devolver a socios: <Money value={totals.anticipos_socios_pendientes}/>. Sus adelantos personales se gestionan aparte del dinero de la cuenta común.</Notice>:null}
      <Card title="Dinero del evento">
        <p>Los pagos del evento usan la caja general una sola vez. Aquí se agrupan como adelantos del fondo común; no se crea otro préstamo ni otra salida de dinero.</p>
        <p>Los cobros que registremos cubren primero esos adelantos. El capital del préstamo y las cuotas del banco siguen en <Link to="/credito">Crédito y fondos</Link>.</p>
        <div className="g-metrics"><div><strong><Money value={totals.pagado_proveedores}/></strong><span>pagos de compras a proveedores</span></div><div><strong><Money value={totals.pendiente_proveedores}/></strong><span>pendiente a proveedores por compromisos y compras</span></div><div><strong><Money value={totals.gastos_operativos_manuales}/></strong><span>otros gastos registrados del evento</span></div></div>
        <Notice>Las reservas cotizadas no son cobros del libro. «Hecho» indica que el trabajo se realizó; los pagos se registran por separado.</Notice>
      </Card>
    </>:null}
    <ComprasPanel eventoId={eventId}/>
    {income&&query.data?<EventIncome eventId={eventId} close={()=>setIncome(false)}/>:null}
  </section>;
}
function EventIncome({eventId,close}:{eventId:string;close:()=>void}) {
  const catalogo=useFinConceptos(), accounts=useGestion<Catalogos>('catalogos'), save=useGuardar(),toast=useToast();
  const conceptos=(catalogo.data?.conceptos.ingreso||[]).filter(c=>!c.clave?.startsWith('g_'));
  const selected=conceptos.find(c=>c.nombre==='Otros ingresos')?.id||conceptos[0]?.id;
  return <FormModal title="Registrar cobro del evento" close={close} fields={[
    {name:'fecha',label:'Fecha del cobro',type:'date',value:hoy(),required:true,max:hoy()},
    {name:'importe',label:'Importe cobrado (EUR)',required:true},
    {name:'nota',label:'Referencia del cobro',type:'textarea'},
  ]} submit={async (d,id)=>{
    const concepto=Number(str(d,'concepto_id'));
    if (!conceptos.some(c=>c.id===concepto)) throw new Error('concepto_invalido');
    await save.mutateAsync({path:`eventos/${encodeURIComponent(eventId)}/cobros`,body:{id,fecha:str(d,'fecha'),importe:amount(d,'importe'),concepto_id:concepto,cuenta_id:opt(d,'cuenta_id'),nota:opt(d,'nota')}});
    toast('Cobro del evento registrado');
  }}>
    <Fields fields={[
      {name:'concepto_id',label:'Concepto del ingreso',value:selected,required:true,options:conceptos.map(c=>({value:String(c.id),label:c.nombre}))},
      {name:'cuenta_id',label:'Cuenta donde entró el dinero',required:true,options:[{value:'',label:'Seleccionar cuenta'},...(accounts.data?.cuentas||[]).filter(c=>c.moneda==='EUR').map(c=>({value:c.id,label:c.nombre}))]},
    ]}/><ErrorBox error={catalogo.error||accounts.error}/>
    <Notice>Registra únicamente dinero recibido y comprobado. Esta operación aumenta la caja y se asigna a este evento.</Notice>
  </FormModal>;
}
