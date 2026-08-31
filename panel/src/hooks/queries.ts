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
import { api, apiPatch, apiPost, qs } from '../api/client';
import { quietRefetch } from '../api/queryClient';
import type {
  AiBalance,
  AiUsage,
  Availability,
  EscalationsResponse,
  InboxResponse,
  LeadDetail,
  LeadsResponse,
  Me,
  OkResponse,
  ReleaseResponse,
  ReplyResponse,
  Stats,
  TakeoverResponse,
  TenantsResponse,
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
