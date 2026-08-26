# Plan del panel — de dónde sale y en qué orden se hace

> Origen: el análisis competitivo **«El panel de Velai frente al mercado»**
> (artifact `7822458f-ff36-47be-a0ac-c97c31e8de1f`, 26 agosto 2026): 25 productos
> revisados — 8 plataformas DIY, implantadores de España y LatAm, y los grandes de
> atención al cliente. Base comparada: Velai en `812b22d`, 7 vistas.
>
> Este doc es el **mapa**, no la spec. Cada horizonte tiene el suyo:
> [`H1-PANEL.md`](./H1-PANEL.md) · [`H2-PANEL.md`](./H2-PANEL.md) · [`H3-PANEL.md`](./H3-PANEL.md).
> La decisión de almacenamiento que salió de H1 §1 vive aparte, en
> [`VOLUMEN-Y-ALMACENAMIENTO.md`](./VOLUMEN-Y-ALMACENAMIENTO.md) — sobrevive al horizonte.
> Cuando un horizonte se cierre: su doc se borra, el resumen va a `IMPLEMENTADO.md` y
> los restos a `TAREAS-PENDIENTES.md` (el flujo de siempre).

---

## El diagnóstico en una línea

**El panel de Velai es hoy el más honesto del mercado sobre si el sistema funciona, y
el más pobre sobre qué se dijo dentro de él.** Enseña el *resultado* (el lead, la cita)
pero no el *proceso* (la conversación). Ese es el eje de todo lo que sigue.

## Los tres huecos de paridad

Un cliente que compare tres presupuestos va a echar en falta exactamente esto:

| Hueco | Quién lo tiene | Dónde se arregla |
| --- | --- | --- |
| El historial de conversación no se puede leer | Las 8 DIY + Cliengo + Respond.io | H1 · §1 |
| El conocimiento del bot es una caja de texto (`system_prompt`) | Tidio, Wati, Kommo, Chatfuel, HubSpot, Zendesk | H2 · §1 (= fase 2 de `CONTEXTOS-AMPLIOS.md`) |
| Las plantillas de WhatsApp se ven a medias (estado binario) | Respond.io, Landbot, ManyChat | H1 · §5 |

## Las tres ventajas que nadie más tiene

No son accidentes: salieron de incidentes reales y hoy **no están contadas en ningún
sitio comercial**. Antes de construir nada nuevo, conviene que se vean.

- **El panel no puede mentir sobre el enrutado.** La vista Canales calcula el
  diagnóstico *en el worker*, con la misma pregunta que hace el enrutado en cada
  mensaje. En el mercado el estado se lee de lo que reporta el proveedor — por eso
  GOgestión pudo estar «verde en Twilio» y mudo a la vez.
- **«¿Dónde llegan tus leads?»** Ninguna plataforma revisada verifica su propia promesa
  de entrega (destinatarios, número emisor, plantilla, aprobación de Meta, ausencia de
  respaldo en la subcuenta).
- **Los avisos van donde el dueño ya está.** Telegram con bot propio del cliente, Temas
  del grupo y clasificación automática. El resto resuelve la movilidad con una app que
  hay que instalar. Es infraestructura de *salida* y hoy solo se usa para avisar — el
  informe semanal (H1 §2) es lo primero que la aprovecha para algo más.

## Las cinco apuestas con hueco real

| Apuesta | Estado del mercado | Horizonte |
| --- | --- | --- |
| Informe periódico automático al dueño | Solo Fin (correo). **Nadie** en España ni LatAm | H1 · §2 |
| Métricas del negocio, no del bot | Solo Bookline y 1MillionBot | H1 · §4 |
| Lo que el bot no supo contestar, enlazado a las conversaciones | Fin, Gorgias, Ada, Zendesk (los cuatro grandes) | H2 · §2 |
| Un panel distinto por vertical | Nadie enseña métricas de clínica/taller/gestoría | H2 · §5 |
| Decir la verdad sobre cómo se cuenta «resuelto» | La opacidad es la norma | transversal, ver *Vocabulario* |

## El orden, y por qué

```
H1.1 Guardar la conversación  ──┬──> H1.2 Informe semanal (línea «no supe contestar»)
   (una migración + una vista)  ├──> H2.2 Conversaciones no resueltas / temas sin respuesta
                               ├──> H2.4 Responder desde el panel
                               └──> H2.3 Probar el bot con la traza
```

**Guardar la conversación va primero, no segundo.** El artifact pone el informe semanal
en cabeza por ser el más barato, y lo es — pero su propio ejemplo («14 conversaciones,
6 leads, 2 citas, **3 preguntas que no supe contestar**») necesita conversaciones
guardadas. Hacerlo al revés obliga a enviar el informe dos veces: una pobre y otra
buena. Persistir es una migración y un endpoint; se hace en una tarde y desbloquea seis
de las nueve cosas que vienen después.

Dentro de H1 el resto va por coste creciente y por dependencia externa: las plantillas
granulares van al final porque son las únicas que dependen de comprobar contra la API
viva de Twilio qué campos expone de verdad.

## Vocabulario: adoptarlo no cuesta nada

- **El trío de tasas**: intervención (¿en cuántas participó el bot?) → resolución
  (¿cuántas cerró solo?) → automatización (el producto). Enseñar solo una permite
  maquillar, y el sector ya lo señala.
- **«Resolución», nunca «deflexión».** Intercom la declaró devaluada este año.
- **Confirmada frente a asumida.** «El cliente dijo gracias» ≠ «el cliente se fue».
  Detectar el agradecimiento en el último mensaje es un clasificador trivial.
- **La ventana de 72 h** como silencio tras el cual una conversación cuenta como
  resuelta (Zendesk, HubSpot, Freshworks). Si se elige otra, hay que decirlo.
- **Satisfacción medida aparte** de la de los humanos. Consenso unánime.
- **Rango honesto de resolución**: 40–60% al desplegar, 60%+ a los 6–12 meses (informe
  de ROI de Intercom). El 85–98% que publica `fin.ai` son percentiles del decil
  superior; la mediana verificada independiente ronda el **41%**. Si el panel muestra
  una referencia sectorial, 40–60% es la defendible.
- Coste de un ticket humano: **6–12 $** (Intercom). Es el supuesto de H1 §4.

## Lo que NO se construye — decidido, no volver a discutirlo

- **Un segundo modelo que audite al primero.** Zendesk cobra 1,50 $/resolución porque
  puede. Para Velai es coste doble por conversación y discusiones de factura sin fin.
- **Una puntuación de satisfacción propia tipo CX Score.** Replicarla mal es peor que no
  tenerla: da un número que nadie sabe defender.
- **Cola de revisión de calidad con fichas y revisores.** Es un producto entero
  (Zendesk: 50 $/agente/mes). Una pyme no tiene equipo de calidad.
- **Analítica conversacional en lenguaje natural.** Para seis métricas, unos filtros
  bien puestos ganan.
- **Simulaciones donde una IA hace de cliente y juzga.** Lo más caro de todo el conjunto.
- **Detección de duplicados/contradicciones en la base de conocimiento.** Con cuarenta
  respuestas, una persona lo ve antes.
- **Precio por créditos o por contactos activos** (MAC de Respond.io, créditos de
  Voiceflow). Desacopla lo que cobras de lo que te cuesta y genera sorpresas de factura.
  Precio por cliente y mes, con los mensajes repercutidos a coste, es más defendible.

## Dos fechas que no dependen de nosotros

- **15 de octubre de 2026** — Meta retira Embedded Signup v2 y v3. La mayoría de
  integraciones se convierten solas, pero **no migran** `only_waba_sharing`,
  `marketing_messages_lite` ni `coex` — y `coex` es justamente Coexistence, la vía que
  más conviene a una pyme. Solo afecta si el alta se hace desde el panel; si sigue
  siendo acompañada en la consola de Twilio, no toca nada. **Decidirlo antes de
  septiembre, no en octubre.** → H3 §1 y §2.
- **Recategorización sin preaviso** — desde abril de 2025, a los negocios ya advertidos
  por abuso de categoría Meta les reclasifica las plantillas al instante, sin las 24 h
  de aviso. Escala hasta restricciones de 7–30 días **a nivel de portfolio**; con Self
  Sign-up cada cliente tiene el suyo, así que el daño queda acotado a uno. Apelación:
  60 días, y no aplica a plantillas de autenticación. → H1 §5.

## Fuentes

Se priorizaron centros de ayuda y documentación oficial sobre páginas de marketing.
**Los precios y las tarifas de Meta cambian varias veces al año: verificar antes de
usarlos en un presupuesto.** El listado completo con enlaces está en el artifact
`7822458f-ff36-47be-a0ac-c97c31e8de1f`, §10.
