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

## Vista «Plantillas» — catálogo de plantillas por cliente (2026-09-01)

Pedido de Juan con la primera plantilla real en pending. Ítem SOLO-Velai en la
sección Sistema del panel: primero como matriz clientes × kinds (v2.2.0) y el
mismo día REDISEÑADA «por plantilla» tras el ejercicio de diseño (v2.3.0, lienzo
aprobado por Juan): una tarjeta por kind del catálogo (`worker/plantillas.js`,
que manda label/categoría/descripción — nada por kind hardcodeado en el panel)
con chips-píldora por cliente (aprobada/pendiente/rechazada/sin crear), botón
«Crear» dentro del chip donde falta (paso genérico `plantillas/<kind>`, con
diálogo propio), buscador de clientes sin acentos (la tarjeta sin coincidencias
se atenúa, nunca desaparece) y contadores-filtro globales por estado que pliegan
el resto en un «+N más».

**Vista del CLIENTE (v2.5.0, decisión de Juan):** /plantillas sirve a ambos roles.
El cliente ve SUS plantillas en solo lectura — tarjeta por kind con estado en su
idioma («Activa ✓» / «En revisión por WhatsApp» / «Rechazada — estamos en ello» /
«Aún no creada») y la vista previa estilo WhatsApp del mensaje real con LOS BOTONES
QUE ÉL TIENE elegidos (opciones de su fila; sin opciones, la pareja default). Cero
gestión (sigue siendo de Velai). El endpoint es consciente del rol (patrón /stats):
al cliente le devuelve SOLO su fila (id atado desde el scope — mutaciones probadas:
sin WHERE el guardián se pone rojo; cayendo a la rama global, el barrido adversario
caza la fuga) y SIN sids; entra en clienteAllowed con su caso en el barrido. El
cuerpo del aviso de lead se MUDÓ al catálogo (aviso_lead.content, única fuente: el
paso `template` del aprovisionamiento lo lee de ahí y createLeadTemplate se retiró)
para poder previsualizarlo también. Endpoint
`GET /api/admin/plantillas` (403 al rol cliente, fuera de clienteAllowed): une el
registro `tenant_templates` con la plantilla de LEADS de las columnas históricas,
presentada como kind `aviso_lead` fuente 'columnas' — unificación de LECTURA; su
almacenamiento y su alta (paso 2 del aprovisionamiento) no cambian, y el POST
genérico la rechaza (`template_kind_not_creatable`). El catálogo es desde aquí LA
lista completa de plantillas del sistema.

## Confirmaciones — recordatorio y confirmación de citas por WhatsApp (2026-09-01)

SPEC-CONFIRMACIONES F1+F2 implementadas juntas (decisión de Juan). Addon que VELAI
habilita por cliente (interruptor solo-Velai; el cliente lo ve), nombre
«Confirmaciones» dentro de la vista Calendario. Antelación: la decisión original
«24 h única» EVOLUCIONÓ el mismo día a **curada 12/24/48 con default 24** (ver
§Alta configurable más abajo) — es config del addon (`tenants.reminder_hours`),
editable sin nueva aprobación de Meta.

### Alta configurable de la plantilla (evolución del mismo día, panel v2.4.0)

«Crear plantilla» pasó de un confirmar simple a un diálogo de configuración con
envío explícito: antelación curada (12/24/48, default 24; se cambia después sin
nueva aprobación — el cuerpo es NEUTRO respecto al tiempo), pareja de botones
CURADA del catálogo (4 parejas, ≤25 caracteres; NUNCA texto libre hacia Twilio —
decisión de Juan; cambiar los botones después exige plantilla nueva y otra revisión
de Meta; los payloads conf:/canc: no cambian jamás) y vista previa del mensaje REAL
renderizada por el worker. El POST `plantillas/<kind>` valida `{botones, antelacion}`
contra el catálogo antes de tocar Twilio; lo elegido se persiste en
`tenant_templates.opciones` (migración 0031, que también hace GENÉRICO el kind del
ledger → 'previo': un kind con horas re-sembraría la cita al cambiar la antelación).
Retrocompatible: el alta sin opciones usa los defaults y las filas ya creadas sin
opciones siguen válidas.

- **F1**: migración `0030` (ledger `appointment_reminders` con el molde de
  lead_notifications; `appointments.customer_confirmed_at/cancelled_by`;
  `tenants.reminders_enabled/reminder_hours`). Cron de 5 min: siembra y envía por la
  subcuenta del tenant, sin modelo; cita creada ya dentro de la ventana → `skipped`
  (no se recuerda lo recién agendado); reintentos con backoff. Plantilla Utility con
  botones quick-reply «Confirmo»/«Cancelar» (payloads `conf:<id>`/`canc:<id>`); el
  webhook los resuelve por un camino DETERMINISTA con triple validación (cita existe
  + del tenant enrutado por To + From = teléfono de la cita — validado por mutación).
  Cancelar borra el evento de Google (`deleteGoogleEvent`) y todo avisa al negocio
  por su Telegram.
- **F2**: tools `cancelar_cita`/`confirmar_cita` en el bucle de calendario, mismo
  contrato hostil que `agendar_cita` (cita SOLO por teléfono del remitente + tenant
  del closure, jamás por id del modelo; ambigüedad → lista y Vai pregunta). Tras
  cancelar, Vai reagenda con `consultar_disponibilidad` + `agendar_cita`.
- **Registro genérico de plantillas** (decisión de Juan del mismo día): tabla
  `tenant_templates` (tenant_id, kind) + catálogo EN CÓDIGO en `worker/plantillas.js`
  (una plantilla es un contrato con el código que la envía). Aprovisionamiento
  genérico `POST /provision/plantillas/<kind>` y `pollTemplateApprovals` vigila la
  aprobación por kind. La plantilla de LEADS sigue en sus columnas históricas.
- **Panel v2.1.0**: card «Confirmaciones» en Calendario (addon + plantilla +
  antelación), chips por cita (❌ cancelada por el cliente > ✅ confirmada > ⏳
  recordada) y ledger del recordatorio en el modal del día.

Pendiente del dueño en TAREAS-PENDIENTES.md (aplicar la 0030, crear/aprobar la
plantilla y activar el addon a un tenant de prueba). Fases 3 (autoagenda pública) y 4
(métricas de no-show) quedaron ahí como futuras, con la unificación de la plantilla
de leads en tenant_templates.

## Marketing consolidado en site/ — la raíz del repo queda limpia (2026-09-01)

Pedido de Juan («no quiero ver más carpetas y carpetas de HTML»). Ejecutado el plan de
PLAN-SITE.md en dos tiempos sin un segundo de ventana: copia a `site/` (convivencia) →
flip del «build output directory» del proyecto Pages a `site` (dashboard, Juan) →
retirada de los originales. URLs idénticas antes y después (checklist en caliente: home,
blog, verticales, lp con pauta, widget de clientes como application/javascript, CORS de
fuentes, robots/sitemap — todo 200).

Raíz resultante: `site/` (marketing entero), `panel/` (React), `worker/` (API) + infra
(docs, migrations, test, scripts, seed, tenants). Ganancia de seguridad de raíz: el
repo ya no es descargable por URL — las apps de Access que tapaban /worker/* y demás
quedan como defensa en profundidad (se pueden retirar cuando se quiera; no estorban).

## Cutover del panel v2 (2026-09-01)

`PANEL_V2 = "1"` en producción: el panel React de `panel/` es EL panel de
`admin.hirevai.com` para Velai y para los clientes. Validado por Juan en staging (7
vistas, avisos sonoros, diálogos de marca, y los arreglos de su revisión: checkboxes
del filtro —la regla `.lsearch input` se colaba en el popover anidado— y el input de
pedirTexto vuelto no controlado tras un flaky real de CI).

El v1 serializado SIGUE en el bundle: el rollback es vaciar la bandera y desplegar.
**Pendiente consciente**: retirar el v1 (ADMIN_HTML, admin-page.js, admin-panel.js,
check-bundle.mjs y la vista config de render-panel) cuando el v2 lleve unos días sin
sustos, y portar la tarjeta de infra-usage (panel/TODO.md).

## Hono + panel v2 en React + orden del repo (2026-09-01, tres agentes en paralelo)

La ejecución de la decisión de frameworks (memoria: decision-frameworks-2026-09), en tres
worktrees aislados integrados por el orquestador:

- **Worker sobre Hono 4.13**: `adminRouter` (1.400 líneas de `if path ===`) partido en
  `worker/routes/{publico,leads,conversaciones,tenants,conexiones,calendario,config}.js`
  con el perímetro admin como middleware (`worker/middleware.js`) — un endpoint nuevo ya
  no puede nacer fuera de la cadena identidad→scope. Primera dependencia del repo
  (package-lock.json, `npm ci` en CI). `check-aislamiento.mjs` reescrito para la
  estructura nueva con paridad exacta (101 consultas vigiladas) y validado por mutación
  (7 del agente + 1 independiente del orquestador, cazada por guardián Y 5 tests).
- **Panel v2** (`panel/`): Vite + React 19 + TS estricto + TanStack Query. Shell (nav
  siempre oscura), Dashboard, Leads y Conversaciones completas; 53 tests propios; tokens
  de marca, TERRS, loader y tooltip portados 1:1. Lo sirve EL PROPIO WORKER como
  estáticos (`[assets]` + run_worker_first) en el hostname del panel tras la bandera
  `PANEL_V2` — mismo origen, sin CORS, Access intacto, JWT validado antes de servir un
  byte. Encendido SOLO en staging; rollback = quitar la bandera (v1 intacto en el bundle).
  Vistas restantes en `panel/TODO.md`.
- **Repo**: `docs/ESTRUCTURA.md` (mapa y arquitectura: capas modulares; microservicios y
  hexagonal completo descartados con razones), `docs/PLAN-SITE.md` (mover el marketing a
  site/ — NO ejecutado, requiere dashboard), `distB/` borrado.
- **Exposición del código cerrada en el edge** (mismo día, agente aparte): 3 apps de
  Access con deny-everyone tapan /worker/*, /docs/*, /migrations/*, /seed/*, /tenants/*,
  /test/*, /scripts/*, /distB/*, /.github/* y los ficheros sueltos del repo en
  hirevai.com (todo verificado a 302 con lo público intacto, widget de clientes
  incluido). La solución de origen sigue siendo PLAN-SITE.md.

Trampa de TOML que costó un deploy de staging: una tabla `[assets]` colocada ANTES del
array `routes` se traga las claves sueltas siguientes — las rutas de producción quedaron
colgando de assets y la comprobación de dominios de check-entornos pasó EN VACÍO.
Recolocada tras `routes` y check-entornos endurecido para fallar si producción «no tiene»
admin.hirevai.com.

**Estado al cierre**: 188 tests + 53 del panel, todo verde; staging desplegado con Hono y
panel v2; producción SIN tocar (pendiente de push, decisión de Juan).

## El webhook de Telegram llevaba 10 días roto por el charset del secreto (2026-08-31)

**Síntoma:** «Telegram rechazó el registro del webhook: reintenta», 502 en
`/api/admin/telegram/setup`. Reintentar no arreglaba nada, y la pista falsa era que
parecía un problema del token que pegaba el cliente.

**Alcance real, visto en D1:** desde que se lanzó el autoservicio el 2026-08-21, NINGÚN
cliente había conseguido vincular su Telegram. Solo `velai` tenía chat, del día del
lanzamiento. gogestion, dialogos, zoe y hiredatavision: cero. No era un caso raro de un
cliente, era la función entera muerta — y no se notó porque los avisos de lead SALEN por
`sendMessage` y esos seguían funcionando: lo único que usa el webhook es la vinculación.

**Causa:** `TELEGRAM_WEBHOOK_SECRET` estaba generado con caracteres fuera de lo que
Telegram admite en `secret_token` (solo `A-Z a-z 0-9 _ -`; un `openssl rand -base64 32`
mete `+`, `/` y `=`). Telegram rechaza el `setWebhook` entero con un 400 genérico.
Confirmado: rotado a `openssl rand -hex 32`, el registro pasó a la primera.

**Por qué costó 10 días diagnosticarlo, que es lo que de verdad había que arreglar:**
`telegramSetWebhook` devolvía un booleano y tiraba el `description` de Telegram. El
cliente veía «reintenta» y el log no guardaba NADA — no había forma de distinguir un
token malo de nuestro secreto. Ahora devuelve `{ ok, code, why }`, traduce el motivo a
códigos accionables (`invalid_bot_token`, `webhook_secret_invalid`, `telegram_rate_limited`,
`webhook_url_invalid`), comprueba el charset del secreto ANTES de gastar la llamada, y
`HttpError` acepta un `why` que viaja al cuerpo de la respuesta y al log. El panel ya
sabía leerlo (`e.why`); el worker no lo mandaba nunca.

**Lección que vale más que el arreglo:** un tercero que falla sin que se registre el
motivo es un fallo que no se puede diagnosticar, y aquí costó diez días y la función
entera. Todo `fetch` a un tercero que decida un flujo debe conservar su mensaje.

## Aislamiento multi-tenant estructural + entorno de staging (2026-08-31)

Dos piezas de la revisión de arquitectura previa al crecimiento en clientes. El
diagnóstico: `worker/app.js` pasó de 606 a 4.860 líneas entre el 17 y el 27 de agosto, y
lo que peor escala no es el tamaño sino que **el aislamiento entre clientes se escribía a
mano en cada endpoint** (44 consultas del panel cuya única defensa era que quien escribió
el handler se acordara de la puerta) y que **la primera ejecución real de cada cambio era
producción**.

**A — el aislamiento deja de depender de la memoria.** Se auditaron las 100 consultas del
panel sobre tablas con dueño: **ninguna filtraba datos**, así que esto no arregla un
agujero, cierra la puerta por la que iba a entrar el número 45. Tres piezas:

- `assertOwnTenant(scope, tenantId)` — la puerta de los recursos con `:id` en la ruta,
  que estaba copiada literal en nueve sitios, ahora tiene nombre.
- `scripts/check-aislamiento.mjs` — en `npm run check`: toda consulta del panel alcanzable
  por un cliente debe estar filtrada, tener puerta, sacar el id del scope o llevar un
  `// scope-ok:` explícito. Chequeo estático y no proxy en runtime a propósito: un
  guardián que lanza en producción puede tumbar el panel de un cliente por un falso
  positivo; este, como mucho, pone el build en rojo.
- `test/aislamiento.test.js` — recorre las **31 rutas** que `clienteAllowed` abre al rol
  cliente contra un mock de D1 **adversario** (si una consulta no filtra, el mock devuelve
  la fila del otro cliente, y la fuga se ve en la respuesta). Y exige que cada ruta nueva
  tenga su caso: abrir una al rol cliente sin probarla pone CI en rojo.

Ambos guardianes se validaron por mutación —quitar una puerta, quitar un filtro, añadir un
endpoint de cliente sin filtrar— y los tres casos salen en rojo. La suite pasa de 168 a
**173 tests**. Regla y patrones en `GUIA-WORKERS.md` §4b.

**B — staging.** `[env.staging]` con worker, D1 (`vai-leads-staging`), KV y dominio propios
y ningún cliente detrás; `deploy-worker.yml` ensaya ahí en cada push a `main` y solo
después toca producción. Las 29 migraciones se aplicaron de cero sin un fallo — la primera
vez que se prueba esa cadena completa. `scripts/check-entornos.mjs` vigila que los dos
entornos no compartan recursos, dominios ni grupos de Access, y que sus variables no se
desincronicen (wrangler no hereda `vars` pero **sí hereda `routes`**: sin declararlas en
staging, un deploy reclamaría `admin.hirevai.com`). Detalle y reglas en `OPERATIONS.md`
§Staging.

El propio entorno se ganó el sueldo el primer día: al probar el chat en staging apareció que
la clave de PRUEBA de Turnstile emite tokens con `hostname: example.com` y `verifyTurnstile`
los rechaza, de modo que `POST /chat` daba 403 siempre. Arreglado en la lista de orígenes de
staging (y solo ahí). Es exactamente el tipo de fallo que antes se descubría en producción.

**Sobrevive como pendiente** (TAREAS-PENDIENTES §2f): la `ANTHROPIC_API_KEY` del worker de
staging. Todo lo demás —app de Access `admin staging`, política propia, `TEAM_DOMAIN`,
`POLICY_AUD`, `SECRETS_KEK` y Turnstile— quedó configurado el 2026-08-31.

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

## Vista «Canales» — el enrutado visible (2026-08-24, sin MD previo — incidente gogestion)

**El fallo.** gogestion quedó con el sender ONLINE, la ficha impecable (`sender_sid`, `waba_id`,
`twilio_from`) y **el bot mudo**: no existía su fila en `tenant_channels`, así que `tenantByAddress`
no resolvía y el webhook contestaba `404 unknown_tenant`. Causa: `sender/sync` (PR2) se salta
`channel_address` cuando ya tiene valor — y gogestion tenía `web:gogestion` del canal web — pero
**nunca escribía en `tenant_channels`**. Cualquier cliente con canal web previo quedaba así. Y no
había forma de verlo: todas las vistas del panel salían de las columnas de `tenants` y del estado que
reporta Twilio; ninguna leía la tabla que el worker consulta en cada mensaje, de modo que «verde en
Twilio» y «mudo» convivían sin testigos. La tarjeta de Conexiones llegaba a decir «Activo».

**Los dos arreglos de raíz** (5dddc37): `sender/sync` registra el canal con `assertChannelFree` +
`syncPrimaryChannel` — siempre, no solo cuando hay columnas que rellenar, y si el número enruta a otro
cliente no lo toca (loguea `sender_channel_not_registered`); e `invalidateTenantCache` barre también
las direcciones de `tenant_channels`, porque `tenantByAddress` cachea **el fallo** 5 min y sin eso
registrar un canal dejaba el bot mudo hasta que caducara el negativo.

**La vista** (a6ac312): `GET /api/admin/channels` (velai-only por servidor, no solo por CSS) + pestaña
**Canales**. Lista las direcciones que el worker atiende de verdad con el diagnóstico calculado en el
worker — la misma pregunta que hace `tenantByAddress`, para que panel y enrutado no puedan discrepar:
`atendido` / `cliente inactivo` (el webhook exige `active=1`) / `responde con otro número` (entra por
una dirección y contesta desde otra) / `cliente borrado`. Arriba, la alarma que faltaba: **senders
vivos en Twilio que ninguna fila enruta**. Dos avisos más donde ya se miraba: chip rojo «whatsapp: sin
enrutar» en la lista de clientes (antes ese cliente pasaba por «solo web») y la tarjeta de Conexiones
deja de decir «Activo» con el bot mudo — en lenguaje de cliente, que es quien la ve.

**Lo pidieron los datos reales:** el filtro `sender_sid IS NOT NULL` en la consulta del hueco.
`velai-messenger` lleva el `twilio_from` de Velai para los avisos de SALIDA y no tiene sender propio —
sin ese filtro salía como alarma falsa. Y `created_at` se normaliza a ISO: el backfill de la 0017 usó
`datetime('now')` (UTC sin marca) y `syncPrimaryChannel` escribe ISO con Z, así que el panel pintaba
las viejas 2 h desplazadas.

**Verificado en producción:** fila insertada a mano para desbloquear a gogestion, **bot contestando en
WhatsApp confirmado por Juan**, 4 canales (velai, velai-messenger, dialogos, gogestion) todos en
`atendido` y cero senders sin enrutar. Suite 105/105.

**La ficha dejó de DECLARAR el canal y pasó a LEERLO** (abacfe1). El campo «Canal (To de Twilio)» era una
caja de texto libre haciendo tres trabajos: clave de enrutado de reserva, marcador de ciclo de vida
(`pending:`) y relleno de una columna `NOT NULL UNIQUE`. Para gogestión contenía `web:gogestion`, que **no
enruta nada** — la web entra por slug — mientras ocupaba el canal primario. Ahora `tenantChannelSummary`
lee los 4 canales de donde viven (web del slug o del primer `web_origins`, whatsapp/messenger de
`tenant_channels` con el primario como respaldo, telegram de su columna con el título del grupo) y la ficha
los muestra en solo lectura. **Descartado a propósito:** JSON en una columna (perdería el `PRIMARY KEY`
sobre `address`, que es lo que impide que dos clientes reclamen el mismo número) y multiselect de tipos (un
canal es tipo+dirección, y la dirección la produce Twilio, no el teclado: declararla a mano ES el bug).
**Y desapareció el paso que causó todo:** activar un prospecto exigía reescribir a mano `pending:<slug>` →
`web:<slug>`; ahora el alta deriva del slug y el PATCH promueve al marcar Activo. Un `pending:` explícito
con `active=1` sigue siendo 400 — contradicción pedida a mano, no hueco que rellenar. Ojo: la derivación usa
el MISMO default de `active` que el endpoint (`?? 1`) o alta y guarda se contradicen con un 400 opaco.

**Buscador y filtros en Canales** (e8ffb03): una fila por canal y cliente no se lee con cincuenta clientes.
Buscador (número, cliente o tipo), selector de cliente y filtro de estado — «solo los que requieren
atención» es la vista de diario. Filtrado en cliente sobre lo ya cargado (cabe en una respuesta; si algún
día no cabe, el sitio a cambiar es `chPaint()` y el endpoint ya devuelve todo). El filtro afecta TAMBIÉN al
bloque de alarma para que «ver solo este cliente» signifique lo mismo arriba y abajo, los sin enrutar nunca
los esconde el filtro de estado, y la píldora de la cabecera sigue contando el TOTAL: es el estado del
sistema, no de lo que estés mirando. El buscador normaliza acentos en los dos lados y casa el número con y
sin prefijo (`gogestion` → GOgestión, `624` → su WhatsApp).

**«Tus canales» en el espacio del CLIENTE** (917c513): tenía que leer tres tarjetas de Conexiones para
deducir qué funciona, y su canal **web no aparecía en ninguna parte** pese a llevar el widget en su web.
El criterio de qué se le cuenta: **lo que puede accionar, o lo que le tranquiliza**. Su WhatsApp de alta
pero sin enrutar es trabajo pendiente NUESTRO, así que lee «lo estamos dejando listo», jamás «sin enrutar»
ni un 404; un cliente desactivado lee «en pausa». Velai ve la misma tarjeta con el estado crudo. El colapso
vive en el worker (`channelsForScope`), no en condicionales de la UI — lo que se le dice al cliente es una
sola cosa testeable; las palabras sí viven en el panel como el resto de los mensajes. La vista GLOBAL sigue
vetada al rol cliente (lleva números y nombres de otros); aquí solo su `:id` y el ajeno es 404, nunca 403.

**Fleco de UI que salió al mirarlo en vivo:** `.search` es una pastilla con su propio fondo y borde, y el
input de dentro solo queda desnudo con `class="q"` (`.search input.q`). El buscador de Canales nació sin
ella y salía una caja dentro de la caja. Hay test que recorre TODOS los `<label class="search">` del panel
y exige la clase, para que el siguiente buscador no repita el fleco. Suite 107/107.

## Calidad de los leads: nombre capturado y asunto visible (2026-08-24, sin MD previo)

**Lo que Juan vio:** leads llegando «sin nombre y sin tema». Al mirar D1, dos fallos DISTINTOS
escondidos bajo el mismo síntoma.

**El «sin tema» era puro fallo de visualización.** `need` y `context` se guardan desde la migración
0001 y el resumen de Haiku los llena bien en todos los leads reales (`"obtener certificado digital
FNMT"` / `"cliente venezolano interesado en trámites de conducción y gestión digital en España"`).
El modal de lead nunca los pintaba: su array de tarjetas listaba Sector, Canal, Mensajes/día,
Puntuación, Nota y Página — justo los dos campos que dicen de qué iba la conversación, fuera. Ahora
hay un bloque **«Qué buscaba»** arriba del todo (borde naranja, `need` grande y `context` debajo), el
título cae al asunto cuando no hay nombre (`Sin nombre · obtener certificado FNMT`), la columna
`Sector` del listado pasa a **Asunto** (`need || sector`, porque sector viene vacío en casi todo lead
de cliente: es un concepto del embudo de Velai, no de una gestoría) y el CSV gana `need`/`context`
DELANTE de sector — es de donde trabaja quien llama.

**El «sin nombre» sí era de captura, y la causa está en el reparto de prompts.** La regla «antes de
pedir el WhatsApp asegúrate de saber el nombre» vivía en el `SYSTEM` de Velai, y el prompt efectivo
de un tenant es `system_prompt` de SU fila + `GUARDRAILS` de código: todo cliente con prompt propio
(gogestión, dialogos) nunca recibió esa instrucción. La regla se mudó a **GUARDRAILS**, que es código
y alcanza a todos los tenants y a los dos canales — pide el nombre una sola vez cuando hay interés
real, no insiste si la persona no quiere darlo y NUNCA condiciona la ayuda a obtenerlo.

**Y la guarda de almacenamiento, rediseñada.** El canal WhatsApp exigía `sector || need`; el canal
**web no tenía guarda ninguna** y guardaba el resumen tal cual, vacíos incluidos. Diferir la captura
hasta tener el nombre era la solución evidente y es **errónea**: si la conversación acaba antes, el
lead se pierde — y un teléfono con una conversación real siempre es un lead. El diseño que quedó:
se guarda YA (el equipo se entera al momento) y se **ENRIQUECE** en los turnos siguientes.
`persistLead` en conflicto ya no se limita a devolver el id existente: rellena los huecos con
`COALESCE(col,?)`, que nunca pisa un valor que ya está — puede haberlo corregido una persona en el
panel. La marca de KV cierra la captura solo cuando el nombre llega o cuando se agotan
`LEAD_PATIENCE = 8` turnos (y entonces se registra `lead_sin_nombre`), así que no se gastan resúmenes
de Haiku indefinidamente. Los dos canales comparten ahora `leadFromSummary` + `leadCaptureDone`.

**De paso, el SUMMARY_PROMPT** decía «conversación entre un cliente y Vai (asistente de Velai)» aunque
resume conversaciones de TODOS los tenants: ahora habla del «asistente de un negocio», marca `nombre`
como el campo más importante (buscándolo en toda la conversación, incluso dicho de pasada) y aclara
que `negocio` es el negocio DE LA PERSONA — no el que la atiende — o null si es un particular.

**Y la promesa falsa que salió de ahí, corregida.** Los leads de gogestión y dialogos se capturan pero
**no llegan a nadie**: `telegram_not_configured` (ningún grupo vinculado) + `template_not_approved`
(plantilla `pending` en Meta). Y la tarjeta de Conexiones decía «los avisos de leads llegan por Telegram
mientras WhatsApp aprueba la plantilla» **sin comprobar que hubiera un Telegram vinculado** — con esos dos
clientes era mentira lisa. Ahora Conexiones tiene **«¿Dónde llegan tus leads?»** con el estado de entrega
real por canal, calculado por `leadAlertStatus`, que **espeja las condiciones de `deliver()`** y vive
pegado a ella para que un cambio en una se vea al lado de la otra: destinatarios, `twilio_from`, SID de
plantilla, aprobación de Meta y — clave — que **con subcuenta NO hay respaldo con los recursos del padre**
(dentro de ella no existen). Si no hay ningún canal activo se dice sin rodeos, con lo que importa primero
(«se guardan aquí en el panel, pero hay que entrar a mirarlos») y la salida accionable: conectar Telegram,
lo único que no depende de que Meta apruebe nada. La coletilla de la tarjeta de WhatsApp solo promete
Telegram si de verdad está vinculado.

**Verificado contra producción:** los veredictos del helper coinciden con los `skipped` recientes de los dos
clientes. Ojo al matiz — gogestión tiene además avisos `sent` **antiguos**, de antes de tener subcuenta,
cuando sí caía a los recursos de Velai; los recientes son los que reflejan su configuración actual.
**Lo que queda es acción, no código:** vincular sus Telegram y seguir la aprobación de Meta (TAREAS §2).

Suite 110/110.

## El sondeo de plantillas deja de ser mudo (2026-08-24, sin MD previo)

Juan preguntó dónde mirar cómo va la aprobación de las plantillas de las subcuentas. La respuesta
destapó un agujero: **ninguna plantilla ha llegado nunca a `approved` en producción** (5 tenants con
`null`, 2 con `pending`, cero `approved`, cero `rejected`), las dos existentes llevaban dos días
`pending` — mucho para una Utility — y era **imposible distinguir «Meta va lenta» de «nuestro sondeo
está roto»**, porque `pollProvisioning` tenía un `catch (_) {}` completamente mudo y
`fetchApprovalStatus` lee `data.whatsapp.status`: si la forma real no fuera esa, devolvería `unknown`
para siempre y la fila se quedaría `pending` en silencio. Con el precedente de `/v2/Channels/Senders`
—donde la forma asumida NO era la real y solo se supo pegándole a la API— la duda estaba justificada.

**Fuera el silencio:** el catch del sondeo loguea `provision_poll_failed` con el tenant y el error, y
un estado que no sea approved/rejected/pending/received loguea `template_status_unknown` con las claves
que sí trajo la respuesta. **Y comprobación a demanda:** botón «Comprobar plantilla ahora» en
Aprovisionamiento → `POST …/provision/template/check`, que consulta Twilio, **aplica el veredicto ahí
mismo** si ya es approved/rejected (con su línea de auditoría) y **muestra la respuesta CRUDA** en el
panel. Un `unknown` nunca escribe en la fila: avisa de que la forma cambió y deja ver dónde está el
estado de verdad. `fetchApprovalStatus` devuelve `raw` a propósito para eso.

El test cubre los tres caminos con la API simulada: `approved` se aplica al momento, `pending` no toca
la fila, y la **forma inesperada** (`{approval_requests:[…]}` en vez de `{whatsapp:{…}}`) sale como
`unknown`, no escribe nada y entrega el crudo íntegro. Suite 111/111.

**RESUELTO el mismo día con acceso a Meta.** Juan consiguió admin del portfolio del cliente y
WhatsApp Manager cantó: la WABA de gogestión tenía **«Total de plantillas activas: 0 de 250»**. La
plantilla **nunca llegó a Meta** — ni pendiente ni rechazada, inexistente — aunque Twilio aceptara el
submit (por eso quedó su línea de auditoría). El `pending` de la fila era una espera que no iba a
resolverse jamás. Lo demás de la WABA estaba sano y aísla el fallo a la plantilla: cuenta **Aprobada**,
número **Conectado** con calidad **Alta**, pago por la línea de crédito de Twilio. Con una salvedad
relevante: **verificación del negocio «No verificado»**, y el nombre del negocio es el nombre personal
del titular, no «GOgestión».

**Y el panel no dejaba reintentar:** el paso 2 lanza 409 `already_provisioned` si ya hay SID guardado,
así que te dejaba atascado justo cuando había que reenviar. Nuevo paso **`template/resubmit`** («Reenviar
a aprobación»): reenvía el Content SID existente, vuelve a marcar `pending` SOLO si Twilio lo acepta,
audita el reenvío y devuelve el crudo — si Twilio lo rechaza (duplicado, categoría, nombre) el motivo
viaja al panel con 502 en vez de deducirse, y la fila no se marca pendiente a mentira.

**Dónde se mira, para el registro:** la plantilla es un recurso DE LA SUBCUENTA, así que en la consola
de Twilio hay que cambiar de cuenta primero (Content Template Builder de la subcuenta, no de la
principal) — y con la página de WhatsApp senders ya sabemos que el menú de la subcuenta puede no
ofrecerla. Meta decide de verdad, pero con Self Sign-up la WABA vive en el Business Manager DEL
CLIENTE, así que Velai normalmente no la ve: Twilio es la ventana práctica, y el botón del panel evita
depender de ella.
## Conversaciones a pantalla completa (2026-08-27, del canvas «Conversaciones · Panel Velai»)

La bandeja vivía en una caja de `min(72vh,760px)` con la cabecera, la nota de disponibilidad y seis
filtros encima: en un portátil el hilo se quedaba en un tercio de la pantalla. Ahora la vista **ocupa
el viewport** y son los paneles los que scrollean, nunca la página. Lo sostiene una sola clase,
`body.wide`, que pone el conmutador de vistas: fija el alto y le quita a `main` su padding. Con el
recordatorio de siempre: `min-height:0` en toda la cadena y `#viewConversaciones[hidden]{display:none}`,
porque una clase que fija `display` gana al atributo `hidden` (es el bug que ya se desplegó dos veces).

Lo que cambia, y por qué:

- **Los seis filtros se pliegan** en un buscador dentro de la lista más un botón «Filtros» con el resto
  (cliente, fechas, lead, sin respuesta) en un panel anclado. Todo sigue en el mismo `<form
  id="convFilters">`, así que `convParams()` no cambia y el CSV exporta con los mismos filtros.
- **El buscador filtra de verdad**: `q` nuevo en `convFilters()` del worker, por nombre del lead y por
  identificador. El número se compara también sin espacios ni signos, porque en D1 se guarda
  `whatsapp:+34622418807` y en el panel se lee con espacios; los comodines `%` `_` del usuario se
  escapan con `ESCAPE '\'`. NO busca dentro de los mensajes: eso obligaría a recorrer `conv_messages`
  en cada tecla. El export comparte `convFilters`, así que necesitó su `LEFT JOIN leads`.
- **Chips de canal con su logo** (WhatsApp, Web, Messenger; Instagram ya tiene glifo en `CH_ICON`) y su
  contador. Con logo no hacen falta las palabras: el nombre va en `title`/`aria-label`, y así caben
  cinco canales en 340 px. Si no caben, la barra **se desplaza en horizontal** — nunca una segunda
  fila — con la barra de scroll oculta y una sombra de borde vía `background-attachment:local`, que solo
  aparece cuando de verdad queda algo por ver. Un canal que aún no existe NO se pinta: aparece solo el
  día que llegue una conversación suya (los contadores mandan).
- **La cola y la disponibilidad suben a la barra.** La píldora de «esperando asesor» ahora es roja de
  verdad: el `class="flag bad"` de antes no existía como estilo y salía ámbar. La disponibilidad es un
  botón con su punto y un panel con el porqué (cuántas personas hay, horario, a quién cubres) en vez de
  una línea de prosa permanente; el interruptor vive dentro (`#availSw`) y `#availToggle` solo abre.
- **Filas de dos líneas** sin separadores: lo seleccionado es una superficie con raíl (sombra interior,
  que sigue el radio), lo que espera sigue en rojo, y el canal se ve como insignia en el avatar. El
  cliente va en la misma línea que la vista previa: con 340 px no caben tres líneas, y Velai —que ve
  conversaciones de todos— necesita saber de quién es.
- **El hilo se lee como un chat**: divisorias de día («Hoy», «Ayer»), hora suelta en la burbuja, hilos
  cortos apoyados abajo con un espaciador elástico (no `justify-content:flex-end`, que en Chrome deja
  inalcanzable el principio del scroll), y al abrir un hilo se baja al último mensaje una sola vez —
  después manda el `atBottom`, para no dar saltos mientras alguien lee hacia arriba.
- **El cajón dice por qué**: abierto, campo que crece con lo escrito y botón de enviar redondo; en
  espera, una franja con los minutos, la cuenta atrás de los 15 min y «Tomo el control» (sin campo: lo
  que toca es entrar, no escribir); cerrado, campo punteado con el motivo de `WIN_WHY`.
- **Móvil**: la lista y el hilo se turnan (`.inbox.is-thread`) y el hilo trae su botón de volver; la
  cola baja a su propia línea a lo ancho; todo lo que se pulsa llega a 44 px. Dos arreglos que salieron
  al medirlo: la fila de navegación apilaba sus tres últimos botones en columna (185 px de alto) y ahora
  va en fila con scroll propio — con el alto fijado ya no se iba con el scroll de la página.

**Verificado mirándolo**, no razonándolo: `scripts/render-panel.mjs` (que ya acepta el módulo suelto,
`node scripts/render-panel.mjs worker/admin-page.js /tmp/p.png conversaciones`) en claro, en oscuro y a
390 px, midiendo alturas y blancos de toque por CDP. Ahí salió el fallo de nombre: `.cvtop` era ya la
primera línea de cada fila y la barra nueva le metía 56 px de `min-height` — la barra pasó a `.cvhead`.
El markup inyectado por el harness se actualizó al DOM nuevo. Suite **168/168**.

**Lo que NO entra:** buscar dentro del texto de los mensajes; el chip de Instagram (no existe el canal);
y la nav del móvil sigue siendo la barra lateral aplanada — la hoja «Más» del canvas queda para cuando
se rediseñe la navegación.

## Conexiones a dos columnas (2026-08-27, del canvas «Conexiones · Panel Velai»)

Nueve tarjetas apiladas a todo lo ancho con una o dos líneas de texto dentro, y el asistente de Telegram
como una caja vacía de 250 px: en un portátil sobraba media pantalla. Ahora la vista tiene **una tira de
estado arriba y dos columnas debajo** — a la izquierda el trabajo (asistente y horario), a la derecha el
estado y los ajustes cortos. Cada columna fluye por su cuenta (`.cxcol` es un flex propio, no celdas de
una rejilla), así ninguna arrastra a la otra: medidas, quedan a 1067 y 1035 px.

- **Tira de estado con los cinco canales.** Y aquí una decisión de Juan: los canales que **aún no
  existen se pintan igual**, apagados, en trazo discontinuo y con «Sin activar» — esconderlos dejaba la
  duda de si el canal existe, y pintarlos como si funcionaran sería peor. El catálogo vive en `CX_CAT` y
  `CX_SOON` del panel, no en el worker: `tenantChannelSummary` no se toca, así que la vista de Canales
  no empieza a contar Instagram como «canal que requiere atención». Mismos logos de canal que
  Conversaciones (`CH_ICON`, ahora con Telegram) — el panel habla un solo idioma.
- **Dos tarjetas que decían lo mismo se hacen una**: «¿Dónde llegan tus leads?» y «Números de aviso por
  WhatsApp» son la misma pregunta —quién recibe el aviso— y estaban separadas por media pantalla.
- **El horario deja de ser una rejilla muda**: cabecera Tramo 1 / Tramo 2 y un interruptor por día. El
  interruptor no es un dato nuevo (un día cerrado es un día sin tramos): lee la rejilla, al apagarlo
  borra sus horas y al encenderlo pone 9:00–19:00 para que quede válido de entrada, porque
  `hoursFromForm` exige `a<b` para guardar el tramo. El día cerrado dice qué pasa entonces: «Vai atiende
  y captura el lead». Los estilos van SOLO bajo `.cxsh` — `.shrow` y compañía las comparte el Calendario.
- **Los temas pasan a filas** con su descripción a la vista y editar/quitar como botones de icono (antes
  eran dos enlaces `✕` y `editar` dentro de un flag). El manejador ahora sube con `closest()`: con un
  SVG dentro del botón, `e.target` es el `<svg>` y el `data-*` no estaba.
- **El webhook** baja al pie, a lo ancho y en discontinuo: es fontanería de Velai, no un ajuste del
  negocio. **El informe semanal** pasa a interruptor. El visto del riel del asistente ya es un SVG y no
  un dingbat de fuente.
- **Instagram entra también en los chips de Conversaciones**, a 0 y apagado. Para que no sea mentira,
  `convFilters` acepta ahora `channel=instagram`: antes el parámetro se ignoraba en silencio y filtrar
  por un canal desconocido devolvía **todas** las conversaciones.
- **Móvil**: una columna, tira de estado en vertical y todo lo pulsable a 44 px dentro de la vista (los
  botones del panel son de escritorio: `btnsm` mide 28).

**Verificado mirándolo** con `scripts/render-panel.mjs` (que ahora inyecta el DOM nuevo de la vista:
fichas, riel con el paso abierto, temas y horas) en claro, oscuro y 390 px, midiendo alturas y blancos
de toque por CDP. Suite **168/168**.

**Lo que NO entra:** unificar `.card` en todo el panel — esta vista usa su propia caja (`.cxbox`) y el
resto de vistas siguen con la de antes; y la nav del móvil sigue siendo la barra lateral aplanada.
