# Finanzas y planificación del admin

## Finanzas

El resumen distingue cobros, gastos operativos y costes financieros del periodo,
además de caja y obligaciones de todo el histórico. El periodo, cliente, concepto,
tipo, moneda y clasificación afectan tanto al resumen operativo como al listado
y al CSV. Caja y obligaciones no cambian con esos filtros y se identifican como
acumulado global. No se mezclan euros y pesos.

Un abono de préstamo aumenta caja y deuda, sin ser venta. La apertura y los
intereses se muestran como costes financieros. Los pagos de compras, anticipos
de socios, reembolsos y repartos conservan sus operaciones originales. Las
compras adquiridas y sus pagos pendientes se muestran aparte; el resultado
registrado del libro no es un resultado contable de devengo completo.

El saldo de movimientos no sustituye el extracto bancario conciliado. No se
inventan fechas, pagos o gastos para cuadrarlo. Las operaciones de gestión
conservan sus versiones, idempotencia y auditoría.

## Calendario

Diálogos abre Planificación al seleccionar su cliente. Pulsar una fecha abre
Añadir evento con el día seleccionado. Se guarda título/episodio y detalles;
los registros pueden editarse y borrarse con protección de versión. La agenda
se conserva en D1 y funciona aunque Google Calendar no esté conectado.

Las citas de clientes siguen en su sección propia. Planificación no crea reservas,
notificaciones, bloqueos ni eventos de Google. Velai puede escribir; los clientes
solo consultan su agenda si tienen módulo calendario. La prueba móvil únicamente
consulta: no muestra controles para crear, editar o borrar planificación.

Migración: 0052_editorial.sql, aplicada por CD antes del despliegue.
