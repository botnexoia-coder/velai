-- SPEC-NOTIFICACION-CITA (2026-09-29): el cliente edita el TEXTO de sus plantillas de
-- citas (confirmacion_reserva y recordatorio_cita) desde la vista Plantillas del panel.
-- Aditiva y sin PRAGMA, como manda GUIA-WORKERS §2. Se numera 0047 a propósito (la 0046
-- la reserva otra rama en paralelo): si al fusionar hay hueco o choque, renumerar.
--
-- 1) El texto de la plantilla ACTIVA (sid/status de la fila), con variables con nombre
--    ({{nombre}}, {{fecha}}…). NULL = el texto por defecto del catálogo
--    (worker/plantillas.js): las filas existentes —la de dialogos ya aprobada— siguen
--    enviando exactamente las mismas variables que antes. Quien envía numera las
--    variables A PARTIR DE ESTE TEXTO, así que sid y texto siempre van juntos.
ALTER TABLE tenant_templates ADD COLUMN texto TEXT;

-- 2) REVISIÓN en curso: cambiar el texto (o los botones) de una plantilla YA APROBADA
--    crea otra plantilla en Twilio y la somete a Meta, pero la aprobada sigue enviándose
--    mientras tanto. El poll (pollTemplateApprovals) la PROMUEVE a sid/status/texto/
--    opciones al aprobarse; si Meta la rechaza, queda 'rejected' con su motivo para que
--    el cliente lo vea, y la activa no se toca.
ALTER TABLE tenant_templates ADD COLUMN revision_sid TEXT;
ALTER TABLE tenant_templates ADD COLUMN revision_status TEXT;
ALTER TABLE tenant_templates ADD COLUMN revision_texto TEXT;
ALTER TABLE tenant_templates ADD COLUMN revision_opciones TEXT;
ALTER TABLE tenant_templates ADD COLUMN revision_motivo TEXT;
ALTER TABLE tenant_templates ADD COLUMN revision_at TEXT;
