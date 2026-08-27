-- Aviso sonoro y notificación cuando llega un mensaje al panel (Juan, 2026-08-26: «por si
-- está en otra página u otra pestaña»).
--
-- Por qué una columna y no una consulta: el aviso tiene que saber si llegó algo NUEVO DEL
-- CLIENTE FINAL, no cualquier cambio — si mirara last_at, una respuesta del propio equipo
-- se avisaría a sí misma. Sacarlo con un MAX sobre conv_messages exigiría recorrer todos
-- los mensajes entrantes de todas las conversaciones en cada sondeo; guardado en la fila,
-- el aviso es UNA consulta agregada sobre una tabla pequeña.
ALTER TABLE conversations ADD COLUMN last_inbound_at TEXT;
CREATE INDEX IF NOT EXISTS idx_conversations_inbound ON conversations (tenant_id, last_inbound_at DESC);
