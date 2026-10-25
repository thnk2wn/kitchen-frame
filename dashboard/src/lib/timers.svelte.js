// Kitchen timers: started from the top bar or a recipe step, shown as countdown chips on every
// screen, and when one ends: a chime on the frame, a full-screen alert, and optionally an
// announcement on a speaker through Home Assistant (a notify entity, e.g. an Echo's "Announce").
// Each timer keeps its end time in localStorage, so a reload or Wi-Fi blip doesn't lose it.
import { ha, callService } from './ha.svelte.js';

const KEY = 'frame-timers';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(timers.list)); } catch {} };

// list: [{ id, label, end, total, done }] (end in ms). now ticks once a second only while any run.
// big: the full-screen view (TimerFull.svelte) is up, from its button or a timer started by voice.
export const timers = $state({ list: load(), now: Date.now(), big: false });
// Where timer alerts are announced: a notify entity id, or 'off'. Default: an Echo-style
// "… Announce" entity with "kitchen" in its name, once Home Assistant has listed them.
export const timerSpeaker = $state({ id: localStorage.getItem('frame-timer-speaker') });
export function setTimerSpeaker(id) { timerSpeaker.id = id; try { localStorage.setItem('frame-timer-speaker', id); } catch {} }
// Speakers that can announce timers: Echo-style "… Announce" notify entities, the kitchen's first.
export const timerSpeakers = () => ha.notify.filter((n) => /_announce$/.test(n.entity_id))
  .sort((a, b) => (/kitchen/i.test(b.entity_id) - /kitchen/i.test(a.entity_id)) || a.name.localeCompare(b.name)).slice(0, 3);
export function timerSpeakerId() {
  if (timerSpeaker.id) return timerSpeaker.id === 'off' ? null : timerSpeaker.id;
  const pick = ha.notify.find((n) => /kitchen/i.test(n.entity_id) && /_announce$/.test(n.entity_id));
  return pick ? pick.entity_id : null;
}

// ---- Sound: a short three-note chime, made with Web Audio (no files to load).
let ctx = null;
function audio() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
export function chime() {
  const a = audio();
  if (!a) return;
  [880, 1175, 1568].forEach((f, i) => {
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + i * 0.22;
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + 0.55);
  });
}

// One-tap names offered after a timer starts. Set per frame with ?timer_names=A,B,C (a setup link).
const DEFAULT_NAMES = ['Pasta', 'Bread', 'Veggies', 'Oven', 'Protein'];
{
  const q = new URLSearchParams(location.search).get('timer_names');
  if (q !== null) { try { localStorage.setItem('frame-timer-names', q); } catch {} }
}
export function timerNames() {
  let v = null;
  try { v = localStorage.getItem('frame-timer-names'); } catch {}
  const list = (v || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8);
  return list.length ? list : DEFAULT_NAMES;
}

// ---- Timers
export const MAX_TIMERS = 3;
export function startTimer(label, seconds) {
  audio(); // this tap unlocks sound for the alert later
  if (timers.list.filter((t) => !t.done).length >= MAX_TIMERS) return null;
  const now = Date.now();
  const id = now.toString(36);
  timers.list = [...timers.list, { id, label: label || 'Timer', end: now + seconds * 1000, total: seconds, done: false }];
  save(); tick();
  return id;
}
export function renameTimer(id, label) {
  timers.list = timers.list.map((t) => (t.id === id ? { ...t, label } : t));
  save();
}
export function addTime(id, seconds) {
  timers.list = timers.list.map((t) => (t.id === id ? { ...t, end: Math.max(Date.now(), t.done ? Date.now() : t.end) + seconds * 1000, total: t.total + seconds, done: false } : t));
  save(); tick();
}
export function removeTimer(id) {
  timers.list = timers.list.filter((t) => t.id !== id);
  if (!timers.list.length) timers.big = false;
  save();
}

// From Alexa (worker/alexa.js, through the Worker's message connection): start a timer and show it
// full screen, from across the kitchen; cancel one, or add time to one (durations.js pickTimer).
export function fromVoice({ action, label, seconds }) {
  if (action === 'start') { startTimer(label, seconds); timers.big = true; return; }
  const t = pickTimer(timers.list, label);
  if (!t) return;
  if (action === 'cancel') removeTimer(t.id);
  if (action === 'add') addTime(t.id, seconds || 60);
}
export const remaining = (t) => Math.max(0, Math.ceil((t.end - timers.now) / 1000));
export const ringing = () => timers.list.filter((t) => t.done);

let ticker = null, repeat = null;
function tick() {
  timers.now = Date.now();
  let changed = false;
  for (const t of timers.list) {
    if (!t.done && t.end <= timers.now) { t.done = true; changed = true; finished(t); }
  }
  if (changed) { timers.list = [...timers.list]; save(); }
  const running = timers.list.some((t) => !t.done);
  if (running && !ticker) ticker = setInterval(tick, 1000);
  if (!running && ticker) { clearInterval(ticker); ticker = null; }
  // Chime every 4 s while an alert is up, for up to 2 minutes after the newest one ended.
  const ring = ringing();
  const latest = ring.length ? Math.max(...ring.map((t) => t.end)) : 0;
  if (ring.length && timers.now - latest < 120000) { if (!repeat) repeat = setInterval(() => { chime(); tick(); }, 4000); }
  else if (repeat) { clearInterval(repeat); repeat = null; }
}
function finished(t) {
  // Long overdue (the frame was off): show the alert but don't make noise.
  if (Date.now() - t.end > 10 * 60000) return;
  chime();
  const speaker = timerSpeakerId();
  if (speaker && ha.status === 'connected') {
    callService('notify', 'send_message', { message: doneSentence(t.label, t.total) }, { entity_id: speaker }).catch(() => {});
  }
}
// Drop alerts that ended long ago when the page loads, then start ticking.
timers.list = timers.list.filter((t) => !(t.done && Date.now() - t.end > 30 * 60000));
tick();

// ?timer=Pasta:7.5 starts a named timer (minutes) on arrival, once (links, screenshots).
{
  const q = new URLSearchParams(location.search);
  const m = /^(.*?):(\d+(?:\.\d+)?)$/.exec(q.get('timer') || '');
  if (m) {
    startTimer(m[1].trim() || 'Timer', Math.round(Number(m[2]) * 60));
    q.delete('timer');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }
}

export { clockOf, splitDurations, spokenLength, unnamed, timerPicture } from './durations.js';
import { doneSentence, pickTimer } from './durations.js';
