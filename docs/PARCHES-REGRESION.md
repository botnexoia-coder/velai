# Parches de la regresión — para aplicar de una vez

> **Estado (2026-08-17): LOS 6 PARCHES APLICADOS Y DESPLEGADOS, suite 39/39** (el
> objetivo exacto de este doc). Incluye los detalles del parche 6: cerrojo liberado
> con try/finally, `provPost` recarga la ficha entera (arregla `stale_tenant` Y
> repuebla los inputs en el mismo cambio), `ORDER BY updated_at` en el sondeo,
> invalidación antes del versionado en el alta, y el flag `stale` ahora SÍ re-cifra
> perezosamente con la KEK nueva (el comentario de crypto.js ya es verdad).
> El test previo de deliver-subcuenta se actualizó: con el parche 3 un tenant con
> subcuenta necesita SU From y SU plantilla (ya no hay respaldo cruzado que probar).

> Regresión ejecutada el 2026-08-17 contra el código real de `8e8f770` con un arnés que monta
> **D1 de verdad** (node:sqlite con las 5 migraciones del repo), KV en memoria y `fetch`
> instrumentado, invocando el `fetch` del Worker: **38 escenarios, 32 PASS, 6 FAIL**.
> Los 6 fallos son 3 defectos. No apareció ninguno nuevo.
>
> `npm run check` del repo sigue verde (33/33): estos casos **no estaban cubiertos**, por eso los
> tests no los veían. Los tests nuevos van al final.

---

## Lo que la regresión confirma que YA funciona (32 casos)

| Área | Verificado |
|---|---|
| **Número propio de Velai** | Webhook con `AccountSid` = padre → 200 con TwiML, prompt del tenant + guardrails, historial en KV namespaceado por tenant. **Sin regresión por el reorden de la firma.** |
| **Firma** | Sin cabecera → 403 · con token equivocado → 403 · con el token del **padre** sobre una subcuenta → 403 (no hay respaldo global) · `AccountSid` que no es el de la fila → 403 `account_tenant_mismatch`. En todos, **no se llama al modelo**. |
| **Subcuenta de cliente** | Firmada con su token → 200 **con su contexto**, no el de Velai. |
| **Chat web** | Sin `tenant` → cae en el tenant por defecto · con `tenant` → contexto del cliente · `tenant` inexistente → 400 `invalid_tenant`. |
| **Formulario** | Lead con `tenant` → se persiste con **su** `tenant_id`. (El fix del PR 1 funciona de verdad.) |
| **Messenger** | Adjunto sin `Body` → 200 y log `messenger_attachment_ignored`, sin gastar llamada al modelo. |
| **Prospectos** | `pending:` no enruta (404) · el chat web tampoco lo resuelve (400) · activar uno sin dirección real → `pending_tenant_cannot_be_active`. |
| **Aprovisionamiento (camino feliz)** | Guarda SID + token cifrado `v1:` · la respuesta **no** contiene el token · segundo intento → bloqueado · **una sola** llamada de creación a Twilio · error de Twilio → error controlado y fila intacta. |
| **Cron** | Plantilla `pending` → `approved` con el estado escrito. |
| **Varios** | Rate limit por IP en `POST /` → 429 · `POST /` JSON antiguo → 410 · admin sin JWT → 401 · `deliver` con subcuenta completa usa URL, `From`, plantilla y credenciales **todos** de la subcuenta · plantilla no aprobada → `skipped` sin quemar intento. |

---

## Parche 1 — Token indescifrable: 500 mudo en vez de 403 con alerta

**Fallos 4.1 y 4.2.** Reproducido: fila cifrada con una KEK distinta (exactamente lo que deja una
rotación mal hecha) → **500 `server_error`** en cada webhook y **cero alertas**. Twilio ve un 500,
reintenta y abandona. En `deliver()` la misma excepción se traga como `network_error` y **quema uno
de los 5 intentos**, así que los avisos de ese cliente acaban en `failed` permanente.

`worker/app.js:691` — que un token ilegible sea equivalente a no tenerlo:

```js
async function twilioAuthTokenFor(env, tenant) {
  if (!tenant || !tenant.twilio_auth_token_enc) return null;
  try {
    const out = await decryptSecret(env, tenant.id, tenant.twilio_auth_token_enc);
    return out ? out.value : null;
  } catch (error) {
    // Un token ilegible (KEK rotada sin re-guardar, fila corrupta) equivale a no tenerlo:
    // 403 + alerta, nunca un 500 mudo que Twilio reintenta y nadie ve.
    console.log(JSON.stringify({ level: 'error', code: 'tenant_token_undecryptable', tenant: tenant.slug }));
    return null;
  }
}
```

Con esto el webhook devuelve 403 `twilio_auth_token_missing` **y** dispara
`alertTenantMisconfigured`, y `deliver` devuelve `skipped` sin consumir intentos.

## Parche 2 — `unb64` lanza `DOMException` con base64 corrupto

**Fallo 7.1.** `deliver()` con `twilio_auth_token_enc = 'v1:@@@:@@@'` lanza `Invalid character`
en lugar de un error controlado. `worker/crypto.js:8`:

```js
function unb64(text) {
  try { return Uint8Array.from(atob(text), (c) => c.charCodeAt(0)); }
  catch (_) { throw new Error('cipher_format'); }
}
```

## Parche 3 — `deliver()` cruza cuentas: credenciales de la subcuenta con el número de Velai

**Fallo 5.1.** Reproducido: tenant con subcuenta y token, pero sin `twilio_from` ni
`lead_template_sid` (el estado exacto justo después de aprovisionar) → la petición sale a
`…/Accounts/AC<subcuenta>/Messages.json` con `From=whatsapp:+15706160059` y el `ContentSid` **de
Velai**. Twilio lo rechaza siempre (21606 / 20404) → 5 intentos → `failed` definitivo. El equipo
del cliente nunca recibe sus leads y el semáforo no lo marca.

`worker/app.js:441`:

```js
  const sub = tenant && tenant.twilio_subaccount_sid;
  // Los recursos del padre (número y plantilla de Velai) NO existen dentro de una
  // subcuenta: si el tenant tiene subcuenta, no hay respaldo cruzado posible.
  const templateSid = (tenant && tenant.lead_template_sid) || (sub ? null : env.TWILIO_LEAD_TEMPLATE_SID);
  const fromAddress = (tenant && tenant.twilio_from) || (sub ? null : env.TWILIO_FROM);
```

Y en el semáforo del listado (`GET /api/admin/tenants`), añadir `t.twilio_from IS NOT NULL AS has_from`
y marcar **sin From** cuando haya subcuenta y falte.

## Parche 4 — Sin `SECRETS_KEK` se crea la subcuenta y el token se pierde sin rastro

**Fallos 12.1 y 12.2.** Reproducido con el env sin KEK: Twilio **crea** la subcuenta,
`encryptSecret` lanza fuera del `try` de `provisionOrphan`, y el resultado es SID sin guardar
(`null`), **ninguna alerta**, `server_error` en el panel y una subcuenta facturable que no se puede
borrar (solo cerrar, con eliminación a los 30 días). El siguiente clic crea otra con el mismo nombre.

`worker/app.js:920`:

```js
    if (tenant.twilio_subaccount_sid) throw new HttpError(409, 'already_provisioned');
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) throw new HttpError(503, 'twilio_not_configured');
    // La KEK se comprueba ANTES de gastar dinero: si no puede cifrar, no se crea nada.
    try { await encryptSecret(env, tenantId, 'probe'); }
    catch (_) { throw new HttpError(503, 'kek_not_configured'); }
    const created = await createSubaccount(env, `cliente-${tenant.slug}`);
    let encrypted = null;
    try { encrypted = await encryptSecret(env, tenantId, created.authToken); }
    catch (error) { await provisionOrphan(env, ctx, tenant, 'subcuenta', created.sid, error); }
```

## Parche 5 — La idempotencia la debe imponer D1, no KV

El cerrojo es `KV.get` + `KV.put`: no es atómico y KV es eventualmente consistente. El `UPDATE` no
comprueba el estado previo, así que dos peticiones simultáneas pueden crear **dos** subcuentas y la
segunda **sobrescribe el SID y el token de la primera**. `worker/app.js:925`:

```js
      const res = await env.DB.prepare(`UPDATE tenants SET twilio_subaccount_sid=?, twilio_auth_token_enc=?,
        provisioned_at=?, updated_at=? WHERE id=? AND twilio_subaccount_sid IS NULL`)
        .bind(created.sid, encrypted, now, now, tenantId).run();
      if (!res.meta.changes) {
        await provisionOrphan(env, ctx, tenant, 'subcuenta (carrera)', created.sid, new Error('already_provisioned'));
      }
```

Igual en `template` (`AND lead_template_sid IS NULL`) y en `sender` (`AND sender_sid IS NULL`).

## Parche 6 — Detalles

- **El cerrojo no se libera nunca** (`app.js:874`): se toma antes de las comprobaciones y solo expira
  a los 60 s, así que un OTP mal escrito deja *"ese paso ya está en curso"* un minuto sin que haya
  nada en curso. `try/finally` con `KV.delete` alrededor del cuerpo, o TTL de 10 s para
  `sender/verify`, que no crea recursos.
- **`provPost` del panel** (`admin-page.js:100`): recargar la ficha completa con
  `openTenant(editing.id)`. Hoy el siguiente «Guardar» da `stale_tenant` — y **ese 409 es lo único
  que impide** que el input de subcuenta vacío mande `twilio_subaccount_sid = ''` y borre el SID
  recién creado. Al arreglar el 409 hay que repoblar los inputs **en el mismo cambio**.
- **`pollProvisioning`** (`app.js:1210`): `LIMIT 10` sin `ORDER BY` — con más de 10 filas atascadas
  algunas podrían no sondearse nunca. Añadir `ORDER BY updated_at ASC`.
- **`invalidateTenantCache` antes del versionado** en el alta (`app.js:928`): si el `INSERT` en
  `tenant_versions` falla, hoy la caché se queda sin invalidar hasta 5 minutos.
- **`crypto.js:45`**: el flag `stale` no se usa en ningún sitio; la reescritura perezosa que promete
  el comentario no existe. Implementarla o quitar el comentario.

---

## Tests nuevos (los 6 casos que fallaban)

Al final de `test/worker.test.js`. Con los parches deben pasar los 6 → **39/39**.

```js
test('un token que no descifra da 403 con alerta, nunca 500 mudo', async () => {
  const otherKek = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 99)));
  const id = '00000000-0000-4000-8000-0000000000c1';
  const tenant = { id, slug: 'rot', name: 'Rot', channel_address: 'whatsapp:+34911111111', active: 1,
    twilio_subaccount_sid: 'AC' + 'c'.repeat(32), system_prompt: 'x'.repeat(60),
    twilio_auth_token_enc: await encryptSecret({ SECRETS_KEK: otherKek }, id, 'a'.repeat(32)) };
  // …montar env con ese tenant, firmar con el token del cliente y comprobar:
  // status 403, error 'twilio_auth_token_missing', y una llamada a api.telegram.org
});

test('un ciphertext corrupto no lanza DOMException', async () => {
  await assert.rejects(decryptSecret({ SECRETS_KEK: TEST_KEK }, 't', 'v1:@@@:@@@'),
    (e) => e.message === 'cipher_format');
  const out = await testing.deliver(
    { SECRETS_KEK: TEST_KEK, TWILIO_ACCOUNT_SID: 'AC' + 'p'.repeat(32), TWILIO_AUTH_TOKEN: 'p' },
    'whatsapp', { whatsapp: '+34612' },
    { id: 't', twilio_subaccount_sid: 'AC' + 'c'.repeat(32), twilio_auth_token_enc: 'v1:@@@:@@@',
      team_whatsapp: 'whatsapp:+34600111222', twilio_from: 'whatsapp:+34910000000', lead_template_sid: 'HX' + '9'.repeat(32) });
  assert.equal(out.skipped, true);
});

test('un tenant con subcuenta nunca usa el From ni la plantilla de Velai', async () => {
  // tenant con subcuenta + token pero sin twilio_from ni lead_template_sid
  // → deliver debe devolver skipped, y NO debe haber ninguna llamada a api.twilio.com
});

test('sin SECRETS_KEK no se crea ninguna subcuenta en Twilio', async () => {
  // handleProvision('subaccount') con env sin SECRETS_KEK
  // → rechaza con kek_not_configured y calls a /Accounts.json === 0
});

test('el UPDATE de aprovisionamiento exige que la columna esté vacía', async () => {
  // UPDATE … WHERE id=? AND twilio_subaccount_sid IS NULL con la columna ya puesta
  // → meta.changes === 0 y se registra provision_orphan
});

test('el cerrojo de aprovisionamiento se libera al fallar el paso', async () => {
  // un paso que lanza debe dejar la clave provision:<id>:<paso> borrada en KV
});
```

---

## Después de los parches

1. `npm run check` → 39/39.
2. `openssl rand -base64 32` → `npx wrangler secret put SECRETS_KEK` → **`npx wrangler secret list`
   para confirmar que está**. Con el parche 4 ya no es catastrófico olvidarlo, pero sigue siendo el
   primer paso.
3. `npx wrangler d1 migrations apply vai-leads --remote` (0004 y 0005).
4. `npx wrangler deploy`; comprobar cron `*/5` y bindings `KV`/`DB`.
5. Pruebas en vivo, en este orden: WhatsApp al número de Velai · chat web en `hirevai.com` ·
   formulario de lead · `POST /` sin firma → 403.
6. Alta de los 4 clientes + `myxu-costura` como `pending:` inactivo; intentar activarlo → 400.
7. Tope de gasto a cada subcuenta en la consola de Twilio (la API no lo hace).

Sigue pendiente de terceros: sender de WhatsApp (necesita la WABA del cliente conectada), aprobación
de plantilla (Meta) y localizar dónde está configurado el canal Messenger en la consola.
