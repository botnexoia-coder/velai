# Sebas — activar el chat de Vai en las webs de los 4 clientes (v2)

> **v2 (2026-08-18).** El widget ahora es **autosuficiente** (ya no depende de nada de
> hirevai.com en la página) y **lleva la marca de cada cliente**: su logo, su nombre, su
> saludo y sus colores, servidos desde nuestro panel. Tu parte sigue siendo la misma:
> **pegar dos líneas en cada web**. La versión buena es **`?v=7`** — si en algún sitio
> quedó `?v=5`, cámbialo.
>
> Los cuatro dominios (apex y `www`) están en la allowlist del worker. No necesitas pedir
> nada ni desplegar nada del worker: en cuanto el snippet esté en la web, funciona.

---

## Lo que hay que pegar en cada web

Dos líneas, **en este orden** (la primera declara el cliente, la segunda carga el widget), justo
**antes de `</body>`**:

```html
<script>window.VELAI_TENANT='<SLUG>';</script>
<script src="https://hirevai.com/assets/vai-widget.js?v=7" defer></script>
```

El `<SLUG>` es distinto en cada web. **No los mezcles**: si te equivocas, el bot de un cliente
contesta con el contexto de otro (o con el de Velai) y el lead se guarda en la ficha equivocada.

| Web | Repo | `<SLUG>` a usar |
|---|---|---|
| `hiredatavision.com` | `botnexoia-coder/hiredatavision` | `hiredatavision` |
| `gogestion.es` | `CronoSeb/gogestion-demo` | `gogestion` |
| `zoetravelspain.com` | `botnexoia-coder/Zoe` | `zoe` |
| `dialogosqueensenan.com` | `botnexoia-coder/Dialogos` | `dialogos` |

Ejemplo completo para Zoe:

```html
  <script>window.VELAI_TENANT='zoe';</script>
  <script src="https://hirevai.com/assets/vai-widget.js?v=7" defer></script>
</body>
```

Va en **todas** las páginas de cada web, no solo en la home. Si la web tiene un footer o layout
compartido, ese es el sitio; si son HTML independientes, hay que repetirlo en cada uno (hirevai.com
carga el widget así en sus 26 páginas; allí no lleva la línea del tenant porque el worker usa
`velai` por defecto — en las webs de cliente la primera línea es **obligatoria**).

Nada más: la marca (logo, colores, saludo, chips, WhatsApp de contacto) **no se toca en el HTML**
— la editamos nosotros desde el panel y el widget la pide sola al cargar. Si un cliente quiere
cambiar su saludo, no es un ticket para ti.

---

## Orden importante: no quites ningún chat viejo todavía

`gogestion.es`, `zoetravelspain.com` y `hiredatavision.com` tienen su propio chat con su marca
(Faby granate, Zoe azul/naranja bilingüe…). **La regla es: el chat viejo no se quita hasta que el
nuevo muestre la marca del cliente en esa web** — su logo y su nombre en la cabecera, no
`Vai · Velai`. Mientras tanto pueden convivir un momento en una página de prueba, pero no
sustituyas nada aún.

Cuando toque quitarlos, las pistas de qué buscar: `<script>` que apunte a `*.workers.dev`, a un
`chat.js`/`bot.js`/`widget.js` propio, o un bloque de widget embebido en la página.

**No apagues los workers viejos** (`hiredatavision-bot`, `gogestion-bot`): eso lo hacemos nosotros
después, cuando el tenant nuevo responda igual o mejor **y con su marca**.

En `zoetravelspain.com/prueba-vai/` quedó el snippet con `?v=5`: **cámbialo a `?v=7`** y vuelve a
probar — con la v7 el chat ya funciona ahí (la v5 fallaba porque dependía de un script que solo
existe en hirevai.com; era un defecto nuestro, tu snippet estaba bien puesto).

---

## Cómo comprobar que funciona (2 minutos por web)

1. Abre la web y busca la burbuja de chat abajo a la derecha.
2. **Mira la cabecera del chat**: debe mostrar el logo y el nombre del cliente
   (`Zoe · Zoe Travel Spain`, `Faby · GOgestión`…). Si ves `Vai · Velai`, el slug está mal,
   falta la primera línea del snippet, o aún no hemos cargado la marca de ese cliente en el
   panel — dinos cuál de las webs es y lo miramos.
3. Escribe algo propio del negocio. Cada bot debe responder **como su negocio**, no como Velai:
   - **HireDataVision** → se presenta como *Dara* y habla de datos, BI, pipelines.
   - **GOgestión** → se presenta como *Faby* y habla de trámites de extranjería.
   - **Zoe Travel** → se presenta como *Zoe* y pregunta a dónde quieres viajar (y contesta en
     inglés si la página está en inglés).
   - **Diálogos que Enseñan** → tono cálido, podcast e historias de migrantes.
4. Sigue la conversación hasta que te pida el WhatsApp y dáselo: debe aparecer un lead nuevo en
   `admin.hirevai.com`, en la pestaña **Leads**, con el nombre del cliente en la columna *Cliente*.

---

## Si algo falla, qué significa cada error

Abre la consola del navegador (F12 → Console) y mira el error:

| Lo que ves | Qué pasa | Cómo se arregla |
|---|---|---|
| El chat no aparece | El script no carga | Comprueba la ruta exacta y que las dos líneas estén antes de `</body>` |
| Cabecera `Vai · Velai` o responde como Velai | Falta o está mal `window.VELAI_TENANT` | Debe ir **antes** del `<script src=…>`, con el slug exacto de la tabla |
| `invalid_tenant` | El slug no existe en el panel | Revisa que no haya una errata (es `zoe`, no `zoe-travel`) |
| Error de CORS / `origin_not_allowed` | El dominio no está en la allowlist del worker | Nos lo dices: pasa si la web sirve desde un dominio distinto al de la tabla (un subdominio, un `.pages.dev`…) |
| `human_verification_failed` | Turnstile no reconoce el hostname | Igual: nos lo dices y lo añadimos. Solo están los apex y `www` de los 4 dominios |

Los tres últimos **no los puedes arreglar tú**: son configuración nuestra. Mándanos el dominio
exacto desde el que carga la web y el error de consola, y lo añadimos en un minuto.

---

## Una cosa importante sobre los avisos

Cuando el bot de un cliente capta un lead, el aviso por WhatsApp sale **desde el número de Velai y
con la plantilla de Velai** (dice "Nuevo lead – Velai") hasta que ese cliente tenga su propio
número y su plantilla aprobada. El lead se guarda perfectamente y se ve en el panel con su cliente
asignado; lo que aún no es "de marca blanca" es el mensaje de aviso. **No es algo que tengas que
tocar tú** — solo para que no te sorprenda si lo ves.

---

## Resumen

- [ ] `zoetravelspain.com/prueba-vai/` → subir a `?v=7` y probar (desbloqueada por la v7)
- [ ] `hiredatavision.com` → snippet slug `hiredatavision` en todas las páginas
- [ ] `gogestion.es` → snippet slug `gogestion` en todas las páginas
- [ ] `zoetravelspain.com` → snippet slug `zoe` en todas las páginas
- [ ] `dialogosqueensenan.com` → snippet slug `dialogos` en todas las páginas
- [ ] Probar cada una: cabecera con la marca del cliente + lead de prueba en `admin.hirevai.com`
- [ ] Solo DESPUÉS de ver la marca del cliente: quitar el chat viejo de esa web

Cualquier duda o error de los de la tabla, escríbenos con el dominio exacto y lo resolvemos desde
nuestro lado.
