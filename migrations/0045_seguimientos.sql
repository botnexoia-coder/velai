-- Seguimiento automático por tenant. Desactivado por defecto: ningún cliente empieza
-- a escribir por su cuenta al aplicar la migración.
ALTER TABLE tenants ADD COLUMN followup_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN followup_delay_minutes INTEGER NOT NULL DEFAULT 180;
ALTER TABLE tenants ADD COLUMN followup_message TEXT;
ALTER TABLE tenants ADD COLUMN followup_enabled_at TEXT;

-- Una sola salida automática por conversación. attempts permite reintentar fallos de
-- proveedor sin duplicar un mensaje que sí salió.
ALTER TABLE conversations ADD COLUMN followup_sent_at TEXT;
ALTER TABLE conversations ADD COLUMN followup_attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_conversations_followup
  ON conversations (tenant_id, followup_sent_at, last_at);
