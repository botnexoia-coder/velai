import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { api } from '../api/client';
import { useToast } from '../components/Toasts';
import { HoursGrid } from '../components/HoursGrid';
import { gridFromHours, gridVacio, hoursFromGrid } from '../lib/horario';

type Service = { id?: string; slug: string; name: string; description: string; minutes: number; mode: string; location: string; buffer_min: number; active: number; position: number };
type Exception = { date: string; windows: string[][] | null; note: string };
type Booking = { config: { booking_enabled: number; min_notice_min: number; max_days_ahead: number; booking_note: string } | null; exceptions: Exception[]; url: string | null };
const emptyService: Service = { slug: '', name: '', description: '', minutes: 30, mode: 'presencial', location: '', buffer_min: 0, active: 1, position: 0 };

export function ReservasOnline({ tenantId }: { tenantId: string }) {
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
  const [preview, setPreview] = useState(false);
  async function save(suffix: string, method: string, body?: unknown) {
    setSaving(true);
    try {
      await api(path + suffix, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      await Promise.all([client.invalidateQueries({ queryKey: ['booking', tenantId] }), client.invalidateQueries({ queryKey: ['services', tenantId] }), client.invalidateQueries({ queryKey: ['calendar', tenantId] })]);
      toast('Reservas online actualizadas');
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
  const { config, url, exceptions } = booking.data;
  if (!config) return <p>Conecta Google Calendar para configurar reservas online.</p>;
  const slug = url ? new URL(url).pathname.split('/')[1] : '';
  const serviceAttr = snippetService ? ` data-servicio="${snippetService}"` : '';
  const originAttr = url && new URL(url).origin !== 'https://citas.hirevai.com' ? ` data-origen="${new URL(url).origin}"` : '';
  const loader = '<script src="https://hirevai.com/assets/vai-citas.js?v=18" defer></script>';
  const inline = `<div data-vai-citas="${slug}"${serviceAttr}${originAttr} style="height:640px"></div>\n${loader}`;
  const popup = `<button data-vai-citas-popup="${slug}"${serviceAttr}${originAttr}>Reservar cita</button>\n${loader}`;
  const chosenUrl = url ? url + (snippetService ? '?s=' + encodeURIComponent(snippetService) : '') : '';
  return <section aria-label="Reservas online">
    <div className="card"><h2>Tu página de reservas</h2><p>El cliente elige día y hora. Las citas llegan al mismo calendario que las del chat.</p>
      <label><input type="checkbox" checked={Boolean(config.booking_enabled)} disabled={saving || !url} onChange={(e) => void save('/booking', 'PATCH', { booking_enabled: e.target.checked })} /> Activar página de reservas</label>
      {url ? <><p><a href={chosenUrl} target="_blank" rel="noopener noreferrer">{chosenUrl}</a></p><div className="actions"><button className="btn alt" onClick={() => void copy(chosenUrl)}>Copiar enlace</button><button className="btn alt" onClick={() => downloadQR(chosenUrl)}>Descargar QR</button></div></> : <p>El dominio de reservas aún no está configurado.</p>}
      <p className="muted">La página muestra la marca «con Velai».</p>
    </div>
    <div className="card"><h2>Servicios</h2>{services.data.services.map((s) => <div className="actions" key={s.id}><span>{s.name} · {s.minutes} min · {s.active ? 'Activo' : 'Inactivo'} · orden {s.position}</span><button className="btn alt btnsm" onClick={() => setEditing({ ...s })}>Editar {s.name}</button><button className="btn alt btnsm" disabled={saving} onClick={() => void save('/services/' + s.id, 'DELETE')}>Desactivar</button></div>)}
      <button className="btn" onClick={() => setEditing({ ...emptyService })}>Añadir servicio</button>
      {editing ? <form onSubmit={async (e) => { e.preventDefault(); if (await save('/services' + (editing.id ? '/' + editing.id : ''), editing.id ? 'PATCH' : 'POST', editing)) setEditing(null); }}>
        <h3>{editing.id ? 'Editar servicio' : 'Nuevo servicio'}</h3>
        {(['name', 'slug', 'description', 'location'] as const).map((field) => <label key={field}>{({ name: 'Nombre', slug: 'Identificador del enlace', description: 'Descripción', location: 'Lugar o enlace de videollamada' })[field]}<input required={field === 'name' || field === 'slug'} maxLength={field === 'slug' ? 60 : field === 'name' ? 100 : 500} pattern={field === 'slug' ? '[a-z0-9][a-z0-9-]*' : undefined} value={editing[field] || ''} onChange={(e) => setEditing({ ...editing, [field]: e.target.value })} /></label>)}
        <label>Modalidad<select value={editing.mode} onChange={(e) => setEditing({ ...editing, mode: e.target.value })}><option value="presencial">Presencial</option><option value="video">Vídeo</option><option value="telefono">Teléfono</option></select></label>
        {(['minutes', 'buffer_min', 'position'] as const).map((field) => <label key={field}>{({ minutes: 'Duración (min)', buffer_min: 'Descanso después (min)', position: 'Orden' })[field]}<input type="number" min={field === 'minutes' ? 10 : 0} max={field === 'minutes' ? 240 : field === 'buffer_min' ? 120 : 1000} required value={editing[field]} onChange={(e) => setEditing({ ...editing, [field]: Number(e.target.value) })} /></label>)}
        <label><input type="checkbox" checked={Boolean(editing.active)} onChange={(e) => setEditing({ ...editing, active: e.target.checked ? 1 : 0 })} /> Activo</label>
        <div className="actions"><button className="btn" disabled={saving}>Guardar servicio</button><button className="btn alt" type="button" onClick={() => setEditing(null)}>Cerrar</button></div>
      </form> : null}
    </div>
    <form key={JSON.stringify(config)} className="card" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void save('/booking', 'PATCH', { min_notice_min: Number(f.get('min_notice_min')), max_days_ahead: Number(f.get('max_days_ahead')), booking_note: f.get('booking_note') }); }}>
      <h2>Reglas</h2><label>Antelación mínima (min)<input name="min_notice_min" type="number" min="0" max="43200" required defaultValue={config.min_notice_min} /></label><label>Días de antelación máxima<input name="max_days_ahead" type="number" min="1" max="365" required defaultValue={config.max_days_ahead} /></label><label>Nota de cabecera<textarea name="booking_note" maxLength={1000} defaultValue={config.booking_note || ''} /></label><button className="btn" disabled={saving}>Guardar reglas</button>
    </form>
    <div className="card"><h2>Festivos y excepciones</h2>{exceptions.map((exception) => <div className="actions" key={exception.date}><span>{exception.date} · {exception.windows ? exception.windows.map((w) => w.join('–')).join(', ') : 'Cerrado'} · {exception.note}</span><button className="btn alt btnsm" onClick={() => { setDate(exception.date); setExceptionNote(exception.note || ''); setClosed(exception.windows === null); setGrid(gridFromHours({ mon: (exception.windows || []) as [string, string][] })); }}>Editar</button><button className="btn alt btnsm" disabled={saving} onClick={() => void save('/booking', 'PATCH', { exceptions: exceptions.filter((x) => x.date !== exception.date) })}>Eliminar</button></div>)}
      <form onSubmit={async (e) => { e.preventDefault(); const windows = closed ? null : hoursFromGrid(grid).mon || []; if (!closed && !windows?.length) { toast('Indica un horario válido', false); return; } if (await save('/booking', 'PATCH', { exceptions: [...exceptions.filter((x) => x.date !== date), { date, windows, note: exceptionNote }] })) { setDate(''); setExceptionNote(''); } }}>
        <label>Fecha<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label><label>Nota<input value={exceptionNote} maxLength={200} onChange={(e) => setExceptionNote(e.target.value)} /></label><label><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Cerrado todo el día</label>
        {!closed ? <HoursGrid grid={grid} onChange={setGrid} days={['mon']} idPrefix="exception" /> : null}<button className="btn" disabled={saving}>Guardar excepción</button>
      </form>
    </div>
    {url ? <div className="card"><h2>Insertar en tu web</h2><label>Servicio<select value={snippetService} onChange={(e) => setSnippetService(e.target.value)}><option value="">Todos los servicios</option>{services.data.services.filter((s) => s.active).map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}</select></label>
      <label>Calendario integrado<textarea readOnly rows={3} value={inline} /></label><button className="btn alt" onClick={() => void copy(inline)}>Copiar código integrado</button><label>Botón con ventana emergente<textarea readOnly rows={3} value={popup} /></label><button className="btn alt" onClick={() => void copy(popup)}>Copiar código del botón</button>
      <p>El dominio de tu web debe estar autorizado en la configuración del negocio.</p><button className="btn alt" disabled={!config.booking_enabled} onClick={() => setPreview(!preview)}>{preview ? 'Cerrar vista previa' : 'Vista previa'}</button>
      {preview && config.booking_enabled ? <iframe title="Vista previa de reservas" src={chosenUrl} referrerPolicy="no-referrer" style={{ width: '100%', height: 760, border: 0 }} /> : null}
    </div> : null}
  </section>;
}
