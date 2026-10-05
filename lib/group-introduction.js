'use strict';
function isIntroduction(text, username) {
  return text.trim().toLowerCase() === '/introduce' || new RegExp(`^(?:пульсик|@${username}),?\\s+знакомься[!.]*$`, 'iu').test(text.trim());
}
function introduction(username) {
  return `Всем привет! Я Пульсик — ИИ-бот PulseIQ. Теперь у команды есть ещё один собеседник. За стол не сяду, зато могу поддержать разговор и подкинуть задачку 😄

В этой теме можно позвать меня по имени, отметить @${username} или ответить на моё сообщение. Обсудим игру, поболтаем — только ответы за вашу команду на вечере придумывать всё равно вам.

За личной загадкой заходите в личку и скажите «дай загадку». Можно попросить подсказку, предложить свою версию или сказать «сдаюсь».

А если хочется другого настроения — позовите Блатного Пульсика. У него свой говор и свои байки. «Говори нормально» возвращает меня обратно.

Здесь будут появляться и общие загадки, а анонсы игр — в теме объявлений. Если что-то перепутаю, поправляйте: я тоже могу ошибаться.

Ну что, знакомиться будем? 👋`;
}
async function sendIntroduction({ store, sendMessage, cfg, chatId, topicId, messageId, deadline }) {
  const key = `introduction:${chatId}`, lock = await store.lock(key);
  if (!lock) return { busy: true };
  try {
    const previous = await store.get(key);
    if (previous && (previous.state !== 'rejected' || previous.retryAt > Date.now())) return { alreadyHandled: true };
    if (Date.now() > deadline - 10000 || !await store.owns(lock)) throw Error('Introduction deadline or lock expired');
    const delivery = { state: 'sending', chatId, topicId, at: Date.now() };
    await store.markIntroductionSending(key, delivery);
    try {
      const sent = await sendMessage(introduction(cfg.username), chatId, { topicId, replyTo: messageId, deadline: deadline - 4000 });
      await store.finishIntroduction(key, { ...delivery, state: 'sent', messageId: sent.message_id });
      return { sent: true };
    } catch (err) {
      if (err.ambiguous === false) {
        await store.finishIntroduction(key, { ...delivery, state: 'rejected', retryAt: Date.now() + Math.max(60, err.retryAfter || 60) * 1000 });
        return { rejected: true };
      }
      return { review: true };
    }
  } finally { await store.unlock(lock).catch(() => {}); }
}
module.exports = { isIntroduction, introduction, sendIntroduction };
