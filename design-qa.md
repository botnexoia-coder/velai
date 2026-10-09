# QA de administración financiera · 09/10/2026

El informe anterior de la web se conserva en `docs/qa/design-qa-web-historico.md`.

**final result: passed**

Sin hallazgos P0/P1/P2 abiertos en el alcance revisado. Resultado referido al diseño y los flujos locales; no certifica un despliegue ni una integración fiscal.

## Evidencias

- Fuente visual elegida: `/Users/johan/.codex/generated_images/01a117b1-8f03-7e70-a3f4-1f3a4f606ac3/exec-69c2224c-55bd-4952-bd35-80d5d00ec186.png`.
- Implementación renderizada: `http://127.0.0.1:8796/credito`, navegador Chrome Bot, build real React y rutas Hono con SQLite/R2 aislados.
- Carpeta de evidencias: `/Users/johan/D/Sebas_Proyec/output/velai-finanzas-2026-10-09/qa-implementacion/`.
- Captura final: `credito-escritorio-final.png`. Comparación conjunta abierta e inspeccionada: `comparacion-final.png`; detalle de condiciones/reserva: `detalle-final.png`.
- Viewport escritorio: 1487×1058 CSS, DPR 1. Fuente 1487×1058 px; captura de Chrome 1472×1047 px por área útil/barra de desplazamiento. Normalización de la captura a 1487×1058 para la comparación conjunta; no se consideran diferencias de escala como defectos.
- Móvil 390×844: `credito-movil-v3.png`; tableta 820×1180: `compra-tableta.png` y `facturacion-tableta.png`. Tema oscuro: `credito-oscuro.png`. Formulario de empresa editable: `empresa-campos-editables.png`.

Estado: socio autorizado, préstamo ficticio con abono, seis cuotas reservadas y documento genérico. La referencia tenía tres contratos propuestos y fecha pendiente; la prueba usa un documento genérico y fechas ficticias, con aviso visible. Los contratos reales no se incluyen en el repositorio ni en esta prueba.

## Comparaciones y correcciones

1. `comparacion-v1.png`: P2 por peso tipográfico excesivo (900), fondo con cuadrícula y tarjeta de reserva demasiado saturada. Corregidos con pesos de marca 700/800, fondo neutro y mezcla naranja al 4 %.
2. `comparacion-v2.png` y `detalle-condiciones-v2.png`: jerarquía, cifras, color y tarjetas corregidas. P2 adicional en `credito-movil.png`: seis importes juntos y acciones de documentos fuera del área visible. Reserva móvil reorganizada en 3×2 y documentos como fichas con Ver/Descargar visibles.
3. `credito-movil-v3.png`, `comparacion-final.png` y `detalle-final.png`: correcciones confirmadas; ancho del documento y main 390 px para viewport 390 px. Tablas numéricas extensas conservan desplazamiento contenido. Botones de marca con texto oscuro para contraste.

## Superficies de fidelidad

- **Tipografía:** Cabinet Grotesk de la marca; pesos 700/800 para encabezados/cifras, fuente de lectura existente para campos. Numerales tabulares y decimales españoles. Se conserva el formato monetario del panel con símbolo antes del importe.
- **Espaciado:** jerarquía cabecera/pestañas/métricas/dos tarjetas/documentos. Tarjetas con borde suave y radios de 12 px. En móvil pasan a una columna; documentos y cuotas siguen utilizables sin desplazamiento global horizontal.
- **Color:** navegación oscura por regla existente, lienzo claro y acento naranja, reserva suave. Tema oscuro comprobado. El texto oscuro sobre el botón naranja es una diferencia intencional de accesibilidad respecto a la referencia.
- **Imágenes y activos:** interfaz sin fotografías. Se conservan marca, fuentes e iconos existentes del panel; no se inventan ilustraciones para sustituir activos. El mock es una dirección visual, no un nuevo logotipo.
- **Contenido:** préstamo, caja, reserva y pagos diferenciados. Datos legales y fechas pendientes explícitos. Botones reales de alta/edición/adjunto reemplazan elementos decorativos del mock. Se mantiene la navegación completa y el pie del producto existente.

## Interacciones comprobadas

- Guardar empresa con NIF/domicilio pendientes, editar y reabrir con valores conservados.
- Crear expediente de préstamo sin primer vencimiento confirmado.
- Adjuntar un PDF después de guardar y descargarlo por el endpoint privado.
- Registrar cuota de 882,64: reserva 5295,84 → 4413,20; principal 50000 → 49617,36; 1/84 cuotas. Revertir con motivo devuelve reserva/principal al valor anterior y mantiene el historial.
- Rechazo de fecha de pago futura; valores conservados para corregir y reintentar.
- Escape en el formulario de adjunto cierra solo el diálogo interno y conserva el detalle de compra.
- Navegación a facturación con emisor incompleto y validación bloqueada; origen de caja, comprador y factura separados.
- Estado sin registros, carga, error de guardado, tema oscuro y breakpoints móvil/tableta/escritorio.

Consola: apareció una importación de chunk obsoleto durante una reconstrucción local con la pestaña abierta; se recargó el build completo y el flujo quedó operativo. Sin errores nuevos de aplicación en la navegación final. Los cálculos/idempotencia/concurrencia se verificaron además con pruebas reales SQLite, no solo con mocks de interfaz.

## Pendientes no bloqueantes

- P3: los nombres descargables se normalizan a nombres seguros; podrían conservar una etiqueta visual con espacios sin cambiar el nombre de archivo.
- La navegación horizontal móvil es la existente del panel. Una revisión global de su menú corresponde a otro alcance.
- Cargar los originales reales y verificar el entorno compartido después del despliegue; no forma parte de la prueba visual con datos ficticios.

## Lista de implementación

- [x] Corregir tipografía, fondo y reserva.
- [x] Verificar móvil, documentos visibles y diálogos anidados.
- [x] Comparar de nuevo fuente y render juntos, incluida región detallada.
- [x] Verificar estado pendiente, guardado, descarga, pago y reverso.
- [x] Conservar datos privados fuera de Git.
