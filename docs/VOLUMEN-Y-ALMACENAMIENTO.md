# ¿Hace falta otra base de datos? — medido, no estimado

> Pregunta de Juan (2026-08-26), antes de guardar conversaciones: *«¿nos conviene usar
> otra DB para volumen, tipo Mongo u otra gratuita que nos permita más volumen?»*
>
> **Respuesta corta: no. Hay un problema de volumen real, pero no está en D1 — está en
> KV, y está unas 30 veces más cerca.** Cambiar de base de datos no lo arregla; sacar KV
> del camino caliente del chat sí, y es justo lo que hace H1 §1.

---

## Lo que hay hoy, medido en producción

Consultado el 2026-08-26 contra `vai-leads` (`--remote`, servido desde MAD/WEUR):

| Medida | Valor real |
| --- | --- |
| Clientes activos | 6 |
| Leads totales | 16 (desde 2026-08-17) → **1,76 leads/día** |
| Conversaciones contadas | 5 (`conv_daily` arrancó el 2026-08-25) |
| **Tamaño de TODA la base** | **332 KB** |

## Los límites reales de los planes gratuitos

Verificados en la documentación de Cloudflare el 2026-08-26. **Ojo: el límite de D1 que
importa no es el de la cuenta (5 GB) sino el de la base (500 MB).**

| | D1 gratis | D1 pagado (Workers Paid, 5 $/mes) |
| --- | --- | --- |
| Tamaño máximo **por base** | **500 MB** | 10 GB |
| Almacenamiento de la cuenta | 5 GB | 1 TB |
| Filas escritas | 100.000 / día | 50 M/mes incluidas, luego 1 $/M |
| Filas leídas | 5 M / día | 25.000 M/mes incluidas |
| Consultas por invocación del Worker | 50 | 1.000 |
| Time Travel (recuperación) | 7 días | 30 días |

| | KV gratis | KV pagado |
| --- | --- | --- |
| **Escrituras a claves distintas** | **1.000 / día** | ilimitado |
| Lecturas | 100.000 / día | ilimitado |
| Almacenamiento | 1 GB | ilimitado |

## El cálculo que decide

Supuestos: una conversación son ~8 turnos (16 mensajes) y un mensaje ~200 bytes de texto
en español. Retención de transcripciones: 90 días (H1 §1).

**D1** — por turno se escriben 3 filas (el upsert de `conversations` + los dos mensajes),
o sea ~25 filas por conversación, y ~4 KB de almacenamiento.

- Techo por escrituras: `100.000 / 25` = **4.000 conversaciones/día**.
- Techo por almacenamiento: `500 MB / 4 KB` = 125.000 conversaciones vivas, que con 90
  días de retención son **~1.400 conversaciones/día sostenidas**.
- Manda el almacenamiento: **~1.400/día**, unas **140 veces** el volumen de hoy. Y la
  base entera pesa hoy 332 KB, el 0,07% del límite.

**KV** — cada turno del chat web escribe **cinco** claves distintas:

| Escritura | Dónde |
| --- | --- |
| Límite por IP (`rl:chat:<ip>`) | `worker/app.js:142` vía `rateLimited` |
| Límite por conversación (`rl:chatconv:<id>`) | `worker/app.js:1557` |
| **Estado de la conversación** (`conv:web:<tenant>:<id>`) | `worker/app.js:1593` |
| Contador global de cupo de IA | `worker/app.js:216` |
| Contador de cupo de IA del tenant | `worker/app.js:217` |

- Techo: `1.000 / 5` = **200 turnos/día** ≈ **25 conversaciones/día**.
- Volumen de hoy: ~5/día. Margen: **unas 5 veces**, no 140.

> **KV se agota unas 30 veces antes que D1.** Y cuando se agota, el chat deja de guardar
> estado a media conversación: Vai empieza a responder sin memoria. Es el fallo más caro
> del sistema y no avisa solo. (El dashboard ya vigila KV desde `812b22d` — la
> preocupación estaba bien encaminada, el sospechoso era otro.)

## Las alternativas, una por una

| Opción | Almacenamiento gratis | ¿Desde un Worker? | Veredicto |
| --- | --- | --- | --- |
| **MongoDB Atlas M0** | 512 MB | **No** de forma sana | **Descartado**, ver abajo |
| Neon (Postgres) | 0,5 GB | Sí (HTTP / Hyperdrive) | No mejora a D1 |
| Supabase | 500 MB | Sí (REST) | No mejora, y **pausa el proyecto a los 7 días sin actividad** |
| Turso / libSQL | 9 GB, 500 M lecturas/mes | Sí (HTTP) | Único que mejora el almacenamiento; segundo proveedor |
| **R2** | 10 GB | Nativo | **Sí, para archivo frío** — pero no se consulta |
| Analytics Engine | — | Nativo | Solo agregados sin PII, no transcripciones |

**Mongo es la peor de las opciones, no la mejor.** Tres razones:

1. **El camino HTTP está muerto.** Atlas Data API y los HTTPS Endpoints llegaron a
   *end-of-life el 30 de septiembre de 2025*. Desde un Worker solo queda el driver
   nativo sobre `cloudflare:sockets` (TCP), que no es un camino soportado ni estable.
2. **M0 son 512 MB — lo mismo que D1 gratis.** No compras volumen: 500 MB es el número
   universal del *free tier*. Nadie regala más excepto Turso.
3. **Abre una pregunta de RGPD que hoy no existe.** Las transcripciones de la clínica de
   un cliente tendrían que vivir en una región europea elegida a mano, en un proveedor
   distinto, con su propio backup y su propio acuerdo de tratamiento. Hoy todo está en
   Cloudflare y eso es una sola conversación con el cliente, no dos.

Y una razón que aplica a las cuatro alternativas de base de datos: **el coste que manda
no es el almacenamiento, son los tokens de Anthropic.** A 1.400 conversaciones/día se
gasta en modelo mucho más de lo que cuestan los 5 $/mes de Workers Paid, que suben la
base de 500 MB a **10 GB** (20×) y las escrituras a 50 M/mes. Migrar de proveedor para
ahorrar en la capa más barata del sistema es optimizar la esquina equivocada.

## Decisión

1. **D1 se queda**, y es la fuente única de la conversación.
2. **Sacar KV del camino caliente del chat**, que es donde está el techo de verdad. Lo
   hace H1 §1 sin trabajo extra: si la conversación se guarda en D1, el `put` de
   `conv:web:*` **desaparece** — la escritura a D1 ya la íbamos a hacer de todas formas.
   Cinco escrituras de KV por turno pasan a dos, y el techo sube de ~25 a ~60
   conversaciones/día sin tocar nada más.
3. **Los dos contadores de cupo de IA** son los siguientes candidatos: `ai_usage` ya es
   una tabla de D1 (migración 0018) y los contadores de KV solo existen para aplicar el
   tope diario. Moverlos deja el chat con **cero escrituras de KV** aparte de los
   límites de tasa. → pendiente, no en H1.
4. **Los dos limitadores de tasa** son el último resto. Cloudflare tiene un *binding* de
   rate limiting nativo que no gasta KV; hay que verificar en qué estado está antes de
   apoyarse en él. → pendiente.
5. **R2 para archivo frío** si algún día la retención pasa de 90 días: la transcripción
   entera como un JSON por conversación, y D1 se queda solo con el índice. 10 GB gratis
   y sin coste de salida. Hoy es sobreingeniería (332 KB).
6. **Revisar este doc cuando la base pase de 100 MB** o cuando el dashboard enseñe las
   escrituras de KV por encima del 50% del cupo un día cualquiera.

## ¿WebSockets en vez de sondeo? — preguntado el 2026-08-26

Juan: *«lo otro con los tiempos, ¿podemos agregar websockets?»* y, al responderle que no
teníamos un problema de latencia: *«no lo tenemos porque estamos probando con 1 cliente;
cuando tengamos 10-15 clientes con sesiones activas y chateando todos al tiempo, ¿qué?»*.
La segunda pregunta es la buena, y la respuesta necesita números.

### Primero: los WebSockets NO arreglan los tiempos de la cola

Los avisos de la cola de espera (5 y 15 min) no llegaban tarde por el sondeo: llegaban tarde
por el **cron**, que corría cada 5 minutos, así que «5 minutos» eran 5-10 y «15» eran 15-20.
Un WebSocket no toca eso en absoluto.

Lo que sí lo arregla, y ya está hecho: **dos relojes**. Uno cada minuto que SOLO atiende la
cola, y el de 5 minutos para el resto. No se puede subir todo a un minuto porque
`drainQueuedLeads` hace un **listado de KV por tick** y el plan gratuito da 1.000
listados/día: a 1.440 ticks se pasaría. Y multiplicaría por cinco los reintentos a Twilio.

### Segundo: el coste del sondeo con 15 clientes

Peticiones al Worker por día, contra el tope gratuito de **100.000**:

| | Como estaba | Con freno adaptativo |
| --- | --- | --- |
| Panel (bandeja abierta 8 h) | 28.800 (29%) | 11.520 (12%) |
| Widget (conversaciones vivas) | 15.000 (15%) | 13.500 (14%) |
| **Total** | **43.800 (44%)** | **25.020 (25%)** |

Y eso **antes** del tráfico real: cada mensaje del visitante, cada `/widget/boot` de cada
página vista en las webs de los clientes, cada lead, cada imagen.

O sea: Juan tiene razón en que a 15 clientes el sondeo deja de ser gratis. Por eso ya está el
**freno adaptativo**: el panel sondea cada 15 s solo si hay alguien esperando o una
conversación tomada, y cada 60 s si no; el widget cada 5 s con una persona al otro lado y
cada 10 s mientras solo espera en cola.

### Tercero: cuándo sí valen los WebSockets

Con hibernación, un WebSocket abierto no consume duración y cada mensaje cuenta como una
petición: el widget pasaría de ~1.000 peticiones/día/cliente a ~200. Es una mejora real —
pero se paga:

- **Exige un Durable Object.** En el plan gratuito solo existen los DO con backend SQLite, y
  traen su propio presupuesto (100.000 peticiones/día, 13.000 GB-s/día). No se quita un
  techo: se cambia de techo.
- Hay que implementar la hibernación bien o la duración se dispara, más reconexión con
  reintentos en el widget y en el panel.
- Es un primitivo nuevo en un sistema que hoy solo usa Worker + D1 + KV.

**Decisión: no ahora, y con un disparador medible.** El dashboard ya vigila el consumo de
Cloudflare contra `CF_FREE_LIMITS`, así que el criterio es objetivo: **cuando las peticiones
al Worker pasen del 60% del tope diario de forma sostenida**, toca decidir entre pasar a
Workers Paid (5 $/mes, que quita el techo de peticiones) o montar los WebSockets.

Y ojo al orden de magnitud: a 15 clientes el gasto de **tokens de Anthropic** es de cientos
de dólares al mes. Discutir 5 $ de Workers Paid antes que eso es, otra vez, optimizar la
esquina equivocada.

## Lo que NO se hace

- Cambiar de base de datos por volumen. El volumen no está donde parecía.
- Repartir la conversación entre dos almacenes (KV para lo caliente, D1 para lo frío):
  duplica el estado, obliga a decidir cuál manda cuando discrepan, y es exactamente el
  tipo de sistema que produjo el «verde en Twilio y mudo a la vez» de GOgestión.
