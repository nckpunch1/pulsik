'use strict';
const crypto = require('node:crypto');
function csv(value) { return String(value || '').split(',').map(s => s.trim()).filter(Boolean); }
function positive(value, fallback) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Invalid positive integer configuration');
  return n;
}
function config() {
  const e = process.env;
  for (const name of ['BOT_ENV', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_WEBHOOK_SECRET', 'CRON_SECRET', 'REDIS_URL', 'GROQ_API_KEY', 'WEBHOOK_URL']) {
    if (!e[name] || /^(your_|redis:\/\/\.\.\.)/.test(e[name])) throw new Error(`Missing configuration: ${name}`);
  }
  if (!/^[a-z0-9_-]{1,40}$/.test(e.BOT_ENV)) throw new Error('Invalid BOT_ENV');
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(e.TELEGRAM_BOT_TOKEN)) throw new Error('Invalid bot token format');
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(e.TELEGRAM_WEBHOOK_SECRET)) throw new Error('Invalid webhook secret');
  if (!/^https:\/\/[^/]+$/.test(e.WEBHOOK_URL)) throw new Error('WEBHOOK_URL must be an HTTPS origin');
  if (e.WEEKLY_ENABLED === 'true' && (!/^\d{4}-\d{2}-\d{2}$/.test(e.WEEKLY_START_DATE || '') || !Number.isFinite(Date.parse(e.WEEKLY_START_DATE)))) throw new Error('WEEKLY_START_DATE required');
  if (e.CRON_SECRET.length < 16) throw new Error('CRON_SECRET must have at least 16 characters');
  if (e.WEEKLY_ENABLED === 'true' && (new Date(e.WEEKLY_START_DATE).getUTCDay() !== 3 || new Date(e.WEEKLY_START_DATE).toISOString().slice(0,10) !== e.WEEKLY_START_DATE)) throw new Error('WEEKLY_START_DATE must be a valid Wednesday');
  const operators = csv(e.OPERATOR_USER_IDS);
  const groups = csv(e.ALLOWED_GROUP_IDS);
  if (((e.CHAT_ENABLED === 'true' || e.WEEKLY_ENABLED === 'true') && !operators.length) || operators.length > 5 || operators.some(id => !/^\d+$/.test(id)) || groups.some(id => !/^-\d+$/.test(id))) throw new Error('Invalid Telegram user/group IDs');
  return {
    env: e.BOT_ENV, botId: e.TELEGRAM_BOT_TOKEN.split(':')[0], token: e.TELEGRAM_BOT_TOKEN,
    username: e.BOT_USERNAME || 'pulse_iq_bot', channel: e.TELEGRAM_CHAT_ID,
    operators, groups, chatEnabled: e.CHAT_ENABLED === 'true', weeklyEnabled: e.WEEKLY_ENABLED === 'true' && e.PRIVATE_TEST_MODE !== 'true',
    privateTest: e.PRIVATE_TEST_MODE === 'true',
    groupContext: e.GROUP_CONTEXT_ENABLED === 'true', personaEnabled: e.ALTERNATE_PERSONA_ENABLED === 'true',
    dailyBudget: positive(e.GLOBAL_DAILY_REPLY_LIMIT, 300), minuteBudget: positive(e.GLOBAL_MINUTE_REPLY_LIMIT, 30),
    webhookSecret: e.TELEGRAM_WEBHOOK_SECRET, cronSecret: e.CRON_SECRET,
  };
}
function authorized(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = { config, authorized };
