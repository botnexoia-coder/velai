CREATE TABLE tenant_services (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  minutes INTEGER NOT NULL CHECK(minutes BETWEEN 10 AND 240),
  mode TEXT NOT NULL DEFAULT 'presencial' CHECK(mode IN ('presencial','video','telefono')),
  location TEXT,
  buffer_min INTEGER NOT NULL DEFAULT 0 CHECK(buffer_min BETWEEN 0 AND 120),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, slug)
);
ALTER TABLE appointments ADD COLUMN service_id TEXT;
