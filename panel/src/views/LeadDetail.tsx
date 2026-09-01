// Detalle del lead en modal: contexto arriba en píldoras, «qué buscaba» destacado,
// SOLO las tarjetas con dato, cambio de estado, notas y actividad. Cada acción confirma
// con toast — un fallo invisible hace creer que se guardó.
import { useEffect, useRef, useState } from 'react';
import { confirmar } from '../components/Confirmar';
import { ST_LABEL, traducir } from '../api/errors';
import { StatusPill, TenantChip } from '../components/Pills';
import { useToast } from '../components/Toasts';
import { fmt } from '../lib/format';
import { useLead, useLeadDelete, useLeadNote, useLeadRetry, useLeadStatus, useMe } from '../hooks/queries';
import type { LeadStatus } from '../api/types';

const STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'won', 'lost', 'spam'];

export function LeadDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { data, error } = useLead(id);
  const { data: me } = useMe();
  const isVelai = me?.role === 'velai';
  const toast = useToast();
  const saveStatus = useLeadStatus();
  const addNote = useLeadNote();
  const retry = useLeadRetry();
  const del = useLeadDelete();
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [note, setNote] = useState('');

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    if (error) {
      toast(`No se pudo abrir el lead: ${traducir(error)}`, false);
      onClose();
    }
  }, [error, onClose, toast]);

  const lead = data?.lead;
  const currentStatus: LeadStatus | '' = status || (lead?.status ?? '');

  return (
    <dialog ref={dialogRef} onClose={onClose} aria-label="Detalle del lead">
      <div className="modal-h">
        <strong>{lead ? lead.name || (lead.need ? `Sin nombre · ${lead.need}` : 'Lead sin nombre') : 'Detalle del lead'}</strong>
        <button className="btn alt" type="button" onClick={() => dialogRef.current?.close()}>
          Cerrar
        </button>
      </div>
      <div className="modal-b">
        {!lead ? (
          <p className="muted">Cargando…</p>
        ) : (
          <>
            <div className="lead-meta">
              <StatusPill status={lead.status} />
              <TenantChip id={lead.tenant_id} name={lead.tenant_name} />
              <span className="chip">{fmt(lead.created_at)}</span>
              <span className="chip">fuente: {lead.source}</span>
            </div>
            {/* Lo PRIMERO que necesita quien atiende: qué buscaba la persona. */}
            {lead.need || lead.context ? (
              <div className="card asunto mt12">
                <b>Qué buscaba</b>
                {lead.need ? <p className="as-need">{lead.need}</p> : null}
                {lead.context ? <p className="as-ctx">{lead.context}</p> : null}
              </div>
            ) : null}
            <div className="grid mt12">
              <div className="card">
                <b>WhatsApp</b>
                <span className="tel">{lead.whatsapp || '—'}</span>
              </div>
              {(
                [
                  ['Sector', lead.sector],
                  ['Canal', lead.channel],
                  ['Mensajes/día', lead.messages_per_day],
                  ['Puntuación', lead.score],
                  ['Nota del lead', lead.note],
                  ['Página', lead.page_url],
                ] as [string, string | number | null][]
              )
                .filter(([, v]) => v !== null && v !== undefined && v !== '')
                .map(([k, v]) => (
                  <div className="card" key={k}>
                    <b>{k}</b>
                    {String(v)}
                  </div>
                ))}
            </div>
            <div className="actions">
              <span className="sel">
                <select
                  value={currentStatus}
                  onChange={(e) => setStatus(e.target.value as LeadStatus)}
                  aria-label="Estado del lead"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {ST_LABEL[s]}
                    </option>
                  ))}
                </select>
              </span>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  if (!currentStatus) return;
                  saveStatus.mutate(
                    { id, status: currentStatus },
                    {
                      onSuccess: () => {
                        toast(`Estado guardado ✓ («${ST_LABEL[currentStatus] ?? currentStatus}»)`);
                        dialogRef.current?.close();
                      },
                      onError: (e) => toast(`Estado NO guardado: ${traducir(e)}`, false),
                    },
                  );
                }}
              >
                Guardar estado
              </button>
              <span className="grow" />
              {isVelai ? (
                <>
                  <button
                    className="btn alt"
                    type="button"
                    onClick={() =>
                      retry.mutate(id, {
                        onSuccess: () => toast('Reintento de avisos lanzado ✓'),
                        onError: (e) => toast(`Reintento fallido: ${traducir(e)}`, false),
                      })
                    }
                  >
                    Reintentar avisos
                  </button>
                  <button
                    className="btn bad"
                    type="button"
                    onClick={async () => {
                      if (!(await confirmar({ titulo: '¿Borrar este lead?', cuerpo: 'Se borra definitivamente con todos sus datos: notas, actividad y avisos. Es el borrado RGPD — no hay papelera.', accion: 'Borrar definitivamente', peligro: true }))) return;
                      del.mutate(id, {
                        onSuccess: () => {
                          toast('Lead borrado ✓');
                          dialogRef.current?.close();
                        },
                        onError: (e) => toast(`Lead NO borrado: ${traducir(e)}`, false),
                      });
                    }}
                  >
                    Borrar lead
                  </button>
                </>
              ) : null}
            </div>
            <div className="card">
              <b>Añadir nota</b>
              <div className="note mt6">
                <textarea
                  rows={2}
                  placeholder="Escribe la nota…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-label="Nueva nota"
                />
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    const text = note.trim();
                    if (!text) return;
                    addNote.mutate(
                      { id, text },
                      {
                        onSuccess: () => {
                          setNote('');
                          toast('Nota guardada ✓');
                        },
                        onError: (e) => toast(`Nota NO guardada: ${traducir(e)}`, false),
                      },
                    );
                  }}
                >
                  Añadir
                </button>
              </div>
            </div>
            <div className="timeline">
              <h3>Actividad</h3>
              {data.notifications.map((n, i) => (
                <article key={`nf${i}`}>
                  <b>
                    Aviso {n.channel}: {n.status}
                  </b>
                  <div className="muted">
                    Intentos: {n.attempts}
                    {n.last_error ? ` · ${n.last_error}` : ''}
                  </div>
                </article>
              ))}
              {data.notes.map((n) => (
                <article key={`nt${n.id}`}>
                  <b>{n.author_email}</b>
                  <div>{n.text}</div>
                  <small className="muted">{fmt(n.created_at)}</small>
                </article>
              ))}
              {data.events.map((n) => (
                <article key={`ev${n.id}`}>
                  <b>{n.event_type}</b>
                  <div>{n.detail || ''}</div>
                  <small className="muted">
                    {fmt(n.created_at)} · {n.actor_email}
                  </small>
                </article>
              ))}
              {!data.notifications.length && !data.notes.length && !data.events.length ? (
                <p className="muted">Sin actividad todavía: ni avisos, ni notas, ni cambios.</p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
