# Velai — hirevai.com

Sitio comercial de **Velai** (asistentes de IA para PYMEs) y backend serverless de su
asistente **Vai**. Sitio estático multipágina en **Cloudflare Pages** + un **Cloudflare
Worker** (chat, captura de leads en D1, panel administrativo) — sin frameworks ni build.

## Estructura

```
site/                      TODO el sitio publicado por Pages: 27 páginas (home, verticales,
                           lp/ de pauta, blog, lead magnets…), assets/, fonts/, _headers,
                           sitemap.xml, robots.txt (site/x/index.html se sirve como /x/)
vai-worker.js              Entrypoint del Worker: prompts (SYSTEM, DEMOS, SUMMARY_PROMPT)
worker/                    Lógica del Worker: rutas (chat, leads, webhook Twilio, /api/admin/*), cron
panel/                     Panel admin v2 (React), servido por el worker (admin.hirevai.com)
migrations/                Esquema D1 (aplicar con wrangler d1 migrations apply)
test/worker.test.js        Tests (node --test)
scripts/check-site.mjs     Validador del sitio (páginas, JSON-LD, enlaces, marcadores)
docs/OPERATIONS.md         ★ Runbook: puesta en marcha, deploy, degradación, rollback
docs/GUIA-WORKERS.md       ★ Para el equipo: cómo crear/consumir Workers (arquitectura vigente)
docs/ESTRUCTURA.md         Mapa del repo y reglas (qué es público, qué no)
docs/STACK-TECNOLOGICO.md  Referencia de arquitectura y servicios
```

## Desarrollo

```bash
npm run check                  # sintaxis JS + validación de las 27 páginas de site/ + tests
cp .dev.vars.example .dev.vars # secretos locales (NUNCA se commitea)
npx wrangler dev               # worker local en :8787
python3 -m http.server 8080 -d site  # sitio estático
```

## Despliegue

- **Sitio**: push a `main` → Cloudflare Pages despliega solo (proyecto `velai`, dominio
  `hirevai.com`, build output directory = `site`; previews por rama en
  `https://<rama>.velai-dey.pages.dev`).
- **Worker**: `npx wrangler deploy` (manual). Bindings y variables viven en `wrangler.toml`.
- Orden, requisitos (D1, Turnstile, secrets, Access) y verificación: **`docs/OPERATIONS.md`**.

CI (`.github/workflows/ci.yml`) ejecuta `npm run check` en cada push; falla si queda
algún marcador `REPLACE_WITH_*` sin sustituir (en ramas puede saltarse con
`CHECK_ALLOW_PLACEHOLDERS=1` — el deploy real nunca debe llevarlos).
