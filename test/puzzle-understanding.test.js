'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { understandPuzzle, understoodTurn } = require('../lib/puzzle-understanding');
const { getChatBank } = require('../lib/puzzle-bank');
const { webhookHarness, message } = require('./helpers.cjs');
const { personaState } = require('../lib/persona-state');
const p = getChatBank().find(p => p.question.includes('72 часа'));
const state = { active: p.id, seen: [p.id], hints: 0, completed: false };
test('emotional answer is interpreted with canonical facts and delivered through checked solution', async () => {
  const text = 'нет конечно.... ой я затупил братик';
  const kind = await understandPuzzle(text, state, async messages => {
    const data = JSON.parse(messages[1].content);
    assert.equal(data.message, text); assert.equal(data.canonicalAnswer, p.answer);
    return '{"kind":"correct"}';
  });
  const turn = understoodTurn(kind, text, state, true);
  assert.equal(turn.state.completed, true); assert.ok(turn.reply.includes(p.explanation));
});
test('invalid judgement fails closed and uncertain reply never reveals answer', async () => {
  await assert.rejects(understandPuzzle('hello', state, async () => '{"kind":"invented"}'));
  const turn = understoodTurn('uncertain', 'hello', state, true);
  assert.equal(turn.state.completed, false); assert.ok(!turn.reply.includes(p.explanation));
});
test('chat during an open puzzle reaches conversation without completing it or sharing solution', async () => {
  const h = webhookHarness({ cfg: { personaEnabled: true }, modules: {
    '../lib/llm': { complete: async () => '{"kind":"chat"}', generateReply: async (system) => { assert.match(system, /Блатной/); assert.ok(!system.includes(p.explanation)); return 'conversation'; } },
  } });
  await h.store.put('puzzle:1:0:1', state); await h.store.put('persona:1:0:1', { mode: 'blatnoy' });
  await h.run(message(1, 'Как у тебя настроение?'));
  assert.equal(h.sent[0].text, 'conversation'); assert.equal((await h.store.get('puzzle:1:0:1')).completed, false);
  await h.run(message(2, 'давай поболтаем'));
  assert.equal((await h.store.get('puzzle:1:0:1')).active, null); assert.equal((await h.store.get('persona:1:0:1')).mode, 'blatnoy');
});
test('persona has no turn countdown and survives chat mode; explicit exit wins', () => {
  let stored = { mode: 'blatnoy' };
  for (let i = 0; i < 30; i++) { const voice = personaState('привет', stored, null, true); assert.equal(voice.active, true); stored = voice.next; }
  assert.equal(personaState('давай поболтаем', stored, null, true).active, true);
  assert.equal(personaState('говори нормально', stored, null, true).active, false);
});
test('webhook accepts interpreted answers and model outage leaves puzzle open', async () => {
  const h = webhookHarness({ modules: { '../lib/llm': { complete: async () => '{"kind":"correct"}' } } });
  await h.store.put('puzzle:1:0:1', state);
  await h.run(message(1, 'нет конечно.... ой я затупил братик'));
  assert.equal((await h.store.get('puzzle:1:0:1')).completed, true);
  assert.ok(h.sent[0].text.includes(p.explanation));
  const failed = webhookHarness({ modules: { '../lib/llm': { complete: async () => { throw Error('offline'); } } } });
  await failed.store.put('puzzle:1:0:1', state);
  await failed.run(message(1, 'нет конечно'));
  assert.equal((await failed.store.get('puzzle:1:0:1')).completed, false);
  assert.ok(!failed.sent[0].text.includes(p.explanation));
});
test('answer framing is accepted locally without swallowing contradictions', () => {
  const { answerMatches } = require('../lib/chat-puzzles');
  assert.equal(answerMatches('ну это тень', ['тень']), true);
  assert.equal(answerMatches('ответ тень', ['тень']), true);
  for (const text of ['это не тень', 'тень или дождь', 'тень но я думаю дождь', 'не ответ тень']) assert.equal(answerMatches(text, ['тень']), false);
});
test('new and repeat screenshot requests use stored bank state without calling AI', async () => {
  const h = webhookHarness();
  await h.run(message(1, 'дай эту загадку еще раз'));
  assert.match(h.sent[0].text, /нет сохранённой/);
  await h.run(message(2, 'давай загадку прошлую я вроде разгадал'));
  const first = await h.store.get('puzzle:1:0:1');
  const bankPuzzle = getChatBank().find(x => x.id === first.active);
  await h.run(message(3, 'скажи ответ'));
  await h.run(message(4, 'дай эту загадку еще раз'));
  assert.ok(h.sent[3].text.includes(bankPuzzle.question));
  assert.equal((await h.store.get('puzzle:1:0:1')).active, first.active);
  await h.run(message(5, `ну это ${bankPuzzle.answer}`));
  assert.equal((await h.store.get('puzzle:1:0:1')).completed, true);
  assert.equal(h.prompts.length, 0);
});
