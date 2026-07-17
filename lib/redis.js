'use strict';

const Redis = require('ioredis');

let client;

function getClient() {
  if (!client) {
    client = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
    client.on('error', (err) => console.error('[Redis]', err.message));
  }
  return client;
}

const TTL = 7 * 24 * 60 * 60; // 7 days
const MAX = 20;

async function getUserHistory(userId) {
  try {
    const items = await getClient().lrange(`user:${userId}:history`, 0, MAX - 1);
    return items.map(i => JSON.parse(i)).reverse();
  } catch (err) {
    console.error('[Redis] getUserHistory:', err.message);
    return [];
  }
}

async function appendToUserHistory(userId, role, content) {
  try {
    const key = `user:${userId}:history`;
    const redis = getClient();
    await redis.lpush(key, JSON.stringify({ role, content }));
    await redis.ltrim(key, 0, MAX - 1);
    await redis.expire(key, TTL);
  } catch (err) {
    console.error('[Redis] appendToUserHistory:', err.message);
  }
}

async function getChannelContext(chatId) {
  try {
    const items = await getClient().lrange(`channel:${chatId}:context`, 0, MAX - 1);
    return items.map(i => JSON.parse(i)).reverse();
  } catch (err) {
    console.error('[Redis] getChannelContext:', err.message);
    return [];
  }
}

async function appendToChannelContext(chatId, username, content) {
  try {
    const key = `channel:${chatId}:context`;
    const redis = getClient();
    // Cap entry size so a single long message can't bloat the LLM context
    await redis.lpush(key, JSON.stringify({ username, content: String(content).slice(0, 400) }));
    await redis.ltrim(key, 0, MAX - 1);
    await redis.expire(key, TTL);
  } catch (err) {
    console.error('[Redis] appendToChannelContext:', err.message);
  }
}

// Sliding-window-ish rate limit: INCR + EXPIRE on first hit. Fails open on
// Redis errors so an outage degrades to "no limit" rather than a silent bot.
async function checkRateLimit(bucket, limit, windowSec) {
  try {
    const key = `ratelimit:${bucket}`;
    const redis = getClient();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    return count <= limit;
  } catch (err) {
    console.error('[Redis] checkRateLimit:', err.message);
    return true;
  }
}

// Recently posted weekly puzzles — passed back to the generator to avoid repeats.
const RECENT_PUZZLES_KEY = 'weekly:recentPuzzles';
const RECENT_PUZZLES_MAX = 12;

async function getRecentPuzzles() {
  try {
    return await getClient().lrange(RECENT_PUZZLES_KEY, 0, RECENT_PUZZLES_MAX - 1);
  } catch (err) {
    console.error('[Redis] getRecentPuzzles:', err.message);
    return [];
  }
}

async function appendRecentPuzzle(question) {
  try {
    const redis = getClient();
    await redis.lpush(RECENT_PUZZLES_KEY, String(question).slice(0, 500));
    await redis.ltrim(RECENT_PUZZLES_KEY, 0, RECENT_PUZZLES_MAX - 1);
  } catch (err) {
    console.error('[Redis] appendRecentPuzzle:', err.message);
  }
}

const BLATNOY_TTL = 60 * 60; // 1 hour

function blatnoyKey(chatId, userId) {
  return `blatnoy:${chatId}:${userId}`;
}

async function getBlatnoyCounter(chatId, userId) {
  try {
    const value = await getClient().get(blatnoyKey(chatId, userId));
    return value ? parseInt(value, 10) : 0;
  } catch (err) {
    console.error('[Redis] getBlatnoyCounter:', err.message);
    return 0;
  }
}

async function setBlatnoyCounter(chatId, userId, value) {
  try {
    await getClient().set(blatnoyKey(chatId, userId), value, 'EX', BLATNOY_TTL);
  } catch (err) {
    console.error('[Redis] setBlatnoyCounter:', err.message);
  }
}

async function decrementBlatnoyCounter(chatId, userId) {
  try {
    const key = blatnoyKey(chatId, userId);
    const redis = getClient();
    const remaining = await redis.decr(key);
    if (remaining <= 0) {
      await redis.del(key);
    }
  } catch (err) {
    console.error('[Redis] decrementBlatnoyCounter:', err.message);
  }
}

module.exports = {
  getUserHistory,
  appendToUserHistory,
  getChannelContext,
  appendToChannelContext,
  getBlatnoyCounter,
  setBlatnoyCounter,
  decrementBlatnoyCounter,
  checkRateLimit,
  getRecentPuzzles,
  appendRecentPuzzle,
};
