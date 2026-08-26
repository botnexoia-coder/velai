-- Bandeja de conversaciones: responder desde el panel (docs/H2-BANDEJA.md).
--
-- 1) role='agent'. Una respuesta humana no es el bot ni el cliente, y confundirla con la
--    del bot rompe todo lo que viene después: tasa de resolución, «lo que el bot no supo
--    contestar» y el CSAT medido aparte. SQLite no amplía un CHECK con ALTER, así que hay
--    que RECONSTRUIR la tabla. Se hace AHORA porque conv_messages se creó el 2026-08-26 y
--    está casi vacía: en tres meses esto es una ventana de migración de verdad.
--    Nada referencia a conv_messages (la FK va en el otro sentido), así que el DROP es
--    seguro sin tocar foreign_keys — que en D1 no se puede tocar de todos modos.
CREATE TABLE conv_messages_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','agent')),
  agent_email TEXT,                 -- quién respondió; NULL salvo en 'agent'
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO conv_messages_new (id, conversation_id, role, text, created_at)
  SELECT id, conversation_id, role, text, created_at FROM conv_messages;
DROP TABLE conv_messages;
ALTER TABLE conv_messages_new RENAME TO conv_messages;
CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conv_messages (conversation_id, id);
-- La ventana de 24 h de Meta se calcula con el ÚLTIMO mensaje entrante: es la consulta
-- que hace el panel cada vez que se abre un hilo.
CREATE INDEX IF NOT EXISTS idx_conv_messages_inbound ON conv_messages (conversation_id, role, created_at DESC);

-- 2) Por qué número se responde. `conversations` guardaba el From del cliente final pero
--    NO la dirección a la que escribió. Con dos números por cliente, la respuesta saldría
--    por el que diga tenants.twilio_from y el cliente final la vería llegar desde otro
--    número. La vista Canales ya marca «responde con otro número» y TAREAS §2k lo tenía
--    apuntado como pendiente: la bandeja lo vuelve obligatorio.
--    NULL = no se sabe, y entonces NO se responde. Mejor un cajón cerrado que decirlo,
--    que una respuesta saliendo por el número equivocado.
ALTER TABLE conversations ADD COLUMN inbox_address TEXT;

-- 3) No leídos. Por conversación y no por usuario: una pyme no tiene dos agentes mirando
--    la misma bandeja, y la asignación de conversaciones está descartada con motivo en
--    docs/PLAN-PANEL.md (presupone un equipo de agentes que una pyme no tiene).
ALTER TABLE conversations ADD COLUMN last_read_at TEXT;
