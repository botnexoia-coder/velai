// Conductores administrativos: socio antes de D1/R2, separados de las finanzas.
import { Hono } from 'hono';
import { HttpError, json, NO_STORE, readJson } from './app.js';
import { esSocio, partesAdmin } from './middleware.js';
import { fail, uuid, texto, enumValor, fechaCivil, fechaOpcional, versionDe, soloCampos, entero, auditoria, versionAplicada, huella, idempotente, detectarDocumento, sha256Hex, DOC_MAX_BYTES, DOC_HEADERS, documentoItem } from './gestion-financiera.js';
export const conductores = new Hono();
const BASE = '/api/admin/gestion';
const CLASES = ['foto', 'identidad', 'carnet', 'permiso_trabajo', 'otros'];
const abrir = c => {
  const p = partesAdmin(c);
  if (!esSocio(p.env, p.scope)) throw new HttpError(403, 'not_authorized');
  return {
    ...p,
    now: new Date().toISOString()
  };
};
async function body(c) {
  const b = await readJson(c.req.raw, 32000);
  if (!b || typeof b !== 'object' || Array.isArray(b)) fail('cuerpo_invalido');
  return b;
}
const id = (c, k = 'id') => {
  const v = c.req.param(k);
  if (!/^[0-9a-f-]{36}$/i.test(v || '')) throw new HttpError(404, 'not_found');
  return v.toLowerCase();
};
async function row(env, table, key) {
  const r = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(key).first();
  if (!r) throw new HttpError(404, 'not_found');
  return r;
}
const optional = (max, code) => v => texto(v, max, code, {
  opcional: true
});
const fields = {
  nombre: v => texto(v, 120, 'nombre_invalido'),
  telefono: v => texto(v, 40, 'telefono_invalido'),
  email: optional(180, 'email_invalido'),
  estado: v => v == null ? 'activo' : enumValor(v, ['activo', 'inactivo'], 'estado_invalido'),
  identidad_tipo: v => v == null ? null : enumValor(v, ['dni', 'nie', 'pasaporte', 'otro'], 'identidad_tipo_invalido'),
  identidad_numero: optional(60, 'identidad_numero_invalido'),
  identidad_vence: v => fechaOpcional(v, fechaCivil, 'identidad_vence_invalida'),
  carnet_numero: optional(60, 'carnet_numero_invalido'),
  carnet_categorias: optional(100, 'carnet_categorias_invalidas'),
  carnet_vence: v => fechaOpcional(v, fechaCivil, 'carnet_vence_invalida'),
  permiso_trabajo_vence: v => fechaOpcional(v, fechaCivil, 'permiso_trabajo_vence_invalida'),
  contacto_emergencia_nombre: optional(120, 'contacto_emergencia_nombre_invalido'),
  contacto_emergencia_telefono: optional(40, 'contacto_emergencia_telefono_invalido'),
  nota: optional(2000, 'nota_invalida')
};
const cols = Object.keys(fields);
const assignmentSql = `SELECT a.*,v.referencia,v.matricula,c.nombre AS conductor_nombre,c.telefono AS conductor_telefono FROM g_vehiculo_conductores a JOIN g_vehiculos v ON v.id=a.vehiculo_id JOIN g_conductores c ON c.id=a.conductor_id`;
const assignmentItem = (r, now) => ({
  ...r,
  estado: r.desde > now ? 'programada' : r.hasta && r.hasta <= now ? 'finalizada' : 'actual'
});
function writeError(e) {
  if (/asignacion_solapada/.test(e.message)) throw new HttpError(409, 'asignacion_solapada');
  if (/conductor_inactivo/.test(e.message)) throw new HttpError(409, 'conductor_inactivo');
  throw e;
}
conductores.get(`${BASE}/conductores`, async c => {
  const {
    env,
    url
  } = abrir(c);
  const q = url.searchParams.get('q');
  const args = [];
  let filter = '';
  if (q) {
    const value = texto(q, 120, 'busqueda_invalida');
    filter = 'WHERE instr(upper(nombre),upper(?))>0 OR instr(telefono,?)>0';
    args.push(value, value);
  }
  const rows = (await env.DB.prepare(`SELECT id,nombre,telefono,estado,version FROM g_conductores ${filter} ORDER BY nombre COLLATE NOCASE,id LIMIT 501`).bind(...args).all()).results;
  const mas = rows.length > 500;
  if (mas) rows.pop();
  return json({
    items: rows,
    mas
  }, 200, NO_STORE);
});
conductores.post(`${BASE}/conductores`, async c => {
  const {
    env,
    actor,
    now
  } = abrir(c);
  const b = await body(c);
  soloCampos(b, ['id', ...cols]);
  const d = {
    id: uuid(b.id),
    ...Object.fromEntries(cols.map(k => [k, fields[k](b[k])]))
  };
  const {
    repetida
  } = await idempotente(env, {
    id: d.id,
    ruta: 'conductores',
    huella: await huella(d),
    actor,
    now
  }, () => [env.DB.prepare(`INSERT INTO g_conductores (id,${cols.join(',')},version,created_by,created_at,updated_at) VALUES (${['?', ...cols.map(() => '?'), 1, '?', '?', '?'].join(',')})`).bind(d.id, ...cols.map(k => d[k]), actor, now, now), auditoria(env, {
    actor,
    accion: 'conductor_alta',
    objeto_tipo: 'conductor',
    objeto_id: d.id,
    detalle: {
      campos: cols
    },
    now
  })]);
  return json({
    item: await row(env, 'g_conductores', d.id)
  }, repetida ? 200 : 201, NO_STORE);
});
conductores.get(`${BASE}/conductores/:id`, async c => {
  const {
    env,
    now
  } = abrir(c);
  const key = id(c);
  const item = await row(env, 'g_conductores', key);
  const [docs, assignments] = await env.DB.batch([env.DB.prepare('SELECT * FROM g_conductor_documentos WHERE conductor_id=? ORDER BY created_at,id').bind(key), env.DB.prepare(`${assignmentSql} WHERE a.conductor_id=? ORDER BY a.desde DESC,a.id`).bind(key)]);
  return json({
    item,
    documentos: docs.results.map(documentoItem),
    asignaciones: assignments.results.map(r => assignmentItem(r, now))
  }, 200, NO_STORE);
});
conductores.patch(`${BASE}/conductores/:id`, async c => {
  const {
    env,
    actor,
    now
  } = abrir(c);
  const old = await row(env, 'g_conductores', id(c));
  const b = await body(c);
  soloCampos(b, ['version', ...cols]);
  const version = versionDe(b);
  if (version !== old.version) throw new HttpError(409, 'version_conflicto');
  const n = Object.fromEntries(cols.map(k => [k, b[k] === undefined ? old[k] : fields[k](b[k])]));
  const changed = cols.filter(k => n[k] !== old[k]);
  const result = await env.DB.batch([env.DB.prepare(`UPDATE g_conductores SET ${cols.map(k => `${k}=?`).join(',')},version=version+1,updated_at=? WHERE id=? AND version=?`).bind(...cols.map(k => n[k]), now, old.id, version), auditoria(env, {
    actor,
    accion: 'conductor_cambio',
    objeto_tipo: 'conductor',
    objeto_id: old.id,
    detalle: {
      campos: changed
    },
    now,
    si: versionAplicada()
  })]);
  if (!result[0].meta.changes) throw new HttpError(409, 'version_conflicto');
  return json({
    item: await row(env, 'g_conductores', old.id)
  }, 200, NO_STORE);
});
const utc = v => {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail('fecha_hora_invalida');
  return v;
};
conductores.get(`${BASE}/vehiculos/:id/conductores`, async c => {
  const {
    env,
    now
  } = abrir(c);
  const key = id(c);
  await row(env, 'g_vehiculos', key);
  const items = (await env.DB.prepare(`${assignmentSql} WHERE a.vehiculo_id=? ORDER BY a.desde DESC,a.id`).bind(key).all()).results.map(r => assignmentItem(r, now));
  return json({
    items,
    actual: items.find(r => r.estado === 'actual') || null
  }, 200, NO_STORE);
});
conductores.post(`${BASE}/conductores/:id/asignaciones`, async c => {
  const {
    env,
    actor,
    now
  } = abrir(c);
  const key = id(c);
  await row(env, 'g_conductores', key);
  const b = await body(c);
  soloCampos(b, ['id', 'vehiculo_id', 'desde', 'hasta', 'nota']);
  const n = {
    id: uuid(b.id),
    conductor_id: key,
    vehiculo_id: uuid(b.vehiculo_id),
    desde: utc(b.desde),
    hasta: b.hasta == null ? null : utc(b.hasta),
    nota: optional(2000, 'nota_invalida')(b.nota)
  };
  if (n.hasta && n.hasta <= n.desde) fail('fechas_incoherentes');
  await row(env, 'g_vehiculos', n.vehiculo_id);
  let result;
  try {
    result = await idempotente(env, {
      id: n.id,
      ruta: 'conductor_asignaciones',
      huella: await huella(n),
      actor,
      now
    }, () => [env.DB.prepare(`INSERT INTO g_vehiculo_conductores (id,vehiculo_id,conductor_id,desde,hasta,nota,version,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?)`).bind(n.id, n.vehiculo_id, key, n.desde, n.hasta, n.nota, actor, now, now), auditoria(env, {
      actor,
      accion: 'conductor_asignacion_alta',
      objeto_tipo: 'conductor',
      objeto_id: key,
      detalle: {
        asignacion_id: n.id,
        vehiculo_id: n.vehiculo_id
      },
      now,
      si: versionAplicada()
    })]);
  } catch (e) {
    writeError(e);
  }
  const item = await env.DB.prepare('SELECT * FROM g_vehiculo_conductores WHERE id=?').bind(n.id).first();
  if (!item) throw new HttpError(409, 'conductor_inactivo');
  return json({
    item: assignmentItem(item, now)
  }, result.repetida ? 200 : 201, NO_STORE);
});
conductores.patch(`${BASE}/conductor-asignaciones/:id`, async c => {
  const {
    env,
    actor,
    now
  } = abrir(c);
  const old = await row(env, 'g_vehiculo_conductores', id(c));
  const b = await body(c);
  soloCampos(b, ['version', 'desde', 'hasta', 'nota']);
  const version = versionDe(b);
  if (version !== old.version) throw new HttpError(409, 'version_conflicto');
  const n = {
    desde: b.desde === undefined ? old.desde : utc(b.desde),
    hasta: b.hasta === undefined ? old.hasta : b.hasta === null ? null : utc(b.hasta),
    nota: b.nota === undefined ? old.nota : optional(2000, 'nota_invalida')(b.nota)
  };
  if (n.hasta && n.hasta <= n.desde) fail('fechas_incoherentes');
  let result;
  try {
    result = await env.DB.batch([env.DB.prepare('UPDATE g_vehiculo_conductores SET desde=?,hasta=?,nota=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(n.desde, n.hasta, n.nota, now, old.id, version), auditoria(env, {
      actor,
      accion: 'conductor_asignacion_cambio',
      objeto_tipo: 'conductor',
      objeto_id: old.conductor_id,
      detalle: {
        asignacion_id: old.id,
        campos: Object.keys(n).filter(k => n[k] !== old[k])
      },
      now,
      si: versionAplicada()
    })]);
  } catch (e) {
    writeError(e);
  }
  if (!result[0].meta.changes) throw new HttpError(409, 'version_conflicto');
  return json({
    item: assignmentItem(await row(env, 'g_vehiculo_conductores', old.id), now)
  }, 200, NO_STORE);
});
async function documentoDe(c, env, incluirRetirados = false) {
  const key = id(c);
  const doc = await row(env, 'g_conductor_documentos', id(c, 'docId'));
  if (doc.conductor_id !== key || (!incluirRetirados && doc.retirado_at)) throw new HttpError(404, 'not_found');
  return doc;
}
conductores.get(`${BASE}/conductores/:id/documentos`, async c => {
  const {
    env
  } = abrir(c);
  const key = id(c);
  await row(env, 'g_conductores', key);
  const rows = (await env.DB.prepare('SELECT * FROM g_conductor_documentos WHERE conductor_id=? ORDER BY created_at,id').bind(key).all()).results;
  return json({
    items: rows.map(documentoItem),
    storage_ready: Boolean(env.FINANCE_DOCS)
  }, 200, NO_STORE);
});
async function limpiar(env, key) {
  try {
    if (!(await env.DB.prepare('SELECT id FROM g_conductor_documentos WHERE key=?').bind(key).first())) await env.FINANCE_DOCS.delete(key);
  } catch {
    console.log(JSON.stringify({
      level: 'error',
      code: 'driver_doc_cleanup_failed'
    }));
  }
}
conductores.post(`${BASE}/conductores/:id/documentos`, async c => {
  const {
    env,
    request,
    actor,
    now
  } = abrir(c);
  const conductor_id = id(c);
  await row(env, 'g_conductores', conductor_id);
  if (!env.FINANCE_DOCS) throw new HttpError(503, 'finance_docs_not_configured');
  const size = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(size) && size > DOC_MAX_BYTES + 65536) throw new HttpError(413, 'archivo_demasiado_grande');
  if (!/^multipart\/form-data/i.test(request.headers.get('Content-Type') || '')) throw new HttpError(415, 'unsupported_media_type');
  let f;
  try {
    f = await request.formData();
  } catch {
    fail('multipart_invalido');
  }
  const file = f.get('archivo');
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') fail('archivo_requerido');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) fail('archivo_vacio');
  if (bytes.length > DOC_MAX_BYTES) throw new HttpError(413, 'archivo_demasiado_grande');
  const format = detectarDocumento(bytes);
  if (!format) fail('formato_invalido');
  const d = {
    id: uuid(f.get('id')),
    conductor_id,
    clase: enumValor(f.get('clase'), CLASES, 'clase_invalida'),
    vence: f.get('vence') ? fechaCivil(f.get('vence'), 'vence_invalida') : null,
    sha256: await sha256Hex(bytes)
  };
  if (d.clase === 'foto' && !format.mime.startsWith('image/')) fail('foto_invalida');
  const hash = await huella(d);
  const previa = await env.DB.prepare('SELECT ruta,huella,resultado_id FROM g_idempotencia WHERE clave=?').bind(d.id).first();
  if (previa) {
    if (previa.ruta !== 'conductor_documentos' || previa.huella !== hash) throw new HttpError(409, 'idempotencia_conflicto');
    const saved = await row(env, 'g_conductor_documentos', previa.resultado_id || d.id);
    if (saved.retirado_at) throw new HttpError(409, 'documento_retirado');
    return json({
      item: documentoItem(saved),
      duplicado: saved.id !== d.id
    }, 200, NO_STORE);
  }
  const duplicate = async old => {
    if (old.retirado_at) throw new HttpError(409, 'documento_retirado');
    await idempotente(env, {
      id: d.id,
      ruta: 'conductor_documentos',
      huella: hash,
      actor,
      now,
      resultado_id: old.id
    }, () => []);
    return json({
      item: documentoItem(old),
      duplicado: true
    }, 200, NO_STORE);
  };
  const old = await env.DB.prepare('SELECT * FROM g_conductor_documentos WHERE conductor_id=? AND sha256=?').bind(conductor_id, d.sha256).first();
  if (old) return duplicate(old);
  const key = `gestion/conductor/${conductor_id}/${d.id}/${crypto.randomUUID()}.${format.ext}`;
  try {
    await env.FINANCE_DOCS.put(key, bytes, {
      httpMetadata: {
        contentType: format.mime
      }
    });
  } catch {
    throw new HttpError(503, 'documento_no_guardado');
  }
  try {
    const result = await idempotente(env, {
      id: d.id,
      ruta: 'conductor_documentos',
      huella: hash,
      actor,
      now
    }, () => [env.DB.prepare(`INSERT INTO g_conductor_documentos (id,conductor_id,clase,nombre,mime,ext,bytes,sha256,key,vence,autor,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(d.id, conductor_id, d.clase, `${d.clase}.${format.ext}`, format.mime, format.ext, bytes.length, d.sha256, key, d.vence, actor, now), auditoria(env, {
      actor,
      accion: 'conductor_documento_alta',
      objeto_tipo: 'conductor',
      objeto_id: conductor_id,
      detalle: {
        documento_id: d.id,
        clase: d.clase,
        bytes: bytes.length
      },
      now
    })]);
    if (result.repetida) {
      await limpiar(env, key);
      const op = await env.DB.prepare('SELECT resultado_id FROM g_idempotencia WHERE clave=?').bind(d.id).first();
      const saved = await row(env, 'g_conductor_documentos', op.resultado_id || d.id);
      if (saved.retirado_at) throw new HttpError(409, 'documento_retirado');
      return json({
        item: documentoItem(saved),
      duplicado: saved.id !== d.id
      }, 200, NO_STORE);
    }
  } catch (e) {
    await limpiar(env, key);
    if (e instanceof HttpError) throw e;
    if (/UNIQUE constraint failed: g_conductor_documentos/.test(e.message)) {
      const other = await env.DB.prepare('SELECT * FROM g_conductor_documentos WHERE conductor_id=? AND sha256=?').bind(conductor_id, d.sha256).first();
      if (other) return duplicate(other);
    }
    throw new HttpError(503, 'documento_no_guardado');
  }
  return json({
    item: documentoItem(await row(env, 'g_conductor_documentos', d.id))
  }, 201, NO_STORE);
});
conductores.patch(`${BASE}/conductores/:id/documentos/:docId`, async c => {
  const {
    env,
    actor,
    now
  } = abrir(c);
  const old = await documentoDe(c, env, true);
  const b = await body(c);
  soloCampos(b, ['metadata_version', 'clase', 'estado_revision', 'revision_confirmada', 'fecha_inicio', 'vence', 'nota', 'retirado']);
  const version = entero(b.metadata_version, {
    min: 1,
    code: 'version_invalida'
  });
  if (version !== old.metadata_version) throw new HttpError(409, 'version_conflicto');
  if (b.retirado !== undefined && typeof b.retirado !== 'boolean') fail('retirado_invalido');
  const n = {
    clase: b.clase === undefined ? old.clase : enumValor(b.clase, CLASES, 'clase_invalida'),
    estado_revision: b.estado_revision === undefined ? old.estado_revision : enumValor(b.estado_revision, ['pendiente', 'revisado', 'sustituido'], 'estado_revision_invalido'),
    fecha_inicio: b.fecha_inicio === undefined ? old.fecha_inicio : fechaOpcional(b.fecha_inicio, fechaCivil, 'fecha_inicio_invalida'),
    vence: b.vence === undefined ? old.vence : fechaOpcional(b.vence, fechaCivil, 'vence_invalida'),
    nota: b.nota === undefined ? old.nota : optional(2000, 'nota_invalida')(b.nota)
  };
  if (n.fecha_inicio && n.vence && n.fecha_inicio > n.vence) fail('fechas_incoherentes');
  if (b.estado_revision === 'revisado' && b.revision_confirmada !== true) fail('revision_no_confirmada');
  if(n.clase === 'foto' && !old.mime.startsWith('image/')) fail('foto_invalida');
  const invalidada = n.clase !== old.clase || n.fecha_inicio !== old.fecha_inicio || n.vence !== old.vence;
  const restaurado = Boolean(old.retirado_at) && b.retirado === false;
  if (old.retirado_at && b.retirado !== false) throw new HttpError(409, 'documento_retirado');
  if ((invalidada && n.estado_revision === 'revisado') || (restaurado && n.estado_revision !== 'sustituido')) n.estado_revision = 'pendiente';
  const nuevaRevision = n.estado_revision === 'revisado' && b.estado_revision === 'revisado';
  const retiradoAt = b.retirado === undefined ? old.retirado_at : b.retirado ? old.retirado_at || now : null;
  const pendiente = n.estado_revision === 'pendiente';
  const archivarRevision = Boolean(old.revisado_at) && (nuevaRevision || pendiente);
  const anteriorPor = archivarRevision ? old.revisado_por : old.ultima_revision_por;
  const anteriorAt = archivarRevision ? old.revisado_at : old.ultima_revision_at;
  const revisadoPor = nuevaRevision ? actor : pendiente ? null : old.revisado_por;
  const revisadoAt = nuevaRevision ? now : pendiente ? null : old.revisado_at;
  const results = await env.DB.batch([env.DB.prepare('UPDATE g_conductor_documentos SET clase=?,nombre=?,estado_revision=?,fecha_inicio=?,vence=?,nota=?,retirado_at=?,revisado_por=?,revisado_at=?,ultima_revision_por=?,ultima_revision_at=?,metadata_version=metadata_version+1 WHERE id=? AND conductor_id=? AND metadata_version=?').bind(n.clase,`${n.clase}.${old.ext}`,n.estado_revision,n.fecha_inicio,n.vence,n.nota,retiradoAt,revisadoPor,revisadoAt,anteriorPor,anteriorAt,old.id,old.conductor_id,version), auditoria(env, {
    actor,
    accion: b.retirado ? 'conductor_documento_retirado' : restaurado ? 'conductor_documento_restaurado' : 'conductor_documento_metadata',
    objeto_tipo: 'conductor',
    objeto_id: old.conductor_id,
    detalle: {
      documento_id: old.id,
      campos: [...Object.keys(n).filter(k => n[k] !== old[k]), ...(retiradoAt !== old.retirado_at ? ['retirado_at'] : [])]
    },
    now,
    si: versionAplicada()
  })]);
  if (!results[0].meta.changes) throw new HttpError(409, 'version_conflicto');
  return json({
    item: documentoItem(await row(env, 'g_conductor_documentos', old.id))
  }, 200, NO_STORE);
});
conductores.get(`${BASE}/conductores/:id/documentos/:docId/archivo`, async c => {
  const {
    env,
    url
  } = abrir(c);
  const doc = await documentoDe(c, env);
  if (!env.FINANCE_DOCS) throw new HttpError(503, 'finance_docs_not_configured');
  const object = await env.FINANCE_DOCS.get(doc.key);
  if (!object) throw new HttpError(404, 'archivo_no_disponible');
  return new Response(object.body, {
    headers: {
      ...DOC_HEADERS,
      'Content-Type': doc.mime,
      'Content-Length': String(doc.bytes),
      'Content-Disposition': `${url.searchParams.get('descargar') === '1' ? 'attachment' : 'inline'}; filename="${doc.nombre}"`
    }
  });
});
