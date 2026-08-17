# Operaciones — leads y panel de Velai

> **Estado (2026-08-17): TODO EN PRODUCCIÓN.** D1 `vai-leads` creada y migrada, widget
> Turnstile invisible activo (sitekey en los 26 HTML), secrets cargados, Worker
> desplegado con cron, panel en `admin.hirevai.com` tras Access, y avisos de Telegram
> verificados end-to-end (lead real → D1 → Telegram). Los pasos de abajo quedan como
> referencia para recrear el entorno. **Pendiente**: variables `TEAM_WHATSAPP` y
> `TWILIO_FROM` (el canal whatsapp queda en `skipped` y se activará solo al ponerlas)
> y el riesgo legal del final.

## Recursos Cloudflare (orden de puesta en marcha — ya ejecutado)

1. Crear la base: `npx wrangler d1 create vai-leads`. *(Hecha: id `4b3056eb-6dee-44a4-8d17-5a80af740ca5`.)*
2. Copiar el UUID a `wrangler.toml` y ejecutar `npx wrangler d1 migrations apply vai-leads --remote`.
3. Crear un widget Turnstile de **tipo Invisible** (el tipo se elige en el dashboard; el código usa `execution:'execute'`) con los hostnames `hirevai.com`, `www.hirevai.com` **y** `velai-dey.pages.dev`. *(Hecho: widget `velai-web`.)*
4. Sustituir `REPLACE_WITH_TURNSTILE_SITE_KEY` en los 26 HTML por la site key pública. `npm run check` falla mientras quede algún marcador (en CI de ramas puede saltarse con `CHECK_ALLOW_PLACEHOLDERS=1`; el deploy real nunca). *(Hecho.)*
5. Guardar `TURNSTILE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `TELEGRAM_TOKEN`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TELEGRAM_CHAT_ID` como secrets (`npx wrangler secret put <NOMBRE>`). *(Hechos.)*
6. Configurar `TEAM_WHATSAPP`, `TWILIO_FROM` y `TWILIO_LEAD_TEMPLATE_SID` (formato `whatsapp:+E164`; el SID es de la plantilla aprobada `velai_nuevo_lead`). *(Hechos.)* **El aviso por WhatsApp va SIEMPRE por plantilla** (`ContentSid`) — texto libre fuera de la ventana de 24 h devuelve `Undelivered 63016`, que es lo que tuvo el canal roto desde junio (ver `docs/FASE0-TWILIO-PLANTILLA.md`). Pendiente: duplicar la plantilla en categoría **Utility** y actualizar el SID.
7. Desplegar el Worker: `npx wrangler deploy`. Verificar en **Workers → vai-worker → Settings → Triggers** que el cron `*/5 * * * *` quedó registrado. *(Hecho.)*

No desplegar con el UUID D1 de ceros ni con el marcador de Turnstile. **No quitar de `wrangler.toml` los bindings `KV` y `DB`**: un deploy sin ellos los elimina del Worker (sin `KV`, `/chat` responde 503 y el rate limit se desactiva).

### Lecciones aprendidas del primer deploy (no repetir)

- **`keep_vars = true` es obligatorio**: sin él, cada `wrangler deploy` borra las
  variables puestas a mano en el dashboard (así se perdió `TELEGRAM_CHAT_ID` y los
  avisos quedaron en `skipped`). Las credenciales van como **secrets**, que nunca se pisan.
- **Declarar `routes` desactiva `workers.dev`** salvo `workers_dev = true` explícito —
  y todo el frontend llama a `vai-worker.botnexo-ia.workers.dev`. Ambas líneas ya
  están en `wrangler.toml` con su comentario.

### Orden de despliegue Pages ↔ Worker

Pages despliega **automáticamente** al hacer push a `main`; el Worker se despliega **a mano** con wrangler. El `POST /` JSON antiguo devuelve 410, así que el HTML/JS nuevo y el Worker nuevo deben ir juntos: primero deja el Worker listo (pasos 1–7), después mergea el sitio. Los previews de rama (`https://<rama>.velai-dey.pages.dev`) solo funcionan contra el Worker si su origen exacto está en `ALLOWED_WEB_ORIGINS` (`wrangler.toml`) **y** en los hostnames del widget Turnstile — no hay comodín `*.pages.dev` a propósito.

## Panel administrativo — OPERATIVO en `admin.hirevai.com`

Cómo quedó montado (referencia para recrearlo):

1. `admin.hirevai.com` es dominio personalizado del Worker (declarado en `routes` de `wrangler.toml`). El hostname del panel se deriva de `ADMIN_ORIGIN`; si se cambia de dominio, basta cambiar esa variable.
2. Aplicación self-hosted "Velai Leads Panel" en Cloudflare Access para ese hostname (Zero Trust → Access → Applications).
3. One-time PIN y política Allow limitada a los emails del equipo.
4. `TEAM_DOMAIN` (`https://silent-pond-acd1.cloudflareaccess.com`) y `POLICY_AUD` cargados como secrets del Worker. Truco: ambos se pueden leer de la URL de redirección del login de Access — el parámetro `kid` es el AUD.
5. Verificado: sesión anónima → 302 al login de Access; el Worker rechaza JWT ausentes o inválidos (firma vía JWKS, `iss`, `aud`, `exp` y `alg`); el panel y su API solo responden en el hostname de `ADMIN_ORIGIN`, así que en `*.workers.dev` no están expuestos (404).

## Entrega y recuperación

- D1 confirma el lead antes de responder éxito al navegador. **Si D1 cae, el lead no se pierde**: se envía el aviso directo a Telegram/WhatsApp, se encola en KV (TTL 7 días) y el cron lo re-inserta en D1 cuando vuelve. La respuesta indica la garantía: `stored: "d1" | "kv" | "notification"` con `degraded: true` en contingencia — si aparece en logs (`lead_d1_fallback`, `lead_degraded`), revisar el estado de D1.
- Telegram y WhatsApp son avisos secundarios. El cron (cada 5 min) reintenta fallos hasta cinco veces; un canal sin configurar queda en `skipped` y se revisita cada 6 h, así que al configurarlo el aviso sale solo.
- El chat web y el **WhatsApp entrante** también capturan leads: en WhatsApp el teléfono es el `From` de Twilio, una sola vez por remitente, cuando la conversación muestra intención comercial.
- El panel permite cambiar estado, anotar, reintentar avisos, exportar CSV y eliminar solicitudes RGPD.
- Los leads se eliminan 24 meses después de la última actividad (`LEAD_RETENTION_MONTHS`).
- Los logs usan IDs y códigos de error, nunca contenido del chat ni teléfonos.

## Desarrollo local

```bash
cp .dev.vars.example .dev.vars   # nunca commitear .dev.vars (está en .gitignore)
npx wrangler dev                 # worker local en :8787 con D1/KV locales
python3 -m http.server 8080      # sitio estático
```

La test key de Turnstile del example siempre valida. `ALLOWED_WEB_ORIGINS` del `.dev.vars` debe incluir el origen del servidor estático.

## Validación y rollback

Ejecutar `npm run check` antes de desplegar (sintaxis JS, validación de las 26 páginas, marcadores sin sustituir y tests del Worker). Después, enviar un lead de prueba y verificar D1, Telegram, WhatsApp y el panel; comprobar que la respuesta fue `stored: "d1"` sin `degraded`. Para rollback, conservar D1 y volver a la versión anterior del Worker/Pages; la migración es aditiva y no debe revertirse destruyendo datos.

## Riesgo legal pendiente

La web identifica por ahora únicamente el nombre comercial Velai. **No activar campañas de pago** hasta validar con asesoría y publicar el titular, NIF y domicilio que correspondan conforme al artículo 10 de la LSSI (las plataformas de anuncios exigen además una política de privacidad válida). El derecho de supresión ya es operativo: solicitudes a `privacidad@hirevai.com` se atienden con el botón «Borrar lead» del panel.
