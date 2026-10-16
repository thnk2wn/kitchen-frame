// Turns iCal feeds (Google secret address, iCloud public link), and calendars the Mac bridge sends,
// into one small, sorted event list.
// Pure functions, no Worker APIs, so it runs under `node --test` too.
import ICAL from 'ical.js';

const DAY = 864e5;
// Events kept off the frame: "#private" anywhere in the title or notes (say, a surprise in a
// personal calendar that is published for the frame), or marked Private/Confidential in the app.
const PRIVATE_TAG = /#private\b/i;
export function isPrivate(comp) {
  const cls = String(comp.getFirstPropertyValue('class') || '').toUpperCase();
  if (cls === 'PRIVATE' || cls === 'CONFIDENTIAL') return true;
  return PRIVATE_TAG.test(String(comp.getFirstPropertyValue('summary') || '')) ||
    PRIVATE_TAG.test(String(comp.getFirstPropertyValue('description') || ''));
}
const MAX_OCCURRENCES = 20000; // per recurring event; a daily event from 1990 is ~13,000

// Cron runs get 10 ms of CPU on the Workers Free plan, and a Google feed holds every event ever
// made. Full-parsing that is far too slow, so first drop one-off events outside the window with a
// cheap string scan. Recurring events and their exceptions are always kept.
export function prefilter(text, from, to) {
  text = text.replace(/\r?\n[ \t]/g, ''); // unfold continuation lines
  const lo = ymd(from - 2 * DAY), hi = ymd(to + 2 * DAY);
  const out = ['BEGIN:VCALENDAR'];
  const calTz = /\nX-WR-TIMEZONE:([^\r\n]+)/.exec(text);
  if (calTz) out.push('X-WR-TIMEZONE:' + calTz[1]);
  for (const tz of text.match(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE/g) || []) out.push(tz);
  let i = 0;
  while ((i = text.indexOf('BEGIN:VEVENT', i)) !== -1) {
    const end = text.indexOf('END:VEVENT', i);
    if (end === -1) break;
    const ev = text.slice(i, end + 10);
    i = end + 10;
    if (/\n(RRULE|RDATE|RECURRENCE-ID)[;:]/.test(ev) || /\nDURATION[;:]/.test(ev)) { out.push(ev); continue; }
    const s = /\nDTSTART[^:\r\n]*:(\d{8})/.exec(ev);
    if (!s) continue;
    const e = /\nDTEND[^:\r\n]*:(\d{8})/.exec(ev);
    if ((e ? e[1] : s[1]) >= lo && s[1] <= hi) out.push(ev);
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n');
}

// Expand one feed into events overlapping [from, to). `fallbackTz` covers floating times.
// `notes`: keep each event's description (cleaned up) for the frame's event details. Off unless
// the calendar is allowed to show details (CALENDAR_DETAILS), so nothing else is ever kept.
export function expand(text, cal, from, to, fallbackTz = 'UTC', { notes = false } = {}) {
  const root = new ICAL.Component(ICAL.parse(prefilter(text, from, to)));
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);
  const calTz = root.getFirstPropertyValue('x-wr-timezone');
  const tzFor = (comp, prop) => comp.getFirstProperty(prop)?.getParameter('tzid') || calTz || fallbackTz;

  const events = [];
  const masters = [];
  const overridden = new Map(); // uid -> Set of instance keys replaced by an exception

  function emit(comp, uid, start, end, startTz) {
    if (String(comp.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED') return;
    if (isPrivate(comp)) return;
    const ev = toEvent(comp, uid, cal, start, end, startTz, notes);
    if (ev.endMs > from && ev.startMs < to) events.push(ev);
  }

  for (const comp of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(comp);
    const uid = event.uid || Math.random().toString(36);
    if (comp.hasProperty('recurrence-id')) {
      const rid = comp.getFirstPropertyValue('recurrence-id');
      if (!overridden.has(uid)) overridden.set(uid, new Set());
      overridden.get(uid).add(instanceKey(rid, tzFor(comp, 'recurrence-id')));
      emit(comp, uid, event.startDate, event.endDate, tzFor(comp, 'dtstart'));
    } else if (event.isRecurring()) {
      masters.push(event);
    } else {
      emit(comp, uid, event.startDate, event.endDate, tzFor(comp, 'dtstart'));
    }
  }

  for (const event of masters) {
    const comp = event.component, uid = event.uid, tz = tzFor(comp, 'dtstart');
    const skip = overridden.get(uid);
    const dur = utcMs(event.endDate, tz) - utcMs(event.startDate, tz);
    const it = event.iterator(fastForward(event, from - dur));
    let occ, n = 0;
    while ((occ = it.next()) && n++ < MAX_OCCURRENCES) {
      const naive = Date.UTC(occ.year, occ.month - 1, occ.day, occ.hour, occ.minute, occ.second);
      if (naive > to + DAY) break;
      if (naive + dur < from - DAY) continue;
      if (skip && skip.has(instanceKey(occ, tz))) continue;
      const end = occ.clone();
      end.addDuration(event.duration);
      emit(comp, uid, occ, end, tz);
    }
  }
  return events;
}

// Merge feeds: drop duplicates (the same invite on both calendars), sort, strip sort keys.
export function merge(lists) {
  const seen = new Set(), out = [];
  for (const ev of lists.flat()) {
    const key = ev.uid + '|' + ev.start;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  out.sort((a, b) => a.startMs - b.startMs || a.cal - b.cal || a.title.localeCompare(b.title));
  return out.map(({ startMs, endMs, ...ev }) => ev);
}

// ical.js walks a rule from DTSTART, so a daily event from years ago costs thousands of steps.
// For rules without COUNT, start the walk at the last whole interval before the window instead:
// same phase, same weekdays, same results. Skipped when the shifted date could overflow the
// month (day 29+) and for multiple RRULEs.
function fastForward(event, from) {
  const rules = event.component.getAllProperties('rrule');
  if (rules.length !== 1) return undefined;
  const rule = rules[0].getFirstValue(), interval = rule.interval || 1;
  if (rule.count) return undefined;
  const s = event.startDate, f = new Date(from - 2 * DAY);
  const start = s.clone();
  if (rule.freq === 'DAILY' || rule.freq === 'WEEKLY') {
    const stepDays = (rule.freq === 'DAILY' ? 1 : 7) * interval;
    const steps = Math.floor((f - Date.UTC(s.year, s.month - 1, s.day)) / (stepDays * DAY));
    if (steps <= 0) return undefined;
    start.adjust(steps * stepDays, 0, 0, 0);
  } else if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
    if (s.day > 28) return undefined;
    const unit = rule.freq === 'MONTHLY' ? interval : 12 * interval;
    const months = (f.getUTCFullYear() - s.year) * 12 + f.getUTCMonth() - (s.month - 1) - 1;
    const steps = Math.floor(months / unit);
    if (steps <= 0) return undefined;
    const total = s.year * 12 + s.month - 1 + steps * unit;
    start.year = Math.floor(total / 12);
    start.month = (total % 12) + 1;
  } else {
    return undefined;
  }
  return start;
}

function toEvent(comp, uid, cal, start, end, tz, withNotes) {
  const allDay = start.isDate;
  const startMs = utcMs(start, tz), endMs = Math.max(utcMs(end, tz), startMs);
  const location = comp.getFirstPropertyValue('location');
  const title = String(comp.getFirstPropertyValue('summary') || '(No title)');
  const notes = withNotes ? cleanNotes(comp.getFirstPropertyValue('description'), title) : '';
  return {
    uid, cal, startMs, endMs, allDay, title,
    // All-day events stay as plain dates (end exclusive) so the frame shows them on its own day.
    start: allDay ? dateStr(start) : new Date(startMs).toISOString(),
    end: allDay ? dateStr(end) : new Date(endMs).toISOString(),
    ...(place(location) ? { location: place(location) } : {}),
    ...(notes ? { notes } : {}),
    ...alarmFields(allDay ? [] : alarmsOf(comp)),
  };
}

// alarms: every reminder to say, longest first; alarm: the longest (what older frames read).
const alarmFields = (list) => (list.length ? { alarm: list[0], alarms: list } : {});

// The event's own reminders, in minutes before it starts, for the frame's spoken reminders: each one
// between 0 and 2 hours before the start (a day-before reminder isn't something to say out loud in
// the kitchen), longest first, each once. Empty when it has none in that range.
export function alarmsOf(comp) {
  const out = [];
  for (const alarm of comp.getAllSubcomponents('valarm')) {
    const prop = alarm.getFirstProperty('trigger');
    if (!prop || String(prop.getParameter('related') || 'START').toUpperCase() !== 'START') continue;
    const value = prop.getFirstValue();
    if (!value || typeof value.toSeconds !== 'function') continue; // an absolute time: skip
    out.push(Math.round(-value.toSeconds() / 60));
  }
  return cleanAlarms(out);
}
export const cleanAlarms = (list) => [...new Set(list.filter((m) => Number.isInteger(m) && m >= 0 && m <= 120))].sort((a, b) => b - a);
// The longest of them (null for none), as the frame used to have.
export const alarmOf = (comp) => alarmsOf(comp)[0] ?? null;

// A calendar sent by the Mac bridge (bridge/mac/, EventKit) instead of read from a link: iCloud's
// public links leave out every alert, since an alert there belongs to the person, not the event. The
// Mac reads the calendar as you, alerts included, with repeats already expanded. Same events out as
// expand(): `cal` its index, kept to [from, to), private ones dropped, notes only when allowed.
export function fromBridge(list, cal, from, to, { notes = false } = {}) {
  const out = [];
  for (const b of Array.isArray(list) ? list : []) {
    if (!b || typeof b.uid !== 'string' || typeof b.start !== 'string' || typeof b.end !== 'string') continue;
    const title = String(b.title || '(No title)').slice(0, 300);
    if (PRIVATE_TAG.test(title) || PRIVATE_TAG.test(String(b.notes || ''))) continue;
    const allDay = b.allDay === true && /^\d{4}-\d{2}-\d{2}$/.test(b.start) && /^\d{4}-\d{2}-\d{2}$/.test(b.end);
    const startMs = Date.parse(b.start), endMs = Math.max(Date.parse(b.end), startMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > from && startMs < to)) continue;
    const text = notes ? cleanNotes(b.notes, title) : '';
    out.push({
      uid: b.uid.slice(0, 300), cal, startMs, endMs, allDay, title,
      start: allDay ? b.start : new Date(startMs).toISOString(),
      end: allDay ? b.end : new Date(endMs).toISOString(),
      ...(place(b.location) ? { location: place(b.location) } : {}),
      ...(text ? { notes: text } : {}),
      ...alarmFields(allDay ? [] : cleanAlarms(Array.isArray(b.alarms) ? b.alarms : [])),
    });
  }
  return out;
}

// An event's location as a place to show: links dropped (nothing on the frame can open them, and
// they'd go to the map lookup), so a Zoom or Teams link alone becomes "Video call", and one beside a
// room ("Room 4B; https://zoom.us/j/…") leaves just the room.
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const MEETING_RE = /zoom\.us|teams\.microsoft|teams\.live|meet\.google|webex\.com|gotomeet|whereby\.com|chime\.aws|bluejeans/i;
export function place(location) {
  const raw = String(location || '').trim();
  if (!raw) return '';
  const rest = raw.replace(URL_RE, ' ').replace(/\s*[;,|]\s*(?=[;,|]|$)/g, '').replace(/^[\s;,|·-]+|[\s;,|·-]+$/g, '').replace(/\s{2,}/g, ' ');
  if (rest && /\w/.test(rest) && !/^(?:microsoft teams meeting|zoom meeting|google meet|zoom)$/i.test(rest)) return rest;
  return MEETING_RE.test(raw) || /meeting|zoom|teams|meet/i.test(rest) ? 'Video call' : '';
}

// Event notes as plain text for the frame: HTML (Google, Outlook) turned into lines, links dropped
// (nothing on the frame can open them) along with lines left as a bare label ("Tickets:"), a first
// line that just repeats the title, and separator rules. Kept short.
export const NOTES_MAX = 1000;
export function cleanNotes(raw, title = '') {
  let t = String(raw || '');
  if (!t.trim()) return '';
  if (/<[a-z][^>]*>/i.test(t)) {
    t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
  }
  // A link runs to the end of its line: some feeds don't encode the spaces in theirs (a ticket link's
  // "utm_campaign=F26 vs Alabama"), so stopping at a space would leave half of it behind.
  const lines = t.replace(/\r/g, '').split('\n').map((l) => l.replace(/<?(https?:\/\/|mailto:|tel:)\S.*$/i, '').replace(/[ \t]+/g, ' ').trim());
  const out = [];
  for (const l of lines) {
    if (/^[-_=~:*.•\s]{3,}$/.test(l) || /^[^:]{1,40}:$/.test(l)) continue;
    if (!out.length && !l) continue;
    if (!out.length && l.toLowerCase() === title.trim().toLowerCase()) continue;
    if (!l && !out[out.length - 1]) continue;
    out.push(l);
  }
  const text = out.join('\n').trim();
  return text.length > NOTES_MAX ? text.slice(0, NOTES_MAX - 1).trimEnd() + '…' : text;
}

// Notes move out of the events into one map by uid, so a weekly event's notes are stored once.
export function splitNotes(events) {
  const notes = {};
  for (const e of events) {
    if (!e.notes) continue;
    if (!(e.uid in notes)) notes[e.uid] = e.notes;
    delete e.notes;
  }
  return notes;
}

function instanceKey(t, tz) {
  return t.isDate ? dateStr(t) : utcMs(t, tz);
}

// ICAL.Time -> epoch ms. Uses Intl for IANA zones (current DST rules), the feed's VTIMEZONE for
// anything else, and `tz` (TZID, X-WR-TIMEZONE or fallback) for floating times.
function utcMs(t, tz) {
  if (t.isDate) return Date.UTC(t.year, t.month - 1, t.day);
  const zone = t.zone?.tzid;
  if (zone === 'UTC' || zone === 'Z') return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  const name = zone && zone !== 'floating' ? zone : tz;
  if (isIana(name)) return zonedToUtc(t, name);
  if (t.zone && t.zone !== ICAL.Timezone.localTimezone) return t.toUnixTime() * 1000;
  return zonedToUtc(t, isIana(tz) ? tz : 'UTC');
}

const formats = new Map();
function fmt(tz) {
  if (!formats.has(tz)) {
    formats.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }));
  }
  return formats.get(tz);
}
function isIana(tz) {
  if (!tz) return false;
  try { fmt(tz); return true; } catch { formats.delete(tz); return false; }
}
function offset(ms, tz) {
  const p = {};
  for (const { type, value } of fmt(tz).formatToParts(new Date(ms))) p[type] = +value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
function zonedToUtc(t, tz) {
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  const first = wall - offset(wall, tz);
  const second = wall - offset(first, tz);
  return second;
}

function dateStr(t) {
  return new Date(Date.UTC(t.year, t.month - 1, t.day)).toISOString().slice(0, 10);
}
function ymd(ms) {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
}
