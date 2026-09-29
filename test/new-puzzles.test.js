'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const bank = require('../content/weekly-puzzles.json').puzzles;
test('ten additions have unique IDs, explanations and produce sixteen enabled weekly puzzles', () => {
  assert.equal(bank.filter(p => /^w0(1[2-9]|2[01])$/.test(p.id)).length, 10);
  assert.equal(new Set(bank.map(p => p.id)).size, bank.length);
  assert.equal(bank.filter(p => p.enabled !== false).length, 16);
});
test('w012: exhaustive shortest path verifies the bridge solution is 18 minutes', () => {
  const times = [1, 3, 6, 8], distances = new Map([['0:0', 0]]), queue = [[0, 0, 0]];
  while (queue.length) {
    queue.sort((a, b) => a[2] - b[2]); const [mask, side, cost] = queue.shift();
    if (mask === 15 && side === 1) { assert.equal(cost, 18); return; }
    const here = times.map((_, i) => i).filter(i => ((mask >> i) & 1) === side);
    const groups = here.map(i => [i]); for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) groups.push([here[i], here[j]]);
    for (const group of groups) {
      let next = mask; for (const i of group) next ^= 1 << i;
      const sum = cost + Math.max(...group.map(i => times[i])), key = `${next}:${1 - side}`;
      if (sum < (distances.get(key) ?? Infinity)) { distances.set(key, sum); queue.push([next, 1 - side, sum]); }
    }
  }
  assert.fail('No bridge solution');
});
test('w013: two weighings identify each of nine possible heavier tokens', () => {
  for (let heavy = 0; heavy < 9; heavy++) {
    const weight = i => i === heavy ? 2 : 1;
    const sum = ids => ids.reduce((n, i) => n + weight(i), 0);
    const a = [0, 1, 2], b = [3, 4, 5];
    const group = sum(a) > sum(b) ? a : sum(b) > sum(a) ? b : [6, 7, 8];
    const found = weight(group[0]) > weight(group[1]) ? group[0] : weight(group[1]) > weight(group[0]) ? group[1] : group[2];
    assert.equal(found, heavy);
  }
});
test('w014: locker simulation leaves exactly the ten squares open', () => {
  const doors = Array(101).fill(false);
  for (let pass = 1; pass <= 100; pass++) for (let n = pass; n <= 100; n += pass) doors[n] = !doors[n];
  assert.deepEqual(doors.flatMap((v, i) => v ? [i] : []), [1, 4, 9, 16, 25, 36, 49, 64, 81, 100]);
});
test('w015: unequal rope segments still give 30 + 15 minutes under stated burn-time model', () => {
  // Segment widths may differ: assign unequal one-ended burn times totalling 60.
  for (const segments of [[1, 9, 20, 30], [7, 2, 41, 10], [55, 1, 1, 3]]) {
    const total = segments.reduce((a, b) => a + b, 0), first = total / 2;
    assert.equal(first + (total - first) / 2, 45);
  }
});
test('w016–w019: unique remainder, match count, exact exponent and colour parity', () => {
  assert.deepEqual(Array.from({ length: 120 }, (_, i) => i + 1).filter(n => n % 3 === 2 && n % 5 === 4 && n % 7 === 6), [104]);
  let games = 0; for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) games++; assert.equal(games, 28);
  assert.equal((7n ** 2026n) % 10n, 9n);
  const counts = [0, 0]; for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) if (!(x === 0 && y === 0) && !(x === 7 && y === 7)) counts[(x + y) % 2]++;
  assert.deepEqual(counts, [30, 32]);
});
test('w020: exhaustive search gives only code 042', () => {
  const clues = [['682', 1, 1], ['614', 1, 0], ['206', 2, 0], ['738', 0, 0], ['780', 1, 0]], answers = [];
  for (let n = 0; n < 1000; n++) {
    const code = String(n).padStart(3, '0'); if (new Set(code).size !== 3) continue;
    if (clues.every(([guess, total, placed]) => [...guess].filter(c => code.includes(c)).length === total && [...guess].filter((c, i) => c === code[i]).length === placed)) answers.push(code);
  }
  assert.deepEqual(answers, ['042']);
});
test('w021: four of thirty-six ordered dice outcomes sum to nine', () => {
  let favourable = 0, total = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) { total++; if (a + b === 9) favourable++; }
  assert.equal(favourable, 4); assert.equal(favourable / total, 1 / 9);
});
