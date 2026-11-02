-- Dedicated Alma bridge budget/idempotency ledger. No raw destination/code/token.
-- Never expire or reset reserved rows: an uncertain provider send must not repeat.
CREATE TABLE IF NOT EXISTS puente_whatsapp_dispatch (
  idempotency_key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  destination_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'accepted')),
  message_id TEXT
);
CREATE INDEX IF NOT EXISTS puente_dispatch_created ON puente_whatsapp_dispatch(created_at);
CREATE INDEX IF NOT EXISTS puente_dispatch_destination ON puente_whatsapp_dispatch(destination_hash, created_at);
-- Destination suppression precedes forwarding, so a pending BAJA cannot race a send.
CREATE TABLE IF NOT EXISTS puente_whatsapp_suppressions (
 destination_hash TEXT PRIMARY KEY,
 event_id TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
-- Encrypted event body: phone numbers never sit in a plaintext outbox.
CREATE TABLE IF NOT EXISTS puente_whatsapp_events (
 event_id TEXT PRIMARY KEY,
 message_id TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('optout','status')),
 destination_hash TEXT NOT NULL,
 payload_enc TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0,
 accepted_at INTEGER
);
CREATE INDEX IF NOT EXISTS puente_events_due ON puente_whatsapp_events(state,next_attempt_at,created_at);

CREATE INDEX IF NOT EXISTS puente_dispatch_message ON puente_whatsapp_dispatch(message_id,state,destination_hash);
CREATE INDEX IF NOT EXISTS puente_events_status_pending ON puente_whatsapp_events(event_type,state);
-- This fingerprint pins the stable pseudonym key. Credential rotations cannot
-- bypass pending optouts; changing this key requires an explicit data rekey.
CREATE TABLE IF NOT EXISTS puente_whatsapp_settings (
 setting_key TEXT PRIMARY KEY CHECK(setting_key='destination_hash_fingerprint'),
 fingerprint TEXT NOT NULL
);
