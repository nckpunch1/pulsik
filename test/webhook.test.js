'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { webhookHarness, message } = require('./helpers.cjs');
test('private sentinel never enters group or different-topic model history', async () => {
  const h = webhookHarness();
  await h.run(message(1, 'PRIVATE_SENTINEL'));
  await h.run(message(2, 'Пульсик hello', { chat: -100, type: 'supergroup', topic: 10 }));
  await h.run(message(3, 'Пульсик again', { chat: -100, type: 'supergroup', topic: 11 }));
  assert.equal(h.prompts[1][1].length, 0); assert.equal(h.prompts[2][1].length, 0);
  assert.equal(h.sent[1].options.topicId, 10); assert.equal(h.sent[1].options.replyTo, 2);
});
test('sequential duplicate update sends and generates once', async () => {
  const h = webhookHarness(), req = message(1);
  await h.run(req); await h.run(req);
  assert.equal(h.sent.length, 1); assert.equal(h.prompts.length, 1);
});
test('concurrent duplicate and overlapping same-user turns are retryable without a second send', async () => {
  let release, started;
  const wait = new Promise(r => { release = r; }), entered = new Promise(r => { started = r; });
  const h = webhookHarness({ generate: async () => { started(); await wait; return 'hello'; } });
  const first = h.run(message(1)); await entered;
  assert.equal((await h.run(message(1))).code, 503);
  assert.equal((await h.run(message(2))).code, 503);
  release(); await first; assert.equal(h.sent.length, 1);
});
test('another bot reply, bot senders, unknown groups and channels do not activate', async () => {
  const h = webhookHarness();
  await h.run(message(1, 'hello', { chat: -100, type: 'supergroup', replyTo: { from: { id: 456, is_bot: true } } }));
  await h.run(message(2, 'Пульсик', { bot: true }));
  await h.run(message(3, 'Пульсик', { chat: -777, type: 'supergroup' }));
  await h.run(message(4, 'Пульсик', { chat: -999, type: 'channel' }));
  assert.equal(h.sent.length, 0);
  await h.run(message(5, 'hello', { chat: -100, type: 'supergroup', replyTo: { from: { id: 123, is_bot: true } } }));
  assert.equal(h.sent.length, 1);
});
test('operator status is private and ID-authorized even with old magic phrase', async () => {
  const h = webhookHarness();
  await h.run(message(1, 'Пульсик 12345 статус банков вопросов', { user: 2 }));
  await h.run(message(2, '/bankstatus', { chat: -100, type: 'supergroup' }));
  assert.equal(h.sent.length, 0);
  await h.run(message(3, '/bankstatus')); assert.equal(h.sent.length, 1); assert.equal(h.prompts.length, 0);
});
test('paused bot keeps help/privacy/forget available without a model', async () => {
  const h = webhookHarness({ cfg: { chatEnabled: false } });
  await h.run(message(1)); await h.run(message(2, '/help')); await h.run(message(3, '/privacy'));
  assert.equal(h.sent.length, 2); assert.equal(h.prompts.length, 0);
});
test('Redis outage fails closed without a Telegram or model request', async () => {
  const h = webhookHarness(); h.store.lock = async () => { throw Error('unavailable'); };
  assert.equal((await h.run(message(1))).code, 503); assert.equal(h.sent.length, 0); assert.equal(h.prompts.length, 0);
});
test('global budget stops model calls', async () => {
  const h = webhookHarness(); h.store.rateLimit = async bucket => !bucket.startsWith('global:');
  await h.run(message(1)); assert.equal(h.prompts.length, 0); assert.equal(h.sent.length, 0);
});
test('ambiguous Telegram failure is not sent again on retry', async () => {
  let sends = 0;
  const h = webhookHarness({ send: async () => { sends++; throw Object.assign(Error(), { ambiguous: true }); } });
  await h.run(message(1)); await h.run(message(1)); assert.equal(sends, 1);
  assert.equal((await h.store.get('update:1')).state, 'sending');
});
test('Telegram 429 is retryable only after retry-after', async () => {
  let sends = 0;
  const h = webhookHarness({ send: async () => { sends++; throw Object.assign(Error(), { ambiguous: false, code: 429, retryAfter: 60 }); } });
  assert.equal((await h.run(message(1))).code, 503);
  assert.equal((await h.run(message(1))).code, 503); assert.equal(sends, 1);
});
test('model failure produces one bounded fallback and does not store fabricated assistant history', async () => {
  const h = webhookHarness({ generate: async () => { throw Error('outage'); } });
  await h.run(message(1)); assert.equal(h.sent.length, 1); assert.equal(h.store.histories.size, 0);
});
test('curated private puzzle has stable answer and does not call model', async () => {
  const h = webhookHarness(); await h.run(message(1, '/puzzle'));
  const state = await h.store.get('puzzle:1:0:1'); assert.ok(state.active);
  await h.run(message(2, '/hint')); await h.run(message(3, '/answer'));
  assert.equal(h.prompts.length, 0); assert.equal((await h.store.get('puzzle:1:0:1')).completed, true);
});
test('forget removes previous memory and command itself is not remembered', async () => {
  const h = webhookHarness(); await h.run(message(1, 'private')); await h.run(message(2, '/forget'));
  await h.run(message(3, 'again')); assert.equal(h.prompts[1][1].length, 0);
});
test('alternate persona still includes shared business and disclosure rules', async () => {
  const h = webhookHarness({ cfg: { personaEnabled: true } }); await h.run(message(1, 'блатной пульсик')); await h.run(message(2, 'как настроение?'));
  assert.match(h.prompts[0][0], /Не выдумывай даты/); assert.match(h.prompts[0][0], /Ты ИИ-бот/);
});
test('invalid method and authentication never touch model', async () => {
  const h = webhookHarness(), req = message(1); req.method = 'GET'; assert.equal((await h.run(req)).code, 405);
  req.method = 'POST'; req.headers = {}; assert.equal((await h.run(req)).code, 401); assert.equal(h.prompts.length, 0);
});
test('whoami reports numeric ID privately without calling model', async () => {
  const h = webhookHarness({ cfg: { chatEnabled: false, operators: [] } });
  await h.run(message(1, '/whoami', { user: 42 })); assert.match(h.sent[0].text, /42/); assert.equal(h.prompts.length, 0);
});
test('private testing admits only operator DMs while retaining ID/privacy bootstrap', async () => {
  const h = webhookHarness({ cfg: { privateTest: true } });
  await h.run(message(1, 'hello', { user: 2 }));
  await h.run(message(2, 'Пульсик hello', { chat: -100, type: 'supergroup' }));
  assert.equal(h.sent.length, 0); assert.equal(h.prompts.length, 0);
  await h.run(message(3, '/whoami', { user: 2 })); assert.match(h.sent[0].text, /2/);
  await h.run(message(4, 'hello')); assert.equal(h.prompts.length, 1);
});
