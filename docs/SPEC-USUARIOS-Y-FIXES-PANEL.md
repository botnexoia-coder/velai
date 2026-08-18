# Spec — A) 4 arreglos visuales · B) Alta completa de cliente desde el panel

> **Estado (2026-08-18): AMBAS PARTES APLICADAS Y DESPLEGADAS** (worker `a11e031a`, suite
> 54/54 con los 6 tests del §B.4). Hallazgo de la revisión: los 4 defectos de la parte A
> tenían **una sola causa raíz** — la CSP del panel (`style-src` con nonce) bloquea TODOS
> los atributos `style=""` inline (los nonces no aplican a atributos), así que el ancho del
> medidor, la altura de las barras y el color de los puntos se descartaban en silencio. El
> arreglo no fue el parche de los snippets (seguiría bloqueado) sino mover los estilos
> estáticos a clases y aplicar los dinámicos por CSSOM (`paint()`), que la CSP sí permite.
> El gráfico además llevaba `flex:1` sin altura definida (los `%` colapsaban): ahora 74px
> fijos. Parte B: endpoints de usuarios en la ficha, 409/400 según spec, auditoría en
> `tenant_versions` (field `users`, con rol), 403 instrumentado con correo + alerta a la
> 3ª/hora + rate limit por correo (120/min). **PENDIENTE (Juan, una sola vez): cambiar la
> política de Access a OTP-para-cualquier-correo** (§B.5) — el token de wrangler no tiene
> scope de Access, así que es manual. Hasta entonces, el alta desde el panel escribe la
> fila pero el usuario nuevo sigue necesitando su correo en la política de Access.

> El B es el objetivo de Juan: **dar de alta un cliente entero sin salir del panel**, incluido su
> acceso. Se consigue **quitando** una cerradura, no automatizándola.

---

# PARTE A — Los 4 defectos del rediseño

Verificados en producción con zoom sobre `admin.hirevai.com`.

**A.1 🔴 El medidor de contexto no escala.** Es el que más importa: 3.612 y 15.936 caracteres pintan
**la misma barra**. El componente existe para hacer visible que Zoe cuesta cuatro veces más por
mensaje que Diálogos, y ahora afirma lo contrario. El `<i>` interior necesita su anchura calculada:

```js
const pct = Math.min(100, Math.round((t.prompt_len / 12000) * 100));
// …<span class="meter"><i style="width:${pct}%"></i></span>
```

**A.2 🟠 El gráfico de 14 días está aplastado.** Las barras salen como rayitas de 2px y el día con 3
leads no destaca. Dos causas posibles: el contenedor `.bars` sin altura efectiva, o el máximo mal
calculado. La altura de cada barra es proporcional al máximo de la serie, con un mínimo visible para
los ceros:

```js
const max = Math.max(1, ...serie.map((d) => d.n));
const h = d.n === 0 ? 6 : Math.max(12, Math.round((d.n / max) * 100));   // % sobre 74px de alto
```

**A.3 🟠 La leyenda de estados perdió los puntos de color.** Quedaron solo las palabras. Era la regla
de accesibilidad del diseño: **punto + etiqueta, nunca color solo**. Cada entrada de la leyenda lleva
su `<b>` con el color del estado, igual que la pill de la tabla.

**A.4 ⚪ "1+ resultado"** → "1 resultado" / "3 resultados" (el `+` solo si hay más página).

---

# PARTE B — Alta completa desde el panel

## B.1 La decisión: Access autentica, el worker autoriza

Hoy hay dos cerraduras y por eso cada alta obliga a entrar en Cloudflare. Se cambia a:

- **Cloudflare Access** = *autenticación*. Política de la app `admin.hirevai.com` con **OTP para
  cualquier correo**: quien tenga un correo puede pedir un código y llegar al worker.
- **El worker** = *autorización*. `resolveScope` ya decide: `ADMIN_EMAILS` → Velai, fila en
  `tenant_users` → ese cliente, **nada → 403**. Ese camino está probado (un correo que pasa Access
  sin autorización recibe 403, y sin `ADMIN_EMAILS` no hay admins pero los clientes siguen).

**Lo que se gana:** dar de alta el acceso de un cliente es una fila, desde el panel, sin token de
Cloudflare en el worker. Y no metemos en el worker una credencial capaz de **dar acceso al panel a
cualquiera** — el worker ya guarda la KEK y los auth tokens de cliente; esa habría sido otra clase de
poder.

**Lo que se pierde y hay que compensar:** deja de haber dos cerraduras independientes. El 403 de
`resolveScope` pasa a ser lo único entre un desconocido autenticado y los datos. Tres medidas, las
tres pequeñas:

1. **Registrar cada 403** con el correo que lo provocó (`code:'not_authorized'`). Sin esto no se
   entera nadie de que alguien está probando.
2. **Alerta a Telegram** cuando el mismo correo desconocido lo intenta ≥3 veces en una hora
   (antirebote como el de `alertUnknownTenant`).
3. **Rate limit por correo** en el camino de administración, con el mecanismo que ya existe.

> **`ADMIN_EMAILS` sigue siendo una variable del worker, NO una tabla editable desde el panel.**
> Deliberado: quien pueda editar `tenant_users` desde el panel no debe poder ascenderse a admin de
> Velai. Los dos niveles se gestionan por caminos distintos a propósito.

## B.2 Usuarios del cliente en el panel

En la ficha de cada cliente, una sección **Usuarios**: lista de correos con acceso, añadir y quitar.

Endpoints (solo rol `velai`; para `cliente` son 403 por `clienteAllowed`, que es lista blanca):

| Endpoint | Hace |
|---|---|
| `GET /api/admin/tenants/:id/users` | Lista los correos de ese cliente |
| `POST /api/admin/tenants/:id/users` | Añade `{ email }` |
| `DELETE /api/admin/tenants/:id/users/:email` | Lo quita |

Reglas:

- **Un correo pertenece a un solo cliente** (`email` ya es PK de `tenant_users`). Un choque se
  traduce a **409 `email_taken`** con mensaje claro, no a un 500 — el caso real es intentar dar de
  alta a un gestor que ya trabaja con otro cliente vuestro.
- **Un correo de `ADMIN_EMAILS` no puede añadirse como usuario de cliente** → 400
  `email_is_admin`. Si no, un admin de Velai quedaría degradado a un solo tenant al entrar.
- Normalizar a minúsculas y validar formato antes de escribir.
- Cada alta y baja deja rastro (`lead_events`/tabla de auditoría) con actor y rol.
- Al quitar el último usuario, avisar en la interfaz: *"este cliente se queda sin acceso al panel"*.
  No bloquearlo — a veces es lo que se quiere.

## B.3 El alta completa, de principio a fin

Lo que queda dentro del panel y lo que no. Esto es la referencia para el runbook:

| Paso | ¿Desde el panel? |
|---|---|
| Crear el cliente (nombre, slug, canal, contexto) | ✅ ya |
| Subcuenta de Twilio + token cifrado | ✅ ya (aprovisionamiento) |
| Plantilla de aviso + envío a aprobación | ✅ ya (y el cron rellena el SID al aprobarse) |
| Sender de WhatsApp + webhook + OTP | ✅ ya |
| Equipo de aviso (`team_whatsapp`) | ✅ ya |
| **Acceso al panel de sus usuarios** | ✅ **con este PR** |
| Verificar su negocio en Meta y añadir a Velai como socio | ❌ lo hace el cliente |
| Tope de gasto de la subcuenta | ❌ consola de Twilio (la API no lo permite) |
| Aprobación del display name y de la plantilla | ❌ decide Meta |
| El snippet en su web | ❌ lo pone quien mantiene la web |

Cuatro cosas fuera, y **ninguna es nuestra**: tres dependen de Meta o del cliente, y la cuarta es un
límite de la API de Twilio. Eso es el suelo real de "todo desde el panel".

## B.4 Tests

1. `POST …/users` con un correo ya usado por otro cliente → **409**, sin escribir.
2. `POST …/users` con un correo de `ADMIN_EMAILS` → **400 `email_is_admin`**.
3. Un `cliente` en cualquiera de los tres endpoints de usuarios → **403** y **cero** consultas a D1.
4. Correo con mayúsculas: se guarda en minúsculas y `resolveScope` lo encuentra.
5. Tras `DELETE`, ese correo pasa Access pero recibe **403** (el acceso se revoca de verdad).
6. Un 403 de correo desconocido queda registrado; a la tercera vez en una hora sale la alerta.

## B.5 Cambio manual en Cloudflare — **una sola vez**

Cambiar la política de la app de Access a **OTP para cualquier correo** (o mantener una lista amplia
si preferís un filtro grueso). Es el único paso en Cloudflare de todo este diseño, y se hace una vez.
Documentarlo en `OPERATIONS.md` junto al motivo: *si algún día se vuelve a restringir la política,
las altas desde el panel dejan de bastar y hay que tocar Cloudflare otra vez.*

## B.6 Orden

Parte A primero (son cuatro arreglos pequeños y uno de ellos está diciendo algo falso sobre el
coste). Después la B, con los tests de B.4 escritos antes de la interfaz.
