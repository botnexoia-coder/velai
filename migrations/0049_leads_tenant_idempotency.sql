-- Additive: preserve lead IDs and referencing tables; no table rebuild/cascade.
-- request_id stays the legacy global storage key; new inserts use an internal UUID.
-- tenant_request_id is the caller's scoped idempotency key. Apply before worker.
ALTER TABLE leads ADD COLUMN tenant_request_id TEXT;
UPDATE leads SET tenant_request_id = request_id;
CREATE UNIQUE INDEX leads_tenant_request_unique ON leads(tenant_id, tenant_request_id)
  WHERE tenant_id IS NOT NULL AND tenant_request_id IS NOT NULL;
CREATE UNIQUE INDEX leads_null_tenant_request_unique ON leads(tenant_request_id)
  WHERE tenant_id IS NULL AND tenant_request_id IS NOT NULL;
DROP INDEX leads_chat_phone_unique;
CREATE UNIQUE INDEX leads_tenant_chat_phone_unique ON leads(tenant_id, conversation_id, whatsapp_normalized)
  WHERE tenant_id IS NOT NULL AND conversation_id IS NOT NULL AND whatsapp_normalized IS NOT NULL;
CREATE UNIQUE INDEX leads_null_tenant_chat_phone_unique ON leads(conversation_id, whatsapp_normalized)
  WHERE tenant_id IS NULL AND conversation_id IS NOT NULL AND whatsapp_normalized IS NOT NULL;
-- The previous worker may still write during migration -> worker rollout. Map its
-- legacy key too, so the new worker can find those writes without creating copies.
CREATE TRIGGER leads_legacy_request_key AFTER INSERT ON leads
WHEN NEW.tenant_request_id IS NULL
BEGIN
  UPDATE leads SET tenant_request_id = NEW.request_id WHERE id = NEW.id;
END;
