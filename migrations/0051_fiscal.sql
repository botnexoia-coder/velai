-- Registro interno de originales externos. No es un sistema emisor ni presenta AEAT.
CREATE TABLE g_facturas (
  id TEXT PRIMARY KEY,
  entidad_id TEXT NOT NULL REFERENCES g_entidades(id),
  negocio TEXT NOT NULL CHECK(negocio IN ('velai','coches','dialogos','comun')),
  tipo TEXT NOT NULL CHECK(tipo IN ('recibida','emitida')),
  estado TEXT NOT NULL CHECK(estado IN ('borrador','registrada','validada')),
  origen TEXT NOT NULL CHECK(origen IN ('externa','borrador')),
  clase TEXT NOT NULL DEFAULT 'ordinaria' CHECK(clase IN ('ordinaria','rectificativa')),
  tratamiento_fiscal TEXT NOT NULL DEFAULT 'pendiente' CHECK(tratamiento_fiscal IN ('pendiente','general','exento','no_sujeto','inversion','rebu')),
  nota_fiscal TEXT,
  contraparte_nif TEXT,
  contraparte_nombre TEXT,
  contraparte_direccion TEXT,
  numero TEXT,
  fecha_emision TEXT,
  fecha_operacion TEXT,
  fecha_recepcion TEXT,
  moneda TEXT NOT NULL CHECK(moneda IN ('EUR','COP')),
  compra_id TEXT REFERENCES g_compras(id),
  proveedor_emision TEXT,
  nota TEXT,
  base INTEGER NOT NULL,
  iva INTEGER NOT NULL,
  retencion INTEGER NOT NULL,
  total INTEGER NOT NULL,
  iva_deducible INTEGER NOT NULL DEFAULT 0,
  lineas_json TEXT NOT NULL,
  snapshot_json TEXT,
  revision TEXT,
  correccion_de TEXT UNIQUE REFERENCES g_facturas(id),
  motivo_correccion TEXT,
  rectifica_id TEXT REFERENCES g_facturas(id),
  root_id TEXT NOT NULL,
  external_key TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  request_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(total=base+iva-retencion),
  CHECK((iva >= 0 AND iva_deducible BETWEEN 0 AND iva) OR (iva < 0 AND iva_deducible BETWEEN iva AND 0))
);
CREATE INDEX g_facturas_scope ON g_facturas(entidad_id,moneda,fecha_operacion,fecha_emision);
-- El duplicado de una factura externa no se resuelve inventando otro UUID.
CREATE UNIQUE INDEX g_facturas_external ON g_facturas(external_key) WHERE correccion_de IS NULL AND external_key IS NOT NULL;
CREATE TABLE g_fiscal_eventos (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  objeto_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  fecha TEXT NOT NULL,
  detalle_json TEXT NOT NULL
);
CREATE TABLE g_fiscal_cierres (
  id TEXT PRIMARY KEY,
  entidad_id TEXT NOT NULL REFERENCES g_entidades(id),
  moneda TEXT NOT NULL CHECK(moneda IN ('EUR','COP')),
  desde TEXT NOT NULL,
  hasta TEXT NOT NULL CHECK(hasta >= desde),
  estado TEXT NOT NULL DEFAULT 'cerrado' CHECK(estado IN ('cerrado','reabierto')),
  snapshot_json TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  nota TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  reabierto_por TEXT,
  reabierto_en TEXT,
  motivo_reapertura TEXT
);
CREATE TRIGGER g_factura_validada_inmutable BEFORE UPDATE ON g_facturas WHEN OLD.estado='validada'
BEGIN SELECT RAISE(ABORT,'factura_inmutable'); END;
CREATE TRIGGER g_factura_no_delete BEFORE DELETE ON g_facturas
BEGIN SELECT RAISE(ABORT,'factura_no_borrable'); END;
-- Una nueva razón social/dirección conserva snapshots. Otro NIF o naturaleza
-- jurídica requiere otra entidad: no puede compartir un libro con la anterior.
-- Las revisiones originales siguen validadas aunque hayan sido sustituidas.
CREATE TRIGGER g_entidad_identidad_fiscal BEFORE UPDATE OF nif,tipo ON g_entidades
WHEN (UPPER(TRIM(COALESCE(NEW.nif,'')))<>UPPER(TRIM(COALESCE(OLD.nif,''))) OR NEW.tipo<>OLD.tipo)
 AND EXISTS(SELECT 1 FROM g_facturas f WHERE f.entidad_id=OLD.id AND f.estado='validada')
BEGIN SELECT RAISE(ABORT,'entidad_con_historico_fiscal'); END;
CREATE TRIGGER g_fiscal_evento_no_update BEFORE UPDATE ON g_fiscal_eventos
BEGIN SELECT RAISE(ABORT,'auditoria_inmutable'); END;
CREATE TRIGGER g_fiscal_evento_no_delete BEFORE DELETE ON g_fiscal_eventos
BEGIN SELECT RAISE(ABORT,'auditoria_inmutable'); END;
CREATE TRIGGER g_factura_periodo_insert BEFORE INSERT ON g_facturas
WHEN EXISTS (SELECT 1 FROM g_fiscal_cierres c WHERE c.estado='cerrado' AND c.entidad_id=NEW.entidad_id
 AND c.moneda=NEW.moneda AND COALESCE(NEW.fecha_operacion,NEW.fecha_emision) BETWEEN c.desde AND c.hasta)
BEGIN SELECT RAISE(ABORT,'periodo_cerrado'); END;
CREATE TRIGGER g_factura_periodo_update BEFORE UPDATE ON g_facturas
WHEN EXISTS (SELECT 1 FROM g_fiscal_cierres c WHERE c.estado='cerrado' AND
 ((c.entidad_id=NEW.entidad_id AND c.moneda=NEW.moneda AND COALESCE(NEW.fecha_operacion,NEW.fecha_emision) BETWEEN c.desde AND c.hasta)
 OR (c.entidad_id=OLD.entidad_id AND c.moneda=OLD.moneda AND COALESCE(OLD.fecha_operacion,OLD.fecha_emision) BETWEEN c.desde AND c.hasta)))
BEGIN SELECT RAISE(ABORT,'periodo_cerrado'); END;
CREATE TRIGGER g_fiscal_cierre_no_solapar BEFORE INSERT ON g_fiscal_cierres
WHEN EXISTS (SELECT 1 FROM g_fiscal_cierres c WHERE c.estado='cerrado' AND c.entidad_id=NEW.entidad_id
 AND c.moneda=NEW.moneda AND NEW.desde<=c.hasta AND NEW.hasta>=c.desde)
BEGIN SELECT RAISE(ABORT,'periodo_ya_cerrado'); END;
-- Valida el conjunto y las versiones DENTRO de la transacción de cierre: impide
-- aceptar un snapshot calculado antes de una escritura concurrente.
CREATE TRIGGER g_fiscal_snapshot_actual BEFORE INSERT ON g_fiscal_cierres
WHEN (SELECT COUNT(*) FROM g_facturas f WHERE f.entidad_id=NEW.entidad_id AND f.moneda=NEW.moneda
 AND COALESCE(f.fecha_operacion,f.fecha_emision) BETWEEN NEW.desde AND NEW.hasta) <> json_array_length(NEW.snapshot_json,'$.facturas')
 OR EXISTS (SELECT 1 FROM json_each(NEW.snapshot_json,'$.facturas') j
 WHERE NOT EXISTS (SELECT 1 FROM g_facturas f WHERE f.id=json_extract(j.value,'$.id')
 AND f.version=json_extract(j.value,'$.version') AND f.entidad_id=NEW.entidad_id AND f.moneda=NEW.moneda
 AND COALESCE(f.fecha_operacion,f.fecha_emision) BETWEEN NEW.desde AND NEW.hasta))
BEGIN SELECT RAISE(ABORT,'cierre_desactualizado'); END;
CREATE TRIGGER g_fiscal_cierre_no_delete BEFORE DELETE ON g_fiscal_cierres
BEGIN SELECT RAISE(ABORT,'cierre_inmutable'); END;
CREATE TRIGGER g_fiscal_cierre_guard BEFORE UPDATE ON g_fiscal_cierres
WHEN OLD.estado<>'cerrado' OR NEW.estado<>'reabierto' OR NEW.version<>OLD.version+1
 OR NEW.id<>OLD.id OR NEW.entidad_id<>OLD.entidad_id OR NEW.moneda<>OLD.moneda
 OR NEW.desde<>OLD.desde OR NEW.hasta<>OLD.hasta OR NEW.snapshot_json<>OLD.snapshot_json
 OR NEW.sha256<>OLD.sha256 OR NEW.request_hash<>OLD.request_hash
 OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
 OR NEW.nota IS NOT OLD.nota OR NEW.reabierto_por IS NULL OR NEW.reabierto_en IS NULL
 OR length(trim(COALESCE(NEW.motivo_reapertura,'')))<5
BEGIN SELECT RAISE(ABORT,'cierre_inmutable'); END;
