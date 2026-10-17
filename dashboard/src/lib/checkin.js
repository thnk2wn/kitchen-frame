// The kiosk's check-in with the Worker (worker/frame.js): what it's running and showing, every
// 10 minutes and on load, so its version can be checked from anywhere (scripts/frame-status.sh).
// It also backs up the Settings choices, sending them only when they've changed, and restores them
// once when it finds its storage empty, after a reset. Only in the kiosk app (window.FrameKiosk),
// never in a browser or in demo mode, so a laptop viewing the dashboard can't overwrite the frame.
import { api } from './api.js';
import { ui } from './state.svelte.js';
import { night } from './night.svelte.js';
import { ha } from './ha.svelte.js';
import { log, take, putBack, onError } from './log.svelte.js';

// Settings worth keeping: choices made on the frame, not caches, history of what was said, running
// timers or secrets (the dashboard key and Home Assistant token come back with the setup link).
const KEEP = ['frame-announcements', 'frame-cal-view', 'frame-camera-refresh', 'frame-clock-color', 'frame-day-brightness', 'frame-doorbell',
  'frame-doorbell-camera', 'frame-ha-dashboard', 'frame-ha-url', 'frame-hidden-cals', 'frame-idle', 'frame-list',
  'frame-music-player', 'frame-music-speaker', 'frame-night', 'frame-night-photos', 'frame-photo-details', 'frame-slide-videos', 'frame-notices-seen', 'frame-now-tv',
  'frame-playlist-order', 'frame-playlist-played', 'frame-presence-area', 'frame-presence-ignore', 'frame-recipes-mode', 'frame-settings-tab',
  'frame-spotify-played', 'frame-theme', 'frame-thermostat-gap', 'frame-timer-names', 'frame-timer-speaker', 'frame-tv',
  'frame-tv-apps', 'frame-tv-audio', 'frame-tv-own-speakers', 'frame-unlock-pin'];
const KEEP_PREFIX = ['frame-sort-'];
const SENT = 'frame-settings-sent';     // the settings JSON last backed up
const CHECKED = 'frame-settings-checked'; // set once this storage has been checked for a restore

const kiosk = () => typeof window !== 'undefined' && !!window.FrameKiosk;
const loadedAt = new Date().toISOString();
const version = () => ((/assets\/index-([\w-]+)\.js/.exec(document.documentElement.innerHTML) || [])[1] || 'dev').slice(0, 8);
/* global __RELEASE__ */
const release = () => (typeof __RELEASE__ === 'string' ? __RELEASE__ : ''); // "v1.0.0+3 (a1b2c3d)", from vite.config.js

function settings() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (KEEP.includes(k) || KEEP_PREFIX.some((p) => k.startsWith(p))) out[k] = localStorage.getItem(k);
  }
  return out;
}

export async function checkIn() {
  if (!kiosk() || ui.demo) return;
  const now = settings();
  const json = JSON.stringify(now);
  let changed = false;
  try { changed = localStorage.getItem(SENT) !== json; } catch {}
  const events = take();
  try {
    await api('/api/frame/status', { method: 'POST', body: JSON.stringify({
      version: version(), release: release(), webview: (/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || '',
      kiosk: window.FrameKiosk.getVersion ? window.FrameKiosk.getVersion() : '',
      loadedAt, screen: ui.idle ? (night.active ? 'night' : 'clock') : 'awake', tab: ui.tab, ha: ha.status,
      ...(changed ? { settings: now } : {}), ...(events.length ? { events } : {}),
    }) });
    if (changed) localStorage.setItem(SENT, json);
  } catch { putBack(events); }
}

// After a reset: settings missing here but in the backup come back, then the page reloads once.
async function restore() {
  if (!kiosk() || ui.demo) return;
  try { if (localStorage.getItem(CHECKED)) return; } catch { return; }
  try {
    const { settings: saved } = await api('/api/frame/settings');
    let restored = 0;
    for (const [k, v] of Object.entries(saved || {})) {
      if ((KEEP.includes(k) || KEEP_PREFIX.some((p) => k.startsWith(p))) && localStorage.getItem(k) === null) { localStorage.setItem(k, v); restored++; }
    }
    localStorage.setItem(CHECKED, new Date().toISOString());
    if (restored) { reloadFor('restore'); console.info('checkin: restored ' + restored + ' settings'); location.reload(); }
  } catch {}
}

// Why the page is loading: set just before a deliberate reload, read once at the next start.
export function reloadFor(reason) { try { sessionStorage.setItem('frame-reload-reason', reason); } catch {} }
function loadReason() {
  try { const r = sessionStorage.getItem('frame-reload-reason'); sessionStorage.removeItem('frame-reload-reason'); return r || 'start'; } catch { return 'start'; }
}

// An error sends what's pending within a minute, and at most every 5 minutes.
let lastErrorSend = 0, errorTimer = null;
onError(() => {
  if (errorTimer || Date.now() - lastErrorSend < 5 * 60000) return;
  errorTimer = setTimeout(() => { errorTimer = null; lastErrorSend = Date.now(); checkIn(); }, 60000);
});

// "Check in now" from the Worker (frame-status.sh --now, the status page): at most every 10 s.
let lastAsked = 0;
if (typeof window !== 'undefined') window.addEventListener('frame-command', (e) => {
  if (!kiosk() || Date.now() - lastAsked < 10000) return;
  lastAsked = Date.now();
  if (e.detail === 'checkin') checkIn();
  // A reload sends what's logged first, and says why it happened.
  if (e.detail === 'reload') checkIn().finally(() => { reloadFor('remote'); location.reload(); });
});

export function startCheckIn() {
  log('app.load', { version: version(), release: release(), reason: loadReason(), webview: (/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1] });
  restore().then(() => setTimeout(checkIn, 20000)); // give Home Assistant a moment to connect first
  setInterval(checkIn, 10 * 60 * 1000);
}
