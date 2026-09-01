# Panel v2 — lo que queda

Con la segunda tanda, TODAS las vistas del panel v1 están migradas: shell con
navegación por rol y tema, Dashboard, Leads, Conversaciones, Conexiones, Clientes
(listado + ficha completa + alta guiada + aprovisionamiento), Calendario, Canales,
Configuración y los avisos sonoros. La referencia de conducta sigue siendo
`worker/admin-panel.js` + `worker/admin-page.js` (v1) y los contratos,
`worker/routes/*.js`.

## Pendiente de verdad

- **Infraestructura Cloudflare** en el Dashboard (solo velai):
  `GET /api/admin/infra-usage` — barras contra los límites del plan gratuito
  (CF_FREE_LIMITS), el caso `cloudflare_analytics_denied` explicado con el permiso
  que falta, y el aviso de que superar un límite degrada, no cobra. Es la única
  tarjeta del v1 sin puerto.
- **Deep-linking**: `/leads?estado=…` y `/conversaciones?c=<id>` en la URL. El v1 no
  lo tenía; con react-router es barato y hace compartibles las vistas. (El único que
  ya existe: `/calendario?t=<tenantId>` desde la lista de Clientes.)
- **Retirada del v1**: cuando Juan valide esta tanda en staging y producción, quitar
  `ADMIN_HTML`, `worker/admin-page.js`, `worker/admin-panel.js` y
  `scripts/check-bundle.mjs` en un PR aparte (fuera del alcance de `panel/`).

## Deuda consciente

- El logo que el cliente sube en Conexiones no refresca la cabecera del shell hasta
  recargar: `/api/admin/me` se cachea con staleTime Infinity. Arreglo barato:
  invalidar `['me']` en `useLogoUpload` cuando el canal web cambió.
- El select de Fuente en Leads no re-inyecta una fuente elegida que desapareció de
  los datos (v1 sí lo hacía). Solo pasa si se borra el último lead de esa fuente.
- Los export CSV navegan con `window.location.href` (como el v1): no pasan por
  api() y no encienden la barra de actividad.
- `composerKey` está portado y testeado pero el cajón usa estado por conversación
  de React (equivalente en la práctica). Si el cajón se repinta por algo más que la
  conversación abierta, usarlo como `key=`.
- Las confirmaciones manuales del asistente de Telegram (grupo creado, permisos
  dados) viven en memoria del componente y se pierden al navegar fuera de
  Conexiones (el v1 las perdía al recargar; mismo espíritu, ventana algo menor).
- El botón de avisos comparte el molde del v1: tras recargar con la preferencia
  activa, el primer beep puede llegar mudo hasta el primer clic en la página (el
  navegador no deja crear el AudioContext sin gesto). El tooltip lo cuenta.
