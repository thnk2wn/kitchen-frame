import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFitness, listFitness, saveFitness, removeFitness } from './fitness.js';

const kv = () => {
  const m = new Map();
  return {
    m,
    get: async (k, type) => (m.has(k) ? (type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => m.set(k, v),
    delete: async (k) => m.delete(k),
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  };
};
const ID1 = '11111111-2222-3333-4444-555555555555';
const ID2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const day = (date, move = 300) => ({ date, move, moveGoal: 500, exercise: 12, exerciseGoal: 30, stand: 6, standGoal: 12 });

test('cleanFitness: keeps the last 29 days in order and the 5 newest workouts', () => {
  const days = Array.from({ length: 31 }, (_, i) => day(new Date(Date.UTC(2026, 9, 19 - i)).toISOString().slice(0, 10)));
  const workouts = Array.from({ length: 7 }, (_, i) => ({ type: 'Walk', kind: 'walk', start: `2026-10-${10 + i}T12:00:00Z`, minutes: 20 }));
  const p = cleanFitness({ id: ID1, name: 'Alex', days, workouts, steps: 2924.4, meters: 2317 });
  assert.equal(p.days.length, 29);
  assert.equal(p.days[0].date, '2026-09-21');
  assert.equal(p.days[28].date, '2026-10-19');
  assert.deepEqual(p.workouts.map((w) => w.start.slice(8, 10)), ['16', '15', '14', '13', '12']);
  assert.equal(p.steps, 2924.4);
});

test('cleanFitness: the same workout copied in by another app is kept once', () => {
  const w = { type: 'Outdoor run', kind: 'run', start: '2026-10-18T22:05:00Z', minutes: 31 };
  const p = cleanFitness({ id: ID1, name: 'Alex', workouts: [w, { ...w, minutes: 30.5 }, { ...w, type: 'Yoga' }] });
  assert.deepEqual(p.workouts.map((x) => x.type), ['Outdoor run', 'Yoga']);
});

test('cleanFitness: workout details kept in range, the send reason kept short', () => {
  const p = cleanFitness({ id: ID1, name: 'Alex', reason: 'Health update (workouts)', workouts: [
    { type: 'Outdoor walk', kind: 'walk', start: '2026-10-19T15:36:00Z', minutes: 21.3, kcal: 83, totalKcal: 124, climbMeters: 19.2, effort: 2, tempC: 13.9, humidity: 49, heartRate: 95 },
    { type: 'Yoga', kind: 'yoga', start: '2026-10-18T15:36:00Z', minutes: 30, effort: 14, tempC: -80, humidity: 120, heartRate: 400 },
  ] });
  assert.equal(p.reason, 'Health update (workouts)');
  assert.deepEqual([p.workouts[0].totalKcal, p.workouts[0].climbMeters, p.workouts[0].effort, p.workouts[0].tempC, p.workouts[0].humidity, p.workouts[0].heartRate], [124, 19.2, 2, 13.9, 49, 95]);
  assert.deepEqual([p.workouts[1].effort, p.workouts[1].tempC, p.workouts[1].humidity, p.workouts[1].heartRate], [null, null, null, null]);
  assert.equal(cleanFitness({ id: ID1, name: 'Alex' }).reason, null);
});

test('cleanFitness: malformed parts dropped, unknown kinds become other, no id or name refused', () => {
  const p = cleanFitness({ id: ID1.toUpperCase(), name: ' Sam ', days: [{ date: 'yesterday' }, day('2026-10-19', -5)], workouts: [{ type: 'Climb', kind: 'rope', start: '2026-10-19T08:00:00Z', minutes: 50 }, { type: 'x' }] });
  assert.equal(p.id, ID1);
  assert.equal(p.name, 'Sam');
  assert.equal(p.days.length, 1);
  assert.equal(p.days[0].move, null);
  assert.equal(p.workouts.length, 1);
  assert.equal(p.workouts[0].kind, 'other');
  assert.equal(cleanFitness({ id: ID1, name: '  ' }), null);
  assert.equal(cleanFitness({ id: 'sam', name: 'Sam' }), null);
  assert.equal(cleanFitness(null), null);
});

test('save, list and remove: one entry per phone; the same name on two phones stays two people', async () => {
  const env = { CALENDAR: kv() };
  assert.equal((await saveFitness(env, { id: ID1, name: 'Sam', days: [day('2026-10-19', 100)] })).status, 200);
  await saveFitness(env, { id: ID2, name: 'Sam', days: [day('2026-10-19')] });
  await saveFitness(env, { id: ID1, name: 'Sam', days: [day('2026-10-19', 150)] });
  let { people } = await listFitness(env);
  assert.equal(people.length, 2);
  assert.equal(people.find((p) => p.id === ID1).days[0].move, 150);
  await removeFitness(env, ID2);
  ({ people } = await listFitness(env));
  assert.deepEqual(people.map((p) => p.id), [ID1]);
  await removeFitness(env, 'not-an-id');
  assert.equal((await saveFitness(env, {})).status, 400);
});

test('cleanFitness: dataAt (the newest Watch reading) kept as a time, else null', () => {
  assert.equal(cleanFitness({ id: ID1, name: 'Alex', days: [], dataAt: '2026-10-20T12:20:00Z' }).dataAt, '2026-10-20T12:20:00.000Z');
  assert.equal(cleanFitness({ id: ID1, name: 'Alex', days: [], dataAt: 'soon' }).dataAt, null);
  assert.equal(cleanFitness({ id: ID1, name: 'Alex', days: [] }).dataAt, null);
});

test('weight: weigh-ins as differences from the goal, one a day, in order; the goal and height only together', () => {
  const p = cleanFitness({ id: ID1, name: 'Sam', days: [day('2026-10-20')], weight: { unit: 'lb', points: [
    { date: '2026-10-08', d: 15.2 }, { date: '2026-08-24', d: 19.8 }, { date: '2026-10-08', d: 15.4 }, { date: 'soon', d: 1 }, { date: '2026-10-21', d: 'x' }, { date: '2026-10-21', d: 11.8 },
  ] } });
  assert.deepEqual(p.weight, { unit: 'lb', points: [{ date: '2026-08-24', d: 19.8 }, { date: '2026-10-08', d: 15.4 }, { date: '2026-10-21', d: 11.8 }] });
  // Height comes only with a goal (it's only for BMI, which needs the weight).
  assert.ok(!('heightM' in cleanFitness({ id: ID1, name: 'Sam', weight: { points: [{ date: '2026-10-21', d: 1 }], heightM: 1.88 } }).weight));
  const shown = cleanFitness({ id: ID1, name: 'Sam', weight: { unit: 'kg', points: [{ date: '2026-10-21', d: 1 }], goal: 84, heightM: 1.88, bmi: 24.74, bodyFat: 19.5 } }).weight;
  assert.deepEqual([shown.unit, shown.goal, shown.heightM, shown.bmi, shown.bodyFat], ['kg', 84, 1.88, 24.7, 19.5]);
  // BMI and body fat, like height, only with the goal.
  const bare = cleanFitness({ id: ID1, name: 'Sam', weight: { points: [{ date: '2026-10-21', d: 1 }], bmi: 24.7, bodyFat: 19.5 } }).weight;
  assert.ok(!('bmi' in bare) && !('bodyFat' in bare));
  // Not shared: no weight at all.
  assert.ok(!('weight' in cleanFitness({ id: ID1, name: 'Sam' })));
  assert.ok(!('weight' in cleanFitness({ id: ID1, name: 'Sam', weight: { points: [] } })));
});
