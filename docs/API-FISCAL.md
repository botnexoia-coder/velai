# Registro fiscal interno de Velai

Módulo local `worker/routes/fiscal.js`, exportación `fiscal` de Hono. Requiere migraciones 0050 y 0051. Todos los handlers comprueban `esSocio` antes de consultar DB/R2. El coordinador lo monta en el router administrativo existente, manteniendo Access, comprobación de origen y aislamiento del rol cliente.

Este módulo reúne **originales emitidos fuera del sistema, facturas recibidas y borradores internos**. No asigna series/números legales, no emite facturas, no genera QR fiscales, no conecta automáticamente proveedores de emisión y no presenta declaraciones. No hay datos, emisores personales ni proveedores preseleccionados. La futura sociedad se configura cuando tenga identidad fiscal; promotores/perfiles incompletos pueden preparar información pero no validarla ni cerrar libros.

La ficha de empresa puede guardar y editar nombre/dirección, conservando los datos históricos en cada factura revisada. Una vez existe una factura validada, un trigger bloquea cambiar NIF o tipo de entidad (`entidad_con_historico_fiscal`, devolver **409** desde el endpoint de entidades). El bloqueo sigue vigente si esa factura fue sustituida por una corrección. Un sujeto legal diferente necesita otra entidad, para no mezclar libros. Cambios de mayúsculas/espacios exteriores del mismo NIF no alteran identidad.

## Convenciones

- Prefijo `/api/admin/gestion`; respuestas de listas `{items,nextCursor}`, de escritura/detalle `{item}`.
- ID UUID enviado por cliente en altas: reintentar idéntico devuelve el mismo recurso; mismo ID/cuerpo diferente devuelve 409. También se detecta misma factura externa con otro UUID por entidad, tipo, número/año y NIF de proveedor en recibidas.
- PATCH y acciones requieren `version` entera. Una edición concurrente devuelve 409; recargar antes de reintentar.
- Importes enteros en céntimos EUR / pesos COP. No convertir monedas ni sumar titulares. IVA, retenciones, precio y descuento de cada línea se redondean en unidades menores con aritmética racional/BigInt, mitad alejándose de cero. Cantidad se transmite como texto decimal de hasta cuatro decimales, por ejemplo `"1.5"`.
- `iva_bp`: puntos básicos, `2100` significa 21 %. Su valor por defecto es **null**, clasificación pendiente; no significa exento ni IVA cero. `retencion_bp` por defecto 0. El descuento es un importe absoluto por línea en unidades menores, aplicado tras multiplicar cantidad por precio.
- Fechas civiles ISO comprobadas. Resumen/export/cierre requieren `entidad_id`, `moneda`, `desde`, `hasta`; rango máximo 367 fechas inclusivas. Tope de 5000 facturas y 8 MiB de líneas/snapshots por consulta, 10000 líneas por exportación y 1 MiB por snapshot de cierre. Si el rango excede la capacidad explícita, se pide dividirlo y nunca se truncan totales silenciosamente.
- Registrar/validar/corregir una factura **no escribe `fin_movimientos` ni marca una compra pagada**. El cobro/pago se registra una única vez en tesorería/compras. `compra_id` sólo asocia evidencia fiscal a una compra recibida de la misma entidad y moneda.

## Facturas

`GET /facturas?entidad_id=...&moneda=EUR[&desde=...&hasta=...&estado=...&tipo=recibida|emitida&cursor=...]` devuelve hasta 100 recursos, incluyendo borradores. Los filtros de tipo/estado/fecha se aplican en servidor antes de paginar. Seguir `nextCursor` para todas las páginas. `GET /facturas/:id` devuelve el detalle.

`POST /facturas` acepta:

```json
{
  "id": "0e049ca3-fd91-48bc-8612-506d2704917b",
  "entidad_id": "entidad-configurada",
  "negocio": "velai",
  "tipo": "emitida",
  "estado": "registrada",
  "origen": "externa",
  "clase": "ordinaria",
  "tratamiento_fiscal": "general",
  "nota_fiscal": null,
  "contraparte_nombre": "Cliente de ejemplo",
  "contraparte_nif": "NIF-DE-EJEMPLO",
  "contraparte_direccion": "Dirección de ejemplo",
  "numero": "EJEMPLO-2026-001",
  "fecha_emision": "2026-10-09",
  "fecha_operacion": "2026-10-09",
  "fecha_recepcion": null,
  "moneda": "EUR",
  "proveedor_emision": null,
  "compra_id": null,
  "nota": null,
  "lineas": [{"descripcion":"Servicio", "cantidad":"1", "precio_unitario":10000, "descuento":0, "iva_bp":2100, "retencion_bp":0}]
}
```

Todos los datos del ejemplo son ficticios y no habilitan una entidad. `negocio`: velai/coches/dialogos/comun. `tipo`: recibida/emitida. Alta permite `estado=borrador|registrada`, nunca validada. `origen=borrador|externa`. Borradores no requieren contraparte, número ni fecha; registrada exige número y fecha del original externo. `tratamiento_fiscal` admite pendiente/general/exento/no_sujeto/inversion/rebu.

El servidor calcula `base`, `iva`, `retencion`, `total` y el desglose de líneas. Ejemplo: 10000 + 2100 − 0 = 12100. No se aceptan totales enviados que puedan alterar los cálculos. `iva_deducible=0` hasta revisión explícita. Para originales cuyo método de redondeo difiera, se conserva el documento y se corrigen las líneas revisando con asesoría; no se inventa una deducción o cuota de ajuste.

La respuesta añade `documentos_count`, `originales_count` (clase factura), `version`, actores/fechas, `revision`, `snapshot`, `root_id`, `correccion_de`, `motivo_correccion`. `snapshot` es null hasta validar. Los hashes de idempotencia no se exponen.

`PATCH /facturas/:id` admite `version` y los campos editables del alta, sin `id`; vuelve a calcular importes. Una factura validada no se modifica, ni siquiera sus metadatos de negocio. Una revisión en un período cerrado tampoco se modifica. No existe DELETE.

`POST /facturas/:id/validar`:

```json
{"version":1,"iva_deducible":0,"revision":"Original comprobado; clasificación y deducibilidad revisadas."}
```

Requiere entidad activa con NIF y dirección, tipo distinto de promotores, factura registrada/externa, contraparte identificada, fechas/número y al menos un documento privado `g_documentos(tipo='factura',objeto_id=id,clase='factura')`. Un recibo de pago u otro anexo no sustituye la factura original. No afirma que un NIF formalmente escrito esté censado o que un PDF pruebe deducibilidad: el actor documenta su revisión. La validación congela datos, entidad y referencias/hash de originales en `snapshot_json`. Un documento subido no cambia por sí mismo estado fiscal ni pago.

- `general`: cada línea debe tener tipo de IVA explícito; se respeta cero si fue elegido como tal.
- `exento`/`no_sujeto`: cuota cero y fundamento en `nota_fiscal`; estados distintos, sin inferencias automáticas.
- `pendiente`: bloquea validación con `tratamiento_fiscal_pendiente`.
- `inversion`/`rebu`: conservan el registro externo pero bloquean validación con `regimen_requiere_asesoria`. Esta versión no calcula autorrepercusión, márgenes fiscales ni libros especiales. El margen comercial de coches no sustituye la base imponible fiscal.
- Deducción sólo en recibidas, importe manual acotado a la cuota soportada y con el mismo signo. No deduce automáticamente todo el IVA.

`POST /facturas/:id/corregir` crea una revisión del **registro interno**, mantiene el original validado inmutable y exige `id`, `version`, `motivo`. Admite las líneas y campos descriptivos corregidos, conservando identidad, entidad, moneda y fechas del documento externo. No genera una factura rectificativa legal. La revisión anterior sigue incluida en cifras hasta validar la nueva; entonces queda sustituida, sin sumar ambas. La revisión nueva necesita asociar su evidencia privada mediante `/documentos`. Sólo se permite un sucesor por revisión; se continúa desde el último sucesor si hace falta otra corrección.

Una factura rectificativa **externa real** se registra como recurso separado `clase=rectificativa`, número propio, líneas con importes positivos o negativos según el original, `rectifica_id` de una factura validada de la misma entidad/tipo/moneda y fundamento. No sustituye el original: ambos importes participan con su signo. Nunca se simula el documento legal usando el endpoint de corrección interna.

## Impuestos y libros internos

`GET /fiscal/resumen?entidad_id=...&desde=...&hasta=...&moneda=EUR`:

```json
{
  "ambito":{"entidad_id":"entidad-configurada","moneda":"EUR","desde":"2026-10-01","hasta":"2026-12-31"},
  "totales":{"base_emitida":10000,"base_recibida":0,"iva_repercutido":2100,"iva_soportado":0,"iva_deducible":0,"retenciones_emitidas":0,"retenciones_recibidas":0,"saldo_iva_provisional":2100},
  "validadas":1,"pendientes":0,"borradores":0,"sin_fecha":0,"incidencias":[],
  "alcance":"Libro interno para asesoría. Proyección provisional, no declaración presentada ni formato AEAT validado."
}
```

Sólo versiones vigentes validadas participan en totales. Registradas y borradores tienen incidencias propias. `sin_fecha` cuenta registros de la misma entidad/moneda que no pueden asignarse al período. Fecha del período = operación, o emisión si falta operación. Esto es un criterio interno explícito: no resuelve por sí solo fecha de deducción, criterio de caja, prorrata, importaciones ni regímenes especiales. `saldo_iva_provisional = repercutido − deducible` es una ayuda, **no la cuota de un modelo 303**. No calcula Impuesto sobre Sociedades/IRPF ni compensaciones previas.

`GET /fiscal/export.csv?...` utiliza el mismo ámbito. Devuelve CSV UTF-8/BOM con una fila por línea, entidad congelada de revisión, contraparte, documento/fechas, bases/tipos/cuotas/retenciones, negocio, compra y referencias de corrección. Las filas no revisadas o sustituidas se marcan `INCIDENCIA`, `incluida_en_totales=NO` y no llevan cifras fiscales; no contaminan la suma del libro. Un aviso `AVISO_SIN_FECHA` indica cuántos registros de la entidad/moneda siguen sin fecha y no pueden asignarse al período. El importe deducible de factura aparece sólo en su primera línea. Fórmulas de texto neutralizadas, incluso tras espacios; los importes negativos calculados se conservan como números para que los abonos sumen correctamente. Es **exportación interna para asesoría**, no XML/CSV declarado compatible con AEAT. Descargar no presenta ni paga un impuesto.

## Cierre y reapertura

`GET /cierres?entidad_id=...&moneda=EUR[&cursor=...]` lista snapshots completos con hash SHA-256; 100 por página.

`POST /cierres` acepta `{id,entidad_id,moneda,desde,hasta,nota?,aceptar_pendientes?:true}`. Sin aceptación explícita, incidencias o facturas sin fecha bloquean el cierre. Si se acepta, quedan enumeradas en el snapshot; no pasan a deducibles. Se guarda conjunto completo de versiones del rango, originales referenciados, sumas, actor, fecha y hash. No cambia ningún estado a «presentado».

Triggers SQLite verifican dentro de la transacción que el conjunto y sus versiones sigan siendo los leídos para calcular el snapshot; una carrera devuelve `cierre_desactualizado`. Se impiden períodos solapados cerrados y nuevas facturas/ediciones retroactivas del rango, incluidos borradores. Cierre no elimina pendientes: para corregirlos hay que reabrir con motivo.

`POST /cierres/:id/reabrir` acepta `{version,motivo}` de al menos cinco caracteres. Conserva íntegro snapshot/hash original, registra actor y motivo, y permite corregir el libro abierto. Cerrar de nuevo crea **otro cierre** con otro ID; se conserva historia. La auditoría es append-only. Una reapertura interna no rectifica ninguna declaración externa presentada.

## Adjuntos, controles y límites

Se usan endpoints privados comunes `/documentos`; nunca Biblioteca pública. El objeto propietario es `tipo=factura`, `objeto_id=g_facturas.id`. Las referencias originales son inmutables; nuevos adjuntos sólo añaden evidencia. El snapshot de una validación contiene los IDs/hash existentes en ese momento; archivos posteriores no reescriben lo revisado. No se copian aquí documentos bancarios o facturas personales.

No se han configurado datos fiscales, emisión, certificado digital, envío AEAT, motor fiscal, obligaciones censales, calendarios oficiales ni declaraciones ya presentadas. Esas integraciones tienen que verificarse como entregables propios antes de anunciar cumplimiento o presentación. Retener originales y revisión del asesor sigue siendo necesario. No activar reparto automático de socios.

Pruebas `node --test test/fiscal.test.js` usan SQLite real y router Hono local, sin nube ni credenciales. Cubren permisos por handler, separación por entidad/moneda, IVA pendiente/cálculo exacto, idempotencia, congelación/correcciones, CSV y cierre/reapertura. No prueban aceptación de Hacienda ni certifican el producto como SIF.
