-- Numeración anual correlativa por emisor y familia (F ordinaria, R rectificativa,
-- PR prueba). Aditiva: no toca g_facturas ni el libro. Un contador por (emisor,
-- familia, ejercicio) que solo avanza de uno en uno y únicamente dentro de la misma
-- transacción que inserta el documento numerado: sin MAX+1, sin huecos por reintento.
-- Las series reales F/R quedan preparadas pero NINGUNA ruta las consume: no hay
-- sistema de emisión integrado y el registro publicado sigue siendo interno.
CREATE TABLE g_factura_contadores (
  entidad_id TEXT NOT NULL REFERENCES g_entidades(id),
  familia TEXT NOT NULL CHECK(familia IN ('F','R','PR')),
  ejercicio INTEGER NOT NULL CHECK(typeof(ejercicio)='integer' AND ejercicio BETWEEN 2000 AND 9999),
  ultimo INTEGER NOT NULL CONSTRAINT g_factura_contador_tope CHECK(typeof(ultimo)='integer' AND ultimo BETWEEN 1 AND 999999),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entidad_id, familia, ejercicio)
);
-- El contador avanza exactamente en 1 y nunca cambia de clave ni se borra.
CREATE TRIGGER g_factura_contador_paso BEFORE UPDATE ON g_factura_contadores
WHEN NEW.ultimo<>OLD.ultimo+1 OR NEW.entidad_id<>OLD.entidad_id OR NEW.familia<>OLD.familia
 OR NEW.ejercicio<>OLD.ejercicio OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'contador_salto'); END;
CREATE TRIGGER g_factura_contador_no_delete BEFORE DELETE ON g_factura_contadores
BEGIN SELECT RAISE(ABORT,'contador_inmutable'); END;

-- Facturas de prueba: muestra numerada PR de un borrador de venta, con copia congelada
-- (entidad + factura en esa versión) para reimprimir. Sin validez fiscal: no entran en
-- el libro interno, no mueven caja y no consumen las series F/R.
CREATE TABLE g_facturas_prueba (
  id TEXT PRIMARY KEY,
  factura_id TEXT NOT NULL REFERENCES g_facturas(id),
  entidad_id TEXT NOT NULL REFERENCES g_entidades(id),
  familia TEXT NOT NULL DEFAULT 'PR' CHECK(familia='PR'),
  ejercicio INTEGER NOT NULL CHECK(typeof(ejercicio)='integer' AND ejercicio BETWEEN 2000 AND 9999),
  secuencia INTEGER NOT NULL CONSTRAINT g_factura_prueba_tope CHECK(typeof(secuencia)='integer' AND secuencia BETWEEN 1 AND 999999),
  serie TEXT NOT NULL,
  numero TEXT NOT NULL,
  fecha_emision TEXT NOT NULL,
  version_origen INTEGER NOT NULL CHECK(version_origen>0),
  validez_fiscal TEXT NOT NULL DEFAULT 'ninguna' CHECK(validez_fiscal='ninguna'),
  snapshot_json TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(entidad_id,familia,ejercicio,secuencia),
  UNIQUE(entidad_id,numero),
  CHECK(serie=familia||'-'||ejercicio AND numero=serie||'-'||printf('%03d',secuencia))
);
CREATE INDEX g_facturas_prueba_origen ON g_facturas_prueba(factura_id,created_at);
-- El número insertado es exactamente el último reservado por el contador en esta misma
-- transacción: ni inventado ni ya asignado.
CREATE TRIGGER g_factura_prueba_contador BEFORE INSERT ON g_facturas_prueba
WHEN NOT EXISTS (SELECT 1 FROM g_factura_contadores c WHERE c.entidad_id=NEW.entidad_id
 AND c.familia=NEW.familia AND c.ejercicio=NEW.ejercicio AND c.ultimo=NEW.secuencia)
BEGIN SELECT RAISE(ABORT,'secuencia_sin_contador'); END;
-- Solo un borrador de venta, en la versión que vio quien pidió la prueba. Si cambió
-- entre la lectura y la escritura, aborta la transacción entera (contador incluido).
CREATE TRIGGER g_factura_prueba_origen BEFORE INSERT ON g_facturas_prueba
WHEN NOT EXISTS (SELECT 1 FROM g_facturas f WHERE f.id=NEW.factura_id AND f.entidad_id=NEW.entidad_id
 AND f.version=NEW.version_origen AND f.origen='borrador' AND f.tipo='emitida')
BEGIN SELECT RAISE(ABORT,'version_desactualizada'); END;
CREATE TRIGGER g_factura_prueba_no_update BEFORE UPDATE ON g_facturas_prueba
BEGIN SELECT RAISE(ABORT,'prueba_inmutable'); END;
CREATE TRIGGER g_factura_prueba_no_delete BEFORE DELETE ON g_facturas_prueba
BEGIN SELECT RAISE(ABORT,'prueba_inmutable'); END;
