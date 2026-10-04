'use strict';
const { config } = require('../lib/config');
const store = require('../lib/redis');
const { telegram } = require('../lib/telegram');
const { getUpcomingSessions } = require('../lib/sessions');
async function main() {
  const cfg = config(), problems = [];
  const me = await telegram('getMe', {});
  if (String(me.id) !== cfg.botId || me.username !== cfg.username) problems.push('Bot identity mismatch');
  const channel = await telegram('getChat', { chat_id: cfg.channel });
  const membership = await telegram('getChatMember', { chat_id: cfg.channel, user_id: Number(cfg.botId) });
  if (cfg.weeklyTopic || cfg.announcementTopic) {
    if (channel.type !== 'supergroup' || !channel.is_forum) problems.push('Topic destination must be a forum supergroup');
    if (!['member', 'administrator', 'creator'].includes(membership.status)) problems.push('Bot cannot post to forum group');
    if (membership.status === 'member' && channel.permissions?.can_send_messages === false) problems.push('Group blocks member posting');
    // Telegram has no read-only getForumTopic method: actual topic delivery needs a rehearsal.
  } else {
    if (channel.type !== 'channel') problems.push('Weekly destination is not a broadcast channel');
    if (!['administrator', 'creator'].includes(membership.status) || !membership.can_post_messages) problems.push('Missing channel posting permission');
  }
  if (!cfg.groups.length) problems.push('No discussion group configured');
  if (channel.linked_chat_id && !cfg.groups.includes(String(channel.linked_chat_id))) problems.push('Linked discussion group not allowlisted');
  for (const id of cfg.groups) {
    const group = await telegram('getChat', { chat_id: id });
    const member = await telegram('getChatMember', { chat_id: id, user_id: Number(cfg.botId) });
    if (!['group', 'supergroup'].includes(group.type)) problems.push('Invalid group type');
    if (!['member', 'administrator', 'creator'].includes(member.status)) problems.push('Bot cannot participate in group');
    if (member.status !== 'administrator' && !me.can_read_all_group_messages) problems.push('Disable group privacy for name triggers');
  }
  const hook = await telegram('getWebhookInfo', {});
  if (hook.url !== `${process.env.WEBHOOK_URL}/api/webhook`) problems.push('Webhook URL mismatch');
  if (hook.pending_update_count > 20) problems.push('Webhook backlog');
  if (!await store.get(store.rotationName())) problems.push('Rotation not initialized');
  if ((await store.uncertain()).weeks.length) problems.push('Unresolved weekly delivery');
  if (await getUpcomingSessions() === null) problems.push('Schedule unavailable');
  console.log(JSON.stringify({ environment: cfg.env, chatEnabled: cfg.chatEnabled, weeklyEnabled: cfg.weeklyEnabled, checksPassed: problems.length === 0, problems }, null, 2));
  if (problems.length) process.exitCode = 1;
}
main().catch(() => { console.error('Preflight failed; check configuration/connectivity. No messages were sent.'); process.exitCode = 1; }).finally(store.close);
