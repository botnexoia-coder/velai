-- Piloto: préstamos CONCEDIDOS. No modifica los créditos recibidos ni sus pagos.
CREATE TABLE g_equipo_prestamos (
 id TEXT PRIMARY KEY,titulo TEXT NOT NULL,cuenta_id TEXT NOT NULL REFERENCES g_cuentas(id),
 importe INTEGER NOT NULL CHECK(typeof(importe)='integer' AND importe>0),
 vencimiento TEXT NOT NULL,estado TEXT NOT NULL DEFAULT 'solicitado' CHECK(estado IN ('solicitado','aprobado','vigente','cancelado')),
 aprobado_por TEXT,fecha_desembolso TEXT,destino_titular TEXT,destino_referencia TEXT,
 comprobante_entrega TEXT REFERENCES g_documentos(id),nota TEXT,version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE g_equipo_participantes (
 prestamo_id TEXT NOT NULL REFERENCES g_equipo_prestamos(id),email TEXT NOT NULL REFERENCES fin_socios(email),
 importe INTEGER NOT NULL CHECK(typeof(importe)='integer' AND importe BETWEEN 1 AND 50000),PRIMARY KEY(prestamo_id,email)
);
CREATE TABLE g_equipo_devoluciones (
 id TEXT PRIMARY KEY,prestamo_id TEXT NOT NULL REFERENCES g_equipo_prestamos(id),
 participante_email TEXT NOT NULL,importe INTEGER NOT NULL CHECK(typeof(importe)='integer' AND importe>0),
 fecha TEXT NOT NULL,comprobante_id TEXT NOT NULL UNIQUE REFERENCES g_documentos(id),created_by TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(prestamo_id,participante_email) REFERENCES g_equipo_participantes(prestamo_id,email)
);
ALTER TABLE fin_movimientos ADD COLUMN equipo_prestamo_id TEXT REFERENCES g_equipo_prestamos(id);
INSERT OR IGNORE INTO fin_conceptos(tipo,nombre,sistema,position,created_by,created_at,clave) VALUES
 ('egreso','Préstamo concedido al equipo',0,90,'migracion',datetime('now'),'g_equipo_entrega'),
 ('ingreso','Devolución de préstamo del equipo',0,90,'migracion',datetime('now'),'g_equipo_devolucion');
UPDATE fin_conceptos SET clave='g_equipo_entrega' WHERE tipo='egreso' AND nombre='Préstamo concedido al equipo' AND clave IS NULL;
UPDATE fin_conceptos SET clave='g_equipo_devolucion' WHERE tipo='ingreso' AND nombre='Devolución de préstamo del equipo' AND clave IS NULL;
CREATE INDEX g_equipo_cuenta ON g_equipo_prestamos(cuenta_id,estado);
CREATE INDEX g_equipo_persona ON g_equipo_participantes(email,prestamo_id);
CREATE VIEW g_equipo_exposicion AS
 SELECT p.prestamo_id,p.email,p.importe-COALESCE((SELECT SUM(d.importe) FROM g_equipo_devoluciones d WHERE d.prestamo_id=p.prestamo_id AND d.participante_email=p.email),0) AS pendiente
 FROM g_equipo_participantes p JOIN g_equipo_prestamos l ON l.id=p.prestamo_id WHERE l.estado IN ('aprobado','vigente');
CREATE VIEW g_equipo_cuentas AS
 SELECT c.*,
 c.saldo_inicial+COALESCE((SELECT SUM(CASE WHEN m.tipo='ingreso' THEN m.importe*m.signo ELSE -m.importe*m.signo END) FROM fin_movimientos m WHERE m.cuenta_id=c.id AND (c.fecha_saldo IS NULL OR (CASE WHEN m.requiere_conciliacion=1 AND m.conciliada=1 THEN m.conciliacion_fecha ELSE m.fecha END)>c.fecha_saldo)),0)
 +COALESCE((SELECT SUM(CASE WHEN t.cuenta_destino_id=c.id THEN t.importe*t.signo ELSE -t.importe*t.signo END) FROM fin_traspasos t WHERE (t.cuenta_origen_id=c.id OR t.cuenta_destino_id=c.id) AND (c.fecha_saldo IS NULL OR t.fecha>c.fecha_saldo)),0) AS saldo,
 COALESCE((SELECT SUM(MAX(0,p.reserva_cuotas*p.cuota-COALESCE((SELECT SUM(g.capital+g.interes) FROM g_pagos g WHERE g.objeto_tipo='prestamo' AND g.objeto_id=p.id AND g.clase='pago' AND g.estado='activo'),0))) FROM g_prestamos p WHERE p.cuenta_id=c.id AND COALESCE(p.desembolsado,0)>0),0) AS reserva,
 COALESCE((SELECT SUM(p.importe) FROM g_equipo_prestamos p WHERE p.cuenta_id=c.id AND p.estado='aprobado'),0) AS aprobado
 FROM g_cuentas c WHERE c.moneda='EUR';
CREATE VIEW g_equipo_compromisos AS SELECT
 COALESCE((SELECT SUM(MAX(0,COALESCE(c.real,c.estimado)-COALESCE((SELECT SUM(p.importe) FROM g_pagos p WHERE p.objeto_tipo='compra' AND p.objeto_id=c.id AND p.clase='pago' AND p.estado='activo'),0))) FROM g_compras c WHERE c.moneda='EUR' AND c.estado IN ('comprometida','comprada')),0)
 +COALESCE((SELECT SUM(CASE WHEN p.clase='pago' AND p.pagador='socio' THEN p.importe WHEN p.clase='reembolso' THEN -p.importe ELSE 0 END) FROM g_pagos p WHERE p.objeto_tipo='compra' AND p.estado='activo' AND p.moneda='EUR'),0)
 +COALESCE((SELECT SUM(m.importe) FROM fin_movimientos m WHERE m.moneda='EUR' AND m.requiere_conciliacion=1 AND m.conciliada=0),0) AS importe;
CREATE TRIGGER g_equipo_uuid BEFORE INSERT ON g_equipo_prestamos WHEN EXISTS(SELECT 1 FROM g_prestamos WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'equipo_id_duplicado'); END;
CREATE TRIGGER g_credito_uuid BEFORE INSERT ON g_prestamos WHEN EXISTS(SELECT 1 FROM g_equipo_prestamos WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'equipo_id_duplicado'); END;
CREATE TRIGGER g_equipo_version BEFORE UPDATE ON g_equipo_prestamos
 WHEN NEW.version<>OLD.version+1 BEGIN SELECT RAISE(ABORT,'version_conflicto'); END;
CREATE TRIGGER g_equipo_sin_borrar BEFORE DELETE ON g_equipo_prestamos BEGIN SELECT RAISE(ABORT,'equipo_inmutable'); END;
CREATE TRIGGER g_equipo_guard BEFORE UPDATE OF estado ON g_equipo_prestamos WHEN NEW.estado IN ('aprobado','vigente') AND NEW.estado<>OLD.estado BEGIN
 SELECT RAISE(ABORT,'equipo_estado_invalido') WHERE NOT ((OLD.estado='solicitado' AND NEW.estado='aprobado') OR (OLD.estado='aprobado' AND NEW.estado='vigente'));
 SELECT RAISE(ABORT,'equipo_autoaprobacion') WHERE NEW.aprobado_por IS NULL OR EXISTS(SELECT 1 FROM g_equipo_participantes WHERE prestamo_id=NEW.id AND lower(email)=lower(NEW.aprobado_por));
 SELECT RAISE(ABORT,'equipo_participantes_invalidos') WHERE NEW.importe<>COALESCE((SELECT SUM(importe) FROM g_equipo_participantes WHERE prestamo_id=NEW.id),0) OR EXISTS(SELECT 1 FROM g_equipo_participantes p LEFT JOIN fin_socios s ON s.email=p.email WHERE p.prestamo_id=NEW.id AND COALESCE(s.activo,0)<>1);
 SELECT RAISE(ABORT,'equipo_limite_persona') WHERE NEW.estado='aprobado' AND EXISTS(SELECT 1 FROM g_equipo_participantes p WHERE p.prestamo_id=NEW.id AND p.importe+COALESCE((SELECT SUM(e.pendiente) FROM g_equipo_exposicion e WHERE e.email=p.email),0)>50000);
 SELECT RAISE(ABORT,'equipo_sin_liquidez') WHERE NOT EXISTS(SELECT 1 FROM g_equipo_cuentas WHERE id=NEW.cuenta_id AND conciliada=1 AND saldo-reserva-aprobado>=CASE WHEN NEW.estado='aprobado' THEN NEW.importe ELSE 0 END)
 OR COALESCE((SELECT SUM(saldo-reserva-aprobado) FROM g_equipo_cuentas WHERE conciliada=1),0)-(SELECT importe FROM g_equipo_compromisos)<CASE WHEN NEW.estado='aprobado' THEN NEW.importe ELSE 0 END;
 SELECT RAISE(ABORT,'equipo_comprobante_requerido') WHERE NEW.estado='vigente' AND NOT EXISTS(SELECT 1 FROM g_documentos d WHERE d.id=NEW.comprobante_entrega AND d.tipo='prestamo' AND d.objeto_id=NEW.id AND d.clase='entrega');
END;
CREATE TRIGGER g_equipo_participante_guard BEFORE INSERT ON g_equipo_participantes BEGIN
 SELECT RAISE(ABORT,'equipo_participantes_invalidos') WHERE NOT EXISTS(SELECT 1 FROM g_equipo_prestamos WHERE id=NEW.prestamo_id AND estado='solicitado') OR NOT EXISTS(SELECT 1 FROM fin_socios WHERE email=NEW.email AND activo=1);
END;
CREATE TRIGGER g_equipo_participante_inmutable BEFORE UPDATE ON g_equipo_participantes BEGIN SELECT RAISE(ABORT,'equipo_inmutable'); END;
CREATE TRIGGER g_equipo_participante_sin_borrar BEFORE DELETE ON g_equipo_participantes BEGIN SELECT RAISE(ABORT,'equipo_inmutable'); END;
CREATE TRIGGER g_equipo_devolucion_guard BEFORE INSERT ON g_equipo_devoluciones BEGIN
 SELECT RAISE(ABORT,'equipo_estado_invalido') WHERE NOT EXISTS(SELECT 1 FROM g_equipo_prestamos WHERE id=NEW.prestamo_id AND estado='vigente' AND fecha_desembolso<=NEW.fecha);
 SELECT RAISE(ABORT,'equipo_pago_excesivo') WHERE NEW.importe>COALESCE((SELECT pendiente FROM g_equipo_exposicion WHERE prestamo_id=NEW.prestamo_id AND email=NEW.participante_email),0);
 SELECT RAISE(ABORT,'equipo_comprobante_requerido') WHERE NOT EXISTS(SELECT 1 FROM g_documentos WHERE id=NEW.comprobante_id AND tipo='prestamo' AND objeto_id=NEW.prestamo_id AND clase='devolucion');
END;
CREATE TRIGGER g_equipo_devolucion_inmutable BEFORE UPDATE ON g_equipo_devoluciones BEGIN SELECT RAISE(ABORT,'equipo_inmutable'); END;
CREATE TRIGGER g_equipo_devolucion_sin_borrar BEFORE DELETE ON g_equipo_devoluciones BEGIN SELECT RAISE(ABORT,'equipo_inmutable'); END;
