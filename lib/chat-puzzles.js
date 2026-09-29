'use strict';
const { conversationIntent } = require('./conversation-intent');
const { getChatBank } = require('./puzzle-bank');
const normalise = text => String(text).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function puzzleTurn(text, current, random = Math.random, { blatnoy = false, deferUnknown = false } = {}) {
  const bank = getChatBank();
  const state = { seen: [], active: null, hints: 0, ...current };
  // Persist a small turn counter so feedback varies without changing puzzle selection.
  function reaction(lines) {
    const index = Number.isSafeInteger(state.reactions) && state.reactions >= 0 ? state.reactions : 0;
    state.reactions = index + 1;
    return lines[index % lines.length];
  }
  const cmd = text.trim().toLowerCase();
  const intent = conversationIntent(text, Boolean(state.active));
  if (intent === 'puzzle') {
    let candidates = bank.filter(p => !state.seen.includes(p.id));
    if (!candidates.length) { candidates = bank.filter(p => p.id !== state.active); state.seen = []; }
    if (!candidates.length) candidates = bank;
    const p = candidates[Math.floor(random() * candidates.length)];
    state.active = p.id; state.seen.push(p.id); state.hints = 0; state.completed = false;
    const intro = blatnoy ? 'Так, дело занятное. Приглядимся к условию:\n\n' : '';
    return { reply: `${intro}${p.question}\n\nКак думаешь, в чём разгадка? Если понадобится, попроси подсказку.`, state };
  }
  const active = bank.find(p => p.id === state.active);
  if (['hint', 'answer'].includes(intent) && (!active || state.completed)) return { reply: blatnoy ? 'На столе пока ни одного дела. Подкинем задачку? Скажи «дай загадку».' : 'Сейчас у нас нет открытой загадки. Скажи «дай загадку», если хочется размяться.', state };
  if (!active || state.completed) return null;
  if (intent === 'answer') {
    state.completed = true;
    const intro = blatnoy ? 'Раскрываем карты. Вот задуманный ответ:' : 'Вот в чём задумка:';
    return { reply: `${intro} ${active.answer}\n${active.explanation}\n\nХочешь ещё загадку или просто поболтаем?`, state };
  }
  if (intent === 'hint') {
    const hints = active.hints || ['Попробуй внимательно перечитать условие: что в нём сказано прямо, а что ты предполагаешь?'];
    const repeated = state.hints >= hints.length;
    const hint = hints[Math.min(state.hints, hints.length - 1)]; state.hints++;
    const intro = blatnoy
      ? (repeated ? 'Других зацепок пока нет. Без суеты, приглядимся к этой:' : 'Подкину зацепку, но карты пока придержу:')
      : (repeated ? 'Другой подсказки у меня пока нет. Вернёмся к этой зацепке:' : 'Давай потянем за одну ниточку:');
    return { reply: `${intro}\n${hint}\n\nЕсли захочешь раскрыть ответ — так и скажи. А можно отложить загадку и поболтать.`, state };
  }
  if ([active.answer, ...(active.acceptedAnswers || [])].some(a => normalise(a) === normalise(text))) {
    state.completed = true;
    const intro = reaction(blatnoy
      ? ['Вот теперь расклад сошёлся. Смотри:', 'Дело раскрыто. Шляпу поправил — и к объяснению:', 'Точно! Вот где хитрость пряталась:']
      : ['В точку! Вот как всё сходится:', 'Да, это задуманный ответ. Разберём фокус:', 'Есть решение! Смотри, в чём хитрость:']);
    return { reply: `${intro}\n${active.explanation}\n\nЕсли захочется ещё, скажи «ещё загадку».`, state };
  }
  if (deferUnknown && !cmd.startsWith('/')) return { needsUnderstanding: true, state };
  // Exact matching cannot judge arbitrary alternatives. Never falsely declare them wrong.
  if (!cmd.startsWith('/')) {
    const intro = reaction(blatnoy ? [
      'С приговором погодим. Я пока не уверен, что эта версия объясняет все условия. Давай проверим зацепку.',
      'Карты пока не сошлись у меня в голове. Не стану объявлять твою версию неверной — можно сравнить с задуманным решением.',
      'Тут без судейской мантии: я пока не берусь оценить эту версию. Подсказка или раскрываем карты?',
    ] : [
      'Я пока не уверен, что эта версия подходит ко всем условиям. Давай оставим её в игре и присмотримся к подсказке.',
      'Не буду спешить с вердиктом: другая формулировка тоже может подойти. Можно взять подсказку или сравнить с задуманным решением.',
      'Тут я пока не берусь судить. Если хочется, посмотрим задуманный ответ и его объяснение — без оценок и красной ручки.',
    ]);
    return { reply: `${intro}\n\nМожно попросить подсказку, раскрыть ответ или сказать «давай поболтаем».`, state };
  }
  return null;
}
module.exports = { puzzleTurn, normalise };
