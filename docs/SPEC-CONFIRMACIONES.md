# SPEC — Confirmaciones de cita por WhatsApp (módulo tipo Confirmafy)

> Estado: BORRADOR para decisión de Juan (2026-09-01). Investigación: Confirmafy vende
> recordatorio + confirmación de citas por WhatsApp (el cliente responde Sí/No), sincronía
> con Google Calendar, autoagenda por enlace y reportes; cobra por volumen de citas
> (~12–31 USD/mes por 50–200 citas). Su cliente tipo es el nuestro: clínicas, estética,
> talleres, profesionales con cita previa. El dolor que resuelve: los no-shows.

## Por qué encaja (lo que YA existe)

| Pieza necesaria | Estado en Velai |
|---|---|
| Citas con teléfono del cliente | `appointments` (0012): `customer_phone NOT NULL`, timezone, `provider_event_id` de Google |
| Agendado | Vai agenda por chat (`agendar_cita`, exige nombre+teléfono+confirmación) — MEJOR que el form de Confirmafy |
| Canal WhatsApp por negocio | Subcuentas Twilio por tenant + maquinaria de PLANTILLAS con aprobación (aprovisionamiento del panel) |
| Motor de envíos con reintentos | Cron 1min/5min + patrón ledger (`lead_notifications`: pending/sent/failed/skipped, backoff) |
| Entrada de respuestas | Webhook Twilio ya enruta por tenant |
| Aviso al negocio | Telegram/WhatsApp dual ya montado |
| Panel | Vista Calendario (v2) lista para pintar estados |

Lo que falta es la CAPA DE RECORDATORIO: programar, enviar, entender la respuesta y
actualizar la cita. Todo lo demás es reutilización.

## Fase 1 — Recordar y confirmar (el corazón; mata el no-show)

1. **Migración `00XX_confirmaciones.sql`**
   - `appointment_reminders` (ledger, mismo molde que lead_notifications): appointment_id,
     kind ('previo_24h' | 'previo_2h'), status, attempts, next_attempt_at, sent_at, error.
   - `appointments`: + `customer_confirmed_at TEXT`, + `cancelled_by TEXT` ('customer'|'business'),
     y ampliar CHECK de status si hace falta (se mantiene confirmed/cancelled/error).
   - `tenants`: + `reminder_hours TEXT` (default `'24'`; CSV, p. ej. `'24,2'`),
     + `reminder_template_sid` / `reminder_template_status` (mismo ciclo de aprobación que
     la plantilla de leads), + `reminders_enabled INTEGER DEFAULT 0` (opt-in por tenant).
2. **Plantilla WhatsApp** (categoría **Utility**, recordatorio = mensaje iniciado por el
   negocio → SIEMPRE plantilla aprobada; lección del 63016): texto con variables
   (nombre, negocio, fecha/hora EN LA ZONA del negocio, motivo) y **botones quick-reply**
   «✅ Confirmo» / «❌ Cancelar». El paso de aprovisionamiento del panel gana un botón
   «Crear plantilla de recordatorios» (reutiliza `createTemplate` + el cron que vigila
   la aprobación).
3. **Cron (reloj de 5 min)**: por cada tenant con `reminders_enabled`, citas futuras
   `status='confirmed'` sin ledger para cada kind vencido (`starts_at - X horas <= now`)
   → sembrar ledger + enviar por la subcuenta del tenant. Reintentos y `skipped` como los
   avisos de lead. Cita a <X horas de crearse: se salta ese kind (no recordar lo recién
   agendado). Presupuesto: NO pasa por `aiBudgetGuard` (no hay modelo), sí log por envío.
4. **Respuesta del cliente** (webhook Twilio): si trae `ButtonPayload` (`conf:<id>` /
   `canc:<id>`) → camino DETERMINISTA sin modelo:
   - Confirmo → `customer_confirmed_at=now`, respuesta corta de cortesía (dentro de la
     ventana de 24h que abre el propio cliente al pulsar → texto libre permitido),
     aviso al negocio («María confirmó su cita del jueves 10:00»).
   - Cancelar → `status='cancelled', cancelled_by='customer'`, borrar/actualizar el
     evento de Google (código de calendario ya existente), aviso al negocio, y el hueco
     queda libre para `consultar_disponibilidad`. La respuesta invita a reagendar con
     Vai en el mismo chat (enlace natural a Fase 2).
   - Sin payload (texto libre «sí»/«no puedo») → sigue a Vai como conversación normal
     (Fase 2 le da herramientas para actuar).
5. **Panel (v2)**: en Calendario, chip de estado por cita (⏳ enviada / ✅ confirmada /
   ❌ cancelada por el cliente) + ledger en el detalle; en la config del calendario:
   interruptor, horas de antelación y estado de la plantilla.
6. **Tests**: molde de la casa — ledger por mutación, zona horaria (Madrid/Bogotá),
   idempotencia del cron, webhook con payload de botón (firma Twilio incluida),
   aislamiento por tenant (el barrido adversario cubre las rutas nuevas del panel).

**Coste variable**: cada recordatorio es una conversación Utility de Meta (céntimos;
verificar tarifa vigente ES/CO antes de fijar precios). A 200 citas/mes con 2
recordatorios ≈ pocos euros por tenant. La respuesta del cliente abre ventana de 24 h
(las contestaciones no cuestan plantilla).

## Fase 2 — Reagendar conversacional (el diferenciador)
Al cancelar (o al responder texto libre), Vai retoma con las herramientas que ya tiene
(`consultar_disponibilidad` + `agendar_cita`) y ofrece huecos ahí mismo. Confirmafy
manda a un enlace; nosotros reagendamos EN la conversación. Nuevas tools mínimas:
`cancelar_cita` / `confirmar_cita` para el camino de texto libre.

## Fase 3 — Autoagenda pública (enlace de reserva)
Página pública por tenant (tipo `hirevai.com/reserva/<slug>` servida por el worker) con
huecos de `availableSlots`. Es lo que a Confirmafy le da el «agenda online». Para
nosotros es OPCIONAL: el chat de Vai ya agenda — decidir si aporta o dispersa.

## Fase 4 — Métricas
Tasa de confirmación / cancelación / no-show en el dashboard y en el informe semanal
(`weeklyReportText` ya viaja cada lunes). «No-show» exige marcarlo: botón en el panel
sobre citas pasadas.

## Preguntas abiertas (deciden alcance y precio)
1. **Producto**: ¿incluido en el plan Profesional o addon con precio propio? (referencia
   de mercado: 12–31 USD/mes por volumen de citas).
2. **Antelaciones por defecto**: ¿24 h solo, o 24 h + 2 h?
3. **Fase 2 dentro del primer disparo** o F1 sola primero (F1 ya funciona sin modelo).
4. **Nombre visible** del módulo en el panel («Confirmaciones», «Recordatorios»…).
