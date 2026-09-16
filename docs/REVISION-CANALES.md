# Revisión de la vista «Canales» — ¿aporta, y cómo se arregla?

> Escrito el 2026-09-16 a petición de Juan: «no está retroalimentándose cuando se crean
> los canales… pero antes validemos si sí aporta algo al software o cómo lo podemos
> mejorar». Primero el diagnóstico —con los números de producción delante—, después las
> opciones. **Nada de esto está implementado**: la decisión es de Juan.

---

## 1. Qué es hoy la vista, exactamente

`panel/src/views/Canales.tsx` (160 líneas, solo rol Velai) pinta lo que devuelve
`GET /api/admin/channels` (`worker/routes/conexiones.js:103`), que son dos consultas:

- **`channels`**: las filas de la tabla `tenant_channels`, con el estado calculado en el
  worker por `routingChannelState` (`worker/app.js:873`) — la misma pregunta que se hace
  `tenantByAddress` en cada mensaje entrante. Esa es su virtud de origen: panel y enrutado
  real no pueden discrepar.
- **`unrouted`**: los clientes con sender propio en Twilio y **ninguna fila que lo enrute**.
  Es el incidente de GOgestión del 2026-08-24 convertido en detector: verde en Twilio y el
  bot mudo.

## 2. Lo que hay de verdad en esa tabla (producción, 2026-09-16)

```
tenant_channels:  3 whatsapp · 1 messenger   → 4 filas en total
tenants:          8, los 8 activos
con Telegram vinculado: 2
```

**Cuatro filas para ocho clientes.** Y no es un fallo de datos: `syncPrimaryChannel`
(`worker/app.js:507`) solo escribe en esa tabla direcciones `whatsapp:` y `messenger:` —
mira su `kindOf`, que devuelve `null` para cualquier otra cosa. La tabla es, por diseño,
**el registro de las direcciones externas (Twilio/Meta) que el worker enruta**, no el
inventario de canales del cliente.

## 3. Por qué «no se retroalimenta» — dos causas, las dos verificadas

**a) La mitad de lo que llamamos «crear un canal» no toca esa tabla.** Vincular Telegram
escribe `tenants.telegram_chat_id`; el canal web vive en `tenants.channel_address`
(`web:<slug>`) y `web_origins`; la página de reservas, en `tenant_calendars`. Ninguno pasa
por `tenant_channels`, así que **Canales no se entera nunca** — ni al crear, ni al borrar.
Lo único que la mueve es cambiar el `channel_address` de un cliente y aprovisionar un
sender de WhatsApp (`worker/app.js:3479`).

Esto explica la sensación exacta: en Conexiones el cliente «tiene» cuatro canales —
`tenantChannelSummary` (`worker/app.js:880`) los DERIVA de columnas del tenant— y en
Canales solo aparece uno, o ninguno. **Dos definiciones distintas de «canal» conviviendo**:
una física (la tabla) y otra derivada (el resumen). Ese es el fondo del problema, no un
refresco.

**b) El panel nunca invalida su caché.** `useGlobalChannels` (`panel/src/hooks/queries.ts:637`)
usa la clave `['channels']`, y esa clave **no aparece en ninguna invalidación del panel**:
`invalidateConexiones` (`:434`) refresca `tenant-telegram`, `tenant-channels`,
`tenant-whatsapp` y `tenant-hours`, y las mutaciones de cliente refrescan `tenants`,
`tenant-detail`, `tenant-versions` y `tenant-provision`. Ninguna toca `['channels']`.
Con `staleTime` de 15 s se acaba refrescando al volver a entrar, pero si te quedas en la
vista —o vuelves antes de esos 15 s— ves lo viejo sin ningún aviso.

## 4. ¿Aporta algo? Sí, pero no lo que su nombre promete

**Lo que solo ella hace hoy**, y vale:

- **`unrouted`**: sender vivo en Twilio sin fila que lo enrute. Nació de un incidente real
  y es el único sitio donde se ve.
- **`orphan`**: una fila cuyo cliente ya no existe, que seguiría capturando mensajes.
- **`from_mismatch`**: la fila enruta una dirección y el `twilio_from` del cliente es otra
  — mensajes que entran por un número y salen por otro.

**Lo que no aporta:** como inventario de canales es engañosa. Para ocho clientes enseña
cuatro filas, omite el canal web (que es el que lleva el chat en TODAS las webs) y omite
Telegram (por donde llegan los avisos de dos clientes). Su buscador, su filtro por cliente
y su filtro por estado son maquinaria para una tabla que cabe en media pantalla.

**Y la parte que sí es inventario ya está mejor contada en otro sitio**: la ficha de
Conexiones enseña los cuatro canales del cliente con direcciones legibles (el dominio en
vez del slug, el nombre del grupo en vez del `-100123…`) y traduce el estado a algo que el
cliente puede entender.

## 5. Tres caminos

### A · Retirar la vista y quedarse con las alarmas
Los tres diagnósticos (`unrouted`, `orphan`, `from_mismatch`) suben al Dashboard de Velai
como una tira de aviso que enlaza a la ficha del cliente; la vista y su navegación
desaparecen.

- **A favor:** menos superficie que mantener —el criterio de «guardianes antes que
  frameworks»— y el aviso aparece donde ya se mira, en vez de en una pestaña que hay que
  recordar visitar. Los detalles siguen en Conexiones.
- **En contra:** se pierde la tabla forense «todo el enrutado de un vistazo», que es la que
  desenredó el incidente de GOgestión. Con 8 clientes no duele; con 40, quizá sí.
- **Coste:** bajo. Una consulta reutilizada, un componente de aviso, borrar la vista.

### B · Hacerla honesta: que enseñe TODOS los canales
La vista pasa a listar, por cliente, los cuatro canales que ya calcula
`tenantChannelSummary`, más las alarmas de la tabla física.

- **A favor:** responde a la pregunta que Juan hace de verdad («¿qué tiene montado cada
  cliente?») y deja de mentir por omisión. Se retroalimenta sola, porque lee del mismo
  sitio que Conexiones.
- **En contra:** pasa a ser un resumen de Conexiones × N clientes; hay que cuidar que no
  sea la tercera copia de lo mismo (Clientes ya lista clientes).
- **Coste:** medio. Un endpoint que haga el resumen para todos los clientes en una consulta
  (hoy es una por cliente), la vista reescrita y sus tests.

### C · Dejarla como está y solo arreglar el refresco
Invalidar `['channels']` en las mutaciones de conexiones y de cliente.

- **A favor:** una línea, arregla el síntoma que disparó esto.
- **En contra:** no arregla el fondo. Seguirá sin reaccionar al vincular Telegram o al
  cambiar el canal web, porque eso **no está en la tabla**. Es decir: seguirá pareciendo
  rota, solo que menos veces.
- **Coste:** mínimo.

## 6. Lo que recomiendo

**A, con el arreglo de C mientras tanto.** La razón es de tamaño: con ocho clientes y
cuatro filas, una vista entera dedicada a la tabla de enrutado no se gana su sitio, y su
valor real —las tres alarmas— es precisamente lo que conviene que salte solo, sin que nadie
tenga que entrar a mirar. B es la opción correcta si el plan es llegar a decenas de
clientes o si Velai va a operar los canales a diario desde ahí; entonces merece la pena
pagar el endpoint nuevo.

Sea cual sea el camino, **la invalidación de `['channels']` hay que ponerla igual** (es un
bug, no una opinión) y **hay que decidir qué es un «canal»** en el vocabulario del panel:
mientras la tabla signifique una cosa y la ficha otra, cualquier vista que las mezcle va a
volver a parecer rota.

## 7. Si se elige A — qué hay que hacer

- [ ] Endpoint o reutilización de `/api/admin/channels` para quedarse solo con `unrouted`
      + `orphan` + `from_mismatch` (la consulta ya existe).
- [ ] Tira de aviso en el Dashboard (solo rol Velai) con enlace a la ficha del cliente.
- [ ] Borrar `Canales.tsx`, su entrada de navegación, `lib/canales.ts` y sus tests; revisar
      que `CHST`/`channelsBad` no los use nadie más.
- [ ] Un test que falle si un cliente con sender propio y sin fila deja de salir en el aviso
      — es el guardián del incidente de GOgestión, y no puede perderse en la mudanza.

## 8. Si se elige B — qué hay que hacer

- [ ] `GET /api/admin/channels` devuelve, por cliente activo, el resumen de
      `tenantChannelSummary` resuelto en **una** consulta (hoy haría N).
- [ ] La vista agrupa por cliente y no por fila; las alarmas se pintan sobre esa lista.
- [ ] Invalidar `['channels']` en `invalidateConexiones` y en las mutaciones de cliente.
- [ ] Tests: un cliente con Telegram vinculado aparece con su canal; uno sin WhatsApp
      aparece en `off`, no ausente.
