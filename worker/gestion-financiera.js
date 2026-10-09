// Administración financiera: reglas puras (calendario, importes, fechas, nombres de
// archivo) y ayudas de persistencia compartidas por worker/routes/gestion.js y por el
// futuro módulo fiscal. Sin red y sin estado de módulo: todo recibe env/DB.
import { HttpError, UUID_RE } from './app.js';
import { detectMedia } from './biblioteca.js';

export const NEGOCIOS = ['velai', 'coches', 'dialogos', 'comun'];
export const MONEDAS = ['EUR', 'COP'];
export const TIPOS_ENTIDAD = ['autonomo', 'sociedad', 'promotores'];
export const ESTADOS_ENTIDAD = ['pendiente', 'activa'];
export const ESTADOS_COMPRA = ['prevista', 'comprometida', 'comprada', 'cancelada'];
export const TIPOS_DOCUMENTO = ['prestamo', 'compra', 'factura'];
export const PAGADORES = ['cuenta', 'socio'];
// Solo EUR en los préstamos iniciales (contrato): la cuenta del préstamo debe ser EUR.
export const MONEDAS_PRESTAMO = ['EUR'];
export const DOC_MAX_BYTES = 10 * 1024 * 1024;
// PDF/JPEG/PNG/WebP, decididos por bytes: ni el nombre ni el Content-Type del cliente.
export const DOC_FORMATOS = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// Claves estables de fin_conceptos (migración 0050) que firman cada partida de gestión.
export const CLAVES_CONCEPTO = ['g_financiacion', 'g_capital', 'g_financiero', 'g_compra', 'g_reembolso_socio'];
// Tope de importes: céntimos EUR / pesos COP. Mantiene saldo × tin_bp dentro de los
// enteros seguros de JS en el cálculo de intereses.
export const IMPORTE_MAX = 10 ** 13;
export const PRINCIPAL_MAX = 10 ** 11;
export const TIN_BP_MAX = 10000;

export const fail = (code, status = 400) => { throw new HttpError(status, code); };

// ── Validación de entrada (todas lanzan HttpError 400 con código estable) ────
export const esUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
export function uuid(v, code = 'id_invalido') { if (!esUuid(v)) fail(code); return v.toLowerCase(); }
export const uuidOpcional = (v, code) => v == null ? null : uuid(v, code);

export const esFechaCivil = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export const hoyMasUno = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
// Fecha civil verificada (sin 31 de abril ni 29 de febrero inexistente). Sirve para
// previsiones: puede ser futura.
export function fechaCivil(v, code = 'fecha_invalida') {
  if (!esFechaCivil(v) || v < '2000-01-01' || v > '2100-12-31') fail(code);
  return v;
}
// Fecha de un hecho real (abono, pago, compra): nunca más allá de mañana.
export function fechaReal(v, code = 'fecha_invalida') {
  fechaCivil(v, code);
  if (v > hoyMasUno()) fail(code);
  return v;
}
export const fechaOpcional = (v, fn = fechaCivil, code) => v == null ? null : fn(v, code);

export function entero(v, { min = 0, max = IMPORTE_MAX, code = 'importe_invalido' } = {}) {
  if (!Number.isSafeInteger(v) || v < min || v > max) fail(code);
  return v;
}
export const importePositivo = (v, code = 'importe_invalido') => entero(v, { min: 1, code });
export const importeNoNegativo = (v, code = 'importe_invalido') => entero(v, { min: 0, code });
export const enumValor = (v, values, code) => values.includes(v) ? v : fail(code);
export function texto(v, max, code, { opcional = false } = {}) {
  if (v == null || v === '') { if (opcional) return null; fail(code); }
  if (typeof v !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029]/.test(v)) fail(code);
  const t = v.trim();
  if (!t) { if (opcional) return null; fail(code); }
  if (t.length > max) fail(code);
  return t;
}
export function versionDe(b) {
  if (!Number.isSafeInteger(b?.version) || b.version < 1) fail('version_requerida');
  return b.version;
}
export function soloCampos(b, permitidos, code = 'campo_no_editable') {
  const extra = Object.keys(b).find((k) => !permitidos.includes(k));
  if (extra) fail(code);
}
export function socioEmail(v, code = 'socio_invalido') {
  if (typeof v !== 'string' || v.trim().length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) fail(code);
  return v.trim().toLowerCase();
}
// Condiciones del préstamo tal como figuran en el contrato/oferta: concepto, valor y
// de dónde sale. Texto libre acotado; no se interpreta.
export function condiciones(v) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 50) fail('condiciones_invalidas');
  return v.map((c) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) fail('condiciones_invalidas');
    soloCampos(c, ['concepto', 'valor', 'fuente'], 'condiciones_invalidas');
    return { concepto: texto(c.concepto, 120, 'condiciones_invalidas'), valor: texto(c.valor, 300, 'condiciones_invalidas'), fuente: texto(c.fuente, 200, 'condiciones_invalidas', { opcional: true }) };
  });
}

// ── Préstamos: calendario previsto y resumen real ────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
// Mes calendario con clamping al último día (31 ene → 28/29 feb). No se ajustan
// festivos ni fines de semana: eso solo lo sabe el banco.
export function sumarMeses(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (m - 1) + n;
  const yy = y + Math.floor(total / 12), mm = ((total % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${pad(mm + 1)}-${pad(Math.min(d, ultimo))}`;
}
// Interés del mes en céntimos: saldo × TIN / 12, con TIN en basis points (1200 = 12 %).
// Entero exacto hasta el redondeo final; sin coma flotante acumulada entre meses.
export function interesMensual(saldo, tinBp) { return Math.round((saldo * tinBp) / 120000); }

// Cuota francesa con la cuota que fijó el banco; la última se recalcula para cerrar el
// principal. Previsto (calendario) y real (pagos) se cruzan por número de cuota.
export function calendario(p, pagos = []) {
  const filas = [];
  let saldo = p.principal;
  for (let k = 1; k <= p.meses; k++) {
    const interes = saldo > 0 ? interesMensual(saldo, p.tin_bp) : 0;
    let capital = Math.min(saldo, Math.max(0, p.cuota - interes));
    if (k === p.meses) capital = saldo;
    saldo -= capital;
    filas.push({ numero: k, fecha: p.primer_vencimiento ? sumarMeses(p.primer_vencimiento, k - 1) : null,
      cuota: capital + interes, interes, capital, saldo, pagado: 0, capital_pagado: 0, estado: 'pendiente' });
  }
  for (const pago of pagos) {
    if (pago.clase !== 'pago' || pago.estado !== 'activo' || !pago.numero) continue;
    const fila = filas[pago.numero - 1];
    if (!fila) continue;
    fila.pagado += pago.capital + pago.interes;
    fila.capital_pagado += pago.capital;
  }
  for (const f of filas) f.estado = f.cuota === 0 ? 'sin_cuota' : f.pagado >= f.cuota ? 'pagada' : f.pagado > 0 ? 'parcial' : 'pendiente';
  return filas;
}
// La cuota tiene que amortizar algo desde el primer mes y no liquidar antes del
// último: fuera de ese rango el calendario no describe el préstamo que se firmó.
export function validarCalendario(p) {
  if (p.cuota <= interesMensual(p.principal, p.tin_bp)) fail('cuota_insuficiente');
  const filas = calendario(p);
  if (p.meses > 1 && filas[p.meses - 1].capital <= 0) fail('cuota_excesiva');
  return filas;
}

export function prestamoItem(row) {
  if (!row) return null;
  let cond = [];
  try { cond = JSON.parse(row.condiciones || '[]'); } catch (_) { cond = []; }
  return { id: row.id, nombre: row.nombre, cuenta_id: row.cuenta_id, principal: row.principal, apertura: row.apertura, cuota: row.cuota,
    tin_bp: row.tin_bp, tae_bp: row.tae_bp, meses: row.meses, reserva_cuotas: row.reserva_cuotas, fecha_abono: row.fecha_abono,
    primer_vencimiento: row.primer_vencimiento, condiciones: cond, version: row.version };
}
export function pagoItem(row) {
  if (!row) return null;
  const { created_by, ...rest } = row;
  return { ...rest, registrado_por: created_by };
}
// Resumen de un préstamo: lo previsto (calendario) separado de lo real (pagos).
// Sin desembolso confirmado no hay dinero en la cuenta: desembolsado = 0 y la reserva
// no existe todavía; el principal pendiente es el contractual.
export function resumenPrestamo(prestamo, pagos) {
  const activos = pagos.filter((p) => p.clase === 'pago' && p.estado === 'activo');
  const capital_pagado = activos.reduce((s, p) => s + p.capital, 0);
  const pagado_cuotas = activos.reduce((s, p) => s + p.capital + p.interes, 0);
  const comisiones = activos.reduce((s, p) => s + p.comision, 0);
  const desembolsado = prestamo.desembolsado || 0;
  const reserva_inicial = prestamo.reserva_cuotas * prestamo.cuota;
  const reserva_restante = desembolsado ? Math.max(0, reserva_inicial - pagado_cuotas) : 0;
  const principal_pendiente = prestamo.principal - capital_pagado;
  return {
    prestamo: prestamoItem(prestamo),
    estado: !desembolsado ? 'pendiente_desembolso' : principal_pendiente <= 0 ? 'liquidado' : 'vigente',
    calendario: calendario(prestamo, pagos),
    pagos: pagos.map(pagoItem),
    reserva_inicial, reserva_restante, principal_pendiente, pagado_cuotas, comisiones, desembolsado,
  };
}

// ── Compras ──────────────────────────────────────────────────────────────────
export function compraItem(row) {
  if (!row) return null;
  const pagado = row.pagado || 0;
  const referencia = row.real ?? row.estimado;
  const pendiente = row.estado === 'cancelada' ? 0 : Math.max(0, referencia - pagado);
  return { id: row.id, concepto: row.concepto, negocio: row.negocio, entidad_id: row.entidad_id, prestamo_id: row.prestamo_id, moneda: row.moneda,
    estimado: row.estimado, real: row.real, estado: row.estado, comprador: row.comprador, proveedor: row.proveedor, fecha_prevista: row.fecha_prevista,
    fecha_compra: row.fecha_compra, categoria: row.categoria, nota: row.nota, version: row.version, pagado, pendiente, documentos_count: row.documentos_count || 0 };
}
export const SELECT_COMPRA = `SELECT c.*,
  COALESCE((SELECT SUM(p.importe) FROM g_pagos p WHERE p.objeto_tipo='compra' AND p.objeto_id=c.id AND p.clase='pago' AND p.estado='activo'),0) AS pagado,
  (SELECT COUNT(*) FROM g_documentos d WHERE d.tipo='compra' AND d.objeto_id=c.id) AS documentos_count
  FROM g_compras c`;

// ── Documentos privados ──────────────────────────────────────────────────────
export function detectarDocumento(bytes) {
  const f = detectMedia(bytes);
  return f && DOC_FORMATOS[f.mime] ? { mime: f.mime, ext: DOC_FORMATOS[f.mime] } : null;
}
// Nombre apto para Content-Disposition y para el panel: ASCII, sin rutas ni control,
// y SIEMPRE con la extensión del formato detectado (nunca la que diga el cliente).
export function nombreSeguro(nombre, ext) {
  let base = String(nombre || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
  if (!base) base = 'documento';
  return `${base}.${ext}`;
}
export const DOC_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
export function documentoItem(row) {
  if (!row) return null;
  const { key, ...rest } = row;
  return rest;
}
export const sha256Hex = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) => x.toString(16).padStart(2, '0')).join('');

export async function tablaExiste(env, nombre) {
  const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(nombre).first();
  return Boolean(row);
}
// ¿Existe el objeto al que se adjunta? Las facturas viven en el módulo fiscal (tabla
// g_facturas, migración posterior): si aún no existe la tabla, el objeto no existe.
export async function objetoExiste(env, tipo, id) {
  if (tipo === 'prestamo') return Boolean(await env.DB.prepare('SELECT id FROM g_prestamos WHERE id=?').bind(id).first());
  if (tipo === 'compra') return Boolean(await env.DB.prepare('SELECT id FROM g_compras WHERE id=?').bind(id).first());
  if (tipo === 'factura') {
    if (!await tablaExiste(env, 'g_facturas')) return false;
    return Boolean(await env.DB.prepare('SELECT id FROM g_facturas WHERE id=?').bind(id).first());
  }
  return false;
}
// Para el módulo fiscal: estado del adjunto de una factura sin acoplar su esquema.
// {estado:'not_found'} si no hay tabla o fila; 'sin_adjunto' / 'adjunta' con el recuento.
export async function verificarAdjuntoFactura(env, facturaId) {
  if (!esUuid(facturaId) || !await objetoExiste(env, 'factura', facturaId.toLowerCase())) return { estado: 'not_found', documentos: 0 };
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM g_documentos WHERE tipo='factura' AND objeto_id=?").bind(facturaId.toLowerCase()).first();
  const n = row?.n || 0;
  return { estado: n ? 'adjunta' : 'sin_adjunto', documentos: n };
}

// ── Persistencia compartida: conceptos, caja, auditoría e idempotencia ───────
export async function conceptosGestion(env) {
  const rows = (await env.DB.prepare('SELECT id,clave FROM fin_conceptos WHERE clave IS NOT NULL').all()).results;
  const map = Object.fromEntries(rows.map((r) => [r.clave, r.id]));
  if (CLAVES_CONCEPTO.some((k) => !map[k])) throw new HttpError(409, 'concepto_gestion_no_disponible');
  return map;
}
// Una partida del libro único. Las de gestión llevan origen y por eso son inmutables
// (trigger 0050); signo -1 solo para reversos.
export function partidaCaja(env, m, actor, now) {
  return env.DB.prepare(`INSERT INTO fin_movimientos
    (id,tipo,concepto_id,fecha,moneda,importe,nota,tenant_id,beneficiario,reparto_id,created_by,created_at,naturaleza,signo,origen_tipo,origen_id,cuenta_id,entidad_id)
    VALUES (?,?,?,?,?,?,?,NULL,NULL,NULL,?,?,?,?,?,?,?,?)`)
    .bind(m.id || crypto.randomUUID(), m.tipo, m.concepto_id, m.fecha, m.moneda, m.importe, m.nota ?? null, actor, now,
      m.naturaleza, m.signo ?? 1, m.origen_tipo, m.origen_id, m.cuenta_id ?? null, m.entidad_id ?? null);
}
// La auditoría sigue inmediatamente al UPDATE en el mismo batch; changes() evita
// registrar un PATCH rechazado incluso si otro ya dejó la versión siguiente.
export const versionAplicada = () => ({ sql: 'SELECT 1 WHERE changes()>0', args: [] });
// El trigger exige avanzar exactamente una versión. Si otra operación ganó, el
// UPDATE aborta el batch entero: pagos, caja, auditoría e idempotencia incluidos.
export const reclamarVersion = (env, tabla, row, now) => env.DB.prepare(`UPDATE ${tabla} SET version=?, updated_at=? WHERE id=?`).bind(row.version + 1, now, row.id);
export function errorEscrituraGestion(e) {
  for (const code of ['version_conflicto', 'cuenta_en_uso', 'entidad_con_historico_fiscal', 'concepto_del_sistema']) {
    if (e.message.includes(code)) throw new HttpError(409, code);
  }
  for (const code of ['moneda_distinta', 'entidad_cuenta_distinta', 'cuenta_invalida', 'concepto_de_gestion']) {
    if (e.message.includes(code)) throw new HttpError(400, code);
  }
  throw e;
}
export function auditoria(env, { actor, accion, objeto_tipo, objeto_id, detalle = null, now, si = null }) {
  const valores = [now, actor, accion, objeto_tipo, objeto_id, detalle == null ? null : JSON.stringify(detalle)];
  if (!si) return env.DB.prepare('INSERT INTO g_auditoria (fecha,actor,accion,objeto_tipo,objeto_id,detalle) VALUES (?,?,?,?,?,?)').bind(...valores);
  return env.DB.prepare(`INSERT INTO g_auditoria (fecha,actor,accion,objeto_tipo,objeto_id,detalle) SELECT ?,?,?,?,?,? WHERE EXISTS (${si.sql})`).bind(...valores, ...si.args);
}
const ordenar = (v) => Array.isArray(v) ? v.map(ordenar) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])])) : v;
export const huella = (obj) => sha256Hex(new TextEncoder().encode(JSON.stringify(ordenar(obj))));

// Escribe UNA vez por id de cliente. `sentencias()` devuelve la transacción (sin la fila
// de idempotencia, que se añade aquí). Repetición idéntica → {repetida:true}; misma
// clave con otro cuerpo u otra ruta → 409. Dos peticiones simultáneas: la segunda
// falla en el PRIMARY KEY, relee y decide igual.
export async function idempotente(env, { id, ruta, huella: h, actor, now, resultado_id = id }, sentencias) {
  const comprobar = (previa) => { if (previa.ruta !== ruta || previa.huella !== h) throw new HttpError(409, 'idempotencia_conflicto'); };
  const previa = await env.DB.prepare('SELECT ruta,huella FROM g_idempotencia WHERE clave=?').bind(id).first();
  if (previa) { comprobar(previa); return { repetida: true }; }
  try {
    const operaciones = await sentencias();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO g_idempotencia (clave,ruta,huella,actor,created_at,resultado_id) VALUES (?,?,?,?,?,?)').bind(id, ruta, h, actor, now, resultado_id),
      ...operaciones,
    ]);
    return { repetida: false };
  } catch (e) {
    // También releer tras una validación mutable: otro intento con este mismo ID
    // pudo confirmar entre la lectura inicial y el cálculo del pendiente.
    const otra = await env.DB.prepare('SELECT ruta,huella FROM g_idempotencia WHERE clave=?').bind(id).first();
    if (otra) { comprobar(otra); return { repetida: true }; }
    errorEscrituraGestion(e);
  }
}
// Un reverso repite las partidas de la operación original con signo contrario.
export function partidasEspejo(env, filas, reversoId, actor, now, fecha) {
  return filas.map((f) => partidaCaja(env, { tipo: f.tipo, concepto_id: f.concepto_id, fecha, moneda: f.moneda, importe: f.importe, nota: f.nota,
    naturaleza: f.naturaleza, signo: -f.signo, origen_tipo: 'reverso', origen_id: reversoId, cuenta_id: f.cuenta_id, entidad_id: f.entidad_id }, actor, now));
}
