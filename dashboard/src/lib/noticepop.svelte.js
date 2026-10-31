// New notices, shown large for a few seconds on any screen (components/NoticePop.svelte), with a
// chime on the frame: red and orange chime, blue doesn't. At night only red ones pop up.
// Settings → Display → New notices: Chime (the default), Quiet (no sound) or Off.
//
// A notice pops up once: its id and when it started (lib/notices.svelte.js keeps that steady while
// Home Assistant updates it), remembered across reloads. One that started more than FRESH_MS ago
// was on before the frame looked (a reload, a reconnect) and doesn't pop up.
import { untrack } from 'svelte';
import { notices } from './notices.svelte.js';
import { quietNow } from './night.svelte.js';
import { notes } from './timers.svelte.js';
import { ui } from './state.svelte.js';

const FRESH_MS = 5 * 60000;
const RANK = { alert: 0, warn: 1, info: 2 };
const keyOf = (n) => n.id + '|' + Date.parse(n.created);

const PREF_KEY = 'frame-notice-pop';
export const popPrefs = $state({ mode: (() => { try { return localStorage.getItem(PREF_KEY) || 'chime'; } catch { return 'chime'; } })() });
export function setPopMode(mode) {
  popPrefs.mode = mode;
  try { localStorage.setItem(PREF_KEY, mode); } catch {}
}

// What the card shows, most urgent first. round goes up each time more arrive (the card restarts
// its countdown and chimes for them); chime is the most urgent tone in that round, or null.
// hold keeps it up (?pop=<n> in demo mode, for screenshots).
export const pop = $state({ list: [], round: 0, chime: null, hold: false });
export const clearPop = () => { pop.list = []; pop.hold = false; };

const POPPED_KEY = 'frame-notices-popped';
const popped = new Set((() => { try { return JSON.parse(localStorage.getItem(POPPED_KEY) || '[]'); } catch { return []; } })());

function check() {
  const current = notices();
  const live = new Map(current.map((n) => [keyOf(n), n]));
  // One that ends or is dismissed elsewhere leaves the card; one updated shows its new text.
  if (pop.list.length) pop.list = pop.list.map((n) => live.get(keyOf(n))).filter(Boolean);
  const now = Date.now(), quiet = quietNow(), arrived = [];
  for (const [k, n] of live) {
    if (popped.has(k)) continue;
    popped.add(k);
    if (popPrefs.mode === 'off' || ui.demo || !(now - Date.parse(n.created) < FRESH_MS) || (quiet && n.tone !== 'alert')) continue;
    arrived.push(n);
  }
  for (const k of popped) if (!live.has(k)) popped.delete(k);
  try { localStorage.setItem(POPPED_KEY, JSON.stringify([...popped])); } catch {}
  if (!arrived.length) return;
  pop.list = [...pop.list, ...arrived].sort((a, b) => RANK[a.tone] - RANK[b.tone]);
  const top = arrived.reduce((t, n) => (RANK[n.tone] < RANK[t] ? n.tone : t), 'info');
  pop.chime = popPrefs.mode === 'chime' && top !== 'info' ? top : null;
  pop.round++;
}

// The chimes: orange a soft two-note ding-dong, red four quicker, louder notes.
export function popChime(tone) {
  if (tone === 'alert') notes([1319, 988, 1319, 988], { gap: 0.18, vol: 0.6 });
  else if (tone === 'warn') notes([1047, 784], { gap: 0.3, vol: 0.4 });
}

export function startNoticePop() {
  $effect.root(() => {
    // Untracked: check() writes pop, which mustn't re-run it.
    $effect(() => { notices(); untrack(check); });
  });
  // Demo screenshots: ?pop=<n> shows the first n demo notices on the card, held up.
  const n = new URLSearchParams(location.search).get('pop');
  if (ui.demo && /^\d$/.test(n || '')) { pop.list = notices().slice(0, Number(n) || 1); pop.hold = true; pop.round++; }
}
