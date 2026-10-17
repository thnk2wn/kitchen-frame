// One read for the status page (ops/, its own Worker behind GitHub sign-in): the frame's check-in,
// its event log and a day of check-ins, and the health of everything behind the dashboard. Counts,
// times and errors rather than content: no event titles, list items or recipe text.
//   GET /api/ops/summary   (dashboard key; the status page calls it over a service binding)
import { getStatus } from './frame.js';
import { listNotices } from './notices.js';
import { listPaprika } from './paprika.js';
import { BRIDGE_LISTS, fromReminders, bridge } from './bridge.js';
import { mediaStorage } from './photos.js';
import { spotifyConfigured } from './spotify.js';

async function lists(env) {
  const out = {};
  for (const list of Object.keys(BRIDGE_LISTS)) {
    if (!fromReminders(env, list)) { out[list] = { source: 'todoist' }; continue; }
    try {
      const v = await (await bridge(env).fetch('https://bridge/view/' + list)).json();
      out[list] = { source: 'reminders', items: (v.items || []).length, pending: (v.items || []).filter((i) => i.pending).length,
        updated: v.updated || null, stale: v.stale || null, waiting: !!v.waiting };
    } catch (e) { out[list] = { source: 'reminders', error: String(e.message || e) }; }
  }
  return out;
}

// The Mac bridge: when it last checked in, what it reports wrong, the camera relay beside it, and
// the calendars and photos it sends (bridge:<name> in CALENDAR_URLS, bridge:<album> in ALBUM_URL).
async function mac(env) {
  const cals = String(env.CALENDAR_URLS || '').split(/[\s,]+/).filter((u) => /^bridge:/i.test(u)).map((u) => decodeURIComponent(u.slice(7)));
  const album = /^bridge:/i.test(env.ALBUM_URL || '') ? decodeURIComponent(env.ALBUM_URL.slice(7)) : null;
  const uses = Object.keys(BRIDGE_LISTS).some((l) => fromReminders(env, l)) || cals.length || album;
  if (!uses) return null;
  const [status, calAt, photos] = await Promise.all([
    bridge(env).fetch('https://bridge/status').then((r) => r.json()).catch(() => null),
    cals.length ? env.CALENDAR.get('bridge-calendars', 'json').then((c) => c && c.at).catch(() => null) : null,
    album ? env.CALENDAR.get('bridge-photos', 'json').catch(() => null) : null,
  ]);
  return {
    seen: status && status.seen ? new Date(status.seen).toISOString() : null,
    problems: (status && status.problems) || [],
    relay: (status && status.relay) || null,
    version: (status && status.version) || null,
    calendars: cals.length ? { names: cals, sent: calAt || null } : null,
    photos: album ? { album, showing: photos ? photos.photos.length : 0, changed: photos && photos.fetched ? new Date(photos.fetched).toISOString() : null,
      storage: await mediaStorage(env).catch(() => null) } : null,
  };
}

export async function opsSummary(env, calendarKey) {
  const [frame, cal, notices, paprika, listInfo, macInfo] = await Promise.all([
    getStatus(env),
    env.CALENDAR.get(calendarKey, 'json'),
    listNotices(env).catch(() => null),
    listPaprika(env).catch((e) => ({ error: String(e.message || e) })),
    lists(env),
    mac(env).catch((e) => ({ error: String(e.message || e) })),
  ]);
  const perCal = {};
  for (const e of (cal && cal.events) || []) perCal[e.cal] = (perCal[e.cal] || 0) + 1;
  return {
    now: new Date().toISOString(),
    frame,
    calendar: cal ? { updated: cal.updated, names: cal.names || [], events: perCal, errors: cal.errors || [] } : null,
    notices: notices ? notices.items.map(({ title, tone, how, created, ended }) => ({ title, tone, how, created, ended })) : [],
    paprika: paprika.configured === false ? { configured: false }
      : { configured: true, updated: paprika.updated || null, recipes: (paprika.recipes || []).length, remaining: paprika.remaining || 0, error: paprika.error },
    lists: listInfo,
    mac: macInfo,
    spotify: { configured: spotifyConfigured(env) },
  };
}
