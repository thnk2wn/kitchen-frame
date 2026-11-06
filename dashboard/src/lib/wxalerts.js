// Weather Service alerts (worker/weather.js): which are still in effect, in what order, how they read
// and how they're said, and which to say now (Settings → Announcements → Weather alerts). Plain
// functions, tested in wxalerts.test.js; lib/alerts.svelte.js does the speaking.
//
// Each alert can carry `ai: { summary, speech }` from the Worker (worker/wx-alert-ai.js): a short line
// and a couple of spoken sentences, without the county lists and codes. Everything here works without
// it too, from the Weather Service's own text.
import { time, dow, dayKey } from './format.js';

// Gone the minute it ends, not at the next weather fetch (every 15 min).
export const activeAlerts = (alerts, now = Date.now()) => (alerts || []).filter((a) => !a.ends || Date.parse(a.ends) > now);

// Warnings (tornado, severe thunderstorm, flash flood) are Severe or Extreme; statements, advisories
// and most watches are Moderate or Minor.
export const isWarning = (a) => a.severity === 'Severe' || a.severity === 'Extreme';

export const alertKey = (a) => 'wx:' + (a.id || a.event + '|' + a.ends);
// Said once per kind while one is in effect: the Weather Service re-issues a warning as an update with a
// new id (2026-11-06: the Flash Flood Warning at 10:31, updated at 11:12, was said twice).
export const eventKey = (a) => 'wx:event:' + a.event;

// Worst first: by kind (a warning, then a watch, an advisory, a statement), then severity, then the
// one ending soonest.
const KIND = [/warning$/i, /watch$/i, /advisory$/i, /statement$/i];
const SEVERITY = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };
const kindRank = (a) => { const k = KIND.findIndex((r) => r.test(a.event || '')); return k < 0 ? KIND.length : k; };
const endsAt = (a) => (a.ends ? Date.parse(a.ends) : Infinity);
export const worse = (a, b) => kindRank(a) - kindRank(b) || (SEVERITY[b.severity] || 0) - (SEVERITY[a.severity] || 0) || endsAt(a) - endsAt(b);

// What the sheet and Home show: in effect, worst first, and one row per kind of alert. During a storm
// the Weather Service often has two of the same (neighbouring areas, or an update alongside the
// original): those merge into the newest, lasting as long as the longest. count: how many merged.
export function alertList(alerts, now = Date.now()) {
  const by = new Map();
  for (const a of activeAlerts(alerts, now)) {
    const had = by.get(a.event);
    if (!had) { by.set(a.event, { ...a, count: 1 }); continue; }
    const newer = Date.parse(a.sent || 0) > Date.parse(had.sent || 0) ? a : had;
    by.set(a.event, { ...newer, ends: endsAt(a) > endsAt(had) ? a.ends : had.ends, count: had.count + 1 });
  }
  return [...by.values()].sort(worse);
}

// New: sent in the last half hour.
export const isNew = (a, now = Date.now()) => !!a.sent && now - Date.parse(a.sent) < 30 * 60000;

// "until 9:00 AM", or "until Fri 9:00 AM" when it ends another day.
export const until = (t, now = Date.now()) => (t ? 'until ' + (dayKey(new Date(t)) === dayKey(new Date(now)) ? '' : dow(dayKey(new Date(t))) + ' ') + time(new Date(t)) : '');

// The Weather Service hard-wraps its text at about 70 characters: join those lines, keep paragraphs.
export const unwrap = (t) => (t || '').replace(/([^\n])\n(?!\n)/g, '$1 ');

// "Flash Flood Warning" -> "Flash flood", for the chip beside the days.
export const shortEvent = (e) => { const w = String(e || '').split(' '); const s = (w.length > 1 ? w.slice(0, -1) : w).join(' '); return s.charAt(0) + s.slice(1).toLowerCase(); };

// The alert's text as labelled sections: [{ label, text }] (label '' for a plain paragraph). Drops
// what's noise on a kitchen screen: product codes ("FFWRAH"), "The National Weather Service in …
// has issued a", the "* Until …" line (the end time is shown already), links and map coordinates.
// Areas ("…County in central Iowa…") read as a list.
const LABELS = { WHAT: 'What', WHERE: 'Where', WHEN: 'When', IMPACTS: 'Impacts', IMPACT: 'Impacts', HAZARD: 'Hazard',
  SOURCE: 'Source', 'ADDITIONAL DETAILS': 'Details' };
// Said already by the end time beside it, or only of interest to forecasters.
const SKIP = (label, text) => label === 'Source' || (label === 'When' && /^until\b/i.test(text));
export function sections(a) {
  const out = [];
  const add = (label, text) => { text = tidy(text); if (text) out.push({ label, text }); };
  for (let p of unwrap(a.description || a.text || '').split(/\n\s*\n/)) {
    p = p.trim();
    if (!p || /^[A-Z0-9]{4,8}$/.test(p) || /^&&$/.test(p) || /^(LAT\.\.\.LON|TIME\.\.\.MOT\.\.\.LOC)/.test(p)) continue;
    if (/^The National Weather Service in .* has issued an?$/i.test(p)) continue;
    let m;
    if ((m = /^\*?\s*([A-Z][A-Z ]+?)\.\.\.\s*([\s\S]*)$/.exec(p)) && LABELS[m[1]]) {
      if (!SKIP(LABELS[m[1]], m[2])) add(LABELS[m[1]], m[1] === 'WHERE' ? areas(m[2]) : m[2]);
    } else if ((m = /^\*\s*.+? (?:Warning|Watch|Advisory|Statement) for\.\.\.\s*([\s\S]*)$/i.exec(p))) {
      add('Where', areas(m[1]));
    } else if (/^\*\s*Until\b/i.test(p)) {
      continue;
    } else if ((m = /^\*?\s*(?:Some )?locations (?:that will experience [\w ]+ include|impacted include)\.\.\.\s*([\s\S]*)$/i.exec(p))) {
      add('Places', m[1]);
    } else if ((m = /^This includes the following highways\.\.\.\s*([\s\S]*)$/i.exec(p))) {
      add('Roads', m[1]);
    } else {
      add(/^\*?\s*At \d/.test(p) && !out.some((s) => s.label === 'What') ? 'What' : '', p.replace(/^\*\s*/, ''));
    }
  }
  return out;
}
// "- " details on their own lines, links gone, double spaces closed up.
const tidy = (t) => String(t || '').replace(/\s*-\s+https?:\S+/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+-\s+/g, '\n').replace(/^-\s+/, '')
  .replace(/[ \t]{2,}/g, ' ').trim();
// "Northeastern Story County in central Iowa... Southern Polk County in central Iowa..." ->
// "Northeastern Story County, Southern Polk County (central Iowa)".
export function areas(t) {
  const parts = String(t).split(/\.{3}/).map((s) => s.trim().replace(/\.$/, '')).filter(Boolean);
  const m = parts.map((s) => /^(.*?) in ((?:\w+ )*?(?:north|south|east|west|central|northern|southern|eastern|western|northeast|northwest|southeast|southwest)\w* .+)$/i.exec(s));
  const region = m.every((x) => x) && m.every((x) => x[2] === m[0][2]) ? m[0][2] : null;
  return region ? m.map((x) => x[1]).join(', ') + ' (' + region + ')' : parts.join(', ') + '.';
}

// What to do: the Weather Service's advice, one paragraph, without the boilerplate heading.
export const advice = (a) => unwrap(a.instruction || '').replace(/^PRECAUTIONARY\/PREPAREDNESS ACTIONS\.\.\.\s*/i, '').replace(/\s*\n+\s*/g, ' ').trim();

const firstSentence = (t) => (/^.*?[.!?](?=\s|$)/.exec(t || '') || [t || ''])[0].trim();
// The advice to say: "Turn around, don't drown" and the like are slogans, not instructions.
const SLOGAN = /^(turn around,? don.?t drown|when thunder roars,? go indoors)\b[^.!?]*[.!?]\s*/i;
const toSayAdvice = (a) => firstSentence(advice(a).replace(SLOGAN, ''));
// "At 1031 AM EST, Doppler radar indicated…" -> "Doppler radar indicated…"
const noStamp = (t) => t.replace(/^At \d{1,2}:?\d{2} ?[AP]M \w+, (\w)/, (_, c) => c.toUpperCase());
const what = (a) => { const s = sections(a); return (s.find((x) => x.label === 'What') || s.find((x) => x.label === 'Hazard') || s.find((x) => !x.label) || { text: '' }).text; };

// One short line for the list: the model's, else the alert's first sentence.
export const summary = (a) => (a.ai && a.ai.summary) || noStamp(firstSentence(what(a)));

// Read aloud: the model's couple of sentences, else what's happening and the first piece of advice.
export function speech(a, now = Date.now()) {
  const head = a.event + (a.ends ? ' ' + until(a.ends, now) : '') + '.';
  if (a.ai && a.ai.speech) return head + ' ' + a.ai.speech;
  return [head, noStamp(firstSentence(what(a))), toSayAdvice(a)].filter(Boolean).join(' ');
}

// Said on its own, as an announcement.
export const spoken = (a, now = Date.now()) => 'Weather: ' + speech(a, now);

// "Read all": just what's in effect and until when, worst first; each alert has its own Read aloud.
export function readAll(list, now = Date.now()) {
  if (!list.length) return '';
  return (list.length === 1 ? 'One weather alert. ' : list.length + ' weather alerts. ')
    + list.map((a) => a.event + (a.ends ? ' ' + until(a.ends, now) : '') + '.').join(' ');
}

// What to say now. mode: 'off' | 'warnings' | 'all'. A warning is said day or night; anything else
// waits out quiet hours and is said when they end, if it's still in effect. said: alertKey -> when.
export function toSay(alerts, { mode, quiet, said, now = Date.now() }) {
  if (mode !== 'warnings' && mode !== 'all') return [];
  return activeAlerts(alerts, now).filter((a) => (mode === 'all' || isWarning(a)) && !said[alertKey(a)] && !said[eventKey(a)] && (isWarning(a) || !quiet));
}
