-- Quién entra al panel y con qué alcance. Access valida la identidad; esta tabla decide
-- qué puede ver. Un correo pertenece a un solo tenant. Los admins de Velai NO van aquí:
-- van en ADMIN_EMAILS (wrangler.toml) para que una fila borrada no pueda dejarlos fuera.
CREATE TABLE tenant_users (
  email TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  role TEXT NOT NULL DEFAULT 'cliente',
  created_at TEXT NOT NULL
);

-- Auditoría con rol: un cliente cambiando el estado de su lead tiene que poder
-- distinguirse de Velai haciéndolo.
ALTER TABLE lead_events ADD COLUMN actor_role TEXT;
ALTER TABLE lead_notes ADD COLUMN author_role TEXT;
