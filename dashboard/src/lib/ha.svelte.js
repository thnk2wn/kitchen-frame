// Home Assistant, straight from the frame over its WebSocket API on the home network.
// The URL and token live in the frame's localStorage (set over ADB from dashboard/.frame.vars),
// never in the deployed site or Cloudflare. HA's REST API refuses cross-origin calls; its
// WebSocket API does not, so everything here goes over the socket.
import { limiter } from './limit.js';
import { log } from './log.svelte.js';

export const ha = $state({
  status: 'off',   // off (not set up) | connecting | connected | error
  error: null,
  players: [],     // media players, Music Assistant ones first; TVs have tv: true (and remote, platform)
  tts: [],         // text-to-speech engines (tts.* entities)
  scripts: [],     // script entity ids (the frame looks for script.frame_announce)
  notify: [],      // notify entities [{ entity_id, name }] (e.g. an Echo's "Announce", for timer alerts)
});

// One-time setup from the URL, like ?key=: ?ha_url=…&ha_token=…&ha_dashboard=… are saved, then
// removed from the address bar so the token doesn't linger in it. (Or set them over ADB.)
{
  const q = new URLSearchParams(location.search);
  const keys = { ha_url: 'frame-ha-url', ha_token: 'frame-ha-token', ha_dashboard: 'frame-ha-dashboard', tv_audio: 'frame-tv-audio' };
  let found = false;
  for (const [param, key] of Object.entries(keys)) {
    if (q.has(param)) { found = true; const v = q.get(param); v ? localStorage.setItem(key, v) : localStorage.removeItem(key); q.delete(param); }
  }
  if (found) history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
}

const entities = new Map(); // entity_id -> { state, attributes }
// TVs among the media players, found by their integration (or a "tv" device class), each with the
// remote entity on the same device when there is one (an on-screen remote sends its buttons).
const TV_PLATFORMS = ['apple_tv', 'androidtv', 'androidtv_remote', 'roku', 'webostv', 'samsungtv', 'braviatv', 'vizio', 'philips_js', 'panasonic_viera', 'directv', 'fire_tv'];
let tvInfo = new Map(); // entity_id -> { platform, remote }

// The speaker that plays a TV's sound, for the TV view's volume buttons: TV_AUDIO in .frame.vars,
// "media_player.tv=media_player.soundbar,…". A TV behind a soundbar often can't step its volume
// itself: an Apple TV never knows the level, so Home Assistant reads it as 0 and volume down does
// nothing. A soundbar with its own integration (an Alexa-built-in Bose, a Sonos) reports its level.
export const tvAudio = (() => {
  try {
    return Object.fromEntries(String(localStorage.getItem('frame-tv-audio') || '').split(',')
      .map((pair) => pair.split('=').map((s) => s.trim())).filter(([tv, speaker]) => tv && speaker));
  } catch { return {}; }
})();

// Whether Now Playing (Home's card and the top bar) shows TVs too, or only music. Settings sets it.
export const nowPrefs = $state({ tv: (() => { try { return localStorage.getItem('frame-now-tv') !== 'off'; } catch { return true; } })() });
export function setNowTv(on) { nowPrefs.tv = on; try { localStorage.setItem('frame-now-tv', on ? 'on' : 'off'); } catch {} }
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
  ha.scripts = states.filter((s) => s.entity_id.startsWith('script.')).map((s) => s.entity_id); // e.g. script.frame_announce
  ha.notify = states.filter((s) => s.entity_id.startsWith('notify.') && s.state !== 'unavailable')
    .map((s) => ({ entity_id: s.entity_id, name: (s.attributes && s.attributes.friendly_name) || s.entity_id }));
  for (const fn of stateHooks) { try { fn(states); } catch (e) { console.error(e); } }
  const ids = states.filter((s) => s.entity_id.startsWith('media_player.')).map((s) => s.entity_id);
  // Which players are TVs, and their remotes: from the entity registry (integration and device).
  try {
    const reg = (await send({ type: 'config/entity_registry/list_for_display' })).entities || [];
    const byId = new Map(reg.map((e) => [e.ei, e]));
    const remoteOf = new Map(reg.filter((e) => e.ei.startsWith('remote.') && e.di).map((e) => [e.di, e.ei]));
    tvInfo = new Map();
    for (const s of states) {
      if (!s.entity_id.startsWith('media_player.')) continue;
      const e = byId.get(s.entity_id) || {};
      if (TV_PLATFORMS.includes(e.pl) || (s.attributes && s.attributes.device_class === 'tv')) {
        tvInfo.set(s.entity_id, { platform: e.pl || '', remote: (e.di && remoteOf.get(e.di)) || null });
      }
    }
  } catch (err) { console.error('tv discovery', err); }
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
    .map(([entity_id, e]) => ({ entity_id, state: e.state, ...e.attributes, ma: isMA(e.attributes),
      ...(tvInfo.has(entity_id) ? { tv: true, ...tvInfo.get(entity_id) } : {}) }));
  // When Music Assistant is in use, its speakers are the speakers (others are duplicates); TVs stay.
  if (list.some((p) => p.ma)) list = list.filter((p) => p.ma || p.tv);
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

// A brake on runaway loops (lib/limit.js): the same action on the same entity more than 12 times in
// 2 s, or more than 60 calls in 5 s, is refused for 30 s and reported once as ha.call_flood. The
// volume slider sends at most 4 a second; a loop on 2026-10-15 sent thousands and froze the frame.
const callLimit = limiter({ perKey: 12, perKeyMs: 2000, total: 60, totalMs: 5000 });

// Every call to Home Assistant; failures and slow ones (over 5 s) go to the event log.
export function callService(domain, service, data = {}, target = undefined) {
  const started = Date.now();
  const entity = target && target.entity_id;
  const verdict = callLimit(domain + '.' + service + '|' + (entity || ''));
  if (verdict !== 'ok') {
    if (verdict === 'report') log('ha.call_flood', { action: domain + '.' + service, entity }, 'error');
    return Promise.reject(new Error('Too many calls to ' + domain + '.' + service + ' at once'));
  }
  return send({ type: 'call_service', domain, service, service_data: data, ...(target ? { target } : {}) }).then((r) => {
    const ms = Date.now() - started;
    if (ms > 5000) log('ha.call_slow', { action: domain + '.' + service, entity, ms }, 'warn');
    return r;
  }, (e) => {
    log('ha.call_failed', { action: domain + '.' + service, entity, error: e && e.message, ms: Date.now() - started }, 'error');
    throw e;
  });
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
  const busy = ha.players.filter((x) => x.state === 'playing' && x.media_title && (nowPrefs.tv || !x.tv));
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
  return h && (nowPrefs.tv || !h.tv) && (h.state === 'paused' || h.state === 'idle') && h.media_title ? h : null;
}

// Have Home Assistant speak text on a speaker. Prefers Piper (local, private). Speakers that
// support announcements (Music Assistant ones) pause music for it and resume afterwards.
export function announce(text, entity_id) {
  const engine = ha.tts.find((t) => t === 'tts.piper') || ha.tts[0];
  if (!engine) return Promise.reject(new Error('No text-to-speech engine in Home Assistant'));
  return callService('tts', 'speak', { media_player_entity_id: entity_id, message: text, cache: false }, { entity_id: engine });
}
