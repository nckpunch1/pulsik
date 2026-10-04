'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const env = { BOT_ENV: 'test', TELEGRAM_BOT_TOKEN: '123:token', TELEGRAM_CHAT_ID: '-999', TELEGRAM_WEBHOOK_SECRET: 'sixteencharacterssecret', CRON_SECRET: 'sixteencharacterssecret', REDIS_URL: 'redis://127.0.0.1', GROQ_API_KEY: 'test', WEBHOOK_URL: 'https://pulsik.vercel.app' };
const moduleFor = changes => load('lib/config.js', {}, { process: { env: { ...env, ...changes } } });
test('paused bootstrap is allowed, enabling bot requires numeric admin IDs', () => {
  assert.equal(moduleFor({}).config().operators.length, 0);
  assert.throws(() => moduleFor({ CHAT_ENABLED: 'true' }).config());
  assert.throws(() => moduleFor({ OPERATOR_USER_IDS: 'Nikomaniak', CHAT_ENABLED: 'true' }).config());
  assert.deepEqual([...moduleFor({ OPERATOR_USER_IDS: '42', CHAT_ENABLED: 'true' }).config().operators], ['42']);
});
test('weekly enablement requires a valid Wednesday and positive budgets', () => {
  assert.throws(() => moduleFor({ OPERATOR_USER_IDS: '42', WEEKLY_ENABLED: 'true' }).config());
  assert.throws(() => moduleFor({ OPERATOR_USER_IDS: '42', WEEKLY_ENABLED: 'true', WEEKLY_START_DATE: '2026-09-28' }).config());
  assert.equal(moduleFor({ OPERATOR_USER_IDS: '42', WEEKLY_ENABLED: 'true', WEEKLY_START_DATE: '2026-09-30' }).config().weeklyEnabled, true);
  assert.throws(() => moduleFor({ GLOBAL_DAILY_REPLY_LIMIT: '-1' }).config());
});
test('secret comparisons handle missing and unequal length input', () => {
  const { authorized } = moduleFor({}); assert.equal(authorized(undefined, 'secret'), false); assert.equal(authorized('x', 'secret'), false); assert.equal(authorized('secret', 'secret'), true);
});
test('private test mode suppresses weekly publishing even if its switch is set', () => {
  const c = moduleFor({ OPERATOR_USER_IDS: '42', PRIVATE_TEST_MODE: 'true', WEEKLY_ENABLED: 'true', WEEKLY_START_DATE: '2026-09-30' }).config();
  assert.equal(c.privateTest, true); assert.equal(c.weeklyEnabled, false);
});
test('topic IDs are positive integers and optional', () => {
  const c = moduleFor({ ANNOUNCEMENT_TOPIC_ID: '2', WEEKLY_TOPIC_ID: '3', CONVERSATION_TOPIC_ID: '3' }).config();
  assert.equal(c.announcementTopic, 2); assert.equal(c.weeklyTopic, 3); assert.equal(c.conversationTopic, 3);
  for (const value of ['0', '-1', '3.5', 'text']) assert.throws(() => moduleFor({ WEEKLY_TOPIC_ID: value }).config());
});
