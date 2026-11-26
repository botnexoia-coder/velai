-- 0064 · Préstamos al equipo: límite de 1.000 EUR por persona y regularización histórica.
-- No modifica 0060 ni los créditos recibidos (g_prestamos, g_pagos, reserva de cuotas).
--
-- A) Límite por persona 500 → 1.000 EUR. SQLite no modifica un CHECK: se recrea
--    g_equipo_participantes CON EL MISMO NOMBRE (g_equipo_devoluciones la referencia por
--    clave foránea compuesta; un RENAME reescribiría esa referencia). Mismo método que 0063:
--    claves foráneas diferidas hasta el final de la transacción, datos copiados tal cual,
--    y se recrean su índice y sus tres triggers (DROP TABLE los elimina). La vista
--    g_equipo_exposicion no se toca: se resuelve por nombre.
PRAGMA defer_foreign_keys = true;
CREATE TABLE g_equipo_participantes_0064_copia AS SELECT * FROM g_equipo_participantes;
DROP TABLE g_equipo_participantes;
CREATE TABLE g_equipo_participantes (
 prestamo_id TEXT NOT NULL REFERENCES g_equipo_prestamos(id),email TEXT NOT NULL REFERENCES fin_socios(email),
 importe INTEGER NOT NULL CHECK(typeof(importe)='integer' AND importe BETWEEN 1 AND 100000),PRIMARY KEY(prestamo_id,email)
);
INSERT INTO g_equipo_participantes(prestamo_id,email,importe) SELECT prestamo_id,email,importe FROM g_equipo_participantes_0064_copia;
DROP TABLE g_equipo_participantes_0064_copia;
CREATE INDEX g_equipo_persona ON g_equipo_participantes(email,prestamo_id);
CREATE TRIGGER g_equipo_participante_guard BEFORE INSERT ON g_equipo_participantes BEGIN
 SELECT RAISE(ABORT,'equipo_participantes_invalidos') WHERE NOT EXISTS(SELECT 1 FROM g_equipo_prestamos WHERE id=NEW.prestamo_id AND estado='solicitado') OR NOT EXISTS(SELECT 1 FROM fin_socios WHERE email=NEW.email AND activo=1);
END;
CREATE TRIGGER g_equipo_participante_inmutable BEFORE UPDATE ON g_equipo_participantes BEGIN SELECT RAISE(ABORT,'equipo_inmutable'); END;
CREATE TRIGGER g_equipo_participante_sin_borrar BEFORE DELETE ON g_equipo_participantes BEGIN SELECT RAISE(ABORT,'equipo_inmutable'); END;

-- B) Regularización histórica: un préstamo cuyo dinero YA salió. Tabla auxiliar 1:1 con
--    g_equipo_prestamos (no se duplica el préstamo ni se amplía su CHECK de estado):
--    · borrador: fila base en 'solicitado' + esta fila 'borrador'. Sin movimiento, sin
--      exposición, sin reserva de capacidad; la vía normal (aprobar/desembolsar) queda cerrada.
--    · confirmado: la fila base pasa DIRECTAMENTE solicitado→vigente con UN movimiento de
--      principal. aprobado_por se queda NULL: no hubo aprobación independiente.
--    La ratificación independiente es un estado propio y arranca 'pendiente'. Ninguna ruta
--    la cambia todavía: requerirá una migración/endpoint posterior.
CREATE TABLE g_equipo_historico (
 prestamo_id TEXT PRIMARY KEY REFERENCES g_equipo_prestamos(id),
 estado TEXT NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador','confirmado')),
 deudor_declarado TEXT NOT NULL,destinatario TEXT NOT NULL,motivo_excepcion TEXT NOT NULL,
 credito_id TEXT REFERENCES g_prestamos(id),
 credito_cuota INTEGER CHECK(credito_cuota IS NULL OR (typeof(credito_cuota)='integer' AND credito_cuota>=1)),
 importe_cuota INTEGER CHECK(importe_cuota IS NULL OR (typeof(importe_cuota)='integer' AND importe_cuota>0)),
 importe_adicional INTEGER CHECK(importe_adicional IS NULL OR (typeof(importe_adicional)='integer' AND importe_adicional>=0)),
 fecha_cuota_proyectada TEXT,
 ratificacion TEXT NOT NULL DEFAULT 'pendiente' CHECK(ratificacion IN ('pendiente','ratificada','rechazada')),
 ratificado_por TEXT,ratificado_at TEXT,
 desvios TEXT,confirmado_por TEXT,confirmado_at TEXT,
 created_by TEXT NOT NULL,created_at TEXT NOT NULL,
 CHECK((credito_id IS NULL AND credito_cuota IS NULL AND importe_cuota IS NULL AND importe_adicional IS NULL AND fecha_cuota_proyectada IS NULL)
  OR (credito_id IS NOT NULL AND credito_cuota IS NOT NULL AND importe_cuota IS NOT NULL AND importe_adicional IS NOT NULL AND fecha_cuota_proyectada IS NOT NULL)),
 CHECK(ratificacion='pendiente' OR (ratificado_por IS NOT NULL AND ratificado_at IS NOT NULL))
);
CREATE INDEX g_equipo_historico_estado ON g_equipo_historico(estado,ratificacion);
CREATE TRIGGER g_equipo_historico_alta BEFORE INSERT ON g_equipo_historico BEGIN
 SELECT RAISE(ABORT,'equipo_historico_invalido') WHERE NEW.estado<>'borrador' OR NEW.ratificacion<>'pendiente' OR NEW.desvios IS NOT NULL OR NEW.confirmado_por IS NOT NULL OR NEW.ratificado_por IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM g_equipo_prestamos l WHERE l.id=NEW.prestamo_id AND l.estado='solicitado' AND l.aprobado_por IS NULL AND l.fecha_desembolso IS NULL)
  OR (NEW.credito_id IS NOT NULL AND NEW.importe_cuota+NEW.importe_adicional<>(SELECT importe FROM g_equipo_prestamos WHERE id=NEW.prestamo_id));
END;
-- Único UPDATE posible: borrador → confirmado. Después es inmutable (la ratificación futura
-- sustituirá este trigger en su propia migración).
CREATE TRIGGER g_equipo_historico_confirmar BEFORE UPDATE ON g_equipo_historico BEGIN
 SELECT RAISE(ABORT,'equipo_inmutable') WHERE OLD.estado<>'borrador' OR NEW.estado<>'confirmado' OR NEW.prestamo_id<>OLD.prestamo_id
  OR NEW.deudor_declarado<>OLD.deudor_declarado OR NEW.destinatario<>OLD.destinatario OR NEW.motivo_excepcion<>OLD.motivo_excepcion
  OR NEW.credito_id IS NOT OLD.credito_id OR NEW.credito_cuota IS NOT OLD.credito_cuota OR NEW.importe_cuota IS NOT OLD.importe_cuota
  OR NEW.importe_adicional IS NOT OLD.importe_adicional OR NEW.fecha_cuota_proyectada IS NOT OLD.fecha_cuota_proyectada
  OR NEW.ratificacion<>'pendiente' OR NEW.ratificado_por IS NOT NULL OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at;
 SELECT RAISE(ABORT,'equipo_historico_incompleto') WHERE NEW.confirmado_por IS NULL OR NEW.confirmado_at IS NULL OR NEW.desvios IS NULL
  OR NOT EXISTS(SELECT 1 FROM g_equipo_prestamos l WHERE l.id=NEW.prestamo_id AND l.estado='solicitado');
END;
CREATE TRIGGER g_equipo_historico_sin_borrar BEFORE DELETE ON g_equipo_historico BEGIN SELECT RAISE(ABORT,'equipo_inmutable'); END;

-- Guarda de transición (sustituye a la de 0060). Para préstamos normales conserva TODAS
-- sus reglas (autoaprobación, participantes activos, liquidez conciliada, comprobante) y
-- sube el límite por persona a 100000 céntimos. Para un histórico: solo
-- solicitado→vigente, con aprobado_por NULL, borrador ya confirmado, datos de entrega y
-- límite por persona sumando la exposición viva. La liquidez NO se exige (el dinero ya
-- salió): el desvío queda registrado en g_equipo_historico.desvios.
DROP TRIGGER g_equipo_guard;
CREATE TRIGGER g_equipo_guard BEFORE UPDATE OF estado ON g_equipo_prestamos WHEN NEW.estado IN ('aprobado','vigente') AND NEW.estado<>OLD.estado BEGIN
 SELECT RAISE(ABORT,'equipo_estado_invalido') WHERE NOT (
  (EXISTS(SELECT 1 FROM g_equipo_historico h WHERE h.prestamo_id=NEW.id) AND OLD.estado='solicitado' AND NEW.estado='vigente')
  OR (NOT EXISTS(SELECT 1 FROM g_equipo_historico h WHERE h.prestamo_id=NEW.id) AND ((OLD.estado='solicitado' AND NEW.estado='aprobado') OR (OLD.estado='aprobado' AND NEW.estado='vigente'))));
 SELECT RAISE(ABORT,'equipo_historico_invalido') WHERE EXISTS(SELECT 1 FROM g_equipo_historico h WHERE h.prestamo_id=NEW.id) AND NEW.aprobado_por IS NOT NULL;
 SELECT RAISE(ABORT,'equipo_historico_incompleto') WHERE EXISTS(SELECT 1 FROM g_equipo_historico h WHERE h.prestamo_id=NEW.id)
  AND (NOT EXISTS(SELECT 1 FROM g_equipo_historico h WHERE h.prestamo_id=NEW.id AND h.estado='confirmado')
   OR NEW.fecha_desembolso IS NULL OR NEW.destino_titular IS NULL OR NEW.destino_referencia IS NULL OR NEW.vencimiento<NEW.fecha_desembolso);
 SELECT RAISE(ABORT,'equipo_autoaprobacion') WHERE NOT EXISTS(SELECT 1 FROM g_equipo_historico h WHERE h.prestamo_id=NEW.id)
  AND (NEW.aprobado_por IS NULL OR EXISTS(SELECT 1 FROM g_equipo_participantes WHERE prestamo_id=NEW.id AND lower(email)=lower(NEW.aprobado_por)));
 SELECT RAISE(ABORT,'equipo_participantes_invalidos') WHERE NEW.importe<>COALESCE((SELECT SUM(importe) FROM g_equipo_participantes WHERE prestamo_id=NEW.id),0) OR EXISTS(SELECT 1 FROM g_equipo_participantes p LEFT JOIN fin_socios s ON s.email=p.email WHERE p.prestamo_id=NEW.id AND COALESCE(s.activo,0)<>1);
 SELECT RAISE(ABORT,'equipo_limite_persona') WHERE (NEW.estado='aprobado' OR EXISTS(SELECT 1 FROM g_equipo_historico h WHERE h.prestamo_id=NEW.id))
  AND EXISTS(SELECT 1 FROM g_equipo_participantes p WHERE p.prestamo_id=NEW.id AND p.importe+COALESCE((SELECT SUM(e.pendiente) FROM g_equipo_exposicion e WHERE e.email=p.email AND e.prestamo_id<>NEW.id),0)>100000);
 SELECT RAISE(ABORT,'equipo_sin_liquidez') WHERE NOT EXISTS(SELECT 1 FROM g_equipo_historico h WHERE h.prestamo_id=NEW.id)
  AND (NOT EXISTS(SELECT 1 FROM g_equipo_cuentas WHERE id=NEW.cuenta_id AND conciliada=1 AND saldo-reserva-aprobado>=CASE WHEN NEW.estado='aprobado' THEN NEW.importe ELSE 0 END)
   OR COALESCE((SELECT SUM(saldo-reserva-aprobado) FROM g_equipo_cuentas WHERE conciliada=1),0)-(SELECT importe FROM g_equipo_compromisos)<CASE WHEN NEW.estado='aprobado' THEN NEW.importe ELSE 0 END);
 SELECT RAISE(ABORT,'equipo_comprobante_requerido') WHERE NEW.estado='vigente' AND NOT EXISTS(SELECT 1 FROM g_documentos d WHERE d.id=NEW.comprobante_entrega AND d.tipo='prestamo' AND d.objeto_id=NEW.id AND d.clase='entrega');
END;

-- Un préstamo con dinero entregado no se cancela: haría desaparecer su exposición sin
-- que el libro lo revierta. Hace falta un reverso explícito (fuera de esta migración).
CREATE TRIGGER g_equipo_sin_cancelar_entregado BEFORE UPDATE OF estado ON g_equipo_prestamos WHEN OLD.estado='vigente' AND NEW.estado<>'vigente' BEGIN
 SELECT RAISE(ABORT,'equipo_reverso_requerido');
END;
-- Una sola salida de principal por préstamo: ni dos desembolsos ni un histórico duplicado.
CREATE UNIQUE INDEX fin_mov_equipo_entrega_unica ON fin_movimientos(equipo_prestamo_id)
 WHERE equipo_prestamo_id IS NOT NULL AND origen_tipo='prestamo_desembolso';
