// Activity rings and recent workouts, per person, for the frame's Fitness tab. Each person's iPhone
// sends its own (the phone app reads HealthKit, ios/KitchenFrame/Fitness.swift); nothing else from
// Health comes here. A phone sends when it opens and when HealthKit wakes it with new data, so a
// person's numbers can be an hour or more behind; `updated` says how far.
//   GET    /api/fitness           -> { people: [{ id, name, updated, unit, days, steps, meters, workouts }] }
//   POST   /api/fitness           one phone's numbers (below), replacing what it sent before
//   DELETE /api/fitness?id=<id>   stops showing that phone's person (its "Share Fitness on the frame" off, or unpaired)
// A phone is known by an id it makes once (a UUID), not by the name typed on it, so two people with
// the same name can't overwrite or remove each other. One KV entry per phone (CALENDAR namespace,
// "fitness:<id>"), so two phones sending at once can't lose each other's update either. A phone
// writes at most every few minutes, mostly hourly or less, far inside KV's free allowance.
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
const phoneId = (v) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : null);

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
  return { id, name, updated: new Date().toISOString(), dataAt: iso(b.dataAt) || null, reason: clip(b.reason, 40) || null, unit: b.unit === 'km' ? 'km' : 'mi', days, steps: num(b.steps), meters: num(b.meters), workouts };
}

export async function listFitness(env) {
  const { keys } = await env.CALENDAR.list({ prefix: PREFIX });
  const people = (await Promise.all(keys.map((k) => env.CALENDAR.get(k.name, 'json')))).filter(Boolean);
  return { people: people.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) };
}

export async function saveFitness(env, body) {
  const p = cleanFitness(body);
  if (!p) return { status: 400, body: { error: 'id and name are required' } };
  if (!(await env.CALENDAR.get(PREFIX + p.id))) {
    const { keys } = await env.CALENDAR.list({ prefix: PREFIX });
    if (keys.length >= MAX_PEOPLE) return { status: 400, body: { error: 'too many people' } };
  }
  // Gone by itself after TTL_DAYS without a send (a phone unpaired offline, the app deleted), each send renewing it.
  await env.CALENDAR.put(PREFIX + p.id, JSON.stringify(p), { expirationTtl: TTL_DAYS * 86400 });
  return { status: 200, body: { ok: true, updated: p.updated } };
}

export async function removeFitness(env, id) {
  const key = phoneId(id);
  if (key) await env.CALENDAR.delete(PREFIX + key);
  return { status: 200, body: { ok: true } };
}
