-- One attribution per event/contact, not one per message or chat session.
CREATE TABLE event_code_attributions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES tenant_events(id) ON DELETE CASCADE,
  contact_key TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  original_code TEXT NOT NULL,
  code TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK(validation_status IN ('recognized','pending','approved','rejected')),
  attendees INTEGER CHECK(attendees IS NULL OR attendees BETWEEN 1 AND 999),
  reservation_id TEXT REFERENCES event_reservations(id) ON DELETE SET NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,event_id,contact_key)
);
CREATE INDEX event_codes_tenant_event ON event_code_attributions(tenant_id,event_id,code);
