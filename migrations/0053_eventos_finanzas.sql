-- Etiquetas explícitas de evento y ejecución; no reclasifica ni duplica el histórico.
ALTER TABLE g_compras ADD COLUMN evento_id TEXT REFERENCES tenant_events(id);
ALTER TABLE g_compras ADD COLUMN hecho INTEGER NOT NULL DEFAULT 0 CHECK(hecho IN (0,1));
ALTER TABLE g_compras ADD COLUMN hecho_fecha TEXT;
ALTER TABLE g_compras ADD COLUMN hecho_por TEXT;
ALTER TABLE g_compras ADD COLUMN plan_pagos TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(plan_pagos) AND json_type(plan_pagos)='array' AND json_array_length(plan_pagos)<=20);
ALTER TABLE fin_movimientos ADD COLUMN evento_id TEXT REFERENCES tenant_events(id);
CREATE INDEX g_compras_evento ON g_compras(evento_id,moneda,estado);
CREATE INDEX fin_mov_evento ON fin_movimientos(evento_id,fecha);

-- Un evento usa EUR y el paraguas Diálogos. Las guardas también cubren carreras
-- entre la validación del API y la escritura, conservando versión optimista.
CREATE TRIGGER g_compra_evento_insert BEFORE INSERT ON g_compras
WHEN NEW.evento_id IS NOT NULL AND (NEW.moneda<>'EUR' OR NEW.negocio<>'dialogos' OR NOT EXISTS(SELECT 1 FROM tenant_events WHERE id=NEW.evento_id))
BEGIN SELECT RAISE(ABORT,'evento_compra_incoherente'); END;
CREATE TRIGGER g_compra_evento_update BEFORE UPDATE OF evento_id,moneda,negocio ON g_compras
WHEN NEW.evento_id IS NOT NULL AND (NEW.moneda<>'EUR' OR NEW.negocio<>'dialogos' OR NOT EXISTS(SELECT 1 FROM tenant_events WHERE id=NEW.evento_id))
BEGIN SELECT RAISE(ABORT,'evento_compra_incoherente'); END;
CREATE TRIGGER g_compra_plan_insert BEFORE INSERT ON g_compras
WHEN (SELECT COALESCE(SUM(json_extract(value,'$.importe')),0) FROM json_each(NEW.plan_pagos))>COALESCE(NEW.real,NEW.estimado)
BEGIN SELECT RAISE(ABORT,'plan_supera_importe'); END;
CREATE TRIGGER g_compra_plan_update BEFORE UPDATE OF plan_pagos,real,estimado ON g_compras
WHEN (SELECT COALESCE(SUM(json_extract(value,'$.importe')),0) FROM json_each(NEW.plan_pagos))>COALESCE(NEW.real,NEW.estimado)
BEGIN SELECT RAISE(ABORT,'plan_supera_importe'); END;
CREATE TRIGGER fin_mov_evento_insert BEFORE INSERT ON fin_movimientos
WHEN NEW.evento_id IS NOT NULL AND (NEW.moneda<>'EUR' OR NEW.tenant_id IS NOT (SELECT tenant_id FROM tenant_events WHERE id=NEW.evento_id) OR NOT EXISTS(SELECT 1 FROM tenant_events WHERE id=NEW.evento_id))
BEGIN SELECT RAISE(ABORT,'evento_movimiento_incoherente'); END;
CREATE TRIGGER fin_mov_evento_update BEFORE UPDATE OF evento_id,moneda,tenant_id ON fin_movimientos
WHEN NEW.evento_id IS NOT NULL AND (NEW.moneda<>'EUR' OR NEW.tenant_id IS NOT (SELECT tenant_id FROM tenant_events WHERE id=NEW.evento_id) OR NOT EXISTS(SELECT 1 FROM tenant_events WHERE id=NEW.evento_id))
BEGIN SELECT RAISE(ABORT,'evento_movimiento_incoherente'); END;
