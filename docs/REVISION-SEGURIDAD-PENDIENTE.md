# Revisión de seguridad pendiente de validación

> **Resolución (2026-08-17, validada por Juanes):**
>
> | # | Punto | Estado |
> |---|---|---|
> | 1 | Hostname de Turnstile | ✅ **Aceptado e implementado** — `verifyTurnstile` valida `result.hostname` contra los hostnames de `ALLOWED_WEB_ORIGINS` (+ localhost en dev), con test |
> | 2 | Límites de coste/abuso | 🟡 **Parcial** — implementados en el worker: límite por `conversationId` (20/min) y presupuesto diario global de IA (`AI_DAILY_LIMIT`, 429 + alerta a Telegram con antirebote). Las reglas WAF/Rate Limiting de borde quedan como paso manual del dashboard (pendiente) |
> | 3 | Auditoría de la política de Access | ⬜ **Manual pendiente** (ver TAREAS-PENDIENTES) |
> | 4 | Cabeceras del sitio | ✅ **Ya cubierto** en `_headers` (nosniff, XFO, Referrer/Permissions-Policy, HSTS preload, COOP y CSP base con frame-ancestors). Pendiente: CSP completa de recursos, empezar en Report-Only |
> | 5 | `no-store` en admin | ✅ **Implementado** en todas las respuestas de `/api/admin/*` |
> | 6 | JWT malformado → 401 | ✅ **Ya cubierto** (hallazgo 14 de REVISION-2026-08-17, con test) |
> | 7 | Content-Type 415 | ✅ **Implementado** en `readJson` (todas las rutas JSON), con test |
> | 8 | Retención escalonada | ⬜ **Decisión negocio/legal** — hoy 24 meses renovados por actividad; validar con asesoría |
> | 9 | Configurar cookies | ✅ **Implementado** — `window.VELAI_openConsent()` + enlace «Configurar cookies» en /privacidad/ |
> | 10 | Promesas de canales | ⬜ **Decisión de negocio** — el usuario decidió mantener Instagram en el prompt por ahora |
> | 11 | Más pruebas | 🟡 **Parcial** — añadidos Turnstile (hostname/action), 415, 413; suite en 17 tests. El resto, incremental |
> | 12 | Alertas operativas | 🟡 **Parcial** — alertas activas a Telegram: D1 degradada y presupuesto IA. Umbrales documentados en OPERATIONS §Alertas |

> Revisión del 2026-08-17 sobre `main` en `2bc8cca`.
> Este documento no afirma que exista una brecha activa. Recoge controles ya
> presentes y endurecimientos propuestos para que Juanes los valide antes de
> replicar esta arquitectura en otros proyectos.

## Resultado general

La nueva arquitectura mejora de forma sustancial la protección del Worker y de
los leads. Ya existen Turnstile, CORS exacto, límites por IP, validación de
entrada, consultas preparadas, firma de Twilio, Cloudflare Access para el panel,
CSP, neutralización de fórmulas CSV, secretos fuera del repositorio y logs sin
contenido sensible.

Las propuestas siguientes son defensa en profundidad. Ninguna debe aplicarse a
ciegas: validar primero en preview y comprobar que chat, formulario, WhatsApp y
panel siguen funcionando.

## P0 — Validar antes de pauta o de reutilizar el Worker

### 1. Verificar el hostname devuelto por Turnstile

**Situación actual:** `verifyTurnstile()` valida `success` y `action`, pero no
comprueba explícitamente `result.hostname`.

**Propuesta:** aceptar únicamente los hosts configurados para el frontend, por
ejemplo `hirevai.com`, `www.hirevai.com` y la preview expresamente autorizada.
No derivar esta lista de un `Origin` enviado por el cliente.

**Criterios de aceptación:**

- Token válido con `action` y hostname esperados: continúa.
- Token válido emitido para otro hostname: `403 human_verification_failed`.
- Tests para producción, `www`, preview y hostname ajeno.

### 2. Añadir límites de coste y abuso en el borde

**Situación actual:** KV limita 20 solicitudes/minuto para chat y 5/minuto para
leads por IP. El contador no es atómico y falla abierto si KV no está disponible.

**Propuesta:** mantener el control actual como segunda capa y añadir reglas de
Cloudflare WAF/Rate Limiting para `/chat` y `/lead`. Evaluar además:

- límite por `conversationId`;
- presupuesto o límite diario global para llamadas al modelo;
- alerta por incremento anómalo de errores, tokens o solicitudes;
- bloqueo temporal ante creación masiva de conversaciones.

**Criterios de aceptación:**

- Una ráfaga supera el límite y recibe `429` antes de consumir Anthropic.
- Una oficina o red móvil compartida no queda bloqueada con tráfico normal.
- Existe una alerta operativa y un procedimiento para desbloqueo/ajuste.

### 3. Confirmar la política real de acceso al panel

**Situación actual:** el Worker valida correctamente firma, `iss`, `aud`, `exp`
y `alg` del JWT de Cloudflare Access. La autorización de personas depende de la
política configurada en Zero Trust.

**Validación manual pendiente:**

- confirmar la lista exacta de correos permitidos;
- probar un correo autorizado y otro no autorizado;
- retirar usuarios que ya no pertenezcan al equipo;
- documentar propietario y recuperación de la cuenta de Zero Trust.

## P1 — Endurecimiento recomendado

### 4. Cabeceras de seguridad para el sitio público

Crear y probar un `_headers` de Pages con, como mínimo:

- `Content-Security-Policy` adaptada a Cloudflare, Turnstile, Google, Meta y los
  demás recursos realmente utilizados;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy`;
- `Permissions-Policy`;
- protección contra framing mediante CSP `frame-ancestors`;
- HSTS únicamente después de confirmar que todo el dominio y subdominios
  relevantes funcionan siempre por HTTPS.

Empezar la CSP en modo `Report-Only` para localizar dependencias antes de
bloquearlas.

### 5. Evitar caché de información administrativa

Añadir `Cache-Control: no-store` a todas las respuestas del panel y de
`/api/admin/*`, no solo a la exportación CSV.

**Criterio de aceptación:** respuestas HTML, JSON y CSV administrativas incluyen
`Cache-Control: no-store` y siguen funcionando detrás de Access.

### 6. Tratar como 401 los JWT malformados

Encapsular la decodificación y el `JSON.parse` de cabecera/payload del JWT. Un
token corrupto debe producir siempre `401 admin_unauthorized`, nunca un `500`.

### 7. Validar el tipo de contenido de las rutas JSON

Para `/chat`, `/lead` y las mutaciones administrativas, exigir el tipo esperado
y responder `415 unsupported_media_type` cuando no corresponda. Mantener el
webhook de Twilio separado como `application/x-www-form-urlencoded`.

## P1 — Privacidad y cumplimiento relacionados

### 8. Revisar la conservación de leads

El valor actual es 24 meses desde la última actividad. Validar con asesoría y con
la finalidad comercial real si conviene separar plazos:

- leads sin respuesta o descartados: 90–180 días;
- oportunidades activas: mientras exista negociación;
- clientes: plazo contractual y legal aplicable.

El cambio de estado o una nota no debería renovar automáticamente 24 meses sin
una razón documentada.

### 9. Facilitar la retirada del consentimiento de cookies

El banner permite aceptar o seguir con esenciales, pero para cambiar después la
decisión se indica borrar datos del navegador. Añadir un enlace permanente
`Configurar cookies` y permitir aceptar/rechazar categorías desde la propia web.

Revisar también con asesoría el uso de Google Consent Mode avanzado —pings sin
cookies antes de una decisión— frente al modo básico para el mercado español.

### 10. Alinear promesas y canales implementados

La web menciona Instagram Direct, Facebook Messenger y tres canales en algunos
textos. Confirmar cuáles están realmente operativos y eliminar o matizar toda
promesa no desplegada.

## P2 — Pruebas y observabilidad

### 11. Ampliar las pruebas automáticas

Añadir pruebas de integración o dobles completos para:

- Turnstile válido, expirado, acción incorrecta y hostname incorrecto;
- persistencia y deduplicación en D1;
- caída de D1, cola KV y drenaje posterior;
- reintentos y estados de Telegram/WhatsApp;
- rutas administrativas GET/PATCH/POST/DELETE;
- XSS en campos y notas mostrados en el panel;
- cuerpos sobredimensionados y tipos de contenido incorrectos;
- JWT vencido, alterado y malformado;
- webhook de Twilio con firma correcta e incorrecta.

### 12. Definir alertas operativas

Documentar umbrales y responsables para:

- `chat_error`, `lead_d1_fallback` y `lead_degraded`;
- respuestas `429`, `5xx` y timeouts de Anthropic;
- acumulación de notificaciones `failed` o `skipped`;
- aumento atípico de solicitudes o coste;
- fallo del cron o crecimiento de `leadq:*`.

## Configuración aún pendiente

- `TEAM_WHATSAPP`.
- `TWILIO_FROM`.
- Prueba del panel con los correos reales del equipo.
- Confirmación de eventos en GA4, Google Ads y Meta.
- Identificación jurídica del titular antes de activar pauta.

## Orden sugerido

1. Validación de hostname de Turnstile y tests.
2. WAF/rate limiting y alertas de coste.
3. Auditoría manual de Cloudflare Access.
4. `Cache-Control: no-store` y JWT malformado.
5. CSP en `Report-Only`, después modo obligatorio.
6. Cookies, retención y corrección de promesas comerciales.
7. Ampliación del conjunto de pruebas.

## Cierre de la revisión

Juanes puede marcar cada punto como:

- **Aceptado**: se implementará.
- **Ya cubierto**: indicar dónde está configurado o probado.
- **No aplica**: explicar el motivo.
- **Decisión de negocio/legal**: asignar responsable y fecha.

