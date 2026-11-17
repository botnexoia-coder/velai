-- 0063 · Control económico por vehículo y por viaje (negocio Coches).
-- Aditiva para compras, facturas y movimientos: columnas NULL, los registros
-- existentes siguen funcionando. Enlazar un vehículo o un viaje nunca crea pagos,
-- cobros ni movimientos de caja: solo relaciona registros ya existentes.
CREATE TABLE g_vehiculos (
  id TEXT PRIMARY KEY,
  referencia TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL DEFAULT 'coche' CHECK(tipo IN ('coche','camioneta','furgoneta','moto','otro')),
  marca TEXT,
  modelo TEXT,
  matricula TEXT,
  vin TEXT,
  moneda TEXT NOT NULL DEFAULT 'EUR' CHECK(moneda IN ('EUR','COP')),
  estado TEXT NOT NULL DEFAULT 'previsto' CHECK(estado IN ('previsto','comprado','preparado','anunciado','vendido','cancelado')),
  fecha_compra TEXT,
  fecha_venta TEXT,
  -- Precio de venta acordado (céntimos/pesos). Es un dato declarado: el cobro real
  -- se registra aparte como ingreso con vehiculo_id.
  precio_venta INTEGER CHECK(precio_venta IS NULL OR precio_venta >= 0),
  prestamo_id TEXT REFERENCES g_prestamos(id),
  entidad_id TEXT REFERENCES g_entidades(id),
  nota TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX g_vehiculos_estado ON g_vehiculos(estado, tipo, moneda);
CREATE TRIGGER g_vehiculos_version BEFORE UPDATE OF version ON g_vehiculos
WHEN NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT,'version_conflicto'); END;

-- Un viaje agrupa N vehículos. Los gastos conjuntos (sin vehículo) se imputan a
-- cada vehículo según `reparto`: a partes iguales o por pesos manuales (suma 10000 bp).
-- La imputación es un cálculo del resumen, nunca un movimiento.
CREATE TABLE g_viajes (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'EUR' CHECK(moneda IN ('EUR','COP')),
  fecha_inicio TEXT,
  fecha_fin TEXT,
  estado TEXT NOT NULL DEFAULT 'previsto' CHECK(estado IN ('previsto','en_curso','cerrado','cancelado')),
  reparto TEXT NOT NULL DEFAULT 'igual' CHECK(reparto IN ('igual','manual')),
  nota TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TRIGGER g_viajes_version BEFORE UPDATE OF version ON g_viajes
WHEN NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT,'version_conflicto'); END;
CREATE TABLE g_viaje_vehiculos (
  viaje_id TEXT NOT NULL REFERENCES g_viajes(id),
  vehiculo_id TEXT NOT NULL REFERENCES g_vehiculos(id),
  peso_bp INTEGER NOT NULL DEFAULT 0 CHECK(peso_bp BETWEEN 0 AND 10000),
  PRIMARY KEY (viaje_id, vehiculo_id)
);
CREATE INDEX g_viaje_vehiculos_vehiculo ON g_viaje_vehiculos(vehiculo_id);

ALTER TABLE g_compras ADD COLUMN vehiculo_id TEXT REFERENCES g_vehiculos(id);
ALTER TABLE g_compras ADD COLUMN viaje_id TEXT REFERENCES g_viajes(id);
CREATE INDEX g_compras_vehiculo ON g_compras(vehiculo_id, estado);
CREATE INDEX g_compras_viaje ON g_compras(viaje_id, estado);
ALTER TABLE g_facturas ADD COLUMN vehiculo_id TEXT REFERENCES g_vehiculos(id);
CREATE INDEX g_facturas_vehiculo ON g_facturas(vehiculo_id);
ALTER TABLE fin_movimientos ADD COLUMN vehiculo_id TEXT REFERENCES g_vehiculos(id);
CREATE INDEX fin_mov_vehiculo ON fin_movimientos(vehiculo_id, fecha);

-- Documentos: el CHECK de `tipo` se amplía con 'vehiculo' y 'viaje' y se añade la
-- fecha de vencimiento opcional (seguro, ITV, permisos). SQLite no modifica un
-- CHECK: se recrea la tabla CON EL MISMO NOMBRE, porque g_equipo_prestamos y
-- g_equipo_devoluciones (0060) la referencian por clave foránea y un RENAME
-- reescribiría esas referencias. Ids, claves R2 y versiones se conservan tal cual.
-- Las claves foráneas quedan diferidas hasta el final de la transacción.
PRAGMA defer_foreign_keys = true;
CREATE TABLE g_documentos_0063_copia AS SELECT * FROM g_documentos;
DROP INDEX IF EXISTS g_documentos_objeto;
DROP TABLE g_documentos;
CREATE TABLE g_documentos (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK(tipo IN ('prestamo','compra','factura','movimiento','vehiculo','viaje')),
  objeto_id TEXT NOT NULL,
  clase TEXT NOT NULL,
  nombre TEXT NOT NULL,
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  sha256 TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  autor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  vence TEXT,
  UNIQUE(tipo, objeto_id, sha256)
);
INSERT INTO g_documentos (id,tipo,objeto_id,clase,nombre,mime,ext,bytes,sha256,key,version,autor,created_at)
SELECT id,tipo,objeto_id,clase,nombre,mime,ext,bytes,sha256,key,version,autor,created_at
FROM g_documentos_0063_copia;
DROP TABLE g_documentos_0063_copia;
CREATE INDEX g_documentos_objeto ON g_documentos(tipo, objeto_id, created_at);
