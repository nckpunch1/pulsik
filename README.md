# pulseiq-bot

Telegram bot (@pulse_iq_bot) for the [@pulseiq_au](https://t.me/pulseiq_au) channel.

**Two features:**
1. **Weekly cron** — posts a *СредаIQ — прокачай интеллект* every Wednesday at 09:00 UTC (7 PM Brisbane / AEST UTC+10, same UTC day). The puzzle is drawn from the curated bank in `content/weekly-puzzles.json`, never generated: posted ids are tracked in Redis so nothing repeats until the bank is exhausted, then it reshuffles. `content/posts.json` is only a safety net for a missing bank file. A fallback fire logs `FALLBACK_USED` and returns `degraded: true`.
2. **Conversational AI** — Пульсик responds when @mentioned in the group chat, powered by Groq (GPT-OSS 120B, falling back to GPT-OSS 20B) with per-user memory and rolling channel context stored in Redis.

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
| `CRON_SECRET` | **Yes** | Vercel sends this as `Authorization: Bearer <secret>` on cron calls. The endpoint refuses to run without it. |
| `GROQ_API_KEY` | Yes | Groq API key — get one at https://console.groq.com/keys |
| `GROQ_MODEL` | No | Chat model override. Default: `openai/gpt-oss-120b` |
| `GROQ_FALLBACK_MODEL` | No | Model used when the primary errors. Default: `openai/gpt-oss-20b`. Must be a current Groq **production** model — check https://console.groq.com/docs/deprecations before changing. |
| `REDIS_URL` | Yes | Injected automatically by Vercel when a Redis store is connected |
| `TELEGRAM_WEBHOOK_SECRET` | **Yes** | Random string to verify webhook requests from Telegram. The webhook refuses updates without it. |
| `BANK_STATUS_CODE` | No | Numeric code in the puzzle-bank status command (see below). Default: `12345`. Set this to rotate the code without a code change. |

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

## Puzzle banks

`content/weekly-puzzles.json` is the source of the weekly СредаIQ post. It replaced LLM generation, which produced puzzles that were sometimes ambiguous or unsolvable. Shape:

```json
{ "puzzles": [ { "id": "w001", "question": "...", "answer": "...", "explanation": "..." } ] }
```

`question` is the visible text; `answer` and `explanation` go together under the Telegram spoiler. `explanation` is optional — an entry missing `id`, `question` or `answer` is skipped at load with a log line.

Selection is a random draw among ids not yet in the Redis set `weekly:postedPuzzleIds`. When every id has been posted the handler logs `BANK_EXHAUSTED`, clears the set and starts a fresh cycle (excluding just the previous week's puzzle, so it can't repeat back to back). The set has no TTL — at one post a week a cycle spans months. Each post logs `posted bank puzzle wNNN (n/N this cycle)`.

**To top the bank up:** add entries to the file and redeploy. Ids must be unique; new ones count as unused immediately.

`content/chat-puzzles.json` is the same shape for DM conversation, but nothing reads it yet.

### Checking how many are left

Send the bot this exact phrase, in a DM or the group:

```
Пульсик 12345 статус банков вопросов
```

It replies with how many weekly puzzles are still unused in the current cycle, which ids have gone out, and the size of the chat bank. The command is answered before any LLM call and is never written to chat history. The code is `BANK_STATUS_CODE` (default `12345`) — it is a plain phrase rather than a `/slash` command on purpose, since Telegram advertises registered commands to every member of a group.

## Fallback posts

`content/posts.json` is only used when the bank file itself is missing or unreadable — when that happens the handler logs `BANK_UNAVAILABLE` and `FALLBACK_USED` and returns `degraded: true`, so grep the Vercel logs for those markers rather than trusting the cron's green tick.

Only `type: "puzzle"` entries are eligible, picked by `weekNumber % puzzlePosts.length`, so the list cycles and never runs out. Each entry's header must match its actual content — `puzzle` entries carry the СредаIQ title, `fact` entries carry their own:

```json
{
  "id": 21,
  "type": "puzzle",
  "content": "🧠 <b>СредаIQ — прокачай интеллект</b>\n\n...\n\n🎯 <i>PulseIQ — интеллектуальные игры в Брисбене</i>"
}
{
  "id": 22,
  "type": "fact",
  "content": "💡 <b>Это интересно</b>\n\n...\n\n🎯 <i>PulseIQ — интеллектуальные игры в Брисбене</i>"
}
```

`parse_mode` is set to `HTML`, so you can use `<b>`, `<i>`, `<tg-spoiler>`, etc.
