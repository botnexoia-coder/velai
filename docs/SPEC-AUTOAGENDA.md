# SPEC-AUTOAGENDA — página de reserva pública, servicios y embeds

> **Estado:** implementado en el repositorio el 2026-09-15; pendiente de migrar y validar
> primero en staging antes de activar Diálogos que Enseñan. Escrito a partir de las capturas de
> **Confirmafy** (enlace `confirmafy.com/<negocio>/<id>`) y **Calendly** (widget inline y
> popup) que trajo Juan.
> **Origen:** es la **F3** que SPEC-CONFIRMACIONES dejó anotada en
> [`TAREAS-PENDIENTES.md`](./TAREAS-PENDIENTES.md) («autoagenda pública por enlace —
> decidir si aporta o dispersa»). Aquí se decide **que sí aporta**, y con qué forma.
>
> **Decisiones de Juan (2026-09-15)**, ya incorporadas abajo: forma de URL
> **URL `citas.hirevai.com/{cliente}/reservas`** — la forma que pidió Juan, sobre el host
> con más aislamiento de los tres candidatos (§3.1), con el aislamiento escrito como código
> y como test (§3.2) —, **marca Velai visible** (§3.3) y **cliente de prueba: Diálogos que
> Enseñan** (§11.1). Abierto solo el precio (§14).

## Ajustes de implementación aprobados (2026-09-15)

- Bloqueos atómicos en D1 para intervalos completos, incluyendo descanso; KV solo como caché. Los reintentos de Google reutilizan un identificador de evento.
- Reagendar conserva la cita original hasta asegurar la nueva.
- La vista previa permite además el origen admin exacto en `frame-ancestors`; se amplía `clienteAllowed` para las rutas nuevas sin modificar la autenticación.
- Marca Velai fija; se retira el interruptor contradictorio de §10.
- Servicios y modalidades configurables; selección secuencial con botones, saltando pasos con una sola opción.
- **Horas de inicio exclusivamente cada 30 minutos (:00 o :30)**, nunca hora libre. La duración y el descanso del servicio determinan cuánto espacio ocupa la cita.
- Gestión por chat web: un teléfono declarado no autoriza a leer ni modificar citas. Hace falta el enlace privado de confirmación o el remitente verificado de WhatsApp.
- La confirmación inicial de reserva usa una plantilla de WhatsApp propia (`confirmacion_reserva`), que debe aprobarse antes de enviar. No se reutiliza un recordatorio con otro significado.

---

## 0. La decisión de fondo (léase esto aunque no se lea el resto)

Hoy Vai agenda **conversando**: el visitante escribe, el bot consulta huecos reales y crea
la cita. Eso es nuestra diferencia y no se toca. Lo que Confirmafy y Calendly tienen y
nosotros no es **una superficie visual de reserva sin conversación**: un enlace que el
negocio pega en su bio de Instagram, en su firma, en un cartel con QR o en un botón de su
web, y que agenda sin que nadie escriba nada.

Las dos cosas no compiten: **el enlace captura al que no quiere hablar** y el chat capta al
que sí. Un cliente de gestoría no manda al lead a escribir con un bot para poner una firma;
le manda el enlace. Y el propio bot, cuando la conversación se atasca eligiendo hora,
debería poder decir «te paso el calendario» en vez de recitar doce horas en texto.

**La regla que evita que esto se convierta en tres productos:** se construye **una sola
página de reserva** y todo lo demás son colocaciones de esa misma página. Enlace, iframe
inline, popup y tarjeta dentro del chat son el mismo HTML. Un selector de horas
reimplementado en el widget, otro en el panel y otro en la página es exactamente el tipo de
duplicación que un equipo de una persona no puede mantener.

---

## 1. Qué tenemos ya (inventario, con dónde vive)

| Pieza | Dónde | Sirve para la autoagenda |
|---|---|---|
| Conexión Google Calendar por tenant (OAuth, refresh cifrado, estado) | `migrations/0012`, `worker/calendar.js`, `worker/routes/calendario.js` | ✅ tal cual |
| Ocupación real del calendario (`googleBusy`, events.list) | `worker/calendar.js:googleBusy` | ✅ hay que ampliarla a rango de mes |
| Cálculo **puro** de huecos con DST y margen de 15 min | `worker/calendar.js:freeSlots` | ✅ el corazón del selector, ya con tests |
| Horario del negocio por día de la semana | `tenant_calendars.business_hours` + `HoursGrid` del panel | ✅ falta excepciones por fecha |
| Creación de evento + fila en `appointments` con triple anti-doble-reserva | `worker/app.js:calendarExecutor` | ✅ se factoriza y se reutiliza |
| Marca por tenant (logo, colores, nombre, tema) | `GET /widget/boot` (`worker/app.js:772`) | ✅ la cabecera de la página sale de aquí |
| Dominios del cliente en D1 | `tenants.web_origins` (0008) | ✅ es la allowlist de `frame-ancestors` del iframe |
| Turnstile + rate limit + CORS exacto en endpoints públicos | `verifyTurnstile`, `rateLimited`, `publicCors` | ✅ el perímetro ya está escrito |
| Recordatorio 24 h + botones Confirmo/Cancelar por WhatsApp | SPEC-CONFIRMACIONES (0030) | ✅ se engancha: la cita del enlace también se recuerda |
| Cancelar/confirmar por texto libre | tools `cancelar_cita` / `confirmar_cita` | ✅ el token público hace lo mismo sin chat |
| Vista Calendario del panel | `panel/src/views/Calendario.tsx` | ✅ ahí va la configuración nueva |

**Lo que NO existe hoy y la autoagenda necesita:**

1. **Tipos de cita / servicios.** `tenant_calendars.slot_minutes` es **uno solo por
   negocio**. Confirmafy muestra «Atencion presencial · 30 min» porque tiene un catálogo;
   Calendly llama a eso *event type*. Sin esto no hay primera pantalla, y además hoy un
   taller no puede tener «Revisión 30 min» y «Diagnóstico 90 min».
2. **Disponibilidad de un mes entero.** `availableSlots` hace **una llamada a Google por
   día**. Pintar los puntitos de los días con hueco (lo que hacen los dos productos) serían
   30 llamadas por visita. Hace falta leer el mes en una llamada y calcular en local.
3. **Página pública** (no hay ninguna superficie pública del worker que pinte HTML salvo el
   panel, que está detrás de Access).
4. **Reserva sin conversación**: `agendar_cita` es un *tool* del modelo, no un endpoint.
5. **Email del cliente** en `appointments` (hoy solo nombre y teléfono) y **token de
   gestión** para cancelar/reagendar desde un enlace.
6. **Antelación mínima, tope de días y excepciones por fecha** configurables: hoy son
   constantes en código (15 min de margen, 60 días de tope).

---

## 2. Qué copiamos de cada uno (y qué no)

| Pieza que vimos | Confirmafy | Calendly | ¿La hacemos? |
|---|---|---|---|
| Cabecera con logo + nombre del negocio + tipo de cita | ✅ | ✅ | **Sí** — ya tenemos la marca en `/widget/boot`, sale gratis |
| Pantalla 1: elegir **servicio** de una lista con duración | ✅ | ✅ («30 Minute Meeting ▸») | **Sí** — tabla nueva `tenant_services`. Si el negocio tiene uno solo, se salta la pantalla |
| Calendario mensual con **días disponibles marcados** y el resto en gris | ✅ | ✅ | **Sí** — exige la lectura del mes en una llamada (§5) |
| Columna de horas del día elegido, con punto verde | ✅ | ✅ | **Sí** |
| Zona horaria visible / seleccionable | «\*Hora de Madrid» (fija) | Selector completo | **Intermedio**: se muestra siempre la del negocio y, **solo si el navegador está en otra**, un aviso con la equivalencia. Un selector completo es una fuente de errores para una peluquería |
| Formulario de datos tras elegir hora | ✅ | ✅ | **Sí** — nombre + teléfono obligatorios (los que ya pide `agendar_cita`), email y nota opcionales |
| **Embed inline** (iframe en la web del cliente) | — | ✅ | **Sí** — es la misma página en un `<iframe>`; una línea de snippet en el panel |
| **Popup** desde un botón de la web | — | ✅ | **Sí** — el mismo loader que ya sirve el widget de chat, modo `citas` |
| Marca «Desarrollado por Calendly» en la esquina | — | ✅ | **Sí**: «con Velai» discreto y **fijo**, no quitable por tenant (decisión de Juan, §3.3) |
| URL propia tipo `confirmafy.com/gestoriagogestion/<id>` | ✅ | ✅ (`calendly.com/<user>/<event>`) | **Sí** — forma `/{cliente}/reservas` (§3.1) |
| Cookies / banner propio | ✅ | ✅ | **No hace falta**: la página no pone cookies de terceros. Solo Turnstile |
| Pagos al reservar, round-robin de equipo, encuestas post-cita | — | ✅ (planes de pago) | **No** — fuera de alcance (§12) |

**Lo que ninguno de los dos tiene y nosotros sí podemos dar:** la cita reservada por el
enlace entra en el **mismo sitio** que la del chat (`appointments` + Google Calendar del
negocio), la recuerda el **mismo** WhatsApp de Confirmaciones, y si el cliente responde a
ese WhatsApp **hay un bot al otro lado** que reagenda hablando. Calendly te manda un correo;
nosotros contestamos. Ese es el argumento comercial de la función, y conviene escribirlo tal
cual en la landing cuando salga.

---

## 3. Arquitectura: una página, cuatro colocaciones

```
            ┌────────────────────────────────────────────────────┐
            │  citas.hirevai.com/{cliente}/reservas[?s=servicio]  │  ← UNA sola
            │  HTML autocontenido servido por el worker           │     implementación
            └────────────────────────────────────────────────────┘
                 ▲            ▲             ▲              ▲
  enlace directo │   iframe   │   popup     │   tarjeta dentro del chat
  (WhatsApp,     │  inline en │  desde un   │   (el bot dice «te paso el
   bio, QR)      │  la web    │  botón      │    calendario» y se abre aquí)
```

- **Servida por el worker**, no por Pages: necesita el slug en la ruta, leer D1 y decidir
  `frame-ancestors` por tenant. Pages es estático y no puede.
- **Forma de URL `/{cliente}/reservas`** (decisión de Juan): el slug del cliente primero y
  el sustantivo después. Se lee bien en un cartel y deja sitio a `/{cliente}/cita/<token>`
  para la gestión, sobre el host dedicado `citas.hirevai.com` (§3.1).
- **HTML autocontenido con CSP y nonce**, patrón `worker/admin-page.js`: nada de meterla en
  `panel/dist` (ese bundle está atado al hostname del panel y a Access) ni de arrastrar
  React a una página pública que tiene que cargar en 300 ms en un móvil con 3G.
- **Fetch mismo-origen** → cero problemas de CORS en el camino principal. El CORS solo
  aparece si algún día alguien llama a la API de reservas desde fuera, y ahí ya está
  `publicCors`.

Ficheros nuevos previstos:

```
worker/reserva-page.js     HTML+CSS+JS de la página (patrón admin-page.js: template string
                           + nonce; el JS como función real serializada, como admin-panel.js)
worker/routes/reserva.js   rutas públicas: página, servicios, disponibilidad, reserva,
                           gestión por token
worker/agenda.js           núcleo compartido: monthAvailability(), bookAppointment(),
                           holds. Lo usan el executor del chat Y la página — el chat pasa
                           a llamar aquí en vez de tener la lógica inline en app.js
```

### 3.1 El host: **`citas.hirevai.com`** (cerrado — subdominio propio, sin Access)

La forma de URL que quiere Juan se respeta entera: **`citas.hirevai.com/{cliente}/reservas`**.
El host es un subdominio **dedicado**, y se elige por ser la opción con más aislamiento de las
tres que había sobre la mesa:

| Candidato | Veredicto |
|---|---|
| `admin.hirevai.com/{cliente}/reservas` | **Imposible sin romper la cerradura del panel.** Ver abajo |
| `api.hirevai.com/{cliente}/reservas` | Funciona, pero comparte host con el chat y los leads: las relajaciones que la página necesita (`frame-ancestors` con dominios de clientes, HTML con nonce, Turnstile con otro hostname) caerían sobre el mismo origen que atiende `/chat` y `/lead` |
| **`citas.hirevai.com/{cliente}/reservas`** | **Elegido.** Origen propio: lo que se relaja para la página no alcanza ni al panel ni a la API; el navegador aísla cookies y storage por origen; y un fallo de configuración aquí no tiene ningún camino hacia `/api/admin/*` |

**Por qué `admin.hirevai.com` queda descartado** (la prueba, para no reabrirlo dentro de tres meses):

1. **Access corta antes que nuestro código.** Hay una aplicación self-hosted de Access sobre ese
   hostname y está verificado que **una sesión anónima recibe un 302 al login**
   ([`OPERATIONS.md`](./OPERATIONS.md) §68-71). El cliente de Diálogos que abriera el enlace desde
   WhatsApp vería la pantalla de login de Velai, no un calendario: no llega ni al worker.
2. **Nuestro propio perímetro corta igual.** En ese hostname *todo* GET pasa por `adminIdentity`
   antes de servir un byte (`worker/routes/publico.js` → `panelV2Response`), y `/api/admin/*` va
   tras `mwAdminHost → mwAdminCors → mwAdminIdentity → mwResolveScope` (`worker/app.js:4086`).
3. **Ese host ya tiene comodín**: la SPA del panel sirve `*` ahí, así que `/{cliente}/reservas`
   chocaría con el fallback de react-router.

**DESCARTADO Y NO SE REABRE** (mismo tono que el `410 legacy_chat_retired` de
[`GUIA-WORKERS.md`](./GUIA-WORKERS.md) §1): abrir un hueco público en `admin.hirevai.com` con una
política **Bypass** de Access sobre `/*/reservas` más una excepción en la cadena de middlewares.
Sonaba a atajo y es la peor decisión posible de las disponibles:

- Pondría la cerradura del panel de **todos** los clientes a depender de un patrón de path escrito
  en el **dashboard** de Access — estado que no vive en el repo, que ningún test ve y que
  `scripts/check-aislamiento.mjs` no puede cubrir. Un `*` de más y queda abierto.
- Obligaría a que el mismo host sirva `frame-ancestors` con dominios de clientes (la página) y
  `frame-ancestors 'none'` (el panel). Dos políticas opuestas, un solo host, un solo error.
- El cliente enseñaría en un cartel con QR la URL del panel de administración: quien borre
  `/reservas` aterriza en su puerta.

### 3.2 El aislamiento, como ESTRUCTURA (no como disciplina)

Añadir un hostname al mismo worker es exactamente el momento en que se cuelan los accidentes,
porque `[assets] run_worker_first` hace que **todos** los hostnames entren al worker y el binding
`ASSETS` (que es `panel/dist`) está ahí para cualquiera que sepa pedirlo. Por eso el aislamiento
se escribe como código y como test, igual que hizo la migración a Hono con el perímetro del panel:

- **`BOOKING_ORIGIN` como variable** (mismo patrón que `ADMIN_ORIGIN`), declarada en los dos
  entornos de `wrangler.toml` — `scripts/check-entornos.mjs` ya falla si una clave existe en un
  entorno y no en el otro. En staging, `citas-staging.hirevai.com`.
- **`mwBookingHost`**: todas las rutas de `worker/routes/reserva.js` van detrás de un middleware
  que exige `url.hostname === bookingHost(env)`. Fuera de ese host, **404** idéntico al de
  cualquier ruta inexistente — la misma conducta que `mwAdminHost` tiene hoy en workers.dev.
- **Fail-closed**: sin `BOOKING_ORIGIN` configurada, `bookingHost(env)` devuelve `null` y las
  rutas de reserva **no existen**. Un deploy a medias no abre nada; apaga la función.
- **El perímetro del panel no se toca ni un byte.** `ADMIN_ORIGIN`, `mwAdminHost`, `adminCorsGuard`
  y `adminIdentity` quedan exactamente como están; el host de citas **no** entra en `ADMIN_ORIGIN`
  ni en el CORS del panel. Si este spec obliga a editar algo de la cadena admin, algo se está
  haciendo mal.
- **`citas.hirevai.com` no lleva Cloudflare Access delante** — y tampoco debe añadirse «por si
  acaso»: con Access encima, la página no la vería ningún cliente final.
- **El OAuth del calendario sigue SOLO en el host admin**: `/oauth/calendar/callback` no se toca.
  Nada de la página pública puede iniciar ni recibir un flujo OAuth.

Las tres cosas que esto obliga a verificar con un test están en §12 (assets del panel
inalcanzables desde el host de citas, rutas de reserva en 404 fuera de su host, y rutas admin en
404 dentro de él).

### 3.3 Marca Velai (decidido: visible)

La página lleva marca **Velai** visible, como el «Desarrollado por Calendly» de la captura:
discreta, en la esquina inferior, con enlace a `hirevai.com` y `rel="noopener"`. **No es
quitable por tenant** — se cae la columna `branding_hidden` que tenía el borrador. Cada cita
que reserva el cliente final de Diálogos es una impresión de marca en el sector exacto al que
vendemos, y es la contrapartida natural de no cobrar la función como la cobra Calendly.
Si algún día un cliente grande pide quitarla, se decide entonces como ventaja de plan, no ahora.

---

## 4. Modelo de datos (migraciones aditivas, sin PRAGMA — GUIA-WORKERS §2)

### `0034_servicios.sql`

```sql
-- Catálogo de tipos de cita por negocio (la primera pantalla del enlace, y el
-- «¿presencial o videollamada?» del chat). Sin filas, el negocio sigue funcionando
-- exactamente como hoy: una cita genérica de tenant_calendars.slot_minutes.
CREATE TABLE tenant_services (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  slug TEXT NOT NULL,                 -- 'presencial' → /dialogos/reservas?s=presencial
  name TEXT NOT NULL,                 -- 'Atención presencial'
  description TEXT,
  minutes INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'presencial' CHECK (mode IN ('presencial','video','telefono')),
  location TEXT,                      -- dirección o 'te llamamos'; sale en la confirmación
  buffer_min INTEGER NOT NULL DEFAULT 0,   -- descanso después de la cita
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, slug)
);
ALTER TABLE appointments ADD COLUMN service_id TEXT;   -- NULL = cita genérica (las de hoy)
```

### `0035_autoagenda.sql`

```sql
-- Interruptor de la página pública + reglas que hoy son constantes en código.
ALTER TABLE tenant_calendars ADD COLUMN booking_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_calendars ADD COLUMN min_notice_min INTEGER NOT NULL DEFAULT 120;  -- antelación mínima
ALTER TABLE tenant_calendars ADD COLUMN max_days_ahead INTEGER NOT NULL DEFAULT 60;
ALTER TABLE tenant_calendars ADD COLUMN booking_note TEXT;        -- texto bajo la cabecera
-- Sin columna de marca: la marca Velai es fija (§3.3). Una columna que nadie puede
-- cambiar es una columna que alguien acabará cambiando por error.

-- Excepciones por fecha: festivos, vacaciones y días con horario especial. Sin esto
-- el negocio tiene que bloquear a mano su Google Calendar cada puente.
CREATE TABLE calendar_exceptions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  date TEXT NOT NULL,                 -- YYYY-MM-DD local del negocio
  windows TEXT,                       -- JSON [["10:00","13:00"]]; NULL = cerrado todo el día
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, date)
);

-- Datos que la reserva por enlace aporta y el chat no tenía.
ALTER TABLE appointments ADD COLUMN customer_email TEXT;
ALTER TABLE appointments ADD COLUMN notes TEXT;
ALTER TABLE appointments ADD COLUMN manage_token TEXT;   -- HMAC público para cancelar/reagendar
ALTER TABLE appointments ADD COLUMN rescheduled_from TEXT;  -- id de la cita anterior
```

`appointments.channel` ya existe: las reservas de la página entran como `'web_reserva'`
(el CHECK actual no restringe el canal, así que no hay migración destructiva). Así el panel
distingue de un vistazo lo que agendó el bot de lo que agendó el propio cliente.

---

## 5. Disponibilidad del mes en UNA llamada (la pieza técnica que importa)

Es el punto donde esto se rompe si se hace ingenuamente. La página pinta un mes con los días
disponibles marcados; `availableSlots` actual es **por día**.

```js
// worker/agenda.js
// UNA lectura de events.list para todo el rango visible (con paginación por
// nextPageToken: 100 eventos no cubren un mes de una clínica llena), y luego
// freeSlots() — que ya es PURA y está cubierta por tests — día por día en local.
export async function monthAvailability(env, cal, { from, to, service })
```

- **Caché en KV `calfree:<tenant>:<servicio>:<YYYY-MM>` con TTL 90 s.** La página es pública:
  sin caché, cada visitante que navega entre meses golpea la API de Google. Con 90 s el hueco
  que ve el visitante sigue siendo fresco y la triple barrera anti-doble-reserva sigue debajo.
- **Invalidación al reservar**: `bookAppointment` borra la clave del mes afectado. Un hueco
  recién ocupado desaparece al instante para el siguiente visitante.
- **El cálculo se mantiene puro**: `freeSlots` recibe ahora `bufferMin` y `minNoticeMin` y las
  excepciones por fecha entran como sustitución de las ventanas del día. Todo testeable sin red,
  como ya lo está el DST.
- **Nada de títulos de eventos**: se sigue leyendo solo `start/end/status/transparency`. Un
  visitante anónimo no puede deducir con quién se ve el negocio (hoy ya es así, y con una
  página pública importa el doble).

---

## 6. API pública (perímetro de seguridad idéntico al de `/chat` y `/lead`)

Todas en `citas.hirevai.com` y **solo ahí**: detrás de `mwBookingHost`, que devuelve 404 en
cualquier otro hostname (§3.2).

| Ruta | Qué hace | Guardas |
|---|---|---|
| `GET /{cliente}/reservas` | La página. 404 si el tenant no existe, no tiene calendario conectado o `booking_enabled = 0` | `noindex`, CSP con nonce, `frame-ancestors` desde `tenants.web_origins` |
| `GET /{cliente}/cita/<token>` | Página «tu cita»: ver, **cancelar** o **reagendar** | token HMAC, sin enumerar; rate limit |
| `GET /api/reservas/{cliente}` | Marca + servicios activos + zona horaria + reglas | Cache 300 s, sin PII |
| `GET /api/reservas/{cliente}/huecos?mes=YYYY-MM&s=<servicio>` | Días con hueco y horas por día | `rateLimited(ip,'resfree',60)`, caché KV 90 s |
| `POST /api/reservas/{cliente}/hold` | **Reserva blanda de 5 min** al elegir hora, antes de pedir datos | Turnstile `action:'reserva'`, `rateLimited(ip,'reshold',10)` |
| `POST /api/reservas/{cliente}` | Crea la cita | Turnstile, `rateLimited(ip,'reserva',5)`, `readJson(request, 4000)`, todo por `clean()` |
| `POST /api/cita/<token>/(cancelar\|reagendar)` | Ejecuta | mismo token + rate limit |

Detalles que no se pueden olvidar:

- **Turnstile**: la página ejecuta el challenge ella misma (como ya hace el widget fuera de
  hirevai.com). `verifyTurnstile` cruza el `hostname` del token contra `allowedOrigins`, así que
  **el host de la página tiene que estar en `ALLOWED_WEB_ORIGINS`** y en los hostnames del widget
  de Turnstile (el botón «Sincronizar Turnstile» del panel los reescribe desde D1 —
  `worker/cloudflare.js`). Si esto se olvida, el POST responde `403 human_verification_failed`
  y el síntoma parece un fallo de la reserva.
- **Hold de 5 minutos**: una fila sin PII en `booking_claims`, con solapamiento comprobado
  mediante una escritura condicional y atómica de D1. Cubre toda la duración y el descanso;
  una hora ocupada por un servicio bloquea también a los demás servicios.
- **Triple barrera anti-doble-reserva**: relectura del hueco justo antes de crear + claim
  atómico en D1 + `UNIQUE(request_id)`. El evento de Google lleva además un id determinista,
  de forma que reintentar una respuesta de red perdida no crea otro evento. La reserva pública usa
  `request_id = 'res:<tenant>:<startIso>:<hash del teléfono>'`.
- **El slug no se enumera**: `booking_enabled = 0` responde el mismo 404 que un slug
  inexistente.
- **Tope por teléfono**: máximo 3 citas futuras activas por teléfono y tenant. Sin esto, una
  página pública es un formulario abierto para llenarle la agenda a un cliente.

---

## 7. La página: pantallas y comportamiento

1. **Cabecera** — logo, nombre del negocio, `booking_note`. Sale de la misma marca del widget.
2. **Servicio** — lista con nombre, duración y modo (icono presencial/vídeo/teléfono). Se
   **salta** si solo hay uno o si llega `?s=<slug>`.
3. **Día y hora** — rejilla mensual con los días disponibles marcados y la columna de horas a
   la derecha (exactamente la forma de las dos capturas: es una convención que el usuario ya
   sabe leer, no hay nada que inventar). Zona horaria del negocio visible; aviso si el
   navegador está en otra.
4. **Datos** — nombre y teléfono (obligatorios, mismo contrato que `agendar_cita`), email y
   nota (opcionales), casilla de privacidad enlazando a `/privacidad/`.
5. **Confirmación** — día, hora, duración, lugar, y botones **«Añadir a mi calendario»**
   (.ics generado por el worker, sin dependencias) y «Gestionar mi cita» (el enlace
   `/{cliente}/cita/<token>`,
   que además se manda por WhatsApp si el tenant tiene Confirmaciones activo).

Requisitos no negociables: **móvil primero** (la mayoría de los enlaces se abren desde
WhatsApp), ES/EN por `navigator.language` como el widget, sin fuentes externas bloqueantes,
funcional sin JS moderno (nada de optional chaining sin transpilar: el widget ya se escribe
así por algo), y `prefers-color-scheme` respetado usando los colores de marca del tenant.

---

## 8. Embeds y enganche con el chat

**Embed inline** (lo de la captura 2 y 3 de Calendly) — una línea en la web del cliente:

```html
<div data-vai-citas="gogestion" data-servicio="presencial" style="height:640px"></div>
<script src="https://hirevai.com/assets/vai-citas.js" defer></script>
```

El loader crea un `<iframe>` a `citas.hirevai.com/{cliente}/reservas?embed=1` y ajusta la altura por
`postMessage` (origen verificado en los dos sentidos). **Popup**: el mismo loader sobre
`<button data-vai-citas-popup="gogestion">`. Es deliberadamente el mismo patrón de
`assets/vai.js`, que Johan ya sabe instalar ([`PARA-JOHAN-widget-en-webs-cliente.md`](./PARA-JOHAN-widget-en-webs-cliente.md)).

**Dentro del chat** — dos cambios pequeños:

- Tool nueva `enviar_enlace_reserva` (en `CALENDAR_TOOLS`, solo si `booking_enabled`): devuelve
  la URL con el servicio ya elegido. Guardrail: «si el cliente prefiere ver el calendario, o
  lleváis **dos intentos** sin cuadrar una hora, pásale el enlace en vez de seguir listando horas».
- El widget aprende a pintar **una tarjeta** con ese enlace. Hoy `addMsg` escapa todo el texto y
  **no hay enlaces clicables** (`site/assets/vai-widget.js:628`), así que una URL en la respuesta
  del bot llega como texto muerto — hay que arreglarlo igual. Se hace con un **marcador
  estructurado** que emite el worker (no linkify libre sobre lo que escriba el modelo): el widget
  reconoce solo ese marcador y pinta la tarjeta; cualquier otra cosa sigue escapándose.
  **Sube la versión del widget** (`?v=18` en el archivo y en los HTML; `npm run check:site` lo exige).

**El chat sigue agendando conversando.** El enlace es una salida, no un reemplazo: si Vai empieza
a mandar el enlace por defecto, perdemos la única cosa que nos distingue de Calendly.

---

## 9. Gestión de la cita por el cliente final (cierra el bucle con Confirmaciones)

`manage_token = HMAC-SHA256(APP_SECRET, appointment_id)` truncado a 32 hex, guardado en la fila
(así el enlace se puede reimprimir y revocar borrando la columna). La página
`/{cliente}/cita/<token>`:

- **Cancelar** → reutiliza `markAppointmentCancelled` + `deleteGoogleEvent` (ya escritos para
  SPEC-CONFIRMACIONES, `cancelled_by = 'customer'`).
- **Reagendar** → lo que hoy **no existe por ningún camino**: cancela y abre el selector con el
  mismo servicio, enlazando por `rescheduled_from`. El botón «Cancelar» del recordatorio de
  WhatsApp pasa a ofrecer este enlace en vez de solo cancelar.
- Sin token válido, 404. El token **no** lleva el id en claro.

---

## 10. Panel (`panel/src/views/Calendario.tsx`)

Tab nueva **«Reservas online»** junto a la card de Confirmaciones, para **ambos roles** (el
cliente gestiona lo suyo; Velai, el del tenant seleccionado):

- Interruptor **Activar página de reservas** + enlace con botón «Copiar» y QR descargable
  (el QR es lo que acaba en el mostrador y en el escaparate).
- **Servicios**: alta/edición/orden/activo (nombre, duración, modo, lugar, buffer).
- **Reglas**: antelación mínima, días de antelación máxima y nota de cabecera. La marca
  Velai es fija y no tiene interruptor (§3.3).
- **Excepciones**: festivos y vacaciones sobre el mismo `HoursGrid` que ya existe.
- **Snippets**: el `<div>` del embed y el del popup, listos para copiar.
- Vista previa en iframe de la propia página (es la única forma honesta de ver cómo queda —
  [memoria: renderizar el panel en vez de razonarlo]).

Endpoints admin nuevos en `worker/routes/calendario.js`, con el mismo `assertOwnTenant` y
`scopeClause` de todo lo demás: `GET/POST/PATCH/DELETE /api/admin/tenants/:id/services` y
`PATCH …/booking`.

---

## 11. Fases (cada una entregable y verificable por sí sola)

| Fase | Contenido | Por qué en este orden |
|---|---|---|
| **A. Núcleo ✅** | `worker/agenda.js`: `monthAvailability` + `bookAppointment` extraídos de `calendarExecutor`, con caché KV, buffer, antelación mínima y excepciones. El chat pasa a usarlos. Migraciones 0034/0035. | Todo lo demás cuelga de aquí y **se verifica solo con tests puros**, sin UI ni red (memoria: guardianes antes que frameworks) |
| **B. Servicios en el panel ✅** | CRUD de `tenant_services` + reglas, y el bot usando la duración del servicio | Sin catálogo no hay pantalla 1; y ya mejora el chat aunque la página no exista |
| **C. Página pública ✅ (activación pendiente)** | Alta del host (`citas.hirevai.com` en `routes`, `BOOKING_ORIGIN` en los dos entornos, hostname en `ALLOWED_WEB_ORIGINS` y en el widget de Turnstile) + `mwBookingHost` con sus tres tests de aislamiento **antes** de escribir la primera línea de HTML; luego `/{cliente}/reservas` completa + .ics + `/{cliente}/cita/<token>` | Es el entregable que el cliente enseña. El orden importa: el aislamiento del host se prueba con rutas vacías, cuando aún no hay nada que perder |
| **D. Embeds ✅** | `assets/vai-citas.js` (inline + popup), widget `v18` con tarjeta, tool `enviar_enlace_reserva` | Depende de que C exista y esté estable |

### 11.1 Cliente de prueba: **Diálogos que Enseñan** (decidido)

`dialogosqueensenan.com`, tenant `dialogos`, bot **Alma**. Es la elección correcta y además
ya tenemos medio camino hecho con ellos:

- **Es el tenant con el que se verificó el calendario e2e** el 2026-08-20: la primera cita real
  agendada por chat fue en su Google Calendar ([`IMPLEMENTADO.md`](./IMPLEMENTADO.md) §Calendario
  fase 1). La conexión OAuth ya existe, así que la fase A se prueba contra huecos de verdad.
- Su dominio ya está en `ALLOWED_WEB_ORIGINS` y su widget va con la marca de Alma desde el v8,
  así que el **embed en su web** se prueba sin tocar orígenes ni Turnstile.
- Antes de enseñarles nada hace falta: **al menos un servicio** en `tenant_services` con la
  duración real de sus sesiones, y decidir si su recordatorio de WhatsApp sale con el enlace de
  gestión (depende de que su plantilla de Confirmaciones esté aprobada — hoy sigue pendiente).
- **Orden sugerido con ellos**: enlace a secas primero (lo comparten por WhatsApp y en su bio),
  y el embed en su web solo cuando el enlace lleve una semana sin sustos.

**Antes de la fase C**: la nota de `TAREAS-PENDIENTES` sobre la pantalla de **«app no
verificada»** de Google sigue vigente. Un enlace público de reserva no la muestra (el OAuth lo
hace el negocio, no el visitante), pero el alta de cada cliente sí, y con más volumen de altas
empieza a apretar el tope de 100 usuarios.

---

## 12. Tests y guardianes nuevos (`test/`, `node --test`, sin dependencias)

- `monthAvailability` puro: mes con festivos, buffer, antelación mínima, cambio de hora de
  octubre, y **un día con el horario partido** (mañana y tarde).
- Tope de 3 citas futuras por teléfono; hold que caduca; hold que bloquea una segunda reserva.
- `manage_token`: token válido, token de otra cita, token manipulado un byte → 404.
- Aislamiento (`test/aislamiento.test.js`): un slug **no** puede leer huecos, servicios ni citas
  de otro tenant; `booking_enabled = 0` responde 404 idéntico al de slug inexistente.
- **Aislamiento de HOST** (los tres que hacen que el subdominio nuevo no sea una puerta trasera,
  §3.2), en `test/worker.test.js` junto a los del perímetro admin:
  1. `GET citas.hirevai.com/index.html` y `/assets/index-*.js` → **404**: el binding `ASSETS`
     (`panel/dist`) no es alcanzable desde el host de citas pese a `run_worker_first`.
  2. `GET citas.hirevai.com/api/admin/leads` → **404**, no 401: `mwAdminHost` ya lo garantiza,
     pero el test lo deja clavado para cuando alguien mueva rutas.
  3. `GET admin.hirevai.com/dialogos/reservas` → lo que respondía antes (la SPA tras Access),
     **nunca** la página de reservas; y con `BOOKING_ORIGIN` vacía, las rutas de reserva
     responden 404 en todas partes (fail-closed).
- CSP de la página: `frame-ancestors` contiene exactamente los `web_origins` del tenant y nada más.
- `scripts/check-site.mjs`: la versión del widget y la del snippet de citas coinciden en todos los HTML.
- e2e (`panel/e2e/`): reservar de punta a punta contra un Google mockeado, y cancelar por token.

---

## 13. Lo que NO hacemos (y conviene que quede escrito)

Pagos al reservar · varios profesionales / round-robin / reparto por carga · generación
automática de enlaces de Meet o Zoom (la columna `mode='video'` guarda un enlace fijo del
negocio; crear salas es otra spec) · Microsoft 365 (sigue en fase 2 desde 2026-08-20) ·
sincronización de dos calendarios por negocio · encuestas post-cita · listas de espera ·
recordatorios por email (el canal es WhatsApp, que es donde está nuestro valor).

---

## 14. Estado de las decisiones

**Cerradas (Juan, 2026-09-15):**

- **URL**: `citas.hirevai.com/{cliente}/reservas` — la forma pedida, sobre subdominio propio sin
  Access, que es la opción con más aislamiento (§3.1). Descartado `admin.hirevai.com` con prueba,
  y descartado **expresamente** el atajo del Bypass de Access: no se reabre.
- **Aislamiento como estructura** (§3.2): `BOOKING_ORIGIN` fail-closed, `mwBookingHost`, el
  perímetro del panel intacto y tres tests que lo vigilan.
- **Marca Velai visible y fija** en la página (§3.3).
- **Cliente de prueba: Diálogos que Enseñan** (§11.1).

**Abierta (una, y no bloquea nada técnico):**

1. **Precio**: ¿la autoagenda entra en el plan Profesional, va con Confirmaciones como un mismo
   addon «Citas», o se cobra aparte? Calendly cobra 10–16 $/usuario/mes por justo esto, y
   nosotros lo damos con recordatorio por WhatsApp y bot que reagenda encima.
