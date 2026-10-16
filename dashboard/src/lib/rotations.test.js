import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onDay, rotationLines } from './rotations.js';

const RULES = [
  { name: 'Up early', icon: 'sunrise', switchAt: '10:00', days: { mon: 'Sam', tue: 'Alex', wed: 'Sam', thu: 'Alex', fri: 'Sam', sat: 'Alex', sun: 'Sam' } },
  { name: 'Bedtime', icon: 'moon', alternate: { from: '2026-10-15', who: ['Alex', 'Sam'], what: ['Mia', 'Leo'] } },
];

test('rotations: by weekday, and alternating from a start day (also before it)', () => {
  assert.equal(onDay(RULES[0], new Date(2026, 9, 15)), 'Alex'); // a Thursday
  assert.equal(onDay(RULES[0], new Date(2026, 9, 18)), 'Sam'); // Sunday
  assert.equal(onDay(RULES[1], new Date(2026, 9, 15)), 'Alex: Mia · Sam: Leo');
  assert.equal(onDay(RULES[1], new Date(2026, 9, 16)), 'Alex: Leo · Sam: Mia');
  assert.equal(onDay(RULES[1], new Date(2026, 9, 17)), 'Alex: Mia · Sam: Leo');
  assert.equal(onDay(RULES[1], new Date(2026, 9, 14)), 'Alex: Leo · Sam: Mia');
  assert.equal(onDay({ name: 'x', days: { mon: 'Sam' } }, new Date(2026, 9, 15)), null);
});

test('rotations: up early is today\'s at the top until switchAt, then tomorrow\'s; bedtime is tonight\'s, last', () => {
  const at = (h, m = 0) => rotationLines(RULES, new Date(2026, 9, 15, h, m)).map((l) => [l.name, l.text, l.place]);
  assert.deepEqual(at(7), [['Up early', 'Alex', 'top'], ['Bedtime', 'Alex: Mia · Sam: Leo', 'last']]);
  assert.deepEqual(at(10), [['Up early', 'Sam', 'tomorrow'], ['Bedtime', 'Alex: Mia · Sam: Leo', 'last']]);
  assert.deepEqual(at(21, 30), [['Up early', 'Sam', 'tomorrow'], ['Bedtime', 'Alex: Mia · Sam: Leo', 'last']]);
  assert.deepEqual(rotationLines('nope'), []);
  assert.deepEqual(rotationLines([{ name: 'Bad', alternate: { who: ['a'], what: [] } }]), []);
});
