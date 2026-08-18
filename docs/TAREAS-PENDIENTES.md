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

### 2f. Widget con marca en las webs de los clientes (desplegado `?v=7` el 2026-08-18 — ver `IMPLEMENTADO.md`)

- [x] **Hostnames del widget de Turnstile verificados por API (2026-08-18)**: los 4 apex de los clientes + `hirevai.com`/`www` + `velai-dey.pages.dev` + `gogestion-demo.pages.dev` están en el widget `velai-web`. Los `www.` de los clientes quedan cubiertos: Turnstile permite automáticamente los subdominios de los dominios listados. Ojo servidor: `verifyTurnstile` cruza contra `ALLOWED_WEB_ORIGINS`, que sí lista los `www` explícitos — las dos listas alineadas.
- [ ] **Recopilar y cargar la marca de cada cliente** en la ficha del panel (sección «Marca del widget»): logo https, 2 colores, nombre del bot, saludo (ES y EN para Zoe), chips, placeholder y WhatsApp de contacto. Hoy los 4 están en null → sus chats saldrían como `Vai · Velai`. Punto de partida documentado en `IMPLEMENTADO.md` §Widget (Zoe: `#1a4fd0`/`#f57a1f`, logo `/img/zoe-logo.png`; GOgestión: Faby, `#A6153A`/`#FDF8F0`, wa 34634167405).
- [ ] **Decidir el nombre del asistente de Diálogos** (su prompt no le da ninguno; la cabecera del chat lo necesita).
- [ ] **Acceso a los repos de HireDataVision y Diálogos** (404 con el token gh actual) o su marca por otra vía.
- [ ] **Sebas** (su checklist es `PARA-JOHAN-widget-en-webs-cliente.md` v2): subir `/prueba-vai/` de Zoe a `?v=7`, snippet en las 4 webs, y quitar chats viejos SOLO cuando la cabecera muestre la marca del cliente. Los workers viejos no se apagan hasta que el tenant iguale al bot viejo en marca Y respuestas.

### 2a-bis. Alta de usuarios desde el panel (SPEC-USUARIOS — desplegado, falta un paso manual)

- [ ] ~~Política de Access a OTP-para-cualquier-correo~~ **SUSTITUIDO** por
  [`SPEC-ACCESO-CLIENTES-POR-API.md`](./SPEC-ACCESO-CLIENTES-POR-API.md): OTP + grupo
  `Clientes Velai` mantenido por el panel vía API (la puerta solo deja pasar correos
  dados de alta, y queda automatizado). Diagnóstico confirmado por API el 2026-08-18:
  la organización tiene CERO IdPs — sin OTP, el correo de Diálogos no puede entrar por
  mucho que su fila en `tenant_users` exista. Pasos 1-2 de la spec (crear IdP OTP +
  grupo en la política) desbloquean a Diálogos de inmediato.

### 2b. De la revisión de seguridad de Johan (lo manual — el resto ya está aplicado)

- [ ] **Reglas WAF/Rate Limiting de borde** para `/chat` y `/lead` (dashboard → Security → WAF; el worker ya limita por IP y por conversación como segunda capa).
- [ ] **Auditoría de la política de Access**: confirmar la lista exacta de correos, probar uno no autorizado, y documentar quién es el propietario/recuperación de la cuenta Zero Trust.
- [ ] **CSP completa de recursos** empezando en `Report-Only` (la base con frame-ancestors ya está en `_headers`).
- [ ] **Decisión legal**: retención escalonada de leads (hoy 24 meses renovados por actividad) — validar con asesoría.

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
