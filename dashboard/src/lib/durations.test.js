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

import { saidLength, pickTimer } from './durations.js';
test('timer lengths as Alexa says them', () => {
  assert.equal(saidLength(600), '10 minutes');
  assert.equal(saidLength(60), '1 minute');
  assert.equal(saidLength(5400), '1 hour and 30 minutes');
  assert.equal(saidLength(90), '1 minute and 30 seconds');
  assert.equal(saidLength(45), '45 seconds');
});

test('a spoken timer: the one named, else a ringing one, else the one ending next', () => {
  const list = [{ id: 'a', label: 'Pasta', end: 300, done: false }, { id: 'b', label: 'Bread', end: 200, done: false }, { id: 'c', label: '5 min', end: 100, done: true }];
  assert.equal(pickTimer(list, 'pasta').id, 'a');
  assert.equal(pickTimer(list, '').id, 'c');
  assert.equal(pickTimer(list, 'rice').id, 'c'); // no such name: as if none was said
  assert.equal(pickTimer(list.slice(0, 2), '').id, 'b');
  assert.equal(pickTimer([], 'x'), null);
});

import { timerPicture } from './durations.js';
import { ICONS } from './icons.js';
test('timer pictures: food names get one, other names none, and every picture is an icon', () => {
  assert.equal(timerPicture('Pasta'), 'pot');
  assert.equal(timerPicture('Veggies'), 'carrot'); // not an egg
  assert.equal(timerPicture('Boiled eggs'), 'pot');
  assert.equal(timerPicture('Eggs'), 'egg');
  assert.equal(timerPicture('Oven'), 'microwave');
  assert.equal(timerPicture('Chicken soup'), 'drumstick');
  assert.equal(timerPicture('Protein'), 'drumstick');
  assert.equal(timerPicture('10 min'), null);
  assert.equal(timerPicture('Homework'), null);
  for (const n of ['pot', 'croissant', 'egg', 'pizza', 'cookie', 'cake', 'drumstick', 'beef', 'ham', 'fish', 'shrimp', 'carrot', 'leafyGreen', 'soup', 'microwave', 'coffee', 'popcorn', 'sandwich', 'washer']) assert.ok(ICONS[n], n);
});
