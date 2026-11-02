-- Catálogo operativo de servicios recurrentes. No crea gastos ni sustituye el
-- libro: describe qué puede volver a cobrarse, quién lo adelanta y a qué proyecto
-- pertenece. Los pagos reales continúan registrándose una sola vez en movimientos.
CREATE TABLE fin_recurrentes (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  proveedor TEXT NOT NULL,
  proyecto TEXT NOT NULL,
  tenant_id TEXT REFERENCES tenants(id),
  tipo_cobro TEXT NOT NULL CHECK(tipo_cobro IN ('cuota_fija','recarga_automatica','consumo_variable')),
  frecuencia TEXT NOT NULL CHECK(frecuencia IN ('mensual','anual','variable')),
  moneda TEXT NOT NULL CHECK(moneda IN ('EUR','COP','USD')),
  importe_estimado INTEGER CHECK(importe_estimado IS NULL OR (importe_estimado>=0 AND typeof(importe_estimado)='integer')),
  pagador_socio TEXT,
  metodo_pago TEXT,
  incluido_en_finanzas INTEGER NOT NULL DEFAULT 1 CHECK(incluido_en_finanzas IN (0,1)),
  estado TEXT NOT NULL DEFAULT 'activo' CHECK(estado IN ('activo','revision','pausado','cancelado')),
  proxima_fecha TEXT,
  nota TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(proveedor,nombre,proyecto)
);
CREATE INDEX fin_recurrentes_estado ON fin_recurrentes(estado,incluido_en_finanzas,proveedor);
CREATE INDEX fin_recurrentes_tenant ON fin_recurrentes(tenant_id);

INSERT INTO fin_recurrentes
  (id,nombre,proveedor,proyecto,tipo_cobro,frecuencia,moneda,importe_estimado,pagador_socio,metodo_pago,incluido_en_finanzas,estado,proxima_fecha,nota,created_by,created_at,updated_by,updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000552','Créditos API para bots','Anthropic','Velai · bots de clientes','recarga_automatica','variable','USD',NULL,
   (SELECT email FROM fin_socios WHERE lower(email)='johan.s@hotmail.es' LIMIT 1),'Mastercard ···· 8545',1,'activo',NULL,
   'Recarga por consumo de todos los asistentes de este Worker mediante su única ANTHROPIC_API_KEY. El Claude Pro de botnexo.ia@gmail.com se canceló el 13/10/2026 tras comprobar 0% de uso; conserva acceso hasta el 11/11/2026 y no se renovará. Claude Equipo de Farmapiel y las suscripciones personales de los socios quedan fuera de Nexo.','migracion',datetime('now'),'migracion',datetime('now')),
  ('00000000-0000-4000-8000-000000000553','hirevai.com','Cloudflare Registrar','Velai','cuota_fija','anual','USD',1046,
   (SELECT email FROM fin_socios WHERE lower(email)='johan.s@hotmail.es' LIMIT 1),'Mastercard ···· 8545',1,'activo','2027-04-14','Dominio principal de Velai.','migracion',datetime('now'),'migracion',datetime('now')),
  ('00000000-0000-4000-8000-000000000554','myxucostura.com','Cloudflare Registrar','My Xu Costura','cuota_fija','anual','USD',1046,
   (SELECT email FROM fin_socios WHERE lower(email)='johan.s@hotmail.es' LIMIT 1),'Mastercard ···· 8545',1,'activo','2027-05-10','Dominio de cliente administrado por Nexo.','migracion',datetime('now'),'migracion',datetime('now')),
  ('00000000-0000-4000-8000-000000000555','hiredatavision.com','Cloudflare Registrar','HireDataVision','cuota_fija','anual','USD',1046,
   (SELECT email FROM fin_socios WHERE lower(email)='johan.s@hotmail.es' LIMIT 1),'Mastercard ···· 8545',1,'activo','2027-05-15','Dominio de producto administrado por Nexo.','migracion',datetime('now'),'migracion',datetime('now')),
  ('00000000-0000-4000-8000-000000000556','dialogosqueensenan.com','Cloudflare Registrar','Diálogos que Enseñan','cuota_fija','anual','USD',1046,
   (SELECT email FROM fin_socios WHERE lower(email)='johan.s@hotmail.es' LIMIT 1),'Mastercard ···· 8545',1,'activo','2027-07-11','Dominio del proyecto Diálogos.','migracion',datetime('now'),'migracion',datetime('now')),
  ('00000000-0000-4000-8000-000000000557','zoetravelspain.com','Cloudflare Registrar','Zoe Travel Spain','cuota_fija','anual','USD',1046,
   (SELECT email FROM fin_socios WHERE lower(email)='johan.s@hotmail.es' LIMIT 1),'Mastercard ···· 8545',1,'activo','2027-07-14','Dominio de cliente administrado por Nexo.','migracion',datetime('now'),'migracion',datetime('now')),
  ('00000000-0000-4000-8000-000000000558','talleresartemotor.com','Cloudflare Registrar','Arte y Motor','cuota_fija','anual','USD',1046,
   (SELECT email FROM fin_socios WHERE lower(email)='johan.s@hotmail.es' LIMIT 1),'Mastercard ···· 8545',1,'activo','2027-09-15','Dominio de cliente administrado por Nexo.','migracion',datetime('now'),'migracion',datetime('now')),
  ('00000000-0000-4000-8000-000000000559','nayaeventos.com','Cloudflare Registrar','NAYA Eventos','cuota_fija','anual','USD',1046,
   (SELECT email FROM fin_socios WHERE lower(email)='johan.s@hotmail.es' LIMIT 1),'Mastercard ···· 8545',1,'activo','2027-09-19','Dominio del proyecto NAYA.','migracion',datetime('now'),'migracion',datetime('now')),
  ('00000000-0000-4000-8000-000000000560','Railway Hobby / uso','Railway','Nexobot Polymarket · Sebastián + Juan','consumo_variable','mensual','USD',844,
   (SELECT email FROM fin_socios WHERE lower(email)='johan.s@hotmail.es' LIMIT 1),'Mastercard ···· 8545',0,'revision','2026-10-29',
   'Proyecto separado de Velai. El bot está detenido, pero Railway continúa cobrando; revisar antes del próximo ciclo.','migracion',datetime('now'),'migracion',datetime('now')),
  ('00000000-0000-4000-8000-000000000561','Proxies residenciales','Webshare','Infraestructura histórica de pruebas','consumo_variable','mensual','USD',NULL,
   (SELECT email FROM fin_socios WHERE lower(email)='johan.s@hotmail.es' LIMIT 1),'Mastercard ···· 8545',0,'pausado',NULL,
   'Sin cobros desde julio; cuenta suspendida y renovación reportada como desactivada. Verificar antes de reactivar.','migracion',datetime('now'),'migracion',datetime('now'));
