'use strict';

const { sendMessage } = require('../lib/telegram');
const { generateReply } = require('../lib/llm');
const { PERSONALITY_PROMPT, BLATNOY_PERSONALITY_PROMPT, contextLine } = require('../lib/personality');
const { getUpcomingSessions } = require('../lib/sessions');
const { formatSessionsForPrompt } = require('../lib/format');
const {
  getUserHistory,
  appendToUserHistory,
  getChannelContext,
  appendToChannelContext,
  getBlatnoyCounter,
  setBlatnoyCounter,
  decrementBlatnoyCounter,
  checkRateLimit,
} = require('../lib/redis');

const BOT_USERNAME = 'pulse_iq_bot';
const MENTION = `@${BOT_USERNAME}`;

// Caps LLM cost per message and blunts prompt-stuffing via giant messages
const MAX_USER_MESSAGE_CHARS = 1000;
// Per-minute reply budgets; exceeding them silently drops the message
const USER_RATE_LIMIT = 10;
const CHAT_RATE_LIMIT = 20;

module.exports = async function handler(req, res) {
  // Fail closed: without the secret anyone who finds the URL can spoof updates
  // and drive LLM calls / bot replies.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] TELEGRAM_WEBHOOK_SECRET is not set — refusing to process updates');
    return res.status(500).json({ error: 'Webhook secret is not configured' });
  }
  const incoming = req.headers['x-telegram-bot-api-secret-token'];
  if (incoming !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
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

  // Group chats: record context and require one of three triggers
  if (isGroup) {
    await appendToChannelContext(chatId, username, text);

    const mentioned =
      text.toLowerCase().includes(MENTION.toLowerCase()) ||
      (message.entities || []).some(
        e => e.type === 'mention' &&
             text.slice(e.offset, e.offset + e.length).toLowerCase() === MENTION.toLowerCase()
      );

    const namedPulsik = text.toLowerCase().includes('пульсик');

    const replyToBot =
      message.reply_to_message?.from?.username === BOT_USERNAME ||
      message.reply_to_message?.from?.is_bot === true;

    if (!mentioned && !namedPulsik && !replyToBot) {
      return res.status(200).json({ ok: true });
    }
  }

  // Rate-limit only messages we would actually answer
  const [userAllowed, chatAllowed] = await Promise.all([
    checkRateLimit(`user:${userId}`, USER_RATE_LIMIT, 60),
    checkRateLimit(`chat:${chatId}`, CHAT_RATE_LIMIT, 60),
  ]);
  if (!userAllowed || !chatAllowed) {
    console.warn(`[webhook] rate limit hit (user ${userId}, chat ${chatId})`);
    return res.status(200).json({ ok: true });
  }

  // Strip @mention only in group context; pass full text in DMs
  const userMessage = (isGroup
    ? (text.replace(new RegExp(MENTION, 'gi'), '').trim() || '👋')
    : (text || '👋')
  ).slice(0, MAX_USER_MESSAGE_CHARS);

  // Determine whether we're entering / continuing the Блатной Пульсик persona
  const lowerText = text.toLowerCase();
  const triggerActivation =
    lowerText.includes('блатной') && lowerText.includes('пульсик');

  try {
    const blatnoyCounter = await getBlatnoyCounter(chatId, userId);

    const isBlatnoyMode = triggerActivation || blatnoyCounter > 0;

    const [userHistory, channelContext, sessions] = await Promise.all([
      getUserHistory(userId),
      isGroup ? getChannelContext(chatId) : Promise.resolve([]),
      // Skip the schedule lookup entirely in persona mode — keep it pure character
      isBlatnoyMode ? Promise.resolve([]) : getUpcomingSessions(),
    ]);

    let fullSystemPrompt;

    if (triggerActivation) {
      // Entering the persona — set 4-message budget and play a theatrical intro
      await setBlatnoyCounter(chatId, userId, 4);
      fullSystemPrompt =
        BLATNOY_PERSONALITY_PROMPT +
        '\n\nЭто твоё первое появление в роли. Войди в образ театрально и весело.';
    } else if (blatnoyCounter > 0) {
      // Continuing the persona — count this message and wind down on the last one
      const isFinalBlatnoyMessage = blatnoyCounter === 1;
      fullSystemPrompt = BLATNOY_PERSONALITY_PROMPT;
      if (isFinalBlatnoyMessage) {
        fullSystemPrompt +=
          '\n\nЭто твоё последнее сообщение в роли Блатного Пульсика. Намекни, что чай остыл / луна зашла / пора в дорогу, и попрощайся с этой ролью с лёгким сожалением. После этого ты автоматически вернёшься к обычному стилю.';
      }
      await decrementBlatnoyCounter(chatId, userId);
    } else {
      // Normal mode — main personality plus the upcoming-sessions context
      const sessionsText = formatSessionsForPrompt(sessions);
      fullSystemPrompt = sessionsText
        ? `${PERSONALITY_PROMPT}\n\n${sessionsText}`
        : PERSONALITY_PROMPT;
    }

    // Tell the persona which room it is in. This does not affect *whether* we
    // reply — that gating happened above — only how the character behaves once
    // we do: free-ranging chat and the puzzle-solving loop in a DM, hands off
    // the spoiler-hidden weekly puzzle in a group. Applies in Блатной mode too,
    // since the room is a property of the chat, not of the persona.
    fullSystemPrompt += `\n\n${contextLine(isPrivate)}`;

    const reply = await generateReply(
      fullSystemPrompt,
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
