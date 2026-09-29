'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { formatSessionsForPrompt } = require('../lib/format');
const { puzzleTurn } = require('../lib/chat-puzzles');
const { validateBank, getChatBank } = require('../lib/puzzle-bank');
test('schedule contract preserves venueName/suburb and distinguishes outages', () => {
  const text = formatSessionsForPrompt([{ name: 'Game', date: '2026-09-30T19:00:00+10:00', venueName: 'Venue', venueSuburb: 'Suburb' }]);
  assert.match(text, /Venue, Suburb/); assert.match(text, /19:00/);
  assert.notEqual(formatSessionsForPrompt(null), formatSessionsForPrompt([]));
});
test('schedule fetch has deadline and rejects malformed schemas', async () => {
  let options;
  const sessions = load('lib/sessions.js', {}, { fetch: async (url, opts) => { options = opts; return { ok: true, json: async () => ({ sessions: 'bad' }) }; } });
  assert.equal(await sessions.getUpcomingSessions(), null); assert.ok(options.signal);
});
test('schedule network failure returns unavailable instead of empty', async () => {
  const sessions = load('lib/sessions.js', {}, { fetch: async () => { throw Error('network'); } });
  assert.equal(await sessions.getUpcomingSessions(), null);
});
test('Telegram never retries ambiguous transport failure', async () => {
  let count = 0;
  const api = load('lib/telegram.js', {}, { process: { env: { TELEGRAM_BOT_TOKEN: '123:test' } }, fetch: async () => { count++; throw Error('private token in original error'); } });
  await assert.rejects(api.sendMessage('hello', 1), e => e.ambiguous && !e.message.includes('private token')); assert.equal(count, 1);
});
test('Telegram parses retry_after and sends conversation text as plain text with topic/reply', async () => {
  let body;
  const api = load('lib/telegram.js', {}, { process: { env: { TELEGRAM_BOT_TOKEN: '123:test' } }, fetch: async (url, options) => { body = JSON.parse(options.body); return { ok: false, status: 429, json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 12 } }) }; } });
  await assert.rejects(api.sendMessage('<not html>', 1, { topicId: 10, replyTo: 12 }), e => e.code === 429 && e.retryAfter === 12 && !e.ambiguous);
  assert.equal(body.parse_mode, undefined); assert.equal(body.message_thread_id, 10); assert.equal(body.reply_parameters.message_id, 12);
});
test('Telegram 5xx/invalid JSON are ambiguous, oversize input is rejected before I/O', async () => {
  let count = 0;
  const api = load('lib/telegram.js', {}, { process: { env: { TELEGRAM_BOT_TOKEN: '123:test' } }, fetch: async () => { count++; return { ok: false, status: 500, json: async () => ({ ok: false }) }; } });
  await assert.rejects(api.sendMessage('x', 1), e => e.ambiguous);
  await assert.rejects(api.sendMessage('x'.repeat(4097), 1), e => !e.ambiguous); assert.equal(count, 1);
});
test('empty or truncated primary model output falls back with retries disabled', async () => {
  const requests = [], options = [];
  class Groq { constructor(config) { assert.equal(config.maxRetries, 0); this.chat = { completions: { create: async (r, o) => { requests.push(r); options.push(o); return { choices: [{ message: { content: requests.length === 1 ? '<think>secret</think>' : 'answer' }, finish_reason: 'stop' }] }; } } }; } }
  const llm = load('lib/llm.js', { 'groq-sdk': Groq, './observability': { event() {} } });
  assert.equal(await llm.complete([{ role: 'user', content: 'hello' }]), 'answer'); assert.equal(requests.length, 2);
  assert.ok(options.every(o => o.maxRetries === 0 && o.timeout <= 10000));
});
test('both models failing ends after two attempts, no raw provider errors escape', async () => {
  let n = 0;
  class Groq { constructor() { this.chat = { completions: { create: async () => { n++; throw Error('secret'); } } }; } }
  const llm = load('lib/llm.js', { 'groq-sdk': Groq, './observability': { event() {} } });
  await assert.rejects(llm.complete([]), /Model unavailable/); assert.equal(n, 2);
});
test('model deadline prevents starting further attempts', async () => {
  let n = 0;
  class Groq { constructor() { this.chat = { completions: { create: async () => { n++; } } }; } }
  const llm = load('lib/llm.js', { 'groq-sdk': Groq, './observability': { event() {} } });
  await assert.rejects(llm.complete([], { deadline: Date.now() - 1 })); assert.equal(n, 0);
});
test('curated puzzles avoid repeats, keep hints/solution separate and accept aliases', () => {
  const bank = getChatBank(); let state;
  const seen = new Set();
  for (let i = 0; i < bank.length; i++) { const t = puzzleTurn('/puzzle', state, () => 0); state = t.state; assert.ok(!seen.has(state.active)); seen.add(state.active); }
  const last = state.active; state = puzzleTurn('/puzzle', state, () => 0).state; assert.notEqual(state.active, last);
  const hint = puzzleTurn('/hint', { active: 'c006', seen: ['c006'], hints: 0 }); assert.equal(hint.state.hints, 1); assert.doesNotMatch(hint.reply, /39/);
  const solved = puzzleTurn('39 гусей', hint.state); assert.equal(solved.state.completed, true);
});
test('bank validator rejects duplicate IDs, missing fields and long puzzles', () => {
  const p = { id: 'w001', question: 'Q', answer: 'A', explanation: 'E' };
  assert.throws(() => validateBank({ puzzles: [p, p] }, 'test'));
  assert.throws(() => validateBank({ puzzles: [{ ...p, answer: '' }] }, 'test'));
  assert.throws(() => validateBank({ puzzles: [{ ...p, question: 'x'.repeat(3001) }] }, 'test'));
});
test('model failures record safe reason codes without provider text', async () => {
  const events = []; let calls = 0;
  class Groq { constructor() { this.chat = { completions: { create: async () => {
    if (++calls === 1) throw Object.assign(Error('sensitive provider body'), { status: 429 });
    return { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] };
  } } }; } }
  const llm = load('lib/llm.js', { 'groq-sdk': Groq, './observability': { event: (name, fields) => events.push({ name, ...fields }) } });
  await assert.rejects(llm.complete([]));
  assert.equal(events[0].code, 'http_429'); assert.equal(events[1].code, 'truncated_output');
  assert.doesNotMatch(JSON.stringify(events), /sensitive provider body|partial/);
});
