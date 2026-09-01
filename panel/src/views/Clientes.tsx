// Clientes (solo velai): canal, contexto y estado de cada cliente de un vistazo — el
// semáforo de configuración se ve desde el listado, sin abrir nada. La fila abre la
// ficha; la columna Calendario salta a la vista de calendario de ESE cliente.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { traducir } from '../api/errors';
import { TenantChip } from '../components/Pills';
import { semaforo } from '../lib/semaforo';
import { useTenants } from '../hooks/queries';
import { ClienteFicha } from './ClienteFicha';

export function Clientes() {
  const { data, error } = useTenants(true);
  const navigate = useNavigate();
  /** null = cerrado; '' = alta nueva; uuid = ficha. */
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div>
      <div className="vhead">
        <div>
          <h1>Clientes</h1>
          <p>Canal, contexto y estado de cada cliente</p>
        </div>
        <button className="btn" type="button" onClick={() => setOpen('')}>
          Nuevo cliente
        </button>
      </div>
      {error ? <p className="error">{traducir(error)}</p> : null}
      <div className="table">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Canal</th>
              <th>Leads</th>
              <th>Contexto</th>
              <th>Configuración</th>
              <th>Estado</th>
              <th>Calendario</th>
            </tr>
          </thead>
          <tbody>
            {data && data.tenants.length ? (
              data.tenants.map((t) => (
                <tr key={t.id} className="rowlink" onClick={() => setOpen(t.id)}>
                  <td>
                    <TenantChip id={t.id} name={t.name} />
                  </td>
                  <td className="muted">{t.channel_address}</td>
                  <td>{t.lead_count}</td>
                  <td>
                    {/* El contexto viaja al modelo en CADA mensaje: un prompt largo
                        consume saldo en cada turno — el globo lo recuerda. */}
                    <span className="meter" data-tip="El contexto viaja al modelo en CADA mensaje, así que un prompt largo consume saldo en cada turno.">
                      <i style={{ width: `${Math.min(100, Math.round((t.prompt_len / 12000) * 100))}%` }} />
                    </span>
                    <span className="muted">{t.prompt_len} car.</span>
                  </td>
                  <td>
                    {semaforo(t).map((c, i) => (
                      <span key={i} className={`flag${c.cls ? ` ${c.cls}` : ''}`}>
                        {c.text}
                      </span>
                    ))}
                  </td>
                  <td>{t.active ? <span className="flag ok">activo</span> : <span className="flag off">inactivo</span>}</td>
                  <td>
                    <button
                      type="button"
                      className="btn alt btnsm"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/calendario?t=${t.id}`);
                      }}
                    >
                      Abrir
                    </button>
                  </td>
                </tr>
              ))
            ) : data ? (
              <tr>
                <td colSpan={7} className="empty">
                  Sin clientes.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {open !== null ? <ClienteFicha id={open || null} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
