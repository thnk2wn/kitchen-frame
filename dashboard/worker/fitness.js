// Activity rings and recent workouts, per person, for the frame's Fitness tab, and weight against a
// goal for those who share it. Each person's iPhone sends its own (the phone app reads HealthKit,
// ios/KitchenFrame/Fitness.swift); nothing else from Health comes here. A phone sends when it opens and when HealthKit wakes it with new data, so a
// person's numbers can be an hour or more behind; `updated` says how far.
//   GET    /api/fitness           -> { people: [{ id, name, updated, unit, days, steps, meters, workouts }] }
//   POST   /api/fitness           one phone's numbers (below), replacing what it sent before
//   DELETE /api/fitness?id=<id>   stops showing that phone's person (its "Share Fitness on the frame" off, or unpaired)
// A phone is known by an id it makes once (a UUID), not by the name typed on it, so two people with
// the same name can't overwrite or remove each other. One KV entry per phone (CALENDAR namespace,
// "fitness:<id>"), so two phones sending at once can't lose each other's update either. A phone
// writes at most every few minutes, mostly hourly or less, far inside KV's free allowance.
import { roomStore } from './store.js';

const PREFIX = 'fitness:';
const MAX_PEOPLE = 6;
const DAYS = 29; // 4 weeks before today, and today
const TTL_DAYS = 14;
// Icons the frame has for a workout (src/lib/icons.js); anything else shows the generic one.
const KINDS = ['run', 'walk', 'bike', 'swim', 'strength', 'yoga', 'hiit', 'elliptical', 'rowing', 'other'];

const num = (v, max = 1e6) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n * 10) / 10, max) : null; };
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const clip = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const inRange = (v, lo, hi, signed = false) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= lo && n <= hi && (signed || n >= 0) ? Math.round(n * 10) / 10 : null; };
export const phoneId = (v) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : null);

// Weight against a goal, only when its owner shares it (the phone's Settings → Apple Health): the last
// year's weigh-ins, one a day, each as the difference from the goal (d), in the phone's unit, so the
// trend and what's left need no weight at all (src/lib/weight.js). The goal itself, and height for
// BMI, only when its owner also chose to show their weight. Out of range is dropped.
const WEIGH_INS = 400;
export function cleanWeight(w) {
  if (!w || typeof w !== 'object') return null;
  // One a day, the last sent for a date winning; at most WEIGH_INS (the input trimmed first, so a
  // huge list costs nothing).
  const byDate = new Map();
  for (const p of (Array.isArray(w.points) ? w.points : []).slice(-WEIGH_INS * 2)) {
    const d = p && day(p.date) ? inRange(p.d, -300, 300, true) : null;
    if (d != null) byDate.set(p.date, { date: p.date, d });
  }
  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-WEIGH_INS);
  if (!points.length) return null;
  const goal = inRange(w.goal, 20, 700), heightM = Number(w.heightM);
  // The scale's own BMI and body fat (it saves them to Health), with the goal only, like height.
  const bmi = goal != null ? inRange(w.bmi, 10, 80) : null, bodyFat = goal != null ? inRange(w.bodyFat, 2, 75) : null;
  // show: how its owner shows the weight, 'pin' (after their PIN) or 'open' (to anyone, on the chip
  // too); only with the goal, which is what lets the frame work the weight out.
  return { unit: w.unit === 'kg' ? 'kg' : 'lb', points, ...(goal != null ? { goal, show: w.show === 'open' ? 'open' : 'pin' } : {}),
    ...(goal != null && Number.isFinite(heightM) && heightM >= 1 && heightM <= 2.5 ? { heightM: Math.round(heightM * 1000) / 1000 } : {}),
    ...(bmi != null ? { bmi } : {}), ...(bodyFat != null ? { bodyFat } : {}) };
}

// What a phone sends, kept to what the frame shows: the last 4 weeks and today of rings (with each
// day's steps and workout minutes), today's steps and distance, and the 5 latest workouts. Anything missing or malformed is dropped, not guessed.
export function cleanFitness(b) {
  const id = phoneId(b && b.id);
  const name = clip(b && b.name, 40);
  if (!id || !name) return null;
  const days = (Array.isArray(b.days) ? b.days : []).map((d) => d && day(d.date) && {
    date: d.date,
    move: num(d.move), moveGoal: num(d.moveGoal),
    exercise: num(d.exercise, 1440), exerciseGoal: num(d.exerciseGoal, 1440),
    stand: num(d.stand, 24), standGoal: num(d.standGoal, 24),
    // For the trends (streaks, against the usual, workout days).
    steps: num(d.steps), workoutMinutes: num(d.workoutMinutes, 1440),
  }).filter(Boolean).sort((a, c) => a.date.localeCompare(c.date)).slice(-DAYS);
  const workouts = (Array.isArray(b.workouts) ? b.workouts : []).map((w) => w && iso(w.start) && {
    type: clip(w.type, 40) || 'Workout',
    kind: KINDS.includes(w.kind) ? w.kind : 'other',
    start: iso(w.start),
    minutes: num(w.minutes, 1440),
    kcal: num(w.kcal),
    meters: num(w.meters),
    // For the frame's workout sheet: total calories (active and resting), climb, Apple's effort
    // score (1-10), the weather the Watch saved, and average heart rate only if its owner turned
    // that on (the phone's Settings → Apple Health). Out of range is dropped.
    totalKcal: num(w.totalKcal),
    climbMeters: num(w.climbMeters, 9000),
    effort: inRange(w.effort, 1, 10),
    tempC: inRange(w.tempC, -60, 60, true),
    humidity: inRange(w.humidity, 0, 100),
    heartRate: inRange(w.heartRate, 30, 250),
  }).filter(Boolean)
    // Other apps (Strava, Peloton) copy a Watch workout into Health: the same start and type twice.
    .filter((w, i, all) => all.findIndex((x) => x.start === w.start && x.type === w.type) === i)
    .sort((a, c) => c.start.localeCompare(a.start)).slice(0, 5);
  // unit: how the phone shows distances (its region's setting), so the frame matches it.
  // reason: why the phone sent (app opened, a workout saved, a Health update), for the status page.
  // dataAt: when the phone's newest Watch reading ends (how current the rings are); none from older apps.
  const weight = cleanWeight(b.weight);
  const usual = cleanUsual(b.usual);
  return { id, name, updated: new Date().toISOString(), dataAt: iso(b.dataAt) || null, reason: clip(b.reason, 40) || null, unit: b.unit === 'km' ? 'km' : 'mi', days, steps: num(b.steps), meters: num(b.meters), workouts, ...(weight ? { weight } : {}), ...(usual ? { usual } : {}) };
}

// usual: where each ring usually is by the end of each hour on each day of the week (7, Sunday first,
// each 24 shares of the day's goal per ring, or null for a weekday with too few days), so the frame
// says behind against a usual Monday, not a straight line through the day. A day's three rings or none.
const cleanUsualDay = (u) => {
  if (!u || typeof u !== 'object') return null;
  const out = {};
  for (const ring of ['move', 'exercise', 'stand']) {
    const a = Array.isArray(u[ring]) && u[ring].length === 24 ? u[ring].map((v) => inRange(v, 0, 5)) : null;
    if (!a || a.some((v) => v == null)) return null;
    out[ring] = a.map((v, i) => Math.max(v, ...a.slice(0, i))); // a running total never goes down
  }
  return out;
};
export function cleanUsual(u) {
  if (!Array.isArray(u) || u.length !== 7) return null;
  const days = u.map(cleanUsualDay);
  return days.some(Boolean) ? days : null;
}

// Each phone's numbers live in the room's store (store.js), not KV: written hourly and after every
// workout, and listed whenever the frame looks. Without the room (tests), KV.
const store = (env) => (env.MESSAGES ? roomStore(env) : env.CALENDAR);
const all = async (env) => {
  const s = store(env);
  if (s.entries) return (await s.entries(PREFIX)).map((e) => JSON.parse(e.value));
  const { keys } = await s.list({ prefix: PREFIX });
  return (await Promise.all(keys.map((k) => s.get(k.name, 'json')))).filter(Boolean);
};
// Once, after the move: the people KV still had, so nobody disappears until their phone next sends.
async function moveFromKv(env) {
  const s = store(env);
  if (!env.MESSAGES || (await s.get('fitness-moved'))) return;
  const { keys } = await env.CALENDAR.list({ prefix: PREFIX });
  for (const k of keys) {
    const p = await env.CALENDAR.get(k.name, 'json');
    if (p && !(await s.get(k.name))) await s.put(k.name, JSON.stringify(p), { expirationTtl: TTL_DAYS * 86400 });
  }
  await s.put('fitness-moved', '1');
}

export async function listFitness(env) {
  await moveFromKv(env);
  const people = await all(env);
  return { people: people.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) };
}

export async function saveFitness(env, body) {
  const p = cleanFitness(body);
  if (!p) return { status: 400, body: { error: 'id and name are required' } };
  await moveFromKv(env);
  const s = store(env);
  if (!(await s.get(PREFIX + p.id))) {
    const { keys } = await s.list({ prefix: PREFIX });
    if (keys.length >= MAX_PEOPLE) return { status: 400, body: { error: 'too many people' } };
  }
  // Gone by itself after TTL_DAYS without a send (a phone unpaired offline, the app deleted), each send renewing it.
  await s.put(PREFIX + p.id, JSON.stringify(p), { expirationTtl: TTL_DAYS * 86400 });
  return { status: 200, body: { ok: true, updated: p.updated } };
}

export async function removeFitness(env, id) {
  const key = phoneId(id);
  if (key) { await store(env).delete(PREFIX + key); if (env.MESSAGES) await env.CALENDAR.delete(PREFIX + key).catch(() => {}); }
  return { status: 200, body: { ok: true } };
}
