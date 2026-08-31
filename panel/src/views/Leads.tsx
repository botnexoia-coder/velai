// Leads: la bandeja de trabajo. Filtros arriba (la fuente sale de los DATOS, vía
// /api/admin/stats — source es texto libre y una lista fija dejaría sin filtrar
// cualquier landing nueva), tabla paginada por cursor y detalle en modal.
import { useMemo, useState, type FormEvent } from 'react';
import { traducir } from '../api/errors';
import { NbChips, StatusPill, TenantChip } from '../components/Pills';
import { IcoSearch } from '../components/icons';
import { useToast } from '../components/Toasts';
import { fmt } from '../lib/format';
import { leadQs, useEscalations, useLeads, useMe, useResumeBot, useStats, useTenants, type LeadFilters } from '../hooks/queries';
import { LeadDetailModal } from './LeadDetail';

export function Leads() {
  const { data: me } = useMe();
  const isVelai = me?.role === 'velai';
  const { data: stats } = useStats();
  const { data: tenants } = useTenants(isVelai === true);
  // Los filtros APLICADOS (los del listado) van aparte del formulario: como el v1, la
  // consulta solo cambia al pulsar «Filtrar».
  const [applied, setApplied] = useState<LeadFilters>({});
  const [openLead, setOpenLead] = useState<string | null>(null);
  const leads = useLeads(applied);

  const rows = useMemo(() => (leads.data ? leads.data.pages.flatMap((p) => p.leads) : []), [leads.data]);
  const hasMore = Boolean(leads.hasNextPage);
  const countLabel = `${rows.length}${hasMore ? '+' : ''} resultado${rows.length === 1 && !hasMore ? '' : 's'}`;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const next: LeadFilters = {};
    for (const k of ['q', 'tenant', 'status', 'notification', 'source', 'from', 'to'] as const) {
      const v = String(data.get(k) ?? '').trim();
      if (v) next[k] = v;
    }
    setApplied(next);
  }

  return (
    <div>
      <div className="vhead">
        <div>
          <h1>Leads</h1>
          <p>Últimos 30 días</p>
        </div>
        <button
          className="btn alt"
          type="button"
          onClick={() => {
            window.location.href = `/api/admin/leads/export.csv${leadQs(applied)}`;
          }}
        >
          Exportar CSV
        </button>
      </div>
      <Escalaciones />
      <form className="filters" onSubmit={onSubmit}>
        <label className="search">
          <IcoSearch />
          <input name="q" className="q" placeholder="Buscar nombre, teléfono, sector…" />
        </label>
        {isVelai ? (
          <span className="sel">
            <select name="tenant" aria-label="Cliente">
              <option value="">Todos los clientes</option>
              {(tenants?.tenants ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </span>
        ) : null}
        <span className="sel">
          <select name="status" aria-label="Estado">
            <option value="">Todos los estados</option>
            {['new', 'contacted', 'qualified', 'won', 'lost', 'spam'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </span>
        <span className="sel">
          <select name="notification" aria-label="Avisos">
            <option value="">Todos los avisos</option>
            {['pending', 'sent', 'failed', 'skipped'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </span>
        <span className="sel">
          <select name="source" aria-label="Fuente">
            <option value="">Todas las fuentes</option>
            {(stats?.fuentes ?? []).map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </span>
        <input name="from" type="date" data-tip="Desde esta fecha (incluida)" aria-label="Desde" />
        <input name="to" type="date" data-tip="Hasta esta fecha (incluida)" aria-label="Hasta" />
        <button className="btn">Filtrar</button>
        <span className="result-count">{leads.data ? countLabel : ''}</span>
      </form>
      {leads.error ? (
        <p className="error">{traducir(leads.error)}</p>
      ) : null}
      <div className="table">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              {isVelai ? <th>Cliente</th> : null}
              <th>Estado</th>
              <th>Nombre</th>
              <th>WhatsApp</th>
              <th>Asunto</th>
              <th>Fuente</th>
              <th>Avisos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="rowlink" onClick={() => setOpenLead(l.id)}>
                <td>{fmt(l.created_at)}</td>
                {isVelai ? (
                  <td>
                    <TenantChip id={l.tenant_id} name={l.tenant_name} />
                  </td>
                ) : null}
                <td>
                  <StatusPill status={l.status} />
                </td>
                <td>{l.name || '—'}</td>
                <td className="tel">{l.whatsapp || '—'}</td>
                <td>{l.need || l.sector || '—'}</td>
                <td>{l.source}</td>
                <td>
                  <NbChips summary={l.notification_summary} />
                </td>
              </tr>
            ))}
            {leads.data && !rows.length ? (
              <tr>
                <td colSpan={isVelai ? 8 : 7} className="empty">
                  No hay leads con estos filtros.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="legend">
        <span>
          <i className="d-new" />
          nuevo
        </span>
        <span>
          <i className="d-contacted" />
          contactado
        </span>
        <span>
          <i className="d-qualified" />
          cualificado
        </span>
        <span>
          <i className="d-won" />
          ganado
        </span>
        <span>
          <i className="d-lost" />
          perdido
        </span>
      </div>
      <div className="pager">
        {hasMore ? (
          <button className="btn alt" type="button" onClick={() => void leads.fetchNextPage()} disabled={leads.isFetchingNextPage}>
            Cargar más
          </button>
        ) : null}
      </div>
      {openLead ? <LeadDetailModal id={openLead} onClose={() => setOpenLead(null)} /> : null}
    </div>
  );
}

// Handoff: conversaciones con el bot en pausa (un humano las atiende por WhatsApp).
// Reanudar borra la pausa.
function Escalaciones() {
  const { data } = useEscalations();
  const { data: me } = useMe();
  const { data: tenants } = useTenants(me?.role === 'velai');
  const resume = useResumeBot();
  const toast = useToast();
  if (!data?.escalations.length) return null;
  return (
    <div className="escalations">
      {data.escalations.map((e) => {
        const tn = tenants?.tenants.find((t) => t.id === e.tenantId)?.name;
        return (
          <span key={`${e.tenantId}:${e.from}`} className="esc">
            ⏸ {e.from}
            {tn ? ` · ${tn}` : ''}{' '}
            <button
              type="button"
              onClick={() =>
                resume.mutate(e, {
                  onSuccess: () => toast(`Bot reanudado ✓ para ${e.from}`),
                  onError: (err) => toast(`No se pudo reanudar: ${traducir(err)}`, false),
                })
              }
            >
              Reanudar bot
            </button>
          </span>
        );
      })}
    </div>
  );
}
