'use strict';

const { sendMessage } = require('../lib/telegram');
const { generateReply } = require('../lib/gemini');
const { PERSONALITY_PROMPT } = require('../lib/personality');
const {
  getUserHistory,
  appendToUserHistory,
  getChannelContext,
  appendToChannelContext,
} = require('../lib/redis');

const BOT_USERNAME = 'pulse_iq_bot';
const MENTION = `@${BOT_USERNAME}`;

module.exports = async function handler(req, res) {
  // Verify webhook secret
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const incoming = req.headers['x-telegram-bot-api-secret-token'];
    if (incoming !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const update = req.body;
  const message = update && (update.message || update.channel_post);
  if (!message) return res.status(200).json({ ok: true });

  const text = message.text || message.caption || '';
  if (!text) return res.status(200).json({ ok: true });

  const chatId = String(message.chat.id);
  const from = message.from || {};
  const userId = String(from.id || 'unknown');
  const username = from.username
    ? `@${from.username}`
    : (from.first_name || 'User');

  // Skip messages from the bot itself
  if (from.username === BOT_USERNAME) return res.status(200).json({ ok: true });

  // Always record group messages for context
  await appendToChannelContext(chatId, username, text);

  // Check if the bot was @mentioned
  const mentioned =
    text.toLowerCase().includes(MENTION.toLowerCase()) ||
    (message.entities || []).some(
      e => e.type === 'mention' &&
           text.slice(e.offset, e.offset + e.length).toLowerCase() === MENTION.toLowerCase()
    );

  if (!mentioned) return res.status(200).json({ ok: true });

  // Strip the mention and clean up whitespace
  const userMessage = text.replace(new RegExp(MENTION, 'gi'), '').trim() || '👋';

  try {
    const [userHistory, channelContext] = await Promise.all([
      getUserHistory(userId),
      getChannelContext(chatId),
    ]);

    const reply = await generateReply(
      PERSONALITY_PROMPT,
      userHistory,
      channelContext,
      userMessage
    );

    await sendMessage(reply, chatId);

    await Promise.all([
      appendToUserHistory(userId, 'user', userMessage),
      appendToUserHistory(userId, 'assistant', reply),
      appendToChannelContext(chatId, 'Пульсик', reply),
    ]);
  } catch (err) {
    console.error('[webhook] error:', err.message);
    await sendMessage('Ой, что-то я задумался... Попробуй ещё раз через минутку 🤔', chatId);
  }

  return res.status(200).json({ ok: true });
};
