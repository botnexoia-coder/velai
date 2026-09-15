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
