'use strict';
function words(text) {
  return String(text).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function conversationIntent(text, active = false) {
  const command = text.trim().toLowerCase().split(/\s+/)[0];
  const commands = { '/puzzle': 'puzzle', '/hint': 'hint', '/answer': 'answer', '/chat': 'chat', '/normal': 'normal' };
  if (commands[command]) return commands[command];
  // Match requests, not arbitrary mentions or negated instructions in puzzle guesses.
  let s = words(text).replace(/^(?:эй |привет )?(?:блатной )?пульсик\s+/, '');
  s = s.replace(/\bplease\b/g, '').replace(/(?:пожалуйста|плиз)/g, '').trim().replace(/\s+/g, ' ');
  if (/^(?:обычный пульсик|пульсик без образа|без образа|говори нормально|давай без образа|вернись к обычному пульсику|будь обычным пульсиком)$/.test(s)) return 'normal';
  if (/^(?:давай |хочу |можно )?(?:просто )?поболта(?:ем|ть)$|^(?:хватит загадок|отложим загадку|давай поговорим)$/.test(s)) return 'chat';
  if (/^(?:(?:загадай|дай|хочу|давай|можно|задай)(?: мне)?|можешь(?: мне)? (?:дать|загадать)) (?:еще (?:одну )?|новую |следующую )?(?:загадку|задачку|головоломку)$/.test(s) || /^(?:еще (?:одну )?|новая |следующая )(?:загадка|загадку|задачка|задачку)$/.test(s) || (active && /^(?:еще|давай еще|еще одну)$/.test(s))) return 'puzzle';
  if (/^(?:(?:дай|давай|можно|хочу)(?: мне)? )?(?:еще (?:одну )?)?подсказк[ау]$|^(?:подскажи|подскажи мне|нужна подсказка|можешь подсказать)$/.test(s)) return 'hint';
  if (/^(?:скажи|покажи|дай|раскрой)(?: мне)? (?:ответ|решение)$|^(?:какой ответ|сдаюсь|раскрывай карты)$/.test(s) || (active && /^(?:не знаю|ответ|решение)$/.test(s))) return 'answer';
  return null;
}
module.exports = { conversationIntent };
