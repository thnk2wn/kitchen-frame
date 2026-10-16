import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limiter } from './limit.js';

test('limiter: a runaway repeat is cut off and reported once; others carry on', () => {
  const allow = limiter({ perKey: 5, perKeyMs: 2000, total: 60, totalMs: 5000 });
  const t = 1_000_000;
  // (After its 30 s block a key may go again: that's checked at the end.)
  // The snapshot loop: a thousand presses, 10 ms apart.
  const got = Array.from({ length: 1000 }, (_, i) => allow('button.press|garage', t + i * 10));
  assert.equal(got.filter((x) => x === 'ok').length, 5); // five, then blocked for 30 s
  assert.equal(got.filter((x) => x === 'report').length, 1);
  // Something else still goes through meanwhile.
  assert.equal(allow('light.toggle|kitchen', t + 5000), 'ok');
  assert.equal(allow('button.press|garage', t + 40000), 'ok');
  // Normal use is never touched: a tap every second for a minute.
  const calm = limiter({ perKey: 5, perKeyMs: 2000 });
  assert.ok(Array.from({ length: 60 }, (_, i) => calm('lock.lock|front', t + i * 1000)).every((x) => x === 'ok'));
});

test('limiter: everything together has a ceiling too, and reports again only after a minute', () => {
  const allow = limiter({ perKey: 100, total: 10, totalMs: 5000 });
  const t = 2_000_000;
  const got = Array.from({ length: 30 }, (_, i) => allow('k' + i, t + i));
  assert.equal(got.filter((x) => x === 'ok').length, 10);
  assert.equal(allow('k15', t + 100), 'drop'); // k15 was refused (and reported) just now
  assert.equal(allow('k15', t + 61000), 'ok'); // a minute on, the window has long cleared
});
