'use strict';
const { conversationIntent } = require('./conversation-intent');
const MEMORY_WINDOW = 7 * 86400000;
function personaState(text, stored, puzzle, enabled, now = Date.now()) {
  const off = conversationIntent(text) === 'normal';
  const on = /^\/blatnoy(?:\s|$)/i.test(text) || (/блатной/i.test(text) && /пульсик/i.test(text));
  if (!enabled || off) return { active: false, stop: off, next: { mode: 'normal' } };
  // Migrate still-live legacy persona/puzzle state without the old four-turn cutoff.
  const legacy = typeof stored === 'number' ? stored > 0 : stored?.expiresAt > now;
  const active = on || stored?.mode === 'blatnoy' || legacy || (puzzle?.voice === 'blatnoy' && puzzle.voiceUntil > now);
  return { active: Boolean(active), start: Boolean(on), expiresAt: active ? now + MEMORY_WINDOW : 0,
    next: { mode: active ? 'blatnoy' : 'normal' } };
}
module.exports = { personaState };
