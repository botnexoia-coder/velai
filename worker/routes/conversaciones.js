// Dominio CONVERSACIONES del panel: la bandeja (inbox/alerts), el listado y su CSV,
// la transcripción, el control de la conversación (takeover/release/reply), la
// disponibilidad de asesores y las escalaciones. Migrado tal cual del adminRouter
// monolítico — misma conducta, mismos códigos.
//
// Aislamiento: TODO listado lleva scopeClause con alias 'c' (scc.sql) y el detalle
// resuelve la propiedad en el propio WHERE (ajeno = 404, nunca 403). Atender —no
// solo ver— exige además canAttend: Velai ve todas pero solo atiende las suyas.
import { Hono } from 'hono';
import { partesAdmin, scopeClause } from '../middleware.js';
import { DEFAULT_BUSINESS_HOURS } from '../calendar.js';
import {
  HttpError, json, NO_STORE, clean, readJson, rateLimited, csvCell, convFilters,
  convAppend, replyWindow, canAttend, sendTwilioText, velaiTenantId,
  withinSupportHours, UUID_RE, QUEUE_MAX_MIN, TAKEOVER_GRACE_MIN,
} from '../app.js';

export const conversaciones = new Hono();

conversaciones.get('/api/admin/escalations', async (c) => {
  const { env, scope } = partesAdmin(c);
  if (!env.KV) return json({ escalations: [] }, 200, NO_STORE);
  const prefix = scope.tenantId ? `pause:${scope.tenantId}:` : 'pause:';
  const list = await env.KV.list({ prefix, limit: 100 });
  const escalations = list.keys.map((k) => {
    const rest = k.name.slice('pause:'.length);
    const cut = rest.indexOf(':');
    return { tenantId: rest.slice(0, cut), from: rest.slice(cut + 1) };
  });
  return json({ escalations }, 200, NO_STORE);
});

conversaciones.post('/api/admin/escalations/resume', async (c) => {
  const { request, env, scope } = partesAdmin(c);
  const body = await readJson(request, 2000);
  // Un cliente solo puede reanudar SUS conversaciones: su tenantId manda.
  const tenantId = scope.tenantId || clean(body.tenantId, 40);
  const from = clean(body.from, 80);
  if (!tenantId || !from) throw new HttpError(400, 'invalid_resume');
  if (env.KV) { try { await env.KV.delete(`pause:${tenantId}:${from}`); } catch (_) {} }
  console.log(JSON.stringify({ level: 'info', code: 'bot_resumed', actor_role: scope.role }));
  return json({ ok: true }, 200, NO_STORE);
});

// ── Conversaciones (migración 0021) ────────────────────────────────────────
// El hueco de paridad número uno: hasta ahora la conversación vivía en KV con TTL de
// 24 h y cuando un lead salía mal no había forma de mirar qué pasó.
conversaciones.get('/api/admin/conversations', async (c) => {
  const { env, url, scope } = partesAdmin(c);
  const f = convFilters(url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  // Mismo cursor por tupla que los leads: un last_at repetido en el borde de página no
  // se salta conversaciones.
  const cursor = clean(url.searchParams.get('cursor'), 80);
  if (cursor) {
    const [cAt, cId] = cursor.split('|');
    if (cId) { f.sql += ' AND (c.last_at < ? OR (c.last_at = ? AND c.id < ?))'; f.values.push(cAt, cAt, cId); }
    else { f.sql += ' AND c.last_at < ?'; f.values.push(cAt); }
  }
  const scc = scopeClause(scope, 'c');
  const rows = (await env.DB.prepare(`
    SELECT c.id, c.channel, c.msgs, c.unanswered, c.started_at, c.last_at, c.lead_id,
           c.demo <> '' AS is_demo, t.name AS tenant_name, c.tenant_id,
           l.name AS lead_name, l.status AS lead_status
    FROM conversations c
    LEFT JOIN tenants t ON t.id = c.tenant_id
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE ${f.sql}${scc.sql} ORDER BY c.last_at DESC, c.id DESC LIMIT ?`)
    .bind(...f.values, ...scc.args, limit + 1).all()).results;
  const more = rows.length > limit; if (more) rows.pop();
  // Un cliente nunca recibe nombres de otros tenants (el suyo va en su cabecera).
  if (scope.role !== 'velai') for (const row of rows) { delete row.tenant_name; delete row.tenant_id; }
  return json({ conversations: rows, nextCursor: more ? `${rows.at(-1).last_at}|${rows.at(-1).id}` : null }, 200, NO_STORE);
});

conversaciones.get('/api/admin/conversations/export.csv', async (c) => {
  const { env, url, scope } = partesAdmin(c);
  const f = convFilters(url);
  const scc = scopeClause(scope, 'c');
  // Un mensaje por fila, con la conversación como columna: es el formato que sirve
  // para leer en una hoja de cálculo, y el que pide un cliente que quiere auditar.
  const rows = (await env.DB.prepare(`
    SELECT c.id AS conversacion, c.channel AS canal, m.created_at AS fecha, m.role AS quien, m.text AS mensaje
    FROM conversations c JOIN conv_messages m ON m.conversation_id = c.id
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE ${f.sql}${scc.sql} ORDER BY c.last_at DESC, c.id DESC, m.id ASC LIMIT 20000`)
    .bind(...f.values, ...scc.args).all()).results;
  const keys = ['conversacion', 'canal', 'fecha', 'quien', 'mensaje'];
  const csv = [keys.join(','), ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(','))].join('\r\n');
  return new Response('\uFEFF' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="velai-conversaciones.csv"', 'Cache-Control': 'no-store' } });
});

// ── Bandeja: lista + hilo abierto en UNA llamada (docs/H2-BANDEJA.md §5) ────
// Un solo endpoint porque el panel hace polling: dos llamadas cada 5 s con seis paneles
// abiertos son 35.000 peticiones/día, un tercio del plan gratuito de Workers en
// refrescar una pantalla. Con una cada 15 s y solo con la pestaña visible, ~11.500.
conversaciones.get('/api/admin/inbox', async (c) => {
  const { env, url, scope } = partesAdmin(c);
  const f = convFilters(url);
  const scc = scopeClause(scope, 'c');
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 40));
  const rows = (await env.DB.prepare(`
    SELECT c.id, c.channel, c.external_id, c.msgs, c.unanswered, c.last_at, c.lead_id,
           (c.last_read_at IS NULL OR c.last_read_at < c.last_at) AS unread,
           c.state, c.state_at, c.agent_email,
           t.name AS tenant_name, c.tenant_id, l.name AS lead_name, l.status AS lead_status,
           (SELECT m.text FROM conv_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS preview,
           (SELECT m.role FROM conv_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS preview_role
    FROM conversations c
    LEFT JOIN tenants t ON t.id = c.tenant_id
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE ${f.sql}${scc.sql}
    -- Lo que ESPERA a que alguien lo tome va primero, y lo más antiguo antes: con varias
    -- en cola, atender por «lo último que llegó» es dejar tirado justo al que más lleva.
    ORDER BY CASE c.state WHEN 'esperando' THEN 0 WHEN 'humano' THEN 1 ELSE 2 END,
             CASE WHEN c.state = 'esperando' THEN c.state_at END ASC,
             c.last_at DESC
    LIMIT ?`)
    .bind(...f.values, ...scc.args, limit).all()).results;
  // Contadores por canal para las pestañas: se cuentan SOBRE EL MISMO filtro de scope,
  // no sobre el de canal — si no, la pestaña activa se contaría a sí misma y las demás
  // saldrían a cero.
  const counts = (await env.DB.prepare(`SELECT channel, COUNT(*) AS n,
      SUM(CASE WHEN last_read_at IS NULL OR last_read_at < last_at THEN 1 ELSE 0 END) AS unread,
      SUM(CASE WHEN state = 'esperando' THEN 1 ELSE 0 END) AS waiting
    FROM conversations c WHERE demo = ''${scc.sql} GROUP BY channel`).bind(...scc.args).all()).results;
  if (scope.role !== 'velai') for (const row of rows) { delete row.tenant_name; delete row.tenant_id; }
  let thread = null;
  const wanted = clean(url.searchParams.get('conversation'), 40);
  if (wanted && UUID_RE.test(wanted)) {
    const head = await env.DB.prepare(`SELECT c.*, t.name AS tenant_name FROM conversations c
      LEFT JOIN tenants t ON t.id = c.tenant_id WHERE c.id=?${scc.sql}`).bind(wanted, ...scc.args).first();
    if (head) {
      const messages = (await env.DB.prepare('SELECT role, agent_email, text, created_at FROM conv_messages WHERE conversation_id=? ORDER BY id ASC LIMIT 500').bind(head.id).all()).results;
      const win = await replyWindow(env, head);
      // La misma puerta que el endpoint de respuesta, pero ANTES: el cajón se cierra con
      // el motivo escrito en vez de dejar que alguien escriba y se coma un 403.
      if (!(await canAttend(env, scope, head.tenant_id))) { win.open = false; win.reason = 'velai_no_atiende_clientes'; }
      // Marcar leído SOLO si hay algo nuevo: en un polling cada 15 s, un UPDATE
      // incondicional serían 1.900 escrituras al día por panel abierto para nada.
      if (!head.last_read_at || head.last_read_at < head.last_at) {
        await env.DB.prepare('UPDATE conversations SET last_read_at=? WHERE id=?').bind(new Date().toISOString(), head.id).run();
      }
      // El token cifrado del bot y el interno del tenant no salen del worker.
      delete head.demo; if (scope.role !== 'velai') { delete head.tenant_name; delete head.tenant_id; }
      thread = { conversation: head, messages, window: win };
    }
  }
  // queueMin viaja para que el panel pinte la cuenta atrás con el MISMO número que usa el
  // worker: si se escribiera a mano en el panel, un día dirían cosas distintas.
  return json({ conversations: rows, counts, thread, queueMin: QUEUE_MAX_MIN, pingMin: TAKEOVER_GRACE_MIN }, 200, NO_STORE);
});

// Aviso de mensajes nuevos. Deliberadamente MÍNIMO: lo sondea el panel cada 30 segundos
// incluso con la pestaña oculta (es el caso que hay que cubrir), así que es una sola
// consulta agregada sobre una tabla pequeña y devuelve tres números, nada más.
conversaciones.get('/api/admin/alerts', async (c) => {
  const { env, scope } = partesAdmin(c);
  const scc = scopeClause(scope, 'c');
  const row = await env.DB.prepare(`SELECT
      SUM(CASE WHEN c.state = 'esperando' THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN c.last_read_at IS NULL OR c.last_read_at < c.last_at THEN 1 ELSE 0 END) AS unread,
      MAX(c.last_inbound_at) AS lastInbound
    FROM conversations c WHERE c.demo = ''${scc.sql}`).bind(...scc.args).first();
  return json({
    waiting: Number(row && row.waiting) || 0,
    unread: Number(row && row.unread) || 0,
    lastInbound: (row && row.lastInbound) || null,
  }, 200, NO_STORE);
});

// Disponibilidad de la persona que mira el panel. El interruptor es POR PERSONA; el
// horario es del cliente y lo cierra por fuera (docs/H2-HANDOFF.md).
conversaciones.on(['GET', 'PATCH'], '/api/admin/availability', async (c) => {
  const { request, env, url, scope, actor } = partesAdmin(c);
  // Velai solo puede estar disponible para SUS conversaciones: el ?tenant= se ignora a
  // propósito, porque no hay nada que elegir.
  const asked = clean(url.searchParams.get('tenant'), 40);
  if (scope.tenantId && asked && asked !== scope.tenantId) throw new HttpError(404, 'not_found');
  const tenantId = scope.tenantId || await velaiTenantId(env);
  if (!tenantId) throw new HttpError(503, 'velai_tenant_missing');
  const tenantRow = await env.DB.prepare('SELECT id, name, support_hours, support_tz FROM tenants WHERE id=?').bind(tenantId).first();
  if (!tenantRow) throw new HttpError(404, 'not_found');
  if (request.method === 'PATCH') {
    const body = await readJson(request, 2000);
    const on = body.available ? 1 : 0;
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO agent_presence (tenant_id,email,available,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(tenant_id,email) DO UPDATE SET available=excluded.available, updated_at=excluded.updated_at`)
      .bind(tenantId, String(actor).toLowerCase(), on, now).run();
    console.log(JSON.stringify({ level: 'info', code: 'agent_availability', available: on === 1, actor_role: scope.role }));
  }
  const mine = await env.DB.prepare('SELECT available FROM agent_presence WHERE tenant_id=? AND email=?')
    .bind(tenantId, String(actor).toLowerCase()).first();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM agent_presence WHERE tenant_id=? AND available=1').bind(tenantId).first();
  const dentro = withinSupportHours(tenantRow);
  return json({
    available: Boolean(mine && mine.available),
    withinHours: dentro,
    // Lo que de verdad decide si se ofrece un asesor: el interruptor Y el horario.
    offering: dentro && Number(total && total.n) > 0,
    advisors: Number(total && total.n) || 0,
    hours: tenantRow.support_hours ? JSON.parse(tenantRow.support_hours) : DEFAULT_BUSINESS_HOURS,
    tz: tenantRow.support_tz || 'Europe/Madrid',
    graceMin: TAKEOVER_GRACE_MIN,
    // Para quién es esta disponibilidad. El panel lo enseña porque un admin de Velai ve
    // conversaciones de todos y tiene que saber que solo cubre las de Velai.
    forTenant: tenantRow.name || null,
  }, 200, NO_STORE);
});

// Tomar / devolver el control de una conversación. Es un CERROJO de una conversación, no
// una cola con dueños: la asignación sigue descartada en PLAN-PANEL.md.
conversaciones.post('/api/admin/conversations/:id/:accion{takeover|release}', async (c) => {
  const { env, scope, actor } = partesAdmin(c);
  const id = c.req.param('id'); const accion = c.req.param('accion');
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
  const scc = scopeClause(scope, 'c');
  const conv = await env.DB.prepare(`SELECT c.id, c.state, c.agent_email, c.channel, c.tenant_id, c.external_id, c.inbox_address, c.demo, c.msgs FROM conversations c WHERE c.id=?${scc.sql}`)
    .bind(id, ...scc.args).first();
  if (!conv) throw new HttpError(404, 'not_found');
  // 403 y no 404 a propósito: Velai SÍ ve esta conversación, así que fingir que no existe
  // sería mentirle al panel. Lo que no puede es meterse a atenderla.
  if (!(await canAttend(env, scope, conv.tenant_id))) throw new HttpError(403, 'velai_no_atiende_clientes');
  const now = new Date().toISOString();
  const who = String(actor).toLowerCase();
  if (accion === 'takeover') {
    // Ya lo tiene OTRA persona: se dice quién, en vez de dejar que dos escriban a la vez
    // creyendo cada una que la otra no está.
    if (conv.state === 'humano' && conv.agent_email && conv.agent_email !== who) {
      throw new HttpError(409, 'ya_tomada');
    }
    if (!['esperando', 'humano'].includes(conv.state)) throw new HttpError(409, 'nada_que_tomar');
    await env.DB.prepare("UPDATE conversations SET state='humano', agent_email=?, state_at=? WHERE id=?").bind(who, now, conv.id).run();
    console.log(JSON.stringify({ level: 'info', code: 'takeover', channel: conv.channel, actor_role: scope.role }));
    return json({ ok: true, state: 'humano', agent_email: who }, 200, NO_STORE);
  }
  // Devolver el control. Al principio no mandaba nada al cliente final, razonando que un
  // «te devuelvo al bot» sobraba. Estaba mal (Juan, 2026-08-26): el visitante estaba
  // hablando con una PERSONA y de golpe vuelve el bot sin que nadie se lo diga — se queda
  // esperando a alguien que ya no está. Se le avisa, con el nombre del asistente.
  // MISMO orden que en la cola: guardar el aviso, luego cambiar el estado, y Twilio al
  // final. El widget deja de preguntar al ver 'bot', así que invertirlo abre el hueco en el
  // que el aviso se escribe sin nadie escuchando.
  const tRow = await env.DB.prepare('SELECT * FROM tenants WHERE id=?').bind(conv.tenant_id).first();
  const quien = clean(tRow && tRow.bot_name, 40) || 'El asistente';
  const aviso = `${quien} vuelve a atenderte a partir de aquí. Si necesitas otra vez a alguien del equipo, solo tienes que pedírmelo.`;
  await convAppend(env, { id: conv.id, tenant: conv.tenant_id, channel: conv.channel, externalId: conv.external_id,
    inbox: conv.inbox_address, demo: conv.demo || '', msgs: conv.msgs, isNew: false },
  [{ role: 'assistant', content: aviso }]);
  await env.DB.prepare("UPDATE conversations SET state='bot', agent_email=NULL, state_at=? WHERE id=?").bind(now, conv.id).run();
  // La clave de pausa se borra con el tenant y el destinatario REALES de la conversación,
  // no con el scope: para un admin de Velai scope.tenantId es null y la clave saldría
  // malformada, dejando al bot callado para siempre.
  if (env.KV) { try { await env.KV.delete(`pause:${conv.tenant_id}:${conv.external_id}`); } catch (_) {} }
  // Twilio al final y sin bloquear: si falla, la conversación ya está devuelta y el bot
  // vuelve a atender. Quedarse en 'humano' sin nadie delante sería peor.
  if (tRow && conv.channel !== 'web' && conv.inbox_address) {
    const out = await sendTwilioText(env, tRow, conv.inbox_address, conv.external_id, aviso);
    if (!out.ok) console.log(JSON.stringify({ level: 'error', code: 'release_notice_failed', tenant: tRow.slug, error: clean(out.error || 'skipped', 40) }));
  }
  console.log(JSON.stringify({ level: 'info', code: 'control_released', channel: conv.channel, actor_role: scope.role }));
  return json({ ok: true, state: 'bot' }, 200, NO_STORE);
});

// Responder desde el panel. La parte difícil no es enviar: es NO enviar cuando no se
// puede, y decir por qué (docs/H2-BANDEJA.md §1 y §2).
conversaciones.post('/api/admin/conversations/:id/reply', async (c) => {
  const { request, env, scope, actor } = partesAdmin(c);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
  const scc = scopeClause(scope, 'c');
  const conv = await env.DB.prepare(`SELECT c.* FROM conversations c WHERE c.id=?${scc.sql}`).bind(id, ...scc.args).first();
  if (!conv) throw new HttpError(404, 'not_found');   // de otro cliente = 404, nunca 403
  if (!(await canAttend(env, scope, conv.tenant_id))) throw new HttpError(403, 'velai_no_atiende_clientes');
  const body = await readJson(request, 4000);
  const text = clean(body.text, 1500);
  if (!text) throw new HttpError(400, 'invalid_message');
  if (await rateLimited(env, `${actor}:${conv.id}`, 'convreply', 30)) throw new HttpError(429, 'rate_limited');
  // La guarda va ANTES de tocar Twilio: el 63016 de un texto libre fuera de ventana
  // llega cuando el mensaje ya se dio por enviado en la pantalla.
  const win = await replyWindow(env, conv);
  if (!win.open) throw new HttpError(409, win.reason);
  const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id=?').bind(conv.tenant_id).first();
  if (!tenant) throw new HttpError(404, 'not_found');
  // En el canal web no hay proveedor al que enviar: el mensaje se guarda y el widget lo
  // recoge en su siguiente sondeo. Por eso aquí no se toca Twilio.
  if (conv.channel !== 'web') {
    const sent = await sendTwilioText(env, tenant, conv.inbox_address, conv.external_id, text);
    if (!sent.ok) throw new HttpError(502, clean(sent.error || 'twilio_failed', 40));
  }
  // El bot se CALLA: dos voces en la misma conversación es peor que ninguna. Es la
  // MISMA pausa que escribe el centinela [[HUMANO]], así que la vista de escalaciones y
  // su botón de reanudar siguen valiendo tal cual — sin mecanismo nuevo.
  // En web NO se escribe: allí manda conv.state, y gastar una escritura de KV por
  // respuesta sería el peor uso del recurso más escaso que tenemos.
  if (env.KV && conv.channel !== 'web') { try { await env.KV.put(`pause:${conv.tenant_id}:${conv.external_id}`, '1', { expirationTtl: 4 * 3600 }); } catch (_) {} }
  const saved = await convAppend(env, {
    id: conv.id, tenant: conv.tenant_id, channel: conv.channel, externalId: conv.external_id,
    inbox: conv.inbox_address, demo: conv.demo || '', msgs: conv.msgs, isNew: false,
  }, [{ role: 'agent', content: text, agentEmail: actor }]);
  console.log(JSON.stringify({ level: 'info', code: 'agent_reply', channel: conv.channel, saved, actor_role: scope.role }));
  return json({ ok: true, window: win }, 200, NO_STORE);
});

conversaciones.get('/api/admin/conversations/:id', async (c) => {
  const { env, scope } = partesAdmin(c);
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
  const scc = scopeClause(scope, 'c');
  // La transcripción ajena es un 404, nunca un 403: un 403 confirmaría que la
  // conversación existe. Mismo criterio que el resto del panel.
  const head = await env.DB.prepare(`
    SELECT c.id, c.channel, c.external_id, c.msgs, c.unanswered, c.started_at, c.last_at,
           c.expires_at, c.lead_id, c.demo <> '' AS is_demo, t.name AS tenant_name
    FROM conversations c LEFT JOIN tenants t ON t.id = c.tenant_id
    WHERE c.id = ?${scc.sql}`).bind(id, ...scc.args).first();
  if (!head) throw new HttpError(404, 'not_found');
  if (scope.role !== 'velai') delete head.tenant_name;
  const messages = (await env.DB.prepare('SELECT role, text, created_at FROM conv_messages WHERE conversation_id=? ORDER BY id ASC LIMIT 500')
    .bind(head.id).all()).results;
  return json({ conversation: head, messages }, 200, NO_STORE);
});
