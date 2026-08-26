-- Handoff con toma de control (docs/H2-HANDOFF.md). Decisión de Juan el 2026-08-26:
--   «bot sin restricción horaria, hablar con un asesor CON restricción horaria.
--    Fuera de horario no se ofrece interacción humana o se rechaza.»
--
-- El problema que arregla: hoy un [[HUMANO]] pausa el bot 4 h y avisa por Telegram, pero
-- nada garantiza que alguien conteste. Si el aviso llega de noche, el cliente final se
-- queda en silencio cuatro horas justo después de pedir ayuda.
--
-- Horario de atención HUMANA, no del bot. El bot sigue 24/7.
-- Mismo formato que tenant_calendars.business_hours: {"mon":[["09:00","14:00"]],…}
-- NULL = el default de siempre (L-V 9-19, DEFAULT_BUSINESS_HOURS en worker/calendar.js):
-- si la interacción humana va con horario, un NULL no puede significar «sin límite».
ALTER TABLE tenants ADD COLUMN support_hours TEXT;
ALTER TABLE tenants ADD COLUMN support_tz TEXT;      -- NULL = Europe/Madrid

-- Estado de la conversación. 'bot' | 'esperando' | 'humano'.
-- Sin CHECK porque SQLite no lo admite por ALTER y reconstruir conversations por esto no
-- vale la pena: se valida en código (CONV_STATES).
--   bot       → la IA atiende con las reglas de siempre
--   esperando → pidió asesor Y había alguien disponible; el bot calla y corre la cuenta
--               atrás de 5 min para que alguien tome el control
--   humano    → alguien tomó el control; SOLO en este estado se habilita el cajón
ALTER TABLE conversations ADD COLUMN state TEXT NOT NULL DEFAULT 'bot';
ALTER TABLE conversations ADD COLUMN state_at TEXT;     -- cuándo entró en el estado (la cuenta atrás)
ALTER TABLE conversations ADD COLUMN agent_email TEXT;  -- quién tomó el control
CREATE INDEX IF NOT EXISTS idx_conversations_state ON conversations (state, state_at);

-- Disponibilidad POR PERSONA (varias pueden estar disponibles); el horario es del cliente.
-- Interruptor explícito, elegido por Juan frente a la presencia implícita: quien lo enciende
-- se está comprometiendo, y el horario lo cierra por fuera.
CREATE TABLE IF NOT EXISTS agent_presence (
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, email)
);
