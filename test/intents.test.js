'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { conversationIntent } = require('../lib/conversation-intent');
test('natural requests accept politeness, names and punctuation', () => {
  for (const s of ['загадка', 'Загадка?', 'Пульсик загадка', 'дай нам загадку', 'Пульсик дай нам загадку для начала', 'дай мне загадку', 'Пульсик, загадай загадку!', 'Можно загадку, пожалуйста?', 'можешь мне загадать загадку', 'ещё одну загадку']) assert.equal(conversationIntent(s), 'puzzle', s);
  for (const s of ['подскажи', 'дай мне подсказку', 'можно подсказку?', 'нужна подсказка']) assert.equal(conversationIntent(s), 'hint', s);
  for (const s of ['скажи ответ', 'покажи мне решение', 'сдаюсь']) assert.equal(conversationIntent(s), 'answer', s);
});
test('mentions, negations and unrelated answers do not trigger puzzle actions', () => {
  for (const s of ['не говори ответ', 'я не хочу загадку', 'не дай мне подсказку', 'ответ в том что он попросил подсказку', 'расскажи про загадку', 'не знаю']) assert.equal(conversationIntent(s), null, s);
  assert.equal(conversationIntent('не знаю', true), 'answer');
  assert.equal(conversationIntent('ещё', true), 'puzzle');
});
test('screenshot requests choose a new puzzle or repeat without requiring exact phrasing', () => {
  assert.equal(conversationIntent('давай загадку прошлую я вроде разгадал'), 'puzzle');
  assert.equal(conversationIntent('дай эту загадку еще раз'), 'repeat');
  assert.equal(conversationIntent('повтори загадку'), 'repeat');
  assert.equal(conversationIntent('не давай загадку прошлую я вроде разгадал'), null);
});
