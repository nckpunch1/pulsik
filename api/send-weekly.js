'use strict';

const path = require('path');
const fs = require('fs');
const { sendMessage } = require('../lib/telegram');
const { complete } = require('../lib/llm');
const { getRecentPuzzles, appendRecentPuzzle } = require('../lib/redis');

// Stored posts are kept purely as a fallback when generation fails.
const fallbackPosts = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../content/posts.json'), 'utf8')
);

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

  // 700 was not enough headroom: reasoning shares this budget, so a long think
  // could consume it before the JSON was emitted, leaving output that fails the
  // parse below and drops the week to static content. The visible JSON is only
  // a couple of hundred tokens — the rest is slack for thinking. Reasoning
  // effort is deliberately left at the model default here (unlike chat replies):
  // this runs once a week and the puzzle is better for the extra thought.
  const raw = await complete(
    [
      { role: 'system', content: PUZZLE_SYSTEM_PROMPT },
      { role: 'user', content: `Придумай одну новую загадку.${avoidBlock}` },
    ],
    { maxTokens: 2048 }
  );

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('no JSON in model output');
  const parsed = JSON.parse(jsonMatch[0]);
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
