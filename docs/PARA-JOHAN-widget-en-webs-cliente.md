# Sebas — widget de Vai en las webs de los clientes (v7)

> **v7 (2026-09-16). No hay nada que pegar: las seis webs ya están al día.** Con los
> repos de todos los sitios a mano, se repasó página por página y se pasaron al loader
> las tres que faltaban (`gogestion-demo`, `MyXuCostura`, `TuFisioOficial`). Las tres
> publicaron solas al hacer push y se comprobaron mirando el dominio real. Diálogos,
> hiredatavision y Zoe ya estaban. `ArteYMotor` no lleva widget.
>
> Este documento se queda como referencia para **webs nuevas**: el snippet del §1 es el
> definitivo y no vuelve a cambiar con las versiones. Si te encuentras una página con
> `vai-widget.js?v=...`, con `velai-assistant-polish.js` o con un
> `window.VELAI_ASSISTANT_UI` inline, es de la época anterior: se sustituye por las dos
> líneas del §1 y se borra el resto — la marca la sirve el panel.


> **v6 (2026-09-14).** Pasamos a **`/assets/vai.js` sin `?v=`**: última vez que
> hay que tocar el HTML para actualizar versiones. El loader carga el widget vigente
> (v16 en esta entrega) y tiene caché de cinco minutos. El cliente mantiene el slug
> inline antes del script. El botón v15 se conserva; la ventana nueva incluye retrato,
> bienvenida, hasta cinco sugerencias y tema automático/claro/oscuro desde Marca.
> **Antes de cambiar snippets:** confirmar el despliegue de Pages y que el loader
> devuelve `Cache-Control: public, max-age=300, must-revalidate`, sin `immutable`.
> Este código todavía está pendiente de publicación. Las páginas ya abiertas no
> se recargan solas: la actualización llega en posteriores cargas de la página.


> **v5 (2026-09-14).** El snippet de aquella entrega usaba **`?v=15`**: lanzador con
> retrato, acento y tarjeta de bienvenida configurables desde Marca del widget.
> Sin retrato del cliente, muestra la inicial del bot. La versión está preparada
> en el repositorio; confirmar el despliegue de Pages antes de cambiar snippets.
>
> Con `?v=14` habrá un estado mixto tras publicar: Pages purga edge y un visitante
> nuevo recibe v15, pero el navegador de un recurrente puede conservar v14 hasta
> un año (`immutable`). Ambos funcionan; cambiar a `?v=15` hace la actualización
> determinista. La versión de idioma se fija al cargar la página.


> **v4 (2026-08-26).** La versión de aquella entrega era **`?v=14`**. Añade una cosa nueva: cuando
> alguien pide hablar con una persona y hay alguien del equipo disponible en el panel, el
> chat de la web pasa a ser **conversación en vivo** — lo que escribe el equipo desde el
> panel le llega al visitante en la propia web.
>
> **El `?v=8` sigue funcionando y no rompe nada**: un widget v8 no sabe recibir esas
> respuestas, así que el asistente le atiende él y deja el lead, exactamente como hasta
> ahora. O sea que no hay prisa, pero mientras esté en v8 ese cliente no tiene chat en vivo.
>
> **v3 (2026-08-22).** Cambio pequeño pero importante: la versión buena ahora es **`?v=8`**.
> El `v=7` llamaba a un dominio (`workers.dev`) que los bloqueadores de anuncios cortan: a esos
> visitantes el chat les salía sin la marca del cliente (decía `Vai · Velai`) **y no enviaba
> mensajes**. El v=8 llama a `api.hirevai.com` y no tiene ese problema. Lo comprobamos en
> `dialogosqueensenan.com`: con adblock salía el genérico; con el v=8, sale Alma siempre.
>
> Tu parte sigue siendo pegar (o corregir) **dos líneas por web**. Nada más ha cambiado.

---

## 1. El snippet definitivo (loader sin versión)

Dos líneas, **en este orden**, justo **antes de `</body>`**, en TODAS las páginas de cada web
(si hay footer/layout compartido, ese es el sitio):

```html
<script>window.VELAI_TENANT='<SLUG>';</script>
<script src="https://hirevai.com/assets/vai.js" defer></script>
```

El `<SLUG>` es distinto en cada web. **No los mezcles**: si te equivocas, el bot de un cliente
contesta con el contexto de otro y el lead se guarda en la ficha equivocada.

| Web | Repo | `<SLUG>` | Estado (2026-09-16) |
|---|---|---|---|
| `dialogosqueensenan.com` | `botnexoia-coder/Dialogos` | `dialogos` | Loader en las 12 páginas ✅ |
| `hiredatavision.com` | `botnexoia-coder/hiredatavision` | `hiredatavision` | Loader en las 6 páginas ✅ |
| `zoetravelspain.com` | `botnexoia-coder/Zoe` | `zoe` | Loader en las 7 páginas, `/prueba-vai/` incluida ✅ |
| `gogestion-demo.pages.dev` | `CronoSeb/gogestion-demo` | `gogestion` | Loader en portada y privacidad ✅ (demo; `gogestion.es` es la web del cliente y no la servimos nosotros) |
| `myxucostura.com` | `botnexoia-coder/MyXuCostura` | `myxu-costura` | Loader en la portada ✅ |
| `www.tufisiooficial.com` | `botnexoia-coder/TuFisioOficial` | `tufisiooficial` | Loader en la portada ✅ |
| `arteymotor` | `botnexoia-coder/ArteYMotor` | — | Sin widget, a propósito |

Los `404.html` de todos los repos van sin widget. Publicación: `dialogos`, `zoe`,
`hiredatavision`, `myxucostura` y `gogestion-demo` son proyectos de Cloudflare Pages
conectados a su repo, y `tufisiooficial` es un Worker con assets que también despliega
desde el repo: **el push publica**, sin CI propio en ninguno.

La marca (logo, colores, saludo, chips, WhatsApp) **no se toca en el HTML**: la editamos desde
el panel y el widget la pide solo al cargar. Los dominios de la tabla ya están autorizados en el
worker (los de Velai en `ALLOWED_WEB_ORIGINS`, el resto en el `web_origins` de cada tenant) — no
hay que pedir ni desplegar nada más. Para una web nueva, ese es el único paso de nuestro lado.

## 2. Cómo verificar cada web (1 minuto)

1. Abre la web en una pestaña normal (con tus extensiones de siempre, mejor aún si tienes adblock).
2. El botón del chat debe abrir con **la marca del cliente** en la cabecera (p. ej. `Alma ·
   Diálogos que Enseñan`), su saludo y sus chips — **no** `Vai · Velai`.
3. Manda un "hola" de prueba: debe responder. Si contesta con el negocio equivocado, el `<SLUG>`
   está mal.
4. Si tras cambiar a v=8 sigues viendo lo viejo: recarga forzada (Ctrl+Shift+R) — el v=7 se
   cachea un año en el navegador y solo el cambio de versión en la página lo suelta.

## 3. Chats viejos: ya se pueden retirar (donde se cumpla la regla)

La regla sigue siendo la misma: **el chat viejo no se quita hasta que el nuevo muestre la marca
del cliente en esa web** (verificación del punto 2).

- `dialogosqueensenan.com`: la marca de Alma ya carga → **retira su chat viejo** (se ve su botón
  flotante naranja detrás del widget nuevo).
- `gogestion.es`, `zoetravelspain.com`, `hiredatavision.com`: pon el v=8, verifica la marca, y
  entonces retira el suyo en la misma pasada.

## 4. Si algo no cuadra

- Marca genérica (`Vai · Velai`) **en incógnito también** → avísanos: es cosa nuestra (panel/worker).
- Marca genérica solo con extensiones → asegúrate de que la página carga `?v=8` (mira el código
  fuente); si carga v=8 y sigue mal, avísanos con una captura de la pestaña Red (F12) filtrada
  por `api.hirevai.com`.
- El chat no responde al enviar → captura de la consola (F12) y nos la mandas.
