-- Temas de Telegram por tenant (pedido de Juan 2026-08-21): el cliente crea los
-- Temas en SU grupo con sus nombres; el bot los registra (mensaje de servicio del
-- webhook, o /tema dentro del tema) y Vai clasifica cada lead hacia el tema que
-- mejor encaje. JSON [{thread_id, name}] — pocos y del propio cliente.
ALTER TABLE tenants ADD COLUMN telegram_topics TEXT;
