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

// Which curated-bank puzzles have already gone out in the current pass through
// the bank. Replaces the old weekly:recentPuzzles list, which held question TEXT
// capped at 12 entries to feed the generator's "don't repeat these" prompt: the
// bank asks a different question — set membership by id, over a cycle that must
// hold the entire bank, however large it grows.
//
// Deliberately no TTL, unlike the chat keys above: at one post a week a cycle
// spans months, and an expiry would silently restart it mid-way and re-post
// puzzles the channel has already seen.
const POSTED_PUZZLES_KEY = 'weekly:postedPuzzleIds';
// The id posted most recently, kept separately so that the wrap-around at the
// end of a cycle can avoid drawing the same puzzle two weeks running.
const LAST_PUZZLE_KEY = 'weekly:lastPuzzleId';

// Returns null — not [] — when Redis is unreachable, so callers can tell "no
// puzzles posted yet" apart from "we can't see what was posted". The weekly
// cron treats both the same (draw anyway), but the status command must not
// report a full bank as unused just because Redis blinked.
async function getPostedPuzzleIds() {
  try {
    return await getClient().smembers(POSTED_PUZZLES_KEY);
  } catch (err) {
    console.error('[Redis] getPostedPuzzleIds:', err.message);
    return null;
  }
}

async function markPuzzlePosted(id) {
  try {
    const redis = getClient();
    await redis.sadd(POSTED_PUZZLES_KEY, id);
    await redis.set(LAST_PUZZLE_KEY, id);
  } catch (err) {
    console.error('[Redis] markPuzzlePosted:', err.message);
  }
}

async function resetPostedPuzzleIds() {
  try {
    await getClient().del(POSTED_PUZZLES_KEY);
  } catch (err) {
    console.error('[Redis] resetPostedPuzzleIds:', err.message);
  }
}

async function getLastPuzzleId() {
  try {
    return await getClient().get(LAST_PUZZLE_KEY);
  } catch (err) {
    console.error('[Redis] getLastPuzzleId:', err.message);
    return null;
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
  getPostedPuzzleIds,
  markPuzzlePosted,
  resetPostedPuzzleIds,
  getLastPuzzleId,
};
