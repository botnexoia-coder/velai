// Bandeja de conversaciones a pantalla completa: lista a la izquierda, hilo y cajón a
// la derecha, contra /api/admin/inbox (UNA llamada con lista + hilo, sondeada por
// TanStack Query cada 15 s cuando hay algo vivo y cada 60 s si no).
//
// La lógica sutil vive en lib/composer.ts y lib/format.ts (testeadas aparte):
//  - ventana de Meta de 24 h (el cajón se cierra ANTES de escribir, con el motivo);
//  - cola de espera con cuenta atrás (queueMin/pingMin vienen DEL SERVIDOR: si se
//    escribieran a mano aquí, un día dirían cosas distintas que el worker);
//  - presencia del visitante web.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { traducir } from '../api/errors';
import { ChIcon, CH_LABEL, IcoBack, IcoChat, IcoChevronDown, IcoDownload, IcoSearch, IcoSend, IcoSliders } from '../components/icons';
import { useToast } from '../components/Toasts';
import { composerState } from '../lib/composer';
import { fmtDia, fmtHora, fmtShort, dayLabel, initials, minutesSince, prevPrefix, tenantColor, whoOf } from '../lib/format';
import {
  convQs,
  useAvailability,
  useInbox,
  useMe,
  useRelease,
  useReply,
  useSetAvailability,
  useTakeover,
  useTenants,
  type ConvFilters,
} from '../hooks/queries';
import type { Availability, ConvChannel, InboxCount, InboxRow, InboxThread } from '../api/types';

// Todos los canales del producto, en el orden en que se miran. Los que aún no reciben
// nada TAMBIÉN se pintan, a 0 y apagados: esconderlos dejaba la duda de si el canal
// existe, y el filtro por ese canal devuelve vacío de verdad, no «todo».
const CH_ORDER: ConvChannel[] = ['whatsapp', 'web', 'messenger', 'instagram'];
const CONVERSATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function Conversaciones() {
  const [searchParams] = useSearchParams();
  const { data: me } = useMe();
  const isVelai = me?.role === 'velai';
  const { data: tenants } = useTenants(isVelai === true);
  const toast = useToast();

  // El buscador espera a que se deje de teclear (350 ms): cada tecla sería una consulta a D1.
  const [qRaw, setQRaw] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(qRaw.trim()), 350);
    return () => clearTimeout(t);
  }, [qRaw]);

  const [channel, setChannel] = useState('');
  const [pop, setPop] = useState<ConvFilters>({});
  const [openId, setOpenId] = useState<string | null>(() => {
    const linked = searchParams.get('conversation');
    return linked && CONVERSATION_ID_RE.test(linked) ? linked : null;
  });
  const [popOpen, setPopOpen] = useState<'' | 'filtros' | 'avail'>('');

  const filters = useMemo<ConvFilters>(() => {
    const f: ConvFilters = { ...pop };
    if (q) f.q = q;
    if (channel) f.channel = channel;
    return f;
  }, [pop, q, channel]);

  const inbox = useInbox(filters, openId);
  const d = inbox.data;
  const rows = d?.conversations ?? [];
  const enCola = (d?.counts ?? []).reduce((a, c) => a + (c.waiting || 0), 0);
  const queueMin = d?.queueMin ?? 15;

  // Filtros y disponibilidad son cajones anclados: uno abierto a la vez, y se cierran al
  // pulsar fuera o con Escape. No son diálogos — no bloquean la bandeja detrás.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t?.closest('.rel')) setPopOpen('');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopOpen('');
    };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Un tope que no se dice se lee como «esto es todo»: la bandeja trae las 40 más recientes.
  const countLabel = d
    ? `${rows.length} conversaci${rows.length === 1 ? 'ón' : 'ones'}${rows.length >= 40 ? ' — las más recientes; filtra por fecha o canal para ver más atrás' : ''}`
    : '';

  return (
    <div className="cview">
      <div className="cvhead">
        <h1>Conversaciones</h1>
        <span className="cvsep" />
        <span className="convcount">{countLabel}</span>
        <span className="spacer" />
        {enCola ? (
          <span className="pill-wait">
            <i />
            <span>{enCola === 1 ? '1 esperando asesor' : `${enCola} esperando asesor`}</span>
          </span>
        ) : null}
        <Disponibilidad
          open={popOpen === 'avail'}
          onToggle={() => setPopOpen((p) => (p === 'avail' ? '' : 'avail'))}
          isVelai={isVelai === true}
        />
        <button
          className="iconbtn"
          type="button"
          aria-label="Exportar CSV"
          data-tip="Descarga lo que estás viendo AHORA, con los filtros aplicados"
          onClick={() => {
            window.location.href = `/api/admin/conversations/export.csv${convQs(filters)}`;
          }}
        >
          <IcoDownload />
        </button>
      </div>
      <div className="convmsg">{inbox.error ? <p className="error">{traducir(inbox.error)}</p> : null}</div>
      <div className={`inbox${openId ? ' is-thread' : ''}`}>
        <div className="inbox-l">
          <div className="cvfilters">
            <div className="lsearch">
              <IcoSearch />
              <input
                placeholder="Buscar persona o número…"
                autoComplete="off"
                maxLength={60}
                value={qRaw}
                onChange={(e) => {
                  setQRaw(e.target.value);
                  setOpenId(null);
                }}
                aria-label="Buscar en la bandeja"
              />
              <span className="rel">
                <button
                  className={`fbtn${popOpen === 'filtros' ? ' is-on' : ''}`}
                  type="button"
                  aria-expanded={popOpen === 'filtros'}
                  onClick={() => setPopOpen((p) => (p === 'filtros' ? '' : 'filtros'))}
                >
                  <IcoSliders />
                  <span>Filtros</span>
                </button>
                {popOpen === 'filtros' ? (
                  <FiltrosPop
                    isVelai={isVelai === true}
                    tenants={tenants?.tenants ?? []}
                    value={pop}
                    onApply={(f) => {
                      setPop(f);
                      setOpenId(null);
                      setPopOpen('');
                    }}
                    onClear={() => {
                      setPop({});
                      setQRaw('');
                      setOpenId(null);
                      setPopOpen('');
                    }}
                  />
                ) : null}
              </span>
            </div>
            <div className="lbar">
              <ChTabs
                counts={d?.counts ?? []}
                current={channel}
                onPick={(k) => {
                  setChannel(k);
                }}
              />
            </div>
          </div>
          <div className="inbox-list">
            {rows.length ? (
              rows.map((c) => <ConvRow key={c.id} c={c} isOn={c.id === openId} onOpen={() => setOpenId(c.id)} />)
            ) : d ? (
              <p className="cvempty">No hay conversaciones con estos filtros. Solo se guardan desde el 26 de agosto de 2026.</p>
            ) : null}
          </div>
        </div>
        <div className="inbox-r">
          {openId && d?.thread ? (
            <Thread
              thread={d.thread}
              queueMin={queueMin}
              onBack={() => setOpenId(null)}
              onToast={toast}
            />
          ) : (
            <div className="thread-empty">
              <div>
                <IcoChat />
                <b>Elige una conversación</b>
                <p>Se guardan desde el 26 de agosto de 2026 y se borran solas a los 90 días.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pestañas de canal, con su logo y su contador ─────────────────────────────
function ChTabs({ counts, current, onPick }: { counts: InboxCount[]; current: string; onPick: (k: string) => void }) {
  const by = new Map(counts.map((c) => [c.channel, c]));
  const canales = [...new Set<ConvChannel>([...CH_ORDER, ...counts.map((c) => c.channel)])];
  const sum = (f: 'n' | 'unread') => counts.reduce((a, c) => a + (c[f] || 0), 0);
  const tabs: { k: string; label: string; n: number; u: number }[] = [
    { k: '', label: 'Todos', n: sum('n'), u: sum('unread') },
    ...canales.map((k) => ({ k, label: CH_LABEL[k] ?? k, n: by.get(k)?.n ?? 0, u: by.get(k)?.unread ?? 0 })),
  ];
  return (
    <div className="chtabs">
      {tabs.map((t) => (
        <button
          key={t.k || 'todos'}
          type="button"
          className={`chtab${t.k === current ? ' is-on' : ''}${t.n ? '' : ' is-zero'}`}
          aria-label={t.label}
          // El globo solo en las pestañas de ICONO: la de «Todos» ya lleva su palabra
          // escrita. De paso dice qué significa el punto de sin leer.
          data-tip={t.k ? `${t.label}\n${t.u ? `${t.u} sin leer de ${t.n}` : `${t.n} conversaciones`}` : undefined}
          onClick={() => onPick(t.k)}
        >
          {t.k ? <ChIcon ch={t.k as ConvChannel} /> : <span>{t.label}</span>} <b>{t.n}</b>
          {t.u ? <i /> : null}
        </button>
      ))}
    </div>
  );
}

// ── Fila de la lista ─────────────────────────────────────────────────────────
function ConvRow({ c, isOn, onOpen }: { c: InboxRow; isOn: boolean; onOpen: () => void }) {
  const who = whoOf(c);
  // Los minutos que lleva esperando, no la hora del último mensaje: con varias en cola
  // es el único dato con el que se decide a quién atender primero.
  const espera = c.state === 'esperando' ? minutesSince(c.state_at) : null;
  return (
    <button type="button" className={`cvrow${isOn ? ' is-on' : ''}${c.state === 'esperando' ? ' is-wait' : ''}`} onClick={onOpen}>
      <span className="cvav" style={{ background: tenantColor(c.external_id) }}>
        {initials(who)}
        <span className="cvch">
          <ChIcon ch={c.channel} />
        </span>
      </span>
      <span className="cvmain">
        <span className="cvtop">
          <span className="cvwho">{who}</span>
          {espera !== null ? (
            <span className="cvwait">{espera}′ esperando</span>
          ) : c.state === 'humano' ? (
            <span className="cvwhen">{c.agent_email ? c.agent_email.split('@')[0] : 'en curso'}</span>
          ) : (
            <span className="cvwhen">{fmtShort(c.last_at)}</span>
          )}
        </span>
        <span className="cvbot">
          <span className="cvprev">
            <i>{prevPrefix(c.preview_role)}</i>
            {String(c.preview ?? '')}
          </span>
          {/* Para Velai —que ve conversaciones de todos— saber de quién es no es opcional.
              Para un cliente, tenant_name no viaja y la etiqueta no se pinta. */}
          {c.tenant_name ? (
            <span className="cvten">
              <i style={{ background: tenantColor(c.tenant_id ?? c.tenant_name) }} />
              <span>{c.tenant_name}</span>
            </span>
          ) : null}
        </span>
      </span>
      {c.unread ? <i className="cvdot" /> : null}
    </button>
  );
}

// ── Popover de filtros ───────────────────────────────────────────────────────
function FiltrosPop({
  isVelai,
  tenants,
  value,
  onApply,
  onClear,
}: {
  isVelai: boolean;
  tenants: { id: string; name: string }[];
  value: ConvFilters;
  onApply: (f: ConvFilters) => void;
  onClear: () => void;
}) {
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const f: ConvFilters = {};
    const tenant = String(data.get('tenant') ?? '');
    const from = String(data.get('from') ?? '');
    const to = String(data.get('to') ?? '');
    if (tenant) f.tenant = tenant;
    if (from) f.from = from;
    if (to) f.to = to;
    if (data.get('lead')) f.lead = 'si';
    if (data.get('sinResolver')) f.sinResolver = '1';
    onApply(f);
  }
  return (
    <form className="pop" onSubmit={onSubmit}>
      <h3>Filtrar la bandeja</h3>
      {isVelai ? (
        <label>
          <span>Cliente</span>
          <select name="tenant" defaultValue={value.tenant ?? ''}>
            <option value="">Todos los clientes</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="popdos">
        <label>
          <span>Desde</span>
          <input name="from" type="date" defaultValue={value.from ?? ''} />
        </label>
        <label>
          <span>Hasta</span>
          <input name="to" type="date" defaultValue={value.to ?? ''} />
        </label>
      </div>
      <label className="fchk">
        <input type="checkbox" name="lead" value="si" defaultChecked={value.lead === 'si'} />
        Solo las que dieron lead
      </label>
      <label className="fchk">
        <input type="checkbox" name="sinResolver" value="1" defaultChecked={value.sinResolver === '1'} />
        Solo con preguntas sin respuesta
      </label>
      <div className="popfoot">
        <button className="btn" type="submit">
          Aplicar
        </button>
        <button className="btn alt" type="button" onClick={onClear}>
          Limpiar
        </button>
      </div>
    </form>
  );
}

// ── Disponibilidad: el interruptor es de esta persona; el horario es del cliente y lo
// cierra por fuera. Se dice cuál de los dos manda. ───────────────────────────
function Disponibilidad({ open, onToggle, isVelai }: { open: boolean; onToggle: () => void; isVelai: boolean }) {
  const { data } = useAvailability();
  const set = useSetAvailability();
  const toast = useToast();
  return (
    <span className="rel">
      <button
        className={`availbtn${data && !data.offering ? ' off' : ''}`}
        type="button"
        aria-expanded={open}
        data-tip="Si lo apagas, Vai deja de pasarte conversaciones y atiende él solo. No cierra las que ya tengas."
        onClick={onToggle}
      >
        <i />
        <span className="avlabel">{data ? (data.offering ? 'Asesor disponible' : data.available ? 'Fuera de horario' : 'No disponible') : '—'}</span>
        <IcoChevronDown />
      </button>
      {open ? (
        <div className="pop">
          <h3>Tu disponibilidad</h3>
          <div className="swrow">
            <b>Recibir conversaciones</b>
            <button
              className={`sw${data?.available ? ' on' : ''}`}
              type="button"
              role="switch"
              aria-checked={Boolean(data?.available)}
              aria-label="Recibir conversaciones"
              disabled={set.isPending}
              onClick={() =>
                set.mutate(!data?.available, {
                  onError: (e) => toast(`No se pudo cambiar la disponibilidad: ${traducir(e)}`, false),
                })
              }
            >
              <i />
            </button>
          </div>
          <p>{data ? availNote(data, isVelai) : ''}</p>
          <p className="pophint">
            {data ? `${data.withinHours ? 'Dentro del horario de atención' : 'Fuera del horario de atención'} · ${data.tz}` : ''}
          </p>
        </div>
      ) : null}
    </span>
  );
}

function availNote(d: Availability, isVelai: boolean): string {
  // Velai solo cubre las conversaciones de Velai: las de los clientes las atienden ellos.
  const para = isVelai && d.forTenant ? ` Solo cubres las conversaciones de ${d.forTenant}: las de los clientes las atienden ellos.` : '';
  if (d.available && !d.withinHours) {
    return `Estás marcado como disponible, pero fuera del horario de atención (${d.tz}) no se ofrecen asesores: Vai atiende y captura el lead.${para}`;
  }
  if (d.offering) {
    return (d.advisors === 1 ? 'Vai puede pasar una conversación a una persona.' : `${d.advisors} personas disponibles.`) + para;
  }
  return `Vai atiende todo y captura leads. Nadie va a recibir conversaciones.${para}`;
}

// ── El hilo ──────────────────────────────────────────────────────────────────
function Thread({
  thread,
  queueMin,
  onBack,
  onToast,
}: {
  thread: InboxThread;
  queueMin: number;
  onBack: () => void;
  onToast: (msg: string, ok?: boolean) => void;
}) {
  const c = thread.conversation;
  const quien = whoOf(c);
  const logRef = useRef<HTMLDivElement>(null);
  const lastConvRef = useRef<string | null>(null);

  // Al ABRIR un hilo se baja al último mensaje; en los repintados del sondeo solo se
  // baja si el lector YA estaba abajo — saltar al final mientras alguien lee hacia
  // arriba es insoportable.
  const wasAtBottomRef = useRef(true);
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const isNew = lastConvRef.current !== c.id;
    lastConvRef.current = c.id;
    if (isNew || wasAtBottomRef.current) log.scrollTop = log.scrollHeight;
  });

  let dia = '';
  return (
    <div className="thread">
      <div className="thread-h">
        <button className="cvback" type="button" data-tip="Volver a la lista" aria-label="Volver a la lista" onClick={onBack}>
          <IcoBack />
        </button>
        <span className="cvav" style={{ background: tenantColor(c.external_id) }}>
          {initials(quien)}
          <span className="cvch">
            <ChIcon ch={c.channel} />
          </span>
        </span>
        <span className="grow">
          <span className="thwho">{quien}</span>
          <span className="thmeta">
            <b>{CH_LABEL[c.channel] ?? c.channel}</b>
            {c.tenant_name ? (
              <>
                ·<b>{c.tenant_name}</b>
              </>
            ) : null}
            ·<span className="mono">{String(c.external_id ?? '').replace(/^(whatsapp:|messenger:)/, '').slice(0, 8)}</span>
          </span>
        </span>
        {c.unanswered > 0 ? <span className="chip warn">{c.unanswered} sin respuesta</span> : null}
        <span className="chip">se borra el {fmtDia(c.expires_at)}</span>
      </div>
      <div
        className="chatlog thread-log"
        ref={logRef}
        onScroll={() => {
          const log = logRef.current;
          if (log) wasAtBottomRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
        }}
      >
        <i className="cvfill" />
        {thread.messages.length ? (
          thread.messages.map((m, i) => {
            const kind = m.role === 'user' ? 'user' : m.role === 'agent' ? 'agent' : 'bot';
            const clave = m.created_at ? new Date(m.created_at).toDateString() : '';
            // Divisoria de día: sin ella no se sabe si el «11:52» es de hoy o de la
            // semana pasada.
            const sep = clave && clave !== dia;
            if (clave) dia = clave;
            return (
              <div key={i} style={{ display: 'contents' }}>
                {sep ? (
                  <div className="cvday">
                    <span>{dayLabel(m.created_at)}</span>
                  </div>
                ) : null}
                <div className={`bub ${kind}`}>
                  {m.role === 'agent' ? <span className="who">{m.agent_email || 'equipo'}</span> : null}
                  <span className="txt">{m.text}</span>
                  <time>{fmtHora(m.created_at)}</time>
                </div>
              </div>
            );
          })
        ) : (
          <p className="muted">Sin mensajes guardados.</p>
        )}
      </div>
      <Composer thread={thread} queueMin={queueMin} onToast={onToast} />
    </div>
  );
}

// ── El cajón de escritura ────────────────────────────────────────────────────
function Composer({ thread, queueMin, onToast }: { thread: InboxThread; queueMin: number; onToast: (msg: string, ok?: boolean) => void }) {
  const c = thread.conversation;
  const state = composerState(thread.window, c, queueMin);
  const takeover = useTakeover();
  const release = useRelease();
  const reply = useReply();
  // El borrador vive en estado de React POR conversación: el repintado del sondeo cada
  // 15 s no puede borrar lo que la persona está escribiendo.
  const [draft, setDraft] = useState('');
  const convRef = useRef(c.id);
  if (convRef.current !== c.id) {
    convRef.current = c.id;
    if (draft) setDraft('');
  }
  const taRef = useRef<HTMLTextAreaElement>(null);

  // El campo crece con lo escrito (una línea de base, tope en 112 px y luego scroll).
  // La altura se toca por CSSOM, no con style="": compatible con la CSP del panel.
  function grow() {
    const t = taRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(112, t.scrollHeight)}px`;
  }

  function send() {
    const text = draft.trim();
    if (!text || reply.isPending) return;
    reply.mutate(
      { id: c.id, text },
      {
        onSuccess: () => {
          setDraft('');
          if (taRef.current) taRef.current.style.height = 'auto';
          onToast('Enviado ✓');
        },
        // Si falló por la ventana, el estado de la pantalla estaba viejo: la
        // invalidación del hook refresca la bandeja y el cajón se cierra solo.
        onError: (e) => onToast(`NO se envió: ${traducir(e)}`, false),
      },
    );
  }

  if (state.kind === 'waiting') {
    // Aquí NO se pinta campo de texto: lo que toca es entrar, no escribir.
    return (
      <div className="composer">
        <div className="cvstrip">
          <span className="grow">
            <b>
              {state.waitedMin !== null ? `${state.waitedMin}′ esperando · ` : ''}
              Pidió hablar con una persona del equipo
            </b>
            {state.remainingMin !== null ? <small>Vai retoma en {state.remainingMin} min si nadie entra.</small> : null}
          </span>
          <button
            className="btn"
            type="button"
            disabled={takeover.isPending}
            onClick={() =>
              takeover.mutate(c.id, {
                onSuccess: () => onToast('Control tomado ✓ — ya puedes escribirle'),
                onError: (e) => onToast(`No se pudo: ${traducir(e)}`, false),
              })
            }
          >
            Tomo el control
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === 'closed') {
    return (
      <div className="composer">
        <div className="cvfield shut">
          <textarea rows={1} disabled placeholder="Cajón cerrado" aria-label="Cajón cerrado" />
          <button className="cvsend" type="button" disabled tabIndex={-1} aria-hidden="true">
            <IcoSend />
          </button>
        </div>
        <div className="crow">
          <span className="cwin shut">{state.why}</span>
        </div>
      </div>
    );
  }

  // En WhatsApp lo que importa es cuánto queda de la ventana de Meta; en web, si el
  // visitante sigue delante. En los dos casos se enseña el dato, no un semáforo verde.
  const estado =
    state.status.kind === 'web' ? (
      state.status.away ? (
        <span className="cwin shut">El visitante no está en la página ahora mismo. Tu mensaje se guarda y lo verá si vuelve durante su visita.</span>
      ) : (
        <span className="cwin">El visitante está en la página.</span>
      )
    ) : (
      <span className="cwin">
        Quedan <b>{state.status.hoursLeft} h</b> de la ventana de WhatsApp.
      </span>
    );

  return (
    <div className="composer">
      <div className="cvfield">
        <textarea
          ref={taRef}
          rows={1}
          placeholder="Escribe tu respuesta…"
          value={draft}
          disabled={reply.isPending}
          aria-label="Tu respuesta"
          onChange={(e) => {
            setDraft(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="cvsend" type="button" data-tip="Enviar (Ctrl+Intro)" aria-label="Enviar" disabled={reply.isPending} onClick={send}>
          <IcoSend />
        </button>
      </div>
      <div className="crow">
        <span className="cwin">
          <b>Tienes el control</b>
          {state.agentEmail ? ` · ${state.agentEmail}` : ''}
        </span>
        <span className="sp" />
        {estado}
        <span className="sp" />
        <button
          className="btn alt btnsm"
          type="button"
          disabled={release.isPending}
          onClick={() =>
            release.mutate(c.id, {
              onSuccess: () => onToast('Devuelta a Vai ✓ — se le ha avisado de que vuelve a atenderle el asistente'),
              onError: (e) => onToast(`No se pudo: ${traducir(e)}`, false),
            })
          }
        >
          Devolver a Vai
        </button>
      </div>
    </div>
  );
}
