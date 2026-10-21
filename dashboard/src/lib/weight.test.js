import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weightView, weightChip, demoWeight } from './weight.js';

const now = new Date('2026-06-30T09:00:00');
const pt = (date, d) => ({ date, d });

test('a falling series: a fitted pace, what is left, progress from the peak, and when at this pace', () => {
  const v = weightView({ unit: 'lb', points: [pt('2026-02-01', 20), pt('2026-03-01', 17), pt('2026-04-01', 14), pt('2026-05-01', 11), pt('2026-06-01', 8)] }, now);
  assert.ok(v.rate < -2.9 && v.rate > -3.2); // about 3 a month down
  assert.equal(v.toGo, 8);
  assert.equal(v.towards, true);
  assert.equal(v.progress, 0.6); // from 20 above to 8 above
  assert.equal(v.daysSince, 29);
  assert.equal(v.stale, true);
  assert.ok(v.eta && v.eta.getMonth() === 7); // 8 more at 3 a month from June 1: late August
  assert.deepEqual(weightChip(v), { text: '↓ 3.0 lb/mo · 8.0 lb to go', tone: 'good' });
});

test('two weigh-ins are a change, not a trend', () => {
  const v = weightView({ unit: 'lb', points: [pt('2026-06-01', 12), pt('2026-06-20', 10.5)] }, now);
  assert.equal(v.rate, null);
  assert.deepEqual(v.change, { from: '2026-06-01', by: -1.5 });
  assert.equal(v.eta, null);
  assert.deepEqual(weightChip(v), { text: '10.5 lb to go', tone: '' });
});

test('three weigh-ins within a few days are too close together for a trend', () => {
  const v = weightView({ unit: 'lb', points: [pt('2026-06-20', 12), pt('2026-06-22', 11), pt('2026-06-25', 10)] }, now);
  assert.equal(v.rate, null);
});

test('going up, away from the goal, is called that', () => {
  const v = weightView({ unit: 'lb', points: [pt('2026-02-01', 5), pt('2026-04-01', 7), pt('2026-06-01', 9)] }, now);
  assert.ok(v.rate > 0.9);
  assert.equal(v.towards, false);
  assert.equal(weightChip(v).tone, 'low');
  assert.ok(weightChip(v).text.startsWith('↑ '));
});

test('flat is steady; under the goal is at goal', () => {
  const flat = weightView({ unit: 'lb', points: [pt('2026-03-01', 3), pt('2026-04-15', 3.2), pt('2026-06-01', 3.1)] }, now);
  assert.equal(flat.steady, true);
  assert.equal(weightChip(flat).text, 'Steady · 3.1 lb to go');
  const under = weightView({ unit: 'lb', points: [pt('2026-06-20', -1.2)] }, now);
  assert.equal(under.atGoal, true);
  assert.equal(weightChip(under).text, 'at goal');
});

test('the weight and BMI only when the goal (and height) were sent', () => {
  const pts = [pt('2026-06-20', 11.8)];
  assert.equal(weightView({ unit: 'lb', points: pts }, now).weight, null);
  const v = weightView({ unit: 'lb', points: pts, goal: 185, heightM: 1.88 }, now);
  assert.equal(v.weight, 196.8);
  assert.equal(v.bmi, 25.3);
  // The scale's BMI wins over the worked-out one; body fat comes with it.
  const s = weightView({ unit: 'lb', points: pts, goal: 185, heightM: 1.88, bmi: 24.7, bodyFat: 19.5 }, now);
  assert.deepEqual([s.bmi, s.bodyFat], [24.7, 19.5]);
  // Shown or not, the chip never carries the weight (that's behind the PIN on the sheet).
  assert.equal(weightChip(s).text, '11.8 lb to go');
});

test('weigh-ins older than a year are left out; none at all is nothing to show', () => {
  const v = weightView({ unit: 'lb', points: [pt('2025-01-01', 30), pt('2026-06-01', 10)] }, now);
  assert.equal(v.points.length, 1);
  assert.equal(weightView({ unit: 'lb', points: [] }, now), null);
  assert.equal(weightView(null, now), null);
});

test('a climb then a fall: the pace is fitted from the turn, not through both', () => {
  const v = weightView({ unit: 'lb', points: [pt('2026-01-10', 10), pt('2026-03-01', 12), pt('2026-04-20', 17), pt('2026-05-01', 19.8), pt('2026-05-15', 16.4), pt('2026-06-10', 15.4), pt('2026-06-25', 11.8)] }, now);
  assert.deepEqual(v.turn, { date: '2026-05-01', kind: 'peak' });
  assert.ok(v.rate < -3.5 && v.rate > -5, String(v.rate));
  assert.equal(v.line[0].date, '2026-05-01');
});

test('a peak, then down to a new low at the latest weigh-in: fitted from the peak', () => {
  const v = weightView({ unit: 'lb', points: [pt('2026-02-01', 15), pt('2026-03-20', 17.2), pt('2026-05-01', 19.8), pt('2026-05-15', 16.4), pt('2026-06-10', 15.4), pt('2026-06-25', 11.8)] }, now);
  assert.deepEqual(v.turn, { date: '2026-05-01', kind: 'peak' });
  assert.ok(v.rate < -3, String(v.rate));
});

test('a turn with too little after it keeps the whole window', () => {
  const v = weightView({ unit: 'lb', points: [pt('2026-02-01', 10), pt('2026-04-01', 13), pt('2026-06-01', 16), pt('2026-06-20', 14)] }, now);
  assert.equal(v.turn, null);
  assert.equal(v.line[0].date, '2026-02-01');
});

test('demo weigh-ins make a trend heading for the goal', () => {
  const v = weightView(demoWeight(now), now);
  assert.ok(v.rate < 0 && v.towards);
});
