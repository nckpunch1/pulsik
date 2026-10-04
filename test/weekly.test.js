'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { load, memoryStore, cfg, response } = require('./helpers.cjs');
const { scheduledWeek, latestDue, selectPuzzle, buildPost } = require('../lib/weekly');
function harness(send, store = memoryStore(), overrides = {}) {
  let count = 0;
  store.values.set('rotation', { posted: [], last: null });
  const RealDate = Date;
  class Clock extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-09-30T10:00:00Z'])); } static now() { return new RealDate('2026-09-30T10:00:00Z').getTime(); } }
  const handler = load('api/send-weekly.js', {
    '../lib/config': { config: () => ({ ...cfg, ...overrides }), authorized: (a, b) => a === b }, '../lib/redis': store,
    '../lib/telegram': { sendMessage: send || (async () => { count++; return { message_id: count }; }) },
    '../lib/weekly': { scheduledWeek: () => ({ id: '2026-09-30', at: new RealDate('2026-09-30T09:00:00Z').getTime() }), selectPuzzle, buildPost },
    '../lib/observability': { event() {} },
  }, { Date: Clock, process: { env: { WEEKLY_START_DATE: '2026-09-30' } } });
  return { store, count: () => count, async run() { const r = response(); await handler({ method: 'GET', headers: { authorization: 'Bearer cron' } }, r); return r; } };
}
test('Wednesday slot is 19:00 Brisbane and does not run early', () => {
  assert.equal(scheduledWeek(new Date('2026-09-28T12:00:00Z')).at, Date.parse('2026-09-30T09:00:00Z'));
  assert.equal(latestDue(new Date('2026-09-30T08:59:59Z')).id, '2026-09-23');
  assert.equal(latestDue(new Date('2026-09-30T09:00:00Z')).id, '2026-09-30');
});
test('weekly duplicate sends once and stores Telegram message ID', async () => {
  const h = harness(); await h.run(); await h.run(); assert.equal(h.count(), 1);
  assert.equal((await h.store.get('delivery:2026-09-30')).messageId, 1); assert.equal((await h.store.get('rotation')).posted.length, 1);
});
test('concurrent weekly calls cannot both publish', async () => {
  let release, started, count = 0; const wait = new Promise(r => { release = r; }), entered = new Promise(r => { started = r; });
  const h = harness(async () => { count++; started(); await wait; return { message_id: 10 }; });
  const first = h.run(); await entered; assert.equal((await h.run()).code, 409); release(); await first; assert.equal(count, 1);
});
test('ambiguous weekly failure preserves rotation and blocks resend/fallback', async () => {
  let count = 0; const h = harness(async () => { count++; throw Object.assign(Error(), { ambiguous: true }); });
  assert.equal((await h.run()).code, 503); assert.equal((await h.run()).code, 409); assert.equal(count, 1);
  assert.equal((await h.store.get('rotation')).posted.length, 0);
});
test('post-send persistence failure also blocks resend', async () => {
  const h = harness(); h.store.finishWeekly = async () => { throw Error('Redis lost'); };
  await h.run(); await h.run(); assert.equal(h.count(), 1);
});
test('missing rotation or storage failure cannot post', async () => {
  const h = harness(); h.store.values.delete('rotation'); assert.equal((await h.run()).code, 503); assert.equal(h.count(), 0);
  h.store.get = async () => { throw Error('outage'); }; await h.run(); assert.equal(h.count(), 0);
});
test('exhaustion excludes last puzzle, and failed sends never clear rotation', () => {
  const b = [{ id: 'w001' }, { id: 'w002' }]; const rotation = { posted: ['w001', 'w002'], last: 'w002' };
  assert.equal(selectPuzzle(b, rotation, () => 0).puzzle.id, 'w001'); assert.equal(rotation.posted.length, 2);
});
test('weekly HTML escapes content and keeps spoiler', () => {
  const post = buildPost({ question: '<x>&', answer: '<secret>', explanation: 'why' });
  assert.match(post, /&lt;x&gt;&amp;/); assert.match(post, /<tg-spoiler>&lt;secret&gt;/);
});

test('weekly post targets topic 3 explicitly', async () => {
  let destination;
  const h = harness(async (text, chat, options) => { destination = { chat, options }; return { message_id: 11 }; }, memoryStore(), { weeklyTopic: 3 });
  await h.run(); assert.equal(destination.options.topicId, 3); assert.equal(destination.chat, cfg.channel);
});
