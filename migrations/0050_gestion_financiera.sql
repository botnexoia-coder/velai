-- Administración financiera (docs/SPEC-ADMINISTRACION-FINANCIERA.md).
-- Aditiva: el libro fin_movimientos sigue siendo EL registro de caja; las tablas g_*
-- añaden entidades, cuentas, préstamos, compras, pagos, documentos y auditoría.
-- Ninguna fila anterior se reinterpreta: naturaleza 'operativo' y sin cuenta/pagador.

-- ── Catálogos ────────────────────────────────────────────────────────────────
CREATE TABLE g_entidades (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('autonomo','sociedad','promotores')),
  nif TEXT,
  direccion TEXT,
  -- Activar exige identificación fiscal; el perfil incompleto se ve, no se oculta.
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','activa')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE g_cuentas (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  entidad_id TEXT REFERENCES g_entidades(id),
  moneda TEXT NOT NULL CHECK(moneda IN ('EUR','COP')),
  saldo_inicial INTEGER NOT NULL DEFAULT 0 CHECK(typeof(saldo_inicial) = 'integer'),
  fecha_saldo TEXT,
  -- 0 = saldo pendiente de conciliar con el banco: se muestra como pendiente, nunca
  -- como saldo bancario verificado.
  conciliada INTEGER NOT NULL DEFAULT 0 CHECK(conciliada IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX g_cuentas_moneda ON g_cuentas(moneda, nombre);

-- ── Un solo registro de caja: fin_movimientos clasificado ───────────────────
-- naturaleza: operativo (ventas/gastos del negocio, el legado), financiacion (abono de
-- préstamo y devolución de principal: ni venta ni gasto), financiero (intereses y
-- comisiones: gasto real), compra (inversión/pago pendiente de tratamiento fiscal), reembolso_socio (devolver un anticipo: salida, no gasto).
ALTER TABLE fin_movimientos ADD COLUMN naturaleza TEXT NOT NULL DEFAULT 'operativo'
  CHECK(naturaleza IN ('operativo','financiacion','financiero','reembolso_socio','compra'));
-- Un reverso es una partida espejo con signo -1: el libro es append-only, nada se
-- edita ni se borra, y las sumas (importe*signo) vuelven a cuadrar.
ALTER TABLE fin_movimientos ADD COLUMN signo INTEGER NOT NULL DEFAULT 1 CHECK(signo IN (1,-1));
ALTER TABLE fin_movimientos ADD COLUMN origen_tipo TEXT
  CHECK(origen_tipo IS NULL OR origen_tipo IN ('prestamo_desembolso','prestamo_pago','compra_pago','compra_reembolso','reverso'));
ALTER TABLE fin_movimientos ADD COLUMN origen_id TEXT;
ALTER TABLE fin_movimientos ADD COLUMN cuenta_id TEXT REFERENCES g_cuentas(id);
ALTER TABLE fin_movimientos ADD COLUMN entidad_id TEXT REFERENCES g_entidades(id);
CREATE INDEX fin_mov_origen ON fin_movimientos(origen_tipo, origen_id);
CREATE INDEX fin_mov_cuenta ON fin_movimientos(cuenta_id);

-- Las partidas creadas por gestión son inmutables también por debajo del panel
-- legado: cualquier UPDATE/DELETE aborta. Las filas históricas (origen NULL) siguen
-- editándose como siempre.
CREATE TRIGGER fin_mov_gestion_sin_update BEFORE UPDATE ON fin_movimientos
WHEN OLD.origen_tipo IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'fin_movimiento_gestion');
END;
CREATE TRIGGER fin_mov_gestion_sin_delete BEFORE DELETE ON fin_movimientos
WHEN OLD.origen_tipo IS NOT NULL
BEGIN
  SELECT RAISE(ABORT,'fin_movimiento_gestion');
END;

-- Conceptos que firman las partidas de gestión, localizados por CLAVE estable y no
-- por nombre (misma lección que el concepto de reparto en 0037). Si ya existe un
-- concepto con ese nombre, se reutiliza y se marca.
ALTER TABLE fin_conceptos ADD COLUMN clave TEXT;
CREATE UNIQUE INDEX fin_conceptos_clave ON fin_conceptos(clave) WHERE clave IS NOT NULL;
INSERT OR IGNORE INTO fin_conceptos (tipo,nombre,position,created_by,created_at) VALUES
 ('ingreso','Financiación recibida',(SELECT COALESCE(MAX(position),-1)+1 FROM fin_conceptos WHERE tipo='ingreso'),'migracion',datetime('now')),
 ('egreso','Devolución de principal',(SELECT COALESCE(MAX(position),-1)+1 FROM fin_conceptos WHERE tipo='egreso'),'migracion',datetime('now')),
 ('gasto','Intereses y comisiones de financiación',(SELECT COALESCE(MAX(position),-1)+1 FROM fin_conceptos WHERE tipo='gasto'),'migracion',datetime('now')),
 ('gasto','Compras e inversiones',(SELECT COALESCE(MAX(position),-1)+1 FROM fin_conceptos WHERE tipo='gasto'),'migracion',datetime('now')),
 ('egreso','Reembolso de anticipo a socio',(SELECT COALESCE(MAX(position),-1)+1 FROM fin_conceptos WHERE tipo='egreso'),'migracion',datetime('now'));
UPDATE fin_conceptos SET clave='g_financiacion' WHERE clave IS NULL AND tipo='ingreso' AND nombre='Financiación recibida';
UPDATE fin_conceptos SET clave='g_capital' WHERE clave IS NULL AND tipo='egreso' AND nombre='Devolución de principal';
UPDATE fin_conceptos SET clave='g_financiero' WHERE clave IS NULL AND tipo='gasto' AND nombre='Intereses y comisiones de financiación';
UPDATE fin_conceptos SET clave='g_compra' WHERE clave IS NULL AND tipo='gasto' AND nombre='Compras e inversiones';
UPDATE fin_conceptos SET clave='g_reembolso_socio' WHERE clave IS NULL AND tipo='egreso' AND nombre='Reembolso de anticipo a socio';

-- ── Préstamos ────────────────────────────────────────────────────────────────
-- El alta registra condiciones y proyección; la caja solo se mueve con el desembolso
-- confirmado (fecha_abono) y con cada pago real. Basis points: 1200 = 12,00 %.
CREATE TABLE g_prestamos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  cuenta_id TEXT NOT NULL REFERENCES g_cuentas(id),
  principal INTEGER NOT NULL CHECK(principal > 0 AND typeof(principal) = 'integer'),
  apertura INTEGER NOT NULL DEFAULT 0 CHECK(apertura >= 0),
  cuota INTEGER NOT NULL CHECK(cuota > 0),
  tin_bp INTEGER NOT NULL CHECK(tin_bp >= 0),
  tae_bp INTEGER NOT NULL CHECK(tae_bp >= 0),
  meses INTEGER NOT NULL CHECK(meses BETWEEN 1 AND 600),
  -- Número de cuotas cuyo importe se aparta del saldo (reserva_inicial = n × cuota).
  reserva_cuotas INTEGER NOT NULL DEFAULT 0 CHECK(reserva_cuotas >= 0 AND reserva_cuotas <= meses),
  fecha_abono TEXT,
  primer_vencimiento TEXT,
  condiciones TEXT NOT NULL DEFAULT '[]',
  -- Desembolso confirmado UNA vez: id de la operación (idempotencia) e importe abonado.
  desembolso_id TEXT UNIQUE,
  desembolsado INTEGER,
  apertura_cobrada INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((fecha_abono IS NULL AND desembolso_id IS NULL) OR (fecha_abono IS NOT NULL AND desembolso_id IS NOT NULL))
);
CREATE INDEX g_prestamos_cuenta ON g_prestamos(cuenta_id);
-- Dos confirmaciones simultáneas del abono: la segunda aborta su transacción entera
-- (partidas de caja incluidas) en vez de duplicar la financiación.
CREATE TRIGGER g_prestamos_desembolso_unico BEFORE UPDATE OF desembolso_id ON g_prestamos
WHEN OLD.desembolso_id IS NOT NULL AND NEW.desembolso_id IS NOT OLD.desembolso_id
BEGIN
  SELECT RAISE(ABORT,'g_prestamo_ya_desembolsado');
END;

-- ── Compras ──────────────────────────────────────────────────────────────────
CREATE TABLE g_compras (
  id TEXT PRIMARY KEY,
  concepto TEXT NOT NULL,
  negocio TEXT NOT NULL CHECK(negocio IN ('velai','coches','dialogos','comun')),
  entidad_id TEXT REFERENCES g_entidades(id),
  prestamo_id TEXT REFERENCES g_prestamos(id),
  moneda TEXT NOT NULL CHECK(moneda IN ('EUR','COP')),
  estimado INTEGER NOT NULL CHECK(estimado >= 0),
  real INTEGER CHECK(real IS NULL OR real >= 0),
  estado TEXT NOT NULL DEFAULT 'prevista' CHECK(estado IN ('prevista','comprometida','comprada','cancelada')),
  comprador TEXT,
  proveedor TEXT,
  fecha_prevista TEXT,
  fecha_compra TEXT,
  categoria TEXT NOT NULL DEFAULT 'otros',
  nota TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((estado = 'comprada' AND real IS NOT NULL) OR estado <> 'comprada')
);
CREATE INDEX g_compras_estado ON g_compras(estado, negocio, moneda);

-- ── Pagos (préstamos y compras), reembolsos y reversos ──────────────────────
-- Nada se borra: un error se corrige con un reverso explícito que deja la fila
-- original marcada y una fila espejo. El pago de un socio es un anticipo: queda aquí,
-- NO en caja común; el reembolso sí sale de caja (una sola vez).
CREATE TABLE g_pagos (
  id TEXT PRIMARY KEY,
  objeto_tipo TEXT NOT NULL CHECK(objeto_tipo IN ('prestamo','compra')),
  objeto_id TEXT NOT NULL,
  clase TEXT NOT NULL CHECK(clase IN ('pago','reembolso','reverso')),
  pago_id TEXT REFERENCES g_pagos(id),
  numero INTEGER CHECK(numero IS NULL OR numero > 0),
  fecha TEXT NOT NULL,
  moneda TEXT NOT NULL CHECK(moneda IN ('EUR','COP')),
  importe INTEGER NOT NULL CHECK(importe > 0 AND typeof(importe) = 'integer'),
  capital INTEGER NOT NULL DEFAULT 0 CHECK(capital >= 0),
  interes INTEGER NOT NULL DEFAULT 0 CHECK(interes >= 0),
  comision INTEGER NOT NULL DEFAULT 0 CHECK(comision >= 0),
  pagador TEXT NOT NULL CHECK(pagador IN ('cuenta','socio')),
  cuenta_id TEXT REFERENCES g_cuentas(id),
  socio TEXT,
  nota TEXT,
  motivo TEXT,
  estado TEXT NOT NULL DEFAULT 'activo' CHECK(estado IN ('activo','revertido')),
  reverso_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK((pagador = 'cuenta' AND cuenta_id IS NOT NULL AND socio IS NULL) OR (pagador = 'socio' AND socio IS NOT NULL AND cuenta_id IS NULL)),
  CHECK((clase = 'pago' AND pago_id IS NULL) OR (clase <> 'pago' AND pago_id IS NOT NULL))
);
CREATE INDEX g_pagos_objeto ON g_pagos(objeto_tipo, objeto_id, clase, estado);
CREATE INDEX g_pagos_origen ON g_pagos(pago_id);
-- Un pago solo se revierte una vez, también bajo dos peticiones simultáneas.
CREATE UNIQUE INDEX g_pagos_reverso_unico ON g_pagos(pago_id) WHERE clase = 'reverso';
-- Los importes y fechas de un pago no se corrigen: se revierte y se vuelve a registrar.
CREATE TRIGGER g_pagos_inmutable BEFORE UPDATE ON g_pagos
WHEN NEW.importe <> OLD.importe OR NEW.capital <> OLD.capital OR NEW.interes <> OLD.interes
  OR NEW.comision <> OLD.comision OR NEW.fecha <> OLD.fecha OR NEW.clase <> OLD.clase
  OR NEW.objeto_id <> OLD.objeto_id OR NEW.pagador <> OLD.pagador OR OLD.estado = 'revertido'
BEGIN
  SELECT RAISE(ABORT,'g_pago_inmutable');
END;
CREATE TRIGGER g_pagos_sin_delete BEFORE DELETE ON g_pagos
BEGIN
  SELECT RAISE(ABORT,'g_pago_inmutable');
END;

-- ── Documentos privados (binding FINANCE_DOCS, nunca MEDIA) ─────────────────
-- La clave del objeto la genera el worker; el cliente solo conoce el id.
CREATE TABLE g_documentos (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK(tipo IN ('prestamo','compra','factura')),
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
CREATE INDEX g_documentos_objeto ON g_documentos(tipo, objeto_id, created_at);

-- ── Idempotencia de los POST con id del cliente ──────────────────────────────
-- La misma clave con la misma huella repite la respuesta; con otra huella es 409.
CREATE TABLE g_idempotencia (
  clave TEXT PRIMARY KEY,
  ruta TEXT NOT NULL,
  huella TEXT NOT NULL,
  resultado_id TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ── Auditoría append-only de toda mutación ───────────────────────────────────
CREATE TABLE g_auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  actor TEXT NOT NULL,
  accion TEXT NOT NULL,
  objeto_tipo TEXT NOT NULL,
  objeto_id TEXT NOT NULL,
  detalle TEXT
);
CREATE INDEX g_auditoria_objeto ON g_auditoria(objeto_tipo, objeto_id, id);
CREATE TRIGGER g_auditoria_sin_update BEFORE UPDATE ON g_auditoria
BEGIN
  SELECT RAISE(ABORT,'g_auditoria_inmutable');
END;
CREATE TRIGGER g_auditoria_sin_delete BEFORE DELETE ON g_auditoria
BEGIN
  SELECT RAISE(ABORT,'g_auditoria_inmutable');
END;

-- CAS de operaciones monetarias: reclamar la versión leída antes de validar evita
-- que dos batches confirmen contra el mismo pendiente o contra condiciones antiguas.
CREATE TRIGGER g_prestamos_version BEFORE UPDATE OF version ON g_prestamos
WHEN NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT,'version_conflicto'); END;
CREATE TRIGGER g_compras_version BEFORE UPDATE OF version ON g_compras
WHEN NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT,'version_conflicto'); END;
-- Los catálogos y la caja deben seguir coincidiendo incluso si las peticiones
-- cambiaron la cuenta entre la validación en JS y la escritura.
CREATE TRIGGER g_cuentas_identidad BEFORE UPDATE OF moneda,entidad_id ON g_cuentas
WHEN (NEW.moneda <> OLD.moneda AND (
 EXISTS(SELECT 1 FROM g_prestamos WHERE cuenta_id=OLD.id) OR
 EXISTS(SELECT 1 FROM g_pagos WHERE cuenta_id=OLD.id) OR
 EXISTS(SELECT 1 FROM fin_movimientos WHERE cuenta_id=OLD.id)))
 OR (OLD.entidad_id IS NOT NULL AND NEW.entidad_id IS NOT OLD.entidad_id AND (
 EXISTS(SELECT 1 FROM g_pagos WHERE cuenta_id=OLD.id) OR
 EXISTS(SELECT 1 FROM fin_movimientos WHERE cuenta_id=OLD.id)))
BEGIN SELECT RAISE(ABORT,'cuenta_en_uso'); END;
CREATE TRIGGER g_prestamos_cuenta_insert BEFORE INSERT ON g_prestamos
WHEN NOT EXISTS(SELECT 1 FROM g_cuentas WHERE id=NEW.cuenta_id AND moneda='EUR')
BEGIN SELECT RAISE(ABORT,'moneda_distinta'); END;
CREATE TRIGGER g_prestamos_cuenta_update BEFORE UPDATE OF cuenta_id ON g_prestamos
WHEN NOT EXISTS(SELECT 1 FROM g_cuentas WHERE id=NEW.cuenta_id AND moneda='EUR')
BEGIN SELECT RAISE(ABORT,'moneda_distinta'); END;
-- D1 remoto puede confundir END de CASE con el cierre del trigger. Agrupar CASE
-- conserva la expresión y evita ese corte: cloudflare/workers-sdk#4727.
CREATE TRIGGER fin_mov_cuenta_insert BEFORE INSERT ON fin_movimientos
WHEN NEW.cuenta_id IS NOT NULL
BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM g_cuentas WHERE id=NEW.cuenta_id) THEN RAISE(ABORT,'cuenta_invalida') END);
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM g_cuentas WHERE id=NEW.cuenta_id AND moneda=NEW.moneda) THEN RAISE(ABORT,'moneda_distinta') END);
 -- Completar el titular de una cuenta no reescribe sus partidas históricas NULL.
 -- Un reverso puede conservar ese NULL únicamente si refleja la partida original.
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM g_cuentas WHERE id=NEW.cuenta_id AND entidad_id IS NEW.entidad_id)
 AND NOT (NEW.origen_tipo='reverso' AND NEW.entidad_id IS NULL AND EXISTS(
   SELECT 1 FROM g_pagos r JOIN fin_movimientos m ON m.origen_id=r.pago_id
   WHERE r.id=NEW.origen_id AND r.clase='reverso' AND m.cuenta_id=NEW.cuenta_id
     AND m.entidad_id IS NULL AND m.tipo=NEW.tipo AND m.concepto_id=NEW.concepto_id
     AND m.importe=NEW.importe AND m.signo=-NEW.signo
 )) THEN RAISE(ABORT,'entidad_cuenta_distinta') END);
END;
CREATE TRIGGER fin_mov_cuenta_update BEFORE UPDATE OF cuenta_id,moneda,entidad_id ON fin_movimientos
WHEN NEW.cuenta_id IS NOT NULL
BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM g_cuentas WHERE id=NEW.cuenta_id AND moneda=NEW.moneda) THEN RAISE(ABORT,'moneda_distinta') END);
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM g_cuentas WHERE id=NEW.cuenta_id AND entidad_id IS NEW.entidad_id) THEN RAISE(ABORT,'entidad_cuenta_distinta') END);
END;
-- Conceptos internos no pueden borrarse, renombrarse ni utilizarse en el alta manual.
CREATE TRIGGER fin_concepto_gestion_delete BEFORE DELETE ON fin_conceptos WHEN OLD.clave IS NOT NULL
BEGIN SELECT RAISE(ABORT,'concepto_del_sistema'); END;
CREATE TRIGGER fin_concepto_gestion_update BEFORE UPDATE ON fin_conceptos
WHEN OLD.clave IS NOT NULL AND (NEW.nombre<>OLD.nombre OR NEW.tipo<>OLD.tipo OR NEW.activo<>OLD.activo OR NEW.clave IS NOT OLD.clave)
BEGIN SELECT RAISE(ABORT,'concepto_del_sistema'); END;
CREATE TRIGGER fin_mov_concepto_gestion_insert BEFORE INSERT ON fin_movimientos
WHEN NEW.origen_tipo IS NULL AND EXISTS(SELECT 1 FROM fin_conceptos WHERE id=NEW.concepto_id AND clave IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'concepto_de_gestion'); END;
CREATE TRIGGER fin_mov_concepto_gestion_update BEFORE UPDATE OF concepto_id ON fin_movimientos
WHEN NEW.origen_tipo IS NULL AND NEW.concepto_id<>OLD.concepto_id AND EXISTS(SELECT 1 FROM fin_conceptos WHERE id=NEW.concepto_id AND clave IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'concepto_de_gestion'); END;
