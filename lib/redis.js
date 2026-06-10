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
    await redis.lpush(key, JSON.stringify({ username, content }));
    await redis.ltrim(key, 0, MAX - 1);
    await redis.expire(key, TTL);
  } catch (err) {
    console.error('[Redis] appendToChannelContext:', err.message);
  }
}

module.exports = { getUserHistory, appendToUserHistory, getChannelContext, appendToChannelContext };
