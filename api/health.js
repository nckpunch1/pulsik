'use strict';
const { config, authorized } = require('../lib/config');
const store = require('../lib/redis');
const { latestDue } = require('../lib/weekly');
const { sendMessage, telegram } = require('../lib/telegram');
const { getUpcomingSessions } = require('../lib/sessions');
const { getWeeklyBank, getChatBank } = require('../lib/puzzle-bank');
const { event } = require('../lib/observability');
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  let cfg;
  try { cfg = config(); } catch { return res.status(503).json({ ok: false, issues: ['configuration'] }); }
  if (!authorized(req.headers.authorization, `Bearer ${cfg.cronSecret}`)) return res.status(401).json({ error: 'Unauthorized' });
  const issues = [];
  if (!cfg.operators.length) issues.push('operator_unconfigured');
  try {
    const pending = await store.uncertain();
    if (pending.updates.length || pending.weeks.length || pending.overviews?.length || pending.introductions?.length) issues.push('delivery_review');
    const rotation = await store.get(store.rotationName());
    if (cfg.weeklyEnabled && !rotation) issues.push('rotation_uninitialized');
    const slot = latestDue();
    if (cfg.weeklyEnabled && slot.id >= process.env.WEEKLY_START_DATE && Date.now() > slot.at + 3600000) {
      const delivery = await store.get(store.deliveryName(slot.id));
      if (!delivery || !['sent', 'skipped'].includes(delivery.state)) issues.push('weekly_missing');
    }
    const bank = getWeeklyBank(); getChatBank();
    if (rotation && bank.filter(p => !rotation.posted.includes(p.id)).length <= 3) issues.push('weekly_bank_low');
  } catch { issues.push('storage_or_bank_failure'); }
  try {
    const webhook = await telegram('getWebhookInfo', {}, { deadline: Date.now() + 5000 });
    if (webhook.url !== `${process.env.WEBHOOK_URL}/api/webhook`) issues.push('webhook_url');
    if (webhook.last_error_date && webhook.last_error_date * 1000 > Date.now() - 86400000) issues.push('webhook_recent_error');
    if (webhook.pending_update_count > 20) issues.push('webhook_backlog');
  } catch { issues.push('telegram_unavailable'); }
  if (await getUpcomingSessions() === null) issues.push('schedule_unavailable');
  const fingerprint = issues.sort().join(',');
  event('HEALTH_CHECK', { state: fingerprint || 'healthy' });
  if (issues.length) {
    // One alert per distinct issue set per day; no text, IDs or credentials in alerts.
    let notify = true;
    try { const old = await store.get('health:alert'); notify = !old || old.fingerprint !== fingerprint || Date.now() - old.at > 86400000; } catch { /* Redis outage must itself alert. */ }
    if (notify) {
      let allSent = true;
      for (const operator of cfg.operators) {
        try { await sendMessage(`Pulse Bot (${cfg.env}): требуется проверка.\n${issues.join('\n')}\nИнструкция: RUNBOOK.md в репозитории.`, operator, { deadline: Date.now() + 4000 }); }
        catch { allSent = false; event('HEALTH_ALERT_FAILED'); }
      }
      if (allSent) await store.put('health:alert', { fingerprint, at: Date.now() }, 172800).catch(() => {});
    }
  } else await store.put('health:alert', { fingerprint: '', at: Date.now() }, 172800).catch(() => {});
  return res.status(issues.length ? 503 : 200).json({ ok: !issues.length, issues });
};
