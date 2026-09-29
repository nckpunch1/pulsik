'use strict';
const { config, authorized } = require('../lib/config');
const store = require('../lib/redis');
const { sendMessage } = require('../lib/telegram');
const { generateReply, complete } = require('../lib/llm');
const { matchesStatusCommand, buildStatusReport } = require('../lib/bank-status');
const { PERSONALITY_PROMPT, BLATNOY_PERSONALITY_PROMPT, SHARED_RULES, contextLine } = require('../lib/personality');
const { getUpcomingSessions } = require('../lib/sessions');
const { formatSessionsForPrompt } = require('../lib/format');
const { puzzleTurn } = require('../lib/chat-puzzles');
const { event } = require('../lib/observability');
const { understandPuzzle, understoodTurn } = require('../lib/puzzle-understanding');
const { getChatBank } = require('../lib/puzzle-bank');
const { conversationIntent } = require('../lib/conversation-intent');
const { personaState } = require('../lib/persona-state');
const { COMMANDS: OVERVIEW_COMMANDS, createOverviewCommands } = require('../lib/game-overview');
const overviewCommand = createOverviewCommands({ store, sendMessage, getUpcomingSessions, complete });

const HELP = 'Я Пульсик, ИИ-бот PulseIQ. Можно просто поболтать!\nХочешь размяться? Скажи «дай загадку».\nМожно попросить «дай подсказку», «скажи ответ» или «давай поболтаем».\n/privacy — о данных\n/forget — удалить сохранённую память\n/whoami — мой числовой Telegram ID\nВ группе отвечаю на упоминание, имя «Пульсик» или ответ на моё сообщение. Игры и регистрация: player.pulseiq.com.au';
const PRIVACY = 'Я ИИ-бот. Текст обращений и последние 20 сообщений нашей беседы могут передаваться Groq для ответа. Память разделена по чатам и темам; сообщения старше 7 дней не используются. История загадок удаляется после 7 дней бездействия. /forget удаляет твою сохранённую память во всех чатах бота, включая индексируемые цитаты из групп. Это не удаляет сообщения в Telegram или данные, уже обработанные провайдерами. Технические записи доставки не содержат текст переписки. Админские заметки для анонсов хранятся отдельно 30 дней, черновики — сутки; удалить заметки можно через /gameclear. Для создания анонса заметки передаются Groq.';

module.exports = async function handler(req, res) {
  const started = Date.now(), deadline = started + 48000;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let cfg;
  try { cfg = config(); } catch { event('CONFIGURATION_FAILURE'); return res.status(503).json({ error: 'Bot not configured' }); }
  if (!authorized(req.headers['x-telegram-bot-api-secret-token'], cfg.webhookSecret)) return res.status(401).json({ error: 'Unauthorized' });
  const update = req.body, m = update?.message;
  if (!m) return res.status(200).json({ ok: true });
  const privateChat = m.chat?.type === 'private', group = ['group', 'supergroup'].includes(m.chat?.type);
  if ((!privateChat && !group) || !Number.isSafeInteger(m.from?.id) || m.from.is_bot || m.sender_chat || !Number.isSafeInteger(m.chat?.id)) return res.status(200).json({ ok: true });
  if (!Number.isSafeInteger(update.update_id) || !Number.isSafeInteger(m.message_id)) return res.status(400).json({ error: 'Invalid update' });
  if (m.date && m.date * 1000 < Date.now() - 7 * 86400000) return res.status(200).json({ ok: true, stale: true });
  const chatId = String(m.chat.id), userId = String(m.from.id), topicId = m.message_thread_id || 0;
  if (group && !cfg.groups.includes(chatId)) return res.status(200).json({ ok: true });
  let text = m.text || m.caption || '';
  if (typeof text !== 'string' || !text.trim()) return res.status(200).json({ ok: true });
  const commandTarget = text.match(/^\/[a-z]+@([a-z0-9_]+)/i)?.[1];
  if (commandTarget && commandTarget.toLowerCase() !== cfg.username.toLowerCase()) return res.status(200).json({ ok: true });
  text = text.replace(/^\/(\w+)@\w+/i, '/$1');
  const command = text.trim().split(/\s+/)[0].toLowerCase();
  if (cfg.privateTest && (!privateChat || (!cfg.operators.includes(userId) && !['/whoami', '/privacy', '/forget'].includes(command)))) return res.status(200).json({ ok: true, testing: true });
  const overviewControl = OVERVIEW_COMMANDS.has(command);
  if (!overviewControl) text = text.slice(0, 1000);
  const statusCommand = matchesStatusCommand(text);
  // Operational requests never enter the LLM or shared context, including unauthorized ones.
  if ((statusCommand || overviewControl) && (!privateChat || !cfg.operators.includes(userId))) return res.status(200).json({ ok: true });
  const control = ['/start', '/help', '/privacy', '/forget', '/whoami'].includes(command) || statusCommand || overviewControl;
  if (!cfg.chatEnabled && !control) return res.status(200).json({ ok: true, paused: true });
  const addressed = privateChat || control || text.toLowerCase().includes(`@${cfg.username.toLowerCase()}`) || /(?:^|[^\p{L}])пульсик(?:$|[^\p{L}])/iu.test(text) || String(m.reply_to_message?.from?.id) === cfg.botId;
  if (!addressed && !cfg.groupContext) return res.status(200).json({ ok: true });
  const scopeId = store.scope(chatId, userId, topicId), roomId = store.room(chatId, topicId);
  let updateLock, userLock, sending = false;
  try {
    updateLock = await store.lock(`update:${update.update_id}`);
    if (!updateLock) return res.status(503).json({ error: 'Update busy' });
    const previous = await store.get(`update:${update.update_id}`);
    if (previous && ['done', 'sending', 'uncertain'].includes(previous.state)) {
      if (previous.state !== 'done') event('UPDATE_REQUIRES_REVIEW', { updateId: update.update_id, state: previous.state });
      return res.status(200).json({ ok: true, duplicate: true });
    }
    if (previous?.retryAt > Date.now()) return res.status(503).json({ error: 'Retry later' });
    // A user-wide lock also makes /forget atomic relative to that user's turns in other rooms.
    userLock = await store.lock(`user:${userId}`);
    if (!userLock) return res.status(503).json({ error: 'Conversation busy' });
    if (!addressed) {
      await store.finishUpdate(update.update_id, { roomId, userId, username: m.from.first_name || 'Участник', contextText: text });
      return res.status(200).json({ ok: true });
    }
    const allowed = await Promise.all([store.rateLimit(`user:${userId}`, 10, 60), store.rateLimit(`chat:${chatId}`, 20, 60)]);
    if (allowed.includes(false)) { await store.finishUpdate(update.update_id); return res.status(200).json({ ok: true, limited: true }); }
    let reply, puzzle, persona, replyHtml = false, remember = false;
    const gameState = !control ? await store.get(`puzzle:${scopeId}`) : null;
    const intent = conversationIntent(text, Boolean(gameState?.active));
    const voice = !control ? personaState(text, cfg.personaEnabled ? await store.get(`persona:${scopeId}`) : null, gameState, cfg.personaEnabled) : { active: false };
    if (overviewControl) { const result = await overviewCommand({ text, cfg, userId, updateId: update.update_id, deadline }); reply = result.reply; replyHtml = Boolean(result.html); }
    else if (statusCommand) reply = buildStatusReport(await store.get(store.rotationName()));
    else if (command === '/start' || command === '/help') reply = HELP + (cfg.personaEnabled ? '\nПозови «Блатной Пульсик», если хочется другого настроения. «Говори нормально» — вернуться к обычному голосу.' : '') + (privateChat && cfg.operators.includes(userId) ? '\nДля анонса: /gamebrief, /overview, /publish КОД. Заметки видны только администраторам.' : '');
    else if (command === '/privacy') reply = PRIVACY + (cfg.groupContext ? '\nСбор контекста групп включён: последние 20 коротких цитат могут использоваться в пределах этой группы/темы.' : '\nФоновый сбор сообщений групп отключён.');
    else if (command === '/whoami') reply = privateChat ? `Твой Telegram user ID: ${userId}. Username сам по себе не даёт прав администратора.` : 'Напиши /whoami мне в личку.';
    else if (command === '/forget') { await store.forget(userId); reply = 'Сохранённая память и история загадок удалены. Новые обращения начнут новую историю.'; }
    else if (voice.stop) { persona = voice.next; puzzle = gameState ? { ...gameState, voice: null, voiceUntil: 0 } : undefined; reply = 'Снова обычный Пульсик. Если загадка ещё открыта, продолжаем её.'; }
    else if (voice.start && !['puzzle', 'hint', 'answer', 'chat'].includes(intent)) {
      persona = voice.next;
      if (gameState?.active && !gameState.completed) puzzle = { ...gameState, voice: 'blatnoy', voiceUntil: voice.expiresAt };
      const fallbacks = ['Ну что, устроимся поудобнее? Можем за жизнь поболтать, а можем загадку раскрутить.', 'Я на связи. Какой сегодня расклад — поговорим или голову над загадкой поломаем?', 'О, заглянули на огонёк. Рассказывай, что нового — или подкинуть задачку?'];
      reply = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      const budgets = await Promise.all([store.rateLimit('global:minute', cfg.minuteBudget, 60), store.rateLimit(`global:day:${new Date().toISOString().slice(0, 10)}`, cfg.dailyBudget, 172800)]);
      if (!budgets.includes(false)) {
        const history = await store.history(scopeId);
        const introRules = 'Собеседник позвал Блатного Пульсика. Ответь живым коротким вступлением в образе (1–3 предложения). Учитывай его реплику и недавний разговор, не повторяй прежнее вступление. Без списка команд, слеш-команд и технических объяснений режима. Не используй каждый раз шляпу, чай или «на связи». Можно предложить поболтать или загадку обычными словами, но не задавай саму загадку и не раскрывай ответ. Не придумывай факты об играх. Если загадка уже открыта, предложи продолжить её.';
        try {
          const intro = await generateReply(`${BLATNOY_PERSONALITY_PROMPT}\n\n${SHARED_RULES}\n\n${contextLine(privateChat)}\n\n${introRules}\nОткрытая загадка: ${Boolean(gameState?.active && !gameState.completed)}.`, history, [], text, { maxTokens: 700, deadline: Math.min(deadline - 12000, Date.now() + 22000) });
          if (intro.length <= 700 && !/\/[a-z]+/i.test(intro)) reply = intro;
        } catch { event('PERSONA_INTRO_FALLBACK', { updateId: update.update_id }); }
      }
      remember = true;
    }
    else if (command === '/blatnoy') reply = 'Театральный образ пока выключен. Обычный Пульсик на месте!';
    else if (group && ['puzzle', 'hint', 'answer'].includes(intent)) reply = `За загадкой напиши мне в личку: https://t.me/${cfg.username}`;
    else {
      let modelAdmitted = false;
      const admitModel = async () => {
        if (modelAdmitted) return true;
        const budgets = await Promise.all([store.rateLimit('global:minute', cfg.minuteBudget, 60), store.rateLimit(`global:day:${new Date().toISOString().slice(0, 10)}`, cfg.dailyBudget, 172800)]);
        modelAdmitted = !budgets.includes(false); return modelAdmitted;
      };
      if (intent === 'chat') puzzle = { ...gameState, seen: gameState?.seen || [], active: null, completed: true, hints: 0 };
      let turn = privateChat && intent !== 'chat' ? puzzleTurn(text, gameState, Math.random, { blatnoy: voice.active, deferUnknown: true }) : null;
      if (turn?.needsUnderstanding) {
        let kind = 'uncertain';
        if (await admitModel()) {
          try { kind = await understandPuzzle(text, gameState, complete, { maxTokens: 400, deadline: Math.min(deadline - 24000, Date.now() + 9000) }); }
          catch { event('PUZZLE_INTERPRETATION_UNAVAILABLE', { updateId: update.update_id }); }
        }
        turn = kind === 'chat' ? null : understoodTurn(kind, text, gameState, voice.active);
      }
      if (turn) { reply = turn.reply; puzzle = { ...turn.state, voice: voice.active ? 'blatnoy' : null, voiceUntil: voice.active ? voice.expiresAt : 0 }; persona = voice.next; remember = true; }
      else if (command.startsWith('/') && intent !== 'chat') reply = HELP;
      else {
        if (!await admitModel()) { event('GLOBAL_BUDGET_REACHED'); await store.finishUpdate(update.update_id); return res.status(200).json({ ok: true, limited: true }); }
        const [history, context, sessions] = await Promise.all([store.history(scopeId), group && cfg.groupContext ? store.context(roomId) : [], getUpcomingSessions({ deadline: Math.min(deadline - 18000, Date.now() + 2500) })]);
        persona = voice.next;
        const style = voice.active ? BLATNOY_PERSONALITY_PROMPT : PERSONALITY_PROMPT;
        const pendingPuzzle = privateChat && intent !== 'chat' && gameState?.active && !gameState.completed ? getChatBank().find(p => p.id === gameState.active) : null;
        const puzzleContext = pendingPuzzle ? `Сейчас есть открытая загадка: ${pendingPuzzle.question}\nЭта реплика распознана как разговор, а не попытка ответа. Ответь на неё в текущем образе. Не оценивай её как решение, не раскрывай и не угадывай ответ. Загадку можно продолжить позже.` : intent === 'chat' ? 'Собеседник хочет поболтать. Продолжи текущую беседу в выбранном образе; не здоровайся заново и не навязывай загадки.' : '';
        const system = `${style}\n\n${SHARED_RULES}\n\n${contextLine(privateChat)}\n\n${formatSessionsForPrompt(sessions)}\n\n${puzzleContext}`;
        try { reply = await generateReply(system, history, context, text, { deadline: Math.min(deadline - 12000, Date.now() + 22000) }); remember = true; }
        catch { reply = 'Сейчас не получается ответить. Попробуй чуть позже; можно попросить «дай загадку» — они доступны без ИИ.'; event('MODEL_UNAVAILABLE', { updateId: update.update_id }); }
      }
    }
    if (Date.now() > deadline - 9000 || !await store.owns(updateLock) || !await store.owns(userLock)) throw new Error('Deadline or lock expired');
    // Persist intent before network I/O; a crash now must never cause an automatic resend.
    await store.markSending(update.update_id); sending = true;
    const sent = await sendMessage(reply, chatId, { html: replyHtml, deadline: deadline - 3000, topicId, replyTo: group ? m.message_id : undefined });
    await store.finishUpdate(update.update_id, {
      scopeId, userId, userText: remember ? text : undefined, reply: remember ? reply : undefined,
      puzzle, persona, messageId: sent.message_id,
      roomId: group && cfg.groupContext && remember ? roomId : undefined,
      contextText: text, username: m.from.first_name || 'Участник',
    });
    event('UPDATE_DELIVERED', { updateId: update.update_id, durationMs: Date.now() - started });
    return res.status(200).json({ ok: true });
  } catch (err) {
    event('UPDATE_FAILED', { updateId: update.update_id, state: sending ? 'delivery_review' : 'before_send', code: String(err.code || 'internal') });
    if (sending && err.ambiguous === false) {
      // Telegram explicitly rejected the send: retry a 429 only; permanent rejections are completed.
      if (err.code === 429) {
        await store.put(`update:${update.update_id}`, { state: 'retry', retryAt: Date.now() + Math.max(1, err.retryAfter || 60) * 1000 }).catch(() => {});
        return res.status(503).json({ error: 'Rate limited' });
      }
      await store.finishUpdate(update.update_id).catch(() => {});
      return res.status(200).json({ ok: true, rejected: true });
    }
    return res.status(sending ? 200 : 503).json({ ok: sending, review: sending });
  } finally {
    await Promise.all([store.unlock(userLock).catch(() => {}), store.unlock(updateLock).catch(() => {})]);
  }
};
