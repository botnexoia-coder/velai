# Velai — Funnel de Ventas: Investigación Competitiva y Blueprint de Implementación

> Documento de trabajo para desarrollo. Fecha de investigación: 2026-06-11.
> Objetivo: definir y construir el funnel de ventas de Velai (hirevai.com) para España y Colombia,
> basado en el análisis de ~15 competidores reales del espacio "agentes de IA para negocios".

---

## 1. Contexto del negocio

**Velai** implanta **Vai**, un asistente de IA conversacional llave en mano para PYMEs:

- Atiende, vende y gestiona reservas/pedidos en **WhatsApp, web e Instagram**, 24/7.
- Entregado **funcionando en menos de 48 horas**, entrenado con catálogo, precios, horarios y procesos del cliente.
- Precio: **setup único desde 1.000 € + desde 100 €/mes**.
- Público: PYMEs de servicios sin equipo técnico (restaurantes, clínicas, talleres, inmobiliarias) que reciben 30–100+ mensajes/día.
- Diferenciador clave vs. ManyChat/Tidio/Intercom: **no es una herramienta que el cliente monta; es un resultado entregado.**

Activos existentes: web hirevai.com, blog con SEO comparativo incipiente, calculadora de ROI (`/calculadora-roi/`), CTA de demo.

---

## 2. Hallazgo central de la investigación

En ambos mercados el patrón es idéntico y deja un hueco claro:

| Tipo de player | Ejemplos | Su funnel | Su debilidad |
|---|---|---|---|
| Enterprise consultivo | Aunoa, Centribal, Keybe, Truora, Botmaker | Demo-led, sin precios públicos | Abandonaron / no atienden a la PYME pequeña |
| SaaS DIY | Landbot, Cliengo, Whaticket, Wati, Tidio | Trial self-service, precios públicos | El cliente debe montarlo y mantenerlo él mismo |
| Llave en mano vertical | **Bookline** (solo hostelería/voz, España) | Demo única, vende resultado | Cubre un solo vertical y un solo canal |

**El hueco de Velai: llave en mano multivertical para PYME, con la transparencia de un SaaS y la promesa de resultado de un servicio.** Nadie ocupa esa casilla hoy en España ni en Colombia.

---

## 3. Competidores analizados (resumen)

### España

| Competidor | Funnel | Lead magnet | Precios públicos | Lo copiable |
|---|---|---|---|---|
| **Aunoa** (aunoa.ai) | Demo-led | Calculadora ROI, Test Ley SAC, generador links WA | No | Herramientas gancho por temperatura de lead |
| **Bookline** (bookline.ai) | Demo única | Métricas en vivo en la home | No ("sin comisiones") | Storytelling de dolor vertical, testimonios de dueños |
| **Landbot** (landbot.io) | PLG: trial + demo | Plan gratis, +100 plantillas, builder en la home | Sí (40–400 €/mes) | Transparencia de precio, "jugar" con el producto |
| **Cliengo** (cliengo.com) | Trial 14 días + demo | Guía WhatsApp descargable | Sí ($45–259/mes) | FAQ de pricing que desarma objeciones |
| **Centribal** (centribal.com) | Sales-led puro | Solo demo | No | Estructura de planes por volumen |
| **Oct8ne** (oct8ne.com) | Trial + demo | Cifras de beneficio en home | Parcial | Casos con métricas (+30% ventas) |
| **Whaticket** (whaticket.com) | Trial self-service | Generador links WA, ebooks | Sí (USD) | SEO comparativo "vs. competidor" |

### Colombia

| Competidor | Funnel | Lead magnet | Precios públicos | Lo copiable |
|---|---|---|---|---|
| **Leadsales** (leadsales.io) | Trial $7 + demo grupal | Generador link/QR WA, Academy | Sí ($97–247/mes) | Demos grupales en vivo, onboarding 72h como promesa |
| **Wasapi** (wasapi.io) | Trial + demo | **Diagnóstico de Atención en WhatsApp™** (quiz con puntaje) | Sí ($99–399/mes) | El mejor lead magnet de la muestra |
| **B2Chat** (b2chat.io) | Demo cualificada + WA directo | Cotizador interactivo 5 pasos | Sí ($33–187/mes + desglose Meta) | Transparencia radical, formulario que cualifica |
| **Treble.ai** (treble.ai) | PLG sin tarjeta | Demos interactivas por industria | No | Trial sin tarjeta, botones "pregunta a ChatGPT sobre nosotros" (GEO) |
| **Keybe/Biky** (keybe.ai) | Signup + WA + partners | "Contrata a Biky, tu vendedora IA" | No | Personaje IA con nombre propio; verticalización |
| **Cliengo** | Trial + partners | Trial 14 días | Sí | Red de agencias como fuerza de ventas |
| **Truora** (truora.com) | Sales-led inbound | Ebooks, webinars, asesoría gratis | Parcial | Estándar de contenido educativo |
| **Wati** (wati.io) | SaaS self-service | Trial gratis | Sí (por región) | Genérico; poco que copiar |

---

## 4. Blueprint del funnel Velai

Principio rector: **Vai se vende a sí misma.** Cada etapa del funnel debe ser una experiencia con el producto, no una descripción del producto.

```
CAPTACIÓN              ACTIVACIÓN                CONVERSIÓN           CIERRE Y EXPANSIÓN
─────────              ──────────                ──────────           ──────────────────
SEO vertical      →    Diagnóstico WhatsApp  →   Demo instantánea  →  Propuesta + setup 48h
SEO comparativo   →    Calculadora de        →   por WhatsApp con  →  Onboarding asistido
Herramientas           ventas perdidas           asistente de tu      Caso de éxito
gratuitas              (leads con datos          sector (¡hablar      documentado →
Casos de éxito         de su negocio)            CON Vai, no          referidos y
GEO (IA buscadores)                              SOBRE Vai)           testimonios
```

### Etapa 1 — Captación (TOFU)

**1a. SEO vertical (modelo Bookline, multivertical):** una landing por sector con el dolor en el idioma del dueño, no del técnico.

- `/restaurantes` — "Cada llamada o WhatsApp sin responder es una mesa vacía"
- `/clinicas` — "Citas confirmadas y recordatorios automáticos; menos no-shows"
- `/talleres` — "Presupuestos y citas de taller respondidos al instante"
- `/inmobiliarias` — "Cada lead de portal contestado en segundos, 24/7"

Cada landing: dolor → cómo lo resuelve Vai (3 bullets) → caso de éxito del sector con cifras → CTA dual (probar demo por WhatsApp / pedir demo guiada).

**1b. SEO comparativo (modelo Whaticket):** artículos "Alternativa a X en español / para PYMEs": ManyChat, Tidio, Landbot, Cliengo, Leadsales, B2Chat, Wasapi. El de ManyChat/Tidio/Intercom ya existe — replicar formato honesto ("cuándo NO elegirnos") que ya funciona como generador de confianza.

**1c. Herramientas gratuitas SEO (modelo Aunoa/Leadsales):** generador de link de WhatsApp + generador de QR. Tráfico transaccional barato y constante; cada herramienta con banner contextual hacia el diagnóstico.

**1d. GEO (modelo Treble):** botones/snippets "Pregúntale a ChatGPT/Perplexity/Claude sobre Velai" + contenido estructurado (FAQ schema, comparativas) optimizado para buscadores de IA, donde la PYME ya investiga proveedores.

### Etapa 2 — Activación / Lead magnets (MOFU)

**2a. ⭐ Diagnóstico de Atención por WhatsApp (modelo Wasapi — máxima prioridad):**

- Quiz de 2 minutos, 8–10 preguntas: sector, mensajes/día, tiempo medio de respuesta, % fuera de horario, quién responde hoy, reservas/pedidos por chat, etc.
- Output: **puntaje 0–100 + informe personalizado** (fortalezas, fugas, estimación de ventas perdidas/mes).
- Pide nombre + WhatsApp/email para entregar el informe → lead cualificado CON sus dolores ya diagnosticados.
- El comercial llega a la llamada sabiendo exactamente qué le duele al prospecto.

**2b. Calculadora de ventas perdidas (evolución de la calculadora ROI actual):** reorientar el framing de "cuánto ahorras con IA" a "**cuánto pierdes hoy por no responder**" (mensajes/día × % sin responder o respondidos tarde × ticket medio × tasa de conversión). El dolor cuantificado vende más que el beneficio abstracto.

**2c. Test Ley de Atención al Cliente (solo España, modelo Aunoa):** mini-test "¿Cumple tu negocio la Ley SAC?". Urgencia regulatoria = lead caliente.

### Etapa 3 — Conversión (BOFU)

**3a. ⭐ Demo instantánea por WhatsApp (la ventaja única de Velai):** Bookline no puede hacerlo (voz); los SaaS no lo hacen (te dan un builder vacío). Velai sí:

- Botón en cada landing vertical: "**Habla ahora con la Vai de un restaurante**" → abre wa.me con un asistente demo de ese sector (negocio ficticio completo: carta, horarios, reservas).
- El prospecto **experimenta el producto final en el canal real en 10 segundos**, sin formulario.
- El asistente demo, tras 3–4 intercambios, ofrece: "¿Quieres una Vai así para tu negocio? Te conecto con el equipo / agenda aquí tu demo personalizada."
- Esto ES el funnel: la demo se hace en el producto, el producto cualifica y agenda.

**3b. Precio público como diferenciador:** frente a tanto "contáctanos" (Aunoa, Centribal, Keybe, Bookline), publicar sin miedo: "**Desde 1.000 € de setup + desde 100 €/mes. Funcionando en 48 horas.**" Añadir mini-cotizador de 3 pasos (sector → volumen de chats → canales) que devuelve rango de precio (modelo B2Chat). La transparencia autocualifica y acelera ciclos.

**3c. Formulario de demo que cualifica (modelo B2Chat):** sector, mensajes/día, canal principal, quién responde hoy. Si <10 mensajes/día → descalificación honesta automática ("probablemente aún no nos necesitas, aquí tienes una guía gratuita") — refuerza la marca honesta del blog y eleva la calidad del pipeline.

**3d. Demos grupales en vivo (modelo Leadsales, fase 2):** webinar semanal de 30 min "Mira a Vai atender un negocio real" por vertical. Escala el tiempo comercial cuando el volumen de leads lo justifique.

### Etapa 4 — Cierre, onboarding y expansión

- **La promesa de 48h como eje de cierre:** countdown explícito en la propuesta ("firma hoy, tu asistente atiende el sábado"). Leadsales hace de sus "72 hrs" un argumento; Velai tiene una promesa mejor — explotarla.
- **Caso de éxito como parte del contrato:** a los 60–90 días, documentar cifras (mensajes atendidos, reservas gestionadas, ventas recuperadas) → testimonio en vídeo/quote del dueño → alimenta las landings verticales. Bookline y Keybe demuestran que el testimonio de un par (dueño a dueño) es el activo de conversión más fuerte del segmento.
- **Programa de referidos** (descuento en mensualidad por referido cerrado) y, en fase 2, **red de agencias partner** (modelo Cliengo) para capilaridad en Colombia.
- **Nurturing:** secuencia de email/WhatsApp post-diagnóstico (informe → caso de éxito del sector → invitación a demo → oferta de auditoría en llamada). Newsletter mensual con casos.

---

## 5. Roadmap de implementación

### Sprint 1 (semanas 1–2) — lo que más convierte con lo que ya existe
1. **Demo instantánea por WhatsApp**: montar 1 asistente demo (restaurante) + botón wa.me en home y landing. Es producto existente reutilizado como activo de marketing.
2. **Publicar pricing** en la web con la promesa 48h al lado.
3. Reorientar calculadora ROI → **calculadora de ventas perdidas**.

### Sprint 2 (semanas 3–4)
4. **Diagnóstico de Atención por WhatsApp** (quiz + scoring + informe + captura de lead).
5. Landing vertical `/restaurantes` completa (dolor + caso + demo WA del sector).
6. Formulario de demo cualificador con descalificación honesta.

### Sprint 3 (semanas 5–8)
7. Landings `/clinicas`, `/talleres`, `/inmobiliarias` + asistentes demo por sector.
8. 3–4 artículos "Alternativa a X" + generador de link/QR de WhatsApp.
9. Secuencia de nurturing post-diagnóstico (email/WhatsApp).
10. Test Ley SAC (España).

### Fase 2 (mes 3+)
11. Demos grupales en vivo por vertical.
12. Programa de referidos y partners (Colombia).
13. GEO: FAQ schema, botones "pregunta a la IA", contenido estructurado.
14. Mini-cotizador interactivo de precio.

---

## 6. Especificaciones técnicas de los activos prioritarios

### A. Demo instantánea por WhatsApp
- **Stack:** número de WhatsApp Business API dedicado por vertical (o uno con menú inicial de selección de sector). Asistente Vai estándar entrenado con negocio ficticio realista (carta/servicios, precios, horarios, sistema de reservas simulado).
- **Comportamiento:** atiende como en producción; tras 3–4 turnos o ante intención de compra, pivota a venta de Velai con CTA de agendar demo (link Calendly/Cal.com) o conectar con humano.
- **Tracking:** UTM en el link wa.me, registro de conversaciones demo, tasa demo-WA → demo agendada.

### B. Diagnóstico de Atención por WhatsApp
- **Frontend:** quiz de 8–10 preguntas, una por pantalla, barra de progreso, mobile-first (el tráfico será móvil).
- **Scoring:** puntaje 0–100 ponderado (tiempo de respuesta 25%, cobertura horaria 25%, volumen gestionado 20%, automatización actual 15%, seguimiento post-venta 15%).
- **Output:** página de resultados + informe enviado por WhatsApp/email (esto también demuestra el canal). Incluir estimación de € perdidos/mes reutilizando la lógica de la calculadora.
- **Lead capture:** nombre, negocio, sector, WhatsApp. Webhook a CRM con respuestas completas adjuntas.

### C. Calculadora de ventas perdidas
- **Inputs:** mensajes/día, % respondidos tarde o nunca (con valores por defecto por sector), ticket medio, tasa de conversión estimada del sector.
- **Output:** "Estás perdiendo ~X €/mes" + comparación con coste de Vai (100 €/mes) → ROI implícito. CTA: diagnóstico o demo WA.

### D. Landing vertical (plantilla)
- Estructura: H1 de dolor → 3 bullets de solución → demo WA embebida/botón → caso de éxito con cifras y foto del dueño → pricing resumido → FAQ del sector → CTA final.
- Una sola plantilla parametrizada (copy, caso, número WA demo) para escalar a nuevos verticales.

---

## 7. KPIs del funnel

| Etapa | Métrica | Referencia inicial |
|---|---|---|
| Captación | Visitas a landings verticales y herramientas; % tráfico orgánico | establecer baseline mes 1 |
| Activación | Diagnósticos completados / iniciados (objetivo >60%); leads capturados/semana | — |
| Conversión | Conversaciones demo-WA iniciadas; demo-WA → demo agendada (objetivo >15%); demo → propuesta | — |
| Cierre | Propuesta → firma; tiempo medio de ciclo (objetivo <14 días apoyado en promesa 48h) | — |
| Expansión | Casos de éxito documentados/trimestre (objetivo 3); % clientes por referido | — |

---

## 8. Fuentes

**España:** https://aunoa.ai · https://aunoa.ai/precios/ · https://aunoa.ai/calculadora-roi-agente-ia/ · https://bookline.ai · https://landbot.io/pricing · https://www.cliengo.com/pricing · https://centribal.com/planes/ · https://oct8ne.com/es/ · https://whaticket.com/precios/

**Colombia:** https://leadsales.io/precios/ · https://www.wasapi.io (diagnóstico: https://www.puntajedeatencionwasapi.com/) · https://www.b2chat.io/precios/ · https://treble.ai · https://keybe.ai · https://biky.ai · https://www.truora.com · https://www.wati.io/pricing/

**Propias:** https://hirevai.com/blog/comparativa-manychat-tidio-intercom/ · https://hirevai.com/calculadora-roi/
