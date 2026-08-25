-- Conversaciones atendidas por día y canal. Hace falta para la TASA DE CAPTURA: sin el
-- denominador (cuántas conversaciones hubo) el número de leads no dice si el bot
-- convierte bien o si simplemente entró poca gente. Una fila por (cliente, día, canal)
-- con UPSERT y una sola escritura por conversación NUEVA — no por mensaje.
CREATE TABLE IF NOT EXISTS conv_daily (
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  channel TEXT NOT NULL,          -- 'web' | 'whatsapp' (el canal por donde entró)
  convs INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, day, channel)
);
CREATE INDEX IF NOT EXISTS idx_conv_daily_day ON conv_daily (day);
