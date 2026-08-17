# Spec — rediseño del panel `admin.hirevai.com`

> **Estado (2026-08-18): APLICADA Y DESPLEGADA** (suite 43/43). La maqueta
> `panel-velai-rediseno.html` no estaba en el repo: se construyó desde esta spec.
> Ajuste sobre §5: `satoshi-700.woff2` no existe en `/fonts/` (solo 300/400/500) —
> el panel carga cabinet-grotesk-900 + satoshi-400/500 (3 ficheros) y el bold se
> sintetiza desde el 500. Todo lo demás según spec: tokens reales de la home,
> retícula de fondo, naranja solo-interactivo, escala de estados con punto+texto,
> chips de cliente con color estable por id, .nb/.flag/.meter, leyenda,
> `GET /api/admin/stats` (serie de 14 días rellenada en servidor, sin PII),
> `font-src https://hirevai.com` en la CSP y CORS de `/fonts/*` en `_headers`.
> Las 6 reglas del §7 verificadas por test (ids, nonce, sin dominios externos).

> **Objetivo.** El panel usa hoy una paleta inventada (`#0c0d10`, `#17191f`, gris azulado) y
> `system-ui`, mientras la web va en negro cálido, naranja de marca y Cabinet Grotesk + Satoshi:
> parecen dos productos. Este rediseño lo alinea con `hirevai.com` **usando sus tokens reales** y
> arregla la jerarquía (métricas arriba, filtros que respiran, estados legibles).
>
> Maqueta aprobada: `panel-velai-rediseno.html` (adjunta). Portar a `worker/admin-page.js`
> **sin cambiar comportamiento ni handlers**: mismo `id` en cada control, mismas rutas, mismas
> validaciones. Es un cambio de presentación, con dos añadidos de datos (§6).

---

## 1. Tokens — copiar de `index.html`, no reinventar

```css
:root{
  color-scheme:dark;
  --orange:#FF6B1A; --orange2:#FF8C40; --amber:#FFAA00;
  --bg:#09070A; --bg2:#110D13; --surface:#181220;
  --border:rgba(255,107,26,.12); --border2:rgba(255,107,26,.22);
  --white:#FFF8F4; --muted:rgba(255,248,244,.62); --muted2:rgba(255,248,244,.40);
  --font-d:'Cabinet Grotesk',system-ui,sans-serif;
  --font-b:'Satoshi',system-ui,sans-serif;
  --r:14px; --r-sm:9px; --header-h:57px;
}
```

Fondo: la misma retícula tenue de la web (`linear-gradient` 64px, alpha .04) con
`mask-image:radial-gradient(...)`, en un `body::before` con `pointer-events:none`. Es lo que ata
visualmente el panel a la marca sin añadir ruido.

## 2. Estados — escala propia, **el naranja no se usa para estados**

Regla que sostiene todo el diseño: **el naranja de marca es solo para lo interactivo** (botón
primario, pestaña activa, foco, barras del gráfico). Un estado nunca es naranja, para que no se
confunda con algo pulsable.

```css
--st-new:#3987e5; --st-contacted:#c98500; --st-qualified:#9085e9;
--st-won:#199e70;  --st-lost:#e66767;
```

Validada con el script de la skill de diseño sobre la superficie real (`#181220`, modo oscuro):
banda de luminosidad, croma, contraste ≥3:1 y separación para daltonismo **PASS**; el par
rojo↔verde queda en la banda 6–8, admisible **porque cada estado lleva punto + etiqueta de texto**.
Si se cambia algún color, **volver a pasar el validador** — no ajustar a ojo.

Cada pill: `<span class="pill s-won"><b></b>ganado</span>` — punto de color + texto. Nunca color
solo. El texto de la pill va en un tono claro derivado del color (no en el color puro: no contrasta).

## 3. Layout

| Zona | Qué |
|---|---|
| **Header** sticky | Marca (punto naranja + "Velai" en Cabinet Grotesk 900 + "Panel" en versalitas), pestañas como *segmented control* con `role="tablist"` y `aria-selected`, y a la derecha *Exportar CSV* + *Nuevo cliente* (primario) |
| **Fila de métricas** | 4 tarjetas + 1 gráfico. Números en Cabinet Grotesk 900 a 38px. La tarjeta de *Avisos fallidos* se tiñe de rojo **solo si > 0** |
| **Gráfico** | Leads por día, 14 días. Una sola serie → un solo tono (naranja), **sin leyenda**, tooltip en hover, barras con `border-radius:4px 4px 0 0` |
| **Filtros** | Una fila `flex-wrap`, buscador con `flex:1`, y el recuento de resultados alineado a la derecha |
| **Tabla** | `th` sticky bajo el header (`top:var(--header-h)`), filas de 14px de padding, `tbody tr:hover` con velo naranja al 5%, teléfono en `font-variant-numeric:tabular-nums` |
| **Leyenda de estados** | Bajo la tabla de leads, una fila con los 5 estados |

## 4. Componentes

- **`.pill`** — estado: fondo `--bg2`, borde `--border`, punto de 7px + etiqueta.
- **`.tenant`** — chip de cliente: barrita vertical de color (6×22px) + nombre. El color identifica
  al cliente y **es estable**: se asigna por `id` del tenant, nunca por su posición en la lista
  (si filtras, los supervivientes no cambian de color).
- **`.nb`** — avisos: `Telegram` / `WhatsApp` con estado `ok` / `wait` / `bad`. Sustituye al
  `telegram:sent,whatsapp:sent` en texto plano de hoy, que no se lee.
- **`.flag`** — semáforo de configuración. Ámbar por defecto, `.ok` verde ("listo"), `.off` gris
  ("prospecto"). Mantener **todos** los avisos actuales: `sin plantilla`, `sin equipo`,
  `contexto corto`, `sin token`, `sin From`, `socio pendiente`, `prospecto` — y añadir
  `solo web` y `contexto muy largo` (>8.000 car.).
- **`.meter`** — medidor de contexto: barra de 64px, `width` = `min(100, chars/12000*100)`.
  Hace visible que el contexto viaja al modelo **en cada mensaje**: 16.303 caracteres son coste
  por respuesta, no un dato inerte.
- **Botones e inputs** — `--r-sm`, borde `--border2`, hover a naranja. `:focus-visible` con
  `outline:2px solid var(--orange); outline-offset:2px` en **todos** los controles.

## 5. Fuentes y CSP — el único punto delicado

El panel va con `default-src 'none'` (`worker/app.js:18`), así que hoy **no puede cargar fuentes
externas**. Dos caminos:

**Recomendado — servirlas desde `hirevai.com`:**

1. En la CSP del panel añadir **solo** `font-src https://hirevai.com`. No tocar el resto:
   `script-src`/`style-src` siguen con nonce y `connect-src 'self'`.
2. En `_headers` de Pages, permitir CORS para las fuentes (sin esto el navegador las descarta
   aunque la CSP las permita):
   ```
   /fonts/*
     Access-Control-Allow-Origin: *
   ```
3. Cargar solo lo que se usa: `cabinet-grotesk-900` (marca y números) y
   `satoshi-400/500/700`. Cuatro ficheros, no los diez.

**Alternativa sin tocar Pages:** dejar el *font stack* del sistema. Se pierde el display de la
marca, pero el 90% del carácter visual viene del color, la escala y los pesos. Si se elige esta,
subir el `letter-spacing:-.02em` de los números para compensar.

En ambos casos las familias van declaradas con fallback (`system-ui,sans-serif`), para que un fallo
de red no deje el panel roto.

## 6. Datos nuevos que hacen falta

Las métricas y el gráfico no se pueden calcular con lo que hay: el listado está paginado, así que
contar en cliente daría números falsos. Añadir **un** endpoint:

```
GET /api/admin/stats  →  { total30, sinContactar, fallidos7, tenantsActivos, porDia: [{d,n}, …] }
```

Una consulta por métrica, todas sobre índices existentes, en un `env.DB.batch([...])`:

```sql
-- total de leads de los últimos 30 días
SELECT COUNT(*) AS n FROM leads WHERE created_at >= datetime('now','-30 days');
-- sin contactar (y la antigüedad del más viejo, para el subtexto)
SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM leads WHERE status = 'new';
-- avisos fallidos de los últimos 7 días
SELECT COUNT(*) AS n FROM lead_notifications
 WHERE status = 'failed' AND updated_at >= datetime('now','-7 days');
-- clientes por estado
SELECT active, COUNT(*) AS n FROM tenants GROUP BY active;
-- serie de 14 días
SELECT date(created_at) AS d, COUNT(*) AS n FROM leads
 WHERE created_at >= datetime('now','-14 days') GROUP BY d ORDER BY d;
```

Reglas: `Cache-Control: no-store`, tras Access como el resto de `/api/admin/*`, **sin PII** en la
respuesta (solo recuentos y fechas), y si `DB` no está disponible → 503, nunca ceros silenciosos
que parecerían "no hay leads".

La serie de 14 días debe rellenar los días vacíos con 0 **en el servidor**: si no, el gráfico
comprime el eje y miente sobre la distribución.

## 7. Lo que NO se puede romper al portar

Esto ya costó una jornada de arreglos; que el rediseño no lo deshaga:

1. **El campo de auth token es write-only**: se envía solo si el usuario escribe algo, nunca se
   rellena al cargar la ficha, y debajo va `configurado ✓ / sin configurar`.
2. **`provPost` recarga la ficha completa** (`openTenant(editing.id)`). No sustituir por un refresco
   de `updated_at`: los inputs deben repoblarse o un "Guardar" posterior mandaría el campo de
   subcuenta vacío y **borraría el SID**.
3. **Ningún dato sensible en el DOM**: el ciphertext del token no llega al cliente (la API ya
   devuelve solo `has_twilio_token`). No añadir campos que lo expongan.
4. **Sin recursos externos** más allá de las fuentes de §5: nada de CDNs, iconos remotos ni
   `localStorage`. Los estilos y el script siguen con `nonce`.
5. **Mismos `id` de control** (`tName`, `tSlug`, `tAddress`, `tActive`, `tPrompt`, `tSub`, …) y
   mismos textos de error de `TERRS`: son los que traducen los códigos del worker.
6. El aviso del tope de gasto de la subcuenta sigue visible (la API de Twilio no lo configura).

## 8. Tests

- `ADMIN_HTML` no contiene ninguna URL `http://` ni dominio externo salvo `https://hirevai.com/fonts/`.
- `ADMIN_HTML` sigue conteniendo el marcador `__NONCE__` y los `id` de los controles del §7.5.
- `GET /api/admin/stats` sin JWT de Access → 401; con DB caída → 503; y su respuesta **no** contiene
  ningún teléfono, nombre ni email (regex de dígitos largos y `@`).
- La serie de 14 días devuelve 14 entradas incluso sin leads.

## 9. Orden

Después de la spec de `web:<slug>` (sin ella no hay clientes activos que enseñar). El rediseño no
toca el enrutado ni el aprovisionamiento, así que puede ir en un PR propio, con `npm run check`
verde antes de desplegar.
