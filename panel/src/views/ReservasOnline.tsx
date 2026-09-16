// Reservas online (rediseño aprobado el 2026-09-16, lienzo «Panel de reservas»).
// Lo que arregla respecto de la versión anterior:
//  · El interruptor que abre la página al público era un checkbox suelto; ahora es lo
//    primero de la vista, con su estado dicho en palabras.
//  · Nadie avisaba de lo que falta para que el enlace funcione (dominio sin autorizar,
//    sin servicios, sin horario): ahora hay una lista de requisitos junto al enlace.
//  · Los servicios eran una línea de texto con «orden 10»; ahora son filas con su
//    modalidad, su lugar y su estado.
// Permisos: todas estas rutas están en la lista blanca del rol CLIENTE
// (worker/middleware.js) y el handler exige que el tenant sea el suyo, así que esta
// pantalla es la misma para Velai y para cada cliente en su propio panel.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { api } from '../api/client';
import { useToast } from '../components/Toasts';
import { HoursGrid } from '../components/HoursGrid';
import { confirmar } from '../components/Confirmar';
import { gridFromHours, gridVacio, hoursFromGrid } from '../lib/horario';

type Service = { id?: string; slug: string; name: string; description: string; minutes: number; mode: string; location: string; buffer_min: number; active: number; position: number };
type Exception = { date: string; windows: string[][] | null; note: string };
type Booking = { config: { booking_enabled: number; min_notice_min: number; max_days_ahead: number; booking_note: string } | null; exceptions: Exception[]; url: string | null; faltan?: string[] };
const emptyService: Service = { slug: '', name: '', description: '', minutes: 30, mode: 'presencial', location: '', buffer_min: 0, active: 1, position: 0 };
const MODOS: Record<string, string> = { presencial: 'Presencial', video: 'Vídeo', telefono: 'Teléfono' };
const DURACIONES = [15, 30, 45, 60, 90];

function Ico({ d, s = 18 }: { d: string; s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
const ICO = {
  presencial: 'M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Zm0-8.4a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z',
  video: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h7A2.5 2.5 0 0 1 15 7.5v9A2.5 2.5 0 0 1 12.5 19h-7A2.5 2.5 0 0 1 3 16.5Zm12 4.5 6-3.4v10.8Z',
  telefono: 'M6.5 3.5h3l1.5 4-2 1.6a12 12 0 0 0 5.9 5.9l1.6-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z',
  check: 'm5 13 4.5 4.5L19 7',
  alerta: 'M12 8.5v5m0 3.2v.1M10.3 4l-7 12A2 2 0 0 0 5 19h14a2 2 0 0 0 1.7-3l-7-12a2 2 0 0 0-3.4 0Z',
  copiar: 'M9 9h9.5A1.5 1.5 0 0 1 20 10.5V20a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 20v-9.5A1.5 1.5 0 0 1 9 9Z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM17.5 14H20M14 17.5v2.5',
  abrir: 'M14 4h6v6M20 4l-8.5 8.5M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5h5',
  mundo: 'M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  mas: 'M12 5v14M5 12h14',
};

export function ReservasOnline({ tenantId, dominios, isCliente = false }: { tenantId: string; dominios?: number; isCliente?: boolean }) {
  const path = `/api/admin/tenants/${tenantId}`;
  const client = useQueryClient();
  const toast = useToast();
  const booking = useQuery({ queryKey: ['booking', tenantId], queryFn: () => api<Booking>(path + '/booking') });
  const services = useQuery({ queryKey: ['services', tenantId], queryFn: () => api<{ services: Service[] }>(path + '/services') });
  const [editing, setEditing] = useState<Service | null>(null);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState('');
  const [exceptionNote, setExceptionNote] = useState('');
  const [closed, setClosed] = useState(true);
  const [grid, setGrid] = useState(gridVacio);
  const [snippetService, setSnippetService] = useState('');
  const [forma, setForma] = useState<'enlace' | 'inline' | 'popup'>('inline');
  const [preview, setPreview] = useState(false);

  async function save(suffix: string, method: string, body?: unknown) {
    setSaving(true);
    try {
      await api(path + suffix, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      await Promise.all([client.invalidateQueries({ queryKey: ['booking', tenantId] }), client.invalidateQueries({ queryKey: ['services', tenantId] }), client.invalidateQueries({ queryKey: ['calendar', tenantId] })]);
      return true;
    } catch (e) { toast(`No se pudo guardar: ${(e as Error).message}`, false); return false; }
    finally { setSaving(false); }
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); toast('Copiado'); } catch { toast('No se pudo copiar. Selecciona el texto y cópialo.', false); } }
  function downloadQR(url: string) {
    const code = qrcode(0, 'M'); code.addData(url); code.make();
    const objectUrl = URL.createObjectURL(new Blob([code.createSvgTag(6, 24)], { type: 'image/svg+xml' }));
    const a = document.createElement('a'); a.href = objectUrl; a.download = 'reservas-qr.svg'; a.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  if (booking.error || services.error) return <div className="card" role="alert">No se pudo cargar Reservas online. <button className="btn alt" onClick={() => { void booking.refetch(); void services.refetch(); }}>Reintentar</button></div>;
  if (!booking.data || !services.data) return <p>Cargando reservas online…</p>;
  const { config, url, exceptions, faltan = [] } = booking.data;
  if (!config) return <p>Conecta Google Calendar para configurar reservas online.</p>;

  const lista = services.data.services;
  const activos = lista.filter((s) => s.active).length;
  const slug = url ? new URL(url).pathname.split('/')[1] : '';
  const serviceAttr = snippetService ? ` data-servicio="${snippetService}"` : '';
  const originAttr = url && new URL(url).origin !== 'https://citas.hirevai.com' ? ` data-origen="${new URL(url).origin}"` : '';
  const loader = '<script src="https://hirevai.com/assets/vai-citas.js?v=19" defer></script>';
  const chosenUrl = url ? url + (snippetService ? '?s=' + encodeURIComponent(snippetService) : '') : '';
  const inline = `<div data-vai-citas="${slug}"${serviceAttr}${originAttr} style="height:640px"></div>\n${loader}`;
  const popup = `<button data-vai-citas-popup="${slug}"${serviceAttr}${originAttr}>Reservar cita</button>\n${loader}`;
  const snippet = forma === 'enlace' ? chosenUrl : forma === 'inline' ? inline : popup;
  const activa = Boolean(config.booking_enabled);

  return (
    <section aria-label="Reservas online" className="rescol">
      {/* 1. ¿Está viva la página, con qué enlace y qué le falta? */}
      <div className="pane resestado">
        <div className="resestado-a">
          <div className="swrow">
            {/* Encender la página al público lo hace VELAI (decisión de Juan, 2026-09-16);
                el cliente ve el estado, como en Confirmaciones. El worker lo veta además
                en el handler: aquí no hay más que la forma de decirlo. */}
            {isCliente ? (
              <span className={`flag${activa ? ' ok' : ' off'}`}>{activa ? 'Activada' : 'Apagada'}</span>
            ) : (
              <button type="button" className="sw" role="switch" aria-checked={activa} aria-label="Activar página de reservas"
                disabled={saving || !url || (!activa && faltan.length > 0)}
                onClick={async () => {
                  if (activa && !(await confirmar({ titulo: '¿Apagar la página de reservas?', cuerpo: 'El enlace dejará de funcionar al momento. Las citas ya reservadas se mantienen.', accion: 'Apagar', peligro: true }))) return;
                  void save('/booking', 'PATCH', { booking_enabled: !activa });
                }}><i /></button>
            )}
            <span className="swtxt">
              <b>{activa ? 'Página de reservas activa' : 'Página de reservas apagada'}</b>
              <small className="muted">
                {isCliente
                  ? (activa ? 'Tus clientes pueden reservar sin escribirte.' : 'La activa el equipo de Velai: escríbenos y la encendemos.')
                  : (activa ? 'Sus clientes pueden reservar sin escribirle.' : 'Enciéndela para que el enlace empiece a funcionar.')}
              </small>
            </span>
          </div>
          {url ? (
            <>
              <div className="urlbox mt12">
                <span className="muted"><Ico d={ICO.mundo} s={17} /></span>
                <span className="u">{chosenUrl.replace(/^https:\/\//, '')}</span>
                <button className="btn alt btnsm" type="button" onClick={() => void copy(chosenUrl)}><Ico d={ICO.copiar} s={14} /> Copiar</button>
                <button className="btn alt btnsm" type="button" onClick={() => downloadQR(chosenUrl)}><Ico d={ICO.qr} s={14} /> QR</button>
                <a className="btn alt btnsm" href={chosenUrl} target="_blank" rel="noopener noreferrer"><Ico d={ICO.abrir} s={14} /> Abrir</a>
              </div>
              <p className="muted mt6">La página usa el logo y los colores de la ficha del negocio, y lleva el distintivo «Tecnología Velai».</p>
            </>
          ) : <p className="muted mt12">El dominio de reservas aún no está configurado.</p>}
        </div>
        <div className="resestado-b">
          <b className="lblup">Antes de compartir el enlace</b>
          <div className="reqs">
            <Req ok>Google Calendar conectado</Req>
            <Req ok={activos > 0}>{activos > 0 ? `${activos} servicio${activos === 1 ? '' : 's'} activo${activos === 1 ? '' : 's'}` : 'Sin servicios activos'}</Req>
            <Req ok={faltan.length === 0}>
              {faltan.length === 0
                ? 'Worker listo para servir la página'
                : faltan[0] === 'secret_corto' ? 'El secreto APP_SECRET del worker es demasiado corto (mínimo 32 caracteres)'
                  : faltan[0] === 'secret' ? 'Falta el secreto APP_SECRET en el worker'
                    : faltan[0] === 'turnstile' ? 'Falta la clave de Turnstile en el worker'
                      : 'Falta el dominio de reservas en el worker'}
            </Req>
            <Req ok={dominios === undefined || dominios > 0}>
              {dominios === undefined || dominios > 0 ? 'Dominio de su web autorizado' : 'Su web no está autorizada: el calendario integrado no cargará'}
            </Req>
          </div>
        </div>
      </div>

      <div className="resgrid">
        {/* 2. Servicios: lo que el cliente elige primero */}
        <div className="pane">
          <header>
            <div><h2>Servicios</h2><p>Lo que el cliente elige primero, en este orden.</p></div>
            <button className="btn" type="button" onClick={() => setEditing({ ...emptyService, position: (lista.at(-1)?.position ?? 0) + 10 })}><Ico d={ICO.mas} s={15} /> Añadir</button>
          </header>
          <div className="svclist">
            {lista.length ? lista.map((s) => (
              <div className="svcrow" key={s.id}>
                <span className="ico"><Ico d={ICO[s.mode as keyof typeof ICO] ?? ICO.presencial} /></span>
                <span className="txt">
                  <b>{s.name}</b>
                  <small>{s.minutes} min · {MODOS[s.mode] ?? s.mode}{s.location ? ` · ${s.location}` : ''}</small>
                </span>
                <span className={`pill${s.active ? '' : ' off'}`}><b style={{ background: s.active ? 'var(--ok)' : 'rgba(var(--ink),.3)' }} />{s.active ? 'Activo' : 'Oculto'}</span>
                <button className="btn alt btnsm" type="button" aria-label={`Editar ${s.name}`} onClick={() => setEditing({ ...s })}>Editar</button>
                <button className="btn alt btnsm" type="button" disabled={saving || !s.active} aria-label={`Ocultar ${s.name}`} onClick={() => void save('/services/' + s.id, 'DELETE')}>Ocultar</button>
              </div>
            )) : <p className="muted">Sin servicios: la página ofrecerá una cita genérica con la duración por defecto.</p>}
          </div>
        </div>

        {/* 3. Reglas */}
        <form key={JSON.stringify(config)} className="pane" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save('/booking', 'PATCH', { min_notice_min: Number(f.get('min_notice_min')), max_days_ahead: Number(f.get('max_days_ahead')), booking_note: f.get('booking_note') });
        }}>
          <header><div><h2>Reglas</h2><p>Qué huecos se ofrecen y con cuánta antelación.</p></div></header>
          <label>Antelación mínima
            <select name="min_notice_min" defaultValue={String(config.min_notice_min)}>
              {[0, 30, 60, 120, 240, 480, 1440].map((m) => <option key={m} value={m}>{m === 0 ? 'Sin antelación' : m < 60 ? `${m} minutos` : m === 60 ? '1 hora' : m < 1440 ? `${m / 60} horas` : '1 día'}</option>)}
            </select>
          </label>
          <label>Se puede reservar hasta
            <select name="max_days_ahead" defaultValue={String(config.max_days_ahead)}>
              {[7, 14, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} días vista</option>)}
            </select>
          </label>
          <label>Nota bajo el nombre del negocio (opcional)
            <textarea name="booking_note" maxLength={1000} rows={2} placeholder="Ej.: «Las sesiones son en español»" defaultValue={config.booking_note || ''} />
          </label>
          <div className="actions actions0 mt12">
            <button className="btn" disabled={saving}>Guardar</button>
            <span className="muted">Se aplica al instante en la página.</span>
          </div>
        </form>
      </div>

      {/* 4. Festivos: ganan al horario */}
      <div className="pane">
        <header>
          <div><h2>Festivos y días especiales</h2><p>Ganan al horario semanal: cierran el día o lo acortan.</p></div>
        </header>
        <div className="svclist">
          {exceptions.map((exception) => (
            <div className="svcrow" key={exception.date}>
              <span className="txt">
                <b>{new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${exception.date}T12:00:00Z`))}</b>
                <small>{exception.windows ? exception.windows.map((w) => w.join('–')).join(', ') : 'Cerrado todo el día'}{exception.note ? ` · ${exception.note}` : ''}</small>
              </span>
              <button className="btn alt btnsm" type="button" onClick={() => { setDate(exception.date); setExceptionNote(exception.note || ''); setClosed(exception.windows === null); setGrid(gridFromHours({ mon: (exception.windows || []) as [string, string][] })); }}>Editar</button>
              <button className="btn alt btnsm" type="button" disabled={saving} onClick={() => void save('/booking', 'PATCH', { exceptions: exceptions.filter((x) => x.date !== exception.date) })}>Eliminar</button>
            </div>
          ))}
        </div>
        <form className="excform mt12" onSubmit={async (e) => {
          e.preventDefault();
          const windows = closed ? null : hoursFromGrid(grid).mon || [];
          if (!closed && !windows?.length) { toast('Indica un horario válido', false); return; }
          if (await save('/booking', 'PATCH', { exceptions: [...exceptions.filter((x) => x.date !== date), { date, windows, note: exceptionNote }] })) { setDate(''); setExceptionNote(''); setClosed(true); setGrid(gridVacio); }
        }}>
          <label>Fecha<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Nota<input value={exceptionNote} maxLength={200} placeholder="Navidad, puente…" onChange={(e) => setExceptionNote(e.target.value)} /></label>
          <label className="inlinechk"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Cerrado todo el día</label>
          {!closed ? <div className="excgrid"><HoursGrid grid={grid} onChange={setGrid} days={['mon']} idPrefix="exception" /></div> : null}
          <button className="btn" disabled={saving}>Guardar excepción</button>
        </form>
      </div>

      {/* 5. Ponerlo en su web */}
      {url ? (
        <div className="pane">
          <header>
            <div><h2>Ponlo en su web</h2><p>Copia una línea y pégala donde quiera que aparezca.</p></div>
            <div className="chtabs">
              {([['enlace', 'Solo el enlace'], ['inline', 'Calendario integrado'], ['popup', 'Botón emergente']] as const).map(([k, label]) => (
                <button key={k} type="button" className={`chtab${forma === k ? ' is-on' : ''}`} onClick={() => setForma(k)}>{label}</button>
              ))}
            </div>
          </header>
          <label>Servicio
            <select value={snippetService} onChange={(e) => setSnippetService(e.target.value)}>
              <option value="">Todos los servicios</option>
              {lista.filter((s) => s.active).map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
            </select>
          </label>
          <div className="codebox mt12">
            <button className="btn alt btnsm" type="button" onClick={() => void copy(snippet)}><Ico d={ICO.copiar} s={13} /> Copiar</button>
            <code>{snippet}</code>
          </div>
          {dominios === 0 ? <p className="mt6"><span className="flag">Su web no está autorizada todavía: el calendario integrado no cargará hasta añadir el dominio en la ficha del negocio.</span></p> : null}
          <div className="actions actions0 mt12">
            <button className="btn alt" type="button" disabled={!activa} onClick={() => setPreview(!preview)}>{preview ? 'Cerrar vista previa' : 'Vista previa'}</button>
            {!activa ? <span className="muted">Enciende la página para verla.</span> : null}
          </div>
          {preview && activa ? <iframe title="Vista previa de reservas" src={chosenUrl} referrerPolicy="no-referrer" style={{ width: '100%', height: 760, border: 0, borderRadius: 12, marginTop: 12 }} /> : null}
        </div>
      ) : null}

      {editing ? <ServicioDialog servicio={editing} saving={saving} onClose={() => setEditing(null)} onSave={async (s) => { if (await save('/services' + (s.id ? '/' + s.id : ''), s.id ? 'PATCH' : 'POST', s)) setEditing(null); }} /> : null}
    </section>
  );
}

function Req({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return <span className={`req${ok ? '' : ' no'}`}><i><Ico d={ok ? ICO.check : ICO.alerta} s={11} /></i>{children}</span>;
}

// El alta/edición de un servicio pasa de formulario incrustado en la lista a diálogo:
// la duración va en píldoras (lo que se elige el 95% de las veces) y el orden se
// gobierna desde la lista, no con un campo numérico.
function ServicioDialog({ servicio, saving, onClose, onSave }: { servicio: Service; saving: boolean; onClose: () => void; onSave: (s: Service) => void }) {
  const [s, setS] = useState(servicio);
  const nuevo = !s.id;
  return (
    <dialog open aria-label={nuevo ? 'Nuevo servicio' : 'Editar servicio'} className="svcdlg">
      <div className="modal-h"><strong>{nuevo ? 'Nuevo servicio' : 'Editar servicio'}</strong><button className="btn alt" type="button" onClick={onClose}>Cerrar</button></div>
      <form className="modal-b" onSubmit={(e) => { e.preventDefault(); onSave(s); }}>
        <label>Nombre<input required maxLength={100} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value, slug: nuevo ? e.target.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) : s.slug })} /></label>
        <label>Identificador del enlace<input required maxLength={60} pattern="[a-z0-9][a-z0-9-]*" value={s.slug} onChange={(e) => setS({ ...s, slug: e.target.value })} /></label>
        <label>Descripción (opcional)<input maxLength={500} placeholder="Una línea que ayude a elegir" value={s.description || ''} onChange={(e) => setS({ ...s, description: e.target.value })} /></label>
        <fieldset className="modes"><legend>Modalidad</legend>
          {Object.entries(MODOS).map(([k, label]) => (
            <button key={k} type="button" className={`modebtn${s.mode === k ? ' is-on' : ''}`} aria-pressed={s.mode === k} onClick={() => setS({ ...s, mode: k })}>
              <Ico d={ICO[k as keyof typeof ICO]} s={16} /> {label}
            </button>
          ))}
        </fieldset>
        <fieldset className="modes"><legend>Duración</legend>
          {DURACIONES.map((m) => (
            <button key={m} type="button" className={`modebtn${s.minutes === m ? ' is-on' : ''}`} aria-pressed={s.minutes === m} onClick={() => setS({ ...s, minutes: m })}>{m} min</button>
          ))}
          <label className="otradur">Otra<input type="number" min={10} max={240} value={s.minutes} onChange={(e) => setS({ ...s, minutes: Number(e.target.value) })} /></label>
        </fieldset>
        <label>{s.mode === 'video' ? 'Enlace de la videollamada' : s.mode === 'telefono' ? 'Cómo se hace la llamada' : 'Dónde'}
          <input maxLength={500} value={s.location || ''} placeholder={s.mode === 'video' ? 'https://…' : s.mode === 'telefono' ? 'Te llamamos al teléfono que dejes' : 'Calle, número, ciudad'} onChange={(e) => setS({ ...s, location: e.target.value })} /></label>
        <label>Descanso después (min)<input type="number" min={0} max={120} value={s.buffer_min} onChange={(e) => setS({ ...s, buffer_min: Number(e.target.value) })} /></label>
        <div className="swrow mt12">
          <button type="button" className="sw" role="switch" aria-checked={Boolean(s.active)} aria-label="Visible en la página" onClick={() => setS({ ...s, active: s.active ? 0 : 1 })}><i /></button>
          <span className="swtxt"><b>Visible en la página</b><small className="muted">Ocúltalo para dejar de ofrecerlo sin borrar sus citas.</small></span>
        </div>
        <div className="actions actions0 mt12"><button className="btn" disabled={saving}>Guardar servicio</button><button className="btn alt" type="button" onClick={onClose}>Cancelar</button></div>
      </form>
    </dialog>
  );
}
