'use strict';

const { getWeeklyBank, getChatBank } = require('./puzzle-bank');

// Operator command: "Пульсик 12345 статус банков вопросов" reports how many
// curated puzzles are still unused. The numeric code is the only gate, so it is
// configurable — rotate it by setting BANK_STATUS_CODE rather than editing (and
// committing) a new one here. Read at call time so a redeploy isn't needed to
// pick up a changed value.
//
// Deliberately a plain phrase rather than a /slash command: Telegram advertises
// registered commands in the UI to every member of a group, which would put the
// code one tap away from everyone.
const DEFAULT_CODE = '12345';

function statusCode() {
  return String(process.env.BANK_STATUS_CODE || DEFAULT_CODE);
}

// Case-insensitive, tolerant of repeated whitespace and one trailing . or !,
// so a phone keyboard's autocapitalisation or a stray space doesn't silently
// route the command into the LLM instead. Everything else must match exactly.
function matchesStatusCommand(text) {
  const normalised = String(text || '').trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
  const expected = `Пульсик ${statusCode()} статус банков вопросов`;
  return normalised.toLowerCase() === expected.toLowerCase();
}

// Wording is deliberately explicit about what is and isn't tracked: the weekly
// bank has a real Redis-backed cycle, the chat bank is authored but unwired, and
// conflating the two would misreport the chat bank as "all unused".
function buildStatusReport(postedIds) {
  const weekly = getWeeklyBank();
  const chat = getChatBank();
  const lines = ['📊 <b>Статус банков вопросов</b>', ''];

  if (!weekly) {
    lines.push('🧠 <b>СредаIQ (еженедельный)</b>');
    lines.push('⚠️ Банк не читается — файл weekly-puzzles.json недоступен. Пост уйдёт из старого статичного набора.');
  } else if (postedIds === null) {
    // Redis is the only record of what has already gone out, so without it the
    // count would be a guess. Say so instead of reporting the full bank as unused.
    lines.push('🧠 <b>СредаIQ (еженедельный)</b>');
    lines.push(`Всего в банке: <b>${weekly.length}</b>`);
    lines.push('⚠️ Redis недоступен — сколько уже опубликовано, сейчас не видно.');
  } else {
    const posted = new Set(postedIds);
    // Only ids that are still in the bank count as used: an id dropped from the
    // file shouldn't make the remaining count look smaller than it is.
    const used = weekly.filter((p) => posted.has(p.id));
    const left = weekly.length - used.length;
    lines.push('🧠 <b>СредаIQ (еженедельный)</b>');
    lines.push(`Осталось неиспользованных: <b>${left}</b> из ${weekly.length}`);
    if (used.length > 0) {
      lines.push(`Уже опубликованы: ${used.map((p) => p.id).join(', ')}`);
    }
    if (left === 0) {
      lines.push('🔁 Банк исчерпан — следующий пост перемешает его и пойдёт по второму кругу. Самое время пополнить.');
    } else if (left <= 3) {
      lines.push('⏳ Осталось мало — стоит пополнить банк до конца цикла.');
    }
  }

  lines.push('');
  lines.push('💬 <b>Разговорные загадки</b>');
  if (!chat) {
    lines.push('⚠️ Банк не читается — файл chat-puzzles.json недоступен.');
  } else {
    lines.push(`В файле: <b>${chat.length}</b>`);
    lines.push('Пока не подключены к диалогам — расход не отслеживается.');
  }

  return lines.join('\n');
}

module.exports = { matchesStatusCommand, buildStatusReport };
