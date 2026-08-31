// Mapa de códigos de error del worker → frase en español (portado 1:1 de
// worker/admin-panel.js — mismos códigos, mismos textos). El worker responde
// { error: 'codigo' } y el panel lo traduce aquí; un código sin traducción se
// enseña tal cual, que es mejor que esconderlo.

export const TERRS: Record<string, string> = {
  already_provisioned: 'Ese paso ya está hecho (idempotente: un doble clic no crea recursos duplicados).',
  provision_in_progress: 'Ese paso ya está en curso, espera unos segundos.',
  waba_required: 'Rellena y guarda primero la WABA del cliente.',
  subaccount_required: 'Crea primero la subcuenta (paso 1).',
  subaccount_unusable: 'Esa subcuenta no existe en Twilio o no está activa: revisa el SID pegado en la ficha.',
  sender_required: 'Este cliente aún no tiene número de WhatsApp: haz primero el alta y sincroniza.',
  template_required: 'Este cliente aún no tiene plantilla creada: haz primero el paso 2.',
  brand_empty: 'Rellena al menos el nombre de marca o el logo en la ficha antes de aplicar el perfil.',
  logo_missing: 'Sube primero tu imagen.',
  channels_required: 'Marca al menos un canal para esa imagen.',
  sender_profile_failed: 'Twilio rechazó la actualización del perfil (mira el detalle).',
  twilio_400_63100: 'Twilio rechazó los datos del perfil (validación). El detalle dice qué campo falla.',
  twilio_400_63101: 'La foto no es válida para WhatsApp: prueba una cuadrada de 640×640 en PNG o JPG.',
  invalid_image: 'Solo PNG, JPG o WebP (y que sea una imagen de verdad).',
  image_too_large: 'La imagen pesa más de 2 MB.',
  media_not_configured: 'El almacenamiento de imágenes no está disponible en el worker.',
  twilio_auth_token_missing: 'La subcuenta no tiene auth token guardado.',
  provision_orphan: 'Twilio creó el recurso pero D1 no lo guardó: revisa Telegram y reconcilia a mano.',
  invalid_code: 'El OTP son 4-8 dígitos.',
  slug_taken: 'Ese slug ya existe.',
  address_taken: 'Ese canal ya está asignado a otro cliente: guardarlo desviaría sus conversaciones.',
  subaccount_taken: 'Esa subcuenta de Twilio ya está asignada a otro cliente.',
  pending_tenant_cannot_be_active: 'Un prospecto (canal pending:) no puede activarse: ponle primero su canal real.',
  invalid_twilio_auth_token: 'El auth token debe ser 32 caracteres hexadecimales (Twilio → Keys & Credentials).',
  stale_tenant: 'Alguien modificó este cliente mientras editabas. Recarga la ficha y vuelve a aplicar tus cambios.',
  nothing_to_update: 'No hay cambios que guardar.',
  invalid_preview: 'Escribe un mensaje de prueba y un contexto de al menos 50 caracteres.',
  rate_limited: 'Demasiadas pruebas seguidas: espera un minuto.',
  email_taken: 'Ese correo ya tiene acceso al panel de OTRO cliente (un correo pertenece a un solo cliente).',
  email_is_admin: 'Ese correo es admin de Velai (ADMIN_EMAILS): ya ve todo, no puede ser usuario de un cliente.',
  invalid_email: 'Eso no parece un correo válido.',
  cloudflare_api_not_configured: 'Falta CF_API_TOKEN (secret) o CF_ACCOUNT_ID en el worker: la sincronización con Cloudflare no está activa.',
  turnstile_sync_failed: 'El PUT a Turnstile falló DESPUÉS de guardar en D1: el worker acepta el origen pero Turnstile no emitirá token. Reintenta Sincronizar Turnstile.',
  turnstile_domains_limit: 'Turnstile admite 10 dominios por widget y ya se superan incluso plegando los www: toca pasar a un widget por cliente (alternativa §4 de la spec).',
  already_admin: 'Ese correo ya es admin.',
  email_is_client: 'Ese correo es usuario de un CLIENTE: primero quítalo de la ficha del cliente y luego dale admin.',
  admin_is_root: 'Ese admin es raíz (vive en la configuración del worker): no se puede quitar desde el panel.',
  cannot_remove_self: 'No puedes quitarte a ti mismo (que lo haga otro admin): evita el cierre accidental.',
  root_only: 'Solo los admins raíz (los de la configuración del worker) pueden tocar la configuración.',
  invalid_token_format: 'Eso no parece un token de API de Cloudflare.',
  token_invalid: 'Cloudflare rechazó el token (no está activo): NO se guardó.',
  token_verify_unavailable: 'No se pudo validar contra Cloudflare (red): NO se guardó.',
  sender_not_found: 'La subcuenta no tiene ningún sender de WhatsApp aún: haz primero el Self Sign-up con el cliente.',
  multiple_senders: 'La subcuenta tiene VARIOS senders: reconcíliala a mano desde la ficha.',
  team_whatsapp_equals_from: 'Ese número es el DEL BOT: si se avisa a sí mismo, WhatsApp rechaza todos los avisos (error 63031). Usa los números del equipo.',
  telegram_not_configured: 'Falta configurar Telegram en el worker (token del bot o secreto del webhook).',
  telegram_no_vinculado: 'Vincula primero el grupo de Telegram (botón Conectar Telegram).',
  marca_blanca_requerida: 'Los Temas son parte de la marca blanca: actívala en el paso 1 para este cliente.',
  group_sin_temas: 'El grupo no tiene «Temas» activados: actívalos en los ajustes del grupo de Telegram y reintenta.',
  bot_sin_permisos: 'El bot necesita ser ADMIN del grupo con permiso «Gestionar temas»: dáselo y reintenta.',
  telegram_topic_failed: 'Telegram no pudo crear el tema: reintenta en unos segundos.',
  demasiados_temas: 'Máximo 25 temas por grupo.',
  invalid_topic_name: 'Ponle nombre al tema.',
  invalid_bot_token: 'Ese token no parece de @BotFather o Telegram lo rechazó.',
  telegram_setup_failed: 'Telegram rechazó el registro del webhook (el detalle va detrás del guion).',
  webhook_secret_invalid: 'Configuración del worker: el TELEGRAM_WEBHOOK_SECRET tiene caracteres que Telegram no admite (solo letras, números, guion y guion bajo). No es culpa del token del cliente — hay que regenerarlo en el worker.',
  webhook_url_invalid: 'Telegram no acepta la URL del webhook del worker: revisa WORKER_PUBLIC_URL.',
  telegram_rate_limited: 'Telegram esta limitando las peticiones de ese bot: espera un minuto y reintenta.',
  // Códigos que en el v1 vivían fuera de TERRS pero también llegan al panel:
  not_authorized: 'Tu correo no tiene acceso a este panel.',
  not_found: 'Eso ya no existe (o no es tuyo).',
  invalid_status: 'Ese estado de lead no existe.',
  invalid_note: 'Escribe la nota antes de guardarla.',
  invalid_message: 'Escribe el mensaje antes de enviarlo.',
  request_failed: 'La petición falló. Reintenta en unos segundos.',
};

// Por qué NO se puede responder, en palabras del dueño. El cajón se cierra ANTES de que
// alguien escriba: el 63016 de Twilio llega cuando el mensaje ya se dio por enviado.
export const WIN_WHY: Record<string, string> = {
  inbox_address_unknown: 'No sabemos por qué número responder (conversación anterior a la bandeja). En cuanto el cliente vuelva a escribir, se podrá.',
  no_inbound: 'Todavía no hay ningún mensaje del cliente en esta conversación.',
  window_closed: 'La ventana de 24 h de WhatsApp se cerró. Para escribir ahora hace falta una plantilla aprobada por Meta.',
  atiende_la_ia: 'Vai está atendiendo esta conversación. El cajón se abre cuando la persona pide un asesor y alguien toma el control.',
  sin_control: 'Esta persona pidió hablar con alguien del equipo y está esperando. Toma el control para poder escribirle.',
  ya_tomada: 'Otra persona del equipo tomó el control de esta conversación.',
  nada_que_tomar: 'Aquí no hay ningún control que tomar: la está atendiendo Vai.',
  velai_no_atiende_clientes: 'Esta conversación es de un cliente y la atiende su equipo, no Velai. La ves para dar soporte, pero no puedes escribir en ella.',
  velai_tenant_missing: 'No encuentro el cliente «velai» en la base: sin él no se puede resolver la disponibilidad de Velai.',
};

// Estados de los avisos por lead (chips de la tabla): el punto de color solo no dice
// si el aviso falló, está en cola o se saltó a propósito.
export const NB_TIP: Record<string, string> = {
  sent: 'Entregado',
  failed: 'Falló. Se reintenta solo (5 veces, espaciando).',
  pending: 'En cola, aún sin enviar',
  skipped: 'No se envió: ese canal no está configurado para este cliente',
};

export const ST_LABEL: Record<string, string> = {
  new: 'nuevo',
  contacted: 'contactado',
  qualified: 'cualificado',
  won: 'ganado',
  lost: 'perdido',
  spam: 'spam',
};

/** Traduce un código de error del worker; sin traducción, devuelve el código tal cual. */
export function traducir(code: unknown): string {
  const key = code instanceof Error ? code.message : String(code ?? '');
  return WIN_WHY[key] ?? TERRS[key] ?? key;
}
