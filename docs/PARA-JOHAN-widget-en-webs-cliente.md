# Sebas — activar el chat de Vai en las webs de los 4 clientes

> **Qué hay hecho y qué falta.** El worker multi-tenant ya está en producción y los cuatro clientes
> están dados de alta con su contexto propio. Ya probamos los cuatro bots por API y responden en su
> personaje y con sus datos. **Lo único que falta es poner el widget en cada web** — eso es tu parte.
>
> Todo lo de nuestro lado está listo: los cuatro dominios (apex y `www`) están en la allowlist del
> worker y los apex en el widget de Turnstile. No hace falta que pidas nada ni que despliegues nada
> del worker: en cuanto el snippet esté en la web, funciona.

---

## Lo que hay que pegar en cada web

Dos líneas, **en este orden** (la primera declara el cliente, la segunda carga el widget), justo
**antes de `</body>`**:

```html
<script>window.VELAI_TENANT='<SLUG>';</script>
<script src="https://hirevai.com/assets/vai-widget.js?v=5" defer></script>
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
  <script src="https://hirevai.com/assets/vai-widget.js?v=5" defer></script>
</body>
```

Va en **todas** las páginas de cada web, no solo en la home. Si la web tiene un footer o layout
compartido, ese es el sitio; si son HTML independientes, hay que repetirlo en cada uno (así funciona
hirevai.com, con las dos líneas en sus 26 páginas).

---

## Antes de pegar: quita el chat viejo

`hiredatavision.com` y `gogestion.es` ya tenían su propio bot (`hiredatavision-bot` y
`gogestion-bot`, workers aparte). **Busca en el HTML cualquier script de chat anterior y quítalo** —
si dejas los dos, el visitante ve dos burbujas de chat y no sabe cuál usar.

Pistas de qué buscar: `<script>` que apunte a `*.workers.dev`, a un `chat.js`/`bot.js` propio, o un
bloque de widget de chat embebido en la página.

**No apagues los workers viejos todavía.** Primero comprobamos que el tenant nuevo responde igual o
mejor; el apagado lo hacemos después, con calma.

---

## Cómo comprobar que funciona (2 minutos por web)

1. Abre la web y busca la burbuja de chat abajo a la derecha.
2. Escribe algo propio del negocio. Cada bot debe responder **como su negocio**, no como Velai:
   - **HireDataVision** → se presenta como *Dara* y habla de datos, BI, pipelines.
   - **GOgestión** → se presenta como *Faby* y habla de trámites de extranjería.
   - **Zoe Travel** → se presenta como *Zoe* y pregunta a dónde quieres viajar.
   - **Diálogos que Enseñan** → tono cálido, podcast e historias de migrantes.
3. Si te responde hablando de Velai, de asistentes de IA o de planes de 1.000 €/1.800 €:
   **el slug está mal o falta la primera línea**.
4. Sigue la conversación hasta que te pida el WhatsApp y dáselo: debe aparecer un lead nuevo en
   `admin.hirevai.com`, en la pestaña **Leads**, con el nombre del cliente en la columna *Cliente*.

---

## Si algo falla, qué significa cada error

Abre la consola del navegador (F12 → Console) y mira el error:

| Lo que ves | Qué pasa | Cómo se arregla |
|---|---|---|
| El chat no aparece | El script no carga | Comprueba la ruta exacta y que las dos líneas estén antes de `</body>` |
| Responde como Velai | Falta o está mal `window.VELAI_TENANT` | Debe ir **antes** del `<script src=…>`, con el slug exacto de la tabla |
| `invalid_tenant` | El slug no existe en el panel | Revisa que no haya una errata (es `zoe`, no `zoe-travel`) |
| Error de CORS / `origin_not_allowed` | El dominio no está en la allowlist | Nos lo dices: pasa si la web sirve desde un dominio distinto al de la tabla (por ejemplo un subdominio o un `.pages.dev`) |
| `human_verification_failed` | Turnstile no reconoce el hostname | Igual: nos lo dices y lo añadimos. Solo están los apex y `www` |

Los dos últimos **no los puedes arreglar tú**: son configuración nuestra. Mándanos el dominio exacto
desde el que carga la web y lo añadimos en un minuto.

---

## Una cosa importante sobre los avisos

Ahora mismo, cuando el bot de un cliente capta un lead, el aviso por WhatsApp sale **desde el número
de Velai y con la plantilla de Velai** (dice "Nuevo lead – Velai"), porque estos clientes todavía no
tienen su propio número ni su plantilla aprobada. El lead se guarda perfectamente y se ve en el panel
con su cliente asignado; lo que aún no es "de marca blanca" es el mensaje de aviso.

Eso se resuelve cuando cada cliente tenga su WhatsApp propio. **No es algo que tengas que tocar tú**
— solo para que no te sorprenda si lo ves.

---

## Resumen

- [ ] `hiredatavision.com` → slug `hiredatavision` + quitar chat viejo
- [ ] `gogestion.es` → slug `gogestion` + quitar chat viejo
- [ ] `zoetravelspain.com` → slug `zoe`
- [ ] `dialogosqueensenan.com` → slug `dialogos`
- [ ] Probar cada uno y ver el lead en `admin.hirevai.com`

Cualquier duda o error de los dos últimos de la tabla, escríbenos con el dominio exacto y lo
resolvemos desde nuestro lado.
