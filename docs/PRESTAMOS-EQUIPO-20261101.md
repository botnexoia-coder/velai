# Finanzas · préstamos concedidos al equipo

Propuesta autorizada el 1 de noviembre de 2026 e implementación local. No implica
publicación, migración remota, préstamo real ni movimiento bancario.

## Navegación

Finanzas abre el dashboard. Ingresos y Gastos conservan consultas y exportaciones
filtradas por su tipo. Todos los movimientos conserva el libro completo. Los
créditos recibidos continúan en su expediente propio; no son préstamos al equipo.
Repartos, traspasos, conceptos, socios y servicios recurrentes se conservan.

El dashboard muestra saldo registrado en cuentas EUR, reserva de cuotas, principal
concedido pendiente y capacidad calculada del piloto. La vista de operación admite
EUR y COP por separado. El escenario de retraso no suma devoluciones ni ingresos
futuros. Cuotas sin fecha o consultas fallidas impiden dar la evaluación por completa.

## Piloto del equipo

- Máximo de 500 EUR pendientes POR PERSONA, entre todas sus solicitudes individuales
  y conjuntas; no es un máximo global de 500 EUR para el equipo.
- En grupos se registra la responsabilidad de principal de cada integrante; no se
  infiere solidaridad ni una compensación contra repartos.
- Devolución en un mes calendario como máximo; cero interés en la primera fase.
- Aprobación de un socio que no sea beneficiario, también para solicitudes de grupo.
- Solicitar y aprobar no son una entrega bancaria. La entrega requiere confirmación
  expresa con fecha real; la liquidez se vuelve a comprobar al registrarla.
- La reserva para cuotas y los compromisos se mantienen protegidos. Un cobro previsto
  no constituye cobertura. Solo cuenta liquidez registrada elegible para el piloto.
- El principal concedido reduce caja, sin ser gasto operativo; recuperarlo aumenta
  caja, sin ser venta. No se descuenta el principal por segunda vez en el disponible.
- La entrega debe ser una transferencia desde la cuenta de Velai a la cuenta del
  destinatario, con titular y referencia de cuenta, comprobante privado y verificación
  expresa. Una compra directa desde Velai se registra en Compras.
- Las devoluciones admiten importes parciales por participante. Es necesario adjuntar
  su comprobante y verificar la entrada; subir un documento no cierra el préstamo.
- Un vencimiento superado con principal pendiente se muestra como vencido.

## Modalidades futuras

La ampliación para el equipo a 1.000 EUR y tres meses permanece en evaluación.

La vista «Préstamos a terceros · Próximamente» se presenta en gris y desactivada.
Muestra persona destinataria, responsable del equipo que negocia y gestiona,
importe máximo de 500 EUR, plazo máximo de tres meses, modalidad de interés,
importe/porcentaje pactado y total a devolver. No permite registrar operaciones.

Se prevén dos modalidades de negociación, sin valor predeterminado:

- Importe fijo: principal 500 EUR + interés fijo 30 EUR = total 530 EUR.
- Porcentaje sobre el principal para TODO el plazo: 300 EUR al 3 % = interés 9 EUR,
  total 309 EUR. No se interpreta como tasa mensual ni anual, ni se capitaliza.

El responsable documentará la negociación concreta antes de habilitar esa fase.
No se ha elegido una tasa ni se presume rendimiento asegurado.

## Publicación

El checkout canónico conserva trabajo local previo. Sus migraciones no deben
publicarse automáticamente: el inventario de origin/main contiene 0055_tenant_redes,
0056_event_code_attributions, 0057_catalogo_empresas y 0058_tenant_espacio; la rama
PUENTE tiene 0059 pendiente. La migración local anterior de recurrentes usa 0055.
Antes de publicar hay que integrar los cambios sobre la fuente vigente y reconciliar
la numeración sin omitir los esquemas ya instalados. No tocar D1 por intuición.

## Evidencia local

Migración nueva: `0060_prestamos_equipo.sql`, aditiva. Reutiliza el libro y los
comprobantes privados con tipo `prestamo`, distinguiendo explícitamente en el
libro `equipo_prestamo_id`. Un UUID no puede pertenecer simultáneamente al crédito
recibido y al concedido. Los nombres manuales de concepto que ya coincidan se
conservan y reciben su clave interna; no se borra el catálogo.

La capacidad usa únicamente cuentas EUR conciliadas y resta reservas, aprobaciones,
compras comprometidas y anticipos pendientes. Las guardas SQL revalidan exposición
individual y liquidez dentro de la transacción. Las cuotas deben estar registradas
correctamente en Crédito; el cálculo no puede conocer obligaciones sin registrar.
Las fechas de movimientos nuevos deben ser posteriores al saldo inicial conciliado
para no ocultar una entrega o devolución debajo de una instantánea bancaria.

Verificado: `npm run check` (428 pruebas backend y controles de aislamiento/entornos),
305 pruebas del panel, build normal y prueba móvil. Recorrido HTTP/UI completo con
SQLite y R2 en memoria: solicitud 500 EUR, aprobación independiente, comprobante,
transferencia, comprobante de devolución y recuperación íntegra. Saldo del préstamo
final 0; ancho móvil 390/390 y controles de terceros desactivados. No errores JS.

Claude produjo una evaluación inicial de arquitectura. El intento de implementación
no produjo archivos y se interrumpió; la revisión final delimitada agotó 90 s sin
informe. No se considera una aprobación independiente del código. Codex realizó
la implementación, revisión y validación descritas.

La vista se ejecuta con `node scripts/preview-gestion.mjs`, únicamente loopback,
con socios, documentos y saldos ficticios que desaparecen al detener el proceso.

Condición incorporada por el usuario: en la propuesta de terceros, el integrante
solicitante que autoriza y gestiona responde ante Velai de todas las cuotas, incluso
si el destinatario no paga. Se presenta como condición de la modalidad futura, que
continúa desactivada. No genera contratos ni obligaciones nuevas automáticamente.

## Integración para publicación

Candidato sobre origin/main54124d5. Conserva catálogos/espacios0055–0058 y reserva
0059 para la rama PUENTE, sin incorporarla. El catálogo local de recurrentes se
publica como0061; préstamos al equipo como0060. El checkout canónico anterior se
conserva intacto, con sus archivos y numeración local.

Identidad Git HTTPS CronoSeb y Wrangler botnexo.ia@gmail.com/cuenta
6a5877b5637ec5fa28d05af46e894542 revalidadas. D1 producción4b3056eb y staging4fe5d8b0,
ambas WEUR, respaldadas antes de publicar. Ensayo de exportaciones reales en SQLite:
54→58 tablas, columnas/datos anteriores conservados salvo los conceptos nuevos,
integridad y claves foráneas correctas. Copias privadas fuera de Git.

Candidato integrado:461 pruebas servidor,333 panel/tipos y52 E2E verdes. Mensaje
explicativo enviado al grupo Diálogos que Enseñan, incluyendo responsabilidad del
solicitante ante impago de terceros. Esta modalidad permanece desactivada.
