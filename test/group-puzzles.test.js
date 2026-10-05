'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { webhookHarness, message } = require('./helpers.cjs');
const { getChatBank } = require('../lib/puzzle-bank');
const group = { chat: -100, type: 'supergroup', topic: 3 };
const replyTo = { from: { id: 123 }, message_thread_id: 3 };

test('group puzzle requests deliver bank questions in the requesting topic without a model', async () => {
  for (const request of ['Пульсик дай нам загадку для начала', 'загадка', 'Пульсик, загадка!', '/puzzle', '/puzzle@pulse_iq_bot', '@pulse_iq_bot загадка']) {
    const h = webhookHarness({ cfg: { conversationTopic: 3 } });
    const res = await h.run(message(1, request, group));
    assert.equal(res.code, 200, request);
    const state = await h.store.get('group-puzzle:-100:3');
    assert.ok(state?.active, request);
    assert.ok(h.sent[0].text.includes(getChatBank().find(p => p.id === state.active).question));
    assert.equal(h.sent[0].chat, '-100');
    assert.equal(h.sent[0].options.topicId, 3);
    assert.equal(h.sent[0].options.replyTo, 1);
    assert.equal(h.prompts.length, 0);
  }
});

test('different members share hints and answers while private puzzles remain separate', async () => {
  const h = webhookHarness();
  await h.run(message(1, 'загадка'));
  const dm = JSON.stringify(await h.store.get('puzzle:1:0:1'));
  await h.run(message(2, 'Пульсик, загадка', group));
  await h.run(message(3, 'дай нам подсказку', { ...group, user: 2, replyTo }));
  const state = await h.store.get('group-puzzle:-100:3');
  assert.equal(state.hints, 1);
  await h.run(message(4, getChatBank().find(p => p.id === state.active).answer, { ...group, user: 3, replyTo }));
  assert.equal((await h.store.get('group-puzzle:-100:3')).completed, true);
  assert.equal(JSON.stringify(await h.store.get('puzzle:1:0:1')), dm);
  assert.equal(h.prompts.length, 0);
});

test('chat, normal voice and forgetting do not clear the communal puzzle', async () => {
  const h = webhookHarness({ cfg: { personaEnabled: true } });
  await h.run(message(1, '/puzzle', group));
  const before = JSON.stringify(await h.store.get('group-puzzle:-100:3'));
  await h.run(message(2, 'давай поболтаем', { ...group, replyTo }));
  await h.run(message(3, 'Пульсик говори нормально', group));
  await h.run(message(4, '/forget', group));
  assert.equal(JSON.stringify(await h.store.get('group-puzzle:-100:3')), before);
});

test('group puzzle uses each responding member voice without changing shared state voice', async () => {
  const h = webhookHarness({ cfg: { personaEnabled: true } });
  await h.run(message(1, '/blatnoy', { ...group, replyTo }));
  await h.run(message(2, '/puzzle', group));
  assert.match(h.sent.at(-1).text, /дело занятное/);
  await h.run(message(3, '/hint', { ...group, user: 2 }));
  assert.match(h.sent.at(-1).text, /Давай потянем/);
  assert.equal((await h.store.get('group-puzzle:-100:3')).voice, undefined);
});

test('topic and group restrictions still apply to puzzle requests', async () => {
  const h = webhookHarness({ cfg: { conversationTopic: 3 } });
  await h.run(message(1, '/puzzle', { ...group, topic: 2 }));
  await h.run(message(2, 'загадка', { ...group, chat: -200 }));
  await h.run(message(3, '/puzzle@other_bot', group));
  await h.run(message(4, 'эта загадка была интересной', group));
  assert.equal(h.sent.length, 0);
});

test('shared lock serializes different members and releases after delivery', async () => {
  const h = webhookHarness();
  const lock = await h.store.lock('group-puzzle:-100:3');
  const busy = await h.run(message(1, '/puzzle', { ...group, user: 2 }));
  assert.equal(busy.code, 503);
  assert.equal(h.sent.length, 0);
  await h.store.unlock(lock);
  assert.equal((await h.run(message(1, '/puzzle', { ...group, user: 2 }))).code, 200);
  assert.equal((await h.run(message(2, '/hint', { ...group, user: 3 }))).code, 200);
  assert.equal((await h.store.get('group-puzzle:-100:3')).hints, 1);
  await h.run(message(1, '/puzzle', { ...group, user: 2 }));
  assert.equal(h.sent.length, 2);
});
