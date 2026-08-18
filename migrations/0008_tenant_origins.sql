-- Orígenes web por tenant (SPEC-ORIGENES-Y-TURNSTILE-POR-API §2): la lista de dominios
-- de cliente es un dato de negocio y pertenece a su fila, no a la configuración del
-- Worker. allowedOrigins() une estos orígenes (tenants activos) con los del entorno
-- (ALLOWED_WEB_ORIGINS queda como base: si D1 cae, nuestro propio sitio sigue).
-- JSON array de orígenes https sin barra final, máx. 6 por tenant. Además elimina el
-- tope silencioso de clean(...,1000) que se habría alcanzado hacia el cliente ~15.
ALTER TABLE tenants ADD COLUMN web_origins TEXT;
