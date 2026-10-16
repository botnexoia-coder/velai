import { HttpError } from './app.js';
// Se conservan las identidades fiscales históricas; las nuevas referencias deben
// salir del catálogo. No se confunden proveedores con entidades emisoras propias.
export async function empresaDeCatalogo(db, nombre) {
 if (!nombre) return null;
 const row = await db.prepare('SELECT nombre FROM g_terceros WHERE nombre=? COLLATE NOCASE').bind(nombre.trim()).first();
 if (!row) throw new HttpError(400,'empresa_desconocida');
 return row.nombre;
}
