import { useMemo, useState } from 'react';
import { traducir } from '../api/errors';
import type { EventReservationStatus } from '../api/types';
import { useEventReservationStatus, useEvents } from '../hooks/queries';
import { fmt } from '../lib/format';
import { useToast } from '../components/Toasts';

function eventDate(value: string | null) {
  if (!value) return 'Fecha por confirmar';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value));
}

export function Eventos() {
  const query = useEvents();
  const update = useEventReservationStatus();
  const toast = useToast();
  const [selected, setSelected] = useState('');
  const events = query.data?.events ?? [];
  const eventId = selected || events.find((e) => e.status === 'active')?.id || events[0]?.id || '';
  const current = events.find((e) => e.id === eventId);
  // El administrador recibe varios tenants. La selección de un evento también fija el
  // tenant de la vista para que reservas propias y consentimientos no se mezclen entre
  // clientes. En el panel de cliente tenant_id se elimina de la respuesta y el filtro
  // conserva, correctamente, todas sus filas.
  const currentTenantId = current?.tenant_id;
  const reservations = useMemo(
    () => (query.data?.reservations ?? []).filter((r) => {
      if (!eventId) return true;
      if (r.kind === 'own_event') return !currentTenantId || r.tenant_id === currentTenantId;
      return r.event_id === eventId;
    }),
    [currentTenantId, eventId, query.data?.reservations],
  );
  const consents = useMemo(
    () => (query.data?.consents ?? []).filter((c) => !currentTenantId || c.tenant_id === currentTenantId),
    [currentTenantId, query.data?.consents],
  );
  const pending = reservations.filter((r) => r.status === 'pending').length;
  const confirmed = reservations.filter((r) => r.status === 'confirmed').length;
  const accepted = consents.filter((c) => c.status === 'accepted').length;

  function change(id: string, status: EventReservationStatus) {
    update.mutate({ id, status }, {
      onSuccess: () => toast('Reserva actualizada ✓'),
      onError: (error) => toast(`No se pudo actualizar: ${traducir(error)}`, false),
    });
  }

  return (
    <div>
      <div className="vhead">
        <div><h1>Eventos</h1><p>Reservas y consentimiento, sin perder el hilo de WhatsApp</p></div>
        {events.length > 1 ? (
          <span className="sel"><select aria-label="Evento" value={eventId} onChange={(e) => setSelected(e.target.value)}>
            {events.map((event) => <option key={event.id} value={event.id}>{event.tenant_name ? `${event.tenant_name} · ` : ''}{event.name}</option>)}
          </select></span>
        ) : null}
      </div>
      {query.error ? <p className="error">{traducir(query.error)}</p> : null}
      {current ? (
        <section className="eventhero">
          <div><span className="flag ok">{current.status === 'active' ? 'Activo' : current.status}</span><h2>{current.name}</h2>
            {current.tenant_name ? <p><b>{current.tenant_name}</b></p> : null}
            <p>{eventDate(current.starts_at)} · {current.venue || 'Lugar por confirmar'}</p>
            {current.address ? <small>{current.address}</small> : null}
          </div>
        </section>
      ) : null}
      <div className="grid eventstats">
        <div className="card"><b>Pendientes</b><strong>{pending}</strong><small>El equipo debe confirmarlas</small></div>
        <div className="card"><b>Confirmadas</b><strong>{confirmed}</strong><small>Marcadas por el equipo</small></div>
        <div className="card"><b>Avisos aceptados</b><strong>{accepted}</strong><small>Consentimiento vigente</small></div>
      </div>
      <div className="eventsection"><h2>Reservas e interesados</h2><p>La IA crea una ficha provisional; una persona confirma la reserva.</p></div>
      <div className="table">
        <table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Nombre</th><th>WhatsApp</th><th>Detalle</th><th>Estado</th></tr></thead>
          <tbody>
            {reservations.map((r) => <tr key={r.id}>
              <td>{fmt(r.updated_at)}</td><td>{r.kind === 'own_event' ? 'Evento propio' : 'Evento actual'}</td>
              <td>{r.name || 'Por completar'}</td><td className="tel">{r.contact || '—'}</td><td>{r.details || '—'}</td>
              <td><span className="sel"><select aria-label={`Estado de ${r.name || r.contact || 'reserva'}`} value={r.status} disabled={update.isPending} onChange={(e) => change(r.id, e.target.value as EventReservationStatus)}>
                <option value="pending">Pendiente</option><option value="confirmed">Confirmada</option><option value="cancelled">Cancelada</option>
              </select></span></td>
            </tr>)}
            {query.data && !reservations.length ? <tr><td colSpan={6} className="empty">Todavía no hay reservas para este evento.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="eventsection"><h2>Permiso para futuros eventos</h2><p>Estado vigente por contacto. La evidencia completa queda registrada en D1.</p></div>
      <div className="table"><table className="tnarrow"><thead><tr><th>Fecha</th><th>Contacto</th><th>Canal</th><th>Estado</th></tr></thead><tbody>
        {consents.map((c) => <tr key={c.id}><td>{fmt(c.created_at)}</td><td className="tel">{c.contact}</td><td>{c.channel}</td><td><span className={`flag ${c.status === 'accepted' ? 'ok' : c.status === 'withdrawn' ? 'bad' : 'off'}`}>{c.status === 'accepted' ? 'Aceptó' : c.status === 'withdrawn' ? 'Baja' : 'No aceptó'}</span></td></tr>)}
        {query.data && !consents.length ? <tr><td colSpan={4} className="empty">Aún no hay preferencias registradas.</td></tr> : null}
      </tbody></table></div>
    </div>
  );
}
