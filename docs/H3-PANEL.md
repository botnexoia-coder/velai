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

## §4. Cupo de IA visible y con corte

`ai_daily_limit` **ya existe** (columna en `tenants`, migración 0011, con
`AI_TENANT_DAILY_LIMIT` como default en `wrangler.toml`). Falta:

- exponerlo en el panel del cliente,
- y **decidir qué pasa al agotarse**: se corta (429, como hoy) o se desborda con aviso,
  que es lo que hacen Crisp y Zendesk.

Es media tarde de código y una decisión de negocio.

## §5. Kit Digital y Kit Consulting

Siguen vivos en 2026 con fondos remanentes y **ya financian IA**. Es el mecanismo de
compra que la pyme española reconoce, y **Centribal ya lo usa como canal de entrada**.

No es panel: es canal comercial. Va aquí porque salió del mismo análisis y porque
condiciona cómo se presenta el precio (`PLAN-PANEL.md`: precio por cliente y mes con
mensajes a coste, nunca créditos).

- [ ] Verificar convocatoria y plazos vigentes antes de usarlo en un presupuesto.
