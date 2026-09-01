# PLAN-SITE — mover el marketing a `site/` (EN EJECUCIÓN)

> **Estado: EN EJECUCIÓN.** La parte de repo está hecha en la rama
> `consolidacion-site`, en dos commits separados a propósito:
>
> 1. **Commit A (convivencia)** — copia del marketing a `site/` + tooling
>    validando `site/`. **Mergeable ya**: la raíz sigue intacta y publicada.
> 2. **Commit B (retirada)** — borra los originales de la raíz y actualiza
>    docs. **NO mergear hasta después del flip del dashboard** (paso 3).
>
> Lo que falta (en orden): mergear/pushear el commit A → verificar (paso 2)
> → **flip del dashboard, acción del dueño** (paso 3) → verificación en
> caliente (paso 4) → mergear/pushear el commit B → verificar de nuevo →
> paso 6 (docs ya van en el commit B; queda registrar en `IMPLEMENTADO.md`
> y borrar este MD según el flujo de specs).
> Contexto y restricción: [`ESTRUCTURA.md`](./ESTRUCTURA.md).

## Qué es

Mover todo lo publicado (las 27 páginas, `assets/`, `fonts/`, `favicon.svg`,
`robots.txt`, `sitemap.xml`, `_headers`, `og-velai.jpg`) de la raíz del repo a
`site/`, y cambiar el **build output directory** del proyecto Pages `velai` de
`/` a `/site`. **Las URLs públicas no cambian**: `site/blog/index.html` se
sigue sirviendo como `hirevai.com/blog/` — el SEO no se toca.

## Qué se gana

1. **Raíz legible**: la raíz queda en ~10 entradas con intención clara
   (`site/`, `worker/`, `panel/`, `migrations/`, `docs/`, `test/`, `scripts/`,
   `seed/`, `tenants/`, config).
2. **Se cierra la exposición pública del backend**: hoy
   `hirevai.com/worker/app.js`, `/wrangler.toml`, `/docs/*`, `/seed/*` y
   `/tenants/*` devuelven 200 (verificado 2026-09-01). Con output dir =
   `site/`, Pages solo publica el marketing.
3. Deja de ser posible repetir el accidente de `distB/` (un artefacto
   commiteado en la raíz quedaba publicado al instante).

## Qué arriesga

- **Un despliegue de Pages mal configurado tumba el sitio comercial entero**
  (hirevai.com en 404: home, landings con pauta activa, blog). El output dir
  es un ajuste de proyecto — afecta a producción Y a los previews de rama a la
  vez, no se puede probar por rama.
- El cambio tiene **dos mitades en dos sitios** (commit en el repo + ajuste en
  el dashboard): hechas en el orden ingenuo, entre una y otra hay ventana de
  caída. El plan de abajo la elimina con una fase de convivencia.
- `_headers` tiene que viajar dentro de `site/` (Pages lo lee de la raíz del
  output dir). Si se queda fuera: sin cache-control, sin CORS de `fonts/`
  (el panel deja de cargar la tipografía), sin cabeceras de seguridad.

## Prerrequisitos en el repo (HECHOS, rama `consolidacion-site`)

- [x] `scripts/check-site.mjs`: la raíz del sitio ya es `site/` (con override
  por argumento). Valida las 27 páginas, JSON-LD, enlaces y `?v=`.
- [x] `package.json` → `check:js`: las rutas `assets/*.js` pasaron a
  `site/assets/…`.
- [x] `.github/workflows/deploy-worker.yml`: filtro `paths` revisado — no
  lista carpetas de marketing y nada de `site/**` lo dispara. `ci.yml` corre
  en todo push: sin cambios.
- [x] `_headers` verificado tras copiarlo: las reglas son rutas de URL
  (`/fonts/*`, `/*.css`…), no de repo — mismo contenido, viaja dentro de `site/`.
- [x] Referencias a rutas de repo del marketing revisadas con grep: los HTML
  solo usan rutas absolutas (cero relativas); `test/worker.test.js` lee ahora
  `site/assets/*`; docs con rutas de fichero actualizados (STACK-TECNOLOGICO,
  TAREAS-PENDIENTES, README, ESTRUCTURA). Las URLs `hirevai.com/assets|fonts`
  del worker, el panel y los docs de integración NO cambian (misma URL).

## Ejecución sin ventana de caída (fase de convivencia)

El truco: que durante el cambio de dashboard **la raíz y `site/` contengan lo
mismo**, de modo que sirva quien sirva, se sirve lo correcto. Rollback en
cualquier paso = revertir un solo ajuste.

1. **Commit A (convivencia) — HECHO** (`consolidacion-site`): el marketing
   está **copiado** (no movido) a `site/` con los originales en la raíz, y el
   tooling valida `site/`. Falta el push a `main`. Pages redespliega desde
   la raíz: **nada cambia para el visitante** (solo aparece /site/ duplicado,
   público unos días — ya lo era).
2. **Verificar el despliegue de A:** `hirevai.com/` y 3–4 URLs de muestra
   (blog, una landing de pauta, `/assets/vai-widget.js`) responden 200 y CI
   verde.
3. **Dashboard (acción del dueño):** proyecto Pages `velai` → Settings →
   Builds & deployments → **Build output directory = `site`**. Guardar y
   **Retry deployment** (o push vacío) para que se aplique.
4. **Verificar en caliente** (si falla algo, paso 3 a la inversa y listo):
   - `curl -I https://hirevai.com/` → 200
   - `curl -I https://hirevai.com/blog/` → 200
   - `curl -I https://hirevai.com/lp/clinicas/` → 200 (pauta activa)
   - `curl -I https://hirevai.com/assets/vai-widget.js` → 200 (webs de clientes lo cargan)
   - `curl -sI https://hirevai.com/fonts/fonts.css | grep -i access-control` →
     CORS presente (prueba de que `_headers` viaja) y el panel carga la fuente
   - `curl -I https://hirevai.com/worker/app.js` → **404** (la ganancia nº 2)
   - Sitemap en Search Console sin errores nuevos en 48 h
5. **Commit B (limpieza) — HECHO en la rama, NO mergear antes del paso 3:**
   borra los originales de la raíz (quedan solo en `site/`) y actualiza los
   docs. Tras el flip verificado: push y verificar de nuevo el punto 4.
6. `README.md` y [`ESTRUCTURA.md`](./ESTRUCTURA.md) ya van actualizados en el
   commit B (la restricción pasa de "la raíz es pública" a "site/ es
   público"). Queda: registrar en `IMPLEMENTADO.md` y borrar este MD (flujo
   de specs).

**Rollback total** (si algo raro aparece días después): dashboard a `/` +
revert del commit B. La convivencia (commit A) se conserva hasta estar seguros.

## Qué NO hace este plan

- No cambia ninguna URL pública ni toca sitemap/robots/redirects.
- No toca el worker ni su deploy (van por `deploy-worker.yml`, independiente).
- No decide cuándo: el paso 3 es del dueño y conviene hacerlo en horario de
  poco tráfico, con el paso 4 preparado en una terminal.
