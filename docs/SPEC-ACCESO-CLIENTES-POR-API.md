# Spec — alta de usuarios de cliente en Cloudflare Access, por API

> **Estado (2026-08-18): CÓDIGO IMPLEMENTADO** (`worker/cloudflare.js`:
> `syncAccessGroup` reescribe el grupo ENTERO desde D1 tras cada alta/baja — con
> centinela si la lista queda vacía —, respuesta con `gate:
> sincronizado|pendiente|manual`, toasts en el panel, log `access_group_desync` +
> alerta Telegram si el PUT falla tras escribir en D1; suite 65/65). Desviación
> consciente: sin cerrojo KV — el PUT reescribe la lista completa leída tras la
> propia escritura, así que dos operaciones simultáneas convergen en la siguiente
> sincronización; el estado `pendiente` + alerta cubre el resto. **Falta para
> activarlo (manual/una vez)**: token `CF_API_TOKEN` (el OAuth de wrangler es
> solo-lectura para Access: los POST de IdP y grupo devolvieron `auth.forbidden`),
> crear el IdP OTP + grupo «Clientes Velai» + meterlo en la política de la app
> (la app vive a NIVEL DE ZONA, no de cuenta), y `CF_ACCESS_GROUP_ID` en wrangler.toml.
> restricted to members of the account”; la idea es que eso quede guardado también vía API»*.
> Verificado el 2026-08-18 contra la API y la documentación de Cloudflare Zero Trust.
> Complementa `SPEC-ORIGENES-Y-TURNSTILE-POR-API.md` (mismo token, mismo patrón).
>
> **Validación CLI (2026-08-18):** diagnóstico CONFIRMADO contra la API real —
> `GET /accounts/{id}/access/identity_providers` devuelve `[]` (cero IdPs): One-time PIN
> no existe en la organización, así que ningún correo externo puede autenticarse por
> mucho que su fila en `tenant_users` sea correcta. Esta spec SUSTITUYE el plan anterior
> de «política Everyone + OTP» (TAREAS §2a-bis): la puerta pasa a ser OTP + grupo
> `Clientes Velai` mantenido por el panel — al implementarla, actualizar también
> OPERATIONS §Modelo de cerraduras.

## 1. La causa: no es el panel, es que **OTP no existe** en la organización

La pantalla que ves ofrece **un solo** método de acceso, *Cloudflare*, y avisa de que el inicio de
sesión está restringido a **miembros de la cuenta**. Eso significa que la organización de Zero Trust
tiene como método de login el **proveedor de identidad de Cloudflare**, que solo autentica a gente con
cuenta de Cloudflare en el equipo. `dialogosqueensenan@gmail.com` no lo es, así que no hay forma de
que entre — la fila en `tenant_users` es correcta y no tiene nada que ver.

Contexto que explica por qué apareció así: Cloudflare cambió el valor por defecto el **18 de junio de
2026** — las organizaciones nuevas arrancan con el IdP de Cloudflare en vez de con One-time PIN.
**OTP ya no se añade automáticamente.**

Es decir: hay **dos capas** y hoy falla la primera.

| Capa | Quién decide | Estado |
|---|---|---|
| **Puerta** — Cloudflare Access: ¿puede este correo autenticarse y llegar a `admin.hirevai.com`? | Zero Trust (IdP + política) | 🔴 cerrada: sin OTP, solo miembros de la cuenta |
| **Permisos** — ¿qué ve una vez dentro? | Nuestro worker: `resolveScope` + `tenant_users` | ✅ ya funciona (rol `cliente`, sus leads y nada más) |

## 2. Arreglo, en dos pasos

### Paso 1 — habilitar One-time PIN (una sola vez)

```
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/access/identity_providers
{ "name": "One-time PIN", "type": "onetimepin" }
```

Permiso del token: **Access: Organizations, Identity Providers, and Groups → Write**.
(Equivalente en el dashboard: *Zero Trust → Integrations → Identity providers → Add new → One-time PIN*.)

⚠️ **Trampa que encaja con tu captura:** si la aplicación tiene `allowed_idps` fijado al IdP de
Cloudflare, añadir OTP **no basta** — el botón de OTP no aparecerá. Hay que dejar `allowed_idps`
vacío (= todos) o añadir el `id` del IdP de OTP en la aplicación
(`PUT /accounts/{id}/access/apps/{app_id}`). Que el login siga mostrando solo *Cloudflare* después de
crear el OTP es exactamente este caso.

### Paso 2 — un grupo de Access que el panel mantiene

Crear **una vez** un grupo `Clientes Velai` y que la política de la app *«Velai Leads Panel»* lo
incluya. A partir de ahí, cada alta o baja en el panel actualiza el grupo:

```
PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/access/groups/{group_id}
{
  "name": "Clientes Velai",
  "include": [
    { "email": { "email": "dialogosqueensenan@gmail.com" } },
    { "email": { "email": "gestora@cliente.com" } }
  ]
}
```

⚠️ **`include` es sustitución completa**, igual que los `domains` de Turnstile: si envías solo el
correo nuevo, **borras a todos los demás**. La lista se reconstruye **siempre desde D1**
(`SELECT email FROM tenant_users`), nunca incrementalmente.

## 3. Dónde encaja en el código

Extender los handlers que ya existen (`worker/app.js`, `/api/admin/tenants/:id/users`):

| Acción | Añadir |
|---|---|
| `POST …/users` | tras el `INSERT`: reconstruir la lista desde D1 → `PUT` al grupo |
| `DELETE …/users/:email` | tras el `DELETE`: mismo `PUT` (si no, un correo dado de baja sigue entrando por la puerta) |
| `GET …/users` | además del listado, el estado de la puerta: *acceso concedido ✓* / *pendiente* |

Guardas, calcadas del PR 6:

1. **D1 primero, Cloudflare después.** Si el `PUT` falla, la fila ya está y el correo queda con
   *acceso pendiente*: log `code:'access_group_desync'` + alerta a Telegram. Es el único estado
   incoherente y hay que verlo, no adivinarlo.
2. **Cerrojo en KV** (`access:group`, TTL 60 s): dos altas simultáneas reconstruyendo la lista podrían
   pisarse y perder un correo.
3. **Botón *Reconciliar***: `GET` del grupo, comparar con D1, mostrar diferencias y reparar. Con una
   API de sustitución completa, la reconciliación no es un lujo.
4. **Nunca meter los `ADMIN_EMAILS` en el grupo de clientes**: van por su propia regla. Un cliente que
   pudiera editar el grupo no debe poder colarse entre los admins (misma razón por la que los admins
   no están en `tenant_users`).
5. Auditoría en `tenant_versions` con actor y correo, como ya se hace.

## 4. La alternativa sin API, y por qué no la elegiría ya

Poner la política en *Everyone* + *One-time PIN*: cualquiera con un correo consigue sesión de Access y
es **nuestro worker** quien devuelve `403 not_authorized` si no está en `tenant_users`. Funciona —la
autorización de verdad ya vive ahí, con registro y alerta al 3.er intento— pero deja la puerta de
`admin.hirevai.com` abierta al mundo y convierte cada escaneo en tráfico contra el worker.

Con el grupo, **solo los correos que has dado de alta pasan la puerta**, y encima queda automatizado.
Ya que hay que tocar la API para Turnstile, hacerlo aquí también sale casi gratis.

## 5. Token y secretos

Un solo secret `CF_API_TOKEN` + `CF_ACCOUNT_ID` con dos permisos de cuenta:

- **Access: Organizations, Identity Providers, and Groups → Write** (IdP, grupos y apps)
- **Turnstile → Edit** (los `domains` del widget, spec anterior)

Y una nota de diseño: OTP **no** conserva las pertenencias a grupos del IdP. Da igual en nuestro caso
—la autorización la hace el worker con `tenant_users`, no Access— pero conviene no construir nada que
dependa de grupos de identidad.

## 6. Orden

1. Crear el IdP de OTP y revisar `allowed_idps` de la app *(desbloquea a Diálogos hoy mismo)*.
2. Crear el grupo `Clientes Velai` y meterlo en la política.
3. `PUT` del grupo desde `POST`/`DELETE` de usuarios + estado en el panel + alerta de desincronía.
4. Botón de reconciliación.

Con 1 y 2 hechos a mano, el correo de Diálogos entra esta tarde. 3 y 4 son para que no vuelvas a
tocar el dashboard en el cliente número 5.
