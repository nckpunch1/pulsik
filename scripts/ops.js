'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { config } = require('../lib/config');
const store = require('../lib/redis');
async function main() {
  const cfg = config(), args = process.argv.slice(2), action = args[0] || 'status';
  const value = flag => args[args.indexOf(flag) + 1];
  const r = await store.ready();
  const snapshot = {
    at: new Date().toISOString(), environment: cfg.env, destination: cfg.channel,
    rotation: await store.get(store.rotationName()),
    legacy: { posted: await r.smembers('weekly:postedPuzzleIds'), last: await r.get('weekly:lastPuzzleId') },
    uncertain: await store.uncertain(),
  };
  if (action === 'status') { console.log(JSON.stringify(snapshot, null, 2)); return; }
  if (!['initialize', 'reset', 'resolve-weekly', 'resolve-update', 'resolve-overview'].includes(action)) throw new Error('Unknown action');
  if (!args.includes('--apply')) { console.log(JSON.stringify({ dryRun: true, action, ...snapshot }, null, 2)); return; }
  if (!args.includes('--confirm') || value('--confirm') !== `${cfg.env}:${cfg.channel}`) throw new Error('Exact environment:destination confirmation required');
  const lock = await store.lock(action === 'resolve-overview' ? `overview:${cfg.channel}` : `weekly:${cfg.channel}`);
  if (!lock) throw new Error('Weekly operation busy');
  try {
    // Re-read under the same lock as weekly sends. Backup is durable before mutation.
    snapshot.rotation = await store.get(store.rotationName());
    snapshot.uncertain = await store.uncertain();
    const dir = path.join(__dirname, '../.ops-backups'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const filename = path.join(dir, `${Date.now()}-${action}.json`);
    const week = value('--week'), updateId = value('--update'), overviewDate = value('--date');
    const overviewKey = `overview:${cfg.channel}:delivery:${overviewDate}`;
    if (action === 'resolve-overview') snapshot.overview = await store.get(overviewKey);
    if (action === 'resolve-weekly') snapshot.delivery = await store.get(store.deliveryName(week));
    if (action === 'resolve-update') snapshot.update = await store.get(`update:${updateId}`);
    const fd = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(snapshot, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (action === 'initialize') {
      if (snapshot.rotation) throw new Error('Rotation already initialized; use reset only at final launch step');
      if (!args.includes('--from-legacy') && !args.includes('--fresh')) throw new Error('Choose --from-legacy or --fresh explicitly');
      const rotation = args.includes('--from-legacy') ? snapshot.legacy : { posted: [], last: null };
      await store.put(store.rotationName(), rotation, 0);
    } else if (action === 'reset') {
      if (snapshot.uncertain.weeks.length) throw new Error('Reconcile weekly deliveries before resetting');
      if (!snapshot.rotation) throw new Error('Initialize/migrate first');
      await store.put(store.rotationName(), { posted: [], last: null }, 0);
      const check = await store.get(store.rotationName());
      if (check.posted.length || check.last !== null) throw new Error('Reset verification failed');
    } else if (action === 'resolve-weekly') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(week || '') || !snapshot.delivery || !['sending', 'uncertain', 'rejected'].includes(snapshot.delivery.state)) throw new Error('No unresolved delivery for that week');
      if (args.includes('--message-id')) {
        const id = Number(value('--message-id'));
        if (!Number.isSafeInteger(id) || id <= 0 || !snapshot.delivery.nextRotation) throw new Error('Valid observed Telegram message ID and saved rotation required');
        await store.finishWeekly(week, { ...snapshot.delivery, state: 'sent', messageId: id, reconciledAt: Date.now() }, snapshot.delivery.nextRotation);
      } else if (args.includes('--confirmed-not-sent')) {
        await store.transaction([['set', store.key(store.deliveryName(week)), JSON.stringify({ state: 'retry', reconciledAt: Date.now() })], ['srem', store.key('uncertain:weekly'), week]]);
      } else throw new Error('Inspect Telegram first; provide --message-id or --confirmed-not-sent');
    } else if (action === 'resolve-overview') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(overviewDate || '') || !snapshot.overview || !['sending', 'uncertain', 'rejected'].includes(snapshot.overview.state)) throw new Error('No unresolved overview for that date');
      if (args.includes('--message-id')) {
        const id = Number(value('--message-id'));
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Observed Telegram message ID required');
        await store.finishOverview(overviewKey, { ...snapshot.overview, state: 'sent', messageId: id, reconciledAt: Date.now() });
      } else if (args.includes('--confirmed-not-sent')) {
        await store.finishOverview(overviewKey, { ...snapshot.overview, state: 'retry', reconciledAt: Date.now() });
      } else throw new Error('Inspect Telegram first; provide --message-id or --confirmed-not-sent');
    } else {
      if (!/^\d+$/.test(updateId || '') || !snapshot.update || !['sending', 'uncertain', 'retry'].includes(snapshot.update.state)) throw new Error('No unresolved update');
      const updateLock = await store.lock(`update:${updateId}`);
      if (!updateLock) throw new Error('Update busy');
      try {
        // Close an ambiguous update without sending or replaying private content.
        await store.finishUpdate(Number(updateId));
      } finally { await store.unlock(updateLock); }
    }
    console.log(JSON.stringify({ action, applied: true, backup: filename, deliveryHistoryPreserved: action === 'reset' }));
  } finally { await store.unlock(lock); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(store.close);
