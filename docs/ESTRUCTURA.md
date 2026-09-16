# Estructura del repo — mapa y reglas

> Fuente de verdad de **qué es cada carpeta y por qué está donde está**.
> Última revisión: 2026-09-03.

---

## La restricción que lo gobierna todo

**`site/` ES el directorio publicado de Cloudflare Pages.**
El proyecto Pages `velai` (dominio `hirevai.com`) despliega en cada push a
`main` con *build output directory* = `site`, sin build:
`site/clinicas/index.html` se sirve como `hirevai.com/clinicas/`. Consecuencias:

1. **Cada carpeta de `site/` con `index.html` es una URL pública con SEO
   invertido** (sitemap.xml, backlinks, campañas de pauta). Moverla o
   renombrarla cambia la URL y rompe todo eso. **Prohibido moverlas** salvo
   plan explícito con redirecciones.
2. **Todo lo commiteado dentro de `site/` es públicamente descargable.**
   El resto del repo (worker/, docs/, seed/, tenants/…) ya NO lo publica
   Pages — esa era la exposición que cerró el plan de `site/`
   (consolidación del marketing en `site/`, cerrada el 2026-09-01 y resumida en
   [`IMPLEMENTADO.md`](./IMPLEMENTADO.md)). Aun así: **nunca commitear nada
   sensible, en ninguna carpeta** (los secretos van en `.dev.vars` local y
   en secrets de wrangler/GitHub).
3. `.gitignore` no protege de Pages: ignora lo no commiteado, pero Pages
   sirve lo commiteado dentro de `site/`. Son dos capas distintas.

## Mapa de la raíz

### (a) `site/` — publicado e intocable (URLs con SEO/campañas encima)

| Elemento (dentro de `site/`) | Qué es |
|---|---|
| `index.html` | Home de hirevai.com |
| `que-es-velai/`, `privacidad/`, `condiciones/` | Páginas corporativas/legales |
| `clinicas/`, `restaurantes/`, `inmobiliarias/`, `talleres/` | Landings verticales (en sitemap) |
| `lp/{clinicas,restaurantes,inmobiliarias,talleres}/` | Landings de pauta (noindex a propósito, con campañas apuntando) |
| `blog/` | Blog SEO (8 posts + índice) |
| `calculadora-roi/`, `calculadora-ventas-perdidas/`, `cotizador-precio/`, `diagnostico-whatsapp/`, `generador-link-whatsapp/`, `test-ley-atencion-cliente/` | Lead magnets interactivos |
| `assets/` | `funnel.js` (tracking+consentimiento+Turnstile), `vai-widget.js` (chat), `leadform.js`, `styles.css` (compilado de `styles.scss`, ver STACK-TECNOLOGICO.md) |
| `fonts/` | Tipografías de marca (el panel las consume cross-origin; CORS en `_headers`) |
| `favicon.svg`, `og-velai.jpg`, `robots.txt`, `sitemap.xml`, `_headers` | Infra del sitio estático (`_headers` DEBE vivir dentro de `site/`: Pages lo lee desde el output dir) |

### (b) Infraestructura del worker (backend)

| Elemento | Qué es |
|---|---|
| `vai-worker.js` | Entrypoint del Worker declarado en `wrangler.toml` (`main`); prompts SYSTEM/DEMOS/SUMMARY |
| `worker/` | La lógica: rutas, servicios y adaptadores (en reestructuración a capas modulares) |
| `wrangler.toml` | Bindings, vars, rutas, entorno staging |
| `migrations/` | Esquema D1, secuencial (`wrangler d1 migrations apply`) |
| `.dev.vars.example` | Plantilla de secretos locales (`.dev.vars` real nunca se commitea) |

### (c) Tooling y desarrollo

| Elemento | Qué es |
|---|---|
| `scripts/` | `check-site.mjs` (valida las 27 páginas de `site/`), `check-aislamiento.mjs`, `check-entornos.mjs`, `check-test-catalog.mjs` (ningún test backend omitido), `deploy-scope.mjs` (manifiesto y frescura CI→CD), `check-bundle.mjs` (panel contra bundle real), `render-panel.mjs` (render a PNG) |
| `test/` | `node --test`, sin dependencias |
| `package.json` | Scripts (`npm run check`) y Hono; Node 20.19.x o >=22.12 |
| `.github/workflows/` | `ci.yml` (checks + panel + smoke y artefacto), `deploy-worker.yml` (solo tras CI verde: staging → producción) |
| `.gitignore` | Ver comentarios dentro; recordar el punto 3 de arriba |

### (d) Datos y configuración versionados

| Elemento | Qué es |
|---|---|
| `seed/` | SQL de datos iniciales (velai, staging). Sin secretos, por diseño |
| `tenants/` | Prompts de negocio por tenant, copia versionada para revisión — la fuente de verdad es la columna `system_prompt` en D1 |
| `docs/` | Documentación (índice de fuentes de verdad abajo) |

### (e) Residuos ya eliminados

- `distB/` — bundle de `wrangler --dry-run --outdir` commiteado por accidente
  (22e9183, 26-08). Borrado tras verificar cero referencias; `dist*/` ahora en
  `.gitignore`.

## Arquitectura: capas modulares en un solo worker

Decisión tomada (2026-09-01): **un solo Cloudflare Worker organizado en capas
modulares** — `routes/` (HTTP), `services/` (lógica de negocio) y adaptadores
(Twilio, Telegram, Anthropic, D1/KV, Calendar) como módulos planos.

**Por qué NO microservicios (varios workers):**
- Un solo desarrollador y ~5k líneas: el coste de coordinación no compra nada.
- Las cuotas del plan gratuito (lecturas/escrituras KV, triggers de cron) se
  cuentan **por worker**: partir el sistema multiplica el consumo del mismo
  trabajo.
- Lo que hoy es una llamada a función pasaría a ser una llamada de red entre
  workers (service bindings o HTTP): latencia y modos de fallo nuevos sin
  ganancia de escala real.

**Por qué NO hexagonal completo (puertos y adaptadores ceremoniosos):**
- La separación que importa —dominio que no sabe de Twilio/Telegram— **ya
  existe** en los módulos de `worker/` (`twilio.js`, `calendar.js`,
  `cloudflare.js`, `crypto.js` son adaptadores de facto).
- En JS sin inyección de dependencias ni tipos, las interfaces de puerto son
  papeleo: no las verifica nadie en compile-time. La disciplina se sostiene con
  la estructura de carpetas y `npm run check`, no con ceremonia.

**Estructura del repo:**

```
site/              el marketing publicado por Pages (27 páginas + assets/fonts/_headers…)
worker/            backend: routes/ + services/ + adaptadores sobre Hono
panel/             panel admin v2 React, compilado y servido por el Worker
migrations/        esquema D1
docs/              documentación
test/              tests node --test
scripts/           validadores y herramientas
seed/              datos iniciales
tenants/           prompts de negocio versionados
```

La consolidación en `site/` está EN EJECUCIÓN: el repo ya está listo (copia +
retirada de la raíz) y falta el flip del *build output directory* en el
dashboard, que es del dueño — pasos restantes y verificación en
[`IMPLEMENTADO.md`](./IMPLEMENTADO.md), sección «Marketing consolidado en site/».

## docs/ — qué doc es la fuente de verdad de qué

| Doc | Fuente de verdad de |
|---|---|
| [`OPERATIONS.md`](./OPERATIONS.md) | ★ Runbook: puesta en marcha, deploy, degradación, rollback |
| [`GUIA-WORKERS.md`](./GUIA-WORKERS.md) | ★ Cómo crear/consumir Workers (arquitectura vigente, para el equipo) |
| [`STACK-TECNOLOGICO.md`](./STACK-TECNOLOGICO.md) | Referencia de stack y servicios (incl. SCSS → CSS) |
| [`ESTRUCTURA.md`](./ESTRUCTURA.md) | Este doc: mapa del repo y decisión de arquitectura |
| [`IMPLEMENTADO.md`](./IMPLEMENTADO.md) | Registro consolidado de specs cerradas (el texto íntegro vive en el historial de git) |
| [`TAREAS-PENDIENTES.md`](./TAREAS-PENDIENTES.md) | Pasos manuales pendientes de Juan (cuentas, IDs, terceros) |
| [`CONTEXTOS-AMPLIOS.md`](./CONTEXTOS-AMPLIOS.md) | Fases 2–4 de contextos (fase 1 consolidada en IMPLEMENTADO.md) |
| [`PLAN-PANEL.md`](./PLAN-PANEL.md) | Mapa del panel y decisiones cerradas («lo que NO se construye», vocabulario de métricas). El código lo cita como autoridad |
| [`H1-PANEL.md`](./H1-PANEL.md), [`H2-PANEL.md`](./H2-PANEL.md) | Horizontes con trabajo aún abierto (H1 §3-§5, H2 §1-§2-§3-§5). Lo cerrado salió a `IMPLEMENTADO.md` y se borró de aquí |
| [`ALTACLIENTE.md`](./ALTACLIENTE.md) | Proceso de alta de un cliente nuevo |
| [`DEMOS.md`](./DEMOS.md) | Catálogo de `site/demo/` y la convención de carpetas |
| [`PARA-JOHAN-widget-en-webs-cliente.md`](./PARA-JOHAN-widget-en-webs-cliente.md) | Instrucciones de integración del widget para terceros |
| [`VOLUMEN-Y-ALMACENAMIENTO.md`](./VOLUMEN-Y-ALMACENAMIENTO.md) | Estimaciones de volumen y límites de almacenamiento |
| [`VERIFICACION-GOOGLE.md`](./VERIFICACION-GOOGLE.md) | Verificación del OAuth de Google Calendar |
| [`links-strategy.md`](./links-strategy.md), [`backlinks-plan.md`](./backlinks-plan.md), [`pauta-anuncios.md`](./pauta-anuncios.md) | Marketing: enlaces, backlinks y pauta |

Regla del flujo de specs: al terminar el trabajo de un MD, se borra el MD, el
resumen va a `IMPLEMENTADO.md` y lo que quede pendiente a `TAREAS-PENDIENTES.md`.

Coherencia revisada el 2026-09-15: `IMPLEMENTADO.md` registra lo desplegado y
`TAREAS-PENDIENTES.md` decide qué trabajo sigue activo. Ese día se aplicó la regla a los
horizontes cerrados: `H2-BANDEJA.md`, `H2-HANDOFF.md` y `H3-PANEL.md` se borraron con su
resumen volcado a `IMPLEMENTADO.md` y sus decisiones abiertas bajadas al backlog.
`PLAN-PANEL.md` se queda porque es referencia viva, y `H1-PANEL.md`/`H2-PANEL.md` porque
aún tienen secciones sin construir.

Repasada de nuevo el 2026-09-16, esta vez **dentro** de los docs: se borró
`SPEC-AUTOAGENDA.md` (construida y desplegada entera), se borró `worker/MIGRACION-HONO.md`
(migración hecha; el mapa del worker vive en este doc §Arquitectura y en `GUIA-WORKERS.md`
§2), y de `H1-PANEL.md` y `H2-PANEL.md` se retiraron las secciones ya construidas —
H1 §1 y §2, H2 §4 — que pasaron a `IMPLEMENTADO.md`. La regla vale también dentro de un
MD: una sección hecha no se queda ahí marcada como hecha, se va.
