'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
// CI supplies a disposable Redis instance. Never use a production URL here.
test('real Redis: locks, atomic turns, scoped memory, forgetting and durable weekly state', { skip: !process.env.REDIS_TEST_URL }, async () => {
  process.env.REDIS_URL = process.env.REDIS_TEST_URL;
  process.env.BOT_ENV = `test-${process.pid}`;
  process.env.TELEGRAM_BOT_TOKEN = '123:test'; process.env.TELEGRAM_CHAT_ID = '-999';
  const s = require('../lib/redis');
  try {
    const r = await s.ready();
    const locks = await Promise.all([s.lock('race'), s.lock('race')]); assert.equal(locks.filter(Boolean).length, 1);
    const lock = locks.find(Boolean); await s.unlock({ name: lock.name, token: 'wrong' }); assert.equal(await s.owns(lock), true); await s.unlock(lock);
    const rate = await Promise.all(Array.from({ length: 20 }, () => s.rateLimit('race', 10, 60))); assert.equal(rate.filter(Boolean).length, 10); assert.ok(await r.ttl(s.key('rate:race')) > 0);
    const scope = s.scope('1', '1'), group = s.scope('-100', '1', 8);
    await s.finishUpdate(1, { scopeId: scope, userId: '1', userText: 'PRIVATE', reply: 'RESPONSE', puzzle: { active: 'c006' }, roomId: '-100:8', contextText: 'private user group quote', username: 'one' });
    await s.finishUpdate(2, { scopeId: s.scope('-100', '2', 8), userId: '2', userText: 'OTHER', reply: 'REPLY', roomId: '-100:8', contextText: 'other user quote', username: 'two' });
    assert.deepEqual((await s.history(scope)).map(m => m.content), ['PRIVATE', 'RESPONSE']); assert.equal((await s.history(group)).length, 0);
    await r.lpush(s.key(`history:${scope}`), JSON.stringify({ role: 'user', content: 'STALE', at: Date.now() - 8 * 86400000 }));
    assert.ok(!(await s.history(scope)).some(m => m.content === 'STALE'));
    await s.finishUpdate(3, { scopeId: group, userId: '1', puzzleRoomId: '-100:8', puzzle: { active: 'c006' } });
    assert.ok(await r.ttl(s.key('group-puzzle:-100:8')) > 0);
    await s.forget('1');
    assert.equal((await s.get('group-puzzle:-100:8')).active, 'c006'); assert.equal((await s.history(scope)).length, 0); assert.equal(await s.get(`puzzle:${scope}`), null);
    assert.deepEqual((await s.context('-100:8')).map(m => m.userId), ['2']);
    await s.markSending(42); assert.equal((await s.get('update:42')).state, 'sending'); assert.ok((await s.uncertain()).updates.includes('42'));
    await s.finishUpdate(42); assert.ok(!(await s.uncertain()).updates.includes('42'));
    await s.markWeeklySending('2026-09-30', { state: 'sending', puzzleId: 'w006' });
    await s.finishWeekly('2026-09-30', { state: 'sent', messageId: 123 }, { posted: ['w006'], last: 'w006' });
    assert.equal(await r.ttl(s.key(s.rotationName())), -1); assert.equal(await r.ttl(s.key(s.deliveryName('2026-09-30'))), -1);
    const overviewKey = 'overview:-999:delivery:2026-10-08';
    await s.markOverviewSending(overviewKey, { state: 'sending' });
    assert.ok((await s.uncertain()).overviews.includes(overviewKey));
    await s.finishOverview(overviewKey, { state: 'sent', messageId: 456 });
    assert.ok(!(await s.uncertain()).overviews.includes(overviewKey));
    assert.equal((await s.get(overviewKey)).messageId, 456);
    assert.equal(await r.ttl(s.key(overviewKey)), -1);
    await s.put('overview:-999:brief', { notes: 'test' }, 30 * 86400);
    await s.put('overview:-999:draft:1', { code: 'test' }, 86400);
    assert.ok(await r.ttl(s.key('overview:-999:brief')) > 29 * 86400);
    assert.ok(await r.ttl(s.key('overview:-999:draft:1')) > 86000);
    await s.put(s.rotationName(), { posted: [], last: null }, 0); assert.equal((await s.get(s.deliveryName('2026-09-30'))).messageId, 123);
  } finally { await s.close(); }
});
