-- SPEC-CONEXIONES PR1: vinculación de Telegram en autoservicio. El token de un solo
-- uso vive en KV (TTL 15 min) — aquí solo el resultado y cuándo, para auditoría y
-- para que el panel muestre A DÓNDE van los avisos. Aditiva, sin PRAGMA (D1).
ALTER TABLE tenants ADD COLUMN telegram_linked_at TEXT;
ALTER TABLE tenants ADD COLUMN telegram_chat_title TEXT; -- 'GOgestión · Leads': el nombre del chat vinculado
