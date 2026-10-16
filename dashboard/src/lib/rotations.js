// Household rotations on Home's Today card: who's up early with the kids, who puts whom to bed. The
// rules come from the Worker (ROTATIONS, a JSON secret, so names stay out of the repo;
// GET /api/rotations) and are worked out here for the frame's own day:
//   [{ "name": "Up early with kids", "icon": "sunrise", "switchAt": "10:00",
//      "days": { "mon": "Alex", "tue": "Sam", ..., "sun": "Alex" } },
//    { "name": "Bedtime", "icon": "moon", "at": "19:00",
//      "alternate": { "from": "2026-10-15", "who": ["Alex", "Sam"], "what": ["Mia", "Leo"] } }]
// days: a name per weekday (a missing day shows nothing). alternate: on `from`, who[i] has what[i];
// each day after, everyone moves on to the next one (two people swap daily).
// Where it shows: with "at", today's, among today's events at that time (all day, even after it).
// With "switchAt", today's at the top of Today until then, and after it tomorrow's, last in Today
// ("tomorrow"), getting ready for the next day. With neither, today's at the top.
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dayNumber = (d) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
const fromKey = (k) => { const [y, m, d] = String(k).split('-').map(Number); return dayNumber(new Date(y, m - 1, d)); };
const minutes = (hhmm) => { const t = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return t ? +t[1] * 60 + +t[2] : null; };

// One rotation's text for a day, or null.
export function onDay(r, day) {
  if (r.days) return r.days[DAYS[day.getDay()]] || null;
  const a = r.alternate;
  if (a && Array.isArray(a.who) && Array.isArray(a.what) && a.who.length && a.who.length === a.what.length && a.from) {
    const n = a.who.length;
    const shift = (((dayNumber(day) - fromKey(a.from)) % n) + n) % n;
    if (!Number.isFinite(shift)) return null;
    return a.who.map((w, i) => w + ': ' + a.what[(i + shift) % n]).join(' · ');
  }
  return null;
}

// The lines to show now: [{ name, icon, text, tomorrow, place: 'top' | 'bottom' | 'at', at? }]
// (at: minutes after midnight).
export function rotationLines(rules, now = new Date()) {
  const out = [];
  for (const r of Array.isArray(rules) ? rules : []) {
    if (!r || typeof r.name !== 'string') continue;
    const at = minutes(r.at), sw = minutes(r.switchAt);
    const tomorrow = at == null && sw != null && now.getHours() * 60 + now.getMinutes() >= sw;
    const day = tomorrow ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) : now;
    const text = onDay(r, day);
    if (text) out.push({ name: r.name, icon: r.icon || 'users', text, tomorrow, place: at != null ? 'at' : tomorrow ? 'bottom' : 'top', ...(at != null ? { at } : {}) });
  }
  return out;
}

// Demo mode: invented names.
export const DEMO_ROTATIONS = [
  { name: 'Up early with kids', icon: 'sunrise', switchAt: '10:00', days: { mon: 'Sam', tue: 'Alex', wed: 'Sam', thu: 'Alex', fri: 'Sam', sat: 'Alex', sun: 'Sam' } },
  { name: 'Bedtime', icon: 'moon', at: '19:00', alternate: { from: '2026-01-01', who: ['Alex', 'Sam'], what: ['Mia', 'Leo'] } },
];
