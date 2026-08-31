# Panel v2 — lo que falta por migrar

Primera entrega (hecha): shell con navegación por rol y tema, Dashboard, Leads
(filtros + cursor + detalle + CSV + escalaciones), Conversaciones (bandeja completa:
cola, takeover/release, responder, ventana de 24 h, contadores por canal, disponibilidad,
filtros, export). Todo lo demás enseña «En construcción» y sigue viviendo en el panel v1.

La referencia de comportamiento de CADA vista pendiente es `worker/admin-panel.js`
(y su markup en `worker/admin-page.js`): portar, no inventar.

## Vistas pendientes

### Conexiones (`/conexiones`)
La vista más grande. Por bloques:
- **Tira de canales del cliente**: `GET /api/admin/tenants/:id/channels` (estados ya
  colapsados por rol en el worker: on/preparing/unrouted/off/soon — dos vocabularios).
- **Asistente de Telegram** (riel de 5 pasos, marca blanca):
  `GET/PATCH/DELETE /api/admin/tenants/:id/telegram`,
  `POST /api/admin/tenants/:id/telegram/link` (enlace que caduca en 15 min),
  `POST/DELETE /api/admin/tenants/:id/telegram/bot` (token write-only),
  `POST /api/admin/tenants/:id/telegram/topics` y
  `PATCH/DELETE /api/admin/tenants/:id/telegram/topics/:threadId`.
  Ojo: los pasos «hechos» los marca el estado real del servidor; los pasos sin señal
  (grupo, permisos) se confirman con su botón y viven solo en memoria (tgManual).
- **Horario de atención humana** (interruptor por día, dos tramos, tz):
  se LEE de `GET /api/admin/availability?tenant=` (devuelve el horario en vigor con el
  default aplicado) y se guarda con `PATCH /api/admin/tenants/:id/notify`
  (`support_hours` como JSON string + `support_tz`). Un objeto vacío = «nunca se ofrece
  asesor» y hay que decirlo (shSummary).
- **Quién recibe los avisos + números de WhatsApp**: `GET /api/admin/tenants/:id/whatsapp`
  (estado del sender en lenguaje de negocio + alerts) y `PATCH /:id/notify`
  (`team_whatsapp`, `wa_number`). La guarda del 63031 (número del bot) la pone el worker.
- **Informe semanal**: interruptor (`PATCH /:id/notify` con `weekly_report`) y
  `POST /api/admin/tenants/:id/report/test`; el último envío viene en el GET de telegram
  (`lastReport`).
- **Logo en autoservicio**: `POST /api/admin/tenants/:id/logo?channels=web,whatsapp`
  (cuerpo binario, máx. 2 MB, magic bytes en el worker) y
  `POST /api/admin/tenants/:id/logo/apply` (reaplicar a WhatsApp sin resubir).
- **Solo Velai**: `POST /:id/provision/sender/sync`, `POST /:id/provision/sender/profile`,
  `POST /api/admin/telegram/setup` (webhook del bot, una vez), toggle de marca blanca.

### Clientes y ficha (`/clientes`, solo velai)
- Listado: `GET /api/admin/tenants` (semáforo de configuración por columnas has_*).
- Ficha con pestañas y UN solo Guardar (punto ámbar por pestaña sucia, confirmación al
  descartar): `GET/PATCH /api/admin/tenants/:id` con `expected_updated_at` (el 409
  `stale_tenant` existe y hay que respetarlo), `POST /api/admin/tenants` (alta guiada
  por stepper: el borrador nace prospecto `pending:<slug>` y se promueve al activar).
- Contexto: contador de tokens, duplicar de otro cliente, probar borrador
  (`POST /:id/preview`), cupos de IA (`ai_monthly_tokens`, `ai_daily_limit`).
- Marca del widget con previsualización en vivo (mini-mock del chat) y subida de logo
  (`POST /:id/logo`); sincronizar Turnstile (`POST /:id/provision/domains`).
- Aprovisionamiento Twilio: `POST /:id/provision/{subaccount,template,template/check,
  template/resubmit,sender,sender/verify}` — provPost SIEMPRE recarga la ficha entera
  (regla §7: evita stale_tenant y no pisa SIDs recién creados).
- Usuarios del panel: `GET/POST /:id/users`, `DELETE /:id/users/:email` (avisos del
  estado de la puerta de Access: sincronizado/pendiente/manual).
- Historial: `GET /:id/versions`, `POST /:id/versions/:vid/restore`.

### Calendario (`/calendario`)
- `GET/PATCH/DELETE /api/admin/tenants/:id/calendar`,
  `POST /api/admin/tenants/:id/calendar/connect` (OAuth de Google; al volver, el
  callback redirige con `#calendar=ok:<tenantId>` — hay que leer ese hash al arrancar).
- Citas del mes: `GET /api/admin/appointments?tenant=&from=&to=` (el corte por tz se
  hace al pintar, con la tz del calendario).
- Rejilla mensual estilo Google (chips por día, modal del día), config de citas
  (calendar_id, tz, slot_minutes, horario laboral: vacío → null, JAMÁS `{}` — un `{}`
  significa «ningún hueco jamás»).
- Para velai: selector de cliente y «Volver a Clientes».

### Canales (`/canales`, solo velai)
- `GET /api/admin/channels`: la tabla de ENRUTADO real + `unrouted` (números vivos en
  Twilio que nadie atiende — siempre visibles, nunca los esconde el filtro).
- Filtrado 100% en cliente (búsqueda sin acentos y sin prefijo `whatsapp:`), píldora
  global con el TOTAL del sistema, no lo filtrado.

### Configuración (`/configuracion`, solo velai; el worker exige raíz con 403 root_only)
- Admins: `GET/POST /api/admin/admins`, `DELETE /api/admin/admins/:email`.
- Estado de integraciones: `GET /api/admin/config` (tarjetas con semáforo).
- Token de Cloudflare (write-only): `POST/DELETE /api/admin/config/cf-token`.
- Webhook de Telegram (solo lectura, bajo demanda): `GET /api/admin/config/telegram-webhook`.

## Piezas transversales pendientes

- **Avisos sonoros y notificaciones** (botón del sidebar): sondeo de
  `GET /api/admin/alerts` cada 30 s SIN mirar visibilityState (es el caso que cubre),
  primer sondeo solo fija referencia, beep con Web Audio (oscilador — la CSP no declara
  media-src), Notification API solo tras gesto del usuario, preferencia en sessionStorage.
- **Infraestructura Cloudflare** en el dashboard (solo velai):
  `GET /api/admin/infra-usage` con los límites del plan gratuito y el caso
  `cloudflare_analytics_denied` explicado.
- **Deep-linking**: `/leads?estado=…` y `/conversaciones?c=<id>` en la URL (el v1 no lo
  tenía; con react-router es barato y hace compartibles las vistas).

## Deuda consciente de esta entrega

- El botón «Filtrar» de Leads no repuebla el select de Fuente con la elegida si esa
  fuente desaparece de los datos (el v1 la re-inyectaba para que el filtro siguiera
  diciendo la verdad). Menor: solo pasa si se borra el último lead de esa fuente.
- `composerKey` está portado y testeado pero el cajón usa estado por conversación de
  React (equivalente en la práctica: el polling no borra el borrador). Si algún día el
  cajón se repinta por algo más que la conversación abierta, usarlo como `key=`.
- El export CSV navega con `window.location.href` (como el v1): no pasa por api() y no
  enciende la barra de actividad.
