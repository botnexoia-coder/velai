// Tipos de las respuestas de /api/admin/* — derivados LEYENDO los handlers de
// worker/app.js (la fuente de verdad). Si un handler cambia, esto cambia con él.
//
// Convención del worker: para el rol cliente, tenant_name/tenant_id se BORRAN de las
// filas antes de responder (su nombre va en la cabecera del panel) — por eso son
// opcionales en todos los tipos de fila.

export type Role = 'velai' | 'cliente';

/** GET /api/admin/me */
export interface Me {
  role: Role;
  tenantName: string | null;
  tenantLogo: string | null;
  /** El cliente lo necesita para llamar a SUS rutas /tenants/:id/…; para velai es null. */
  tenantId: string | null;
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'won' | 'lost' | 'spam';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'skipped';

/** Fila de leads (SELECT l.* + tenant_name + notification_summary). */
export interface Lead {
  id: string;
  tenant_id?: string;
  tenant_name?: string | null;
  created_at: string;
  updated_at: string;
  status: LeadStatus;
  source: string;
  name: string | null;
  whatsapp: string | null;
  need: string | null;
  context: string | null;
  sector: string | null;
  messages_per_day: string | number | null;
  channel: string | null;
  score: number | null;
  note: string | null;
  page_url: string | null;
  conversation_id: string | null;
  expires_at: string | null;
  /** GROUP_CONCAT(canal:estado), p. ej. "telegram:sent,whatsapp:failed". Solo en el listado. */
  notification_summary?: string | null;
}

/** GET /api/admin/leads */
export interface LeadsResponse {
  leads: Lead[];
  /** Cursor por tupla `created_at|id`; null = no hay más. */
  nextCursor: string | null;
}

export interface LeadNote {
  id: number;
  lead_id: string;
  author_email: string;
  author_role: string;
  text: string;
  created_at: string;
}

export interface LeadEvent {
  id: number;
  lead_id: string;
  actor_email: string;
  actor_role: string;
  event_type: string;
  detail: string | null;
  created_at: string;
}

export interface LeadNotification {
  id: number;
  lead_id: string;
  channel: string;
  status: NotificationStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  updated_at: string;
}

/** GET /api/admin/leads/:id */
export interface LeadDetail {
  lead: Lead;
  notes: LeadNote[];
  events: LeadEvent[];
  notifications: LeadNotification[];
}

/** GET /api/admin/stats */
export interface StatsDia {
  d: string;
  n: number;
  /** Desglose por canal (source), ordenado de mayor a menor. */
  canales: { canal: string; n: number }[];
}
export interface Stats {
  total30: number;
  sinContactar: number;
  sinContactarDesde: string | null;
  fallidos7: number;
  /** Solo velai; para el rol cliente viaja null. */
  tenantsActivos: number | null;
  porDia: StatsDia[];
  porCanal: { canal: string; n: number }[];
  /** Valores reales de `source` en los datos: alimentan el filtro «Fuente». */
  fuentes: string[];
  captura: {
    conversaciones: number;
    leads: number;
    porCanal: { canal: string; convs: number; leads: number }[];
    /** Inicio efectivo de la ventana comparable. */
    desde: string;
    /** False durante los primeros 30 días desde que existe el enlace conversación→lead. */
    periodoCompleto: boolean;
  };
}

/** Fila de GET /api/admin/tenants (solo velai). */
export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  channel_address: string;
  active: number;
  updated_at: string;
  has_template: number;
  has_team: number;
  has_subaccount: number;
  has_twilio_token: number;
  has_from: number;
  has_telegram: number;
  meta_partner_status: string | null;
  sender_status: string | null;
  channels: string | null;
  prompt_len: number;
  lead_count: number;
}
export interface TenantsResponse {
  tenants: TenantRow[];
}

// ── Bandeja de conversaciones ────────────────────────────────────────────────
export type ConvChannel = 'web' | 'whatsapp' | 'messenger' | 'instagram' | 'telegram';
export type ConvState = 'bot' | 'esperando' | 'humano';
export type MsgRole = 'user' | 'assistant' | 'agent';

/** Fila de la lista de GET /api/admin/inbox. */
export interface InboxRow {
  id: string;
  channel: ConvChannel;
  external_id: string | null;
  msgs: number;
  unanswered: number;
  last_at: string;
  lead_id: string | null;
  /** 0/1 de SQLite. */
  unread: number;
  state: ConvState;
  state_at: string | null;
  agent_email: string | null;
  tenant_name?: string | null;
  tenant_id?: string;
  lead_name: string | null;
  lead_status: LeadStatus | null;
  preview: string | null;
  preview_role: MsgRole | null;
}

export interface InboxCount {
  channel: ConvChannel;
  n: number;
  unread: number;
  waiting: number;
}

/** Cabecera del hilo abierto (c.* de conversations). */
export interface ConversationHead {
  id: string;
  tenant_id?: string;
  tenant_name?: string | null;
  channel: ConvChannel;
  external_id: string | null;
  inbox_address?: string | null;
  msgs: number;
  unanswered: number;
  started_at: string;
  last_at: string;
  last_read_at?: string | null;
  last_inbound_at?: string | null;
  visitor_seen_at?: string | null;
  state: ConvState;
  state_at: string | null;
  agent_email: string | null;
  lead_id: string | null;
  expires_at: string | null;
}

export interface ConvMessage {
  role: MsgRole;
  agent_email?: string | null;
  text: string;
  created_at: string;
}

/**
 * Estado del cajón de respuesta, calculado por el worker (replyWindow):
 * - WhatsApp: ventana de Meta de 24 h desde el último mensaje ENTRANTE.
 * - Web: siempre abierta con el control tomado, pero avisa si el visitante se fue.
 * - Cerrada: `reason` es un código que WIN_WHY traduce.
 */
export interface ReplyWindow {
  open: boolean;
  reason?: string;
  web?: boolean;
  away?: boolean;
  seenAt?: string | null;
  closesAt?: string;
  lastIn?: string;
}

export interface InboxThread {
  conversation: ConversationHead;
  messages: ConvMessage[];
  window: ReplyWindow;
}

/** GET /api/admin/inbox — lista + hilo abierto en UNA llamada (es la que se sondea). */
export interface InboxResponse {
  conversations: InboxRow[];
  counts: InboxCount[];
  thread: InboxThread | null;
  /** Minutos que una conversación espera en cola antes de que Vai retome (QUEUE_MAX_MIN). */
  queueMin: number;
  /** Minutos hasta el primer aviso de «seguimos buscando» (TAKEOVER_GRACE_MIN). */
  pingMin: number;
}

/** GET/PATCH /api/admin/availability */
export interface Availability {
  available: boolean;
  withinHours: boolean;
  /** Lo que de verdad decide si se ofrece asesor: interruptor Y horario. */
  offering: boolean;
  advisors: number;
  hours: Record<string, [string, string][]>;
  tz: string;
  graceMin: number;
  /** Para quién es esta disponibilidad (Velai solo cubre las conversaciones de Velai). */
  forTenant: string | null;
}

/** GET /api/admin/alerts */
export interface Alerts {
  waiting: number;
  unread: number;
  lastInbound: string | null;
}

/** GET /api/admin/escalations */
export interface Escalation {
  tenantId: string;
  from: string;
}
export interface EscalationsResponse {
  escalations: Escalation[];
}

// ── IA ───────────────────────────────────────────────────────────────────────
/** GET /api/admin/ai-usage (solo velai). */
export interface AiUsageDia {
  d: string;
  cost: number;
  calls: number;
  /** Llamadas por cliente ese día (para el globo de la barra). */
  clientes: { name: string; calls: number }[];
}
export interface AiUsage {
  days: number;
  total: { cost: number; calls: number; tokens: number };
  clientes: {
    tenant_id: string;
    name: string;
    slug: string | null;
    calls: number;
    tokens: number;
    cost: number;
    models: Record<string, number>;
  }[];
  porDia: AiUsageDia[];
  moneda: 'USD';
}

/** GET /api/admin/ai-balance (el saldo que ve el cliente; sin coste, a propósito). */
export interface AiBalance {
  month: string;
  included: number;
  used: number;
  remaining: number;
  /** Acotado a 100. */
  pct: number;
  over: boolean;
  usedToday: number;
  calls: number;
  serie: { d: string; n: number; calls: number }[];
}

/** Respuestas de acciones simples. */
export interface OkResponse {
  ok: true;
}
export interface TakeoverResponse {
  ok: true;
  state: 'humano';
  agent_email: string;
}
export interface ReleaseResponse {
  ok: true;
  state: 'bot';
}
export interface ReplyResponse {
  ok: true;
  window: ReplyWindow;
}

// ═════════════════════════════════════════════════════════════════════════════
// Segunda tanda — tipos derivados leyendo worker/routes/{tenants,conexiones,
// config,calendario}.js (los handlers reales tras la migración a Hono).
// ═════════════════════════════════════════════════════════════════════════════

// ── Ficha del tenant (GET /api/admin/tenants/:id — columnas explícitas) ──────
export interface TenantDetail {
  id: string;
  slug: string;
  name: string;
  channel_address: string;
  team_whatsapp: string | null;
  telegram_chat_id: string | null;
  lead_template_sid: string | null;
  twilio_from: string | null;
  twilio_subaccount_sid: string | null;
  waba_id: string | null;
  meta_partner_status: string | null;
  system_prompt: string;
  bot_name: string | null;
  brand_name: string | null;
  logo_url: string | null;
  brand_color: string | null;
  brand_color_2: string | null;
  agent_color: string | null;
  greeting: string | null;
  greeting_en: string | null;
  chips_json: string | null;
  placeholder: string | null;
  wa_number: string | null;
  theme: string | null;
  web_origins: string | null;
  sender_sid: string | null;
  sender_status: string | null;
  telegram_chat_title: string | null;
  ai_monthly_tokens: number | null;
  ai_daily_limit: number | null;
  support_hours: string | null;
  support_tz: string | null;
  active: number;
  created_at: string;
  updated_at: string;
  /** El token cifrado JAMÁS sale del worker: solo se dice si existe. */
  has_twilio_token: number;
}

/**
 * Canal de un tenant (tenantChannelSummary). Para velai el estado es el diagnóstico
 * crudo; para el cliente, channelsForScope lo colapsa a su vocabulario (on/paused/
 * preparing/off) — dos vocabularios a propósito: el cliente nunca lee un diagnóstico.
 */
export type TenantChannelState = 'live' | 'inactive' | 'unrouted' | 'from_mismatch' | 'off' | 'on' | 'paused' | 'preparing';
export interface TenantChannel {
  kind: 'web' | 'whatsapp' | 'telegram' | 'messenger';
  address: string | null;
  state: TenantChannelState;
  /** Perfil técnico que conserva el enrutado de un alias heredado. */
  managed_by?: string | null;
}

export interface TenantDetailResponse {
  tenant: TenantDetail;
  channels: TenantChannel[];
}

/** POST /api/admin/tenants (201) y PATCH /api/admin/tenants/:id (200). */
export interface TenantSaveResponse {
  ok: true;
  id?: string;
  updated_at: string;
}

/** GET /api/admin/tenants/:id/versions */
export interface TenantVersion {
  id: number;
  actor_email: string;
  field: string;
  previous_value: string | null;
  note: string | null;
  created_at: string;
}
export interface TenantVersionsResponse {
  versions: TenantVersion[];
}

/** GET /api/admin/tenants/:id/users */
export interface TenantUser {
  email: string;
  created_at: string;
}
export interface TenantUsersResponse {
  users: TenantUser[];
}
/** Estado de la puerta de Access tras un alta/baja: sincronizado | pendiente | manual. */
export type GateState = string | null | undefined;
export interface UserMutationResponse {
  ok: true;
  email?: string;
  remaining?: number;
  gate?: GateState;
}

/** POST /api/admin/tenants/:id/preview */
export interface PreviewResponse {
  reply: string;
}

// ── Aprovisionamiento Twilio ─────────────────────────────────────────────────
/** GET /api/admin/tenants/:id/provision */
export interface ProvisionState {
  subaccount: { sid: string | null; hasToken: boolean };
  template: { sid: string | null; status: string | null };
  sender: { sid: string | null; status: string | null };
  provisioned_at: string | null;
  warnings: string[];
}
/** POST /:id/provision/template/check */
export interface TemplateCheckResponse {
  ok: true;
  status: string;
  reason?: string | null;
  applied: boolean;
  stored: string | null;
  sid: string | null;
  raw: unknown;
}
/** POST /:id/provision/template/resubmit */
export interface TemplateResubmitResponse {
  ok: true;
  raw: unknown;
}
/** POST /:id/provision/sender/sync */
export interface SenderSyncResponse {
  ok: true;
  applied: number;
  sender: { senderSid: string; senderId: string | null; status: string | null; wabaId: string | null };
  conflicts: { field: string; current: string; fromTwilio: string }[];
  webhookOk: boolean;
  webhookFixed: boolean;
  channelRegistered: boolean;
}
/** POST /:id/provision/sender/profile y /:id/logo/apply */
export interface ProfileApplyResponse {
  ok: true;
  applied: { logo: boolean; websites: number; description: boolean };
}

// ── Conexiones: Telegram del tenant ──────────────────────────────────────────
export interface TelegramTopic {
  thread_id: number;
  name: string;
  description?: string;
}
export interface TelegramLastReport {
  period_start: string;
  status: string;
  detail: string | null;
  sent_at: string | null;
}
/** GET /api/admin/tenants/:id/telegram */
export interface TelegramInfo {
  linked: boolean;
  title: string | null;
  linked_at: string | null;
  botUsername: string | null;
  whitelabel: boolean;
  topics: TelegramTopic[];
  weeklyReport: boolean;
  lastReport: TelegramLastReport | null;
}
export interface TelegramInfoResponse {
  telegram: TelegramInfo;
}
/** POST /api/admin/tenants/:id/telegram/link */
export interface TelegramLinkResponse {
  token: string;
  dmUrl: string;
  groupUrl: string;
  expiresInSeconds: number;
}
export interface TelegramBotResponse {
  ok: true;
  botUsername: string;
}
export interface TopicsResponse {
  ok: true;
  topics: TelegramTopic[];
}
/** POST /api/admin/telegram/setup (webhook del bot de Velai; solo velai). */
export interface TelegramSetupResponse {
  ok: true;
  botUsername: string | null;
}

// ── Conexiones: WhatsApp del tenant ──────────────────────────────────────────
/** GET /api/admin/tenants/:id/whatsapp — columnas explícitas, sin secretos. */
export interface WhatsappRow {
  channel_address: string | null;
  twilio_from: string | null;
  has_waba: number;
  sender_status: string | null;
  lead_template_status: string | null;
  meta_partner_status: string | null;
  team_whatsapp: string | null;
  wa_number: string | null;
  logo_url: string | null;
  logo_wa_url: string | null;
  has_token: number;
  has_subaccount: number;
  /** Existe la fila de tenant_channels que enruta el webhook a este cliente. */
  routed: number;
}
export type AlertDeliveryState = 'on' | 'off' | 'pending_template';
/** Estado de ENTREGA de los avisos (leadAlertStatus): mismas condiciones que deliver(). */
export interface LeadAlerts {
  telegram: AlertDeliveryState;
  whatsapp: AlertDeliveryState;
  any: boolean;
}
/** Cómo fue el último empujón de la foto al perfil de WhatsApp (KV waprof:<id>). */
export interface ProfileSync {
  ok: boolean;
  at?: string;
  error?: string;
  why?: string;
}
export interface WhatsappInfoResponse {
  whatsapp: WhatsappRow;
  alerts: LeadAlerts;
  profileSync: ProfileSync | null;
}

/** POST /api/admin/tenants/:id/logo?channels=web,whatsapp */
export interface LogoUploadResponse {
  ok: true;
  logo_url: string;
  store: string;
  canales: { web: boolean; whatsapp: boolean };
  /** true si además se lanzó la actualización de la foto de WhatsApp en segundo plano. */
  whatsapp: boolean;
}

// ── Canales (vista global, solo velai) ───────────────────────────────────────
export type GlobalChannelState = 'live' | 'inactive' | 'from_mismatch' | 'orphan';
export interface GlobalChannel {
  address: string;
  kind: string;
  created_at: string;
  tenant_id: string | null;
  slug: string | null;
  name: string | null;
  active: number | null;
  twilio_from: string | null;
  sender_status: string | null;
  state: GlobalChannelState;
}
/** Sender vivo en Twilio sin fila que lo enrute: el bot calla en verde (caso gogestion). */
export interface UnroutedSender {
  tenant_id: string;
  slug: string;
  name: string;
  active: number;
  channel_address: string | null;
  twilio_from: string;
  sender_status: string | null;
}
export interface ChannelsResponse {
  channels: GlobalChannel[];
  unrouted: UnroutedSender[];
}

// ── Configuración (solo admins raíz salvo /admins) ───────────────────────────
/** GET /api/admin/config */
export interface ConfigInfo {
  cf_token: {
    source: 'panel' | 'worker' | 'none';
    valid: boolean | null;
    status: string | null;
  };
  account_id: string | null;
  turnstile_sitekey: string | null;
  groups: { clientes: boolean; admins: boolean };
  d1: boolean;
  kv: boolean;
}
/** POST /api/admin/config/cf-token */
export interface CfTokenSaveResponse {
  ok: true;
  source: 'panel';
  status: string;
}
/** DELETE /api/admin/config/cf-token */
export interface CfTokenClearResponse {
  ok: true;
  source: 'worker' | 'none';
}
/** GET /api/admin/config/telegram-webhook (solo lectura, bajo demanda). */
export interface WebhookInfo {
  configured: boolean;
  error?: string;
  url?: string | null;
  esperada?: string;
  coincide?: boolean;
  pendientes?: number;
  ultimoError?: { mensaje: string; cuando: string | null } | null;
  maxConexiones?: number | null;
  ip?: string | null;
}

/** GET /api/admin/admins */
export interface AdminEntry {
  email: string;
  root: boolean;
  created_by?: string;
  created_at?: string;
}
export interface AdminsResponse {
  admins: AdminEntry[];
}
export interface AdminMutationResponse {
  ok: true;
  email?: string;
  gate?: GateState;
}

// ── Calendario ───────────────────────────────────────────────────────────────
/** GET /api/admin/tenants/:id/calendar (sin el refresh token, claro). */
export interface CalendarRow {
  provider: string;
  account_email: string | null;
  calendar_id: string | null;
  timezone: string | null;
  slot_minutes: number | null;
  /** JSON string de {dia: [["HH:MM","HH:MM"],…]} o null (= default L-V 9-19). */
  business_hours: string | null;
  status: string;
  last_error: string | null;
  connected_at: string | null;
  updated_at: string | null;
}
/** Bloque de Confirmaciones (SPEC-CONFIRMACIONES): addon que habilita Velai; el
 *  cliente lo VE. El estado de la plantilla sale de tenant_templates (kind
 *  recordatorio_cita) — el catálogo de plantillas vive en worker/plantillas.js. */
export interface Confirmaciones {
  enabled: boolean;
  /** Antelación en horas (decisión vigente: 24 única). */
  hours: number;
  template: { sid: string | null; status: string | null };
}
export interface CalendarResponse {
  calendar: CalendarRow | null;
  /** Ausente solo si el worker corre sin la migración 0030. */
  confirmaciones?: Confirmaciones;
}
/** POST /api/admin/tenants/:id/calendar/connect */
export interface CalendarConnectResponse {
  authUrl: string;
}
/** GET /api/admin/appointments */
export interface Appointment {
  id: string;
  tenant_id?: string;
  tenant_name?: string | null;
  channel: string;
  customer_name: string;
  customer_phone: string;
  reason: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  status: string;
  created_at: string;
  /** Confirmaciones (0030): qué hizo el cliente final con su cita. */
  customer_confirmed_at?: string | null;
  cancelled_by?: string | null;
  /** Ledger del recordatorio previo_24h (LEFT JOIN: null = sin recordatorio). */
  reminder_status?: NotificationStatus | null;
  reminder_sent_at?: string | null;
  reminder_attempts?: number | null;
  reminder_error?: string | null;
}
export interface AppointmentsResponse {
  appointments: Appointment[];
}

/** Horario semanal ya parseado: {mon: [["09:00","19:00"], …], …}. */
export type WeekHours = Record<string, [string, string][]>;

// ── Vista «Plantillas» (solo velai) ──────────────────────────────────────────
/** Estado de UNA plantilla de un cliente. updated_at null en las legacy de columnas
 *  (aviso_lead): las columnas no guardan cuándo cambió ESA plantilla. */
export interface PlantillaCelda {
  /** Ausente para el rol cliente: el sid es dato operativo de Velai. */
  sid?: string | null;
  status: string | null;
  updated_at: string | null;
  /** Lo elegido al crearla (0031). null = creada sin opciones → defaults del catálogo. */
  opciones?: { botones?: string; textos?: { confirmar: string; cancelar: string } } | null;
  /** La categoría REAL leída de Twilio por el poll (0032). null = aún no leída: se
   *  enseña «—», JAMÁS la intención del catálogo como si fuera un hecho. */
  categoria?: string | null;
}

// ── Solicitudes de cambio del cliente (tenant_solicitudes, 0032) ─────────────
export interface SolicitudPayload {
  botones?: string;
  antelacion?: number;
}
/** GET /api/admin/solicitudes — consciente del rol: el cliente ve las suyas (con
 *  status/nota); velai las pendientes de todos (con tenant y lo actual al lado). */
export interface Solicitud {
  id: number;
  tipo: string;
  payload: SolicitudPayload;
  created_at: string;
  /** Solo en la respuesta del cliente. */
  status?: 'pending' | 'approved' | 'rejected';
  nota?: string | null;
  resolved_at?: string | null;
  /** Solo en la respuesta de velai. */
  tenant_id?: string;
  tenant_name?: string;
  requested_by?: string;
  actual?: { hours: number; opciones: { botones?: string; textos?: { confirmar: string; cancelar: string } } | null };
}
export interface SolicitudesResponse {
  solicitudes: Solicitud[];
}
/** Una pareja de botones CURADA del catálogo (nunca texto libre — decisión de Juan). */
export interface ParejaBotones {
  id: string;
  confirmar: string;
  cancelar: string;
}
/** La config del diálogo de alta de un kind creable: preview renderizada y las listas
 *  curadas. Solo la traen los kinds con `content` (los legacy-columnas no se crean así). */
export interface PlantillaConfig {
  /** El cuerpo REAL de la plantilla con los valores de ejemplo ya sustituidos. */
  preview: string | null;
  antelaciones?: number[];
  antelacionDefault?: number;
  botones?: ParejaBotones[];
  botonesDefault?: string;
}
/** Un kind del catálogo (worker/plantillas.js): TODO lo que la vista pinta viene de
 *  aquí — nada por kind se hardcodea en el panel. */
export interface PlantillaKind {
  kind: string;
  label: string;
  fuente: 'registro' | 'columnas';
  /** Categoría de Meta (Utility/Marketing…). Opcionales: un worker anterior no los manda. */
  categoria?: string;
  descripcion?: string;
  config?: PlantillaConfig;
}
/** GET /api/admin/plantillas — clientes × kinds del catálogo (worker/plantillas.js). */
export interface PlantillasResponse {
  kinds: PlantillaKind[];
  /** Activos primero (orden del SQL). `plantillas` solo trae los kinds que existen. */
  tenants: {
    id: string;
    slug: string;
    name: string;
    active: number;
    plantillas: Record<string, PlantillaCelda | undefined>;
    /** Solo en la respuesta del CLIENTE: su antelación vigente (los selectores de
     *  solicitud parten de lo actual). */
    hours?: number;
  }[];
}
