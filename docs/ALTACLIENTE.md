# Alta de un cliente — runbook operativo

> Requiere los PR 1–3 de `docs/PLAN-ALTA-CLIENTES.md` (desplegados el 2026-08-17).
> `window.VELAI_TENANT` funciona desde el PR 1 — no antes. El alta de la fila se hace
> **desde el panel** (`admin.hirevai.com` → Clientes), nunca por SQL: así queda versionada.
> Los contextos preparados viven en `tenants/<slug>.md` — copiar/pegar y "Probar" antes de guardar.

*C = cliente · V = Velai*

## Ruta A — Messenger y/o web: sin un solo trámite

| # | Paso | Quién |
|---|---|---|
| 1 | Te asigna su página de Facebook como socio (o te hace admin) | C |
| 2 | Conectas la página en Twilio → Messenger (hasta **25 páginas** por cuenta/subcuenta) | V |
| 3 | Webhook al worker de siempre (`https://vai-worker.botnexo-ia.workers.dev`) | V |
| 4 | Alta en el panel: `channel_address = messenger:<pageId>`, equipo, plantilla, contexto | V |
| 5 | Si lleva web: script inline `window.VELAI_TENANT='<slug>'` **antes** del `<script src=…vai-widget.js>` en su página, su dominio en `ALLOWED_WEB_ORIGINS` (wrangler.toml → deploy del Worker) **y** en los hostnames del widget de Turnstile | V |
| 6 | Prueba end-to-end | V |

> ⚠️ Primera prueba real de Messenger: verificar que el canal acepta la respuesta TwiML.
> Si no, cambiar a envío por API con `MessagingServiceSid`. Comprobar ANTES de prometer
> el canal a un cliente. Los adjuntos sin texto (stickers/fotos) se ignoran con 200.

## Ruta B — WhatsApp con la WABA del cliente

| # | Paso | Quién |
|---|---|---|
| 1 | Crea su Business Portfolio (o usa el que ya tenga si hace anuncios) | C |
| 2 | Verifica su negocio con su CIF | C |
| 3 | Añade a Velai como **socio** con permisos sobre la WABA | C |
| 4 | Subcuenta `cliente-<slug>`: botón **"1· Crear subcuenta"** en la ficha del panel (crea, cifra el token y lo guarda solo — las 4 primeras ya existen y se quedan como están). **Tope de gasto a mano** en la consola: la API no lo permite y el panel lo recuerda | V |
| 5 | Registras el sender con la WABA **del cliente** (Embedded Signup; el OTP lo recibe él) | V+C |
| 6 | Display name = su marca, exacta — cambiarlo después exige ticket de soporte | V |
| 7 | Perfil del sender con los datos del cliente | V |
| 8 | Webhook de la subcuenta → `https://vai-worker.botnexo-ia.workers.dev` | V |
| 9 | Plantilla `nuevo_lead_<slug>` Utility: botón **"2· Plantilla → aprobación"** (el cron avisa por Telegram cuando Meta la apruebe; hasta entonces el aviso queda `skipped: template_not_approved`) | V |
| 10 | Alta/edición en el panel: canal, subcuenta (AC…), WABA, **auth token** (write-only, se guarda cifrado), plantilla, equipo, contexto, socio = concedido | V |
| 11 | Prueba end-to-end + firma validada con el token de la subcuenta (si falta el token, el worker rechaza con `twilio_auth_token_missing` y avisa a Telegram) | V |

**Antes de prometer fechas:** su número no puede tener WhatsApp activo; si lo tiene, hay
que eliminar esa cuenta y **pierde su historial**. Esa conversación va primero.

## Prospectos (negociación abierta)

Fila con `channel_address = pending:<slug>` y **Activo desmarcado**: el contexto queda
escrito y versionado sin atender a nadie (el panel la marca `prospecto`). Un prospecto no
puede activarse hasta ponerle su canal real — el panel lo rechaza. Al cerrar el trato:
canal real + subcuenta + token + plantilla + equipo, marcar Activo y guardar. Sin deploy.

## Baja de un cliente

Borrar el sender, retirar el socio en Meta, **Activo desmarcado** en el panel (la fila
nunca se borra: los leads apuntan a `tenant_id`), y purgar sus leads según la retención.
