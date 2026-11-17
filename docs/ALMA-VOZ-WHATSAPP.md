# Alma por llamada de WhatsApp — investigación y preparación del piloto

Estado: **BORRADOR · no implementado ni habilitado**. Actualizado: 28/10/2026.

Responsables: Codex/Sebas, preparación técnica; Juan, validaciones de Meta **si dispone de administración del activo**. Esa titularidad todavía debe confirmarse.

## Resumen para retomar

Queremos que Alma atienda llamadas entrantes desde WhatsApp, conservando el número en Twilio y el contexto de Diálogos en Velai. Sebas ha elegido Alma para el piloto y pide un máximo de **180 segundos por llamada**, anunciado y aplicado técnicamente.

La investigación y la inspección de configuración están realizadas. **Todavía faltan el adaptador de voz, sus pruebas, la configuración de Twilio y la validación de elegibilidad en Meta. No es correcto decir que solo queda Meta ni que ya se puede llamar.**

Sebas informa de que no puede acceder a Meta y cree que Juan administra esa parte. No necesitamos sus contraseñas ni intentar recuperar o eludir un bloqueo para continuar: Juan puede devolver las comprobaciones de la sección siguiente desde su propia sesión autorizada.

Mensaje listo para compartir: [PARA-JUAN-ALMA-VOZ-META.md](PARA-JUAN-ALMA-VOZ-META.md).

## Lo comprobado y sus límites

| Elemento | Evidencia del 28/10 | Interpretación |
| --- | --- | --- |
| Twilio de Alma | Subcuenta `cliente-dialogos`; emisor de Diálogos Online, calidad High | Mensajería registrada; no prueba elegibilidad para llamadas |
| Número correcto | El emisor WhatsApp del bot termina en **6513** | Usar el emisor de Console; el contacto configurado en otra ficha termina en 0553 y es distinto |
| Enrutamiento actual | Webhook de mensajes hacia el Worker de Velai | Conservarlo; la voz tiene configuración separada |
| Voice Endpoint Configuration | TwiML Application: **None** | No hay aplicación de voz conectada |
| Contexto | `systemFor` usa prompt, identidad y reglas por tenant; Alma corresponde a `dialogos` | Se puede reutilizar, con adaptación para voz |
| Historial | Persistencia por tenant/canal/contacto en D1 | No implica memoria automática entre llamada y chat |
| Modelo | `callAnthropicRaw` del flujo revisado espera respuesta JSON completa | La ruta de voz necesita generación progresiva y cancelación de turnos |
| Meta | El administrador de WhatsApp pide iniciar sesión | No se comprobó verificación del negocio ni límite habilitado |
| Audio real | Ninguna llamada realizada | No hay mediciones de naturalidad, latencia o corte |

Fuentes de código: `worker/app.js` (`systemFor`, `callAnthropicRaw`, `convLoad`, `convAppend`), `worker/twilio.js`, `worker/routes/publico.js` y `tenants/dialogos.md`. Se contrastaron con `main` en `54124d5` al preparar este borrador. Los datos observados de Console son un snapshot y deben revalidarse antes de activar.

## Validaciones de Meta para Juan

Entrar en [Meta Business Suite](https://business.facebook.com/) y localizar Configuración del negocio → Cuentas → Cuentas de WhatsApp → WhatsApp Manager. Los nombres de menú pueden variar. **Primero verificar; no cambiar ni migrar activos para intentar resolverlo.**

| ID | Qué comprobar | Resultado que necesitamos |
| --- | --- | --- |
| M1 | Quién administra el portfolio de Diálogos y si Juan tiene permisos para ese activo | Administrador disponible o responsable al que pedir la validación |
| M2 | Que la WABA y el emisor de Diálogos correspondan al bot que termina en 6513 | Coincidencia confirmada; no confundir número de contacto, otra marca o NAYA |
| M3 | Estado de verificación del negocio/portfolio | Verificado, pendiente, rechazado o sin acceso; copiar el motivo visible sin documentos personales |
| M4 | Límite vigente de mensajería iniciada por el negocio y nivel al que se aplica | Valor/nivel exacto y pantalla consultada; Twilio exige al menos 2.000 en 24 horas para Calling. Es capacidad habilitada, no obligación de enviar 2.000 mensajes |
| M5 | Restricciones, calidad y avisos del portfolio, WABA o número | Confirmar si hay una restricción que impida usar Calling; no atribuir al bot el bloqueo personal de Sebas sin evidencia |
| M6 | Disponibilidad de ajustes de llamadas para el número | Si aparecen Call settings/Voice calls, si están disponibles y qué impedimento muestra Meta, si lo hay |
| M7 | Opciones de llamadas entrantes, icono y horario | Informar estado actual y si permite configurarlos; no publicar el icono antes de tener el adaptador probado |
| M8 | Permisos para completar posteriormente la configuración | Quién puede habilitar llamadas y comprobar su propagación en Meta cuando el equipo técnico esté preparado |

Para este piloto solo habrá llamadas **iniciadas por la persona**. No hace falta preparar campañas ni permisos para llamadas salientes. Un botón de llamada enviado por plantilla es otra forma opcional de acceso; no confundirlo con el icono de llamadas ni con la elegibilidad de la WABA.

### Plantilla de respuesta de Juan

Completar para cada ID M1–M8:

```text
ID:
Estado: confirmado / bloqueado / sin acceso / no encontrado
Valor o mensaje exacto de la interfaz:
Fecha y pantalla consultada:
Evidencia privada disponible: sí / no
Acción pendiente y responsable:
```

**No subir capturas de clientes, documentos de verificación, claves, tokens, contraseñas, códigos de acceso ni identificadores completos de cuenta a este repositorio público.** Las capturas, si hacen falta, por canal privado y con lo ajeno a la comprobación oculto. Si el requisito no se cumple, registrar el impedimento y el procedimiento oficial que indique Meta; no crear otra WABA ni mover el número.

## Decisión técnica propuesta

```text
Persona en WhatsApp
  → Meta / Twilio WhatsApp Business Calling
  → TwiML de voz + ConversationRelay
  → sesión autenticada de Velai
  → contexto de Alma + modelo de Anthropic
  → respuesta progresiva → voz → persona
```

Configuración inicial propuesta: **Google STT + Google TTS explícitos**, español y voz compatibles por verificar. Evitar valores predeterminados: ConversationRelay usa ElevenLabs como TTS por defecto. No activar detección multilingüe automática sin revisar sus requisitos de proveedor.

ElevenLabs **como voz dentro de Relay** se puede evaluar más adelante sin mover el número de Twilio. Es distinto de importar WhatsApp a ElevenLabs Agents; no se propone esa migración. No está demostrado que una voz sea más natural para Alma: hay que escucharla.

| Alternativa revisada | Qué hay debajo | Decisión para este piloto |
| --- | --- | --- |
| Ejemplo Twilio + Anthropic | Node/Fastify, WSS, ConversationRelay y Claude con streaming | Referencia preferida; adaptar a Velai, no desplegar sin revisión |
| Twilio Agent Connect | SDK de canales con Relay y opciones Memory/Orchestrator | No incorporar memoria duplicada ni nuevos productos sin necesidad |
| Pipecat | Twilio Media Streams y pipeline configurable; el ejemplo usa OpenAI/Deepgram/Cartesia | Reservar para una necesidad demostrada de mayor control; añade operación de audio |
| LiveKit Agents | Conector Twilio hacia LiveKit Cloud | Más plataforma e infraestructura para este primer caso |

Se leyó el código público `server.js` del ejemplo de Twilio, rama `step3-conversation-tracking`, commit `3a020887c5df017816edcc3a5d62c3c92d410f03`. No se ejecutó. Tiene sesiones en memoria y logs de contenido; no resuelve nuestro aislamiento, duración ni operación de producción. Su patrón de interrupciones requiere cancelar la generación en curso para que un turno antiguo no siga hablando.

## Trabajo técnico que puede avanzar sin Meta

Esta lista queda preparada para implementación; **no marcar como realizada por existir el diseño**.

- [ ] Definir una sesión de voz por tenant/CallSid, sin mezclar el historial de otras marcas. Aprovechar Cloudflare y evaluar Durable Objects para estado, temporizadores y recuperación antes de añadir un servidor externo.
- [ ] Crear endpoints HTTPS de voz/estado y WSS. Validar `X-Twilio-Signature` también en el handshake, con la credencial de la subcuenta correcta; rechazar discrepancias de cuenta, número o sesión.
- [ ] Aplicar una allowlist temporal de llamantes internos y límite de concurrencia/consumo. Rechazar el resto antes de conectar Relay. No anunciar el piloto públicamente.
- [ ] Cargar contexto desde el tenant real de Alma, con reglas propias de voz. No pegar una copia divergente del prompt como nueva fuente de verdad.
- [ ] Generar respuestas en streaming; serializar turnos y cancelar la generación al interrumpir, colgar o vencer el tiempo. El historial debe distinguir lo generado de lo reproducido.
- [ ] Resolver continuidad llamada/chat con vínculo de contacto validado y acceso limitado al tenant; no asumir que el número identifica a una persona para toda clase de datos sensibles.
- [ ] Decidir y documentar qué contenido se conserva en D1 y por cuánto tiempo. Separar memoria durante la sesión de transcripción persistente y de un resumen para continuar por chat.
- [ ] Añadir aviso, cierre y respaldo técnico del máximo de 180 segundos, medido desde la respuesta de la llamada; no reiniciar el plazo al reconectar el WSS.
- [ ] Manejar fallos de modelo, almacenamiento o voz con un mensaje breve de salida y cierre. No dejar la llamada abierta en espera indefinida.
- [ ] Probar localmente con eventos sintéticos, sin llamadas facturables ni datos reales. Preparar configuración por tenant que después pueda extenderse a Vai/NAYA/Dara.

Alma conserva su función de escucha y acompañamiento como **asistente virtual**, sin presentarse como psicóloga. El prompt actual dice que debe seguir escuchando siempre: hay que adaptar esa regla a un cierre anunciado y ofrecer continuidad por escrito, conservando sus pautas actuales ante situaciones delicadas. No convertir automáticamente cada llamada en un lead.

## Experiencia y límite de tres minutos

| Momento | Comportamiento propuesto |
| --- | --- |
| Inicio | «Hola, soy Alma, la asistente virtual de Diálogos. Podemos hablar durante tres minutos y después seguir por WhatsApp. ¿Cómo estás hoy?» |
| 150 s | Aviso corto de que queda medio minuto; evitar solaparlo con la voz de la persona |
| 165 s | Iniciar un cierre breve, sin preguntas nuevas; ofrecer continuar por chat |
| 180 s | Terminar técnicamente la llamada aunque falle el modelo o el cierre hablado |

El límite no puede depender de que el modelo lo recuerde. Twilio Call REST documenta la actualización de `TimeLimit`, sujeta a configuración: establecer y comprobar su aplicación a la llamada entrante; si no puede garantizarse, no conectar la sesión del piloto. Añadir temporizador durable y terminación de la llamada mediante `Status=completed` como respaldo, cancelando el trabajo en curso. No usar solo `setTimeout` en un proceso efímero ni confiar en un atributo de `<Dial>` para una sesión `<Connect><ConversationRelay>`.

## Configuración de Twilio que sigue pendiente

1. Verificar cuenta/subcuenta y facturación efectiva. La cifra visible de saldo en una subcuenta no demuestra por sí sola si consume el saldo compartido del padre. No recargar ni contratar nada como parte de este borrador.
2. Comprobar si ya está aceptado el addendum de funciones predictivas/generativas AI/ML requerido por Relay. Si no lo está, debe revisarlo y aceptarlo una persona autorizada; no se ha aceptado durante esta investigación.
3. Crear la aplicación TwiML con endpoints reales y seleccionar esa aplicación **solo en Voice Endpoint Configuration** del emisor existente. Conservar la configuración de mensajería.
4. Confirmar con Meta elegibilidad y visibilidad de llamadas; dejar el icono sin anunciar hasta pasar la prueba interna.
5. Reversión: retirar la aplicación de voz del emisor, detener sesiones del piloto y comprobar que el chat sigue respondiendo. No eliminar ni liberar el número.

## Datos, costes y prueba de aceptación

La propuesta evita grabaciones y Conversation Intelligence. No equivale a cero procesamiento externo: Meta/Twilio transportan la llamada; el proveedor STT procesa audio; Anthropic recibe el texto/contexto necesario; TTS procesa la respuesta. La documentación indica que Relay no almacena transcripciones por defecto, pero quedan por comprobar los metadatos, subprocesadores y región efectiva de toda la ruta. La región de D1 no prueba residencia europea del audio/modelo.

Tarifas publicadas consultadas el 28/10/2026: WhatsApp entrante Twilio **0,005 USD/min**; conectividad entrante Meta sin cargo; Relay **0,07 USD/min**. Base estimada **0,075 USD/min**: una llamada de 3 min ≈ **0,225 USD**; diez ≈ **2,25 USD**, más modelo, alojamiento, impuestos y extras que se habiliten. No es una factura ni un presupuesto final; revalidar tarifa y granularidad de facturación antes de gastar. No se presupone un recargo o ahorro por cambiar la voz.

Prueba propuesta: diez llamadas internas, con casos sintéticos y objetivo inicial de latencia por turno p95 ≤ 2,5 s desde fin de voz del usuario hasta primer audio de respuesta. Es un objetivo a medir, no un resultado conseguido.

| Prueba | Criterio de aceptación |
| --- | --- |
| Contexto y tono | Se identifica como Alma, mantiene el contexto de Diálogos y escucha sin forzar captación |
| Interrupción | Deja de reproducir el turno anterior y no reaparecen tokens/audio obsoletos |
| Comprensión | Validar español, acentos, nombres y números; pide aclaración cuando no entiende |
| Duración | Aviso/cierre y terminación verificados en las diez llamadas; límite 180 s con resolución de medida y desviación anotadas |
| Fallos | Ensayar timeout/modelo/voz/WSS; no queda llamada huérfana ni se renueva el plazo |
| Aislamiento | Firma inválida, cuenta ajena, tenant ajeno, llamada duplicada y llamante fuera de allowlist rechazados |
| Datos y coste | Sin grabación, sin logs de contenido; revisar eventos, duración y cargos reales |
| Regresión | Mensajería de Alma funciona después de habilitar y después de revertir voz |

No ampliar a público ni a otros tenants hasta revisar los resultados. Una llamada conectada no acredita comprensión, seguridad, continuidad de memoria o entrega de mensajes de seguimiento.

## Fuentes y punto exacto de reanudación

- [WhatsApp Business Calling: requisitos, activación y restricciones](https://www.twilio.com/docs/voice/whatsapp-business-calling).
- [ConversationRelay: onboarding y addendum](https://www.twilio.com/docs/voice/conversationrelay/onboarding).
- [Proveedores, atributos e idioma de Relay](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay).
- [Protocolo WSS y firma](https://www.twilio.com/docs/voice/conversationrelay/websocket-messages).
- [Call REST: actualización y terminación](https://www.twilio.com/docs/voice/api/call-resource).
- [Transcripciones de Relay](https://www.twilio.com/docs/conversation-intelligence-classic/conversation-relay-integration).
- [Tarifas WhatsApp](https://www.twilio.com/en-us/whatsapp/pricing) y [Relay](https://www.twilio.com/en-us/products/conversational-ai/pricing).
- [Ejemplo Twilio/Anthropic e interrupciones](https://www.twilio.com/en-us/blog/anthropic-conversationrelay-token-streaming-interruptions-javascript) y [código inspeccionado](https://github.com/pkamp3/cr-anthropic-demo/tree/3a020887c5df017816edcc3a5d62c3c92d410f03).
- [Twilio Agent Connect](https://www.twilio.com/docs/conversations/agent-connect/overview), [Pipecat/Twilio](https://docs.pipecat.ai/pipecat/telephony/twilio-websockets) y [LiveKit/Twilio](https://docs.livekit.io/telephony/connectors/twilio/).

**Para retomar:** leer este documento, revalidar las identidades y el emisor, incorporar respuestas M1–M8 por un canal adecuado y ejecutar la lista técnica. Este PR es de documentación: no incluye adaptador, despliegue, cambios de cuentas, aceptación de contratos ni llamadas reales. Meta es una dependencia externa; la implementación puede avanzar en paralelo, pero sus checks no están completados.
