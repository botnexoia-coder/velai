ALTER TABLE tenant_calendars ADD COLUMN booking_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_calendars ADD COLUMN min_notice_min INTEGER NOT NULL DEFAULT 120;
ALTER TABLE tenant_calendars ADD COLUMN max_days_ahead INTEGER NOT NULL DEFAULT 60;
ALTER TABLE tenant_calendars ADD COLUMN booking_note TEXT;
ALTER TABLE tenant_calendars ADD COLUMN booking_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE calendar_exceptions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  date TEXT NOT NULL,
  windows TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(tenant_id,date)
);
ALTER TABLE appointments ADD COLUMN customer_email TEXT;
ALTER TABLE appointments ADD COLUMN notes TEXT;
ALTER TABLE appointments ADD COLUMN manage_token TEXT;
ALTER TABLE appointments ADD COLUMN rescheduled_from TEXT;
ALTER TABLE appointments ADD COLUMN buffer_min INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX appointments_manage_token ON appointments(manage_token) WHERE manage_token IS NOT NULL;
CREATE INDEX appointments_phone_future ON appointments(tenant_id,customer_phone,status,starts_at);

-- KV is only a cache. One conditional D1 write claims the WHOLE occupied interval.
-- A hold expires; an in-flight provider write does NOT expire: a timeout must never
-- silently release a slot whose Google event may already exist. Retry uses the
-- same provider event id and the same claim. No PII in cache keys.
CREATE TABLE booking_claims (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  service_id TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  busy_until TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'hold' CHECK(state IN ('hold','booking','booked')),
  request_id TEXT UNIQUE,
  phone_key TEXT,
  appointment_id TEXT,
  rescheduled_from TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX booking_claims_ranges ON booking_claims(tenant_id,starts_at,busy_until);
CREATE INDEX booking_claims_phone ON booking_claims(tenant_id,phone_key,state);

-- Strict, atomic public rate limits; outages fail closed rather than opening writes.
CREATE TABLE booking_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE booking_notifications (
  appointment_id TEXT PRIMARY KEY REFERENCES appointments(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
