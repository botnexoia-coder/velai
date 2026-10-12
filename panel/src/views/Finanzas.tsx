import { adminReadHref } from '../mobilePreview';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { qs } from '../api/client';
import { traducir } from '../api/errors';
import type { FinConcepto, FinCuenta, FinMoneda, FinNaturaleza, FinMovimiento, FinMovimientoInput, FinRepartoInput, FinResumen, FinSocio, FinSocioInput, FinSocioRegistro, FinTipo, FinTraspasoInput, TenantRow } from '../api/types';
import { confirmar } from '../components/Confirmar';
import { TenantChip } from '../components/Pills';
import { useToast } from '../components/Toasts';
import { useMe, useTenants, useEvents, useFinConceptos, useFinMovimientos, useFinMutacion, useFinRepartos, useFinResumen, useFinSocios, useFinCuentas, useFinTraspasos, useFinTraspasoReverso, type FinFilters } from '../hooks/queries';
import { finDinero, finImporte } from '../lib/format';
import { Documentos } from './gestion/shared';

const TIPOS: FinTipo[] = ['ingreso', 'gasto', 'egreso'];
const MONEDAS: FinMoneda[] = ['EUR', 'COP'];
const NATURALEZAS: Record<FinNaturaleza,string> = {operativo:'Operación del negocio',financiacion:'Préstamos y capital',financiero:'Costes del crédito',compra:'Pagos de compras',reembolso_socio:'Reembolsos a socios'};
const LABEL: Record<FinTipo, string> = { ingreso: 'Ingreso', gasto: 'Gasto', egreso: 'Egreso' };
const ERRORS: Record<string, string> = {
  concepto_duplicado: 'Ya existe un concepto con ese nombre en este tipo.',
  concepto_en_uso: 'Este concepto tiene movimientos. Puedes desactivarlo para conservar el histórico.',
  concepto_inactivo: 'Este concepto está desactivado. Elige otro concepto.',
  concepto_de_otro_tipo: 'El concepto debe pertenecer al tipo del movimiento.',
  concepto_reparto_no_disponible: 'Falta el concepto de reparto en el catálogo. Restáuralo antes de repartir.',
  concepto_del_sistema: 'Este concepto lo usan los repartos: puedes moverlo de sitio, pero no renombrarlo ni desactivarlo.',
  reparto_vacio: 'Pon el importe de al menos un socio. Las líneas en blanco se ignoran.',
  importe_invalido: 'Introduce un importe positivo: hasta dos decimales en EUR y pesos enteros en COP.',
  fecha_invalida: 'La fecha debe ser real, desde 2025 y como máximo mañana.',
  linea_de_reparto: 'Esta línea pertenece a un reparto. Borra el reparto completo y vuelve a registrarlo.',
  beneficiario_desconocido: 'Ese correo ya no pertenece a la lista de socios. Actualiza la página.',
  socio_duplicado: 'Ya hay un socio con ese correo. Si está inactivo, puedes reactivarlo.',
  email_invalido: 'Introduce un correo electrónico válido.',
  nombre_invalido: 'Introduce un nombre de hasta 120 caracteres.',
  movimiento_de_gestion: 'Este movimiento se conserva desde Crédito o Compras. Corrige la operación de origen.',
  cuenta_desconocida: 'La cuenta seleccionada ya no está disponible. Revisa las cuentas del proyecto.',
  cuenta_no_encontrada: 'La cuenta seleccionada ya no está disponible. Revisa las cuentas del proyecto.',
  moneda_distinta: 'La cuenta debe usar la misma moneda que el movimiento.',
  cuenta_moneda_distinta: 'La cuenta debe usar la misma moneda que el movimiento.',
  concepto_gestion_no_manual: 'Registra esta operación desde Crédito o Compras para conservar su trazabilidad.',
  conciliacion_solo_gasto_manual: 'La conciliación solo se activa en gastos manuales.',
  conciliacion_cuenta_requerida: 'Selecciona la cuenta del proyecto desde la que se devolvió el dinero.',
  conciliacion_pendiente_con_cuenta: 'Mientras el reembolso esté pendiente, la cuenta debe quedar sin asignar.',
  conciliacion_fecha_anterior: 'La devolución no puede tener una fecha anterior al gasto.',
  conciliacion_invalida: 'Revisa el estado, la persona y la cuenta de la conciliación.',
  traspaso_misma_cuenta: 'El origen y el destino del traspaso deben ser cuentas distintas.',
  traspaso_invalido: 'El traspaso no coincide con las cuentas o la moneda seleccionadas.',
  traspaso_inmutable: 'Los traspasos no se editan: anula el original y registra uno nuevo.',
  traspaso_ya_revertido: 'Este traspaso ya está anulado.',
  fecha_anterior: 'La anulación no puede tener una fecha anterior al traspaso.',
};
const mensaje = (e: unknown) => ERRORS[e instanceof Error ? e.message : ''] || traducir(e);
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function periodo(value: string): FinFilters {
  if (value === 'todo') return {};
  const d = new Date(), y = d.getFullYear(), m = value === 'año' ? 1 : value === 'trimestre' ? Math.floor(d.getMonth() / 3) * 3 + 1 : d.getMonth() + 1;
  const finMes = value === 'año' ? 12 : value === 'trimestre' ? m + 2 : m;
  return { desde: `${y}-${String(m).padStart(2, '0')}-01`, hasta: `${y}-${String(finMes).padStart(2, '0')}-${new Date(y, finMes, 0).getDate()}` };
}
function ErrorFin({ error }: { error: unknown }) { return error ? <p className="error" role="alert">{mensaje(error)}</p> : null; }
function TipoPill({ tipo, naturaleza }: { tipo: FinTipo; naturaleza?:FinNaturaleza }) { return <span className={`pill fin-${tipo}`}>{naturaleza === 'financiacion' ? 'Financiación' : naturaleza === 'reembolso_socio' ? 'Reembolso a socio' : naturaleza === 'financiero' ? 'Gasto financiero' : naturaleza === 'compra' ? 'Pago de compra' : LABEL[tipo]}</span>; }
function importeFirmado(m:FinMovimiento) { return m.importe * (m.signo ?? 1); }
function origenMovimiento(m:FinMovimiento) {
  const credito=m.origen_tipo?.startsWith('prestamo_') || (m.origen_tipo==='reverso' && (m.naturaleza==='financiacion'||m.naturaleza==='financiero'));
  return credito ? {ruta:'/credito',nombre:'Crédito'} : {ruta:'/compras',nombre:'Compras'};
}
function Dinero({ value, moneda }: { value: number; moneda: FinMoneda }) { return <span className={`fin-money${value < 0 ? ' fin-negative' : ''}`}>{finDinero(value, moneda)}</span>; }

export function Finanzas() {
  const me = useMe();
  if (me.error) return <ErrorFin error={me.error} />;
  if (!me.data) return <p role="status">Cargando…</p>;
  if (me.data.role !== 'velai' || me.data.socio !== true) return <Navigate to="/" replace />;
  // Los hooks del libro solo se montan tras confirmar ambas condiciones de acceso.
  return <FinanzasSocio />;
}
function FinanzasSocio() {
  const [params, setParams] = useSearchParams();
  const tab = ['traspasos', 'repartos', 'conceptos', 'socios'].includes(params.get('tab') || '') ? params.get('tab')! : 'movimientos';
  const [p, setP] = useState('mes');
  const [custom, setCustom] = useState<FinFilters>(periodo('mes'));
  const dates = p === 'personalizado' ? custom : periodo(p);
  const [f, setF] = useState<FinFilters>({});
  const filters = { ...dates, ...f };
  const resumen = useFinResumen(filters, tab === 'movimientos');
  return <div className="finanzas">
    <div className="vhead"><div><h1>Finanzas</h1><p>Operación, financiación y compras: cada importe en su lugar.</p></div></div>
    <nav className="fin-tabs" aria-label="Secciones de Finanzas">
      {['movimientos', 'traspasos', 'repartos', 'conceptos', 'socios'].map((t) => <button type="button" key={t} className={`btn ${tab === t ? '' : 'alt'}`} aria-pressed={tab === t} onClick={() => setParams((prev) => { const next = new URLSearchParams(prev); next.set('tab', t); return next; })}>{t[0]!.toUpperCase() + t.slice(1)}</button>)}
    </nav>
    {tab === 'movimientos' ? <>
      <FiltrosFin f={f} setF={setF} />
      <div className="fin-overview">
        <div className="fin-period"><label>Periodo<select value={p} onChange={(e) => setP(e.target.value)}><option value="mes">Mes actual</option><option value="trimestre">Trimestre actual</option><option value="año">Año actual</option><option value="todo">Todo</option><option value="personalizado">Elegir fechas</option></select></label>
          {p === 'personalizado' ? <><label>Desde<input type="date" value={custom.desde || ''} onChange={(e) => setCustom({ ...custom, desde: e.target.value })} /></label><label>Hasta<input type="date" value={custom.hasta || ''} onChange={(e) => setCustom({ ...custom, hasta: e.target.value })} /></label></> : null}
          <p className="muted">El resultado usa el periodo y los filtros seleccionados.<br />La caja y las obligaciones muestran todo el histórico.</p>
        </div>
        <div className="fin-currencies">
          {MONEDAS.filter(moneda => !f.moneda || f.moneda === moneda).map((moneda) => <ResumenMoneda key={moneda} moneda={moneda} resumen={resumen.data} />)}
        </div>
      </div>
      <ErrorFin error={resumen.error} />
      <p className="muted">Un gasto pagado con crédito sigue siendo gasto; el préstamo financia la caja. El resultado del libro no incluye compras, amortizaciones ni operaciones todavía sin registrar. Consulta <Link to="/credito?vista=destino">Fondos del proyecto</Link> para ver cuentas, reservas y compromisos.</p>
      <Movimientos filters={filters} />
      {resumen.data ? <details className="fin-breakdown"><summary>Desglose por concepto · periodo y filtros seleccionados</summary><div className="fin-table"><table><thead><tr><th>Concepto</th><th>Tipo</th><th>Moneda</th><th>Importe</th></tr></thead><tbody>{resumen.data.conceptos.map((r) => <tr key={`${r.concepto_id}-${r.moneda}-${r.naturaleza||'operativo'}`}><td>{r.nombre}</td><td><TipoPill tipo={r.tipo} naturaleza={r.naturaleza} /></td><td>{r.moneda}</td><td><Dinero value={r.importe} moneda={r.moneda} /></td></tr>)}</tbody></table></div>{!resumen.data.conceptos.length ? <p className="empty">No hay movimientos en este periodo.</p> : null}</details> : null}
    </> : tab === 'traspasos' ? <Traspasos /> : tab === 'repartos' ? <Repartos /> : tab === 'socios' ? <Socios /> : <Conceptos />}
  </div>;
}
function FiltrosFin({ f, setF }: {f:FinFilters;setF:(next:FinFilters)=>void}) {
  const conceptos=useFinConceptos(true), tenants=useTenants(true), events=useEvents();
  return <><div className="fin-toolbar fin-shared-filters"><div className="fin-filters">
    <label>Tipo<select value={f.tipo || ''} onChange={e=>setF({...f,tipo:e.target.value,concepto:''})}><option value="">Todos los tipos</option>{TIPOS.map(t=><option key={t} value={t}>{LABEL[t]}</option>)}</select></label>
    <label>Moneda<select value={f.moneda || ''} onChange={e=>setF({...f,moneda:e.target.value})}><option value="">EUR y COP</option>{MONEDAS.map(m=><option key={m}>{m}</option>)}</select></label>
    <label>Clasificación<select value={f.naturaleza || ''} onChange={e=>setF({...f,naturaleza:e.target.value})}><option value="">Todas las operaciones</option>{Object.entries(NATURALEZAS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label>Concepto<select value={f.concepto || ''} onChange={e=>setF({...f,concepto:e.target.value})}><option value="">Todos los conceptos</option>{TIPOS.filter(t=>!f.tipo||t===f.tipo).flatMap(t=>conceptos.data?.conceptos[t]||[]).map(c=><option key={c.id} value={c.id}>{c.nombre}{c.activo?'':' (inactivo)'}</option>)}</select></label>
    <label>Cliente<select value={f.tenant || ''} onChange={e=>setF({...f,tenant:e.target.value})}><option value="">Todos los clientes</option>{tenants.data?.tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <label>Evento<select value={f.evento || ''} onChange={e=>setF({...f,evento:e.target.value})}><option value="">Todos los eventos y producción</option>{events.data?.events?.map(event=><option key={event.id} value={event.id}>{event.tenant_name?`${event.tenant_name} · `:''}{event.name}</option>)}</select></label>
    {Object.values(f).some(Boolean)?<button className="btn alt" type="button" onClick={()=>setF({})}>Limpiar filtros</button>:null}
  </div></div><ErrorFin error={conceptos.error||tenants.error||events.error}/></>;
}
function MetricaFin({label,value,moneda}:{label:string;value:number|undefined;moneda:FinMoneda}) {
  return <div><span>{label}</span><strong>{value===undefined?'—':<Dinero value={value} moneda={moneda}/>}</strong></div>;
}
function ResumenMoneda({moneda,resumen}:{moneda:FinMoneda;resumen:FinResumen|undefined}) {
  const d=resumen?.desglose?.[moneda], a=resumen?.acumulado?.[moneda], o=resumen?.obligaciones?.[moneda], t=resumen?.tesoreria?.[moneda], legacy=resumen?.monedas[moneda];
  return <section className="fin-currency" aria-label={`Resumen ${moneda}`}>
    <h2>{moneda} <small>{moneda==='EUR'?'Euros':'Pesos colombianos'}</small></h2>
    <h3 className="fin-block-title">Operación <small>· periodo y filtros</small></h3>
    <div className="fin-metrics">
      <MetricaFin label="Cobros del negocio" value={d?.ingresos_operativos??legacy?.ingresos} moneda={moneda}/>
      <MetricaFin label="Gastos operativos" value={d?.gastos_operativos??legacy?.gastos} moneda={moneda}/>
      <MetricaFin label="Resultado operativo" value={d?.resultado_operativo??legacy?.beneficio} moneda={moneda}/>
      <MetricaFin label="Costes del crédito" value={d?.gastos_financieros} moneda={moneda}/>
    </div>
    {d?<div className="fin-result"><span>Resultado tras costes financieros</span><strong><Dinero value={d.resultado_tras_financieros} moneda={moneda}/></strong><small>Resultado registrado; el préstamo recibido no es una venta.</small></div>:null}
    <h3 className="fin-block-title">Caja y financiación <small>· todo el histórico</small></h3>
    <div className="fin-metrics">
      <MetricaFin label="Préstamos recibidos" value={a?.financiacion_entradas??resumen?.financiacion?.[moneda]?.entradas} moneda={moneda}/>
      <MetricaFin label="Capital devuelto" value={a?.financiacion_salidas??resumen?.financiacion?.[moneda]?.salidas} moneda={moneda}/>
      <MetricaFin label="Pagos de compras desde cuentas" value={a?.compras_pagadas} moneda={moneda}/>
      <MetricaFin label="Reembolsos a socios" value={a?.reembolsos_socios} moneda={moneda}/>
      <MetricaFin label="Repartos al equipo" value={a?.repartos} moneda={moneda}/>
      <MetricaFin label="Otros egresos" value={a?.otros_egresos} moneda={moneda}/>
    </div>
    <div className="fin-caja"><span>Saldo total del libro <small>· todo el histórico</small></span><strong>{legacy?<Dinero value={legacy.caja} moneda={moneda}/>:'—'}</strong><small>Suma de movimientos registrados. No equivale al efectivo físico, al saldo bancario conciliado ni al beneficio repartible.</small></div>
    {t?<div className="fin-treasury" aria-label={`Ubicación del dinero ${moneda}`}>
      <h4>¿Dónde está registrado el dinero?</h4>
      {t.cuentas.map(q=><div className="fin-treasury-row" key={q.id}><span>{q.nombre}<small>{q.conciliada?'Saldo conciliado':'Pendiente de conciliar con extracto'}</small></span><strong><Dinero value={q.saldo} moneda={moneda}/></strong></div>)}
      <div className={`fin-treasury-row${t.sin_cuenta?' is-pending':''}`}><span>Movimientos sin cuenta asignada<small>{t.movimientos_sin_cuenta} movimiento(s): confirma si pertenecen a efectivo, banco o fondos personales.</small></span><strong><Dinero value={t.sin_cuenta} moneda={moneda}/></strong></div>
      {t.conciliaciones_pendientes?<div className="fin-treasury-row is-pending"><span>Pagado por personas · por devolver<small>{t.conciliaciones_pendientes} conciliación(es) pendiente(s). Es una deuda con el equipo, no dinero que haya salido todavía de una cuenta del proyecto.</small></span><strong><Dinero value={t.pendiente_socios} moneda={moneda}/></strong></div>:null}
      <div className="fin-treasury-row fin-treasury-total"><span>Fondos ubicados menos anticipos pendientes<small>Debe coincidir con el saldo total del libro cuando todos los movimientos tienen una ubicación.</small></span><strong><Dinero value={t.saldo_neto} moneda={moneda}/></strong></div>
    </div>:null}
    {o?<>
      {o.prestamos_sin_abono.cantidad>0?<p className="fin-warning">Hay {o.prestamos_sin_abono.cantidad} préstamo(s) por <Dinero value={o.prestamos_sin_abono.principal} moneda={moneda}/> sin abono registrado. La caja está incompleta. <Link to="/credito">Revisar crédito</Link></p>:null}
      <details className="fin-obligaciones"><summary>Compras y obligaciones · todo el histórico</summary>
        <div className="fin-metrics">
          <MetricaFin label="Compras realizadas" value={o.compras.adquirido} moneda={moneda}/>
          <MetricaFin label="Pagado a proveedores" value={o.compras.pagado_proveedores} moneda={moneda}/>
          <MetricaFin label="Pendiente a proveedores" value={o.compras.pendiente_proveedores} moneda={moneda}/>
          <MetricaFin label="Pendiente de reembolsar a socios" value={o.socios.pendiente} moneda={moneda}/>
          <MetricaFin label="Capital pendiente de devolver" value={o.prestamos_desembolsados.principal_pendiente} moneda={moneda}/>
        </div><p className="muted">Pagar al proveedor y reembolsar al socio son dos pasos de una misma compra. No se suman como dos gastos.</p><Link to="/compras">Revisar compras</Link>
      </details>
    </>:null}
  </section>;
}
function Movimientos({ filters }: { filters: FinFilters }) {
  const query = useFinMovimientos(filters), conceptos = useFinConceptos(true), tenants = useTenants(true), cuentas = useFinCuentas();
  const [editing, setEditing] = useState<FinMovimiento | 'new' | null>(null);
  const rows = query.data?.pages.flatMap((p) => p.movimientos) || [];
  return <>
    <div className="fin-toolbar">

      <div className="fin-actions"><a className="btn alt" href={adminReadHref(`/api/admin/finanzas/export.csv${qs({ ...filters })}`)} download>Exportar CSV</a><button className="btn" type="button" onClick={() => setEditing('new')}>Registrar movimiento</button></div>
    </div>
    <ErrorFin error={query.error || conceptos.error || tenants.error || cuentas.error} />
    {query.isPending ? <p role="status">Cargando movimientos…</p> : <div className="fin-table"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Cliente</th><th>Cuenta</th><th>Nota</th><th>Importe</th></tr></thead><tbody>
      {rows.map((m) => <tr key={m.id} onClick={() => setEditing(m)}><td>{m.fecha}</td><td><TipoPill tipo={m.tipo} naturaleza={m.naturaleza} />{m.requiere_conciliacion?<small className={`fin-reconciliation-tag ${m.conciliada?'done':'pending'}`}>{m.conciliada?'Conciliado':'Conciliación pendiente'}</small>:null}</td><td><button className="fin-row-open" type="button" onClick={() => setEditing(m)}>{m.concepto_nombre}</button>{m.evento_nombre?<small className="muted"> · {m.evento_nombre}</small>:null}{m.reparto_id ? <small className="muted"> · reparto</small> : null}{m.origen_tipo ? <small className="muted"> · {m.signo === -1 ? 'Reverso · ' : ''}{origenMovimiento(m).nombre}</small> : null}</td><td><TenantChip id={m.tenant_id || undefined} name={m.tenant_name} /></td><td>{m.cuenta_id ? cuentas.data?.cuentas?.find(c=>c.id===m.cuenta_id)?.nombre || 'Cuenta vinculada' : 'Pendiente de asignar'}</td><td className="fin-note">{m.nota || '—'}</td><td><Dinero value={importeFirmado(m)} moneda={m.moneda} /> <small>{m.moneda}</small></td></tr>)}
    </tbody></table>{!rows.length ? <p className="empty">Sin movimientos con estos filtros. Registra el primero para empezar el libro.</p> : null}</div>}
    {query.hasNextPage ? <div className="pager"><button className="btn alt" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Cargar más</button></div> : null}
    {editing ? <MovimientoModal initial={editing === 'new' ? null : editing} tenants={tenants.data?.tenants || []} cuentas={cuentas.data?.cuentas || []} cuentasError={cuentas.error} onClose={() => setEditing(null)} /> : null}
  </>;
}
function Traspasos() {
  const query=useFinTraspasos(), cuentas=useFinCuentas(), reverso=useFinTraspasoReverso(), toast=useToast();
  const [open,setOpen]=useState(false), [error,setError]=useState<unknown>(null);
  async function anular(id:string, fecha:string) {
    if (!await confirmar({titulo:'¿Anular este traspaso?',cuerpo:'Se añadirá un reverso de efecto contrario. El registro original se conservará para auditoría.',accion:'Anular traspaso',peligro:true})) return;
    setError(null);
    try { await reverso.mutateAsync({id,operacionId:crypto.randomUUID(),fecha:hoy(),nota:`Anulación del traspaso del ${fecha}`}); toast('Traspaso anulado sin alterar el resultado'); }
    catch(e){setError(e);}
  }
  const anulados=new Set(query.data?.traspasos.filter(t=>t.reverso_de).map(t=>t.reverso_de) || []);
  return <>
    <div className="fin-toolbar"><div><h2>Traspasos internos</h2><p className="muted">Mueven dinero entre banco y caja física sin crear ingresos ni gastos.</p></div><button className="btn" type="button" disabled={(cuentas.data?.cuentas.length||0)<2} onClick={()=>setOpen(true)}>Nuevo traspaso</button></div>
    <ErrorFin error={query.error||cuentas.error||error}/>
    {cuentas.data&&(cuentas.data.cuentas.length<2)?<p className="fin-warning">Necesitas al menos dos cuentas de la misma moneda. Puedes crear «Caja física» desde <Link to="/credito?vista=destino">Fondos del proyecto</Link>.</p>:null}
    {query.isPending?<p role="status">Cargando traspasos…</p>:<div className="fin-table fin-transfers"><table><thead><tr><th>Fecha</th><th>Origen</th><th>Destino</th><th>Nota</th><th>Importe</th><th>Estado</th></tr></thead><tbody>{query.data?.traspasos.map(t=><tr key={t.id}><td data-label="Fecha">{t.fecha}</td><td data-label="Origen">{t.cuenta_origen_nombre}</td><td data-label="Destino">{t.cuenta_destino_nombre}</td><td data-label="Nota" className="fin-note">{t.nota||'—'}</td><td data-label="Importe"><Dinero value={t.importe*t.signo} moneda={t.moneda}/></td><td data-label="Estado">{t.signo===-1?<span className="pill">Reverso</span>:anulados.has(t.id)?<span className="pill">Anulado</span>:<button className="btn alt btnsm" disabled={reverso.isPending} onClick={()=>void anular(t.id,t.fecha)}>Anular</button>}</td></tr>)}</tbody></table>{query.data&&!query.data.traspasos.length?<p className="empty">Todavía no hay traspasos. Registra aquí los movimientos entre Santander, caja física u otras cuentas.</p>:null}</div>}
    {open?<TraspasoModal cuentas={cuentas.data?.cuentas||[]} onClose={()=>setOpen(false)}/>:null}
  </>;
}
function TraspasoModal({cuentas,onClose}:{cuentas:FinCuenta[];onClose:()=>void}) {
  const mutation=useFinMutacion<FinTraspasoInput>('traspasos'), toast=useToast();
  const operacionId=useRef(crypto.randomUUID());
  const [origen,setOrigen]=useState(cuentas[0]?.id||''), [destino,setDestino]=useState(''), [importe,setImporte]=useState(''), [fecha,setFecha]=useState(hoy()), [nota,setNota]=useState(''), [error,setError]=useState<unknown>(null);
  const cuentaOrigen=cuentas.find(q=>q.id===origen), destinos=cuentas.filter(q=>q.id!==origen&&q.moneda===cuentaOrigen?.moneda);
  const destinoDisponible=destinos.some(q=>q.id===destino), primerDestino=destinos[0]?.id||'';
  useEffect(()=>{if(!destinoDisponible) setDestino(primerDestino);},[destinoDisponible,primerDestino]);
  async function guardar(e:React.FormEvent){
    e.preventDefault();setError(null);
    const valor=cuentaOrigen?finImporte(importe,cuentaOrigen.moneda):null;
    if(!valor){setError(new Error('importe_invalido'));return;}
    try{await mutation.mutateAsync({method:'POST',body:{id:operacionId.current,fecha,importe:valor,cuenta_origen_id:origen,cuenta_destino_id:destino,nota}});toast('Traspaso registrado · impacto en resultado: 0');onClose();}catch(e){setError(e);}
  }
  return <Modal title="Nuevo traspaso interno" close={onClose} busy={mutation.isPending}><form onSubmit={e=>void guardar(e)}><div className="fin-form">
    <label>Fecha<input type="date" min="2025-01-01" max={hoy()} required value={fecha} onChange={e=>setFecha(e.target.value)}/></label>
    <label>Desde<select required value={origen} onChange={e=>setOrigen(e.target.value)}>{cuentas.map(q=><option key={q.id} value={q.id}>{q.nombre} · {q.moneda}</option>)}</select></label>
    <label>Hacia<select required value={destino} onChange={e=>setDestino(e.target.value)}>{destinos.map(q=><option key={q.id} value={q.id}>{q.nombre}</option>)}</select></label>
    <label>Importe ({cuentaOrigen?.moneda||'—'})<input inputMode="decimal" required value={importe} onChange={e=>setImporte(e.target.value)}/></label>
    <label className="fin-full">Nota<textarea rows={2} maxLength={2000} value={nota} onChange={e=>setNota(e.target.value)}/></label>
  </div><p className="fin-reconciliation-status done"><strong>Impacto en resultado: 0</strong><span>Solo cambia dónde está el dinero. No se registrará como ingreso ni como gasto.</span></p><ErrorFin error={error}/><button className="btn" disabled={mutation.isPending||!destino}>Guardar traspaso</button></form></Modal>;
}
function Modal({ title, children, close, busy = false }: { title: string; children: ReactNode; close: () => void | Promise<void>; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="fin-modal" aria-label={title} onCancel={(e) => { e.preventDefault(); if (!busy) void close(); }}><div className="modal-h"><strong>{title}</strong><button className="btn alt" type="button" disabled={busy} onClick={() => void close()}>Cerrar</button></div><div className="modal-b">{children}</div></dialog>;
}
function MovimientoModal({ initial, tenants, cuentas, cuentasError, onClose }: { initial: FinMovimiento | null; tenants: TenantRow[]; cuentas:FinCuenta[]; cuentasError:unknown; onClose: () => void }) {
  const catalogo = useFinConceptos(), socios=useFinSocios(), mutation = useFinMutacion<Partial<FinMovimientoInput>>('movimientos'), toast = useToast();
  const [tipo, setTipo] = useState<FinTipo>(initial?.tipo || 'ingreso');
  const [concepto, setConcepto] = useState(String(initial?.concepto_id || ''));
  const [fecha, setFecha] = useState(initial?.fecha || hoy()), [moneda, setMoneda] = useState<FinMoneda>(initial?.moneda || 'EUR');
  const [importe, setImporte] = useState(initial ? String(initial.importe / (initial.moneda === 'EUR' ? 100 : 1)) : '');
  const [nota, setNota] = useState(initial?.nota || ''), [tenant, setTenant] = useState(initial?.tenant_id || '');
  const [cuenta,setCuenta]=useState(initial?.cuenta_id || '');
  const [requiereConciliacion,setRequiereConciliacion]=useState(Boolean(initial?.requiere_conciliacion));
  const [conciliacionSocio,setConciliacionSocio]=useState(initial?.conciliacion_socio || '');
  const [conciliada,setConciliada]=useState(Boolean(initial?.conciliada));
  const [conciliacionFecha,setConciliacionFecha]=useState(initial?.conciliacion_fecha || hoy());
  const [error, setError] = useState<unknown>(null);
  const opciones = (catalogo.data?.conceptos[tipo] || []).filter(c=>!c.clave?.startsWith('g_'));
  const conceptoId = Number(concepto || opciones[0]?.id || 0);
  const entero = finImporte(importe, moneda);
  const original = {
    tipo: initial?.tipo || 'ingreso' as FinTipo,
    concepto: String(initial?.concepto_id || ''), fecha: initial?.fecha || hoy(),
    moneda: initial?.moneda || 'EUR' as FinMoneda,
    importe: initial ? String(initial.importe / (initial.moneda === 'EUR' ? 100 : 1)) : '',
    nota: initial?.nota || '', tenant: initial?.tenant_id || '', cuenta:initial?.cuenta_id || '',
    requiereConciliacion:Boolean(initial?.requiere_conciliacion),conciliacionSocio:initial?.conciliacion_socio||'',
    conciliada:Boolean(initial?.conciliada),conciliacionFecha:initial?.conciliacion_fecha||hoy(),
  };
  const camposCambiados = Boolean((concepto && concepto !== original.concepto) || fecha !== original.fecha
    || moneda !== original.moneda || importe !== original.importe || nota !== original.nota || tenant !== original.tenant || cuenta !== original.cuenta
    || requiereConciliacion!==original.requiereConciliacion || conciliacionSocio!==original.conciliacionSocio
    || conciliada!==original.conciliada || conciliacionFecha!==original.conciliacionFecha);
  // En un alta vacía se puede explorar Ingreso/Gasto/Egreso sin avisos. En edición,
  // cambiar el tipo sí es una modificación pendiente y debe protegerse al salir.
  const sucio = camposCambiados || Boolean(initial && tipo !== original.tipo);
  async function descartar(motivo: 'tipo' | 'cerrar') {
    if (!sucio) return true;
    return confirmar({
      titulo: motivo === 'tipo' ? '¿Cambiar el tipo de movimiento?' : '¿Cerrar sin guardar?',
      cuerpo: 'Hay cambios sin guardar. Puedes volver para guardarlos; si continúas, se borrarán.',
      accion: motivo === 'tipo' ? 'Descartar y cambiar' : 'Descartar y cerrar',
      cancelar: 'Seguir editando', peligro: true,
    });
  }
  async function cambiarTipo(next: FinTipo) {
    if (next === tipo || !await descartar('tipo')) return;
    setTipo(next); setConcepto(''); setError(null);
    if (sucio) {
      setFecha(original.fecha); setMoneda(original.moneda); setImporte(original.importe);
      setNota(original.nota); setTenant(next === 'egreso' ? '' : original.tenant); setCuenta(original.cuenta);
      setRequiereConciliacion(next==='gasto'&&original.requiereConciliacion);setConciliacionSocio(original.conciliacionSocio);
      setConciliada(next==='gasto'&&original.conciliada);setConciliacionFecha(original.conciliacionFecha);
    } else if (next === 'egreso') setTenant('');
    if(next!=='gasto'){setRequiereConciliacion(false);setConciliacionSocio('');setConciliada(false);}
  }
  async function cerrar() { if (await descartar('cerrar')) onClose(); }
  async function guardar(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!entero) { setError(new Error('importe_invalido')); return; }
    try {
      await mutation.mutateAsync({ method: initial ? 'PATCH' : 'POST', id: initial?.id, body: { tipo, ...(initial ? {} : { moneda }), fecha, concepto_id: conceptoId, importe: entero, nota, tenant_id: tipo === 'egreso' ? null : tenant || null,
        cuenta_id:requiereConciliacion&&!conciliada?null:cuenta||null, requiere_conciliacion:requiereConciliacion,
        conciliacion_socio:requiereConciliacion?conciliacionSocio||null:null,conciliada:requiereConciliacion&&conciliada,
        conciliacion_fecha:requiereConciliacion&&conciliada?conciliacionFecha:null } });
      toast('Movimiento guardado'); onClose();
    } catch (e) { setError(e); }
  }
  async function borrar() {
    if (!initial || !await confirmar({ titulo: '¿Borrar este movimiento?', cuerpo: 'Se recalcularán la caja y el beneficio.', accion: 'Borrar movimiento', peligro: true })) return;
    try { await mutation.mutateAsync({ method: 'DELETE', id: initial.id }); toast('Movimiento borrado'); onClose(); } catch (e) { setError(e); }
  }
  return <Modal title={initial ? 'Detalle del movimiento' : 'Registrar movimiento'} close={cerrar} busy={mutation.isPending}>
    {initial?.origen_tipo ? <><p><TipoPill tipo={initial.tipo} naturaleza={initial.naturaleza} /> {initial.signo === -1 ? '· Reverso' : ''}</p><h2>{initial.concepto_nombre}</h2><p><Dinero value={importeFirmado(initial)} moneda={initial.moneda} /> · {initial.fecha}</p><p>{initial.nota || 'Sin nota adicional'}</p><p className="muted">Cuenta: {cuentas.find(c=>c.id===initial.cuenta_id)?.nombre || 'Cuenta vinculada'}</p><p>Este movimiento se generó desde {origenMovimiento(initial).nombre}. Se conserva en el libro y se corrige desde la operación de origen.</p><Link className="btn" to={origenMovimiento(initial).ruta}>Abrir {origenMovimiento(initial).nombre}</Link></> : initial?.reparto_id ? <><p>Esta línea pertenece a un reparto para {initial.beneficiario}.</p><p><Dinero value={initial.importe} moneda={initial.moneda} /> · {initial.fecha}</p><p>Para corregirla, borra el reparto completo y vuelve a registrarlo.</p><Link className="btn" to="/finanzas?tab=repartos">Ver repartos</Link></> : <form onSubmit={(e) => void guardar(e)}>
      <fieldset disabled={mutation.isPending} className="fin-fieldset"><legend>Tipo de movimiento</legend><div className="fin-segment">{TIPOS.map((t) => <button type="button" key={t} className={`btn ${t === tipo ? '' : 'alt'}`} aria-pressed={t === tipo} onClick={() => void cambiarTipo(t)}>{LABEL[t]}</button>)}</div></fieldset>
      <div className="fin-form"><label>Concepto<select required value={conceptoId || ''} onChange={(e) => setConcepto(e.target.value)} disabled={mutation.isPending || !catalogo.data}>{!opciones.length ? <option value="">No hay conceptos activos</option> : null}{initial && tipo === initial.tipo && !opciones.some((c) => c.id === initial.concepto_id) ? <option value={initial.concepto_id}>{initial.concepto_nombre} (inactivo)</option> : null}{opciones.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <label>Fecha<input type="date" required min="2025-01-01" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <label>Moneda<select disabled={Boolean(initial)} value={moneda} onChange={(e) => { setMoneda(e.target.value as FinMoneda); setImporte(''); setCuenta(''); }}>{MONEDAS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Importe ({moneda})<input required inputMode="decimal" placeholder={moneda === 'EUR' ? '0,00' : '0'} value={importe} onChange={(e) => setImporte(e.target.value)} /><small>{moneda === 'EUR' ? 'Euros, hasta dos decimales' : 'Pesos enteros, sin decimales'}</small></label>
        {tipo !== 'egreso' ? <label>Cliente (opcional)<select value={tenant} disabled={Boolean(initial)} onChange={(e) => setTenant(e.target.value)}><option value="">Sin cliente</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label> : null}
        <label>Cuenta del proyecto {requiereConciliacion&&conciliada?'que hizo el reembolso':'(opcional)'}<select value={cuenta} disabled={mutation.isPending||(requiereConciliacion&&!conciliada)} required={requiereConciliacion&&conciliada} onChange={e=>setCuenta(e.target.value)}><option value="">{requiereConciliacion&&!conciliada?'Se asignará al conciliar':'Pendiente de asignar'}</option>{cuenta&&!cuentas.some(c=>c.id===cuenta)?<option value={cuenta}>Cuenta vinculada (pendiente de cargar)</option>:null}{cuentas.filter(c=>c.moneda===moneda).map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select><small>{requiereConciliacion?'La cuenta se asigna al mismo gasto cuando se devuelve el dinero; no se crea otro movimiento.':'Selecciona dónde entró o salió el dinero. Un histórico sin cuenta conserva esa condición.'}</small></label>
        <label className="fin-full">Nota<textarea maxLength={2000} rows={3} value={nota} onChange={(e) => setNota(e.target.value)} /></label>
      </div>
      {tipo==='gasto'?<fieldset className="fin-reconciliation"><legend>Conciliación del gasto</legend>
        <label><input type="checkbox" checked={requiereConciliacion} onChange={e=>{setRequiereConciliacion(e.target.checked);if(!e.target.checked){setConciliacionSocio('');setConciliada(false);}}}/> ¿Este gasto lo adelantó una persona y necesita conciliación?</label>
        {requiereConciliacion?<><label>¿A quién se le debe o devolvió?<select value={conciliacionSocio} required onChange={e=>setConciliacionSocio(e.target.value)}><option value="">Seleccionar socio</option>{socios.data?.socios.filter(s=>s.activo||s.email===conciliacionSocio).map(s=><option key={s.email} value={s.email}>{s.nombre}</option>)}</select></label>
          <label><input type="checkbox" checked={conciliada} onChange={e=>{setConciliada(e.target.checked);if(!e.target.checked)setCuenta('');}}/> El dinero ya fue devuelto desde una cuenta del proyecto</label>
          {conciliada?<label>Fecha de la devolución<input type="date" min={fecha} max={hoy()} required value={conciliacionFecha} onChange={e=>setConciliacionFecha(e.target.value)}/></label>:null}
          <p className={`fin-reconciliation-status ${conciliada?'done':'pending'}`}><strong>{conciliada?'Conciliación realizada':'Conciliación pendiente'}</strong><span>{conciliada?'El gasto conserva un único impacto. Falta adjuntar el comprobante si aún no aparece debajo.':'El gasto está registrado; todavía no se ha asignado una salida de la cuenta común.'}</span></p></>:null}
      </fieldset>:null}
      {initial ? <p className="muted">Registrado por {initial.created_by} · {initial.created_at.slice(0, 10)}</p> : null}
      <ErrorFin error={error || catalogo.error || socios.error || cuentasError} /><div className="fin-actions"><button className="btn" disabled={mutation.isPending || !catalogo.data || !conceptoId || (requiereConciliacion&&!conciliacionSocio) || (conciliada&&!cuenta)}>Guardar movimiento</button>{initial ? <button className="btn alt" type="button" disabled={mutation.isPending} onClick={() => void borrar()}>Borrar movimiento</button> : null}</div>
      {initial&&requiereConciliacion?<Documentos tipo="movimiento" objetoId={initial.id}/>:null}
    </form>}
  </Modal>;
}
function Repartos() {
  const query = useFinRepartos(), resumen = useFinResumen({}), mutation = useFinMutacion('repartos'), toast = useToast();
  const [open, setOpen] = useState(false), [aviso, setAviso] = useState(false);
  const socios = query.data?.socios || [];
  const historicos = query.data?.repartido || [];
  const personas = [...socios, ...historicos.filter((h, i, arr) => !socios.some((s) => s.email === h.email) && arr.findIndex((s) => s.email === h.email) === i)];
  async function borrar(id: string) {
    if (!await confirmar({ titulo: '¿Borrar el reparto completo?', cuerpo: 'Se borrarán todas sus líneas y el dinero volverá a figurar en caja.', accion: 'Borrar reparto', peligro: true })) return;
    try { await mutation.mutateAsync({ method: 'DELETE', id }); toast('Reparto borrado'); } catch (e) { toast(mensaje(e), false); }
  }
  return <>
    <div className="fin-toolbar"><div><h2>Repartos del equipo</h2><p className="muted">Acumulado por persona · desde el origen</p></div><button className="btn" disabled={!query.data || !resumen.data || !socios.length} onClick={() => setOpen(true)}>Nuevo reparto</button></div>
    <ErrorFin error={query.error || resumen.error} />
    {query.data && !socios.length ? <p className="empty">Añade un socio en la pestaña <Link to="/finanzas?tab=socios">Socios</Link> para registrar repartos.</p> : null}
    {aviso ? <p className="fin-warning" role="alert">Reparto guardado. La caja ha quedado negativa.</p> : null}
    <div className="fin-socios">{personas.map((s) => <article key={s.email} className="fin-persona"><h3>{s.nombre}</h3><small className="muted">{s.email}</small>{MONEDAS.map((m) => <p key={m}><span>{m}</span><Dinero value={historicos.find((r) => r.email === s.email && r.moneda === m)?.importe || 0} moneda={m} /></p>)}</article>)}</div>
    {query.isPending ? <p role="status">Cargando repartos…</p> : null}
    {query.data?.repartos.map((r) => <article className="fin-reparto" key={r.id}><div className="fin-toolbar"><h3>{r.fecha} · {r.moneda} · <Dinero value={r.lineas.reduce((sum, l) => sum + l.importe, 0)} moneda={r.moneda} /></h3><button className="btn alt btnsm" disabled={mutation.isPending} onClick={() => void borrar(r.id)}>Borrar reparto</button></div>{r.nota ? <p>{r.nota}</p> : null}<ul>{r.lineas.map((l) => <li key={l.id}><span>{l.nombre}</span><Dinero value={l.importe} moneda={r.moneda} /></li>)}</ul><small className="muted">Registrado por {r.created_by}</small></article>)}
    {query.data && !query.data.repartos.length ? <p className="empty">Todavía no hay repartos. Cada reparto se registra con sus importes por persona.</p> : null}
    {open && resumen.data ? <RepartoModal socios={socios} resumen={resumen.data} onClose={() => setOpen(false)} onSaved={(negative) => { setAviso(negative); setOpen(false); }} /> : null}
  </>;
}
function RepartoModal({ socios, resumen, onClose, onSaved }: { socios: FinSocio[]; resumen: FinResumen; onClose: () => void; onSaved: (negative: boolean) => void }) {
  const mutation = useFinMutacion<FinRepartoInput>('repartos'), toast = useToast();
  const [fecha, setFecha] = useState(hoy()), [moneda, setMoneda] = useState<FinMoneda>('EUR'), [nota, setNota] = useState('');
  const [lineas, setLineas] = useState(socios.map((s, i) => ({ key: i, beneficiario: s.email, importe: '' })));
  const nextKey = useRef(socios.length), [error, setError] = useState<unknown>(null);
  // Quien no cobra esta vez se deja en blanco: no hay que quitar su línea.
  const llenas = lineas.filter((l) => l.importe.trim());
  const total = llenas.reduce((sum, l) => sum + (finImporte(l.importe, moneda) || 0), 0), despues = resumen.monedas[moneda].caja - total;
  async function guardar(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!llenas.length) { setError(new Error('reparto_vacio')); return; }
    if (llenas.some((l) => !finImporte(l.importe, moneda)) || !Number.isSafeInteger(total)) { setError(new Error('importe_invalido')); return; }
    try {
      const r = await mutation.mutateAsync({ method: 'POST', body: { fecha, moneda, nota, lineas: llenas.map((l) => ({ beneficiario: l.beneficiario, importe: finImporte(l.importe, moneda)! })) } });
      toast('Reparto guardado'); onSaved(r.aviso === 'caja_negativa');
    } catch (e) { setError(e); }
  }
  return <Modal title="Nuevo reparto" close={onClose} busy={mutation.isPending}><form onSubmit={(e) => void guardar(e)}>
    <div className="fin-form"><label>Fecha<input required type="date" min="2025-01-01" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label><label>Moneda<select value={moneda} onChange={(e) => { setMoneda(e.target.value as FinMoneda); setLineas((ls) => ls.map((l) => ({ ...l, importe: '' }))); }}>{MONEDAS.map((m) => <option key={m}>{m}</option>)}</select></label><label className="fin-full">Nota<textarea rows={2} maxLength={2000} value={nota} onChange={(e) => setNota(e.target.value)} /></label></div>
    <p className="muted">Deja el importe en blanco a quien no cobre esta vez: esa línea no se registra.</p>
    <div className="fin-lines">{lineas.map((l, i) => <div className="fin-line" key={l.key}><label>Socio {i + 1}<select value={l.beneficiario} onChange={(e) => setLineas(lineas.map((r) => r.key === l.key ? { ...r, beneficiario: e.target.value } : r))}>{socios.map((s) => <option key={s.email} value={s.email}>{s.nombre}</option>)}</select></label><label>Importe {i + 1} ({moneda})<input inputMode="decimal" value={l.importe} onChange={(e) => setLineas(lineas.map((r) => r.key === l.key ? { ...r, importe: e.target.value } : r))} /></label><button className="btn alt btnsm" type="button" aria-label={`Quitar línea ${i + 1}`} onClick={() => setLineas(lineas.filter((r) => r.key !== l.key))}>Quitar</button></div>)}</div>
    <button className="btn alt" type="button" disabled={lineas.length >= 50} onClick={() => setLineas([...lineas, { key: nextKey.current++, beneficiario: socios[0]!.email, importe: '' }])}>Añadir línea</button>
    <div className="fin-preview" aria-live="polite"><p>Total a repartir <Dinero value={total} moneda={moneda} /></p><p>Queda en caja después <Dinero value={despues} moneda={moneda} /></p>{despues < 0 ? <p className="fin-warning" role="alert">La caja quedará negativa. Puedes guardar el reparto igualmente.</p> : null}</div>
    <ErrorFin error={error} /><button className="btn" disabled={mutation.isPending || !llenas.length}>Guardar reparto</button>
  </form></Modal>;
}
function Conceptos() {
  const query = useFinConceptos(true), mutation = useFinMutacion<Partial<FinConcepto>>('conceptos'), toast = useToast();
  const [tipo, setTipo] = useState<FinTipo>('ingreso'), [nombre, setNombre] = useState(''), [error, setError] = useState<unknown>(null);
  async function add(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try { await mutation.mutateAsync({ method: 'POST', body: { tipo, nombre } }); setNombre(''); toast('Concepto añadido'); } catch (e) { setError(e); }
  }
  return <><h2>Catálogo de conceptos</h2><p className="muted">Cada tipo tiene su propio desplegable. Desactiva un concepto para retirarlo sin perder su histórico.</p>
    <form className="fin-add" onSubmit={(e) => void add(e)}><label>Tipo de concepto<select value={tipo} onChange={(e) => setTipo(e.target.value as FinTipo)}>{TIPOS.map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}</select></label><label>Nuevo concepto<input required maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} /></label><button className="btn" disabled={mutation.isPending}>Añadir concepto</button></form>
    <ErrorFin error={query.error || error} />
    {query.isPending ? <p role="status">Cargando conceptos…</p> : null}
    <div className="fin-catalog">{TIPOS.map((t) => <section key={t} aria-label={`Conceptos de ${LABEL[t].toLowerCase()}`}><h3>{LABEL[t]}s</h3>{query.data?.conceptos[t].map((c, i, rows) => <ConceptoRow key={`${c.id}-${c.nombre}`} concepto={c} prev={rows[i - 1]} next={rows[i + 1]} />)}{query.data && !query.data.conceptos[t].length ? <p className="muted">Sin conceptos.</p> : null}</section>)}</div>
  </>;
}
function ConceptoRow({ concepto: c, prev, next }: { concepto: FinConcepto; prev?: FinConcepto; next?: FinConcepto }) {
  const mutation = useFinMutacion<Partial<FinConcepto>>('conceptos'), toast = useToast();
  const [nombre, setNombre] = useState(c.nombre), [error, setError] = useState<unknown>(null);
  async function change(body: Partial<FinConcepto>) {
    setError(null);
    try { await mutation.mutateAsync({ method: 'PATCH', id: c.id, body }); toast('Concepto actualizado'); } catch (e) { setError(e); }
  }
  async function borrar() {
    if (!await confirmar({ titulo: `¿Borrar «${c.nombre}»?`, cuerpo: 'Si tiene movimientos, podrás desactivarlo y conservar el histórico.', accion: 'Borrar concepto', peligro: true })) return;
    try { await mutation.mutateAsync({ method: 'DELETE', id: c.id }); toast('Concepto borrado'); }
    catch (e) {
      if (e instanceof Error && e.message === 'concepto_en_uso' && await confirmar({ titulo: 'Este concepto tiene movimientos', cuerpo: 'Puedes desactivarlo: desaparecerá del desplegable y seguirá en el histórico.', accion: 'Desactivar' })) await change({ activo: 0 });
      else setError(e);
    }
  }
  // El concepto que firma los repartos se mueve de sitio, pero no se renombra, ni se
  // apaga, ni se borra: el worker lo rechaza y aquí ni se ofrece.
  const sistema = Boolean(c.sistema);
  return <div className={`fin-concepto${c.activo ? '' : ' fin-inactive'}${sistema ? ' fin-sistema' : ''}`}>
    {sistema
      ? <p className="fin-fijo"><strong>{c.nombre}</strong><small className="muted">{c.clave?.startsWith('g_') ? 'Lo usan Crédito y Compras: no se renombra ni se desactiva.' : 'Lo usan los repartos del equipo: no se renombra ni se desactiva.'}</small></p>
      : <form onSubmit={(e) => { e.preventDefault(); void change({ nombre }); }}><input aria-label={`Nombre de ${c.nombre}`} required maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} /><button className="btn alt btnsm" disabled={mutation.isPending || nombre === c.nombre}>Guardar</button></form>}
    <div className="fin-concept-actions"><span className="muted">{c.activo ? 'Activo' : 'Inactivo'}</span><button className="btn alt btnsm" aria-label={`Subir ${c.nombre}`} disabled={mutation.isPending || !prev} onClick={() => void change({ position: prev!.position })}>↑</button><button className="btn alt btnsm" aria-label={`Bajar ${c.nombre}`} disabled={mutation.isPending || !next} onClick={() => void change({ position: next!.position })}>↓</button>
      {sistema ? null : <><button className="btn alt btnsm" disabled={mutation.isPending} onClick={() => void change({ activo: c.activo ? 0 : 1 })}>{c.activo ? 'Desactivar' : 'Activar'}</button><button className="btn alt btnsm" disabled={mutation.isPending} onClick={() => void borrar()}>Borrar</button></>}</div>
    <ErrorFin error={error} />
  </div>;
}

function Socios() {
  const query = useFinSocios();
  const mutation = useFinMutacion<Partial<FinSocioInput>>('socios');
  const toast = useToast();
  const [editing, setEditing] = useState<FinSocioRegistro | 'new' | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function quitar(socio: FinSocioRegistro) {
    if (!await confirmar({
      titulo: `¿Quitar a ${socio.nombre}?`,
      cuerpo: socio.tiene_repartos
        ? 'Dejará de aparecer en los nuevos repartos. Sus pagos anteriores se conservan y podrás reactivarlo.'
        : 'Se eliminará de la lista de socios para nuevos repartos.',
      accion: 'Quitar socio', peligro: true,
    })) return;
    setError(null);
    try {
      const result = await mutation.mutateAsync({ method: 'DELETE', id: socio.email });
      toast(result.desactivado ? 'Socio desactivado. Su histórico se conserva.' : 'Socio eliminado');
    } catch (e) { setError(e); }
  }
  async function reactivar(socio: FinSocioRegistro) {
    setError(null);
    try {
      await mutation.mutateAsync({ method: 'PATCH', id: socio.email, body: { activo: 1 } });
      toast('Socio reactivado');
    } catch (e) { setError(e); }
  }

  return <>
    <div className="fin-toolbar">
      <div><h2>Socios del equipo</h2><p className="muted">Gestiona las personas que reciben los repartos.</p></div>
      <button className="btn" type="button" onClick={() => setEditing('new')}>Añadir socio</button>
    </div>
    <p className="muted">Dar de alta o quitar un socio aquí cambia la lista de beneficiarios. Los permisos para entrar al panel se gestionan por separado.</p>
    <ErrorFin error={query.error || error} />
    {query.isPending ? <p role="status">Cargando socios…</p> : null}
    <div className="fin-socios">
      {query.data?.socios.map((socio) => <article className="fin-persona" key={socio.email} aria-label={`Socio ${socio.nombre}`}>
        <h3>{socio.nombre}</h3>
        <div className="muted">{socio.email}</div>
        <p><span className="chip">{socio.activo ? 'Activo' : 'Inactivo'}</span>
          {socio.tiene_repartos ? <small className="muted">Con repartos registrados</small> : null}
        </p>
        <div className="fin-actions">
          <button className="btn alt btnsm" type="button" disabled={mutation.isPending} onClick={() => setEditing(socio)}>Editar</button>
          {socio.activo
            ? <button className="btn alt btnsm" type="button" disabled={mutation.isPending} onClick={() => void quitar(socio)}>Quitar</button>
            : <button className="btn alt btnsm" type="button" disabled={mutation.isPending} onClick={() => void reactivar(socio)}>Reactivar</button>}
        </div>
      </article>)}
    </div>
    {query.data && !query.data.socios.length ? <p className="empty">Todavía no hay socios. Añade el primero para comenzar a repartir.</p> : null}
    {editing ? <SocioModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
  </>;
}

function SocioModal({ initial, onClose }: { initial: FinSocioRegistro | null; onClose: () => void }) {
  const mutation = useFinMutacion<FinSocioInput>('socios');
  const toast = useToast();
  const [nombre, setNombre] = useState(initial?.nombre || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [error, setError] = useState<unknown>(null);
  async function guardar(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try {
      await mutation.mutateAsync({ method: initial ? 'PATCH' : 'POST', id: initial?.email, body: { nombre, email } });
      toast(initial ? 'Socio actualizado' : 'Socio añadido'); onClose();
    } catch (e) { setError(e); }
  }
  return <Modal title={initial ? 'Editar socio' : 'Añadir socio'} close={onClose} busy={mutation.isPending}>
    <form onSubmit={(e) => void guardar(e)}>
      <div className="fin-form">
        <label>Nombre<input required autoFocus maxLength={120} autoComplete="name" value={nombre} disabled={mutation.isPending} onChange={(e) => setNombre(e.target.value)} /></label>
        <label>Correo electrónico<input required type="email" maxLength={200} autoComplete="email" value={email} disabled={mutation.isPending} onChange={(e) => setEmail(e.target.value)} /></label>
      </div>
      {initial?.tiene_repartos ? <p className="muted">Al corregir el correo, sus repartos anteriores seguirán asociados a esta persona.</p> : null}
      <ErrorFin error={error} />
      <button className="btn" disabled={mutation.isPending}>Guardar socio</button>
    </form>
  </Modal>;
}
