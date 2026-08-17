-- Historial de cambios de configuración de tenants. Cada guardado deja el estado
-- ANTERIOR, con quién y cuándo; el rollback del prompt es un clic en el panel.
CREATE TABLE tenant_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_email TEXT NOT NULL,
  field TEXT NOT NULL,            -- 'system_prompt' | 'config'
  previous_value TEXT,            -- el valor que se reemplazó
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX tenant_versions_idx ON tenant_versions(tenant_id, created_at DESC);
