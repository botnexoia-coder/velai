-- MVP de eventos para clientes como NAYA. Las tres tablas son multi-tenant y no
-- duplican el CRM de leads: guardan el evento, la intención de reserva y el historial
-- auditable del consentimiento para futuros avisos.
CREATE TABLE tenant_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  starts_at TEXT,
  venue TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','closed','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, slug)
);
CREATE INDEX tenant_events_active_idx ON tenant_events(tenant_id, status, starts_at);

CREATE TABLE event_reservations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES tenant_events(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('event_reservation','own_event')),
  name TEXT,
  contact TEXT,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX event_reservations_conversation_unique
  ON event_reservations(tenant_id, conversation_id, kind)
  WHERE conversation_id IS NOT NULL;
CREATE INDEX event_reservations_tenant_idx ON event_reservations(tenant_id, status, updated_at DESC);

-- Ledger append-only: el estado vigente es siempre la fila más reciente del contacto.
-- Así una BAJA no borra la evidencia del consentimiento anterior.
CREATE TABLE contact_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'future_events' CHECK(purpose IN ('future_events')),
  status TEXT NOT NULL CHECK(status IN ('accepted','declined','withdrawn')),
  channel TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  evidence TEXT NOT NULL,
  text_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX contact_consents_latest_idx ON contact_consents(tenant_id, contact, purpose, created_at DESC, id DESC);

-- Primer evento real. El módulo se activa por presencia de un evento activo; por eso
-- otros tenants no ven todavía la pestaña ni ejecutan captura adicional.
INSERT INTO tenant_events (id,tenant_id,slug,name,starts_at,venue,address,status,created_at,updated_at)
SELECT
  '7a000000-0000-4000-8000-000000000001',
  '653aaff5-8b17-4d71-a181-aa4b3c9f688d',
  'noche-solteros-2026-10-30',
  'Noche de Solteros y Solteras',
  '2026-10-30T23:00:00+02:00',
  'Co’legiale Sevilla',
  'Calle Geología 53, Polígono Torneo, Sevilla',
  'active',datetime('now'),datetime('now')
FROM tenants WHERE id='653aaff5-8b17-4d71-a181-aa4b3c9f688d';
