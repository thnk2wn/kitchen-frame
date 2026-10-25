// The kiosk's check-in with the Worker (worker/frame.js): what it's running and showing, every
// 10 minutes and on load, so its version can be checked from anywhere (scripts/frame-status.sh).
// It also backs up the Settings choices, sending them only when they've changed, and restores them
// once when it finds its storage empty, after a reset. Only in the kiosk app (window.FrameKiosk),
// never in a browser or in demo mode, so a laptop viewing the dashboard can't overwrite the frame.
import { api } from './api.js';
import { ui } from './state.svelte.js';
import { night } from './night.svelte.js';
import { ha, callService } from './ha.svelte.js';
import { timers } from './timers.svelte.js';
import { log, take, putBack, onError } from './log.svelte.js';

// Settings worth keeping: choices made on the frame, not caches, history of what was said, running
// timers or secrets (the dashboard key and Home Assistant token come back with the setup link).
const KEEP = ['frame-announcements', 'frame-cal-view', 'frame-camera-refresh', 'frame-clock-color', 'frame-day-brightness', 'frame-doorbell',
  'frame-doorbell-camera', 'frame-ha-dashboard', 'frame-ha-url', 'frame-hidden-cals', 'frame-idle', 'frame-list',
  'frame-music-player', 'frame-music-speaker', 'frame-night', 'frame-night-photos', 'frame-light-sensor', 'frame-dark-lux', 'frame-photo-details', 'frame-slide-videos', 'frame-notices-seen', 'frame-now-tv',
  'frame-playlist-order', 'frame-playlist-played', 'frame-presence-area', 'frame-presence-ignore', 'frame-recipes-mode', 'frame-settings-tab',
  'frame-spotify-played', 'frame-theme', 'frame-thermostat-gap', 'frame-timer-names', 'frame-timer-speaker', 'frame-tv',
  'frame-tv-apps', 'frame-tv-audio', 'frame-tv-own-speakers', 'frame-unlock-pin'];
const KEEP_PREFIX = ['frame-sort-'];
const SENT = 'frame-settings-sent';     // the settings JSON last backed up
const CHECKED = 'frame-settings-checked'; // set once this storage has been checked for a restore

const kiosk = () => typeof window !== 'undefined' && !!window.FrameKiosk;
const loadedAt = new Date().toISOString();
// The kiosk's own memory report (1.8+): the app as Android counts it, WebView included.
const memory = () => { try { return window.FrameKiosk.getMemory ? JSON.parse(window.FrameKiosk.getMemory()) : undefined; } catch { return undefined; } };
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
      kiosk: window.FrameKiosk.getVersion ? window.FrameKiosk.getVersion() : '', memory: memory(),
      loadedAt, screen: ui.idle ? (night.active ? 'night' : 'clock') : 'awake', tab: ui.tab, ha: ha.status,
      timers: timers.list.map(({ id, label, end, total, done }) => ({ id, label, end, total, done })), // for the phone's Remote
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
  // A restart of the kiosk app (restartApp below) loads as 'start': its kiosk.restart event, just
  // before, says why.
  try { const r = sessionStorage.getItem('frame-reload-reason'); sessionStorage.removeItem('frame-reload-reason'); return r || 'start'; } catch { return 'start'; }
}

// Restarting the kiosk app (1.12+), WebView and all: a page reload leaves the app's memory as grown as
// it was (scripts/frame-metrics.sh memory), a restart starts it fresh. Every night at RESTART_HOUR, on the
// clock screen with nothing over it, once the app has been up RESTART_AFTER; or when the Worker asks
// ("restart"). It sends what's logged first.
const RESTART_HOUR = 3;
const RESTART_AFTER = 12 * 60; // minutes
// Not 1.11: started again more than 10 minutes after a power-up, it showed "No dashboard URL set".
const kioskAtLeast = (major, minor) => { const [a, b] = String(window.FrameKiosk.getVersion ? window.FrameKiosk.getVersion() : '').split('.').map(Number); return a > major || (a === major && b >= minor); };
const canRestart = () => kiosk() && typeof window.FrameKiosk.restartApp === 'function' && kioskAtLeast(1, 12);
function restartApp(reason) {
  const m = memory() || {};
  log('kiosk.restart', { reason, upMin: Math.round(m.upMin), pss: m.pss });
  checkIn().finally(() => window.FrameKiosk.restartApp());
}
function restartAtNight() {
  if (!canRestart() || ui.demo || new Date().getHours() !== RESTART_HOUR || !ui.idle || document.querySelector('[role="alertdialog"]')) return;
  const m = memory();
  if (m && m.upMin >= RESTART_AFTER) restartApp('nightly');
}

// What the kiosk saw before this start (1.13+, kiosk/src/…/KioskLog.java), once per app start, not
// per page load: the start itself (Android's boot count; a gap is a boot that never reached the kiosk),
// the previous run's last lines from the kiosk's own log, and the previous boot's last Android errors.
// Both logs are otherwise lost at every power-up.
let reportTries = 0;
function reportKioskStart() {
  if (!kiosk() || typeof window.FrameKiosk.getStartReport !== 'function') return;
  let r;
  try { r = JSON.parse(window.FrameKiosk.getStartReport()); } catch { return; }
  if (r.pending) { if (reportTries++ < 12) setTimeout(reportKioskStart, 5000); return; }
  if (r.boot === undefined) return; // already sent for this app start
  log('kiosk.start', { boot: r.boot, restart: r.sameBoot, missedBoots: r.missedBoots, sinceBootS: r.sinceBootS, zygoteS: r.zygoteS, bootanimS: r.bootanimS }, r.missedBoots > 0 ? 'warn' : 'info');
  for (const line of r.previousRun || []) log('kiosk.before', { line });
  // Not warnings: every power-off leaves some (services stopping); they matter after a hang.
  for (const line of r.previousBoot || []) log('android.before', { line });
}

// Home Assistant's "frame went quiet" timer: restarted every 5 minutes while the dashboard runs on the
// frame, it runs out after QUIET of silence, and a Home Assistant automation notifies a phone (and
// again when it's back). A timer, not a check-in on the Worker: Home Assistant can't see those.
const QUIET_TIMER = 'timer.kitchen_frame_quiet';
const QUIET = '00:20:00';
function stillHere() {
  if (kiosk() && !ui.demo && ha.status === 'connected') callService('timer', 'start', { duration: QUIET }, { entity_id: QUIET_TIMER }).catch(() => {});
}

// An error sends what's pending within a minute, and at most every 5 minutes.
let lastErrorSend = 0, errorTimer = null;
onError(() => {
  if (errorTimer || Date.now() - lastErrorSend < 5 * 60000) return;
  errorTimer = setTimeout(() => { errorTimer = null; lastErrorSend = Date.now(); checkIn(); }, 60000);
});

// "Check in now" from the Worker (frame-status.sh --now, the status page, the phone's Remote after a
// tap) and "reload": at most every 10 s. Other commands (show, screenshot…) don't count, or a
// check-in asked for right after a tab change would be dropped.
let lastAsked = 0;
if (typeof window !== 'undefined') window.addEventListener('frame-command', (e) => {
  if (!kiosk() || !['checkin', 'reload', 'restart'].includes(e.detail) || Date.now() - lastAsked < 10000) return;
  lastAsked = Date.now();
  if (e.detail === 'checkin') checkIn();
  // A reload sends what's logged first, and says why it happened.
  if (e.detail === 'reload') checkIn().finally(() => { reloadFor('remote'); location.reload(); });
  // An older kiosk can't restart: a reload is the next best thing.
  if (e.detail === 'restart') { if (canRestart()) restartApp('remote'); else checkIn().finally(() => { reloadFor('remote'); location.reload(); }); }
});

// The frame (not a browser viewing the dashboard) tells the Worker when it's in demo mode, so Alexa
// reads the same invented day it shows (worker/alexa.js). At load and on every switch.
export function reportDemo() {
  if (!kiosk()) return;
  api('/api/frame/demo', { method: 'POST', body: JSON.stringify({ on: !!ui.demo }) }).catch(() => {});
}

export function startCheckIn() {
  reportDemo();
  log('app.load', { version: version(), release: release(), reason: loadReason(), webview: (/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1] });
  reportKioskStart();
  restore().then(() => setTimeout(checkIn, 20000)); // give Home Assistant a moment to connect first
  setInterval(checkIn, 10 * 60 * 1000);
  setInterval(restartAtNight, 5 * 60 * 1000);
  setTimeout(stillHere, 30000); // once Home Assistant has connected
  setInterval(stillHere, 5 * 60 * 1000);
}
