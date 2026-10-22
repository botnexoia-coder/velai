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
| 4 | Alta en el panel: equipo, plantilla, contexto. El primario es web o WhatsApp (no hay clientes solo-red) | V |
| 5 | **Plan y módulos → Messenger**: si su plan no lo incluye (Esencial), actívalo ahí como red adicional — no ocupa plaza. Profesional y Empresa lo traen; si alguien lo apagó, «Usar lo que incluye el plan» | V |
| 6 | Identidad y canal → «ID de la página» → Conectar (el panel pone el prefijo `messenger:`) | V |
| 7 | Si lleva web: snippet en su página (ver "Ruta solo web"), su dominio en `web_origins` de su ficha (CORS al instante, sin deploy) y «Sincronizar Turnstile» | V |
| 8 | Prueba end-to-end | V |

> Apagar Messenger en «Plan y módulos» (o bajar a Esencial sin excepción) **no desconecta
> la página**: el bot deja de atenderla —200 con TwiML vacío y log `channel_disabled`— y
> vuelve a atender en cuanto se re-enciende, sin reconectar nada.

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
<script src="https://hirevai.com/assets/vai.js" defer></script>
```

Su dominio (apex y www) en `web_origins` de su ficha + botón «Sincronizar Turnstile». Sin deploy.
La marca del widget (logo, colores, saludo, chips) se edita en el panel, nunca en el HTML.

## Prospectos (negociación abierta)

Fila con `channel_address = pending:<slug>` y **Activo desmarcado**: el contexto queda
escrito y versionado sin atender a nadie (el panel la marca `prospecto`). Un prospecto no
puede activarse hasta ponerle su canal real — el panel lo rechaza. Al cerrar el trato:
canal real + circuito de la Ruta B, marcar Activo y guardar. Sin deploy.

## Espacio de Velai (solo con acuerdo)

Por defecto un cliente **no** aparece en el selector «Espacio» del panel y Velai no
puede atender sus conversaciones. Solo si es empresa propia o hay un acuerdo firmado:
ficha → «Identidad y canal» → **Espacio de Velai** → «Aparece en el selector Espacio»
y, si además Velai va a responder por él, «Velai puede tomar el control de sus
conversaciones». Guardar. Queda en el Historial. Sin deploy. Detalle en
`docs/OPERATIONS.md` → «Espacios de Velai».

## Baja de un cliente

Borrar el sender, retirar el socio en Meta si lo hubiera, **Activo desmarcado** en el panel
(la fila nunca se borra: los leads apuntan a `tenant_id`), y purgar sus leads según la retención.
Si tenía «Espacio de Velai», apágalo: un cliente inactivo ya no abre, pero así no
vuelve a aparecer si se reactiva.


### Plan y módulos (0043, disponible tras el CD)

El alta incorpora «Plan y módulos» después de Identidad. El plan inicial es Esencial:
una plaza de conversación (web **o** WhatsApp). Profesional y Empresa permiten
varios canales e incluyen Calendario; Empresa tiene por ahora las mismas funciones
implementadas. Telegram no consume plaza. Citas y Eventos se conceden aparte.

Citas requiere Calendario. Concederlo no enciende reservas ni confirmaciones: esos
interruptores se configuran en Calendario. Revocarlo apaga ambos en la misma
transacción. «Usar lo que incluye el plan» elimina la excepción; una concesión
explícita se conserva al cambiar de plan. Bajar a Esencial exige dejar como máximo
un canal configurado. Un prospecto con WhatsApp ya enrutado se activa usando ese
canal, sin añadir web por defecto.
