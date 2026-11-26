-- Registro administrativo privado. No modifica tablas financieras existentes.
CREATE TABLE g_conductores (
 id TEXT PRIMARY KEY, nombre TEXT NOT NULL, telefono TEXT NOT NULL, email TEXT,
 estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo')),
 identidad_tipo TEXT CHECK (identidad_tipo IS NULL OR identidad_tipo IN ('dni','nie','pasaporte','otro')),
 identidad_numero TEXT, identidad_vence TEXT, carnet_numero TEXT, carnet_categorias TEXT, carnet_vence TEXT,
 permiso_trabajo_vence TEXT, contacto_emergencia_nombre TEXT, contacto_emergencia_telefono TEXT, nota TEXT,
 version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE g_conductor_documentos (
 id TEXT PRIMARY KEY, conductor_id TEXT NOT NULL REFERENCES g_conductores(id),
 clase TEXT NOT NULL CHECK (clase IN ('foto','identidad','carnet','permiso_trabajo','otros')),
 nombre TEXT NOT NULL, mime TEXT NOT NULL, ext TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, key TEXT NOT NULL UNIQUE,
 version INTEGER NOT NULL DEFAULT 1, metadata_version INTEGER NOT NULL DEFAULT 1,
 estado_revision TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_revision IN ('pendiente','revisado','sustituido')),
 revisado_por TEXT, revisado_at TEXT, ultima_revision_por TEXT, ultima_revision_at TEXT, fecha_inicio TEXT, vence TEXT, nota TEXT, retirado_at TEXT,
 autor TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(conductor_id,sha256)
);
CREATE INDEX idx_conductor_documentos ON g_conductor_documentos(conductor_id,created_at,id);
CREATE TABLE g_vehiculo_conductores (
 id TEXT PRIMARY KEY, vehiculo_id TEXT NOT NULL REFERENCES g_vehiculos(id), conductor_id TEXT NOT NULL REFERENCES g_conductores(id),
 desde TEXT NOT NULL CHECK (length(desde)=24 AND desde GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z' AND strftime('%Y-%m-%dT%H:%M:%fZ',desde,'+0 days') IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',desde,'+0 days')=desde),
 hasta TEXT CHECK (hasta IS NULL OR (length(hasta)=24 AND hasta GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z' AND strftime('%Y-%m-%dT%H:%M:%fZ',hasta,'+0 days') IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',hasta,'+0 days')=hasta AND hasta>desde)),
 nota TEXT, version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_vehiculo_conductores ON g_vehiculo_conductores(vehiculo_id,desde,hasta);
CREATE INDEX idx_conductor_asignaciones ON g_vehiculo_conductores(conductor_id,desde);
CREATE TRIGGER g_vehiculo_conductores_solape_insert BEFORE INSERT ON g_vehiculo_conductores
WHEN EXISTS (SELECT 1 FROM g_vehiculo_conductores o WHERE o.vehiculo_id=NEW.vehiculo_id AND NEW.desde<COALESCE(o.hasta,'9999') AND o.desde<COALESCE(NEW.hasta,'9999'))
BEGIN SELECT RAISE(ABORT,'asignacion_solapada'); END;
CREATE TRIGGER g_vehiculo_conductores_solape_update BEFORE UPDATE OF desde,hasta,vehiculo_id ON g_vehiculo_conductores
WHEN EXISTS (SELECT 1 FROM g_vehiculo_conductores o WHERE o.vehiculo_id=NEW.vehiculo_id AND o.id<>NEW.id AND NEW.desde<COALESCE(o.hasta,'9999') AND o.desde<COALESCE(NEW.hasta,'9999'))
BEGIN SELECT RAISE(ABORT,'asignacion_solapada'); END;

CREATE TRIGGER g_vehiculo_conductores_activo BEFORE INSERT ON g_vehiculo_conductores
WHEN NOT EXISTS (SELECT 1 FROM g_conductores WHERE id=NEW.conductor_id AND estado='activo')
BEGIN SELECT RAISE(ABORT,'conductor_inactivo'); END;
