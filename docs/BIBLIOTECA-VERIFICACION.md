# Biblioteca multimedia: implementación y verificación

Estado del 2026-09-17: las fases 0–4 de [SPEC-BIBLIOTECA.md](SPEC-BIBLIOTECA.md)
están implementadas y publicadas en staging. Twilio confirmó la entrega real de un
PDF de 3 MB al destinatario de prueba autorizado. La selección por IA, la repetición,
la desactivación con IA y la publicación en producción siguen pendientes. Por indicación
de Juan, las pruebas restantes del bot se harán en producción, con su clave actual.

Cloudflare confirmó por `wrangler r2 bucket list` que existen `vai-media` y
`vai-media-staging`, creados el 2026-09-17. La configuración local enlaza cada entorno
a su bucket y a su propio `PUBLIC_MEDIA_BASE`.

Juan autorizó el número de Velai **+1 570 616 0059** para la prueba. La consulta remota
confirmó que `tenant_channels` de staging ya lo asocia al tenant `velai`, aunque
`tenants.channel_address` conserva el número ficticio del seed. Juan proporcionó las
credenciales mediante `.dev.vars`; la consulta de cuenta de Twilio autenticó correctamente
y confirmó una cuenta activa. Se cargaron `TWILIO_ACCOUNT_SID` y `TWILIO_AUTH_TOKEN`
como secretos de staging, sin mostrar sus valores. Twilio confirmó que el emisor está
`ONLINE` y que su webhook sigue apuntando al Worker de producción. No se cambió ese
webhook. Juan autorizó un destinatario de prueba y abrió la ventana de WhatsApp con
un mensaje entrante el 2026-09-17 a las 17:54:15 UTC.

La migración 0039 se aplicó en D1 remoto de staging. El primer intento falló con
`incomplete input` en el `CASE ... END` del trigger; D1 revirtió todos los cambios.
Se sustituyó por `SELECT RAISE(...) WHERE changes()=0`, conservando la misma reserva
atómica. Las 17 pruebas backend pasaron otra vez y la migración remota terminó con éxito.

Worker de staging publicado: versión `59d695ad-a89b-4e9a-a686-42220ea577f3`, con el
panel del artefacto del CI verde [35253248210](https://github.com/botnexoia-coder/velai/actions/runs/35253248210).
Prueba de humo remota: preflight `/chat` **204**, arranque del widget `demo-staging`
**200** y API del panel anónima **302** a Access. Producción sigue pendiente.

Se preparó un PDF válido de una página con datos ficticios, de **3.145.728 bytes**.
La fixture reservó cuota mediante el trigger de D1, se subió al bucket R2 de staging
y se registró en el catálogo de Velai de staging. La descarga pública devolvió **200**,
`application/pdf`, SHA-256 idéntico, caché immutable, `nosniff`, CSP sandbox y `noindex`.
Esta preparación por CLI no se presenta como una subida autenticada desde el panel.

La petición firmada al webhook de staging pasó la validación de Twilio, pero terminó
en **503 `ai_not_configured`** antes de llamar a Anthropic. El nombre del secreto
`ANTHROPIC_API_KEY` está listado en Cloudflare, pero su valor no está disponible al
Worker; tampoco está en `.dev.vars`. Juan indicó que no se configure otra clave y que
las pruebas pendientes se hagan en producción. No se modificó `ANTHROPIC_API_KEY`
en ningún entorno. No hubo consumo ni métricas de caché que permitan validar la parte de IA.

Para comprobar independientemente el transporte, se envió el PDF público de staging
por la API real de Twilio al destinatario autorizado. El mensaje
`MM8b47f88816c59cfadb467fde82db146a` terminó en **`delivered`**, con **1 adjunto** y
`error_code: null`, el 2026-09-17 a las 18:07:01 UTC. No fue una respuesta elegida por
el modelo y no incrementó artificialmente el contador de envíos del catálogo.

## Evidencia por requisito

| Spec | Implementación | Verificación |
|---|---|---|
| §0–2: R2 obligatorio, entornos separados, logos antiguos | `wrangler.toml`, `check-entornos.mjs`, `mediaPut(required)`, `publicMediaBase` | Buckets consultados en Cloudflare; backend comprueba 503 sin R2, logo nuevo con `store:r2` y URL de staging; se conserva la lectura de KV de logos antiguos |
| §3: esquema, catálogo y metadatos | `0039_biblioteca.sql`, `routes/biblioteca.js` | SQLite con todas las migraciones y FK activas; CRUD, hash, canales, orden, baja y validación |
| §3: cuota sin carrera ni huérfanos gratuitos | Reserva persistente `tenant_media_uploads` y trigger `tenant_media_reserve` | Dos subidas simultáneas sobre cuota: una aceptada y otra 413; fallo de R2, fallo del INSERT y fallo de limpieza; reconciliación conserva las reservas |
| §3: autoservicio del cliente y Velai | Conexiones → Biblioteca; lista blanca y `assertOwnTenant` antes de D1 | Barrido adversario de las dos rutas; pruebas React; E2E con cliente, handlers reales y SQLite |
| §3, §6: papelera y purga | Borrado lógico inmediato; cron elimina de R2 tras 7 días y después descuenta bytes/archivos | Catálogo vacío tras baja pero cuota intacta; purga diferida, dos crons concurrentes y reservas abandonadas |
| §4: herramienta y caché | `MEDIA_TOOL`, `MEDIA_GUARDRAILS`, catálogo ordenado y volátil; executor con tenant resuelto | Slug ajeno y URL rechazados; máximo uno por turno y dos por conversación; repetición entre turnos; `cache_control` idéntico sin biblioteca |
| §4: WhatsApp/Messenger sin calendario | Primera llamada con tools solo cuando corresponda; segunda llamada de adjunto acotada; continuación asíncrona si hay más tools | Webhooks firmados de ambos canales contra el Worker real y proveedor simulado; TwiML con Media; parámetros MediaUrl repetidos; fallo de envío sin registrar éxito |
| §4: medios entrantes | Explicación por texto cuando llega un archivo sin Body; respeta toma de control humana | Prueba de respuesta sin IA y de pausa humana sin respuesta automática |
| §5: widget v20 | `attachments`, capacidad `media:true`, URL en texto para widget anterior, render DOM seguro | Chat web sin calendario; E2E imagen/PDF/audio/vídeo; rechazo de otros hosts, javascript, credenciales y fragmentos; lockstep completo |
| §6: historial y bandeja | `attachments_json`, marcador de texto, consultas de bandeja/transcripción/CSV, `/chat/poll` y chips | Pruebas de persistencia, consultas del panel, exportación y polling; helper `mediaHref` contra URLs hostiles |
| §7: perímetro de archivos | Magic bytes, claves aleatorias nuevas, cabeceras nosniff/sandbox/noindex, descripciones de una línea | Pruebas de cada formato, HTML/SVG disfrazados, cabeceras con y sin caché, tamaño antes del buffer y límite de imagen |
| §8, §11.1–3 | Catálogos de tests y scripts actualizados | `npm run check`, tests panel, typecheck, build y Playwright; PDF de 3 MB aceptado, MP4 anunciado de 20 MB rechazado antes del buffer |
| §11.4–6: proveedor y métricas reales | Staging desplegado, secretos Twilio configurados; PDF real entregado por la API de Twilio | Webhook firmado de staging devuelve `ai_not_configured`; por indicación de Juan, selección por IA, no repetición, desactivación y caché se comprobarán en producción |

## Detalles que protegen los datos

La reserva usa el UPDATE condicional de la especificación dentro de un trigger de
SQLite. El INSERT de la reserva, el incremento y el rechazo por cuota comparten una
sola sentencia. No depende del valor de `changes()` entre llamadas separadas de D1.
La tabla de reservas también permite reconciliar mientras hay una subida en curso:
sumar solamente archivos terminados liberaría cuota que sigue ocupada en R2.

Si un put o INSERT falla, se intenta borrar el objeto antes de devolver la cuota.
Si la limpieza falla, la reserva permanece contabilizada y el cron puede eliminarla
a los siete días. La papelera no puede reactivarse durante una purga. Resubir un
archivo idéntico que ya está en papelera devuelve `media_pending_deletion`.

Los contadores de envío registran el adjunto emitido en una respuesta web/TwiML o
aceptado por la API de Twilio; no son confirmaciones de descarga ni de lectura.
Un fallo de la API al enviar media queda registrado como `media_send_failed`,
intenta entregar una explicación por texto y no incrementa el contador del archivo.

La biblioteca acepta Ogg con Opus. WebP se ofrece en web y Messenger; WhatsApp lo
trata como sticker y tiene requisitos distintos, así que se excluye de ese canal.
Referencias del proveedor: [medios de WhatsApp en Twilio](https://www.twilio.com/docs/whatsapp/guidance-whatsapp-media-messages)
y [API de R2 para Workers](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

## Publicación y comprobación pendiente

1. Publicar mediante el CI/CD documentado en [OPERATIONS.md](OPERATIONS.md), que aplica
   migraciones antes del Worker. La 0039 no modifica las migraciones ya desplegadas.
   El token de despliegue debe poder enlazar ambos buckets R2.
2. Verificar primero Worker y panel. Publicar después el sitio con widget/loader v20,
   `vai-citas.js` y snippet en lockstep. No pedir `?v=20` a Pages antes de que esté activo:
   esas URLs tienen caché immutable.
3. En producción, subir un logo y comprobar `store:r2`; subir un PDF de 3 MB, obtener su
   URL y confirmar Content-Type y cabeceras. La prueba local ya cubre ese recorrido.
4. Con la clave de IA actual de producción y el destinatario autorizado, pedir el documento,
   confirmar entrega real,
   marcador e histórico; repetir para comprobar que no se reenvía. Desactivar y abrir
   una conversación nueva para comprobar que ya no se ofrece.
5. Revisar `media_send_failed` y `ai_usage.cache_r_tokens`/`cache_w_tokens` del mismo
   tenant durante la prueba. Los errores inyectados por tests locales son intencionados
   y no son evidencia de un fallo del proveedor ni de su ausencia en producción.

## Comandos locales

```sh
npm run check
npm run test:panel
npm run typecheck --prefix panel
npm run build --prefix panel
npm exec --prefix panel -- playwright test --config panel/playwright.config.ts
npx --yes wrangler@4 deploy --dry-run --outdir /tmp/velai-biblioteca-bundle
node scripts/check-bundle.mjs /tmp/velai-biblioteca-bundle/vai-worker.js
```

La suite de Biblioteca incluye 17 pruebas backend y 5 pruebas del panel. El conjunto
del panel pasa 171 pruebas y el navegador pasa 28 recorridos, incluyendo Biblioteca
en escritorio/móvil y los cuatro tipos de adjunto en el widget. La subida y la
cuota usan handlers reales y SQLite; Anthropic, Twilio y R2 están simulados en tests.
