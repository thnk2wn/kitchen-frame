// The kiosk's check-in with the Worker (worker/frame.js): what it's running and showing, every
// 10 minutes and on load, so its version can be checked from anywhere (scripts/frame-status.sh).
// It also backs up the Settings choices, sending them only when they've changed, and restores them
// once when it finds its storage empty, after a reset. Only in the kiosk app (window.FrameKiosk),
// never in a browser or in demo mode, so a laptop viewing the dashboard can't overwrite the frame.
import { api } from './api.js';
import { ui } from './state.svelte.js';
import { night } from './night.svelte.js';
import { ha } from './ha.svelte.js';

// Settings worth keeping: choices made on the frame, not caches, history of what was said, running
// timers or secrets (the dashboard key and Home Assistant token come back with the setup link).
const KEEP = ['frame-announcements', 'frame-cal-view', 'frame-clock-color', 'frame-day-brightness', 'frame-doorbell',
  'frame-doorbell-camera', 'frame-ha-dashboard', 'frame-ha-url', 'frame-hidden-cals', 'frame-idle', 'frame-list',
  'frame-music-player', 'frame-music-speaker', 'frame-night', 'frame-night-photos', 'frame-notices-seen', 'frame-now-tv',
  'frame-playlist-order', 'frame-playlist-played', 'frame-presence-area', 'frame-recipes-mode', 'frame-settings-tab',
  'frame-spotify-played', 'frame-theme', 'frame-thermostat-gap', 'frame-timer-names', 'frame-timer-speaker', 'frame-tv',
  'frame-tv-apps', 'frame-tv-audio', 'frame-tv-own-speakers'];
const KEEP_PREFIX = ['frame-sort-'];
const SENT = 'frame-settings-sent';     // the settings JSON last backed up
const CHECKED = 'frame-settings-checked'; // set once this storage has been checked for a restore

const kiosk = () => typeof window !== 'undefined' && !!window.FrameKiosk;
const loadedAt = new Date().toISOString();
const version = () => ((/assets\/index-([\w-]+)\.js/.exec(document.documentElement.innerHTML) || [])[1] || 'dev').slice(0, 8);

function settings() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (KEEP.includes(k) || KEEP_PREFIX.some((p) => k.startsWith(p))) out[k] = localStorage.getItem(k);
  }
  return out;
}

async function checkIn() {
  if (!kiosk() || ui.demo) return;
  const now = settings();
  const json = JSON.stringify(now);
  let changed = false;
  try { changed = localStorage.getItem(SENT) !== json; } catch {}
  try {
    await api('/api/frame/status', { method: 'POST', body: JSON.stringify({
      version: version(), webview: (/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || '',
      kiosk: window.FrameKiosk.getVersion ? window.FrameKiosk.getVersion() : '',
      loadedAt, screen: ui.idle ? (night.active ? 'night' : 'clock') : 'awake', tab: ui.tab, ha: ha.status,
      ...(changed ? { settings: now } : {}),
    }) });
    if (changed) localStorage.setItem(SENT, json);
  } catch {}
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
    if (restored) { console.info('checkin: restored ' + restored + ' settings'); location.reload(); }
  } catch {}
}

export function startCheckIn() {
  restore().then(() => setTimeout(checkIn, 20000)); // give Home Assistant a moment to connect first
  setInterval(checkIn, 10 * 60 * 1000);
}
