# Stack tecnológico y conocimientos — Velai (hirevai.com)

Documento de referencia de las tecnologías, servicios y conocimientos usados en
este proyecto. La web es el sitio comercial de **Velai** (empresa de IA) y su
asistente **Vai**. Dominio público: `hirevai.com`; correo en `velai.ai`.

---

## 1. Arquitectura general

Sitio **estático multipágina** servido desde **Cloudflare Pages**, con un único
**Cloudflare Worker** como backend serverless para el chat de Vai, la captura de
leads y el panel admin. El Worker está dividido en: `vai-worker.js` (entrypoint +
prompts `SYSTEM`/`DEMOS`/`SUMMARY_PROMPT`) → `worker/app.js` (app de Hono 4 +
helpers) + `worker/middleware.js` (perímetro del panel) + `worker/routes/*.js`
(rutas por dominio). El marketing es HTML + CSS + JavaScript vanilla, sin build
obligatorio y optimizado para SEO/GEO; el panel v2 es React + TypeScript + Vite,
compilado a `panel/dist` y servido por el mismo Worker. El panel v1 serializado se
conserva temporalmente como rollback en `worker/admin-page.js`.

```
Navegador ──► Cloudflare Pages (HTML/CSS/JS estáticos)
                   │
                   └─► fetch ──► Cloudflare Worker (vai-worker.js → worker/app.js)
                                      ├─► Anthropic API (Claude)  — respuestas de Vai
                                      ├─► Cloudflare KV           — historial de conversación WhatsApp
                                      ├─► Cloudflare D1           — leads, estados, notas y reintentos
                                      ├─► Cloudflare Turnstile    — protección antiabuso
                                      ├─► Telegram Bot API        — notificación de leads
                                      └─► Twilio WhatsApp API     — canal WhatsApp + aviso a fundadores
```

---

## 2. Frontend

| Tecnología | Uso |
|---|---|
| **HTML5 semántico** | Páginas estáticas (`index.html`, landings `lp/`, herramientas, blog). |
| **CSS3** | Estilos. Custom properties (CSS vars) en `:root`, mayoría inline en cada HTML. |
| **SCSS** | `site/assets/styles.scss` → se compila a `site/assets/styles.css`. Compilar con: `npx sass --no-source-map --style=compressed site/assets/styles.scss site/assets/styles.css`. |
| **JavaScript vanilla (ES5/ES6)** | Sin frameworks. IIFE con `'use strict'`. Scripts en `site/assets/`. |
| **React + TypeScript + Vite** | Panel administrativo v2 en `panel/`; el Worker sirve el build de `panel/dist`. |
| **Web fonts self-hosted** | Cabinet Grotesk + Satoshi en `.woff2` (`site/fonts/fonts.css`), con `font-display: swap`. |

### Scripts de frontend
- **`site/assets/funnel.js`** — fundación de medición: Google Consent Mode v2,
  banner de consentimiento bilingüe (ES/EN, sin CMP externo), captura y
  persistencia de UTM / gclid / fbclid (atribución), wiring de eventos de
  conversión y enlaces `wa.me`.
- **`site/assets/leadform.js`** — formulario cualificador de demo reutilizable
  (`data-velai-leadform`), bilingüe, con descalificación honesta (<10 msgs/día
  no envía lead), envía a la ruta `/lead` del Worker con reintento recuperable.
- **`site/assets/vai-widget.js`** — widget de chat autocontenido (26 páginas): llama a
  `/chat`, persiste la conversación entre páginas (sessionStorage), Turnstile en
  el primer mensaje con reintento ante 403, modo demo por sector.
- **Turnstile en cliente** — `funnel.js` expone `window.VELAI_HUMAN.execute(action)`
  (carga perezosa, widget invisible); la site key pública va inline en el HTML
  (`window.VELAI_TURNSTILE_SITEKEY`).

### Convención de caché (importante)
Definida en `site/_headers`: los assets (`.js`, `.css`, fuentes, imágenes) son
**`immutable`, max-age 1 año**; el HTML es **`max-age=0, must-revalidate`**.
Por eso la configuración variable (IDs de tracking, número de WhatsApp) va
**inline en el HTML** y la lógica en los `.js` versionados con `?v=N`
(cache-busting manual al cambiar lógica).

---

## 3. Backend — Cloudflare Worker (`vai-worker.js` → `worker/app.js`)

Worker serverless (módulo ES `export default { fetch, scheduled }`). Responsabilidades:

- **Chat de Vai**: recibe mensajes (JSON desde la web, o
  `x-www-form-urlencoded` desde Twilio) y llama a la **Anthropic API**.
  - Modelo de conversación: `claude-sonnet-4-6`.
  - Modelo de resumen/extracción de lead: `claude-haiku-4-5-20251001`.
  - System prompts: `SYSTEM` (comercial) y `DEMOS` (rol-play por sector).
- **Modo demo por sector**: el visitante juega a ser cliente de un negocio
  ficticio; en demo no se notifican leads.
- **Captura de leads**: `/lead` valida Turnstile y persiste de forma idempotente
  en D1 antes de confirmar; Telegram y WhatsApp son avisos reintentables. Con D1
  caída degrada a KV + aviso directo (`stored`/`degraded` en la respuesta) y el
  cron re-inserta. El chat web y el **WhatsApp entrante** también capturan leads
  (en WhatsApp, teléfono = `From` de Twilio, una vez por remitente).
- **Multi-tenant**: la config de cada negocio vive en la tabla `tenants` (D1); el
  webhook de Twilio enruta por `To` y el canal web por `body.tenant` (default
  `velai`). El prompt efectivo es `tenant.system_prompt + GUARDRAILS` (los
  guardrails son código y se concatenan siempre). Lookup cacheado en KV 5 min.
  Copias versionadas de los prompts en `tenants/*.md`; seed en `seed/`.
- **Chat web v2**: `/chat` recibe solo el nuevo mensaje, conserva el historial
  canónico 24 h en KV (namespaceado por tenant) y verifica Turnstile en la primera
  interacción. El antiguo `POST /` JSON devuelve **410 `legacy_chat_retired`**.
- **Panel**: hostname de `ADMIN_ORIGIN` (hoy `admin.hirevai.com`), protegido con
  Cloudflare Access y JWT validado por el propio Worker (JWKS cacheado 10 min).
  Rutas: `GET/PATCH/DELETE /api/admin/leads[...]`, `/notes`, `/retry`,
  `/export.csv` (con neutralización de fórmulas).
- **Cron (`*/5 * * * *`)**: reintenta avisos (5 intentos, backoff cuadrático;
  `skipped` se revisita cada 6 h), drena la cola `leadq:*` de KV hacia D1 y
  purga leads caducados.
- **Seguridad**: CORS exacto, límites de payload, rate limit, timeouts,
  validación de firma Twilio en tiempo constante y guarda de prototipo en las
  claves de `DEMOS`.

### Servicios externos integrados
| Servicio | Para qué | Credenciales (env/secrets) |
|---|---|---|
| **Anthropic API** (`api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`) | Respuestas de Vai + extracción de leads. | `ANTHROPIC_API_KEY` |
| **Cloudflare KV** | Historial de conversación (`conv:wa:<from>` y `conv:web:<uuid>`, TTL 24h, máx 20 mensajes), rate limiting (`rl:<bucket>:<ip>`), cola de leads en contingencia (`leadq:*`) y marca de lead por remitente WA (`lead:wa:*`). | binding `KV` |
| **Cloudflare D1** | Fuente de verdad de leads, notas, estados y notificaciones. | binding `DB` |
| **Cloudflare Turnstile** | Verificación antiabuso de formularios y primer mensaje. | `TURNSTILE_SECRET_KEY` |
| **Cloudflare Access** | Autenticación del panel administrativo. | `TEAM_DOMAIN`, `POLICY_AUD` |
| **Telegram Bot API** | Canal centralizado de notificación de leads (HTML). | `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID` |
| **Twilio WhatsApp API** | Canal WhatsApp del bot + aviso al equipo. | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TEAM_WHATSAPP` |

Variables no-secretas en `wrangler.toml [vars]`: `ALLOWED_WEB_ORIGINS` (CORS
exacto, incluye el alias de preview de Pages), `ADMIN_ORIGIN` (hostname del
panel) y `LEAD_RETENTION_MONTHS` (purga RGPD).

> El Worker se despliega en `vai-worker.botnexo-ia.workers.dev` (configurable en
> el frontend vía `window.VELAI_WORKER`); el panel solo responde en el hostname
> de `ADMIN_ORIGIN`.

---

## 4. Infraestructura y despliegue

- **Cloudflare Pages** — hosting del sitio estático (deploy desde git).
- **Cloudflare Workers** — backend serverless del chat/leads.
- **Cloudflare KV** — almacén key-value para historial de conversaciones.
- **Cloudflare D1** — persistencia de leads durante 24 meses desde la última actividad.
- **Cloudflare Access** — acceso administrativo sin contraseñas propias.
- **`site/_headers`** — políticas de caché y cabeceras de seguridad (`X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS con preload,
  COOP y CSP base con `frame-ancestors`).
- **Git** — control de versiones (rama `main`).
- **Entornos** — `producción` (`vai-worker`, D1 `vai-leads`) y `staging`
  (`vai-worker-staging`, D1 `vai-leads-staging`, sin clientes). Cada push no documental
  de `main` ensaya en staging tras CI verde y solo después toca producción. Detalle y reglas:
  `docs/OPERATIONS.md` §Staging.
- **Tooling** — Node **20.19.x o >=22.12** (rango de Vite 7; CI usa el mínimo). El Worker tiene una
  sola dependencia de runtime (Hono 4, con lockfile; `npm ci` en CI): `npm run check` = `node --check`
  de los JS + `scripts/check-site.mjs` (valida las 27 páginas, JSON-LD, recursos
  internos y marcadores sin sustituir) + `scripts/check-aislamiento.mjs` (ninguna
  consulta del panel sin filtro de tenant ni puerta) + `scripts/check-entornos.mjs`
  (staging y producción no comparten recursos ni se desincronizan) + `node --test`
  (`test/worker.test.js` y `test/aislamiento.test.js`). El catálogo se pasa de forma
  explícita a `node --test`, portable entre Node 20 y 24 (Node 20 no interpreta el glob
  `"test/**/*.test.js"` y el autodiscovery alcanza también el subproyecto React), y
  `check-test-catalog.mjs` falla si aparece un test backend no enumerado. CI añade los
  tests, typecheck/build y la base de smoke Playwright del panel con API interceptada:
  no necesita Access ni credenciales, bloquea la red y solo permite GET. El CD solo se
  dispara tras CI verde y consume su mismo `panel/dist`; el smoke queda pendiente de su
  primera validación en el runner de GitHub Actions.
- **Migraciones D1** — `migrations/` (aplicar con `wrangler d1 migrations apply`).
- El runbook operativo completo (puesta en marcha, deploy, rollback) vive en
  `docs/OPERATIONS.md`. Para implementar Workers o endpoints nuevos, la guía de
  patrones obligatoria del equipo es `docs/GUIA-WORKERS.md` (la arquitectura
  monolítica anterior está retirada — su endpoint responde 410).

---

## 5. SEO / GEO / AEO

Pilar central del proyecto. Conocimientos aplicados:

- **SEO on-page**: `title`, `meta description`, `keywords`, canonical, headings
  semánticos.
- **Open Graph + Twitter Cards** para previsualizaciones en redes.
- **`hreflang`** (`es`, `x-default`) — base multi-idioma.
- **Schema.org / JSON-LD** — datos estructurados (`SoftwareApplication`,
  `Organization`, etc.) en `index.html` y `blog/`.
- **`site/sitemap.xml`** y **`site/robots.txt`** mantenidos a mano.
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
