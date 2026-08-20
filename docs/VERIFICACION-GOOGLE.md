# Verificación de la app OAuth de Velai en Google — guía de trabajo

> **Para quién es este doc**: para preparar y enviar la verificación de la app
> `velai-calendar` en Google Auth Platform. Es autocontenido: incluye todos los
> datos reales del proyecto. Objetivo: pasar la revisión del scope sensible de
> Google Calendar para que los clientes de Velai conecten su calendario sin
> avisos de "app no verificada" y sin que sus conexiones caduquen a los 7 días.

---

## 1. Contexto: qué es la app y qué hace con el calendario

- **Velai** (sitio: `https://hirevai.com`) es un SaaS español: un asistente de IA
  («**Vai**») que atiende a los clientes de un negocio (clínicas, restaurantes,
  gestorías…) por chat web y WhatsApp.
- Función que requiere el scope: cada negocio cliente conecta **su propia cuenta
  de Google** desde su panel (`https://admin.hirevai.com`) mediante OAuth. Con ese
  permiso, Vai:
  1. **Consulta la disponibilidad** del calendario del negocio (solo tramos
     ocupados/libres — nunca lee títulos ni contenido de otros eventos), y
  2. **Crea los eventos de las citas** que los clientes finales solicitan por chat.
- El token de acceso se guarda **cifrado (AES-256-GCM)** y aislado por cliente.
  El negocio puede revocar la conexión en cualquier momento desde el panel o desde
  su cuenta de Google.

## 2. Datos concretos del proyecto (usar tal cual)

| Campo | Valor |
|---|---|
| Proyecto de Google Cloud | `velai-calendar` |
| Nombre de la app (marca) | Velai |
| Client ID OAuth | `1059741045199-puqu4mcvbc8fmfj34puqdpo72tenb2a2.apps.googleusercontent.com` |
| Tipo de cliente | Aplicación web |
| Redirect URIs registrados | `https://admin.hirevai.com/oauth/calendar/callback` y `http://localhost:8787/oauth/calendar/callback` |
| **Scope solicitado (único)** | `https://www.googleapis.com/auth/calendar.events` (sensible) |
| API habilitada | Google Calendar API |
| Página principal | `https://hirevai.com/` |
| Política de privacidad | `https://hirevai.com/privacidad/` — incluye sección específica «Datos de Google Calendar» con la declaración de **Limited Use** |
| Condiciones del servicio | `https://hirevai.com/condiciones/` — incluye apartado 5 «Integración con Google Calendar» |
| Dominio autorizado | `hirevai.com` |
| Estado actual | **Testing** (usuarios de prueba; refresh tokens caducan a los 7 días) |

## 3. Prerrequisitos ANTES de enviar (checklist)

- [ ] **Search Console**: verificar la propiedad de `hirevai.com` en
  `https://search.google.com/search-console` **con la misma cuenta de Google
  dueña del proyecto** `velai-calendar`. Método recomendado: propiedad de dominio
  con registro TXT en el DNS (el DNS está en Cloudflare). Sin esto, Google no
  acepta el dominio autorizado ni la marca.
- [ ] **Información de la marca completa** (Google Auth Platform → Información de
  la marca): nombre «Velai», logo (opcional pero ayuda; si se sube, la revisión de
  marca es obligatoria), correo de asistencia, dominio `hirevai.com`, enlaces de
  privacidad y condiciones de la tabla de arriba.
- [ ] **El vídeo demo** (sección 4).
- [ ] La app funciona end-to-end en producción (verificado el 2026-08-20: un
  negocio conectó su calendario y Vai agendó una cita real por chat) — así que la
  demo se puede grabar del flujo real, no de un mock.

## 4. El vídeo demo (lo más importante para el revisor)

**Formato**: YouTube, visibilidad **unlisted** (no privado). Idioma: inglés
recomendado (o español con interfaz visible clara). Duración: 2–4 minutos.
Sin cortes en las partes clave.

**Debe mostrarse, en este orden:**

1. **La pantalla de consentimiento OAuth completa**, donde se vea:
   - la barra de direcciones con la URL de Google (`accounts.google.com`),
   - que la app se llama **Velai**,
   - **el client ID visible en la URL** de la pantalla de consentimiento (el
     revisor lo comprueba contra la solicitud — ampliar/zoom si hace falta),
   - el permiso solicitado (ver y editar eventos de calendario) tal y como lo
     muestra Google.
2. **Cómo se llega ahí**: desde el panel `admin.hirevai.com`, vista «Calendario»
  del negocio → botón «Conectar Google».
3. **El uso real del scope, de punta a punta**:
   - tras conectar, se ve el calendario del negocio en el panel de Velai;
   - en la web con el chat de Vai, un cliente final escribe «quiero una cita
     mañana» → Vai ofrece huecos leídos del calendario conectado → el usuario da
     nombre y teléfono y confirma;
   - se muestra **el evento creado en Google Calendar** del negocio y la cita
     reflejada en el panel.
4. (Opcional, suma puntos) La **desconexión** desde el panel («Desconectar»).

**Nota de seguridad al grabar**: usar una cuenta/calendario de prueba, no exponer
datos personales reales de clientes ni tokens.

## 5. Respuestas para el formulario de verificación (borrador)

- **How will the scopes be used?** (calendar.events):
  > Velai is a customer-service AI assistant for small businesses. When a business
  > connects its own Google account via OAuth, Velai uses `calendar.events` for
  > exactly two operations: (1) listing the business's own calendar events
  > (start/end times only) to compute free/busy availability, and (2) creating
  > events for appointments that the business's customers request through the
  > business's chat channels. Velai does not read event titles or descriptions of
  > existing events beyond start/end/status, does not access any other user data,
  > does not use the data for advertising, and does not transfer it to third
  > parties except the infrastructure sub-processors required to serve the
  > feature. Refresh tokens are stored encrypted (AES-256-GCM) per business.
  > Businesses can revoke access at any time from the Velai panel or their Google
  > Account. Our privacy policy includes the Google API Services User Data Policy
  > Limited Use disclosure: https://hirevai.com/privacidad/
- **Why do you need a sensitive scope (and not a narrower one)?**
  > Read-only scopes cannot create appointment events; `calendar.events` is the
  > narrowest scope that allows both reading availability of the connected
  > calendar and creating events. We request no other scopes.
- **Demo video**: enlace de YouTube unlisted (sección 4).

## 6. Envío y seguimiento

1. Google Auth Platform → **Centro de verificación** → preparar/enviar la
   verificación (marca + datos de la app + scope + vídeo).
2. Google responde por **email** (a los contactos del proyecto): contestar rápido,
   suelen pedir aclaraciones o re-grabar algún tramo del vídeo.
3. Plazo típico: **2–6 semanas** para scopes sensibles.
4. **No pulsar «Publicar app» hasta tener el vídeo y los prerrequisitos**: publicar
   sin verificar muestra la pantalla de «app no verificada» a los usuarios.

## 7. Mientras dura la revisión (modo Testing)

- Solo los correos añadidos en **Público → Test users** pueden conectar su Google
  (límite 100). Añadir ahí el Gmail de cada negocio piloto ANTES de que intente
  conectar.
- Los refresh tokens de Testing **caducan a los 7 días**: reconectar desde el
  panel de Velai (dos clics). Avisar a los pilotos de esta limitación temporal.
- Todo lo demás de la función de citas está operativo en producción.

## 8. Qué NO hay que tocar

- No añadir más scopes (cada scope extra reabre/complica la revisión).
- No cambiar los redirect URIs ni el client ID (el worker en producción los usa).
- No regenerar el client secret salvo decisión consciente (está cargado como
  secret del worker; si se rota, hay que recargarlo con
  `npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET`).
