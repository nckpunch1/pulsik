'use strict';
const { getWeeklyBank, getChatBank } = require('./puzzle-bank');
function matchesStatusCommand(text) {
  return /^\/bankstatus(?:@\w+)?\s*$/i.test(text) || /^пульсик\s+\d+\s+статус банков вопросов[.!]*$/i.test(text.trim());
}
function buildStatusReport(rotation) {
  const weekly = getWeeklyBank(), chat = getChatBank();
  if (!rotation) return `Банки: ${weekly.length} еженедельных, ${chat.length} разговорных. Ротация ещё не инициализирована оператором.`;
  const used = weekly.filter(p => rotation.posted.includes(p.id));
  return `Банк СредаIQ: осталось ${weekly.length - used.length} из ${weekly.length}.\nОпубликованы: ${used.map(p => p.id).join(', ') || 'нет'}.\nРазговорный банк: ${chat.length}; история индивидуальна для каждой беседы.`;
}
module.exports = { matchesStatusCommand, buildStatusReport };
