// Hechos de revisión persistidos; fechas efectivas calculadas en la zona de negocio.
export const CATEGORIAS_DOCUMENTALES = ['permiso_circulacion', 'ficha_tecnica', 'itv', 'seguro', 'mantenimiento', 'multa', 'gps', 'compraventa', 'otros', 'foto'];
export const CARPETAS_DOCUMENTALES = {
  permiso_circulacion: 'circulacion',
  ficha_tecnica: 'circulacion',
  itv: 'circulacion',
  seguro: 'seguros',
  mantenimiento: 'mantenimiento',
  multa: 'multas',
  gps: 'gps',
  compraventa: 'compraventa',
  otros: 'otros',
  foto: 'otros'
};
const CLASES_ANTIGUAS = {
  permiso_circulacion: 'permiso_circulacion',
  ficha_tecnica: 'ficha_tecnica',
  itv: 'itv',
  seguro: 'seguro',
  mantenimiento: 'mantenimiento',
  multa: 'multa',
  gps: 'gps',
  compraventa: 'compraventa',
  contrato_compra: 'compraventa',
  contrato_venta: 'compraventa',
  foto: 'foto'
};
export function hoyMadrid(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}
export function datosExpediente(row, today = hoyMadrid()) {
  const categoria_documental = row.categoria_documental || CLASES_ANTIGUAS[row.clase] || 'otros';
  const estado_revision = row.estado_revision || 'pendiente';
  const estado_efectivo = estado_revision === 'sustituido' ? 'sustituido' : row.vence && row.vence < today ? 'caducado' : row.fecha_inicio && row.fecha_inicio > today ? 'programado' : estado_revision;
  return {
    categoria_documental,
    carpeta: CARPETAS_DOCUMENTALES[categoria_documental],
    metadata_version: row.metadata_version || 1,
    estado_revision,
    estado_efectivo,
    revisado_por: row.revisado_por || null,
    revisado_at: row.revisado_at || null,
    fecha_inicio: row.fecha_inicio || null,
    nota: row.nota || null,
    kilometros: row.kilometros ?? null
  };
}
export const normalizarMatricula = s => String(s || '').toUpperCase().replace(/[\s-]/g, '');
