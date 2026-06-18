# Stack tecnológico y conocimientos — Velai (hirevai.com)

Documento de referencia de las tecnologías, servicios y conocimientos usados en
este proyecto. La web es el sitio comercial de **Velai** (empresa de IA) y su
asistente **Vai**. Dominio público: `hirevai.com`; correo en `velai.ai`.

---

## 1. Arquitectura general

Sitio **estático multipágina** servido desde **Cloudflare Pages**, con un único
**Cloudflare Worker** (`vai-worker.js`) como backend serverless para el chat de
Vai y la captura de leads. No hay framework de frontend ni build pesado: HTML +
CSS + JavaScript vanilla, optimizado para SEO/GEO y velocidad de carga.

```
Navegador ──► Cloudflare Pages (HTML/CSS/JS estáticos)
                   │
                   └─► fetch ──► Cloudflare Worker (vai-worker.js)
                                      ├─► Anthropic API (Claude)  — respuestas de Vai
                                      ├─► Cloudflare KV           — historial de conversación WhatsApp
                                      ├─► Telegram Bot API        — notificación de leads
                                      └─► Twilio WhatsApp API     — canal WhatsApp + aviso a fundadores
```

---

## 2. Frontend

| Tecnología | Uso |
|---|---|
| **HTML5 semántico** | Páginas estáticas (`index.html`, landings `lp/`, herramientas, blog). |
| **CSS3** | Estilos. Custom properties (CSS vars) en `:root`, mayoría inline en cada HTML. |
| **SCSS** | `assets/styles.scss` → se compila a `assets/styles.css`. Compilar con: `npx sass --no-source-map --style=compressed assets/styles.scss assets/styles.css`. |
| **JavaScript vanilla (ES5/ES6)** | Sin frameworks. IIFE con `'use strict'`. Scripts en `assets/`. |
| **Web fonts self-hosted** | Cabinet Grotesk + Satoshi en `.woff2` (`fonts/fonts.css`), con `font-display: swap`. |

### Scripts de frontend
- **`assets/funnel.js`** — fundación de medición: Google Consent Mode v2,
  banner de consentimiento bilingüe (ES/EN, sin CMP externo), captura y
  persistencia de UTM / gclid / fbclid (atribución), wiring de eventos de
  conversión y enlaces `wa.me`.
- **`assets/leadform.js`** — formulario cualificador de demo reutilizable
  (`data-velai-leadform`), bilingüe, con descalificación honesta (<10 msgs/día
  no envía lead), envía a la ruta `/lead` del Worker.

### Convención de caché (importante)
Definida en `_headers`: los assets (`.js`, `.css`, fuentes, imágenes) son
**`immutable`, max-age 1 año**; el HTML es **`max-age=0, must-revalidate`**.
Por eso la configuración variable (IDs de tracking, número de WhatsApp) va
**inline en el HTML** y la lógica en los `.js` versionados con `?v=N`
(cache-busting manual al cambiar lógica).

---

## 3. Backend — Cloudflare Worker (`vai-worker.js`)

Worker serverless (módulo ES `export default { fetch }`). Responsabilidades:

- **Chat de Vai**: recibe mensajes (JSON desde la web, o
  `x-www-form-urlencoded` desde Twilio) y llama a la **Anthropic API**.
  - Modelo de conversación: `claude-sonnet-4-6`.
  - Modelo de resumen/extracción de lead: `claude-haiku-4-5-20251001`.
  - System prompts: `SYSTEM` (comercial) y `DEMOS` (rol-play por sector).
- **Modo demo por sector**: el visitante juega a ser cliente de un negocio
  ficticio; en demo no se notifican leads.
- **Captura de leads**:
  - Ruta `/lead`: leads de formulario/quiz → notifica **solo por Telegram**.
  - Chat: detecta teléfono en el mensaje → resume la conversación con Claude
    (JSON estructurado) → notifica por Telegram y WhatsApp.
- **CORS** manual, manejo de `OPTIONS`/`POST`.

### Servicios externos integrados
| Servicio | Para qué | Credenciales (env/secrets) |
|---|---|---|
| **Anthropic API** (`api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`) | Respuestas de Vai + extracción de leads. | `ANTHROPIC_API_KEY` |
| **Cloudflare KV** | Persistencia del historial de conversación de WhatsApp (`conv:<from>`, TTL 24h, máx 20 mensajes). | binding `KV` |
| **Telegram Bot API** | Canal centralizado de notificación de leads (HTML, `chat_id` fijo). | `TELEGRAM_TOKEN` |
| **Twilio WhatsApp API** | Canal WhatsApp del bot + aviso a fundadores. | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |

> El Worker se despliega en `vai-worker.botnexo-ia.workers.dev` (configurable en
> el frontend vía `window.VELAI_WORKER`).

---

## 4. Infraestructura y despliegue

- **Cloudflare Pages** — hosting del sitio estático (deploy desde git).
- **Cloudflare Workers** — backend serverless del chat/leads.
- **Cloudflare KV** — almacén key-value para historial de conversaciones.
- **`_headers`** — políticas de caché y cabeceras de seguridad (HSTS no,
  pero sí `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`).
- **Git** — control de versiones (rama `main`).

---

## 5. SEO / GEO / AEO

Pilar central del proyecto. Conocimientos aplicados:

- **SEO on-page**: `title`, `meta description`, `keywords`, canonical, headings
  semánticos.
- **Open Graph + Twitter Cards** para previsualizaciones en redes.
- **`hreflang`** (`es`, `x-default`) — base multi-idioma.
- **Schema.org / JSON-LD** — datos estructurados (`SoftwareApplication`,
  `Organization`, etc.) en `index.html` y `blog/`.
- **`sitemap.xml`** y **`robots.txt`** mantenidos a mano.
- **GEO/AEO (optimización para IA generativa)**: `robots.txt` permite
  explícitamente bots de IA (GPTBot, ChatGPT-User, OAI-SearchBot,
  PerplexityBot, ClaudeBot, Claude-Web, Google-Extended, Applebot-Extended)
  para que citen el contenido. Bloque "pregúntale a la IA sobre Velai".
- **Estrategia de contenido/backlinks**: ver `docs/backlinks-plan.md` y
  `docs/links-strategy.md`.
- **Blog SEO-first** en `blog/` (artículos comparativos y "alternativa a X").

---

## 6. Privacidad y cumplimiento (RGPD)

- **Google Consent Mode v2** con consentimiento por defecto **denegado**.
- **Banner de consentimiento self-hosted** (sin CMP de terceros), bilingüe.
- Tags de Google/Meta solo se cargan tras aceptación.
- Cualificación honesta de leads (no se capturan datos si el negocio no encaja).

---

## 7. Herramientas / lead magnets (páginas estáticas interactivas)

Cada una es una página con JS vanilla que alimenta el funnel:

- `calculadora-roi/` — ROI del asistente.
- `calculadora-ventas-perdidas/` — ventas perdidas por no atender.
- `diagnostico-whatsapp/` — quiz/diagnóstico con score.
- `cotizador-precio/` — mini-cotizador en 3 pasos.
- `generador-link-whatsapp/` — generador de enlace `wa.me`.
- `test-ley-atencion-cliente/` — test orientativo.
- Landings verticales: `lp/{restaurantes,clinicas,inmobiliarias,talleres}/` y
  secciones por sector (`restaurantes/`, `clinicas/`, `talleres/`, etc.).

---

## 8. Resumen de conocimientos clave para trabajar aquí

1. **Cloudflare** (Pages, Workers, KV, `_headers`).
2. **JavaScript vanilla** sin frameworks (patrón IIFE, ES módulos en el Worker).
3. **Anthropic API / Claude** (system prompts, modelos Sonnet/Haiku, extracción
   JSON estructurada).
4. **Integraciones**: Telegram Bot API, Twilio WhatsApp API.
5. **SEO técnico + GEO/AEO** y datos estructurados Schema.org.
6. **RGPD / Consent Mode v2** y atribución de marketing (UTM/gclid/fbclid).
7. **SCSS** compilado a CSS, fuentes self-hosted, estrategia de caché immutable.
