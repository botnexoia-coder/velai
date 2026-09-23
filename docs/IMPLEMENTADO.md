# Implementado — registro consolidado de specs cerradas

> **Consolidación del 2026-08-18.** Cada spec/plan de esta lista se verificó contra el
> código en `main` (suite **54/54**) y se retiró de `docs/`. El texto íntegro de cada
> documento sigue disponible en el historial de git. Lo que sobrevive como pendiente
> está en [`TAREAS-PENDIENTES.md`](./TAREAS-PENDIENTES.md) (pasos manuales y de
> terceros) y en [`CONTEXTOS-AMPLIOS.md`](./CONTEXTOS-AMPLIOS.md) (fases 2–4).
>
> Docs vivos que NO se consolidan: `OPERATIONS.md`, `GUIA-WORKERS.md`,
> `STACK-TECNOLOGICO.md`, `ESTRUCTURA.md`, `ALTACLIENTE.md`, `DEMOS.md`,
> `VOLUMEN-Y-ALMACENAMIENTO.md`, `VERIFICACION-GOOGLE.md`,
> `PARA-JOHAN-widget-en-webs-cliente.md` y los de marketing (`links-strategy.md`,
> `backlinks-plan.md`, `pauta-anuncios.md`).
>
> **Repaso del 2026-09-16**: la regla se aplicó también DENTRO de los docs. Se borró
> `SPEC-AUTOAGENDA.md` entera y se retiraron de `H1-PANEL.md` sus §1 y §2 y de
> `H2-PANEL.md` su §4; las tres cosas están resumidas abajo. Fuera de `docs/` se borró
> `worker/MIGRACION-HONO.md`: la migración está hecha y el mapa del worker vive en
> `ESTRUCTURA.md` §Arquitectura y en `GUIA-WORKERS.md` §2.

---

## Planes y módulos por cuenta (2026-09-21, migración 0043; implementación local, pendiente de CD)

Plan + excepciones por cuenta, conservando las decisiones de la spec revisada:
Esencial permite un canal de conversación; Profesional y Empresa no ponen tope e
incluyen Calendario. Citas (reservas online + confirmaciones) y Eventos son addons.
Empresa tiene hoy las mismas prestaciones implementadas que Profesional. Finanzas
sigue siendo interna de Velai y no forma parte de este catálogo.

- `worker/planes.js` concentra catálogo, derechos efectivos y canales ocupados. Web
  ocupa plaza con primario `web:` o al menos un origen configurado; WhatsApp,
  Messenger e Instagram cuentan una vez por tipo (primario o fila de enrutado).
  Instagram solo se reconoce para contar; su integración sigue pendiente. Telegram
  es un destino de avisos y nunca consume plaza.
- `0043_planes.sql` añade `tenants.plan`, una revisión para evitar sobrescrituras y
  `tenant_modulos` con excepciones `on`/`off`, actor y fecha. Deduce el plan por los
  canales actuales y conserva Calendario, Citas y Eventos que ya se usaban, incluido
  el acceso a históricos. Una excepción concedida sobrevive al cambio de plan;
  quitarla devuelve el comportamiento del catálogo. La migración no deduce contratos
  comerciales: revisar el reparto real antes de aplicarla.
- El límite se comprueba al dar de alta, editar orígenes/canal, crear o sincronizar
  el sender y bajar de plan. Responde `409 plan_channel_limit` antes de configurar
  un segundo canal en Esencial. Canal primario y espejo se escriben juntos, con
  control de concurrencia. Activar un prospecto con WhatsApp ya conectado utiliza
  ese canal y no lo convierte innecesariamente en web.
- El **cupo de canales nunca corta mensajes entrantes**, aunque haya configuración
  heredada que lo supere. Revocar Calendario retira sus herramientas de agenda;
  revocar Eventos detiene la captura del módulo y su integración firmada. No borra
  datos, y se siguen atendiendo consentimientos pendientes y bajas de avisos.
- `resolveScope` carga plan/derechos una vez; `moduloGate` protege calendario,
  reservas/servicios y eventos antes de las consultas de los handlers. Recurso de
  otro tenant sigue siendo 404. Sin migración, se cierran solo las áreas contratables.
  `/me` publica `plan`/`modulos`: Eventos ya no depende de sembrar una fila.
- Solo Velai puede consultar/editar `/tenants/:id/plan`; `/planes` ofrece el catálogo
  para el alta. PATCH exige revisión y audita `field='plan'`. El guardado general
  acepta también plan/excepciones para que la ficha conserve **un solo Guardar**.
  La transacción incluye derechos y apagado de `reminders_enabled` y
  `booking_enabled` cuando Citas deja de estar concedido. Citas requiere Calendario.
  Los interruptores operativos no se reactivan al volver a conceder el módulo;
  tampoco puede activarlos Velai sin derecho ni reencenderlos una petición antigua.
- Panel: segundo paso «Plan y módulos», selector desde el catálogo del servidor,
  estado heredado/excepcional, restauración del valor del plan y contador de canales;
  chip de plan en Clientes. Menús y rutas directas respetan los derechos; Citas
  oculta sus controles en Calendario. `/me` se refresca cada 30 segundos para que
  una sesión abierta recoja las revocaciones. Ficha revisada en escritorio y móvil.

Revisión posterior (mismo día, tres correcciones sobre la primera pasada):

- **El aprovisionamiento vuelve a ser tolerante.** `sender/sync` había perdido su
  `try/catch` deliberado: un `address_taken` (el número enruta a otro cliente) o un
  guardado concurrente abortaban el paso con 409 **antes de reparar el webhook**, otro
  requisito para recibir mensajes — o sea, reintroducía el incidente de gogestion
  (2026-08-24: sender ONLINE y bot mudo). Ahora informa (`channelRegistered:false`,
  `applied:0`, `channelError`, log `sender_channel_not_registered`) y sigue hasta reparar el webhook. El
  cupo del plan sí sigue cortando antes: configurar de más es otra cosa. El assert de
  `channelRegistered` se había vuelto tautológico (el valor era una constante `true`) y
  ahora hay un caso con el número ya enrutado a otro cliente que lo vigila. Ambos paneles
  muestran «Sincronización incompleta» si falla el registro o el webhook: un guardado
  concurrente pide reintentar; un número ocupado pide revisar su asignación. La auditoría
  también distingue el resultado parcial. Una prueba con SQLite cubre la carrera y el reintento.
- **El derecho de calendario se comprueba antes de usar la caché.** Cada consulta de
  `tenantCalendar` verifica el módulo en D1. Borrar `calcfg:` al revocarlo no basta:
  un llenado en vuelo puede restaurarlo y el borrado puede fallar. Las pruebas cubren
  ambos casos; la configuración antigua no habilita consultas posteriores. Si falla
  la lectura del derecho, el chat sigue respondiendo sin las tools de calendario.
- **El callback OAuth de Google redirige en vez de devolver JSON.** `assertTenantModulo`
  lanzaba un 403 en un flujo que vuelve al navegador del usuario; ahora sale por
  `back('sin_modulo')` como el resto de errores de ese callback.

También se retiró `useTenantPlanSave` (nunca se usó: la ficha guarda el plan por el
`PATCH /tenants/:id` general, dentro del «un solo Guardar»).

**Corrección del router de aprovisionamiento (2026-09-21, caso Zoe).** Pulsar
«Sincronizar desde Twilio» enviaba correctamente `/sender/sync`, pero las alternativas
sin agrupar en la ruta de `/sender` también coincidían con esa URL. El router ejecutaba
el alta y devolvía `sender_sin_sincronizar` aunque se hubiera pulsado sincronizar.
Las alternativas de las rutas de aprovisionamiento van ahora agrupadas; se comprueban
también OTP, perfil, comprobación y reenvío de plantillas, y se rechazan sufijos ajenos.
La prueba de concurrencia pasa por el router y un E2E pulsa el botón real con SQLite y
Twilio simulado: reproduce el error antes de la corrección y después registra el sender,
su canal y el webhook sin crear otro. Los tests directos de `handleProvision` por sí
solos no detectaban este fallo de despacho. Desplegada por CD el 2026-09-21 (worker
`3b276ec3-4a21-4fbb-8578-a97e13045bbd`).

Verificación: `npm run check`, unitarios del panel, typecheck/build y Playwright;
pruebas con SQLite real de migración, altas, cambios de canal, concurrencia,
rollback, auditoría, continuidad de WhatsApp y cierre de reservas públicas tras
revocar Citas. El E2E nuevo usa el worker real contra SQLite, sin cuentas externas.
No se ha aplicado la migración ni desplegado desde esta sesión. El siguiente paso
es el CD habitual (staging antes de producción), registrado en TAREAS-PENDIENTES.

### Eventos (migraciones 0041/0042, ahora bajo el módulo `eventos`)

Vista operativa de eventos, reservas provisionales y consentimientos. La captura
conversacional distingue reservas de un evento de solicitudes de celebración propia;
la integración web firmada crea lead, reserva y consentimiento con idempotencia.
El cliente consulta y gestiona solo sus reservas; Velai conserva la vista global.
La concesión del módulo es independiente de que existan eventos cargados.

## Biblioteca multimedia por cliente (`SPEC-BIBLIOTECA.md`, 2026-09-17, migración 0039)

Pedido de Juan: «un apartado multimedia, que el bot pueda tomar de ahí imágenes, documentos
o audios para enviar en los chats». El negocio sube su material **una vez** desde su panel y
Vai lo entrega solo cuando hace falta, en vez de describirlo con palabras o soltar una URL.

**Las decisiones que fijaron el diseño** (Juan, 2026-09-17): el bot elige con una **tool
sobre el catálogo**, no con reglas a mano — cada archivo lleva una descripción y decide el
modelo; **lo gestionan cliente y Velai** (autoservicio, rutas en `clienteAllowed` con guarda
own-only); cuatro familias —imagen, PDF, audio y vídeo corto—; **R2 obligatorio**, sin
binding la subida da 503 y nunca se cae a KV en silencio; **500 MB por cliente**; y por
fichero, los límites del canal y ni un byte más (5 MB imágenes, 16 MB el resto, los de
WhatsApp: aceptar más sería prometer algo que el canal no entrega).

- **La pieza que sostiene el resto: el executor no envía nada.** `enviar_archivo` solo deja
  el archivo elegido en `meta.attachment`, igual que `meta.bookingCard`. Así hay **un solo
  camino de envío por canal** (TwiML `<Media>`, `MediaUrl`, campo JSON del widget) y la
  herramienta se prueba entera sin tocar Twilio.
- **Esquema y perímetro**: `tenant_media` + `tenant_media_uploads` y las cuotas
  (`media_quota_bytes`, `media_bytes_used`, `media_files_used`) con reserva atómica por
  trigger en D1; claves inadivinables `lib/<tenant>/<uuid+8hex>.<ext>` que nunca se
  sobrescriben; **tipo por magic bytes, jamás por cabecera** (SVG rechazado: es script); y
  `/media/*` con `nosniff`, `default-src 'none'; sandbox` y `noindex`, porque un fichero
  interpretable como HTML en el origen de la API del panel es XSS en `api.hirevai.com`.
  La `description` la escribe el cliente y entra en el prompt: ≤300 caracteres sin saltos
  de línea ni caracteres de control, para que no pueda falsificar secciones del system.
- **Panel**: vista `Biblioteca` dentro de Conexiones (subida, metadatos, canales permitidos
  `web/whatsapp/messenger`, cuota y borrado), historial con `attachments_json`, marcador de
  texto en la transcripción y chips en la bandeja.

**Verificado en producción el 2026-09-17** (PR #2 y #3, CD del commit `8f1507b`): subida
autenticada de un PDF de 3 MB desde el panel y descarga pública con el mismo SHA-256 y las
cabeceras esperadas; un archivo de 20 MB rechazado con 413 `media_too_large`; logo aplicado
con `store:r2`; el modelo eligió el PDF y Twilio lo entregó con estado `read`, 1 adjunto y
sin error; al pedirlo otra vez respondió solo texto, con `sent_count` en 1; y tras
desactivarlo, una conversación web nueva no lo ofreció ni lo nombró. Las pruebas por
navegador no superaron Turnstile y se completaron con interacción real de Juan, **sin
deshabilitarlo ni sustituirlo**. El PDF de prueba queda inactivo en producción con su
historial intacto; su enlace público sigue accesible, como está documentado del producto.

**Lo que NO entra, decidido**: recibir archivos del cliente final; PDF como base de
conocimiento (`CONTEXTOS-AMPLIOS.md` ya lo descartó — esto es para **enviar**, no para
consultar); miniaturas o transcodificación; Telegram; URLs firmadas; y analítica de
descargas (`/media/*` va por caché de borde y no se puede contar sin desactivarla).

---

## Finanzas: el libro interno de Velai (`SPEC-FINANZAS.md`, 2026-09-17, migraciones 0037/0038)

Pedido de Juan: «gastos, ingresos y egresos… qué queda en caja, y si repartimos algunos de los
ingresos, los que hacemos parte del equipo que nos repartimos dineros». Contabilidad **de
Velai**, no un módulo para clientes: ningún tenant la ve ni existe para el rol cliente.

**Las cuatro decisiones que fijaron el modelo** (Juan, 2026-09-17): reparto **manual por
evento**, sin porcentajes guardados; **egreso = salida que no es gasto**, de modo que
`beneficio = ingresos − gastos` y repartir dinero no parezca una pérdida; **dos monedas, EUR y
COP**, cada una con su caja y sin conversión; y acceso **solo para socios**, no para todo el
rol velai.

- **Esquema** (`0037_finanzas.sql`): `fin_conceptos` (el catálogo de los desplegables, cada
  concepto de un solo tipo), `fin_movimientos` (un único libro: el tipo da el signo y el
  importe va en la unidad MENOR —céntimos en EUR, pesos en COP— para que sumar cien filas no
  arrastre redondeos), `fin_repartos` y `fin_socios`. Las líneas de un reparto son egresos con
  `reparto_id`: **el dinero repartido sale de la caja por el mismo camino que todo lo demás**,
  que es justo la resta que se olvida cuando vive aparte.
- **Dos cerraduras, no una**: ninguna ruta entra en `clienteAllowed`, así que `clienteGate`
  cierra al rol cliente ANTES de tocar D1; y cada uno de los 17 handlers exige `esSocio` en su
  primera línea. `SOCIOS_EMAILS` vive en el entorno y no en D1 —mismo motivo que `ADMIN_EMAILS`:
  si la lista de quién cobra fuera una tabla editable desde el panel, una sesión comprometida
  podría añadirse sola—, y hace falta ADEMÁS rol velai. `/api/admin/me` devuelve `socio`.
- **Las cuentas, escritas una sola vez**: la caja es SIEMPRE acumulada desde el origen aunque
  el filtro diga «septiembre» (preguntar «qué queda» por periodo no significa nada), el
  beneficio sí es del periodo y los egresos no lo tocan. Nunca se suman euros con pesos.
- **Panel** (`views/Finanzas.tsx`, bloque «Administración» de la barra lateral, visible solo
  con `me.socio`): Movimientos con tarjetas por moneda y la caja destacada, Repartos con el
  acumulado por persona, Conceptos y Socios. `finImporte` lee «0,29» como 29 céntimos exactos,
  sin multiplicar flotantes.
- **El egreso que firma los repartos** se localiza por la marca `fin_conceptos.sistema` y nunca
  por su nombre: renombrarlo desde el catálogo dejaba el reparto siguiente en un 409
  inexplicable. La API rechaza renombrarlo, apagarlo y borrarlo; reordenarlo sí, porque moverlo
  de sitio no rompe nada.
- **Socios gestionables** (`0038_fin_socios_gestion.sql`): `SOCIOS_EMAILS` decidía dos cosas a
  la vez, quién entra y quién cobra. Ahora `fin_socios` es el catálogo de beneficiarios,
  editable desde la pestaña Socios, y la variable conserva EXCLUSIVAMENTE el permiso de
  entrada: un alta del panel no concede acceso y hay test que lo prueba. Corregir un correo
  reasigna sus repartos en la MISMA transacción, para que el acumulado de una persona no se
  parta en dos por un error de dedo; quien tiene pagos no se borra, se desactiva. La carrera
  entre validar un beneficiario y darlo de baja se cierra en la base con un trigger
  `BEFORE INSERT` dentro del propio batch: si el socio deja de estar activo a mitad, cae
  también la cabecera del reparto. Alta, cambio y baja dejan rastro (`created_by`/`created_at`
  en la ficha y `fin_socio_alta` / `fin_socio_cambio` / `fin_socio_baja` en el log).
- **Permisos finos** (`0040_permisos.sql`): ser admin de Velai abría el panel pero no
  Finanzas, y lo único que abría Finanzas era `SOCIOS_EMAILS` — una variable del `wrangler.toml`,
  o sea un deploy por cada persona. Ahora hay `admin_permisos` (email × permiso, hoy solo
  `finanzas`), que la cuenta raíz concede y revoca desde **Configuración → Permisos**. La
  garantía que mantenía la lista fuera de D1 no la daba el almacén sino quién escribe: las tres
  rutas comparten la puerta `soloRaiz` del token de Cloudflare — raíz = `ADMIN_EMAILS` del
  entorno—, así que **un admin dado de alta en el panel no puede ascenderse a sí mismo**.
  `SOCIOS_EMAILS` se queda como la RAÍZ del acceso: si la tabla se vaciara entera, los correos
  del toml siguen entrando, igual que `ADMIN_EMAILS` sobrevive a un `DELETE FROM admin_users`.
  Los permisos se resuelven UNA vez en `resolveScope` y viajan en el scope, para que `esSocio`
  siga siendo síncrono y el barrido adversario de los 17 handlers siga devolviendo 403 sin
  tocar D1. Solo se conceden a quien ya es admin (un permiso suelto no abre nada y mentiría en
  la lista) y quedan auditados en Telegram (🔐) y en el log (`permiso_concedido` /
  `permiso_retirado`). Estiven (`estivenrojas09@gmail.com`) entra a Finanzas por esta tabla y
  no por el toml, precisamente para poder quitárselo con un clic.
- **Pruebas**: `test/finanzas.test.js` (19 casos sobre SQLite real, con todas las migraciones y
  las claves ajenas activas) cubre la aritmética de las dos monedas, el 403 a un velai NO socio
  sin permitirle una sola consulta, el rollback real de un reparto con una línea mala, la baja
  concurrente y un replay de la 0038 sobre el estado ya desplegado que demuestra que no mueve
  ni una fila. Además `Finanzas.test.tsx` y tres recorridos E2E que usan los handlers reales
  contra SQLite efímera.

**Desplegado el 2026-09-17 en dos tandas**, las dos por el CD y con la migración remota antes
del worker: `033807f` (el libro, migración 0037) y `79cdfbe` (socios gestionables,
migración 0038).

**Lo que NO entra, a propósito**: conversión EUR↔COP y total combinado —exige una tasa, y una
tasa envejece—; facturación, IVA, AEAT o DIAN; adjuntar justificantes; conciliación bancaria;
presupuestos; y enganchar automáticamente el gasto de IA de `ai_usage`, que está en USD (una
tercera moneda) y se apunta a mano.

## Autoagenda: página de reserva pública, servicios y embeds (`SPEC-AUTOAGENDA.md`, 2026-09-15/16, migraciones 0034/0035/0036)

La **F3** que SPEC-CONFIRMACIONES dejó anotada: una superficie de reserva **sin
conversación**, para el visitante que no quiere escribir. El chat sigue agendando
conversando — eso es lo que nos distingue de Calendly y no se toca; el enlace es la otra
mitad del mismo embudo. Las cuatro fases de la spec están construidas y desplegadas:

- **Núcleo** (`worker/agenda.js`): `monthAvailability()` y `bookAppointment()` extraídos de
  `calendarExecutor` — el chat y la página llaman al MISMO código. Un mes entero se resuelve
  con **una** lectura de `events.list` (paginada) y `freeSlots()` puro día a día, con caché KV
  `calfree:<tenant>:<servicio>:<mes>` de 90 s que `bookAppointment` invalida al reservar. Se
  siguen leyendo solo `start/end/status/transparency`: ni un título de evento sale de Google.
- **Servicios** (`0034_servicios.sql`, tab «Reservas online» del panel): catálogo por negocio
  con duración, modo (presencial/vídeo/teléfono), lugar y descanso. El bot usa la duración del
  servicio. Horas de inicio **solo a :00 y :30**, nunca hora libre.
- **Página pública** en `citas.hirevai.com/{cliente}/reservas` (`worker/reserva-page.js` +
  `worker/routes/reserva.js`): HTML autocontenido con nonce, móvil primero, ES/EN, marca del
  tenant y marca Velai fija; stepper de tres pasos, .ics propio y `/{cliente}/cita/<token>`
  para cancelar y **reagendar** (lo que hasta ahora no existía por ningún camino).
- **Embeds** (`site/assets/vai-citas.js`): iframe inline y popup con la misma página, altura
  por `postMessage` con origen verificado, y el snippet listo para copiar en el panel. En el
  chat, la tool `enviar_enlace_reserva` (`worker/calendar.js`) hace que Vai **pregunte una vez**
  cómo prefiere reservar el visitante en vez de recitar horas.

**El aislamiento se escribió como estructura, no como disciplina** — que era el riesgo real
de añadir un hostname al mismo worker con `run_worker_first`: `BOOKING_ORIGIN` en los dos
entornos (fail-closed: sin ella las rutas de reserva **no existen**), `mwBookingHost`
(`worker/booking-security.js`) delante de todas ellas, el perímetro del panel intacto y tres
tests que lo clavan: los assets del panel **no** son alcanzables desde el host de citas, las
rutas admin dan 404 dentro de él, y las de reserva dan 404 fuera. `admin.hirevai.com` quedó
descartado con la prueba delante (Access corta antes que nuestro código) y el atajo del
**Bypass de Access no se reabre**: pondría la cerradura del panel de todos los clientes a
depender de un patrón de path escrito en el dashboard, que ningún test puede ver.

Anti-doble-reserva en tres barreras: relectura del hueco, claim atómico en `booking_claims`
(0035) que cubre duración **y** descanso, y `UNIQUE(request_id)` con id determinista de evento
para que un reintento de red no cree una cita gemela. Tope de 3 citas futuras por teléfono —
una página pública sin eso es un formulario abierto para llenarle la agenda al cliente. El
`manage_token` es un HMAC truncado: sin token válido, 404, y el id nunca viaja en claro.

**Verificado**: suite **244/244** (incluidos los tres de aislamiento de host, los de
`monthAvailability` con DST y horario partido, y los del hold que caduca) y la página real
**mirada** en `citas.hirevai.com/dialogos/reservas` — cabecera de Diálogos, marca Velai y el
paso 1 de 3 con sus tres modalidades. Migración 0036 preparó el piloto de Diálogos.

**Añadido el 2026-09-16**: quien abre un enlace de reservas de un negocio que no las tiene
encendidas ya no recibe el JSON de error del worker, sino una página con la marca de Velai
(«Aquí todavía no se puede reservar») y por dónde escribirnos. Sigue siendo un 404 y sigue
siendo **la misma respuesta byte a byte** que para un slug inexistente —con el nonce del CSP
como única diferencia, que es aleatorio por respuesta—: el aviso no puede convertirse en una
forma de averiguar qué clientes existen. Un test lo compara.

**Abierto** (en TAREAS-PENDIENTES): el precio, la plantilla `confirmacion_reserva` por
aprobar antes de que la confirmación salga por WhatsApp, y colocar el embed en la web de
Diálogos cuando el enlace lleve una semana sin sustos.

## Las tres webs que faltaban pasan al loader — 2026-09-16

Con los repos de los seis sitios ya accesibles se revisó página por página quién servía
qué. Diálogos, hiredatavision y Zoe estaban al día (loader en todas sus páginas salvo
`404.html`). Faltaban tres, y cada una por un motivo distinto:

- **`CronoSeb/gogestion-demo`** (portada y privacidad) seguía en `vai-widget.js?v=14`,
  la única versión viva que no sabe recibir la conversación en vivo del panel. Se
  borraron además `assets/assistant-brand.js` y `assets/velai-assistant-polish.js`
  (248 líneas): ambos se apoyaban en `window.VELAI_ASSISTANT_UI`, que el widget dejó de
  leer en la v15 — pintaban su propio lanzador y su propia tarjeta por encima del
  nuestro. Commit `f2de36c`.
- **`botnexoia-coder/MyXuCostura`** estaba en `?v=17`. Cambio de dos líneas. Commit `d18bc4c`.
- **`botnexoia-coder/TuFisioOficial`** era el caso sucio: `?v=20260913-salo`, más un
  `velai-assistant-polish.js` pedido a hirevai.com que **respondía 404** (ese archivo
  nunca se publicó en nuestro sitio, solo existía en el repo de gogestion), más 69 líneas
  inline de `VELAI_ASSISTANT_UI` y un `MutationObserver` que reescribía nombre, saludo y
  chips del widget ya montado y añadía su propia tarjeta en móvil. Todo eso llega hoy de
  Marca. Commit `77a9629`.

Las tres publicaron solas: `myxucostura` y `gogestion-demo` son proyectos de Pages con
Git, y `tufisiooficial` es un Worker con assets que también despliega desde el repo. **Las
tres verificadas mirándolas** (captura con chrome-headless-shell a 1280×900 sobre el
dominio real, no sobre el repo): lanzador, tarjeta de bienvenida y `assets/vai.js` sin
versión en el HTML servido.

`ArteYMotor` queda fuera a propósito: ese sitio no lleva widget. `gogestion.es` es la web
real del cliente y no es nuestra — nuestro repo solo sirve el demo en `gogestion-demo.pages.dev`.

**Lo que la limpieza dejó a la vista:** Salo y Faby salen con la inicial del bot y la
tarjeta genérica, porque sus fichas de Marca tienen `portrait_url` y teaser a NULL —
antes eso lo tapaba el andamiaje local. Mei, que sí los tiene cargados, sale perfecta. Es
trabajo de panel, no de código: queda en TAREAS-PENDIENTES.

## Loader sin versión — 2026-09-14

`site/assets/vai.js` resuelve el widget contra su propio `currentScript.src`, con
versión vigente 16 y doble guarda para evitar inyecciones repetidas o un widget
ya montado. Los clientes incluyen el loader sin query; hirevai conserva las
27 referencias directas `vai-widget.js?v=16`. La excepción de `_headers` retira
Cache-Control heredado y fija `public, max-age=300, must-revalidate`.
`check:js` valida el loader y `check-site` exige coincidencia loader/widget/HTML
y la regla de caché corta. ALTACLIENTE y PARA-JOHAN v6 incluyen el snippet definitivo.
La propagación aplica a posteriores cargas, no a sesiones abiertas.

Desplegado el 2026-09-14 (commit `953d020`, CI `34853146142`, Pages publicado con el
mismo push). El `!` de `_headers` retiró el `immutable`, pero la cabecera real llegaba
como `max-age=14400`: el ajuste de zona **TTL de caché del navegador** estaba en 4 h y
elevaba cualquier max-age inferior. Juan lo pasó a «Respetar los encabezados
existentes» el mismo día y el loader quedó en `public, max-age=300, must-revalidate`.
Desde entonces `_headers` es la única fuente de la política de caché de hirevai.com, y
lo que hay en git es lo que sirve el borde. Único efecto lateral: `robots.txt`, sin
regla propia en el archivo, pasó de 4 h a la cabecera de Pages (`max-age=0`).

## Sesión de Access caducada: el panel lo dice — 2026-09-15

Access no responde 401 a las peticiones del panel: responde 302 hacia su login, en otro
origen. Con el redirect por defecto el navegador intentaba seguirlo, la CSP del panel
(`connect-src 'self'`) lo bloqueaba y `fetch` caía con un TypeError genérico. La ficha
mostraba «la petición falló» y parecía un botón roto, con la consola llena de avisos de
CSP que no señalaban la causa. Le pasó a Juan subiendo el retrato de Dara.

`api()` pide ahora `redirect:'manual'` —puesto después del spread, para que ninguna
llamada pueda volver a esconderlo— y trata la respuesta opaca como lo que es:
`session_expired`. Un módulo `api/session.ts` avisa una sola vez, y el marco pinta una
barra que ofrece **entrar en otra pestaña**, no recargar: recargar tiraría el formulario
a medio escribir, que es justo lo que se estaba guardando cuando saltó. De paso, un
fallo de red se traduce a `network_failed` en vez de propagarse crudo, y un abort de los
sondeos de fondo sigue siendo un abort.

Cubierto por `src/api/session.test.ts` (respuesta opaca, aviso único, redirect manual,
red frente a abort) y por un caso en `Shell.test.tsx`. Panel v2.7.0.

## Widget v17: el copy de Velai no viaja a webs de cliente — 2026-09-14

Al absorber la capa cosmética en el widget, cada web de cliente dejó de traer su propio
`assistant-brand.js` y pasó a depender de la ficha en admin.hirevai.com, que es lo
correcto. Pero la cascada del teaser y de las sugerencias caía al texto de Velai cuando
la ficha no tenía los suyos: zoetravelspain.com y hiredatavision.com llegaron a mostrar
«¿Tu negocio necesita más tiempo? Cuéntame qué tarea te gustaría automatizar». Con
tenant, el teaser usa ahora copy genérico («¿En qué puedo ayudarte?») y las sugerencias
quedan vacías; sin tenant, hirevai.com conserva el suyo. Misma regla que el retrato.

Diálogos además conservaba su propia capa, `dialogos-widget-polish.js`, escrita para
Alma porque el polish compartido excluía ese tenant: con v17 duplicaba cara y etiqueta
dentro del mismo botón. Retirada en el repo `Dialogos` (`9ca194c`), conservando su única
regla propia, subir el botón sobre el FAB de la página de CV.

Desplegado el 2026-09-14 (commit `595ffbf`, CI `34859408570`, deploy `34859554503`).
Verificado en los tres sitios en vivo: un solo botón, una sola cara, `?v=17` y consola
limpia. Los tests de versión dejaron de clavar el número y comparan loader contra
cabecera del widget; check-site sigue añadiendo los 27 HTML.

Pendiente de datos, no de código: los retratos, acentos y textos de tarjeta de los tres
clientes se recuperaron de git y hay que cargarlos en el panel (ver TAREAS-PENDIENTES).

## Ventana del chat v16 — 2026-09-14

Panel fijo lateral de 400 px y márgenes de 16 px en escritorio; oculta el lanzador
mientras está abierto y devuelve el foco al cerrarse. En <768 px conserva el sheet
y el botón. Ambos respetan `--vai-lift`; el cálculo contempla el panel visible
cuando el botón está oculto. Lanzador y teaser v15 conservan su aspecto.

Bienvenida con retrato de 84 px, saludo y estado; identidad compacta con retrato
al comenzar el hilo. El logo empresarial continúa configurable, pero la cabecera
v16 usa el retrato según esta nueva especificación (sustituye la decisión v15).
El saludo se pinta una sola vez como primera burbuja al enviar y se reconstruye
al restaurar, sin añadirlo al payload/historial que recibe el servidor. Mensajes
anclados abajo con `margin-top:auto`, bot según tema, usuario en gradiente,
equipo con acento y marca. Por indicación posterior de Juan, `/chat/poll` añade
`agent_name` por mensaje: alias del autor anterior a @, sin dominio ni etiquetas
+tag, como identidad visible del panel. No devuelve el correo completo. El widget
pinta «Nombre · Equipo {marca}» y conserva el nombre en la sesión restaurada;
mensajes sin autor conocido caen a «Equipo {marca}». Nombre público editable,
independiente del alias, anotado como mejora en pendientes.

Temas claro y oscuro explícitos y automático mediante prefers-color-scheme, que
responde a cambios del sistema; sin tenant se fija oscuro. Vista previa del panel
con bienvenida, retrato, entrada y sugerencias; selector Automático/Claro/Oscuro.
Hasta cinco chips en validación, boot, formulario, preview y render. Botón Enviar
inactivo sin texto o durante envío. No hay nuevas migraciones para v16 (0033 sigue
siendo parte del lote v15 pendiente). Turnstile, demos, mecánica de poll y VaiChat se conservan.

Validación local: `npm run check`, 219/219 worker + 5/5 aislamiento, 138/138
panel, tipos y build. Chromium: 12/12 recorridos, incluido loader desde un origen
distinto, temas, geometría, transcript restaurado y nombre de cada agente. Referencia externa
de Claude inaccesible en esta sesión; diseño comprobado contra las medidas y tokens
del MD, con capturas y recorridos en Chromium.

Desplegado el 2026-09-14 (commit `953d020`, CI `34853146142`, deploy worker
`34853293426` con gate y deploy en verde, Pages con el mismo push; suite 224/224,
panel 138/138, Chromium 11/11). Verificado en hirevai.com real con Chromium: ventana
de 400×768 desde `top:16px`, botón oculto al abrir, «Hablar con Vai» al cerrar, sin
errores de consola y una sola petición `vai-widget.js?v=16`. Queda por mirar en una
web cliente con cabecera fija. Rollback visual a v15: restaurar juntos widget, HTML y
loader con `V='15'`; no revertir 0033.


## Lanzador de marca en el widget (v15) — 2026-09-14

Absorbida la capa cosmética de `36c28a2` dentro de `vai-widget.js`: pill de 64 px,
retrato o inicial, «Hablar con {bot_name}» / «Cerrar conversación», kicker fijo
«ASISTENTE IA · VELAI» y tarjeta oscura ES/EN. Es el único lanzador para todos
los tenants, incluido dialogos. Hirevai sin tenant conserva retrato absoluto
`https://hirevai.com/assets/assistants/vai-v1.jpg`, colores
`#b83e08 / #662a16 / #ff914f` y textos Vai. El logo sigue en la cabecera del chat.
Retirados los dos scripts externos y sus etiquetas; 27 HTML usan `?v=15`.

Migración aditiva 0033: `portrait_url`, `accent_color`, `teaser_title`,
`teaser_copy`, `teaser_title_en`, `teaser_copy_en`. Validación, alta, ficha,
versionado PATCH, caché KV y boot público cubren los campos. El acento vacío
se deriva del primario; los textos EN caen a ES y después al default.
`POST /api/admin/tenants/:id/logo?kind=portrait` reutiliza almacenamiento,
validación por magic bytes y límite 2 MB; guarda retrato y versión config,
invalida caché y no sincroniza WhatsApp ni valida canales. Marca del widget
incluye subida, URLs, acento, textos y previsualización. Conexiones cliente,
admin v1, middleware y pruebas de aislamiento quedan sin cambios.

El teaser no se crea ni registra impresiones en <768 px. Un solo `--vai-lift`
resuelve los banners visibles con solape horizontal (`velai-consent` solo
<900 px, `cookieBanner`, `ckb`), con observación de tamaño, atributos y viewport.
La API VaiChat, sesiones, demos, Turnstile y live-poll se conservan.

Desplegado el 2026-09-14 en el mismo push que el loader y la ventana v16 (commit
`953d020`, deploy worker `34853293426`, migración 0033 aplicada por CD en staging y
producción). Verificado: `GET /widget/boot` en producción devuelve los seis campos
nuevos; hirevai.com sirve el widget v16 sin rastro de los scripts polish.
Validación local: `npm run check`, 218/218 pruebas worker + 5/5 aislamiento,
137/137 panel, tipos (incluido E2E), build y 5/5 pruebas Chromium (smoke del
panel y cuatro recorridos del widget). Las 33 migraciones se aplicaron en SQLite.
La subida devuelve además `updated_at`: la ficha conserva el borrador y renueva
su versión optimista para permitir Guardar después sin un falso 409.

Tras publicar, `?v=14` queda en estado mixto: Pages ignora el query en origen
y purga edge, por lo que nuevos visitantes reciben v15; los recurrentes pueden
retener v14 hasta un año. Es funcionalmente seguro, pero exige bumpear snippets
para uniformidad. Loader sin versión, retrato en Conexiones y cambios de idioma
en caliente pasan a pendientes. Rollback: revertir Pages a v14 con sus scripts;
no revertir la migración aditiva; el worker puede mantenerse. Colores muy claros
pueden reducir contraste; el preview permite ajustar el secundario oscuro.


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
`GET /api/admin/plantillas` consciente del rol (cliente permitido, siempre atado al
tenant del scope): une el registro `tenant_templates` con la plantilla de LEADS de las columnas históricas,
presentada como kind `aviso_lead` fuente 'columnas' — unificación de LECTURA; su
almacenamiento y su alta (paso 2 del aprovisionamiento) no cambian, y el POST
genérico la rechaza (`template_kind_not_creatable`). El catálogo es desde aquí LA
lista completa de plantillas del sistema.

## Solicitudes de cliente y categoría real de Twilio en Plantillas (2026-09-01)

Dos evoluciones de la vista Plantillas (panel v2.6.0, migración 0032):

- **El cliente SOLICITA y Velai aprueba** (tabla genérica `tenant_solicitudes`:
  tipo + payload JSON, UNIQUE parcial de 1 pendiente por tenant+tipo). Desde su
  vista, el cliente elige antelación (12/24/48) y pareja de botones curada viendo la
  preview, y «Solicitar cambio» crea la solicitud (validada CONTRA EL CATÁLOGO —
  hostiles = 400 sin efectos; tenant siempre del scope) con aviso a Velai por
  Telegram (de→a y quién). Nada se aplica sin aprobación: Velai resuelve desde el
  bloque «Solicitudes» sobre la matriz — aprobar APLICA (antelación al momento;
  botones distintos recrean la plantilla con la maquinaria del alta → nueva
  revisión de Meta; sin subcuenta el error sale limpio y la solicitud sigue
  pending) y rechazar exige nota, que el cliente ve. Aislamiento validado por
  mutación (sin el WHERE del scope: barrido Y guardián en rojo).
- **Categoría REAL de Twilio, no la intención del catálogo** (cazada de Juan: la de
  lead de gogestion es Marketing y el panel pintaba Utility). fetchApprovalStatus
  captura `whatsapp.category`; los dos polls la persisten
  (tenant_templates.categoria / tenants.lead_template_category) con backfill
  AUTOCURATIVO (con sid y categoría NULL se sondea aunque esté approved). La UI
  enseña la real («—» mientras no se lea, JAMÁS la del catálogo como hecho; en
  ámbar para Velai cuando difiere — aviso de coste; el cliente ve solo el hecho).

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

Pendiente operativo en TAREAS-PENDIENTES.md (confirmar que el CD aplicó la 0030,
crear/aprobar la plantilla y activar el addon a un tenant de prueba). Fases 3 (autoagenda pública) y 4
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

**Estado al cierre de aquella fase**: 188 tests + 53 del panel, todo verde; staging
desplegado con Hono y panel v2; producción aún sin tocar. Ese estado histórico fue
superado por el cutover en producción registrado arriba, también el 2026-09-01.

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
## Historial de conversaciones en D1 (`H1-PANEL.md` §1, 2026-08-26, migración 0021)

El cimiento del que colgaba medio plan del panel. La conversación vivía en KV con TTL de 24 h
y solo los últimos 20 mensajes: cuando un lead salía mal no había forma de mirar qué pasó.

`conversations` + `conv_messages` **sustituyen** a KV, no lo acompañan: los `conv:web:*` y
`conv:wa:*` se borraron. Repartir el estado entre un almacén caliente y otro frío obliga a
decidir cuál manda cuando discrepan — el mismo patrón que produjo el «verde en Twilio y mudo
a la vez» de GOgestión. Además el cuello del sistema estaba en KV (1.000 escrituras/día), no
en D1, así que el cambio **subió** el techo de conversaciones al día.

Decisiones que sostienen la tabla: `id` propio y no el `conversationId` del widget (lo elige
el navegador: es entrada de usuario y no puede ser clave primaria), `UNIQUE(tenant_id,
channel, external_id)` para que el upsert sea idempotente, `unanswered` contado al escribir
en vez de reprocesando transcripciones, y **sin tope de mensajes por conversación**: en
WhatsApp la dirección es el teléfono, y un tope enmudecería para siempre a un cliente real.
Lo que acota ya es suficiente — sesión de 72 h, limitador de 20/min y cupo diario de IA.

Se escribe **por turno** y con `await`, no en `waitUntil`: contar puede fallar sin daño, pero
recordar no. Sin `env.DB` el chat responde 503 (el mismo contrato que tenía KV: responder sin
memoria es peor que no responder); si el `batch` falla con la base presente, la respuesta se
devuelve igual —ya está pagada— y queda `conv_state_not_saved` en los logs. Retención de 90
días desde el último mensaje, uniforme, con `/privacidad/` actualizada el mismo día.

## Informe semanal al Telegram del cliente (`H1-PANEL.md` §2, 2026-08-26, migración 0022)

El hueco más grande del análisis competitivo: ni un solo proveedor español o latinoamericano
manda un resumen periódico automático, y los de fuera lo mandan por correo, donde una pyme no
vive. Velai ya entrega en el Telegram del cliente, así que era infraestructura de salida ya
pagada.

Cada lunes por la mañana, en la ventana de 24 h que abre a las 07:00 UTC: conversaciones,
leads, citas y preguntas sin respuesta, **con la comparación de la semana anterior** cuando la
hay. Cuando no la hay lo dice en vez de pintar un cero — el historial arrancó el 2026-08-26 y
comparar contra una semana que no existió sería un -100% falso.

Sin cron nuevo: viaja en el de 5 minutos. La idempotencia es una fila de `tenant_reports`
reservada ANTES de enviar (`status='sending'`) con tope de `attempts`, porque un cron que se
dispara dos veces no puede mandar dos informes ni reintentar un fallo permanente en cada tick.
Un cliente sin Telegram vinculado es un `skipped` **visible con su motivo**, no un silencio.
Interruptor de baja en Conexiones, encendido por defecto. Y el botón **«Enviar informe de
prueba»** (últimos 7 días, marcado como prueba, sin consumir el envío real de la semana):
sin él, la única forma de comprobar que funciona era esperar al lunes.

## Bandeja de conversaciones — responder desde el panel (2026-08-26, `H2-BANDEJA.md`, migraciones 0023/0026/0029)

Pedido de Juan el 2026-08-26: lista de conversaciones con filtros por canal, hilo a la
derecha y cajón de escritura. Es paridad, no diferenciador; lo diferenciador fue hacerla
honesta, y de eso iba casi toda la spec.

**La ventana de 24 h de Meta se dice antes de escribir, no después de fallar.** El texto
libre solo es legal dentro de la ventana que abre el último mensaje entrante; fuera,
WhatsApp responde `63016`. Dentro, el cajón enseña las horas que quedan; fuera, se
deshabilita con el motivo escrito. El canal web no tiene ventana pero sí el problema
opuesto: si el visitante cerró la pestaña la respuesta no llega, así que `visitor_seen_at`
avisa en vez de bloquear.

**Por qué número se responde** (`conversations.inbox_address`, el `To` del webhook): con
dos números por cliente, `tenants.twilio_from` puede no ser el de llegada y el cliente
final vería la respuesta desde otro número. Se rellena con `COALESCE` en cada entrante,
así que las conversaciones anteriores a la migración se reparan solas con el siguiente
mensaje; mientras esté a `NULL` el cajón se cierra diciendo por qué.

**`role='agent'` se reconstruyó con la tabla casi vacía**, que era el momento más barato:
SQLite no amplía un `CHECK` con `ALTER`. Al modelo se le presenta como `assistant` porque
la API solo conoce dos roles y el modelo TIENE que ver lo que dijo la persona: si no, al
expirar la pausa retomaría contradiciéndola. La burbuja del panel sí los distingue, con el
correo de quien respondió; sin eso la tasa de resolución mentiría.

**El sondeo se midió antes de escribirlo.** Un panel abierto 8 h refrescando cada 5 s con
dos llamadas son ~5.800 peticiones/día por panel, y con seis clientes 35.000: un tercio del
presupuesto gratuito en refrescar una pantalla. Con un solo endpoint cada 15 s y solo con la
pestaña visible son ~1.900 por panel y ~11.500 con seis, el 11%. Se marca leído solo cuando
hay algo nuevo: un `UPDATE` incondicional serían ~1.900 escrituras diarias para nada. El
scroll no salta si el lector no estaba abajo, y el tope de 40 conversaciones se dice en voz
alta, porque un tope callado se lee como «esto es todo».

**Responder por el canal web** llegó el mismo día (migración 0026, widget v9): el widget
declara `live:true` y pregunta cada 6 s solo cuando la conversación no la lleva el bot. Un
widget cacheado sin la bandera no recibe el turno y se comporta como antes, y por eso se
pudo desplegar sin tocar las webs de los clientes.

**Avisos de mensajes nuevos** (migración 0029): el sonido va con un oscilador de Web Audio,
no con `<audio>`, porque la CSP del panel no declara `media-src` y cualquier archivo
—incluido un `data:`— quedaría bloqueado; hay un test que falla si alguien mete un
`new Audio()`. Ese sondeo, al revés que el de la bandeja, NO mira `visibilityState`: el caso
a cubrir es justamente la pestaña en segundo plano, así que va cada 30 s con una sola
consulta agregada. Mira `conversations.last_inbound_at` y no `last_at`, porque con `last_at`
una respuesta del propio equipo se avisaría a sí misma. El permiso y el `AudioContext` solo
se pueden pedir dentro de un gesto, así que viven en el clic del botón, y la preferencia se
recuerda por pestaña.

**Fuera de alcance, con motivo:** enviar plantillas fuera de la ventana (comparte maquinaria
con el informe semanal por WhatsApp), Instagram (no se pinta una pestaña de un canal que no
existe: un filtro que no filtra es la clase de mentira que este panel no se permite),
asignación, etiquetas y adjuntos.

## Handoff con toma de control (2026-08-26, `H2-HANDOFF.md`, migraciones 0025/0027)

Pedido de Juan: «el chat solo se habilita cuando el usuario pida hablar con un asesor y
haya alguien conectado; si no, envía un lead y sigue la IA». Antes, `[[HUMANO]]` escribía
una pausa de 4 h y avisaba a Telegram sin que nada garantizara respuesta: si el aviso
llegaba de noche, el cliente final se quedaba mudo cuatro horas justo después de pedir
ayuda. **Si no hay nadie disponible ya no se escala:** se captura el lead y la IA sigue.

**Cuatro estados** (`conversations.state`): `bot`, `esperando`, `humano` y vuelta a `bot`.
En `esperando`, a los 5 minutos se avisa de que se sigue buscando y a los 15 la IA retoma y
pide el teléfono. Los 5 minutos eran el final en la primera versión y estaba mal: con un
asesor ocupado en otra conversación saltaba casi siempre y el visitante leía «no hay nadie
disponible» cuando sí lo había. La disponibilidad nunca fue exclusiva, así que atender
varias a la vez ya funcionaba; lo que faltaba era verlas, y por eso la bandeja pone lo que
espera primero con un contador «N esperando asesor».

**La vuelta al bot se avisa siempre.** Al principio «Devolver a Vai» no mandaba nada,
razonando que sobraba; estaba mal: el visitante venía hablando con una persona y se quedaba
esperando a alguien que ya no estaba. Ahora se avisa con el nombre del asistente de ese
cliente, el aviso queda en el hilo, y si el envío falla la conversación se devuelve igual,
porque quedarse en `humano` sin nadie es peor.

**Disponible = interruptor Y horario.** El interruptor es por usuario del panel; el horario
es del cliente y lo cierra por fuera. `support_hours` a `NULL` cae al mismo default que el
calendario: se propuso que `NULL` fuera «sin restricción» y Juan lo corrigió, porque si la
interacción humana va con horario, un `NULL` sin límite es lo contrario de lo pedido. Un
`{}` explícito sí significa «nunca se ofrece asesor», y el panel lo dice con esas palabras.
Lo edita el cliente en Conexiones con una rejilla de siete días y dos tramos: la primera
versión fue un textarea de JSON y Juan la paró, porque eso es para nosotros, no para un
cliente.

**Velai atiende SOLO lo de Velai.** Un admin de Velai podía tomar el control de la
conversación de un cliente, y la burbuja lleva el correo de quien escribe: el cliente final
de una gestoría habría visto `botnexo.ia@gmail.com` dentro de su chat. Ver sí, atender no.
El cajón se cierra antes con el motivo escrito y el endpoint devuelve **403, no 404**,
porque fingir que la conversación no existe sería mentirle al panel que la está enseñando.
La disponibilidad de un admin de Velai es siempre la del tenant `velai` y el `?tenant=` se
ignora: antes dependía del selector de la bandeja y con «Todos los clientes» dejaba el botón
mudo.

**Detalles que no se disimularon:** el cron es `*/5`, así que «5 minutos» son entre 5 y 10;
se compensa porque si la persona vuelve a escribir con el plazo vencido la IA contesta en
ese mismo mensaje, y el cron solo hace falta cuando el cliente final se queda callado. El
lead se captura sí o sí al pedir asesor, saltándose el mínimo de dos turnos, porque pedir
hablar con una persona ya es intención comercial. Quién tomó el control se guarda y se
enseña, para que dos personas no se pisen. Los dos cambios de riesgo alto, `escalateToHuman`
y la guarda de pausa del webhook, se hicieron al final y manteniendo la clave `pause:` en
paralelo.

## Cupo de IA visible, sin corte (2026-08-26, `H3-PANEL.md` §4, migración 0024)

Decisión de Juan: **visible sí, corte no**, que son dos cosas distintas y el panel las
separa. El saldo mensual de tokens (`tenants.ai_monthly_tokens`) lo ve el cliente, baja
hasta cero y no corta nada; es un contador, y la tarjeta lo dice con letra clara, porque un
saldo a cero sin explicación haría pensar en una factura. El cupo diario de llamadas
(`ai_daily_limit`) sí corta con un 429: es la guarda anti-abuso, y subió de 300 a 1.500
porque 300 llamadas son unas 37 conversaciones al día y un cliente que creciera se comía un
corte duro antes de que su saldo dijera nada. Avisa a Velai al 80%, porque el punto de
subirlo es ver venir el problema, no solo retrasarlo.

Dos decisiones que aparecieron al construirlo. **Al cliente no se le enseña el coste:** la
tarjeta en dólares es solo para Velai, porque enseñarle lo que pagamos por él es enseñarle
el margen; su tarjeta lleva tokens y porcentaje, y hay un test que falla si se cuela
cualquier rastro de coste. Y **el cupo se dimensionó con consumo real**, no a ojo: 3.148
tokens por llamada en Diálogos frente a 4.872 en GOgestión, y la diferencia no es el tráfico
sino el prompt, que en GOgestión son 12.858 caracteres viajando en cada turno.

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

## Seguimiento automático por cliente (2026-09-23)

- La ficha de cada cliente incluye interruptor, espera en minutos y mensaje propio. Todo nace apagado.
- El cron de cinco minutos solo envía por WhatsApp si el último turno es del asistente, existe un lead,
  sigue abierta la ventana de Meta y ha vencido la espera configurada.
- Nunca procesa conversaciones anteriores a la activación, números del equipo, demos, bajas, reservas
  ya creadas, conversaciones en control humano ni hilos cuyo último turno sea del cliente.
- La conversación se reclama antes de enviar y registra un único seguimiento; los fallos de proveedor
  se reintentan con un máximo de tres intentos.
- Cuando el último turno sí es del cliente, la bandeja muestra «Pendiente de responder»: es una deuda
  interna del equipo y nunca se confunde con el cierre automático hacia el cliente.
