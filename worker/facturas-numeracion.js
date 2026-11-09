// Numeración anual correlativa de documentos emitidos (migración 0062). Un contador por
// emisor, familia y ejercicio que se reserva y se consume en la MISMA transacción
// (D1.batch) que inserta el documento: sin MAX+1, sin lectura intermedia en JS y sin
// huecos por reintento, fallo o concurrencia (si la inserción falla, la reserva se
// revierte con ella). Familias: F (ordinaria) y R (rectificativa) quedan preparadas y
// probadas, pero ninguna ruta las consume hasta integrar un sistema de emisión; PR
// (prueba, sin validez fiscal) es la única activa. Sin red y sin estado de módulo.
import { HttpError } from './app.js';

export const FAMILIAS = ['F', 'R', 'PR'];
export const EJERCICIO_MIN = 2000, EJERCICIO_MAX = 9999, SECUENCIA_MAX = 999999;
const fail = (code, status = 400) => { throw new HttpError(status, code); };

// El ejercicio son los cuatro dígitos de la fecha civil tal como se escribió. Nunca
// Date/getFullYear: un 31/12 o un 01/01 cambiarían de año según la zona del runtime.
export function ejercicioDe(fecha) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) fail('fecha_invalida');
  const ejercicio = Number(fecha.slice(0, 4));
  if (ejercicio < EJERCICIO_MIN || ejercicio > EJERCICIO_MAX) fail('fecha_invalida');
  return ejercicio;
}
export const familiaDe = (v) => FAMILIAS.includes(v) ? v : fail('familia_invalida');
export const serieDe = (familia, ejercicio) => `${familiaDe(familia)}-${ejercicio}`;
// Tres dígitos mínimos (PR-2027-001); a partir de 1000 el número crece sin truncar.
export const numeroDe = (familia, ejercicio, secuencia) => `${serieDe(familia, ejercicio)}-${String(secuencia).padStart(3, '0')}`;
// El mismo formato calculado en SQL, para que el documento tome el número del contador
// dentro de la transacción (`c` = alias de g_factura_contadores).
export const SERIE_SQL = "c.familia||'-'||c.ejercicio";
export const NUMERO_SQL = `${SERIE_SQL}||'-'||printf('%03d',c.ultimo)`;

// Sentencia 1 del batch: crea el contador en 1 o lo avanza exactamente en 1. El trigger
// g_factura_contador_paso rechaza cualquier otro salto y el CHECK, el desbordamiento.
export function reservarNumero(db, { entidad_id, familia, ejercicio, now }) {
  return db.prepare(`INSERT INTO g_factura_contadores (entidad_id,familia,ejercicio,ultimo,created_at,updated_at) VALUES (?,?,?,1,?,?)
    ON CONFLICT(entidad_id,familia,ejercicio) DO UPDATE SET ultimo=ultimo+1, updated_at=excluded.updated_at`)
    .bind(entidad_id, familiaDe(familia), ejercicio, now, now);
}
// Sentencia 2: inserta el documento tomando entidad, familia, ejercicio, secuencia,
// serie y número del contador recién reservado. `columnas`/`valores` son el resto de la
// fila. Si esta inserción falla por cualquier motivo, D1 revierte también la reserva.
const IDENT = /^[a-z][a-z0-9_]*$/;
export function insertarNumerado(db, tabla, columnas, valores, { entidad_id, familia, ejercicio }) {
  if (!IDENT.test(tabla) || columnas.length !== valores.length || !columnas.every((c) => IDENT.test(c))) throw new Error('numeracion_sentencia_invalida');
  const propias = [...columnas, 'entidad_id', 'familia', 'ejercicio', 'secuencia', 'serie', 'numero'];
  return db.prepare(`INSERT INTO ${tabla} (${propias.join(',')})
    SELECT ${columnas.map(() => '?').concat(['c.entidad_id', 'c.familia', 'c.ejercicio', 'c.ultimo', SERIE_SQL, NUMERO_SQL]).join(',')}
    FROM g_factura_contadores c WHERE c.entidad_id=? AND c.familia=? AND c.ejercicio=?`)
    .bind(...valores, entidad_id, familiaDe(familia), ejercicio);
}
// Errores que SQLite lanza desde los triggers/CHECK de 0062, en códigos estables.
export function errorNumeracion(e) {
  const m = String(e?.message || '');
  if (m.includes('version_desactualizada')) throw new HttpError(409, 'version_desactualizada');
  if (m.includes('g_factura_contador_tope') || m.includes('g_factura_prueba_tope')) throw new HttpError(409, 'secuencia_agotada');
  for (const code of ['contador_salto', 'contador_inmutable', 'secuencia_sin_contador', 'prueba_inmutable']) if (m.includes(code)) throw new HttpError(409, code);
  throw e;
}
