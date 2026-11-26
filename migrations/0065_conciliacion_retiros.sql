-- 0065 · Conciliación de retiros (control SEPARADO del libro).
-- Agrupa por lote salidas bancarias ya registradas (fin_traspasos / fin_movimientos) y
-- los usos del efectivo (pagos de compra ya registrados o declaraciones pendientes).
-- NUNCA crea, edita ni borra traspasos, movimientos ni pagos: solo los referencia.
-- Importes en unidades menores (céntimos EUR / pesos COP), enteros.
-- Nada se borra: una fuente se "retira" y un uso se "anula" (reversible y auditado).

CREATE TABLE g_retiro_lotes (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'EUR' CHECK(moneda IN ('EUR','COP')),
  nota TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TRIGGER g_retiro_lotes_version BEFORE UPDATE OF version ON g_retiro_lotes
WHEN NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT,'version_conflicto'); END;
CREATE TRIGGER g_retiro_lotes_sin_delete BEFORE DELETE ON g_retiro_lotes
BEGIN SELECT RAISE(ABORT,'retiro_sin_borrado'); END;

-- Fuente: UNA operación ya existente del libro. `importe` es la foto del importe al
-- enlazar: si el original cambia o se anula, el control lo marca y no lo pierde.
-- clasificacion: 'cajero_verificado' = efectivo confirmado (exige extracto o captura);
-- 'efectivo_declarado' = efectivo que alguien dice haber recibido, sin confirmar;
-- 'traspaso_por_identificar' = salida cuyo destinatario no consta: no se infiere efectivo.
-- comision NULL = desconocida (no es 0). Una comisión solo es "conocida" si
-- coste_estado = 'confirmado'.
CREATE TABLE g_retiro_fuentes (
  id TEXT PRIMARY KEY,
  lote_id TEXT NOT NULL REFERENCES g_retiro_lotes(id),
  origen_tipo TEXT NOT NULL CHECK(origen_tipo IN ('traspaso','movimiento')),
  origen_id TEXT NOT NULL,
  importe INTEGER NOT NULL CHECK(typeof(importe)='integer' AND importe > 0),
  moneda TEXT NOT NULL CHECK(moneda IN ('EUR','COP')),
  clasificacion TEXT NOT NULL CHECK(clasificacion IN ('cajero_verificado','efectivo_declarado','traspaso_por_identificar')),
  evidencia TEXT CHECK(evidencia IS NULL OR evidencia IN ('extracto','captura','declaracion')),
  declarado_por TEXT,
  nota TEXT,
  comision INTEGER CHECK(comision IS NULL OR (typeof(comision)='integer' AND comision >= 0 AND comision <= importe)),
  coste_bancario_total INTEGER CHECK(coste_bancario_total IS NULL OR (typeof(coste_bancario_total)='integer' AND coste_bancario_total >= 0)),
  coste_estado TEXT NOT NULL DEFAULT 'por_confirmar' CHECK(coste_estado IN ('confirmado','por_confirmar','autorizacion_pendiente')),
  estado TEXT NOT NULL DEFAULT 'activa' CHECK(estado IN ('activa','retirada')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(clasificacion <> 'cajero_verificado' OR COALESCE(evidencia,'') IN ('extracto','captura')),
  CHECK(coste_estado <> 'confirmado' OR comision IS NOT NULL)
);
CREATE INDEX g_retiro_fuentes_lote ON g_retiro_fuentes(lote_id, created_at);
-- Una operación no puede estar activa en dos lotes ni dos veces en el mismo.
CREATE UNIQUE INDEX g_retiro_fuentes_origen_activo ON g_retiro_fuentes(origen_tipo, origen_id) WHERE estado = 'activa';
CREATE TRIGGER g_retiro_fuentes_version BEFORE UPDATE OF version ON g_retiro_fuentes
WHEN NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT,'version_conflicto'); END;
CREATE TRIGGER g_retiro_fuentes_sin_delete BEFORE DELETE ON g_retiro_fuentes
BEGIN SELECT RAISE(ABORT,'retiro_sin_borrado'); END;
CREATE TRIGGER g_retiro_fuentes_vinculo BEFORE UPDATE OF lote_id, origen_tipo, origen_id, importe, moneda ON g_retiro_fuentes
WHEN NEW.lote_id <> OLD.lote_id OR NEW.origen_tipo <> OLD.origen_tipo OR NEW.origen_id <> OLD.origen_id OR NEW.importe <> OLD.importe OR NEW.moneda <> OLD.moneda
BEGIN SELECT RAISE(ABORT,'retiro_vinculo_inmutable'); END;
CREATE TRIGGER g_retiro_fuentes_moneda BEFORE INSERT ON g_retiro_fuentes
WHEN NEW.moneda IS NOT (SELECT moneda FROM g_retiro_lotes WHERE id = NEW.lote_id)
BEGIN SELECT RAISE(ABORT,'retiro_moneda_distinta'); END;

-- Uso: a dónde fue el efectivo común. 'pago_existente' enlaza un pago de compra activo
-- desde una cuenta (no crea nada); 'declaracion' es lo que alguien dice haber pagado,
-- sin fecha ni documento obligatorios, vinculable a una compra. importe_efectivo es el
-- efectivo común; aporte_personal es dinero propio de quien pagó y solo informa:
-- no crea deuda ni reembolso.
CREATE TABLE g_retiro_usos (
  id TEXT PRIMARY KEY,
  lote_id TEXT NOT NULL REFERENCES g_retiro_lotes(id),
  tipo TEXT NOT NULL CHECK(tipo IN ('pago_existente','declaracion')),
  pago_id TEXT REFERENCES g_pagos(id),
  compra_id TEXT REFERENCES g_compras(id),
  concepto TEXT NOT NULL,
  importe_efectivo INTEGER NOT NULL CHECK(typeof(importe_efectivo)='integer' AND importe_efectivo > 0),
  aporte_personal INTEGER CHECK(aporte_personal IS NULL OR (typeof(aporte_personal)='integer' AND aporte_personal >= 0)),
  aporte_reembolso TEXT CHECK(aporte_reembolso IS NULL OR aporte_reembolso IN ('reembolsable','no_reembolsable')),
  fecha TEXT,
  evidencia TEXT NOT NULL DEFAULT 'ninguna' CHECK(evidencia IN ('extracto','captura','declaracion','documento','ninguna')),
  declarado_por TEXT,
  nota TEXT,
  estado TEXT NOT NULL DEFAULT 'activo' CHECK(estado IN ('activo','anulado')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((tipo = 'pago_existente' AND pago_id IS NOT NULL) OR (tipo = 'declaracion' AND pago_id IS NULL)),
  CHECK(aporte_reembolso IS NULL OR COALESCE(aporte_personal,0) > 0)
);
CREATE INDEX g_retiro_usos_lote ON g_retiro_usos(lote_id, created_at);
CREATE INDEX g_retiro_usos_pago ON g_retiro_usos(pago_id, estado);
CREATE TRIGGER g_retiro_usos_version BEFORE UPDATE OF version ON g_retiro_usos
WHEN NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT,'version_conflicto'); END;
CREATE TRIGGER g_retiro_usos_sin_delete BEFORE DELETE ON g_retiro_usos
BEGIN SELECT RAISE(ABORT,'retiro_sin_borrado'); END;
CREATE TRIGGER g_retiro_usos_vinculo BEFORE UPDATE OF lote_id, tipo, pago_id ON g_retiro_usos
WHEN NEW.lote_id <> OLD.lote_id OR NEW.tipo <> OLD.tipo OR NEW.pago_id IS NOT OLD.pago_id
BEGIN SELECT RAISE(ABORT,'retiro_vinculo_inmutable'); END;
-- El pago debe seguir activo, ser de cuenta y de compra, y estar en la moneda del lote.
CREATE TRIGGER g_retiro_usos_pago_insert BEFORE INSERT ON g_retiro_usos
WHEN NEW.tipo = 'pago_existente' AND NEW.estado = 'activo' AND NOT EXISTS (
  SELECT 1 FROM g_pagos p WHERE p.id = NEW.pago_id AND p.clase = 'pago' AND p.estado = 'activo' AND p.pagador = 'cuenta'
    AND p.objeto_tipo = 'compra' AND p.moneda = (SELECT moneda FROM g_retiro_lotes WHERE id = NEW.lote_id))
BEGIN SELECT RAISE(ABORT,'retiro_pago_no_vigente'); END;
-- Los usos activos de un pago no suman más que el pago.
CREATE TRIGGER g_retiro_usos_suma_insert BEFORE INSERT ON g_retiro_usos
WHEN NEW.tipo = 'pago_existente' AND NEW.estado = 'activo'
  AND COALESCE((SELECT SUM(importe_efectivo) FROM g_retiro_usos WHERE pago_id = NEW.pago_id AND estado = 'activo'), 0) + NEW.importe_efectivo
      > COALESCE((SELECT importe FROM g_pagos WHERE id = NEW.pago_id), 0)
BEGIN SELECT RAISE(ABORT,'retiro_uso_supera_pago'); END;
CREATE TRIGGER g_retiro_usos_suma_update BEFORE UPDATE OF importe_efectivo, estado ON g_retiro_usos
WHEN NEW.tipo = 'pago_existente' AND NEW.estado = 'activo' AND (NEW.importe_efectivo <> OLD.importe_efectivo OR NEW.estado <> OLD.estado)
  AND (COALESCE((SELECT SUM(importe_efectivo) FROM g_retiro_usos WHERE pago_id = NEW.pago_id AND estado = 'activo' AND id <> NEW.id), 0) + NEW.importe_efectivo
      > COALESCE((SELECT importe FROM g_pagos WHERE id = NEW.pago_id), 0)
    OR NOT EXISTS (SELECT 1 FROM g_pagos p WHERE p.id = NEW.pago_id AND p.estado = 'activo'))
BEGIN SELECT RAISE(ABORT,'retiro_uso_supera_pago'); END;
