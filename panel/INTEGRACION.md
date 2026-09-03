# Integración vigente del panel v2 (React) en el Worker

El panel v2 es una SPA autocontenida en `panel/` que compila a estáticos (`panel/dist`).
La sirve **el propio worker** en `admin.hirevai.com` mediante el binding de assets de
Workers: mismo origen que la API, así que el panel hace `fetch` con rutas relativas
(`/api/admin/...`), sin CORS y sin gestión de tokens — Cloudflare Access pone la cookie
y el worker valida el JWT en cada petición, exactamente igual que hoy.

**Estado actual:** esta integración está cableada y `PANEL_V2 = "1"` está desplegado
en producción desde el 2026-09-01. Las secciones siguientes documentan el diseño y el
procedimiento operativo; no son una lista de tareas por implementar.

## 1. Assets binding en `wrangler.toml`

```toml
[assets]
directory = "panel/dist"
binding = "ASSETS"
# El worker decide QUÉ peticiones van a los estáticos (solo el hostname del panel):
run_worker_first = true
```

- `run_worker_first = true` es la pieza clave: sin ella, Cloudflare serviría los assets
  ANTES de ejecutar el worker para cualquier ruta que case con un fichero, en todos los
  hostnames. Con ella, todas las peticiones entran al worker y es él quien enruta.
- El binding `env.ASSETS` queda disponible en el worker. En `wrangler dev` funciona igual
  (sirve `panel/dist`, así que hay que haber hecho `npm run build` en `panel/` al menos
  una vez, o desarrollar con el proxy de Vite — ver §4).

## 2. Enrutado en el worker (solo hostname admin + bandera)

En el punto donde hoy se responde `ADMIN_HTML` para `admin.hirevai.com`, delante:

```js
// Panel v2 (estáticos). Solo en el hostname del panel, solo con la bandera puesta,
// y NUNCA para /api/, /oauth/ ni /media/ (esas siguen siendo del worker).
const esPanelHost = url.hostname === 'admin.hirevai.com'; // + el hostname de staging
const esApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/oauth/') || url.pathname.startsWith('/media/');
if (esPanelHost && env.PANEL_V2 === '1' && !esApi && request.method === 'GET') {
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 404) return res;             // fichero real (js/css/favicon…)
  // SPA con react-router: cualquier ruta de vista (/leads, /conversaciones…) es index.html.
  return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
}
// …aquí sigue el panel v1 tal cual (ADMIN_HTML).
```

Notas:

- Access sigue delante del hostname y el worker sigue validando el JWT **también** para
  los assets si se quiere defensa en profundidad (opcional: el HTML/JS no lleva datos;
  todos los datos salen de `/api/admin/*`, que ya valida). Si se prefiere validar antes de
  servir assets, hacer el `adminIdentity(request, env)` antes del bloque anterior.
- La alternativa `not_found_handling = "single-page-application"` en `[assets]` haría el
  fallback a index.html solo, pero se aplicaría a todos los hostnames: con multi-hostname
  en el mismo worker, mejor el fallback explícito de arriba.

### Cabeceras / CSP del panel v2

El panel v1 inyecta CSS/JS inline con nonce. El v2 son ficheros externos del MISMO
origen, así que su CSP es más simple y más estricta:

```
default-src 'none'; script-src 'self'; style-src 'self';
font-src https://hirevai.com; img-src 'self' https: data:;
connect-src 'self'; base-uri 'none'; frame-ancestors 'none'
```

- React aplica los estilos dinámicos por CSSOM (propiedades de `element.style`), no con
  atributos `style=""` serializados, así que **no hace falta** `unsafe-inline` ni nonce.
- Mantener `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store` para el HTML
  (los assets con hash pueden ir con `immutable`), `X-Frame-Options: DENY` y
  `Referrer-Policy: no-referrer`, como hoy (ver `ADMIN_HEADERS` en worker/admin-page.js).

## 3. Build probado que consume el workflow de deploy

CI construye y prueba el panel; después publica `panel/dist` durante 7 días. El workflow
de deploy solo acepta un `workflow_run` verde o un `workflow_dispatch` cuyo SHA actual
tenga ese CI verde, y descarga el artifact sin recompilar una variante distinta:

```yaml
- uses: actions/download-artifact@v4
  with:
    name: panel-dist
    path: panel/dist
    run-id: ${{ needs.gate.outputs.ci_run_id }}
    github-token: ${{ github.token }}
```

- `npm run build` incluye el typecheck: un error de tipos rompe CI, a propósito.
- `npm run typecheck` valida por separado la aplicación/Vitest y
  `tsconfig.e2e.json`/Playwright, sin mezclar sus globals.
- `npm test` (`vitest run`) y `npm run test:e2e` forman parte del job de CI. El
  smoke E2E intercepta toda `/api/admin/*`, rechaza rutas no declaradas y comprueba que
  no sale ninguna mutación; no necesita credenciales ni toca el Worker. Esta base no se
  declara validada hasta observar su primer job verde en GitHub Actions.
- `scripts/check-bundle.mjs` (el del panel v1 serializado) sigue igual: el v1 no se toca.

## 4. Desarrollo local

```bash
# terminal 1 — el worker con su API:
wrangler dev            # http://localhost:8787

# terminal 2 — el panel con HMR:
cd panel && npm run dev # http://localhost:5173, proxy de /api, /media y /favicon.svg a :8787
```

En dev no hay Access: el worker debe seguir teniendo su camino de identidad de
desarrollo (el que use hoy `wrangler dev` para el panel v1).

## 5. Estado y cambios de la bandera `PANEL_V2`

- La bandera es una **var de entorno del Worker**, no un secret: `PANEL_V2 = "1"` en
  staging y producción.
- Cualquier cambio futuro se valida primero en staging y llega a producción mediante
  el workflow normal, nunca mediante una edición manual de la bandera aislada.
- El v1 y `check-bundle.mjs` se mantienen como rollback consciente. Su retirada será
  un cambio separado cuando se decida cerrar esa red de seguridad; los acabados de
  producto pendientes viven en `docs/TAREAS-PENDIENTES.md`.

## 6. Rollback

Quitar la bandera (`PANEL_V2` vacía o ausente) y desplegar: el worker vuelve a servir el
panel v1 serializado, que sigue intacto en el bundle. No hay migraciones, no hay estado:
el rollback es instantáneo y sin pérdida (el v2 no escribe nada que el v1 no escriba —
ambos hablan con los mismos endpoints).

## 7. Qué NO cambia

- Ningún endpoint de `/api/admin/*`: el v2 consume exactamente los contratos actuales
  (tipados en `panel/src/api/types.ts`, derivados leyendo worker/app.js).
- Access, el JWT, los roles y el aislamiento por tenant: todo sigue en el worker.
- El logout sigue siendo `/cdn-cgi/access/logout` (lo atiende Access, no el worker).
