# Spec — prefijo `web:<slug>` para clientes solo-web

> **Estado (2026-08-18): APLICADA Y DESPLEGADA** (suite 41/41). Además del código, ya
> están hechos los dos pasos de deploy del §7 para los 4 clientes: sus dominios (apex y
> www) en `ALLOWED_WEB_ORIGINS` y sus apex en los hostnames del widget de Turnstile
> (actualizado por API). CORS verificado en producción con zoetravelspain.com. Falta solo
> el alta de las filas `web:<slug>` en el panel y el snippet en cada web del cliente.

> **Por qué.** Un cliente que hoy solo puede tener chat web (sin WhatsApp ni página asignada) no
> cabe en el modelo actual: para atender por web necesita `active = 1`, y para estar activo necesita
> una `channel_address` que pase `ADDRESS_RE` (`whatsapp:` o `messenger:`). `pending:` no sirve
> porque fuerza inactivo. Resultado: los 4 clientes en alta (HireDataVision, GoGestión, Zoe,
> Diálogos) no se pueden dar de alta operativos, y el canal web es justo el único entregable sin
> trámites de Meta.
>
> **Qué se añade.** Una tercera forma de dirección, `web:<slug>`: legal, **activable** (a diferencia
> de `pending:`) y **no enrutable por Twilio**. Cambio pequeño; la parte importante es la guarda 2.

---

## 1. `worker/app.js` — la regex

Junto a `ADDRESS_RE` y `PENDING_RE` (≈ línea 227):

```js
// Cliente solo-web: atiende por `body.tenant` (resuelto por slug), nunca por webhook de
// Twilio. Es una dirección legal y ACTIVABLE — al revés que `pending:`, que fuerza inactivo.
const WEB_RE = /^web:[a-z0-9][a-z0-9-]{1,39}$/;
```

En `validateTenant`, la validación de `channel_address` acepta las tres:

```js
  if (has('channel_address') || !partial) {
    out.channel_address = clean(body.channel_address, 80);
    if (!ADDRESS_RE.test(out.channel_address) && !PENDING_RE.test(out.channel_address)
      && !WEB_RE.test(out.channel_address)) bad('channel_address');
  }
```

`assertNotActivePending` **no cambia**: solo `pending:` bloquea la activación.

## 2. Guarda: el webhook solo acepta direcciones enrutables

En `handleTwilio`, **antes** de consultar D1:

```js
  // Twilio solo manda `whatsapp:` o `messenger:`. Cualquier otra cosa (incluidas las
  // direcciones internas `web:` y `pending:`) se rechaza aquí: así una dirección interna
  // no puede recibir tráfico ni gastar una consulta a D1, ni con el token del padre.
  if (!ADDRESS_RE.test(to)) throw new HttpError(400, 'invalid_twilio_payload');
```

Es la línea que hace que este cambio no abra superficie: sin ella, un `To` falsificado con
`web:<slug>` alcanzaría el tenant de un cliente por el camino del webhook.

## 3. Semáforo del panel

Un tenant `web:` **no necesita** `twilio_from`, subcuenta ni plantilla propia, así que hoy el
semáforo lo marcaría en rojo para siempre. En `worker/admin-page.js`, función `semaforo(t)`:

- Si `channel_address` empieza por `web:` → etiqueta **`solo web`** y solo se exige contexto y
  **algún canal de aviso** (`has_team` **o** `telegram_chat_id`). No se exige plantilla ni From.
- El resto de estados, igual que ahora.

Y en el placeholder del campo Canal, añadir la tercera forma:
`whatsapp:+34910000000 · messenger:12345 · web:mi-cliente · pending:mi-cliente`.

## 4. Aviso de leads de un cliente solo-web

Sin subcuenta, `deliver()` usa el número y la plantilla de Velai (respaldo del entorno), lo cual
**funciona** pero el texto que recibe el equipo del cliente dice "Nuevo lead – Velai".

Recomendación para estos 4: **avisar por Telegram** con el `telegram_chat_id` del cliente, y dejar
el WhatsApp para cuando tengan su propia subcuenta y plantilla. Si se prefiere WhatsApp igualmente,
dejarlo documentado en `OPERATIONS.md` como comportamiento consciente del piloto.

## 5. Tests (3 nuevos)

1. Tenant con `channel_address = 'web:zoe'` y `active = 1` → `POST /chat` con `tenant: 'zoe'`
   responde **con su contexto**, y `POST /lead` guarda con **su** `tenant_id`.
2. `POST /` (webhook) con `To = web:zoe` → **400** y **ninguna** consulta a D1 (espiar `env.DB`).
3. Un tenant `web:` **sí** se puede activar (`assertNotActivePending` no lo bloquea), mientras que
   `pending:` sigue dando 400 `pending_tenant_cannot_be_active`.

## 6. Documentación

- `docs/OPERATIONS.md`: las tres formas de dirección y cuándo se usa cada una.
- `docs/ALTACLIENTE.md`: ruta "solo web" con sus dos pasos de deploy (§7 de aquí).
- `docs/PLAN-ALTA-CLIENTES.md` §3.6: nota de que el prefijo `web:` complementa a `pending:`.

## 7. Lo que sigue siendo deploy (no lo olvides al dar el alta)

Para que la web de un cliente pueda hablar con el worker hacen falta **dos** cosas, y ninguna es
automática:

1. Su dominio en `ALLOWED_WEB_ORIGINS` (`wrangler.toml`) → **deploy del Worker**.
2. Su hostname en los hostnames del **widget de Turnstile** (dashboard) — si falta, el chat falla
   con `human_verification_failed` y parece un bug del bot.

Y en su web, antes de cargar el widget:

```html
<script>window.VELAI_TENANT='zoe';</script>
<script src="https://hirevai.com/assets/vai-widget.js?v=5" defer></script>
```

Si vais a dar de alta los 4, mete los 4 dominios de una vez en un solo deploy.
