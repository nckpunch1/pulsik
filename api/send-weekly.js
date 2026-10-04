'use strict';
const { config, authorized } = require('../lib/config');
const store = require('../lib/redis');
const { getWeeklyBank } = require('../lib/puzzle-bank');
const { sendMessage } = require('../lib/telegram');
const { scheduledWeek, selectPuzzle, buildPost } = require('../lib/weekly');
const { event } = require('../lib/observability');
module.exports = async function handler(req, res) {
  const deadline = Date.now() + 40000;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  let cfg;
  try { cfg = config(); } catch { return res.status(503).json({ error: 'Bot not configured' }); }
  if (!authorized(req.headers.authorization, `Bearer ${cfg.cronSecret}`)) return res.status(401).json({ error: 'Unauthorized' });
  if (!cfg.weeklyEnabled) return res.status(200).json({ ok: true, paused: true });
  const slot = scheduledWeek();
  if (Date.now() < slot.at || slot.id < process.env.WEEKLY_START_DATE) return res.status(200).json({ ok: true, notDue: true });
  let lock, sending = false;
  try {
    lock = await store.lock(`weekly:${cfg.channel}`);
    if (!lock) return res.status(409).json({ error: 'Weekly delivery busy' });
    const previous = await store.get(store.deliveryName(slot.id));
    if (previous?.state === 'sent' || previous?.state === 'skipped') return res.status(200).json({ ok: true, duplicate: true });
    if (previous && ['sending', 'uncertain'].includes(previous.state)) {
      event('WEEKLY_REQUIRES_REVIEW', { week: slot.id });
      return res.status(409).json({ error: 'Delivery requires operator reconciliation' });
    }
    if (previous?.retryAt > Date.now()) return res.status(429).json({ error: 'Retry later' });
    const rotation = await store.get(store.rotationName());
    const selected = selectPuzzle(getWeeklyBank(), rotation);
    const post = buildPost(selected.puzzle);
    if (post.length > 4096) throw new Error('Post too long');
    const delivery = { state: 'sending', topicId: cfg.weeklyTopic || null, puzzleId: selected.puzzle.id, at: Date.now(), nextRotation: selected.rotation };
    if (!await store.owns(lock)) throw new Error('Lock expired');
    await store.markWeeklySending(slot.id, delivery); sending = true;
    const result = await sendMessage(post, cfg.channel, { html: true, topicId: cfg.weeklyTopic, deadline: deadline - 5000 });
    await store.finishWeekly(slot.id, { ...delivery, state: 'sent', messageId: result.message_id, sentAt: Date.now() }, selected.rotation);
    event('WEEKLY_DELIVERED', { week: slot.id, count: selected.rotation.posted.length });
    return res.status(200).json({ ok: true, puzzleId: selected.puzzle.id, messageId: result.message_id });
  } catch (err) {
    if (sending && err.ambiguous === false) {
      await store.put(store.deliveryName(slot.id), { state: 'rejected', code: err.code, retryAt: Date.now() + (err.retryAfter || 60) * 1000 }, 0).catch(() => {});
    }
    event('WEEKLY_FAILED', { week: slot.id, state: sending ? 'delivery_review' : 'before_send' });
    return res.status(503).json({ error: 'Weekly delivery failed; inspect health and delivery state' });
  } finally { await store.unlock(lock).catch(() => {}); }
};
