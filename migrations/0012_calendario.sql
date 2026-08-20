-- SPEC-CALENDARIO fase 1 (solo Google; la columna provider ya admite microsoft
-- para la fase futura). Conexión de calendario por tenant (1:1): el refresh_token
-- va CIFRADO (AES-256-GCM, AAD 'calendar:<tenant_id>') — un ciphertext copiado a
-- otra fila no descifra. Sin PRAGMA (D1) y aditiva, como manda GUIA-WORKERS §2.
CREATE TABLE tenant_calendars (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  provider TEXT NOT NULL CHECK (provider IN ('google','microsoft')),
  refresh_token_enc TEXT NOT NULL,
  account_email TEXT,                        -- solo para "conectado como" en el panel
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  business_hours TEXT,                       -- JSON {"mon":[["09:00","14:00"],...]}; NULL = L-V 9-19
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','error','revoked')),
  last_error TEXT,
  connected_by TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Citas creadas por Vai: auditoría + panel. La fuente de verdad del hueco es el
-- calendario del cliente en Google; esta tabla registra lo que Vai hizo.
-- request_id UNIQUE = idempotencia: un reintento del bucle de tools no duplica.
CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  lead_id TEXT REFERENCES leads(id),         -- enlace cita↔lead (fase 3, columna lista)
  request_id TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,                     -- web | whatsapp | messenger
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  reason TEXT,
  starts_at TEXT NOT NULL,                   -- ISO UTC
  ends_at TEXT NOT NULL,
  timezone TEXT NOT NULL,                    -- la del negocio al agendar
  provider_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','error')),
  created_at TEXT NOT NULL
);
CREATE INDEX appointments_tenant_starts_idx ON appointments(tenant_id, starts_at DESC);
