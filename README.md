# Velai — hirevai.com

Sitio comercial de **Velai** (asistentes de IA para PYMEs) y backend serverless de su
asistente **Vai**. Sitio estático multipágina en **Cloudflare Pages** + un **Cloudflare
Worker** (chat y captura de leads en D1). El marketing no necesita framework ni build;
el panel administrativo v2 es una aplicación React compilada y servida por el Worker.

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

Requisito: **Node.js 20.19.x o 22.12+** (incluido Node 24). El rango coincide con
Vite 7 y se declara en los dos `package.json`; CI usa la rama mínima, Node 20.19.

```bash
npm run check                  # sintaxis JS + validación de las 27 páginas de site/ + tests
cd panel
npm ci
npm test -- --run              # tests de componentes
npm run typecheck              # app/Vitest y E2E/Playwright en tsconfigs separados
npm run build
npm run test:e2e               # build + smoke Chromium con API simulada, sin credenciales
cd ..
cp .dev.vars.example .dev.vars # secretos locales (NUNCA se commitea)
npx wrangler dev               # worker local en :8787
python3 -m http.server 8080 -d site  # sitio estático
```

## Despliegue

- **Sitio**: push a `main` → Cloudflare Pages despliega solo (proyecto `velai`, dominio
  `hirevai.com`, build output directory = `site`; previews por rama en
  `https://<rama>.velai-dey.pages.dev`).
- **Worker + panel**: push a `main` → CI prueba y compila el panel; si termina verde
  y el push no afecta solo a `docs/**` o ficheros Markdown, el workflow de CD descarga ese mismo
  `dist`, ensaya migraciones/deploy/humo en staging y solo entonces migra y despliega producción.
  Un reintento manual se hace con `workflow_dispatch`, indicando el SHA completo que
  siga en `main`; debe conservar un CI de push verde y sus artefactos de los últimos 7 días.
  `npx wrangler deploy` queda para operación excepcional siguiendo el runbook.
- Orden, requisitos (D1, Turnstile, secrets, Access) y verificación: **`docs/OPERATIONS.md`**.

CI (`.github/workflows/ci.yml`) ejecuta `npm run check`, los tests/build del panel y la
base de smoke E2E sin credenciales en cada push. El smoke nuevo no se considera
validado hasta ver su primer job verde en GitHub Actions. CI también falla si queda
algún marcador `REPLACE_WITH_*` sin sustituir (en ramas puede saltarse con
`CHECK_ALLOW_PLACEHOLDERS=1` — el deploy real nunca debe llevarlos).
