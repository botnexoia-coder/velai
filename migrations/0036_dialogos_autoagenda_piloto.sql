-- Piloto acordado para Diálogos que Enseñan. Se preparan las tres modalidades,
-- todas de 30 minutos, pero la página sigue apagada hasta que se pruebe en staging.
-- INSERT ... SELECT hace que una instalación sin ese tenant sea un no-op seguro.
INSERT INTO tenant_services
  (id, tenant_id, slug, name, description, minutes, mode, location,
   buffer_min, active, position, created_at, updated_at)
SELECT
  'a0000000-0000-4000-8000-000000000001', id, 'presencial',
  'Sesión presencial', 'Sesión presencial de 30 minutos', 30, 'presencial', NULL,
  0, 1, 10, '2026-09-15T00:00:00.000Z', '2026-09-15T00:00:00.000Z'
FROM tenants WHERE slug = 'dialogos';

INSERT INTO tenant_services
  (id, tenant_id, slug, name, description, minutes, mode, location,
   buffer_min, active, position, created_at, updated_at)
SELECT
  'a0000000-0000-4000-8000-000000000002', id, 'video',
  'Sesión por vídeo', 'Sesión por videollamada de 30 minutos', 30, 'video', NULL,
  0, 1, 20, '2026-09-15T00:00:00.000Z', '2026-09-15T00:00:00.000Z'
FROM tenants WHERE slug = 'dialogos';

INSERT INTO tenant_services
  (id, tenant_id, slug, name, description, minutes, mode, location,
   buffer_min, active, position, created_at, updated_at)
SELECT
  'a0000000-0000-4000-8000-000000000003', id, 'telefono',
  'Sesión por teléfono', 'Sesión telefónica de 30 minutos', 30, 'telefono', NULL,
  0, 1, 30, '2026-09-15T00:00:00.000Z', '2026-09-15T00:00:00.000Z'
FROM tenants WHERE slug = 'dialogos';
