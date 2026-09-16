# Design QA — disposición de Industrias (2026-09-16)

- Origen: captura de Juan a ~1757 px. Medido antes de tocar: la columna de texto mide 284 px
  de alto y la conversación 509, así que quedaban **224 px de hueco muerto** bajo el texto; y
  el interruptor de canal formaba una segunda fila de pastillas justo debajo de las de sector.
- Cambios: (1) el interruptor sube a la MISMA fila que los sectores, pegado a la derecha —
  son dos ejes del mismo control, no dos filas; (2) la rejilla pasa a `1.05fr .95fr` con
  `align-items:center`, así el hueco se reparte arriba y abajo en vez de caer entero debajo
  del texto; (3) la tarjeta se limita a 460 px y se alinea con el borde derecho de la sección
  — estirada a la columna entera dejaba de parecer una conversación.
- Por debajo de 900 px la tarjeta ocupa el ancho y el interruptor baja a su propia línea:
  pegado a las pestañas de sector parecía un sector más.
- Trampa de cascada: las reglas de móvil vivían en el bloque RESPONSIVE general, que está
  ANTES de la hoja del chat; con la misma especificidad ganaba la última y la tarjeta seguía
  estrecha y a la derecha a 880 px. Ahora van al final de su propia hoja.
- Comprobado a 1757, 880 y 390 px, en las dos pieles y en varias pestañas.
- Queda anotado: cambiar de canal mueve la altura de la tarjeta (WhatsApp 521 px, web 623),
  así que la sección da un salto de ~100 px al pulsar. Es honesto —son dos cosas distintas—
  pero si molesta se iguala con un `min-height`.
- P0/P1/P2 pendientes: ninguno.

final result: passed

---

# Design QA — Industrias enseña los dos canales (2026-09-16)

- Decisión: el bot vive en WhatsApp Y en la web, y cada canal lo pinta a su manera, así que
  la sección no puede enseñar una sola apariencia. Mismo diálogo, dos pieles y un
  interruptor «WhatsApp / Chat web» encima de la tarjeta; el canal elegido se aplica a las
  cuatro pestañas a la vez, para no tener que volver a pulsarlo en cada sector.
- Piel WhatsApp: la que ya había (barra de estado del móvil, iconos de llamada, burbujas
  verdes con cola, dobles ticks azules y micrófono). Piel web: el widget real de
  `site/assets/vai-widget.js` en tema oscuro, con sus tokens, radios y burbujas.
  `.indchat-solo-wa` / `.indchat-solo-web` marcan lo que existe en un canal y no en el otro.
- **Colisión de nombres cazada al mirarlo**: `site/assets/styles.css` ya define `.chat-mock`
  (el mock de WhatsApp de otras landings) con `max-width:340px; margin-left:auto`, y también
  existían `.chat-header` y `.chat-avatar` en la propia home. Las clases nuevas heredaban ese
  ancho y la tarjeta salía a 340 px pegada a la derecha. Todas pasan a `indchat-*`.
- Segundo tropiezo: el interruptor y la tarjeta eran dos hijos de una rejilla de dos
  columnas, así que la tarjeta caía a una fila nueva. Van dentro de `.indchat-demo`.
- Comprobado: las dos pieles en las cuatro pestañas, a 1800 y 390 px, y el interruptor
  cambiando de canal en vivo. `npm run check:site` en verde.
- P0/P1/P2 pendientes: ninguno.

final result: passed

---

# Design QA — la malla cinética llega hasta el final del hero (2026-09-16)

- Origen: Juan marca la banda bajo la cinta de canales; la malla interactiva no la cubría.
- Causa medida: el lienzo (`.kinetic-grid-canvas`) cubre su contenedor entero
  (`inset:68px 0 0`), pero esa banda **no era del hero**. El hero acababa en 932 px y la
  cinta, con su margen inferior de 56 px, dejaba 42 px de fondo de página por debajo: ahí
  no hay ni imagen ni malla porque no hay hero que pintar.
- Implementación: el hero se alarga 56 px por abajo (`padding-bottom:calc(8rem + 56px)`) y
  la cinta sube otros 56 (`margin:-152px auto 70px`), con lo que las tarjetas quedan donde
  estaban y los 70 px que las separan de «El problema» son ya hero — con imagen y malla.
  El margen inferior de la cinta devuelve al flujo exactamente esos 70 px: sin él, la
  sección siguiente subía y se comía la cola del hero.
- Por debajo de 900 px no se toca nada: ahí la cinta cae ENTERA fuera del hero (su arte va
  anclado arriba), así que el hero conserva su relleno de siempre con una regla explícita.
- Medido después: hero 932 · lienzo 932 · cinta 862 · sección 932. Banda de hero bajo las
  tarjetas, 70 px; solape con la sección, 0.
- Viewports comprobados: 1800 (claro y oscuro), 880 y 500 px — los dos últimos, idénticos
  a antes del cambio.
- P0/P1/P2 pendientes: ninguno.

final result: passed

---

# Design QA — cinta de canales y tema claro del hero (2026-09-16)

- Origen: captura de Juan a ~1800 px de ancho; la cinta de canales del hero quedaba pegada
  al borde de la sección «El problema», sin aire entre las tarjetas y la sección siguiente.
- Medido antes de tocar: hueco real de **0 px** entre `.channel-ribbon` y `.problem-section`
  (la cinta sube 75 px con margen negativo y sobresalía 7 px POR DEBAJO del hero, justo
  encima del borde de la siguiente sección). Defecto de origen, no de una entrega reciente.
- Implementación: `.channel-ribbon` pasa a `margin:-96px auto 56px` — la cinta queda entera
  dentro del hero (14 px de margen hasta su borde) y deja 56 px hasta la sección. En ≤900
  px, `-55px 20px 40px`; en ≤600 px, `-48px 14px 32px`.
- Hallazgo del paso de tema claro (barrido de luminancia sobre todo el texto del hero y de
  la cinta): **`.channel-pill` y el botón «Hablar con Vai» heredaban el `--white` invertido**
  y quedaban oscuros sobre el hero, que sigue siendo oscuro en tema claro. El botón
  desaparecía por completo. Añadidas dos reglas `body.light` que les devuelven el texto claro.
- Viewports comprobados: 1800 × 1000 (claro y oscuro), 1280 y 390 × 800. Barrido completo de
  la página en tiras, en los dos temas, sin más hallazgos: el único hueco a 0 era este.
- Falso positivo descartado: la figura de precios sale en blanco en capturas fuera del
  viewport porque es `loading="lazy"`; con la sección a la vista carga y se ve correcta.
- P0/P1/P2 pendientes: ninguno.

final result: passed

---

# Design QA — recorrido editorial de precios

- Fuente visual: `exec-5b32fc4f-e2a8-4343-b9d5-f05cde6ef56a.png` (dirección 1 aprobada).
- Implementación corregida: `site/index.html` y `site/assets/pricing-journey-editorial-v2.webp`.
- Escritorio: se integra la composición aprobada completa; ya no se reconstruye como cuatro tarjetas superpuestas.
- Móvil: recorrido vertical legible sobre el fondo orbital, sin desbordamiento horizontal.
- Viewports comprobados: 1440 × 1000 y 390 × 844.
- Evidencia: `audit/pricing-editorial-v2-desktop.png`, `audit/pricing-editorial-v2-mobile.png` y `audit/pricing-editorial-v2-comparison.png`.
- P0/P1/P2 pendientes: ninguno.

final result: passed

---

# Design QA — red cinética en el hero

- Fuente visual: `/Users/johan/.codex/visualizations/2026/09/15/01a0a659-0ca1-7732-9ccc-b62c564eedcc/velai-spline-review/01-current-home.png` (hero anterior).
- Implementación: `/Users/johan/.codex/visualizations/2026/09/15/01a0a659-0ca1-7732-9ccc-b62c564eedcc/velai-spline-review/06-kinetic-grid-hero-desktop.png`.
- Comparación normalizada: `/Users/johan/.codex/visualizations/2026/09/15/01a0a659-0ca1-7732-9ccc-b62c564eedcc/velai-spline-review/09-hero-comparison-cropped.png`.
- Vista móvil: `/Users/johan/.codex/visualizations/2026/09/15/01a0a659-0ca1-7732-9ccc-b62c564eedcc/velai-spline-review/07-kinetic-grid-hero-mobile.png`.
- Viewport y densidad: fuente e implementación 1280 × 720 px sobre viewport CSS 1280 × 720, DPR 1. La comparación se recortó a 1280 × 580 por lado para excluir el estado distinto del consentimiento de cookies.
- Estado: tema oscuro, español, puntero sobre el área visual derecha. También se verificó 390 × 844 para respuesta móvil.
- Evidencia de vista completa: el hero conserva composición, proporciones, navegación, CTA, estadísticas e imagen; la única diferencia intencional es la malla naranja-violeta.
- Evidencia focal: la comparación recortada contiene titular, texto, CTA, esfera y salidas operativas con tamaño suficiente; no fue necesario otro recorte.

## Superficies de fidelidad

- Tipografía: familias, pesos, tamaños, interlineado, wrapping y jerarquía permanecen sin cambios.
- Espaciado y ritmo: hero, márgenes, CTA, estadísticas y crop de la imagen permanecen sin cambios.
- Colores: la malla reutiliza el naranja y violeta de Velai; la máscara evita reducir el contraste del titular.
- Imagen: se conserva el WebP original sin reescalado ni sustitución; el canvas actúa como capa decorativa.
- Copy: no cambia ningún texto ni traducción.

## Interacción y accesibilidad

- Puntero, deformación y onda de clic comprobados.
- Los CTA conservan sus destinos y el canvas usa `pointer-events: none`.
- Sin errores ni avisos en consola.
- En móvil y con `prefers-reduced-motion` queda un fotograma estático.

## Hallazgos

- P0/P1/P2 pendientes: ninguno.
- P3 opcional: ajustar la intensidad después de observar datos o feedback real; no bloquea el despliegue.

## Historial de comparación

- Primera comparación: sin diferencias accionables P0/P1/P2; no fueron necesarias iteraciones correctivas.

final result: passed
