# Handoff con toma de control — spec, antes de tocar nada

> Pedido de Juan el 2026-08-26: «el chat solo se habilita cuando el usuario pida hablar con
> un asesor y haya alguien conectado; si no, envía un lead y sigue la IA atendiendo».
> Y sobre la red de seguridad: «el bot queda frenado esperando respuesta; si pasados 5 min
> nadie toma control, la IA retoma diciendo que no hay asesores disponibles».
>
> **Esto cambia el camino del handoff en producción, con clientes reales atendiendo.**
> La spec va antes del código a propósito: si mi entendimiento está mal, se ve aquí y no en
> el WhatsApp de un cliente.

---

## El problema de hoy, que no es solo el cajón

Cuando el modelo emite `[[HUMANO]]` en WhatsApp, `escalateToHuman()` (`worker/app.js:952`)
hace dos cosas: escribe `pause:<tenant>:<from>` en KV con **4 h** de TTL y manda un aviso a
Telegram. **Nada garantiza que alguien conteste.** Si el aviso llega de noche o nadie lo ve,
el cliente final se queda en silencio cuatro horas justo después de pedir ayuda. Eso está
en producción ahora.

En el canal **web** no existe: el sentinela se limpia y el bot responde «aviso al equipo»,
sin pausa ni escalación. Esta spec es de WhatsApp y Messenger.

## Los cuatro estados de una conversación

```
        bot ──[[HUMANO]] y hay alguien disponible──> esperando
         ↑                                              │
         │                                    «Tomo el control»
         │                                              ↓
         └──── el asesor suelta el control ────────── humano
         ↑                                              │
         └── 5 min sin que nadie tome el control ───────┘
             (la IA retoma: «no hay asesores disponibles»)

        bot ──[[HUMANO]] y NO hay nadie disponible──> bot
             (se captura el lead, la IA sigue atendiendo)
```

- **`bot`** — normal. La IA atiende con las reglas de siempre (incluida «ESPACIO Y CIERRE»).
- **`esperando`** — la persona pidió un asesor Y había alguien disponible: está **en cola**.
  El bot calla y el panel enseña «Tomo el control» con los minutos que lleva esperando.
  A los **5 min** se le avisa de que seguís buscando (para que no haya silencio) y a los
  **15** la IA retoma y le pide el teléfono.

  Los 5 minutos eran el final en la primera versión, y estaba mal: con un asesor ocupado en
  otra conversación saltaba casi siempre, y el visitante leía «no hay nadie disponible»
  cuando sí había (lo vio Juan el 2026-08-26). La disponibilidad nunca fue exclusiva —
  `advisorAvailable` solo cuenta filas de presencia— así que atender varias a la vez ya
  funcionaba: lo que faltaba era **verlas**. Ahora la bandeja pone lo que espera primero,
  con los minutos de espera y un contador «N esperando asesor» en la cabecera.
- **`humano`** — alguien tomó el control. El bot sigue callado y **solo entonces se habilita
  el cajón de escritura**, con la ventana de 24 h de Meta como hasta ahora.
- Vuelta a **`bot`** por dos caminos: el asesor suelta el control, o pasan 5 minutos sin que
  nadie lo tome.

**Si no hay nadie disponible, NO se escala.** Se captura el lead y la IA sigue. Es el cambio
que pide Juan y el que quita el silencio de 4 h.

## «Disponible» = interruptor Y horario

Decisión de Juan: interruptor explícito, **pero que el horario lo cierre**. O sea:

```
disponible = interruptor ON  Y  ahora está dentro del horario de atención
```

El interruptor es por **usuario** del panel (varias personas pueden estar disponibles); el
horario es del **cliente**. Fuera de horario el interruptor no vale: se ignora y el panel lo
dice, para que nadie crea que está cubriendo cuando no.

Reutiliza lo que ya existe y está probado con DST: `localWeekday` y `localToUtcMs` de
`worker/calendar.js`, y el mismo formato de tabla que `business_hours`
(`{"mon":[["09:00","14:00"],["16:00","19:00"]],…}`).

Columnas nuevas en `tenants`: `support_hours` (TEXT/JSON) y `support_tz` (TEXT).
`support_hours` a NULL cae al **mismo default que el calendario** (L-V 9-19,
`DEFAULT_BUSINESS_HOURS`). Al principio propuse que NULL fuera «sin restricción» y Juan lo
corrigió: si la interacción humana va con horario, un NULL sin límite es lo contrario de lo
pedido. Un `{}` explícito sí significa «nunca se ofrece asesor», y el panel lo dice con esas
palabras para que no parezca un fallo.

**Lo edita el CLIENTE, en Conexiones, con una rejilla de horas.** La primera versión fue un
textarea de JSON (la convención que ya usaba el horario del calendario) y Juan lo paró: eso
es para nosotros, no para un cliente. Ahora son siete filas —una por día— con dos tramos
cada una, porque la jornada partida es la norma aquí, un selector de zona horaria con las
seis habituales y un «copiar el lunes a L-V». Guarda por `/notify`, que ya es un endpoint
auditado y con scope de cliente, en vez de abrir uno nuevo.

## Lo que se toca, y el riesgo de cada cosa

| Pieza | Cambio | Riesgo |
| --- | --- | --- |
| Migración `0025` | `tenants.support_hours`/`support_tz`, `conversations.state`/`state_at`/`agent_email`, tabla `agent_presence` | Bajo: aditivo |
| `replyWindow()` | Una condición más: solo abre el cajón en estado `humano` | Bajo: hoy nadie responde desde el panel |
| Panel | Interruptor de disponibilidad, «Tomar el control», «Devolver a la IA», cuenta atrás | Bajo: UI nueva |
| **`escalateToHuman()`** | Consulta disponibilidad; escala o captura lead | **ALTO: camino vivo** |
| **La guarda de pausa de `handleTwilio`** | Pasa de «hay clave `pause:`» a «el estado es `esperando` u `humano`» | **ALTO: decide si el bot contesta** |
| El cron de 5 min | Vence las esperas y hace que la IA retome | Medio: manda mensajes al cliente final |

Los dos de riesgo ALTO se hacen **al final**, con la infraestructura ya desplegada y probada,
y manteniendo la clave `pause:` en paralelo hasta comprobar que el estado nuevo se comporta.
La vista de Escalaciones y su botón de Reanudar siguen valiendo: son la salida de emergencia.

## Detalles que no me quiero saltar

- **El cron es `*/5`, así que «5 minutos» son en realidad entre 5 y 10.** No lo voy a
  disimular. Se compensa con lo que cubre el caso normal: si la persona **vuelve a escribir**
  mientras espera y el plazo ya venció, la IA contesta en ese mismo mensaje, sin esperar al
  cron. El cron solo hace falta cuando el cliente final se queda callado.
- **«La IA retoma diciendo que no hay asesores disponibles»** es un mensaje que sale solo
  hacia el cliente final. Va por `sendTwilioText` y es legal: la ventana de 24 h la abrió su
  propio mensaje hace cinco minutos.
- **El lead se captura sí o sí al pedir asesor.** Hoy `captureWhatsAppLead` exige ≥2 turnos y
  que el resumen traiga necesidad o sector. Pedir hablar con una persona es intención
  comercial suficiente: ahí la captura se fuerza.
- **Quién tomó el control se guarda** (`conversations.agent_email`) y se enseña. Sin eso, dos
  personas pueden pisarse creyendo cada una que la otra no está.
- **Asignación de conversaciones sigue descartada** (`PLAN-PANEL.md`): tomar el control no es
  asignar: es un cerrojo de una conversación, no una cola de trabajo con dueños.

## Velai atiende SOLO lo de Velai

Decisión de Juan el 2026-08-26, después de ver que un admin de Velai podía tomar el control
de la conversación de un cliente: **el cliente final de un negocio no debe encontrarse a
Velai dentro de su chat.** La burbuja del panel lleva el correo de quien escribe, así que
habría visto `botnexo.ia@gmail.com` en el chat de su gestoría.

- **Ver sí, atender no.** Velai sigue viendo todas las conversaciones —lo necesita para dar
  soporte y diagnosticar— pero no puede responderlas ni tomar su control.
- El cajón se cierra **antes** con el motivo escrito («la atiende su equipo, no Velai»), y
  el endpoint devuelve **403, no 404**: fingir que la conversación no existe sería mentirle
  al panel, que la está enseñando.
- La disponibilidad de un admin de Velai es siempre **la del tenant `velai`**: el
  `?tenant=` se ignora porque no hay nada que elegir. Antes dependía del selector de la
  bandeja y con «Todos los clientes» dejaba el botón mudo — así lo descubrió Juan.

## Lo que NO hace

- No toca el canal web: el widget no tiene canal de vuelta (`H2-BANDEJA.md` §1).
- No añade notificaciones push ni sonido. El aviso sigue siendo Telegram.
- No mide tiempos de respuesta del equipo. Eso es H2 §2 y va aparte.
