'use strict';

async function sendMessage(text, chatIdOverride) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = chatIdOverride || process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set');
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const post = async (body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  let data = await post({ chat_id: chatId, text, parse_mode: 'HTML' });

  // LLM output isn't guaranteed to be valid Telegram HTML — if parsing is what
  // failed, deliver the message as plain text instead of dropping it.
  if (!data.ok && /parse|entit/i.test(data.description || '')) {
    data = await post({ chat_id: chatId, text });
  }

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description}`);
  }

  return data.result;
}

module.exports = { sendMessage };
