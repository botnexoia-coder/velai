# SPEC · Instagram DM — qué haría falta de verdad

> Separada de [`SPEC-CANALES-SOCIALES.md`](./SPEC-CANALES-SOCIALES.md) el 2026-09-22, al
> descubrir que **Instagram no se puede hacer por Twilio**. No está empezada: esto es el
> alcance honesto para poder decidir cuándo se arranca, no un plan de ejecución.

---

## El hallazgo que la separa

Todo lo demás de mensajería en Velai entra por Twilio. Instagram **no está** entre los
canales de mensajería de Twilio (WhatsApp y Facebook Messenger sí; Messenger además en
*Public Beta*). Comprobado el 2026-09-22 contra su documentación.

Así que Instagram no es «un canal más»: es una **integración directa con Meta**, con su
propia autenticación, su propio webhook y su propio ciclo de revisión. Nada del camino de
Twilio se reaprovecha salvo la parte nuestra: el enrutado por `tenant_channels`, la
conversación, la captura de lead y el prompt.

## Lo que exige Meta

| Pieza | Qué implica |
|---|---|
| App de Meta propia | Con los permisos `instagram_manage_messages` y `pages_messaging` |
| **App Review** | Revisión de Meta antes de poder usarla con cuentas que no sean tuyas. **Se mide en semanas y no depende de nosotros.** Es el plazo que manda |
| Webhook propio | Verificación por `hub.challenge` en el alta y firma `X-Hub-Signature-256` en cada entrega — otro esquema distinto al HMAC de Twilio que ya validamos |
| Token por página | Long-lived page access token de cada cliente, cifrado en D1 como `twilio_auth_token_enc` |
| Envío | Graph API (`/me/messages`), no TwiML: el envío deja de ser síncrono y pasa a ser una llamada aparte, como ya hace el calendario |
| Requisito del cliente | Su cuenta de Instagram debe ser **Business o Creator** y estar vinculada a una página de Facebook |

## Lo que ya está hecho de nuestro lado

Poco trabajo perdido, y conviene saberlo antes de presupuestarlo:

- `tenant_channels` admite `kind='instagram'` sin migración (no tiene `CHECK` sobre kind).
- `canalesOcupados` y `PLANES` ya cuentan Instagram como red del plan Profesional
  (`worker/planes.js`), así que el gating no hay que tocarlo.
- El panel ya tiene su etiqueta, su icono y su estado «Sin activar» (`CX_SOON`).
- `conversations.channel` ya acepta `instagram` en filtros y métricas.

## Lo que habría que construir

1. **`ADDRESS_RE` acepta `instagram:<id>`** (`worker/app.js:590`). Hoy lo rechaza con 400,
   que es correcto mientras el canal no exista.
2. **Webhook nuevo**, no el de Twilio: verificación `hub.challenge`, firma
   `X-Hub-Signature-256`, y la forma del payload de Meta (que anida los mensajes de otra
   manera).
3. **Envío por Graph API** con el token de la página, y la ventana de 24 h de Meta con sus
   etiquetas, que no es la misma política que la de WhatsApp.
4. **Alta en el panel**: el `POST /tenants/:id/channels` ya existe y solo habría que
   añadir `instagram` a `SECUNDARIOS` (`worker/routes/conexiones.js`) y guardar su token.
5. **Copy de la web**: hoy dice «Instagram próximamente»; ese día pasa a incluido.

## Cuándo arrancarla

Cuando haya **un cliente que la pida de verdad**, porque el App Review es el camino
crítico y caduca el esfuerzo si se hace en vacío. Mientras tanto la promesa comercial ya
está ajustada: la web dice «próximamente» y el panel lo pinta «Sin activar», que es lo
honesto.
