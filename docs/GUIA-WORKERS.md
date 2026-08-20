# Guía del equipo — cómo crear y consumir Workers en Velai

> **Para quien implemente algo nuevo.** Esta es la arquitectura vigente desde 2026-08-17.
> La vieja (un `vai-worker.js` monolítico con CORS `*`, credenciales hardcodeadas, sin
> rate limit y `POST /` con JSON) está **retirada** — ese endpoint responde `410
> legacy_chat_retired` a propósito. No copies código de commits anteriores a `5dec33d`.

## 1. Qué NO hacer (arquitectura vieja)

- ❌ Toda la lógica en un solo archivo desplegado a mano sin `wrangler.toml`.
- ❌ `Access-Control-Allow-Origin: '*'` o allowlist hardcodeada en el código.
- ❌ Teléfonos, chat_ids o destinatarios hardcodeados (el repo es público).
- ❌ Endpoints públicos de escritura sin Turnstile ni rate limit.
- ❌ El cliente enviando el historial completo del chat (podía inyectar turnos falsos).
- ❌ `fetch` a APIs externas sin timeout ni reintento.

## 2. Estructura de un Worker (patrón vigente)

```
vai-worker.js        entrypoint: SOLO configuración/prompts + createWorker(config)
worker/app.js        lógica: helpers, handlers, router, scheduled, export testing
worker/admin-page.js ensamblador de la UI embebida: HTML+CSS en template string +
                     nonce CSP; el JS del panel se interpola como IIFE serializada
worker/admin-panel.js el JS del panel como FUNCIÓN REAL (panelApp): node --check y
                     los tests lo validan; autocontenida, solo APIs del navegador
worker/calendar.js   proveedor Google Calendar + freeSlots puro + CALENDAR_TOOLS
                     (SPEC-CALENDARIO); no toca D1/KV — eso vive en app.js
wrangler.toml        config declarativa (única fuente de verdad de bindings)
migrations/          esquema D1 (NNNN_nombre.sql, aditivas, sin PRAGMA)
test/                node --test contra el export `testing` y el router
```

Convenciones dentro de `worker/app.js` (reutilízalas, no las reinventes):

- **`HttpError(status, code)`** + try/catch central en el router: todos los errores
  salen como `{ok:false, error:"<código>"}` y se loguean con código/status/cf-ray,
  **nunca con PII** (ni mensajes, ni teléfonos, ni nombres).
- **`clean(value, max)`** para TODO input de usuario antes de usarlo.
- **Lookups seguros**: nunca `objeto[claveDelUsuario]` a pelo — usa
  `Object.prototype.hasOwnProperty.call(...)` (ver `isDemoKey`); `"constructor"` y
  `"__proto__"` son claves válidas para un atacante.
- **`callAnthropic(env, payload, options)`**: por defecto timeout 15 s + 1 reintento
  en 429/5xx. EXCEPCIÓN: el webhook de Twilio pasa `{retries:0, timeoutMs:10000}` —
  Twilio corta a ~15 s y reintenta el webhook entero, así que reintentar dentro
  garantizaba perder la respuesta y pagar el mensaje dos veces (hay dedupe por
  `MessageSid` además). `options.tenant` activa el cupo de IA por tenant.
  Cualquier fetch externo lleva `AbortSignal.timeout(...)`.
- **Export `testing`** con los helpers puros para que `test/worker.test.js` los cubra.

## 3. `wrangler.toml` — plantilla mínima obligatoria

```toml
name = "mi-worker"
main = "mi-worker.js"
compatibility_date = "2026-04-14"
keep_vars = true          # SIN esto, cada deploy BORRA las vars puestas en el dashboard
workers_dev = true        # SIN esto, declarar `routes` apaga la URL workers.dev

# routes = [ { pattern = "algo.hirevai.com", custom_domain = true } ]

[vars]                    # SOLO valores no sensibles (el toml es público)
ALLOWED_WEB_ORIGINS = "https://hirevai.com,https://www.hirevai.com,https://velai-dey.pages.dev"

[[kv_namespaces]]         # declarar SIEMPRE los bindings existentes:
binding = "KV"            # un deploy sin ellos LOS ELIMINA del worker
id = "..."
```

**Secrets** (API keys, tokens, chat_ids): `npx wrangler secret put NOMBRE` — nunca en
el toml ni en el código. Los secrets sobreviven a los deploys; las vars del dashboard
solo si `keep_vars = true`. Documenta cada variable nueva en `.dev.vars.example`.

## 4. Seguridad de serie en todo endpoint nuevo

| Qué | Cómo (ya implementado, reutilizar) |
|---|---|
| CORS | `publicCors(request, env)` — allowlist EXACTA desde `ALLOWED_WEB_ORIGINS`; sin comodines. Origen nuevo (p. ej. un preview de rama) = añadirlo a la var **y** al widget Turnstile |
| Antiabuso | `verifyTurnstile(env, token, request, '<action>')` en endpoints públicos que escriben; la `action` del cliente y del servidor deben coincidir |
| Rate limit | `rateLimited(env, ip, '<bucket>', N)` (KV, ventana 60 s, fail-open) |
| Webhooks | Validar firma (ver `validTwilioSignature`: HMAC en tiempo constante) |
| WhatsApp saliente | Mensaje iniciado por el negocio = SIEMPRE plantilla aprobada (`ContentSid` + `ContentVariables` vía `templateVar`); texto libre fuera de la ventana de 24 h falla con 63016 |
| Rutas admin | Solo en el hostname de `ADMIN_ORIGIN` + JWT de Cloudflare Access verificado (firma JWKS, `iss`, `aud`, `exp`, `alg`) — ver `adminIdentity` |
| Datos | Payload limitado (`readJson(request, maxBytes)`), campos con `clean()`, SQL SIEMPRE con `prepare().bind()` |

## 4b. Multi-tenant

La config por cliente es un DATO (tabla `tenants` en D1, cacheada en KV 5 min), nunca
código. La excepción deliberada: los **guardrails antiinyección van en código**
(`GUARDRAILS` + `systemFor`) y se concatenan siempre — editar una fila no puede
degradar la seguridad de nadie. Todo estado por conversación/lead se namespacea por
`tenant.id` (historiales, marcas KV, `request_id`); sin eso dos clientes con el mismo
usuario final se pisan. Alta de clientes: `docs/OPERATIONS.md` §Multi-tenant.

## 5. Persistencia y resiliencia

- **D1 = fuente de verdad**; **KV** = estado efímero con TTL (historiales, rate limit,
  colas). Migraciones en `migrations/`, aditivas, aplicadas con
  `npx wrangler d1 migrations apply <db> --remote`.
- **Nada crítico depende de un solo sistema**: el patrón de leads es
  D1 → si falla, aviso directo + cola en KV (TTL 7 días) → el cron re-inserta
  (`storeLead` / `drainQueuedLeads`). La respuesta declara la garantía:
  `{stored: "d1"|"kv"|"notification", degraded?}`.
- **Trabajo diferido**: `ctx.waitUntil(promesa.catch(...))` — siempre con `.catch`.
  Tareas periódicas en `scheduled()` (cron en `[triggers]` del toml).
- **Idempotencia**: toda escritura reintenta-ble lleva un `request_id` único
  (UNIQUE en D1) para que los reintentos no dupliquen.

## 6. Cómo se CONSUME un worker desde el frontend

- La URL base va **inline en el HTML** (`window.VELAI_WORKER`), nunca hardcodeada en
  los `.js` de assets sin fallback. Config variable inline; lógica en `.js` con `?v=N`
  (los assets son `immutable` 1 año por `_headers` → **sube el `?v=` en cada cambio**).
- **Contrato de respuesta**: `2xx` con `{ok:true, ...}`; error `{ok:false, error:"código"}`.
  El cliente decide el mensaje según el código (`rate_limited`, `human_verification_*`…),
  no muestra el error crudo.
- **Turnstile en cliente**: `window.VELAI_HUMAN.execute('<action>')` (de `funnel.js`)
  devuelve el token a enviar como `turnstileToken`. Ante `403 human_verification_required`,
  pedir token nuevo y reintentar UNA vez (ver `postChat` en `vai-widget.js`).
- **`requestId`**: genera un UUID por operación (`window.VELAI_UUID()`) y **reúsalo en
  los reintentos** — el worker deduplica.
- **La UX nunca depende del backend** para resultados calculables en local (patrón de
  los quizzes: pintar resultado ya, enviar en segundo plano con estado propio y reintento).

## 7. Ciclo de desarrollo y deploy

```bash
cp .dev.vars.example .dev.vars   # NUNCA se commitea (.gitignore)
npx wrangler dev                 # worker local :8787 con D1/KV locales
npm run check                    # sintaxis + validación del sitio + tests — SIEMPRE antes de push
npx wrangler deploy              # manual; Pages se despliega solo al push a main
```

- **Orden**: si un cambio rompe compatibilidad de API, primero el Worker, inmediatamente
  después el push del sitio (Pages auto-despliega). No dejar hueco entre ambos.
- Tras el deploy: probar el flujo real, revisar que los triggers (cron/domains) siguen
  listados en la salida de wrangler, y mirar los logs (`npx wrangler tail`) — recuerda:
  logs con códigos, no con datos.
- CI (`.github/workflows/ci.yml`) corre `npm run check` en cada push; los marcadores
  `REPLACE_WITH_*` bloquean el check (escape solo en ramas: `CHECK_ALLOW_PLACEHOLDERS=1`).

## 8. Checklist para un endpoint nuevo

- [ ] Handler en `worker/app.js` con `HttpError` y ruta en el router
- [ ] CORS (`publicCors`) o guard de admin, según el caso
- [ ] Turnstile + rate limit si es público y escribe
- [ ] Inputs con `clean()`/validación, SQL parametrizado, sin PII en logs
- [ ] Idempotencia si hay reintentos (requestId/UNIQUE)
- [ ] Timeout en todo fetch externo; `waitUntil` con `.catch`
- [ ] Test en `test/worker.test.js` (mínimo: caso feliz del router + un rechazo)
- [ ] Variable nueva → `.dev.vars.example` + `docs/OPERATIONS.md`; secret → `wrangler secret put`
- [ ] `npm run check` verde → deploy → verificación en producción
