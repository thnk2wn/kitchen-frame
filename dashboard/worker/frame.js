// The frame's check-in and settings backup. The kiosk can't be reached from outside the home network,
// so it reports to the Worker instead: what it's running and showing, every 10 minutes and on load,
// and a copy of its Settings choices whenever they change. After a reset (a firmware update wiped
// it once) the frame finds its storage empty and takes its settings back from here.
//   POST /api/frame/status    { version, release, webview, kiosk, loadedAt, screen, tab, ha, memory?, timers?, settings?, events? }
//   GET  /api/frame/status    -> the last check-in, with when it arrived and the last 200 events
//                                (scripts/frame-status.sh, --log for the events)
// Events (src/lib/log.svelte.js) are written to the Worker's log one by one, as structured entries
// Cloudflare indexes (Observability → filter source = "frame", or event = "ha.call_failed"), and the
// last 200 are kept with the status, in the same KV write, so logging costs no extra writes.
//   GET  /api/frame/settings  -> { settings, savedAt } for a restore
//   GET  /api/frame/settings?history -> the 10 versions before it, newest first: { savedAt, changes,
//                                settings }, where changes says what the next version changed
// A change to a setting someone chose is also logged as a "settings.changed" event, with what changed
// ("frame-night.on: true → false"), so it shows with the frame's events and on the status page.
// memory comes from kiosk 1.8 (window.FrameKiosk.getMemory, in MB): kept with the status, the app's
// total in each timeline entry, and one data point per check-in in Workers Analytics Engine (the
// METRICS dataset, when bound) for trends past a day: scripts/frame-metrics.sh queries it. Events
// about live video and the frame's stability get a point each too (TRACKED, index "event").
// Kept in KV (the CALENDAR namespace): "frame:status" on each check-in (about 150 writes a day), and
// "frame:settings" only when the settings changed, with "frame:settings:history" when one a person
// chose did. Only the kiosk app checks in, not a browser.
import { roomStore } from './store.js';

const STATUS = 'frame:status';
const SETTINGS = 'frame:settings';
const SETTINGS_HISTORY = 'frame:settings:history';
const KEEP_VERSIONS = 10;
const MAX_SETTINGS = 64 * 1024;
const KEEP_EVENTS = 200;
const KEEP_HISTORY = 170; // a check-in every 10 minutes: a bit over a day
const LEVELS = ['info', 'warn', 'error'];

// An event as the frame sent it, reduced to short strings and numbers.
function cleanEvent(e) {
  if (!e || typeof e !== 'object' || typeof e.event !== 'string') return null;
  const out = {};
  for (const [k, v] of Object.entries(e).slice(0, 16)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 300);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  out.level = LEVELS.includes(out.level) ? out.level : 'info';
  return out;
}

// Settings the frame changes by itself (what was seen, played, the last tab): backed up, but not
// worth a log entry or a version of their own.
const AUTOMATIC = ['frame-notices-seen', 'frame-playlist-played', 'frame-spotify-played', 'frame-settings-tab', 'frame-timer-names', 'frame-tv-apps', 'frame-recipes-mode'];
// Shown only as set, changed or removed: the unlock PIN's hash says nothing useful and is better kept out of logs.
const OPAQUE = ['frame-unlock-pin'];

// A setting's value as flat paths: JSON objects become "key.path" entries, anything else is itself.
function flatten(prefix, value, out) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (!keys.length) out[prefix] = '{}';
    for (const k of keys) flatten(prefix + '.' + k, value[k], out);
  } else out[prefix] = JSON.stringify(value);
  return out;
}
const parsed = (v) => { try { return JSON.parse(v); } catch { return v; } };

// What changed between two backups, in words: ["frame-night.on: true → false", "frame-tv: set"].
export function settingsChanges(before = {}, after = {}) {
  const out = [];
  for (const k of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (AUTOMATIC.includes(k) || before[k] === after[k]) continue;
    if (OPAQUE.includes(k)) { out.push(k + ': ' + (before[k] == null ? 'set' : after[k] == null ? 'removed' : 'changed')); continue; }
    const a = before[k] == null ? {} : flatten(k, parsed(before[k]), {});
    const b = after[k] == null ? {} : flatten(k, parsed(after[k]), {});
    for (const p of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (a[p] === b[p]) continue;
      out.push(p + ': ' + (a[p] === undefined ? 'set to ' + b[p] : b[p] === undefined ? 'removed (was ' + a[p] + ')' : a[p] + ' → ' + b[p]));
    }
  }
  return out;
}

const clip = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
// The kiosk's memory report, numbers only: anything else the page sends is dropped.
const MEMORY_KEYS = ['pss', 'native', 'java', 'avail', 'total', 'upMin', 'bootMin'];
function cleanMemory(m) {
  if (!m || typeof m !== 'object') return undefined;
  const out = {};
  for (const k of MEMORY_KEYS) if (Number.isFinite(m[k]) && m[k] >= 0 && m[k] < 1e7) out[k] = Math.round(m[k]);
  if (typeof m.low === 'boolean') out.low = m.low;
  return Object.keys(out).length ? out : undefined;
}
// The frame's timers (lib/timers.svelte.js), for the phone app's Remote: at most a few, each cut down.
function cleanTimers(list) {
  if (!Array.isArray(list)) return undefined;
  return list.slice(0, 6).filter((t) => t && Number.isFinite(t.end) && Number.isFinite(t.total))
    .map((t) => ({ id: clip(t.id, 20) || '', label: clip(t.label, 40) || 'Timer', end: Math.round(t.end), total: Math.round(t.total), done: t.done === true }));
}
// Events worth following over weeks, one Analytics Engine point each (index "event"): how long live
// video took from opening a camera or a ring (camera.view_live, doorbell.live), each attempt and its route, when it falls back or fails (camera.*, doorbell.ring), and how
// stable the frame is (page loads and their reason, its own reloads, Home Assistant drops, a part that
// failed, the API failing or slow). blobs: event, what it was about (camera, doorbell, reason, path or
// part), level, dashboard build, why/step; double1 its duration in ms (-1 without one; ha.connected's
// downtime), double2 when it happened (epoch seconds: events arrive with the next check-in).
const TRACKED = new Set(['camera.view_live', 'doorbell.live', 'camera.live', 'camera.live_error', 'camera.relay_offline', 'camera.fallback', 'camera.not_playing',
  'camera.no_live', 'camera.ice', 'camera.still', 'camera.still_slow', 'camera.still_failed', 'doorbell.ring',
  'app.load', 'frame.selfreload', 'ha.disconnected', 'ha.connected', 'ui.error', 'api.failed', 'api.slow']);
const MAX_EVENT_POINTS = 200; // Analytics Engine takes up to 250 writes per request; the memory point is one
function writeEventMetrics(env, events, build) {
  if (!env.METRICS) return;
  let n = 0;
  for (const e of events) {
    if (!TRACKED.has(e.event) || e.test || n >= MAX_EVENT_POINTS) continue;
    const about = e.camera || e.doorbell || e.reason || e.path || e.part || '';
    const ms = Number.isFinite(e.ms) ? e.ms : typeof e.downFor === 'string' && /^\d+ s$/.test(e.downFor) ? parseInt(e.downFor, 10) * 1000 : -1;
    const at = Date.parse(e.t);
    try {
      env.METRICS.writeDataPoint({
        indexes: ['event'],
        blobs: [e.event, String(about).slice(0, 100), e.level || 'info', build || '', String(e.why || e.step || e.to || e.via || '').slice(0, 100)],
        doubles: [ms, Number.isFinite(at) ? Math.round(at / 1000) : -1],
      });
      n++;
    } catch (err) { console.warn({ source: 'frame', message: 'metrics write failed', error: String(err) }); return; }
  }
}

// One point per check-in: blobs say what it was running and showing, doubles are the numbers
// (double1 pss … double7 bootMin, in MEMORY_KEYS order; double8 minutes since the page loaded).
function writeMetrics(env, status) {
  if (!env.METRICS || !status.memory) return;
  const m = status.memory;
  const pageMin = status.loadedAt ? Math.max(0, Math.round((Date.parse(status.receivedAt) - Date.parse(status.loadedAt)) / 60000)) : -1;
  try {
    env.METRICS.writeDataPoint({
      indexes: ['frame'],
      blobs: [status.version || '', status.webview || '', status.kiosk || '', status.screen || '', status.tab || '', status.ha || ''],
      doubles: [...MEMORY_KEYS.map((k) => (m[k] == null ? -1 : m[k])), Number.isFinite(pageMin) ? pageMin : -1],
    });
  } catch (e) { console.warn({ source: 'frame', message: 'metrics write failed', error: String(e) }); }
}

// The check-in status lives in the room's store (store.js), not KV: it's written every 10 minutes.
// Without the room (tests), KV.
const statusStore = (env) => (env.MESSAGES ? roomStore(env) : env.CALENDAR);

export async function saveStatus(env, body) {
  const b = body || {};
  const events = (Array.isArray(b.events) ? b.events.slice(-300) : []).map(cleanEvent).filter(Boolean);
  for (const e of events) {
    const line = { source: 'frame', message: 'frame ' + e.event, ...e };
    (e.level === 'error' ? console.error : e.level === 'warn' ? console.warn : console.log)(line);
  }
  const status = {
    version: clip(b.version, 40), release: clip(b.release, 60), webview: clip(b.webview, 40), kiosk: clip(b.kiosk, 40),
    loadedAt: clip(b.loadedAt, 40), screen: clip(b.screen, 20), tab: clip(b.tab, 20), ha: clip(b.ha, 20),
    memory: cleanMemory(b.memory), timers: cleanTimers(b.timers), receivedAt: new Date().toISOString(),
  };
  // The settings first: what a person changed goes into this check-in's events.
  let saveSettings = null, version = null;
  if (b.settings && typeof b.settings === 'object' && !Array.isArray(b.settings)) {
    const settings = Object.fromEntries(Object.entries(b.settings)
      .filter(([k, v]) => /^frame-[a-z0-9-]+$/.test(k) && typeof v === 'string'));
    saveSettings = JSON.stringify({ settings, savedAt: status.receivedAt });
    if (saveSettings.length > MAX_SETTINGS) return { status: 413, body: { error: 'settings too large' } };
    const prev = await env.CALENDAR.get(SETTINGS, 'json');
    const changes = prev ? settingsChanges(prev.settings, settings) : [];
    if (changes.length) {
      const e = { t: status.receivedAt, event: 'settings.changed', level: 'info', changes: changes.join('; ').slice(0, 300), count: changes.length };
      console.log({ source: 'frame', message: 'frame settings.changed', ...e });
      events.push(e);
      version = { savedAt: prev.savedAt, changes: changes.slice(0, 40), settings: prev.settings };
    }
  }
  // Keep the log and a day of check-ins (the status page's timeline) across check-ins.
  const prev = (await getStatus(env)) || {};
  status.log = (prev.log || []).concat(events).slice(-KEEP_EVENTS);
  status.history = (prev.history || []).concat({ t: status.receivedAt, screen: status.screen, ha: status.ha, v: status.version, ...(status.memory ? { m: status.memory.pss } : {}) }).slice(-KEEP_HISTORY);
  writeMetrics(env, status);
  writeEventMetrics(env, events, status.version);
  await statusStore(env).put(STATUS, JSON.stringify(status));
  if (saveSettings) await env.CALENDAR.put(SETTINGS, saveSettings);
  if (version) {
    const versions = (await env.CALENDAR.get(SETTINGS_HISTORY, 'json')) || [];
    await env.CALENDAR.put(SETTINGS_HISTORY, JSON.stringify([version, ...versions].slice(0, KEEP_VERSIONS)));
  }
  return { status: 200, body: { ok: true } };
}

// Until the first check-in after the move, the last one KV kept.
export const getStatus = async (env) => (await statusStore(env).get(STATUS, 'json')) || (env.MESSAGES && (await env.CALENDAR.get(STATUS, 'json'))) || {};
export const getSettings = async (env) => (await env.CALENDAR.get(SETTINGS, 'json')) || { settings: {}, savedAt: null };
export const getSettingsHistory = async (env) => (await env.CALENDAR.get(SETTINGS_HISTORY, 'json')) || [];
