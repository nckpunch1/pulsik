'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { load, response, cfg, memoryStore } = require('./helpers.cjs');
function harness(issues = false) {
  const store = memoryStore(), sent = [];
  store.values.set('rotation', { posted: [], last: null });
  store.uncertain = async () => ({ updates: issues ? ['1'] : [], weeks: [] });
  const handler = load('api/health.js', {
    '../lib/config': { config: () => ({ ...cfg, weeklyEnabled: false }), authorized: (a, b) => a === b },
    '../lib/redis': store, '../lib/observability': { event() {} },
    '../lib/sessions': { getUpcomingSessions: async () => [] },
    '../lib/telegram': { telegram: async () => ({ url: 'https://pulsik.vercel.app/api/webhook', pending_update_count: 0 }), sendMessage: async (text, chat) => { sent.push({ text, chat }); return { message_id: 1 }; } },
  }, { process: { env: { WEBHOOK_URL: 'https://pulsik.vercel.app' } } });
  return { store, sent, async run(headers = { authorization: 'Bearer cron' }) { const r = response(); await handler({ method: 'GET', headers }, r); return r; } };
}
test('healthy monitor stays quiet and requires authentication', async () => {
  const h = harness(); assert.equal((await h.run({})).code, 401); assert.equal((await h.run()).code, 200); assert.equal(h.sent.length, 0);
});
test('uncertain delivery alerts operator privately only once for unchanged issue set', async () => {
  const h = harness(true); assert.equal((await h.run()).code, 503); assert.equal((await h.run()).code, 503);
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].chat, '1'); assert.doesNotMatch(h.sent[0].text, /update:1/);
});
test('Redis outage is actionable and still attempts a private alert', async () => {
  const h = harness(); h.store.uncertain = async () => { throw Error('outage'); };
  const result = await h.run(); assert.equal(result.code, 503); assert.ok(result.body.issues.includes('storage_or_bank_failure')); assert.equal(h.sent.length, 1);
});
