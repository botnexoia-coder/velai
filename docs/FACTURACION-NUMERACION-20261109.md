# Numeración anual y copias de prueba

## Alcance

Las facturas recibidas y emitidas por otro programa conservan su número original. Los borradores internos no tienen número fiscal. Guardar una prueba crea una copia histórica independiente, con número automático `PR-AAAA-001`, `PR-AAAA-002`… por emisor y ejercicio. El año corresponde a la fecha de prueba confirmada; la fecha inicial de la pantalla usa Europe/Madrid.

La copia conserva razón social, domicilio, destinatario, líneas e importes del momento de generación. Cambiar el borrador o el perfil de la empresa después no cambia esa copia. Reimprimir o guardar de nuevo el PDF consulta la copia guardada: no asigna otro número.

Los campos ausentes se muestran con datos ficticios de relleno únicamente en la impresión de prueba. No se guardan ceros como NIF real de una entidad. Las notas internas del borrador no se imprimen. Los importes con IVA pendiente se marcan como provisionales. REBU no desglosa la cuota de IVA.

## Garantías del contador

- Contador persistente separado por emisor, familia y ejercicio. Familias previstas: F (ordinaria), R (rectificativa), PR (prueba).
- Incremento y creación de la copia en una misma transacción. Un error de guardado no consume el número.
- Identificador estable por intento: una repetición de la misma petición devuelve la misma copia. Reutilizarlo con otros datos se rechaza.
- La asignación concurrente no usa un MAX+1 fuera de transacción.
- Las copias históricas no se pueden editar ni borrar mediante las rutas del panel. La base protege su inmutabilidad.
- El cambio de ejercicio abre otra serie; no reinicia ni renumera la anterior. Llegar a 999 no reinicia la secuencia.
- PR no incrementa F/R ni registra una venta, cobro o impuesto.

## Emisión fiscal real

El mecanismo de numeración contempla F/R, pero no habilita por sí mismo la emisión legal. La ruta de emisión real rechaza la operación sin reservar número. Ninguna variable permite saltarse esta guarda en esta versión.

Para una emisión real debe existir un flujo que cumpla los requisitos aplicables al SIF, con datos fiscales completos, registros exigibles, tratamiento tributario revisado y declaración responsable de la versión cuando corresponda. Un número correlativo y un PDF no acreditan por sí solos dicho cumplimiento. Se puede integrar el programa que finalmente utilice el contador; todavía no se ha elegido ni contratado uno.

No activar el emisor guardando un NIF de relleno ni convirtiendo una muestra en factura real. La muestra está identificada en cabecera y pie como prueba sin validez fiscal.

## Fuentes revisadas

- RD 1619/2012, artículo 6: numeración correlativa por serie y serie específica de rectificativas. La organización anual elegida no implica que la ley obligue a reiniciar todas las series cada año: https://www.boe.es/eli/es/rd/2012/11/30/1619/con
- RD 1007/2023, requisitos de sistemas informáticos de facturación: https://www.boe.es/eli/es/rd/2023/12/05/1007/con
- AEAT, declaración responsable de cada versión de SIF: https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/certificacion-sistemas-informaticos-declaracion-responsable.html

## Operación

Aplicar la migración aditiva de numeración por el CD habitual antes del código nuevo. No reescribe facturas anteriores ni modifica saldos. Respaldar la base antes del despliegue. No generar pruebas con datos reales como QA en producción: usar la vista local y las pruebas automatizadas con datos ficticios. La vista local se inicia con `node scripts/preview-gestion.mjs` después del build del panel y muestra el enlace al borrador ficticio.
