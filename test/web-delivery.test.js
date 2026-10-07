import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createWorker } from '../worker/app.js';
import { sqliteD1 } from './helpers/sqlite-d1.js';

async function fixture(t, state = 'humano') {
  const DB = await sqliteD1(); t.after(() => DB.close());
  const tenantId = randomUUID(), convId = randomUUID(), conversationId = randomUUID();
  const slug = 'delivery-' + tenantId.slice(0, 8), now = new Date().toISOString();
  await DB.prepare(`INSERT INTO tenants(id,slug,name,channel_address,system_prompt,active,created_at,updated_at)
    VALUES (?,?,?,?,?,1,?,?)`).bind(tenantId, slug, 'Equipo de prueba', 'web:' + slug, 'Prompt de prueba', now, now).run();
  await DB.prepare(`INSERT INTO conversations(id,tenant_id,channel,external_id,msgs,started_at,last_at,expires_at,state,state_at)
    VALUES (?,?,'web',?,0,?,?,?,?,?)`).bind(convId, tenantId, conversationId, now, now, now, state, now).run();
  const env = { DB, ALLOWED_WEB_ORIGINS: 'https://widget.example' };
  const worker = createWorker({ SYSTEM: '', GUARDRAILS: '', DEMOS: {} });
  const ctx = { waitUntil() { throw new Error('Human delivery must not trigger background effects'); } };
  const send = (body = {}, selected = env) => worker.fetch(new Request('https://isolated.invalid/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://widget.example' },
    body: JSON.stringify({ tenant: slug, conversationId, message: 'Mensaje de prueba', ...body }),
  }), selected, ctx);
  return { DB, env, send, convId, conversationId, slug };
}

for (const state of ['humano', 'esperando']) {
  test(`web ${state}: batch fallido no acepta el mensaje; recuperación conserva un único turno`, async (t) => {
    const f = await fixture(t, state), messageId = randomUUID();
    const broken = { ...f.env, DB: { prepare: f.DB.prepare, batch: async () => { throw Error('synthetic_batch_failure'); } } };
    const failed = await f.send({ messageId }, broken);
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).error, 'conversation_message_not_saved');
    assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM conv_messages').first()).n, 0);
    const recovered = await f.send({ messageId });
    assert.equal(recovered.status, 200); assert.equal((await recovered.json()).accepted, true);
    assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM conv_messages').first()).n, 1);
    assert.equal((await f.DB.prepare('SELECT msgs FROM conversations WHERE id=?').bind(f.convId).first()).msgs, 1);
  });
}

test('web legacy sin UUID sigue válido y también exige persistencia', async (t) => {
  const f = await fixture(t);
  const broken = { ...f.env, DB: { prepare: f.DB.prepare, batch: async () => { throw Error('synthetic_batch_failure'); } } };
  assert.equal((await f.send({}, broken)).status, 503);
  const response = await f.send(); assert.equal(response.status, 200);
  assert.equal((await response.json()).reply, null);
  assert.equal((await f.DB.prepare('SELECT client_message_id FROM conv_messages').first()).client_message_id, null);
});

test('web respuesta perdida: UUID repetido no duplica ni llama IA tras terminar atención; cursor no salta al asesor', async (t) => {
  const f = await fixture(t), messageId = randomUUID();
  const first = await f.send({ messageId }); assert.equal(first.status, 200);
  const originalId = (await first.json()).lastId;
  await f.DB.prepare("INSERT INTO conv_messages(conversation_id,role,text,created_at) VALUES (?,'agent','Respuesta de prueba',?)")
    .bind(f.convId, new Date().toISOString()).run();
  await f.DB.prepare("UPDATE conversations SET state='bot' WHERE id=?").bind(f.convId).run();
  t.mock.method(globalThis, 'fetch', async () => { throw Error('No model or network expected'); });
  const retry = await f.send({ messageId }), body = await retry.json();
  assert.equal(retry.status, 200); assert.equal(body.accepted, true); assert.equal(body.reply, null);
  assert.equal(body.lastId, originalId); assert.equal(body.state, 'bot');
  assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM conv_messages WHERE role='user'").first()).n, 1);
  assert.equal((await f.DB.prepare('SELECT msgs FROM conversations WHERE id=?').bind(f.convId).first()).msgs, 1);
});

test('web dos retries concurrentes guardan un mensaje y un solo incremento de contador', async (t) => {
  const f = await fixture(t), messageId = randomUUID();
  let entrants = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const selected = { ...f.env, DB: { batch: f.DB.batch, prepare(sql) {
    const statement = f.DB.prepare(sql);
    if (!sql.includes('SELECT id,text FROM conv_messages')) return statement;
    return { ...statement, bind(...args) {
      const bound = statement.bind(...args);
      return { ...bound, async first() {
        const row = await bound.first();
        // Synchronize the first two reads so both requests see no existing receipt.
        if (++entrants <= 2) { if (entrants === 2) release(); await barrier; }
        return row;
      } };
    } };
  } } };
  const responses = await Promise.all([f.send({ messageId }, selected), f.send({ messageId }, selected)]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM conv_messages').first()).n, 1);
  assert.equal((await f.DB.prepare('SELECT msgs FROM conversations WHERE id=?').bind(f.convId).first()).msgs, 1);
});

test('web UUID reused with different text is a conflict, invalid UUID fails before writes', async (t) => {
  const f = await fixture(t), messageId = randomUUID();
  assert.equal((await f.send({ messageId })).status, 200);
  const changed = await f.send({ messageId, message: 'Texto distinto' });
  assert.equal(changed.status, 409); assert.equal((await changed.json()).error, 'message_id_conflict');
  assert.equal((await f.send({ messageId: 'not-a-uuid' })).status, 400);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM conv_messages').first()).n, 1);
});

test('web receipt UUID is scoped to conversation and tenant, never globally deduplicated', async (t) => {
  const f = await fixture(t), messageId = randomUUID();
  await f.send({ messageId });
  const tenant2 = randomUUID(), conv2 = randomUUID(), slug2 = 'second-' + tenant2.slice(0, 8), now = new Date().toISOString();
  await f.DB.prepare(`INSERT INTO tenants(id,slug,name,channel_address,system_prompt,active,created_at,updated_at)
    VALUES (?,?,?,?,?,1,?,?)`).bind(tenant2, slug2, 'Segundo equipo', 'web:' + slug2, 'Prompt', now, now).run();
  await f.DB.prepare(`INSERT INTO conversations(id,tenant_id,channel,external_id,msgs,started_at,last_at,expires_at,state)
    VALUES (?,?,'web',?,0,?,?,?,'humano')`).bind(conv2, tenant2, f.conversationId, now, now, now).run();
  assert.equal((await f.send({ tenant: slug2, messageId, message: 'Otro tenant' })).status, 200);
  const rows = (await f.DB.prepare('SELECT conversation_id,text FROM conv_messages ORDER BY id').all()).results;
  assert.deepEqual(rows.map(r => r.conversation_id), [f.convId, conv2]);
});
