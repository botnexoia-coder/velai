-- SPEC-CONEXIONES PR1-bis (marca blanca, pedida por Juan 2026-08-21): bot de
-- Telegram PROPIO por cliente. El token va CIFRADO (AES-256-GCM, AAD
-- 'telegram:<tenant_id>') y es write-only; el username se guarda al validar con
-- getMe para mostrarlo sin repetir llamadas. Sin bot propio: el de Velai.
ALTER TABLE tenants ADD COLUMN telegram_bot_token_enc TEXT;
ALTER TABLE tenants ADD COLUMN telegram_bot_username TEXT;
