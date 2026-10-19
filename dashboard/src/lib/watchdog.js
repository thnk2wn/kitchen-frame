// The frame puts itself right when the page has stopped working, without anyone unplugging it.
//   - Stopped updating: App redraws with the clock every minute (noteAlive, from an effect). If an
//     uncaught error has stopped Svelte's updates, those redraws stop while this timer, which isn't
//     Svelte's, keeps running; three minutes without one and the page reloads. That's what a frozen
//     white frame looked like on 2026-10-19.
//   - Repeated errors: three uncaught errors within five minutes, and the page reloads.
// At most one such reload every RELOAD_GAP_MS (remembered across reloads), so a fault that comes back
// at once can't reload the frame in a loop; it shows as frame.selfreload on the status page instead.
// Parts of the screen that fail on their own are caught by components/Safe.svelte and don't count.
import { log } from './log.svelte.js';
import { checkIn, reloadFor } from './checkin.js';

const STALL_MS = 3 * 60 * 1000;
const ERRORS = 3, ERROR_WINDOW_MS = 5 * 60 * 1000;
const RELOAD_GAP_MS = 10 * 60 * 1000;
const KEY = 'frame-watchdog-reload';

let alive = Date.now();
let errors = [];

export const noteAlive = () => { alive = Date.now(); };

function reload(reason) {
  let last = 0;
  try { last = Number(localStorage.getItem(KEY) || 0); } catch {}
  if (Date.now() - last < RELOAD_GAP_MS) return;
  try { localStorage.setItem(KEY, String(Date.now())); } catch {}
  log('frame.selfreload', { reason }, 'warn');
  reloadFor('watchdog');
  // Send what was logged first (the error that caused this), but don't wait on it for long.
  Promise.race([checkIn().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]).finally(() => location.reload());
}

// Only on the frame (the kiosk app): a laptop's browser sleeps and wakes, which would look like a stall.
export function startWatchdog() {
  if (typeof window === 'undefined' || !window.FrameKiosk) return;
  setInterval(() => { if (Date.now() - alive > STALL_MS) reload('stopped updating'); }, 30000);
  window.addEventListener('error', () => {
    const now = Date.now();
    errors = [...errors.filter((t) => now - t < ERROR_WINDOW_MS), now];
    if (errors.length >= ERRORS) reload('repeated errors');
  });
}
