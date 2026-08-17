# Velai — hirevai.com

Sitio comercial de **Velai** (asistentes de IA para PYMEs) y backend serverless de su
asistente **Vai**. Sitio estático multipágina en **Cloudflare Pages** + un **Cloudflare
Worker** (chat, captura de leads en D1, panel administrativo) — sin frameworks ni build.

## Estructura

```
*.html / */index.html      26 páginas (home, 4 verticales, 4 lp/ de pauta, blog, lead magnets…)
assets/                    funnel.js (tracking+consentimiento+Turnstile), vai-widget.js (chat),
                           leadform.js (formulario de demo), estilos
vai-worker.js              Entrypoint del Worker: prompts (SYSTEM, DEMOS, SUMMARY_PROMPT)
worker/app.js              Lógica del Worker: /chat, /lead, webhook Twilio, /api/admin/*, cron
worker/admin-page.js       HTML del panel de leads (admin.hirevai.com, tras Cloudflare Access)
migrations/                Esquema D1 (aplicar con wrangler d1 migrations apply)
test/worker.test.js        Tests (node --test, sin dependencias)
scripts/check-site.mjs     Validador del sitio (páginas, JSON-LD, enlaces, marcadores)
docs/OPERATIONS.md         ★ Runbook: puesta en marcha, deploy, degradación, rollback
docs/GUIA-WORKERS.md       ★ Para el equipo: cómo crear/consumir Workers (arquitectura vigente)
docs/STACK-TECNOLOGICO.md  Referencia de arquitectura y servicios
```

## Desarrollo

```bash
npm run check                  # sintaxis JS + validación de las 26 páginas + tests (sin npm install)
cp .dev.vars.example .dev.vars # secretos locales (NUNCA se commitea)
npx wrangler dev               # worker local en :8787
python3 -m http.server 8080    # sitio estático
```

## Despliegue

- **Sitio**: push a `main` → Cloudflare Pages despliega solo (proyecto `velai`, dominio
  `hirevai.com`; previews por rama en `https://<rama>.velai-dey.pages.dev`).
- **Worker**: `npx wrangler deploy` (manual). Bindings y variables viven en `wrangler.toml`.
- Orden, requisitos (D1, Turnstile, secrets, Access) y verificación: **`docs/OPERATIONS.md`**.

CI (`.github/workflows/ci.yml`) ejecuta `npm run check` en cada push; falla si queda
algún marcador `REPLACE_WITH_*` sin sustituir (en ramas puede saltarse con
`CHECK_ALLOW_PLACEHOLDERS=1` — el deploy real nunca debe llevarlos).
