// One read for the status page (ops/, its own Worker behind GitHub sign-in): the frame's check-in,
// its event log and a day of check-ins, and the health of everything behind the dashboard. Counts,
// times and errors rather than content: no event titles, list items or recipe text.
//   GET /api/ops/summary   (dashboard key; the status page calls it over a service binding)
import { getStatus } from './frame.js';
import { listNotices } from './notices.js';
import { listPaprika } from './paprika.js';
import { BRIDGE_LISTS, fromReminders, bridge } from './bridge.js';
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

export async function opsSummary(env, calendarKey) {
  const [frame, cal, notices, paprika, listInfo] = await Promise.all([
    getStatus(env),
    env.CALENDAR.get(calendarKey, 'json'),
    listNotices(env).catch(() => null),
    listPaprika(env).catch((e) => ({ error: String(e.message || e) })),
    lists(env),
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
    spotify: { configured: spotifyConfigured(env) },
  };
}
