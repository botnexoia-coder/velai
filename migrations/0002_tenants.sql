-- Un cliente = una fila. La clave de enrutado es channel_address: exactamente lo que
-- Twilio manda en `To` (whatsapp:+34... | messenger:<pageId>), así Messenger entra en
-- el mismo camino sin código extra.
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  channel_address TEXT NOT NULL UNIQUE,
  team_whatsapp TEXT,
  telegram_chat_id TEXT,
  lead_template_sid TEXT,
  twilio_from TEXT,
  system_prompt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX tenants_active_idx ON tenants(active, channel_address);

ALTER TABLE leads ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
CREATE INDEX leads_tenant_created_idx ON leads(tenant_id, created_at DESC);

-- Velai es el tenant 1: el camino que usamos a diario es el mismo que usarán los clientes.
-- El system_prompt se siembra después con seed/seed-velai.sql (el SYSTEM de vai-worker.js
-- sin el bloque de seguridad, que ahora es guardrail compartido en código). Mientras diga
-- 'PENDIENTE', systemFor() cae al SYSTEM de código: el bot nunca contesta vacío.
INSERT INTO tenants (id, slug, name, channel_address, team_whatsapp, lead_template_sid,
                     twilio_from, system_prompt, active, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'velai', 'Velai',
  'whatsapp:+15706160059',
  'whatsapp:+34642650553,whatsapp:+34655433803,whatsapp:+34602608940',
  'HX1b64454910a2b69179a7250114448c2b',
  'whatsapp:+15706160059',
  'PENDIENTE',
  1, '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z'
);

-- El canal Messenger de Velai (página de Facebook) tuvo conversaciones reales en mayo:
-- fila propia con el mismo prompt para que siga atendiendo sin interrupción.
INSERT INTO tenants (id, slug, name, channel_address, team_whatsapp, lead_template_sid,
                     twilio_from, system_prompt, active, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  'velai-messenger', 'Velai (Messenger)',
  'messenger:1077804955422697',
  'whatsapp:+34642650553,whatsapp:+34655433803,whatsapp:+34602608940',
  'HX1b64454910a2b69179a7250114448c2b',
  'whatsapp:+15706160059',
  'PENDIENTE',
  1, '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z'
);

-- Los leads que ya existen son todos de Velai.
UPDATE leads SET tenant_id = '00000000-0000-4000-8000-000000000001' WHERE tenant_id IS NULL;
