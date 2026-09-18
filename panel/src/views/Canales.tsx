// Diagnóstico (solo Velai): configuración de enrutado, sin prometer disponibilidad
// del proveedor ni entrega de mensajes. Los estados los decide el worker.
// El filtrado es en cliente sobre lo ya
// cargado: la tabla cabe entera en una respuesta y filtrar sin ir al servidor es
// instantáneo. La píldora de arriba sigue contando el TOTAL, no lo filtrado.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { traducir } from '../api/errors';
import { IcoSearch } from '../components/icons';
import { TenantChip } from '../components/Pills';
import { CHST, channelCountLabel, channelsBad, clientPath, connectionsPath, filterChannels } from '../lib/canales';
import { fmt } from '../lib/format';
import { useGlobalChannels } from '../hooks/queries';

export function Canales() {
  const { data, error, isFetching, refetch, dataUpdatedAt } = useGlobalChannels();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [tenant, setTenant] = useState('');
  const [state, setState] = useState('');

  const filtered = useMemo(() => (data ? filterChannels(data, { q, tenant, state }) : null), [data, q, tenant, state]);
  // El selector se puebla con los clientes que TIENEN canales: los demás no dicen nada aquí.
  const who = useMemo(() => {
    const m = new Map<string, string>();
    if (data) for (const o of [...data.channels, ...data.unrouted]) if (o.tenant_id && o.name) m.set(o.tenant_id, o.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [data]);

  const bad = data ? channelsBad(data) : 0;
  const total = data?.channels.length ?? 0;
  const isFiltered = Boolean(q.trim() || tenant || state);

  return (
    <div className="channel-diagnostics">
      <div className="vhead">
        <div>
          <h1>Diagnóstico de canales</h1>
          <p>Configuración de enrutado de WhatsApp y Messenger</p>
        </div>
        <div className="actions actions0">
          {data && !error ? (
            <span className={`stpill ${bad ? 'warn' : 'ok'}`}>
              <i />
              {bad ? `${bad}${bad === 1 ? ' incidencia' : ' incidencias'}` : 'Sin incidencias de configuración'}
            </span>
          ) : null}
          <button className="btn alt btnsm" type="button" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </div>
      <p className="muted channel-freshness">
        {dataUpdatedAt ? <>Última consulta: <time dateTime={new Date(dataUpdatedAt).toISOString()}>{new Date(dataUpdatedAt).toLocaleTimeString('es-ES')}</time>. </> : null}
        Actualización automática cada 30 s mientras esta vista esté visible.
      </p>
      <div className="filters">
        <label className="search">
          <IcoSearch />
          <input className="q" placeholder="Buscar número, cliente o tipo…" value={q} onChange={(e) => setParams((p) => { if (e.target.value) p.set('q', e.target.value); else p.delete('q'); return p; }, { replace: true })} />
        </label>
        <span className="sel">
          <select value={tenant} onChange={(e) => setTenant(e.target.value)} aria-label="Cliente">
            <option value="">Todos los clientes</option>
            {who.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </span>
        <span className="sel">
          <select value={state} onChange={(e) => setState(e.target.value)} aria-label="Estado">
            <option value="">Todos los estados</option>
            <option value="alert">Solo los que requieren atención</option>
            <option value="live">Enrutados</option>
            <option value="inactive">Clientes inactivos</option>
          </select>
        </span>
        <span className="result-count">{data ? channelCountLabel(filtered?.rows.length ?? 0, total, isFiltered) : ''}</span>
      </div>
      {/* Los números sin enrutar no desaparecen al filtrar el estado de la tabla. */}
      {filtered && filtered.unrouted.length ? (
        <div className="panelcard mt12">
          <b>
            Números de WhatsApp sin enrutar<span className="pt-count">{filtered.unrouted.length}</span>
          </b>
          <p className="muted mt6">
            Estos números están registrados en la ficha y no tienen una ruta asignada al cliente.
            Revisa su conexión y usa «Sincronizar desde Twilio» para comprobar el registro.
          </p>
          {filtered.unrouted.map((u) => (
            <div className="cxrow" key={`${u.tenant_id}:${u.twilio_from}`}>
              <span className="flag off">{String(u.twilio_from).replace('whatsapp:', '')}</span>{' '}
              <TenantChip id={u.tenant_id} name={u.name} />{' '}
              <span className="muted">
                · sender {u.sender_status ?? '—'}
                {u.active ? '' : ' · cliente inactivo'}
              </span>
              <Link className="btn alt btnsm" to={`${connectionsPath(u.tenant_id)}#whatsapp`}>Revisar WhatsApp de {u.name}</Link>
            </div>
          ))}
        </div>
      ) : null}
      <p className="muted mt12">
        «Enrutado» indica que la dirección está asignada a un cliente activo. No verifica la entrega de mensajes ni
        la disponibilidad del proveedor. También puede existir una ruta por el canal primario de la ficha.
        El resumen de Web y de los avisos por Telegram está en <Link to="/clientes">Clientes</Link>.
      </p>
      {error ? <p className="error">No se pudo actualizar: {traducir(error)}{data ? '. Se muestran los últimos datos disponibles.' : ''}</p> : null}
      <div className="table mt6">
        <table>
          <thead>
            <tr>
              <th>Dirección</th>
              <th>Cliente</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Enrutado desde</th>
              <th>Revisar</th>
            </tr>
          </thead>
          <tbody>
            {filtered && filtered.rows.length ? (
              filtered.rows.map((c) => {
                const s = CHST[c.state] ?? { cls: '', label: '—' };
                return (
                  <tr key={c.address}>
                    <td className="tel">{c.address}</td>
                    <td>
                      {c.name ? (
                        <TenantChip id={c.tenant_id ?? undefined} name={c.name} />
                      ) : (
                        <span className="muted">— (id {String(c.tenant_id)})</span>
                      )}
                    </td>
                    <td className="muted">{c.kind}</td>
                    <td>
                      <span className={`flag ${s.cls}`}>{s.label}</span>
                      {c.state === 'from_mismatch' ? (
                        <span className="muted"> · responde desde {String(c.twilio_from).replace('whatsapp:', '')}</span>
                      ) : null}
                    </td>
                    <td className="muted">{fmt(c.created_at)}</td>
                    <td>{c.tenant_id && c.state !== 'orphan' ? (
                      <div className="channel-row-actions">
                        <Link to={connectionsPath(c.tenant_id)}>Conexiones</Link>
                        <Link to={clientPath(c.tenant_id)}>Ficha</Link>
                      </div>
                    ) : <span className="muted">Revisar asignación: el cliente ya no existe.</span>}</td>
                  </tr>
                );
              })
            ) : data ? (
              <tr>
                <td colSpan={6} className="empty">
                  {data.channels.length ? 'Ningún canal casa con el filtro.' : 'Ninguna dirección enrutada todavía.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="legend cfglegend">
        <span>
          <i className="lg-ok" />
          enrutado
        </span>
        <span>
          <i className="lg-warn" />
          requiere atención
        </span>
        <span>
          <i className="lg-bad" />
          cliente inexistente
        </span>
      </div>
    </div>
  );
}
