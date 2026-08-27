# Sebas — widget de Vai en las webs de los 4 clientes (v3)

> **v4 (2026-08-26).** La versión buena ahora es **`?v=12`**. Añade una cosa nueva: cuando
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

## 1. El snippet (igual que siempre, con `v=12`)

Dos líneas, **en este orden**, justo **antes de `</body>`**, en TODAS las páginas de cada web
(si hay footer/layout compartido, ese es el sitio):

```html
<script>window.VELAI_TENANT='<SLUG>';</script>
<script src="https://hirevai.com/assets/vai-widget.js?v=12" defer></script>
```

El `<SLUG>` es distinto en cada web. **No los mezcles**: si te equivocas, el bot de un cliente
contesta con el contexto de otro y el lead se guarda en la ficha equivocada.

| Web | Repo | `<SLUG>` | Estado actual |
|---|---|---|---|
| `dialogosqueensenan.com` | `botnexoia-coder/Dialogos` | `dialogos` | Snippet YA puesto y correcto — solo cambiar `?v=7` → `?v=8` |
| `hiredatavision.com` | `botnexoia-coder/hiredatavision` | `hiredatavision` | Poner/actualizar a `?v=8` |
| `gogestion.es` | `CronoSeb/gogestion-demo` | `gogestion` | Poner/actualizar a `?v=8` |
| `zoetravelspain.com` | `botnexoia-coder/Zoe` | `zoe` | Poner/actualizar a `?v=8` (incluida la página `/prueba-vai/` si sigue con v=5) |

La marca (logo, colores, saludo, chips, WhatsApp) **no se toca en el HTML**: la editamos desde
el panel y el widget la pide solo al cargar. Los 4 dominios ya están autorizados en el worker —
no hay que pedir ni desplegar nada más.

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
