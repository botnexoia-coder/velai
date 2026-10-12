import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { traducir } from '../api/errors';
import { confirmar } from '../components/Confirmar';
import { useToast } from '../components/Toasts';
import { dayKey, monthShape } from '../lib/calendario';
import { MOBILE_PREVIEW } from '../mobilePreview';
import './editorial-calendar.css';

export interface EditorialEntry { id: string; fecha: string; titulo: string; detalle: string | null; version: number }
type Draft = { fecha: string; titulo: string; detalle: string };

export function EditorialCalendar({ tenantId, canEdit }: { tenantId: string; canEdit: boolean }) {
  const editable = canEdit && !MOBILE_PREVIEW;
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(() => dayKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
  const [editing, setEditing] = useState<EditorialEntry | 'new' | null>(null);
  const [actionError, setActionError] = useState('');
  const client = useQueryClient();
  const toast = useToast();
  const root = `/api/admin/tenants/${encodeURIComponent(tenantId)}/editorial`;
  const from = dayKey(month.getFullYear(), month.getMonth(), 1);
  const shape = monthShape(month.getFullYear(), month.getMonth());
  const to = dayKey(month.getFullYear(), month.getMonth(), shape.days);
  const query = useQuery({ queryKey: ['editorial', tenantId, from, to], queryFn: ({ signal }) => api<{ entries: EditorialEntry[]; mas?: boolean }>(`${root}?${new URLSearchParams({ from, to })}`, undefined, { signal }) });
  const mutation = useMutation({
    mutationFn: ({ method, entry, draft }: { method: 'POST' | 'PATCH' | 'DELETE'; entry?: EditorialEntry; draft?: Draft }) => api(method === 'POST' ? root : `${root}/${encodeURIComponent(entry!.id)}${method === 'DELETE' ? `?version=${entry!.version}` : ''}`, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(method === 'DELETE' ? {} : { body: JSON.stringify({ ...draft, ...(entry ? { version: entry.version } : {}) }) }),
    }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['editorial', tenantId] }); setActionError(''); },
  });
  const entries = query.data?.entries ?? [];
  const dayEntries = entries.filter(e => e.fecha === selected);
  function shift(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next); setSelected(dayKey(next.getFullYear(), next.getMonth(), 1)); setActionError('');
  }
  function errorText(error: unknown) {
    return error instanceof ApiError && error.status === 409 ? 'Este registro cambió desde que lo abriste. Actualiza la consulta y revisa los cambios antes de guardar.' : traducir(error);
  }
  async function remove(entry: EditorialEntry) {
    if (!editable || !(await confirmar({ titulo: '¿Borrar esta planificación?', cuerpo: entry.titulo, accion: 'Borrar', peligro: true }))) return;
    try { await mutation.mutateAsync({ method: 'DELETE', entry }); toast('Planificación borrada'); }
    catch (error) { setActionError(errorText(error)); }
  }
  return <section className="editorial-calendar" aria-label="Planificación del equipo">
    <p className="muted">Pulsa una fecha para añadir un evento. Organiza grabaciones, episodios y tareas del equipo. Estas notas se guardan en Velai y no crean citas ni reservas en Google.</p>
    <div className="card">
      <div className="calnav">
        <button className="btn alt btnsm" type="button" aria-label="Mes anterior" onClick={() => shift(-1)}>←</button>
        <h2>{new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(month)}</h2>
        <button className="btn alt btnsm" type="button" aria-label="Mes siguiente" onClick={() => shift(1)}>→</button>
        <button className="btn alt btnsm" type="button" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(dayKey(now.getFullYear(), now.getMonth(), now.getDate())); }}>Hoy</button>
      </div>
      {query.isPending ? <p role="status">Cargando planificación…</p> : null}
      {query.error ? <div role="alert"><p>No se pudo cargar la planificación: {traducir(query.error)}</p><button className="btn alt" type="button" onClick={() => void query.refetch()}>Reintentar consulta</button></div> : null}
      {query.data?.mas ? <p role="status">Hay más de 500 registros en este mes. La consulta muestra los primeros 500.</p> : null}
      <div className="editorial-grid" aria-label="Días del mes">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => <span className="editorial-weekday" key={d}>{d}</span>)}
        {Array.from({ length: shape.lead }, (_, i) => <span key={`before-${i}`} />)}
        {Array.from({ length: shape.days }, (_, i) => {
          const fecha = dayKey(month.getFullYear(), month.getMonth(), i + 1);
          const list = entries.filter(e => e.fecha === fecha);
          return <button key={fecha} type="button" className={`editorial-day${selected === fecha ? ' selected' : ''}`} aria-pressed={selected === fecha} aria-label={`${fecha}${list.length ? `, ${list.length} registros` : ''}`} onClick={() => { setSelected(fecha); setActionError(''); if (editable) setEditing('new'); }}><strong>{i + 1}</strong>{list.slice(0, 2).map(e => <span key={e.id} className="editorial-chip">{e.titulo}</span>)}{list.length > 2 ? <small>+{list.length - 2}</small> : null}</button>;
        })}
      </div>
    </div>
    <div className="card editorial-day-detail">
      <div className="actions"><h3>Planificación · {selected}</h3>{editable ? <button className="btn" type="button" disabled={mutation.isPending} onClick={() => setEditing('new')}>Añadir planificación</button> : <span className="muted">Solo lectura</span>}</div>
      {actionError ? <div role="alert"><p>{actionError}</p><button className="btn alt" type="button" onClick={() => void query.refetch()}>Actualizar consulta</button></div> : null}
      {!query.isPending && !query.error && !dayEntries.length ? <p className="muted">Sin planificación para este día.</p> : null}
      {dayEntries.map(entry => <article className="editorial-entry" key={entry.id}><h4>{entry.titulo}</h4>{entry.detalle ? <p>{entry.detalle}</p> : null}{editable ? <div className="actions"><button className="btn alt btnsm" type="button" disabled={mutation.isPending} onClick={() => setEditing(entry)}>Editar</button><button className="btn alt btnsm" type="button" disabled={mutation.isPending} onClick={() => void remove(entry)}>Borrar</button></div> : null}</article>)}
    </div>
    {editing && editable ? <EditorialDialog key={editing === 'new' ? selected : editing.id} initial={editing === 'new' ? { fecha: selected, titulo: '', detalle: '' } : { fecha: editing.fecha, titulo: editing.titulo, detalle: editing.detalle ?? '' }} busy={mutation.isPending} close={() => setEditing(null)} save={async draft => {
      await mutation.mutateAsync({ method: editing === 'new' ? 'POST' : 'PATCH', draft, ...(editing === 'new' ? {} : { entry: editing }) });
      setSelected(draft.fecha); setMonth(new Date(Number(draft.fecha.slice(0, 4)), Number(draft.fecha.slice(5, 7)) - 1, 1)); setEditing(null); toast('Planificación guardada');
    }} errorText={errorText} /> : null}
  </section>;
}

function EditorialDialog({ initial, busy, close, save, errorText }: { initial: Draft; busy: boolean; close: () => void; save: (draft: Draft) => Promise<void>; errorText: (error: unknown) => string }) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const sending = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(document.activeElement);
  useEffect(() => {
    const previous = restoreFocus.current;
    const element = dialog.current;
    try { element?.showModal(); } catch { element?.setAttribute('open', ''); }
    titleInput.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  async function dismiss() {
    if (busy || sending.current) return;
    if (JSON.stringify(draft) !== JSON.stringify(initial) && !(await confirmar({ titulo: '¿Descartar los cambios?', accion: 'Descartar', peligro: true }))) return;
    close();
  }
  return <dialog className="modal editorial-dialog" ref={dialog} aria-labelledby="editorial-dialog-title" onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)') ?? []);
    const first = controls[0], last = controls.at(-1);
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  }} onCancel={e => { e.preventDefault(); void dismiss(); }}>
    <div className="modal-h"><strong id="editorial-dialog-title">{initial.titulo ? 'Editar planificación' : 'Añadir evento'}</strong><button className="btn alt btnsm" type="button" disabled={busy} onClick={() => void dismiss()}>Cerrar</button></div>
    <form className="modal-b" onSubmit={async e => {
      e.preventDefault(); if (busy || sending.current) return;
      if (!draft.titulo.trim()) { setError('Escribe qué grabarán o planificarán.'); return; }
      sending.current = true; setError('');
      try { await save({ ...draft, titulo: draft.titulo.trim(), detalle: draft.detalle.trim() }); }
      catch (cause) { setError(errorText(cause)); }
      finally { sending.current = false; }
    }}>
      <label>Fecha<input type="date" min="2025-01-01" max="2100-12-31" required value={draft.fecha} onChange={e => setDraft(d => ({ ...d, fecha: e.target.value }))} /></label>
      <label>Qué grabaremos / episodio<input ref={titleInput} required maxLength={160} value={draft.titulo} onChange={e => setDraft(d => ({ ...d, titulo: e.target.value }))} /></label>
      <label>Detalles<textarea rows={5} maxLength={4000} value={draft.detalle} onChange={e => setDraft(d => ({ ...d, detalle: e.target.value }))} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="actions"><button className="btn alt" type="button" disabled={busy} onClick={() => void dismiss()}>Cancelar</button><button className="btn" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar planificación'}</button></div>
    </form>
  </dialog>;
}
