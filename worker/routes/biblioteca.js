import { Hono } from 'hono';
import { partesAdmin, assertOwnTenant } from '../middleware.js';
import { HttpError, UUID_RE, json, NO_STORE, readJson, mediaPut } from '../app.js';
import { detectMedia, MEDIA_LIMITS, MEDIA_CHANNELS, MEDIA_SLUG_RE, mediaQuota, mediaChannels, mediaText, mediaItem, releaseMediaReservation } from '../biblioteca.js';

export const biblioteca = new Hono();
const mediaAdmin = async (c) => {
  const { request, env, url, scope } = partesAdmin(c);
  const tenantId = c.req.param('id');
  if (!UUID_RE.test(tenantId)) throw new HttpError(404, 'not_found');
  assertOwnTenant(scope, tenantId);
  const tenant = await env.DB.prepare('SELECT id,media_quota_bytes,media_bytes_used,media_files_used FROM tenants WHERE id=?').bind(tenantId).first();
  if (!tenant) throw new HttpError(404, 'not_found');
  const mediaId = c.req.param('mediaId');
  if (mediaId && !UUID_RE.test(mediaId)) throw new HttpError(404, 'not_found');
  const quota = mediaQuota(env, tenant);
  if (c.req.path.endsWith('/reconcile')) {
    if (scope.role !== 'velai') throw new HttpError(403, 'not_authorized');
    // Una sentencia y también las reservas: no puede subcontar subidas en curso.
    await env.DB.prepare(`UPDATE tenants SET
      media_bytes_used=(SELECT COALESCE(SUM(bytes),0) FROM tenant_media WHERE tenant_id=?)+(SELECT COALESCE(SUM(bytes),0) FROM tenant_media_uploads WHERE tenant_id=?),
      media_files_used=(SELECT COUNT(*) FROM tenant_media WHERE tenant_id=?)+(SELECT COUNT(*) FROM tenant_media_uploads WHERE tenant_id=?) WHERE id=?`).bind(tenantId, tenantId, tenantId, tenantId, tenantId).run();
    return json({ ok: true }, 200, NO_STORE);
  }
  if (request.method === 'GET') {
    const rows = (await env.DB.prepare('SELECT * FROM tenant_media WHERE tenant_id=? AND deleted_at IS NULL ORDER BY position,id').bind(tenantId).all()).results;
    return json({ items: rows.map((r) => mediaItem(env, r)), quota: { bytes: quota, used: tenant.media_bytes_used, files: tenant.media_files_used }, limits: MEDIA_LIMITS, storage_ready: Boolean(env.MEDIA) }, 200, NO_STORE);
  }
  const now = new Date().toISOString();
  if (mediaId) {
    const previous = await env.DB.prepare('SELECT * FROM tenant_media WHERE tenant_id=? AND id=? AND deleted_at IS NULL').bind(tenantId, mediaId).first();
    if (!previous) throw new HttpError(404, 'not_found');
    if (request.method === 'DELETE') {
      await env.DB.prepare('UPDATE tenant_media SET active=0,deleted_at=?,updated_at=? WHERE tenant_id=? AND id=? AND deleted_at IS NULL').bind(now, now, tenantId, mediaId).run();
      return json({ ok: true, purge_after_days: 7 }, 200, NO_STORE);
    }
    const b = await readJson(request, 4000);
    if (!b || Array.isArray(b) || Object.keys(b).some((k) => !['name', 'description', 'slug', 'channels', 'active', 'position'].includes(k))) throw new HttpError(400, 'media_metadata_invalid');
    const name = mediaText(b.name ?? previous.name, 120, 'name');
    const description = mediaText(b.description ?? previous.description, 300, 'description');
    const slug = b.slug ?? previous.slug, active = b.active ?? previous.active, position = b.position ?? previous.position;
    if (typeof slug !== 'string' || !MEDIA_SLUG_RE.test(slug) || ![0, 1].includes(active) || !Number.isInteger(position) || position < 0 || position > 10000) throw new HttpError(400, 'media_metadata_invalid');
    const channels = mediaChannels(b.channels ?? JSON.parse(previous.channels), previous.mime);
    try {
      const result = await env.DB.prepare('UPDATE tenant_media SET name=?,description=?,slug=?,channels=?,active=?,position=?,updated_at=? WHERE tenant_id=? AND id=? AND deleted_at IS NULL').bind(name, description, slug, JSON.stringify(channels), active, position, now, tenantId, mediaId).run();
      if (!result.meta.changes) throw new HttpError(404, 'not_found');
    } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'media_slug_exists'); throw e; }
    return json({ ok: true }, 200, NO_STORE);
  }
  if (!env.MEDIA) throw new HttpError(503, 'media_store_required');
  const length = Number(request.headers.get('Content-Length'));
  if (!Number.isSafeInteger(length) || length <= 0) throw new HttpError(411, 'media_length_required');
  if (length > MEDIA_LIMITS.video) throw new HttpError(413, 'media_too_large', 'Máximo 5 MB por imagen y 16 MB por PDF, audio o vídeo.');
  const name = mediaText(url.searchParams.get('name'), 120, 'name');
  const description = mediaText(url.searchParams.get('description'), 300, 'description');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength !== length) throw new HttpError(400, 'media_length_invalid');
  const format = detectMedia(bytes);
  if (!format) throw new HttpError(400, 'media_type_invalid');
  if (bytes.byteLength > MEDIA_LIMITS[format.kind]) throw new HttpError(413, 'media_too_large', format.kind === 'image' ? 'Las imágenes admiten hasta 5 MB.' : 'Este archivo admite hasta 16 MB.');
  const channels = mediaChannels(url.searchParams.get('channels') ?? MEDIA_CHANNELS.filter((ch) => format.mime !== 'image/webp' || ch !== 'whatsapp'), format.mime);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) => x.toString(16).padStart(2, '0')).join('');
  const duplicate = await env.DB.prepare('SELECT * FROM tenant_media WHERE tenant_id=? AND sha256=?').bind(tenantId, hash).first();
  if (duplicate) {
    if (duplicate.deleted_at) throw new HttpError(409, 'media_pending_deletion');
    return json({ ok: true, duplicate: true, item: mediaItem(env, duplicate), store: 'r2' }, 200, NO_STORE);
  }
  const id = crypto.randomUUID(), slug = `archivo-${id}`;
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => x.toString(16).padStart(2, '0')).join('');
  const key = `lib/${tenantId}/${id}${suffix}.${format.ext}`;
  try {
    // El trigger reserva con UPDATE condicional atómico o aborta el INSERT.
    await env.DB.prepare('INSERT INTO tenant_media_uploads (id,tenant_id,key,bytes,sha256,created_at,quota_default) VALUES (?,?,?,?,?,?,?)').bind(id, tenantId, key, length, hash, now, quota).run();
  } catch (e) {
    if (e.message.includes('quota_exceeded')) throw new HttpError(413, 'quota_exceeded');
    if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'media_upload_in_progress');
    throw e;
  }
  try {
    await mediaPut(env, key, bytes, format.mime, { required: true });
    await env.DB.batch([
      env.DB.prepare('INSERT INTO tenant_media (id,tenant_id,slug,kind,mime,ext,key,bytes,sha256,name,description,channels,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id, tenantId, slug, format.kind, format.mime, format.ext, key, length, hash, name, description, JSON.stringify(channels), now, now),
      env.DB.prepare('DELETE FROM tenant_media_uploads WHERE id=? AND tenant_id=?').bind(id, tenantId),
    ]);
  } catch (e) {
    // Un put con timeout puede haber escrito: borrar ANTES de devolver la cuota.
    try { await env.MEDIA.delete(key); await releaseMediaReservation(env, tenantId, id); }
    catch (_) { console.log(JSON.stringify({ level: 'error', code: 'media_upload_cleanup_failed', tenant: tenantId, id })); }
    if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'media_duplicate');
    throw new HttpError(503, 'media_upload_failed');
  }
  const row = await env.DB.prepare('SELECT * FROM tenant_media WHERE tenant_id=? AND id=?').bind(tenantId, id).first();
  return json({ ok: true, item: mediaItem(env, row), store: 'r2' }, 201, NO_STORE);
};
biblioteca.get('/api/admin/tenants/:id/media', mediaAdmin);
biblioteca.post('/api/admin/tenants/:id/media', mediaAdmin);
biblioteca.patch('/api/admin/tenants/:id/media/:mediaId', mediaAdmin);
biblioteca.delete('/api/admin/tenants/:id/media/:mediaId', mediaAdmin);
biblioteca.post('/api/admin/tenants/:id/media/reconcile', mediaAdmin);
