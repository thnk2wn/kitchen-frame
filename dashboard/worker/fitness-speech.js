// What Alexa says for "how's my fitness" (alexa.js FitnessIntent): each sharing person's rings today,
// the past week and recent workouts (worker/fitness.js), as a short spoken summary from Workers AI,
// or the same facts read out plainly when the model is slow, out of allowance or says nothing usable.
// The facts are worked out here; the model only words them, so it can't invent numbers.
import { view, nudge } from '../src/lib/fitness.js';
import { MODEL, aiError } from './meal-groceries.js';

const CACHE = 'fitness-speech:';   // the same facts within half an hour say the same thing
const CACHE_TTL = 30 * 60;
const AI_WAIT_MS = 4500;           // Alexa allows about 8 seconds for the whole answer

// people: what the phones sent; wall: now as the household's wall clock (alexa.js wallClock), so
// "today" is their day, not UTC's; tz for naming workout days.
export function fitnessFacts(people, wall, tz, now = new Date()) {
  const dayName = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(iso));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(now - 864e5));
  return people.map((p) => view(p, wall)).filter((v) => !v.empty).map((v) => {
    const n = nudge(v.today, wall, v.usual);
    const past = v.week.slice(0, 6).filter((d) => d.move != null);
    return {
      name: v.name,
      hour: wall.getHours(),
      minutesOld: Math.max(0, Math.round((now - Date.parse(v.updated)) / 60000)),
      today: v.waiting ? null : v.today,
      // waiting: the phone sent before its Health had today's rings from the Watch; today's numbers aren't known.
      waiting: v.waiting,
      status: v.waiting ? 'waiting for today\'s rings from the Watch' : n.done ? 'all three rings closed' : n.idle ? 'not started yet' : n.ring ? 'behind on ' + n.ring : n.ahead ? 'ahead of usual' : 'on track',
      left: v.waiting ? [] : n.left.map((l) => l.ring + ' ' + l.text),
      pastDays: past.length,
      allClosedDays: past.filter((d) => d.move >= 1 && d.exercise >= 1 && d.stand >= 1).length,
      moveClosedDays: past.filter((d) => d.move >= 1).length,
      exerciseClosedDays: past.filter((d) => d.exercise >= 1).length,
      steps: v.steps == null ? null : Math.round(v.steps),
      // From the 4 weeks the phone sends (lib/fitness.js trends()): streaks, today against the usual
      // by this time of day (percent), and days with a workout.
      moveStreak: v.trends.moveStreak, allRingsStreak: v.trends.allStreak,
      stepsVsUsual: v.trends.steps, exerciseVsUsual: v.trends.exercise,
      workoutDays: v.trends.workoutDays, workoutDaysOf: v.trends.workoutOf,
      workouts: (v.workouts || []).slice(0, 3).map((w) => {
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(w.start));
        // effort: Apple's scale in words (1-3 easy, 4-6 moderate, 7-8 hard, 9-10 all out), when there is one.
        const effort = w.effort == null ? undefined : w.effort <= 3 ? 'easy' : w.effort <= 6 ? 'moderate' : w.effort <= 8 ? 'hard' : 'all out';
        return { type: w.type.toLowerCase(), minutes: Math.round(w.minutes || 0), effort, when: day === today ? 'today' : day === yesterday ? 'yesterday' : 'on ' + dayName(w.start) };
      }),
    };
  });
}

const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

// The facts read out, for when the model isn't used.
export function plainSpeech(facts) {
  if (!facts.length) return 'No one is sharing their fitness with the frame yet. Turn it on in the Kitchen Frame app, under Settings.';
  const one = facts.length === 1;
  return facts.map((f) => {
    const t = f.today;
    const who = one ? 'You\'re' : f.name + ' is';
    const status = f.status === 'all three rings closed' ? (one ? 'You\'ve' : f.name + ' has') + ' closed all three rings today.'
      : f.status === 'not started yet' ? (one ? 'You haven\'t' : f.name + ' hasn\'t') + ' started moving yet today.'
      : f.status === 'on track' ? who + ' on track today.' : who + ' ' + f.status + ' today.';
    const parts = f.waiting ? [(one ? 'Your' : f.name + '\'s') + ' rings for today haven\'t come from the Watch yet.'] : [status,
      'Move ' + t.move + ' of ' + t.moveGoal + ' calories, exercise ' + t.exercise + ' of ' + plural(t.exerciseGoal, 'minute') + ', stand ' + t.stand + ' of ' + plural(t.standGoal, 'hour') + '.'];
    if (f.allRingsStreak >= 2) parts.push((one ? 'You\'re' : f.name + ' is') + ' on a ' + f.allRingsStreak + '-day streak of closing all three rings.');
    else if (f.moveStreak >= 2) parts.push((one ? 'You\'re' : f.name + ' is') + ' on a ' + f.moveStreak + '-day Move streak.');
    else if (f.pastDays) parts.push('All three rings closed on ' + f.allClosedDays + ' of the last ' + plural(f.pastDays, 'day') + '.');
    const w = f.workouts[0];
    if (w) parts.push('Last workout: ' + (w.effort ? (w.effort === 'easy' || w.effort === 'all out' ? 'an ' : 'a ') + w.effort + ' ' : '') + w.type + ' ' + w.when + ', ' + plural(w.minutes, 'minute') + '.');
    if (f.minutesOld > 180) parts.push('These numbers are from ' + plural(Math.round(f.minutesOld / 60), 'hour') + ' ago.');
    return parts.join(' ');
  }).join(' ');
}

function prompt(facts) {
  return [
    { role: 'system', content: [
      'You speak through Alexa on a family kitchen display. Summarise each person\'s Apple Watch activity.',
      'Rules: plain spoken English, no markdown, lists or emoji. Use only the facts given; never invent numbers.',
      'For each person: say how today is going (status and what is left), one pattern from the past days, the latest workout if any,',
      'and one small practical suggestion for the rest of today when a ring is open and it is before 9 PM (like a 10 minute walk).',
      'Warm and encouraging, never guilt or shame, no medical or diet advice. About 3 sentences per person, under 70 words each.',
      facts.length === 1 ? 'There is one person: talk to them as "you".' : 'Name each person.',
      'Calories are active calories. hour is the local hour (24h). minutesOld over 180 means the numbers may be out of date: say so briefly.',
    ].join(' ') },
    { role: 'user', content: JSON.stringify(facts) + '\n/no_think' },
  ];
}

// The model's answer cleaned for speech, or null when it isn't usable.
export function cleanSpeech(text) {
  const s = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim();
  return s.length >= 20 && s.length <= 1200 ? s : null;
}

async function hash(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// The spoken summary: the model's (cached for half an hour per set of facts), else the plain one.
// Returns { speech, source: 'ai' | 'cache' | 'plain', problem? } for the Alexa log.
export async function fitnessSpeech(env, facts) {
  if (!facts.length || !env.AI) return { speech: plainSpeech(facts), source: 'plain' };
  // minutesOld changes every minute; only whether the numbers are old matters to what's said.
  const key = CACHE + await hash(JSON.stringify(facts.map((f) => ({ ...f, minutesOld: f.minutesOld > 180 }))));
  const cached = await env.CALENDAR.get(key).catch(() => null);
  if (cached) return { speech: cached, source: 'cache' };
  try {
    const res = await Promise.race([
      env.AI.run(MODEL, { messages: prompt(facts), max_tokens: 400, temperature: 0.4 }),
      new Promise((_, no) => setTimeout(() => no(new Error('the model took too long')), AI_WAIT_MS)),
    ]);
    const text = typeof res === 'string' ? res : res?.response ?? res?.choices?.[0]?.message?.content ?? '';
    const speech = cleanSpeech(text);
    if (!speech) return { speech: plainSpeech(facts), source: 'plain', problem: 'the model gave no usable answer' };
    await env.CALENDAR.put(key, speech, { expirationTtl: CACHE_TTL }).catch(() => {});
    return { speech, source: 'ai' };
  } catch (e) {
    return { speech: plainSpeech(facts), source: 'plain', problem: aiError(e) };
  }
}
