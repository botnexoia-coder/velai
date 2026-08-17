-- D1 no admite PRAGMA foreign_keys (las FK se aplican siempre); no añadir PRAGMAs aquí.
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT,
  source TEXT NOT NULL,
  name TEXT,
  whatsapp TEXT,
  whatsapp_normalized TEXT,
  sector TEXT,
  messages_per_day TEXT,
  channel TEXT,
  current_responder TEXT,
  score INTEGER,
  note TEXT,
  need TEXT,
  context TEXT,
  attribution_json TEXT NOT NULL DEFAULT '{}',
  page_url TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','won','lost','spam')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE UNIQUE INDEX leads_chat_phone_unique
  ON leads(conversation_id, whatsapp_normalized)
  WHERE conversation_id IS NOT NULL AND whatsapp_normalized IS NOT NULL;
CREATE INDEX leads_created_at_idx ON leads(created_at DESC);
CREATE INDEX leads_status_updated_idx ON leads(status, updated_at DESC);
CREATE INDEX leads_expires_at_idx ON leads(expires_at);

CREATE TABLE lead_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('telegram','whatsapp')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  sent_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(lead_id, channel)
);
CREATE INDEX lead_notifications_retry_idx ON lead_notifications(status, next_attempt_at);

CREATE TABLE lead_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  author_email TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE lead_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor_email TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

