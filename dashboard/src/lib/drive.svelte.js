// The drive to an event, with traffic (the Worker's /api/drive, Google's Routes API): for events
// with a place on calendars set to in CALENDAR_DRIVE, and only those that can open (the place text
// leaves the Worker only for them). Asked for when an event's details open, and on Home for the
// events it lists: again every 12 hours, and every 10 minutes from two hours before one starts. The
// Worker keeps each answer for the same time and shares it with every screen and reload, so a busy
// day is about 70 Routes calls, under its daily allowance (worker/maps.js GOOGLE_CAPS).
import { api } from './api.js';
import { calendar, canOpen, ui } from './state.svelte.js';

const FRESH_MS = 10 * 60000, FRESH_LATER_MS = 12 * 3600000;
export const SOON_MS = 2 * 3600000;
// A trip that's usually longer than this is an away game or a holiday, not a drive to time.
const MAX_USUAL = 120;

// key -> { minutes, usual } or null (not found, or too far); only what's been asked for this run.
export const drives = $state({});
const asked = new Map(); // key -> when

const keyOf = (e) => e.location + '|' + e.start;

export const drivable = (e) => !!(e && e.location && e.location !== 'Video call' && !e.allDay && !ui.demo
  && calendar.raw && calendar.raw.drive && calendar.raw.drive[e.cal] && canOpen(e));

// The drive for an event, once known: { minutes, usual, leave: Date } or null.
export function driveOf(e) {
  const d = e && drives[keyOf(e)];
  return d ? { ...d, leave: new Date(Date.parse(e.start) - d.minutes * 60000) } : null;
}

// Asks the Worker, unless asked lately (see above) or the event has started.
export function loadDrive(e, now = Date.now()) {
  const start = Date.parse(e && e.start);
  if (!drivable(e) || start <= now) return;
  const key = keyOf(e);
  if (now - (asked.get(key) || 0) < (start - now > SOON_MS ? FRESH_LATER_MS : FRESH_MS)) return;
  asked.set(key, now);
  api('/api/drive?q=' + encodeURIComponent(e.location) + '&at=' + encodeURIComponent(e.start)).then((r) => {
    const d = r && r.drive;
    // No answer this time (an error, the allowance used up) keeps the last good one.
    if (!d && drives[key]) return;
    drives[key] = d && d.usual <= MAX_USUAL ? { minutes: d.minutes, usual: d.usual } : null;
  }).catch(() => asked.delete(key));
}

// "Leave in 25 min", "Leave in 1 h 5 min", "Leave now".
export function leaveIn(leave, now) {
  const m = Math.ceil((leave.getTime() - now.getTime()) / 60000);
  if (m <= 0) return 'Leave now';
  return 'Leave in ' + (m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min');
}
