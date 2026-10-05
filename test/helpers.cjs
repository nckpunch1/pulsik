'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function load(file, mocks = {}, globals = {}) {
  const filename = path.resolve(__dirname, '..', file), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name.startsWith('.') ? path.resolve(path.dirname(filename), name) : name), process, console, Date, Math, Set, Promise, AbortSignal, Buffer, ...globals }, { filename });
  return module.exports;
}
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
const cfg = { env: 'test', botId: '123', username: 'pulse_iq_bot', channel: '-999', webhookSecret: 'secret', cronSecret: 'cron', operators: ['1'], groups: ['-100'], chatEnabled: true, weeklyEnabled: true, groupContext: false, personaEnabled: false, minuteBudget: 30, dailyBudget: 300 };
function memoryStore() {
  const values = new Map(), locks = new Map(), histories = new Map(), contexts = new Map();
  let serial = 0;
  const store = {
    values, histories, contexts,
    get: async name => values.get(name) ?? null,
    put: async (name, v) => values.set(name, v),
    lock: async name => { if (locks.has(name)) return null; const lock = { name, token: ++serial }; locks.set(name, lock.token); return lock; },
    owns: async l => locks.get(l?.name) === l?.token,
    unlock: async l => { if (l && locks.get(l.name) === l.token) locks.delete(l.name); },
    scope: (chat, user, topic = 0) => `${chat}:${topic}:${user}`, room: (chat, topic = 0) => `${chat}:${topic}`,
    history: async s => histories.get(s) || [], context: async r => contexts.get(r) || [],
    rateLimit: async () => true,
    markSending: async id => values.set(`update:${id}`, { state: 'sending' }),
    finishUpdate: async (id, x = {}) => {
      values.set(`update:${id}`, { state: 'done' });
      if (x.userText && x.reply) histories.set(x.scopeId, [...(histories.get(x.scopeId) || []), { role: 'user', content: x.userText }, { role: 'assistant', content: x.reply }]);
      if (x.puzzle !== undefined) values.set(`puzzle:${x.scopeId}`, x.puzzle);
      if (x.persona !== undefined) values.set(`persona:${x.scopeId}`, x.persona);
      if (x.roomId && x.contextText) contexts.set(x.roomId, [...(contexts.get(x.roomId) || []), { userId: x.userId, content: x.contextText }]);
    },
    forget: async user => { for (const k of histories.keys()) if (k.endsWith(`:${user}`)) histories.delete(k); for (const k of values.keys()) if (k.startsWith('puzzle:') && k.endsWith(`:${user}`)) values.delete(k); },
    rotationName: () => 'rotation', deliveryName: week => `delivery:${week}`,
    markWeeklySending: async (week, d) => values.set(`delivery:${week}`, d),
    finishWeekly: async (week, d, r) => { values.set(`delivery:${week}`, d); values.set('rotation', r); },
    markIntroductionSending: async (name, d) => values.set(name, d),
    finishIntroduction: async (name, d) => values.set(name, d),
    markOverviewSending: async (name, d) => values.set(name, d),
    finishOverview: async (name, d) => values.set(name, d),
  };
  return store;
}
function message(id, text = 'hello', { user = 1, chat = user, type = 'private', topic, replyTo, bot = false } = {}) {
  return { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'secret' }, body: { update_id: id, message: { message_id: id, text, chat: { id: chat, type }, from: { id: user, is_bot: bot }, message_thread_id: topic, reply_to_message: replyTo } } };
}
function webhookHarness(overrides = {}) {
  const store = overrides.store || memoryStore(), sent = [], prompts = [];
  const handler = load('api/webhook.js', {
    '../lib/config': { config: () => ({ ...cfg, ...overrides.cfg }), authorized: (a, b) => a === b },
    '../lib/redis': store, '../lib/observability': { event() {} },
    '../lib/telegram': { sendMessage: overrides.send || (async (text, chat, options) => { sent.push({ text, chat, options }); return { message_id: sent.length }; }) },
    '../lib/llm': { generateReply: overrides.generate || (async (...args) => { prompts.push(args); return 'reply'; }) },
    '../lib/sessions': { getUpcomingSessions: async () => [] },
    ...(overrides.modules || {}),
  });
  return { handler, store, sent, prompts, async run(req) { const res = response(); await handler(req, res); return res; } };
}
module.exports = { load, response, cfg, memoryStore, message, webhookHarness };
