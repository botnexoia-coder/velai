-- Idempotencia para formularios externos firmados. Un reintento de la web no puede
-- crear dos reservas ni duplicar la evidencia de consentimiento.
ALTER TABLE event_reservations ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX event_reservations_request_unique
  ON event_reservations(tenant_id, request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE contact_consents ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX contact_consents_request_unique
  ON contact_consents(tenant_id, request_id)
  WHERE request_id IS NOT NULL;
