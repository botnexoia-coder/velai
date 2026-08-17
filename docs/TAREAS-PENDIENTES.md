# Tareas pendientes — por tu parte (Juan)

> Cosas que el código **no puede hacer solo** y dependen de ti (cuentas, IDs,
> despliegues, datos reales). Marca las casillas a medida que las completes.
> Última actualización: 2026-08-17.

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
- [ ] **`TEAM_WHATSAPP` y `TWILIO_FROM`** (formato `whatsapp:+E164`): único cabo suelto del sistema de avisos. Sin ellas, el canal WhatsApp de los avisos queda `skipped` — se activará solo (≤6 h) cuando las pongas.
- [ ] Login de prueba en `admin.hirevai.com` con tu email + PIN, y verificar que ves el lead de prueba.

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

---

## 🟢 Decisiones de negocio pendientes

- [ ] **Colombia**: cuándo replicar el funnel (precios USD/COP, copy localizado). Hoy todo está en España (€).
- [ ] **Calendario de demos**: ¿usamos Calendly / Cal.com para que el lead agende solo? (hoy el cierre es por WhatsApp con el equipo).

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
