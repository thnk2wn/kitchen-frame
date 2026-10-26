// toLocaleTimeString / toLocaleDateString build a new Intl formatter on every call, which is slow on the
// frame's CPU (Home formats dozens of times as it opens). Keep one formatter per set of options; the
// text is the same. A formatter keeps the time zone it was made in, so a change of the frame's zone
// shows after the next reload (daylight saving is within a zone, so it's unaffected).
const formatters = new Map();
// A 0–5 rating as filled and empty stars: ['★★★', '★★'].
export function stars(n) {
  const k = Math.max(0, Math.min(5, Math.round(Number(n)) || 0));
  return ['★'.repeat(k), '★'.repeat(5 - k)];
}

export function formatDate(d, options) {
  const key = JSON.stringify(options);
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.DateTimeFormat([], options)));
  return f.format(d);
}
// The same for comparing text in sorts: localeCompare with options builds a collator per comparison.
const collators = new Map();
export function compareText(a, b, options) {
  const key = JSON.stringify(options || {});
  let c = collators.get(key);
  if (!c) collators.set(key, (c = new Intl.Collator(undefined, options)));
  return c.compare(a, b);
}
const TIME = { hour: 'numeric', minute: '2-digit' };
const LONG_DATE = { weekday: 'long', month: 'long', day: 'numeric' };
const SHORT_DATE = { weekday: 'short', month: 'short', day: 'numeric' };
const WEEKDAY = { weekday: 'short' };

export function time(d) {
  return formatDate(d, TIME);
}
// Lock-screen style: "5:20", no AM/PM.
export function clockTime(d) {
  return time(d).split(/\s/)[0];
}
export function longDate(d) {
  return formatDate(d, LONG_DATE);
}
export function dayKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
// Calendar colour as CSS variables (the palette changes with the theme).
export function calVars(e) {
  return calColorVars(e.cal);
}
// A calendar's colour as --c / --c-tint, from CALENDAR_COLORS (a palette name such as "orange", or a
// hex colour), else the default rotation of red, blue, green, purple, orange, teal.
const DEFAULT_CALS = ['red', 'blue', 'green', 'purple', 'orange', 'teal'];
let calColors = [];
export function setCalendarColors(colors) { calColors = Array.isArray(colors) ? colors : []; }
export function calColorVars(i) {
  const c = String(calColors[i] || DEFAULT_CALS[i % DEFAULT_CALS.length]).trim().toLowerCase();
  const hex = /^#([0-9a-f]{6})$/.exec(c);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return '--c:' + c + ';--c-tint:rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',.16)';
  }
  const name = /^[a-z]+$/.test(c) ? c : 'gray';
  return '--c:var(--pal-' + name + ', var(--pal-gray));--c-tint:var(--pal-' + name + '-tint, var(--pal-gray-tint))';
}
// Events touching a local calendar day. All-day events are plain dates with an exclusive end.
// Looks up a per-feed index (built once per calendar copy) instead of scanning every event for
// every day: Month, Week, Home and the clock screen ask about many days each minute.
const indexes = new WeakMap();
export function eventsOn(events, day) {
  let byDay = indexes.get(events);
  if (!byDay) indexes.set(events, (byDay = indexDays(events)));
  return byDay.get(dayKey(day)) || [];
}
function indexDays(events) {
  const byDay = new Map();
  const add = (k, e) => { if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); };
  for (const e of events) {
    if (!e.allDay) { add(dayKey(new Date(e.start)), e); continue; }
    const [y, m, d] = e.start.split('-').map(Number);
    for (let i = 0, k = e.start; k < e.end && i < 400; k = dayKey(new Date(y, m - 1, d + ++i))) add(k, e);
  }
  return byDay;
}
export function isPast(e, now) {
  return !e.allDay && Date.parse(e.end) <= now.getTime();
}
export function isNow(e, now) {
  return !e.allDay && Date.parse(e.start) <= now.getTime() && now.getTime() < Date.parse(e.end);
}
// "5:00 – 6:30 PM", or "11:00 AM – 1:00 PM" across noon.
export function timeRange(e) {
  const a = time(new Date(e.start)), b = time(new Date(e.end));
  const [at, ap] = a.split(/\s/), [, bp] = b.split(/\s/);
  return (ap === bp ? at : a) + ' – ' + b;
}
// Where an address's street starts: at a comma, or before a street number ("Main Street Gym 120 Oak
// St, ...").
export const STREET = /,|\s+(?=\d{1,6}[a-z]?\s+(?:[a-z.]+\s+){1,4}(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|way|ct|court|pkwy|parkway|hwy|highway|pl|place|cir|circle|ter|trl|trail)\b)/i;
// An event's place, short for a row: its name when it has one ("Main Street Gym - Springfield"), else the street
// and town ("120 Oak St, Springfield"), never the state, zip or country. The event's sheet
// shows the whole address.
export function placeName(loc) {
  const s = String(loc || '').replace(/\s+/g, ' ').trim();
  const name = s.split(STREET)[0].trim();
  if (name && !/^\d/.test(name)) return name;
  return s.split(/\s*,\s*/).slice(0, 2).filter((p) => p && !/^(united states|usa?)$/i.test(p) && !/\d{5}/.test(p)).join(', ');
}
// A timed task's moment: "16:30" on its due day (Reminders, or a floating Todoist time), or a full
// ISO time (a Todoist task pinned to a time zone). null when it has no time.
export function dueAt(item) {
  if (!item.due || !item.time) return null;
  if (item.time.length > 5) return new Date(item.time);
  const [y, m, d] = item.due.split('-').map(Number), [h, min] = item.time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min);
}
// "4 PM", "4:30 PM".
export function shortTime(d) {
  return time(d).replace(':00', '');
}
export function dueLabel(due, now) {
  const today = dayKey(now), tomorrow = dayKey(addDays(now, 1));
  if (due < today) return 'Overdue';
  if (due === today) return 'Today';
  if (due === tomorrow) return 'Tomorrow';
  const [y, m, d] = due.split('-').map(Number);
  return formatDate(new Date(y, m - 1, d), SHORT_DATE);
}
// WMO weather codes (Open-Meteo) -> label + icon name + icon tint.
export function weatherInfo(code, day = true) {
  if (code === 0) return { label: day ? 'Sunny' : 'Clear', icon: day ? 'sun' : 'moon', tint: day ? 'sun' : '' };
  if (code <= 2) return { label: 'Partly Cloudy', icon: day ? 'cloudSun' : 'cloud', tint: day ? 'sun' : '' };
  if (code === 3) return { label: 'Cloudy', icon: 'cloud', tint: '' };
  if (code <= 48) return { label: 'Foggy', icon: 'fog', tint: '' };
  if (code <= 57) return { label: 'Drizzle', icon: 'rain', tint: 'rain' };
  if (code <= 67) return { label: 'Rain', icon: 'rain', tint: 'rain' };
  if (code <= 77) return { label: 'Snow', icon: 'snow', tint: '' };
  if (code <= 82) return { label: 'Showers', icon: 'rain', tint: 'rain' };
  if (code <= 86) return { label: 'Snow Showers', icon: 'snow', tint: '' };
  return { label: 'Thunderstorms', icon: 'storm', tint: 'rain' };
}

// A forecast day's label and icon: the National Weather Service's short forecast when there is one
// ("Sunny", "Chance Rain Showers then Mostly Sunny"), otherwise Open-Meteo's daily code. The daily
// code is the day's worst hour, so a sunny day with evening clouds would otherwise read "Cloudy".
export function dayInfo(d) {
  const s = d.short ? d.short.split(/ then /i)[0].toLowerCase() : '';
  const night = !!d.shortNight;
  const pick = (icon, tint) => ({ label: d.short, icon, tint });
  if (!s) return weatherInfo(d.code);
  if (/thunder/.test(s)) return pick('storm', 'rain');
  if (/snow|flurr|sleet|ice|wintry/.test(s)) return pick('snow', '');
  if (/rain|shower|drizzle/.test(s)) return pick('rain', 'rain');
  if (/fog|haze|smoke/.test(s)) return pick('fog', '');
  if (/partly|mostly sunny|mostly clear/.test(s)) return pick(night ? 'cloud' : 'cloudSun', night ? '' : 'sun');
  if (/cloud|overcast/.test(s)) return pick('cloud', '');
  if (/sunny|clear|fair/.test(s)) return pick(night ? 'moon' : 'sun', night ? '' : 'sun');
  return { ...weatherInfo(d.code), label: d.short };
}
export function dow(date) {
  return formatDate(new Date(date + 'T12:00'), WEEKDAY);
}

// "Tomorrow" or "Wed, Oct 21" for an event's start day (all-day events are plain dates).
export function dayName(e, now) {
  const day = e.allDay ? new Date(e.start + 'T12:00') : new Date(e.start);
  if (dayKey(day) === dayKey(addDays(now, 1))) return 'Tomorrow';
  return formatDate(day, SHORT_DATE);
}

// Recipe titles without asides: "Algerian Kefta (Meatballs)" -> "Algerian Kefta".
export function recipeTitle(t) {
  const short = String(t || '').replace(/\s*\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim();
  return short || String(t || '').trim();
}

// UV index -> WHO band: label and a CSS class for its colour (green, yellow, orange, red, purple).
export function uvBand(uv) {
  if (uv <= 2) return { label: 'Low', cls: 'uv-low' };
  if (uv <= 5) return { label: 'Moderate', cls: 'uv-mod' };
  if (uv <= 7) return { label: 'High', cls: 'uv-high' };
  if (uv <= 10) return { label: 'Very high', cls: 'uv-vhigh' };
  return { label: 'Extreme', cls: 'uv-ext' };
}
