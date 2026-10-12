// Copia del admin para el equipo: el transporte y los bindings impiden escrituras.
import { HttpError } from './app.js';

export const MOBILE_API = '/api/admin/mobile-preview/';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const READ_ROUTES = [
  /^(me|stats|events|tenants|plantillas|planes|escalations|inbox|alerts|availability|appointments|solicitudes|channels|admins|permisos|ai-usage|ai-balance)$/,
  new RegExp(`^(leads|conversations)(/(export\\.csv|${UUID}))?$`, 'i'),
  new RegExp(`^tenants/${UUID}(/(versions|users|plan|channels|whatsapp|telegram|calendar|editorial|booking|services|booking/qr-logo|media|provision))?$`, 'i'),
  /^finanzas\/(socios|conceptos|movimientos|resumen|repartos|export\.csv)$/,
  /^gestion\/(catalogos|entidades|cuentas|prestamos|compras|resumen|documentos|facturas|fiscal\/resumen|fiscal\/export\.csv|cierres)$/,
  new RegExp(`^gestion/(prestamos/${UUID}(/resumen)?|compras/${UUID}(/pagos)?|documentos/${UUID}/archivo|facturas/${UUID})$`, 'i'),
];

export function previewTarget(path, method, scope) {
  if (!path.startsWith(MOBILE_API)) return null;
  if (scope.role !== 'velai') throw new HttpError(403, 'not_authorized');
  if (method !== 'GET') throw new HttpError(405, 'mobile_preview_read_only');
  const suffix = path.slice(MOBILE_API.length);
  if (!suffix || suffix.includes('..') || suffix.startsWith('/') || suffix.startsWith('mobile-preview/')) {
    throw new HttpError(404, 'not_found');
  }
  if (!READ_ROUTES.some(route => route.test(suffix))) throw new HttpError(403, 'mobile_preview_unavailable');
  return '/api/admin/' + suffix;
}

export function readOnlyEnv(env) {
  const originals = new WeakMap();
  function statement(sql, args = []) {
    // Solo SELECT de los handlers existentes; no exec, run, DDL ni múltiples sentencias.
    const query = String(sql).trim();
    if (!/^SELECT\b/i.test(query) || query.replace(/;\s*$/, '').includes(';')) {
      throw new HttpError(405, 'mobile_preview_read_only');
    }
    const native = env.DB.prepare(sql).bind(...args);
    const safe = {
      bind: (...values) => statement(sql, values),
      all: (...values) => native.all(...values),
      first: (...values) => native.first(...values),
      raw: (...values) => native.raw(...values),
      run: () => { throw new HttpError(405, 'mobile_preview_read_only'); },
    };
    originals.set(safe, native);
    return safe;
  }
  const blocked = () => { throw new HttpError(405, 'mobile_preview_read_only'); };
  const storage = (binding) => binding ? new Proxy(binding, {
    get(target, key) {
      if (['put', 'delete', 'createMultipartUpload', 'resumeMultipartUpload'].includes(String(key))) return blocked;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) : binding;
  return {
    ...env,
    MOBILE_PREVIEW_READ_ONLY: true,
    DB: {
      prepare: statement,
      batch: (items) => env.DB.batch(items.map((item) => {
        const native = originals.get(item);
        if (!native) return blocked();
        return native;
      })),
      exec: blocked,
    },
    KV: storage(env.KV),
    MEDIA: storage(env.MEDIA),
    FINANCE_DOCS: storage(env.FINANCE_DOCS),
  };
}
