# Pulse Bot launch audit — 28 September 2026

## Implementation update — 28 September 2026

The findings below describe the original checkout. The local working tree now implements isolated memory, atomic conversation turns, update and weekly delivery guards, bounded network calls, operator authorization, group allowlisting, topic replies, request budgets, kill switches, corrected venue fields, curated DM puzzles, privacy/onboarding commands, shared persona rules, health alerts, preflight/reconciliation/reset tooling and CI.

Content review leaves **16 enabled weekly puzzles** (including ten new additions) and **63 enabled chat puzzles**. Held entries remain in the files for review. See `CONTENT-REVIEW.md` and `RUNBOOK.md`.

Verification: **50 tests passed**, including real Redis integration on a disposable local server; JavaScript/bank validation passed; npm production dependency audit reported **zero known vulnerabilities**. The application dependencies were not changed.

Live rollout remains pending. Read-only Vercel inspection confirmed project `pulsik`, repository `pulsik`, and Node 24.x. Its sensitive environment values were not retrievable through the API; live Telegram identity, destination, permissions and Redis rotation were therefore not verified. No production configuration, deployment, webhook or Redis state was changed. Intended admin is `@Nikomaniak`; numeric user ID and discussion group/topic details are still needed. An external uptime monitor and real private Telegram rehearsal also remain deployment tasks. The backup-first live rotation reset remains the final step.

**Recommendation:** fix the privacy and delivery blockers before a public launch. The existing implementation is a workable foundation; a rewrite is unnecessary. A launch this week is plausible if these changes and a private Telegram rehearsal pass, but production readiness has not yet been verified.

## Scope and evidence

Reviewed both API handlers, all libraries, webhook registration, configuration, both puzzle banks, and the local admin schedule endpoint. All 11 JavaScript files pass Node syntax checks. Both banks parse, have required fields and unique IDs: **11 weekly puzzles and 67 chat puzzles**. There is no configured test suite or CI workflow in this checkout.

Six offline, dependency-mocked checks confirmed: DM history enters group generation; repeated update IDs produce repeated replies; replies to other bots trigger Pulsik; an arbitrary user can invoke the default bank status command; two concurrent weekly invocations both send; and the schedule formatter drops the API's venue fields. These checks establish application behavior, not real Telegram delivery or actual LLM disclosure.

No application code, puzzle content, Redis state, webhook registration, deployment, or Telegram messages were changed. No live credentials were loaded. The actual deployment version, webhook health, destination chat, permissions, Redis usage, Groq account limits, and dependency vulnerability status remain unverified.

## Fix before public launch

### 1. High — Private conversation content can enter public replies

`lib/redis.js:18` keys memory only by user ID; `api/webhook.js:128` uses that memory in every chat. A member who talks privately and then mentions the bot in a group has private history included in that group's LLM request. The prompt's confidentiality instruction is not a data boundary.

Use a key including environment, chat ID and user ID (topic ID too if topics are supported). Start a new memory namespace rather than copying mixed legacy history into it. Save user/assistant turns together atomically and serialize overlapping turns for the same conversation; the current independent writes can interleave. Acceptance: a private sentinel never appears in a group model request.

### 2. High — Weekly posting has no protection against repeated runs

`api/send-weekly.js:51,135` selects, sends, then records usage without a weekly delivery key or lock. Duplicate/manual/concurrent invocations can send multiple posts and can select the same puzzle. Recording errors are swallowed by `lib/redis.js:105`, so a successful response does not prove usage was saved. Read failures silently turn selection into unrestricted random draws.

Add a distributed lock plus a durable delivery record keyed by environment, destination and scheduled week. Record selected puzzle, delivery state and returned Telegram message ID. Distinguish definite rejection from an ambiguous network failure: the current broad fallback may send a second puzzle after Telegram accepted the first but its response was lost. Do not blindly resend ambiguous deliveries. Fail visibly when durable weekly state is unavailable; provide an operator reconciliation procedure. A lock alone cannot guarantee exactly-once delivery across Redis and Telegram.

### 3. High — Telegram update retries can repeat replies and cost

`api/webhook.js` never reads `update_id`. Duplicate delivery repeats the model call and reply. Introduce a durable update claim/completion mechanism with bounded retention and recoverable failure states. Test repeated and concurrent delivery of the same update. Do not mark an update completed before its required work succeeds.

### 4. High — Total request time can exceed the function limit

`lib/llm.js:23` permits a 15-second attempt plus one retry for both primary and fallback models: roughly 60 seconds before backoff, Redis, schedule lookup and Telegram delivery. The function limit is 60 seconds. `lib/sessions.js:13` and `lib/telegram.js:14` have no explicit fetch deadline. Empty or truncated model output is not validated. The error-message send can itself reject outside protection.

Give the entire request a deadline, reserve delivery time, bound every network operation, and reduce model retries accordingly. Validate nonempty output and handle length limits, HTTP errors and Telegram rate limits. Exercise primary failure, fallback failure, empty output, slow schedule service, Redis outage, and Telegram rejection without sending duplicate error messages.

### 5. Launch setup gate — Channel publishing and member chat are distinct

The handler deliberately ignores broadcast channel posts (`api/webhook.js:62`). Members should interact in a linked discussion group or in DMs. The README conflates channel and group setup: channel publishing needs the appropriate administrator posting right, while group participation has separate privacy/permissions settings.

Verify the production channel ID, linked discussion group ID, bot identity, channel posting permission, group visibility, and webhook secret. If discussion topics are used, preserve reply/topic identifiers: `sendMessage` currently accepts only text and chat ID. Webhook registration must require the secret; the script currently allows registration without one even though the handler rejects all such updates. Perform a real rehearsal in a separate private test destination before public rollout.

## Important fixes for the launch sprint

- **Restrict activation:** `api/webhook.js:92` treats a reply to any bot as a reply to Pulsik. Match Pulsik's numeric bot ID; ignore other bot senders. Decide which groups are allowed. Currently any group where the bot receives messages can use it.
- **Operator access:** the bank status phrase defaults to `12345`, has no operator identity check, works publicly, and runs before rate limiting. It only reads status today, but must not be reused as authorization for reset operations. Restrict operational commands to configured Telegram user IDs in DMs.
- **Abuse and spend controls:** rate limits are per user/chat only and fail open on Redis errors (`lib/redis.js:65`). Add a global spending/request budget, atomic rate-limit expiry, and a deliberate outage policy. Add a switch to disable conversational replies while keeping operational access.
- **Correct schedule venues:** the producer (`../admin-host/api/public/upcoming-sessions.js`) returns `venueName` / `venueSuburb`; `lib/format.js:31` expects `venue`. Map the actual fields and add a contract check. Distinguish an unavailable schedule from an empty one.
- **Wire curated DM puzzles:** the 67-item chat bank is read only for status. Conversations still ask the LLM to invent puzzles. Track active puzzle, canonical answer, hints, completion and seen IDs per private conversation; let the model phrase hints, with the stored puzzle as the source of truth.
- **Privacy controls and onboarding:** group context stores the latest 20 entries and refreshes a seven-day TTL on activity; active keys can persist beyond seven calendar days. User history is also 20 messages, about ten exchanges. Add clear `/start`, `/help`, `/privacy`, and `/forget` behavior and describe group-context collection. The persona currently instructs the bot never to identify as AI; allow an honest explanation when asked while retaining its character.
- **Preserve baseline rules in the alternate persona:** the theatrical persona replaces the normal prompt, dropping the detailed business-fact restrictions. Keep shared safety/business rules separate from style. Decide whether this persona belongs in the initial public release.
- **Monitoring:** record update/delivery IDs, latency, model fallback, errors, and durable weekly delivery status without logging private text or secrets. Alert on missed weekly delivery, Redis failure and fallback posts; console markers alone are not a monitoring system.
- **Configuration and CI:** pin a supported deployment Node major; validate required variables at startup; add focused regression tests for the issues above and a bank validator. Review dependency advisories and deployed versions before upgrading packages. Both configured Groq model IDs remain listed as production models in the documentation checked during this audit; no model replacement is indicated solely by their names.

## Puzzle review and reset — last

Weekly selection is random among unused IDs, not an ordered queue. Eleven entries provide eleven weekly slots from a fresh cycle, then the bank reshuffles. Actual remaining count cannot be inferred from the JSON; it lives in Redis. The configured schedule is Wednesday 09:00 UTC / 7 PM Brisbane. The next configured slot after this audit date is 30 September 2026; actual execution and timing depend on the deployment.

Content is labelled verified, but should get an editorial pass before enabling the chat bank. Specific examples:

- `c013`: the answer can stand, but the explanation says both statements are true and then correctly says Karl's is false. Change “both true” to “both consistent with their truth/lie schedules”.
- `c045`: at minute 11, the seven-minute glass has **three minutes remaining before flipping**, then four minutes after flipping. The procedure reaches 15 minutes, but its explanation misstates the remaining sand; also fix “обои” to “оба”.
- `c055`: a sister playing chess does not prove another sister is her opponent; exclude online/computer opponents explicitly or accept alternatives.
- `c024` and `c067` reuse the secret-sharing theme. Unique IDs do not prevent similar experiences.
- Historical claims in weekly puzzles need individual source links and review; their existing collection-level attribution is not a per-question verification trail. A full historical fact-check was outside this code audit.

Reset only after repairs, content review and rehearsal. First back up the production values of `weekly:postedPuzzleIds` and `weekly:lastPuzzleId`, identify the exact environment and destination, then clear only the intended production rotation state. For a completely fresh start, both keys should be considered; the existing reset helper clears only the posted set. Verify the unused count returns to the approved bank size without calling the send endpoint. Do not flush Redis. Separate test and production namespaces so future test posts cannot consume the public rotation. Keep delivery deduplication records separate from content rotation so resetting puzzles cannot accidentally authorize a second weekly post.

## Suggested one-week sequence

1. Days 1–2: isolate memory; implement weekly/update duplicate protection and bounded failures.
2. Day 3: fix routing, admin access, schedule fields and setup instructions; add regression checks.
3. Day 4: connect and review chat puzzles, or explicitly defer curated DM puzzle play; add onboarding and privacy controls.
4. Days 5–6: rehearse in a private channel plus linked group; verify mentions, replies, DMs, spoilers, concurrent messages and outage behavior. Check production deployment settings and monitoring.
5. Final launch step: back up and reset the intended puzzle rotation, verify counts and production destination, then enable public use. If the Wednesday slot arrives before readiness, explicitly manage the cron in the deployment rather than assuming it is paused.

## External references checked

- [Telegram Bot API](https://core.telegram.org/bots/api): channel posting rights, webhook configuration, message/reply fields and delivery interfaces.
- [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs): duplicate/missed runs and the need for locks plus idempotent processing.
- [Groq production models](https://console.groq.com/docs/models): `openai/gpt-oss-120b` and `openai/gpt-oss-20b` are listed.
