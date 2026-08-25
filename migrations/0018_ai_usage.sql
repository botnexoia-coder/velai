-- Consumo de IA por cliente. Hasta ahora solo existía como línea de log (sin cliente y
-- sin historial): imposible saber cuánto cuesta cada cliente ni si uno se desmadra.
-- Una fila por (cliente, día, modelo) con UPSERT: no crece sin control.
CREATE TABLE IF NOT EXISTS ai_usage (
  tenant_id TEXT NOT NULL,          -- '' para las llamadas sin cliente (previsualización del panel)
  day TEXT NOT NULL,                -- YYYY-MM-DD en UTC, igual que el cupo diario
  model TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  in_tokens INTEGER NOT NULL DEFAULT 0,
  out_tokens INTEGER NOT NULL DEFAULT 0,
  cache_w_tokens INTEGER NOT NULL DEFAULT 0,
  cache_r_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, day, model)
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_day ON ai_usage (day);
