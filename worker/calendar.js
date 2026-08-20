// Calendario por tenant (SPEC-CALENDARIO fase 1 — SOLO Google; Microsoft queda
// fuera por decisión del 2026-08-20). Este módulo es la capa de proveedor + el
// cálculo PURO de huecos: no toca D1 ni KV (eso vive en app.js, que tiene el
// tenant y las claves). Patrón worker/twilio.js: fetch + AbortSignal, sin SDK.

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

// ── Constantes del tool use ──────────────────────────────────────────────────
// CONSTANTES de código, nunca de D1: byte-estables para el caché de prompt (los
// tools se renderizan ANTES del breakpoint de cache_control) y no editables por dato.
export const CALENDAR_TOOLS = [
  {
    name: 'consultar_disponibilidad',
    description: 'Consulta los huecos libres de la agenda del negocio para un día concreto. Úsala SIEMPRE antes de proponer horas.',
    input_schema: {
      type: 'object',
      properties: { fecha: { type: 'string', description: 'Día a consultar en formato YYYY-MM-DD' } },
      required: ['fecha'],
    },
  },
  {
    name: 'agendar_cita',
    description: 'Crea la cita en la agenda del negocio. Úsala SOLO cuando el cliente haya confirmado la hora exacta y dado su nombre y teléfono.',
    input_schema: {
      type: 'object',
      properties: {
        fecha_hora: { type: 'string', description: 'Inicio de la cita en formato YYYY-MM-DDTHH:MM, hora local del negocio' },
        nombre: { type: 'string', description: 'Nombre del cliente' },
        telefono: { type: 'string', description: 'Teléfono del cliente' },
        motivo: { type: 'string', description: 'Motivo breve de la cita (opcional)' },
      },
      required: ['fecha_hora', 'nombre', 'telefono'],
    },
  },
];

// Guardrails de citas: en CÓDIGO y concatenados al bloque estable del system —
// editar la fila del tenant no puede desactivarlos (misma filosofía que GUARDRAILS).
export const CALENDAR_GUARDRAILS = [
  'GESTIÓN DE CITAS:',
  '- Usa consultar_disponibilidad antes de proponer horas. NUNCA inventes huecos ni confirmes una cita sin que agendar_cita devuelva ok.',
  '- Antes de usar agendar_cita necesitas SIEMPRE: nombre y teléfono del cliente, y su confirmación de la fecha y hora exactas.',
  '- Tras agendar con éxito, confirma en una frase el día, la hora y el nombre. Si la herramienta devuelve hueco_ocupado, ofrece las alternativas que trae.',
  '- Todas las horas son hora local del negocio. No agendes en el pasado ni a más de 60 días.',
].join('\n');

// Horario por defecto cuando el tenant no configuró el suyo: L-V 9:00-19:00.
export const DEFAULT_BUSINESS_HOURS = {
  mon: [['09:00', '19:00']], tue: [['09:00', '19:00']], wed: [['09:00', '19:00']],
  thu: [['09:00', '19:00']], fri: [['09:00', '19:00']],
};

// ── Zona horaria sin librerías ───────────────────────────────────────────────
// Workers no trae tz-database utilizable salvo vía Intl: el offset se deriva
// formateando el instante EN esa zona y comparando con UTC.
export function tzOffsetMs(timezone, utcMs) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  // hour '24' aparece en algunos runtimes para medianoche: normalizar a 0
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return asUtc - utcMs;
}

// 'YYYY-MM-DD' + 'HH:MM' locales del negocio → ms UTC. Dos pasadas: en el borde
// de un cambio de hora (DST) la primera estimación puede errar el offset.
export function localToUtcMs(timezone, dateStr, hhmm) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let guess = naive - tzOffsetMs(timezone, naive);
  guess = naive - tzOffsetMs(timezone, guess);
  return guess;
}

export function utcToLocalHHMM(timezone, utcMs) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  return `${String(Number(parts.hour) % 24).padStart(2, '0')}:${parts.minute}`;
}

// Fecha local (YYYY-MM-DD) de un instante en esa zona. en-CA formatea ISO.
export function localDateStr(timezone, utcMs) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(utcMs));
}

// Día de la semana ('mon'..'sun') de una fecha local. Mediodía local evita bordes.
export function localWeekday(timezone, dateStr) {
  const noon = localToUtcMs(timezone, dateStr, '12:00');
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(new Date(noon)).toLowerCase();
}

// ── Huecos libres (función PURA, cubierta por tests con DST incluido) ────────
// busy: [{start, end}] ISO del proveedor. hours: ventanas locales [['09:00','14:00'],...].
// Devuelve etiquetas 'HH:MM' locales, tope 12 (no inflar tokens del tool_result).
export function freeSlots({ date, busy, hours, slotMinutes, timezone, nowMs }) {
  const slotMs = (Number(slotMinutes) || 30) * 60000;
  const busyRanges = (busy || [])
    .map((b) => [Date.parse(b.start), Date.parse(b.end)])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s);
  // margen de 15 min: nada de ofrecer una cita "dentro de 3 minutos"
  const minStart = (nowMs ?? 0) + 15 * 60000;
  const out = [];
  for (const window of hours || []) {
    const openMs = localToUtcMs(timezone, date, window[0]);
    const closeMs = localToUtcMs(timezone, date, window[1]);
    for (let t = openMs; t + slotMs <= closeMs; t += slotMs) {
      if (t < minStart) continue;
      const end = t + slotMs;
      if (busyRanges.some(([s, e]) => s < end && e > t)) continue;
      out.push(utcToLocalHHMM(timezone, t));
      if (out.length >= 12) return out;
    }
  }
  return out;
}

// ── OAuth de Google ──────────────────────────────────────────────────────────
export function googleAuthUrl(env, state, redirectUri) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    // Sin access_type=offline + prompt=consent Google NO devuelve refresh_token
    // en reconexiones — y sin refresh_token la conexión muere en 1 hora.
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  // Google exige que el vídeo de verificación muestre la consent screen EN INGLÉS:
  // GOOGLE_OAUTH_HL="en" solo mientras se graba; sin la var, el idioma del usuario.
  if (env.GOOGLE_OAUTH_HL) params.set('hl', env.GOOGLE_OAUTH_HL);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(env, code, redirectUri) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('oauth_exchange_failed');
  return response.json();
}

// invalid_grant = el negocio revocó el acceso desde su cuenta de Google (o el token
// caducó en modo Testing): el llamante marca la conexión en error y avisa.
export async function refreshGoogleToken(env, refreshToken) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET, grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error === 'invalid_grant' ? 'invalid_grant' : 'oauth_refresh_failed');
  }
  return data;
}

// Best-effort: al desconectar desde el panel se intenta revocar en Google; si
// falla, borrar la fila ya deja la conexión inutilizable de nuestro lado.
export async function revokeGoogleToken(refreshToken) {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
      method: 'POST', signal: AbortSignal.timeout(8000),
    });
  } catch (_) {}
}

// ── Calendar API ─────────────────────────────────────────────────────────────
// Ocupación vía events.list (NO freeBusy: el scope mínimo calendar.events no lo
// cubre en todos los casos y events.list sí, con los mismos datos para esto).
// Solo se leen start/end/estado — los TÍTULOS de las citas del negocio jamás
// viajan al modelo (un usuario final no puede sonsacarlos).
export async function googleBusy(env, accessToken, calendarId, timeMinIso, timeMaxIso) {
  const params = new URLSearchParams({
    singleEvents: 'true', orderBy: 'startTime', maxResults: '100',
    timeMin: timeMinIso, timeMax: timeMaxIso,
    fields: 'items(start,end,status,transparency)',
  });
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) throw new Error(`calendar_provider_${response.status}`);
  const data = await response.json();
  return (data.items || [])
    .filter((item) => item.status !== 'cancelled' && item.transparency !== 'transparent')
    .map((item) => ({
      // eventos de día completo traen 'date' en vez de 'dateTime': cuentan como ocupado
      start: (item.start && (item.start.dateTime || item.start.date)) || '',
      end: (item.end && (item.end.dateTime || item.end.date)) || '',
    }));
}

export async function createGoogleEvent(env, accessToken, calendarId, { summary, description, startIso, endIso, timezone }) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary, description,
        start: { dateTime: startIso, timeZone: timezone },
        end: { dateTime: endIso, timeZone: timezone },
      }),
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) throw new Error(`calendar_provider_${response.status}`);
  return response.json();
}
