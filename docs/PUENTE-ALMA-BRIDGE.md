# PUENTE → Alma: corte local del puente de salida

Implementación **desactivada y sin prueba real**. Conserva la URL del webhook de Alma, sus plantillas y los demás clientes. Añade una intercepción de comandos PUENTE después de la firma Twilio; queda cerrada por sus propias banderas. No se debe habilitar todavía.

## Contrato cerrado

`POST https://api.hirevai.com/integrations/puente/whatsapp`

Headers: `Authorization: Bearer <secreto dedicado>`, `Content-Type: application/json`, `Idempotency-Key: <43 caracteres base64url derivados por PUENTE>`.

Cuerpos exactos:

```json
{"type":"verification","destination":"+34000000001","verificationCode":"Ab123456789012"}
```

```json
{"type":"opportunity","destination":"+34000000001"}
```

Número del ejemplo ficticio; no enviar. No permite texto, URL, tenant, remitente ni ContentSid elegidos por el solicitante. El emisor y el tenant Alma/Diálogos siguen fijados en código; la identidad de subcuenta viene solo de PUENTE_BRIDGE_TWILIO_ACCOUNT_SID, configuración privada del servidor contrastada exactamente con la fila activa antes de descifrar su credencial. No admite cuenta elegida por el solicitante ni fallback a la cuenta padre. La cuenta real no está en el repositorio ni en fixtures. El secreto Twilio no sale del Worker Velai ni se copia a PUENTE. El código de verificación ocupa únicamente la variable `1`; la plantilla de oportunidades debe contener su enlace fijo a PUENTE y sus instrucciones de baja.

Respuesta de aceptación: `{"accepted":true,"messageId":"SM…"}`. Significa aceptación del proveedor, **nunca entrega**. El recibo debe contener la subcuenta, emisor y destino exactos esperados. No se devuelve texto de error del proveedor ni información personal.

## Configuración y guardas

Aplicar primero migración `0059_puente_whatsapp_bridge.sql`; 0055–0058 ya existen en origin/main y se conservan. Sin tabla o secreto la ruta falla cerrada. No se ha aplicado ninguna migración remota.

Variables, todas ausentes por defecto:

- `PUENTE_BRIDGE_ENABLED=true` y `PUENTE_BRIDGE_READY=true`.
- `PUENTE_BRIDGE_TWILIO_ACCOUNT_SID`: referencia privada del servidor Velai a la subcuenta de Alma, formato AC seguido de32hex; debe coincidir exactamente con tenants.slug=dialogos y su emisor fijo. Ausente o inválida cierra ambos canales antes de consultar D1.
- `PUENTE_BRIDGE_SECRET`: secreto nuevo dedicado, mínimo 32 caracteres aleatorios, solo Velai y PUENTE. No usar credenciales de Twilio como bearer.
- `PUENTE_BRIDGE_VERIFICATION_CONTENT_SID` y `PUENTE_BRIDGE_VERIFICATION_VERIFIED=true`.
- `PUENTE_BRIDGE_OPPORTUNITY_CONTENT_SID` y `PUENTE_BRIDGE_OPPORTUNITY_VERIFIED=true`.

READY **debe permanecer ausente** hasta que se prueben plantillas realmente aprobadas, autorización vigente de cada destinatario, verificación del número y retorno de BAJA/estado firmado. El retorno tiene implementación local y pruebas simuladas; no tiene conexión ni prueba operativa. Su trigger exclusivo está preparado localmente, con banderas cerradas.

Reserva atómica en D1 antes de llamar al proveedor: máximo 10 solicitudes/minuto, 100/hora y 3/destino/hora compartidas entre ambos tipos. Una clave no vuelve a enviar aunque falle el proveedor, el descifrado o la escritura del recibo. Replay aceptado devuelve el mismo SID; replay reservado devuelve 409; mismo clave con otro cuerpo produce conflicto. PUENTE debe conservar el clave de la operación: sustituirlo tras incertidumbre anularía esta protección y queda prohibido en el consumidor.

Los hashes usan PUENTE_BRIDGE_DESTINATION_HASH_SECRET, clave estable exclusiva de Velai de43–256 caracteres base64url, independiente del bearer y de la firma de eventos. Sin ella ambos canales cierran antes de consultar D1. Su fingerprint SHA256 incluye también la identidad de subcuenta configurada y queda fijada en puente_whatsapp_settings en la primera operación; cambiarla después falla cerrado antes de enviar o reconocer callbacks. La rotación normal del bearer conserva cuotas, supresiones y correlaciones. Rotar la clave estable exige reconciliar los datos y la fingerprint explícitamente; nunca hay fallback al bearer. La clave distingue mayúsculas y minúsculas; corresponde a SHA256 base64url de JSON.stringify(["puente-whatsapp-bridge-v1",tipo,destino,código|noticeId]). Nunca enviar código crudo en la cabecera. El HMAC incluye namespace fijo puente-alma-destination-v1 y conserva la misma identidad al rotar el bearer.

El ledger conserva hashes de cuerpo/HMAC de destino, clave, tiempo y SID; no guarda teléfono, OTP, bearer ni credencial Twilio. No tiene limpieza automática porque borrar reservas permitiría reenvíos inciertos; definir retención/tombstones antes de crecimiento sostenido. Presupuesto global incluye reservas fallidas deliberadamente. Las consultas y respuestas están acotadas; cuerpo máximo512 bytes, respuesta proveedor4096, deadline8segundos, sin redirecciones ni reintentos.

## Pendiente antes de activar

1. Crear y aprobar dos plantillas propias en la subcuenta Alma, verificar categoría/coste/compatibilidad del código14caracteres (protocolo twilio-v1) y enlace fijo del aviso.
2. Adaptador PUENTE que conserve clave clave, consentimiento y número verificado; no basta con compartir el bearer.
3. Probar recepción real de estados Twilio, correlación de SID y actualización durable en PUENTE. El callback temprano se conserva cifrado pendiente: el dispatcher exige un envío aceptado con SID y hash de destino coincidentes antes de reenviar. No depende de un reintento del proveedor. Se limita a1000estados pendientes y se descarta solo estado de más de7d, nunca una BAJA pendiente.
4. Probar BAJA firmada y durable hacia PUENTE, con deduplicación/cancelación de cola y coexistencia de conversación Alma. La URL entrante y conversaciones ordinarias permanecen iguales; los comandos reservados se interceptan solo tras autenticar.
5. Prueba real autorizada a un destinatario propio, incluyendo rechazo/BAJA/recibos, cuotas y no repetición tras timeout. En este corte solo mocks.
6. Revisión de seguridad y CD normal de Velai, sin incorporar archivos financieros ajenos.

Verificación local: tests del módulo con SQLite y fetch simulado, JScheck, aislamiento de tenants, separación de entornos y catálogo backend. Ningún mensaje enviado ni secreto creado.

## Retorno durable de BAJA y estados

`worker/puente-whatsapp-events.js` añade callback `POST https://api.hirevai.com/integrations/puente/whatsapp/status`, autenticado mediante firma Twilio con la credencial cifrada de Alma. Exige subcuenta/emisor/destino exactos; los callbacks adelantados se conservan cifrados hasta que SID y destino coincidan con una aceptación del ledger de menos de7d; solo delivered/read/failed/undelivered son eventos.

El inbound ya autenticado reserva BAJA PUENTE exacto (ignorando espacios externos y mayúsculas), escribe una outbox cifrada y supresión local en una transacción D1, responde TwiML vacío y no entra en IA. BAJA/STOP/UNSUBSCRIBE exactos también notifican a PUENTE y conservan el recorrido de consentimiento existente en Alma. El tráfico ordinario no genera consultas ni eventos nuevos del puente. Una caída D1 no reconoce la baja como procesada.

Banderas separadas `PUENTE_BRIDGE_EVENTS_ENABLED=true`, `PUENTE_BRIDGE_EVENTS_VERIFIED=true` y secreto dedicado `PUENTE_BRIDGE_EVENTS_SECRET` de43–256 caracteres base64url. No reutilizar bearer ni auth-token Twilio. En PUENTE, el mismo valor corresponde a `PUENTE_ALMA_WHATSAPP_EVENTS_SECRET`.

Destino fijo `https://puenteconalma.com/api/webhooks/alma-whatsapp`. Cuerpo exacto `{type,sender,destination,messageId,occurredAt,status?}`; sender es Alma sin prefijo whatsapp, destination E164, messageId SM, occurredAt son milisegundos del primer registro durable, status solo en eventos status. ID estable base64url SHA256(JSON.stringify(["alma-puente-v1",type,messageId,status||""])).

Cabeceras X-Puente-Event-Id, X-Puente-Timestamp (segundos Unix) y X-Puente-Signature `v1=<hex HMAC-SHA256(secret, id+"."+timestamp+"."+rawbody)>`. PUENTE exige firma de menos de5minutos y deduplica ID duraderamente; un retry conserva ID/cuerpo/occurredAt, renueva timestamp/firma. ACK exacto `{accepted:true,eventId}`. Nunca liberar supresión por un ACK genérico o ID distinto.

`dispatchPuenteWhatsAppEvent` reclama atómicamente una fila y hace máximo un fetch, sin redirecciones, timeout8segundos y respuesta512bytes. Reintenta con backoff60s–1h, máximo24 intentos y7d; una fila que agote esos límites permanece pendiente/suprimida hasta investigación, no se descarta ni reconoce falsamente. La alarma operacional registra `puente_event_pending` sin datos personales. El trigger exclusivo `*/2 * * * *` tiene una rama que retorna antes de cualquier trabajo de Velai; son720invocaciones/día y todas son noop con banderas cerradas. Se conserva el cron de minuto y el de5min; staging continúa sin triggers. Este cambio es solo local, no publicado.

Al ACK correcto, un batch marca evento aceptado y libera supresión solo si no queda otra BAJA pendiente del destino. PUENTE vuelve a ser la única autoridad de consentimiento vigente, permitiendo reconsentimiento futuro. Una solicitud ya enviada al proveedor antes de BAJA no se puede retirar. Una caída tras aceptación remota reintenta el mismo evento; la deduplicación del receptor hace segura esa repetición. El tick borra hasta10 estados de más de7d, incluidos adelantados que nunca correlacionaron, y limpia el ciphertext de hasta10 eventos aceptados de más de7d, conservando su tombstone. No elimina pendientes ni incorpora herramientas de recuperación administrativa.


## Presupuesto del cron separado

No se añade al cron5min: sus colas de leads/provisioning/plantillas/avisos comparten presupuestos variables. Tampoco al minuto, donde expireTakeovers LIMIT5 puede consumir hasta36 sentencias D1 al contar fallbackMAX, rewrap de secretos e invalidación de canales, además de hasta5fetch Twilio y operaciones KV.

El trigger nuevo se despacha por cadena exacta antes de cualquier trabajo existente. Máximo del puente por tick: pinfingerprint2D1, claim1D1, envío1fetch, ACK2D1enbatch y dos limpiezas1D1cadauna = **7 sentencias D1 +1fetch**, sin KV, IA, lectura de tenants ni Twilio directo. Error conocido: pinfingerprint2D1+claim1D1+fetch1+reprogramación1D1+cleanup2D1. Vacío: pinfingerprint2D1+claim1D1+cleanup2D1; cerrado:0D1/0fetch. La reclamación no recorre más de una fila; la limpieza tiene LIMIT10. Los índices cubren el estado/fecha/destino; la latencia externa está cercada por8s. Prueba instrumentada a través de testing.scheduled confirma7sentencias y1fetch para ACK exitoso, y ninguna consulta ajena al puente.
