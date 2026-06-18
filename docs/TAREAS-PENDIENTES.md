# Tareas pendientes — por tu parte (Juan)

> Cosas que el código **no puede hacer solo** y dependen de ti (cuentas, IDs,
> despliegues, datos reales). Marca las casillas a medida que las completes.
> Última actualización: 2026-06-11.

---

## 🔴 Bloqueantes para poder pagar pauta medible

Sin esto, las campañas gastarían presupuesto a ciegas (sin medir conversiones).

### 1. Crear cuentas de medición y poner los IDs

- [ ] **Google Analytics 4** → crear propiedad y copiar el ID (`G-XXXXXXX`).
- [ ] **Google Ads** → crear cuenta + una *acción de conversión*; copiar el ID (`AW-XXXXXXXXX`) y la *etiqueta de conversión*.
- [ ] **Meta (Facebook/Instagram) Pixel** → crear el pixel y copiar el ID numérico.

**Dónde se ponen:** en CADA archivo HTML, en el `<head>`, hay esta línea con los valores vacíos:

```html
<script>window.VELAI_TRACK={ga4:'',ads:'',adsLabel:'',pixel:''};window.VELAI_WA='15706160059';</script>
```

Rellena así (ejemplo):

```html
<script>window.VELAI_TRACK={ga4:'G-ABC123',ads:'AW-987654321',adsLabel:'AbCdEfg',pixel:'1234567890'};window.VELAI_WA='15706160059';</script>
```

> 💡 Cuando me pases los IDs, **yo los pongo en las ~11 páginas de una vez** y subo el `?v=` del script. No hace falta que los edites a mano.

Mientras estén vacíos: el banner de cookies y la captura de UTM **sí** funcionan; lo que no se carga es Google/Meta.

### 2. Redeployar el Cloudflare Worker

- [ ] Desplegar `vai-worker.js` para activar la nueva ruta **`/lead`** (la que recibe los formularios del funnel y avisa por Telegram).

Hasta que lo despliegues, el formulario de demo cae al **fallback de WhatsApp** (sigue siendo usable, pero no registra el lead en Telegram).

### 3. Verificar conversiones antes de invertir

- [ ] Con los IDs ya puestos: comprobar eventos en **GA4 DebugView**, **Google Ads** (estado de la conversión) y **Meta Events Manager → Test Events**.
- [ ] Confirmar que un envío de formulario dispara `lead_submit` y un clic en WhatsApp dispara `whatsapp_click`.

---

## 🟠 Para lanzar campañas

- [ ] **Definir presupuesto** y canal de arranque (Google Search vs Meta/Instagram).
- [ ] **Textos de anuncios** que coincidan con el titular de la landing `/lp/restaurantes/` (message match) — te puedo ayudar a redactarlos.
- [ ] **Creatividades** (imágenes/vídeo) para Meta si vas por ese canal.
- [x] **Página de privacidad/cookies** (RGPD): creada en `/privacidad/`. El banner de cookies y el footer ya enlazan a ella; está en el sitemap. ⚠️ **Falta que rellenes los datos fiscales** (razón social, NIF/CIF, domicilio) — están marcados con `[CORCHETES]` en la página.

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

- Fundación de medición + Consent Mode v2 + banner RGPD bilingüe (en las 8 páginas).
- Captura de UTM/gclid/fbclid con atribución end-to-end hasta el lead.
- Formulario cualificador con descalificación honesta (`<10 msg/día`).
- Endpoint `/lead` en el worker (notifica por Telegram).
- WhatsApp unificado: **todos los enlaces públicos van al bot Vai** (15706160059).
- Notificaciones a founders: se mantienen **solo como aviso**; toda interacción del cliente es con el bot.
- Landing de Restaurantes: versión SEO (`/restaurantes/`) + versión de pauta (`/lp/restaurantes/`, noindex).
- **Conversión de Google Ads cableada** (`funnel.js` v2): los eventos de alta intención (envío de formulario, clic en WhatsApp, diagnóstico y cotizador completados) ya disparan `gtag('event','conversion')` con tu `adsLabel`. Antes el `adsLabel` se leía pero no se usaba → Google Ads no podía medir conversiones. **En cuanto pongas los IDs, la medición de pauta funciona.**
- Página de Política de Privacidad y Cookies (`/privacidad/`), RGPD + LSSI, enlazada desde el banner de cookies y el footer.
