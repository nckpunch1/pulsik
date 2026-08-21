'use strict';

const path = require('path');
const fs = require('fs');
const { sendMessage } = require('../lib/telegram');
const { getWeeklyBank } = require('../lib/puzzle-bank');
const {
  getPostedPuzzleIds,
  markPuzzlePosted,
  resetPostedPuzzleIds,
  getLastPuzzleId,
} = require('../lib/redis');

// The curated bank is THE source of the weekly puzzle. It replaced LLM
// generation, which shipped puzzles that were sometimes ambiguous or outright
// unsolvable — no amount of prompt or reasoning-effort tuning made a generated
// riddle verifiably sound, and every entry here is human-checked instead.
// Topping the bank up means editing content/weekly-puzzles.json and redeploying.
// null when the file is missing or unreadable (lib/puzzle-bank logs why).
const bank = getWeeklyBank();

// Legacy static set, now only a safety net for a missing/broken bank file. Only
// the type: 'puzzle' entries qualify: they carry the СредаIQ header and hide
// their answer behind a spoiler, exactly like a bank post. The type: 'fact'
// entries are a different format under their own header.
const allPosts = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../content/posts.json'), 'utf8')
);
const puzzlePosts = allPosts.filter((p) => p.type === 'puzzle');
// Never leave the safety net with nothing to post: an empty puzzle set would
// make the index below NaN and throw, turning a degraded week into a silent one.
// Posting an off-format entry is the lesser failure.
const fallbackPosts = puzzlePosts.length > 0 ? puzzlePosts : allPosts;
if (puzzlePosts.length === 0) {
  console.error('[send-weekly] posts.json has no type:"puzzle" entries — static fallback will post off-format content');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Random draw with no repeat until the bank is used up. Random rather than
// sequential so the running order differs between cycles; the posted-id set in
// Redis is what makes it no-repeat, so a redeploy or a reordered file can't
// re-post something the channel has already seen.
//
// If Redis is unreachable getPostedPuzzleIds returns null and this degrades to a
// plain random pick — a repeat is possible, but the post still goes out, which
// is the right trade for a once-a-week channel post.
async function pickFromBank(puzzles) {
  const posted = new Set(await getPostedPuzzleIds() || []);
  let candidates = puzzles.filter((p) => !posted.has(p.id));
  let cycleReset = false;

  if (candidates.length === 0) {
    // Greppable marker: the bank has wrapped, so the channel is about to start
    // seeing repeats of puzzles it saw one full cycle ago. Alert on
    // BANK_EXHAUSTED as the cue to top the file up.
    console.warn(
      `[send-weekly] BANK_EXHAUSTED — all ${puzzles.length} curated puzzles have been posted; reshuffling for a fresh cycle. Top up content/weekly-puzzles.json to keep the rotation fresh.`
    );
    await resetPostedPuzzleIds();
    cycleReset = true;
    // A fresh cycle may legitimately redraw anything, but drawing last week's
    // puzzle again would read as a bug to the channel, so exclude just that one.
    const lastId = await getLastPuzzleId();
    candidates = puzzles.filter((p) => p.id !== lastId);
    if (candidates.length === 0) candidates = puzzles; // single-entry bank
  }

  return {
    puzzle: candidates[Math.floor(Math.random() * candidates.length)],
    cycleReset,
    // How many of this cycle's posts precede this one — 0 right after a reset.
    postedBefore: cycleReset ? 0 : posted.size,
  };
}

// Same shape as before: header, question, spoiler-hidden answer, footer. The
// spoiler now carries the explanation as well, on its own line, so one tap
// reveals both the answer and why it is the answer.
function buildPost(question, answer, explanation) {
  const revealed = explanation
    ? `${escapeHtml(answer)}\n${escapeHtml(explanation)}`
    : escapeHtml(answer);
  return (
    '🧠 <b>СредаIQ — прокачай интеллект</b>\n\n' +
    `${escapeHtml(question)}\n\n` +
    `<b>Ответ:</b> <tg-spoiler>${revealed}</tg-spoiler>\n\n` +
    '🎯 <i>PulseIQ — интеллектуальные игры в Брисбене</i>'
  );
}

// Static safety net, used only when the bank is unavailable or the bank post
// itself failed. Vercel records the cron as a success either way, so the log
// line is the only signal that the intended source didn't run.
async function postStaticFallback(res, reason) {
  console.error('[send-weekly] FALLBACK_USED — posted static content instead of a bank puzzle:', reason);
  const weekNumber = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const post = fallbackPosts[weekNumber % fallbackPosts.length];
  try {
    await sendMessage(post.content);
  } catch (err) {
    // Both the bank post and the safety net failed — nothing reached the
    // channel, so say so with a non-200 rather than reporting a silent success.
    console.error('[send-weekly] static fallback also failed to send:', err.stack || err.message);
    return res.status(500).json({ ok: false, error: err.message, reason });
  }
  return res.status(200).json({
    ok: true,
    source: 'fallback',
    degraded: true,
    reason,
    postId: post.id,
  });
}

module.exports = async function handler(req, res) {
  // Fail closed: the endpoint can post to the channel, so it must be protected.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[send-weekly] CRON_SECRET is not set — refusing to run');
    return res.status(500).json({ error: 'CRON_SECRET is not configured' });
  }
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!bank) {
    return postStaticFallback(res, 'weekly-puzzles.json unavailable (see BANK_UNAVAILABLE above)');
  }

  let picked;
  try {
    picked = await pickFromBank(bank);
    await sendMessage(buildPost(picked.puzzle.question, picked.puzzle.answer, picked.puzzle.explanation));
  } catch (err) {
    return postStaticFallback(res, err.stack || err.message);
  }

  const { puzzle, cycleReset, postedBefore } = picked;
  // Mark only after the send succeeded, so a failed post doesn't burn a puzzle.
  await markPuzzlePosted(puzzle.id);
  console.log(
    `[send-weekly] posted bank puzzle ${puzzle.id} (${postedBefore + 1}/${bank.length} this cycle${cycleReset ? ', new cycle' : ''})`
  );

  return res.status(200).json({
    ok: true,
    source: 'bank',
    puzzleId: puzzle.id,
    cyclePosted: postedBefore + 1,
    bankSize: bank.length,
    cycleReset,
  });
};
