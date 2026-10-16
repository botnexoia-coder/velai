-- Proveedores/clientes externos. Separados de las entidades emisoras propias.
CREATE TABLE g_terceros (
 id TEXT PRIMARY KEY,
 nombre TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(nombre)) BETWEEN 1 AND 160),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
-- Conservar los nombres existentes sin reescribir facturas ni compras históricas.
INSERT OR IGNORE INTO g_terceros(id,nombre,created_by,created_at)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
 MIN(trim(nombre)), 'migration:0057', strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT proveedor AS nombre FROM g_compras UNION ALL SELECT contraparte_nombre AS nombre FROM g_facturas)
WHERE nombre IS NOT NULL AND length(trim(nombre))>0
GROUP BY trim(nombre) COLLATE NOCASE;
