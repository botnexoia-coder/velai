// Catálogo puro. null en la API representa un límite sin tope (JSON no admite Infinity).
export const MODULOS = ['calendario', 'citas', 'eventos'];
// `kinds` es la otra mitad del cupo, y no es lo mismo: Esencial admite UN canal y solo
// puede ser web o WhatsApp (Juan, 2026-09-22: «no vamos a manejar clientes solo
// messenger, las demás redes van en el plan pro»). Cantidad y tipo se validan aparte
// porque el arreglo es distinto —liberar un canal frente a subir de plan— y un error que
// no los distingue manda a la persona al sitio equivocado.
// `instagram` ya figura en Profesional aunque el canal no exista todavía: el día que se
// integre (SPEC-INSTAGRAM.md) no hace falta tocar los planes ni migrar nada.
export const CANALES = ['web', 'whatsapp', 'messenger', 'instagram'];
export const PLANES = {
  esencial: { nombre: 'Esencial', canales: 1, kinds: ['web', 'whatsapp'], modulos: [] },
  profesional: { nombre: 'Profesional', canales: Infinity, kinds: CANALES, modulos: ['calendario'] },
  empresa: { nombre: 'Empresa', canales: Infinity, kinds: CANALES, modulos: ['calendario'] },
};
// Las REDES sociales son los canales que se encienden y apagan por cliente desde «Plan y
// módulos» (tabla tenant_redes, migración 0055). Web y WhatsApp no lo son: el primario
// sigue siendo uno de los dos y los gobierna solo el cupo del plan.
export const REDES = CANALES.filter((k) => k !== 'web' && k !== 'whatsapp');
export const esPlan = (plan) => typeof plan === 'string' && Object.prototype.hasOwnProperty.call(PLANES, plan);
export function kindPermitido(plan, kind) {
  return esPlan(plan) && PLANES[plan].kinds.includes(kind);
}

// Mismo patrón que modulosDe: el plan pone el valor por defecto y la excepción `on`/`off`
// del cliente manda. Conceder una red a un Esencial es un add-on (no ocupa plaza).
export function redesDe(plan, excepciones = []) {
  if (!esPlan(plan)) return [];
  const activas = new Set(PLANES[plan].kinds.filter((k) => REDES.includes(k)));
  for (const { kind, estado } of excepciones) {
    if (!REDES.includes(kind)) continue;
    if (estado === 'on') activas.add(kind);
    if (estado === 'off') activas.delete(kind);
  }
  return REDES.filter((k) => activas.has(k));
}

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
  const redes = CANALES.filter((k) => k !== 'web');
  const ocupados = new Set(filas.map((r) => r.kind).filter((k) => redes.includes(k)));
  for (const kind of redes) if (address.startsWith(`${kind}:`)) ocupados.add(kind);
  if (address.startsWith('web:') || (Array.isArray(origins) && origins.some((o) => typeof o === 'string' && o.trim()))) ocupados.add('web');
  return CANALES.filter((k) => ocupados.has(k));
}
