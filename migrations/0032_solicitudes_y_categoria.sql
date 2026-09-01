-- Dos piezas de Plantillas (decisión de Juan, 2026-09-01). Aditiva y sin PRAGMA.

-- 1) SOLICITUDES del cliente: el cliente pide un cambio desde su panel y VELAI lo
--    aprueba o rechaza — nada se aplica sin aprobación. Tabla GENÉRICA a propósito
--    (tipo + payload JSON): hoy solo 'plantilla_recordatorio' (pareja de botones y/o
--    antelación), mañana caben otras solicitudes de cliente sin migrar nada.
CREATE TABLE tenant_solicitudes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  tipo TEXT NOT NULL,
  payload TEXT NOT NULL,                     -- JSON validado CONTRA EL CATÁLOGO al crear
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by TEXT NOT NULL,                -- email del usuario del cliente
  resolved_by TEXT,                          -- email de Velai que resolvió
  nota TEXT,                                 -- obligatoria al rechazar: el cliente la ve
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
-- Máximo UNA solicitud pendiente por tenant y tipo: el UNIQUE parcial lo impone D1,
-- no una comprobación con carrera en el worker (el segundo POST simultáneo es 409).
CREATE UNIQUE INDEX tenant_solicitudes_pending_unique
  ON tenant_solicitudes(tenant_id, tipo) WHERE status = 'pending';
CREATE INDEX tenant_solicitudes_status_idx ON tenant_solicitudes(status, created_at DESC);

-- 2) Categoría REAL de cada plantilla, leída de Twilio (cazada de Juan: la de lead de
--    gogestion es Marketing en Twilio y el panel pintaba Utility — la del catálogo es
--    la INTENCIÓN al crear, no un hecho). La persiste el poll de aprobación, con
--    backfill autocurativo para las que ya están approved con categoría NULL.
ALTER TABLE tenant_templates ADD COLUMN categoria TEXT;
ALTER TABLE tenants ADD COLUMN lead_template_category TEXT;
