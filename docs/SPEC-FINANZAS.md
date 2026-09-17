# SPEC · Finanzas de Velai (gastos, ingresos, egresos, caja y repartos)

> Pedido por Juan el **2026-09-17**: «queremos meter **solo para la parte administrativa**
> un apartado de gastos, ingresos y egresos, que se carguen desde una **lista desplegable**
> los posibles gastos, posibles egresos y posibles ingresos, **qué queda en caja**, y si
> repartimos algunos de los ingresos, **los que hacemos parte del equipo que nos repartimos
> dineros**».
>
> Esto es la contabilidad **interna de Velai**, no un módulo para los clientes. Ningún
> tenant ve nada de esto, ni existe para el rol `cliente`.

---

## 0. Las cuatro decisiones que fijan el modelo (respondidas por Juan, 2026-09-17)

| Decisión | Elegido | Consecuencia en el código |
|---|---|---|
| Reparto | **Manual por evento** | No se guardan porcentajes de socio. Cada reparto se apunta a mano con sus líneas. El módulo no opina sobre si es «justo»; suma lo repartido por persona. |
| Gasto vs egreso | **Egreso = salida que no es gasto** | `beneficio = ingresos − gastos`. Los egresos (repartos, impuestos, devoluciones) **no** tocan el beneficio, solo la caja. Sin esto, repartir dinero parecería una pérdida. |
| Moneda | **Dos: EUR y COP** | Cada movimiento lleva su moneda. **Dos cajas separadas**, sin conversión (§4). |
| Acceso | **Solo la lista de socios** | Ni todo el rol `velai` entra: hace falta estar en `SOCIOS_EMAILS`. |

---

## 1. Dónde encaja esto en lo que ya existe

- **Worker**: dominio nuevo `worker/routes/finanzas.js`, montado como los demás junto a
  `admin.route('/', rutasConfig)` (`worker/app.js:4090`). Hereda por tanto los tres
  middlewares de `/api/admin/*`: host admin, identidad de Access y `clienteGate`
  (`worker/app.js:4081-4089`).
- **Puerta del rol cliente**: **no se añade ni una línea a `clienteAllowed`**
  (`worker/middleware.js:133`). Al no figurar ahí, `clienteGate` responde `403 not_authorized`
  a cualquier `/api/admin/finanzas/*` **antes de tocar datos**. Es la defensa que ya está
  probada por `test/aislamiento.test.js`; no inventamos una nueva.
- **Guardián de aislamiento** (`scripts/check-aislamiento.mjs`): las tablas `fin_*` **no**
  se añaden a `DIRECTAS` ni a `HIJAS` — no tienen dueño-tenant, son de Velai. Y aunque un
  handler consulte `tenants` (para el ingreso atribuido a un cliente, §3), el guardián lo
  clasifica como `soloVelai` porque ninguna de sus rutas pasa `clienteAllowed`. CI queda
  verde sin escapes ni `// scope-ok:`.
- **Panel**: vista nueva `panel/src/views/Finanzas.tsx`, ruta `/finanzas` en
  `panel/src/App.tsx`, pestaña en la barra lateral (`panel/src/shell/Shell.tsx:105-116`).
- **Migración**: `migrations/0037_finanzas.sql` (la última es `0036_dialogos_autoagenda_piloto.sql`).

---

## 2. La segunda cerradura: quién es «socio»

El rol `velai` ya no basta: mañana puede haber un colaborador con acceso al panel y las
cifras de reparto son personales.

```
SOCIOS_EMAILS = "correo1@…,correo2@…"   # wrangler.toml, junto a ADMIN_EMAILS (:79 y :222)
```

- Va en **variable de entorno, no en D1**, por el mismo motivo que `ADMIN_EMAILS`
  (`migrations/0009_admin_users.sql`): si la lista de quién cobra viviera en una tabla
  editable desde el panel, una sesión de admin comprometida podría **añadirse a sí misma**
  como socio. Aquí no hay escalada posible sin un deploy.
- Helper en `worker/middleware.js`, al lado de `envAdmins` (`:88`):

```js
export function esSocio(env, scope) {
  return scope.role === 'velai'
    && envSocios(env).includes(String(scope.email || '').toLowerCase());
}
```

- Cada handler de finanzas abre con `if (!esSocio(env, scope)) throw new HttpError(403, 'not_authorized');`
  — **en el handler, no solo en el router**: el patrón de la casa es que el middleware sabe
  quién pregunta y el handler decide qué deja ver.
- `GET /api/admin/me` (`worker/routes/config.js:16`) devuelve además `socio: boolean`. Es lo
  único que necesita el panel para enseñar u ocultar la pestaña. **La interfaz es
  conveniencia; la defensa es el worker.**
- La tabla `fin_socios` (§3) **no da acceso a nada**: solo pone nombre bonito a un correo.

---

## 3. Modelo de datos — `migrations/0037_finanzas.sql`

```sql
-- Catálogo de las listas desplegables. Un concepto pertenece a UN tipo: el desplegable
-- de gastos no puede ofrecer «Reparto a socios».
CREATE TABLE fin_conceptos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo       TEXT NOT NULL CHECK(tipo IN ('ingreso','gasto','egreso')),
  nombre     TEXT NOT NULL,
  activo     INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1)),
  sistema    INTEGER NOT NULL DEFAULT 0 CHECK(sistema IN (0,1)),  -- lo usa el código
  position   INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tipo, nombre)
);

-- Cabecera de un reparto. Va ANTES de fin_movimientos en el fichero: su reparto_id la
-- referencia y D1 aplica las claves ajenas.
-- Las líneas son movimientos de tipo 'egreso' con este reparto_id.
CREATE TABLE fin_repartos (
  id         TEXT PRIMARY KEY,
  fecha      TEXT NOT NULL,
  moneda     TEXT NOT NULL CHECK(moneda IN ('EUR','COP')),
  nota       TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- El libro. Un solo sitio para las tres cosas: el tipo da el signo, el importe es
-- SIEMPRE positivo.
CREATE TABLE fin_movimientos (
  id           TEXT PRIMARY KEY,                    -- uuid
  tipo         TEXT NOT NULL CHECK(tipo IN ('ingreso','gasto','egreso')),
  concepto_id  INTEGER NOT NULL REFERENCES fin_conceptos(id),
  fecha        TEXT NOT NULL,                       -- 'YYYY-MM-DD', el día REAL del movimiento
  moneda       TEXT NOT NULL CHECK(moneda IN ('EUR','COP')),
  importe      INTEGER NOT NULL CHECK(importe > 0), -- unidad MENOR: céntimos en EUR, pesos en COP
  nota         TEXT,
  tenant_id    TEXT REFERENCES tenants(id),         -- opcional: ingreso/gasto atribuido a un cliente
  beneficiario TEXT,                                -- correo del socio, solo en líneas de reparto
  reparto_id   TEXT REFERENCES fin_repartos(id),    -- agrupa las líneas de un mismo reparto
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX fin_mov_fecha ON fin_movimientos(fecha DESC);
CREATE INDEX fin_mov_tipo  ON fin_movimientos(tipo, moneda);

-- Solo para enseñar «Juan» en vez de «juan@…». NO concede acceso (§2).
CREATE TABLE fin_socios (
  email  TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1))
);
```

**Por qué enteros y no decimales.** `REAL` en SQLite arrastra redondeos que se notan al
sumar cien movimientos, y COP no tiene decimales de todos modos. Se guarda la **unidad
menor** (céntimos en EUR, pesos enteros en COP) y el panel formatea. Un `importe` de
`150000` en COP son 150.000 $; en EUR, 1.500,00 €.

**Por qué un solo libro y no tres tablas.** El listado, los filtros, la caja y el export son
la misma consulta con un `WHERE tipo = ?`. Tres tablas serían tres veces el mismo código y
tres sitios donde olvidarse de la moneda.

**Por qué el reparto son líneas de egreso y no una tabla aparte con importes.** Así el
dinero repartido **sale de la caja por el mismo camino que todo lo demás**. Si viviera
aparte, la caja tendría que acordarse de restarlo — y ese es exactamente el tipo de resta
que se olvida.

---

## 4. Las cuentas, escritas una sola vez

Todo se calcula **por moneda**. Nunca se suman euros con pesos.

```
caja(moneda)      = Σ ingresos − Σ gastos − Σ egresos      ← desde el ORIGEN, no del periodo
beneficio(p, mon) = Σ ingresos(p) − Σ gastos(p)            ← los egresos NO restan aquí
repartido(socio)  = Σ egresos con beneficiario = socio
sin repartir(mon) = caja(moneda)                            ← lo que hay para repartir es lo que hay
```

- **La caja es acumulada siempre**, aunque el filtro de arriba diga «septiembre»: «qué queda
  en caja» no tiene sentido por periodo. En la interfaz esa tarjeta lleva la etiqueta
  «acumulado» para que no se lea como una cifra del mes.
- **Sin conversión EUR↔COP en v1.** Dos cajas, una al lado de otra. Un total combinado exige
  una tasa, y una tasa envejece: o se apunta por movimiento (trabajo en cada alta) o el
  histórico cambia solo cada vez que se actualiza. Se deja fuera a propósito (§9) — es la
  pieza que más fácil se añade después y la que más ruido mete ahora.
- El beneficio puede ser **negativo** y se pinta en rojo; la caja también (si repartís más
  de lo que hay, quiero que se vea, no que se impida).

---

## 5. API — `worker/routes/finanzas.js`

Todas bajo `/api/admin/finanzas`, todas con la guarda `esSocio` en la primera línea del
handler, ninguna en `clienteAllowed`.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/conceptos` | Catálogo agrupado por tipo. Sin `?todos=1`, solo los activos (es lo que alimenta el desplegable). |
| POST | `/conceptos` | Alta. `409 concepto_duplicado` contra el `UNIQUE(tipo,nombre)`. |
| PATCH | `/conceptos/:id` | Renombrar, reordenar, activar/desactivar. Si el concepto es `sistema = 1`, solo se admite **reordenarlo**: renombrarlo o apagarlo es `409 concepto_del_sistema`. |
| DELETE | `/conceptos/:id` | **Solo si no tiene movimientos**; si los tiene, `409 concepto_en_uso` y el panel ofrece desactivar (desaparece del desplegable, sigue en el histórico). Un concepto `sistema = 1` no se borra nunca: `409 concepto_del_sistema`. |
| GET | `/movimientos` | Filtros `desde`, `hasta`, `tipo`, `moneda`, `concepto`, `tenant`; orden `fecha DESC, created_at DESC`; paginado 50 como el resto del panel. |
| POST | `/movimientos` | Alta. Valida que `concepto_id` sea **del mismo tipo** que el movimiento (`400 concepto_de_otro_tipo`), `importe > 0` entero, `fecha` real (`YYYY-MM-DD`, ni futura más de un día ni anterior a 2025), moneda del enum. |
| PATCH | `/movimientos/:id` | Corregir importe, fecha, concepto o nota. **Una línea de reparto no se edita suelta** (`409 linea_de_reparto`): se borra el reparto entero y se rehace. |
| DELETE | `/movimientos/:id` | Borra. Es contabilidad interna, no fiscal: se permite, con confirmación en el panel y una línea de log en el worker (`{level:'warn', code:'fin_borrado', id, actor}`). |
| GET | `/resumen` | Lo que pinta la cabecera: por moneda → ingresos, gastos, beneficio, egresos y caja acumulada; desglose por concepto; repartido por socio. Una sola llamada, no seis. |
| GET | `/repartos` | Historial con sus líneas y el acumulado por socio. |
| POST | `/repartos` | Cabecera + líneas en **un `env.DB.batch()`**: o entran todas o ninguna. Un reparto a medias descuadra la caja. |
| DELETE | `/repartos/:id` | Borra cabecera y líneas, también en `batch`. |
| GET | `/export.csv` | El libro filtrado, en CSV, con el molde de `leads/export.csv`. |

**Validación del reparto** (`POST /repartos`): al menos una línea; cada
`beneficiario` tiene que estar en `SOCIOS_EMAILS` (`400 beneficiario_desconocido`) — repartir
a alguien que no es socio es un error de dedo, no una función; todas las líneas van en la
moneda de la cabecera; importes positivos. Si la suma **supera la caja**, se guarda igual
pero la respuesta lleva `{ aviso: 'caja_negativa' }` y el panel lo enseña. No se bloquea:
el dinero puede haber salido de verdad y el módulo tiene que poder reflejarlo.

---

## 6. Panel — `panel/src/views/Finanzas.tsx`

**Dónde se entra.** Bloque nuevo **«Administración»** en la barra lateral, debajo de
«Gestión» y encima de «Sistema» (`panel/src/shell/Shell.tsx:105-126`), con una sola pestaña
—*Finanzas*— y visible solo con `me.socio === true`. Un bloque propio, y no una pestaña
suelta en «Sistema», porque esto no es operación del producto: es la empresa.
La barra sigue **oscura siempre**, como manda la regla de marca; no se toca el CSS del marco.

**Tres pestañas dentro de la vista** (`?tab=` en la URL, como hace Clientes con `?t=`):

1. **Movimientos** (por defecto)
   - Cabecera: selector de periodo (mes actual por defecto, más «trimestre», «año», «todo»)
     y, a la derecha, **dos columnas de tarjetas, EUR y COP**: `Ingresos`, `Gastos`,
     `Beneficio`, `Egresos` y `Caja (acumulado)`. La caja va destacada: es la pregunta de Juan.
   - Tabla: fecha · tipo (píldora con color: ingreso verde, gasto ámbar, egreso azul) ·
     concepto · cliente (`TenantChip`, si lo lleva) · nota · importe con su moneda. Filtros
     por tipo, moneda y concepto. La fila abre el detalle para editar o borrar.
   - Botón **«Registrar movimiento»** → modal: **tipo primero** (segmentado de tres),
     porque es lo que decide qué ofrece el desplegable de concepto; luego concepto
     (`<select>` alimentado por `/conceptos`, filtrado por el tipo elegido), fecha (hoy por
     defecto), moneda (EUR/COP), importe y nota. Cliente, opcional y solo para ingreso y gasto.
2. **Repartos**
   - Acumulado por socio arriba (una tarjeta por persona, por moneda) y el historial debajo.
   - Botón **«Nuevo reparto»** → modal con fecha, moneda, nota y **una línea por socio**
     (nombre de `fin_socios` o el correo), con «Añadir línea». Debajo, en vivo: `Total a
     repartir` y `Queda en caja después`, en rojo si pasa a negativo (con el aviso, sin bloquear).
3. **Conceptos**
   - Las tres listas desplegables, editables: añadir, renombrar, reordenar (arrastrar no;
     flechas, como el resto del panel), activar/desactivar. Aquí se cura el catálogo sin
     entrar en Configuración.

**Datos**: hooks nuevos en `panel/src/hooks/queries.ts` (`useFinResumen`, `useFinMovimientos`,
`useFinConceptos`, `useFinRepartos` + mutaciones), mismo molde de React Query que el resto.
Formato de importes en `panel/src/lib/format.ts`: `€ 1.500,00` y `$ 150.000` (COP sin
decimales), con `Intl.NumberFormat`.

---

## 7. Catálogo inicial (el `INSERT` de la migración)

Es el arranque, no una jaula: todo se edita desde la pestaña Conceptos.

- **Ingresos**: Cuota mensual de cliente · Alta / implantación · Desarrollo a medida ·
  Consultoría · Otros ingresos.
- **Gastos**: Anthropic (IA) · Cloudflare · Twilio · Meta · Dominios · Google Workspace ·
  Otro software / SaaS · Publicidad · Asesoría y contabilidad · Comisiones bancarias ·
  Otros gastos.
- **Egresos**: Reparto a socios · Impuestos · Devolución a cliente · Anticipo o préstamo ·
  Retirada a cuenta personal · Otros egresos.

El concepto **«Reparto a socios»** es el que firman las líneas creadas por `POST /repartos`.
Se busca por la **marca** `(tipo='egreso', sistema=1)` y **nunca por su nombre**: el nombre lo
edita una persona y un renombrado dejaría el siguiente reparto en un 409 inexplicable. Un
índice parcial `UNIQUE(tipo) WHERE sistema = 1` garantiza que haya exactamente uno, la API
rechaza renombrarlo, apagarlo y borrarlo, y el panel ni siquiera ofrece esos botones.
Reordenarlo sí se permite: cambiar su sitio en la lista no rompe nada.

---

## 8. Pruebas (parte del entregable, no un apéndice)

- **`test/finanzas.test.js`** — hay que añadirlo a `test:backend` en `package.json` o
  `scripts/check-test-catalog.mjs` pone CI en rojo:
  - la aritmética de §4 con movimientos de las dos monedas mezclados (que no se sumen entre sí);
  - un `velai` **que no es socio** recibe 403 en las nueve rutas;
  - un `cliente` recibe 403 por `clienteGate`, sin llegar al handler;
  - concepto de otro tipo → 400; importe 0, negativo o decimal → 400; moneda inventada → 400;
  - reparto con una línea inválida **no deja media cabecera** (el `batch`);
  - beneficiario fuera de `SOCIOS_EMAILS` → 400;
  - borrar un concepto con movimientos → 409; desactivarlo lo saca del desplegable y lo
    mantiene en el histórico.
- **`test/aislamiento.test.js`**: comprobar que el barrido adversario cubre
  `/api/admin/finanzas/*` (no hace falta tocar `clienteAllowed`; sí que el barrido las visite).
- **`panel/src/views/Finanzas.test.tsx`**: la pestaña no existe para `socio:false`; el
  desplegable de concepto cambia al cambiar el tipo; las tarjetas separan EUR y COP; el
  modal de reparto avisa cuando la caja queda negativa.
- `npm run check` completo antes de nada (incluye `check:js`, que exige añadir
  `worker/routes/finanzas.js` a su lista de ficheros).

---

## 9. Lo que NO entra

- **Conversión EUR↔COP y total combinado** (§4). Lo primero de la lista si Juan lo pide.
- Facturación, IVA/retenciones, DIAN o AEAT: esto no es un programa de facturación.
- Adjuntar facturas o justificantes (exige R2 y una política de borrado).
- Conciliación bancaria, importación de extractos, multi-cuenta.
- Presupuestos, previsiones y recurrencias automáticas.
- **Enganchar el gasto de IA automáticamente.** `ai_usage` (migración 0018) ya tiene el
  coste real por cliente y día, pero **en USD** — una tercera moneda, justo lo que §4 evita.
  En v1 el gasto de Anthropic se apunta a mano como cualquier otro. En v2, con la conversión
  resuelta, la vista puede **proponer** el movimiento del mes con el total de `ai_usage`; que
  lo confirme una persona, no que se escriba solo.
- Porcentajes fijos de reparto: descartado explícitamente por Juan (§0).

---

## 10. Entrega por fases

| PR | Contenido | Se puede usar al terminar |
|---|---|---|
| **PR1** | Migración 0037 + catálogo inicial · `esSocio` y `socio` en `/me` · conceptos y movimientos (alta, listado, edición, borrado) · `/resumen` · pestaña Movimientos con las tarjetas y la caja · tests backend | Sí: ya se apuntan gastos e ingresos y se ve qué queda en caja |
| **PR2** | Repartos (cabecera + líneas en `batch`), pestaña Repartos con el acumulado por socio, tests | Sí: el reparto del equipo |
| **PR3** | Pestaña Conceptos editable, `export.csv`, filtro por cliente y desglose por concepto | Sí: mantenimiento sin tocar código |

---

## 11. Lo único que falta que diga Juan

1. **El resto de socios**: el 2026-09-17 entraron los dos primeros en `SOCIOS_EMAILS` de
   producción y staging — la cuenta raíz `botnexo.ia@gmail.com` y Juan Esteban García
   (`juanesgarciag@gmail.com`), con su nombre sembrado en `fin_socios` por la migración.
   Cada socio nuevo se añade igual.
2. **Rol velai para cada socio**: `esSocio` exige las DOS cosas. La cuenta raíz lo cumple
   por estar en `ADMIN_EMAILS`; un correo que no esté ahí ni en `admin_users` da
   `socio: false` y no ve la pestaña.
3. **Los dos correos salen como beneficiarios distintos** en un reparto, aunque sean de la
   misma persona: el acumulado se sumaría por separado. Si conviene que la cuenta raíz solo
   ENTRE pero no COBRE, el sitio para decirlo es `fin_socios.activo` (hoy solo decide qué
   nombre se muestra; filtrar con él la lista de beneficiarios son seis líneas).
3. Si el catálogo inicial de §7 le sirve tal cual o quiere quitar/añadir conceptos ahora
   (cambiarlo después es un clic, pero el `INSERT` de la migración se escribe una vez).
