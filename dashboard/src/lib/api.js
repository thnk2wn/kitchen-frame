import { log } from './log.svelte.js';
// The frame opens the dashboard once with ?key=..., then remembers it.
const q = new URLSearchParams(location.search);
if (q.get('key')) {
  localStorage.setItem('frame-key', q.get('key'));
  // Saved now, so take it out of the address bar (and browser history).
  q.delete('key');
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
}

// Calls to the Worker. Failures and slow ones (over 8 s) go to the event log, the path without its
// query string (the frame's own check-in excepted, so a failing log can't log itself).
export async function api(path, init = {}) {
  const started = Date.now();
  const where = String(path).split('?')[0];
  const quiet = where.startsWith('/api/frame/');
  let res;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        Authorization: 'Bearer ' + (localStorage.getItem('frame-key') || ''),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch (e) {
    if (!quiet) log('api.failed', { path: where, error: e && e.message, ms: Date.now() - started }, 'warn');
    throw e;
  }
  const body = await res.json().catch(() => ({}));
  const ms = Date.now() - started;
  if (!res.ok) {
    if (!quiet) log('api.failed', { path: where, status: res.status, error: body.error, ms }, res.status >= 500 ? 'error' : 'warn');
    throw new Error(body.error || 'HTTP ' + res.status);
  }
  if (ms > 8000 && !quiet) log('api.slow', { path: where, ms }, 'warn');
  return body;
}

// Images and the live messages socket can't send the key as a header. They used to carry it in the
// URL; now the Worker sets an HttpOnly cookie on the first call made with the key, and they send
// that (worker/index.js, authorized()), so the key stays out of URLs, logs and caches.
export const mediaUrl = (path) => path;

// Last good copy of each feed, so the frame boots with something on screen when offline.
export function cached(key) {
  try { return JSON.parse(localStorage.getItem('frame-' + key) || 'null'); } catch { return null; }
}
const stored = new Map(); // key -> JSON last written, so unchanged polls can be told apart cheaply
export function remember(key, value) {
  const json = JSON.stringify(value);
  stored.set(key, json);
  try { localStorage.setItem('frame-' + key, json); } catch {}
}
// For pollers: remembers value and returns true only if it differs from the last copy. Unchanged
// polls (the usual case) then skip both the localStorage write and the state update, so nothing
// on screen re-renders.
export function changed(key, value) {
  const json = JSON.stringify(value);
  if (!stored.has(key)) { try { stored.set(key, localStorage.getItem('frame-' + key)); } catch {} }
  if (stored.get(key) === json) return false;
  stored.set(key, json);
  try { localStorage.setItem('frame-' + key, json); } catch {}
  return true;
}
// The next changed() for these keys reports a change (e.g. after demo data replaced the screen).
export function forget(...keys) {
  for (const key of keys) stored.set(key, null);
}
