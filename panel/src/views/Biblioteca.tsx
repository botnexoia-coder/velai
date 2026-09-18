import { useState } from 'react';
import { confirmar } from '../components/Confirmar';
import { useToast } from '../components/Toasts';
import { useBiblioteca, useMediaUpload, useMediaMutation } from '../hooks/queries';
import type { MediaItem, MediaMetadata } from '../api/types';
import { traducir } from '../api/errors';

const canales = ['web', 'whatsapp', 'messenger'] as const;
const errores: Record<string, string> = {
  media_store_required: 'La biblioteca aún no está disponible. Contacta con Velai para activar el almacenamiento.',
  media_too_large: 'El archivo supera el límite: 5 MB por imagen y 16 MB por PDF, audio o vídeo.',
  quota_exceeded: 'No queda espacio suficiente. Los archivos borrados liberan espacio a los 7 días.',
  media_type_invalid: 'Formato no admitido. Usa JPG, PNG, WebP, PDF, MP3, Ogg Opus, M4A o MP4.',
  media_description_invalid: 'Escribe una descripción de hasta 300 caracteres, en una sola línea.',
  media_name_invalid: 'Escribe un nombre de hasta 120 caracteres, en una sola línea.',
  media_channels_invalid: 'Selecciona al menos un canal.',
  media_channel_unsupported: 'WebP está disponible para web y Messenger. Para WhatsApp usa JPG o PNG.',
  media_pending_deletion: 'Este archivo está pendiente de borrado. Su espacio se libera a los 7 días.',
  media_upload_in_progress: 'Este archivo ya se está subiendo. Espera unos segundos y actualiza la lista.',
  media_upload_failed: 'No se pudo subir el archivo. Inténtalo de nuevo.',
  media_duplicate: 'Este archivo ya está en la biblioteca. Actualiza la lista.',
};
const mensaje = (e: unknown) => errores[e instanceof Error ? e.message : ''] || traducir(e);
const mb = (n: number) => (n / 1024 / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 });

export function Biblioteca({ tenantId, isVelai = false }: { tenantId: string; isVelai?: boolean }) {
  const query = useBiblioteca(tenantId);
  const mutation = useMediaMutation(tenantId);
  const toast = useToast();
  const [editing, setEditing] = useState<MediaItem | 'new' | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function change(item: MediaItem, method: 'PATCH' | 'DELETE') {
    if (method === 'DELETE' && !await confirmar({ titulo: `¿Borrar ${item.name}?`, cuerpo: 'El bot dejará de ofrecerlo. El espacio se libera a los 7 días. Su enlace puede seguir abriéndose por la caché y no se borran las copias ya enviadas.', accion: 'Borrar archivo', peligro: true })) return;
    setError(null);
    try { await mutation.mutateAsync({ id: item.id, method, body: { active: item.active ? 0 : 1 } }); toast(method === 'DELETE' ? 'Archivo retirado de la biblioteca' : item.active ? 'Archivo desactivado' : 'Archivo activado'); }
    catch (e) { setError(e); }
  }
  return <section aria-label="Biblioteca multimedia" className="biblioteca">
    <div className="fin-toolbar"><div><h2>Biblioteca multimedia</h2><p className="muted">Sube el material de tu negocio y describe cuándo debe compartirlo el bot.</p></div><button className="btn" disabled={!query.data?.storage_ready || editing !== null} onClick={() => setEditing('new')}>Subir archivo</button></div>
    {query.data ? <div className="cxbox biblioteca-quota"><strong>{mb(query.data.quota.used)} de {mb(query.data.quota.bytes)} MB · {query.data.quota.files} {query.data.quota.files === 1 ? 'archivo' : 'archivos'}</strong><progress aria-label="Espacio ocupado" max={query.data.quota.bytes || 1} value={query.data.quota.used} /><p className="muted">Incluye los archivos pendientes de borrado. Imágenes: hasta 5 MB. PDF, audio y vídeo: hasta 16 MB.</p>{!query.data.storage_ready ? <p role="status">La biblioteca está pendiente de activación por Velai.</p> : null}</div> : null}
    {query.isPending ? <p role="status">Cargando biblioteca…</p> : null}
    {query.error || error ? <p className="error" role="alert">{mensaje(query.error || error)}</p> : null}
    {editing ? <MediaForm key={editing === 'new' ? 'new' : editing.id} tenantId={tenantId} initial={editing === 'new' ? null : editing} close={() => setEditing(null)} /> : null}
    <div className="biblioteca-grid">{query.data?.items.map((item) => <article className="cxbox" key={item.id} aria-label={`Archivo ${item.name}`}>
      <div className="fin-toolbar"><h3>{item.name}</h3><span className="chip">{item.active ? 'Activo' : 'Inactivo'}</span></div>
      <p>{item.description}</p><p className="muted">{item.ext.toUpperCase()} · {mb(item.bytes)} MB · {item.channels.join(', ')}</p>
      <p>Enviado {item.sent_count} {item.sent_count === 1 ? 'vez' : 'veces'}{item.last_sent_at ? ` · último envío: ${new Date(item.last_sent_at).toLocaleDateString('es-ES')}` : ''}</p>
      <div className="fin-actions"><a className="btn alt btnsm" href={item.url} target="_blank" rel="noopener noreferrer">Abrir archivo</a><button className="btn alt btnsm" onClick={() => { void navigator.clipboard.writeText(item.url).then(() => toast('Enlace copiado'), () => toast('No se pudo copiar el enlace', false)); }}>Copiar enlace</button><button className="btn alt btnsm" disabled={mutation.isPending || editing !== null} onClick={() => setEditing(item)}>Editar</button><button className="btn alt btnsm" disabled={mutation.isPending} onClick={() => void change(item, 'PATCH')}>{item.active ? 'Desactivar' : 'Activar'}</button><button className="btn alt btnsm" disabled={mutation.isPending} onClick={() => void change(item, 'DELETE')}>Borrar</button></div>
    </article>)}</div>
    {query.data && !query.data.items.length && !editing ? <p className="empty">Tu biblioteca está vacía. Puedes empezar con las tarifas, un catálogo o indicaciones para llegar.</p> : null}
    <p className="muted">Borrar un archivo lo retira del catálogo al instante y libera espacio a los 7 días. No desactiva inmediatamente su enlace: puede seguir disponible en caché. Tampoco borra lo que ya se envió. Para sustituirlo, sube un archivo nuevo y retira el anterior.</p>
    {isVelai ? <button className="btn alt btnsm" disabled={mutation.isPending} onClick={async () => { try { await mutation.mutateAsync({ method: 'POST', id: 'reconcile' }); toast('Espacio recalculado'); } catch (e) { setError(e); } }}>Recalcular espacio</button> : null}
  </section>;
}
function MediaForm({ tenantId, initial, close }: { tenantId: string; initial: MediaItem | null; close: () => void }) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [channels, setChannels] = useState<string[]>(initial?.channels || [...canales]);
  const [position, setPosition] = useState(initial?.position || 0);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<unknown>(null);
  const upload = useMediaUpload(tenantId), mutation = useMediaMutation(tenantId), toast = useToast();
  const busy = upload.isPending || mutation.isPending;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try {
      const body: MediaMetadata = { name, description, channels, position };
      if (initial) await mutation.mutateAsync({ method: 'PATCH', id: initial.id, body });
      else {
        if (!file) throw new Error('Selecciona un archivo.');
        if (file.size > (file.type.startsWith('image/') ? 5 : 16) * 1024 * 1024) throw new Error('media_too_large');
        const result = await upload.mutateAsync({ file, name, description, channels });
        if (result.duplicate) toast('Este archivo ya estaba en la biblioteca; no ocupa espacio adicional.');
      }
      toast(initial ? 'Archivo actualizado' : 'Archivo disponible en la biblioteca'); close();
    } catch (e) { setError(e); }
  }
  return <form className="cxbox biblioteca-form" aria-label={initial ? 'Editar archivo' : 'Subir archivo'} onSubmit={(e) => void submit(e)}>
    <h3>{initial ? 'Editar archivo' : 'Subir archivo'}</h3>
    <fieldset disabled={busy}>
      {!initial ? <label>Archivo<input required type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.mp3,.ogg,.m4a,.mp4" onChange={(e) => { const next = e.target.files?.[0] || null; setFile(next); if (next && !name) setName(next.name.slice(0, 120)); if (next?.type === 'image/webp') setChannels((cs) => cs.filter((ch) => ch !== 'whatsapp')); }} /></label> : null}
      <label>Nombre<input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Descripción para el bot<input required maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tarifas de 2026. Enviar cuando pregunten por precios." /></label>
      <span className="muted">{description.length}/300 · Indica qué contiene y cuándo compartirlo. Una sola línea.</span>
      <div className="fin-actions" role="group" aria-label="Canales">{canales.map((ch) => <label key={ch}><input type="checkbox" checked={channels.includes(ch)} onChange={(e) => setChannels((cs) => e.target.checked ? [...cs, ch] : cs.filter((v) => v !== ch))} />{ch === 'web' ? 'Chat web' : ch === 'whatsapp' ? 'WhatsApp' : 'Messenger'}</label>)}</div>
      {initial ? <label>Orden<input type="number" min={0} max={10000} value={position} onChange={(e) => setPosition(Number(e.target.value))} /></label> : null}
    </fieldset>
    {error ? <p role="alert" className="error">{mensaje(error)}</p> : null}
    <div className="fin-actions"><button className="btn" disabled={busy || !channels.length}>{busy ? 'Guardando…' : initial ? 'Guardar cambios' : 'Guardar archivo'}</button><button className="btn alt" type="button" disabled={busy} onClick={close}>Cancelar</button></div>
  </form>;
}
