# Alta de un cliente — runbook operativo

> Actualizado el 2026-08-22 tras el primer alta e2e real (Diálogos). El alta de la fila se
> hace **desde el panel** (`admin.hirevai.com` → Clientes), nunca por SQL: así queda versionada.
> Los contextos preparados viven en `tenants/<slug>.md` — copiar/pegar y "Probar" antes de guardar.

*C = cliente · V = Velai*

## Ruta A — Messenger y/o web: sin un solo trámite

| # | Paso | Quién |
|---|---|---|
| 1 | Te asigna su página de Facebook como socio (o te hace admin) | C |
| 2 | Conectas la página en Twilio → Messenger (hasta **25 páginas** por cuenta/subcuenta) | V |
| 3 | Webhook al worker (`https://vai-worker.botnexo-ia.workers.dev` — los webhooks servidor-a-servidor siguen ahí; `api.hirevai.com` es para el navegador) | V |
| 4 | Alta en el panel: `channel_address = messenger:<pageId>`, equipo, plantilla, contexto | V |
| 5 | Si lleva web: snippet en su página (ver "Ruta solo web"), su dominio en `web_origins` de su ficha (CORS al instante, sin deploy) y «Sincronizar Turnstile» | V |
| 6 | Prueba end-to-end | V |

> ⚠️ Primera prueba real de Messenger: verificar que el canal acepta la respuesta TwiML.
> Si no, cambiar a envío por API con `MessagingServiceSid`. Comprobar ANTES de prometer
> el canal a un cliente. Los adjuntos sin texto (stickers/fotos) se ignoran con 200.

## Ruta B — WhatsApp (Self Sign-up en la consola) — VALIDADA e2e con Diálogos el 2026-08-22

**Prerequisito, y va primero la conversación:** el número del cliente NO puede tener WhatsApp
activo. Si lo tiene, hay que eliminar esa cuenta desde la app (pierde su historial) y esperar
unos minutos.

| # | Paso | Quién |
|---|---|---|
| 1 | Ficha del panel → **«1 · Crear o adoptar subcuenta»**. Crea `cliente-<slug>` o, si ya existe (o hay un SID pegado sin token), la **adopta y recupera su auth token solo** — cero duplicados y nada que copiar de Keys & Credentials. **Tope de gasto a mano** en la consola: la API no lo permite y el panel lo recuerda | V |
| 2 | **«2 · Plantilla → aprobación»**: crea `nuevo_lead_<slug>` Utility y la envía a Meta (el cron avisa por Telegram cuando cambie de estado; hasta entonces el aviso por WhatsApp queda `skipped` y el de Telegram funciona) | V |
| 3 | **Self Sign-up** en la consola de Twilio, DENTRO de la subcuenta (verifica el SID arriba a la izquierda). La página es Messaging → Senders → **WhatsApp senders**; si el menú de la subcuenta no la muestra, URL directa `https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders` o el buscador 🔍. **OJO: el modal «Try out WhatsApp» es el SANDBOX, no el alta.** Botón «Create new sender» → popup de Meta → login del **cliente** → WABA → número → OTP. La URL del popup NO se puede compartir con el cliente (registro falla) — sesión juntos | V+C |
| 4 | Panel → Conexiones → cliente → **«Sincronizar desde Twilio»**: rellena solo WABA, sender, estado y número, y **repara el webhook** de la subcuenta. Si sale `OFFLINE`, esperar 2-5 min y re-sincronizar hasta **ONLINE** (cada sync refresca el estado) | V |
| 5 | Ficha → **Canal** = `whatsapp:+<número>` y guardar (la web sigue atendiendo por slug; el canal solo enruta los mensajes ENTRANTES de mensajería). El display name del sender = su marca exacta — cambiarlo después exige ticket de soporte | V |
| 6 | Prueba end-to-end: escribir al número desde un WhatsApp cualquiera → Vai contesta con SU contexto → el lead llega con el título del cliente a su Telegram + copia a Velai | V |

## Ruta "solo web" — el entregable sin trámites de Meta

Alta en el panel con `channel_address = web:<slug>` (activable), contexto, y **al menos un
canal de aviso** (Telegram del cliente en autoservicio desde Conexiones — asistente guiado).
En la web del cliente, antes de `</body>`:

```html
<script>window.VELAI_TENANT='<slug>';</script>
<script src="https://hirevai.com/assets/vai-widget.js?v=14" defer></script>
```

Su dominio (apex y www) en `web_origins` de su ficha + botón «Sincronizar Turnstile». Sin deploy.
La marca del widget (logo, colores, saludo, chips) se edita en el panel, nunca en el HTML.

## Prospectos (negociación abierta)

Fila con `channel_address = pending:<slug>` y **Activo desmarcado**: el contexto queda
escrito y versionado sin atender a nadie (el panel la marca `prospecto`). Un prospecto no
puede activarse hasta ponerle su canal real — el panel lo rechaza. Al cerrar el trato:
canal real + circuito de la Ruta B, marcar Activo y guardar. Sin deploy.

## Baja de un cliente

Borrar el sender, retirar el socio en Meta si lo hubiera, **Activo desmarcado** en el panel
(la fila nunca se borra: los leads apuntan a `tenant_id`), y purgar sus leads según la retención.
