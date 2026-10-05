'use strict';
const { conversationIntent } = require('./conversation-intent');
const MEMORY_WINDOW = 7 * 86400000;
function personaState(text, stored, puzzle, enabled, now = Date.now()) {
  const off = conversationIntent(text) === 'normal';
  const request = String(text).toLowerCase().replace(/ё/g, 'е');
  const clean = request.replace(/[!?.,]+$/g, '').trim();
  // Mentioning a persona in an announcement or discussing it is not selecting it.
  const directName = /^блатной пульсик$/.test(clean);
  const summon = /^(?:пульсик[, ]+)?(?:хочу (?:поговорить|пообщаться) с блатным пульсиком|позови блатного пульсика|давай к блатному пульсику|включи блатного пульсика|будь блатным пульсиком)$/.test(clean);
  const namedRequest = /^блатной пульсик[, ]+(.+)$/.exec(clean);
  const actionable = namedRequest && ['puzzle', 'repeat', 'hint', 'answer', 'chat'].includes(conversationIntent(namedRequest[1]));
  const on = /^\/blatnoy(?:\s|$)/i.test(text) || directName || summon || Boolean(actionable);
  if (!enabled || off) return { active: false, stop: off, next: { mode: 'normal' } };
  // Only the selected persona controls the voice. Old puzzle metadata must never
  // restore a persona after a normal selection or after persona memory expires.
  const legacy = typeof stored === 'number' ? stored > 0 : !stored?.mode && stored?.remaining > 0 && stored.expiresAt > now;
  const active = on || stored?.mode === 'blatnoy' || legacy;
  return { active: Boolean(active), start: Boolean(on), expiresAt: active ? now + MEMORY_WINDOW : 0,
    next: { mode: active ? 'blatnoy' : 'normal' } };
}
module.exports = { personaState };
