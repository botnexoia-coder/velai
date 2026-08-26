-- Historial de conversación legible. Hasta ahora la conversación vivía SOLO en KV
-- (`conv:web:*` / `conv:wa:*`) con TTL de 24 h y recortada a los últimos 20 mensajes:
-- cuando un lead salía mal no había forma de mirar qué pasó. Es el hueco de paridad
-- número uno del análisis competitivo (las 8 plataformas DIY lo tienen) y el cimiento
-- de casi todo lo demás: conversaciones no resueltas, temas sin respuesta, responder
-- desde el panel y la traza del «Probar».
--
-- D1 SUSTITUYE a KV, no lo acompaña (ver docs/VOLUMEN-Y-ALMACENAMIENTO.md): el techo de
-- volumen del sistema estaba en KV (1.000 escrituras/día, cinco por turno de chat), no
-- en D1 (332 KB de 500 MB el 2026-08-26). Estas tablas son la FUENTE ÚNICA del estado de
-- la conversación, así que el `put` de `conv:*` desaparece y el techo sube de ~25 a ~60
-- conversaciones/día sin tocar nada más.
--
-- Una conversación es una SESIÓN, no una vida: tras 72 h de silencio la siguiente
-- entrada abre una fila nueva. Los 72 h no son arbitrarios — son el estándar de facto
-- del sector (Zendesk, HubSpot, Freshworks) para dar una conversación por resuelta, y el
-- mismo que adopta docs/PLAN-PANEL.md. De rebote acota cuánto crece una fila y hace que
-- el panel enseñe conversaciones discretas en vez de un hilo infinito por teléfono.
-- Por eso NO hay UNIQUE por (tenant, canal, dirección): hay una fila por sesión.
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,              -- uuid propio; NO el conversationId del widget (lo elige el navegador)
  tenant_id TEXT NOT NULL,
  channel TEXT NOT NULL,            -- 'web' | 'whatsapp' | 'messenger'
  external_id TEXT NOT NULL,        -- conversationId (web) | From de Twilio (wa/messenger)
  demo TEXT NOT NULL DEFAULT '',    -- clave de demo; '' = conversación real
  lead_id TEXT,                     -- se rellena al capturar; NULL = conversación sin lead
  msgs INTEGER NOT NULL DEFAULT 0,
  unanswered INTEGER NOT NULL DEFAULT 0,  -- respuestas en las que el bot admitió no saber
  started_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  expires_at TEXT NOT NULL          -- retención propia (CONV_RETENTION_DAYS), más corta que la de leads
);
-- El índice que sostiene la búsqueda de la sesión abierta en CADA turno de chat: es la
-- consulta más caliente del sistema, no puede ser un escaneo.
CREATE INDEX IF NOT EXISTS idx_conversations_open ON conversations (tenant_id, channel, external_id, last_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_last ON conversations (tenant_id, last_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_expires ON conversations (expires_at);
CREATE INDEX IF NOT EXISTS idx_conversations_lead ON conversations (lead_id);

-- Se guarda TODO el histórico y al modelo se le manda solo la ventana de 20. Hoy el
-- slice(-20) TIRA lo viejo, que es justo lo que dejamos de hacer.
CREATE TABLE IF NOT EXISTS conv_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON conv_messages (conversation_id, id);
