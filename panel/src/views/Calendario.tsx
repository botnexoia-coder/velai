// Calendario (SPEC-CALENDARIO), estilo Google Calendar: rejilla mensual continua,
// número del día en círculo (hoy relleno), citas como chips y el detalle del día en
// modal. El cliente abre SU calendario; Velai abre el del tenant velai con selector
// para saltar al de cualquier cliente.
import { useEffect, useMemo, useRef, useState } from 'react';
import { confirmar } from '../components/Confirmar';
import { useNavigate, useSearchParams } from 'react-router';
import { traducir } from '../api/errors';
import { HoursGrid } from '../components/HoursGrid';
import { useToast } from '../components/Toasts';
import { apptsByDay, calTzHm, calTzDay, dayKey, estadoConfirmacion, ledgerRecordatorio, monthRange, monthShape } from '../lib/calendario';
import { gridFromHours, hoursFromGrid, copyMonday, gridVacio, type Grid } from '../lib/horario';
import {
  useAppointments,
  useCalendar,
  useCalendarConnect,
  useCalendarDisconnect,
  useCalendarPatch,
  useMe,
  useRemindersPatch,
  useTemplateCreate,
  useTenants,
} from '../hooks/queries';
import type { Appointment, CalendarRow, Confirmaciones, WeekHours } from '../api/types';

export function Calendario() {
  const { data: me } = useMe();
  const isVelai = me?.role === 'velai';
  const isCliente = me?.role === 'cliente';
  const { data: tenants } = useTenants(isVelai === true);
  const toast = useToast();
  const navigate = useNavigate();
  // Desde la lista de Clientes se llega con ?t=<id> (el «Abrir» de la columna Calendario).
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(() => params.get('t'));

  // Al volver del OAuth el callback redirige con #calendar=ok:<tenantId>: se reabre SU
  // calendario (velai, el del tenant conectado; el cliente siempre el suyo).
  useEffect(() => {
    const h = String(window.location.hash || '');
    if (!h.startsWith('#calendar=')) return;
    const r = h.slice(10);
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch {
      /* sin history no pasa nada */
    }
    if (!r.startsWith('ok')) {
      toast(`Conexión de calendario fallida: ${r}`, false);
      return;
    }
    toast('Google Calendar conectado ✓');
    const tid = r.split(':')[1];
    if (tid) setSelected(tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  // Tenant efectivo: el cliente, el suyo; velai, el seleccionado (o su propio negocio).
  const tenantId = isCliente
    ? me?.tenantId ?? null
    : selected ?? (tenants ? (tenants.tenants.find((t) => t.slug === 'velai') ?? tenants.tenants[0])?.id ?? null : null);
  const tenantName = isCliente ? me?.tenantName : tenants?.tenants.find((t) => t.id === tenantId)?.name;

  return (
    <div>
      <div className="vhead">
        <div>
          <h1>Calendario{tenantName ? ` — ${tenantName}` : ''}</h1>
          <p>Citas agendadas por Vai en el Google Calendar del negocio</p>
        </div>
        {isVelai ? (
          <div className="actions actions0">
            <span className="sel">
              <select value={tenantId ?? ''} onChange={(e) => setSelected(e.target.value)} aria-label="Cliente del calendario">
                {(tenants?.tenants ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </span>
            {/* «Volver» es de Velai (que llega desde la lista de Clientes). */}
            <button className="btn alt" type="button" onClick={() => navigate('/clientes')}>
              ← Volver a Clientes
            </button>
          </div>
        ) : null}
      </div>
      {tenantId ? <CalendarBody tenantId={tenantId} isCliente={isCliente === true} /> : null}
    </div>
  );
}

function CalendarBody({ tenantId, isCliente }: { tenantId: string; isCliente: boolean }) {
  const { data, error } = useCalendar(tenantId);
  const toast = useToast();
  const connect = useCalendarConnect();
  const cal = data?.calendar ?? null;
  const connected = Boolean(cal && cal.status === 'connected');

  useEffect(() => {
    if (error) toast(`No se pudo cargar el calendario: ${traducir(error)}`, false);
  }, [error, toast]);

  function startOAuth() {
    connect.mutate(
      { id: tenantId },
      {
        onSuccess: (d) => {
          window.location.href = d.authUrl;
        },
        onError: (e) => toast(`No se pudo iniciar la conexión: ${traducir(e)}`, false),
      },
    );
  }

  if (!data) return null;
  if (!connected) {
    return (
      <>
      <div className="card">
        <b>Conectar Google Calendar</b>
        <p className="muted mt6">
          Aún no hay calendario conectado. Al pulsar «Conectar Google» se abre la pantalla de permiso de Google: entra
          con la cuenta de Google del negocio. Vai consultará sus huecos y agendará citas directamente en su calendario,
          desde el chat web y WhatsApp.
        </p>
        <p className="muted mt6">
          Al conectar, Vai solo lee los tramos ocupados/libres del calendario elegido y crea los eventos de las citas; no
          lee el contenido del resto de eventos. Detalle del tratamiento:{' '}
          <a href="https://hirevai.com/privacidad/#google-calendar" target="_blank" rel="noopener noreferrer">
            datos de Google Calendar
          </a>{' '}
          ·{' '}
          <a href="https://hirevai.com/condiciones/#calendar" target="_blank" rel="noopener noreferrer">
            condiciones del servicio (§5)
          </a>
          .
        </p>
        {cal ? (
          <div className="mt6 muted">
            <span className="flag off">La conexión está en error ({cal.last_error ?? cal.status}): vuelve a conectar.</span>
          </div>
        ) : null}
        <div className="actions actions0">
          <button className="btn" type="button" disabled={connect.isPending} onClick={startOAuth}>
            {cal ? 'Reconectar Google' : 'Conectar Google'}
          </button>
        </div>
      </div>
      {/* La card del addon se ve TAMBIÉN sin calendario: se puede activar y crear su
          plantilla antes de conectar — solo los envíos dependen de que haya citas. */}
      <ConfirmacionesCard tenantId={tenantId} conf={data.confirmaciones ?? null} isCliente={isCliente} sinCalendario />
      </>
    );
  }
  return (
    <CalendarConnected
      tenantId={tenantId}
      cal={cal as CalendarRow}
      conf={data.confirmaciones ?? null}
      isCliente={isCliente}
      onReconnect={startOAuth}
    />
  );
}

function CalendarConnected({
  tenantId,
  cal,
  conf,
  isCliente,
  onReconnect,
}: {
  tenantId: string;
  cal: CalendarRow;
  conf: Confirmaciones | null;
  isCliente: boolean;
  onReconnect: () => void;
}) {
  const toast = useToast();
  const disconnect = useCalendarDisconnect();
  const tz = cal.timezone || 'Europe/Madrid';
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const range = monthRange(month.y, month.m);
  const { data: appts } = useAppointments(tenantId, range.from, range.to, isCliente);
  const byDay = useMemo(() => apptsByDay(appts?.appointments ?? [], tz), [appts, tz]);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const shape = monthShape(month.y, month.m);
  const today = calTzDay(new Date().toISOString(), tz);
  const monthTitle = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date(month.y, month.m, 1));
  const total = appts?.appointments.length ?? 0;

  return (
    <div>
      <div className="card">
        <div className="muted">
          Conectado como <b>{cal.account_email ?? 'cuenta de Google'}</b> · las citas se crean en su calendario «
          {cal.calendar_id ?? 'primary'}»
        </div>
        <div className="calnav mt6">
          <button
            className="btn alt btnsm"
            type="button"
            onClick={() => {
              const d = new Date();
              setMonth({ y: d.getFullYear(), m: d.getMonth() });
            }}
          >
            Hoy
          </button>
          <button className="btn alt btnsm" type="button" aria-label="Mes anterior" onClick={() => setMonth((p) => ({ y: p.m === 0 ? p.y - 1 : p.y, m: p.m === 0 ? 11 : p.m - 1 }))}>
            ◀
          </button>
          <b>{monthTitle}</b>
          <button className="btn alt btnsm" type="button" aria-label="Mes siguiente" onClick={() => setMonth((p) => ({ y: p.m === 11 ? p.y + 1 : p.y, m: p.m === 11 ? 0 : p.m + 1 }))}>
            ▶
          </button>
          <span className="spacer" />
          <button className="btn alt btnsm" type="button" onClick={onReconnect}>
            Reconectar
          </button>
          <button
            className="btn alt btnsm"
            type="button"
            disabled={disconnect.isPending}
            onClick={async () => {
              if (!(await confirmar({ titulo: '¿Desconectar el calendario?', cuerpo: 'Vai dejará de consultar huecos y de agendar citas para este cliente hasta que se vuelva a conectar.', accion: 'Desconectar', peligro: true }))) return;
              disconnect.mutate(
                { id: tenantId },
                {
                  onSuccess: () => toast('Calendario desconectado'),
                  onError: (e) => toast(`No se pudo desconectar: ${traducir(e)}`, false),
                },
              );
            }}
          >
            Desconectar
          </button>
        </div>
        <div className="calgrid">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
            <div key={d} className="caldow">
              {d}
            </div>
          ))}
          {Array.from({ length: shape.lead }, (_, i) => (
            <div key={`l${i}`} className="calcell out" />
          ))}
          {Array.from({ length: shape.days }, (_, i) => {
            const day = i + 1;
            const k = dayKey(month.y, month.m, day);
            const list = byDay.get(k) ?? [];
            return (
              <div key={k} className={`calcell${k === today ? ' today' : ''}`} onClick={() => setOpenDay(k)} role="button" tabIndex={0} aria-label={`Día ${day}`}>
                <span className="dnum">{day}</span>
                {list.slice(0, 3).map((a) => {
                  const estado = estadoConfirmacion(a);
                  return (
                    <span key={a.id} className="calchip" title={estado ? `Cita ${estado.label}` : undefined}>
                      {estado ? `${estado.emoji} ` : ''}
                      {calTzHm(a.starts_at, tz)} {a.customer_name}
                    </span>
                  );
                })}
                {list.length > 3 ? <span className="calmore">+{list.length - 3} más</span> : null}
              </div>
            );
          })}
          {Array.from({ length: shape.tail }, (_, i) => (
            <div key={`t${i}`} className="calcell out" />
          ))}
        </div>
        <div className="mt6 muted">
          {total
            ? 'Toca un día para ver sus citas.'
            : 'Sin citas este mes. Vai las creará aquí (y en el Google Calendar del negocio) cuando las agende por chat o WhatsApp.'}
        </div>
      </div>
      <ConfirmacionesCard tenantId={tenantId} conf={conf} isCliente={isCliente} />
      <CalendarConfig tenantId={tenantId} cal={cal} />
      {openDay ? <DayModal day={openDay} appts={byDay.get(openDay) ?? []} tz={tz} onClose={() => setOpenDay(null)} /> : null}
    </div>
  );
}

// El detalle del día se abre en modal (pedido de Juan, estilo Google Calendar).
function DayModal({ day, appts, tz, onClose }: { day: string; appts: Appointment[]; tz: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} aria-label="Citas del día">
      <div className="modal-h">
        <strong>{new Intl.DateTimeFormat('es-ES', { dateStyle: 'full' }).format(new Date(`${day}T12:00:00Z`))}</strong>
        <button className="btn alt" type="button" onClick={() => ref.current?.close()}>
          Cerrar
        </button>
      </div>
      <div className="modal-b caldaylist">
        {appts.length ? (
          appts.map((a) => {
            const estado = estadoConfirmacion(a);
            const ledger = ledgerRecordatorio(a, tz);
            return (
              <div key={a.id}>
                <b>
                  {calTzHm(a.starts_at, tz)}–{calTzHm(a.ends_at, tz)}
                </b>{' '}
                · <b>{a.customer_name}</b>
                {estado ? (
                  <>
                    {' '}
                    <span title={`Cita ${estado.label}`}>
                      {estado.emoji} {estado.label}
                    </span>
                  </>
                ) : null}
                <br />
                <span className="muted">
                  {a.customer_phone}
                  {a.reason ? ` · ${a.reason}` : ''} · {a.channel}
                </span>
                {ledger ? (
                  <>
                    <br />
                    <span className="muted">{ledger}</span>
                  </>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="muted">Sin citas ese día. Vai las agenda desde el chat web y WhatsApp.</div>
        )}
      </div>
    </dialog>
  );
}

// ── Confirmaciones (SPEC-CONFIRMACIONES): addon de recordatorio + confirmación ─
// El interruptor es SOLO de Velai (el worker responde 403 al rol cliente); el
// cliente VE el estado en texto. La plantilla se crea con el paso genérico de
// aprovisionamiento (plantillas/recordatorio_cita) y la aprueba Meta — el cron del
// worker vigila la aprobación y este bloque solo pinta el estado.
function ConfirmacionesCard({ tenantId, conf, isCliente, sinCalendario = false }: { tenantId: string; conf: Confirmaciones | null; isCliente: boolean; sinCalendario?: boolean }) {
  const toast = useToast();
  const patch = useRemindersPatch();
  const crear = useTemplateCreate();
  // Worker sin la migración 0030: el bloque no viaja y la card no se inventa nada.
  if (!conf) return null;
  const tpl = conf.template;
  const tplEstado = !tpl.status
    ? 'Aún no hay plantilla de recordatorios: sin ella no puede salir ningún recordatorio.'
    : tpl.status === 'approved'
      ? 'Plantilla de recordatorios aprobada por Meta ✓'
      : tpl.status === 'rejected'
        ? 'Meta rechazó la plantilla de recordatorios: revisar en Twilio.'
        : 'Plantilla enviada a Meta: esperando aprobación (el estado se actualiza solo).';
  return (
    <div className="card mt12">
      <b>Confirmaciones</b>
      {sinCalendario ? (
        <p className="muted mt6">
          Los recordatorios salen de las citas del calendario: hasta que Google esté conectado, el addon queda listo
          pero sin nada que recordar.
        </p>
      ) : null}
      <p className="muted mt6">
        Recordatorio automático por WhatsApp <b>{conf.hours} h antes</b> de cada cita, con botones «Confirmo» y
        «Cancelar». Si el cliente cancela, Vai le ofrece huecos y reagenda en la misma conversación.
      </p>
      <div className="mt6">
        {/* .flag.ok es la clase real del sistema (.flag.on no existe y pintaba ámbar). */}
        {conf.enabled ? <span className="flag ok">Activado</span> : <span className="flag off">Desactivado</span>}{' '}
        {isCliente ? (
          <span className="muted">Este módulo lo activa el equipo de Velai: escríbenos si quieres cambiarlo.</span>
        ) : null}
      </div>
      <div className="mt6 muted">{tplEstado}</div>
      {!isCliente ? (
        <div className="actions actions0">
          <button
            className="btn alt btnsm"
            type="button"
            disabled={patch.isPending}
            onClick={async () => {
              if (
                conf.enabled &&
                !(await confirmar({
                  titulo: '¿Desactivar Confirmaciones?',
                  cuerpo: 'Dejarán de salir recordatorios de cita para este cliente hasta volver a activarlo.',
                  accion: 'Desactivar',
                  peligro: true,
                }))
              )
                return;
              patch.mutate(
                { id: tenantId, enabled: !conf.enabled },
                {
                  onSuccess: (d) => toast(d.enabled ? 'Confirmaciones activadas ✓' : 'Confirmaciones desactivadas'),
                  onError: (e) => toast(`No se pudo cambiar el addon: ${traducir(e)}`, false),
                },
              );
            }}
          >
            {conf.enabled ? 'Desactivar' : 'Activar Confirmaciones'}
          </button>
          {!tpl.status ? (
            <button
              className="btn btnsm"
              type="button"
              disabled={crear.isPending}
              onClick={() =>
                crear.mutate(
                  { id: tenantId, kind: 'recordatorio_cita' },
                  {
                    onSuccess: () => toast('Plantilla creada y enviada a aprobación de Meta ✓'),
                    onError: (e) => toast(`No se pudo crear la plantilla: ${traducir(e)}`, false),
                  },
                )
              }
            >
              Crear plantilla de recordatorios
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Configuración de citas: id, tz, duración y el horario laboral ────────────
function CalendarConfig({ tenantId, cal }: { tenantId: string; cal: CalendarRow }) {
  const toast = useToast();
  const patch = useCalendarPatch();
  const [calId, setCalId] = useState(cal.calendar_id ?? 'primary');
  const [tzField, setTzField] = useState(cal.timezone ?? '');
  const [slot, setSlot] = useState(String(cal.slot_minutes ?? 30));
  const [grid, setGrid] = useState<Grid>(() => {
    try {
      return gridFromHours(cal.business_hours ? (JSON.parse(cal.business_hours) as WeekHours) : null);
    } catch {
      return gridVacio();
    }
  });
  const [copiado, setCopiado] = useState('');

  // Si la fila cambia (reconectar, otro tenant), el form se repuebla.
  useEffect(() => {
    setCalId(cal.calendar_id ?? 'primary');
    setTzField(cal.timezone ?? '');
    setSlot(String(cal.slot_minutes ?? 30));
    try {
      setGrid(gridFromHours(cal.business_hours ? (JSON.parse(cal.business_hours) as WeekHours) : null));
    } catch {
      setGrid(gridVacio());
    }
    setCopiado('');
  }, [cal]);

  return (
    <div className="card mt12">
      <b>Configuración de citas</b>
      <div className="grid mt6">
        <div className="card">
          <b>Calendario (ID)</b>
          <input value={calId} onChange={(e) => setCalId(e.target.value)} placeholder="primary" aria-label="ID del calendario" />
        </div>
        <div className="card">
          <b>Zona horaria</b>
          <input value={tzField} onChange={(e) => setTzField(e.target.value)} placeholder="Europe/Madrid" aria-label="Zona horaria" />
        </div>
        <div className="card">
          <b>Duración (min)</b>
          <input type="number" min={10} max={240} value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="30" aria-label="Duración de la cita" />
        </div>
      </div>
      <div className="mt6">
        <b>Horario laboral</b>
        <p className="muted">
          Las horas en las que Vai puede ofrecer cita. Deja en blanco los días que no atendéis; el segundo tramo es para
          las jornadas partidas. Si lo dejas todo en blanco se usa el horario por defecto: <b>lunes a viernes de 9:00 a 19:00</b>.
        </p>
        <HoursGrid grid={grid} onChange={setGrid} idPrefix="cal" />
        <div className="actions actions0">
          <button
            className="btn alt btnsm"
            type="button"
            onClick={() => {
              setGrid(copyMonday(grid));
              setCopiado('Copiado — recuerda Guardar calendario.');
            }}
          >
            Copiar el lunes a L-V
          </button>
          <span className="muted">{copiado || (cal.business_hours ? '' : 'Usando el horario por defecto: L-V de 9:00 a 19:00.')}</span>
        </div>
      </div>
      <div className="actions actions0">
        <button
          className="btn"
          type="button"
          disabled={patch.isPending}
          onClick={() => {
            const hours = hoursFromGrid(grid);
            // OJO: la rejilla vacía se manda como null, NO como {}. Un {} en el
            // calendario significa «ningún hueco jamás» y habría matado las citas en
            // silencio al borrar la rejilla sin querer.
            patch.mutate(
              {
                id: tenantId,
                body: {
                  calendar_id: calId.trim() || 'primary',
                  timezone: tzField.trim() || 'Europe/Madrid',
                  slot_minutes: Number(slot) || 30,
                  business_hours: Object.keys(hours).length ? hours : null,
                },
              },
              {
                onSuccess: () => toast('Calendario guardado ✓'),
                onError: (e) => toast(`No se pudo guardar: ${traducir(e)}`, false),
              },
            );
          }}
        >
          Guardar calendario
        </button>
      </div>
    </div>
  );
}
