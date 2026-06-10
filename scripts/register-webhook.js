'use strict';

// Usage: WEBHOOK_URL=https://your-app.vercel.app node scripts/register-webhook.js

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const webhookUrl = process.env.WEBHOOK_URL;

if (!token || !webhookUrl) {
  console.error('TELEGRAM_BOT_TOKEN and WEBHOOK_URL must be set');
  process.exit(1);
}

const url = `https://api.telegram.org/bot${token}/setWebhook`;

fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: `${webhookUrl}/api/webhook`,
    ...(secret ? { secret_token: secret } : {}),
  }),
})
  .then(r => r.json())
  .then(data => {
    console.log('Telegram response:', JSON.stringify(data, null, 2));
    if (data.ok) {
      console.log('Webhook registered successfully.');
    } else {
      console.error('Failed to register webhook:', data.description);
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('Request failed:', err.message);
    process.exit(1);
  });
