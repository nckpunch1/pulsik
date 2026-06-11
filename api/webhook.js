'use strict';

const { sendMessage } = require('../lib/telegram');
const { generateReply } = require('../lib/llm');
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
  const chatType = message.chat.type; // "private", "group", "supergroup", "channel"
  const from = message.from || {};
  const userId = String(from.id || 'unknown');
  const username = from.username
    ? `@${from.username}`
    : (from.first_name || 'User');

  // Skip messages from the bot itself
  if (from.username === BOT_USERNAME) return res.status(200).json({ ok: true });

  // Never respond in broadcast channels
  if (chatType === 'channel') return res.status(200).json({ ok: true });

  const isPrivate = chatType === 'private';
  const isGroup = chatType === 'group' || chatType === 'supergroup';

  // Group chats: record context and require @mention
  if (isGroup) {
    await appendToChannelContext(chatId, username, text);

    const mentioned =
      text.toLowerCase().includes(MENTION.toLowerCase()) ||
      (message.entities || []).some(
        e => e.type === 'mention' &&
             text.slice(e.offset, e.offset + e.length).toLowerCase() === MENTION.toLowerCase()
      );

    if (!mentioned) return res.status(200).json({ ok: true });
  }

  // Strip @mention only in group context; pass full text in DMs
  const userMessage = isGroup
    ? (text.replace(new RegExp(MENTION, 'gi'), '').trim() || '👋')
    : (text || '👋');

  try {
    const [userHistory, channelContext] = await Promise.all([
      getUserHistory(userId),
      isGroup ? getChannelContext(chatId) : Promise.resolve([]),
    ]);

    const reply = await generateReply(
      PERSONALITY_PROMPT,
      userHistory,
      channelContext,
      userMessage
    );

    await sendMessage(reply, chatId);

    const historyWrites = [
      appendToUserHistory(userId, 'user', userMessage),
      appendToUserHistory(userId, 'assistant', reply),
    ];
    if (isGroup) historyWrites.push(appendToChannelContext(chatId, 'Пульсик', reply));
    await Promise.all(historyWrites);
  } catch (err) {
    console.error('[webhook] error:', err.message);
    await sendMessage('Ой, что-то я задумался... Попробуй ещё раз через минутку 🤔', chatId);
  }

  return res.status(200).json({ ok: true });
};
