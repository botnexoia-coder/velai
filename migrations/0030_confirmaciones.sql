-- SPEC-CONFIRMACIONES F1 (decisión de Juan, 2026-09-01): recordatorio y confirmación
-- de citas por WhatsApp. Aditiva y sin PRAGMA, como manda GUIA-WORKERS §2.

-- Ledger de recordatorios, mismo molde que lead_notifications: sembrar → entregar con
-- reintentos y backoff. UNIQUE(appointment_id, kind) = idempotencia entre ticks del cron.
-- kind admite 'previo_2h' por si un día se amplía; la decisión vigente es 24 h única.
CREATE TABLE appointment_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id TEXT NOT NULL REFERENCES appointments(id),
  kind TEXT NOT NULL DEFAULT 'previo_24h' CHECK (kind IN ('previo_24h','previo_2h')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  sent_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(appointment_id, kind)
);
CREATE INDEX appointment_reminders_retry_idx ON appointment_reminders(status, next_attempt_at);

-- Qué hizo el cliente final con su cita: confirmó (botón o tool confirmar_cita) o la
-- canceló ('customer' | 'business'). El CHECK de status ya admite 'cancelled' (0012).
ALTER TABLE appointments ADD COLUMN customer_confirmed_at TEXT;
ALTER TABLE appointments ADD COLUMN cancelled_by TEXT;

-- Config del ADDON (no de la plantilla): interruptor solo-Velai y antelación en horas
-- (CSV por si un día se amplía — la decisión de Juan es 24 h única).
ALTER TABLE tenants ADD COLUMN reminders_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN reminder_hours TEXT NOT NULL DEFAULT '24';

-- Registro GENÉRICO de plantillas de WhatsApp por tenant (decisión de Juan, 2026-09-01):
-- una fila por kind con el sid de Twilio y el ciclo de aprobación de Meta
-- (pending/approved/rejected — el mismo que lead_template_status). El CUERPO de cada
-- plantilla NO vive aquí: es un contrato con el código que la envía y se declara en
-- worker/plantillas.js. PENDIENTE (paso aparte, fuera de esta entrega): la plantilla de
-- LEADS sigue en tenants.lead_template_sid/lead_template_status — unificarla aquí cuando
-- se quiera, migrando datos y lectores a la vez.
CREATE TABLE tenant_templates (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL,
  sid TEXT,
  status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, kind)
);
