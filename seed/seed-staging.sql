-- Datos de STAGING. Se aplica UNA vez sobre vai-leads-staging (idempotente: se puede
-- repetir). Nunca sobre producción — el nombre de la base va explícito en el comando:
--
--   npx wrangler@4 d1 execute vai-leads-staging --remote --env staging --file seed/seed-staging.sql
--
-- Regla que no se rompe: en staging NO se copian datos reales de clientes. Un entorno con
-- menos protecciones y las mismas fichas de contacto es un problema de RGPD, no un atajo.
-- Todo lo de aquí es inventado y se nota a simple vista.

-- La migración 0002 siembra el tenant `velai` con los teléfonos REALES del equipo. En
-- staging no hay credenciales de Twilio, así que no puede salir nada — pero tampoco hay
-- motivo para que esos números estén aquí. Se sustituyen por números de prueba.
UPDATE tenants
   SET channel_address = 'whatsapp:+10000000001',
       twilio_from     = 'whatsapp:+10000000001',
       team_whatsapp   = 'whatsapp:+10000000002',
       telegram_chat_id = NULL,
       lead_template_sid = NULL,
       name = 'Velai (staging)'
 WHERE slug = 'velai';

-- Mismo motivo: la migración de Messenger trae el page id real de Velai.
UPDATE tenants SET channel_address = 'messenger:000000000000000', name = 'Velai Messenger (staging)'
 WHERE slug = 'velai-messenger';

-- Un SEGUNDO tenant, para que staging pueda probar de verdad lo que más riesgo tiene:
-- el aislamiento entre clientes. Con un solo tenant no hay nada que aislar.
INSERT OR IGNORE INTO tenants
  (id, slug, name, channel_address, team_whatsapp, twilio_from, system_prompt, active, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-0000000000ff',
  'demo-staging', 'Barbería de Prueba (staging)',
  'whatsapp:+10000000003',
  'whatsapp:+10000000004',
  'whatsapp:+10000000003',
  'Eres el asistente de una barbería de PRUEBA que solo existe en staging. Si alguien te pregunta, dilo. Precios inventados: corte 15 euros, barba 10 euros. Horario: L-V 9-19.',
  1, '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z'
);

-- Usuario con rol CLIENTE, para poder abrir el panel como lo ve un cliente y no solo
-- como Velai. El alias +cliente llega al mismo buzón de Gmail (así el OTP de Access se
-- recibe) pero es una cadena distinta de ADMIN_EMAILS, así que resolveScope lo resuelve
-- como cliente y no como admin. Cambia el correo por el tuyo si usas otro.
INSERT OR IGNORE INTO tenant_users (email, tenant_id, role, created_at)
VALUES ('botnexo.ia+cliente@gmail.com', '00000000-0000-4000-8000-0000000000ff', 'cliente', '2026-08-31T00:00:00.000Z');
