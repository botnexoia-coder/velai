// Hooks de datos del panel: cada endpoint de /api/admin con su tipo. Aquí vive el
// reparto silencio/ruido de la barra de actividad: la primera carga de una vista
// enciende la barra; los refetches (polling, recargas tras una acción) van en silencio,
// exactamente como el v1.
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api, apiDelete, apiPatch, apiPost, qs } from '../api/client';
import { quietRefetch } from '../api/queryClient';
import type {
  AdminMutationResponse,
  AdminsResponse,
  AiBalance,
  AiUsage,
  AppointmentsResponse,
  Availability,
  CalendarConnectResponse,
  CalendarResponse,
  CfTokenClearResponse,
  CfTokenSaveResponse,
  ChannelsResponse,
  ConfigInfo,
  EscalationsResponse,
  InboxResponse,
  LeadDetail,
  LeadsResponse,
  PlantillasResponse,
  SolicitudesResponse,
  LogoUploadResponse,
  Me,
  OkResponse,
  PreviewResponse,
  ProfileApplyResponse,
  ProvisionState,
  ReleaseResponse,
  ReplyResponse,
  SenderSyncResponse,
  Stats,
  TakeoverResponse,
  TelegramBotResponse,
  TelegramInfoResponse,
  TelegramLinkResponse,
  TelegramSetupResponse,
  TenantChannel,
  TenantDetailResponse,
  TenantSaveResponse,
  TenantUsersResponse,
  TenantVersionsResponse,
  TenantsResponse,
  TopicsResponse,
  UserMutationResponse,
  WebhookInfo,
  WhatsappInfoResponse,
} from '../api/types';

// ── Identidad y catálogos ────────────────────────────────────────────────────
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/api/admin/me'),
    staleTime: Infinity,
  });
}

/** Lista de clientes — SOLO para velai (clienteAllowed no incluye GET /tenants). */
export function useTenants(enabled: boolean) {
  return useQuery({
    queryKey: ['tenants'],
    queryFn: () => api<TenantsResponse>('/api/admin/tenants'),
    enabled,
    staleTime: 60_000,
  });
}

export function useStats() {
  const client = useQueryClient();
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Stats>('/api/admin/stats', undefined, { quiet: quietRefetch(client, ['stats']) }),
  });
}

// ── Dashboard: IA ────────────────────────────────────────────────────────────
export function useAiUsage(days: number, enabled: boolean) {
  return useQuery({
    queryKey: ['ai-usage', days],
    queryFn: () => api<AiUsage>(`/api/admin/ai-usage?days=${days}`),
    enabled,
  });
}

export function useAiBalance(enabled: boolean) {
  return useQuery({
    queryKey: ['ai-balance'],
    queryFn: () => api<AiBalance>('/api/admin/ai-balance'),
    enabled,
  });
}

// ── Leads ────────────────────────────────────────────────────────────────────
export interface LeadFilters {
  q?: string;
  tenant?: string;
  status?: string;
  notification?: string;
  source?: string;
  from?: string;
  to?: string;
}

export function leadQs(filters: LeadFilters, cursor?: string): string {
  return qs({ ...filters, cursor });
}

export function useLeads(filters: LeadFilters) {
  return useInfiniteQuery({
    queryKey: ['leads', filters],
    queryFn: ({ pageParam }) => api<LeadsResponse>(`/api/admin/leads${leadQs(filters, pageParam ?? undefined)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useLead(id: string | null) {
  return useQuery({
    queryKey: ['lead', id],
    queryFn: () => api<LeadDetail>(`/api/admin/leads/${id}`),
    enabled: Boolean(id),
  });
}

function invalidateLeads(client: QueryClient, id?: string) {
  void client.invalidateQueries({ queryKey: ['leads'] });
  void client.invalidateQueries({ queryKey: ['stats'] });
  if (id) void client.invalidateQueries({ queryKey: ['lead', id] });
}

export function useLeadStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiPatch<OkResponse>(`/api/admin/leads/${id}`, { status }),
    onSuccess: (_d, { id }) => invalidateLeads(client, id),
  });
}

export function useLeadNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      apiPost<OkResponse>(`/api/admin/leads/${id}/notes`, { text }),
    onSuccess: (_d, { id }) => void client.invalidateQueries({ queryKey: ['lead', id] }),
  });
}

export function useLeadRetry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<OkResponse>(`/api/admin/leads/${id}/retry`),
    onSuccess: (_d, id) => void client.invalidateQueries({ queryKey: ['lead', id] }),
  });
}

export function useLeadDelete() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/api/admin/leads/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateLeads(client),
  });
}

// ── Escalaciones (bot en pausa) ──────────────────────────────────────────────
export function useEscalations() {
  return useQuery({
    queryKey: ['escalations'],
    queryFn: () => api<EscalationsResponse>('/api/admin/escalations'),
  });
}

export function useResumeBot() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (e: { tenantId: string; from: string }) => apiPost<OkResponse>('/api/admin/escalations/resume', e),
    onSettled: () => void client.invalidateQueries({ queryKey: ['escalations'] }),
  });
}

// ── Bandeja de conversaciones ────────────────────────────────────────────────
export interface ConvFilters {
  q?: string;
  channel?: string;
  tenant?: string;
  from?: string;
  to?: string;
  lead?: 'si';
  sinResolver?: '1';
}

export function convQs(filters: ConvFilters, conversation?: string | null): string {
  return qs({ ...filters, conversation: conversation ?? undefined });
}

export const INBOX_LIVE_MS = 15_000;
export const INBOX_IDLE_MS = 60_000;

/** ¿Hay algo vivo (alguien esperando o una conversación tomada)? Marca la cadencia del sondeo. */
export function inboxAlive(d: InboxResponse | undefined): boolean {
  if (!d) return false;
  const enCola = (d.counts ?? []).reduce((a, c) => a + (c.waiting || 0), 0);
  return enCola > 0 || (d.conversations ?? []).some((c) => c.state === 'humano');
}

/**
 * La bandeja: UNA llamada con lista + hilo abierto, sondeada cada 15 s cuando hay algo
 * vivo y cada 60 s si no (mismo ahorro que el v1). TanStack solo sondea con la pestaña
 * visible (refetchIntervalInBackground=false por defecto), que es la otra mitad del ahorro.
 */
export function useInbox(filters: ConvFilters, conversation: string | null) {
  const client = useQueryClient();
  const queryKey = ['inbox', filters, conversation] as const;
  return useQuery({
    queryKey,
    queryFn: () =>
      api<InboxResponse>(`/api/admin/inbox${convQs(filters, conversation)}`, undefined, {
        quiet: quietRefetch(client, queryKey),
      }),
    refetchInterval: (query) => (inboxAlive(query.state.data) ? INBOX_LIVE_MS : INBOX_IDLE_MS),
    // El hilo abierto no debe parpadear al cambiar de filtros: se conserva lo anterior.
    placeholderData: (prev) => prev,
  });
}

export function useAvailability() {
  const client = useQueryClient();
  return useQuery({
    queryKey: ['availability'],
    queryFn: () => api<Availability>('/api/admin/availability', undefined, { quiet: quietRefetch(client, ['availability']) }),
  });
}

export function useSetAvailability() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (available: boolean) => apiPatch<Availability>('/api/admin/availability', { available }),
    onSuccess: (data) => client.setQueryData(['availability'], data),
  });
}

function invalidateInbox(client: QueryClient) {
  void client.invalidateQueries({ queryKey: ['inbox'] });
}

export function useTakeover() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<TakeoverResponse>(`/api/admin/conversations/${id}/takeover`),
    onSettled: () => invalidateInbox(client),
  });
}

export function useRelease() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<ReleaseResponse>(`/api/admin/conversations/${id}/release`),
    onSettled: () => invalidateInbox(client),
  });
}

export function useReply() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      apiPost<ReplyResponse>(`/api/admin/conversations/${id}/reply`, { text }),
    onSettled: () => invalidateInbox(client),
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Segunda tanda: Conexiones, Clientes (ficha), Calendario, Canales, Configuración.
// ═════════════════════════════════════════════════════════════════════════════

// ── Clientes: ficha, versiones, usuarios, preview, aprovisionamiento ─────────
export function useTenantDetail(id: string | null) {
  return useQuery({
    queryKey: ['tenant-detail', id],
    queryFn: () => api<TenantDetailResponse>(`/api/admin/tenants/${id}`),
    enabled: Boolean(id),
  });
}

function invalidateTenant(client: QueryClient, id: string | null | undefined) {
  void client.invalidateQueries({ queryKey: ['tenants'] });
  if (id) {
    void client.invalidateQueries({ queryKey: ['tenant-detail', id] });
    void client.invalidateQueries({ queryKey: ['tenant-versions', id] });
    void client.invalidateQueries({ queryKey: ['tenant-provision', id] });
  }
}

export interface TenantSaveBody {
  [k: string]: unknown;
  note?: string;
  expected_updated_at?: string;
  twilio_auth_token?: string;
}

/** POST (alta) o PATCH (edición, con el bloqueo optimista de expected_updated_at). */
export function useTenantSave() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: TenantSaveBody }) =>
      id
        ? apiPatch<TenantSaveResponse>(`/api/admin/tenants/${id}`, body)
        : apiPost<TenantSaveResponse>('/api/admin/tenants', body),
    onSuccess: (_d, { id }) => invalidateTenant(client, id),
  });
}

export function useTenantVersions(id: string | null) {
  return useQuery({
    queryKey: ['tenant-versions', id],
    queryFn: () => api<TenantVersionsResponse>(`/api/admin/tenants/${id}/versions`),
    enabled: Boolean(id),
  });
}

export function useVersionRestore() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, versionId }: { id: string; versionId: number }) =>
      apiPost<TenantSaveResponse>(`/api/admin/tenants/${id}/versions/${versionId}/restore`),
    onSuccess: (_d, { id }) => invalidateTenant(client, id),
  });
}

export function useTenantUsers(id: string | null) {
  return useQuery({
    queryKey: ['tenant-users', id],
    queryFn: () => api<TenantUsersResponse>(`/api/admin/tenants/${id}/users`),
    enabled: Boolean(id),
  });
}

export function useUserAdd() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) =>
      apiPost<UserMutationResponse>(`/api/admin/tenants/${id}/users`, { email }),
    onSettled: (_d, _e, { id }) => void client.invalidateQueries({ queryKey: ['tenant-users', id] }),
  });
}

export function useUserDelete() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) =>
      apiDelete<UserMutationResponse>(`/api/admin/tenants/${id}/users/${encodeURIComponent(email)}`),
    onSettled: (_d, _e, { id }) => void client.invalidateQueries({ queryKey: ['tenant-users', id] }),
  });
}

export function usePreview() {
  return useMutation({
    mutationFn: ({ id, prompt, message }: { id: string; prompt: string; message: string }) =>
      apiPost<PreviewResponse>(`/api/admin/tenants/${id}/preview`, { prompt, message }),
  });
}

export function useProvision(id: string | null) {
  return useQuery({
    queryKey: ['tenant-provision', id],
    queryFn: () => api<ProvisionState>(`/api/admin/tenants/${id}/provision`),
    enabled: Boolean(id),
  });
}

/**
 * Un paso de aprovisionamiento. El llamante DEBE recargar la ficha entera al terminar
 * (regla §7 del rediseño): refresca updated_at (evita stale_tenant en el siguiente
 * Guardar) y repuebla los inputs con el SID recién creado — aquí se invalida todo lo
 * del tenant para forzarlo.
 */
export function useProvisionStep() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, step, body }: { id: string; step: string; body?: unknown }) =>
      apiPost<unknown>(`/api/admin/tenants/${id}/provision/${step}`, body ?? {}),
    onSettled: (_d, _e, { id }) => invalidateTenant(client, id),
  });
}

// ── Conexiones: Telegram, WhatsApp, canales del tenant, avisos, logo ─────────
export function useTenantTelegram(id: string | null) {
  return useQuery({
    queryKey: ['tenant-telegram', id],
    queryFn: () => api<TelegramInfoResponse>(`/api/admin/tenants/${id}/telegram`),
    enabled: Boolean(id),
  });
}

export function useTenantChannels(id: string | null) {
  return useQuery({
    queryKey: ['tenant-channels', id],
    queryFn: () => api<{ channels: TenantChannel[] }>(`/api/admin/tenants/${id}/channels`),
    enabled: Boolean(id),
  });
}

export function useTenantWhatsapp(id: string | null) {
  return useQuery({
    queryKey: ['tenant-whatsapp', id],
    queryFn: () => api<WhatsappInfoResponse>(`/api/admin/tenants/${id}/whatsapp`),
    enabled: Boolean(id),
  });
}

/**
 * El horario en vigor (con el default aplicado) y la tz, leídos de /availability:
 * el cliente sin parámetro; velai con ?tenant= (su selector de la cabecera).
 */
export function useTenantHours(id: string | null, isCliente: boolean) {
  return useQuery({
    queryKey: ['tenant-hours', id, isCliente],
    queryFn: () => api<Availability>(`/api/admin/availability${isCliente ? '' : `?tenant=${encodeURIComponent(id ?? '')}`}`),
    enabled: Boolean(id),
  });
}

function invalidateConexiones(client: QueryClient, id: string) {
  for (const k of ['tenant-telegram', 'tenant-channels', 'tenant-whatsapp', 'tenant-hours'] as const) {
    void client.invalidateQueries({ queryKey: [k, id] });
  }
}

/** Mutación genérica del dominio Conexiones: al asentarse recarga las tarjetas del tenant. */
function useConexionMutation<TData, TVars extends { id: string }>(fn: (vars: TVars) => Promise<TData>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: (_d: TData | undefined, _e: unknown, vars: TVars) => invalidateConexiones(client, vars.id),
  });
}

export function useTelegramLink() {
  return useMutation({
    mutationFn: ({ id }: { id: string }) => apiPost<TelegramLinkResponse>(`/api/admin/tenants/${id}/telegram/link`),
  });
}
export function useTelegramUnlink() {
  return useConexionMutation(({ id }: { id: string }) => apiDelete<OkResponse>(`/api/admin/tenants/${id}/telegram`));
}
export function useTelegramWhitelabel() {
  return useConexionMutation(({ id, enable }: { id: string; enable: boolean }) =>
    apiPatch<{ ok: true; whitelabel: boolean }>(`/api/admin/tenants/${id}/telegram`, { whitelabel: enable }),
  );
}
export function useTelegramBotSave() {
  return useConexionMutation(({ id, token }: { id: string; token: string }) =>
    apiPost<TelegramBotResponse>(`/api/admin/tenants/${id}/telegram/bot`, { token }),
  );
}
export function useTelegramBotDelete() {
  return useConexionMutation(({ id }: { id: string }) => apiDelete<OkResponse>(`/api/admin/tenants/${id}/telegram/bot`));
}
export function useTopicAdd() {
  return useConexionMutation(({ id, name, description }: { id: string; name: string; description: string }) =>
    apiPost<TopicsResponse>(`/api/admin/tenants/${id}/telegram/topics`, { name, description }),
  );
}
export function useTopicPatch() {
  return useConexionMutation(({ id, threadId, description }: { id: string; threadId: number; description: string }) =>
    apiPatch<TopicsResponse>(`/api/admin/tenants/${id}/telegram/topics/${threadId}`, { description }),
  );
}
export function useTopicDelete() {
  return useConexionMutation(({ id, threadId }: { id: string; threadId: number }) =>
    apiDelete<TopicsResponse>(`/api/admin/tenants/${id}/telegram/topics/${threadId}`),
  );
}
/** PATCH /notify: números de aviso, informe semanal y horario de atención. */
export function useNotifyPatch() {
  return useConexionMutation(({ id, body }: { id: string; body: Record<string, unknown> }) =>
    apiPatch<OkResponse>(`/api/admin/tenants/${id}/notify`, body),
  );
}
export function useReportTest() {
  return useMutation({
    mutationFn: ({ id }: { id: string }) => apiPost<OkResponse>(`/api/admin/tenants/${id}/report/test`),
  });
}
/** Registrar el webhook del bot de Velai (solo velai, una vez por bot). */
export function useTelegramSetup() {
  return useMutation({
    mutationFn: () => apiPost<TelegramSetupResponse>('/api/admin/telegram/setup'),
  });
}
/** Subida del logo: cuerpo binario con el Content-Type del archivo. */
export function useLogoUpload() {
  return useConexionMutation(({ id, file, channels }: { id: string; file: File; channels: string[] }) =>
    api<LogoUploadResponse>(`/api/admin/tenants/${id}/logo${channels.length ? `?channels=${channels.join(',')}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    }),
  );
}
export function useLogoApply() {
  return useConexionMutation(({ id }: { id: string }) => apiPost<ProfileApplyResponse>(`/api/admin/tenants/${id}/logo/apply`));
}
/** Sincronizar el sender desde Twilio / aplicar la marca al perfil (solo velai). */
export function useSenderSync() {
  return useConexionMutation(({ id }: { id: string }) => apiPost<SenderSyncResponse>(`/api/admin/tenants/${id}/provision/sender/sync`));
}
export function useSenderProfile() {
  return useConexionMutation(({ id }: { id: string }) => apiPost<ProfileApplyResponse>(`/api/admin/tenants/${id}/provision/sender/profile`));
}

// ── Calendario ───────────────────────────────────────────────────────────────
export function useCalendar(id: string | null) {
  return useQuery({
    queryKey: ['tenant-calendar', id],
    queryFn: () => api<CalendarResponse>(`/api/admin/tenants/${id}/calendar`),
    enabled: Boolean(id),
  });
}
export function useCalendarConnect() {
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiPost<CalendarConnectResponse>(`/api/admin/tenants/${id}/calendar/connect`, { provider: 'google' }),
  });
}
export function useCalendarPatch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiPatch<OkResponse>(`/api/admin/tenants/${id}/calendar`, body),
    onSettled: (_d, _e, { id }) => void client.invalidateQueries({ queryKey: ['tenant-calendar', id] }),
  });
}
export function useCalendarDisconnect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => apiDelete<OkResponse>(`/api/admin/tenants/${id}/calendar`),
    onSettled: (_d, _e, { id }) => void client.invalidateQueries({ queryKey: ['tenant-calendar', id] }),
  });
}
/** Config del addon Confirmaciones (PATCH /reminders): interruptor y/o antelación
 *  (lista curada — cambiar la antelación NO exige nueva aprobación de la plantilla).
 *  SOLO velai — el worker responde 403 al rol cliente. Recarga el calendario. */
export function useRemindersPatch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled, hours }: { id: string; enabled?: boolean; hours?: number }) =>
      apiPatch<{ ok: true; enabled?: boolean; hours?: number }>(`/api/admin/tenants/${id}/reminders`, {
        ...(enabled === undefined ? {} : { enabled }),
        ...(hours === undefined ? {} : { hours }),
      }),
    onSettled: (_d, _e, { id }) => void client.invalidateQueries({ queryKey: ['tenant-calendar', id] }),
  });
}
/**
 * Crea una plantilla del CATÁLOGO (worker/plantillas.js) vía el paso genérico de
 * aprovisionamiento /provision/plantillas/<kind> (solo velai). Hoy la usa la card de
 * Confirmaciones con kind 'recordatorio_cita'; una futura vista de catálogo puede
 * reutilizar este mismo hook con otros kinds (ver panel/TODO.md).
 */
export function useTemplateCreate() {
  const client = useQueryClient();
  return useMutation({
    // opciones: {botones: <id de pareja curada>, antelacion: 12|24|48} — el worker las
    // valida contra el catálogo; sin opciones aplica los defaults (retrocompatible).
    mutationFn: ({ id, kind, opciones }: { id: string; kind: string; opciones?: { botones?: string; antelacion?: number } }) =>
      apiPost<{ ok: true; kind: string; sid: string; status: string }>(`/api/admin/tenants/${id}/provision/plantillas/${kind}`, opciones ?? {}),
    onSettled: (_d, _e, { id }) => {
      void client.invalidateQueries({ queryKey: ['tenant-calendar', id] });
      // La matriz de la vista Plantillas enseña la misma celda: se recarga también.
      void client.invalidateQueries({ queryKey: ['plantillas'] });
    },
  });
}
/** La matriz de la vista «Plantillas» — SOLO velai (el worker responde 403 al cliente). */
export function usePlantillas(enabled: boolean) {
  return useQuery({
    queryKey: ['plantillas'],
    queryFn: () => api<PlantillasResponse>('/api/admin/plantillas'),
    enabled,
  });
}
/** Solicitudes de cambio (0032): el cliente ve las suyas; velai las pendientes. */
export function useSolicitudes(enabled: boolean) {
  return useQuery({
    queryKey: ['solicitudes'],
    queryFn: () => api<SolicitudesResponse>('/api/admin/solicitudes'),
    enabled,
  });
}
/** El cliente pide un cambio: nada se aplica hasta que Velai lo apruebe. */
export function useSolicitudCreate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { tipo: string; botones?: string; antelacion?: number }) =>
      apiPost<{ ok: true; id: number | null; status: 'pending' }>('/api/admin/solicitudes', body),
    onSettled: () => void client.invalidateQueries({ queryKey: ['solicitudes'] }),
  });
}
/** Velai resuelve: aprobar APLICA (la nota solo va al rechazar y es obligatoria). */
export function useSolicitudResolve() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accion, nota }: { id: number; accion: 'aprobar' | 'rechazar'; nota?: string }) =>
      apiPost<{ ok: true; status: string }>(`/api/admin/solicitudes/${id}/${accion}`, nota === undefined ? {} : { nota }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['solicitudes'] });
      // Aprobar puede haber recreado la plantilla y cambiado la antelación.
      void client.invalidateQueries({ queryKey: ['plantillas'] });
      void client.invalidateQueries({ queryKey: ['tenant-calendar'] });
    },
  });
}
export function useAppointments(tenant: string | null, from: string, to: string, isCliente: boolean) {
  return useQuery({
    queryKey: ['appointments', tenant, from, to],
    queryFn: () =>
      api<AppointmentsResponse>(
        `/api/admin/appointments${qs({ tenant: isCliente ? undefined : tenant ?? undefined, from, to })}`,
      ),
    enabled: Boolean(tenant),
  });
}

// ── Canales (vista global, solo velai) ───────────────────────────────────────
export function useGlobalChannels() {
  return useQuery({
    queryKey: ['channels'],
    queryFn: () => api<ChannelsResponse>('/api/admin/channels'),
  });
}

// ── Configuración ────────────────────────────────────────────────────────────
export function useAdmins() {
  return useQuery({
    queryKey: ['admins'],
    queryFn: () => api<AdminsResponse>('/api/admin/admins'),
  });
}
export function useAdminAdd() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => apiPost<AdminMutationResponse>('/api/admin/admins', { email }),
    onSettled: () => void client.invalidateQueries({ queryKey: ['admins'] }),
  });
}
export function useAdminDelete() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => apiDelete<AdminMutationResponse>(`/api/admin/admins/${encodeURIComponent(email)}`),
    onSettled: () => void client.invalidateQueries({ queryKey: ['admins'] }),
  });
}
/** El servidor decide con 403 root_only; el panel solo pinta (retry ya está apagado en 4xx). */
export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api<ConfigInfo>('/api/admin/config'),
  });
}
export function useCfTokenSave() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => apiPost<CfTokenSaveResponse>('/api/admin/config/cf-token', { token }),
    onSettled: () => void client.invalidateQueries({ queryKey: ['config'] }),
  });
}
export function useCfTokenClear() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete<CfTokenClearResponse>('/api/admin/config/cf-token'),
    onSettled: () => void client.invalidateQueries({ queryKey: ['config'] }),
  });
}
/**
 * Diagnóstico del webhook de Telegram: bajo demanda y no al abrir la vista — es una
 * llamada a un tercero para un dato que casi nunca cambia. Por eso es una mutación
 * (el botón «Comprobar»), no una query.
 */
export function useWebhookCheck() {
  return useMutation({
    mutationFn: () => api<WebhookInfo>('/api/admin/config/telegram-webhook'),
  });
}
