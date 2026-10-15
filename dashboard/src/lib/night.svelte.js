// Night: between chosen hours (Settings → Night, 10:30 PM to 6:30 AM by default) the clock screen
// comes on two minutes after the last touch, motion in the room doesn't bring the dashboard back,
// the clock screen shows no photos, and the screen goes to its lowest brightness while it's up.
// A touch brings the dashboard back at the daytime brightness; a timer alert or the doorbell does
// too. The same hours are the quiet hours when agent messages aren't read aloud.
//
// Brightness goes through the kiosk app (window.FrameKiosk), which saves whatever it's given and
// applies it at start. So the daytime level is kept here (localStorage) and given back each morning;
// without the kiosk app (a browser) only the clock screen changes.
import { ui } from './state.svelte.js';
import { ringing } from './timers.svelte.js';
import { bell } from './doorbell.svelte.js';

const KEY = 'frame-night';
const DAY_KEY = 'frame-day-brightness';
const NIGHT_LEVEL = 0.05;   // the kiosk's lowest (Settings' slider starts at 5%)
export const NIGHT_IDLE_MS = 2 * 60 * 1000;

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { return {}; } };
const saved = read();
export const night = $state({
  on: saved.on !== false,
  from: saved.from || '22:30',
  to: saved.to || '06:30',
  active: false, // inside the hours now
});

export function setNight(changes) {
  Object.assign(night, changes);
  try { localStorage.setItem(KEY, JSON.stringify({ on: night.on, from: night.from, to: night.to })); } catch {}
  tick();
}

const mins = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
// Inside from..to, which may cross midnight (22:30 to 06:30).
export function inNight(d = new Date(), from = night.from, to = night.to) {
  const t = d.getHours() * 60 + d.getMinutes(), a = mins(from), b = mins(to);
  return a <= b ? t >= a && t < b : t >= a || t < b;
}
// Quiet hours for reading messages aloud: the night hours, or 10 PM to 7 AM with night off.
export const quietNow = () => (night.on ? inNight() : inNight(new Date(), '22:00', '07:00'));

function tick() { night.active = night.on && inNight(); }

// ---- Brightness

const kiosk = () => (typeof window !== 'undefined' ? window.FrameKiosk : null);
// The daytime brightness (0.05–1, or -1 for Android's own setting).
export function dayBrightness() {
  try {
    const v = localStorage.getItem(DAY_KEY);
    if (v !== null) return Number(v);
  } catch {}
  const k = kiosk();
  return k ? k.getBrightness() : -1;
}
export function setDayBrightness(v) {
  try { localStorage.setItem(DAY_KEY, String(v)); } catch {}
  applied = null;
  apply();
}

let applied = null;
function apply() {
  const k = kiosk();
  if (!k) return;
  const alert = !!bell.ringing || ringing().length > 0;
  const want = night.active && ui.idle && !alert ? NIGHT_LEVEL : dayBrightness();
  if (want === applied) return;
  applied = want;
  k.setBrightness(want);
}

// Before the first change, remember the daytime level the kiosk has, so night never overwrites it.
try { if (localStorage.getItem(DAY_KEY) === null && kiosk()) localStorage.setItem(DAY_KEY, String(kiosk().getBrightness())); } catch {}

$effect.root(() => {
  tick();
  const t = setInterval(tick, 30 * 1000);
  $effect(() => { night.active; ui.idle; bell.ringing; ringing().length; apply(); });
  return () => clearInterval(t);
});
