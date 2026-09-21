-- Aditiva. Se aplica por el ledger de migraciones del CD.
ALTER TABLE tenants ADD COLUMN plan TEXT NOT NULL DEFAULT 'profesional'
  CHECK(plan IN ('esencial','profesional','empresa'));
ALTER TABLE tenants ADD COLUMN plan_revision TEXT NOT NULL DEFAULT '';

CREATE TABLE tenant_modulos (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  modulo TEXT NOT NULL CHECK(modulo IN ('calendario','citas','eventos')),
  estado TEXT NOT NULL CHECK(estado IN ('on','off')),
  otorgado_por TEXT NOT NULL,
  otorgado_en TEXT NOT NULL,
  PRIMARY KEY (tenant_id, modulo)
);

-- Misma definición que canalesOcupados: tipos únicos, Telegram no cuenta.
UPDATE tenants AS t SET plan = CASE WHEN
  (channel_address LIKE 'web:%' OR EXISTS (
    SELECT 1 FROM json_each(CASE WHEN json_valid(web_origins) THEN
      CASE WHEN json_type(web_origins)='array' THEN web_origins ELSE '[]' END ELSE '[]' END)
    WHERE type='text' AND trim(value)<>''))
  + (channel_address LIKE 'whatsapp:%' OR EXISTS (SELECT 1 FROM tenant_channels c WHERE c.tenant_id=t.id AND c.kind='whatsapp'))
  + (channel_address LIKE 'messenger:%' OR EXISTS (SELECT 1 FROM tenant_channels c WHERE c.tenant_id=t.id AND c.kind='messenger'))
  + (channel_address LIKE 'instagram:%' OR EXISTS (SELECT 1 FROM tenant_channels c WHERE c.tenant_id=t.id AND c.kind='instagram'))
  > 1 THEN 'profesional' ELSE 'esencial' END;

-- Los tenants de la propia casa (sembrados en 0002) no se someten al tarifario
-- comercial: el bot público de Velai atiende por WhatsApp, Messenger y la web, y un
-- cupo de Esencial le bloquearía añadir un canal con un 409 en el momento menos
-- oportuno. Empresa = sin tope y con el catálogo entero.
UPDATE tenants SET plan = 'empresa' WHERE slug IN ('velai','velai-messenger');

-- Conservar también el acceso al histórico de citas y las confirmaciones sin conexión.
INSERT INTO tenant_modulos
SELECT id,'calendario','on','migracion:0043',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM tenants t
WHERE EXISTS (SELECT 1 FROM tenant_calendars c WHERE c.tenant_id=t.id)
   OR EXISTS (SELECT 1 FROM appointments a WHERE a.tenant_id=t.id) OR reminders_enabled=1;
INSERT INTO tenant_modulos
SELECT id,'citas','on','migracion:0043',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM tenants t
WHERE reminders_enabled=1 OR EXISTS (SELECT 1 FROM tenant_calendars c WHERE c.tenant_id=t.id AND c.booking_enabled=1);
INSERT INTO tenant_modulos
SELECT id,'eventos','on','migracion:0043',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM tenants t
WHERE EXISTS (SELECT 1 FROM tenant_events e WHERE e.tenant_id=t.id)
   OR EXISTS (SELECT 1 FROM event_reservations e WHERE e.tenant_id=t.id)
   OR EXISTS (SELECT 1 FROM contact_consents c WHERE c.tenant_id=t.id);
