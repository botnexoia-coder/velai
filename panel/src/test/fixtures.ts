// Fixtures con la MISMA forma que devuelven los handlers de worker/app.js: si un test
// pasa con esto y el worker cambia la forma, lo que hay que tocar es types.ts y esto.
import type {
  Availability,
  InboxResponse,
  InboxRow,
  LeadsResponse,
  Me,
  Stats,
  TenantsResponse,
} from '../api/types';

export const meVelai: Me = { role: 'velai', tenantName: null, tenantLogo: null, tenantId: null };

export const meCliente: Me = {
  role: 'cliente',
  tenantName: 'Barbería López',
  tenantLogo: null,
  tenantId: '11111111-1111-4111-8111-111111111111',
};

export const stats: Stats = {
  total30: 42,
  sinContactar: 3,
  sinContactarDesde: '2026-08-20T10:00:00.000Z',
  fallidos7: 1,
  tenantsActivos: 5,
  porDia: [
    { d: '2026-08-30', n: 2, canales: [{ canal: 'web', n: 2 }] },
    { d: '2026-08-31', n: 5, canales: [{ canal: 'whatsapp', n: 3 }, { canal: 'web', n: 2 }] },
  ],
  porCanal: [
    { canal: 'whatsapp', n: 25 },
    { canal: 'web', n: 17 },
  ],
  fuentes: ['hirevai.com', 'landing-clinicas'],
  captura: {
    conversaciones: 120,
    leads: 42,
    porCanal: [
      { canal: 'web', convs: 80, leads: 17 },
      { canal: 'whatsapp', convs: 40, leads: 25 },
    ],
    desde: '2026-08-26',
    periodoCompleto: false,
  },
};

export const tenants: TenantsResponse = {
  tenants: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'barberia-lopez',
      name: 'Barbería López',
      channel_address: 'web:barberia-lopez',
      active: 1,
      updated_at: '2026-08-01T00:00:00.000Z',
      has_template: 1,
      has_team: 1,
      has_subaccount: 0,
      has_twilio_token: 0,
      has_from: 0,
      has_telegram: 1,
      meta_partner_status: 'pendiente',
      sender_status: null,
      channels: 'web',
      prompt_len: 1200,
      lead_count: 12,
    },
  ],
};

export function leadRow(over: Partial<LeadsResponse['leads'][number]> = {}): LeadsResponse['leads'][number] {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    tenant_name: 'Barbería López',
    created_at: '2026-08-30T09:30:00.000Z',
    updated_at: '2026-08-30T09:30:00.000Z',
    status: 'new',
    source: 'hirevai.com',
    name: 'Marta Ruiz',
    whatsapp: '+34600111222',
    need: 'Cita para color',
    context: 'Pregunta precios de coloración',
    sector: 'belleza',
    messages_per_day: null,
    channel: 'web',
    score: 4,
    note: null,
    page_url: 'https://hirevai.com/',
    conversation_id: null,
    expires_at: null,
    notification_summary: 'telegram:sent,whatsapp:failed',
    ...over,
  };
}

export const leadsPage1: LeadsResponse = {
  leads: [leadRow(), leadRow({ id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Otro Lead' })],
  nextCursor: '2026-08-30T09:30:00.000Z|aaaaaaaa-0000-4000-8000-000000000002',
};

export const leadsPage2: LeadsResponse = {
  leads: [leadRow({ id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Tercero' })],
  nextCursor: null,
};

export function inboxRow(over: Partial<InboxRow> = {}): InboxRow {
  return {
    id: 'bbbbbbbb-0000-4000-8000-000000000001',
    channel: 'web',
    external_id: 'c0ffee00-dead-4bea-9f00-000000000001',
    msgs: 6,
    unanswered: 0,
    last_at: '2026-08-31T11:52:00.000Z',
    lead_id: null,
    unread: 1,
    state: 'bot',
    state_at: null,
    agent_email: null,
    tenant_name: 'Barbería López',
    tenant_id: '11111111-1111-4111-8111-111111111111',
    lead_name: null,
    lead_status: null,
    preview: '¿Tenéis hueco mañana?',
    preview_role: 'user',
    ...over,
  };
}

export const inbox: InboxResponse = {
  conversations: [
    inboxRow(),
    inboxRow({
      id: 'bbbbbbbb-0000-4000-8000-000000000002',
      channel: 'whatsapp',
      external_id: 'whatsapp:+34600111222',
      state: 'esperando',
      state_at: new Date(Date.now() - 4 * 60000).toISOString(),
      unread: 0,
    }),
  ],
  counts: [
    { channel: 'web', n: 1, unread: 1, waiting: 0 },
    { channel: 'whatsapp', n: 1, unread: 0, waiting: 1 },
  ],
  thread: null,
  queueMin: 15,
  pingMin: 5,
};

export const inboxConThread: InboxResponse = {
  ...inbox,
  thread: {
    conversation: {
      id: 'bbbbbbbb-0000-4000-8000-000000000001',
      channel: 'web',
      external_id: 'c0ffee00-dead-4bea-9f00-000000000001',
      msgs: 2,
      unanswered: 0,
      started_at: '2026-08-31T11:00:00.000Z',
      last_at: '2026-08-31T11:52:00.000Z',
      state: 'humano',
      state_at: '2026-08-31T11:50:00.000Z',
      agent_email: 'ana@velai.ai',
      lead_id: null,
      expires_at: '2026-11-29T11:00:00.000Z',
      tenant_name: 'Barbería López',
    },
    messages: [
      { role: 'user', text: 'Hola, ¿tenéis hueco mañana?', created_at: '2026-08-31T11:00:00.000Z' },
      { role: 'assistant', text: '¡Claro! ¿Por la mañana o por la tarde?', created_at: '2026-08-31T11:00:10.000Z' },
    ],
    window: { open: true, web: true, away: false, seenAt: '2026-08-31T11:52:00.000Z' },
  },
};

export const availability: Availability = {
  available: true,
  withinHours: true,
  offering: true,
  advisors: 2,
  hours: { mon: [['09:00', '19:00']] },
  tz: 'Europe/Madrid',
  graceMin: 5,
  forTenant: 'Velai',
};

/**
 * Router de fetch para los tests: casa por ruta (sin query) y devuelve el fixture.
 * Cualquier ruta no declarada es un 404 del worker ({error:'not_found'}).
 */
export function mockFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.split('?')[0] ?? url;
    if (path in routes) {
      return new Response(JSON.stringify(routes[path]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}
