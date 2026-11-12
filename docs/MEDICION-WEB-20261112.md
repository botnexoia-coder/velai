# Medición pública VELAI — 12 noviembre 2026

Web `hirevai.com`, Pages `velai`, raíz `site/`. Integración existente directa con gtag, sin añadir GTM ni usar activos de Zoe. IDs propios conservados: GA4 `G-8HC3SQ0T0Q`, Google Ads `AW-18250158066` / conversión `VMZdCLXFn8EcEPKfrf5D`, Meta `1928880717825520`. Cloudflare Web Analytics se conserva bajo permiso analítico.

## Comportamiento

- `funnel.js?v=10` conserva las llamadas existentes `velaiTrack`, la protección Turnstile y la decoración de enlaces. El código no se carga en el panel ni cambia el Worker.
- Preferencia nueva `velai-consent-v2` con categorías independientes; un consentimiento antiguo no autoriza automáticamente nuevas categorías. Banner ES/EN permite aceptar todas, esenciales o configurar. Botón de cookies permanente en las landings.
- Consent Mode v2 empieza denegado. No Google/Meta/Cloudflare Analytics hasta el permiso de su categoría. Analítica configura solamente GA y Cloudflare; publicidad configura solamente Ads/Meta. GA siempre usa destino `send_to` explícito; conversiones Ads conservan destino y etiqueta existentes y requieren publicidad.
- Retirada actualiza denegación, activa `ga-disable`, revoca Meta, elimina cookies accesibles de medición y recarga para detener código ya cargado. Si el navegador bloquea la persistencia, la denegación se conserva en memoria sin recargar para evitar restaurar un permiso anterior; GA/Meta quedan deshabilitados. Las cookies de terceros se gestionan desde el navegador.
- Se conservan eventos de CTA, WhatsApp, widget, formularios, calculadoras, tests y cotizador. El widget remoto ya emite `chat_open`, `chat_first_message`, etc.; no se añade otro observador que los duplique. `lead_submit` solo lo emite el consumidor después de respuesta HTTP correcta y `data.ok`. Un clic o completar una herramienta no demuestra cliente, mensaje enviado ni venta; algunos eventos de intención existentes conservan su conversión publicitaria.
- No se envían parámetros libres de formularios o chat. Lista cerrada de nombres de evento y campos de medición; se eliminan mensajes, teléfono, email, textos de error y query/hash arbitrarios. URL GA saneada y referrer origen+ruta. Campañas se capturan solo tras permiso, con claves conocidas y valores técnicos acotados, sin emails ni secuencias telefónicas. Click IDs requieren publicidad.
- Meta usa URL/referrer nativos de su librería: las URLs de campañas no deben contener datos personales. Coincidencia avanzada automática desactivada.

## Verificación local

`node --test test/site/funnel-consent.test.mjs`: siete comprobaciones de denegación inicial, categorías independientes/destinos, captura segura, retirada y almacenamiento bloqueado. `node --check site/assets/funnel.js`; `node scripts/check-site.mjs` (28 páginas). Verificación de recepción en Google/Meta requiere navegador real y sus paneles; estos checks locales no la sustituyen.

El test de sitio vive en `test/site/` y se ejecuta expresamente; no se mezcla con el catálogo backend ni exige desplegar el Worker. La versión del script sube en todas las páginas que lo cargan porque los JS usan caché immutable de un año.
