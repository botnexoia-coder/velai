# PLAN-SITE — mover el marketing a `site/` (NO ejecutado)

> **Estado: plan, sin ejecutar.** Requiere una acción del dueño en el dashboard
> de Cloudflare que ningún agente puede hacer ni verificar desde el repo.
> Contexto y restricción: [`ESTRUCTURA.md`](./ESTRUCTURA.md).

## Qué es

Mover todo lo publicado (las 26 páginas, `assets/`, `fonts/`, `favicon.svg`,
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

## Prerrequisitos en el repo (parte automatizable, en el mismo PR)

- `scripts/check-site.mjs`: hoy toma `process.cwd()` como raíz del sitio y
  recorre todo el repo. Debe apuntar a `site/` (o aceptar la raíz por
  argumento) y seguir validando las 26 páginas, JSON-LD, enlaces y `?v=`.
- `package.json` → `check:js`: las rutas `assets/funnel.js`,
  `assets/leadform.js`, `assets/vai-widget.js` pasan a `site/assets/…`.
- `.github/workflows/deploy-worker.yml`: revisar el filtro `paths` — no lista
  carpetas de marketing (correcto), pero confirmar que nada nuevo de `site/**`
  lo dispare. `ci.yml` corre en todo push: sin cambios.
- Verificar `_headers` tras moverlo: las reglas son rutas de URL
  (`/fonts/*`, `/*.css`…), no de repo — no cambian de contenido, solo de sitio.
- Buscar referencias en `worker/` y docs a rutas de repo del marketing
  (no de URL): `grep -rn "assets/" worker/ docs/` y ajustar las que sean rutas
  de fichero.

## Ejecución sin ventana de caída (fase de convivencia)

El truco: que durante el cambio de dashboard **la raíz y `site/` contengan lo
mismo**, de modo que sirva quien sirva, se sirve lo correcto. Rollback en
cualquier paso = revertir un solo ajuste.

1. **Commit A (convivencia):** `git mv` NO — **copiar** el marketing a `site/`
   dejando los originales en la raíz. Ajustar scripts/workflows para validar
   `site/` (prerrequisitos de arriba). Push a `main`. Pages redespliega desde
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
5. **Commit B (limpieza):** borrar los originales de la raíz (quedan solo en
   `site/`). Push. Verificar de nuevo el punto 4.
6. Actualizar `README.md` y [`ESTRUCTURA.md`](./ESTRUCTURA.md) (la restricción
   pasa de "la raíz es pública" a "site/ es público") y registrar en
   `IMPLEMENTADO.md`.

**Rollback total** (si algo raro aparece días después): dashboard a `/` +
revert del commit B. La convivencia (commit A) se conserva hasta estar seguros.

## Qué NO hace este plan

- No cambia ninguna URL pública ni toca sitemap/robots/redirects.
- No toca el worker ni su deploy (van por `deploy-worker.yml`, independiente).
- No decide cuándo: el paso 3 es del dueño y conviene hacerlo en horario de
  poco tráfico, con el paso 4 preparado en una terminal.
