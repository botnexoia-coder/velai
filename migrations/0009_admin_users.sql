-- Admins de Velai gestionables desde el panel. Los ADMIN_EMAILS de wrangler.toml
-- siguen existiendo como admins RAÍZ (indestructibles: no viven en D1 y ninguna
-- operación del panel puede quitarlos — un error aquí nunca deja a Velai fuera de su
-- propio panel). resolveScope: env → admin_users → tenant_users. Un correo no puede
-- estar a la vez aquí y en tenant_users (cada endpoint valida el cruce).
CREATE TABLE admin_users (
  email TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
