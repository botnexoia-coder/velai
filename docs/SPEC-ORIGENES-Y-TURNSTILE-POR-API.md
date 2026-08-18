# Spec — allowlist de orígenes y hostnames de Turnstile sin deploy

> Responde a: *«¿los allowed web origins los podemos manejar por API en Cloudflare?»*
> Verificado el 2026-08-18 contra la API de Cloudflare y el código en `a3c0627`.
>
> **Validación CLI (2026-08-18, contra la API real):** el bug de truncado es REAL
> (`clean(…,1000)` en `worker/app.js:51`; la cadena ya mide **332** caracteres con 12
> orígenes). Y una **corrección importante** sobre el borrador original: nuestro widget
> `velai-web` es de tipo **`invisible`** (confirmado con `GET /challenges/widgets`) — el
> ejemplo del PUT decía `"mode":"managed"`, que habría CAMBIADO el tipo de widget y roto
> el challenge invisible en todas las webs. El body de abajo ya va corregido: en el PUT,
> `mode` debe reenviarse SIEMPRE como `"invisible"` (léelo del GET antes de escribir).

## Respuesta corta

Son **dos cosas distintas** y solo una merece ir por API:

| Qué | Hoy | Por API |
|---|---|---|
| `ALLOWED_WEB_ORIGINS` (var del Worker) | `wrangler.toml:25` + deploy | Se puede, pero **no lo recomiendo**: mejor sacarlo del var y llevarlo a D1 |
| Hostnames del widget de Turnstile | a mano en el dashboard | **Sí, y es donde más duele hoy**: `PUT /accounts/{id}/challenges/widgets/{sitekey}` |

---

## 1. La var del Worker: se puede, pero es la opción peor

`PATCH /accounts/{account_id}/workers/scripts/vai-worker/settings` permite actualizar los
`bindings` (incluidas las variables de texto plano) sin volver a subir el código. Dos razones para no
usarlo:

- **El array de `bindings` se sustituye, no se fusiona.** Hay que reenviar *todos* los bindings en
  cada llamada — `DB`, `KV` y los 12 secretos incluidos. Un olvido borra un binding en producción.
  (Con `keep_vars = true` en el toml, que ya está, los vars puestos fuera del toml sobreviven a
  `wrangler deploy`; el riesgo no es que se pierdan, es que el toml y la realidad divergen y nadie
  sabe cuál manda.)
- **No hace falta.** La lista de dominios de cliente es un dato de negocio: pertenece a la fila del
  tenant, no a la configuración del Worker.

## 2. Lo que sí propongo: la allowlist en D1

Hoy: `allowedOrigins(env)` (`worker/app.js:50`) parte `env.ALLOWED_WEB_ORIGINS` por comas. La usan
`publicCors` (`:56`), la comprobación de hostname de `verifyTurnstile` (`:116`) y `handleWidgetBoot`
(`:362`).

**Cambio propuesto**

1. `migrations/0008_tenant_origins.sql`: columna `web_origins TEXT` en `tenants` (JSON array de
   orígenes `https://host`, sin barra final), validada en `validateTenant` con la misma forma que
   `logo_url` (solo `https://`, sin path, ≤ 6 por tenant).
2. `allowedOrigins(env)` pasa a `async allowedOrigins(env)` = **los del entorno** (los nuestros:
   `hirevai.com`, `www`, `velai-dey.pages.dev`) **+** la unión de los `web_origins` de los tenants
   **activos**, con caché en KV 5 min bajo `origins:all`, invalidada por `invalidateTenantCache`.
   El var del entorno se queda como base: si D1 cae, nuestro propio sitio sigue funcionando.
3. Campo *Dominios de la web* en la sección Marca del panel. Alta de cliente = una fila, cero deploys.

**Bug latente que esto arregla de paso** 🔴

`clean(env.ALLOWED_WEB_ORIGINS, 1000)` **trunca a 1000 caracteres en silencio**. Hoy la cadena mide
**299** con 11 orígenes (≈27 por origen, 2 por cliente). Es decir: alrededor del **cliente número 15**
la lista se corta por la mitad de un dominio y el último cliente dado de alta deja de funcionar con
un `origin_not_allowed` que nadie va a relacionar con un límite de longitud. Con la lista en D1 el
tope desaparece; si se queda en el var, subir el `clean` a 4000 y **loggear si se alcanza**.

## 3. Turnstile por API: esto sí, ya

```
PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/challenges/widgets/{sitekey}
```

Body (**los tres primeros son obligatorios**):

```json
{
  "name": "velai-web",
  "mode": "invisible",
  "domains": ["hirevai.com", "www.hirevai.com", "zoetravelspain.com", "www.zoetravelspain.com", "..."],
  "bot_fight_mode": false,
  "offlabel": false
}
```

⚠️ **Es sustitución completa**: `domains` reemplaza la lista entera. Si envías solo el dominio nuevo,
**te quedas sin `hirevai.com`** y se cae el chat de nuestra propia web. Por eso la lista tiene que
reconstruirse desde D1 en cada llamada, nunca a mano.

⚠️ **Y `mode` también viaja entero**: es campo obligatorio del PUT y el nuestro es `invisible` —
enviar `managed` (el default de los ejemplos de la doc de Cloudflare) convierte el widget en
interactivo y rompe `execution:'execute'` en funnel.js y en el widget. Patrón seguro: `GET` del
widget → copiar `mode`/`bot_fight_mode`/`offlabel` → cambiar SOLO `domains` → `PUT`.

Token: *Account → Turnstile → Edit* (nuevo secret `CF_TURNSTILE_TOKEN` + `CF_ACCOUNT_ID`). `region` no
se puede cambiar después de crear el widget.

### Endpoint de aprovisionamiento (mismo patrón que el PR 6 de Twilio)

`POST /api/admin/tenants/:id/provision/domains`

1. Valida y escribe `web_origins` en D1 (fuente de verdad).
2. Reconstruye la lista completa de hostnames: los del entorno + los de **todos** los tenants activos.
3. `PUT` a Turnstile con esa lista.
4. Invalida la caché KV de orígenes.

Guardas heredadas del PR 6, que aquí aplican igual: cerrojo en KV (`provision:<tenantId>:domains`),
rate limit por actor, auditoría en `tenant_versions`, y **alerta a Telegram si el `PUT` a Turnstile
falla después de escribir en D1** — ese es el estado incoherente peligroso (el worker acepta el
origen pero Turnstile no emite token para ese hostname → *«No pude verificar que eres humano»*).
Bonus: un botón *Reconciliar* que compare lo que dice Turnstile (`GET` del widget) con lo que dice D1.

## 4. Alternativa: un widget de Turnstile por cliente

En vez de un widget con los hostnames de todos, crear uno por cliente en el alta y servir su
`turnstile_sitekey` desde `/widget/boot` (el widget ya soporta override por
`window.VELAI_TURNSTILE_SITEKEY`, así que el hueco existe).

- **A favor:** aislamiento real — el ruido o el abuso de un cliente no toca a los demás, y las
  métricas de Turnstile quedan por cliente.
- **En contra:** cada widget tiene **su propio secret**, así que `verifyTurnstile` tendría que
  descifrar el secret del tenant (ya existe la maquinaria: `crypto.js` + `SECRETS_KEK`) en vez de
  usar `TURNSTILE_SECRET_KEY`. Más piezas que mantener.

Para 4–10 clientes no hace falta. Lo dejaría anotado para cuando el volumen lo justifique.

## 5. Orden sugerido

1. `web_origins` en D1 + `allowedOrigins` con caché + campo en el panel *(quita el deploy del alta)*.
2. `provision/domains` con el `PUT` a Turnstile *(quita el paso manual del dashboard)*.
3. Botón de reconciliación D1 ↔ Turnstile.

Con 1 y 2, dar de alta la web de un cliente pasa a ser: rellenar la ficha en el panel y pulsar un
botón. Sin `wrangler deploy` y sin entrar a Cloudflare.
