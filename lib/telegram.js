'use strict';
class TelegramError extends Error {
  constructor(code, { ambiguous = false, retryAfter } = {}) {
    super(`Telegram request failed (${code})`); this.code = code; this.ambiguous = ambiguous; this.retryAfter = retryAfter;
  }
}
async function telegram(method, body, { deadline = Date.now() + 8000 } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramError('configuration');
  const remaining = deadline - Date.now();
  if (remaining < 100) throw new TelegramError('deadline');
  let response, data;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.min(8000, remaining)),
    });
    data = await response.json();
  } catch { throw new TelegramError('network', { ambiguous: true }); }
  if (response.status >= 500 || typeof data.ok !== 'boolean') throw new TelegramError('upstream', { ambiguous: true });
  if (!response.ok || !data.ok) throw new TelegramError(data.error_code || response.status, { retryAfter: data.parameters?.retry_after });
  return data.result;
}
async function sendMessage(text, chatId = process.env.TELEGRAM_CHAT_ID, options = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 4096 || !chatId) throw new TelegramError('invalid_message');
  // Conversation text is plain text. Curated posts explicitly opt into HTML.
  const body = { chat_id: chatId, text, link_preview_options: { is_disabled: true } };
  if (options.html) body.parse_mode = 'HTML';
  if (options.topicId) body.message_thread_id = options.topicId;
  if (options.replyTo) body.reply_parameters = { message_id: options.replyTo, allow_sending_without_reply: true };
  // No automatic retry: a transport failure can hide an accepted send.
  const result = await telegram('sendMessage', body, options);
  if (!Number.isInteger(result?.message_id)) throw new TelegramError('invalid_response', { ambiguous: true });
  return result;
}
module.exports = { telegram, sendMessage, TelegramError };
