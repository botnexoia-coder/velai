# Administración financiera Velai · contrato de implementación

Proyecto personal Velai/Nexo. Remoto botnexoia-coder/velai. Base 86452f4.
Dirección elegida por Sebas: aspecto del concepto 1 y funciones del 3, decisión delegada a Codex el 09/10/2026. Mantener React/Hono/D1 y Cloudflare Access. No publicar ni migrar remoto durante implementación. No introducir datos bancarios personales ni PDF reales en el repositorio público. Originales permanecen fuera del repo.

## Alcance integrado
Crédito separado con condiciones, reserva de cuotas, calendario previsto/pagos reales, documentos privados; compras previstas/realizadas, quién compró/pagó/registró, pago parcial, factura pendiente; facturas recibidas e importadas desde programa de emisión, borradores sin valor fiscal; libros/cierre y exportación para asesoría. Pacto/reparto automático desactivado. Toda cifra por moneda, cuenta y titular. La actividad personal del autónomo está FUERA de Velai. Sus facturas sirven solo como guía visual, sin importar datos ni integrar Declarando. Emisor, cuentas y libros propios de Velai; promotores/SL distinguidos. No autoaplicar IVA, deducibilidad ni REBU. No envío AEAT ni emisión fiscal propia sin motor/configuración conforme.

## Convenciones compartidas
Prefijo `/api/admin/gestion`. Todos los handlers verifican `esSocio` antes de DB/R2. GET listas `{items:[...]}`; POST/PATCH `{item:{...}}`. Errores HttpError. Importes enteros céntimos EUR/pesos COP. Solo EUR en préstamos iniciales. IDs UUID suministrados por cliente en POST para idempotencia; mismo ID distinto cuerpo => 409. PATCH requiere `version` entera para control de concurrencia. Auditoría append-only de mutaciones. Fechas ISO civiles verificadas. Listas acotadas/paginadas si necesario, sin truncar totales silenciosamente.

### Catálogos
`GET /catalogos`: `{entidades,cuentas,socios,negocios:['velai','coches','dialogos','comun']}`.
Entidades: `{id,nombre,tipo:'autonomo'|'sociedad'|'promotores',nif:null|string,direccion:null|string,estado:'pendiente'|'activa',version}`. POST/PATCH `/entidades[/:id]`. Activar requiere identificación fiscal; promotores no emite facturas. Perfiles incompletos visibles.
Cuentas: `{id,nombre,entidad_id:null|string,moneda:'EUR'|'COP',saldo_inicial,fecha_saldo:null|string,conciliada:0|1,version}`. POST/PATCH `/cuentas[/:id]`. Datos pendientes no se muestran como saldo bancario verificado.
Socios: catálogo existente fin_socios, solo nombres/email autorizados internos, no concede accesos.

### Préstamos
`GET/POST /prestamos`, `GET/PATCH /prestamos/:id`: item `{id,nombre,cuenta_id,principal,apertura,cuota,tin_bp,tae_bp,meses,reserva_cuotas,fecha_abono:null|string,primer_vencimiento:null|string,condiciones:[{concepto,valor,fuente}],version}`. Basis points: 1200=12%. Alta registra condiciones/proyección, NO inserta caja automáticamente. No asumir fechas ni pagos reales.
`POST /prestamos/:id/desembolso`: `{id,fecha,importe,apertura}` confirma un abono real y cargo apertura atómicos UNA vez. Validar contra cuenta/principal; histórico de conciliación. Abono financiación no ventas; comisión gasto, no principal.
`GET /prestamos/:id/resumen`: `{prestamo,calendario:[{numero,fecha:null|string,cuota,interes,capital,saldo,pagado,capital_pagado,estado}],pagos,reserva_inicial,reserva_restante,principal_pendiente,pagado_cuotas,desembolsado}`. Previsto y real separados. Sin abono verificado, saldo real pendiente. Cuota mensual (Decimal entero/rational) recalcular última para cerrar principal. Fecha mes calendario con clamping; no afirmar ajuste festivos sin banco.
`POST /prestamos/:id/pagos`: `{id,numero,fecha,importe,capital,interes,comision,nota}`. Desglose suma total, cuenta correcta, no exceder principal ni sobrepagar cuota; partial supported. Consume reserva hasta cuota cubierta, sin tratar reserva como salida. Reversos mediante `POST .../pagos/:pagoId/revertir` `{id,fecha,motivo}`. No borrado. Retornar resumen tras refetch.

### Compras
`GET/POST /compras`, `GET/PATCH /compras/:id`: `{id,concepto,negocio,entidad_id:null|string,prestamo_id:null|string,moneda,estimado,real:null|number,estado:'prevista'|'comprometida'|'comprada'|'cancelada',comprador:null|string,proveedor:null|string,fecha_prevista:null|string,fecha_compra:null|string,categoria,nota,version,pagado,pendiente,documentos_count}`. Pagado=pagos activos aplicados. Estado de justificante no es estado pago.
`POST /compras/:id/comprar`: `{version,real,fecha,comprador,proveedor}` efectúa compra, libera compromiso y fija precio real. Puede faltar factura. `PATCH` de comprada limita metadatos (no importe pagado/borrado).
`POST /compras/:id/pagos`: `{id,fecha,importe,pagador:'cuenta'|'socio',cuenta_id:null|string,socio:null|string,nota}`. Cuenta común crea UNA salida tesorería. Socio crea adelanto, no resta caja común. Pago <= pendiente. `POST /compras/:id/reembolsos`: `{id,pago_id,cuenta_id,fecha,importe}` devuelve anticipos parciales, UNA salida de caja sin segundo gasto. Reversar pagos con operación explícita auditada. Cancelación libera compromiso sin borrar.
`GET /resumen?moneda=EUR`: cuentas/saldos, compromisos, reservas, compras, saldos socios y totales por negocio; datos confirmados separados de pendientes. Toda reserva restada una sola vez; compras pendientes sustituyen compromisos ejecutados. No restar principal completo como reserva.

### Un solo registro de caja
Extender fin_movimientos con `naturaleza` (default operativo), `origen_tipo`, `origen_id`, `cuenta_id`, `entidad_id`; movimiento creado por gestión queda inmutable desde PATCH/DELETE legado. Préstamo entra caja como financiación, NO beneficio. Principal y reembolsos no gasto; intereses/comisiones sí. Gastos pagados por socio reconocidos en compras pero no salida común. Ajustar resumen legado para excluir financiación de ventas/beneficio. No reinterpretar cuenta/pagador históricos: filas previas quedan sin clasificar. No duplicar movimientos. Un evento / varias partidas guardadas en DB.batch atómico e idempotente.

### Adjuntos privados
`GET /documentos?tipo=prestamo|compra|factura&objeto_id=...`; `POST /documentos` multipart {id,tipo,objeto_id,clase,nombre,archivo}. `GET /documentos/:id/archivo?descargar=1` protegido cada vez, sin URL pública, no-store/nosniff, safe filename. Binding NUEVO `FINANCE_DOCS` privado, jamás MEDIA/publico. PDF/JPEG/PNG/WebP validado por bytes y tamaño máx10MiB; sha256/version/autor, deduplicación por propietario; si fallo limpiar objetos sin perder archivos previos. No rutas arbitrarias/lectura por key enviada. No originales reales en git. 503 claro si binding ausente. Documentos vinculados de préstamos/compras no necesitan publicarse a biblioteca.

### Facturas y fiscalidad (módulo independiente)
Migración posterior propia. Facturas por entidad, emisor/proveedor/destinatario, fechas, moneda, serie/número EXTERNO cuando importada, negocio, líneas base/tipo/cuota/retención, total, estado documentación/revisión. Borrador no emite factura ni inventa número legal. Original externo inmutable tras validar; corrección vinculada, nunca UPDATE fiscal de emitido. `GET/POST /facturas`, `GET/PATCH /facturas/:id`, `POST /facturas/:id/validar`, GET /fiscal/resumen?entidad_id&desde&hasta, GET /fiscal/export.csv?..., GET/POST /cierres; cierre conservando snapshot/hash con pendientes explícitos. Exportación interna para asesoría distinta de formato AEAT certificado/aceptado. No declarar presentada por exportar. Preparación de cuota100 +IVA configurable; no21%por defecto universal. Importar/registrar factura no mueve caja: aplicar cobro/pago después. El módulo fiscal tendrá contratos detallados adicionales.

## Asignación de archivos
Claude backend: migrations/0050_gestion_financiera.sql, worker/gestion-financiera.js, worker/routes/gestion.js, test/gestion.test.js y cambios mínimos worker/routes/finanzas.js. No editar frontend, worker/app.js, package.json, scripts, wrangler ni documentos de diseño; Codex integra esos archivos.
Codex: integración, frontend, contratos fiscales y verificación. Ninguna operación cloud/publicación delegada.
