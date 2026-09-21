// Catálogo puro. null en la API representa un límite sin tope (JSON no admite Infinity).
export const MODULOS = ['calendario', 'citas', 'eventos'];
export const PLANES = {
  esencial: { nombre: 'Esencial', canales: 1, modulos: [] },
  profesional: { nombre: 'Profesional', canales: Infinity, modulos: ['calendario'] },
  empresa: { nombre: 'Empresa', canales: Infinity, modulos: ['calendario'] },
};
export const esPlan = (plan) => typeof plan === 'string' && Object.prototype.hasOwnProperty.call(PLANES, plan);

export function modulosDe(plan, excepciones = []) {
  if (!esPlan(plan)) return [];
  const activos = new Set(PLANES[plan].modulos);
  for (const { modulo, estado } of excepciones) {
    if (!MODULOS.includes(modulo)) continue;
    if (estado === 'on') activos.add(modulo);
    if (estado === 'off') activos.delete(modulo);
  }
  return MODULOS.filter((m) => activos.has(m));
}

export function canalesOcupados(tenant, filas = []) {
  let origins = tenant.web_origins;
  if (typeof origins === 'string') { try { origins = JSON.parse(origins); } catch (_) { origins = []; } }
  const address = String(tenant.channel_address || '');
  const ocupados = new Set(filas.map((r) => r.kind).filter((k) => ['whatsapp', 'messenger', 'instagram'].includes(k)));
  for (const kind of ['whatsapp', 'messenger', 'instagram']) if (address.startsWith(`${kind}:`)) ocupados.add(kind);
  if (address.startsWith('web:') || (Array.isArray(origins) && origins.some((o) => typeof o === 'string' && o.trim()))) ocupados.add('web');
  return ['web', 'whatsapp', 'messenger', 'instagram'].filter((k) => ocupados.has(k));
}
