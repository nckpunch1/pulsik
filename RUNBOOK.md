# Pulse Bot launch and operations

## Current rollout state

Code is prepared locally. Do not treat local checks as proof of production rollout. Public discussion group/topic ID is pending from Nick. Intended operator is `@Nikomaniak`; verify the numeric ID before enabling operator access. Vercel project is `pulsik`, production reference `https://pulsik.vercel.app`.

## Rehearsal before launch

Use a separate test bot and private test channel + linked discussion group. Start with both switches off, a unique `BOT_ENV`, and an explicit first Wednesday date.

- Run `npm ci`, `npm run check` with disposable Redis, and `npm audit --omit=dev`.
- Run preflight; verify actual Telegram `getMe`, channel posting rights and group access. Never obtain identity by asking the language model to guess it.
- Register the test webhook with its own secret. Send `/whoami`, `/start`, `/privacy`, `/forget` in DMs. Confirm operator status is denied to a second test user and in groups.
- Enable chat mode. Check Russian and English conversation, direct mention, name trigger and replies to this bot. Replies to a different bot must not trigger it. Replies in a topic must stay in that topic.
- Send a private sentinel then ask in the group: it must not enter that group's model input. Check `/forget` from a DM after conversations in multiple rooms.
- Test `/puzzle`, canonical answer, alternate phrasing, `/hint`, `/answer`, `/chat`, and a new puzzle. The model does not grade freeform alternatives; the member can compare the canonical solution.
- Initialize test rotation. Inspect a locally built weekly post and spoiler HTML. For a real scheduled delivery rehearsal, use a Wednesday slot in the test environment or invoke the send helper with a selected post in the private test channel without consuming production state.
- Confirm duplicate weekly calls and replayed update IDs do not send again. Regression tests cover outage paths without sending real messages.
- Configure the external monitor and verify operator alerts can reach the operator's private chat. Health sends alerts only for actionable issues.
- Set production variables and deploy. Keep the weekly switch off until migration and the final reset have been verified. Preserve the current production webhook until the replacement is ready.

## Safe state commands

All use `.env` supplied locally, never committed. `status` is read-only. Mutation commands are dry-run unless `--apply` and exact `--confirm ENV:DESTINATION` are supplied. Applied operations save a mode-0600 JSON snapshot under ignored `.ops-backups/` before changing state. Keep that directory private.

```sh
npm run ops -- status
# First migration retains the legacy used IDs and last puzzle.
npm run ops -- initialize --from-legacy
npm run ops -- initialize --from-legacy --apply --confirm 'production:@pulseiq_au'
# Use --fresh instead of --from-legacy only for a new isolated test namespace.
```

The destination in `--confirm` must exactly match `TELEGRAM_CHAT_ID`; examples are not evidence of the live configured destination. Never mix legacy test usage with public rotation without reviewing the snapshot.

### Final reset

Stop sending and finish the rehearsal first. Confirm the new deployment reads the v2 namespace and the intended destination. Inspect the backup and any uncertain delivery state. Then:

```sh
npm run ops -- reset
npm run ops -- reset --apply --confirm 'production:@pulseiq_au'
npm run ops -- status
```

Check `posted: []` and `last: null`. Check `/bankstatus` reports all **16 enabled weekly puzzles** unused. Only the v2 rotation is reset: durable delivery records, conversation memory, and legacy keys are preserved. This prevents a reset from authorizing a second post in the same week. The original deployment must be retired before resetting the new namespace. Do not use `FLUSHDB` or `FLUSHALL`.

### Ambiguous weekly delivery

`delivery_review` or a `sending` state means the request may have reached Telegram. Inspect the destination manually. Do not press send repeatedly.

```sh
# If the post is visible, record its actual Telegram message ID:
npm run ops -- resolve-weekly --week 2026-09-30 --message-id 123 --apply --confirm 'production:@pulseiq_au'
# Only if verified absent, allow a later explicit retry:
npm run ops -- resolve-weekly --week 2026-09-30 --confirmed-not-sent --apply --confirm 'production:@pulseiq_au'
```

The first form atomically commits the saved next rotation and observed delivery. The second form permits a fresh send during that scheduled week. An older missed week is not automatically replayed into the channel; decide whether to skip it and publish at the next slot. Reconciliation preserves a snapshot.

### Ambiguous conversational delivery

Inspect Telegram. An update marked `sending` is never blindly replayed. Close it with `resolve-update --update UPDATE_ID --apply --confirm ENV:DESTINATION`. This clears the technical incident without resending text. If delivery succeeded but the memory commit failed, that conversation turn/puzzle progression may be absent; the member can start a fresh `/puzzle`.

### Incidents and monitoring

- `weekly_missing`: inspect delivery record, cron execution and Telegram channel rights. A healthy cron response alone is not proof of a post; check the returned message ID.
- `delivery_review`: use the reconciliation procedure above.
- `storage_or_bank_failure`: restore Redis/configuration; no fail-open model spending or untracked weekly posts occurs.
- `weekly_bank_low`: add reviewed entries with new stable IDs and redeploy. Disabled/removed entries are excluded from counts. Existing IDs must not be repurposed.
- `schedule_unavailable`: inspect the public admin endpoint; the bot says the schedule is unavailable rather than inventing dates.
- `webhook_url` / `webhook_recent_error` / `webhook_backlog`: check Vercel and Telegram `getWebhookInfo`; re-register only with the required secret.
- `GLOBAL_BUDGET_REACHED`: investigate usage before raising limits. Configure the Groq account spend ceiling separately.
- Total deployment/health-cron outage: requires an independent authenticated uptime monitor; internal code cannot alert when it never runs.

Use `CHAT_ENABLED=false` for an emergency conversation pause; operational/privacy commands remain available. Use `WEEKLY_ENABLED=false` separately for scheduled-post incidents. Redeploy after Vercel environment changes. Avoid logging prompts, private content, raw upstream errors or credentials.

## Rollback

Prefer disabling the affected feature on the new deployment. Rolling back to the old implementation reintroduces mixed private/group memory and unprotected posting. If an old deployment must be restored, pause its cron in Vercel and restrict public access first; the old code does not recognize the new kill switches. Restore rotation only from a reviewed snapshot and reconcile delivery records before permitting another send.

## Overview rehearsal and delivery recovery

In the isolated test environment, enable the alternate persona and check `/blatnoy`, `/puzzle`, `/hint`, `/answer`, and `/normal`. A second user must retain their own voice. Public weekly posts retain the shared channel style.

For an overview, save a brief matching a real upcoming test session, run `/overview`, inspect every fact and the displayed destination, then use the preview's `/publish CODE`. Confirm the published text matches the preview. Repeat the code: it must not post twice. Changing the notes or schedule must invalidate an earlier preview. A non-operator or group message must not expose notes or initiate generation/publication. Production October 8 notes are available through `/gamebrief example`; this is an explicit import, not an automatic live write.

If an overview delivery is uncertain, inspect the destination before permitting another attempt. These operations use the same backup and exact confirmation safeguards as weekly recovery:

```sh
npm run ops -- resolve-overview --date 2026-10-08 --message-id 123 --apply --confirm 'production:@pulseiq_au'
# Only when the post is verified absent:
npm run ops -- resolve-overview --date 2026-10-08 --confirmed-not-sent --apply --confirm 'production:@pulseiq_au'
```

After confirming absence, an operator must explicitly use a valid preview code again. No automatic retry occurs. `/gameclear` removes temporary notes and invalidates drafts; delivery metadata remains to prevent duplicate posts.

## Private account rehearsal on the existing bot

Use `PRIVATE_TEST_MODE=true`, `WEEKLY_ENABLED=false`, `ALLOWED_GROUP_IDS=` and `GROUP_CONTEXT_ENABLED=false`. Deploy first with chat paused if the numeric operator ID is unknown; `/whoami` works in private chat for ID discovery. Set `OPERATOR_USER_IDS` to the verified numeric ID, then set `CHAT_ENABLED=true` and `ALTERNATE_PERSONA_ENABLED=true` and redeploy. Only operator DMs can converse. Overview previews are available but `/publish` is blocked. Keep the public puzzle rotation untouched until final launch. Disable private-test mode only when the public rollout is approved.
