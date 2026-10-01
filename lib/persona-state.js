'use strict';
const { conversationIntent } = require('./conversation-intent');
const MEMORY_WINDOW = 7 * 86400000;
function personaState(text, stored, puzzle, enabled, now = Date.now()) {
  const off = conversationIntent(text) === 'normal';
  const request = String(text).toLowerCase().replace(/ё/g, 'е');
  const namedPersona = /(?:^|[^\p{L}])блатн(?:ой|ым|ого|ому|ом)\s+пульсик(?:ом|а|у|е)?(?:$|[^\p{L}])/u.test(request);
  const negated = /(?:не хочу|не надо|не нужен|не включай|не зови)/u.test(request);
  const on = /^\/blatnoy(?:\s|$)/i.test(text) || (namedPersona && !negated);
  if (!enabled || off) return { active: false, stop: off, next: { mode: 'normal' } };
  // Only the selected persona controls the voice. Old puzzle metadata must never
  // restore a persona after a normal selection or after persona memory expires.
  const legacy = typeof stored === 'number' ? stored > 0 : !stored?.mode && stored?.remaining > 0 && stored.expiresAt > now;
  const active = on || stored?.mode === 'blatnoy' || legacy;
  return { active: Boolean(active), start: Boolean(on), expiresAt: active ? now + MEMORY_WINDOW : 0,
    next: { mode: active ? 'blatnoy' : 'normal' } };
}
module.exports = { personaState };
