'use strict';
function scheduledWeek(now = new Date()) {
  const d = new Date(now); d.setUTCHours(9, 0, 0, 0);
  // Wednesday in the current Monday–Sunday UTC week (Brisbane Wednesday evening).
  d.setUTCDate(d.getUTCDate() + 2 - ((d.getUTCDay() + 6) % 7));
  return { id: d.toISOString().slice(0, 10), at: d.getTime() };
}
function latestDue(now = new Date()) {
  let slot = scheduledWeek(now);
  if (slot.at > now.getTime()) slot = scheduledWeek(new Date(now.getTime() - 7 * 86400000));
  return slot;
}
function selectPuzzle(bank, rotation, random = Math.random) {
  if (!rotation || !Array.isArray(rotation.posted)) throw new Error('Rotation not initialized');
  let posted = rotation.posted.filter(id => bank.some(p => p.id === id));
  let candidates = bank.filter(p => !posted.includes(p.id));
  if (!candidates.length) { posted = []; candidates = bank.filter(p => p.id !== rotation.last); }
  if (!candidates.length) candidates = bank;
  const puzzle = candidates[Math.floor(random() * candidates.length)];
  return { puzzle, rotation: { posted: [...posted, puzzle.id], last: puzzle.id } };
}
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function buildPost(p) {
  return `🧠 <b>СредаIQ — прокачай интеллект</b>\n\n${escapeHtml(p.question)}\n\n<b>Ответ:</b> <tg-spoiler>${escapeHtml(p.answer)}\n${escapeHtml(p.explanation)}</tg-spoiler>\n\n🎯 <i>PulseIQ — интеллектуальные игры в Брисбене</i>`;
}
module.exports = { scheduledWeek, latestDue, selectPuzzle, buildPost };
