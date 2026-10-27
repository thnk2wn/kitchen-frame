// Activity rings (move, exercise, stand), steps and recent workouts per person, for the Fitness tab
// and Home's rings. Each person's iPhone sends theirs to the Worker (worker/fitness.js); demo mode
// shows two invented people in the same shape. lib/fitness.svelte.js holds what was loaded.
import { addDays, dayKey } from './format.js';
import { weightView, demoWeight } from './weight.js';

export const RING_COLORS = { move: '#fa114f', exercise: '#a6ff00', stand: '#00f0ff' };
// The same rings on a light background: the bright originals wash out on white.
export const RING_COLORS_LIGHT = { move: '#f2003c', exercise: '#5fc700', stand: '#00b9cc' };

// A workout's kind (the phone maps HealthKit's activity types to these) to its icon.
const KIND_ICONS = { run: 'footprints', walk: 'footprints', bike: 'bike', swim: 'waves', strength: 'dumbbell', yoga: 'person', hiit: 'flame', elliptical: 'activity', rowing: 'waves', other: 'activity' };
export const workoutIcon = (kind) => KIND_ICONS[kind] || 'activity';

// A person's numbers older than this are shown dimmed, with how old they are.
export const STALE_MS = 3 * 3600000;

// The rings' animations (behind pulsing, all closed bouncing) play again every REPLAY_MS while they're
// on screen, 6 AM to 10 PM, so a tab that's been up a while still draws the eye. A number that
// changes on the frame's per-minute clock: {#key} on it remounts the animation, no timer of its own.
export const REPLAY_MS = 5 * 60000;
// Outside the day it stays at the day's last value (not 0), so 10 PM itself doesn't replay once more.
export const replayBeat = (now) => {
  const h = now.getHours();
  if (h >= 6 && h < 22) return Math.floor(now.getTime() / REPLAY_MS);
  const last = new Date(now);
  if (h < 6) last.setDate(last.getDate() - 1);
  last.setHours(22, 0, 0, 0);
  return Math.floor((last.getTime() - 1) / REPLAY_MS);
};

// Today's numbers, and the last 7 days ending today (null where the phone sent nothing). A person
// whose phone hasn't sent today yet shows 0 against their latest goals.
export function view(p, now) {
  const days = p.days || [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const latest = days[days.length - 1] || {};
  const t = byDate.get(dayKey(now)) || { move: 0, exercise: 0, stand: 0, moveGoal: latest.moveGoal, exerciseGoal: latest.exerciseGoal, standGoal: latest.standGoal };
  const share = (v, goal) => (goal ? (v || 0) / goal : 0);
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(now, i - 6);
    const d = byDate.get(dayKey(date));
    // raw: that day's numbers as sent, for the day's bubble on the Fitness tab.
    return { date, raw: d || null, move: d ? share(d.move, d.moveGoal) : null, exercise: d ? share(d.exercise, d.exerciseGoal) : null, stand: d ? share(d.stand, d.standGoal) : null };
  });
  const updated = Date.parse(p.updated) || 0;
  return {
    ...p,
    today: { move: Math.round(t.move || 0), moveGoal: t.moveGoal || 0, exercise: Math.round(t.exercise || 0), exerciseGoal: t.exerciseGoal || 0, stand: Math.round(t.stand || 0), standGoal: t.standGoal || 0 },
    rings: { move: share(t.move, t.moveGoal), exercise: share(t.exercise, t.exerciseGoal), stand: share(t.stand, t.standGoal) },
    week,
    // No goals at all: the phone sent nothing for the rings (Health access off, or no Watch data yet).
    empty: !t.moveGoal && !t.exerciseGoal && !t.standGoal,
    // Sent today, with earlier days but none for today: the phone's Health hasn't had today's rings
    // from the Watch yet (a send from the iPhone's own steps first thing). Not zeros to fall behind
    // on. A phone that last sent before today isn't waiting on the Watch; it shows as old instead.
    waiting: !byDate.has(dayKey(now)) && days.length > 0 && !!p.updated && dayKey(new Date(p.updated)) === dayKey(now),
    stale: now.getTime() - updated > STALE_MS,
    trends: trends(days, byDate, now),
    // Weight against a goal, for those who share it (lib/weight.js); null otherwise.
    weight: weightView(p.weight, now),
  };
}

// The share of the day gone, 6 AM to 10 PM: how far along "by now" is.
const paceAt = (now) => Math.max(0.05, Math.min(1, (now.getHours() + now.getMinutes() / 60 - 6) / 16));

// What the Fitness card's chips say, from up to 4 weeks of days:
//   streak: days in a row with Move closed (to today if it's closed, else to yesterday), and with all
//     three closed; vs: today's steps and exercise against the usual (the 4 weeks' daily average)
//     scaled to the time of day, as a percentage up or down; workoutDays: days with a workout in the
//     4 weeks and today, out of how many days the phone sent.
export function trends(days, byDate, now) {
  // A Move goal of 0 (Move set in minutes, which HealthKit reports apart): judged on exercise and stand alone.
  // A day with no goals at all (no ring data that day) never counts as closed.
  const met = (v, goal) => goal > 0 && v != null && v >= goal;
  const moveDone = (d) => (d.moveGoal > 0 ? met(d.move, d.moveGoal) : met(d.exercise, d.exerciseGoal));
  const closed = (d, all) => !!d && moveDone(d) && (!all || (met(d.exercise, d.exerciseGoal) && met(d.stand, d.standGoal)));
  const streak = (all) => {
    let n = 0, i = closed(byDate.get(dayKey(now)), all) ? 0 : 1;
    while (closed(byDate.get(dayKey(addDays(now, -i))), all)) { n++; i++; }
    return n;
  };
  const before = days.filter((d) => d.date < dayKey(now));
  const avg = (key) => { const v = before.map((d) => d[key]).filter((x) => x != null); return v.length >= 7 ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const today = byDate.get(dayKey(now)) || {};
  const pace = paceAt(now);
  // Before about 8:30 there's too little of the day to compare.
  const vs = (key) => { const a = avg(key); return a && pace >= 0.15 && today[key] != null ? Math.round(((today[key] / (a * pace)) - 1) * 100) : null; };
  const recent = days.filter((d) => d.workoutMinutes != null);
  return {
    moveStreak: streak(false), allStreak: streak(true),
    steps: vs('steps'), exercise: vs('exercise'),
    workoutDays: recent.filter((d) => d.workoutMinutes > 0).length, workoutOf: recent.length,
  };
}

// Distance in the phone's unit, e.g. "1.4 mi".
export function distance(meters, unit) {
  if (meters == null) return '';
  const v = unit === 'km' ? meters / 1000 : meters / 1609.344;
  return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' ' + (unit === 'km' ? 'km' : 'mi');
}

// How far along a ring usually is by now, as a share of its goal: the middle of the last 4 weeks of
// this weekday at each hour's end (usual, from the phone: ios/KitchenFrame/Fitness.swift), between the
// hours. Without it (an older app, or too few of this weekday), a straight line from 6 AM to 10 PM.
export function usualBy(usual, ring, now) {
  const u = Array.isArray(usual) && usual[now.getDay()] && usual[now.getDay()][ring];
  const h = now.getHours(), f = now.getMinutes() / 60;
  if (!Array.isArray(u) || u.length !== 24) return Math.max(0.05, Math.min(1, (h + f - 6) / 16));
  const a = h ? u[h - 1] : 0;
  return a + (u[h] - a) * f;
}

// What's left today, against where each ring usually is by this time of day: a headline (all closed,
// not started, ahead, on track, or the ring furthest behind) and what each open ring still needs,
// short enough for one line. Behind means well short of the usual, not just short of it.
export function nudge(t, now, usual) {
  const rings = [
    { ring: 'move', name: 'Move', share: t.move / (t.moveGoal || 1), left: t.moveGoal - t.move, unit: 'kcal' },
    { ring: 'exercise', name: 'Exercise', share: t.exercise / (t.exerciseGoal || 1), left: t.exerciseGoal - t.exercise, unit: 'min' },
    { ring: 'stand', name: 'Stand', share: t.stand / (t.standGoal || 1), left: t.standGoal - t.stand, unit: 'hrs' },
  ].map((r) => ({ ...r, usual: usualBy(usual, r.ring, now) }));
  // A goal of 0 (Move set in minutes) isn't a ring to close here.
  const open = rings.filter((r) => r.left > 0 && (r.ring !== 'move' || t.moveGoal > 0));
  if (!open.length) return { done: true, headline: t.moveGoal > 0 ? 'All three rings closed' : 'Rings closed', left: [] };
  const left = open.map((r) => ({ ring: r.ring, text: r.left + ' ' + (r.unit === 'hrs' && r.left === 1 ? 'hr' : r.unit) }));
  // Nothing at all yet: the Watch isn't on, or only just. Not behind.
  if (!t.move && !t.exercise && !t.stand) return { ring: null, headline: 'Not started', idle: true, left };
  const behind = open.filter((r) => r.share < r.usual * 0.8 && r.usual - r.share >= 0.1).sort((a, b) => (a.share - a.usual) - (b.share - b.usual))[0];
  const ahead = !behind && open.every((r) => r.usual >= 0.1 && r.share >= r.usual * 1.2);
  return { ring: behind ? behind.ring : null, ahead, headline: behind ? 'Behind on ' + behind.name : ahead ? 'Ahead' : 'On track', left };
}

// Two invented people, in the shape the Worker sends, with today's numbers built from the time of
// day so the rings fill as the day goes.
export function demoFitness(now) {
  const h = now.getHours() + now.getMinutes() / 60;
  const day = Math.max(0, Math.min(1, (h - 6) / 16)); // share of a 6 AM to 10 PM day gone
  const stood = Math.max(0, Math.min(12, Math.floor(h - 7)));
  const at = (days, hh, mm = 0) => { const d = addDays(now, days); d.setHours(hh, mm, 0, 0); return d.toISOString(); };
  // 4 weeks of invented days, the last few all closed (so there's a streak to show).
  const past = (seed, goals) => Array.from({ length: 28 }, (_, i) => {
    const r = (k) => (i >= 24 ? 1.05 + ((seed + i + k) % 3) / 10 : Math.min(1.3, 0.45 + (((seed * 7 + i * 13 + k * 5) % 11) / 10)));
    return { date: dayKey(addDays(now, i - 28)), move: Math.round(goals[0] * r(1)), moveGoal: goals[0], exercise: Math.round(goals[1] * r(2)), exerciseGoal: goals[1], stand: Math.min(24, Math.round(goals[2] * r(3))), standGoal: goals[2],
      steps: Math.round(5200 + ((seed * 31 + i * 17) % 9) * 450), workoutMinutes: (seed + i) % 3 === 0 ? 0 : 20 + ((seed + i) % 4) * 9 };
  });
  const updated = new Date(now.getTime() - 20 * 60000).toISOString();
  const dataAt = new Date(now.getTime() - 26 * 60000).toISOString();
  const steps = (base, per) => Math.round(base + day * per);
  // A usual day: a morning workout, then a steady afternoon (shares of each goal by each hour's end).
  const day1 = { move: [], exercise: [], stand: [] };
  for (let hr = 0; hr < 24; hr++) {
    const d = Math.max(0, Math.min(1, (hr + 1 - 7) / 14));
    day1.move.push(Math.round(Math.min(1.1, d * 0.8 + (hr >= 7 ? 0.25 : 0)) * 100) / 100);
    day1.exercise.push(Math.round(Math.min(1.1, d * 0.4 + (hr >= 7 ? 0.7 : 0)) * 100) / 100);
    day1.stand.push(Math.round(Math.min(1, Math.max(0, hr - 6) / 12) * 100) / 100);
  }
  const usual = Array(7).fill(day1);
  return [
    {
      id: 'demo-alex', name: 'Alex', updated, dataAt, unit: 'mi', steps: steps(1200, 9800), meters: Math.round(steps(1200, 9800) * 0.75), weight: demoWeight(now), usual,
      days: [...past(1, [600, 30, 12]), { date: dayKey(now), move: Math.round(620 * Math.min(1.15, day * 1.25 + 0.18)), moveGoal: 600, exercise: Math.round(Math.min(48, 6 + day * 52)), exerciseGoal: 30, stand: Math.max(stood - 1, 0), standGoal: 12, steps: steps(1200, 9800), workoutMinutes: 42 }],
      workouts: [
        { type: 'Strength training', kind: 'strength', start: at(0, 6, 10), minutes: 42.2, kcal: 286, totalKcal: 362, effort: 6, heartRate: 118 },
        { type: 'Outdoor run', kind: 'run', start: at(-1, 18, 5), minutes: 31.4, kcal: 344, totalKcal: 401, meters: 5200, climbMeters: 41, effort: 7, tempC: 18, humidity: 62, heartRate: 151 },
        { type: 'Outdoor cycle', kind: 'bike', start: at(-3, 7, 0), minutes: 55, kcal: 402, totalKcal: 488, meters: 21400, climbMeters: 160, effort: 5, tempC: 12, humidity: 70 },
      ],
    },
    {
      id: 'demo-sam', name: 'Sam', updated, dataAt, usual, unit: 'mi', steps: steps(600, 7400), meters: Math.round(steps(600, 7400) * 0.7),
      days: [...past(4, [480, 30, 12]), { date: dayKey(now), move: Math.round(480 * Math.min(1, day * 0.9 + 0.05)), moveGoal: 480, exercise: Math.round(Math.min(30, day * 22)), exerciseGoal: 30, stand: stood, standGoal: 12, steps: steps(600, 7400), workoutMinutes: 0 }],
      workouts: [
        { type: 'Yoga', kind: 'yoga', start: at(-1, 19, 30), minutes: 35, kcal: 118, totalKcal: 168, effort: 3 },
        { type: 'Outdoor walk', kind: 'walk', start: at(-2, 12, 15), minutes: 48.3, kcal: 196, totalKcal: 262, meters: 4100, climbMeters: 22, effort: 2, tempC: 21, humidity: 48 },
        { type: 'Pool swim', kind: 'swim', start: at(-4, 17, 45), minutes: 30, kcal: 251, totalKcal: 290, meters: 1200, effort: 5 },
      ],
    },
  ];
}
