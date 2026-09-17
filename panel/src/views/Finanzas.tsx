import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { qs } from '../api/client';
import { traducir } from '../api/errors';
import type { FinConcepto, FinMoneda, FinMovimiento, FinMovimientoInput, FinRepartoInput, FinResumen, FinSocio, FinTipo, TenantRow } from '../api/types';
import { confirmar } from '../components/Confirmar';
import { TenantChip } from '../components/Pills';
import { useToast } from '../components/Toasts';
import { useMe, useTenants, useFinConceptos, useFinMovimientos, useFinMutacion, useFinRepartos, useFinResumen, type FinFilters } from '../hooks/queries';
import { finDinero, finImporte } from '../lib/format';

const TIPOS: FinTipo[] = ['ingreso', 'gasto', 'egreso'];
const MONEDAS: FinMoneda[] = ['EUR', 'COP'];
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
function TipoPill({ tipo }: { tipo: FinTipo }) { return <span className={`pill fin-${tipo}`}>{LABEL[tipo]}</span>; }
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
  const tab = ['repartos', 'conceptos'].includes(params.get('tab') || '') ? params.get('tab')! : 'movimientos';
  const [p, setP] = useState('mes');
  const [custom, setCustom] = useState<FinFilters>(periodo('mes'));
  const dates = p === 'personalizado' ? custom : periodo(p);
  const resumen = useFinResumen(dates, tab === 'movimientos');
  return <div className="finanzas">
    <div className="vhead"><div><h1>Finanzas</h1><p>El libro de Velai: ingresos, gastos, caja y repartos del equipo.</p></div></div>
    <nav className="fin-tabs" aria-label="Secciones de Finanzas">
      {['movimientos', 'repartos', 'conceptos'].map((t) => <button type="button" key={t} className={`btn ${tab === t ? '' : 'alt'}`} aria-pressed={tab === t} onClick={() => setParams((prev) => { const next = new URLSearchParams(prev); next.set('tab', t); return next; })}>{t[0]!.toUpperCase() + t.slice(1)}</button>)}
    </nav>
    {tab === 'movimientos' ? <>
      <div className="fin-overview">
        <div className="fin-period"><label>Periodo<select value={p} onChange={(e) => setP(e.target.value)}><option value="mes">Mes actual</option><option value="trimestre">Trimestre actual</option><option value="año">Año actual</option><option value="todo">Todo</option><option value="personalizado">Elegir fechas</option></select></label>
          {p === 'personalizado' ? <><label>Desde<input type="date" value={custom.desde || ''} onChange={(e) => setCustom({ ...custom, desde: e.target.value })} /></label><label>Hasta<input type="date" value={custom.hasta || ''} onChange={(e) => setCustom({ ...custom, hasta: e.target.value })} /></label></> : null}
          <p className="muted">Ingresos − gastos = beneficio.<br />Los egresos solo restan caja.</p>
        </div>
        <div className="fin-currencies">
          {MONEDAS.map((moneda) => <section className="fin-currency" aria-label={`Resumen ${moneda}`} key={moneda}><h2>{moneda} <small>{moneda === 'EUR' ? 'Euros' : 'Pesos colombianos'}</small></h2>
            <div className="fin-metrics">{(['ingresos', 'gastos', 'beneficio', 'egresos'] as const).map((key) => <div key={key}><span>{key[0]!.toUpperCase() + key.slice(1)}</span><strong>{resumen.data ? <Dinero value={resumen.data.monedas[moneda][key]} moneda={moneda} /> : '—'}</strong></div>)}</div>
            <div className="fin-caja"><span>Caja <small>(acumulado)</small></span><strong>{resumen.data ? <Dinero value={resumen.data.monedas[moneda].caja} moneda={moneda} /> : '—'}</strong><small>Disponible sin repartir · desde el origen</small></div>
          </section>)}
        </div>
      </div>
      <ErrorFin error={resumen.error} />
      <Movimientos dates={dates} />
      {resumen.data ? <details className="fin-breakdown"><summary>Desglose por concepto · periodo seleccionado</summary><div className="fin-table"><table><thead><tr><th>Concepto</th><th>Tipo</th><th>Moneda</th><th>Importe</th></tr></thead><tbody>{resumen.data.conceptos.map((r) => <tr key={`${r.concepto_id}-${r.moneda}`}><td>{r.nombre}</td><td><TipoPill tipo={r.tipo} /></td><td>{r.moneda}</td><td><Dinero value={r.importe} moneda={r.moneda} /></td></tr>)}</tbody></table></div>{!resumen.data.conceptos.length ? <p className="empty">No hay movimientos en este periodo.</p> : null}</details> : null}
    </> : tab === 'repartos' ? <Repartos /> : <Conceptos />}
  </div>;
}
function Movimientos({ dates }: { dates: FinFilters }) {
  const [f, setF] = useState<FinFilters>({});
  const filters = { ...dates, ...f };
  const query = useFinMovimientos(filters), conceptos = useFinConceptos(true), tenants = useTenants(true);
  const [editing, setEditing] = useState<FinMovimiento | 'new' | null>(null);
  const rows = query.data?.pages.flatMap((p) => p.movimientos) || [];
  return <>
    <div className="fin-toolbar">
      <div className="fin-filters"><label>Tipo<select value={f.tipo || ''} onChange={(e) => setF({ ...f, tipo: e.target.value, concepto: '' })}><option value="">Todos los tipos</option>{TIPOS.map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}</select></label>
        <label>Moneda<select value={f.moneda || ''} onChange={(e) => setF({ ...f, moneda: e.target.value })}><option value="">EUR y COP</option>{MONEDAS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Concepto<select value={f.concepto || ''} onChange={(e) => setF({ ...f, concepto: e.target.value })}><option value="">Todos los conceptos</option>{TIPOS.filter((t) => !f.tipo || t === f.tipo).flatMap((t) => conceptos.data?.conceptos[t] || []).map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.activo ? '' : ' (inactivo)'}</option>)}</select></label>
        <label>Cliente<select value={f.tenant || ''} onChange={(e) => setF({ ...f, tenant: e.target.value })}><option value="">Todos los clientes</option>{tenants.data?.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>
      <div className="fin-actions"><a className="btn alt" href={`/api/admin/finanzas/export.csv${qs(filters)}`} download>Exportar CSV</a><button className="btn" type="button" onClick={() => setEditing('new')}>Registrar movimiento</button></div>
    </div>
    <ErrorFin error={query.error || conceptos.error || tenants.error} />
    {query.isPending ? <p role="status">Cargando movimientos…</p> : <div className="fin-table"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Cliente</th><th>Nota</th><th>Importe</th></tr></thead><tbody>
      {rows.map((m) => <tr key={m.id} onClick={() => setEditing(m)}><td>{m.fecha}</td><td><TipoPill tipo={m.tipo} /></td><td><button className="fin-row-open" type="button" onClick={() => setEditing(m)}>{m.concepto_nombre}</button>{m.reparto_id ? <small className="muted"> · reparto</small> : null}</td><td><TenantChip id={m.tenant_id || undefined} name={m.tenant_name} /></td><td className="fin-note">{m.nota || '—'}</td><td><Dinero value={m.importe} moneda={m.moneda} /> <small>{m.moneda}</small></td></tr>)}
    </tbody></table>{!rows.length ? <p className="empty">Sin movimientos con estos filtros. Registra el primero para empezar el libro.</p> : null}</div>}
    {query.hasNextPage ? <div className="pager"><button className="btn alt" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Cargar más</button></div> : null}
    {editing ? <MovimientoModal initial={editing === 'new' ? null : editing} tenants={tenants.data?.tenants || []} onClose={() => setEditing(null)} /> : null}
  </>;
}
function Modal({ title, children, close, busy = false }: { title: string; children: ReactNode; close: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="fin-modal" aria-label={title} onCancel={(e) => { if (busy) e.preventDefault(); }} onClose={close}><div className="modal-h"><strong>{title}</strong><button className="btn alt" type="button" disabled={busy} onClick={close}>Cerrar</button></div><div className="modal-b">{children}</div></dialog>;
}
function MovimientoModal({ initial, tenants, onClose }: { initial: FinMovimiento | null; tenants: TenantRow[]; onClose: () => void }) {
  const catalogo = useFinConceptos(), mutation = useFinMutacion<Partial<FinMovimientoInput>>('movimientos'), toast = useToast();
  const [tipo, setTipo] = useState<FinTipo>(initial?.tipo || 'ingreso');
  const [concepto, setConcepto] = useState(String(initial?.concepto_id || ''));
  const [fecha, setFecha] = useState(initial?.fecha || hoy()), [moneda, setMoneda] = useState<FinMoneda>(initial?.moneda || 'EUR');
  const [importe, setImporte] = useState(initial ? String(initial.importe / (initial.moneda === 'EUR' ? 100 : 1)) : '');
  const [nota, setNota] = useState(initial?.nota || ''), [tenant, setTenant] = useState(initial?.tenant_id || '');
  const [error, setError] = useState<unknown>(null);
  const opciones = catalogo.data?.conceptos[tipo] || [];
  const conceptoId = Number(concepto || opciones[0]?.id || 0);
  const entero = finImporte(importe, moneda);
  async function guardar(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!entero) { setError(new Error('importe_invalido')); return; }
    try {
      await mutation.mutateAsync({ method: initial ? 'PATCH' : 'POST', id: initial?.id, body: initial ? { fecha, concepto_id: conceptoId, importe: entero, nota } : { tipo, moneda, fecha, concepto_id: conceptoId, importe: entero, nota, tenant_id: tipo === 'egreso' ? null : tenant || null } });
      toast('Movimiento guardado'); onClose();
    } catch (e) { setError(e); }
  }
  async function borrar() {
    if (!initial || !await confirmar({ titulo: '¿Borrar este movimiento?', cuerpo: 'Se recalcularán la caja y el beneficio.', accion: 'Borrar movimiento', peligro: true })) return;
    try { await mutation.mutateAsync({ method: 'DELETE', id: initial.id }); toast('Movimiento borrado'); onClose(); } catch (e) { setError(e); }
  }
  return <Modal title={initial ? 'Detalle del movimiento' : 'Registrar movimiento'} close={onClose} busy={mutation.isPending}>
    {initial?.reparto_id ? <><p>Esta línea pertenece a un reparto para {initial.beneficiario}.</p><p><Dinero value={initial.importe} moneda={initial.moneda} /> · {initial.fecha}</p><p>Para corregirla, borra el reparto completo y vuelve a registrarlo.</p><a className="btn" href="/finanzas?tab=repartos">Ver repartos</a></> : <form onSubmit={(e) => void guardar(e)}>
      <fieldset disabled={mutation.isPending} className="fin-fieldset"><legend>Tipo de movimiento</legend><div className="fin-segment">{TIPOS.map((t) => <button type="button" key={t} className={`btn ${t === tipo ? '' : 'alt'}`} disabled={Boolean(initial)} aria-pressed={t === tipo} onClick={() => { setTipo(t); setConcepto(''); }}>{LABEL[t]}</button>)}</div></fieldset>
      <div className="fin-form"><label>Concepto<select required value={conceptoId || ''} onChange={(e) => setConcepto(e.target.value)} disabled={mutation.isPending || !catalogo.data}>{!opciones.length ? <option value="">No hay conceptos activos</option> : null}{initial && !opciones.some((c) => c.id === initial.concepto_id) ? <option value={initial.concepto_id}>{initial.concepto_nombre} (inactivo)</option> : null}{opciones.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <label>Fecha<input type="date" required min="2025-01-01" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <label>Moneda<select disabled={Boolean(initial)} value={moneda} onChange={(e) => { setMoneda(e.target.value as FinMoneda); setImporte(''); }}>{MONEDAS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Importe ({moneda})<input required inputMode="decimal" placeholder={moneda === 'EUR' ? '0,00' : '0'} value={importe} onChange={(e) => setImporte(e.target.value)} /><small>{moneda === 'EUR' ? 'Euros, hasta dos decimales' : 'Pesos enteros, sin decimales'}</small></label>
        {tipo !== 'egreso' ? <label>Cliente (opcional)<select value={tenant} disabled={Boolean(initial)} onChange={(e) => setTenant(e.target.value)}><option value="">Sin cliente</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label> : null}
        <label className="fin-full">Nota<textarea maxLength={2000} rows={3} value={nota} onChange={(e) => setNota(e.target.value)} /></label>
      </div>
      {initial ? <p className="muted">Registrado por {initial.created_by} · {initial.created_at.slice(0, 10)}</p> : null}
      <ErrorFin error={error || catalogo.error} /><div className="fin-actions"><button className="btn" disabled={mutation.isPending || !catalogo.data || !conceptoId}>Guardar movimiento</button>{initial ? <button className="btn alt" type="button" disabled={mutation.isPending} onClick={() => void borrar()}>Borrar movimiento</button> : null}</div>
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
      ? <p className="fin-fijo"><strong>{c.nombre}</strong><small className="muted">Lo usan los repartos del equipo: no se renombra ni se desactiva.</small></p>
      : <form onSubmit={(e) => { e.preventDefault(); void change({ nombre }); }}><input aria-label={`Nombre de ${c.nombre}`} required maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} /><button className="btn alt btnsm" disabled={mutation.isPending || nombre === c.nombre}>Guardar</button></form>}
    <div className="fin-concept-actions"><span className="muted">{c.activo ? 'Activo' : 'Inactivo'}</span><button className="btn alt btnsm" aria-label={`Subir ${c.nombre}`} disabled={mutation.isPending || !prev} onClick={() => void change({ position: prev!.position })}>↑</button><button className="btn alt btnsm" aria-label={`Bajar ${c.nombre}`} disabled={mutation.isPending || !next} onClick={() => void change({ position: next!.position })}>↓</button>
      {sistema ? null : <><button className="btn alt btnsm" disabled={mutation.isPending} onClick={() => void change({ activo: c.activo ? 0 : 1 })}>{c.activo ? 'Desactivar' : 'Activar'}</button><button className="btn alt btnsm" disabled={mutation.isPending} onClick={() => void borrar()}>Borrar</button></>}</div>
    <ErrorFin error={error} />
  </div>;
}
