// Home Assistant, straight from the frame over its WebSocket API on the home network.
// The URL and token live in the frame's localStorage (set over ADB from dashboard/.frame.vars),
// never in the deployed site or Cloudflare. HA's REST API refuses cross-origin calls; its
// WebSocket API does not, so everything here goes over the socket.
export const ha = $state({
  status: 'off',   // off (not set up) | connecting | connected | error
  error: null,
  players: [],     // media players, Music Assistant ones first
  tts: [],         // text-to-speech engines (tts.* entities)
  notify: [],      // notify entities [{ entity_id, name }] (e.g. an Echo's "Announce", for timer alerts)
});

// One-time setup from the URL, like ?key=: ?ha_url=…&ha_token=…&ha_dashboard=… are saved, then
// removed from the address bar so the token doesn't linger in it. (Or set them over ADB.)
{
  const q = new URLSearchParams(location.search);
  const keys = { ha_url: 'frame-ha-url', ha_token: 'frame-ha-token', ha_dashboard: 'frame-ha-dashboard' };
  let found = false;
  for (const [param, key] of Object.entries(keys)) {
    if (q.has(param)) { found = true; const v = q.get(param); v ? localStorage.setItem(key, v) : localStorage.removeItem(key); q.delete(param); }
  }
  if (found) history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
}

const entities = new Map(); // entity_id -> { state, attributes }
let ws = null;
let nextId = 0;
let pending = new Map();
let listeners = new Map(); // subscription id -> handler for its events
const connectHooks = new Set(); // run after every (re)connection, to (re)subscribe
const stateHooks = new Set();   // get the full state list read after every (re)connection
let retryMs = 1000;

const base = () => (localStorage.getItem('frame-ha-url') || '').replace(/\/$/, '');
const token = () => localStorage.getItem('frame-ha-token') || '';
export const haConfigured = () => !!(base() && token());
// The HA dashboard the House tab mirrors (its URL path, e.g. "dashboard-favorites"). Unset = no House tab.
export const haDashboard = () => localStorage.getItem('frame-ha-dashboard') || '';
// fn runs now if connected and again after every reconnection; returns an unsubscribe function.
export function onHAConnect(fn) {
  connectHooks.add(fn);
  if (ha.status === 'connected') fn();
  return () => connectHooks.delete(fn);
}

// fn(states) gets the full state list read after every (re)connection, so features can find their
// entities without another get_states. Returns an unsubscribe function.
export function onHAStates(fn) {
  stateHooks.add(fn);
  return () => stateHooks.delete(fn);
}

// Absolute URL for an entity picture (HA returns a path with its own short-lived token).
export const haUrl = (path) => (!path ? null : /^https?:/.test(path) ? path : base() + path);

export function connectHA() {
  if (!haConfigured()) { ha.status = 'off'; return; }
  if (ws && ws.readyState <= 1) return;
  ha.status = 'connecting';
  ws = new WebSocket(base().replace(/^http/, 'ws') + '/api/websocket');
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    pending.forEach((p) => p.reject(new Error('Disconnected from Home Assistant')));
    pending = new Map();
    listeners = new Map();
    if (ha.status === 'error') return; // bad token: don't hammer HA with retries
    ha.status = 'connecting';
    setTimeout(connectHA, retryMs);
    retryMs = Math.min(retryMs * 2, 30000);
  };
}

function onMessage(m) {
  if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token() }));
  else if (m.type === 'auth_ok') {
    retryMs = 1000; ha.error = null; ha.status = 'connected'; subscribe();
    for (const fn of connectHooks) { try { fn(); } catch (e) { console.error(e); } }
  }
  else if (m.type === 'auth_invalid') { ha.status = 'error'; ha.error = 'Home Assistant rejected the frame’s token'; ws.close(); }
  else if (m.type === 'result') {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.success) p.resolve(m.result);
    else p.reject(new Error((m.error && m.error.message) || 'Home Assistant error'));
  } else if (m.type === 'event' && m.event) {
    const fn = listeners.get(m.id);
    if (fn) fn(m.event); else applyDiff(m.event);
  }
}

// onEvent: for subscriptions, receives each event sent for this message's id.
export function send(msg, onEvent) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error('Not connected to Home Assistant'));
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    if (onEvent) listeners.set(id, onEvent);
    ws.send(JSON.stringify({ id, ...msg }));
  });
}

// One full state read to find the media players, then a live subscription to just those.
async function subscribe() {
  const states = await send({ type: 'get_states' });
  ha.tts = states.filter((s) => s.entity_id.startsWith('tts.')).map((s) => s.entity_id);
  ha.notify = states.filter((s) => s.entity_id.startsWith('notify.') && s.state !== 'unavailable')
    .map((s) => ({ entity_id: s.entity_id, name: (s.attributes && s.attributes.friendly_name) || s.entity_id }));
  for (const fn of stateHooks) { try { fn(states); } catch (e) { console.error(e); } }
  const ids = states.filter((s) => s.entity_id.startsWith('media_player.')).map((s) => s.entity_id);
  entities.clear();
  if (!ids.length) { ha.players = []; return; }
  await send({ type: 'subscribe_entities', entity_ids: ids });
}

// subscribe_entities sends compact diffs: a = added/full, c = changed (+ set, - removed), r = removed.
// Applies one to `map` (entity_id -> { state, attributes }); the House tab keeps its own map.
export function applyEntityDiff(map, ev) {
  for (const [id, s] of Object.entries(ev.a || {})) map.set(id, { state: s.s, attributes: s.a || {} });
  for (const [id, d] of Object.entries(ev.c || {})) {
    const cur = map.get(id) || { state: null, attributes: {} };
    const attributes = { ...cur.attributes };
    if (d['-'] && d['-'].a) for (const k of d['-'].a) delete attributes[k];
    if (d['+']) { if (d['+'].a) Object.assign(attributes, d['+'].a); }
    map.set(id, { state: d['+'] && d['+'].s !== undefined ? d['+'].s : cur.state, attributes });
  }
  for (const id of ev.r || []) map.delete(id);
}
function applyDiff(ev) {
  applyEntityDiff(entities, ev);
  publish();
}

const isMA = (a) => Object.keys(a).some((k) => k.startsWith('mass_')) || a.app_id === 'music_assistant';

// "hunter_s_bedroom" -> "Hunter's Bedroom", to tell apart speakers that share a name.
const roomName = (entity_id) => entity_id.replace(/^media_player\./, '').replace(/_s_/g, "'s_")
  .split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function publish() {
  let list = [...entities.entries()]
    .filter(([, e]) => e.state !== 'unavailable')
    .map(([entity_id, e]) => ({ entity_id, state: e.state, ...e.attributes, ma: isMA(e.attributes) }));
  // When Music Assistant is in use, show only its speakers (TVs and duplicates are noise here).
  if (list.some((p) => p.ma)) list = list.filter((p) => p.ma);
  const counts = {};
  for (const p of list) counts[p.friendly_name] = (counts[p.friendly_name] || 0) + 1;
  for (const p of list) p.label = counts[p.friendly_name] > 1 ? p.friendly_name + ' · ' + roomName(p.entity_id) : (p.friendly_name || roomName(p.entity_id));
  list.sort((a, b) => ((b.state === 'playing') - (a.state === 'playing')) || a.label.localeCompare(b.label));
  ha.players = list;
}

// A subscription whose events go to onEvent. Resolves to its id, for unsubscribeFrom(id).
export function subscribeTo(msg, onEvent) {
  const id = nextId + 1; // send() takes the next id
  return send(msg, onEvent).then(() => id);
}
export function unsubscribeFrom(id) {
  listeners.delete(id);
  return send({ type: 'unsubscribe_events', subscription: id }).catch(() => {});
}

export function callService(domain, service, data = {}, target = undefined) {
  return send({ type: 'call_service', domain, service, service_data: data, ...(target ? { target } : {}) });
}

// The speaker currently playing something with a title, for the Home and slideshow "now playing".
// With hold, the last one that played stays after you pause (Home keeps the card so you can
// resume), including across page reloads, until another speaker plays, its track is gone, or it
// hasn't played for HOLD_MS. Some speakers report "idle" instead of "paused" soon after a pause.
const HOLD_MS = 30 * 60 * 1000;
let held = localStorage.getItem('frame-np-held');
let lastPlayed = Number(localStorage.getItem('frame-np-at') || 0);

export function nowPlaying({ hold = false, now = Date.now() } = {}) {
  // Spotify's player first: an Echo playing Spotify also reports the song through its own player
  // (Alexa Devices), but only Spotify's knows the playlist.
  const busy = ha.players.filter((x) => x.state === 'playing' && x.media_title);
  const p = busy.find((x) => x.entity_id.startsWith('media_player.spotify_')) || busy[0];
  if (p) {
    // Remember it (saved at most once a minute, or when the speaker changes).
    if (p.entity_id !== held || now - lastPlayed > 60000) {
      held = p.entity_id;
      lastPlayed = now;
      try { localStorage.setItem('frame-np-held', held); localStorage.setItem('frame-np-at', String(lastPlayed)); } catch {}
    }
    return p;
  }
  if (!hold || !held || now - lastPlayed > HOLD_MS) return null;
  const h = ha.players.find((x) => x.entity_id === held);
  return h && (h.state === 'paused' || h.state === 'idle') && h.media_title ? h : null;
}

// Have Home Assistant speak text on a speaker. Prefers Piper (local, private). Speakers that
// support announcements (Music Assistant ones) pause music for it and resume afterwards.
export function announce(text, entity_id) {
  const engine = ha.tts.find((t) => t === 'tts.piper') || ha.tts[0];
  if (!engine) return Promise.reject(new Error('No text-to-speech engine in Home Assistant'));
  return callService('tts', 'speak', { media_player_entity_id: entity_id, message: text, cache: false }, { entity_id: engine });
}
