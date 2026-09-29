# SPEC — Notificación de cita agendada y texto editable de las plantillas de citas

Fecha: 2026-09-29 · Estado: implementado en rama, pendiente de migrar (0047) y desplegar.

Dos peticiones del cliente:

- (3) «No se está enviando la notificación al WhatsApp una vez queda agendada una cita».
- (4) «Agregar la plantilla en Plantillas para esa notificación, que el cliente pueda modificarla a su gusto, siguiendo los parámetros».

## 1. Diagnóstico de (3) — causa raíz, con evidencia de producción

Consultas de solo lectura a `vai-leads` (D1 remota) el 2026-09-29:

| Dato | Resultado |
|---|---|
| `tenant_templates` | **1 fila en total**: `dialogos / recordatorio_cita / approved`. **Ningún tenant tiene `confirmacion_reserva`.** |
| `booking_notifications` | 14 filas, todas de gogestion, **todas `pending` con `attempts=0`** (del 23 al 28 de septiembre) |
| `tenants.reminders_enabled` | 1 solo en gogestion y zoe; 0 en dialogos (que es quien tiene el recordatorio aprobado) |
| `appointment_reminders` | vacía: no ha salido ni un recordatorio nunca |
| `appointments` recientes | `web_reserva` (gogestion, zoe, dialogos), `whatsapp` (gogestion, 3 el 24-09) y `web` (tufisiooficial) |

Causa raíz, por capas:

1. **No existe la plantilla `confirmacion_reserva` para ningún cliente.** `processBookingNotifications` hace JOIN con `tenant_templates … kind='confirmacion_reserva' AND status='approved'`, así que no encuentra nada que entregar: las filas se quedan `pending` para siempre. El único camino para crearla era el chip «Crear» de la vista Plantillas de Velai; al cliente se le decía «Escríbenos». Nadie la creó.
2. **La siembra dependía del addon de recordatorios** (`reminders_enabled=1`) y **solo del canal `web_reserva`**. Las citas que agenda Vai por WhatsApp o por el chat web no generaban notificación nunca, y un tenant con la plantilla pero sin el addon tampoco la habría enviado.
3. Cuando existía la plantilla, **su cuerpo terminaba en variable** (`…aquí: {{5}}`), algo que Meta rechaza: aunque se hubiera creado, lo más probable es que no se hubiera aprobado.
4. Colateral: la página de reservas promete «Te lo confirmamos por WhatsApp» siempre (`reserva-page.js`), así que el cliente final lo espera.

Canales que crean citas: la web de reservas (`web_reserva`), Vai en el chat web (`web`) y Vai dentro de WhatsApp/Messenger (`whatsapp`/`messenger`); todos pasan por `bookAppointment`. El panel no crea citas a mano. Los eventos creados directamente en Google Calendar no son citas de Velai (solo ocupan hueco) y no tienen teléfono al que avisar.

Dónde se procesa: `waitUntil` tras reservar o reagendar en la web (routes/reserva.js), el cron de 5 min (`scheduled`) y, desde ahora, también tras la reserva en el chat web.

## 2. Decisiones

- **La confirmación NO depende de `reminders_enabled`.** El addon es el recordatorio programado (cron, antelación, botones) y lo enciende Velai. La confirmación es el acuse inmediato de algo que el cliente final acaba de hacer, y la página de reservas ya la promete. Lo que da el visto bueno es **tener la plantilla `confirmacion_reserva` creada y aprobada**, que siempre es un acto explícito (Velai o el propio cliente desde su vista).
- **Solo se siembra si la plantilla ya está aprobada.** Así no se acumulan filas `pending` para siempre y una aprobación tardía no manda confirmaciones viejas. Además, el envío descarta las citas creadas hace más de 2 h (`BOOKING_NOTIFY_FRESH_MS`): las 14 filas pendientes de gogestion **no saldrán** al aprobarse su plantilla.
- **Por canal:**
  - `web_reserva` y `web` (chat): plantilla al teléfono que dio el cliente. No hay ventana de 24 h abierta.
  - `whatsapp` / `messenger` con Vai: **no se manda plantilla**. La ventana está abierta y Vai ya confirma fecha y hora en el propio hilo, así que la plantilla sería un duplicado y costaría un mensaje. Lo que faltaba era el **enlace privado de gestión**: se añade de forma determinista al final de la respuesta de Vai (`withManageLink`), una sola vez y sin pasar por el modelo, que no puede mutilarlo ni inventarlo. En el chat web se añade también.
- **Texto editable dentro del contrato.** El cliente escribe con variables con nombre de una lista cerrada por plantilla y el worker las numera `{{1}}..{{n}}` por orden de aparición. Quien envía numera **a partir del mismo texto guardado**, así que el contrato no puede desalinearse. Botones y payloads siguen siendo curados.
- **El cliente guarda sin pasar por solicitud a Velai.** Las puertas son `validarTexto` (contrato + reglas de Meta) y la propia revisión de Meta. Hay una revisión a la vez (409 `plantilla_en_revision`) y un freno de 3 por minuto. Velai recibe el aviso de auditoría por Telegram. Botones y antelación siguen yendo por solicitud.
- **Revisión sin hueco.** Si ya hay una plantilla aprobada, la nueva entra como revisión (`revision_*`) y **la aprobada sigue enviándose** hasta que Meta resuelva. Si Meta la aprueba, el poll la promueve entera (sid + texto + opciones); si la rechaza, se guarda el motivo y la activa no cambia. Esto vale también para el cambio de botones por solicitud, que antes dejaba la fila en `pending` y cortaba los recordatorios durante la revisión.
- **Nombre de revisión con sufijo** (`<nombre>_rYYYYMMDDHHMM`): en Meta el nombre de una plantilla es único por WABA.

## 3. Diseño

### Variables por plantilla (`worker/plantillas.js`, `texto.campos`)

| Clave | Etiqueta | confirmacion_reserva | recordatorio_cita |
|---|---|---|---|
| `nombre` | Nombre del cliente | sí | sí |
| `negocio` | Tu negocio | sí | sí |
| `servicio` | Servicio | sí | sí |
| `fecha` | Fecha | **obligatoria** | **obligatoria** |
| `hora` | Hora | **obligatoria** | **obligatoria** |
| `enlace` | Enlace de gestión | **obligatoria** | no (los botones ya gestionan) |

En el recordatorio, el id de la cita viaja en la variable siguiente a las del cuerpo, dentro de `conf:{{n+1}}` / `canc:{{n+1}}`. Con el texto por defecto (`texto` NULL) la numeración es la de siempre (1..5 + 6 = id): la plantilla ya aprobada de dialogos sigue recibiendo exactamente las mismas variables. Hay un test que lo fija.

### Reglas (`validarTexto`, única fuente; el panel pregunta con `validar:true`)

Variables desconocidas (también `{{1}}` escrito a mano) o repetidas; faltan obligatorias; empieza o termina en variable; dos variables juntas (solo espacios entre ellas); llaves sueltas; más de una línea en blanco seguida; tabuladores o 5+ espacios; demasiadas variables para el texto (menos palabras que 2×variables); cuerpo numerado de más de 1.024 caracteres.

### API

`POST /api/admin/tenants/:id/plantillas/:kind` con `{ texto, validar? }`, abierta al rol cliente (`clienteAllowed`, `assertOwnTenant`, módulo `calendario` vía `RUTA_MODULO` y en el handler). Con `validar:true` responde `{ok, errores[{code,clave}], preview, longitud}` sin efectos. Sin él, 201 `{modo: 'revision'|'principal'}`, o bien 400 con el código del primer error (`why` = la clave), 409 `plantilla_en_revision` o 400 `nothing_to_update`.

`GET /api/admin/plantillas` añade en `config.texto` `{defecto, max, campos}` por kind y, en cada celda, `texto` y `revision {status, texto, motivo, at}`.

### Datos — `migrations/0047_plantilla_texto.sql`

`tenant_templates` + `texto`, `revision_sid`, `revision_status`, `revision_texto`, `revision_opciones`, `revision_motivo`, `revision_at`. Es aditiva. Se numera 0047 porque la 0046 puede estar ocupada en otra rama: si al fusionar queda hueco o choque, **renumerar**. Aplicar con `d1 migrations apply` (el CD) antes del worker nuevo.

### Panel

`components/EditorTexto.tsx` en la tarjeta del cliente para cada kind con `config.texto`, y en la de Velai cuando filtra por un cliente. Incluye:

- chips que insertan `{{clave}}` en el cursor (las obligatorias van con `*`);
- vista previa inmediata con el nombre real del negocio;
- validación del worker a los 400 ms de dejar de escribir, con los errores en palabras;
- contador sobre el cuerpo numerado;
- «Texto por defecto», y envío con confirmación.

Con una revisión pendiente el editor queda bloqueado y se avisa de que sigue en uso la aprobada. Si Meta la rechaza, se enseña el motivo y se parte del texto rechazado para corregirlo.

## 4. Verificación

- `npm run check`: 325 tests backend, incluido el nuevo `test/plantilla-texto.test.js`. Pasan también el aislamiento y el catálogo de tests.
- `npm run test:panel`: 187 tests, con `EditorTexto.test.tsx`.
- `panel/e2e/plantillas.spec.ts`: build real contra router y D1 reales (con la 0047) y Twilio simulado. Capturas en claro, oscuro y móvil. Los 34 e2e en verde.

## 5. Pendiente en producción (tras desplegar)

- **Crear y aprobar `confirmacion_reserva`** para los tenants con reservas: gogestion, zoe, dialogos y tufisiooficial. Puede hacerlo el cliente desde Plantillas («Personalizar y crear») o Velai con el chip «Crear». Hace falta subcuenta de Twilio: **tufisiooficial no tiene WhatsApp (`twilio_from` NULL)**, así que no puede recibir confirmaciones hasta aprovisionarlo.
- **Recordatorios parados:** gogestion y zoe tienen `reminders_enabled=1` pero **no tienen plantilla `recordatorio_cita`**. dialogos tiene la plantilla aprobada pero el addon apagado. Decidir y corregir desde el panel.
- Las 14 filas `pending` de gogestion en `booking_notifications` no saldrán (regla de las 2 h). Pueden quedarse como histórico.
