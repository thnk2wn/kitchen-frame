// Pure helpers for timers (no Svelte state), so they run under `node --test` too.

// "12:05", or "1:02:30" for an hour or more.
export function clockOf(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

// Durations in recipe text: "25 minutes", "10–12 min", "1 hour", "30 sec". Returns the pieces of
// the text with each duration as { text, seconds } (the lower number of a range), for tappable timers.
const DURATION = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi;
export function splitDurations(text) {
  const out = [];
  let last = 0, m;
  DURATION.lastIndex = 0;
  while ((m = DURATION.exec(text))) {
    const unit = m[3].toLowerCase();
    const mult = unit.startsWith('h') ? 3600 : unit.startsWith('s') ? 1 : 60;
    const seconds = Math.round(Number(m[1]) * mult);
    if (!seconds || seconds > 24 * 3600) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ text: m[0], seconds });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// How a person says a timer: "5 minute", "1 hour 30 minute", "45 second".
export function spokenLength(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return [h && h + ' hour', m && m + ' minute', !h && !m && s && s + ' second'].filter(Boolean).join(' ') || '0 minute';
}
// "Your 5 minute bread timer is done." Preset labels ("5 min") and "Timer" count as unnamed.
export const unnamed = (label) => !label || label === 'Timer' || /^\d+ min$/.test(label);
export function doneSentence(label, sec) {
  const name = unnamed(label) ? '' : ' ' + (/^[A-Z][a-z]+$/.test(label) ? label.toLowerCase() : label);
  return 'Your ' + spokenLength(sec) + name + ' timer is done.';
}

// A length as a sentence says it: "10 minutes", "1 hour and 30 minutes", "1 minute and 30 seconds".
export function saidLength(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const n = (v, unit) => v + ' ' + unit + (v === 1 ? '' : 's');
  const parts = [h && n(h, 'hour'), m && n(m, 'minute'), !h && s && n(s, 'second')].filter(Boolean);
  return parts.join(' and ') || n(0, 'second');
}

// The timer a spoken "cancel the timer" or "add a minute" means: the one named, if any is, else any;
// of those, one that's ringing, else the one ending next.
export function pickTimer(list, label) {
  const want = String(label || '').toLowerCase().trim();
  const named = want ? list.filter((t) => t.label.toLowerCase() === want) : [];
  const pool = named.length ? named : list;
  return pool.find((t) => t.done) || pool.filter((t) => !t.done).sort((a, b) => a.end - b.end)[0] || null;
}

// A picture for a timer named after food (an icon name, lib/icons.js), shown faintly behind it full
// screen and in the chip; null for other names. The first match wins, so "chicken soup" is chicken.
const PICTURES = [
  [/pasta|spaghetti|noodle|macaroni|boil|rice|potato|quinoa/, 'pot'],
  [/bread|dough|roll|croissant|bagel|biscuit|toast/, 'croissant'],
  [/\beggs?\b/, 'egg'],
  [/pizza/, 'pizza'],
  [/cookie|brownie/, 'cookie'],
  [/cake|muffin|pie\b/, 'cake'],
  [/chicken|turkey|wing|drumstick|protein/, 'drumstick'],
  [/beef|steak|burger|meat|roast|pork|rib/, 'beef'],
  [/ham\b|bacon/, 'ham'],
  [/fish|salmon|tuna|cod\b|tilapia/, 'fish'],
  [/shrimp|prawn/, 'shrimp'],
  [/veg|broccoli|carrot|bean|asparagus|corn\b/, 'carrot'],
  [/salad|greens|spinach|kale/, 'leafyGreen'],
  [/soup|stew|chili|sauce/, 'soup'],
  [/oven|bake|preheat|microwave/, 'microwave'],
  [/coffee|tea\b|espresso/, 'coffee'],
  [/popcorn/, 'popcorn'],
  [/sandwich|panini|grilled cheese/, 'sandwich'],
  [/laundry|wash|dryer/, 'washer'],
];
export function timerPicture(label) {
  const l = String(label || '').toLowerCase();
  const hit = PICTURES.find(([re]) => re.test(l));
  return hit ? hit[1] : null;
}
