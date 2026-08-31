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
    porCanal: { canal: string; convs: number }[];
    /** Fecha desde la que se cuentan conversaciones (antes, el denominador mentiría). */
    desde: string;
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
