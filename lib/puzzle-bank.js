'use strict';
const path = require('node:path');
const fs = require('node:fs');
function validateBank(raw, name) {
  if (!Array.isArray(raw.puzzles) || !raw.puzzles.length) throw new Error(`${name}: empty bank`);
  const ids = new Set(), questions = new Set();
  for (const p of raw.puzzles) {
    for (const field of ['id', 'question', 'answer', 'explanation']) if (typeof p[field] !== 'string' || !p[field].trim()) throw new Error(`${name}: invalid ${field}`);
    if (!/^[wc]\d{3}$/.test(p.id) || ids.has(p.id)) throw new Error(`${name}: duplicate/invalid id ${p.id}`);
    if (questions.has(p.question.trim())) throw new Error(`${name}: duplicate question`);
    if ((p.question + p.answer + p.explanation).length > 3000) throw new Error(`${name}: puzzle too long`);
    ids.add(p.id); questions.add(p.question.trim());
  }
  return raw.puzzles.filter(p => p.enabled !== false);
}
function load(which) {
  const puzzles = validateBank(JSON.parse(fs.readFileSync(path.join(__dirname, `../content/${which}-puzzles.json`), 'utf8')), which);
  if (!puzzles.length) throw new Error(`${which}: no enabled puzzles`);
  return puzzles;
}
module.exports = { validateBank, getWeeklyBank: () => load('weekly'), getChatBank: () => load('chat') };
