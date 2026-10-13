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
