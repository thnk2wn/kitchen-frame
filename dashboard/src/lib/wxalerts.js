// Weather Service alerts (worker/weather.js): which are still in effect, how one is said, and which to
// say now (Settings → Announcements → Weather alerts). Plain functions, tested in wxalerts.test.js;
// lib/alerts.svelte.js does the speaking.
import { time, dow, dayKey } from './format.js';

// Gone the minute it ends, not at the next weather fetch (every 15 min, cached 5 more).
export const activeAlerts = (alerts, now = Date.now()) => (alerts || []).filter((a) => !a.ends || Date.parse(a.ends) > now);

// Warnings (tornado, severe thunderstorm, flash flood) are Severe or Extreme; statements, advisories
// and most watches are Moderate or Minor.
export const isWarning = (a) => a.severity === 'Severe' || a.severity === 'Extreme';

export const alertKey = (a) => 'wx:' + (a.id || a.event + '|' + a.ends);

// "until 9:00 AM", or "until Fri 9:00 AM" when it ends another day.
export const until = (t, now = Date.now()) => (t ? 'until ' + (dayKey(new Date(t)) === dayKey(new Date(now)) ? '' : dow(dayKey(new Date(t))) + ' ') + time(new Date(t)) : '');

// The Weather Service hard-wraps its text at about 70 characters: join those lines, keep paragraphs.
export const unwrap = (t) => (t || '').replace(/([^\n])\n(?!\n)/g, '$1 ');

// Said on its own: the alert, how long, and its first sentence ("* WHAT..." bullets dropped).
export function spoken(a, now = Date.now()) {
  const first = unwrap(a.text).split('\n\n')[0].replace(/^\*\s*\w+\.{3}/, '').trim();
  const sentence = (/^.*?[.!?](?=\s|$)/.exec(first) || [first])[0];
  return ['Weather: ' + a.event + (a.ends ? ' ' + until(a.ends, now) : '') + '.', sentence].filter(Boolean).join(' ');
}

// What to say now. mode: 'off' | 'warnings' | 'all'. A warning is said day or night; anything else
// waits out quiet hours and is said when they end, if it's still in effect. said: alertKey -> when.
export function toSay(alerts, { mode, quiet, said, now = Date.now() }) {
  if (mode !== 'warnings' && mode !== 'all') return [];
  return activeAlerts(alerts, now).filter((a) => (mode === 'all' || isWarning(a)) && !said[alertKey(a)] && (isWarning(a) || !quiet));
}
