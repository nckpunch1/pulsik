# pulseiq-bot

Telegram bot (@pulse_iq_bot) for the [@pulseiq_au](https://t.me/pulseiq_au) channel.

**Two features:**
1. **Weekly cron** — posts a *Четверговая разминка для мозга* every Thursday at 09:00 UTC (7 PM Brisbane / AEST UTC+10).
2. **Conversational AI** — Пульсик responds when @mentioned in the group chat, powered by Google Gemini Flash with per-user memory and rolling channel context stored in Redis.

---

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the project in [Vercel](https://vercel.com).
3. Connect a **Redis store** in Vercel Storage (KV) — `REDIS_URL` will be injected automatically.
4. Set the environment variables below in **Project → Settings → Environment Variables**.
5. Deploy.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | Yes | Default channel for weekly posts, e.g. `@pulseiq_au` |
| `CRON_SECRET` | Recommended | Vercel sends this as `Authorization: Bearer <secret>` on cron calls |
| `GEMINI_API_KEY` | Yes | Google AI Studio key — get one at https://aistudio.google.com/apikey |
| `REDIS_URL` | Yes | Injected automatically by Vercel when a Redis store is connected |
| `TELEGRAM_WEBHOOK_SECRET` | Recommended | Random string to verify webhook requests from Telegram |

Copy `.env.example` to `.env` for local testing (never commit `.env`).

---

## One-time setup after first deploy

### 1. Disable privacy mode on the bot

By default Telegram bots only see messages directed at them. To let Пульсик see all group messages (needed to build channel context):

1. Open [@BotFather](https://t.me/BotFather) → `/setprivacy`
2. Choose your bot → **Disable**

### 2. Register the webhook

After deploying to Vercel, run this once to tell Telegram where to send updates:

```bash
TELEGRAM_BOT_TOKEN=... \
TELEGRAM_WEBHOOK_SECRET=... \
WEBHOOK_URL=https://your-app.vercel.app \
node scripts/register-webhook.js
```

Telegram will now POST every update to `https://your-app.vercel.app/api/webhook`.

### 3. Add the bot to the group

Add @pulse_iq_bot to @pulseiq_au as a member. Admin rights are not required if privacy mode is disabled.

---

## Local test

```bash
# Install dependencies
npm install

# Copy and fill in env vars
cp .env.example .env

# Start local Vercel dev server
npx vercel dev

# Trigger the weekly cron manually
curl -H "Authorization: Bearer your_secret_here" http://localhost:3000/api/send-weekly

# Simulate a webhook update (replace values as needed)
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -H "x-telegram-bot-api-secret-token: your_random_secret_here" \
  -d '{"message":{"text":"@pulse_iq_bot привет!","from":{"id":123,"first_name":"Nick"},"chat":{"id":-456}}}'
```

---

## Adding more posts

Edit `content/posts.json`. Each entry needs:

```json
{
  "id": 21,
  "type": "puzzle",
  "content": "🧠 <b>Четверговая разминка для мозга</b>\n\n...\n\n🎯 <i>PulseIQ — интеллектуальные игры в Брисбене</i>"
}
```

`parse_mode` is set to `HTML`, so you can use `<b>`, `<i>`, `<tg-spoiler>`, etc.
