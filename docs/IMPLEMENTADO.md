# Implementado — registro consolidado de specs cerradas

> **Consolidación del 2026-08-18.** Cada spec/plan de esta lista se verificó contra el
> código en `main` (suite **54/54**) y se retiró de `docs/`. El texto íntegro de cada
> documento sigue disponible en el historial de git. Lo que sobrevive como pendiente
> está en [`TAREAS-PENDIENTES.md`](./TAREAS-PENDIENTES.md) (pasos manuales y de
> terceros) y en [`CONTEXTOS-AMPLIOS.md`](./CONTEXTOS-AMPLIOS.md) (fases 2–4).
>
> Docs vivos que NO se consolidan: `OPERATIONS.md`, `GUIA-WORKERS.md`,
> `STACK-TECNOLOGICO.md`, `ALTACLIENTE.md`, `PARA-JOHAN-widget-en-webs-cliente.md`
> y los de marketing (`links-strategy.md`, `backlinks-plan.md`, `pauta-anuncios.md`).

---

## FASE0 — Aviso de lead por plantilla de Twilio (`FASE0-TWILIO-PLANTILLA.md`)

El aviso de lead por WhatsApp salió del texto libre y pasó a la Content API de Twilio:
`deliver()` envía `ContentSid`/`ContentVariables` con las cuatro variables saneadas por
`templateVar()` (sin vacíos, sin saltos de línea, tope 200 caracteres), lo que cerró el
error `Undelivered 63016` que tuvo el canal roto desde junio. El teléfono viaja en E.164
(`whatsapp_normalized`) para pulsar-y-llamar, y sin SID de plantilla el canal se marca
`skipped` explícito en vez de fallar en silencio. Tres tests blindan el contrato
(ContentSid sí, `Body=` nunca, variables no vacías). Evolución posterior: `deliver()`
resuelve credenciales por subcuenta y bloquea el envío hasta que la plantilla esté
`approved`.

**Sobrevive como pendiente** (TAREAS-PENDIENTES §2): plantilla en categoría Utility,
status callback del sender, perfil de negocio, webhook de voz, bundle +34.

## FASE1 — Multitenant (`FASE1-MULTITENANT.md`)

El Worker pasó a multi-tenant con un solo despliegue: la tabla `tenants` en D1 guarda la
configuración de cada negocio y el webhook enruta por el campo `To` de Twilio
(`tenantByAddress`, cacheado 5 min en KV incluyendo el fallo), con `404 unknown_tenant` y
alerta a Telegram cuando llega un sender sin fila. El prompt efectivo es siempre
`system_prompt` del tenant + `GUARDRAILS` de código (`systemFor`, con caída al SYSTEM de
código si el seed falta): las reglas antiinyección no se pueden desactivar editando una
fila. Historial, `request_id` y marcas KV quedan namespaceados por `tenant.id`; los avisos
(`team_whatsapp`, `telegram_chat_id`, `lead_template_sid`, `twilio_from`) se resuelven por
tenant con respaldo a env. El panel ganó filtro y columna de cliente, `GET
/api/admin/tenants` y `tenant_name` en el CSV; Messenger tiene fila propia. Las 4
correcciones de la cabecera del doc quedaron aplicadas.

## FASE2 — Gestión de clientes desde el panel (`FASE2-PANEL-CLIENTES.md`)

La gestión de clientes vive entera en el panel — alta, edición y contexto sin SQL ni
despliegues. La API cubre listado con semáforo de configuración, alta con versión inicial,
detalle sin credenciales, PATCH con bloqueo optimista (`stale_tenant`) y versionado en
`tenant_versions`, historial, restore reversible (solo `system_prompt`) y preview del
prompt borrador contra el modelo con rate limit por actor. Los choques de unicidad se
traducen a 409 con mensaje útil, la caché de tenants se invalida por dirección y por slug,
y no existe ruta de borrado: solo desactivar. La interfaz añade contador de
caracteres/tokens, probador, historial y «Duplicar de…».

## Alta de clientes con WABA propia (`PLAN-ALTA-CLIENTES_1.md`, supersedió a `PLAN-ALTA-CLIENTES.md`)

Worker multi-tenant con **una subcuenta de Twilio por cliente**: firma del webhook
validada con el token de *esa* cuenta (cifrado en D1 con AES-256-GCM y AAD por tenant,
rotación con `SECRETS_KEK_OLD`), `deliver()` enviando desde la subcuenta con sus propias
credenciales (sin respaldo cruzado padre→subcuenta), y aprovisionamiento automático desde
el panel (subcuenta, plantilla Utility, sender, OTP) con idempotencia en D1, cerrojo KV,
auditoría, `provision_orphan` con alerta y cron que cierra el círculo por Telegram. Canal
web y Messenger operativos (`messenger:<pageId>` legal; adjuntos sin `Body` → 200 con
TwiML vacío). Los SID de las 4 subcuentas están en Twilio → Subaccounts (Push Protection
impide publicarlos). La versión vieja del plan (`PLAN-ALTA-CLIENTES.md`) quedó supersedida
y su §3.4 documentaba una autenticación incorrecta — no usar como referencia.

**Sobrevive como pendiente** (TAREAS-PENDIENTES §2c): alta real de las filas en el panel,
auth tokens, verificación Meta por cliente, topes de gasto, prueba real de Messenger y
cierre de los `[PENDIENTE:…]` de `tenants/*.md`.

## Canal web `web:<slug>` (`SPEC-CANAL-WEB.md`)

Tercera forma de dirección `web:<slug>`, legal y activable (a diferencia de `pending:`) y
no enrutable por Twilio, con la guarda que rechaza en el webhook cualquier dirección no
enrutable **antes** de gastar una consulta a D1. El panel muestra estos tenants como
«solo web» exigiendo solo contexto ≥200 y un canal de aviso. Desbloquea el entregable sin
trámites de Meta para los 4 clientes en alta. Los 8 hostnames de los clientes ya están en
`ALLOWED_WEB_ORIGINS`.

## Chat web en todo el sitio (`PLAN-CHAT-WEB.md`)

El chat pasó de existir solo en la home a estar en las 26 páginas, por encima del banner
de cookies (`z-index` 10000 vs 9999), con chips, teaser, persistencia por `sessionStorage`
y 7 eventos de analítica (`chat_view` … `chat_error`). Se activó la demo rol-play con 4
personas sectoriales (`restaurante`, `clinica`, `taller`, `inmobiliaria`) invocables por
`?demo=` o `data-vai-demo` (validadas con `isDemoKey`, 409 `conversation_mode_mismatch` al
cambiar de modo). CTAs textuales al chat en home, blog y lead magnets. Avisos de lead
funcionando por Telegram y WhatsApp con plantilla; sin `DEFAULT_TELEGRAM_CHAT_ID`
hardcodeado. Las 3 ramas del plan están mergeadas en `main` y el worker desplegado.

**Sobrevive como pendiente** (TAREAS-PENDIENTES): NIF/CIF real en /privacidad/, Instagram
en el prompt (decisión de negocio), CSS muerto `.vai-fab`, los 3 puntos de Cloudflare
(www en error, DMARC `p=none`, proyecto Pages legacy) y la revisión de métricas del chat
(desde ~2026-08-24).

## Rediseño del panel (`SPEC-REDISENO-PANEL.md`)

El panel adopta los tokens reales de hirevai.com (negro cálido, naranja de marca, Cabinet
Grotesk + Satoshi servidas desde Pages con CORS y `font-src` en la CSP), con retícula de
fondo, header sticky con segmented control accesible, fila de métricas y gráfico de 14
días, y cinco componentes (`pill`, `tenant`, `nb`, `flag`, `meter`) que sustituyen el
texto plano. El naranja queda reservado a lo interactivo y cada estado lleva punto +
etiqueta. Un solo endpoint de datos nuevo, `GET /api/admin/stats`, con la serie rellenada
en servidor y sin PII. Desviación única documentada: 3 ficheros de fuente en vez de 4
(`satoshi-700.woff2` no existe; el bold se sintetiza).

## Usuarios del panel + 4 fixes visuales (`SPEC-USUARIOS-Y-FIXES-PANEL.md`)

Los cuatro defectos visuales tenían una sola causa —la CSP con nonce descarta cualquier
atributo `style=""`— y se arreglaron moviendo el estilo estático a clases y aplicando el
dinámico por CSSOM (`paint()`), más altura fija de 74 px para el gráfico. La parte B añade
la sección «Usuarios del panel» en la ficha de cliente con tres endpoints solo-velai,
409/400 según spec, normalización de correos y auditoría con rol en `tenant_versions`.
Como contrapeso a relajar Access: cada 403 queda registrado con el correo, alerta a
Telegram al 3.er intento por hora y rate limit de 120/min.

**Sobrevive como pendiente** (TAREAS-PENDIENTES §2a-bis): cambiar la política de
Cloudflare Access a OTP-para-cualquier-correo (un solo paso manual).

## Handoff a humano + panel por cliente (`SPEC-HANDOFF-Y-PANEL-CLIENTE.md`)

El bot se calla cuando entra un humano: el modelo cierra con el centinela `[[HUMANO]]`, el
worker lo borra del texto antes de enviarlo, escribe `pause:<tenant>:<from>` en KV con TTL
de 4 h y avisa a Telegram una sola vez; mientras la pausa vive, el mensaje se guarda en el
historial pero no hay llamada al modelo (TwiML vacío). El panel lista las escaladas
activas con «Reanudar bot». En paralelo, cada cliente ve solo lo suyo: `tenant_users` +
`resolveScope` traducen identidad a alcance, `scopeClause` es el único punto de paso del
filtro por tenant, el lead ajeno devuelve 404 (nunca 403), CSV y métricas van filtrados y
sin columna de clientes, y todo lo que cuesta dinero o revela a otro cliente es 403 antes
de tocar D1. Ocho tests de fuga cubren el aislamiento. Fuera de v1 por diseño (no es
deuda): plantilla `escalada_<slug>`, detección de frustración, bandeja de conversación,
resumen diario, roles internos.

## Parches de regresión del aprovisionamiento (`PARCHES-REGRESION.md`)

Cerrados los tres defectos de la regresión multitenant: un auth token indescifrable
devuelve 403 con alerta en vez de un 500 mudo, el base64 corrupto lanza `cipher_format`
controlado, y `deliver()` nunca cruza cuentas (un tenant con subcuenta exige SU `From` y
SU plantilla). La idempotencia pasó de KV a D1 (`UPDATE … WHERE columna IS NULL` +
`provision_orphan`), la KEK se comprueba antes de crear recursos facturables en Twilio, el
cerrojo se libera con `try/finally` y el re-cifrado perezoso con la KEK nueva existe de
verdad.

## Revisión general del 2026-08-17 (`REVISION-2026-08-17.md`) — 18/19 aplicados

Se corrigió el sistema de avisos de lead de raíz (canales entregados registrados uno a
uno, cron priorizado con purga acotada, `Promise.allSettled` en Twilio y detección/alerta
del D1 mal configurado en lugar del falso «degradado OK»). En frontend: la promesa de
Turnstile cacheada en fallo, la cola de `VELAI_HUMAN.execute`, `localStorage` sin
try/catch en Safari, validación de teléfono 6–15 con mensaje propio, lookup de prototipo
del widget y cache-busting del CSS con check automático. En robustez: `invalid_json`,
`limit` no numérico, `admin_misconfigured`, 401 en JWT corrupto y retención por defecto de
24 meses. **El único no aplicado es el hallazgo 19** (Instagram en el prompt), por
decisión explícita de negocio — anotado en TAREAS-PENDIENTES.

## Revisión de seguridad (`REVISION-SEGURIDAD-PENDIENTE.md`)

Todo lo implementable en código está hecho: validación del hostname de Turnstile contra
`ALLOWED_WEB_ORIGINS`, rate limit por conversación (20/min) y presupuesto diario global de
IA (`AI_DAILY_LIMIT`, 429 + alerta con antirebote), `Cache-Control: no-store` en todo
`/api/admin/*` y el panel, 415/413/400 en el parseo de JSON y 401 garantizado para JWT
malformados. En el sitio estático, `_headers` con nosniff, XFO, Referrer/Permissions-
Policy, HSTS preload, COOP y CSP base, más el enlace permanente «Configurar cookies»
(`VELAI_openConsent`).

**Sobrevive como pendiente** (TAREAS-PENDIENTES §2b, todo fuera del repo): reglas WAF de
borde para `/chat` y `/lead`, auditoría manual de la política de Access, CSP completa de
recursos empezando en Report-Only, y la decisión legal de retención escalonada.

## Blueprint del funnel de ventas (`VELAI-~1.MD`, investigación 2026-06-11)

Investigación competitiva (~15 competidores) y roadmap del funnel, ejecutado casi entero:
demo del bot en la web, pricing publicado con la promesa 48 h, calculadora de ventas
perdidas (`/calculadora-ventas-perdidas/`), diagnóstico de atención por WhatsApp con quiz
y scoring (`/diagnostico-whatsapp/`), landings verticales (`/restaurantes/`, `/clinicas/`,
`/talleres/`, `/inmobiliarias/` + `/lp/`), formulario cualificador con descalificación
honesta, blog con artículos comparativos, generador de link/QR de WhatsApp, test Ley SAC
(`/test-ley-atencion-cliente/`) y mini-cotizador (`/cotizador-precio/`).

**Sobrevive como pendiente** (TAREAS-PENDIENTES): número WABA para la demo por WhatsApp,
secuencia de nurturing post-diagnóstico, demos grupales, programa de referidos y KPIs del
funnel (baseline sin establecer).

## Contextos amplios — fase 1 (`CONTEXTOS-AMPLIOS.md`, el doc sigue vivo por las fases 2–4)

`callAnthropic` envía el `system` como array de bloques con `cache_control: ephemeral`:
el prompt estable por tenant se escribe una vez a 1,25x y se relee a 0,1x en el resto de
turnos (TTL 5 min) — en Zoe (~4.000 tokens) recorta ~70% del coste de prompt de una charla
de 6 turnos; por debajo del mínimo cacheable la API lo ignora sin coste. Cada llamada
emite `ai_usage` con `cache_w`/`cache_r` para verificar en Workers Logs que el caché
acierta. El contrato (bloque estable, sin datos variables) está blindado por un helper de
test transversal.
