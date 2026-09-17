-- Libro interno de Velai: sin propietario tenant, sin conversiones entre monedas.
CREATE TABLE fin_conceptos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK(tipo IN ('ingreso','gasto','egreso')),
  nombre TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1)),
  -- sistema = lo usa el código, no solo la persona. El de reparto se busca POR ESTA
  -- MARCA y no por su nombre: renombrarlo desde el panel dejaba los repartos rotos.
  sistema INTEGER NOT NULL DEFAULT 0 CHECK(sistema IN (0,1)),
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tipo, nombre)
);
CREATE TABLE fin_repartos (
  id TEXT PRIMARY KEY,
  fecha TEXT NOT NULL,
  moneda TEXT NOT NULL CHECK(moneda IN ('EUR','COP')),
  nota TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE fin_movimientos (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK(tipo IN ('ingreso','gasto','egreso')),
  concepto_id INTEGER NOT NULL REFERENCES fin_conceptos(id),
  fecha TEXT NOT NULL,
  moneda TEXT NOT NULL CHECK(moneda IN ('EUR','COP')),
  importe INTEGER NOT NULL CHECK(importe > 0 AND typeof(importe) = 'integer'),
  nota TEXT,
  tenant_id TEXT REFERENCES tenants(id),
  beneficiario TEXT,
  reparto_id TEXT REFERENCES fin_repartos(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK((reparto_id IS NULL AND beneficiario IS NULL) OR
        (reparto_id IS NOT NULL AND beneficiario IS NOT NULL AND tipo = 'egreso' AND tenant_id IS NULL))
);
CREATE INDEX fin_mov_fecha ON fin_movimientos(fecha DESC);
CREATE INDEX fin_mov_tipo ON fin_movimientos(tipo, moneda);
CREATE INDEX fin_mov_reparto ON fin_movimientos(reparto_id);
CREATE INDEX fin_mov_concepto ON fin_movimientos(concepto_id);
CREATE TABLE fin_socios (
  email TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1))
);
INSERT INTO fin_conceptos (tipo,nombre,position,created_by,created_at) VALUES
 ('ingreso','Cuota mensual de cliente',0,'migracion',datetime('now')),
 ('ingreso','Alta / implantación',1,'migracion',datetime('now')),
 ('ingreso','Desarrollo a medida',2,'migracion',datetime('now')),
 ('ingreso','Consultoría',3,'migracion',datetime('now')),
 ('ingreso','Otros ingresos',4,'migracion',datetime('now')),
 ('gasto','Anthropic (IA)',0,'migracion',datetime('now')),
 ('gasto','Cloudflare',1,'migracion',datetime('now')),
 ('gasto','Twilio',2,'migracion',datetime('now')),
 ('gasto','Meta',3,'migracion',datetime('now')),
 ('gasto','Dominios',4,'migracion',datetime('now')),
 ('gasto','Google Workspace',5,'migracion',datetime('now')),
 ('gasto','Otro software / SaaS',6,'migracion',datetime('now')),
 ('gasto','Publicidad',7,'migracion',datetime('now')),
 ('gasto','Asesoría y contabilidad',8,'migracion',datetime('now')),
 ('gasto','Comisiones bancarias',9,'migracion',datetime('now')),
 ('gasto','Otros gastos',10,'migracion',datetime('now')),
 ('egreso','Reparto a socios',0,'migracion',datetime('now')),
 ('egreso','Impuestos',1,'migracion',datetime('now')),
 ('egreso','Devolución a cliente',2,'migracion',datetime('now')),
 ('egreso','Anticipo o préstamo',3,'migracion',datetime('now')),
 ('egreso','Retirada a cuenta personal',4,'migracion',datetime('now')),
 ('egreso','Otros egresos',5,'migracion',datetime('now'));

-- El egreso que firman las líneas de cada reparto. Marcado, no nombrado: el panel
-- impide renombrarlo, desactivarlo y borrarlo, y el índice parcial garantiza que sea
-- exactamente uno por tipo.
UPDATE fin_conceptos SET sistema = 1 WHERE tipo = 'egreso' AND nombre = 'Reparto a socios';
CREATE UNIQUE INDEX fin_concepto_sistema ON fin_conceptos(tipo) WHERE sistema = 1;

-- Primer socio del libro. Esta tabla SOLO pone nombre a un correo: el acceso lo decide
-- SOCIOS_EMAILS (wrangler.toml) y además hace falta rol velai.
INSERT INTO fin_socios (email,nombre) VALUES ('juanesgarciag@gmail.com','Juan Esteban García');
