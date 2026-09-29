# Pulse Bot / Пульсик

Telegram companion for PulseIQ. Production reference: https://pulsik.vercel.app/.

- Weekly **СредаIQ**: Wednesday 09:00 UTC / 19:00 Brisbane, drawn from a curated bank and posted with a spoiler answer.
- Member conversations: DMs and explicitly allowed discussion groups/topics. Broadcast channel messages are ignored.
- Private puzzles: `/puzzle`, `/hint`, `/answer`, `/chat`. Puzzle state and canonical answers come from the bank, not model invention. Unrecognized answers are never automatically labelled wrong.
- `/start`, `/help`, `/privacy`, `/forget`, `/whoami` work while conversation mode is paused.
- `/bankstatus`: private, operator-only status. The old phrase is recognized for compatibility but never authorizes access by itself.

The repository now contains **16 enabled weekly puzzles** (plus 5 held for editorial review), and **63 enabled chat puzzles** (plus 4 held). The ten new weekly entries are w012–w021. Stable IDs are retained; disabled entries are not selected. See [CONTENT-REVIEW.md](CONTENT-REVIEW.md).

## Local checks

Requires Node **24.x** (also the current Vercel project runtime).

```sh
npm ci
npm run check
npm audit --omit=dev --audit-level=high
```

Tests stub external APIs. For storage integration, supply a **disposable local/CI Redis**:

```sh
REDIS_TEST_URL=redis://127.0.0.1:6379 npm test
```

CI provisions Redis and runs the same checks. Never point the integration suite at production. No default test calls Telegram or Groq.

## Configuration

Copy `.env.example` to an ignored `.env` for local operations. Put actual production values in Vercel. Never paste secrets into chat or commit them.

| Variable | Purpose |
| --- | --- |
| `BOT_ENV` | Required stable namespace, e.g. `staging` or `production`. Do not change casually: it selects different state. |
| `TELEGRAM_BOT_TOKEN` | Required token; its numeric prefix identifies this bot. |
| `BOT_USERNAME` | Default `pulse_iq_bot`; must match `getMe`. |
| `TELEGRAM_CHAT_ID` | Weekly destination; verified broadcast channel for public launch. |
| `TELEGRAM_WEBHOOK_SECRET` | Required 16–256 character Telegram-compatible secret. |
| `CRON_SECRET` | Required cron/health bearer secret. |
| `REDIS_URL` | Required durable Redis; failures stop processing rather than remove limits. |
| `GROQ_API_KEY` | Required for conversation generation. |
| `GROQ_MODEL` / `GROQ_FALLBACK_MODEL` | Defaults `openai/gpt-oss-120b` / `openai/gpt-oss-20b`; no SDK retries. |
| `WEBHOOK_URL` | HTTPS origin, e.g. `https://pulsik.vercel.app`, without a trailing slash. |
| `OPERATOR_USER_IDS` | Comma-separated numeric Telegram IDs; required before enabling either launch switch. May be empty during paused `/whoami` setup. Intended admin: `@Nikomaniak`; usernames alone are not authorization. |
| `ALLOWED_GROUP_IDS` | Comma-separated numeric group IDs. Empty disables group participation. |
| `PRIVATE_TEST_MODE` | Operator DMs only; blocks groups, weekly posts and overview publication. `/whoami`, `/privacy`, `/forget` remain available in private chats for setup. |
| `CHAT_ENABLED` | `true` to enable conversations/puzzle play; defaults off. |
| `WEEKLY_ENABLED` | `true` to allow weekly posts; defaults off. |
| `WEEKLY_START_DATE` | First approved weekly Wednesday date, required when weekly posting is enabled. |
| `GROUP_CONTEXT_ENABLED` | Optional background collection of recent group text, defaults off. Enable only with a member-facing notice. |
| `ALTERNATE_PERSONA_ENABLED` | Optional theatrical persona, defaults off. Shared business/privacy rules remain in force. |
| `GLOBAL_DAILY_REPLY_LIMIT` | Maximum admitted model-backed turns per UTC day; default 300. Each can make up to two model attempts. |
| `GLOBAL_MINUTE_REPLY_LIMIT` | Maximum admitted model-backed turns per rolling fixed window; default 30. |

Set a hard spend limit in the Groq account as well. The application cap bounds requests, not exact currency spend. User/chat reply limits are 10/20 per minute. Non-conversational background context is only stored when explicitly enabled.

## Deployment and Telegram setup

1. Use a **separate test bot and private test channel/group** for the rehearsal. Test and production must have different `BOT_ENV` and preferably separate Redis credentials; previews must never register a webhook for the production bot.
2. Add the production bot as a channel administrator with posting permission. Link a discussion group for member comments and add it to `ALLOWED_GROUP_IDS`. If group privacy remains enabled, name-only triggers will not reliably arrive; disable it in BotFather for that behavior. Only grant extra administrator rights if actually needed.
3. Operator starts the bot in a private chat so operational alerts can be delivered. `/whoami` reports the numeric user ID; configure that ID for operator authorization.
4. Deploy with `CHAT_ENABLED=false` and `WEEKLY_ENABLED=false`. Initialize/migrate rotation deliberately; see the runbook. Deployment alone never clears old state.
5. Register webhook with the required secret. Pending updates are preserved:

```sh
node --env-file=.env scripts/register-webhook.js
# Production requires an explicit environment flag:
node --env-file=.env scripts/register-webhook.js --production
```

6. Run `npm run preflight`. This is read-only: it checks bot identity, webhook URL, channel/group access, Redis rotation and schedule availability. It cannot inspect Telegram's stored webhook secret; a real test update must verify that.
7. Complete the private rehearsal in [RUNBOOK.md](RUNBOOK.md), then set launch switches in Vercel and redeploy. Changing Vercel environment variables alone does not change existing deployments.
8. **Reset the public puzzle rotation last**, with a backup and exact destination confirmation. Do not call the weekly endpoint just to inspect state.

## Reliability and privacy

Conversation memory uses environment, bot, chat, topic and user IDs. Legacy mixed memory is never loaded. User/assistant pairs and puzzle state are committed together. Per-user locks prevent concurrent turns and `/forget` races; busy requests return a retryable status.

Update IDs have seven-day delivery records. Weekly delivery records are durable and separate from puzzle rotation. A `sending` record survives ambiguous Telegram errors or a post-send Redis failure: it blocks an automatic resend and requires operator reconciliation. This prefers a visibly missed/uncertain post over a duplicate. There is no unverified static fallback and no random draw during a Redis outage.

Chat history is capped at 20 messages, group context at 20 short entries per topic, and messages older than seven days are excluded. Inactive state expires after seven days. Active puzzle seen-history can persist while the conversation remains active. `/forget` removes all indexed history/puzzles/persona state and the user's indexed group quotes, plus old user-only history. Old unindexed legacy group quotes cannot be attributed reliably; they are not read and expire under the old seven-day TTL. `/forget` cannot erase messages already in Telegram or provider records.

Health checks run daily at 10:00 UTC, an hour after the weekly slot. `/api/health` requires the cron bearer secret and returns non-200 for issues. It alerts configured operators, with a one-day cooldown for an unchanged issue set. Configure an **independent external uptime monitor** for this endpoint too: an application cannot report its own total deployment outage or a missed health cron. See the runbook for incident handling.

## Persona and game overviews

With `ALTERNATE_PERSONA_ENABLED=true`, a member can use `/blatnoy` (or ask for Блатной Пульсик) and `/normal` to switch back. The voice is scoped to that user, chat and topic. It lasts four conversational turns, at most one hour; an unfinished private puzzle keeps the voice through its hints and solution within that hour. Bank facts and answers are never rewritten. Scheduled channel puzzles use the shared СредаIQ format: an individual member's persona does not change a public broadcast.

Operators can keep one temporary game brief per destination, separate from member memory. In the bot's **private chat**:

```text
/gamebrief 2026-10-08
Content notes about this game, without logistics.
/overview
/publish CODE_FROM_PREVIEW
```

`/gamebrief example` loads the supplied October 8 brief. `/gamebrief` shows the notes; `/gameclear` removes them; `/overview_cancel` discards your draft. Notes expire after 30 days and drafts after 24 hours. `/forget` clears conversation memory; use `/gameclear` for these shared administrative notes. Draft generation sends the notes to Groq. Other members cannot access them through these commands or conversational memory.

The overview uses a consistent template and organiser voice, with title, date, time and venue from the live schedule. It requires one matching upcoming game. Review the private preview for factual accuracy before publishing its exact code. Publication rechecks the schedule and brief; any changes require a new preview. Nothing publishes on a timer. One successful overview per game date is recorded permanently to prevent duplicates. These operator commands remain available while chat/weekly switches are paused.
