-- Conciliación de gastos pagados inicialmente por un socio.
-- El gasto sigue siendo UNA sola fila en fin_movimientos. Al conciliarlo se asigna
-- la cuenta que finalmente soportó el pago y se adjunta el comprobante; no se crea
-- otro gasto ni otra salida de caja.
ALTER TABLE fin_movimientos ADD COLUMN requiere_conciliacion INTEGER NOT NULL DEFAULT 0
  CHECK(requiere_conciliacion IN (0,1));
ALTER TABLE fin_movimientos ADD COLUMN conciliacion_socio TEXT;
ALTER TABLE fin_movimientos ADD COLUMN conciliada INTEGER NOT NULL DEFAULT 0
  CHECK(conciliada IN (0,1));
ALTER TABLE fin_movimientos ADD COLUMN conciliacion_fecha TEXT;
ALTER TABLE fin_movimientos ADD COLUMN conciliada_por TEXT;

CREATE TRIGGER fin_conciliacion_insert_valida BEFORE INSERT ON fin_movimientos
WHEN (NEW.requiere_conciliacion=1 AND (NEW.tipo<>'gasto' OR NEW.origen_tipo IS NOT NULL OR NEW.conciliacion_socio IS NULL))
  OR (NEW.conciliada=1 AND (NEW.requiere_conciliacion<>1 OR NEW.cuenta_id IS NULL OR NEW.conciliacion_fecha IS NULL OR NEW.conciliada_por IS NULL))
  OR (NEW.requiere_conciliacion=1 AND NEW.conciliada=0 AND (NEW.cuenta_id IS NOT NULL OR NEW.conciliacion_fecha IS NOT NULL OR NEW.conciliada_por IS NOT NULL))
  OR (NEW.requiere_conciliacion=1 AND NOT EXISTS(SELECT 1 FROM fin_socios WHERE email=NEW.conciliacion_socio))
  OR (NEW.conciliada=1 AND NEW.conciliacion_fecha<NEW.fecha)
  OR (NEW.requiere_conciliacion=0 AND (NEW.conciliada<>0 OR NEW.conciliacion_socio IS NOT NULL OR NEW.conciliacion_fecha IS NOT NULL OR NEW.conciliada_por IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'fin_conciliacion_invalida'); END;

CREATE TRIGGER fin_conciliacion_update_valida BEFORE UPDATE ON fin_movimientos
WHEN (NEW.requiere_conciliacion=1 AND (NEW.tipo<>'gasto' OR NEW.origen_tipo IS NOT NULL OR NEW.conciliacion_socio IS NULL))
  OR (NEW.conciliada=1 AND (NEW.requiere_conciliacion<>1 OR NEW.cuenta_id IS NULL OR NEW.conciliacion_fecha IS NULL OR NEW.conciliada_por IS NULL))
  OR (NEW.requiere_conciliacion=1 AND NEW.conciliada=0 AND (NEW.cuenta_id IS NOT NULL OR NEW.conciliacion_fecha IS NOT NULL OR NEW.conciliada_por IS NOT NULL))
  OR (NEW.requiere_conciliacion=1 AND NOT EXISTS(SELECT 1 FROM fin_socios WHERE email=NEW.conciliacion_socio))
  OR (NEW.conciliada=1 AND NEW.conciliacion_fecha<NEW.fecha)
  OR (NEW.requiere_conciliacion=0 AND (NEW.conciliada<>0 OR NEW.conciliacion_socio IS NOT NULL OR NEW.conciliacion_fecha IS NOT NULL OR NEW.conciliada_por IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'fin_conciliacion_invalida'); END;

-- Los traspasos cambian la ubicación del dinero, nunca el resultado ni el saldo
-- total del libro. Se guardan fuera de fin_movimientos para que no parezcan un
-- ingreso y un gasto ficticios. Una corrección se registra con un reverso.
CREATE TABLE fin_traspasos (
  id TEXT PRIMARY KEY,
  fecha TEXT NOT NULL,
  moneda TEXT NOT NULL CHECK(moneda IN ('EUR','COP')),
  importe INTEGER NOT NULL CHECK(importe>0 AND typeof(importe)='integer'),
  cuenta_origen_id TEXT NOT NULL REFERENCES g_cuentas(id),
  cuenta_destino_id TEXT NOT NULL REFERENCES g_cuentas(id),
  nota TEXT,
  signo INTEGER NOT NULL DEFAULT 1 CHECK(signo IN (1,-1)),
  reverso_de TEXT REFERENCES fin_traspasos(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(cuenta_origen_id<>cuenta_destino_id),
  CHECK((signo=1 AND reverso_de IS NULL) OR (signo=-1 AND reverso_de IS NOT NULL))
);
CREATE INDEX fin_traspasos_fecha ON fin_traspasos(fecha DESC,created_at DESC);
CREATE INDEX fin_traspasos_origen ON fin_traspasos(cuenta_origen_id);
CREATE INDEX fin_traspasos_destino ON fin_traspasos(cuenta_destino_id);
CREATE UNIQUE INDEX fin_traspasos_reverso_unico ON fin_traspasos(reverso_de) WHERE reverso_de IS NOT NULL;
CREATE TRIGGER fin_traspaso_insert_valido BEFORE INSERT ON fin_traspasos
WHEN NOT EXISTS(SELECT 1 FROM g_cuentas WHERE id=NEW.cuenta_origen_id AND moneda=NEW.moneda)
  OR NOT EXISTS(SELECT 1 FROM g_cuentas WHERE id=NEW.cuenta_destino_id AND moneda=NEW.moneda)
  OR (NEW.signo=-1 AND NOT EXISTS(
    SELECT 1 FROM fin_traspasos o WHERE o.id=NEW.reverso_de AND o.signo=1
      AND o.moneda=NEW.moneda AND o.importe=NEW.importe
      AND o.cuenta_origen_id=NEW.cuenta_origen_id AND o.cuenta_destino_id=NEW.cuenta_destino_id
  ))
BEGIN SELECT RAISE(ABORT,'fin_traspaso_invalido'); END;
CREATE TRIGGER fin_traspaso_sin_update BEFORE UPDATE ON fin_traspasos
BEGIN SELECT RAISE(ABORT,'fin_traspaso_inmutable'); END;
CREATE TRIGGER fin_traspaso_sin_delete BEFORE DELETE ON fin_traspasos
BEGIN SELECT RAISE(ABORT,'fin_traspaso_inmutable'); END;

-- Una cuenta usada por un traspaso tampoco puede cambiar de moneda. Se conserva
-- el resto de la protección de 0050 y se amplía con las dos patas del traspaso.
DROP TRIGGER g_cuentas_identidad;
CREATE TRIGGER g_cuentas_identidad BEFORE UPDATE OF moneda,entidad_id ON g_cuentas
WHEN (NEW.moneda<>OLD.moneda AND (
 EXISTS(SELECT 1 FROM g_prestamos WHERE cuenta_id=OLD.id) OR
 EXISTS(SELECT 1 FROM g_pagos WHERE cuenta_id=OLD.id) OR
 EXISTS(SELECT 1 FROM fin_movimientos WHERE cuenta_id=OLD.id) OR
 EXISTS(SELECT 1 FROM fin_traspasos WHERE cuenta_origen_id=OLD.id OR cuenta_destino_id=OLD.id)))
 OR (OLD.entidad_id IS NOT NULL AND NEW.entidad_id IS NOT OLD.entidad_id AND (
 EXISTS(SELECT 1 FROM g_pagos WHERE cuenta_id=OLD.id) OR
 EXISTS(SELECT 1 FROM fin_movimientos WHERE cuenta_id=OLD.id)))
BEGIN SELECT RAISE(ABORT,'cuenta_en_uso'); END;

-- Los comprobantes de una conciliación pertenecen al movimiento original. Se
-- amplía el catálogo sin cambiar las filas ni las claves privadas existentes.
ALTER TABLE g_documentos RENAME TO g_documentos_0054_anterior;
CREATE TABLE g_documentos (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK(tipo IN ('prestamo','compra','factura','movimiento')),
  objeto_id TEXT NOT NULL,
  clase TEXT NOT NULL,
  nombre TEXT NOT NULL,
  mime TEXT NOT NULL,
  ext TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes > 0),
  sha256 TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  autor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tipo, objeto_id, sha256)
);
INSERT INTO g_documentos (id,tipo,objeto_id,clase,nombre,mime,ext,bytes,sha256,key,version,autor,created_at)
SELECT id,tipo,objeto_id,clase,nombre,mime,ext,bytes,sha256,key,version,autor,created_at
FROM g_documentos_0054_anterior;
DROP TABLE g_documentos_0054_anterior;
CREATE INDEX g_documentos_objeto ON g_documentos(tipo, objeto_id, created_at);
