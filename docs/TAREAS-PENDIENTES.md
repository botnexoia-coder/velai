# Backlog de Velai — pendientes por responsable

> Inventario reconciliado el **2026-09-03** contra `main` en
> `5b1dfb35b1ed92376f5526089428eefe8c859dd0`. No se consultó ni modificó producción
> durante esta revisión: cuando el repositorio prueba el código pero falta evidencia
> del entorno, el pendiente se clasifica como **OPERACIÓN**, no vuelve a abrirse como
> trabajo de código.

> Las specs ya implementadas están consolidadas en
> [`IMPLEMENTADO.md`](./IMPLEMENTADO.md) (texto íntegro en el historial de git).

## Planes y módulos — puesta en marcha de 0043

Implementación y pruebas locales completadas el 2026-09-21; todavía sin desplegar.

- [ ] Antes del CD, revisar los planes deducidos contra los contratos de los clientes:
      un cliente con un solo canal quedará en Esencial aunque pague Profesional.
      La migración conserva sus módulos actuales como excepciones.
      Consulta remota de solo lectura para preparar esa revisión:

      ```bash
      npx wrangler d1 execute vai-leads --remote --command "SELECT slug, channel_address, web_origins, (SELECT group_concat(kind) FROM tenant_channels c WHERE c.tenant_id=t.id) AS enrutados FROM tenants t WHERE active=1 ORDER BY slug"
      ```

- [ ] Pasar CI y CD: `d1 migrations apply` por el flujo habitual, primero staging y
      después producción. No usar `d1 execute --file` para aplicar 0043.
- [ ] En staging, comprobar una cuenta Esencial con WhatsApp: segundo canal rechazado,
      mensajes atendidos; conceder/revocar Eventos en una cuenta sin eventos; revocar
      Citas y comprobar que cierra su página pública de reservas.
- [ ] Verificar el reparto definitivo en producción y corregir los planes comerciales
      desde Clientes → Plan y módulos. Conceder Citas permite configurar sus
      interruptores en Calendario, pero no publica reservas ni envía recordatorios
      automáticamente.
- [ ] **Avisar a Johan**: el intake firmado de eventos
      (`POST /integrations/event-reservations`, el formulario de nayaeventos.com) ahora
      exige el módulo `eventos`. Si algún día se le revoca a NAYA, ese formulario pasa
      de `201` a `403 modulo_no_contratado` — el consumidor vive fuera de este repo.
- [ ] **Orden del CD, no negociable**: `resolveScope` es fail-closed, así que si 0043
      no está aplicada cuando arranca el worker nuevo, TODOS los clientes se quedan sin
      Calendario, Citas y Eventos hasta que la migración entre. El CD ya aplica
      migraciones antes del deploy; si 0043 falla, parar y no desplegar encima.

## Resumen activo por tipo (fuente de verdad)

Las secciones históricas de abajo conservan contexto y pasos concretos. Esta lista
decide quién puede cerrar cada cosa:

### CÓDIGO

- [ ] Nombre público editable del agente, independiente de su alias de acceso;
      v16 muestra el alias que utiliza el panel, sin exponer el correo completo.

- [ ] Retrato en Conexiones (rol cliente); por ahora lo cura Velai en el alta.
- [ ] Widget: seguir cambios de `<html lang>` en caliente para todos sus textos.

- [ ] Contextos amplios fases 2–4 (`tenant_docs`, consulta indexada y, solo a escala,
      Vectorize); no recortar prompts como sustituto.
- [ ] Informe semanal por WhatsApp e Instagram cuando se decida activar esos canales.
- [ ] Canales múltiples fase 2: alta de secundarios, salida por el canal de llegada y
      fusión de datos del alias `velai-messenger`. La auditoría de 2026-09-02 ya hace
      que Conexiones muestre ese alias atendido y quién lo gestiona, sin migrarlo.
- [ ] Exponer `ai_daily_limit`, retirar `.vai-fab`, completar CSP en Report-Only y los
      acabados de Google Calendar (página de integración y botón oficial).
- [ ] Confirmaciones F3/F4 y unificación de la plantilla legacy de leads, solo cuando
      negocio priorice esas fases.
- [ ] Finanzas: conversión EUR↔COP con total combinado, y proponer el movimiento mensual
      del gasto de IA a partir de `ai_usage` (hoy en USD, se apunta a mano). Las dos cosas
      se dejaron fuera a propósito; solo si negocio las pide.

### OPERACIÓN (código ya disponible; requiere entorno o una persona)

- [x] Publicado el lote v15 + loader + ventana v16 el 2026-09-14 (commit `953d020`,
      deploy worker `34853293426`). Verificado en producción: boot con los 6 campos,
      loader `V='16'`, home en `?v=16`, ventana 400×768 con botón oculto, consola limpia.
- [x] **Juan:** TTL de caché del navegador de la zona hirevai.com puesto en «Respetar los
      encabezados existentes» (2026-09-14). El loader sirve ya `max-age=300` y `_headers`
      manda en toda la caché del sitio. No volver a fijar un valor numérico ahí: anularía
      en silencio las cabeceras del repositorio.
- [ ] **Marca de Salo (`tufisiooficial`) y de Faby (`gogestion`) en el panel**: subir
      retrato y escribir la tarjeta de bienvenida. Hoy las dos fichas tienen
      `portrait_url` y `teaser_*` a NULL, así que el widget saca la inicial del bot y el
      texto genérico; hasta el 2026-09-16 eso lo tapaba el andamiaje local que se retiró
      de sus webs. Material ya publicado y servible:
      `https://www.tufisiooficial.com/images/salo-avatar-widget.webp` y
      `https://gogestion-demo.pages.dev/assets/assistants/faby-v1.jpg` (Mei ya está así).
      Teasers que tenían antes — Salo: «¿No sabes qué atención necesitas?» / «Cuéntame qué
      sucede y te ayudo a orientar el servicio y preparar tu cita.»; Faby: «¿Necesitas
      ayuda con tus trámites?» / «Cuéntame qué necesitas y te ayudo a orientar tu consulta
      con el equipo de GOgestión.»
- [ ] **Juan: rol velai para `juanesgarciag@gmail.com`** si quiere abrir Finanzas con su
      correo personal (Configuración → Admins, que escribe `admin_users`). Estar en
      `SOCIOS_EMAILS` NO basta: `esSocio` exige las dos cosas. Hoy la pestaña la ven
      `botnexo.ia@gmail.com` (admin raíz) y `estivenrojas09@gmail.com` (admin del panel con
      el permiso `finanzas` de la migración 0040).
- [ ] **Juan: quitar `botnexo.ia@gmail.com` de Finanzas → Socios.** Decidido el
      2026-09-17: **la cuenta de nexo no cobra, solo entra**; los beneficiarios son
      personas. La migración 0038 la sembró como beneficiario activo (con el correo como
      nombre), así que hoy aparece en el selector de reparto. Como no tiene pagos, el botón
      «Quitar» la borra del todo y desaparece del selector — un clic, sin tocar código ni
      variables. Seguirá entrando a Finanzas: el acceso lo da `SOCIOS_EMAILS`, no esta
      tabla.
- [ ] **Logo de `tufisiooficial` fuera de `workers.dev`**: su `logo_url` apunta a
      `tufisiooficial.botnexo-ia.workers.dev`, justo el dominio que cortan los bloqueadores
      (el motivo del salto v7→v8). Resubirlo desde el panel para que quede en
      `api.hirevai.com/media`.
- [ ] **`MyXuCostura/myxu-costura.html`**: copia antigua de la portada (54 KB, sin
      canonical) que sigue en el repo y no lleva widget. Decidir si se publica o se borra.
- [ ] Comprobar la ventana v16 en una web cliente con cabecera fija y en staging con un
      tenant real: tema, saludo único, hasta cinco sugerencias, conversación viva,
      analítica, y subida de retrato con Historial `config`.

- [ ] Completar y verificar staging: clave Anthropic propia, primer job de CD y login
      con rol cliente. Staging seguirá sin Twilio/Telegram por seguridad.
- [ ] Vincular los Telegram de clientes, pegar tokens de subcuentas, fijar topes de
      gasto y completar las pruebas vivas de chat, historial, informes y Messenger.
- [ ] Revisar logs/cupos, WAF y Access; purgar cachés/snippets antiguos; retirar workers
      legacy solo después de comprobar equivalencia.
- [ ] Confirmar en el job de CD de `main` que las migraciones 0030–0032 y el Worker
      quedaron aplicados. El proceso ya es automático staging→producción; no ejecutar
      migraciones manuales en paralelo.
- [ ] Confirmar el primer CI verde del smoke Playwright y que `deploy-worker` solo nace
      después; si falla, descargar el artifact `playwright-report-*` para ver la traza.
- [ ] Activar Confirmaciones en un tenant de prueba después de que su plantilla esté
      aprobada y hacer el recorrido real de ambos botones.

### TERCEROS

- [ ] Meta/Twilio: verificaciones de negocio, categorías/aprobaciones de plantillas,
      Embedded Signup/Tech Provider y cualquier ticket por plantillas ausentes.
- [ ] Si el equipo necesita un enlace clicable también en el aviso WhatsApp de un lead
      Messenger, crear y aprobar una plantilla nueva: la actual tiene cuatro variables
      fijas. Telegram ya enlaza de forma segura al hilo del panel.
- [ ] Google: enviar la verificación OAuth, esperar aprobación y reactivar protecciones
      de borde después; validación legal de privacidad/LSSI.
- [ ] Cambios en webs de clientes, bots de BotFather y logos que deben aportar sus
      propietarios; R2 es opcional y operativo.

### DECISIONES DE NEGOCIO

- [ ] Presupuesto/canal de campañas, precio del addon Citas (Confirmaciones + Autoagenda), supuestos de
      ahorro, política al agotar IA, Colombia y futuras demos/nurturing.

### LISTO EN ESTE WORKTREE, AÚN NO DESPLEGADO

- [x] Auditoría técnica: tasa de captura con población/ventana única, estado coherente
      de Messenger, soporte Node 20.19+, tests `act` limpios y base E2E sin credenciales.
      El smoke no se declara validado hasta su primer CI verde. Requiere revisión y el
      CD normal; este trabajo no hace commit ni deploy.

---

## 🔴 Bloqueantes para poder pagar pauta medible

Sin esto, las campañas gastarían presupuesto a ciegas (sin medir conversiones).

### 1. Crear cuentas de medición y poner los IDs

- [x] **Google Analytics 4** configurado.
- [x] **Google Ads** y etiqueta de conversión configurados.
- [x] **Meta (Facebook/Instagram) Pixel** configurado.

> Los IDs reales ya están desplegados en las **26 páginas**, en la línea inline del `<head>`:
>
> ```html
> <script>window.VELAI_TRACK={ga4:'G-8HC3SQ0T0Q',ads:'AW-18250158066',adsLabel:'VMZdCLXFn8EcEPKfrf5D',pixel:'1928880717825520'};window.VELAI_WA='15706160059';window.VELAI_TURNSTILE_SITEKEY='…';</script>
> ```
>
> Si algún ID cambia, se edita esa línea en cada HTML y se sube el `?v=` de los scripts.

### 2. Activar persistencia segura y panel — ✅ HECHO (2026-08-17)

- [x] D1 `vai-leads` creada, migración aplicada, UUID real en `wrangler.toml`.
- [x] Turnstile invisible creado (3 hostnames) y sitekey en los 26 HTML.
- [x] Secrets del Worker cargados, incluidos `TELEGRAM_CHAT_ID`, `TEAM_DOMAIN` y `POLICY_AUD`.
- [x] `admin.hirevai.com` como custom domain del Worker + app de Access con OTP.
- [x] Desplegado y verificado end-to-end: lead de prueba en D1 y **aviso entregado en Telegram**.
- [x] `.dev.vars` en `.gitignore` (los secretos de desarrollo local nunca se commitean).
- [x] **`TEAM_WHATSAPP`, `TWILIO_FROM` y `TWILIO_LEAD_TEMPLATE_SID`** configurados; el aviso de WhatsApp va por plantilla (arreglo del `Undelivered 63016` — ver `IMPLEMENTADO.md` §FASE0).
- [ ] **Duplicar la plantilla `velai_nuevo_lead` en categoría Utility** (Twilio Content Template Builder → Duplicate) y pasar el SID nuevo cuando esté aprobada (más barata y sin topes de Marketing).
- [ ] Login de prueba en `admin.hirevai.com` con tu email + PIN, y verificar que ves el lead de prueba.
- [ ] Restos de FASE0 (ver `IMPLEMENTADO.md` §FASE0): status callback del sender (para ver `Undelivered` sin entrar a la consola), perfil de negocio del sender, webhook de voz, bundle +34.

### 2f. Staging — para que su panel sea usable (2026-08-31)

El entorno está montado y con Cloudflare Access delante (app `admin staging`, política
`Staging Velai`). Queda **una** cosa, y es la única que no puede hacerse sin ti:

- [ ] **`ANTHROPIC_API_KEY` del worker de staging** — una clave propia, NO la de producción:
      `npx wrangler@4 secret put ANTHROPIC_API_KEY --env staging`.
      Sin ella el camino del chat funciona entero y muere en el último paso con
      `503 ai_not_configured`. Tope de staging: 100 llamadas/día (~0,60 $ en el peor caso).
- [ ] Confirmar en el primer push a `main` que el `CLOUDFLARE_API_TOKEN` de GitHub Actions
      despliega staging (sus scopes documentados son de cuenta y de zona, así que deberían
      valer sin tocarlo — pero hasta que no corra, no está probado).
- [ ] Entrar una vez a `admin-staging.hirevai.com` con `botnexo.ia+cliente@gmail.com` para
      ver el panel con **rol cliente**, que es el que casi nunca se mira.
- Twilio y Telegram se quedan SIN credenciales en staging a propósito — que una prueba no
  pueda mandarle un WhatsApp a un cliente real. No rellenar «por comodidad».

### 2g. Vincular el Telegram de los clientes (desbloqueado el 2026-08-31)

El webhook ya registra (era el charset de `TELEGRAM_WEBHOOK_SECRET`, ver `IMPLEMENTADO.md`).
Ahora cada cliente puede completar SU vinculación, cosa que nunca fue posible:

- [ ] **gogestion** — tiene marca blanca activada: pega su bot de @BotFather en Conexiones
      y vincula el grupo. Era el caso que destapó el fallo.
- [ ] **dialogos** — igual (marca blanca activada, sin bot).
- [ ] **zoe** y **hiredatavision** — sin marca blanca: les basta el enlace de un solo uso
      con el bot de Velai (@Velaivai_bot).
- [ ] Comprobar en D1 que `telegram_chat_id` deja de ser NULL en cada uno:
      `npx wrangler@4 d1 execute vai-leads --remote --command "SELECT slug, telegram_chat_id FROM tenants"`

### 2c. Alta de los 4 clientes + 1 prospecto (plan de alta aplicado — ver `IMPLEMENTADO.md`)

- [x] **Alta en el panel** de `hiredatavision`, `gogestion`, `zoe`, `dialogos` — verificado el 2026-08-18: los 4 slugs responden 200 en `/widget/boot` (filas activas).
- [ ] `myxu-costura` como prospecto (`pending:myxu-costura`, inactivo) — sin verificar (un prospecto inactivo no responde en `/widget/boot`; mirar en el panel).
- [ ] **Auth tokens de las 4 subcuentas** pegados en el panel (campo write-only; Twilio → subcuenta → Keys & Credentials).
- [ ] **Verificación de negocio en Meta de cada cliente** (con su CIF; añaden a Velai como socio) — bloqueante para su WhatsApp.
- [ ] **Tope de gasto por subcuenta** en Twilio.
- [ ] **Revisión de categoría** de `velai_solicitud_contacto` (Marketing → Utility, disponible hasta el **17 oct 2026**). Desde 2026-09-01 el panel (vista Plantillas) enseña la categoría REAL leída de Twilio por celda — en ámbar cuando difiere de la intención (la de lead de gogestion salió Marketing) — así que el efecto de esta revisión se verá solo, sin consultar Twilio a mano.
- [ ] **Prueba real de Messenger** (¿acepta TwiML?) antes de prometer el canal.
- [ ] Cerrar los `[PENDIENTE:…]` de `tenants/hiredatavision.md`, `dialogos.md` y `myxu-costura.md` (3 repos inaccesibles con el token gh actual: prompts de los bots viejos sin contrastar).
- [ ] Los workers `hiredatavision-bot` y `gogestion-bot` NO se apagan hasta que su tenant responda igual o mejor; anotar en OPERATIONS cuando se apaguen.

### 2d. Contextos amplios (CONTEXTOS-AMPLIOS.md — fase 1 hecha, quedan las siguientes)

- [ ] Tras unos días: revisar `ai_usage` en Workers Logs — `cache_r` > 0 confirma que el caché acierta; si el tráfico es esporádico y `cache_w` se repite mucho, valorar TTL de 1 hora.
- [ ] **Fase 2** (cuando se toque el panel): partir `system_prompt` en instrucciones + conocimiento (`tenant_docs` en D1) — es la que arregla la calidad ("220 caracteres" dejará de competir con 13k de datos; hoy Zoe y GOgestión contestan más largo de lo que su prompt pide).
- [ ] **Fase 3** (al pasar de ~20k car. o varios documentos): herramienta `consultar_base(tema)` con índice en el prompt base.
- [ ] **Fase 4** (solo si el corpus se dispara): Vectorize. Hoy sería sobreingeniería.
- Regla del doc que se mantiene: NO recortar la base de conocimiento de Zoe para ahorrar — el problema es cómo se entrega, no cuánto hay.

### 2e. Restos del plan del chat web (código desplegado — ver `IMPLEMENTADO.md`)

- [ ] Quitar el CSS muerto `.vai-fab` de `site/assets/styles.scss` (3 apariciones) y `site/assets/styles.css` (1).
- [ ] En Cloudflare: `www.hirevai.com` figura "Inactivo (Error)", DMARC sigue en `p=none`, y el proyecto Pages legacy `hirevai` sin retirar.
- [ ] Revisar las métricas del chat (eventos `chat_*` en GA4) a partir del ~2026-08-24, con una semana de datos.

### 2i. Calendario (fase 1 VERIFICADA e2e el 2026-08-20 — consolidada en IMPLEMENTADO.md)

- [x] Google Cloud Console (`velai-calendar`), credenciales cargadas, conexión y cita real de Diálogos agendada por chat y visible en panel + Google Calendar.
- [x] Search Console verificada, app PUBLICADA (ya sin caducidad de 7 días ni test users), marca verificada y publicada, aviso de privacidad in-product en el panel (2026-08-20, sesión Cowork + parche del CLI — detalle en `VERIFICACION-GOOGLE.md`).
- [ ] 🔴 **Grabar el vídeo y ENVIAR la verificación** (2–6 semanas, CAMINO CRÍTICO): guion, justificación del scope (935 car.) y el truco de `GOOGLE_OAUTH_HL="en"` para la consent screen en inglés, todo en `VERIFICACION-GOOGLE.md` §3. Tras grabar, QUITAR la var `GOOGLE_OAUTH_HL`.
- [ ] 🔴 **Reactivar en Cloudflare «Modo Bot Fight» y «AI Labyrinth» cuando Google apruebe el scope** (se apagaron el 2026-08-20 porque el verificador de Google recibía el desafío JS y rechazaba la home). Alternativa si se quieren antes: regla WAF que exima a los fetchers de Google.
- [ ] 🟠 Avisar a los clientes de la pantalla de **«app no verificada»** durante el alta del calendario (desaparece al aprobarse; tope de 100 usuarios nuevos hasta entonces).
- [ ] 🟠 Página `/integraciones/google-calendar/` para usar como enlace de documentación del formulario (admite hasta 3).
- [ ] 🟡 Botón «Conectar Google» con el estilo/logo oficial de Google (branding guidelines) · 🟡 cliente OAuth aparte para desarrollo (hoy `localhost:8787` convive en el de producción; higiene, no motivo de rechazo) · ℹ️ el test user `dialogosqueensenan@gmail.com` ya no hace falta (inocuo).
- [ ] Probar también el camino WhatsApp (asíncrono): pedir cita por WhatsApp y ver la respuesta llegar como mensaje aparte.
- [ ] Validar con asesoría los textos de `/condiciones/` y la sección Google Calendar de `/privacidad/` (junto al bloque LSSI).
- [ ] Pospuesto conscientemente: **Microsoft 365** (fase 2), picker de calendarios (hoy campo `calendar_id`), aviso Telegram por cita, enlace cita↔lead, recordatorios por plantilla, cancelación desde el panel, y canales Telegram/Instagram (spec aparte).

### 2j. Conexiones en autoservicio (spec consolidada en IMPLEMENTADO.md el 2026-08-22 — quedan estos flecos)

- [ ] 🔴 Pulsar **«Registrar webhook»** en el panel → Conexiones (una vez; secret ya cargado). OJO: desde ese momento `getUpdates` deja de funcionar para el bot — los chat ids ya no se leen a mano, que es el punto.
- [ ] Probar el ciclo real: generar enlace para GOgestión → su `/start` en un grupo → el aviso de un lead de prueba llega AL GRUPO y la copia a Velai.
- [x] **PR 2** desplegado (36ad269) y VERIFICADO en vivo (gogestion, 2026-08-22): shape confirmado (`senders`, ruta `/v2/Channels/Senders` con mayúsculas + `Channel=whatsapp`), reparación de webhook ejecutada en vivo, y sandbox (+14155238886) filtrado tras colarse en la 1ª sync (425cdaa).
- [x] **PR 3** desplegado: `PATCH …/notify` en autoservicio + guarda del `63031` en los dos caminos.
- [ ] **PR 4 (Fase B, NO implementar aún)** — Embedded Signup real en el panel. Precondiciones, en orden, todas de Juan: (1) S.L./alta censal para la verificación de negocio de Velai en Meta; (2) 2FA + verificación del portfolio `949061711290882` («several weeks»); (3) app de Meta NUEVA enviada a App Review; (4) alta en el programa Tech Provider de Twilio. Reevaluar a ~10 clientes junto a la comparativa 360dialog.

### 2l. Widget v=8 por api.hirevai.com (adblock — desplegado 2026-08-22)

- [x] Worker con dominio propio `api.hirevai.com`; widget v=8 y las 2 herramientas (diagnóstico, test-ley) llaman ahí. workers.dev sigue vivo para widgets viejos y webhooks Twilio/Telegram.
- [ ] **Juan:** purgar en el dashboard de Cloudflare (hirevai.com → Caching → Custom purge) las URLs `https://hirevai.com/assets/vai-widget.js?v=7` y `https://hirevai.com/assets/vai-widget.js` — así los visitantes nuevos de las webs de clientes (aún con snippet v=7) reciben ya el widget arreglado.
- [x] Webs de clientes al loader `/assets/vai.js` (2026-09-14, desde Claude Code con la cuenta
      botnexoia-coder): **Zoe** (`5afc847`, 7 HTML, retirada también su copia local de
      `velai-assistant-polish.js` + `assistant-brand.js`), **hiredatavision** (`1e9f3d0`, 6 HTML,
      misma retirada) y **Dialogos** (`a37d17e`, 12 HTML; `promo-qr.html` nunca llevó widget).
      Verificado en vivo tras Pages: las tres cargan el loader, sin widget directo ni polish;
      zoetravelspain.com abierto en Chromium monta «Hablar con Zoe» una sola vez y encadena
      `vai.js` → `vai-widget.js?v=16` sin errores.
- [ ] **Juan (panel, 10 min):** cargar en Clientes → ficha → Marca del widget el retrato, el
      acento y los textos de la tarjeta de los tres clientes. Hasta que se carguen, el botón
      muestra la inicial del bot y la tarjeta usa el texto genérico. Esos datos vivían solo en
      los archivos de cada web (`assistant-brand.js` y `dialogos-widget-polish.js`, retirados
      el 2026-09-14); se recuperaron de git y son estos:

      **Alma · dialogos** — retrato `https://dialogosqueensenan.com/img/alma.jpg`,
      acento `#ff8a42`, tarjeta ES «¿En qué puedo ayudarte?» / «Cuéntame qué necesitas.
      Estoy aquí para escucharte y orientarte.» Su botón usaba el degradado `#194fd1 → #263c85`;
      hoy la ficha tiene `#5AA0FF / #FF6577`, que pinta un azul claro a rosa. Decidir cuál queda.

      **Zoe · zoe** — retrato `https://zoetravelspain.com/img/zoe-cat.jpg`, acento `#f57a1f`,
      tarjeta ES «¿A dónde te gustaría viajar?» / «Cuéntame tu destino y te ayudo a dar el
      primer paso de tu próximo viaje.», EN «Where would you like to travel?» / «Tell me your
      destination and I can help you take the first step towards your next trip.»

      **Dara · hiredatavision** — retrato `https://hiredatavision.com/assets/assistants/dara-v2.webp`,
      acento `#57e6bd`, tarjeta ES «¿Qué dato no cuadra?» / «Cuéntame qué proceso tarda
      demasiado o qué decisión necesitas tomar. Te ayudo a ordenar el siguiente paso.»,
      EN «Could your data tell you more?» / «Let's talk about reports, metrics and manual
      tasks. I can help you find a starting point.»

      Mejor subir la imagen con el botón de la ficha que pegar la URL: así el retrato deja de
      depender de la web del cliente. Cambio visible en el sitio en ≤5 min por la caché del boot.
- [ ] **myxucostura.com: revertido, queda por decidir.** El 2026-09-15 se le puso el widget
      (`b61514b`) y se retiraron sus dos chats locales (`dc0edef`), pero Juan pidió dejar el
      sitio exactamente como estaba y se revirtió entero (`67fe052`, árbol idéntico a
      `2bdf6a7` del 16 de mayo). Hoy la web sigue con su propio chat contra
      `myxu-costura-bot.workers.dev` y sin el asistente de la plataforma, pese a que el
      tenant `myxu-costura` ya está completo en el panel (Mei, con retrato, acento y tarjeta).
      Antes de volver a intentarlo, aclarar con Juan qué versión del sitio es la buena: él
      menciona un rediseño «de esta semana» que no existe en el repo `MyXuCostura`, cuyo
      último commit propio es del 16 de mayo.
- [ ] El retrato de Mei pesa 1,9 MB y se sirve desde la web del cliente
      (`myxucostura.com/assets/assistants/myxu-mei-admin-v2.png`). Para un avatar de 46 px
      sobra con una versión pequeña, y subirla por la ficha la mueve al dominio de Velai.
- [ ] **SEO de myxucostura.com:** cualquier ruta inexistente devuelve 200 con la portada
      (comprobado con `/esto-no-existe-12345`). Google lo trata como error blando; conviene
      un `404.html` en el proyecto de Pages.
- [ ] Los workers `myxu-costura-bot`, `hiredatavision-bot` y `gogestion-bot`: solo el primero
      lo llama su web. Revisar si los otros dos siguen sirviendo a algún canal.
- [ ] **Zoe: falta el retrato en la ficha.** Es la causa de que el rediseño de la portada
      restaurara la capa local el 2026-09-15 y dejara la home en `?v=14` (corregido en
      `38d24d3`). La gata sigue publicada en `https://zoetravelspain.com/img/zoe-cat.jpg`.
- [ ] gogestion-demo.pages.dev sigue en `?v=14` con capa local. El repo es `CronoSeb/gogestion-demo`
      y hay acceso de escritura desde la cuenta botnexoia: migrarlo al loader es un commit.
- [ ] **Sebas:** tufisiooficial.com al loader. Lo sirve el Worker `tufisiooficial` con dominio
      propio; su fuente no está en ningún repo de botnexoia-coder. Hoy carga
      `vai-widget.js?v=20260913-salo` (misma línea a sustituir, tenant `tufisiooficial`).

### 2m. Marca del negocio en WhatsApp (desplegado 2026-08-22)

- [x] Subida del logo desde la ficha (Marca del widget → «Subir imagen»): valida el tipo por magic bytes, máx. 2 MB, se guarda en nuestro almacenamiento y se sirve por `api.hirevai.com/media/logos/<id>.<ext>?v=…` (URL versionada, caché de un año).
- [x] Botón **«Aplicar marca al perfil»** en Conexiones → WhatsApp (solo Velai): manda logo, descripción y web de la ficha al perfil de negocio del sender. El display name se relee y se reenvía intacto — cambiarlo dispara revisión de Meta.
- [ ] **Juan (opcional, 1 clic):** activar **R2** en el dashboard (dash.cloudflare.com → R2 → habilitar; 10 GB gratis). Hoy los logos viven en KV y funciona igual; con R2 activo, `npx wrangler@4 r2 bucket create vai-media` + descomentar el binding en `wrangler.toml` y las subidas nuevas van allí.
- [x] **Autoservicio (2026-08-24):** el propio cliente sube su logo desde Conexiones → «Tu logo» (ruta en `clienteAllowed` con guarda own-only: ajeno = 404) y el worker se lo aplica SOLO a su foto de WhatsApp en segundo plano (`sender_profile_synced` / `sender_profile_sync_failed` en los logs). El botón manual de Velai sigue como red de seguridad.
- [ ] Subir un logo grande de Diálogos (su favicon actual es pequeño y se verá pixelado como foto de WhatsApp): ahora basta con subirlo, el perfil se actualiza solo.

### 2n. Gasto de IA y marca por canal (desplegado 2026-08-25)

- [x] **Gasto de IA por cliente** (migración 0018 `ai_usage`, UPSERT por cliente/día/modelo): tarjeta velai-only en el dashboard con coste del periodo, coste medio por llamada, llamadas, tokens, gráfica diaria y tabla por cliente. Tarifas por modelo en `AI_PRICES` (`worker/app.js`) — **si Anthropic cambia precios, se editan ahí**; caché a 1,25x (escritura) y 0,1x (lectura) del precio de entrada.
- [x] **Imagen por canal** (migración 0019 `logo_wa_url`): la subida acepta `?channels=web,whatsapp`; casillas en la tarjeta «Tu logo» y miniatura por canal. El perfil de WhatsApp prefiere su imagen y cae a la del widget.
- [ ] **Pendiente de comprobar en vivo:** que el gasto empiece a aparecer tras las próximas conversaciones (la tabla arranca vacía) y subir una imagen distinta para el WhatsApp de Diálogos (su isotipo cuadrado) dejando el logotipo completo en la web.
- [ ] Cuando haya un mes de datos, revisar si algún cliente sale más caro que su cuota y ajustar su `ai_daily_limit` en la ficha.

### 2o. Plan del panel frente al mercado (análisis competitivo del 2026-08-26)

Del artifact «El panel de Velai frente al mercado» (25 productos revisados) salió un plan
en tres horizontes: [`PLAN-PANEL.md`](./PLAN-PANEL.md) es el mapa y las decisiones;
[`H1-PANEL.md`](./H1-PANEL.md) y [`H2-PANEL.md`](./H2-PANEL.md), el trabajo que queda
(H3 se cerró: §4 está en IMPLEMENTADO.md y §1, §2, §3 y §5 bajaron aquí). Lo que depende de ti:

- [x] **H1 §1 desplegado el 2026-08-26** (migración 0021 + historial en D1 + vista Conversaciones + `/privacidad/`). El CI aplicó la migración y desplegó; el humo del preflight de `/chat` pasó.
- [ ] **Pendiente de comprobar en vivo:** escribir por el widget y por WhatsApp y ver que la conversación aparece en la vista **Conversaciones** con los dos turnos (la tabla arranca vacía: las conversaciones anteriores vivían en KV y ya caducaron). Comprobar de paso que la ficha de un lead nuevo enlaza con su conversación.
- [ ] **Vigilar `conv_state_not_saved` en Workers Logs** los primeros días: significa que alguien recibió su respuesta pero el turno siguiente irá sin ese contexto. Si aparece, es lo primero que hay que mirar del historial.
- [ ] **Confirmar que el cuello de KV bajó**: en el dashboard, las escrituras de KV por conversación deberían pasar de ~5 a ~2. Si no se nota, quedan los dos contadores de cupo de IA por mover a D1 (`ai_usage` ya es una tabla) y los dos limitadores de tasa — están apuntados en `VOLUMEN-Y-ALMACENAMIENTO.md` §Decisión (3 y 4).
- [x] **H1 §2 (informe semanal) desplegado el 2026-08-26** — migración 0022, por Telegram, con interruptor de baja en Conexiones. Sin cron nuevo: viaja en el de 5 minutos dentro de una ventana de 24 h que abre el lunes a las 07:00 UTC (09:00 en verano, 08:00 en invierno).
- [ ] **El primer informe llega el lunes 2026-08-31 por la mañana.** Comprobar que llega a los grupos de los 6 clientes activos y que el que no tenga Telegram vinculado queda como `skipped` en `tenant_reports` (no en silencio). El código de log es `weekly_report`.
- [ ] **Ese primer informe NO llevará comparación** con la semana anterior (el historial arrancó el 2026-08-26): es correcto y deliberado. La comparación empieza a aparecer el lunes 2026-09-14.
- [ ] **Informe por WhatsApp** (segundo paso de H1 §2): necesita su propia plantilla aprobada por Meta (`velai_weekly_report`) provisionada por subcuenta. Comparte maquinaria con el envío de plantillas de la bandeja — se hacen juntas (alcance excluido de la bandeja, en IMPLEMENTADO.md).
- [ ] **Instagram** (Juan, 2026-08-26): va por Meta igual que Messenger, así que cuando se conecte Facebook se conecta Instagram. Se decide al llegar a la bandeja — el filtro de canal NO se pinta hasta que el canal exista: un filtro que no filtra nada es la clase de mentira que el panel no se permite.
- [ ] **Validar en vivo la regla «ESPACIO Y CIERRE»** (Juan, 2026-08-26: «no podemos dejar a un cliente a mitad de una conversación»). La red de seguridad es determinista y está en tests — nadie se queda a mitad, con modelo o sin él. Lo que SOLO se puede validar contra el modelo vivo es la *prevención*: que ante una consulta larga resuma y cierre en vez de empezar a enumerarlo todo. Herramienta: **ficha del cliente → Probar**, con la consulta de NIE de GOgestión que lo destapó. Si aún se va largo, la regla es una cadena de texto en `vai-worker.js`: se endurece y se vuelve a desplegar.
- [ ] **Vigilar `reply_truncated` en Workers Logs.** Si sale mucho para un cliente, súbele el tope de su canal o aprieta su prompt. Si sale para un cliente que atiende en otro idioma, el cierre de emergencia (en español fijo) hay que hacerlo por tenant.
- [ ] **Cuando la base pase de 100 MB o KV pase del 50% del cupo diario**, revisar [`VOLUMEN-Y-ALMACENAMIENTO.md`](./VOLUMEN-Y-ALMACENAMIENTO.md) (medido el 2026-08-26: la base entera pesa 332 KB y el cuello real es KV, no D1).
- [x] **Retención de transcripciones + `/privacidad/`** — 90 días desde el último mensaje (`CONV_RETENTION_DAYS`), uniforme (una conversación con lead no se guarda más), y la política actualizada el 2026-08-26 con la base jurídica de la finalidad nueva. El razonamiento del plazo está en `IMPLEMENTADO.md` §«Historial de conversaciones en D1».
- [ ] **Coexistence y Embedded Signup: decidir antes de septiembre de 2026** (H3 §1 y §2). El 15 de octubre Meta retira Embedded Signup v2/v3 y `coex` no migra solo. Si el alta sigue siendo acompañada en la consola de Twilio, no toca nada; solo hay que decidirlo a tiempo.
- [ ] **Verificar contra Twilio en vivo** qué campos devuelve de verdad la aprobación de plantillas (`rejection_reason`, quality rating) antes de escribir la UI de los siete estados (H1 §5). La plantilla de GOgestión sirve de caso.
- [ ] **Supuestos del ahorro** (H1 §4): confirmar minutos por conversación y coste/hora por defecto. Referencia citable: 6–12 $ por ticket humano (informe de ROI de Intercom).
- [ ] **Satisfacción medida aparte** (H3 §3): decidir si se hace una pregunta al cerrar, que es
      lo único que hace Tidio del grupo DIY. Consenso unánime del sector: **nunca mezclar el CSAT
      del bot con el de los humanos**. Si se decide NO hacerla, el argumento de Intercom para matar
      la encuesta clásica sirve tal cual: baja respuesta, sesgo a los extremos y castigo injusto a
      la IA. Una puntuación propia tipo CX Score sigue descartada en `PLAN-PANEL.md`.
- [ ] **Kit Digital y Kit Consulting** (H3 §5): verificar convocatoria y plazos vigentes antes de
      usarlo en un presupuesto. Siguen vivos en 2026 con fondos remanentes y ya financian IA; es el
      mecanismo de compra que la pyme española reconoce y Centribal ya lo usa como canal de entrada.
      No es panel, es canal comercial, pero condiciona cómo se presenta el precio (`PLAN-PANEL.md`:
      por cliente y mes con los mensajes a coste, nunca créditos).
- [ ] **Cupo de IA al agotarse** (H3 §4): ¿se corta con 429 como hoy, o se desborda con aviso como hacen Crisp y Zendesk?

### 2k. Canales múltiples por cliente (tenant_channels — fase 1 desplegada 2026-08-22)

- [x] Tabla `tenant_channels` (migración 0017, backfill) + enrutado del webhook canales-primero con fallback a `tenants.channel_address`; el PATCH/POST mantienen el espejo del canal primario; chips de la lista por canal real (web siempre + whatsapp con estado del sender + messenger).
- [x] **Enrutado visible + el hueco de `sender/sync` cerrado** (2026-08-24, a6ac312 y 5dddc37): la vista **Canales** del panel lista las direcciones que el worker atiende de verdad y alarma con los senders vivos que ninguna fila enruta; `sender/sync` registra el canal (antes un cliente con canal web previo quedaba con el sender ONLINE y el bot mudo — le pasó a gogestion). Detalle en IMPLEMENTADO.
- [ ] **Fase 2 (cuando un cliente pida 2 canales de mensajería a la vez):** UI para añadir canales secundarios (hoy solo escribe el primario), respuesta saliente por el canal de llegada, y fusionar «Velai (Messenger)» en la fila de Velai como primer caso real. Nota: la vista Canales ya marca «responde con otro número» — el desalineado entre canal de llegada y `twilio_from` que la fase 2 tiene que resolver de verdad.
- [ ] **Telegram y web siguen FUERA de `tenant_channels`** (telegram en `telegram_chat_id`, la web en el slug). La ficha y «Tus canales» ya los presentan como si fueran uno, pero por debajo son tres almacenes: unificarlo exige mudar el `pending:` a una columna de estado propia y retirar `channel_address` con migración. Es la opción que se valoró y descartó el 2026-08-24 por coste; el detonante natural es el primer cliente con dos canales de mensajería a la vez.
- [ ] Los estados `cliente inactivo`, `responde con otro número` y `cliente borrado` no tienen entrada propia en el filtro de la vista Canales (hoy solo Todos / Requieren atención / Atendidos) porque no existe ninguno en producción. Si empiezan a aparecer, merecen su opción.

### 2h. Seguimiento del sprint de blindaje (desplegado 2026-08-20)

- [ ] **Webhook 100% asíncrono (TwiML vacío + `waitUntil` + Messages API de Twilio)**: evaluado y descartado en el sprint — solo abordarlo si los logs `ai_usage` muestran p95 > ~9 s en el canal WhatsApp (hoy el webhook va con timeout 10 s / 0 reintentos + dedupe por `MessageSid`, suficiente). Nota: SPEC-CALENDARIO ya contempla este patrón para el bucle de tools, que lo necesitará de verdad.
- [ ] Exponer `tenants.ai_daily_limit` en la ficha del panel (hoy se edita por SQL; el default es `AI_TENANT_DAILY_LIMIT`=300).

### 2f. Widget con marca en las webs de los clientes (v=7 del 2026-08-18, superado por v=8 — los flecos de versión viven en §2l)

- [x] **Hostnames del widget de Turnstile verificados por API (2026-08-18)**: los 4 apex de los clientes + `hirevai.com`/`www` + `velai-dey.pages.dev` + `gogestion-demo.pages.dev` están en el widget `velai-web`. Los `www.` de los clientes quedan cubiertos: Turnstile permite automáticamente los subdominios de los dominios listados. Ojo servidor: `verifyTurnstile` cruza contra `ALLOWED_WEB_ORIGINS`, que sí lista los `www` explícitos — las dos listas alineadas.
- [x] **Marca de los 4 clientes cargada y verificada por `/widget/boot` (2026-08-18)**: Zoe 🐱, Faby (GOgestión), Dara (HireDataVision) y **Alma** (Diálogos — nombre decidido), con logo, colores, saludo y chips. Los repos externos ya no hacen falta: la marca se sacó por otra vía.
- [x] **Snippet `?v=7` en producción y chats viejos retirados** (verificado por curl 2026-08-18): zoetravelspain.com, hiredatavision.com y dialogosqueensenan.com con tenant correcto y `vai-widget.js?v=7` como único chat.
- [ ] **Los leads de gogestión y dialogos NO llegan a nadie** (detectado 2026-08-24): se capturan bien en el panel, pero los dos canales de aviso salen `skipped` — `telegram_not_configured` (ninguno tiene grupo vinculado) y `template_not_approved` (plantilla `pending` en Meta). Acciones: (a) vincular su Telegram, que es lo único que no depende de terceros y desbloquea el aviso hoy; (b) seguir la aprobación de la plantilla. ~~**Y arreglar la promesa falsa**~~ → HECHO el 2026-08-24: Conexiones gana «¿Dónde llegan tus leads?» con el estado real de entrega por canal (`leadAlertStatus`, espeja las condiciones de `deliver()`), y si no hay ninguno activo lo dice claro en vez de prometer Telegram. Lo que queda es la ACCIÓN: vincular sus Telegram y seguir la aprobación de Meta.
- [ ] **La plantilla de gogestión NUNCA llegó a Meta** (verificado el 2026-08-24 con acceso admin al portfolio del cliente: WhatsApp Manager decía «Total de plantillas activas: 0 de 250»). Twilio aceptó el submit pero Meta no tiene registro, así que el `pending` de la fila no iba a resolverse nunca. Orden de trabajo: (1) **completar la verificación del negocio** de la WABA — está «No verificado» y el nombre del negocio es el nombre personal del titular, no «GOgestión»; (2) pulsar **«Reenviar a aprobación»** en Aprovisionamiento; (3) confirmar en WhatsApp Manager que ahora SÍ aparece. Si tras el reenvío la WABA sigue a 0 plantillas, el problema está entre Twilio y Meta y toca **ticket a Twilio** con el Content SID. Revisar lo mismo en dialogos (enviada el 21/8, también `pending`).
- [ ] **GOgestión — dos flecos**: (a) su `wa_number` está vacío en la ficha → los mensajes de error de su chat caen al WhatsApp de Velai (candidato: 34634167405, el de su bot viejo); (b) el snippet está en `gogestion-demo.pages.dev` pero **no en `gogestion.es` producción** (web Next.js — les toca desplegarlo allí).
- [ ] **Apagar los workers viejos** (`hiredatavision-bot`, `gogestion-bot`): los chats ya no se cargan en ninguna web; queda validar unos días que los tenants responden igual o mejor y apagarlos. Anotar en OPERATIONS al hacerlo.

### 2a-bis. Alta de usuarios desde el panel (SPEC-USUARIOS — desplegado, falta un paso manual)

- [x] **Puerta de Access automatizada (2026-08-18)** — ver `IMPLEMENTADO.md` §Acceso:
  IdP OTP + grupo «Clientes Velai» mantenido por el panel; login de Diálogos verificado.
  Las altas/bajas de usuarios de cliente ya no tocan el dashboard de Cloudflare.

### 2b. De la revisión de seguridad de Johan (lo manual — el resto ya está aplicado)

- [ ] **Reglas WAF/Rate Limiting de borde** para `/chat` y `/lead` (dashboard → Security → WAF; el worker ya limita por IP y por conversación como segunda capa).
- [ ] **Auditoría de la política de Access**: confirmar la lista exacta de correos, probar uno no autorizado, y documentar quién es el propietario/recuperación de la cuenta Zero Trust.
- [ ] **CSP completa de recursos** empezando en `Report-Only` (la base con frame-ancestors ya está en `_headers`).
- [ ] **Decisión legal**: retención escalonada de leads (hoy 24 meses renovados por actividad) — validar con asesoría.

### 2g. Restos del sistema de orígenes/Turnstile (desplegado — ver `IMPLEMENTADO.md`)

- [ ] **Adelgazar `ALLOWED_WEB_ORIGINS`** en `wrangler.toml`: los dominios de los 4 clientes ya viven en sus fichas (D1, verificado); se dejaron también en la var como red de seguridad. Tras unos días estables, retirar los de cliente de la var (+ deploy) y dejar solo los 3 de Velai.
- [ ] **Nota de escala**: el widget de Turnstile admite 10 dominios (hoy 7 apex). Al acercarse al límite, pasar a un widget por cliente (alternativa §4 de la spec, resumida en IMPLEMENTADO.md): sitekey por tenant vía `/widget/boot` + secret cifrado por tenant en `verifyTurnstile`.

### 3. Verificar conversiones antes de invertir

- [ ] Con los IDs ya puestos: comprobar eventos en **GA4 DebugView**, **Google Ads** (estado de la conversión) y **Meta Events Manager → Test Events**.
- [ ] Confirmar que un envío de formulario dispara `lead_submit` y un clic en WhatsApp dispara `whatsapp_click`.

---

## 🟠 Para lanzar campañas

- [ ] **Definir presupuesto** y canal de arranque (Google Search vs Meta/Instagram).
- [ ] **Textos de anuncios** que coincidan con el titular de la landing `/lp/restaurantes/` (message match) — te puedo ayudar a redactarlos.
- [ ] **Creatividades** (imágenes/vídeo) para Meta si vas por ese canal.
- [x] **Página de privacidad/cookies** creada y actualizada con D1, Turnstile y retención. ⚠️ La identificación jurídica del titular sigue pendiente de validación antes de formalizar ventas o pauta.

---

## 🟡 Para los activos de Sprint 2 (cuando lleguemos)

- [ ] **Número de WhatsApp Business API para el bot demo** (un "Vai de restaurante ficticio"). Hace falta un número/sandbox y desplegar el worker parametrizado.
- [ ] **Datos para casos de éxito reales**: en cuanto tengas 1–2 clientes con cifras (mensajes atendidos, reservas, no-shows), me los pasas y los meto en las landings (ahora hay un "ejemplo ilustrativo", no un testimonio real).
- [ ] **Secuencia de nurturing post-diagnóstico** (email/WhatsApp) — del blueprint del funnel, sin empezar.

---

## 🔵 Confirmaciones de cita (código en `main` desde 2026-09-01 — activación operativa)

El código está en `main` (ver IMPLEMENTADO.md §Confirmaciones); nada sale hasta
completar esto, EN ESTE ORDEN. La aplicación de migraciones pertenece al CD automático,
no a una segunda ejecución manual:

- [ ] **Verificar el job de CD de `main`** que contiene las migraciones 0030, 0031 y
      0032: debe mostrar migraciones+deploy+humo verdes primero en staging y después en
      producción. Si no hay evidencia, se reejecuta/repara el job; no se lanzan las
      migraciones a mano mientras el estado sea incierto.
- [ ] **Crear la plantilla de recordatorios** del tenant de prueba: panel →
      Calendario → card «Confirmaciones» → «Crear plantilla de recordatorios»
      (necesita subcuenta de Twilio con token). Se abre el diálogo de configuración:
      antelación (12/24/48) y pareja de botones con vista previa → «Enviar a
      aprobación». El cron avisa por Telegram cuando Meta la apruebe. La plantilla
      de dialogos YA pendiente (creada sin opciones) sigue válida tal cual.
- [ ] **Activar el addon** al tenant de prueba (misma card, botón «Activar
      Confirmaciones») cuando la plantilla esté aprobada.
- [ ] **Prueba real**: agendar una cita con Vai a >24 h vista, esperar el
      recordatorio y pulsar los dos botones (Confirmo y Cancelar → reagendado).
- [ ] **Decisión de precio de Citas**: el módulo agrupa Confirmaciones + Autoagenda.
      Decidir si entra en Profesional o se cobra aparte, y su tarifa. Por ahora es
      addon en el catálogo; incluirlo en un plan se cambia en `worker/planes.js`.

**F3 (autoagenda) desplegada y viva**: `citas.hirevai.com/{cliente}/reservas` responde con
la página de Diálogos y sus tres modalidades; servicios, embeds, .ics y reagendado por token
incluidos, y el chat sigue agendando conversando. Resumen en
[`IMPLEMENTADO.md`](./IMPLEMENTADO.md) §Autoagenda. Lo que queda de ella:

- [ ] **Plantilla `confirmacion_reserva`** creada y aprobada por Meta antes de que la
      confirmación de una reserva salga por WhatsApp. No se reutiliza un recordatorio con
      otro significado: el mensaje dice algo distinto.
- [ ] **Embed en la web de Diálogos** (`vai-citas.js`, inline o popup) cuando el enlace a
      secas lleve una semana sin sustos. Hoy su web solo lleva el widget de chat.
- [ ] **Vigilar los primeros días**: que ninguna reserva pública se cruce con una del chat
      (la triple barrera está en tests, pero el tráfico real es el que manda) y que el caché
      de huecos de 90 s no enseñe una hora ya ocupada.

Futura: **F4** métricas de confirmación/cancelación/no-show en dashboard e informe
semanal (el no-show exige marcarlo a mano en el panel). Técnica pendiente: unificar
la plantilla de LEADS (columnas `lead_template_*` de tenants) en `tenant_templates`,
migrando datos y lectores a la vez.

---

## 🟢 Decisiones de negocio pendientes

- [ ] **Colombia**: cuándo replicar el funnel (precios USD/COP, copy localizado). Hoy todo está en España (€).
- [ ] **Calendario de demos**: ¿usamos Calendly / Cal.com para que el lead agende solo? (hoy el cierre es por WhatsApp con el equipo).
- [ ] **Instagram en el prompt**: la web y el prompt de Vai prometen Instagram sin canal desplegado (`vai-worker.js` y `tenants/velai.md`). Decisión tomada el 2026-08-17 de mantenerlo por ahora — revisar antes de pauta.
- [ ] **Demos grupales por vertical y programa de referidos/partners** (fase 2 del blueprint del funnel, mes 3+).

---

## ✅ Ya hecho (no requiere nada de tu parte)

- Fundación de medición + Consent Mode v2 + banner RGPD bilingüe (en las 26 páginas).
- Captura de UTM/gclid/fbclid con atribución end-to-end hasta el lead.
- Formulario cualificador con descalificación honesta (`<10 msg/día`).
- Endpoint `/lead` en el worker: valida Turnstile, persiste en D1 (con degradación a KV + aviso directo si D1 cae) y notifica por Telegram y WhatsApp con reintentos vía cron. El chat web y el WhatsApp entrante también capturan leads.
- WhatsApp unificado: **todos los enlaces públicos van al bot Vai** (15706160059).
- Notificaciones a founders: se mantienen **solo como aviso**; toda interacción del cliente es con el bot.
- Landing de Restaurantes: versión SEO (`/restaurantes/`) + versión de pauta (`/lp/restaurantes/`, noindex).
- **Conversión de Google Ads cableada** (`funnel.js` v2): los eventos de alta intención (envío de formulario, clic en WhatsApp, diagnóstico y cotizador completados) ya disparan `gtag('event','conversion')` con tu `adsLabel`. Antes el `adsLabel` se leía pero no se usaba → Google Ads no podía medir conversiones. **En cuanto pongas los IDs, la medición de pauta funciona.**
- Página de Política de Privacidad y Cookies (`/privacidad/`), RGPD + LSSI, enlazada desde el banner de cookies y el footer.
