-- Autoagenda en STAGING. Datos inventados, como manda seed-staging.sql:
-- aquí NO se copian datos reales de clientes.
--
--   npx wrangler@4 d1 execute vai-leads-staging --remote --env staging --file seed/seed-staging-autoagenda.sql
--
-- Enciende la página de reservas del tenant demo-staging y le da tres servicios. La fila
-- de tenant_calendars lleva un refresh token de PRUEBA: la página se sirve y se ve, pero
-- consultar huecos exige una conexión real de Google (GOOGLE_OAUTH_CLIENT_ID en staging).
INSERT OR IGNORE INTO tenant_calendars
  (tenant_id, provider, refresh_token_enc, account_email, calendar_id, timezone, slot_minutes,
   status, connected_by, connected_at, updated_at)
SELECT id, 'google', 'staging-placeholder', 'demo@example.com', 'primary', 'Europe/Madrid', 30,
       'connected', 'seed', '2026-09-15T00:00:00.000Z', '2026-09-15T00:00:00.000Z'
  FROM tenants WHERE slug = 'demo-staging';

UPDATE tenant_calendars
   SET booking_enabled = 1, min_notice_min = 120, max_days_ahead = 60,
       booking_note = 'Reserva de prueba en staging',
       business_hours = '{"mon":[["09:00","14:00"],["16:00","20:00"]],"tue":[["09:00","14:00"],["16:00","20:00"]],"wed":[["09:00","14:00"],["16:00","20:00"]],"thu":[["09:00","14:00"],["16:00","20:00"]],"fri":[["09:00","14:00"]]}'
 WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'demo-staging');

INSERT OR IGNORE INTO tenant_services
  (id, tenant_id, slug, name, description, minutes, mode, location, buffer_min, active, position, created_at, updated_at)
SELECT 'b0000000-0000-4000-8000-00000000000' || v.n, t.id, v.slug, v.name, v.descripcion, v.minutos, v.modo, v.lugar,
       0, 1, v.orden, '2026-09-15T00:00:00.000Z', '2026-09-15T00:00:00.000Z'
  FROM tenants t
  JOIN (SELECT 1 AS n, 'presencial' AS slug, 'Consulta presencial' AS name, 'En nuestra oficina' AS descripcion, 30 AS minutos, 'presencial' AS modo, 'Calle de Prueba 1' AS lugar, 10 AS orden
        UNION ALL SELECT 2, 'video', 'Consulta por vídeo', 'Videollamada', 60, 'video', 'https://example.com/sala', 20
        UNION ALL SELECT 3, 'telefono', 'Llamada rápida', 'Te llamamos', 15, 'telefono', NULL, 30) v
 WHERE t.slug = 'demo-staging';
