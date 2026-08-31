# Migración del worker a Hono 4 — qué cambió, qué no, y qué revisar antes de desplegar

> 2026-09-01. Migración MECÁNICA: misma conducta, mejor estructura. Los 186 tests, el
> barrido adversario de aislamiento, check-aislamiento, check-entornos y check-bundle
> pasan en verde en cada commit de la serie. **Nada desplegado**: producción sigue con
> el worker anterior hasta que Juan revise y haga push.

## Estructura resultante

```
vai-worker.js               entrypoint (SIN CAMBIOS): prompts + createWorker(config)
worker/app.js               ensamblador (createWorker monta la app Hono + scheduled)
                            + helpers compartidos (llamadas al modelo, leads, conversa-
                            ciones D1, Telegram/Twilio, cron…) + export testing
worker/middleware.js        el perímetro admin como middlewares de Hono:
                            mwAdminHost → mwAdminCors → mwAdminIdentity → mwResolveScope
                            → clienteGate; y las piezas del aislamiento con nombre:
                            resolveScope, clienteAllowed, scopeClause, assertOwnTenant
worker/routes/publico.js    chat, lead, chat/poll, widget/boot, media, webhooks de
                            Twilio y Telegram, el 410 del chat retirado, la página del
                            panel y el callback OAuth (solo cablea: los handlers siguen
                            en app.js porque los comparten el cron y el panel)
worker/routes/leads.js      listado, export.csv, ficha (estado/notas/retry/borrado)
worker/routes/conversaciones.js  bandeja (inbox/alerts), listado + CSV, transcripción,
                            takeover/release/reply, disponibilidad, escalaciones
worker/routes/tenants.js    alta/listado/ficha, preview, versiones + restore, usuarios
                            del cliente, aprovisionamiento de Twilio (rutas)
worker/routes/conexiones.js canales (global y por tenant), WhatsApp, avisos, logo,
                            informe de prueba, Telegram en autoservicio (bot/Temas)
worker/routes/calendario.js /appointments y Google Calendar por tenant
worker/routes/config.js     /me, /stats, ai-usage/ai-balance/infra-usage, Configuración
                            solo-raíz (token CF, webhook TG), admins gestionados
```

El `adminRouter` monolítico (~1.400 líneas de `if (path === …)`) ya no existe: queda un
despachador fino con la MISMA firma (`testing.adminRouter(request, env, ctx, path, url,
config, scope)`) que inyecta el scope y despacha por la app de Hono — los tests ejercen
exactamente el mismo camino que producción.

## La mejora de fondo (por qué se hizo)

La cadena identidad → scope → clienteAllowed es ahora **middleware sobre todo
`/api/admin/*`** (`app.use` en `buildApp`): un endpoint nuevo no puede registrarse fuera
del perímetro ni "olvidarse" de resolver el scope. Lo único que sigue dependiendo del
handler es el SQL (scopeClause / assertOwnTenant / canAttend), y eso lo vigila
`scripts/check-aislamiento.mjs`, reescrito para la nueva estructura: escanea los
dominios de `worker/routes/*.js`, convierte las rutas de Hono en ejemplos concretos y le
pregunta a la MISMA `clienteAllowed` del middleware. Paridad exacta: 101 consultas
vigiladas antes y después. El propio script documenta qué caza y qué dejó de hacer falta
cazar.

## Decisiones tomadas

- **Hono con lockfile**: primera dependencia del repo (fin de la era cero-dependencias,
  registrado en el commit). `hono@^4.13.5` pineado por `package-lock.json`; los
  workflows hacen `npm ci` antes de los checks. Wrangler bundlea `node_modules` solo
  (bundle final ~595 KB, y check-bundle confirma que el panel serializado sobrevive).
- **Los handlers públicos siguen en app.js**: `handleChat`, `handleTwilio`, etc.
  comparten decenas de helpers con el cron y el panel, y los tests los importan por
  `testing.*`. `publico.js` solo cablea rutas. Mover 1.500 líneas más no era mecánico.
- **`handleProvision` sigue en app.js**: los tests lo invocan directo; `tenants.js`
  registra sus rutas.
- **Grupos con método interno**: las rutas que en el monolito compartían regex
  (`/leads/:id[/notes|retry]`, `/tenants/:id/telegram[/link|bot]`, calendario, ficha del
  tenant, usuarios) comparten handler y conservan el 405/404 exacto del original.
- **Errores como excepción**: el catch central de siempre es ahora `app.onError`
  (mismo cuerpo `{ok:false, error, why?}`, mismo log sin PII con cf-ray, mismo CORS
  público). El sub-app admin RELANZA los errores para que `testing.adminRouter` siga
  siendo `assert.rejects`-able con `e.status`/`e.code`.
- **Barra final normalizada antes de enrutar**: Hono distingue `/chat` de `/chat/` y el
  router viejo no; `createWorker` recorta la barra antes de `app.fetch`, como siempre.
- **`c.executionCtx` = el ctx de siempre**: `waitUntil` viaja por `partesAdmin(c)`; los
  dos crons de `scheduled()` no se tocaron (el de cada minuto y el de 5).
- **`clienteAllowed` conserva su formato línea a línea**: `test/aislamiento.test.js` lo
  parsea (`toString`) para exigir que el barrido cubra toda la superficie del cliente.
- **Un test adaptado (no debilitado)**: el que verifica por FUENTE el orden
  guardar-aviso → cambiar-estado de «Devolver a Vai» lee ahora
  `worker/routes/conversaciones.js`, donde vive ese handler.

## Qué queda igual (verificado por tests)

- Todos los códigos, estados y cuerpos de respuesta, incluido el `why` de los terceros.
- El orden de guardas: 401 de Access antes que el 404 de ruta admin desconocida; 503
  `admin_misconfigured` sin ADMIN_ORIGIN; ajeno = 404 y nunca 403; el 410 del chat
  retirado; hostname del panel vs público; el rate limit del webhook de Twilio.
- `wrangler.toml` intacto (`keep_vars`, rutas, crons, bindings); `vai-worker.js` intacto.
- `testing` exporta lo mismo de siempre; `testing.adminRouter` y `testing.handleAdmin`
  mantienen firma y semántica.

## Diferencias deliberadas (las únicas)

1. El regex histórico de tenants aceptaba combinaciones sin sentido
   (`/tenants/:id/123/restore` se despachaba como la ficha); con rutas explícitas eso es
   404. Ninguna llamada del panel las usaba.
2. `HEAD` a rutas GET: antes caía al 404 genérico, ahora también (sin cambio práctico).

## Mutation-tests hechos (aplicados y revertidos; detalle en los commits)

| # | Mutación | Quién la cazó |
|---|---|---|
| 1 | listado de leads sin `${sc.sql}` | check-aislamiento |
| 2 | listado de conversaciones sin `${scc.sql}` | check-aislamiento |
| 3 | detalle de conversación sin scope | barrido adversario («200 filtró AJENOPROMPT») |
| 4 | `/ai-balance` sin validar `?tenant=` contra el scope | check-aislamiento |
| 5 | `/stats` sin `${leadW}` en el recuento de 30 días | check-aislamiento (el barrido no ve recuentos: no llevan marcadores — igual que antes) |
| 6 | `/tenants/:id/whatsapp` sin `assertOwnTenant` | check-aislamiento (el barrido ya era ciego a esa ruta por su mock; documentado) |
| 7 | `/tenants/:id/channels` sin `assertOwnTenant` | barrido adversario, por partida doble (fuga + 200 donde debía haber 404) |

## Qué revisar antes de desplegar

1. **El push a main dispara deploy-worker.yml**: ensaya en staging y luego producción.
   Revisar el humo de staging con especial atención — es la primera ejecución REAL del
   worker con Hono dentro.
2. **`npm ci` en CI**: los dos workflows lo hacen ya; si algún runner cachea mal, el
   fallo será `Cannot find package 'hono'` en el primer import.
3. **Tamaño del bundle**: ~595 KB sin comprimir (Hono dentro). Muy por debajo del
   límite de 1 MB comprimido del plan de Workers, pero es la primera vez que el bundle
   crece por una dependencia.
4. **Probar en producción tras el deploy** (los caminos que los mocks no cubren al
   100%): un mensaje real de WhatsApp (webhook de Twilio), el panel en
   admin.hirevai.com (carga + una escritura), el widget en la web de un cliente
   (`/chat` + `/chat/poll`), y `/media/` de un logo (usa `caches.default`, que no existe
   en los tests).
5. **`wrangler tail` un rato**: los logs no cambiaron de formato, así que cualquier
   `server_error` nuevo delataría un hueco de la migración.
6. Cuando esté desplegado y verificado: resumen a `docs/IMPLEMENTADO.md` y borrar este
   archivo o dejarlo como registro (criterio del flujo de MDs de specs).
