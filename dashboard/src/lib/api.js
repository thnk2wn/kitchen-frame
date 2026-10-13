// The frame opens the dashboard once with ?key=..., then remembers it.
const q = new URLSearchParams(location.search);
if (q.get('key')) {
  localStorage.setItem('frame-key', q.get('key'));
  // Saved now, so take it out of the address bar (and browser history).
  q.delete('key');
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
}

export async function api(path, init = {}) {
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + (localStorage.getItem('frame-key') || ''),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
  return body;
}

// <img> can't send headers, so image routes take the key in the URL.
export function withKey(path) {
  return path + (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(localStorage.getItem('frame-key') || '');
}

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
