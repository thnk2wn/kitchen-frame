// The frame's check-in and settings backup. The kiosk can't be reached from outside the home network,
// so it reports to the Worker instead: what it's running and showing, every 10 minutes and on load,
// and a copy of its Settings choices whenever they change. After a reset (a firmware update wiped
// it once) the frame finds its storage empty and takes its settings back from here.
//   POST /api/frame/status    { version, webview, kiosk, loadedAt, screen, tab, ha, settings?, events? }
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
// Kept in KV (the CALENDAR namespace): "frame:status" on each check-in (about 150 writes a day), and
// "frame:settings" only when the settings changed, with "frame:settings:history" when one a person
// chose did. Only the kiosk app checks in, not a browser.
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

export async function saveStatus(env, body) {
  const b = body || {};
  const events = (Array.isArray(b.events) ? b.events.slice(-300) : []).map(cleanEvent).filter(Boolean);
  for (const e of events) {
    const line = { source: 'frame', message: 'frame ' + e.event, ...e };
    (e.level === 'error' ? console.error : e.level === 'warn' ? console.warn : console.log)(line);
  }
  const status = {
    version: clip(b.version, 40), webview: clip(b.webview, 40), kiosk: clip(b.kiosk, 40),
    loadedAt: clip(b.loadedAt, 40), screen: clip(b.screen, 20), tab: clip(b.tab, 20), ha: clip(b.ha, 20),
    receivedAt: new Date().toISOString(),
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
  const prev = (await env.CALENDAR.get(STATUS, 'json')) || {};
  status.log = (prev.log || []).concat(events).slice(-KEEP_EVENTS);
  status.history = (prev.history || []).concat({ t: status.receivedAt, screen: status.screen, ha: status.ha, v: status.version }).slice(-KEEP_HISTORY);
  await env.CALENDAR.put(STATUS, JSON.stringify(status));
  if (saveSettings) await env.CALENDAR.put(SETTINGS, saveSettings);
  if (version) {
    const versions = (await env.CALENDAR.get(SETTINGS_HISTORY, 'json')) || [];
    await env.CALENDAR.put(SETTINGS_HISTORY, JSON.stringify([version, ...versions].slice(0, KEEP_VERSIONS)));
  }
  return { status: 200, body: { ok: true } };
}

export const getStatus = async (env) => (await env.CALENDAR.get(STATUS, 'json')) || {};
export const getSettings = async (env) => (await env.CALENDAR.get(SETTINGS, 'json')) || { settings: {}, savedAt: null };
export const getSettingsHistory = async (env) => (await env.CALENDAR.get(SETTINGS_HISTORY, 'json')) || [];
