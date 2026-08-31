# Operaciones — leads y panel de Velai

> **Estado (2026-08-17): TODO EN PRODUCCIÓN.** D1 `vai-leads` creada y migrada, widget
> Turnstile invisible activo (sitekey en los 26 HTML), secrets cargados, Worker
> desplegado con cron, panel en `admin.hirevai.com` tras Access, y avisos de Telegram
> verificados end-to-end (lead real → D1 → Telegram). Los pasos de abajo quedan como
> referencia para recrear el entorno. `TEAM_WHATSAPP`, `TWILIO_FROM` y la plantilla
> también están configurados (el aviso de WhatsApp sale por plantilla). **Pendiente**:
> el riesgo legal del final.

## Recursos Cloudflare (orden de puesta en marcha — ya ejecutado)

1. Crear la base: `npx wrangler d1 create vai-leads`. *(Hecha: id `4b3056eb-6dee-44a4-8d17-5a80af740ca5`.)*
2. Copiar el UUID a `wrangler.toml` y ejecutar `npx wrangler d1 migrations apply vai-leads --remote`.
3. Crear un widget Turnstile de **tipo Invisible** (el tipo se elige en el dashboard; el código usa `execution:'execute'`) con los hostnames `hirevai.com`, `www.hirevai.com` **y** `velai-dey.pages.dev`. *(Hecho: widget `velai-web`.)*
4. Sustituir `REPLACE_WITH_TURNSTILE_SITE_KEY` en los 26 HTML por la site key pública. `npm run check` falla mientras quede algún marcador (en CI de ramas puede saltarse con `CHECK_ALLOW_PLACEHOLDERS=1`; el deploy real nunca). *(Hecho.)*
5. Guardar `TURNSTILE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `TELEGRAM_TOKEN`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TELEGRAM_CHAT_ID` como secrets (`npx wrangler secret put <NOMBRE>`). *(Hechos.)*
6. Configurar `TEAM_WHATSAPP`, `TWILIO_FROM` y `TWILIO_LEAD_TEMPLATE_SID` (formato `whatsapp:+E164`; el SID es de la plantilla aprobada `velai_nuevo_lead`). *(Hechos.)* **El aviso por WhatsApp va SIEMPRE por plantilla** (`ContentSid`) — texto libre fuera de la ventana de 24 h devuelve `Undelivered 63016`, que es lo que tuvo el canal roto desde junio (ver `docs/IMPLEMENTADO.md` §FASE0). Pendiente: duplicar la plantilla en categoría **Utility** y actualizar el SID.
7. Desplegar el Worker: **automático desde 2026-08-20** — el push a `main` que toque
   `vai-worker.js`, `worker/**`, `migrations/**`, `wrangler.toml`, `test/**` o
   `package.json` dispara `.github/workflows/deploy-worker.yml`, que corre los checks,
   aplica las migraciones D1 (**antes** del deploy, ver §esquema) y hace `wrangler deploy`
   con smoke test del preflight de `/chat`. Requiere el secret de GitHub Actions
   `CLOUDFLARE_API_TOKEN` (permisos mínimos: Workers Scripts Edit + D1 Edit +
   Workers Routes Edit en la zona `hirevai.com`; NO es el `CF_API_TOKEN` del worker).
   El deploy manual `npx wrangler deploy` sigue funcionando como respaldo.
   **Caveat**: Pages y este workflow corren en paralelo — para cambios de contrato
   worker↔frontend sigue valiendo la disciplina de dos commits (primero worker, luego sitio).
   Verificar en **Workers → vai-worker → Settings → Triggers** que el cron `*/5 * * * *` sigue registrado. *(Hecho.)*

No desplegar con el UUID D1 de ceros ni con el marcador de Turnstile. **No quitar de `wrangler.toml` los bindings `KV` y `DB`**: un deploy sin ellos los elimina del Worker (sin `KV`, `/chat` responde 503 y el rate limit se desactiva).

### Lecciones aprendidas del primer deploy (no repetir)

- **`keep_vars = true` es obligatorio**: sin él, cada `wrangler deploy` borra las
  variables puestas a mano en el dashboard (así se perdió `TELEGRAM_CHAT_ID` y los
  avisos quedaron en `skipped`). Las credenciales van como **secrets**, que nunca se pisan.
- **Declarar `routes` desactiva `workers.dev`** salvo `workers_dev = true` explícito —
  y todo el frontend llama a `vai-worker.botnexo-ia.workers.dev`. Ambas líneas ya
  están en `wrangler.toml` con su comentario.
- **El webhook GitHub→Pages a veces pierde pushes** (pasó el 2026-08-17: dos pushes
  seguidos sin build). Si `wrangler pages deployment list` no muestra el commit,
  forzar por API: `POST /accounts/<acc>/pages/projects/velai/deployments` con
  `branch=main` (equivale al botón "Create deployment" del dashboard).
- **Nunca pedir una URL versionada (`?v=N`) antes de que su deployment esté activo**:
  Pages sirve el contenido viejo con `immutable` 1 año y el CDN la envenena para
  siempre (sin permiso de purga, la única salida es quemar la versión y saltar a
  `?v=N+1` — así se perdió `funnel.js?v=6`). Para esperar un deploy, consultar el
  ESTADO del deployment por API, no la URL del asset.

### Orden de despliegue Pages ↔ Worker

Pages despliega **automáticamente** al hacer push a `main`; el Worker se despliega **a mano** con wrangler. El `POST /` JSON antiguo devuelve 410, así que el HTML/JS nuevo y el Worker nuevo deben ir juntos: primero deja el Worker listo (pasos 1–7), después mergea el sitio. Los previews de rama (`https://<rama>.velai-dey.pages.dev`) solo funcionan contra el Worker si su origen exacto está en `ALLOWED_WEB_ORIGINS` (`wrangler.toml`) **y** en los hostnames del widget Turnstile — no hay comodín `*.pages.dev` a propósito.

## Panel administrativo — OPERATIVO en `admin.hirevai.com`

Cómo quedó montado (referencia para recrearlo):

1. `admin.hirevai.com` es dominio personalizado del Worker (declarado en `routes` de `wrangler.toml`). El hostname del panel se deriva de `ADMIN_ORIGIN`; si se cambia de dominio, basta cambiar esa variable.
2. Aplicación self-hosted "Velai Leads Panel" en Cloudflare Access para ese hostname (Zero Trust → Access → Applications).
3. One-time PIN y política Allow limitada a los emails del equipo.
4. `TEAM_DOMAIN` (`https://silent-pond-acd1.cloudflareaccess.com`) y `POLICY_AUD` cargados como secrets del Worker. Truco: ambos se pueden leer de la URL de redirección del login de Access — el parámetro `kid` es el AUD.
5. Verificado: sesión anónima → 302 al login de Access; el Worker rechaza JWT ausentes o inválidos (firma vía JWKS, `iss`, `aud`, `exp` y `alg`); el panel y su API solo responden en el hostname de `ADMIN_ORIGIN`, así que en `*.workers.dev` no están expuestos (404).

## Entrega y recuperación

- D1 confirma el lead antes de responder éxito al navegador. **Si D1 cae, el lead no se pierde**: se envía el aviso directo a Telegram/WhatsApp, se encola en KV (TTL 7 días) y el cron lo re-inserta en D1 cuando vuelve. La respuesta indica la garantía: `stored: "d1" | "kv" | "notification"` con `degraded: true` en contingencia — si aparece en logs (`lead_d1_fallback`, `lead_degraded`), revisar el estado de D1.
- Telegram y WhatsApp son avisos secundarios. El cron (cada 5 min) reintenta fallos hasta cinco veces; un canal sin configurar queda en `skipped` y se revisita cada 6 h, así que al configurarlo el aviso sale solo.
- El chat web y el **WhatsApp entrante** también capturan leads: en WhatsApp el teléfono es el `From` de Twilio, una sola vez por remitente, cuando la conversación muestra intención comercial.
- El panel permite cambiar estado, anotar, reintentar avisos, exportar CSV y eliminar solicitudes RGPD.
- Los leads se eliminan 24 meses después de la última actividad (`LEAD_RETENTION_MONTHS`).
- Los logs usan IDs y códigos de error, nunca contenido del chat ni teléfonos.

## Desarrollo local

```bash
cp .dev.vars.example .dev.vars   # nunca commitear .dev.vars (está en .gitignore)
npx wrangler dev                 # worker local en :8787 con D1/KV locales
python3 -m http.server 8080      # sitio estático
```

La test key de Turnstile del example siempre valida. `ALLOWED_WEB_ORIGINS` del `.dev.vars` debe incluir el origen del servidor estático.

## Staging — el ensayo antes de producción (2026-08-31)

Copia completa e independiente del backend: **su propio worker, su propia D1, su propio
KV y ningún cliente detrás**. Existe porque hasta ahora la primera ejecución real de
cualquier cambio era en producción — los tests corren contra mocks y
`d1 migrations apply --remote` iba directo a la base con los leads y las conversaciones
de los clientes. Los tres parches que costó ese agujero (`check-bundle.mjs`,
`render-panel.mjs` y el `try/catch` de `resolveScope`) son el mismo problema visto tres veces.

| | Producción | Staging |
|---|---|---|
| Worker | `vai-worker` | `vai-worker-staging` |
| URL | `api.hirevai.com` | `vai-worker-staging.botnexo-ia.workers.dev` |
| Panel | `admin.hirevai.com` | `admin-staging.hirevai.com` |
| D1 | `vai-leads` | `vai-leads-staging` |
| KV | `14fbc395…` | `d522cc2e…` |
| Cron | cada 1 y 5 min | **ninguno** (cuota de listados de KV) |
| Tope IA | 2.000/día | 100/día |
| App de Access | `admin` · aud `d5ea5814…` | `admin staging` · aud `29b2c9b0…` |

**Se despliega solo.** `deploy-worker.yml` en cada push a `main` hace:
migraciones y deploy en staging → prueba de humo → migraciones y deploy en producción.
Si algo de staging falla, producción ni se roza. A mano:

```bash
npx wrangler@4 d1 migrations apply vai-leads-staging --remote --env staging
npx wrangler@4 deploy --env staging
npx wrangler@4 d1 execute vai-leads-staging --remote --env staging --file seed/seed-staging.sql
```

### Tres reglas que no se rompen

1. **En staging no entran datos reales de clientes.** Ni una copia «solo para probar»: un
   entorno con menos protecciones y las mismas fichas de contacto es un problema de RGPD.
   `seed/seed-staging.sql` siembra tenants inventados y borra hasta los teléfonos del
   equipo que trae la migración 0002.
2. **`CF_ACCESS_GROUP_ID` y `CF_ADMIN_GROUP_ID` se quedan VACÍOS en staging.** Con valor,
   gestionar usuarios desde el panel de staging reescribiría quién entra en el panel de los
   clientes reales. Vacíos, `syncPanelGate`/`syncAdminGate` devuelven `'manual'` y no
   llaman a la API de Access (`worker/app.js:2540`).
3. **`[env.staging]` declara sus `routes` explícitamente.** Wrangler HEREDA `routes` del
   bloque raíz: sin esa línea, un `deploy --env staging` reclamaría `admin.hirevai.com` y
   `api.hirevai.com` y serviría a los clientes desde staging.

`npm run check:entornos` verifica las tres en cada `npm run check`, y además que las
variables de los dos entornos no se desincronicen (wrangler no hereda `vars`: hay que
repetirlas, y lo que se repite a mano se pudre solo).

### Acceso al panel de staging (configurado el 2026-08-31)

App de Access **propia**, separada de la de producción: si alguien toca la de staging, la
de los clientes no se entera.

| | |
|---|---|
| App | `admin staging` · uid `62210de3-95e9-43f1-b5d2-e8db13251fe5` |
| Dominio | `admin-staging.hirevai.com` · sesión 24 h · self-hosted |
| `POLICY_AUD` | `29b2c9b0f5d8f686c9b48a87b0ffa511a39abb2b9f4475953e71e354cac260ed` |
| `TEAM_DOMAIN` | `https://silent-pond-acd1.cloudflareaccess.com` |
| Política | `Staging Velai` (allow, **no reutilizable**): `botnexo.ia@gmail.com` y `botnexo.ia+cliente@gmail.com` |

El alias `+cliente` llega al mismo buzón (así recibes su OTP) pero es una cadena distinta
de `ADMIN_EMAILS`, así que `resolveScope` lo resuelve como **rol cliente** del tenant
`demo-staging`. Es la forma de ver el panel como lo ve un cliente, sin inventar buzones.

Ninguna de las políticas de staging usa los **grupos** de Access de producción, y sus ids
siguen vacíos en `[env.staging.vars]` — ver regla 2 arriba.

**Secrets ya puestos** en el worker de staging: `TEAM_DOMAIN`, `POLICY_AUD`,
`TURNSTILE_SECRET_KEY` (la de prueba) y `SECRETS_KEK` (generada aparte, distinta de la de
producción). Twilio y Telegram se quedan SIN credenciales a propósito: así una prueba en
staging no puede mandarle un WhatsApp de verdad a un cliente de verdad. El código ya
degrada solo cuando faltan (`deliver` devuelve `skipped`).

- [ ] **Falta `ANTHROPIC_API_KEY`** — sin ella `POST /chat` responde `503 ai_not_configured`
      (todo lo anterior del camino sí funciona). Poner una clave propia, no la de producción:
      ```bash
      npx wrangler@4 secret put ANTHROPIC_API_KEY --env staging
      ```
      El tope de staging son 100 llamadas/día (`AI_DAILY_LIMIT`), ~0,60 $ en el peor caso.

### Ojo con `secret put` desde que hay dos entornos

Con un `[env.staging]` en el fichero, wrangler AVISA si no se dice a qué entorno va el
secret. No falla —usa el entorno raíz, o sea producción— pero conviene ser explícito:

```bash
npx wrangler@4 secret put NOMBRE --env=""        # producción
npx wrangler@4 secret put NOMBRE --env staging   # staging
```

Los secrets se aplican **al momento**, sin desplegar. (Si un secret recién puesto parece
no llegar al código, el redeploy no es la solución: casi siempre es que el valor subió
vacío — el prompt oculta lo que se teclea y acepta una línea en blanco sin quejarse.)

### Dos trampas de staging que cuestan una tarde

1. **Turnstile y `example.com`.** La clave de PRUEBA emite tokens con
   `hostname: "example.com"`, y `verifyTurnstile` rechaza todo token cuyo hostname no esté
   en `ALLOWED_WEB_ORIGINS` (`worker/app.js:168`). Por eso staging lleva `example.com` en su
   lista y producción no. Sin esa entrada, `POST /chat` da `403 human_verification_failed`
   siempre y parece un fallo del chat cuando es de la configuración.
2. **La lista de orígenes se cachea en KV 5 minutos** (`origins:all`). Tras cambiar
   `ALLOWED_WEB_ORIGINS` el worker sigue con la lista vieja hasta que expira. Para no
   esperar:
   ```bash
   npx wrangler@4 kv key delete --namespace-id d522cc2ef3f54e1f91a35dc90d0df1bc "origins:all" --remote
   ```

## Validación y rollback

Ejecutar `npm run check` antes de desplegar (sintaxis JS, validación de las 26 páginas, marcadores sin sustituir y tests del Worker). Después, enviar un lead de prueba y verificar D1, Telegram, WhatsApp y el panel; comprobar que la respuesta fue `stored: "d1"` sin `degraded`. Para rollback, conservar D1 y volver a la versión anterior del Worker/Pages; la migración es aditiva y no debe revertirse destruyendo datos.

## Multi-tenant: alta de un cliente

El Worker es multi-tenant (Fase 1 — ver `docs/IMPLEMENTADO.md`): un despliegue, N clientes,
enrutado por el `To` de Twilio. Para dar de alta un cliente:

1. **Desde el panel** (`admin.hirevai.com` → pestaña Clientes → "Nuevo cliente", Fase 2):
   canal (`whatsapp:+E164` o `messenger:<pageId>`), canales de aviso y `system_prompt` de
   negocio (los guardrails antiinyección los pone el código, no la fila). El botón
   "Duplicar de…" copia el contexto de otro cliente; "Probar" ejecuta el borrador sin
   guardar; cada guardado queda versionado con rollback del prompt. Un tenant nunca se
   borra: solo se desactiva.
2. Copia versionada del prompt en `tenants/<slug>.md` (patrón de `tenants/velai.md`).
3. En Twilio: sender bajo la misma WABA, display name del cliente, plantilla
   `nuevo_lead_<cliente>` en categoría **Utility**, webhook apuntando al mismo Worker.
4. Para su widget web: script inline `window.VELAI_TENANT = '<slug>'` **antes** del
   `<script src=…vai-widget.js>` en su página (el widget lo adjunta al payload), su
   dominio en `ALLOWED_WEB_ORIGINS` (wrangler.toml →
   requiere deploy del Worker) **y** en los hostnames del widget de Turnstile.
5. WhatsApp con WABA del cliente: subcuenta de Twilio por cliente (Twilio solo admite
   1 WABA por cuenta/subcuenta). El **auth token de la subcuenta** se pega en el panel
   (write-only) y se guarda **cifrado** en D1 con `SECRETS_KEK` (AES-256-GCM, AAD por
   tenant). La firma del webhook se valida con el token de la cuenta que envía — el del
   padre nunca respalda a una subcuenta. Runbook completo: `docs/ALTACLIENTE.md`.

### Rotación de `SECRETS_KEK`

1. `openssl rand -base64 32` → `npx wrangler secret put SECRETS_KEK` (la nueva).
2. La anterior a `SECRETS_KEK_OLD` (`wrangler secret put`): el descifrado prueba ambas.
3. Re-guardar el token de cada tenant desde el panel (re-cifra con la nueva) y borrar
   `SECRETS_KEK_OLD`.

**Las tres formas de `channel_address`:** `whatsapp:+E164` / `messenger:<pageId>` (enrutables
por el webhook de Twilio), `web:<slug>` (cliente solo-web: activable, atiende por el chat de
su página vía `window.VELAI_TENANT`, el webhook la rechaza con 400 antes de tocar D1) y
`pending:<slug>` (prospecto: no activable). Para un cliente solo-web, el aviso de leads
recomendado es **Telegram con su `telegram_chat_id`**: sin subcuenta propia, el respaldo de
WhatsApp saldría con la plantilla de Velai ("Nuevo lead – Velai"); si se usa igualmente,
es un comportamiento consciente del piloto.

Un mensaje entrante a un sender sin fila responde `404 unknown_tenant` y avisa a Telegram
(antirebote 1 h). El caché de tenants es de 5 min: un `UPDATE` tarda eso en verse.
**Orden en cambios de esquema: migración D1 primero, deploy del Worker después.**

## Usuarios del panel y handoff

**Dar de alta a un usuario de CLIENTE se hace desde el panel** (SPEC-USUARIOS §B): ficha del
cliente → sección "Usuarios del panel" → añadir su correo. La fila en `tenant_users` surte
efecto inmediato (sin caché); quitarla revoca de verdad. Choques: `409 email_taken` (un
correo pertenece a UN cliente) y `400 email_is_admin` (un admin de Velai no puede degradarse
a un tenant). Cada alta/baja queda auditada en `tenant_versions` (field `users`, con rol).

**Modelo de cerraduras (desde 2026-08-18, dos cerraduras automáticas):** Access
**autentica y filtra** — el login ofrece One-time PIN (IdP creado por API) y la app
`admin.hirevai.com` tiene tres políticas: «Equipo Velai» (reutilizable, del dashboard:
los admins RAÍZ del toml — el worker no puede ni quiere editarla), «Admins Velai» y
«Clientes Velai» (dos grupos de Access que **el propio panel reescribe desde D1 en cada
alta/baja**, vía `CF_API_TOKEN` — solo los correos dados de alta pasan la puerta). El
worker **autoriza** (`resolveScope`: `ADMIN_EMAILS` → `admin_users` → `tenant_users`;
sin coincidencia → 403).

**Admins de Velai**: se gestionan desde la pestaña Clientes → «Admins de Velai» (fila en
`admin_users` + grupo de Access, todo en un clic; aviso 👑 a Telegram). Los del toml son
raíz: no se pueden quitar desde el panel y van SIEMPRE incluidos en cada escritura del
grupo. **Configuración (solo raíz)**: estado en vivo de las integraciones y rotación
write-only del `CF_API_TOKEN` (validado contra Cloudflare antes de guardarse, cifrado
con la KEK en `settings`; prioridad sobre el secret del worker, «Volver al secret»
deshace). Copia local del token en `.dev.vars` (gitignorado).
Si el PUT del grupo falla tras escribir en D1, el toast lo dice (`gate: pendiente`), se
loguea `access_group_desync` y llega alerta a Telegram — repetir cualquier alta/baja
resincroniza (la lista se reescribe entera desde D1). Defensas del worker que siguen
activas: cada 403 se registra CON el correo (`not_authorized`), a la 3ª en una hora sale
alerta, y el camino de administración tiene rate limit por correo (120/min). El botón
**Salir** del panel cierra la sesión de Access (`/cdn-cgi/access/logout`).

Los **admins de Velai** van en `ADMIN_EMAILS` (wrangler.toml), nunca en la tabla — quien
edita `tenant_users` desde el panel no debe poder ascenderse a admin. Un cliente
ve SOLO sus leads (aislamiento validado por tests de fuga), puede cambiar estado y anotar,
y no puede reintentar avisos, borrar, ni ver nada de otros tenants.

**Handoff a humano:** si el cliente final pide hablar con una persona, el bot confirma, avisa
a Telegram y se pausa 4 h para esa conversación (clave `pause:<tenant>:<from>` en KV). Las
escaladas activas se ven en el panel como chips ⏸ con botón "Reanudar bot". Mientras no haya
bandeja, el equipo del cliente responde desde SU WhatsApp (número distinto al del bot).

## Alertas operativas

Automáticas (llegan al Telegram del equipo, con antirebote de 1 h):

- **`lead_d1_fallback` / `lead_d1_misconfigured`** — D1 caída o binding roto; los leads van a la cola KV. Revisar el binding DB y el estado de D1; el cron re-inserta al volver.
- **`ai_budget_exhausted`** — se agotó el techo diario GLOBAL de llamadas al modelo (`AI_DAILY_LIMIT`, hoy 1000). El chat responde 429 hasta medianoche UTC; si es tráfico legítimo, subir la variable y redeploy.
- **`ai_tenant_budget_exhausted`** — UN tenant agotó su cupo diario (`tenants.ai_daily_limit`, o `AI_TENANT_DAILY_LIMIT`=300 por defecto). Solo sus canales responden 429; los demás siguen. La alerta de Telegram nombra al tenant. Si es tráfico legítimo, subir su `ai_daily_limit` por SQL — aplica en ≤5 min (caché de tenants), sin deploy.
- **`twilio_duplicate_ignored`** — Twilio reintentó un webhook ya procesado (mismo `MessageSid`); se respondió TwiML vacío sin llamar al modelo. Es el comportamiento esperado, no un error.

A vigilar a mano (en Workers Logs / panel / GA4) hasta tener alerting externo:

- `chat_error` > 5% de los `chat_message` (GA4) → mirar logs del worker.
- Filas `failed` acumulándose en `lead_notifications` (panel, filtro de avisos) → revisar Twilio Monitor / Telegram.
- Crecimiento de claves `leadq:*` en KV → D1 lleva rato caída.
- Respuestas 429/5xx sostenidas en los logs → rate limits o Anthropic.

## Riesgo legal pendiente

La web identifica por ahora únicamente el nombre comercial Velai. **No activar campañas de pago** hasta validar con asesoría y publicar el titular, NIF y domicilio que correspondan conforme al artículo 10 de la LSSI (las plataformas de anuncios exigen además una política de privacidad válida). El derecho de supresión ya es operativo: solicitudes a `privacidad@hirevai.com` se atienden con el botón «Borrar lead» del panel.

## Telegram en autoservicio (SPEC-CONEXIONES PR1, 2026-08-21)

- El webhook del bot se registra desde el panel (Conexiones → «Registrar webhook», solo
  Velai): llama a `setWebhook` con `TELEGRAM_WEBHOOK_SECRET` (secret del worker) apuntando
  a `<worker>/telegram/webhook`. **Con el webhook activo, `getUpdates` DEJA de funcionar**
  para ese bot: los chat ids ya no se leen a mano — cada cliente se vincula con su enlace
  de un solo uso desde su pestaña Conexiones.
- **El secreto solo admite `A-Z a-z 0-9 _ -`** (1-256). Un `openssl rand -base64 32` mete
  `+`, `/` y `=` y Telegram rechaza el `setWebhook` ENTERO con un 400 genérico — tuvo la
  vinculación de todos los clientes muerta del 21 al 31 de agosto. Generarlo siempre con
  `openssl rand -hex 32`. `telegramSetWebhook` ya lo comprueba antes de gastar la llamada.
- **Para mirar sin romper: Configuración → «Webhook de Telegram» → Comprobar** (solo admins
  raíz). Llama a `getWebhookInfo`, que es de solo lectura, y enseña cuatro cosas:
  - la **URL registrada** y si coincide con la del worker — un webhook apuntando a otro
    sitio está «activo» y no entrega nada, y desde fuera se ve igual que uno sano;
  - **cuántas actualizaciones hay en cola** (si suben, Telegram no consigue entregarlas);
  - **`last_error_message`**: qué falló en el último intento. Es el campo que habría
    resuelto el incidente de agosto en dos minutos;
  - la IP desde la que entrega Telegram.

  Existe porque la alternativa era `getUpdates`, y esa exige `deleteWebhook` — o sea dejar
  a TODOS los clientes sin poder vincular para depurar a uno. `getWebhookInfo` no toca nada
  y no devuelve el `secret_token`.
- Avisos de lead por Telegram: entrega DUAL — al chat del cliente (sin chat propio =
  `skipped: telegram_not_configured`, visible en el ledger) y SIEMPRE una copia operativa
  al `TELEGRAM_CHAT_ID` de Velai, deduplicada por lead (`opsping:` en KV, 30 días). El
  fallback silencioso al chat de Velai devolviendo ok:true está cerrado por test.
- El username del bot se descubre con `getMe` (caché KV `tg:botuser`, 1 día): si se cambia
  el bot (nuevo `TELEGRAM_TOKEN`), borrar esa clave o esperar el TTL, y re-registrar el webhook.
