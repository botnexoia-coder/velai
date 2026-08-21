-- Marca blanca de Telegram como FEATURE conmutable por Velai (pedido de Juan,
-- 2026-08-21): el bloque «Bot propio» solo existe para el cliente si su fila lo
-- tiene activado — y la guarda es del worker, no de la interfaz.
ALTER TABLE tenants ADD COLUMN telegram_whitelabel INTEGER NOT NULL DEFAULT 0;
