'use strict';

const path = require('path');
const fs = require('fs');

// Curated, human-verified puzzle banks. The weekly bank replaced LLM generation
// for the СредаIQ post; the chat bank is authored but not yet wired to the
// conversational path, so nothing consumes it and no usage is tracked for it.
//
// Loaded once per cold start and cached: banks change by editing the file and
// redeploying, so re-reading per request would buy nothing.
const BANK_FILES = {
  weekly: 'weekly-puzzles.json',
  chat: 'chat-puzzles.json',
};

const cache = {};

// Returns the usable entries, or null if the file is missing/unreadable/empty —
// callers decide how to degrade. Logs loudly either way: BANK_UNAVAILABLE is the
// marker to alert on, since it means the intended source is gone.
function loadBank(which) {
  if (which in cache) return cache[which];

  const file = BANK_FILES[which];
  const fullPath = path.join(__dirname, '../content', file);
  let result;
  try {
    const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const entries = Array.isArray(raw.puzzles) ? raw.puzzles : [];
    // An entry with no id can't be tracked across a cycle and one with no
    // question/answer can't be posted, so drop those here rather than letting
    // them surface as a broken post. explanation is optional.
    const usable = entries.filter((p) => p && p.id && p.question && p.answer);
    if (usable.length < entries.length) {
      console.error(
        `[puzzle-bank] ${file}: skipped ${entries.length - usable.length} entry(ies) missing id/question/answer`
      );
    }
    if (usable.length === 0) throw new Error('no usable entries in puzzles[]');
    result = usable;
  } catch (err) {
    console.error(
      `[puzzle-bank] BANK_UNAVAILABLE — could not load content/${file}:`,
      err.message
    );
    result = null;
  }

  cache[which] = result;
  return result;
}

const getWeeklyBank = () => loadBank('weekly');
const getChatBank = () => loadBank('chat');

module.exports = { getWeeklyBank, getChatBank };
