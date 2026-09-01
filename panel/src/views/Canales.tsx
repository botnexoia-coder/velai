// Canales (solo velai): la tabla de ENRUTADO, no la opinión de Twilio. Los estados los
// decide el worker (misma pregunta que tenantByAddress); aquí solo se pintan, para que
// panel y enrutado real no puedan discrepar. El filtrado es en cliente sobre lo ya
// cargado: la tabla cabe entera en una respuesta y filtrar sin ir al servidor es
// instantáneo. La píldora de arriba sigue contando el TOTAL, no lo filtrado.
import { useMemo, useState } from 'react';
import { traducir } from '../api/errors';
import { IcoSearch } from '../components/icons';
import { TenantChip } from '../components/Pills';
import { CHST, channelCountLabel, channelsBad, filterChannels } from '../lib/canales';
import { fmt } from '../lib/format';
import { useGlobalChannels } from '../hooks/queries';

export function Canales() {
  const { data, error } = useGlobalChannels();
  const [q, setQ] = useState('');
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
    <div>
      <div className="vhead">
        <div>
          <h1>Canales</h1>
          <p>Las direcciones que el worker atiende de verdad</p>
        </div>
        {data ? (
          <span className={`stpill ${bad ? 'warn' : 'ok'}`}>
            <i />
            {bad ? `${bad}${bad === 1 ? ' canal requiere atención' : ' canales requieren atención'}` : 'todo atendido'}
          </span>
        ) : null}
      </div>
      <div className="filters">
        <label className="search">
          <IcoSearch />
          <input className="q" placeholder="Buscar número, cliente o tipo…" value={q} onChange={(e) => setQ(e.target.value)} />
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
            <option value="live">Atendidos</option>
          </select>
        </span>
        <span className="result-count">{data ? channelCountLabel(filtered?.rows.length ?? 0, total, isFiltered) : ''}</span>
      </div>
      {/* Los sin enrutar son SIEMPRE «requieren atención»: nunca los esconde el filtro. */}
      {filtered && filtered.unrouted.length ? (
        <div className="panelcard mt12">
          <b>
            Números vivos en Twilio que el worker NO atiende<span className="pt-count">{filtered.unrouted.length}</span>
          </b>
          <p className="muted mt6">
            El sender está de alta y en verde, pero ninguna fila lo enruta: el webhook responde 404 y el bot calla. Se
            arregla con «Sincronizar sender» en Conexiones → WhatsApp de esa ficha, que registra el canal.
          </p>
          {filtered.unrouted.map((u) => (
            <div className="mb6" key={`${u.tenant_id}:${u.twilio_from}`}>
              <span className="flag off">{String(u.twilio_from).replace('whatsapp:', '')}</span>{' '}
              <TenantChip id={u.tenant_id} name={u.name} />{' '}
              <span className="muted">
                · sender {u.sender_status ?? '—'}
                {u.active ? '' : ' · cliente inactivo'}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="muted mt12">
        Cada mensaje entrante se enruta por su dirección: el worker la busca en esta tabla (y en el canal primario de la
        ficha) y exige que el cliente esté activo. Si una dirección no sale aquí, ese número no lo atiende nadie — por
        muy verde que esté en Twilio. La web no aparece: entra por slug y funciona siempre.
      </p>
      {error ? <p className="error">{traducir(error)}</p> : null}
      <div className="table mt6">
        <table>
          <thead>
            <tr>
              <th>Dirección</th>
              <th>Cliente</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Enrutado desde</th>
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
                  </tr>
                );
              })
            ) : data ? (
              <tr>
                <td colSpan={5} className="empty">
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
          atendido
        </span>
        <span>
          <i className="lg-warn" />
          requiere atención
        </span>
        <span>
          <i className="lg-bad" />
          no atendido
        </span>
      </div>
    </div>
  );
}
