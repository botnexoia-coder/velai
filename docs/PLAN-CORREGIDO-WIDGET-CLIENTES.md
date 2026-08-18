# Plan corregido — widget de cliente: marca propia + desbloqueo de Turnstile

> **Estado (2026-08-18): CÓDIGO COMPLETO — pendiente de desplegar y de lo manual.**
> Decisiones de Juan: marca en el panel desde D1 (no inline) y el widget SUSTITUYE al
> chat propio de Zoe. Hecho en el repo: A1+A2 (widget autosuficiente: Turnstile propio si
> no hay `VELAI_HUMAN`, sitekey por defecto), B1 (`migrations/0007_tenant_brand.sql`, 11
> columnas), B2 (`GET /widget/boot` público con CORS, caché = la fila de `tenantBySlug`,
> misma invalidación), B3 (el widget pinta logo/nombre/saludo/chips/colores/tema/WhatsApp
> del tenant, ES/EN por `<html lang>`, variables CSS por CSSOM), B4 (sección «Marca del
> widget» en la ficha con previsualización y errores por campo), C1 (MD de Sebas v2) y el
> fix de paginación (`limit` sin parámetro era 1, no 50). Suite **59/59**.
> **Matiz**: se saltó `?v=6` — A y B salen en UN deploy, las 26 páginas van directas a
> `?v=7` (S1 de Sebas también prueba con v7).
> **Falta**: aplicar la migración 0007 en remoto ANTES del deploy del worker, desplegar
> worker + Pages, T1–T6 (manual, abajo) y la parte de Sebas (S1–S4).

> Corrige el diagnóstico anterior con tu criterio: **`funnel.js` no va en las webs de los clientes**
> (es nuestro funnel de medición: cookies, GA4, Ads, pixel) y **cada chat debe llevar su logo, su
> nombre y su saludo**, no solo su contexto. Verificado contra código real: repo `velai` en clon
> limpio + los repos de los clientes `CronoSeb/gogestion-demo` y `botnexoia-coder/Zoe`.

---

## 0. Reparto y orden — quién hace qué y cuándo

**Regla de dependencia:** Sebas no toca ninguna web hasta que **PR A** esté desplegado, y no quita
ningún chat viejo hasta que **PR B** esté en producción. Si se salta el orden, o el chat no funciona
(A) o el cliente ve la marca de Velai en su propia web (B).

### 🟦 Nosotros — código (CLI, repo `velai`)

| # | Tarea | Depende de | Entrega |
|---|---|---|---|
| A1 | `vai-widget.js`: chequeo humano autosuficiente (carga Turnstile solo si no hay `VELAI_HUMAN`) + sitekey por defecto dentro del widget | — | `assets/vai-widget.js?v=6` desplegado en Pages y **verificado activo** |
| A2 | Bump `?v=5` → `?v=6` en las 26 páginas + 3 tests de regresión | A1 | `npm run check` verde |
| B1 | `migrations/0007_tenant_brand.sql` (10 columnas de marca) aplicada **en remoto antes** del deploy del worker | — | Esquema al día |
| B2 | `GET /widget/boot?tenant=<slug>`: marca en JSON, CORS por `ALLOWED_WEB_ORIGINS`, caché KV 5 min | B1 | Endpoint público de solo lectura |
| B3 | Widget pinta logo, nombre, saludo, chips, placeholder, colores y WhatsApp del tenant; `aria-label` con el nombre del bot; ES/EN | B2 | `?v=7` |
| B4 | Panel: pestaña *Marca* en la ficha del tenant, con previsualización y validaciones | B1 | Editable sin deploy |
| C1 | Reescribir `docs/PARA-JOHAN-widget-en-webs-cliente.md` (v2) con `?v=` correcto y criterios de verificación reales | A2, B3 | MD que Sebas pueda seguir sin adivinar |
| — | Arreglar de paso el defecto de paginación de leads (`app.js:1222`) | — | Ya estaba en el pendiente §7.1 |

### 🟨 Tú — manual (dashboards y datos)

| # | Tarea | Cuándo | Por qué |
|---|---|---|---|
| T1 | Turnstile → widget de la sitekey `0x4AAAAAAESkAwvlDVJD9Z1l`: comprobar los **8 hostnames** (apex + `www` de los 4 dominios) | **antes de A2**, o la prueba de Sebas vuelve a fallar | `verifyTurnstile` cruza el hostname contra `ALLOWED_WEB_ORIGINS`: tiene que estar en las dos listas |
| T2 | Recopilar la marca de cada cliente: logo (URL o archivo), 2 colores, nombre del bot, saludo y WhatsApp | antes de B4 | Sin esos datos, B2/B3 no tienen nada que servir |
| T3 | Decidir el nombre del asistente de **Diálogos** (su prompt no le da ninguno) | antes de B4 | Su cabecera necesita un nombre |
| T4 | Conseguir acceso a los repos de **HireDataVision** y **Diálogos** (404 hoy) o su marca por otra vía | antes de B4 | Es donde vive su identidad visual |
| T5 | Cloudflare Zero Trust → política del panel a *Everyone + One-time PIN* | pendiente de antes, sigue abierto | Bloquea el alta del primer usuario de cliente |
| T6 | Topes de gasto en las 4 subcuentas de Twilio | pendiente de antes | Riesgo abierto |

### 🟩 Sebas — webs de los clientes

| # | Tarea | No empieza hasta |
|---|---|---|
| S0 | **Nada. Su trabajo en Zoe está bien hecho** — el snippet de dos líneas era el correcto | — |
| S1 | Cambiar `?v=5` por `?v=6` en `zoetravelspain.com/prueba-vai/` y volver a probar | **A2 desplegado** + T1 verificado |
| S2 | Pegar el snippet (2 líneas, `?v=7`) en **todas** las páginas de las 4 webs | **B3 desplegado** |
| S3 | Quitar el chat viejo de `gogestion.es` y `hiredatavision.com` | **B3 verificado en esa web**: la cabecera muestra el logo y el nombre del cliente |
| S4 | Confirmar que un lead de prueba aparece en `admin.hirevai.com` con el cliente correcto | S2 |

> **Lo que Sebas no puede arreglar nunca:** `origin_not_allowed`, `human_verification_failed` e
> `invalid_tenant`. Son configuración nuestra; que nos mande el dominio exacto y el error de consola.

### Camino crítico

```
A1 → A2 ──┬──────────────► S1 (prueba en Zoe, ya funciona el chat)
   T1 ────┘
B1 → B2 → B3 ──┬────────► S2 (snippet en las 4 webs)
   T2/T3/T4 ───┘   └─ B4 (panel) ──► marca editable sin deploy
                        S2 → S3 (quitar chats viejos) → apagar workers viejos
C1 acompaña a S2: el MD corregido se le pasa a la vez que el ?v=7
```

---

## 1. Lo que descarto de mi propuesta anterior

Proponía añadir `funnel.js` al snippet del cliente. **Mal.** Ese archivo inyecta el banner de cookies
de Velai con `href="/privacidad/"` relativo, Consent Mode v2, GA4, Google Ads y el pixel de Meta.
Nada de eso pinta en la web de un cliente, y el MD original tenía razón en no incluirlo.

**El error real es del widget, no del snippet:** `vai-widget.js` delega el token de Turnstile en
`window.VELAI_HUMAN`, que solo existe si `funnel.js` está cargado (línea 488). Es decir, el widget
**solo funciona dentro de hirevai.com** — una dependencia que nadie declaró y que hace inviable el
uso para el que se construyó.

**Consecuencia buena:** el snippet de dos líneas del MD queda **exactamente como está**. Sebas no
tiene nada que rehacer; cuando salga `?v=6` solo cambia el número de versión.

---

## 2. La marca por cliente es una regresión, no una mejora pendiente

Tienes razón y es más grave que un «falta personalizar»: **los chats viejos ya estaban
marcados, y el unificado los degradaría.** Prueba de sus propios repos:

### GOgestión (`CronoSeb/gogestion-demo/widget.js`)

| Elemento | Valor |
|---|---|
| Cabecera | `Faby · GOgestión` + *«En línea · te orientamos al instante»* |
| Colores | granate `#A6153A`, hover `#8A1230`, crema `#FDF8F0` |
| Saludo | *«¡Hola! 👋 Soy Faby, la asistente de GOgestión, gestoría de extranjería en Sevilla. ¿En qué trámite o situación te puedo orientar? (arraigo, nacionalidad, reagrupación, estudios, canje de carnet…)»* |
| WhatsApp | `wa.me/34634167405`, con CTA propio *«¿Quieres que Faby te oriente primero?»* |
| Placeholder | *«Escribe tu consulta…»* |

### Zoe Travel (`botnexoia-coder/Zoe/public/index.html`)

| Elemento | Valor |
|---|---|
| Cabecera | `<img src="/img/zoe-logo.png">` + `Zoe · Asistente` + *«En línea»* — **logo de imagen, no emoji** |
| Colores | degradado azul `#1a4fd0` → naranja `#f57a1f`, con **tema claro y oscuro** por variables CSS |
| Saludo | ES *«¡Hola! Soy Zoe 🐱 ¿A dónde sueñas viajar?»* · **EN** *«Hi! I'm Zoe 🐱 Where do you dream of travelling?»* |
| Idioma | **bilingüe ES/EN** con `data-i18n` (`chat_hi`, `chat_ph`, `chat_online`, `chat_agency`) |
| WhatsApp | `wa.me/34644280183` |
| Placeholder | *«Escribe tu mensaje...»* / *«Type your message...»* |

**Lo que se ve hoy en `zoetravelspain.com` (chat propio):** logo de Zoe, azul/naranja, bilingüe.
**Lo que pondría `vai-widget.js?v=5`:** avatar 🤖, `Vai · Velai`, naranja `#FF6B1A`, solo español.

Sustituir uno por otro tal cual es un **paso atrás visible para el cliente**. En `/prueba-vai/` no se
nota porque es una página aislada, sin el chat propio al lado.

### Todo lo que hoy está fijo en `assets/vai-widget.js`

| Línea | Qué | Valor fijo |
|---|---|---|
| 141 | avatar | `🤖` |
| 142 | nombre | `Vai · Velai` |
| 143 | estado | `En línea ahora` |
| 152 | placeholder | `Escribe un mensaje...` |
| 163-164 | saludo + 3 chips | textos comerciales de Velai (*«¿Cuánto cuesta?»*, *«Enséñame una demo»*) |
| 44 | color de marca | `ORANGE = '#FF6B1A'` |
| 131 / 138 / 369 | `aria-label` | `Abrir chat con Vai`, `Chat con Vai`, `Cerrar chat con Vai` |
| 345 | globo teaser | *«¿Dudas? Pregúntame lo que quieras — respondo al momento.»* |
| 466-467 | mensajes de error | `wa.me/15706160059` (número de Velai) |

`window.VELAI_TENANT` solo viaja en el payload de `/chat` (línea 483): **cambia lo que dice el
modelo, nada de lo que se ve.**

---

## 3. Lo que hay que hacer

### PR A — Widget autosuficiente (desbloquea las 4 webs) · 🔴 primero

`assets/vai-widget.js`:

1. Si `window.VELAI_HUMAN` **no** existe, el widget carga
   `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` y ejecuta el challenge él
   mismo (`execution:'execute'`, action `chat`, `error-callback`/`expired-callback` como en
   `funnel.js:105-140`). Si `VELAI_HUMAN` existe (hirevai.com), se usa igual que ahora: cero cambios
   en nuestras 26 páginas y un solo widget de Turnstile por página.
2. **Sitekey por defecto dentro del widget**: `0x4AAAAAAESkAwvlDVJD9Z1l` es pública (ya está en el
   HTML de `hirevai.com`), así que la web del cliente **no necesita declarar nada**. Overridable con
   `window.VELAI_TURNSTILE_SITEKEY` por si algún día hay una sitekey por cliente.
3. `window.VELAI_getUTM` es de `funnel.js`: el widget ya lo llama con guarda (`&&`), pero conviene
   dejar explícito que sin funnel el `utm` va vacío — correcto en web de cliente.
4. Subir a **`?v=6`** en las 26 páginas de `hirevai.com` y **esperar a que el deployment de Pages
   esté activo antes de pedir la URL** (regla del CDN que ya nos quemó `funnel.js?v=6`).
5. Tests: (a) el widget obtiene token sin `VELAI_HUMAN` presente; (b) con `VELAI_HUMAN` presente no
   inserta un segundo widget de Turnstile; (c) no queda ninguna referencia a `funnel.js` como
   requisito.

### PR B — Marca por cliente, servida desde D1 · 🔴 sin esto no se sustituye ningún chat

**Datos (`migrations/0007_tenant_brand.sql`)**, en la tabla `tenants`:

| Columna | Ejemplo (`zoe`) |
|---|---|
| `bot_name` | `Zoe` |
| `brand_name` | `Zoe Travel Spain` → cabecera `Zoe · Zoe Travel Spain` |
| `logo_url` | `https://zoetravelspain.com/img/zoe-logo.png` (https obligatorio; fallback a inicial o emoji) |
| `brand_color` / `brand_color_2` | `#1a4fd0` / `#f57a1f` |
| `greeting` | `¡Hola! Soy Zoe 🐱 ¿A dónde sueñas viajar?` |
| `greeting_en` | `Hi! I'm Zoe 🐱 Where do you dream of travelling?` |
| `chips_json` | `["Vuelos a Colombia","Paquetes con hotel","Quiero viajar en diciembre"]` |
| `placeholder` | `Escribe tu mensaje...` |
| `wa_number` | `34644280183` |
| `theme` | `auto` \| `light` \| `dark` |

**Entrega (`GET /widget/boot?tenant=<slug>`)** en el worker: devuelve ese bloque en JSON, CORS con
`ALLOWED_WEB_ORIGINS` (mismo helper que `/chat`), caché KV 5 min con la misma invalidación que
`tenant:addr:*`, y cabecera `Cache-Control` corta. **Nunca** devuelve nada sensible: es un endpoint
público de solo lectura de marca. Fallback a los valores de Velai si el tenant no trae marca, para
que `hirevai.com` siga idéntico.

**Widget:** pinta cabecera, avatar (`<img>` si hay `logo_url`, si no inicial sobre `brand_color`),
saludo, chips, placeholder, color de burbuja/degradado y enlaces de WhatsApp desde esa respuesta.
El `<img>` obliga a revisar la CSP del sitio del cliente solo si la tienen (`img-src`).
Los `aria-label` pasan a `Abrir chat con ${bot_name}`. Colores por **variables CSS** aplicadas por
CSSOM (misma lección del panel: un nonce en `style-src` no cubre `style=""`).

**Idioma:** `lang = navigator.language` o `document.documentElement.lang` → `es` \| `en`, con
`greeting_en` y las cadenas de UI traducidas. Zoe ya es bilingüe; si el unificado solo habla español
pierde a la mitad de su público.

**Panel:** pestaña *Marca* en la ficha del tenant con esos campos, previsualización del chat y
validación (`logo_url` https, colores `#rrggbb`, `chips_json` ≤ 3, longitudes). Que el saludo lo
cambie tú desde el panel, **no Sebas en el HTML** — si la marca vive en la web del cliente, cada
ajuste de copy es un ticket para él.

**Cero rastro de Velai** en el widget de un cliente: nombre, avatar, colores, teaser, `aria-label`,
mensajes de error y número de WhatsApp salen del tenant. Lo único compartido es el origen del
`<script>` (`hirevai.com/assets/…`), invisible para el visitante.

### PR C — Corregir el MD de Sebas

- El snippet sigue siendo de dos líneas, con `?v=6`.
- Quitar el criterio de verificación *«si te responde hablando de Velai, el slug está mal»*: con la
  marca por tenant el criterio pasa a ser *«la cabecera debe mostrar el logo y el nombre del
  cliente; si ves `Vai · Velai`, el slug está mal o falta la primera línea»*.
- Añadir la tabla de errores de consola actualizada (`human_verification_failed` → hostname;
  `origin_not_allowed` → allowlist; `invalid_tenant` → slug).
- Y el aviso de no quitar el chat viejo hasta que el nuevo tenga la marca puesta (PR B).

### Manual (tú)

- Verificar en el dashboard de Turnstile (sitekey `0x4AAAAAAESkAwvlDVJD9Z1l`) los **8 hostnames**:
  apex y `www` de los 4 dominios. `ALLOWED_WEB_ORIGINS` ya los tiene (`wrangler.toml:25`), y
  `verifyTurnstile` (`worker/app.js:113-119`) cruza el hostname que devuelve Cloudflare **contra esa
  misma variable**: tiene que estar en las dos listas.
- Confirmar el WhatsApp de contacto de cada cliente para `wa_number` (hoy los errores dan el de
  Velai). Enlaza con el `team_whatsapp` pendiente.
- Pedir a cada cliente su logo en PNG/SVG con fondo transparente, o la URL del que ya tienen en su
  web (Zoe: `/img/zoe-logo.png`; el resto, por confirmar).

---

## 4. Marca de partida para los 4 tenants

Recuperada de sus repos y contextos. Lo marcado ❓ hay que confirmarlo contigo o con el cliente.

| Tenant | Bot | Cabecera | Colores | Saludo de arranque | WhatsApp | Logo |
|---|---|---|---|---|---|---|
| `zoe` | **Zoe** 🐱 | `Zoe · Zoe Travel Spain` | `#1a4fd0` + `#f57a1f` | *«¡Hola! Soy Zoe 🐱 ¿A dónde sueñas viajar?»* (+ EN) | `34644280183` | `/img/zoe-logo.png` ✅ |
| `gogestion` | **Faby** | `Faby · GOgestión` | `#A6153A` + `#FDF8F0` | *«¡Hola! 👋 Soy Faby, la asistente de GOgestión…»* | `34634167405` | ❓ |
| `hiredatavision` | **Dara** | `Dara · HireDataVision` | ❓ | ❓ (contexto: datos, BI, Sevilla) | ❓ | ❓ (repo no accesible) |
| `dialogos` | ❓ sin nombre propio en su contexto | `Diálogos que Enseñan` | ❓ | ❓ | ❓ | ❓ (repo no accesible) |

Dos huecos a cerrar: los repos de **HireDataVision** y **Diálogos** dan 404 con el acceso actual
(ya pasó al escribir sus contextos), así que su marca hay que sacarla de la web publicada o
pedírsela. Y **Diálogos no tiene nombre de asistente** en su prompt (`tenants/dialogos.md:20`: *«Eres
el asistente virtual de…»*): si su chat va a tener cabecera con nombre, hay que decidir cuál.

---

## 5. Orden y criterio de listo

| Paso | Bloquea a | Listo cuando |
|---|---|---|
| **PR A** | Las 4 webs (nada funciona sin esto) | El chat responde en `zoetravelspain.com/prueba-vai/` sin `funnel.js` en la página |
| **PR B** | Sustituir el chat propio de cualquier cliente | Zoe muestra su logo, su nombre, su saludo ES/EN y sus colores; ni un string de Velai |
| **PR C** | Que Sebas no vuelva a diagnosticar en el sitio equivocado | El MD no menciona nada que el código no haga |
| Apagar workers viejos | — | El tenant iguala al worker viejo **en marca y en respuestas**, no solo en respuestas |

El reparto detallado por persona y las dependencias están en **§0**.

---

## 6. Dos decisiones que necesito de ti

1. **¿La marca se edita en el panel (PR B, D1) o se declara en el HTML de cada web?** Recomiendo el
   panel: cambiar un saludo no debería depender de un deploy de Sebas. La alternativa
   (`window.VELAI_BRAND = {...}` inline) sale hoy y no necesita migración, pero cada ajuste vuelve a
   pasar por él.
2. **¿El widget unificado sustituye al chat propio de Zoe o convive?** Su chat actual está integrado
   en el diseño y es bilingüe. Sustituirlo exige que PR B alcance ese nivel (logo, tema claro/oscuro,
   ES/EN). Si prefieres velocidad, se puede dejar el chat de Zoe llamando al worker unificado
   (`/chat` con `tenant:'zoe'`) y quedarnos su interfaz — menos elegante de mantener, pero cero
   regresión visual.
