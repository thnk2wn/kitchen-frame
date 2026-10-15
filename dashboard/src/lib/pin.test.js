import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePin, pinMatches, waitAfter, triesLeft } from './pin.js';

test('PIN: stored salted and hashed, matched only by the same digits', async () => {
  const saved = await makePin('2580');
  assert.ok(!JSON.stringify(saved).includes('2580'));
  assert.equal(await pinMatches('2580', saved), true);
  assert.equal(await pinMatches('2581', saved), false);
  assert.notEqual((await makePin('2580')).hash, saved.hash); // a new salt each time
  assert.equal(await pinMatches('2580', null), false);
});

test('PIN: five free tries, then a wait that doubles up to 15 minutes', () => {
  assert.deepEqual([0, 4].map(waitAfter), [0, 0]);
  assert.deepEqual([5, 6, 7].map(waitAfter), [60000, 120000, 240000]);
  assert.equal(waitAfter(20), 15 * 60000);
  assert.deepEqual([0, 3, 5, 9].map(triesLeft), [5, 2, 0, 0]);
});
