-- Permisos finos del panel de Velai. El rol dice QUÉ eres (velai o cliente); esto dice
-- a qué áreas cerradas entras. Hoy solo existe una: Finanzas.
--
-- Por qué ESTO sí puede vivir en D1 cuando SOCIOS_EMAILS no podía (0037): la garantía
-- no la daba el almacén, la da quién escribe. Las tres rutas pasan por `soloRaiz`, y
-- raíz = ADMIN_EMAILS del entorno, que ninguna operación del panel puede tocar. Un
-- admin dado de alta desde el panel no puede concederse permisos ni a sí mismo ni a
-- nadie: sigue haciendo falta la cuenta raíz. SOCIOS_EMAILS se queda como la RAÍZ del
-- acceso a Finanzas — si esta tabla se vaciara entera, los correos del toml siguen
-- entrando, igual que ADMIN_EMAILS sobrevive a un `DELETE FROM admin_users`.
CREATE TABLE admin_permisos (
  email TEXT NOT NULL,
  permiso TEXT NOT NULL CHECK(permiso IN ('finanzas')),
  otorgado_por TEXT NOT NULL,
  otorgado_en TEXT NOT NULL,
  PRIMARY KEY (email, permiso)
);
-- Los correos entran ya en minúsculas; el índice lo garantiza aunque algún día entren
-- por otra puerta, como en fin_socios (0038).
CREATE UNIQUE INDEX admin_permisos_normalizado ON admin_permisos(lower(email), permiso);

-- Estiven ya tenía rol velai (`admin_users`); el 2026-09-19 se decide que además entre
-- a Finanzas. Entra POR AQUÍ y no por SOCIOS_EMAILS a propósito: en el toml sería
-- irrevocable sin un deploy, y el sentido de esta tabla es quitarlo con un clic.
INSERT INTO admin_permisos (email,permiso,otorgado_por,otorgado_en)
 VALUES ('estivenrojas09@gmail.com','finanzas','migracion',datetime('now'));
