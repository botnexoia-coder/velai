// Contabilidad interna: la guarda vive en CADA handler, además de clienteGate.
import { Hono } from 'hono';
import { esSocio, partesAdmin } from '../middleware.js';
import { HttpError, json, NO_STORE, readJson, csvCell, PANEL_EMAIL_RE } from '../app.js';

export const finanzas = new Hono();
const TIPOS = ['ingreso', 'gasto', 'egreso'];
const MONEDAS = ['EUR', 'COP'];
const fail = (code) => { throw new HttpError(400, code); };
const enumValue = (value, values, code) => values.includes(value) ? value : fail(code);
const positivo = (n) => Number.isSafeInteger(n) && n > 0 ? n : fail('importe_invalido');
const nombre = (v) => typeof v === 'string' && v.trim() && v.trim().length <= 120 ? v.trim() : fail('nombre_invalido');
const nota = (v) => v == null ? null : typeof v === 'string' && v.length <= 2000 ? v.trim() || null : fail('nota_invalida');
const idConcepto = (v) => Number.isSafeInteger(v) && v > 0 ? v : fail('concepto_invalido');
const fechaReal = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
function fecha(v) {
  if (!fechaReal(v) || v < '2025-01-01' || v > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) fail('fecha_invalida');
  return v;
}
async function bodyOf(request) {
  const body = await readJson(request, 16000);
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('cuerpo_invalido');
  return body;
}
function writeError(e) {
  if (/UNIQUE constraint failed: fin_conceptos/.test(e.message)) throw new HttpError(409, 'concepto_duplicado');
  if (/UNIQUE constraint failed:.*fin_socios/.test(e.message)) throw new HttpError(409, 'socio_duplicado');
  if (e.message.includes('fin_beneficiario_inactivo')) fail('beneficiario_desconocido');
  throw e;
}
function socioEmail(value) {
  if (typeof value !== 'string' || value.trim().length > 200 || !PANEL_EMAIL_RE.test(value.trim())) fail('email_invalido');
  return value.trim().toLowerCase();
}
async function socioByEmail(env, email) {
  const row = await env.DB.prepare('SELECT email,nombre,activo FROM fin_socios WHERE lower(email)=?').bind(socioEmail(email)).first();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}
async function exists(env, table, id) {
  const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}
function filters(url) {
  const p = url.searchParams, clauses = ['1=1'], args = [];
  for (const key of ['desde', 'hasta']) {
    const value = p.get(key);
    if (value) {
      if (!fechaReal(value)) fail('fecha_invalida');
      clauses.push(`m.fecha ${key === 'desde' ? '>=' : '<='} ?`); args.push(value);
    }
  }
  if (p.get('desde') && p.get('hasta') && p.get('desde') > p.get('hasta')) fail('periodo_invalido');
  for (const [key, column, values] of [['tipo', 'tipo', TIPOS], ['moneda', 'moneda', MONEDAS], ['concepto', 'concepto_id'], ['tenant', 'tenant_id']]) {
    const value = p.get(key);
    if (!value) continue;
    if (values) enumValue(value, values, `${key}_invalido`);
    if (key === 'concepto') idConcepto(Number(value));
    clauses.push(`m.${column} = ?`); args.push(value);
  }
  return { sql: clauses.join(' AND '), args };
}
const SELECT_MOV = `SELECT m.*, c.nombre AS concepto_nombre, t.name AS tenant_name FROM fin_movimientos m
  JOIN fin_conceptos c ON c.id = m.concepto_id LEFT JOIN tenants t ON t.id = m.tenant_id`;
const ORDER = ' ORDER BY m.fecha DESC, m.created_at DESC, m.id DESC';
const TOTALS = `SELECT moneda, SUM(CASE WHEN tipo='ingreso' THEN importe ELSE 0 END) AS ingresos,
  SUM(CASE WHEN tipo='gasto' THEN importe ELSE 0 END) AS gastos,
  SUM(CASE WHEN tipo='egreso' THEN importe ELSE 0 END) AS egresos FROM fin_movimientos m`;
const REPARTIDO = `SELECT m.beneficiario AS email, COALESCE(s.nombre,m.beneficiario) AS nombre, m.moneda, SUM(m.importe) AS importe
  FROM fin_movimientos m LEFT JOIN fin_socios s ON lower(s.email)=m.beneficiario
  WHERE m.beneficiario IS NOT NULL GROUP BY m.beneficiario, m.moneda ORDER BY nombre`;
// Todas las cuentas salen del libro; caja ignora SIEMPRE los filtros del periodo.
function cuentas(periodo, acumulado) {
  return Object.fromEntries(MONEDAS.map((moneda) => {
    const p = periodo.find((r) => r.moneda === moneda) || { ingresos: 0, gastos: 0, egresos: 0 };
    const a = acumulado.find((r) => r.moneda === moneda) || { ingresos: 0, gastos: 0, egresos: 0 };
    const caja = a.ingresos - a.gastos - a.egresos;
    return [moneda, { ingresos: p.ingresos, gastos: p.gastos, egresos: p.egresos, beneficio: p.ingresos - p.gastos, caja, sin_repartir: caja }];
  }));
}
async function validateMovimiento(env, b, previous) {
  const tipo = enumValue(b.tipo, TIPOS, 'tipo_invalido');
  const moneda = enumValue(b.moneda, MONEDAS, 'moneda_invalida');
  const importe = positivo(b.importe), dia = fecha(b.fecha), concepto_id = idConcepto(b.concepto_id);
  const concepto = await env.DB.prepare('SELECT * FROM fin_conceptos WHERE id = ?').bind(concepto_id).first();
  if (!concepto) fail('concepto_invalido');
  if (concepto.tipo !== tipo) fail('concepto_de_otro_tipo');
  // Una corrección de nota/importe conserva el concepto histórico desactivado.
  if (!concepto.activo && previous?.concepto_id !== concepto_id) fail('concepto_inactivo');
  if (b.reparto_id || b.beneficiario) fail('usar_repartos');
  const tenant_id = b.tenant_id || null;
  if (tenant_id && (tipo === 'egreso' || typeof tenant_id !== 'string')) fail('cliente_invalido');
  if (tenant_id && !await env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(tenant_id).first()) fail('cliente_invalido');
  return { tipo, moneda, importe, fecha: dia, concepto_id, nota: nota(b.nota), tenant_id };
}
function insertMovimiento(env, m, actor, now, repartoId = null, beneficiario = null) {
  return env.DB.prepare(`INSERT INTO fin_movimientos
    (id,tipo,concepto_id,fecha,moneda,importe,nota,tenant_id,beneficiario,reparto_id,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(m.id, m.tipo, m.concepto_id, m.fecha, m.moneda, m.importe, m.nota, m.tenant_id, beneficiario, repartoId, actor, now);
}
const logBorrado = (id, actor) => console.log(JSON.stringify({ level: 'warn', code: 'fin_borrado', id, actor }));

finanzas.get('/api/admin/finanzas/socios', async (c) => {
  const { env, scope, url } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const socios = (await env.DB.prepare(`SELECT s.email,s.nombre,s.activo,
    EXISTS(SELECT 1 FROM fin_movimientos m WHERE m.beneficiario=s.email) AS tiene_repartos
    FROM fin_socios s ${url.searchParams.get('todos') === '1' ? '' : 'WHERE s.activo=1'}
    ORDER BY s.activo DESC,s.nombre COLLATE NOCASE,s.email`).all()).results;
  return json({ socios }, 200, NO_STORE);
});
finanzas.post('/api/admin/finanzas/socios', async (c) => {
  const { env, scope, request, actor } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const b = await bodyOf(request), email = socioEmail(b.email), name = nombre(b.nombre);
  try {
    await env.DB.prepare('INSERT INTO fin_socios (email,nombre,created_by,created_at) VALUES (?,?,?,?)')
      .bind(email, name, actor, new Date().toISOString()).run();
  } catch (e) { writeError(e); }
  console.log(JSON.stringify({ level: 'info', code: 'fin_socio_alta', email, actor }));
  return json({ ok: true, email }, 201, NO_STORE);
});
finanzas.patch('/api/admin/finanzas/socios/:email', async (c) => {
  const { env, scope, request, actor } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const old = await socioByEmail(env, c.req.param('email')), b = await bodyOf(request);
  if (Object.keys(b).some((k) => !['email', 'nombre', 'activo'].includes(k))) fail('campo_no_editable');
  const email = b.email === undefined ? old.email : socioEmail(b.email);
  const name = b.nombre === undefined ? old.nombre : nombre(b.nombre);
  const activo = b.activo === undefined ? old.activo : b.activo;
  if (![0, 1].includes(activo)) fail('socio_invalido');
  try {
    // El correo identifica al beneficiario en el libro: corregirlo conserva TODOS
    // sus repartos y acumulados, sin cambiar importes ni partidas de caja.
    await env.DB.batch([
      env.DB.prepare('UPDATE fin_socios SET email=?,nombre=?,activo=? WHERE email=?').bind(email, name, activo, old.email),
      env.DB.prepare('UPDATE fin_movimientos SET beneficiario=? WHERE beneficiario=?').bind(email, old.email),
    ]);
  } catch (e) { writeError(e); }
  if (email !== old.email || name !== old.nombre || activo !== old.activo) {
    console.log(JSON.stringify({ level: 'info', code: 'fin_socio_cambio', actor,
      de: { email: old.email, nombre: old.nombre, activo: old.activo }, a: { email, nombre: name, activo } }));
  }
  return json({ ok: true, email }, 200, NO_STORE);
});
finanzas.delete('/api/admin/finanzas/socios/:email', async (c) => {
  const { env, scope, actor } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const old = await socioByEmail(env, c.req.param('email'));
  const result = await env.DB.batch([
    env.DB.prepare('UPDATE fin_socios SET activo=0 WHERE email=?').bind(old.email),
    env.DB.prepare('DELETE FROM fin_socios WHERE email=? AND NOT EXISTS (SELECT 1 FROM fin_movimientos WHERE beneficiario=?)').bind(old.email, old.email),
    env.DB.prepare('SELECT email FROM fin_socios WHERE email=?').bind(old.email),
  ]);
  console.log(JSON.stringify({ level: 'warn', code: 'fin_socio_baja', email: old.email, actor }));
  return json({ ok: true, desactivado: result[2].results.length > 0 }, 200, NO_STORE);
});

finanzas.get('/api/admin/finanzas/conceptos', async (c) => {
  const { env, scope, url } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const rows = (await env.DB.prepare(`SELECT * FROM fin_conceptos ${url.searchParams.get('todos') === '1' ? '' : 'WHERE activo = 1'} ORDER BY position, id`).all()).results;
  return json({ conceptos: Object.fromEntries(TIPOS.map((tipo) => [tipo, rows.filter((r) => r.tipo === tipo)])) }, 200, NO_STORE);
});
finanzas.post('/api/admin/finanzas/conceptos', async (c) => {
  const { env, scope, request, actor } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const b = await bodyOf(request), tipo = enumValue(b.tipo, TIPOS, 'tipo_invalido'), name = nombre(b.nombre);
  try {
    const row = await env.DB.prepare(`INSERT INTO fin_conceptos (tipo,nombre,position,created_by,created_at)
      VALUES (?,?,(SELECT COALESCE(MAX(position),-1)+1 FROM fin_conceptos WHERE tipo=?),?,?) RETURNING id`)
      .bind(tipo, name, tipo, actor, new Date().toISOString()).first();
    return json({ ok: true, id: row.id }, 201, NO_STORE);
  } catch (e) { writeError(e); }
});
finanzas.patch('/api/admin/finanzas/conceptos/:id', async (c) => {
  const { env, scope, request } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const old = await exists(env, 'fin_conceptos', c.req.param('id')), b = await bodyOf(request);
  const name = b.nombre === undefined ? old.nombre : nombre(b.nombre);
  const activo = b.activo === undefined ? old.activo : b.activo;
  const position = b.position === undefined ? old.position : b.position;
  if (![0, 1].includes(activo) || !Number.isSafeInteger(position) || position < 0) fail('concepto_invalido');
  // El concepto que firma los repartos se puede reordenar; renombrarlo o apagarlo
  // rompería el reparto siguiente, así que se cierra aquí y no en la interfaz.
  if (old.sistema && (name !== old.nombre || activo !== old.activo)) throw new HttpError(409, 'concepto_del_sistema');
  try {
    const statements = [];
    // Las flechas desplazan el intervalo en una transacción, sin posiciones empatadas.
    if (position < old.position) statements.push(env.DB.prepare('UPDATE fin_conceptos SET position=position+1 WHERE tipo=? AND id<>? AND position>=? AND position<?').bind(old.tipo, old.id, position, old.position));
    if (position > old.position) statements.push(env.DB.prepare('UPDATE fin_conceptos SET position=position-1 WHERE tipo=? AND id<>? AND position>? AND position<=?').bind(old.tipo, old.id, old.position, position));
    statements.push(env.DB.prepare('UPDATE fin_conceptos SET nombre=?, activo=?, position=? WHERE id=?').bind(name, activo, position, old.id));
    await env.DB.batch(statements);
  } catch (e) { writeError(e); }
  return json({ ok: true }, 200, NO_STORE);
});
finanzas.delete('/api/admin/finanzas/conceptos/:id', async (c) => {
  const { env, scope } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const old = await exists(env, 'fin_conceptos', c.req.param('id'));
  if (old.sistema) throw new HttpError(409, 'concepto_del_sistema');
  const result = await env.DB.prepare('DELETE FROM fin_conceptos WHERE id=? AND NOT EXISTS (SELECT 1 FROM fin_movimientos WHERE concepto_id=?)').bind(old.id, old.id).run();
  if (!result.meta.changes) throw new HttpError(409, 'concepto_en_uso');
  return json({ ok: true }, 200, NO_STORE);
});
finanzas.get('/api/admin/finanzas/movimientos', async (c) => {
  const { env, scope, url } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const f = filters(url), cursor = url.searchParams.get('cursor');
  if (cursor) {
    const parts = cursor.split('|');
    if (parts.length !== 3 || !fechaReal(parts[0])) fail('cursor_invalido');
    f.sql += ' AND (m.fecha, m.created_at, m.id) < (?, ?, ?)'; f.args.push(...parts);
  }
  const rows = (await env.DB.prepare(`${SELECT_MOV} WHERE ${f.sql}${ORDER} LIMIT 51`).bind(...f.args).all()).results;
  const more = rows.length > 50; if (more) rows.pop();
  const last = rows.at(-1);
  return json({ movimientos: rows, nextCursor: more ? `${last.fecha}|${last.created_at}|${last.id}` : null }, 200, NO_STORE);
});
finanzas.post('/api/admin/finanzas/movimientos', async (c) => {
  const { env, scope, request, actor } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const m = await validateMovimiento(env, await bodyOf(request)), id = crypto.randomUUID();
  await insertMovimiento(env, { ...m, id }, actor, new Date().toISOString()).run();
  return json({ ok: true, id }, 201, NO_STORE);
});
finanzas.patch('/api/admin/finanzas/movimientos/:id', async (c) => {
  const { env, scope, request } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const old = await exists(env, 'fin_movimientos', c.req.param('id'));
  if (old.reparto_id) throw new HttpError(409, 'linea_de_reparto');
  const b = await bodyOf(request);
  if (Object.keys(b).some((k) => !['importe', 'fecha', 'concepto_id', 'nota'].includes(k))) fail('campo_no_editable');
  const m = await validateMovimiento(env, { ...old, ...b }, old);
  const result = await env.DB.prepare('UPDATE fin_movimientos SET importe=?, fecha=?, concepto_id=?, nota=? WHERE id=?').bind(m.importe, m.fecha, m.concepto_id, m.nota, old.id).run();
  if (!result.meta.changes) throw new HttpError(404, 'not_found');
  return json({ ok: true }, 200, NO_STORE);
});
finanzas.delete('/api/admin/finanzas/movimientos/:id', async (c) => {
  const { env, scope, actor } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const old = await exists(env, 'fin_movimientos', c.req.param('id'));
  if (old.reparto_id) throw new HttpError(409, 'linea_de_reparto');
  await env.DB.prepare('DELETE FROM fin_movimientos WHERE id=?').bind(old.id).run();
  logBorrado(old.id, actor);
  return json({ ok: true }, 200, NO_STORE);
});
finanzas.get('/api/admin/finanzas/resumen', async (c) => {
  const { env, scope, url } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const f = filters(url);
  const [p, a, desglose, repartido] = await env.DB.batch([
    env.DB.prepare(`${TOTALS} WHERE ${f.sql} GROUP BY moneda`).bind(...f.args),
    env.DB.prepare(`${TOTALS} GROUP BY moneda`),
    env.DB.prepare(`SELECT m.concepto_id,c.nombre,m.tipo,m.moneda,SUM(m.importe) AS importe FROM fin_movimientos m
      JOIN fin_conceptos c ON c.id=m.concepto_id WHERE ${f.sql} GROUP BY m.concepto_id,m.moneda ORDER BY m.tipo,c.position,c.id`).bind(...f.args),
    env.DB.prepare(REPARTIDO),
  ]);
  return json({ monedas: cuentas(p.results, a.results), conceptos: desglose.results, repartido: repartido.results }, 200, NO_STORE);
});
finanzas.get('/api/admin/finanzas/repartos', async (c) => {
  const { env, scope } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const [cabeceras, lineas, repartido, nombres] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM fin_repartos ORDER BY fecha DESC, created_at DESC, id DESC'),
    env.DB.prepare(`SELECT m.*,COALESCE(s.nombre,m.beneficiario) AS nombre FROM fin_movimientos m LEFT JOIN fin_socios s ON lower(s.email)=m.beneficiario WHERE m.reparto_id IS NOT NULL ORDER BY m.created_at,m.id`),
    env.DB.prepare(REPARTIDO), env.DB.prepare('SELECT email,nombre FROM fin_socios WHERE activo=1'),
  ]);
  const socios = nombres.results;
  return json({ socios, repartido: repartido.results, repartos: cabeceras.results.map((r) => ({ ...r, lineas: lineas.results.filter((m) => m.reparto_id === r.id) })) }, 200, NO_STORE);
});
finanzas.post('/api/admin/finanzas/repartos', async (c) => {
  const { env, scope, request, actor } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const b = await bodyOf(request), dia = fecha(b.fecha), moneda = enumValue(b.moneda, MONEDAS, 'moneda_invalida'), note = nota(b.nota);
  if (!Array.isArray(b.lineas) || !b.lineas.length || b.lineas.length > 50) fail('lineas_invalidas');
  const socios = (await env.DB.prepare('SELECT email FROM fin_socios WHERE activo=1').all()).results.map((s) => s.email);
  const lineas = b.lineas.map((l) => {
    if (!l || typeof l !== 'object') fail('lineas_invalidas');
    const beneficiario = String(l.beneficiario || '').trim().toLowerCase();
    if (!socios.includes(beneficiario)) fail('beneficiario_desconocido');
    if (l.moneda !== undefined && l.moneda !== moneda) fail('moneda_invalida');
    return { beneficiario, importe: positivo(l.importe) };
  });
  if (!Number.isSafeInteger(lineas.reduce((sum, l) => sum + l.importe, 0))) fail('importe_invalido');
  // Por la MARCA del catálogo, nunca por su nombre: el nombre lo edita una persona.
  const concepto = await env.DB.prepare("SELECT id FROM fin_conceptos WHERE tipo='egreso' AND sistema=1").first();
  if (!concepto) throw new HttpError(409, 'concepto_reparto_no_disponible');
  const id = crypto.randomUUID(), now = new Date().toISOString();
  let result;
  try { result = await env.DB.batch([
    env.DB.prepare('INSERT INTO fin_repartos (id,fecha,moneda,nota,created_by,created_at) VALUES (?,?,?,?,?,?)').bind(id, dia, moneda, note, actor, now),
    ...lineas.map((l) => insertMovimiento(env, { id: crypto.randomUUID(), tipo: 'egreso', concepto_id: concepto.id, fecha: dia, moneda, importe: l.importe, nota: note, tenant_id: null }, actor, now, id, l.beneficiario)),
    env.DB.prepare(`${TOTALS} GROUP BY moneda`),
  ]); } catch (e) { writeError(e); }
  const caja = cuentas([], result.at(-1).results)[moneda].caja;
  return json({ ok: true, id, caja, ...(caja < 0 ? { aviso: 'caja_negativa' } : {}) }, 201, NO_STORE);
});
finanzas.delete('/api/admin/finanzas/repartos/:id', async (c) => {
  const { env, scope, actor } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const old = await exists(env, 'fin_repartos', c.req.param('id'));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM fin_movimientos WHERE reparto_id=?').bind(old.id),
    env.DB.prepare('DELETE FROM fin_repartos WHERE id=?').bind(old.id),
  ]);
  logBorrado(old.id, actor);
  return json({ ok: true }, 200, NO_STORE);
});
finanzas.get('/api/admin/finanzas/export.csv', async (c) => {
  const { env, scope, url } = partesAdmin(c);
  if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');
  const f = filters(url);
  const rows = (await env.DB.prepare(`${SELECT_MOV} WHERE ${f.sql}${ORDER}`).bind(...f.args).all()).results;
  const keys = ['id', 'fecha', 'tipo', 'concepto_nombre', 'tenant_name', 'nota', 'moneda', 'importe', 'beneficiario', 'reparto_id', 'created_by', 'created_at'];
  // Importe legible en unidades monetarias; sin separador de miles, EUR con dos decimales.
  const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => csvCell(k === 'importe' ? r.moneda === 'EUR' ? (r.importe / 100).toFixed(2) : String(r.importe) : r[k])).join(','))].join('\r\n');
  return new Response('\uFEFF' + csv, { headers: { ...NO_STORE, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="velai-finanzas.csv"' } });
});
