# SPEC · Messenger en la UI, y las redes como derecho del plan Pro

> Pedido por Juan el 2026-09-22: «No vamos a manejar clientes solo messenger, ni solo
> instagram, será solo web o solo whatsapp, las demás redes van en el plan pro, crea el
> plan para implementar ya messenger e Instagram en la UI».
>
> Al comprobarlo salió una corrección de alcance: **Instagram no se puede hacer por
> Twilio** y se separa a su propia spec. Lo que sí entra entero es Messenger.

---

## Contexto

Messenger está cableado de punta a punta desde hace meses —el webhook lo acepta
(`ADDRESS_RE`, `worker/app.js:590`), el enrutado lo resuelve, la conversación se guarda,
el lead se captura con el PSID y la respuesta sale por TwiML— pero **no hay forma de
conectárselo a un cliente desde el panel**. La lista de canales de la ficha
(`ClienteFicha.tsx:474`) es de solo lectura, y el único canal que el panel escribe es el
*primario*. Es la «fase 2» que arrastra `TAREAS-PENDIENTES.md` desde agosto.

Dos comprobaciones hechas contra producción y contra Twilio el 2026-09-22:

- **Cero conversaciones por Messenger** (43 web, 28 WhatsApp). La fila
  `velai-messenger` viene del seed de la migración 0002 y no ha entrado un mensaje nunca.
  La advertencia de `ALTACLIENTE.md` sigue vigente: falta comprobar que Meta acepta la
  respuesta TwiML por ese canal.
- **Twilio no lista Instagram** entre sus canales de mensajería; Messenger figura como
  *Public Beta*.

## Decisiones (Juan, 2026-09-22)

1. **No habrá clientes solo-Messenger ni solo-Instagram.** Esencial es *web **o**
   WhatsApp*; las redes son un derecho del plan Profesional.
2. **Messenger ahora; Instagram en spec aparte** ([`SPEC-INSTAGRAM.md`](./SPEC-INSTAGRAM.md)),
   porque exige integración directa con Meta y un App Review que se mide en semanas.
3. **El control vive en la ficha del cliente**, bajo la lista de canales de «Identidad y
   canal», y **solo para rol Velai**: conectar una página en Twilio no es autoservicio.
4. **En la web, Instagram pasa a «próximamente»** en vez de venderse como incluido.

---

## 1. El plan deja de contar solo canales: también dice cuáles

Hoy `PLANES` (`worker/planes.js`) solo tiene un cupo numérico, así que un Esencial con su
canal libre podría llevarse Messenger. La regla que pide Juan no es de cantidad sino de
**tipo**, y las dos deben convivir:

```js
esencial:    { canales: 1,        kinds: ['web', 'whatsapp'] },
profesional: { canales: Infinity, kinds: ['web', 'whatsapp', 'messenger', 'instagram'] },
empresa:     { canales: Infinity, kinds: ['web', 'whatsapp', 'messenger', 'instagram'] },
```

`instagram` entra ya en la lista de Profesional a propósito: el día que exista no hace
falta tocar los planes ni migrar nada. `canalesOcupados` ya lo cuenta.

`assertPlanChannelLimit` valida las dos cosas y las distingue en la respuesta, porque el
arreglo no es el mismo: **409 `plan_channel_limit`** cuando sobra cantidad y **409
`plan_channel_kind`** cuando el tipo no entra en el plan («Las redes sociales van en el
plan Profesional»). Un mensaje que no distingue manda a la persona a liberar un canal
cuando lo que necesita es subir de plan — el error que ya nos costó dos vueltas con zoe.

## 2. El endpoint que falta

`GET /api/admin/tenants/:id/channels` ya existe. Se añaden, **solo rol Velai** (fuera de
`clienteAllowed`, como el resto de aprovisionamiento):

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/api/admin/tenants/:id/channels` | Añade un canal secundario: `{ kind, address }` |
| `DELETE` | `/api/admin/tenants/:id/channels/:kind` | Lo retira |

El `POST` reutiliza lo que ya existe y en este orden: formato de la dirección contra
`ADDRESS_RE`, **cupo y tipo del plan** (§1), `assertChannelFree` (409 `address_taken`: esa
dirección no puede desviar las conversaciones de otro cliente) y el `INSERT` en
`tenant_channels`, que ya tiene `UNIQUE(tenant_id, kind)` — un segundo Messenger del mismo
cliente **reemplaza** al anterior en la misma transacción, no crea un duplicado.

El canal **primario** (`tenants.channel_address`) no se toca: un canal secundario es una
fila de enrutado, y la respuesta ya sale por el canal de llegada porque el TwiML es
síncrono. Ambas operaciones invalidan la caché del tenant (`tenant:addr:<dirección>`) y
quedan auditadas en `tenant_versions`.

## 3. La UI

En `Channels` (`ClienteFicha.tsx:474`), debajo de la lista actual y solo con rol Velai
sobre una ficha ya creada:

- Un selector con los tipos que **su plan** permite y que aún no tiene. Si el plan no da
  para redes, en vez del selector va una línea que lo dice y enlaza a «Plan y módulos» —
  no un control deshabilitado sin explicación.
- Campo para el **ID numérico de la página** de Facebook (no el nombre), con el prefijo
  `messenger:` puesto por el panel: el mismo problema que provocó el `invalid_phone` de
  zoe, y se evita igual, no haciendo teclear el prefijo.
- Una ✕ por canal secundario, con confirmación, que avisa de que dejará de atender por ahí.

## 4. La prueba que no se puede saltar

`ALTACLIENTE.md` lo avisa desde el principio y sigue sin hacerse: **verificar que Meta
acepta la respuesta TwiML por Messenger**. Si no la acepta, hay que cambiar ese canal a
envío por API con `MessagingServiceSid`, que es media hora de trabajo pero hay que
descubrirlo antes de prometer el canal, no con un cliente delante.

Se hace con la página de Velai, que ya está dada de alta (`messenger:1077804955422697`) y
no tiene tráfico. No es automatizable: hace falta una página real y un mensaje real.

## 5. El copy de la web

`site/index.html` y `site/cotizador-precio/index.html` venden hoy «Todos los canales
(WhatsApp, web, Instagram)» en Profesional. Instagram pasa a **«próximamente»**: se
mantiene el gancho sin prometer entrega. Messenger sí se nombra, que ahora sí se entrega.

---

## Verificación

- **Unitarios**: `kinds` por plan; un Esencial recibe `plan_channel_kind` al intentar
  Messenger y `plan_channel_limit` al intentar un segundo canal permitido — códigos
  distintos, no el mismo; un Profesional lo añade; una dirección de otro cliente sigue
  dando `address_taken`; el segundo Messenger del mismo cliente reemplaza sin duplicar.
- **Aislamiento**: caso adversario por las dos rutas nuevas — el rol cliente recibe 403
  sin tocar D1, y `scripts/check-aislamiento.mjs` sigue verde.
- **Panel**: la ficha de un Esencial no ofrece el selector y explica por qué; la de un
  Profesional lo ofrece y guarda.
- **E2E**: añadir Messenger a un cliente Profesional contra el worker real con SQLite, y
  comprobar que la fila queda en `tenant_channels` y que el canal aparece en la ficha.
- **Manual, en producción**: la prueba de §4 con la página de Velai.
