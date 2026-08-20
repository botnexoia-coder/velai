# Verificación de la app OAuth de Velai en Google — estado y guía

> **Actualizado 2026-08-20 (noche)** tras la sesión de consolas (Cowork) + parche aplicado
> por el CLI. Todo lo de Google Cloud se hizo con **botnexo.ia@gmail.com** (`authuser=4`),
> dueña del proyecto `velai-calendar`. **Falta SOLO el vídeo para poder enviar.**

---

## 1. Estado real (lo que YA está hecho — no repetir)

- ✅ **Search Console**: `sc-domain:hirevai.com` verificada por `botnexo.ia@gmail.com`
  (TXT `google-site-verification=PuaSHVFXLfGnwf4SWv2LIt6iZ9KyUTlF2OtGUl1IuC4` vía
  Domain Connect de Cloudflare). Ojo: `johan.0413@gmail.com` sigue siendo otro propietario.
- ✅ **App PUBLICADA (En producción)**: descubrimiento clave — Google **no deja enviar la
  verificación con la app en «Prueba»**. Secuencia real: publicar app → verificar marca →
  publicar marca → enviar acceso a los datos con el vídeo. Consecuencias del estado actual:
  ya **NO caducan los refresh tokens a los 7 días** ni hace falta lista de test users;
  a cambio, los usuarios ven la pantalla de **«app no verificada»** al conectar (desaparece
  con la aprobación) y hay tope de 100 usuarios nuevos hasta entonces.
- ✅ **Marca verificada Y publicada** (la consent screen muestra «Velai»).
- ✅ **Cloudflare: Modo Bot Fight y AI Labyrinth APAGADOS** — eran la causa del rechazo del
  verificador de Google («tu página principal está protegida por una página de acceso»).
  🔴 Reactivarlos cuando aprueben el scope (o regla WAF que exima a los fetchers de Google).
- ✅ **Parche in-product aplicado** (2026-08-20, CLI): aviso de privacidad en la tarjeta
  «Conectar Google Calendar» del panel con enlaces a `/privacidad/#google-calendar` y
  `/condiciones/#calendar`; la home nombra Google Calendar (featureList + tarjeta 05) y el
  footer enlaza Condiciones; precisiones en privacidad (qué se escribe en el evento; los
  tramos de disponibilidad pasan por Anthropic, el contenido de eventos nunca sale de
  Google); y `googleAuthUrl` acepta `GOOGLE_OAUTH_HL` para forzar la consent screen en
  inglés durante la grabación.

## 2. Datos del proyecto (usar tal cual)

| Campo | Valor |
|---|---|
| Proyecto | `velai-calendar` (cuenta `botnexo.ia@gmail.com`) |
| Client ID | `1059741045199-puqu4mcvbc8fmfj34puqdpo72tenb2a2.apps.googleusercontent.com` |
| Scope único (sensible) | `https://www.googleapis.com/auth/calendar.events` |
| Redirects | `https://admin.hirevai.com/oauth/calendar/callback` · `http://localhost:8787/oauth/calendar/callback` |
| Home / Privacidad / Condiciones | `https://hirevai.com/` · `/privacidad/` (con Limited Use en `#google-calendar`) · `/condiciones/` (§5) |

## 3. Lo ÚNICO que falta: el vídeo (y enviar)

**Antes de grabar** — poner la consent screen en inglés:

```bash
# como var (recomendado: en wrangler.toml [vars] GOOGLE_OAUTH_HL = "en" + push)
# o como secret temporal:
npx wrangler secret put GOOGLE_OAUTH_HL     # valor: en
# …grabar…  y luego QUITARLA para que los clientes la vean en español
```

**Guion (2–4 min, YouTube unlisted, narración o texto en pantalla):**

1. Panel `admin.hirevai.com` → vista **Calendario** → se ve el **aviso de privacidad
   in-product** → botón **Conectar Google**.
2. **Consent screen completa y en inglés**: URL de `accounts.google.com`, nombre **Velai**,
   **client ID legible en la barra** (hacer zoom), permiso de eventos de calendario.
   La pantalla de «app no verificada» aparecerá: es normal y Google QUIERE verla.
3. Uso real: «Conectado como…» → chat de Vai → «quiero cita mañana» → huecos leídos del
   calendario → nombre y teléfono → confirmación → **el evento en Google Calendar** y la
   cita en el panel.
4. **Desconectar** desde el panel (revocación).

Datos ficticios y calendario de prueba (no el de un cliente real).

**Enviar**: Centro de verificación → *Prepare for verification* → enlace del vídeo +
justificación de abajo → Confirmar. Google contesta por email (responder rápido); plazo
típico 2–6 semanas.

### Justificación del scope (935/1000 caracteres — pegar tal cual)

```
Velai is a customer-service AI assistant for small businesses (clinics, restaurants, salons). Each business connects its own Google account from its private Velai dashboard. We use calendar.events for exactly two calls: (1) events.list on that calendar with fields=items(start,end,status,transparency) to compute free/busy slots - we never receive titles, descriptions, attendees or locations; (2) events.insert to create the appointment the business's own customer requested through the business's web or WhatsApp chat. No other Google API or scope is requested. Read-only scopes cannot create events and freebusy is not available to calendar.events, so this is the narrowest scope covering both halves of the feature. Data is never used for ads, sold or shared; refresh tokens are stored encrypted per business (AES-256-GCM) and revoked at Google on disconnect. Limited Use disclosure: https://hirevai.com/privacidad/#google-calendar
```

En **Información adicional** (1000 car.): el panel está detrás de Cloudflare Access con OTP
y el alta es asistida por Velai; si el revisor quiere probar en vivo, se le facilita un
tenant de demo y un correo autorizado.

## 4. Lo que NO hay que tocar

El client ID y sus redirects (el worker los usa), el scope único `calendar.events`, y el
TXT de Search Console (borrarlo tumba la verificación del dominio y con ella la de marca).
