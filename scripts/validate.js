'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validateBank, getWeeklyBank, getChatBank } = require('../lib/puzzle-bank');
for (const dir of ['api', 'lib', 'scripts']) for (const file of fs.readdirSync(path.join(__dirname, '..', dir))) {
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(__dirname, '..', dir, file)]);
}
for (const which of ['weekly', 'chat']) validateBank(require(`../content/${which}-puzzles.json`), which);
console.log(`Validation passed: ${getWeeklyBank().length} enabled weekly puzzles, ${getChatBank().length} enabled chat puzzles.`);
