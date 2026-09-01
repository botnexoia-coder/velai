-- SPEC-CONFIRMACIONES, evolución del 2026-09-01: la antelación del recordatorio pasa
-- de «24 h única» a CURADA (12/24/48, default 24) y configurable por tenant SIN nueva
-- aprobación de Meta (es config del addon: tenants.reminder_hours ya existe).
--
-- 1) El kind del ledger deja de nombrar la antelación. Si el nombre llevara las horas
--    (previo_24h), cambiar la antelación de un tenant re-sembraría sus citas ya
--    recordadas (el NOT EXISTS del cron busca por kind) y saldría un SEGUNDO
--    recordatorio. Pasa a un slot GENÉRICO 'previo': uno por cita, tenga la antelación
--    que tenga. El CHECK de la 0030 fijaba los nombres viejos y SQLite no permite
--    editar un CHECK: reconstrucción copiar-renombrar (la tabla es de esta semana y
--    pequeña; el índice se recrea). Desplegar el worker DESPUÉS de aplicar esto:
--    el worker nuevo escribe kind='previo', que el CHECK viejo rechazaría.
CREATE TABLE appointment_reminders_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id TEXT NOT NULL REFERENCES appointments(id),
  kind TEXT NOT NULL DEFAULT 'previo',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  sent_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(appointment_id, kind)
);
INSERT INTO appointment_reminders_v2 (id, appointment_id, kind, status, attempts, next_attempt_at, last_error, sent_at, updated_at)
  SELECT id, appointment_id, 'previo', status, attempts, next_attempt_at, last_error, sent_at, updated_at
  FROM appointment_reminders;
DROP TABLE appointment_reminders;
ALTER TABLE appointment_reminders_v2 RENAME TO appointment_reminders;
CREATE INDEX appointment_reminders_retry_idx ON appointment_reminders(status, next_attempt_at);

-- 2) Lo ELEGIDO al crear una plantilla (pareja de botones curada del catálogo), como
--    JSON: para enseñarlo en el panel y para recrear la plantilla tras un rechazo.
--    NULL = creada sin opciones (los defaults del catálogo) — las filas existentes,
--    como la plantilla ya pendiente de dialogos, siguen válidas tal cual.
ALTER TABLE tenant_templates ADD COLUMN opciones TEXT;
