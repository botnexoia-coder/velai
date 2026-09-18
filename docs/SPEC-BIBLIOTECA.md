# SPEC · Biblioteca multimedia por cliente — el bot envía imágenes, PDF, audio y vídeo

> Pedido por Juan el **2026-09-17**: «un apartado multimedia, que el bot pueda tomar de ahí
> imágenes, documentos o audios para enviar en los chats, tanto WhatsApp como web y
> cualquier otro canal que implementemos».
>
> Hoy Vai solo sabe escribir. Cuando preguntan por tarifas, por el menú o por cómo llegar,
> lo cuenta con palabras o suelta una URL, y el cliente final tiene que salir del chat. Esto
> es lo contrario: el negocio sube su material **una vez** desde su panel y el bot lo
> entrega solo, en el momento en que hace falta.

---

## 0. Decisiones que fijan el diseño (Juan, 2026-09-17)

| Decisión | Elegido | Consecuencia en el código |
|---|---|---|
| Cómo elige el bot | **Herramienta de IA** sobre el catálogo | Cada archivo lleva una descripción; el modelo decide. Cero reglas que mantener a mano. |
| Quién gestiona | **Cliente y Velai** | Autoservicio, como el calendario y los servicios: rutas en `clienteAllowed`. |
| Tipos | Imagen, PDF, audio y vídeo corto | Cuatro familias de magic bytes desde el día uno. |
| Almacenamiento | **R2 obligatorio** | Sin binding, la subida da 503. Nunca caer a KV en silencio. |
| Primer canal | **WhatsApp y Messenger** | Todo el trabajo vive en el worker y se verifica en CI. |
| Cuota | **500 MB por cliente** | ~15 GB con 30 clientes: 7 céntimos/mes en R2. |

**Por fichero, los límites del canal y ni un byte más**: 5 MB imágenes, 16 MB audio, vídeo y
PDF. Son los de WhatsApp. Aceptar más sería prometer algo que el canal no entrega.

---

## 1. La arquitectura, en una cadena

```
Panel (cliente o Velai) → POST bytes crudos → magic bytes → reserva atómica de cuota en D1
   → R2 (lib/<tenant>/<aleatorio>.<ext>) → fila en tenant_media (nombre + DESCRIPCIÓN)
                                                      ↓
              catálogo del tenant → bloque volátil del system → el modelo lo lee
                                                      ↓
   tool enviar_archivo(archivo: <slug>) → executor (closure sobre el tenant resuelto)
                                                      ↓
              NO envía: rellena meta.attachment  ← igual que meta.bookingCard hoy
                                                      ↓
              el CANAL envía:  TwiML <Media>  ·  MediaUrl  ·  campo JSON del widget
```

**El punto que sostiene todo lo demás: el executor no envía nada.** Solo deja el archivo
elegido en `meta`, exactamente como hace `meta.bookingCard` (`worker/app.js:1872`, leído en
`:2400`). Así hay **un solo camino de envío por canal** y la herramienta se prueba entera
sin tocar Twilio.

---

## 2. Fase 0 — R2 de verdad (infraestructura, sin producto)

Entrega valor sola: los logos dejan de comerse el namespace KV.

- Juan activa R2 en el dashboard (un clic; la API responde 10042 mientras no lo esté) y se
  crean `vai-media` y `vai-media-staging`.
- `wrangler.toml`: descomentar el binding de `:142-149` **y añadir el equivalente en
  `[env.staging]`**. Hacerlo solo en producción repetiría el fallo que esta spec evita:
  staging escribiendo en KV sin que se note.
- **`PUBLIC_MEDIA_BASE` (`worker/app.js:33`) está clavado a `https://api.hirevai.com`.** Pasa
  a variable en los dos bloques `[vars]`; si no, cada URL que guarde staging apunta a
  producción y da 404 eternos.
- Regla nueva en `scripts/check-entornos.mjs`: staging no puede usar el bucket de
  producción, simétrica a las que ya existen para KV y D1.
- **`mediaPut` (`worker/app.js:759`) cae hoy a KV devolviendo `'kv'`, y nadie mira ese
  valor.** Para un logo es tolerable; para una biblioteca no, y el motivo no es el tamaño
  sino con quién comparte: el único namespace KV guarda el estado del chat, los rate limits
  y la caché de tenants. El camino de la biblioteca lanza `503 media_store_required` en vez
  de escribir ahí. Los logos conservan su comportamiento; `mediaGet` sigue mirando los dos
  almacenes, así que lo antiguo se sigue sirviendo.

Verificación: subir un logo desde el panel y ver `store:'r2'` en la respuesta.

---

## 3. Fase 1 — La biblioteca existe (todavía sin IA)

Entrega valor sola: el cliente sube su material y tiene el enlace de cada archivo.

**`migrations/0039_biblioteca.sql`** (molde: `migrations/0034_servicios.sql`) — `tenant_media`
con `id`, `tenant_id` (FK), `slug` único por tenant, `kind` (`CHECK IN ('image','pdf','audio','video')`),
`mime` y `ext` **derivados de los magic bytes**, `key`, `bytes`, `sha256` (resubir lo mismo
no duplica cuota), `name`, `description` (≤300 caracteres: es lo que lee el modelo),
`channels`, `active`, `position`, `sent_count`, `last_sent_at`, `deleted_at`,
`created_at/updated_at`. Y en `tenants`: `media_quota_bytes / media_bytes_used /
media_files_used` — NULL usa el default del entorno, precedente de `ai_daily_limit` (0011).

**`worker/routes/biblioteca.js`** (nuevo; molde exacto `worker/routes/calendario.js:196-274`):
handler compartido con `partesAdmin` → `UUID_RE` → `assertOwnTenant` → tenant 404 →
discriminar por path. `GET` catálogo y cuota, `POST` subida, `PATCH` metadatos, `DELETE`
lógico, y `POST …/reconcile` **solo velai** para recalcular contadores.

**Subida**: cuerpo binario crudo con `request.arrayBuffer()` y opciones en query string,
igual que el logo (`worker/routes/conexiones.js:47`). No se escribe un parser multipart: no
existe en el worker, no hace falta, y serían 200 líneas sensibles que CI no puede demostrar.
Se comprueba `Content-Length` **antes** de bufferizar.

**Cuota sin escanear y sin carrera**: comprobar y reservar son **una sola sentencia** —
`UPDATE tenants SET media_bytes_used = media_bytes_used + ? WHERE id = ? AND
media_bytes_used + ? <= COALESCE(media_quota_bytes, ?)`; `meta.changes === 0` → `413
quota_exceeded`. Es el patrón atómico de `booking_claims` contra dobles reservas. Orden:
reservar → `mediaPut` → INSERT; si R2 falla, UPDATE compensatorio. **Falla cerrado**: se
cobra de más, nunca de menos, y el endpoint de reconciliación corrige la deriva.

**Borrado, y el copy honesto que lo acompaña**: `active=0` + `deleted_at` saca el archivo del
catálogo al instante — eso es lo que el cliente entiende por borrar. Los bytes se purgan a
los 7 días por cron, y **solo entonces** se libera la cuota (si se liberara antes, subir y
borrar en bucle llenaría R2 con una cuota de 500 MB). El panel lo dice sin eufemismos:
borrar aquí no apaga la URL hoy mismo —la caché de `/media/*` es `immutable` un año y no hay
API de purga— ni borra lo que ya se envió. **Sustituir un archivo crea siempre una clave
nueva**; jamás se sobrescribe una clave.

**Panel**: `panel/src/views/Biblioteca.tsx`, pestaña dentro de Conexiones con el patrón
`chtabs` de `Calendario.tsx:218-233`. La subida clona `useLogoUpload`
(`panel/src/hooks/queries.ts:523`): el `File` como cuerpo con su `Content-Type`. Se ve la
cuota («34 de 500 MB · 9 archivos») y, por archivo, `sent_count` — que es lo que hace que el
cliente detecte solo su PDF caducado.

**Lista blanca del cliente** en `worker/middleware.js`, respetando el **formato literal** de
cada línea (`test/aislamiento.test.js` lee su `toString`): `…/media` con GET/POST y
`…/media/:id` con PATCH/DELETE.

---

## 4. Fase 2 — El bot elige y envía por WhatsApp y Messenger

**`worker/biblioteca.js`** (nuevo; gemelo de `worker/calendar.js:11-72`): `MEDIA_TOOL`
constante de código, `MEDIA_GUARDRAILS` en código, `mediaCatalogText(items)` con render
**determinista** (`ORDER BY position, id`, serialización campo a campo) y un compositor único
`mediaTools(hasMedia)` al estilo de `calendarTools`. Sin biblioteca, el prompt queda byte a
byte como hoy.

**El catálogo va al bloque VOLÁTIL del system**, junto a `Servicios disponibles`
(`worker/app.js:1825`). Es el precedente que ya existe para un dato por tenant que cambia al
editarlo. La alternativa —meterlo al final del bloque cacheado— sale más barata en tokens
(0,1x por turno frente a 1x), pero introduce un fallo **invisible**: si el catálogo se
renderiza en orden distinto entre llamadas, la caché de prompt deja de acertar y la única
señal es `cache_r=0` en `ai_usage`. Al volumen de hoy la diferencia es de uno o dos euros al
mes; cuando un catálogo crezca de verdad se reevalúa. **Lo que nunca se hace es meter datos
del tenant en el `input_schema` de la tool**: las tools se renderizan antes del breakpoint de
`cache_control` (`worker/calendar.js:9-10`) e invalidarían el prefijo entero.

**La tool acepta solo un `slug` opaco.** Nunca una URL ni una clave de almacén: el executor
es un closure sobre el tenant ya resuelto por el canal y busca con `WHERE tenant_id=? AND
slug=? AND active=1`. Aceptar una URL del modelo sería una fuga entre clientes servida en
bandeja a cualquier inyección de prompt.

**Salvaguardas en el executor, no en el prompt**: máximo 1 adjunto por turno y 2 por
conversación, `Set` de ya enviados (el bucle admite varias tools por ronda), y el catálogo
**filtrado por canal** para no ofrecer lo que WhatsApp no puede entregar.

**Envío**: `twiml(text, mediaUrls)` en `worker/app.js:2917` (`<Body>` + `<Media>`) para el
camino síncrono, y un parámetro opcional `mediaUrls` en `sendTwilioText`
(`worker/app.js:2797`) para el asíncrono. **Ojo**: `new URLSearchParams({...})` no admite
claves repetidas; hay que `append('MediaUrl', u)`. Twilio descarga la URL él mismo y valida
el `Content-Type`, que es justo el que `/media/*` sirve desde los magic bytes.

**El trabajo de fondo de esta fase**: hoy el bucle de tools solo existe si el tenant tiene
calendario (`worker/app.js:2919-2921` llama a `callAnthropic` sin tools). Un tenant con
biblioteca y sin calendario necesita ese bucle. Se resuelve con el híbrido que ya está en
producción: primera llamada con tools (latencia idéntica a hoy); si no pide herramientas,
TwiML de siempre; si pide solo `enviar_archivo`, una segunda llamada síncrona y TwiML con
`<Media>`; si se complica, el camino asíncrono que ya existe.

**Registro sin migración**: el envío se escribe como texto normal del turno
(`[enviado: tarifas-2026.pdf]`). Se ve en la bandeja, viaja en el historial que lee el modelo
—lo que da gratis la guarda anti-repetición entre turnos— y no toca el `CHECK` de `role` de
`conv_messages`, que obligaría a reconstruir una tabla ya poblada (la 0023 se permitió eso
cuando estaba casi vacía).

**Arreglo obligatorio aquí**: hoy un mensaje entrante sin texto se descarta en silencio
(`worker/app.js:2874-2877`). En cuanto el bot mande archivos, la gente responderá con fotos y
notas de voz y se encontrará con un bot mudo. No se implementa recibir media, pero sí
contestar con una frase.

---

## 5. Fase 3 — Chat web (widget v20)

Campo `attachments` en el JSON de `/chat`, hermano de `booking` (`worker/app.js:2400`).
Render en `addMsg` (`site/assets/vai-widget.js:663`) con **la misma validación que la tarjeta
de reserva** (`:676-686`): `new URL()`, origen en lista blanca, `pathname` que empiece por
`/media/lib/`, sin `hash` ni credenciales, y `createElement` con `src`/`href`, nunca
`innerHTML` con dato del servidor. Es código que corre dentro de las webs de seis clientes.

**Degradación sin coordinar versiones**: el widget v20 declara `media: true`; si no lo
declara, el servidor añade la URL al final del texto. Un widget viejo enseña un enlace plano
en vez de quedarse sin nada.

Versión en lockstep — `scripts/check-site.mjs` lo exige en bloque: cabecera del widget,
`var V = '20'` en `site/assets/vai.js`, los HTML de `site/`, `vai-citas.js` y el snippet de
`panel/src/views/ReservasOnline.tsx:87`. **Las seis webs cliente no se tocan**: ya usan el
loader sin versión y basta publicar Pages. Excepción conocida: `tufisiooficial.com` y
`gogestion-demo` siguen fuera del loader (`docs/TAREAS-PENDIENTES.md:283-287`) y caerán al
texto con enlace hasta que se migren.

---

## 6. Fase 4 — Queda registrado y se ve

`ALTER TABLE conv_messages ADD COLUMN attachments_json TEXT`, la columna en las tres
consultas de `worker/routes/conversaciones.js`, chips de adjunto en
`panel/src/views/Conversaciones.tsx:508` con un helper `mediaHref()` que rechace cualquier
cosa que no sea `https://…/media/lib/…` (React no protege de `javascript:`), `attachments` en
`/chat/poll`, y el cron de purga: papelera de 7 días → borrar de R2 → liberar cuota.

---

## 7. Seguridad: los cinco innegociables

1. **Tipo por magic bytes, jamás por cabecera**: PDF `%PDF-`, MP3 `ID3`/`FF Fx`, OGG `OggS`,
   MP4/M4A `ftyp` + marca. **SVG rechazado** (es script); GIF y WebM fuera de esta fase.
2. **`/media/*` gana `X-Content-Type-Options: nosniff`, `Content-Security-Policy:
   default-src 'none'; sandbox` y `X-Robots-Tag: noindex`.** Sirve con `ACAO:*` desde el
   mismo origen que la API del panel: un fichero interpretable como HTML ahí dentro es XSS
   en `api.hirevai.com`.
3. **Claves inadivinables** (`lib/<tenant>/<uuid+8 hex>.<ext>`) y nunca sobrescribir una
   clave. El riesgo real no es la enumeración —no hay listado y R2 devuelve 404— sino el
   reenvío, que es inherente a enviar algo.
4. **El borrado se explica como es** (§3), sin prometer un borrado que la caché no permite.
5. **La `description` la escribe el cliente y entra en el prompt**: ≤300 caracteres, sin
   saltos de línea ni caracteres de control, para que no falsifique secciones del system.

---

## 8. CI y tests — la lista literal

| Obligación | Dónde |
|---|---|
| Tabla con `tenant_id` | `'tenant_media'` en `DIRECTAS`, `scripts/check-aislamiento.mjs:44-46` |
| Rutas del rol cliente | 2 líneas en `clienteAllowed` (formato literal = contrato) |
| Barrido adversario | 2 casos en `CASOS` de `test/aislamiento.test.js` |
| Ficheros nuevos | `worker/routes/biblioteca.js` y `worker/biblioteca.js` **a mano** en `check:js` |
| Test nuevo | `test/biblioteca.test.js` en `test:backend` (lo exige `check-test-catalog.mjs`) |
| Versión del widget (fase 3) | lockstep completo de `scripts/check-site.mjs` |
| Panel | `panel/src/views/Biblioteca.test.tsx` |

`test/biblioteca.test.js` cubre como mínimo: cada magic byte nuevo acierta y un HTML
disfrazado de PDF se rechaza; dos subidas concurrentes que juntas exceden la cuota dan una
201 y una 413; un `slug` de otro tenant devuelve `archivo_desconocido`; una URL en el
parámetro, también; el segundo envío del mismo archivo devuelve `ya_enviado`;
`sendTwilioText` con dos adjuntos produce dos `MediaUrl`; y el payload a Anthropic conserva
`cache_control` intacto y sin tools cuando el tenant no tiene biblioteca (no-regresión del
prompt actual).

---

## 9. Lo que NO entra

Recibir archivos del cliente final (otro perímetro de seguridad y otra cuota); PDF como base
de conocimiento (`docs/CONTEXTOS-AMPLIOS.md` ya lo descartó: entraría entero en el contexto y
se paga en cada mensaje — esto es para **enviar**, no para consultar); miniaturas,
transcodificación o Cloudflare Images; Telegram (no es canal conversacional); URLs firmadas
(la clave `lib/<tenant>/…` deja la puerta abierta); analítica de descargas (`/media/*` va por
caché de borde y no se puede contar sin desactivarla); y que un agente humano adjunte desde
la bandeja — es la fase natural siguiente y la infraestructura queda lista, pero no es lo
pedido.

---

## 10. Riesgos con nombre

1. **Desplegar sin R2**: `mediaPut` cae a KV y el síntoma aparece semanas después como «Vai
   responde sin memoria». Por eso la guarda es un 503, no un aviso.
2. **Binding R2 solo en producción**: staging validaría el comportamiento equivocado.
3. **Twilio descarga la URL él mismo**: un `Content-Type` mal derivado es un error 12300 y un
   mensaje sin archivo. El texto tiene que sostenerse solo, siempre.
4. **Extender el bucle de tools al camino del 99%** mete cada mensaje de WhatsApp en una
   llamada con tools, con el corte de ~15 s de Twilio detrás. La tool solo existe si el
   tenant tiene biblioteca y el segundo turno síncrono está acotado a uno.
5. **Deriva de cuota** por subida interrumpida entre la reserva y el INSERT: falla cerrado y
   se corrige con la reconciliación.
6. **Pages desplegado a medias** (fase 3): CI verifica el lockstep en el repo, pero no sabe
   si Pages se publicó; el loader seguiría sirviendo v19 en silencio.

---

## 11. Verificación de punta a punta

1. `npm run check`, `npm run test:panel`, `npm --prefix panel run typecheck` y el E2E de
   Playwright.
2. Subir un PDF de 3 MB y un MP4 de 20 MB: el primero entra, el segundo da `413` con el tope
   del canal en el mensaje.
3. Con la cuota casi llena, la subida que la excede da 413 y **no** deja objeto huérfano.
4. En staging, pedir las tarifas por WhatsApp al tenant de prueba: llega el PDF con su frase,
   la conversación lo registra como `[enviado: …]` y pedirlo otra vez no lo manda dos veces.
5. Desactivar el archivo y repetir: el bot ya no lo ofrece ni lo nombra.
6. Ni un `media_send_failed` en los logs, y `ai_usage` sin desplome de aciertos de caché.
