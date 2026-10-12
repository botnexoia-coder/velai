-- Plan editorial separado de appointments y de cualquier proveedor externo.
CREATE TABLE tenant_editorial (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL CHECK(length(fecha)=10 AND fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  titulo TEXT NOT NULL CHECK(length(trim(titulo)) BETWEEN 1 AND 160),
  detalle TEXT CHECK(detalle IS NULL OR length(detalle)<=4000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(version)='integer' AND version>0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX tenant_editorial_fecha ON tenant_editorial(tenant_id,fecha,created_at,id);
