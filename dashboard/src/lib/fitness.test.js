import { test } from 'node:test';
import assert from 'node:assert/strict';
import { view, replayBeat } from './fitness.js';
import { addDays, dayKey } from './format.js';

// A person with n days before today (oldest first) from make(i), and today's numbers.
const now = new Date(2026, 9, 19, 14, 0); // 2 PM: 50% of the 6 AM to 10 PM day
const person = (n, make, today) => ({ id: 'a', name: 'Alex', updated: now.toISOString(), days: [
  ...Array.from({ length: n }, (_, i) => ({ date: dayKey(addDays(now, i - n)), moveGoal: 500, exerciseGoal: 30, standGoal: 12, ...make(i) })),
  { date: dayKey(now), moveGoal: 500, exerciseGoal: 30, standGoal: 12, ...today },
] });
const closed = { move: 600, exercise: 40, stand: 12 };

test('trends: streaks run back from today when it is closed, else from yesterday', () => {
  const t = view(person(10, (i) => (i >= 6 ? closed : { ...closed, stand: 5 }), { ...closed, steps: 0 }), now).trends;
  assert.equal(t.allStreak, 5);   // the last 4 days and today
  assert.equal(t.moveStreak, 11); // Move closed every day
  const notYet = view(person(10, () => closed, { move: 100, exercise: 5, stand: 4 }), now).trends;
  assert.equal(notYet.allStreak, 10); // today not closed yet: counted to yesterday
});

test('trends: steps and exercise against the usual by this time of day; workout days', () => {
  const p = person(28, (i) => ({ move: 300, exercise: 20, stand: 8, steps: 8000, workoutMinutes: i % 2 ? 30 : 0 }), { move: 200, exercise: 15, stand: 5, steps: 5000, workoutMinutes: 25 });
  const t = view(p, now).trends;
  assert.equal(t.steps, 25);    // 5,000 by 2 PM against half of 8,000
  assert.equal(t.exercise, 50); // 15 against half of 20
  assert.deepEqual([t.workoutDays, t.workoutOf], [15, 29]);
  // Too little history, or too early in the day: no comparison.
  assert.equal(view(person(3, () => ({ steps: 8000 }), { steps: 100 }), now).trends.steps, null);
  assert.equal(view(p, new Date(2026, 9, 19, 7, 0)).trends.steps, null);
});

test('trends: a day with no ring data (no goals) breaks a streak rather than counting', () => {
  const t = view(person(6, (i) => (i === 3 ? { moveGoal: null, exerciseGoal: null, standGoal: null, move: null, exercise: null, stand: null } : closed), closed), now).trends;
  assert.equal(t.moveStreak, 3); // today and the two days after the empty one
});

test('view: earlier days but none for today is waiting for the Watch, not behind', () => {
  const p = person(5, () => closed, closed);
  p.days.pop();
  const v = view(p, now);
  assert.equal(v.waiting, true);
  assert.equal(v.empty, false);
  assert.equal(view(person(5, () => closed, closed), now).waiting, false);
  assert.equal(view({ id: 'a', name: 'Alex', updated: now.toISOString(), days: [] }, now).waiting, false);
});

test('view: a phone that last sent before today isn\'t waiting on the Watch', () => {
  const p = person(5, () => closed, closed);
  p.days.pop();
  p.updated = addDays(now, -1).toISOString();
  assert.equal(view(p, now).waiting, false);
});

test('replayBeat: changes every 5 minutes through the day, and not at all from 10 PM to 6 AM', () => {
  const at = (d, h, m) => { const t = new Date(now); t.setDate(t.getDate() + d); t.setHours(h, m, 0, 0); return replayBeat(t); };
  assert.notEqual(at(0, 14, 0), at(0, 14, 5));
  assert.equal(at(0, 14, 0), at(0, 14, 4));
  assert.equal(at(0, 21, 59), at(0, 22, 0)); // no extra replay at 10 PM
  assert.equal(at(0, 22, 0), at(0, 23, 59));
  assert.equal(at(0, 23, 59), at(1, 0, 0));
  assert.equal(at(1, 0, 0), at(1, 5, 59));
  assert.notEqual(at(1, 5, 59), at(1, 6, 0)); // the day's first
});
