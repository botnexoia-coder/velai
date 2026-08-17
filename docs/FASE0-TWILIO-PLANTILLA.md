# Fase 0 — Activar el aviso de lead por WhatsApp

> **Estado (2026-08-17): APLICADO Y DESPLEGADO.** `deliver()` usa la plantilla
> (`ContentSid`/`ContentVariables`), los 3 secrets están cargados (SID de la versión
> Marketing; cambiar a la Utility cuando esté aprobada es solo `wrangler secret put
> TWILIO_LEAD_TEMPLATE_SID`), tests añadidos. Quedan las tareas de §6 (Utility,
> verificación Meta, status callback, perfil, voz, bundle +34).

> Objetivo: que el aviso al equipo llegue, hoy. Es el cambio más pequeño con más impacto y no
> depende de la verificación de Meta, ni de números +34, ni del multi-tenant.
>
> Cambio: ~40 líneas en `worker/app.js`, 3 variables de entorno y una plantilla nueva en Twilio.
> Aplícalo desde la raíz del repo `botnexoia-coder/velai`.

---

## 0. Por qué

Los 6 avisos de junio salieron y **todos volvieron `Undelivered` con error 63016**:

> *Outside messaging window. For WhatsApp, use a Message Template instead*

`deliver()` (`worker/app.js:202`) manda `Body` en texto libre. El equipo no ha escrito al bot en
24 h, así que WhatsApp lo rechaza. Poner `TEAM_WHATSAPP` y `TWILIO_FROM` sin tocar el código
reproduce el mismo fallo.

---

## 1. La plantilla que ya existe

`velai_nuevo_lead` · `HX1b64454910a2b69179a7250114448c2b` · español · **Approved**

```
🔥 Nuevo lead – Velai

📱 WhatsApp: {{1}}
👤 Nombre: {{2}}
🏪 Negocio: {{3}}
🎯 Necesidad: {{4}}

⚡ Contactar hoy mismo
```

| Variable | Contenido | Ejemplo en Twilio |
|---|---|---|
| `{{1}}` | WhatsApp del lead | `34612345678` |
| `{{2}}` | Nombre | `María` |
| `{{3}}` | Negocio / sector | `Barbería en Madrid` |
| `{{4}}` | Necesidad | `Atender clientes fuera de horario` |

Canales soportados: WhatsApp (business y user initiated), **Facebook Messenger**, SMS y RCS.
Lo de Messenger es útil: el mismo `ContentSid` sirve el día que el aviso salga por ahí.

### ⚠️ Está en categoría **Marketing**, y debería ser **Utility**

Un aviso interno de lead es utilidad, no marketing. Que esté como Marketing tiene tres costes:

- **Precio**: marketing es el tramo más caro de Meta.
- **Gratuidad**: desde el 1 de julio de 2025 las plantillas **Utility** enviadas dentro de la
  ventana de atención no tienen coste de Meta. Las de Marketing sí, siempre.
- **Entrega**: las de Marketing están sujetas a los topes por usuario y son las primeras que Meta
  frena si alguien marca como spam. Encima cuentan contra el cupo del portfolio, que con tu
  decisión de WABA compartes entre todos los clientes.

**Una plantilla no se puede editar después de enviarla a aprobación.** Hay que crear otra:

1. Content Template Builder → abre `velai_nuevo_lead` → botón **Duplicate**.
2. Nómbrala `velai_nuevo_lead_util`. Copia el cuerpo tal cual (los emojis y los `{{n}}` incluidos).
3. Categoría WhatsApp: **Utility**.
4. Submit for WhatsApp approval. Suele tardar minutos.
5. Cuando esté `Approved`, usa **su** SID en `TWILIO_LEAD_TEMPLATE_SID`.

> Puedes arrancar ya con la de Marketing (funciona) y cambiar el SID cuando la de Utility esté
> aprobada. Es una variable de entorno, no un deploy.

---

## 2. El parche — `worker/app.js`

### 2.1 Dos funciones nuevas, justo antes de `deliver`

```js
// WhatsApp rechaza variables de plantilla vacías, con saltos de línea o con más de
// 4 espacios seguidos. Todo campo se normaliza y lleva respaldo.
function templateVar(value, fallback) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return text || fallback;
}

// Orden fijado por la plantilla velai_nuevo_lead: 1 WhatsApp, 2 Nombre, 3 Negocio, 4 Necesidad.
// Si cambias la plantilla, cambia esto a la vez.
function leadTemplateVariables(lead) {
  return JSON.stringify({
    1: templateVar(lead.whatsapp, 'sin teléfono'),
    2: templateVar(lead.name, 'sin nombre'),
    3: templateVar(lead.sector, 'sin especificar'),
    4: templateVar(lead.need || lead.note, 'sin especificar'),
  });
}
```

### 2.2 Sustituye `deliver` entera

```js
async function deliver(env, channel, lead) {
  if (channel === 'telegram') {
    if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) return { skipped: true, error: 'not_configured' };
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: notificationText(lead), parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { error: `telegram_${response.status}` };
    const data = await response.json();
    return data.ok ? { ok: true } : { error: 'telegram_rejected' };
  }
  const recipients = clean(env.TEAM_WHATSAPP, 1000).split(',').map((x) => x.trim()).filter(Boolean);
  if (!recipients.length || !env.TWILIO_FROM || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    return { skipped: true, error: 'not_configured' };
  }
  // Sin plantilla, el aviso al equipo es un mensaje iniciado por el negocio fuera de la
  // ventana de 24 h y WhatsApp lo rechaza siempre con 63016. Mejor 'skipped' explícito.
  if (!env.TWILIO_LEAD_TEMPLATE_SID) return { skipped: true, error: 'template_not_configured' };
  const auth = `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`;
  const variables = leadTemplateVariables(lead);
  // allSettled, no all: con Promise.all un timeout de un destinatario tumbaba el envío
  // entero y el reintento duplicaba el mensaje a quien sí lo había recibido.
  const results = await Promise.allSettled(recipients.map((to) => fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        From: env.TWILIO_FROM,
        To: to,
        ContentSid: env.TWILIO_LEAD_TEMPLATE_SID,
        ContentVariables: variables,
      }),
      signal: AbortSignal.timeout(8000),
    })));
  const delivered = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
  if (!delivered) return { error: 'twilio_rejected' };
  return { ok: true, partial: delivered < recipients.length };
}
```

### 2.3 Los dos sitios que llaman a `deliver`

`deliver` ahora recibe el lead, no el texto ya formateado.

```js
// worker/app.js:218 — en processNotifications
- try { outcome = await deliver(env, job.channel, notificationText(lead)); }
+ try { outcome = await deliver(env, job.channel, lead); }
```

```js
// worker/app.js:253 — en el fallback de storeLead
- try { if ((await deliver(env, channel, notificationText(inputToNotifiable(input)))).ok) notified = true; } catch (_) {}
+ try { if ((await deliver(env, channel, inputToNotifiable(input))).ok) notified = true; } catch (_) {}
```

`notificationText()` se queda como está: ahora solo la usa la rama de Telegram, que es donde el
texto libre sí vale.

> Si más adelante aplicas el PR A de `REVISION-2026-08-17.md`, el aviso de "modo degradado" que
> propuse llamaba a `deliver()` con un string. Con esta firma ya no vale: sácalo a una función
> aparte que hable con Telegram directamente.

---

## 3. Variables de entorno

Antes de nada, **comprueba que `keep_vars = true` sigue en `wrangler.toml`**. Es lo que ya os
borró `TELEGRAM_CHAT_ID` una vez, y muy probablemente lo que borró `TEAM_WHATSAPP` y
`TWILIO_FROM` después de las pruebas de junio.

```bash
grep keep_vars wrangler.toml     # debe existir y estar a true

npx wrangler secret put TWILIO_FROM
# whatsapp:+15706160059

npx wrangler secret put TEAM_WHATSAPP
# whatsapp:+34642650553,whatsapp:+34655433803,whatsapp:+34602608940

npx wrangler secret put TWILIO_LEAD_TEMPLATE_SID
# HX1b64454910a2b69179a7250114448c2b   (o el SID de la versión Utility)
```

El prefijo `whatsapp:` y el formato E.164 son obligatorios en `From` y en cada `To`. Sin el
prefijo, Twilio devuelve 400 y el `catch` se lo traga en silencio.

> Los tres números de `TEAM_WHATSAPP` los saqué de los envíos fallidos de junio. Verifica que
> siguen siendo los del equipo antes de ponerlos.

---

## 4. Añade el test

En `test/worker.test.js`, para que esto no vuelva:

```js
test('el aviso de WhatsApp usa plantilla y nunca texto libre', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: String(init.body) });
    return new Response('{}', { status: 201 });
  };
  // … invoca deliver a través de processNotifications con un lead de prueba …
  const twilio = calls.find((c) => c.url.includes('api.twilio.com'));
  assert.ok(twilio.body.includes('ContentSid=HX'), 'debe mandar ContentSid');
  assert.ok(!twilio.body.includes('Body='), 'no debe mandar Body en texto libre');
});

test('las variables de plantilla nunca van vacías', () => {
  const vars = JSON.parse(testing.leadTemplateVariables({ whatsapp: '', name: null, sector: '  ', need: '' }));
  assert.deepEqual(Object.values(vars).filter((v) => !v).length, 0);
});
```

Exporta las dos funciones nuevas en el objeto `testing` del final de `worker/app.js`:

```js
export const testing = { clean, normalizePhone, extractPhone, safeUtm, publicCors,
  validTwilioSignature, csvCell, expiryDate, leadFilters, isDemoKey,
  templateVar, leadTemplateVariables };
```

---

## 5. Desplegar y comprobar

```bash
npm run check          # check:js + check:site + tests
npx wrangler deploy
```

Verificación end-to-end, en orden:

1. Manda un lead de prueba desde el formulario de `hirevai.com`.
2. **Twilio → Monitor → Logs → Messaging**: el mensaje debe salir `Delivered`, no
   `Undelivered 63016`. Si aparece `Sent` y se queda ahí, el destinatario no tiene WhatsApp
   activo en ese número.
3. **Panel admin** (`admin.hirevai.com`): la fila del lead debe mostrar `whatsapp: sent`.
4. Si sale `63028` o similar, es que alguna variable llegó vacía o con salto de línea —
   revisa `templateVar`.

---

## 6. Mientras tanto, en paralelo (no bloquean este cambio)

- [ ] **Duplicar la plantilla en categoría Utility** y cambiar el SID cuando esté aprobada.
- [ ] **Verificación de negocio de Velai en Meta** (Business Manager `949061711290882`).
      Bloqueante para el primer cliente: sin ella el techo es de 2 números y ya usas 1.
- [ ] **Status Callback** del sender apuntando al worker. Sin esto un `Undelivered` solo se ve
      entrando a la consola a mano — que es exactamente por lo que esto ha estado dos meses roto.
- [ ] **Perfil de negocio** del sender: faltan dirección, email y vertical.
- [ ] **Webhook de voz**: sigue en el demo de Twilio. El número está publicado en la web.
- [ ] **Bundle regulatorio** para comprar números +34.

Cuando la Fase 0 esté verde, el siguiente paso es el multi-tenant de `TWILIO-MULTITENANT.md` §5,
antes de dar de alta al segundo cliente.
