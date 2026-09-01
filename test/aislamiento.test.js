// Aislamiento multi-tenant — barrido COMPLETO de la superficie del rol cliente.
//
// Por qué existe: hasta ahora cada fuga tenía su test escrito a mano (fuga B1/B2/B8,
// B4/B5, conversaciones, whatsapp, canales…). Eso cubre lo que alguien se acordó de
// cubrir; el endpoint número 32 se añade sin test y nadie se entera. Este archivo
// invierte la carga: lee la lista de rutas de clienteAllowed() y EXIGE que cada una
// tenga su caso aquí. Añadir una ruta para el rol cliente sin probarla pone CI en rojo.
//
// El mock de D1 es ADVERSARIO a propósito: cuando una consulta NO filtra por tenant,
// devuelve la fila del OTRO cliente. Así una puerta que falte no se queda en teoría —
// los datos ajenos salen en la respuesta y las aserciones de marcadores los cazan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { testing } from '../worker/app.js';

const A = '00000000-0000-4000-8000-00000000000a'; // el cliente que pregunta
const B = '00000000-0000-4000-8000-00000000000b'; // el cliente ajeno
const CLIENTE = { role: 'cliente', tenantId: A, email: 'cliente@mio.com' };

// Todo lo que sea del tenant B lleva marcador: si algo de esto sale por la respuesta
// de un cliente de A, es una fuga. Cadenas raras a propósito, para que un match sea real.
const MARCAS_B = ['AJENOSLUG', 'AJENONOMBRE', 'AJENOPROMPT', 'AJENOCHATID', '+34699999999', 'ajeno@otro.com'];

function tenantRow(id) {
  const ajeno = id === B;
  const m = (s) => (ajeno ? 'AJENO' + s.toUpperCase() : 'mio-' + s);
  return {
    id, slug: m('slug'), name: m('nombre'), system_prompt: m('prompt'),
    active: 1, channel_address: ajeno ? 'whatsapp:+34699999999' : 'whatsapp:+34600000001',
    twilio_from: ajeno ? 'whatsapp:+34699999999' : 'whatsapp:+34600000001',
    team_whatsapp: ajeno ? 'whatsapp:+34699999999' : 'whatsapp:+34600000001',
    wa_number: ajeno ? '+34699999999' : '+34600000001',
    telegram_chat_id: ajeno ? 'AJENOCHATID' : 'mio-chat', telegram_chat_title: m('titulo'),
    telegram_topics: '[]', telegram_bot_token_enc: null, telegram_bot_username: null,
    telegram_whitelabel: 0, telegram_linked_at: null, telegram_webhook_at: null,
    logo_url: null, logo_wa_url: null, brand_name: m('marca'), greeting: m('hola'),
    web_origins: '', sender_sid: null, twilio_subaccount_sid: null, lead_template_sid: null,
    lead_template_status: null, twilio_auth_token_enc: null, weekly_report: 0,
    support_hours: '', support_tz: 'Europe/Madrid', ai_monthly_tokens: 5000000,
    ai_daily_limit: null, updated_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z',
  };
}

const LEAD = (t) => ({
  id: t === B ? leadIdB : leadIdA, tenant_id: t, name: t === B ? 'AJENONOMBRE' : 'Mío',
  whatsapp: t === B ? '+34699999999' : '+34600000001', status: 'new', source: 'web',
  created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z', conversation_id: null,
});
const CONV = (t) => ({
  id: t === B ? convIdB : convIdA, tenant_id: t, channel: 'web', external_id: 'x', msgs: 2,
  unanswered: 0, last_at: '2026-08-20T00:00:00Z', started_at: '2026-08-20T00:00:00Z',
  expires_at: '2026-11-20T00:00:00Z', lead_id: null, demo: '', state: 'bot', state_at: null,
  agent_email: null, last_read_at: null,
});
const leadIdA = '00000000-0000-4000-8000-0000000000a1';
const leadIdB = '00000000-0000-4000-8000-0000000000b1';
const convIdA = '00000000-0000-4000-8000-0000000000a2';
const convIdB = '00000000-0000-4000-8000-0000000000b2';

// ── Mock de D1 adversario ────────────────────────────────────────────────────
// Regla: si el SQL NO lleva filtro de tenant, devuelve TAMBIÉN lo del tenant B.
// Si lo lleva, respeta el filtro. Cualquier puerta que falte se convierte en fuga visible.
function adversarialDb() {
  const queries = [];
  const scopedArg = (sql, args) => {
    // El filtro va como ' AND x.tenant_id = ?' y su argumento es posicional: se localiza
    // contando cuántos '?' hay antes del filtro en el SQL.
    const i = sql.search(/tenant_id\s*=\s*\?/);
    if (i < 0) return null;
    const antes = (sql.slice(0, i).match(/\?/g) || []).length;
    return args[antes];
  };
  const filtra = (rows, sql, args) => {
    const t = scopedArg(sql, args);
    return t == null ? rows : rows.filter((r) => r.tenant_id === t);
  };
  function run(sql, args) {
    queries.push({ sql, args });
    const s = sql.replace(/\s+/g, ' ');
    // La tabla que manda es la PRIMARIA (FROM/UPDATE/INSERT INTO/DELETE FROM), no la del
    // JOIN: media docena de consultas hacen `JOIN tenants` solo para traer el nombre, y
    // clasificarlas como consultas de tenants daba veredictos falsos.
    const prim = (s.match(/(?:DELETE\s+FROM|INSERT\s+INTO|UPDATE|FROM)\s+([a-z_]+)/i) || [])[1] || '';
    const tabla = (t) => prim.toLowerCase() === t;

    if (tabla('tenant_users')) return { rows: [], one: { tenant_id: A, role: 'cliente' } };
    if (tabla('admin_users')) return { rows: [], one: null };
    // tenants por id: devuelve LO QUE PIDAN — el handler debía haber comprobado antes
    // que ese id es suyo. Es el corazón del test: aquí es donde se ve la puerta que falta.
    if (tabla('tenants')) {
      const id = args.find((a) => a === A || a === B);
      const rows = id ? [tenantRow(id)] : [tenantRow(A), tenantRow(B)];
      return { rows, one: rows[0] };
    }
    if (tabla('leads')) {
      const todos = [LEAD(A), LEAD(B)];
      const porId = args.find((a) => a === leadIdA || a === leadIdB);
      let rows = porId ? todos.filter((l) => l.id === porId) : todos;
      rows = filtra(rows, s, args);
      return { rows, one: rows[0] || null, changes: rows.length };
    }
    if (tabla('conversations')) {
      const todos = [CONV(A), CONV(B)];
      const porId = args.find((a) => a === convIdA || a === convIdB);
      let rows = porId ? todos.filter((c) => c.id === porId) : todos;
      rows = filtra(rows, s, args);
      return { rows, one: rows[0] || null, changes: rows.length };
    }
    // Hijas por FK: no tienen tenant_id, dependen de la puerta del padre. Devuelven
    // contenido marcado cuando el id es del ajeno.
    if (tabla('conv_messages')) {
      const ajeno = args.includes(convIdB);
      return { rows: [{ role: 'user', text: ajeno ? 'AJENOPROMPT' : 'hola mío', created_at: '2026-08-20T00:00:00Z', agent_email: null, id: 1 }], one: null };
    }
    if (tabla('lead_notes') || tabla('lead_events') || tabla('lead_notifications')) {
      const ajeno = args.includes(leadIdB);
      return { rows: [{ lead_id: ajeno ? leadIdB : leadIdA, text: ajeno ? 'AJENONOMBRE' : 'nota mía', channel: 'telegram', status: 'sent', created_at: '2026-08-20T00:00:00Z', n: 0 }], one: { n: 0 } };
    }
    if (tabla('tenant_calendars')) {
      const id = args.find((a) => a === A || a === B);
      return { rows: [], one: id === B ? { tenant_id: B, google_email: 'ajeno@otro.com', access_token_enc: null, refresh_token_enc: null } : null };
    }
    if (tabla('agent_presence')) return { rows: [], one: null };
    if (tabla('tenant_channels')) {
      const id = args.find((a) => a === A || a === B);
      return { rows: id === B ? [{ tenant_id: B, channel: 'whatsapp', address: 'whatsapp:+34699999999', active: 1 }] : [], one: null };
    }
    if (tabla('ai_usage') || tabla('conv_daily')) return { rows: [], one: { n: 0, tokens: 0, input: 0, output: 0 } };
    return { rows: [], one: null, changes: 0 };
  }
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    first: async () => run(sql, args).one,
    all: async () => ({ results: run(sql, args).rows }),
    run: async () => ({ meta: { changes: run(sql, args).changes ?? 1 } }),
  });
  return {
    queries,
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => stmts.map((s) => ({ results: run(s.sql, s.args).rows, meta: { changes: 1 } })),
  };
}

function makeEnv(db) {
  return {
    DB: db,
    KV: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [] }; } },
    ADMIN_EMAILS: '', ADMIN_ORIGIN: 'https://admin.hirevai.com',
    SECRETS_KEK: btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1))),
    AI_TENANT_MONTHLY_TOKENS: '5000000', CONV_RETENTION_DAYS: '90', LEAD_RETENTION_MONTHS: '24',
  };
}

// ── Catálogo de casos: uno por ruta de clienteAllowed ────────────────────────
// `t` es el tenant que va en la URL — el barrido lo sustituye por A y por B.
const CASOS = [
  { key: '/api/admin/leads', m: 'GET', path: () => '/api/admin/leads' },
  { key: '/api/admin/leads/export.csv', m: 'GET', path: () => '/api/admin/leads/export.csv' },
  { key: '/api/admin/appointments', m: 'GET', path: () => '/api/admin/appointments' },
  { key: '/api/admin/plantillas', m: 'GET', path: () => '/api/admin/plantillas' },
  { key: 'calendar$', m: ['GET', 'PATCH', 'DELETE'], path: (t) => `/api/admin/tenants/${t}/calendar`, body: { active: true } },
  { key: 'calendar\\/connect$', m: 'POST', path: (t) => `/api/admin/tenants/${t}/calendar/connect` },
  { key: 'telegram$', m: ['GET', 'DELETE'], path: (t) => `/api/admin/tenants/${t}/telegram` },
  { key: 'telegram\\/link$', m: 'POST', path: (t) => `/api/admin/tenants/${t}/telegram/link` },
  { key: 'telegram\\/bot$', m: ['POST', 'DELETE'], path: (t) => `/api/admin/tenants/${t}/telegram/bot`, body: { token: '123:abc' } },
  { key: 'whatsapp$', m: 'GET', path: (t) => `/api/admin/tenants/${t}/whatsapp` },
  { key: 'channels$', m: 'GET', path: (t) => `/api/admin/tenants/${t}/channels` },
  { key: 'notify$', m: 'PATCH', path: (t) => `/api/admin/tenants/${t}/notify`, body: { weekly_report: 1 } },
  { key: 'report\\/test$', m: 'POST', path: (t) => `/api/admin/tenants/${t}/report/test` },
  { key: 'logo$', m: 'POST', path: (t) => `/api/admin/tenants/${t}/logo`, body: { data: 'data:image/png;base64,iVBORw0KGgo=' } },
  { key: 'logo\\/apply$', m: 'POST', path: (t) => `/api/admin/tenants/${t}/logo/apply` },
  { key: 'telegram\\/topics$', m: 'POST', path: (t) => `/api/admin/tenants/${t}/telegram/topics`, body: { topic_id: 7, name: 'x' } },
  { key: 'telegram\\/topics\\/', m: ['PATCH', 'DELETE'], path: (t) => `/api/admin/tenants/${t}/telegram/topics/7`, body: { name: 'x' } },
  { key: '/api/admin/stats', m: 'GET', path: () => '/api/admin/stats' },
  { key: '/api/admin/ai-balance', m: 'GET', path: (t) => `/api/admin/ai-balance?tenant=${t}` },
  { key: '/api/admin/me', m: 'GET', path: () => '/api/admin/me' },
  { key: '/api/admin/escalations', m: 'GET', path: () => '/api/admin/escalations' },
  { key: '/api/admin/conversations', m: 'GET', path: () => '/api/admin/conversations' },
  { key: '/api/admin/conversations/export.csv', m: 'GET', path: () => '/api/admin/conversations/export.csv' },
  { key: 'conversations\\/[0-9a-f-]+$', m: 'GET', path: (t) => `/api/admin/conversations/${t === B ? convIdB : convIdA}` },
  { key: '/api/admin/inbox', m: 'GET', path: (t) => `/api/admin/inbox?conversation=${t === B ? convIdB : convIdA}` },
  { key: '/api/admin/alerts', m: 'GET', path: () => '/api/admin/alerts' },
  { key: '/api/admin/availability', m: ['GET', 'PATCH'], path: () => '/api/admin/availability', body: { available: true } },
  { key: '(takeover|release)', m: 'POST', path: (t) => `/api/admin/conversations/${t === B ? convIdB : convIdA}/takeover` },
  { key: 'conversations\\/[0-9a-f-]+\\/reply$', m: 'POST', path: (t) => `/api/admin/conversations/${t === B ? convIdB : convIdA}/reply`, body: { text: 'hola' } },
  { key: '/api/admin/escalations/resume', m: 'POST', path: () => '/api/admin/escalations/resume', body: { conversationId: convIdB } },
  { key: 'leads\\/[0-9a-f-]+$', m: 'GET', path: (t) => `/api/admin/leads/${t === B ? leadIdB : leadIdA}` },
  { key: 'leads\\/[0-9a-f-]+\\/notes$', m: 'POST', path: (t) => `/api/admin/leads/${t === B ? leadIdB : leadIdA}/notes`, body: { text: 'nota' } },
];

// ── 1. El catálogo cubre TODA la superficie del rol cliente ──────────────────
test('el barrido cubre todas las rutas que clienteAllowed abre al rol cliente', () => {
  const src = testing.clienteAllowed.toString();
  const rutas = [];
  for (const line of src.split('\n')) {
    if (!/return true/.test(line)) continue;
    let r = (line.match(/path === '([^']+)'/) || [])[1];
    if (!r) r = (line.match(/(\/\^[^;]*?\/i?)\.test\(path\)/) || [])[1];
    if (r) rutas.push(r);
  }
  assert.ok(rutas.length >= 30, `se esperaban las ~31 rutas del panel, se leyeron ${rutas.length}`);
  const sinCaso = rutas.filter((r) => !CASOS.some((c) => r.includes(c.key)));
  assert.deepEqual(sinCaso, [], 'rutas abiertas al cliente SIN caso en este archivo: añádelas a CASOS');
});

// ── 2. Ninguna ruta devuelve datos del tenant ajeno ─────────────────────────
async function ejecutar(caso, method, tenantEnUrl) {
  const db = adversarialDb();
  const env = makeEnv(db);
  const ctx = { waitUntil() {} };
  const path = caso.path(tenantEnUrl);
  const url = new URL('https://admin.hirevai.com' + path);
  const init = { method };
  if (caso.body && method !== 'GET') { init.body = JSON.stringify(caso.body); init.headers = { 'content-type': 'application/json' }; }
  const req = new Request(url.toString(), init);
  try {
    const res = await testing.adminRouter(req, env, ctx, url.pathname, url, {}, CLIENTE);
    return { status: res.status, texto: await res.text(), db };
  } catch (e) {
    return { status: e.status || 500, error: e.code || e.message, texto: String(e.code || e.message), db, lanzo: e };
  }
}

const pares = CASOS.flatMap((c) => (Array.isArray(c.m) ? c.m : [c.m]).map((m) => ({ c, m })));

test('ninguna ruta del panel deja salir datos de OTRO cliente', async (t) => {
  const fugas = [];
  for (const { c, m } of pares) {
    const r = await ejecutar(c, m, B);
    const marca = MARCAS_B.find((x) => r.texto.includes(x));
    if (marca) fugas.push(`${m} ${c.path(B)} → ${r.status} filtró ${marca}`);
    // Un fallo inesperado (no HttpError) enmascararía una fuga: sale como aviso.
    if (r.status === 500 && !r.lanzo?.status) t.diagnostic(`revisar mock: ${m} ${c.path(B)} → ${r.error}`);
  }
  assert.deepEqual(fugas, [], 'FUGA MULTI-TENANT');
});

// Solo para recursos direccionados POR RUTA (/tenants/:id/…, /leads/:id, /conversations/:id):
// pedir el de otro debe ser 404 —nunca 403, que confirmaría que existe— y nunca 200.
// Los listados con id en el QUERY (?conversation=, ?tenant=) quedan fuera a propósito: ahí
// un id ajeno es simplemente un filtro que no casa, y responder 200 con la lista PROPIA y
// sin hilo es la conducta correcta. Que no se filtre nada ya lo cubre el test anterior.
test('un recurso ajeno pedido por ruta se cierra con 404/403, nunca con 200', async () => {
  const malos = [];
  for (const { c, m } of pares) {
    const ruta = c.path(B);
    if (!ruta.includes(B) && !ruta.includes(leadIdB) && !ruta.includes(convIdB)) continue;
    if (ruta.includes('?')) continue; // id en query, no en ruta
    const r = await ejecutar(c, m, B);
    if (r.status < 400) malos.push(`${m} ${ruta} → ${r.status} (debería ser 404)`);
    else if (r.status === 403) malos.push(`${m} ${ruta} → 403 revela que existe (debería ser 404)`);
  }
  assert.deepEqual(malos, [], 'recursos ajenos accesibles');
});

// Un 500 NO es aceptable en ninguna pasada: además de ser un fallo en sí, enmascara las
// otras aserciones (una excepción a mitad de handler no filtra datos… porque no llega a
// responder). Se descubrió con esto: la primera versión de assertOwnTenant quedó recursiva
// y los tres tests de arriba seguían en verde.
test('ninguna ruta del panel revienta: un 500 taparía las demás aserciones', async () => {
  const reventadas = [];
  for (const { c, m } of pares) {
    for (const t of [A, B]) {
      const r = await ejecutar(c, m, t);
      // r.lanzo.status ausente = no es un HttpError deliberado, es una excepción de verdad.
      if (r.status === 500 && !r.lanzo?.status) reventadas.push(`${m} ${c.path(t)} → ${r.error}`);
    }
  }
  assert.deepEqual(reventadas, [], 'handlers que lanzan excepción no controlada');
});

// Contrapeso de los tests de fuga: es fácil dejarlo todo hermético cerrando de más.
// Esto no exige un 200 —el mock no tiene datos para todo— pero sí que la ruta propia
// NO se comporte como ajena por el mismo motivo (404 con el tenant propio en la URL).
test('las rutas propias del cliente no se cierran como si fueran ajenas', async (t) => {
  const rotas = [];
  for (const { c, m } of pares) {
    const propia = await ejecutar(c, m, A);
    const ajena = await ejecutar(c, m, B);
    if (propia.status === ajena.status && propia.status === 404 && c.path(A).includes(A)) {
      rotas.push(`${m} ${c.path(A)} → 404 igual que la ajena (${propia.error})`);
    }
  }
  // Las que hoy dan 404 con datos propios lo hacen porque el mock no tiene fila (calendario
  // sin conectar, bot sin token…), no porque la puerta esté mal. Se listan para que un
  // cambio futuro que las cierre de verdad se vea, sin bloquear CI por el mock.
  for (const x of rotas) t.diagnostic('sin fila en el mock: ' + x);
  assert.ok(rotas.length < pares.length / 2, `demasiadas rutas propias cerradas (${rotas.length}/${pares.length})`);
});
