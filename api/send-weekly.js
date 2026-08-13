'use strict';

const path = require('path');
const fs = require('fs');
const { sendMessage } = require('../lib/telegram');
const { complete } = require('../lib/llm');
const { getRecentPuzzles, appendRecentPuzzle } = require('../lib/redis');

// Stored posts are kept purely as a fallback when generation fails. Only the
// type: 'puzzle' entries qualify: they carry the СредаIQ header and hide their
// answer behind a spoiler, exactly like a generated post. The type: 'fact'
// entries are a different format under their own header, and the selector below
// used to cycle all 20 entries — so half of every fallback fire published a fact
// into the slot the channel expects a puzzle in.
const allPosts = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../content/posts.json'), 'utf8')
);
const puzzlePosts = allPosts.filter((p) => p.type === 'puzzle');
// Never leave the fallback with nothing to post: an empty puzzle set would make
// the index below NaN and throw inside the catch, turning a degraded week into a
// silent one. Posting an off-format entry is the lesser failure.
const fallbackPosts = puzzlePosts.length > 0 ? puzzlePosts : allPosts;
if (puzzlePosts.length === 0) {
  console.error('[send-weekly] posts.json has no type:"puzzle" entries — fallback will post off-format content');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Pulls the puzzle object out of a model reply that may also contain prose, a
// markdown code fence, or leftover reasoning.
//
// The previous /\{[\s\S]*\}/ was greedy: it spanned from the FIRST '{' in the
// whole reply to the LAST '}', so a single stray brace anywhere in the prose —
// or a second JSON object — produced a span that could never parse. Scanning for
// the first *balanced* object and testing each candidate is robust to all three,
// and to braces appearing inside the puzzle text itself (string-aware, so a '}'
// inside a quoted value doesn't close the object early).
function extractPuzzleJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '');
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < cleaned.length; j++) {
      const ch = cleaned[j];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(cleaned.slice(i, j + 1));
            if (parsed && parsed.question && parsed.answer) return parsed;
          } catch {
            // Not a usable object — keep scanning from the next brace.
          }
          break;
        }
      }
    }
  }
  return null;
}

const PUZZLE_SYSTEM_PROMPT = `Ты придумываешь одну свежую загадку для еженедельной рубрики «СредаIQ — разминка для мозга» в Telegram-канале PulseIQ (интеллектуальные игры в Брисбене). Аудитория — русскоязычные любители викторин.

Требования:
- Загадка на русском языке: логика, игра слов, математическая задачка, lateral thinking, эрудиция (музыка, география, история, культура) — выбирай категорию разнообразно.
- Решаемая за 1-2 минуты, весёлая, без пошлости и политики.
- НЕ используй заезженные загадки и НЕ повторяй темы из списка недавних загадок, если он дан.
- Ответ должен быть коротким и однозначным, с одним предложением объяснения, если оно нужно.

Ответь СТРОГО в формате JSON без каких-либо пояснений вокруг:
{"question": "текст загадки", "answer": "ответ (и краткое объяснение)"}`;

async function generatePuzzle(recentPuzzles) {
  const avoidBlock = recentPuzzles.length > 0
    ? `\n\nНедавние загадки (НЕ повторяй их и не делай похожих):\n${recentPuzzles.map(p => `- ${p}`).join('\n')}`
    : '';

  // 2048 tokens with 'low' reasoning. The budget is shared with the <think>
  // block, so a long think at the model's default 'medium' effort could consume
  // it before a single character of JSON was emitted — which is exactly what
  // 'no JSON in model output' reports. Structured output is the one job here,
  // and thinking hard about a riddle is worth less than reliably returning it,
  // so effort is capped rather than left at the default.
  const raw = await complete(
    [
      { role: 'system', content: PUZZLE_SYSTEM_PROMPT },
      { role: 'user', content: `Придумай одну новую загадку.${avoidBlock}` },
    ],
    { maxTokens: 2048, reasoningEffort: 'low' }
  );

  const parsed = extractPuzzleJson(raw);
  // Include a snippet: this throw is the only diagnostic that survives into the
  // FALLBACK_USED log line, and 'no JSON' alone never said what did come back.
  if (!parsed) {
    throw new Error(
      `no parseable puzzle JSON in model output (${raw.length} chars): ${JSON.stringify(raw.slice(0, 200))}`
    );
  }
  const question = String(parsed.question || '').trim();
  const answer = String(parsed.answer || '').trim();
  if (!question || !answer) throw new Error('model output missing question/answer');
  return { question, answer };
}

function buildPost(question, answer) {
  return (
    '🧠 <b>СредаIQ — разминка для мозга</b>\n\n' +
    `${escapeHtml(question)}\n\n` +
    `<b>Ответ:</b> <tg-spoiler>${escapeHtml(answer)}</tg-spoiler>\n\n` +
    '🎯 <i>PulseIQ — интеллектуальные игры в Брисбене</i>'
  );
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

  try {
    const recent = await getRecentPuzzles();
    const { question, answer } = await generatePuzzle(recent);
    await sendMessage(buildPost(question, answer));
    await appendRecentPuzzle(question);
    return res.status(200).json({ ok: true, source: 'generated' });
  } catch (err) {
    // Distinct, greppable marker: the weekly post went out as *static* content
    // instead of a freshly generated puzzle. Vercel records the cron as a success
    // either way, so this line is the only signal that generation is broken —
    // alert on "FALLBACK_USED" in the logs.
    console.error(
      '[send-weekly] FALLBACK_USED — LLM generation failed, posted static fallback:',
      err.stack || err.message
    );
    const weekNumber = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
    const post = fallbackPosts[weekNumber % fallbackPosts.length];
    // Still post: static content beats no post at all.
    await sendMessage(post.content);
    return res.status(200).json({
      ok: true,
      source: 'fallback',
      degraded: true,
      reason: err.message,
      postId: post.id,
    });
  }
};
