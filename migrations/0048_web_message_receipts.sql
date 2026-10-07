-- Recibo opcional de entrega web a un asesor. Clientes antiguos siguen enviando NULL.
-- La unicidad vive en el mismo batch que mensaje y contador: un retry no duplica ninguno.
-- La retención es la del mensaje/conversación existente; no se crea un ledger paralelo.
ALTER TABLE conv_messages ADD COLUMN client_message_id TEXT;
CREATE UNIQUE INDEX idx_conv_messages_client_receipt
  ON conv_messages(conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL AND role='user';
