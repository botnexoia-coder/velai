# Administración financiera

## Uso

El panel incorpora Crédito y fondos, Compras, Facturación e Impuestos y asesoría. Requiere rol Velai y permiso de socio en el servidor. La actividad personal del autónomo no se incorpora.

- **Datos pendientes:** se puede crear el perfil de la futura sociedad sin NIF ni domicilio, completar y editar después. Promotores identifica la situación anterior a la sociedad y no actúa como emisor fiscal. Las cuentas conservan moneda y titular cuando ya hay operaciones; completar un titular inicialmente vacío no reatribuye el histórico.
- **Crédito:** alta de condiciones y documentos independiente del abono. El calendario es una proyección; sin fecha confirmada muestra fechas pendientes. El abono y los pagos reales requieren fecha y desglose. Reserva de cuotas y pago son estados diferentes. Un reverso conserva la operación original y corrige caja, deuda y reserva.
- **Compras:** idea → presupuesto comprometido → compra realizada → registro del pago. El precio real sustituye la previsión. La fecha de compra puede quedar pendiente y editarse después. Registrar el pago requiere fecha bancaria; las compras sin registro de pago se identifican como pendientes de registrar, aunque exista una confirmación verbal en las notas. Una factura pendiente no impide conservar la compra.
- **Quién participa:** comprador, pagador y autor del registro son datos distintos. La cuenta común no genera deuda con el comprador. Fondos personales generan un anticipo; los reembolsos parciales y sus reversos conservan el histórico y no duplican el importe de compra.
- **Documentos:** PDF, JPEG, PNG o WebP de hasta 10 MiB. Se adjuntan en cualquier momento al préstamo, compra o factura, con Ver y Descargar privados. Adjuntar no crea pagos ni deducciones.
- **Fondos:** saldo registrado por cuenta/moneda, menos reserva, compromisos y adelantos pendientes. Previsiones sin comprometer se muestran aparte. No representa saldo bancario verificado, beneficios fiscales ni cantidades repartibles. Las compras de vehículos pueden ser existencias; un pago no se presume gasto deducible.
- **Facturación:** borradores sin valor fiscal y archivo de facturas externas. El modelo de referencia es genérico. No se asigna número legal a un borrador ni se emite una factura fiscal desde este módulo. Original, identidad fiscal y revisión son necesarios antes de validar; el IVA y su deducibilidad no se presuponen. REBU e inversión del sujeto pasivo necesitan clasificación profesional.
- **Asesoría:** listado por entidad, moneda y período, CSV interno y cierres con instantánea/hash. Exportar o cerrar no presenta una declaración en la AEAT. La emisión conforme y una integración fiscal son una fase posterior.

No se implementan los porcentajes propuestos del pacto de socios. Los registros históricos de Finanzas conservan su cuenta sin asignar; no se reinterpretan por el texto de sus notas. Los nuevos movimientos generados se consultan en Finanzas pero se corrigen en su módulo de origen.

La lista de compras muestra hasta 500 registros y avisa si hay más; los filtros/gráficos de esa lista se limitan a esos registros. El resumen de fondos agrega la totalidad. Las facturas tienen paginación.

## Operación y despliegue

Migraciones aditivas 0050 y 0051 antes del Worker. No contienen datos bancarios reales. `FINANCE_DOCS` usa R2 privado, jurisdicción EU: `vai-finance-docs` en producción y `vai-finance-docs-staging` en staging, separado de MEDIA. Nunca habilitar r2.dev o un dominio público para esos buckets. Los archivos solo se sirven desde el endpoint autenticado; validación de firma, SHA-256, no-store y nosniff.

La publicación habitual pasa por CI y CD: pruebas, build, smoke del panel, migraciones/deploy/smoke en staging y producción del mismo SHA verde. No cargar contratos reales hasta confirmar aislamiento y permisos en el entorno de destino. Los adjuntos bancarios permanecen fuera de Git y se cargan por el panel autenticado.

Los POST financieros usan UUID estable, huella de petición e idempotencia; los PATCH requieren versión. Los lotes D1 y las restricciones SQL evitan pagos simultáneos por encima del pendiente. La auditoría solo se escribe si la operación se confirma. Cada intento de carga utiliza una clave R2 propia y solo limpia su propio objeto al fallar.

## Verificación local

`npm run check`, `npm test --prefix panel -- --run`, `npm run build --prefix panel`. El pipeline existente ejecuta además el smoke E2E sobre el artefacto final y `check-bundle` sobre el Worker empaquetado.

Vista manual: `node scripts/preview-gestion.mjs`, después del build del panel, en `http://127.0.0.1:8796/credito`. Usa SQLite y R2 en memoria con datos ficticios, sin credenciales ni llamadas cloud. Restringida a loopback y origen propio. Se reinicia todo al cerrar el proceso. Nunca desplegar este servidor.

QA de diseño y flujos: `../design-qa.md`. Contratos: `SPEC-ADMINISTRACION-FINANCIERA.md` y `API-FISCAL.md`.
