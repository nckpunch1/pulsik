'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createOverviewCommands, renderOverview, validateCopy } = require('../lib/game-overview');
const { memoryStore, cfg, webhookHarness, message } = require('./helpers.cjs');
const NOW = Date.parse('2026-09-29T09:00:00Z');
const session = { id: 'next', name: 'PulseIQ — юмористическая игра', date: '2026-10-08T19:00:00+10:00', venueName: 'TEST VENUE', venueSuburb: 'TEST SUBURB' };
const copy = { intro: 'Смеяться будем вместе. Но расслабляться рано: смешно не значит легко.', highlights: ['«Алиби»: одна или несколько команд станут мафией.', 'Остальным предстоит вычислить мафию.', 'Предпоследняя игра сезона и борьба за финал.'], closing: 'Собирайте команду — и чувство юмора тоже берите.' };
function setup(overrides = {}) {
  const store = memoryStore(), sent = [], prompts = [], reads = [], ttls = [], originalPut = store.put;
  store.put = async (key, value, ttl) => { ttls.push({ key, ttl }); return originalPut(key, value); };
  let sessions = [session], clock = NOW, serial = 0, codes = 0;
  const runCommand = createOverviewCommands({ store, now: () => clock, makeCode: () => `code${++codes}`,
    sendMessage: overrides.send || (async (text, chat, options) => { sent.push({ text, chat, options }); return { message_id: sent.length }; }),
    complete: overrides.complete || (async (messages, options) => { prompts.push({ messages, options }); return JSON.stringify(copy); }),
    getUpcomingSessions: async options => { reads.push(options); return sessions; },
  });
  return { store, sent, prompts, reads, ttls, setSessions: x => { sessions = x; }, setTime: x => { clock = x; },
    run: (text, userId = '1') => runCommand({ text, userId, cfg: { ...cfg, ...overrides.cfg }, updateId: ++serial, deadline: clock + 48000 }) };
}
async function draft(h) { await h.run('/gamebrief 2026-10-08\nЮмор. Алиби: одна или несколько команд — мафия. Предпоследняя игра сезона.'); return h.run('/overview'); }
test('brief is temporary and preview never sends to the channel', async () => {
  const h = setup(); const preview = await draft(h);
  assert.equal(h.sent.length, 0); assert.equal(preview.html, true); assert.match(preview.reply, /\/publish code1/);
  assert.match(preview.reply, /8 октября/); assert.match(preview.reply, /19:00/); assert.match(preview.reply, /TEST VENUE, TEST SUBURB/);
  assert.ok(h.ttls.some(x => x.ttl === 30 * 86400)); assert.ok(h.ttls.some(x => x.ttl === 86400));
  assert.ok(h.reads.every(x => x.fresh)); assert.doesNotMatch(h.prompts[0].messages[1].content, /TEST VENUE|19:00|блатной/i);
});
test('explicit publish sends exactly the reviewed post once, even for a new draft', async () => {
  const h = setup(); await draft(h); const frozen = await h.store.get('overview:-999:draft:1');
  await h.run('/publish wrong'); assert.equal(h.sent.length, 0);
  await h.run('/publish code1'); await h.run('/publish code1'); assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].text, frozen.html); assert.equal(h.sent[0].chat, cfg.channel); assert.equal(h.sent[0].options.html, true);
  await h.run('/overview'); await h.run('/publish code2'); assert.equal(h.sent.length, 1);
});
test('notes edit, clear and draft cancellation invalidate approval', async () => {
  const h = setup(); await draft(h); await h.run('/gamebrief 2026-10-08\nНовое содержание'); await h.run('/publish code1'); assert.equal(h.sent.length, 0);
  await h.run('/overview'); await h.run('/gameclear'); await h.run('/publish code2'); assert.equal(h.sent.length, 0);
  await draft(h); await h.run('/overview_cancel'); await h.run('/publish code3'); assert.equal(h.sent.length, 0);
});
test('changed schedule, unavailable API, ambiguous same-day games and missing venue block posting', async () => {
  const h = setup(); await draft(h); h.setSessions([{ ...session, venueName: 'NEW VENUE' }]);
  assert.match((await h.run('/publish code1')).reply, /Расписание изменилось/); assert.equal(h.sent.length, 0);
  h.setSessions(null); assert.match((await h.run('/overview')).reply, /недоступно/);
  h.setSessions([session, { ...session, id: 'second' }]); assert.match((await h.run('/overview')).reply, /несколько игр/);
  h.setSessions([{ ...session, venueName: null }]); assert.match((await h.run('/overview')).reply, /не хватает/);
});
test('expired draft and past game cannot publish', async () => {
  const h = setup(); await draft(h); h.setTime(NOW + 86400001); await h.run('/publish code1'); assert.equal(h.sent.length, 0);
  h.setTime(Date.parse('2026-10-09T00:00:00Z')); assert.match((await h.run('/overview')).reply, /нет одной предстоящей/);
});
test('unknown delivery outcome never causes an automatic resend', async () => {
  let sends = 0; const h = setup({ send: async () => { sends++; throw Object.assign(Error(), { ambiguous: true }); } });
  await draft(h); assert.match((await h.run('/publish code1')).reply, /мог попасть/);
  assert.match((await h.run('/publish code1')).reply, /требует проверки/); assert.equal(sends, 1);
});
test('post-send storage failure also blocks resends', async () => {
  const h = setup(); await draft(h); h.store.finishOverview = async () => { throw Error('storage outage'); };
  await h.run('/publish code1'); await h.run('/publish code1'); assert.equal(h.sent.length, 1);
});
test('definite Telegram rejection permits retry after the requested wait', async () => {
  let sends = 0; const h = setup({ send: async () => { sends++; if (sends === 1) throw Object.assign(Error(), { ambiguous: false, retryAfter: 120 }); return { message_id: 5 }; } });
  await draft(h); await h.run('/publish code1'); await h.run('/publish code1'); assert.equal(sends, 1);
  h.setTime(NOW + 121000); await h.run('/publish code1'); assert.equal(sends, 2);
});
test('only the draft owner may approve it and unauthorized users cannot store notes', async () => {
  const h = setup(); await draft(h); await h.run('/publish code1', '2'); await h.run('/gamebrief 2026-10-08\nHACK', '2');
  assert.equal(h.sent.length, 0); assert.doesNotMatch((await h.store.get('overview:-999:brief')).notes, /HACK/);
});
test('webhook keeps admin notes out of group/LLM and allows admin commands while chat is paused', async () => {
  const calls = [];
  const h = webhookHarness({ cfg: { chatEnabled: false }, modules: { '../lib/game-overview': { COMMANDS: new Set(['/gamebrief', '/overview', '/publish']), createOverviewCommands: () => async x => { calls.push(x); return { reply: 'Saved' }; } } } });
  await h.run(message(1, '/gamebrief 2026-10-08 SECRET', { user: 2 }));
  await h.run(message(2, '/gamebrief 2026-10-08 SECRET', { chat: -100, type: 'supergroup' }));
  assert.equal(calls.length, 0); assert.equal(h.prompts.length, 0); assert.equal(h.store.contexts.size, 0);
  await h.run(message(3, '/gamebrief 2026-10-08\n' + 'x'.repeat(2000))); assert.equal(calls.length, 1); assert.ok(calls[0].text.length > 1000); assert.equal(h.store.histories.size, 0);
});
test('draft format is validated and schedule HTML is escaped', () => {
  assert.throws(() => validateCopy('not json'));
  assert.throws(() => validateCopy(JSON.stringify({ ...copy, intro: '<a>injection</a>' })));
  const text = renderOverview({ name: '<script>', at: session.date, venue: 'A&B' }, copy); assert.match(text, /&lt;script&gt;/); assert.match(text, /A&amp;B/);
});
test('model outage or budget exhaustion leaves the brief intact without publishing', async () => {
  const h = setup({ complete: async () => { throw Error('offline'); } }); await h.run('/gamebrief example');
  assert.match((await h.run('/overview')).reply, /Заметки сохранены/); assert.ok(await h.store.get('overview:-999:brief')); assert.equal(h.sent.length, 0);
  h.store.rateLimit = async () => false; await h.run('/overview'); assert.equal(h.sent.length, 0);
});

test('private rehearsal can draft but cannot publish', async () => {
  const h = setup({ cfg: { privateTest: true } }); await draft(h);
  assert.match((await h.run('/publish code1')).reply, /отключена/);
  assert.equal(h.sent.length, 0);
});
