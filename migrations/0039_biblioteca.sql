ALTER TABLE tenants ADD COLUMN media_quota_bytes INTEGER CHECK(media_quota_bytes IS NULL OR media_quota_bytes >= 0);
ALTER TABLE tenants ADD COLUMN media_bytes_used INTEGER NOT NULL DEFAULT 0 CHECK(media_bytes_used >= 0);
ALTER TABLE tenants ADD COLUMN media_files_used INTEGER NOT NULL DEFAULT 0 CHECK(media_files_used >= 0);

CREATE TABLE tenant_media (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('image','pdf','audio','video')),
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  sha256 TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 300),
  channels TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  position INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,slug),
  UNIQUE(tenant_id,sha256)
);
CREATE INDEX tenant_media_catalog ON tenant_media(tenant_id,active,position,id);
CREATE INDEX tenant_media_trash ON tenant_media(deleted_at) WHERE deleted_at IS NOT NULL;

-- Las reservas sobreviven a un Worker interrumpido entre R2 y el INSERT.
-- Reconciliar nunca libera cuota de una subida en curso ni de un objeto huérfano.
CREATE TABLE tenant_media_uploads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  sha256 TEXT NOT NULL,
  quota_default INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,sha256)
);
CREATE INDEX tenant_media_uploads_age ON tenant_media_uploads(created_at);

-- UPDATE y comprobación comparten sentencia SQLite, sin depender de changes()
-- entre llamadas de D1. Si no cabe, se revierte también la fila de reserva.
CREATE TRIGGER tenant_media_reserve AFTER INSERT ON tenant_media_uploads
BEGIN
  UPDATE tenants SET media_bytes_used=media_bytes_used+NEW.bytes,
    media_files_used=media_files_used+1
    WHERE id=NEW.tenant_id AND media_bytes_used+NEW.bytes <= COALESCE(media_quota_bytes,NEW.quota_default);
  SELECT RAISE(ABORT,'quota_exceeded') WHERE changes()=0;
END;

ALTER TABLE conv_messages ADD COLUMN attachments_json TEXT;
