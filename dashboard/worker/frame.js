// The frame's check-in and settings backup. The kiosk can't be reached from outside the home network,
// so it reports to the Worker instead: what it's running and showing, every 10 minutes and on load,
// and a copy of its Settings choices whenever they change. After a reset (a firmware update wiped
// it once) the frame finds its storage empty and takes its settings back from here.
//   POST /api/frame/status    { version, webview, kiosk, loadedAt, screen, tab, ha, settings? }
//   GET  /api/frame/status    -> the last check-in, with when it arrived (scripts/frame-status.sh)
//   GET  /api/frame/settings  -> { settings, savedAt } for a restore
// Kept in KV (the CALENDAR namespace): "frame:status" on each check-in (about 150 writes a day) and
// "frame:settings" only when the settings changed. Only the kiosk app checks in, not a browser.
const STATUS = 'frame:status';
const SETTINGS = 'frame:settings';
const MAX_SETTINGS = 64 * 1024;

const clip = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);

export async function saveStatus(env, body) {
  const b = body || {};
  const status = {
    version: clip(b.version, 40), webview: clip(b.webview, 40), kiosk: clip(b.kiosk, 40),
    loadedAt: clip(b.loadedAt, 40), screen: clip(b.screen, 20), tab: clip(b.tab, 20), ha: clip(b.ha, 20),
    receivedAt: new Date().toISOString(),
  };
  await env.CALENDAR.put(STATUS, JSON.stringify(status));
  if (b.settings && typeof b.settings === 'object' && !Array.isArray(b.settings)) {
    const settings = Object.fromEntries(Object.entries(b.settings)
      .filter(([k, v]) => /^frame-[a-z0-9-]+$/.test(k) && typeof v === 'string'));
    const json = JSON.stringify({ settings, savedAt: status.receivedAt });
    if (json.length > MAX_SETTINGS) return { status: 413, body: { error: 'settings too large' } };
    await env.CALENDAR.put(SETTINGS, json);
  }
  return { status: 200, body: { ok: true } };
}

export const getStatus = async (env) => (await env.CALENDAR.get(STATUS, 'json')) || {};
export const getSettings = async (env) => (await env.CALENDAR.get(SETTINGS, 'json')) || { settings: {}, savedAt: null };
