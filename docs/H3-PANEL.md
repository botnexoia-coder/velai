# Horizonte 3 — decisiones, no tareas

> Mapa en [`PLAN-PANEL.md`](./PLAN-PANEL.md). Nada de aquí es «ponerse a programar»:
> son cinco decisiones que hay que tomar, dos de ellas con fecha impuesta por Meta.
> Cuando una se decida, se convierte en spec y sale de este doc.

---

## §1. Coexistence de WhatsApp — la más urgente de decidir

Dejar al cliente **su app de WhatsApp Business y su historial** al pasar a la API.
**Es el mayor quitamiedos del alta**, y Wati es el único del grupo que lo ofrece.

- [ ] **Decidir antes de septiembre de 2026.** El 15 de octubre Meta retira Embedded
      Signup v2 y v3, y `coex` es uno de los tres tipos de configuración que **no
      migran solos** (con `only_waba_sharing` y `marketing_messages_lite`).

Si el alta sigue siendo acompañada en la consola de Twilio, esta fecha no toca nada.
Solo afecta si se decide hacer el alta desde el panel — es decir, si se decide §2.

## §2. Embedded Signup propio

Hoy el alta la hacéis acompañando al cliente, **y funciona**. El autoservicio lo tienen
Landbot, Wati, ManyChat, Chatfuel, Kommo y Respond.io, y exige ser Tech Provider:
verificación de negocio, App Review y **dos vídeos demostrativos**.

Es una decisión de coste de oportunidad, no de producto: con cuatro clientes el alta
acompañada gana. La pregunta es a partir de cuántos deja de ganar.

- [ ] Decidir junto con §1 (comparten la fecha del 15 de octubre).

## §3. Satisfacción, medida aparte

**Una pregunta al cerrar, no un motor de puntuación.** Tidio es el único del grupo DIY
que la tiene; Fin, Zendesk, Ada y Gorgias la miden aparte para la IA.

Consenso unánime del sector: **nunca mezclar el CSAT del bot con el de los humanos.**
El argumento de Intercom para matar la encuesta clásica —baja respuesta, sesgo a los
extremos, castigo injusto a la IA— es reutilizable tal cual si se decide no hacerla.

Recordatorio de lo descartado (`PLAN-PANEL.md`): una puntuación propia tipo CX Score
**no** se construye.

## §4. Cupo de IA visible — RESUELTO y desplegado el 2026-08-26

Decisión de Juan: **visible sí, corte no.** Son dos cosas distintas y ahora el panel las
separa:

- **Saldo mensual de tokens** (`tenants.ai_monthly_tokens`, migración 0024): lo ve el
  cliente en su panel, baja hasta cero y **no corta nada**. Es un contador. La tarjeta lo
  dice con letra clara — un saldo que llega a cero sin explicar qué pasa haría que el
  primer cliente que lo cruce piense en una factura.
- **Cupo diario de llamadas** (`ai_daily_limit`): guarda anti-abuso, ese sí corta con un
  429. Subido de 300 a 1.500, porque 300 llamadas son ~37 conversaciones al día y un
  cliente que creciera se comía un corte duro antes de que su saldo dijera nada. Y ahora
  **avisa a Velai al 80%** (`ai_tenant_budget_warning`): el punto de subirlo es ver el
  problema venir, no solo retrasarlo.

Dos decisiones que no estaban en la pregunta original y aparecieron al construirlo:

- **Al cliente no se le enseña el coste.** La tarjeta de gasto en dólares es velai-only
  porque enseñarle lo que pagamos por él es enseñarle el margen. Su tarjeta lleva tokens y
  porcentaje, y hay un test que falla si se cuela cualquier rastro de coste.
- **El cupo se dimensionó con consumo real**, no a ojo: 3.148 tokens/llamada en Diálogos
  frente a 4.872 en GOgestión. La diferencia no es el tráfico, es el prompt — el de
  GOgestión son 12.858 caracteres y viajan en cada turno. El saldo hace visible el
  problema de H2 §1 desde la factura, que es el sitio donde más se nota.

## §5. Kit Digital y Kit Consulting

Siguen vivos en 2026 con fondos remanentes y **ya financian IA**. Es el mecanismo de
compra que la pyme española reconoce, y **Centribal ya lo usa como canal de entrada**.

No es panel: es canal comercial. Va aquí porque salió del mismo análisis y porque
condiciona cómo se presenta el precio (`PLAN-PANEL.md`: precio por cliente y mes con
mensajes a coste, nunca créditos).

- [ ] Verificar convocatoria y plazos vigentes antes de usarlo en un presupuesto.
