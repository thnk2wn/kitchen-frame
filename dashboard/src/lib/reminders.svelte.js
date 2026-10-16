// Event reminders, said out loud (Settings → Announcements → Event reminders): for each calendar
// switched on, a timed event is announced before it starts, at each of its own reminders when it has
// them (0-120 minutes before, from the feed or the Mac bridge; worker/calendar.js) and they're
// preferred, else once at the lead time chosen (30 minutes to start):
// "In 30 minutes: Swim lesson, at the Aquatic center."
//
// Each reminder is said once (remembered across reloads), not during night or quiet hours, and only
// while Announcements is on. The frame does the timing, so nothing is said while it's off; a
// reminder up to 10 minutes late (a reload, a blip) is still said if the event hasn't started.
import { calendar, calendarNames } from './state.svelte.js';
import { say, speak } from './announce.svelte.js';
import { quietNow } from './night.svelte.js';

const MIN = 60000;
const LATE_MS = 10 * MIN;
const DONE_KEY = 'frame-reminded';
const done = (() => { try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); } catch { return {}; } })();
const keyOf = (e, minutes) => e.uid + '|' + e.start + '|' + minutes;

// Whether reminders are on for this event's calendar (by name, so it survives feeds being reordered).
export const remindsFor = (cal) => !!say.reminders.cals[calendarNames()[cal]];

// When this event will be announced, or null: { all: minutes before for each (longest first),
// minutes: the first of them, own: its own reminders }.
export function reminderFor(e) {
  if (!e || e.allDay || e.holiday || !say.on || !remindsFor(e.cal)) return null;
  const mine = Array.isArray(e.alarms) && e.alarms.length ? e.alarms : e.alarm != null ? [e.alarm] : [];
  const own = say.reminders.own && mine.length > 0;
  const all = own ? mine : [say.reminders.lead];
  return { all, minutes: all[0], own };
}

const clean = (t) => String(t || '').replace(/\p{Extended_Pictographic}|️|‍/gu, '').replace(/\s+/g, ' ').trim();
export function sentence(e, now = Date.now()) {
  const mins = Math.round((Date.parse(e.start) - now) / MIN);
  const when = mins <= 1 ? 'Starting now' : mins < 60 ? 'In ' + mins + ' minutes'
    : mins % 60 === 0 ? 'In ' + (mins / 60 === 1 ? 'an hour' : mins / 60 + ' hours') : 'In ' + Math.floor(mins / 60) + ' hour' + (mins >= 120 ? 's' : '') + ' ' + (mins % 60) + ' minutes';
  const where = e.location === 'Video call' ? ', a video call' : e.location ? ', at ' + clean(e.location).split(',')[0] : '';
  return when + ': ' + clean(e.title) + where + '.';
}

function check() {
  // All calendars, including any hidden from this frame's display.
  const events = (calendar.raw || calendar.data || {}).events;
  if (!events || !say.on || quietNow()) return;
  const now = Date.now();
  for (const e of events) {
    const r = reminderFor(e);
    if (!r) continue;
    const start = Date.parse(e.start);
    if (now >= start) continue;
    // The latest reminder now due (15 and 5 minutes before, at 6 minutes: the 15 is past), said once;
    // any earlier one missed (the frame was off) is let go rather than said back to back.
    const due = r.all.filter((m) => now >= start - m * MIN && now - (start - m * MIN) <= LATE_MS);
    if (!due.length) continue;
    const m = Math.min(...due), k = keyOf(e, m);
    if (done[k]) continue;
    for (const d of due) done[keyOf(e, d)] = now; // claimed before speaking, so the next check can't repeat it
    speak(sentence(e, now), { kind: 'reminder' }).then((ok) => { if (!ok) delete done[k]; }, () => delete done[k]).finally(save);
  }
}
function save() {
  const cutoff = Date.now() - 3 * 24 * 60 * MIN;
  for (const k of Object.keys(done)) if (done[k] < cutoff) delete done[k];
  try { localStorage.setItem(DONE_KEY, JSON.stringify(done)); } catch {}
}

export function startReminders() {
  setTimeout(check, 15000); // once Home Assistant has had a moment to connect
  setInterval(check, 30000);
}
