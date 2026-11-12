# Mensaje para Juan — piloto de llamadas de Alma

**Borrador listo para copiar. No enviado.** Fecha: 28/10/2026.

Juan, estamos avanzando con la preparación para que Alma conteste llamadas entrantes de WhatsApp, manteniendo el número en Twilio y el contexto que ya tiene en Velai. La investigación recomienda Twilio + ConversationRelay y queremos probar con llamadas de máximo tres minutos.

Ya hemos comprobado en Twilio que el emisor de Diálogos está Online y con calidad High. La voz todavía no está habilitada: falta desarrollar y conectar el adaptador, probarlo y completar las validaciones de Meta. No está listo para que llamemos aún.

Sebas no puede acceder a Meta y cree que tú administras esa parte. ¿Puedes confirmar si tienes permisos y revisar lo siguiente en el portfolio y WhatsApp Business de Diálogos?

1. Que administras la cuenta/activo correcto y puedes gestionar el emisor de Alma que termina en **6513**. Es el número del bot de Twilio, no el teléfono de contacto que termina en 0553.
2. El estado de verificación del negocio: verificado, pendiente o con algún rechazo y su motivo.
3. El límite actual de mensajería iniciada por la empresa: Twilio pide al menos **2.000 en 24 horas** para habilitar llamadas. Es el límite concedido, no tener que enviar esa cantidad.
4. Si hay restricciones o incidencias del portfolio, de la cuenta WhatsApp o del número que impidan activar llamadas.
5. Si aparecen los ajustes de llamadas de voz/Call settings para ese número y si están disponibles o muestran un bloqueo.
6. El estado del icono, las llamadas entrantes y el horario, y quién puede completar la activación cuando tengamos la parte técnica probada.

Por ahora basta con validar y devolver el estado; no hace falta mover el número, crear otra cuenta ni hacer cambios en el WhatsApp que ya funciona. Tampoco necesitamos tus claves o códigos. Si no tienes acceso a ese activo, dinos quién lo administra para dirigirle la comprobación.

Dejamos [la investigación y la tabla M1–M8 para responder aquí](ALMA-VOZ-WHATSAPP.md). Puedes devolver cada punto como **confirmado / bloqueado / sin acceso**, con el valor o mensaje que aparezca. Si necesitas compartir una captura, por privado y sin información de clientes ni documentos personales; el repositorio es público.

Con eso podremos separar lo que depende de Meta de lo que debemos terminar en Velai/Twilio y organizar la primera llamada de prueba contigo y Sebas.
