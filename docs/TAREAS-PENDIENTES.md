# Tareas pendientes — por tu parte (Juan)

> Cosas que el código **no puede hacer solo** y dependen de ti (cuentas, IDs,
> despliegues, datos reales). Marca las casillas a medida que las completes.
> Última actualización: 2026-08-17.

> Las specs ya implementadas están consolidadas en
> [`IMPLEMENTADO.md`](./IMPLEMENTADO.md) (texto íntegro en el historial de git).

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

### 2c. Alta de los 4 clientes + 1 prospecto (plan de alta aplicado — ver `IMPLEMENTADO.md`)

- [x] **Alta en el panel** de `hiredatavision`, `gogestion`, `zoe`, `dialogos` — verificado el 2026-08-18: los 4 slugs responden 200 en `/widget/boot` (filas activas).
- [ ] `myxu-costura` como prospecto (`pending:myxu-costura`, inactivo) — sin verificar (un prospecto inactivo no responde en `/widget/boot`; mirar en el panel).
- [ ] **Auth tokens de las 4 subcuentas** pegados en el panel (campo write-only; Twilio → subcuenta → Keys & Credentials).
- [ ] **Verificación de negocio en Meta de cada cliente** (con su CIF; añaden a Velai como socio) — bloqueante para su WhatsApp.
- [ ] **Tope de gasto por subcuenta** en Twilio.
- [ ] **Revisión de categoría** de `velai_solicitud_contacto` (Marketing → Utility, disponible hasta el **17 oct 2026**).
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

- [ ] Quitar el CSS muerto `.vai-fab` de `assets/styles.scss` (3 apariciones) y `assets/styles.css` (1).
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
- [ ] **Sebas:** subir el snippet a `?v=8` en las 4 webs de clientes (dialogosqueensenan.com confirmada con snippet correcto; el cambio es solo la query). Los navegadores que cachearon v=7 (immutable, 1 año) solo se arreglan con esto.

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
[`H1-PANEL.md`](./H1-PANEL.md), [`H2-PANEL.md`](./H2-PANEL.md) y
[`H3-PANEL.md`](./H3-PANEL.md), el trabajo. Lo que depende de ti:

- [ ] **Cuando la base pase de 100 MB o KV pase del 50% del cupo diario**, revisar [`VOLUMEN-Y-ALMACENAMIENTO.md`](./VOLUMEN-Y-ALMACENAMIENTO.md) (medido el 2026-08-26: la base entera pesa 332 KB y el cuello real es KV, no D1).
- [x] **Retención de transcripciones + `/privacidad/`** — 90 días desde el último mensaje (`CONV_RETENTION_DAYS`), uniforme (una conversación con lead no se guarda más), y la política actualizada el 2026-08-26 con la base jurídica de la finalidad nueva. El razonamiento del plazo está en `H1-PANEL.md` §1.
- [ ] **Coexistence y Embedded Signup: decidir antes de septiembre de 2026** (H3 §1 y §2). El 15 de octubre Meta retira Embedded Signup v2/v3 y `coex` no migra solo. Si el alta sigue siendo acompañada en la consola de Twilio, no toca nada; solo hay que decidirlo a tiempo.
- [ ] **Verificar contra Twilio en vivo** qué campos devuelve de verdad la aprobación de plantillas (`rejection_reason`, quality rating) antes de escribir la UI de los siete estados (H1 §5). La plantilla de GOgestión sirve de caso.
- [ ] **Supuestos del ahorro** (H1 §4): confirmar minutos por conversación y coste/hora por defecto. Referencia citable: 6–12 $ por ticket humano (informe de ROI de Intercom).
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
