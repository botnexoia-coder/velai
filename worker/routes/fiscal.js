// Registro interno: no emite documentos fiscales ni transmite a Hacienda.
import { Hono } from 'hono';
import { esSocio, partesAdmin } from '../middleware.js';
import { HttpError, json, NO_STORE, readJson } from '../app.js';
import { fail, choice, textField, uuid, integer, versionOf, day, canonical, digest, FIELDS, MONEDAS,
  normalizeInvoice, fromRow, scopeOf, summarize, invoiceIssues, csvSafe, moneyText } from '../fiscal.js';

export const fiscal = new Hono();
const ROOT = '/api/admin/gestion';
const SELECT = `SELECT f.*, (SELECT COUNT(*) FROM g_documentos d WHERE d.tipo='factura' AND d.objeto_id=f.id) AS documentos_count,
  (SELECT COUNT(*) FROM g_documentos d WHERE d.tipo='factura' AND d.objeto_id=f.id AND d.clase='factura') AS originales_count FROM g_facturas f`;
const FILTER = 'f.entidad_id=? AND f.moneda=? AND COALESCE(f.fecha_operacion,f.fecha_emision) BETWEEN ? AND ?';
const normalizeError = (e) => {
  for (const code of ['periodo_cerrado', 'periodo_ya_cerrado', 'cierre_desactualizado', 'factura_inmutable', 'cierre_inmutable']) if (e.message.includes(code)) throw new HttpError(409, code);
  if (/UNIQUE constraint failed.*external_key/.test(e.message)) throw new HttpError(409, 'factura_externa_duplicada');
  if (/UNIQUE constraint failed.*correccion_de/.test(e.message)) throw new HttpError(409, 'correccion_ya_existe');
  throw e;
};
async function bodyOf(req, allowed) {
  const b = await readJson(req, 160000);
  if (!b || typeof b !== 'object' || Array.isArray(b)) fail('cuerpo_invalido');
  if (Object.keys(b).some((k) => !allowed.includes(k))) fail('campo_no_editable');
  return b;
}
async function entity(db, id) {
  const result = await db.prepare('SELECT * FROM g_entidades WHERE id=?').bind(id).first();
  if (!result) fail('entidad_desconocida', 404);
  return result;
}
async function invoice(db, id) {
  const result = await db.prepare(`${SELECT} WHERE f.id=?`).bind(uuid(id)).first();
  if (!result) fail('factura_no_encontrada', 404);
  return result;
}
async function linkedRecords(db, item) {
  await entity(db, item.entidad_id);
  if (item.compra_id) {
    const purchase = await db.prepare('SELECT entidad_id,moneda FROM g_compras WHERE id=?').bind(item.compra_id).first();
    if (!purchase || item.tipo !== 'recibida' || purchase.entidad_id !== item.entidad_id || purchase.moneda !== item.moneda) fail('compra_incompatible');
  }
  if (item.rectifica_id) {
    const ref = await invoice(db, item.rectifica_id);
    if (ref.entidad_id !== item.entidad_id || ref.tipo !== item.tipo || ref.moneda !== item.moneda || ref.estado !== 'validada') fail('rectificacion_incompatible');
  }
}
function audit(db, tipo, objeto, actor, now, detail, conditional = false) {
  const values = [crypto.randomUUID(), tipo, objeto, actor, now, canonical(detail)];
  return db.prepare(`INSERT INTO g_fiscal_eventos (id,tipo,objeto_id,actor,fecha,detalle_json) ${conditional ? 'SELECT ?,?,?,?,?,? WHERE changes()>0' : 'VALUES (?,?,?,?,?,?)'}`).bind(...values);
}
async function externalKey(item) {
  if (item.origen !== 'externa' || !item.numero || !item.fecha_emision || (item.tipo === 'recibida' && !item.contraparte_nif)) return null;
  return digest([item.entidad_id, item.tipo, item.tipo === 'recibida' ? item.contraparte_nif.toUpperCase().replace(/\s/g, '') : '', item.numero.trim().toUpperCase(), item.fecha_emision.slice(0, 4)]);
}
const WRITE_FIELDS = FIELDS.filter((k) => k !== 'lineas');
function valuesOf(item) { return { ...Object.fromEntries(WRITE_FIELDS.map((k) => [k, item[k]])), base: item.base, iva: item.iva, retencion: item.retencion, total: item.total, lineas_json: JSON.stringify(item.lineas) }; }
async function create(db, b, actor, correction = null) {
  const id = uuid(b.id), item = normalizeInvoice(b), request_hash = await digest({ ...item, correccion_de: correction?.id ?? null, motivo_correccion: b.motivo ?? null });
  const previous = await db.prepare('SELECT * FROM g_facturas WHERE id=?').bind(id).first();
  if (previous) {
    if (previous.request_hash !== request_hash) fail('id_reutilizado', 409);
    return { item: fromRow(await invoice(db, id)), status: 200 };
  }
  await linkedRecords(db, item);
  if (correction) assertSameIdentity(correction, item);
  const now = new Date().toISOString(), record = { id, ...valuesOf(item), iva_deducible: 0, root_id: correction?.root_id ?? id,
    correccion_de: correction?.id ?? null, motivo_correccion: correction ? textField(b.motivo, 2000, true) : null,
    external_key: await externalKey(item), request_hash, created_by: actor, updated_by: actor, created_at: now, updated_at: now };
  const keys = Object.keys(record);
  try {
    await db.batch([
      db.prepare(`INSERT INTO g_facturas (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...Object.values(record)),
      audit(db, correction ? 'factura_correccion' : 'factura_alta', id, actor, now, { estado: item.estado, correccion_de: correction?.id ?? null }),
    ]);
  } catch (e) {
    // Un POST concurrente idéntico devuelve el mismo recurso. Nunca repite la caja.
    const concurrent = await db.prepare('SELECT * FROM g_facturas WHERE id=?').bind(id).first();
    if (concurrent) {
      if (concurrent.request_hash !== request_hash) fail('id_reutilizado', 409);
      return { item: fromRow(await invoice(db, id)), status: 200 };
    }
    normalizeError(e);
  }
  return { item: fromRow(await invoice(db, id)), status: 201 };
}
function assertSameIdentity(old, next) {
  for (const key of ['entidad_id', 'moneda', 'tipo', 'numero', 'contraparte_nif', 'fecha_emision', 'fecha_operacion', 'origen', 'clase', 'rectifica_id']) {
    if ((old[key] ?? null) !== (next[key] ?? null)) fail('correccion_cambia_identidad');
  }
}
async function rangeRows(db, s) {
  const size = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(length(f.lineas_json)+length(COALESCE(f.snapshot_json,''))),0) AS bytes FROM g_facturas f WHERE ${FILTER}`)
    .bind(s.entidad_id, s.moneda, s.desde, s.hasta).first();
  if (size.n > 5000 || size.bytes > 8 * 1024 * 1024) fail('demasiadas_facturas_dividir_periodo', 409);
  const rows = (await db.prepare(`${SELECT} WHERE ${FILTER} ORDER BY COALESCE(f.fecha_operacion,f.fecha_emision),f.created_at,f.id LIMIT 5001`)
    .bind(s.entidad_id, s.moneda, s.desde, s.hasta).all()).results;
  if (rows.length > 5000) fail('demasiadas_facturas_dividir_periodo', 409);
  return rows.map(fromRow);
}
function queryScope(url) { return scopeOf(Object.fromEntries(url.searchParams)); }

fiscal.get(`${ROOT}/facturas`, async (c) => {
  const { env, scope, url } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const id = textField(url.searchParams.get('entidad_id'), 100, true), currency = choice(url.searchParams.get('moneda'), MONEDAS, 'moneda');
  await entity(env.DB, id);
  const clauses = ['f.entidad_id=?', 'f.moneda=?'], args = [id, currency];
  for (const key of ['desde', 'hasta']) if (url.searchParams.has(key)) { clauses.push(`COALESCE(f.fecha_operacion,f.fecha_emision) ${key === 'desde' ? '>=' : '<='} ?`); args.push(day(url.searchParams.get(key), true)); }
  if (url.searchParams.get('desde') && url.searchParams.get('hasta') && url.searchParams.get('desde') > url.searchParams.get('hasta')) fail('periodo_invalido');
  if (url.searchParams.has('estado')) { clauses.push('f.estado=?'); args.push(choice(url.searchParams.get('estado'), ['borrador', 'registrada', 'validada'], 'estado')); }
  if (url.searchParams.has('tipo')) { clauses.push('f.tipo=?'); args.push(choice(url.searchParams.get('tipo'), ['recibida', 'emitida'], 'tipo')); }
  if (url.searchParams.has('cursor')) { clauses.push('f.id>?'); args.push(uuid(url.searchParams.get('cursor'))); }
  const rows = (await env.DB.prepare(`${SELECT} WHERE ${clauses.join(' AND ')} ORDER BY f.id LIMIT 101`).bind(...args).all()).results;
  const more = rows.length > 100; if (more) rows.pop();
  return json({ items: rows.map(fromRow), nextCursor: more ? rows.at(-1).id : null }, 200, NO_STORE);
});
fiscal.get(`${ROOT}/facturas/:id`, async (c) => {
  const { env, scope } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  return json({ item: fromRow(await invoice(env.DB, c.req.param('id'))) }, 200, NO_STORE);
});
fiscal.post(`${ROOT}/facturas`, async (c) => {
  const { env, scope, actor, request } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const result = await create(env.DB, await bodyOf(request, ['id', ...FIELDS]), actor);
  return json({ item: result.item }, result.status, NO_STORE);
});
fiscal.patch(`${ROOT}/facturas/:id`, async (c) => {
  const { env, scope, actor, request } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const old = await invoice(env.DB, c.req.param('id')), b = await bodyOf(request, ['version', ...FIELDS]);
  if (old.estado === 'validada') fail('factura_inmutable', 409);
  if (old.version !== versionOf(b.version)) fail('version_desactualizada', 409);
  const next = normalizeInvoice({ ...fromRow(old), ...b });
  await linkedRecords(env.DB, next);
  if (old.correccion_de) assertSameIdentity(old, next);
  const now = new Date().toISOString(), fields = { ...valuesOf(next), external_key: await externalKey(next), updated_at: now, updated_by: actor };
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE g_facturas SET ${Object.keys(fields).map((k) => `${k}=?`).join(',')},version=version+1 WHERE id=? AND version=?`).bind(...Object.values(fields), old.id, old.version),
      audit(env.DB, 'factura_edicion', old.id, actor, now, { version_anterior: old.version, campos: Object.keys(b).filter((k) => k !== 'version') }, true),
    ]);
    if (!results[0].meta.changes) fail('version_desactualizada', 409);
  } catch (e) { normalizeError(e); }
  return json({ item: fromRow(await invoice(env.DB, old.id)) }, 200, NO_STORE);
});
fiscal.post(`${ROOT}/facturas/:id/validar`, async (c) => {
  const { env, scope, actor, request } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const old = await invoice(env.DB, c.req.param('id')), b = await bodyOf(request, ['version', 'iva_deducible', 'revision']);
  if (old.estado === 'validada') fail('factura_inmutable', 409);
  if (old.version !== versionOf(b.version)) fail('version_desactualizada', 409);
  const issuer = await entity(env.DB, old.entidad_id), item = fromRow(old);
  if (issuer.tipo === 'promotores' || issuer.estado !== 'activa' || !issuer.nif?.trim() || !issuer.direccion?.trim()) fail('entidad_fiscal_incompleta', 409);
  if (old.estado !== 'registrada' || old.origen !== 'externa' || !old.numero || !old.fecha_emision || !old.contraparte_nif || !old.contraparte_nombre || !old.contraparte_direccion) fail('original_externo_incompleto', 409);
  if (!old.originales_count) fail('original_pendiente', 409);
  if (old.clase === 'rectificativa' && !old.rectifica_id) fail('referencia_rectificativa_pendiente', 409);
  if (old.tratamiento_fiscal === 'pendiente') fail('tratamiento_fiscal_pendiente', 409);
  if (['inversion', 'rebu'].includes(old.tratamiento_fiscal)) fail('regimen_requiere_asesoria', 409);
  if (old.tratamiento_fiscal === 'general' && item.lineas.some((l) => l.iva_bp === null)) fail('tipo_iva_pendiente', 409);
  if (['exento', 'no_sujeto'].includes(old.tratamiento_fiscal) && (!old.nota_fiscal || item.lineas.some((l) => l.iva !== 0 || (l.iva_bp !== null && l.iva_bp !== 0)))) fail('fundamento_fiscal_pendiente', 409);
  const iva_deducible = integer(b.iva_deducible ?? 0, Math.min(old.iva, 0), Math.max(old.iva, 0));
  if (old.tipo === 'emitida' && iva_deducible !== 0) fail('deduccion_solo_recibidas');
  const revision = textField(b.revision, 2000, true), now = new Date().toISOString();
  const documents = (await env.DB.prepare("SELECT id,sha256,nombre,clase FROM g_documentos WHERE tipo='factura' AND objeto_id=? ORDER BY id").bind(old.id).all()).results;
  const snapshot = { entidad: { id: issuer.id, nombre: issuer.nombre, nif: issuer.nif, direccion: issuer.direccion, tipo: issuer.tipo }, factura: { ...item, snapshot: null, estado: 'validada', iva_deducible, revision, version: old.version + 1 }, documentos: documents, revisada_por: actor, revisada_en: now };
  try {
    const result = await env.DB.batch([
      env.DB.prepare(`UPDATE g_facturas SET estado='validada',iva_deducible=?,revision=?,snapshot_json=?,version=version+1,updated_by=?,updated_at=?
        WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM g_entidades e WHERE e.id=g_facturas.entidad_id AND e.version=? AND e.estado='activa')`)
        .bind(iva_deducible, revision, canonical(snapshot), actor, now, old.id, old.version, issuer.version),
      audit(env.DB, 'factura_validada', old.id, actor, now, { version_anterior: old.version, iva_deducible, revision }, true),
    ]);
    if (!result[0].meta.changes) fail('version_desactualizada', 409);
  } catch (e) { normalizeError(e); }
  return json({ item: fromRow(await invoice(env.DB, old.id)) }, 200, NO_STORE);
});
fiscal.post(`${ROOT}/facturas/:id/corregir`, async (c) => {
  const { env, scope, actor, request } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const old = await invoice(env.DB, c.req.param('id')), b = await bodyOf(request, ['id', 'version', 'motivo', ...FIELDS]);
  if (old.estado !== 'validada') fail('corregir_solo_validada', 409);
  if (old.version !== versionOf(b.version)) fail('version_desactualizada', 409);
  textField(b.motivo, 2000, true);
  const { snapshot, documentos_count, ...data } = fromRow(old);
  const result = await create(env.DB, { ...data, ...b, estado: 'registrada' }, actor, old);
  return json({ item: result.item, aviso: 'Corrección del registro interno; no emite una factura rectificativa. La revisión anterior sigue en cifras hasta validar esta corrección.' }, result.status, NO_STORE);
});
fiscal.get(`${ROOT}/fiscal/resumen`, async (c) => {
  const { env, scope, url } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const s = queryScope(url); await entity(env.DB, s.entidad_id);
  const items = await rangeRows(env.DB, s), result = summarize(items, s);
  const noDate = await env.DB.prepare('SELECT COUNT(*) AS n FROM g_facturas WHERE entidad_id=? AND moneda=? AND fecha_operacion IS NULL AND fecha_emision IS NULL').bind(s.entidad_id, s.moneda).first();
  return json({ ...result, sin_fecha: noDate.n }, 200, NO_STORE);
});
fiscal.get(`${ROOT}/fiscal/export.csv`, async (c) => {
  const { env, scope, url } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const s = queryScope(url); const e = await entity(env.DB, s.entidad_id), items = await rangeRows(env.DB, s);
  if (items.reduce((sum, f) => sum + f.lineas.length, 0) > 10000) fail('demasiadas_lineas_dividir_periodo', 409);
  const replaced = new Set(items.filter((i) => i.estado === 'validada' && i.correccion_de).map((i) => i.correccion_de));
  const keys = ['registro', 'entidad_id', 'entidad_nombre', 'entidad_nif', 'moneda', 'id', 'tipo', 'negocio', 'estado', 'incluida_en_totales', 'numero_externo', 'fecha_emision', 'fecha_operacion', 'fecha_recepcion', 'contraparte_nombre', 'contraparte_nif', 'contraparte_direccion', 'tratamiento_fiscal', 'nota_fiscal', 'linea', 'descripcion', 'cantidad', 'precio_unitario', 'descuento', 'base', 'iva_bp', 'iva', 'retencion_bp', 'retencion', 'total', 'iva_deducible_factura', 'compra_id', 'proveedor_emision', 'correccion_de', 'rectifica_id', 'version', 'documentos', 'revision', 'incidencias'];
  // Sólo columnas numéricas generadas/validadas aquí pueden conservar el signo -
  // como número; usar el escape antifórmula de texto convertiría abonos en texto.
  const numeric = new Set(['linea', 'cantidad', 'precio_unitario', 'descuento', 'base', 'iva_bp', 'iva', 'retencion_bp', 'retencion', 'total', 'iva_deducible_factura', 'version', 'documentos']);
  const rows = [];
  for (const f of items) {
    const included = f.estado === 'validada' && !replaced.has(f.id), frozenEntity = f.snapshot?.entidad ?? e;
    f.lineas.forEach((l, index) => {
      const row = { registro: included ? 'LIBRO_INTERNO' : 'INCIDENCIA', entidad_id: f.entidad_id, entidad_nombre: frozenEntity.nombre, entidad_nif: frozenEntity.nif,
        moneda: f.moneda, id: f.id, tipo: f.tipo, negocio: f.negocio, estado: f.estado, incluida_en_totales: included ? 'SI' : 'NO', numero_externo: f.numero,
        fecha_emision: f.fecha_emision, fecha_operacion: f.fecha_operacion, fecha_recepcion: f.fecha_recepcion, contraparte_nombre: f.contraparte_nombre, contraparte_nif: f.contraparte_nif,
        contraparte_direccion: f.contraparte_direccion, tratamiento_fiscal: f.tratamiento_fiscal, nota_fiscal: f.nota_fiscal,
        linea: index + 1, descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: moneyText(l.precio_unitario, f.moneda), descuento: moneyText(l.descuento, f.moneda),
        base: included ? moneyText(l.base, f.moneda) : '', iva_bp: l.iva_bp, iva: included ? moneyText(l.iva, f.moneda) : '', retencion_bp: l.retencion_bp,
        retencion: included ? moneyText(l.retencion, f.moneda) : '', total: included ? moneyText(l.total, f.moneda) : '',
        iva_deducible_factura: included && index === 0 ? moneyText(f.iva_deducible, f.moneda) : '', compra_id: f.compra_id, proveedor_emision: f.proveedor_emision,
        correccion_de: f.correccion_de, rectifica_id: f.rectifica_id, version: f.version, documentos: f.documentos_count, revision: f.revision,
        incidencias: [...invoiceIssues(f), ...(replaced.has(f.id) ? ['revision_sustituida'] : [])].join('|') };
      rows.push(keys.map((key) => numeric.has(key) && /^-?\d+(?:\.\d+)?$/.test(String(row[key])) ? `"${row[key]}"` : csvSafe(row[key])).join(','));
    });
  }
  const undated = await env.DB.prepare('SELECT COUNT(*) AS n FROM g_facturas WHERE entidad_id=? AND moneda=? AND fecha_emision IS NULL AND fecha_operacion IS NULL').bind(s.entidad_id, s.moneda).first();
  if (undated.n) {
    const notice = { registro: 'AVISO_SIN_FECHA', entidad_id: e.id, entidad_nombre: e.nombre, entidad_nif: e.nif, moneda: s.moneda, incluida_en_totales: 'NO',
      incidencias: `${undated.n} registros sin fecha no asignados al periodo; completar la fecha y repetir la exportacion.` };
    rows.push(keys.map((key) => csvSafe(notice[key])).join(','));
  }
  const csv = '\uFEFF' + [keys.join(','), ...rows].join('\r\n');
  return new Response(csv, { headers: { ...NO_STORE, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="velai-libro-interno-${s.desde}-${s.hasta}.csv"`, 'X-Content-Type-Options': 'nosniff' } });
});
fiscal.get(`${ROOT}/cierres`, async (c) => {
  const { env, scope, url } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const id = textField(url.searchParams.get('entidad_id'), 100, true), currency = choice(url.searchParams.get('moneda'), MONEDAS, 'moneda');
  await entity(env.DB, id);
  const cursor = url.searchParams.get('cursor');
  const rows = (await env.DB.prepare(`SELECT * FROM g_fiscal_cierres WHERE entidad_id=? AND moneda=? ${cursor ? 'AND id>?' : ''} ORDER BY id LIMIT 101`).bind(id, currency, ...(cursor ? [uuid(cursor)] : [])).all()).results;
  const more = rows.length > 100; if (more) rows.pop();
  return json({ items: rows.map(({ request_hash, snapshot_json, ...r }) => ({ ...r, snapshot: JSON.parse(snapshot_json) })), nextCursor: more ? rows.at(-1).id : null }, 200, NO_STORE);
});
fiscal.post(`${ROOT}/cierres`, async (c) => {
  const { env, scope, actor, request } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const b = await bodyOf(request, ['id', 'entidad_id', 'moneda', 'desde', 'hasta', 'nota', 'aceptar_pendientes']);
  const id = uuid(b.id), s = scopeOf(b), nota = textField(b.nota, 2000), hash = await digest({ ...s, nota, aceptar_pendientes: b.aceptar_pendientes === true });
  const prior = await env.DB.prepare('SELECT * FROM g_fiscal_cierres WHERE id=?').bind(id).first();
  if (prior) {
    if (prior.request_hash !== hash) fail('id_reutilizado', 409);
    const { request_hash, snapshot_json, ...item } = prior;
    return json({ item: { ...item, snapshot: JSON.parse(snapshot_json) } }, 200, NO_STORE);
  }
  const e = await entity(env.DB, s.entidad_id);
  if (e.tipo === 'promotores' || e.estado !== 'activa' || !e.nif || !e.direccion) fail('entidad_fiscal_incompleta', 409);
  const items = await rangeRows(env.DB, s), summary = summarize(items, s);
  const undated = await env.DB.prepare('SELECT COUNT(*) AS n FROM g_facturas WHERE entidad_id=? AND moneda=? AND fecha_emision IS NULL AND fecha_operacion IS NULL').bind(s.entidad_id, s.moneda).first();
  if ((summary.incidencias.length || undated.n) && b.aceptar_pendientes !== true) fail('cierre_con_pendientes', 409);
  const now = new Date().toISOString(), snapshot = { entidad: { id: e.id, nombre: e.nombre, nif: e.nif, direccion: e.direccion }, ...summary, sin_fecha: undated.n, facturas: items, generado_por: actor, generado_en: now }, raw = canonical(snapshot), sha = await digest(raw);
  if (new TextEncoder().encode(raw).length > 1024 * 1024) fail('snapshot_grande_dividir_periodo', 409);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO g_fiscal_cierres (id,entidad_id,moneda,desde,hasta,snapshot_json,sha256,request_hash,nota,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(id, s.entidad_id, s.moneda, s.desde, s.hasta, raw, sha, hash, nota, actor, now),
      audit(env.DB, 'periodo_cerrado', id, actor, now, { ...s, sha256: sha, pendientes: summary.incidencias.length, sin_fecha: undated.n }),
    ]);
  } catch (err) {
    const concurrent = await env.DB.prepare('SELECT * FROM g_fiscal_cierres WHERE id=?').bind(id).first();
    if (concurrent && concurrent.request_hash === hash) {
      const { request_hash, snapshot_json, ...item } = concurrent;
      return json({ item: { ...item, snapshot: JSON.parse(snapshot_json) } }, 200, NO_STORE);
    }
    normalizeError(err);
  }
  return json({ item: { id, ...s, estado: 'cerrado', version: 1, sha256: sha, snapshot, created_by: actor, created_at: now, nota } }, 201, NO_STORE);
});
fiscal.post(`${ROOT}/cierres/:id/reabrir`, async (c) => {
  const { env, scope, actor, request } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const id = uuid(c.req.param('id')), b = await bodyOf(request, ['version', 'motivo']), version = versionOf(b.version), motivo = textField(b.motivo, 2000, true);
  if (motivo.length < 5) fail('motivo_insuficiente');
  const now = new Date().toISOString();
  try {
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE g_fiscal_cierres SET estado='reabierto',version=version+1,reabierto_por=?,reabierto_en=?,motivo_reapertura=? WHERE id=? AND version=? AND estado='cerrado'").bind(actor, now, motivo, id, version),
      audit(env.DB, 'periodo_reabierto', id, actor, now, { motivo, version_anterior: version }, true),
    ]);
    if (!results[0].meta.changes) fail('version_desactualizada', 409);
  } catch (err) { normalizeError(err); }
  const { request_hash, snapshot_json, ...item } = await env.DB.prepare('SELECT * FROM g_fiscal_cierres WHERE id=?').bind(id).first();
  return json({ item: { ...item, snapshot: JSON.parse(snapshot_json) } }, 200, NO_STORE);
});
