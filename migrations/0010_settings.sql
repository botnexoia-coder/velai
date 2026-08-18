-- Ajustes del worker editables desde el panel (SOLO admins raíz), cifrados con la KEK
-- (AAD 'setting:<key>'). Hoy: 'cf_api_token' (rotación del token de API de Cloudflare,
-- validado contra Cloudflare ANTES de guardarse; write-only, nunca se devuelve).
-- La KEK, ANTHROPIC_API_KEY y las credenciales maestras de Twilio NO viven aquí a
-- propósito: si el panel pudiera cambiarlas, una sesión de admin comprometida podría
-- sustituirlas — esas siguen como secrets del worker.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_enc TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
