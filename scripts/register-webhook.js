'use strict';
const { config } = require('../lib/config');
const { telegram } = require('../lib/telegram');
async function main() {
  const cfg = config();
  if (process.env.BOT_ENV === 'production' && !process.argv.includes('--production')) throw new Error('Use --production after preflight and test rehearsal');
  await telegram('setWebhook', { url: `${process.env.WEBHOOK_URL}/api/webhook`, secret_token: cfg.webhookSecret, allowed_updates: ['message'], drop_pending_updates: false });
  console.log('Webhook registered with secret. Pending updates preserved.');
}
main().catch(() => { console.error('Webhook registration failed; check configuration and connectivity.'); process.exitCode = 1; });
