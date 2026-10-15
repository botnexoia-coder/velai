-- Redes sociales encendidas/apagadas por cliente desde «Plan y módulos» (REDES-PLAN.md).
-- Aditiva: tabla NUEVA en vez de ampliar el CHECK de tenant_modulos, que en SQLite obliga
-- a reconstruir la tabla (copiar, borrar, renombrar) con sus datos vivos y sus FKs.
-- Mismo molde que tenant_modulos: sin fila = lo que diga el plan; `on`/`off` = excepción.
-- `instagram` se admite ya aunque el canal no exista (SPEC-INSTAGRAM.md): el día que se
-- integre no hace falta otra migración.
CREATE TABLE tenant_redes (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('messenger','instagram')),
  estado TEXT NOT NULL CHECK(estado IN ('on','off')),
  otorgado_por TEXT NOT NULL,
  otorgado_en TEXT NOT NULL,
  PRIMARY KEY (tenant_id, kind)
);

-- Neutral: el webhook empieza a callar por una red APAGADA, así que quien hoy atiende por
-- una red que su plan no incluye (un Esencial anterior a la regla de 2026-09-22) recibe la
-- excepción `on` que conserva exactamente lo que ya tenía. Profesional y Empresa la traen
-- de serie y no necesitan fila. Misma definición de «conectada» que canalesOcupados.
INSERT INTO tenant_redes
SELECT t.id, r.kind, 'on', 'migracion:0055', strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM tenants t JOIN (SELECT 'messenger' AS kind UNION ALL SELECT 'instagram') r
WHERE t.plan = 'esencial'
  AND (t.channel_address LIKE r.kind || ':%'
    OR EXISTS (SELECT 1 FROM tenant_channels c WHERE c.tenant_id = t.id AND c.kind = r.kind));
