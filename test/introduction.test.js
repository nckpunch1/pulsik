'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { webhookHarness, message } = require('./helpers.cjs');
const group = { chat: -100, type: 'supergroup', topic: 3 };
const config = { conversationTopic: 3, privateTest: false };
test('operator introduction occurs once across new updates and survives forgetting', async () => {
  const h = webhookHarness({ cfg: config });
  await h.run(message(1, '/introduce@pulse_iq_bot', group));
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].options.topicId, 3); assert.match(h.sent[0].text, /ИИ-бот PulseIQ/);
  await h.run(message(2, 'Пульсик, знакомься!', group));
  await h.run(message(3, '/forget'));
  await h.run(message(4, '/introduce', group));
  assert.equal(h.sent.length, 2); assert.equal(h.prompts.length, 0);
  assert.equal((await h.store.get('introduction:-100')).state, 'sent');
});
test('intro cannot be triggered by members, DMs, other topics or paused groups', async () => {
  const h = webhookHarness({ cfg: config });
  await h.run(message(1, '/introduce', { ...group, user: 2 }));
  await h.run(message(2, '/introduce'));
  await h.run(message(3, '/introduce', { ...group, topic: 2 }));
  assert.equal(h.sent.length, 0);
  const paused = webhookHarness({ cfg: { ...config, privateTest: true } });
  await paused.run(message(4, '/introduce', group)); assert.equal(paused.sent.length, 0);
});
test('ambiguous introduction delivery and post-send persistence failures never resend', async () => {
  for (const storageFailure of [false, true]) {
    let sends = 0;
    const h = webhookHarness({ cfg: config, send: async () => { sends++; if (!storageFailure) throw Error('unknown delivery'); return { message_id: 12 }; } });
    if (storageFailure) h.store.finishIntroduction = async () => { throw Error('storage'); };
    await h.run(message(1, '/introduce', group)); await h.run(message(2, '/introduce', group));
    assert.equal(sends, 1); assert.equal((await h.store.get('introduction:-100')).state, 'sending');
  }
});
test('simultaneous introductions by different operators cannot both send', async () => {
  let release, entered, count = 0;
  const wait = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; });
  const h = webhookHarness({ cfg: { ...config, operators: ['1', '2'] }, send: async () => { count++; entered(); await wait; return { message_id: 3 }; } });
  const first = h.run(message(1, '/introduce', group)); await started;
  assert.equal((await h.run(message(2, '/introduce', { ...group, user: 2 }))).code, 503);
  release(); await first; await h.run(message(2, '/introduce', { ...group, user: 2 })); assert.equal(count, 1);
});
