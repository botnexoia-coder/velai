import { Link } from 'react-router';
import { useGlobalChannels } from '../hooks/queries';
import { channelIncidents } from '../lib/canales';

/** Se monta solo para Velai; el cliente no consulta el inventario global. */
export function ChannelAlerts() {
  const { data, error, isPending } = useGlobalChannels();
  const incidents = data ? channelIncidents(data) : [];
  if (isPending) return <p className="muted">Comprobando la configuración de canales…</p>;
  if (!error && !incidents.length) return null;
  return (
    <section className="panelcard channel-alerts" aria-label="Incidencias de canales">
      <div className="channel-alerts-head">
        <h2>{incidents.length ? `${incidents.length} ${incidents.length === 1 ? 'incidencia de canales' : 'incidencias de canales'}` : 'Diagnóstico de canales no disponible'}</h2>
        <Link to="/canales">Ver diagnóstico</Link>
      </div>
      {error ? <p className="error">No se pudo actualizar el diagnóstico.{data ? ' Se muestran los últimos datos disponibles.' : ''}</p> : null}
      <ul className="channel-issues">
        {incidents.map((issue) => (
          <li key={issue.key}>
            <div>
              <strong>{issue.name}</strong>
              <span>{issue.reason}</span>
              <small className="muted">{issue.address.replace(/^(whatsapp|messenger):/, '')}</small>
            </div>
            <Link className="btn alt btnsm" to={issue.href} aria-label={`${issue.action}: ${issue.name}`}>{issue.action}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
