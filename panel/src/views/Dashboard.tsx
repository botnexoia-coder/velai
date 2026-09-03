// Dashboard: leads y consumo, de un vistazo. Las métricas no bloquean nada: cada
// tarjeta carga y falla por su cuenta.
import { useState } from 'react';
import { ApiError } from '../api/client';
import { traducir } from '../api/errors';
import { Brow, DayChart } from '../components/Bars';
import { miles, usd } from '../lib/format';
import { useAiBalance, useAiUsage, useMe, useStats } from '../hooks/queries';
import type { AiBalance, AiUsage, Stats } from '../api/types';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fmtCorto(v: string | null): string {
  return v ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'short' }).format(new Date(v)) : '';
}

export function Dashboard() {
  const { data: me } = useMe();
  const { data: stats, error: statsError } = useStats();
  const isVelai = me?.role === 'velai';
  const isCliente = me?.role === 'cliente';

  return (
    <div>
      <div className="vhead">
        <div>
          <h1>Dashboard</h1>
          <p>Leads y consumo, de un vistazo</p>
        </div>
      </div>
      {statsError ? <p className="error">{traducir(statsError)}</p> : null}
      <Metricas stats={stats} isVelai={isVelai} />
      {isCliente ? <SaldoIa /> : null}
      <div className="chartcard">
        <b>Leads por día · 14 días</b>
        {stats ? (
          <>
            <DayChart
              bars={stats.porDia.map((x) => ({
                d: x.d,
                value: x.n,
                // El globo dice el total y de QUÉ canal vino cada lead.
                rows: [['Leads', x.n] as [string, number]].concat(x.canales.map((c) => [c.canal, c.n] as [string, number])),
              }))}
            />
            <div className="chartlabels">
              <span>{stats.porDia[0]?.d.slice(5) ?? ''}</span>
              <span>{stats.porDia.at(-1)?.d.slice(5) ?? ''}</span>
            </div>
          </>
        ) : (
          <p className="muted mt6">—</p>
        )}
      </div>
      <div className="grid2 mt12">
        <div className="chartcard">
          <b>Leads por canal · 30 días</b>
          <div className="mt6">
            {stats ? <CanalRows stats={stats} /> : <span className="muted">—</span>}
          </div>
        </div>
        <div className="chartcard">
          <b>Tasa de captura · {stats?.captura?.periodoCompleto ? '30 días' : `desde ${stats?.captura?.desde ?? 'el inicio del registro'}`}</b>
          {stats?.captura ? <Captura stats={stats} /> : <p className="muted mt6">—</p>}
        </div>
      </div>
      {isVelai ? <GastoIa /> : null}
    </div>
  );
}

function Metricas({ stats, isVelai }: { stats: Stats | undefined; isVelai: boolean }) {
  return (
    <div className="metrics">
      <div className="stat">
        <b>Leads · 30 días</b>
        <span className="n">{stats ? stats.total30 : '—'}</span>
      </div>
      <div className="stat">
        <b>Sin contactar</b>
        <span className="n">{stats ? stats.sinContactar : '—'}</span>
        <small>
          {stats && stats.sinContactar && stats.sinContactarDesde
            ? `el más antiguo, del ${fmtCorto(stats.sinContactarDesde)}`
            : ''}
        </small>
      </div>
      <div className={`stat${stats && stats.fallidos7 > 0 ? ' alerta' : ''}`}>
        <b>Avisos fallidos · 7 días</b>
        <span className="n">{stats ? stats.fallidos7 : '—'}</span>
      </div>
      {isVelai ? (
        <div className="stat">
          <b>Clientes activos</b>
          <span className="n">{stats ? stats.tenantsActivos ?? '—' : '—'}</span>
        </div>
      ) : null}
    </div>
  );
}

function CanalRows({ stats }: { stats: Stats }) {
  if (!stats.porCanal.length) return <span className="muted">Sin leads en el periodo.</span>;
  const cmax = Math.max(1, ...stats.porCanal.map((x) => x.n));
  return (
    <>
      {stats.porCanal.map((x) => (
        <Brow key={x.canal} label={x.canal} pct={Math.round((x.n / cmax) * 100)} right={`${x.n} leads`} />
      ))}
    </>
  );
}

// Tasa de captura conversacional: conversaciones enlazadas a lead / conversaciones.
// Ambos números y el canal vienen ya agregados por el worker sobre las mismas filas.
function Captura({ stats }: { stats: Stats }) {
  const convs = stats.captura.conversaciones;
  const leads = stats.captura.leads;
  const porCanal = stats.captura?.porCanal ?? [];
  const incoherente = leads < 0 || leads > convs || porCanal.some((x) => x.leads < 0 || x.leads > x.convs);
  if (incoherente) {
    return (
      <p className="error mt6" role="alert">
        Datos de captura incoherentes: revisa la agregación antes de interpretar esta métrica.
      </p>
    );
  }
  const pct = convs ? Math.round((leads / convs) * 100) : null;
  return (
    <>
      <div className="metrics mt6">
        <div className="stat">
          <b>Conversaciones</b>
          <span className="n">{miles(convs)}</span>
        </div>
        <div className="stat">
          <b>Acaban en lead</b>
          <span className="n">{pct === null ? '—' : `${pct}%`}</span>
          <small>{convs ? `${leads} de ${convs} conversaciones` : 'Aún no hay conversaciones contadas'}</small>
        </div>
      </div>
      <div className="mt6">
        {porCanal.map((x) => {
          const p = x.convs ? Math.round((x.leads / x.convs) * 100) : 0;
          return <Brow key={x.canal} label={x.canal} pct={p} right={`${x.leads}/${x.convs} · ${p}%`} />;
        })}
        <small className="muted">
          Solo conversaciones que acaban enlazadas a un lead; los formularios se muestran en «Leads por canal».
        </small>
      </div>
    </>
  );
}

// ── Gasto de IA (solo Velai): el coste en dólares JAMÁS sale del panel de Velai ──
function GastoIa() {
  const [days, setDays] = useState(30);
  const { data, error } = useAiUsage(days, true);
  return (
    <div className="chartcard mt12">
      <div className="aihead">
        <b>Gasto de IA</b>
        <span className="sel">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Periodo del gasto de IA">
            <option value={7}>7 días</option>
            <option value={30}>30 días</option>
            <option value={90}>90 días</option>
          </select>
        </span>
      </div>
      {error ? <p className="muted mt6">No se pudo cargar el gasto: {traducir(error)}</p> : null}
      {data ? <GastoIaBody data={data} /> : null}
    </div>
  );
}

function GastoIaBody({ data }: { data: AiUsage }) {
  const tot = data.total.cost || 1;
  return (
    <>
      <div className="metrics mt6">
        <div className="stat">
          <b>Coste del periodo</b>
          <span className="n">{usd(data.total.cost)}</span>
          <small>{data.total.calls ? `≈ ${usd(data.total.cost / data.total.calls)} por llamada` : ''}</small>
        </div>
        <div className="stat">
          <b>Llamadas al modelo</b>
          <span className="n">{miles(data.total.calls)}</span>
        </div>
        <div className="stat">
          <b>Tokens</b>
          <span className="n">{miles(data.total.tokens)}</span>
        </div>
      </div>
      <DayChart
        small
        minPct={10}
        bars={data.porDia.map((x) => ({
          d: x.d,
          value: x.cost,
          // Coste y llamadas del día, y QUIÉN lo gastó: con varios clientes es lo primero
          // que se pregunta cuando un día se dispara.
          rows: ([['Coste', usd(x.cost)], ['Llamadas', miles(x.calls)]] as [string, string][]).concat(
            x.clientes.map((c) => [c.name, `${miles(c.calls)} ll.`] as [string, string]),
          ),
        }))}
      />
      <div className="chartlabels">
        <span>{data.porDia[0]?.d.slice(5) ?? ''}</span>
        <span>{data.porDia.at(-1)?.d.slice(5) ?? ''}</span>
      </div>
      <div className="table mt12">
        <table className="tnarrow">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Llamadas</th>
              <th>Tokens</th>
              <th>Coste</th>
              <th>Parte del total</th>
            </tr>
          </thead>
          <tbody>
            {data.clientes.length ? (
              data.clientes.map((c) => {
                const pct = Math.round((c.cost / tot) * 100);
                return (
                  <tr key={c.tenant_id || c.name}>
                    <td>
                      {c.name}
                      {c.slug ? <span className="muted"> {c.slug}</span> : null}
                    </td>
                    <td>{miles(c.calls)}</td>
                    <td>{miles(c.tokens)}</td>
                    <td>{usd(c.cost)}</td>
                    <td>
                      <span className="share">
                        <i style={{ width: `${pct}%` }} />
                        {pct}%
                      </span>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="empty">
                  Todavía no hay consumo registrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <small className="muted">
        Coste estimado con las tarifas públicas de Anthropic (entrada, salida y caché) por modelo. El cupo diario por
        cliente se edita en su ficha.
      </small>
    </>
  );
}

// ── Saldo de IA del mes (solo cliente). Nunca coste: eso es velai-only. El saldo baja
// hasta cero y al llegar NO corta nada — la tarjeta lo dice con letra clara. ──
function SaldoIa() {
  const { data, error } = useAiBalance(true);
  return (
    <div className="chartcard mt12">
      <b>{data ? `Saldo de IA · ${MESES[Number(String(data.month).slice(5, 7)) - 1] ?? data.month}` : 'Saldo de IA'}</b>
      {error ? (
        <small className="muted">
          No se pudo cargar el saldo: {error instanceof ApiError ? traducir(error) : String(error)}
        </small>
      ) : null}
      {data ? <SaldoIaBody data={data} /> : null}
    </div>
  );
}

function SaldoIaBody({ data }: { data: AiBalance }) {
  return (
    <>
      <div className="saldo">
        <span className="n">{miles(data.remaining)} tokens</span>
        <span className="of">
          de {miles(data.included)} de este mes
          {/* Los tokens por sí solos no le dicen nada a un cliente; las llamadas sí. */}
          {data.calls ? ` · ${miles(data.calls)} llamadas` : ''}
        </span>
      </div>
      {/* La barra pinta lo CONSUMIDO, no lo que queda: es lo que se lee de un vistazo. */}
      <div className={`bigbar${data.pct >= 80 ? ' hot' : ''}`}>
        <i style={{ width: `${Math.max(1, data.pct)}%` }} />
      </div>
      <div className="chartlabels">
        <span>Consumido hoy: {miles(data.usedToday)} tokens</span>
        <span>{data.pct}% del mes</span>
      </div>
      <DayChart
        small
        bars={data.serie.map((x) => ({
          d: x.d,
          value: x.n,
          rows: [
            ['Tokens', miles(x.n)],
            ['Llamadas', miles(x.calls)],
          ],
        }))}
      />
      <small className="muted">
        {data.over
          ? 'Has pasado del saldo incluido este mes. No se ha cortado nada ni se te cobra de más: lo revisamos juntos y ajustamos tu plan si hace falta.'
          : 'Al agotarse no se corta nada ni se te cobra de más: es un contador para que sepas cuánto usas.'}
      </small>
    </>
  );
}
