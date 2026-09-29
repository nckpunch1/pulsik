'use strict';
const { conversationIntent } = require('./conversation-intent');
const HOUR = 3600000;
function personaState(text, stored, puzzle, enabled, now = Date.now()) {
  const off = conversationIntent(text) === 'normal';
  const on = /^\/blatnoy(?:\s|$)/i.test(text) || (/блатной/i.test(text) && /пульсик/i.test(text));
  if (!enabled || off) return { active: false, stop: off, next: { remaining: 0, expiresAt: 0 } };
  if (on) return { active: true, start: true, expiresAt: now + HOUR, next: { remaining: 4, expiresAt: now + HOUR } };
  const value = typeof stored === 'number' ? { remaining: stored, expiresAt: now + HOUR } : stored;
  const carried = value?.remaining > 0 && value.expiresAt > now;
  const pinned = puzzle?.voice === 'blatnoy' && !puzzle.completed && puzzle.voiceUntil > now;
  return { active: Boolean(carried || pinned), expiresAt: carried ? value.expiresAt : puzzle?.voiceUntil,
    next: { remaining: carried ? Math.max(0, value.remaining - 1) : 0, expiresAt: value?.expiresAt || 0 } };
}
module.exports = { personaState };
