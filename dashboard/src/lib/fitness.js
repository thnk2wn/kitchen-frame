// Activity rings (move, exercise, stand) and recent workouts per person. A mockup on demo data for now:
// the real numbers would come from each person's iPhone (HealthKit, or a Shortcut) through the Worker.
import { addDays } from './format.js';

export const RING_COLORS = { move: '#fa114f', exercise: '#a6ff00', stand: '#00f0ff' };
// The same rings on a light background: the bright originals wash out on white.
export const RING_COLORS_LIGHT = { move: '#f2003c', exercise: '#5fc700', stand: '#00b9cc' };

// Two invented people, numbers built from the time of day so the rings fill as the day goes.
export function demoFitness(now) {
  const h = now.getHours() + now.getMinutes() / 60;
  const day = Math.max(0, Math.min(1, (h - 6) / 16)); // share of a 6 AM to 10 PM day gone
  const stood = Math.max(0, Math.min(12, Math.floor(h - 7)));
  const week = (seed) => Array.from({ length: 7 }, (_, i) => {
    const r = (k) => Math.min(1.3, 0.45 + (((seed * 7 + i * 13 + k * 5) % 11) / 10));
    return { date: addDays(now, i - 6), move: i === 6 ? null : r(1), exercise: i === 6 ? null : r(2), stand: i === 6 ? null : r(3) };
  });
  const at = (days, hh, mm = 0) => { const d = addDays(now, days); d.setHours(hh, mm, 0, 0); return d; };
  const people = [
    {
      name: 'Alex',
      move: Math.round(620 * Math.min(1.15, day * 1.25 + 0.18)), moveGoal: 600,
      exercise: Math.round(Math.min(48, 6 + day * 52)), exerciseGoal: 30,
      stand: Math.max(stood - 1, 0), standGoal: 12,
      workouts: [
        { type: 'Strength training', icon: 'dumbbell', start: at(0, 6, 10), minutes: 42, kcal: 286 },
        { type: 'Outdoor run', icon: 'run', start: at(-1, 18, 5), minutes: 31, kcal: 344, km: 5.2 },
        { type: 'Cycling', icon: 'bike', start: at(-3, 7, 0), minutes: 55, kcal: 402, km: 21.4 },
      ],
      seed: 1,
    },
    {
      name: 'Sam',
      move: Math.round(480 * Math.min(1, day * 0.9 + 0.05)), moveGoal: 480,
      exercise: Math.round(Math.min(30, day * 22)), exerciseGoal: 30,
      stand: stood, standGoal: 12,
      workouts: [
        { type: 'Yoga', icon: 'yoga', start: at(-1, 19, 30), minutes: 35, kcal: 118 },
        { type: 'Outdoor walk', icon: 'run', start: at(-2, 12, 15), minutes: 48, kcal: 196, km: 4.1 },
        { type: 'Pool swim', icon: 'swim', start: at(-4, 17, 45), minutes: 30, kcal: 251 },
      ],
      seed: 4,
    },
  ];
  return people.map((p) => {
    const w = week(p.seed);
    w[6] = { date: now, move: p.move / p.moveGoal, exercise: p.exercise / p.exerciseGoal, stand: p.stand / p.standGoal };
    return { ...p, week: w };
  });
}

// What's left today, against how far through the day it is (6 AM to 10 PM): a headline (all closed,
// on track, or the ring furthest behind) and what each open ring still needs, short enough for one line.
export function nudge(p, now) {
  const h = now.getHours() + now.getMinutes() / 60;
  const pace = Math.max(0.05, Math.min(1, (h - 6) / 16));
  const rings = [
    { ring: 'move', name: 'Move', share: p.move / p.moveGoal, left: p.moveGoal - p.move, unit: 'kcal' },
    { ring: 'exercise', name: 'Exercise', share: p.exercise / p.exerciseGoal, left: p.exerciseGoal - p.exercise, unit: 'min' },
    { ring: 'stand', name: 'Stand', share: p.stand / p.standGoal, left: p.standGoal - p.stand, unit: 'hrs' },
  ];
  const open = rings.filter((r) => r.left > 0);
  if (!open.length) return { done: true, headline: 'All three rings closed', left: [] };
  const behind = open.filter((r) => r.share < pace * 0.8).sort((a, b) => a.share - b.share)[0];
  return {
    ring: behind ? behind.ring : null,
    headline: behind ? 'Behind on ' + behind.name : 'On track',
    left: open.map((r) => ({ ring: r.ring, text: r.left + ' ' + r.unit })),
  };
}
