-- Los beneficiarios se gestionan en Finanzas → Socios. SOCIOS_EMAILS conserva
-- exclusivamente el permiso de acceso. No modificar la migración 0037 ya desplegada.
CREATE UNIQUE INDEX fin_socios_email_normalizado ON fin_socios(lower(email));

-- Quién dio de alta a cada beneficiario, igual que admin_users (0009): en un libro de
-- dinero, añadir a alguien que cobra no puede ser la única operación sin rastro.
-- Nullable a propósito: las filas anteriores entraron por migración, no por una persona.
ALTER TABLE fin_socios ADD COLUMN created_by TEXT;
ALTER TABLE fin_socios ADD COLUMN created_at TEXT;

-- Conserva los dos beneficiarios configurados al desplegar Finanzas y cualquier
-- correo del histórico. Los nombres que ya existen se mantienen.
INSERT OR IGNORE INTO fin_socios (email,nombre,created_by,created_at) VALUES
 ('botnexo.ia@gmail.com','botnexo.ia@gmail.com','migracion',datetime('now')),
 ('juanesgarciag@gmail.com','Juan Esteban García','migracion',datetime('now'));
INSERT OR IGNORE INTO fin_socios (email,nombre,created_by,created_at)
 SELECT DISTINCT lower(beneficiario),lower(beneficiario),'migracion',datetime('now')
 FROM fin_movimientos WHERE beneficiario IS NOT NULL;

CREATE INDEX fin_mov_beneficiario ON fin_movimientos(beneficiario);

-- Cierra la carrera entre la validación de un reparto y la baja de un socio.
-- El fallo revierte también la cabecera y las líneas anteriores del DB.batch.
CREATE TRIGGER fin_beneficiario_activo BEFORE INSERT ON fin_movimientos
WHEN NEW.beneficiario IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM fin_socios WHERE email=NEW.beneficiario AND activo=1
)
BEGIN
 SELECT RAISE(ABORT,'fin_beneficiario_inactivo');
END;
