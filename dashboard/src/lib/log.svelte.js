// The frame's event log: what happened on the frame, for troubleshooting from anywhere. Events are
// small ({ t, event, level, ...context }) and kept in a buffer that rides on the 10-minute check-in
// (lib/checkin.js), so logging adds no requests of its own; an error sends within a minute (at most
// every 5 minutes). The Worker writes each one to Cloudflare's logs (filter: source = frame) and
// keeps the last 200 with the frame's status (scripts/frame-status.sh --log). The last 50 are also
// kept here, for Settings → About → Recent events.
//
// Context is welcome (which calendar, list or entity, an error's message), raw payloads aren't, and
// secrets never: the dashboard key and Home Assistant token are never logged.
const PENDING_MAX = 300;
const RECENT_KEY = 'frame-log-recent';

let pending = [];
export const recent = $state((() => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } })());
let flushSoon = null; // set by checkin.js: send what's pending now (used for errors)

const trim = (v) => (typeof v === 'string' ? v.slice(0, 300) : v);

export function log(event, data = {}, level = 'info') {
  const e = { t: new Date().toISOString(), event, level };
  for (const [k, v] of Object.entries(data)) if (v !== undefined && v !== null && v !== '') e[k] = trim(v);
  pending.push(e);
  if (pending.length > PENDING_MAX) pending = pending.slice(-PENDING_MAX);
  recent.unshift(e);
  if (recent.length > 50) recent.length = 50;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch {}
  if (level === 'error' && flushSoon) flushSoon();
  if (typeof console !== 'undefined') (level === 'error' ? console.error : console.info)('[frame] ' + event, e);
}

// For the check-in: everything pending, cleared once it's been sent.
export function take() { const out = pending; pending = []; return out; }
export function putBack(events) { pending = events.concat(pending).slice(-PENDING_MAX); }
export function onError(fn) { flushSoon = fn; }

// Uncaught errors: one entry per distinct message per 10 minutes, so a loop can't flood the log.
const seenErrors = new Map();
function error(msg, src) {
  // Chrome's harmless "ResizeObserver loop limit exceeded": a layout note, not a fault.
  if (/ResizeObserver loop/.test(msg)) return;
  const key = msg + '|' + src, now = Date.now();
  if (now - (seenErrors.get(key) || 0) < 10 * 60000) return;
  seenErrors.set(key, now);
  log('error', { msg, src }, 'error');
}
if (typeof window !== 'undefined') {
  window.addEventListener('error', (ev) => error(String(ev.message || ev.error || 'error'), (ev.filename || '').split('?')[0].split('#')[0].split('/').pop() + ':' + ev.lineno + ':' + ev.colno));
  window.addEventListener('unhandledrejection', (ev) => error(String((ev.reason && (ev.reason.message || ev.reason)) || 'rejected'), 'promise'));
}
