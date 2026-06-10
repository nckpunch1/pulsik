# pulseiq-bot

Telegram bot (@pulse_iq_bot) that posts a weekly **Четверговая разминка для мозга** (Thursday Brain Warmer) to the Telegram channel [@pulseiq_au](https://t.me/pulseiq_au).

Posts rotate automatically each week based on the current week number — no database required.

## Deploy to Vercel

1. Fork or push this repo to GitHub.
2. Import the project in [Vercel](https://vercel.com).
3. Set the environment variables below in **Project → Settings → Environment Variables**.
4. Deploy. Vercel will run the cron job every Thursday at 09:00 UTC (7 PM Brisbane / AEST UTC+10).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | Yes | Target channel, e.g. `@pulseiq_au` |
| `CRON_SECRET` | Recommended | Secret string; Vercel sends it as `Authorization: Bearer <secret>` to prevent unauthorized triggers |

Copy `.env.example` to `.env` for local testing (never commit `.env`).

## Local test

```bash
# Set env vars, then invoke the handler directly with curl against `vercel dev`:
npx vercel dev
curl -H "Authorization: Bearer your_secret_here" http://localhost:3000/api/send-weekly
```

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
