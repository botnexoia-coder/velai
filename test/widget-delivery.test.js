// Boundary tests execute the widget's actual send/transport/session functions with
// fake DOM elements and mock HTTP. Visual/keyboard QA is separate from this harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const source = await readFile(new URL('../site/assets/vai-widget.js', import.meta.url), 'utf8');
function functionSource(name) {
  const re = new RegExp('^  (?:async )?function ' + name + '\\(', 'm');
  const start = source.search(re); assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
function widget(fetch, persisted = null, tenant = 'personal-test') {
  const bubbles = [], requests = [], storage = new Map(persisted ? [['state', persisted]] : []);
  const classes = { add() {}, remove() {} };
  const el = { input: { value: '', style: {}, focus() {} }, send: {}, retry: { focus() {} }, pending: {},
    chips: { classList: classes }, typing: { classList: classes }, msgs: { scrollHeight: 0 } };
  const make = new Function('fetch', 'sessionStorage', 'el', 'TENANT', 'bubbles', 'uuid',
    `var history=[], pendingMessage=null, sent=0, busy=false, conversationId='${randomUUID()}', demo='',
    humanVerified=true, liveState='humano', lastId=0, open=true, wasOpen=false;
    var SS_STATE='state', WORKER='https://isolated.invalid', LANG='es';
    var T={errHuman:'Verificación pendiente',errGeneric:'Problema de entrega'};
    var location={href:'https://widget.example',pathname:'/'};
    var window={};
    function withBrand(fn){fn();} function script(){return {greeting:'Hola'};}
    function addMsg(role,text){bubbles.push({role,text});} function track(){}
    function waNumber(){return '';} function humanToken(){return Promise.resolve('fake-token');}
    function isDemo(){return false;} function applyLive(state){liveState=state;saveState();}
    ${['updateSend','renderPending','saveState','loadState','postChat','send'].map(functionSource).join('\n')}
    return {send,loadState,renderPending,get state(){return {history,pendingMessage,sent,busy,conversationId,liveState};}};`);
  const api = make(async (url, options) => { requests.push(JSON.parse(options.body)); return fetch(url, options); },
    { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, el, tenant, bubbles, randomUUID);
  return { api, requests, el, bubbles, saved: () => storage.get('state') };
}

test('widget offline retains message+UUID; explicit retry keeps UUID and one user bubble, clears only after acceptance', async () => {
  let attempt = 0;
  const w = widget(async () => {
    if (++attempt === 1) throw Error('offline');
    return new Response(JSON.stringify({ reply: null, state: 'humano', accepted: true, lastId: 12 }), { status: 200 });
  });
  w.el.input.value = 'Mensaje sin conexión'; await w.api.send();
  const pending = w.api.state.pendingMessage;
  assert.equal(pending.text, 'Mensaje sin conexión'); assert.equal(w.el.pending.hidden, false);
  assert.equal(JSON.parse(w.saved()).pendingMessage.id, pending.id); assert.equal(w.el.send.disabled, true);
  await w.api.send('Otro mensaje'); assert.equal(w.requests.length, 1, 'do not reorder while a delivery is pending');
  w.el.input.value = 'Borrador siguiente'; await w.api.send(null, 'retry', true);
  assert.deepEqual(w.requests.map(r => r.messageId), [pending.id, pending.id]);
  assert.equal(w.api.state.history.filter(m => m.role === 'user').length, 1);
  assert.equal(w.bubbles.filter(m => m.role === 'user').length, 1);
  assert.equal(w.api.state.sent, 1); assert.equal(w.api.state.pendingMessage, null);
  assert.equal(JSON.parse(w.saved()).pendingMessage, null); assert.equal(w.el.pending.hidden, true);
  assert.equal(w.el.input.value, 'Borrador siguiente', 'retry preserves newly typed draft');
});

test('widget 503 from storage keeps text across page restore and retries with the same message/conversation IDs', async () => {
  const failed = widget(async () => new Response(JSON.stringify({ error: 'conversation_message_not_saved' }), { status: 503 }));
  await failed.api.send('Persistir primero');
  const restored = widget(async () => new Response(JSON.stringify({ reply: null, state: 'esperando', accepted: true, lastId: 3 }), { status: 200 }), failed.saved());
  restored.api.loadState(); restored.api.renderPending();
  assert.equal(restored.el.pending.hidden, false); assert.equal(restored.api.state.pendingMessage.text, 'Persistir primero');
  await restored.api.send(null, 'retry', true);
  assert.equal(restored.requests[0].messageId, failed.requests[0].messageId);
  assert.equal(restored.requests[0].conversationId, failed.requests[0].conversationId);
  assert.equal(restored.api.state.history.filter(m => m.role === 'user').length, 1);
});

test('widget lost response is not treated as success and does not mint another UUID', async () => {
  let attempt = 0;
  const w = widget(async () => {
    if (++attempt === 1) return { ok: true, async json() { throw Error('response_lost'); } };
    return new Response(JSON.stringify({ reply: null, state: 'bot', accepted: true, lastId: 9 }), { status: 200 });
  });
  await w.api.send('Entregado pero respuesta perdida');
  assert.ok(w.api.state.pendingMessage); await w.api.send(null, 'retry', true);
  assert.equal(w.requests[0].messageId, w.requests[1].messageId); assert.equal(w.api.state.pendingMessage, null);
  assert.equal(w.api.state.liveState, 'bot');
});

test('widget restore never carries pending delivery into another tenant', async () => {
  const a = widget(async () => { throw Error('offline'); }, null, 'tenant-a'); await a.api.send('Mensaje A');
  const b = widget(async () => { throw Error('unexpected'); }, a.saved(), 'tenant-b'); b.api.loadState();
  assert.equal(b.api.state.pendingMessage, null); assert.equal(b.api.state.history.length, 0);
});
