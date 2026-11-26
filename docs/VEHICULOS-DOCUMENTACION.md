# Vehículos y conductores

## Carpeta del vehículo

En Administración → Vehículos y viajes, busca por matrícula actual o anterior, referencia, marca o modelo. La matrícula se muestra primero también al elegir un vehículo para registrar gastos o asignarlo a un conductor.

La ficha conserva su enlace y abre el expediente: foto privada real, matrícula destacada, tipo y país declarados, acceso a papeles y costes. Si falta foto se ofrece añadirla; no se utiliza una imagen genérica como si perteneciera al coche. Editar ficha permite confirmar si la matrícula es provisional o definitiva. Cambiarla conserva la anterior; un cliente antiguo que cambie el número sin indicar tipo vuelve a «por confirmar».

Carpetas: Circulación e ITV, Seguros, Mantenimiento, Multas, GPS y servicios, Compra y venta. Otros conserva archivos aún sin clasificar. Los accesos rápidos llevan a permiso, ficha/ITV o seguro. No se deduce ausencia de multas o cobertura por tener una carpeta vacía.

«Falta adjuntar» significa que falta el archivo en el expediente. «Pendiente de revisar» identifica un archivo que el equipo aún no ha revisado. Registrar la revisión requiere confirmación expresa y conserva autor y fecha; no sustituye la comprobación del contenido. Las fechas se interpretan como fechas civiles de Madrid, con el día de vencimiento incluido. Un documento vencido o aún no iniciado conserva esa indicación aunque su contenido se haya revisado.

Los archivos anteriores pueden marcarse como sustituidos y consultarse mediante Mostrar históricos. Cambiar fechas o categoría invalida la revisión actual y requiere revisarlo de nuevo. Los archivos duplicados se identifican por sus bytes y propietario; la pantalla ofrece editar el existente, sin otra copia. La versión de metadatos es independiente de la versión de subida y rechaza cambios concurrentes.

Adjuntar o clasificar documentos no crea gastos ni pagos. Las facturas y comprobantes económicos siguen enlazados a su origen. Costes y operaciones se despliegan para ver compra, viaje, preparación, soportes y conciliación; el total permanece en el encabezado plegado.

## Conductores

Administración → Conductores permite crear fichas privadas para socios. Nombre y teléfono son obligatorios; identidad, carnet, categorías, caducidades, permiso de trabajo cuando corresponda y contacto de emergencia son opcionales. Los números y documentos solo aparecen en el detalle; el listado muestra nombre, teléfono y estado. No se crean cuentas de acceso para los conductores.

Las fotografías y documentos se guardan en el almacenamiento privado existente, separados de los documentos financieros. Adjuntar no registra una revisión ni declara aptitud laboral o aseguradora. No se incluyen datos personales en los eventos de auditoría: se registran los campos modificados.

Un duplicado abre el documento existente para corregir su tipo o fechas. Retirar un archivo bloquea su descarga y lo deja en históricos; Restaurar al expediente lo recupera como pendiente de revisar. Ninguna de estas acciones borra sus bytes. La purga definitiva y los plazos de conservación quedan fuera de esta entrega.

Cada asignación guarda vehículo, conductor, inicio y devolución opcional. El formulario trabaja con la hora de Madrid y el servidor conserva instantes UTC. Las horas inexistentes del cambio de horario se rechazan; las repetidas requieren elegir cuál corresponde. Un vehículo no admite asignaciones solapadas. El conductor actual se calcula según el instante de consulta; las asignaciones futuras permanecen programadas. El historial administrativo no acredita quién conducía en un incidente.

## Acceso y publicación

Los handlers requieren el mismo permiso de socio antes de acceder a base de datos o archivos. Conductores no está disponible en la copia de prueba móvil; sí en el panel privado normal, adaptable a móvil. Los archivos usan descargas autenticadas sin caché; no se publican fotografías, licencias ni documentos de identidad.

Las migraciones 0066 y 0067 son aditivas y no reconstruyen las tablas financieras. Se aplican por el pipeline existente primero en staging y luego en producción. No cambian precios, pagos ni saldos. La reversión de código conserva las columnas/tablas nuevas y los originales.
