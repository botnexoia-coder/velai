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

## Widget de clientes: marca propia + Turnstile autosuficiente (`PLAN-CORREGIDO-WIDGET-CLIENTES.md`)

Desplegado el 2026-08-18 (worker `df2e680d`, Pages `847d4b19`, migración 0007 aplicada,
suite 59/59). El widget dejó de depender de `funnel.js` — sin `VELAI_HUMAN` carga
Turnstile y ejecuta el challenge él mismo, con la sitekey pública de Velai por defecto —
lo que desbloquea las 4 webs de clientes (el chat de `zoetravelspain.com/prueba-vai/` no
funcionaba por esa dependencia no declarada, no por el snippet de Sebas). La marca de
cada cliente vive en D1 (11 columnas de la migración 0007), se edita desde la sección
«Marca del widget» de la ficha (con previsualización) y se sirve por `GET /widget/boot`
(público, CORS, caché = la fila de `tenantBySlug`, slug desconocido → 404): el chat pinta
logo, `bot · marca`, saludo ES/EN, chips, colores (variables CSS por CSSOM), tema
claro/oscuro y el WhatsApp del cliente en los errores. Los defaults de Velai viven en el
widget: hirevai.com quedó idéntico. Las 26 páginas pasaron de `?v=5` a `?v=7` (v6 se
saltó: todo salió en un deploy). De paso se corrigió la paginación del panel (sin
`?limit` el listado devolvía 1 lead, no 50). Decisiones de Juan: marca desde el panel
(no inline en el HTML del cliente) y el widget sustituye al chat propio de Zoe.
Verificado en producción: los 4 slugs de clientes responden 200 en `/widget/boot` —
las altas del panel estaban hechas.

**Sobrevive como pendiente** (TAREAS-PENDIENTES §2f): la marca de cada cliente está
toda en null (recopilarla y cargarla), hostnames de Turnstile, nombre del asistente de
Diálogos, y la parte de Sebas (snippet `?v=7` en las 4 webs, quitar chats viejos solo
tras ver la marca).

## Orígenes en D1 + Turnstile por API (`SPEC-ORIGENES-Y-TURNSTILE-POR-API.md`)

Desplegado y probado end-to-end el 2026-08-18. Los dominios de cliente dejaron de vivir
en `wrangler.toml`: la migración 0008 añade `tenants.web_origins` (JSON, ≤6, https sin
path), editable en la ficha («Dominios de la web»), y `allowedOrigins()` une el entorno
(base de Velai, red de seguridad si D1 cae) con los tenants activos, cacheado en KV
(`origins:all`, 5 min, invalidado con la fila). **Alta de dominio = fila en el panel,
CORS al instante, sin deploy** — verificado con los 9 orígenes reales y la revocación
inmediata del de prueba. El botón «Sincronizar Turnstile» (`POST /provision/domains`)
reescribe los hostnames del widget desde D1 con GET-antes-de-PUT que preserva el `mode`
`invisible` (el ejemplo original con `managed` habría roto el challenge de todas las
webs) y ES la reconciliación (idempotente). Dos límites descubiertos y resueltos:
`clean(…,1000)` truncaba la var en silencio (subido a 4000 CON log) y **Turnstile admite
10 dominios por widget** — la API rechazó 12; como cubre subdominios automáticamente,
se sincronizan solo apex (`www.` plegado; hoy 7 de 10; si se supera →
`400 turnstile_domains_limit` → pasar a widget por cliente, alternativa §4 de la spec).

## Acceso de clientes por API — Cloudflare Access (`SPEC-ACCESO-CLIENTES-POR-API.md`)

Desplegado y probado el 2026-08-18 (login real de Diálogos con OTP ✓). Causa raíz
confirmada por API: la organización de Zero Trust tenía CERO IdPs (Cloudflare cambió el
default en junio de 2026 — OTP ya no se añade solo), así que ningún correo externo podía
autenticarse por mucho que su fila en `tenant_users` existiera. Setup único hecho por
API: IdP One-time PIN, grupo «Clientes Velai» (id en `CF_ACCESS_GROUP_ID`) y política
nueva en la app `admin.hirevai.com` que incluye el grupo SIN tocar la regla de admins
(`allowed_idps` vacío = el botón de OTP aparece solo). En runtime, `syncAccessGroup`
(worker/cloudflare.js) reescribe el grupo ENTERO desde D1 tras cada alta/baja de usuario
del panel — D1 primero: un PUT fallido no pierde la fila, devuelve `gate: pendiente` con
log `access_group_desync` + alerta a Telegram; sin correos, centinela que cierra la
puerta; los `ADMIN_EMAILS` jamás entran al grupo. El panel muestra el resultado en el
toast («puerta de Access actualizada»). Secret `CF_API_TOKEN` (Turnstile Edit + Access
cuenta Edit + Access zona Edit). Desviaciones conscientes: sin cerrojo KV (el PUT
reescribe la lista completa post-escritura y converge) y sin botón de reconciliación
aparte (cada alta/baja ES la reconciliación). También se añadió el botón **Salir** del
panel (`/cdn-cgi/access/logout`), necesario para cambiar de cuenta.

## Admins de Velai desde el panel + sección Configuración (2026-08-18, sin MD previo)

Pedido por Juan en sesión: gestionar admins y tokens sin CLI ni dashboard. **Admins**:
tabla `admin_users` (migración 0009) + sección «Admins de Velai» en la pestaña Clientes
— el alta/baja escribe la fila y reescribe el grupo de Access «Admins Velai»
(`CF_ADMIN_GROUP_ID`) con los raíz del entorno SIEMPRE dentro. Los `ADMIN_EMAILS` del
toml quedan como raíz indestructibles y además pasan por la política reutilizable
«Equipo Velai» del dashboard, que el worker NO puede editar (el intento dio
`cf_api_12130`: las políticas reutilizables no se tocan por el endpoint por-app — se
convirtió en garantía externa). Guardas: un correo de cliente no asciende
(`email_is_client`), el inverso tampoco (`email_is_admin` mira también `admin_users`),
un raíz no se borra (`admin_is_root`), nadie se quita a sí mismo (`cannot_remove_self`);
auditoría por Telegram (👑) + logs. Probado: alta de `estivenrojas09@gmail.com` con
puerta actualizada y login real con OTP. **Configuración (solo admins raíz — dos
factores reales en vez de un PIN)**: estado en vivo de integraciones (token verificado
contra `/user/tokens/verify` en cada carga, cuenta, sitekey, grupos, bindings) y
rotación write-only del `CF_API_TOKEN` — se valida contra Cloudflare ANTES de guardarse,
se cifra con la KEK en la tabla `settings` (migración 0010), tiene prioridad sobre el
secret del worker (`withCfToken`) y nunca se devuelve. La KEK, Anthropic y las
credenciales maestras de Twilio quedan fuera a propósito (secrets del worker). También:
botón **Salir** (`/cdn-cgi/access/logout`). Copia local del token en `.dev.vars`
(gitignorado). Suite 72/72.

## Contextos amplios — fase 1 (`CONTEXTOS-AMPLIOS.md`, el doc sigue vivo por las fases 2–4)

`callAnthropic` envía el `system` como array de bloques con `cache_control: ephemeral`:
el prompt estable por tenant se escribe una vez a 1,25x y se relee a 0,1x en el resto de
turnos (TTL 5 min) — en Zoe (~4.000 tokens) recorta ~70% del coste de prompt de una charla
de 6 turnos; por debajo del mínimo cacheable la API lo ignora sin coste. Cada llamada
emite `ai_usage` con `cache_w`/`cache_r` para verificar en Workers Logs que el caché
acierta. El contrato (bloque estable, sin datos variables) está blindado por un helper de
test transversal.

## Sprint de blindaje (2026-08-20, sin MD previo — auditoría de 2 agentes)

Cuatro arreglos que compran ~1 año con la arquitectura actual (veredicto de la
auditoría: NO reescribir — monolito Cloudflare correcto para esta escala):
(1) **CD del worker** — `.github/workflows/deploy-worker.yml` en push a `main`:
checks → valida el panel contra el BUNDLE real (`scripts/check-bundle.mjs`) →
migraciones D1 → deploy → smoke del preflight de `/chat`. Secret de Actions
`CLOUDFLARE_API_TOKEN` (scopes mínimos, distinto del `CF_API_TOKEN` del worker).
(2) **Webhook idempotente** — dedupe por `MessageSid` en KV tras la firma y
`callAnthropic(env,payload,options)` con `{retries:0, timeoutMs:10000}` solo en el
webhook (Twilio corta a ~15 s; reintentar dentro cobraba dos veces el mismo mensaje).
(3) **Cupo de IA por tenant** — migración 0011 (`tenants.ai_daily_limit`) +
`AI_TENANT_DAILY_LIMIT=300`; 429 `ai_tenant_budget_exhausted` con alerta que nombra
al tenant; el techo global queda como red anti-catástrofe.
(4) **Panel testeable** — el JS vive en `worker/admin-panel.js` como función real
(`panelApp`), serializada al HTML como IIFE; `node --check`, smoke con `vm.Script`
y validación contra el bundle. Incidente y lección: esbuild (keepNames) inyecta
`__name(...)` dentro del cuerpo y el helper no viaja con `toString()` → shim de
`__name` en el script del panel + check-bundle en el workflow para siempre.
Comparativa Twilio vs Zernio: quedarse en Twilio hoy; reevaluar vs 360dialog a ~10
clientes. Suite 72→79.

## Calendario fase 1 — Google (`SPEC-CALENDARIO.md`, 2026-08-20, VERIFICADO e2e)

Cada cliente conecta SU cuenta de Google (autoservicio desde su panel) y Vai
consulta huecos reales y agenda citas EN SU calendario desde el chat web y
WhatsApp/Messenger. Verificado en producción el mismo día: cita agendada por chat
en el calendario real de Diálogos y visible en el panel.
- `worker/calendar.js`: proveedor Google (events.list/insert, refresh con
  `invalid_grant`→estado error+alerta, revoke), `freeSlots` puro con DST,
  `CALENDAR_TOOLS`/`CALENDAR_GUARDRAILS` como constantes de código.
- Tool use propio en el worker: `callAnthropicRaw` + `runToolLoop` (máx 3 vueltas,
  tool_results en UN mensaje user, executor que NUNCA rompe el bucle); system en
  2 bloques (estable cacheado / fecha-hora volátil SIN cache_control) — el caché
  de prompt sigue acertando. `max_tokens` 500 solo con tools.
- `handleTwilio` híbrido: sin tools TwiML como siempre; con `tool_use`, TwiML vacío
  inmediato y respuesta final por la Messages API en `waitUntil` (texto libre legal:
  ventana de 24 h). `settleTwilioReply` unifica handoff/historial/captura.
- Anti dobles reservas en 3 capas: relectura del proveedor justo antes de crear +
  cerrojo KV 60 s + `request_id` UNIQUE (migración 0012: `tenant_calendars` con
  refresh cifrado AAD `calendar:<tenant_id>`, y `appointments`).
- OAuth: `POST /tenants/:id/calendar/connect` → state un-solo-uso en KV →
  `GET /oauth/calendar/callback` SOLO en el hostname admin (Access + JWT + scope);
  el cliente solo puede conectar SU tenant (ajeno = 404/403, con tests).
- Panel: vista `#viewCalendario` estilo Google Calendar (rejilla continua, día en
  círculo, chips, «Hoy», modal con las citas del día) con ítem de menú bajo Leads
  para AMBOS roles — el cliente su calendario; el admin el de Velai + selector de
  cliente y columna Calendario→Abrir en Clientes. `/api/admin/appointments` scoped
  con rango `from`/`to`.
- Legal para la verificación de Google: `/condiciones/` nueva y sección de datos de
  Google Calendar con **Limited Use** en `/privacidad/`.
Suite 79→88. **Sobrevive como pendiente** (TAREAS §2i): verificación de la app por
Google (en Testing los refresh caducan a 7 días), Microsoft (fase 2), picker de
calendarios, aviso Telegram por cita, enlace cita↔lead, recordatorios, y los nuevos
canales Telegram/Instagram como spec aparte.


## Conexiones en autoservicio + alta WhatsApp e2e (`SPEC-CONEXIONES-AUTOSERVICIO.md`, 2026-08-21/22)

**PR 1 — Telegram en autoservicio** (commits 7f00fd1→f827d3c, migraciones 0013-0016): vista Conexiones
para ambos roles (admin con selector de cliente), enlace `t.me` con token de un solo uso (KV 15 min),
webhook público `/telegram/webhook` (secreto en header + `timingSafeEqual`, 200 mudo). **Entrega DUAL**:
el aviso va al chat del cliente (sin chat = skip visible) y Velai recibe SIEMPRE copia operativa
deduplicada por lead (`opsping:` 30 días). **Marca blanca por cliente** (conmutador que solo activa
Velai): bot propio de @BotFather (token cifrado AAD `telegram:<id>`) + **Temas** del grupo creados
desde el panel con nombre y descripción (`createForumTopic`) y clasificación de cada lead con Haiku
(nombre-exacto-o-General, nunca se pierde); plan básico = 2 pasos, un solo chat con el bot de Velai.
UI: asistente horizontal de 5 pasos (riel clicable, confirmaciones manuales, pantalla final).

**PR 2 — sender/sync** (36ad269, verificado EN VIVO el 2026-08-22 con gogestion): el botón
«Sincronizar desde Twilio» lee el sender de la subcuenta, rellena `waba_id/sender_sid/sender_status/
twilio_from` sin pisar `channel_address`/`twilio_from` con valor (informa `conflicts[]`) y **repara el
webhook** si quedó en el default de Twilio. Verificado contra la API real: ruta `/v2/Channels/Senders`
CON mayúsculas + `Channel=whatsapp` (en minúsculas 404 20404), array `senders`, y el **Sandbox
(+14155238886) se filtra siempre** (la 1ª sync real lo adoptó como sender del cliente).
**PR 3** (99b08ac): `PATCH …/notify` en autoservicio + guarda del 63031 en los dos caminos.
**PR 4** (Embedded Signup en el panel) NO implementado: precondiciones y distinción Self Sign-up vs
Tech Provider en TAREAS §2j — clave: la URL del popup de Twilio NO es compartible con el cliente.

**Del rodaje real salieron además** (2026-08-22, 58d9096→9a0d533): subcuenta **crear-o-adoptar**
(SID sin token → recupera y cifra el token vía el padre; `cliente-<slug>` preexistente → se adopta;
cero duplicados en Twilio), auditoría de aprovisionamiento titulada con el cliente, `errorResponseParts`
(los errores de Twilio salen con su código, nunca `server_error` mudo; los 500 loguean el mensaje real),
y el aviso de lead en Telegram titula con el NOMBRE del cliente dueño.

**Primer alta e2e completada — Diálogos** (2026-08-22): Self Sign-up real (la página WhatsApp senders
no sale en el menú de la subcuenta: llegar por URL directa o el buscador de la consola; «Try out
WhatsApp» es el sandbox, no el alta), sender ONLINE `whatsapp:+34641586513` (WABA 963253983463170),
canal cambiado desde la ficha y **primer lead real de un cliente en producción**. De ahí: tabla
**`tenant_channels`** (migración 0017, N canales por cliente, enrutado canales-primero con fallback,
chips de la lista por canal real — «socio pendiente» retirado) y **`api.hirevai.com`** como dominio
del worker + widget v=8 (workers.dev está en listas de adblock: a esos visitantes el widget les salía
sin marca y con el chat muerto).
