'use strict';
const Redis = require('ioredis');
const { randomUUID } = require('node:crypto');
const { event } = require('./observability');
let client;
const TTL = 7 * 86400;
function prefix() {
  const env = process.env.BOT_ENV;
  if (!env || !/^[a-z0-9_-]{1,40}$/.test(env)) throw new Error('BOT_ENV required');
  return `pulse:v2:${env}:${String(process.env.TELEGRAM_BOT_TOKEN || '').split(':')[0]}:`;
}
const key = name => prefix() + name;
function getClient() {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL required');
  if (!client) {
    client = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 1500, commandTimeout: 1500, maxRetriesPerRequest: 0, enableOfflineQueue: false, retryStrategy: () => null });
    client.on('error', () => event('REDIS_FAILURE'));
  }
  return client;
}
async function ready() {
  const r = getClient();
  if (r.status === 'wait' || r.status === 'end') await r.connect();
  else if (r.status !== 'ready') {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new Error('Redis unavailable')), 1600);
      const onReady = () => done(); const onError = () => done(new Error('Redis unavailable'));
      function done(err) { clearTimeout(timer); r.off('ready', onReady); r.off('error', onError); err ? reject(err) : resolve(); }
      r.once('ready', onReady); r.once('error', onError);
    });
  }
  return r;
}
async function get(name) { const r = await ready(); const value = await r.get(key(name)); return value ? JSON.parse(value) : null; }
async function put(name, value, ttl = TTL) {
  const r = await ready();
  return ttl ? r.set(key(name), JSON.stringify(value), 'EX', ttl) : r.set(key(name), JSON.stringify(value));
}
async function transaction(commands) {
  const r = await ready(); const result = await r.multi(commands).exec();
  if (!result || result.some(([err]) => err)) throw new Error('Redis transaction failed');
}
async function lock(name) {
  const r = await ready(), token = randomUUID();
  return await r.set(key(`lock:${name}`), token, 'EX', 90, 'NX') === 'OK' ? { name, token } : null;
}
async function owns(lockValue) {
  if (!lockValue) return false;
  const r = await ready(); return await r.get(key(`lock:${lockValue.name}`)) === lockValue.token;
}
async function unlock(lockValue) {
  if (!lockValue) return;
  const r = await ready();
  await r.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) end return 0", 1, key(`lock:${lockValue.name}`), lockValue.token);
}
async function rateLimit(bucket, limit, seconds) {
  const r = await ready();
  const n = await r.eval("local n=redis.call('incr',KEYS[1]); if n==1 then redis.call('expire',KEYS[1],ARGV[1]) end; return n", 1, key(`rate:${bucket}`), seconds);
  return n <= limit;
}
const scope = (chatId, userId, topicId = 0) => `${chatId}:${topicId}:${userId}`;
const room = (chatId, topicId = 0) => `${chatId}:${topicId}`;
async function history(scopeId) {
  const r = await ready();
  return (await r.lrange(key(`history:${scopeId}`), 0, 19)).map(JSON.parse).reverse().filter(m => m.at > Date.now() - TTL * 1000);
}
async function context(roomId) {
  const r = await ready();
  return (await r.lrange(key(`context:${roomId}`), 0, 19)).map(JSON.parse).reverse().filter(m => m.at > Date.now() - TTL * 1000);
}
function indexed(commands, userId, target) {
  commands.push(['sadd', key(`privacy:${userId}`), target], ['expire', key(`privacy:${userId}`), TTL + 86400]);
}
// Called under the conversation lock. Pair + puzzle/persona state + completion commit together.
async function finishUpdate(updateId, { scopeId, userId, userText, reply, puzzle, persona, roomId, contextText, username, messageId } = {}) {
  const commands = [['set', key(`update:${updateId}`), JSON.stringify({ state: 'done', at: Date.now(), messageId }), 'EX', TTL], ['srem', key('uncertain:updates'), String(updateId)]];
  if (scopeId && userText && reply) {
    const h = key(`history:${scopeId}`), at = Date.now();
    commands.push(['lpush', h, JSON.stringify({ role: 'user', content: userText, at }), JSON.stringify({ role: 'assistant', content: reply, at })], ['ltrim', h, 0, 19], ['expire', h, TTL]);
    indexed(commands, userId, h);
  }
  for (const [name, value] of [['puzzle', puzzle], ['persona', persona]]) {
    if (value !== undefined && scopeId) {
      const k = key(`${name}:${scopeId}`);
      commands.push(['set', k, JSON.stringify(value), 'EX', TTL]); indexed(commands, userId, k);
    }
  }
  if (roomId && contextText) {
    const k = key(`context:${roomId}`);
    commands.push(['lpush', k, JSON.stringify({ userId, username, content: contextText.slice(0, 400), at: Date.now() })], ['ltrim', k, 0, 19], ['expire', k, TTL]); indexed(commands, userId, k);
  }
  await transaction(commands);
}
async function markSending(updateId) {
  await transaction([['set', key(`update:${updateId}`), JSON.stringify({ state: 'sending', at: Date.now() }), 'EX', TTL], ['sadd', key('uncertain:updates'), String(updateId)]]);
}
async function forget(userId) {
  const r = await ready();
  // One atomic deletion across all indexed rooms, retaining other members' context.
  await r.eval(`local ks=redis.call('smembers',KEYS[1]); for _,k in ipairs(ks) do
    if string.find(k,':context:',1,true) then
      local items=redis.call('lrange',k,0,-1); local ttl=redis.call('pttl',k); redis.call('del',k);
      for _,v in ipairs(items) do local ok,m=pcall(cjson.decode,v); if ok and tostring(m.userId)~=ARGV[1] then redis.call('rpush',k,v) end end;
      if ttl>0 then redis.call('pexpire',k,ttl) end;
    else redis.call('del',k) end;
  end; redis.call('del',KEYS[1]); redis.call('del',KEYS[2]); return #ks`, 2, key(`privacy:${userId}`), `user:${userId}:history`, String(userId));
}
const rotationName = () => `weekly:${process.env.TELEGRAM_CHAT_ID}:rotation`;
const deliveryName = week => `weekly:${process.env.TELEGRAM_CHAT_ID}:delivery:${week}`;
async function finishWeekly(week, delivery, rotation) {
  await transaction([['set', key(rotationName()), JSON.stringify(rotation)], ['set', key(deliveryName(week)), JSON.stringify(delivery)], ['srem', key('uncertain:weekly'), week]]);
}
async function markWeeklySending(week, delivery) {
  await transaction([['set', key(deliveryName(week)), JSON.stringify(delivery)], ['sadd', key('uncertain:weekly'), week]]);
}
async function markOverviewSending(name, delivery) {
  await transaction([['set', key(name), JSON.stringify(delivery)], ['sadd', key('uncertain:overviews'), name]]);
}
async function finishOverview(name, delivery) {
  await transaction([['set', key(name), JSON.stringify(delivery)], ['srem', key('uncertain:overviews'), name]]);
}
async function markIntroductionSending(name, delivery) {
  await transaction([['set', key(name), JSON.stringify(delivery)], ['sadd', key('uncertain:introductions'), name]]);
}
async function finishIntroduction(name, delivery) {
  await transaction([['set', key(name), JSON.stringify(delivery)], ['srem', key('uncertain:introductions'), name]]);
}
async function uncertain() {
  const r = await ready();
  return { introductions: await r.smembers(key('uncertain:introductions')), updates: await r.smembers(key('uncertain:updates')), weeks: await r.smembers(key('uncertain:weekly')), overviews: await r.smembers(key('uncertain:overviews')) };
}
async function close() { if (client) { client.disconnect(); client = undefined; } }
module.exports = { TTL, key, ready, get, put, transaction, lock, owns, unlock, rateLimit, scope, room, history, context, finishUpdate, markSending, forget, rotationName, deliveryName, finishWeekly, markWeeklySending, markOverviewSending, finishOverview, markIntroductionSending, finishIntroduction, uncertain, close };
