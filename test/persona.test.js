'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { personaState } = require('../lib/persona-state');
const { puzzleTurn } = require('../lib/chat-puzzles');
const { getChatBank } = require('../lib/puzzle-bank');
const { webhookHarness, message } = require('./helpers.cjs');
test('persona activation and puzzle question/hint/solution all use the active voice', async () => {
  const h = webhookHarness({ cfg: { personaEnabled: true } });
  await h.run(message(1, '/blatnoy'));
  await h.run(message(2, '/puzzle'));
  const state = await h.store.get('puzzle:1:0:1'), p = getChatBank().find(p => p.id === state.active);
  assert.match(h.sent[1].text, /дело занятное/); assert.ok(h.sent[1].text.includes(p.question));
  await h.run(message(3, '/hint')); assert.match(h.sent[2].text, /Подкину зацепку/); assert.ok(h.sent[2].text.includes(p.hints[0]));
  await h.run(message(4, '/answer')); assert.match(h.sent[3].text, /Раскрываем карты/); assert.ok(h.sent[3].text.includes(p.answer));
  assert.equal(h.prompts.length, 0);
});
test('correct answers and unmatched guesses preserve persona without changing correctness', () => {
  const state = { active: 'c006', seen: ['c006'], hints: 0 };
  const wrong = puzzleTurn('100', state, () => 0, { blatnoy: true });
  assert.match(wrong.reply, /С приговором погодим/); assert.ok(!wrong.state.completed); assert.doesNotMatch(wrong.reply, /39/);
  const correct = puzzleTurn('39', state, () => 0, { blatnoy: true }); assert.equal(correct.state.completed, true); assert.match(correct.reply, /расклад сошёлся/);
});
test('puzzle keeps voice until completion even if the short conversation budget runs out', () => {
  const now = Date.now(), stored = { remaining: 0, expiresAt: now + 1000 };
  const game = { active: 'c006', voice: 'blatnoy', voiceUntil: now + 1000, completed: false };
  assert.equal(personaState('/hint', stored, game, true, now).active, true);
  assert.equal(personaState('hello', stored, { ...game, completed: true }, true, now).active, false);
  assert.equal(personaState('/hint', stored, game, true, now + 2000).active, false);
});
test('/normal exits during a puzzle; other users and rooms are isolated', async () => {
  const h = webhookHarness({ cfg: { personaEnabled: true } });
  await h.run(message(1, '/blatnoy')); await h.run(message(2, '/puzzle'));
  await h.run(message(3, '/puzzle', { user: 2 })); assert.doesNotMatch(h.sent[2].text, /дело занятное/);
  await h.run(message(4, '/normal')); await h.run(message(5, '/hint')); assert.doesNotMatch(h.sent[4].text, /Подкину|карты/);
  assert.equal((await h.store.get('puzzle:1:0:1')).voice, null);
});
test('activation works inside an existing puzzle and switch-off disables puzzle persona', async () => {
  const h = webhookHarness({ cfg: { personaEnabled: true } });
  await h.run(message(1, '/puzzle')); await h.run(message(2, 'Блатной Пульсик')); await h.run(message(3, '/hint'));
  assert.match(h.sent[2].text, /Подкину зацепку/);
  assert.equal(personaState('/hint', { remaining: 4, expiresAt: Date.now() + 1000 }, { voice: 'blatnoy', voiceUntil: Date.now() + 1000 }, false).active, false);
});
