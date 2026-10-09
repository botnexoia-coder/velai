import { HttpError } from './app.js';

export const NEGOCIOS = ['velai', 'coches', 'dialogos', 'comun'];
export const MONEDAS = ['EUR', 'COP'];
export const fail = (code, status = 400) => { throw new HttpError(status, code); };
export const choice = (v, choices, field) => choices.includes(v) ? v : fail(`${field}_invalido`);
export const textField = (v, max = 500, required = false) => {
  if (v == null || v === '') return required ? fail('campo_obligatorio') : null;
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)) fail('texto_invalido');
  return v.trim();
};
export function uuid(v) {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) fail('id_invalido');
  return v.toLowerCase();
}
export function day(v, required = false) {
  if (v == null || v === '') return required ? fail('fecha_invalida') : null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v))
    || new Date(v).toISOString().slice(0, 10) !== v || v < '2000-01-01' || v > '2100-12-31') fail('fecha_invalida');
  return v;
}
export const integer = (v, min = 0, max = 1000000000000) => Number.isSafeInteger(v) && v >= min && v <= max ? v : fail('importe_invalido');
export const versionOf = (v) => integer(v, 1, Number.MAX_SAFE_INTEGER);
const safe = (v) => { const n = Number(v); if (!Number.isSafeInteger(n) || Math.abs(n) > 1000000000000) fail('importe_excesivo'); return n; };
export function roundedRatio(numerator, denominator) {
  if (denominator <= 0n) fail('division_invalida');
  const sign = numerator < 0n ? -1n : 1n, abs = numerator * sign;
  return safe(sign * ((abs + denominator / 2n) / denominator));
}
// Cantidades decimales entran como texto. Nunca float * 100 para unidades de dinero.
function quantity(v) {
  const s = v ?? '1';
  if (typeof s !== 'string' || !/^\d{1,7}(?:\.\d{1,4})?$/.test(s)) fail('cantidad_invalida');
  const [whole, fraction = ''] = s.split('.'), scaled = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
  if (scaled <= 0n) fail('cantidad_invalida');
  return { text: s, scaled };
}
export function calculateLines(lines, clase = 'ordinaria') {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) fail('lineas_invalidas');
  let base = 0n, iva = 0n, retencion = 0n;
  const calculated = lines.map((line) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) fail('lineas_invalidas');
    const descripcion = textField(line.descripcion, 500, true), q = quantity(line.cantidad);
    const precio_unitario = integer(line.precio_unitario, clase === 'rectificativa' ? -1000000000000 : 0);
    const descuento = integer(line.descuento ?? 0);
    const bruto = roundedRatio(BigInt(precio_unitario) * q.scaled, 10000n);
    if (descuento > Math.abs(bruto)) fail('descuento_invalido');
    const neto = bruto < 0 ? bruto + descuento : bruto - descuento;
    const iva_bp = line.iva_bp == null ? null : integer(line.iva_bp, 0, 10000);
    const retencion_bp = integer(line.retencion_bp ?? 0, 0, 10000);
    const cuota = iva_bp === null ? 0 : roundedRatio(BigInt(neto) * BigInt(iva_bp), 10000n);
    const retenido = roundedRatio(BigInt(neto) * BigInt(retencion_bp), 10000n);
    base += BigInt(neto); iva += BigInt(cuota); retencion += BigInt(retenido);
    return { descripcion, cantidad: q.text, precio_unitario, descuento, iva_bp, retencion_bp, base: neto, iva: cuota, retencion: retenido, total: neto + cuota - retenido };
  });
  return { lineas: calculated, base: safe(base), iva: safe(iva), retencion: safe(retencion), total: safe(base + iva - retencion) };
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function digest(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonical(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const FIELDS = ['entidad_id', 'negocio', 'tipo', 'estado', 'origen', 'clase', 'tratamiento_fiscal', 'nota_fiscal', 'contraparte_nif', 'contraparte_nombre', 'contraparte_direccion', 'numero', 'fecha_emision', 'fecha_operacion', 'fecha_recepcion', 'moneda', 'compra_id', 'proveedor_emision', 'nota', 'rectifica_id', 'lineas'];
export function normalizeInvoice(b) {
  const clase = choice(b.clase ?? 'ordinaria', ['ordinaria', 'rectificativa'], 'clase');
  const amounts = calculateLines(b.lineas, clase);
  const item = {
    entidad_id: textField(b.entidad_id, 100, true), negocio: choice(b.negocio, NEGOCIOS, 'negocio'),
    tipo: choice(b.tipo, ['recibida', 'emitida'], 'tipo'), estado: choice(b.estado ?? 'borrador', ['borrador', 'registrada'], 'estado'),
    origen: choice(b.origen ?? 'borrador', ['externa', 'borrador'], 'origen'), clase,
    tratamiento_fiscal: choice(b.tratamiento_fiscal ?? 'pendiente', ['pendiente', 'general', 'exento', 'no_sujeto', 'inversion', 'rebu'], 'tratamiento_fiscal'),
    nota_fiscal: textField(b.nota_fiscal, 2000),
    contraparte_nif: textField(b.contraparte_nif, 50), contraparte_nombre: textField(b.contraparte_nombre, 200),
    contraparte_direccion: textField(b.contraparte_direccion, 500), numero: textField(b.numero, 100),
    fecha_emision: day(b.fecha_emision), fecha_operacion: day(b.fecha_operacion), fecha_recepcion: day(b.fecha_recepcion),
    moneda: choice(b.moneda, MONEDAS, 'moneda'), compra_id: b.compra_id ? uuid(b.compra_id) : null,
    proveedor_emision: textField(b.proveedor_emision, 100), nota: textField(b.nota, 2000),
    rectifica_id: b.rectifica_id ? uuid(b.rectifica_id) : null,
    ...amounts,
  };
  if (item.estado === 'registrada' && (item.origen !== 'externa' || !item.numero || !item.fecha_emision)) fail('original_externo_incompleto');
  if (clase === 'ordinaria' && item.rectifica_id) fail('referencia_rectificativa_invalida');
  return item;
}
export function fromRow(row) {
  if (!row) return null;
  const { lineas_json, snapshot_json, request_hash, external_key, ...item } = row;
  return { ...item, lineas: JSON.parse(lineas_json), snapshot: snapshot_json ? JSON.parse(snapshot_json) : null };
}
export function scopeOf(input) {
  const s = { entidad_id: textField(input.entidad_id, 100, true), moneda: choice(input.moneda, MONEDAS, 'moneda'), desde: day(input.desde, true), hasta: day(input.hasta, true) };
  if (s.desde > s.hasta) fail('periodo_invalido');
  if ((Date.parse(s.hasta) - Date.parse(s.desde)) / 86400000 > 366) fail('periodo_demasiado_amplio');
  return s;
}
export function invoiceIssues(item) {
  const issues = [];
  if (item.estado !== 'validada') issues.push('pendiente_revision');
  if (item.origen !== 'externa') issues.push('borrador_sin_valor_fiscal');
  if (item.tratamiento_fiscal === 'pendiente') issues.push('tratamiento_fiscal_pendiente');
  if (['rebu', 'inversion'].includes(item.tratamiento_fiscal)) issues.push('regimen_requiere_asesoria');
  if (!item.originales_count) issues.push('original_pendiente');
  if (!item.fecha_operacion && !item.fecha_emision) issues.push('fecha_pendiente');
  return issues;
}
export function summarize(items, ambito) {
  const replaced = new Set(items.filter((x) => x.estado === 'validada' && x.correccion_de).map((x) => x.correccion_de));
  const current = items.filter((x) => !replaced.has(x.id));
  const valid = current.filter((x) => x.estado === 'validada');
  const totales = { base_emitida: 0, base_recibida: 0, iva_repercutido: 0, iva_soportado: 0, iva_deducible: 0, retenciones_emitidas: 0, retenciones_recibidas: 0, saldo_iva_provisional: 0 };
  for (const item of valid) {
    const emitida = item.tipo === 'emitida';
    totales[emitida ? 'base_emitida' : 'base_recibida'] = safe(BigInt(totales[emitida ? 'base_emitida' : 'base_recibida']) + BigInt(item.base));
    totales[emitida ? 'iva_repercutido' : 'iva_soportado'] = safe(BigInt(totales[emitida ? 'iva_repercutido' : 'iva_soportado']) + BigInt(item.iva));
    totales[emitida ? 'retenciones_emitidas' : 'retenciones_recibidas'] = safe(BigInt(totales[emitida ? 'retenciones_emitidas' : 'retenciones_recibidas']) + BigInt(item.retencion));
    if (!emitida) totales.iva_deducible = safe(BigInt(totales.iva_deducible) + BigInt(item.iva_deducible));
  }
  totales.saldo_iva_provisional = totales.iva_repercutido - totales.iva_deducible;
  return { ambito, totales, validadas: valid.length, pendientes: current.filter((x) => x.estado === 'registrada').length,
    borradores: current.filter((x) => x.estado === 'borrador').length, incidencias: current.flatMap((x) => invoiceIssues(x).map((codigo) => ({ id: x.id, codigo }))),
    alcance: 'Libro interno para asesoría. Proyección provisional, no declaración presentada ni formato AEAT validado.' };
}
export function csvSafe(value) {
  const str = String(value ?? ''), guarded = /^[\s\u0000-\u001f]*[=+\-@]/.test(str) || /^[\t\r\n]/.test(str) ? `'${str}` : str;
  return `"${guarded.replace(/"/g, '""')}"`;
}
export function moneyText(n, currency) {
  if (currency === 'COP') return String(n);
  const abs = Math.abs(n); return `${n < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
