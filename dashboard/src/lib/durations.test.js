import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitDurations, clockOf, doneSentence } from './durations.js';

test('recipe steps: durations become timers, ranges use the lower number', () => {
  const parts = splitDurations('Simmer 10–12 minutes, then bake for 1 hour. Rest 30 sec.');
  assert.deepEqual(parts.filter((p) => typeof p !== 'string').map((p) => [p.text, p.seconds]),
    [['10–12 minutes', 600], ['1 hour', 3600], ['30 sec', 30]]);
  assert.equal(parts.map((p) => (typeof p === 'string' ? p : p.text)).join(''), 'Simmer 10–12 minutes, then bake for 1 hour. Rest 30 sec.');
  assert.deepEqual(splitDurations('Preheat oven to 375F.'), ['Preheat oven to 375F.']);
});

test('timer clock text', () => {
  assert.equal(clockOf(65), '1:05');
  assert.equal(clockOf(3725), '1:02:05');
});

test('timer announcements read like the spoken request', () => {
  assert.equal(doneSentence('Bread', 300), 'Your 5 minute bread timer is done.');
  assert.equal(doneSentence('5 min', 300), 'Your 5 minute timer is done.');
  assert.equal(doneSentence('Blackened Shrimp Bowls', 1500), 'Your 25 minute Blackened Shrimp Bowls timer is done.');
  assert.equal(doneSentence('Oven', 5400), 'Your 1 hour 30 minute oven timer is done.');
});
