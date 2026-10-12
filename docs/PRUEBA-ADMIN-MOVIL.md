# Admin móvil de Velai — prueba en solo lectura

Entrada: `https://admin.hirevai.com/prueba-movil/`. Misma identidad Cloudflare Access,
roles y permisos que el admin habitual. La navegación móvil tiene Inicio,
Conversaciones, Clientes y Más, que conserva las secciones del panel.

El build normal permanece en `panel/dist`; `vite build --mode mobile-preview`
construye la copia en `panel/dist/prueba-movil`. Solo esa variante adapta la
navegación y consume `/api/admin/mobile-preview/*`. El servidor exige rol Velai,
GET y una lista cerrada de lecturas existentes. Conserva las guardas financieras
y de identidad raíz. Los bindings de la copia solo admiten SELECT y lecturas de
almacenamiento. Abrir un hilo no marca la conversación como leída. Los mensajes,
reservas públicas, cambios, archivos nuevos y herramientas de proveedores están
bloqueados en esta copia. El admin normal mantiene sus operaciones.

La copia no registra service worker ni guarda respuestas privadas para uso sin
conexión. Requiere Internet y sesión válida. Se añade a pantalla de inicio desde
Compartir en iPhone o el menú del navegador en Android. El manifiesto usa un id y
scope propios para distinguirla de la entrada normal.

QA local: backend 395 pruebas, panel 244 pruebas, tipos y 37 E2E (incluye móvil
390×844 sin desbordamiento y con todas las peticiones por API de lectura).
Revisión independiente de allowlist, descargas, reservas y conservación de permisos.
