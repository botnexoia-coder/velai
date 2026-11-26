import { Link } from 'react-router';
import { MOBILE_PREVIEW } from '../../mobilePreview';
import { ErrorBox, useGestion } from './shared';

interface Asignacion {
  id:string; conductor_id:string; conductor_nombre:string; conductor_telefono:string;
  desde:string; hasta:string|null; estado:'actual'|'programada'|'finalizada';
}
const fechaHora=(value:string)=>new Intl.DateTimeFormat('es-ES',{
  timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short',
}).format(new Date(value));

export function VehiculoConductores({id}:{id:string}) {
  return MOBILE_PREVIEW?null:<AsignacionesVehiculo id={id}/>;
}
function AsignacionesVehiculo({id}:{id:string}) {
  const query=useGestion<{items:Asignacion[];actual:Asignacion|null}>(`vehiculos/${encodeURIComponent(id)}/conductores`);
  const current=query.data?.actual;
  return <section className="ve-driver" aria-label="Conductor asignado">
    <h3>Conductor asignado</h3>
    <ErrorBox error={query.error}/>
    {query.isPending?<p role="status">Consultando asignación…</p>:query.data?<>
      {current?<p><Link to={`/conductores?conductor=${encodeURIComponent(current.conductor_id)}`}><strong>{current.conductor_nombre}</strong></Link> · {current.conductor_telefono}<br/><small>Desde {fechaHora(current.desde)} · hora de Madrid</small></p>:<p>Sin conductor asignado en este momento.</p>}
      <Link to="/conductores">Gestionar conductores y asignaciones</Link>
      {query.data.items.length?<details className="ve-detail-fold"><summary>Historial de asignaciones ({query.data.items.length})</summary><ul>{query.data.items.map(item=><li key={item.id}>
        <Link to={`/conductores?conductor=${encodeURIComponent(item.conductor_id)}`}>{item.conductor_nombre}</Link> · {fechaHora(item.desde)} → {item.hasta?fechaHora(item.hasta):'sin devolución registrada'} · {({actual:'Actual',programada:'Programada',finalizada:'Finalizada'})[item.estado]}
      </li>)}</ul><small>Hora de Madrid. Registra la entrega del vehículo; no acredita quién conducía en un incidente.</small></details>:null}
    </>:null}
  </section>;
}
