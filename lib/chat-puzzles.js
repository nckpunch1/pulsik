'use strict';
const { getChatBank } = require('./puzzle-bank');
const normalise = text => String(text).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function puzzleTurn(text, current, random = Math.random, { blatnoy = false } = {}) {
  const bank = getChatBank();
  const state = { seen: [], active: null, hints: 0, ...current };
  // Persist a small turn counter so feedback varies without changing puzzle selection.
  function reaction(lines) {
    const index = Number.isSafeInteger(state.reactions) && state.reactions >= 0 ? state.reactions : 0;
    state.reactions = index + 1;
    return lines[index % lines.length];
  }
  const cmd = text.trim().toLowerCase();
  if (/^\/puzzle(?:\s|$)/.test(cmd) || /^(?:загадай|дай|хочу|давай)(?: мне)? (?:загадку|задачку|головоломку)[.!?]*$/i.test(cmd)) {
    let candidates = bank.filter(p => !state.seen.includes(p.id));
    if (!candidates.length) { candidates = bank.filter(p => p.id !== state.active); state.seen = []; }
    if (!candidates.length) candidates = bank;
    const p = candidates[Math.floor(random() * candidates.length)];
    state.active = p.id; state.seen.push(p.id); state.hints = 0; state.completed = false;
    const intro = blatnoy ? 'Так, дело занятное. Приглядимся к условию:\n\n' : '';
    return { reply: `${intro}${p.question}\n\nНапиши ответ, /hint — подсказка, /answer — решение.`, state };
  }
  const active = bank.find(p => p.id === state.active);
  if (/^\/(hint|answer)(?:\s|$)/.test(cmd) && (!active || state.completed)) return { reply: blatnoy ? 'На столе пока ни одного дела. Подкинем задачку? /puzzle' : 'Сейчас у нас нет открытой загадки. Если хочется размяться — /puzzle.', state };
  if (!active || state.completed) return null;
  if (/^\/answer(?:\s|$)/.test(cmd) || /^(сдаюсь|не знаю|покажи ответ)[.!?]*$/.test(cmd)) {
    state.completed = true;
    const intro = blatnoy ? 'Раскрываем карты. Вот задуманный ответ:' : 'Вот в чём задумка:';
    return { reply: `${intro} ${active.answer}\n${active.explanation}\n\nЗа следующей загадкой — /puzzle. А можно просто поболтать.`, state };
  }
  if (/^\/hint(?:\s|$)/.test(cmd) || /^(подсказка|дай подсказку)[.!?]*$/.test(cmd)) {
    const hints = active.hints || ['Попробуй внимательно перечитать условие: что в нём сказано прямо, а что ты предполагаешь?'];
    const repeated = state.hints >= hints.length;
    const hint = hints[Math.min(state.hints, hints.length - 1)]; state.hints++;
    const intro = blatnoy
      ? (repeated ? 'Других зацепок пока нет. Без суеты, приглядимся к этой:' : 'Подкину зацепку, но карты пока придержу:')
      : (repeated ? 'Другой подсказки у меня пока нет. Вернёмся к этой зацепке:' : 'Давай потянем за одну ниточку:');
    return { reply: `${intro}\n${hint}\n\nРешение — /answer, отложить загадку — /chat.`, state };
  }
  if ([active.answer, ...(active.acceptedAnswers || [])].some(a => normalise(a) === normalise(text))) {
    state.completed = true;
    const intro = reaction(blatnoy
      ? ['Вот теперь расклад сошёлся. Смотри:', 'Дело раскрыто. Шляпу поправил — и к объяснению:', 'Точно! Вот где хитрость пряталась:']
      : ['В точку! Вот как всё сходится:', 'Да, это задуманный ответ. Разберём фокус:', 'Есть решение! Смотри, в чём хитрость:']);
    return { reply: `${intro}\n${active.explanation}\n\nЕсли захочется ещё — /puzzle.`, state };
  }
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
    return { reply: `${intro}\n\n/hint — подсказка, /answer — решение. Отложить загадку и поболтать — /chat.`, state };
  }
  return null;
}
module.exports = { puzzleTurn, normalise };
