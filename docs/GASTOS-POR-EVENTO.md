# Presupuesto de eventos y gastos generales

Cada compra o servicio puede vincularse a un evento. El negocio contable se
conserva bajo Diálogos; el evento separa el destino NAYA de la producción habitual.
Las etiquetas son explícitas y no se infieren de notas, proveedor o préstamo.

En Eventos, los socios del admin disponen de Presupuesto y gastos. La previsión
incluye ideas, compromisos, compras realizadas y gastos manuales etiquetados.
Los pagos al proveedor y las tareas realizadas se muestran por separado.

Hecho registra ejecución, actor y fecha. No crea compras, pagos ni reversos.
Los planes de pago tienen fechas e importes previstos; no generan caja y se
conservan aunque sus fechas hayan pasado. Se pueden pagar anticipos de un
compromiso antes de que se complete el servicio. La distribución de pagos entre
cuotas es orientativa por fecha: no certifica una cuota bancaria concreta.

El informe calcula los adelantos del fondo común desde las partidas del libro
con cuenta asignada, incluido el reembolso de un anticipo personal. Los pagos
personales pendientes de reembolsar se muestran aparte. Un gasto sin cuenta no
se atribuye al fondo común. Las reservas cotizadas no se convierten en ingresos.

Registrar cobro del evento añade un ingreso real al libro, con cuenta y UUID
idempotente. Los cobros registrados cubren los adelantos en el informe; esa
cobertura no crea otra transferencia, ni un préstamo entre entidades, ni otra
salida de dinero. La caja general sigue siendo única; la deuda bancaria se
controla desde Crédito. La inversión pendiente se limita a cero como mínimo.

Los filtros de Evento y Cliente en Finanzas, movimientos y CSV usan el evento
y el cliente efectivos, también para pagos antiguos, reembolsos y reversos
generados por Compras. La combinación no elimina partidas cuyo tenant_id de
origen es nulo. Los datos históricos y su origen permanecen intactos.

Los gastos y cobros solo se consultan por administradores de Velai con permiso
financiero. Los clientes operativos no acceden al presupuesto. La prueba móvil
solo consulta y no permite marcar Hecho, registrar pagos ni modificar planes.

Migración aditiva0053_eventos_finanzas.sql. Sin datos reales dentro de Git.
