-- Canales de mensajería por cliente (N por tenant): hasta ahora tenants.channel_address
-- era EL canal (uno solo) y tener WhatsApp + Messenger exigía duplicar la fila entera
-- (así nació «Velai (Messenger)»). Esta tabla desacopla el enrutado de la fila: el
-- webhook entrante busca aquí primero y cae a tenants.channel_address si no hay fila.
-- Fase 1: la tabla refleja el canal primario (se sincroniza al escribir channel_address);
-- la web NO vive aquí — entra por slug y funciona siempre.
CREATE TABLE IF NOT EXISTS tenant_channels (
  address TEXT PRIMARY KEY,             -- 'whatsapp:+34…' | 'messenger:<page_id>'
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- 'whatsapp' | 'messenger'
  created_at TEXT NOT NULL
);
-- Un canal por tipo y cliente (fase 1): mantiene inequívoco el canal de RESPUESTA
-- saliente (twilio_from para whatsapp, page id para messenger).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_channels_tenant_kind ON tenant_channels (tenant_id, kind);

-- Backfill: los canales de mensajería que ya enrutan hoy entran a la tabla.
INSERT OR IGNORE INTO tenant_channels (address, tenant_id, kind, created_at)
  SELECT channel_address, id, substr(channel_address, 1, instr(channel_address, ':') - 1), datetime('now')
  FROM tenants
  WHERE channel_address LIKE 'whatsapp:%' OR channel_address LIKE 'messenger:%';
