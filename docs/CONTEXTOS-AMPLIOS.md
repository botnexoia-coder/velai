# Contextos amplios — opciones, con recomendación

> **Estado (2026-08-18): FASE 1 APLICADA Y DESPLEGADA.** `callAnthropic` marca el
> `system` (estable por tenant) con `cache_control: ephemeral` — relectura a 0,1x
> desde el segundo turno; por debajo del mínimo cacheable la API lo ignora sin coste.
> Verificación: cada llamada loguea `ai_usage` con `cache_w`/`cache_r` en Workers
> Logs — si ambos son siempre 0, el caché no acierta. El contrato (bloque estable,
> idéntico byte a byte, cache_control en el último bloque fijo) queda cubierto por
> los tests que inspeccionan el payload. Fases 2–4 anotadas en TAREAS-PENDIENTES.

> **El problema.** El `system_prompt` de cada tenant viaja al modelo **en cada mensaje y en cada
> turno**. Zoe son 15.949 caracteres (~4.000 tokens): una conversación de 6 turnos envía ~24.000
> tokens de prompt para 6 respuestas. Y hay un segundo coste, menos visible pero peor: en un muro de
> 16k caracteres, la regla *"responde en 220 caracteres"* compite con 13k de base de conocimiento —
> es exactamente lo que se ve en Diálogos y HireDataVision, que contestan más largo de lo que su
> propio prompt les pide.
>
> Estado hoy: Zoe ~4.000 tokens · GOgestión ~3.000 · HireDataVision ~970 · Diálogos ~900.

---

## Lo primero: el PDF **no** es el camino

La idea de "subir un PDF y que el bot lo consulte" es intuitiva, pero funciona al revés de lo que
parece:

- **Un PDF adjuntado a la petición entra entero en el contexto.** No hay búsqueda dentro del PDF por
  arte de magia: si se lo pasas al modelo, pagas todos sus tokens en cada mensaje. Sería *más* caro
  que hoy, no menos.
- **El PDF es el peor formato para esto.** Un PDF lleva maquetación, saltos de página, cabeceras y
  columnas que se convierten en ruido al extraer el texto; el mismo contenido en texto plano ocupa
  menos y se lee mejor. Nada de lo que aporta un PDF (fuentes, diseño) le sirve al modelo.
- Para que el bot "sepa que algo está en el documento y vaya a buscarlo" hace falta **una herramienta
  de consulta** (opción C) o **búsqueda semántica** (opción D). El formato del origen es lo de menos;
  lo que importa es cómo se trocea y cómo se recupera.

**Formato recomendado para cualquier base de conocimiento: Markdown plano**, con un encabezado corto
por tema, 150–800 palabras por bloque, sin tablas complejas ni anidamiento profundo. Un tema por
bloque, y el título describiendo exactamente lo que contiene (`## Menor que viaja solo (azafata)`).
Eso sirve igual para las cuatro opciones de abajo y es lo que ya tenéis en `tenants/*.md`.

---

## A. Dejarlo como está

Todo el contexto en el prompt, en cada mensaje.

**A favor:** cero trabajo, cero riesgo, el modelo siempre tiene el dato delante.
**En contra:** el coste crece con cada mensaje y las instrucciones se diluyen.

**Cuándo basta:** contextos por debajo de ~4.000 caracteres. HireDataVision y Diálogos están aquí y
no necesitan nada más.

---

## B. Caché de prompt — **lo que yo haría ya**

El bloque estable del `system` se marca con `cache_control`. El modelo lo guarda y en las siguientes
peticiones se cobra a **0,1x** en lugar de 1x. Precios oficiales, como multiplicador del input:

| Concepto | Coste |
|---|---|
| Escritura de caché, TTL 5 min | **1,25x** |
| Escritura de caché, TTL 1 hora | **2x** |
| **Lectura de caché** (acierto o refresco) | **0,1x** |

Mínimo cacheable en Sonnet: **1.024 tokens**. Zoe (~4.000) y GOgestión (~3.000) califican; los otros
dos no, y no importa.

**Por qué es tan buen negocio aquí:** el prompt se reenvía **en cada turno de la misma conversación**.
Con TTL de 5 minutos, una charla de 6 turnos con Zoe pasa de 6×4.000 = 24.000 tokens de prompt a
4.000×1,25 + 5×400 = **7.000**. Un 70% menos sin cambiar nada del diseño. Sale a cuenta desde el
**segundo** mensaje de una misma conversación.

**Implementación (una sola cosa que cambiar).** Hoy `callAnthropic` manda `system` como cadena. Pasa
a mandarlo como array de bloques y marca el último bloque estable:

```js
system: [
  // Bloque estable por tenant: contexto de negocio + guardrails. Idéntico en cada
  // petición de este tenant, así que el caché acierta desde el segundo mensaje.
  { type: 'text', text: systemFor(config, tenant), cache_control: { type: 'ephemeral' } },
],
```

Reglas que hay que respetar para que el caché acierte:

- El prefijo cacheado tiene que ser **idéntico byte a byte**. Nada de timestamps, nombres del usuario
  ni "hoy es martes" dentro del bloque cacheado: eso va en el `messages`, después.
- El `cache_control` va en **el último bloque que no cambia**, nunca en uno que varíe.
- El orden del prefijo es `tools` → `system` → `messages`: cachear el `system` funciona aunque el
  historial crezca, porque lo variable viene después.
- Verificar que funciona mirando `cache_creation_input_tokens` y `cache_read_input_tokens` en la
  respuesta. Si los dos son 0, no se está cacheando (y la API **no** avisa).

**TTL de 1 hora (2x escritura) solo si el tráfico es esporádico.** Con un mensaje cada 20 minutos, el
caché de 5 min expira entre conversaciones y se paga la escritura una y otra vez; con 1 hora sale a
cuenta desde la tercera conversación de esa hora. Empezad con 5 minutos y mirad los contadores.

---

## C. Dos niveles + herramienta de consulta — el paso siguiente

Esto es lo que Juan describía: un prompt corto que **sabe qué hay** en la base de conocimiento y va a
buscarlo solo cuando hace falta.

**Cómo se monta:**

1. **Separar en D1** lo que hoy es un solo campo: `system_prompt` (instrucciones, tono, cómo actuar —
   corto) y una tabla nueva `tenant_docs (tenant_id, tema, titulo, contenido)`.
2. **En el prompt base va el índice, no el contenido:** *"Tienes una base de conocimiento con estos
   temas: tarifas por edad · menor que viaja solo · requisitos de salida de un menor · documentación
   Colombia-España · solvencia económica · planes · medios de pago · recogida en aeropuerto. Si la
   pregunta trata de uno de ellos, consúltalo antes de responder."* Sin ese índice el modelo no sabe
   que existe y contesta de memoria.
3. **Una herramienta** `consultar_base(tema)` en la llamada a la API. Cuando el modelo la usa, el
   worker devuelve ese bloque y el modelo responde con el dato delante. Es un ida y vuelta extra al
   modelo, solo en las preguntas que lo necesitan.

**A favor:** pagas los bloques que se consultan, no los 20; el prompt base queda corto y las
instrucciones de estilo dejan de competir con 13k de datos; el índice es auditable y determinista
(sabes exactamente qué puede consultar).
**En contra:** más código (bucle de tool use), +1 latencia cuando consulta, y **el riesgo real: que
el modelo no consulte cuando debería** y responda de memoria. Se mitiga con un índice claro y con la
instrucción de que en esos temas *tiene* que consultar.

**Cuándo:** cuando un contexto pase de ~20.000 caracteres, o cuando un cliente tenga varios
documentos (catálogo + condiciones + FAQ), o cuando la base cambie a menudo y no queráis reeditar el
prompt entero cada vez.

---

## D. Búsqueda semántica (RAG con Vectorize)

Trocear los documentos, calcular embeddings, y ante cada pregunta buscar los 2-3 fragmentos más
parecidos e inyectarlos. Cloudflare lo tiene todo en la misma cuenta (Vectorize + Workers AI para los
embeddings), así que no hay proveedor nuevo.

**A favor:** escala a cientos de fragmentos y encuentra por significado, no por título.
**En contra:** es la opción con más piezas móviles (pipeline de indexado, reindexar al editar,
afinar el troceado) y **para 20 bloques es sobreingeniería**: buscar por tema (opción C) acierta igual
y es predecible. La búsqueda semántica también puede traer el fragmento equivocado, y ahí sí duele:
en temas como permisos de salida de un menor, un fragmento parecido pero no exacto es peor que nada.

**Cuándo:** cientos de fragmentos, varios idiomas, o documentos largos y poco estructurados. Hoy no
es vuestro caso.

---

## Recomendación por fases

| Fase | Qué | Esfuerzo | Cuándo |
|---|---|---|---|
| **1** | **Caché de prompt** en Zoe y GOgestión (y en cualquier tenant >1.024 tokens) | Un cambio en `callAnthropic` | Ya |
| **2** | **Partir instrucciones y conocimiento** en D1, aunque los dos sigan viajando en el prompt | Migración + panel con dos campos | Cuando toquéis el panel |
| **3** | **Herramienta de consulta** sobre `tenant_docs` con índice en el prompt base | Bucle de tool use | Al pasar de ~20k car. o varios documentos |
| **4** | **Vectorize** | Pipeline de indexado | Solo si el corpus se dispara |

La fase 2 vale la pena aunque no cambie el coste: es la que arregla la calidad. Con instrucciones
cortas al final y el conocimiento aparte, la regla *"1-2 frases, 220 caracteres"* deja de pelear con
13k de datos — que es la razón por la que ahora mismo dos de los cuatro bots contestan más largo de
lo que su propio prompt les pide.

**Lo que NO haría:** recortar la base de conocimiento de Zoe para ahorrar tokens. Esos 13k son
requisitos de salida de menores, permisos notariales y solvencia — justo donde el bot aporta valor y
donde una respuesta incompleta hace daño. El problema es *cómo* se entrega, no *cuánto* hay.

---

Fuente de los precios y límites del caché: [Prompt caching — Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
