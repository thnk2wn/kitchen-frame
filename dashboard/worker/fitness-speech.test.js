import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitnessFacts, plainSpeech, cleanSpeech, fitnessSpeech } from './fitness-speech.js';

// Mid-afternoon in New York; the wall clock is that time as local fields (alexa.js wallClock).
const now = new Date('2026-10-19T19:30:00Z');
const tz = 'America/New_York';
const wall = new Date(now.toLocaleString('en-US', { timeZone: tz }));
const day = (date, move, exercise, stand) => ({ date, move, moveGoal: 500, exercise, exerciseGoal: 30, stand, standGoal: 12 });
const person = (name, today, extra = {}) => ({
  id: name, name, updated: new Date(now - 20 * 60000).toISOString(), unit: 'mi', steps: 6123.4,
  days: [day('2026-10-14', 500, 35, 13), day('2026-10-15', 300, 10, 9), day('2026-10-16', 520, 31, 12), day('2026-10-17', 677, 16, 15), day('2026-10-18', 702, 19, 13), today],
  workouts: [{ type: 'Outdoor walk', kind: 'walk', start: '2026-10-19T13:00:00Z', minutes: 22.4, effort: 2 }, { type: 'Elliptical', kind: 'elliptical', start: '2026-10-16T12:04:00Z', minutes: 4 }],
  ...extra,
});

test('fitnessFacts: today by the household clock, the past week counted, workouts named by day', () => {
  const [f] = fitnessFacts([person('Alex', day('2026-10-19', 173, 8, 3))], wall, tz, now);
  assert.equal(f.hour, 15);
  assert.deepEqual([f.today.move, f.today.exercise, f.today.stand], [173, 8, 3]);
  assert.equal(f.status, 'behind on stand');
  assert.equal(f.pastDays, 5);
  assert.equal(f.allClosedDays, 2);
  assert.equal(f.steps, 6123);
  assert.deepEqual(f.workouts.map((w) => w.when), ['today', 'on Friday']);
  assert.equal(f.minutesOld, 20);
});

test('plainSpeech: one person spoken to, several named; nobody sharing explained', () => {
  const one = plainSpeech(fitnessFacts([person('Alex', day('2026-10-19', 173, 8, 3))], wall, tz, now));
  assert.match(one, /^You're behind on stand today\. Move 173 of 500 calories, exercise 8 of 30 minutes, stand 3 of 12 hours\./);
  assert.match(one, /You're on a 3-day Move streak\. Last workout: an easy outdoor walk today, 22 minutes\./);
  const two = plainSpeech(fitnessFacts([person('Alex', day('2026-10-19', 500, 40, 12)), person('Sam', day('2026-10-19', 300, 25, 9))], wall, tz, now));
  assert.match(two, /^Alex has closed all three rings today\./);
  assert.match(two, /Sam is on track today\./);
  assert.match(plainSpeech([]), /No one is sharing/);
});

test('fitnessSpeech: the model words it (and is cached); slow or failing, the plain facts instead', async () => {
  const store = new Map();
  const CALENDAR = { get: async (k) => store.get(k) ?? null, put: async (k, v) => store.set(k, v) };
  const facts = fitnessFacts([person('Alex', day('2026-10-19', 173, 8, 3))], wall, tz, now);
  let calls = 0;
  const ok = { AI: { run: async () => { calls++; return { response: '<think>x</think>You are **on your way** today, with a walk already in. A short walk would close exercise.' }; } }, CALENDAR };
  const first = await fitnessSpeech(ok, facts);
  assert.equal(first.source, 'ai');
  assert.equal(first.speech, 'You are on your way today, with a walk already in. A short walk would close exercise.');
  assert.equal((await fitnessSpeech(ok, facts)).source, 'cache');
  assert.equal(calls, 1);
  const down = await fitnessSpeech({ AI: { run: async () => { throw new Error('4006: daily free allocation'); } }, CALENDAR: { get: async () => null, put: async () => {} } }, facts);
  assert.equal(down.source, 'plain');
  assert.match(down.problem, /allowance/);
  assert.match(down.speech, /^You're behind on stand/);
  assert.equal(cleanSpeech('ok'), null);
});
