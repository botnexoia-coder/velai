-- Informe semanal automático al canal del cliente (H1 §2). El hueco más grande del
-- análisis competitivo: NI UN SOLO proveedor español o latinoamericano manda un resumen
-- periódico automático. Cliengo se acerca (informe a hasta cinco correos) pero bajo
-- demanda; fuera del mercado hispano solo Intercom lo tiene. Y todos lo mandan por
-- CORREO, donde una pyme no vive — Velai ya entrega en el Telegram del cliente.
--
-- Interruptor por cliente: Intercom resuelve la baja con un clic y es lo mínimo
-- esperable de algo que llega sin pedirlo. Por defecto ENCENDIDO — es la prueba del valor
-- y el cliente que no lo quiera lo apaga en Conexiones.
ALTER TABLE tenants ADD COLUMN weekly_report INTEGER NOT NULL DEFAULT 1;

-- Idempotencia: un cron que se dispara dos veces NO puede mandar dos informes. La fila se
-- reserva ANTES de enviar (status 'sending') y se cierra después. `attempts` acota los
-- reintentos: sin tope, un fallo permanente reintentaría en cada tick del cron durante
-- toda la ventana del lunes.
--
-- Un cliente sin Telegram vinculado es un 'skipped' VISIBLE con su motivo, no un silencio
-- — el mismo criterio que la entrega dual de leads.
CREATE TABLE IF NOT EXISTS tenant_reports (
  tenant_id TEXT NOT NULL,
  period_start TEXT NOT NULL,       -- lunes de la semana informada, YYYY-MM-DD (UTC)
  status TEXT NOT NULL CHECK (status IN ('sending','sent','skipped','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, period_start)
);
CREATE INDEX IF NOT EXISTS idx_tenant_reports_period ON tenant_reports (period_start);
