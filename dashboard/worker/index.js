// Serves the dashboard (static assets) and its API:
//   GET  /api/calendar               merged iCal feeds (cron refreshes them into KV every 10 min)
//   GET  /api/weather                Open-Meteo current + 5-day (see weather.js)
//   GET  /api/radar                  rain radar frames and home's position (see radar.js)
//   GET  /api/lists/:list            Todoist project tasks, list = groceries | todo (see todoist.js)
//   POST /api/lists/:list            { content, description? } adds an item, or { items: [...] } several
//   POST /api/lists/:list/:id        { content?, priority? } edits an item
//   POST /api/lists/:list/:id/done   completes an item
//   GET  /api/photos                 idle-screen photo list from the iCloud shared album (see photos.js)
//   GET  /api/photos/:id             one photo, passed through from iCloud
//   POST /api/messages               an agent posts a full-screen message (AGENT_TOKEN; see messages.js)
//   GET  /api/messages               pending messages for the frame
//   GET  /api/messages/live          WebSocket: messages pushed the moment they change
//   POST /api/messages/:id/dismiss   the frame's X button
//   GET  /api/notices                Home Assistant notices that have ended, for "Earlier" (notices.js)
//   POST /api/notices                the frame reports one as it ends
//   POST /api/frame/status           the kiosk checks in: version, screen, and its settings (frame.js)
//   GET  /api/frame/status           its last check-in;  GET /api/frame/settings  the settings backup
//   POST /api/frame/checkin          asks the frame to check in now, over the messages socket
//   POST /api/frame/reload           asks it to reload the dashboard (it sends its events first)
//   GET  /api/ops/summary            everything the status page shows (ops.js; ops/ is that page)
//   /api/recipes...                  Explore (TheMealDB) and Saved recipes (see recipes.js)
//   /api/recipes/paprika...          our own recipes, synced read-only from Paprika (see paprika.js)
//   GET  /api/meals                  the Paprika meal plan around today (see paprika.js)
//   GET  /api/rotations              who's up early, whose bedtime (ROTATIONS; src/lib/rotations.js)
//   GET  /api/geo?q=                 an event location's coordinates, for its map (see maps.js)
//   GET  /api/tiles/:z/:x/:y         OpenStreetMap tiles, cached
//   GET  /api/spotify/playlists      every Spotify playlist, and when each was last played (spotify.js)
//   GET  /api/spotify/now            what's playing from (a playlist, album, ...) and its cover
//   GET  /api/spotify/queue          the next few songs (Up next)
//
// Secrets (`wrangler secret put`, or .dev.vars locally):
//   CALENDAR_NAMES optional names for the frame's Calendars list, comma-separated, in link order.
//   CALENDAR_COLORS optional colours, comma-separated, in link order: palette names (red, orange,
//                  yellow, green, teal, blue, indigo, purple, pink, brown, gray) or #rrggbb.
//   CALENDAR_DETAILS optional yes/no per calendar, comma-separated, in link order: whether tapping
//                  an event opens its details (with its notes). Notes are only kept for "yes" ones.
//   CALENDAR_URLS  iCal links separated by spaces, commas or newlines. Google "Secret address in
//                  iCal format" and iCloud public calendar links (webcal://) both work. bridge:<name>
//                  instead of a link: the Apple Calendar calendar of that name, sent by the Mac
//                  bridge (bridge/mac/) with its alerts, which iCloud's public links leave out.
//   DASHBOARD_KEY  shared key the frame sends with every API call. Unset = no check (dev only).
//   TODOIST_TOKEN  Todoist API token.
//   ALBUM_URL      iCloud shared album link with Public Website on, or bridge:<album name> for the
//                  Mac bridge to send that shared album's photos, with no public link (photos.js).
//   AGENT_TOKEN    lets AI agents post messages and save recipes; it can't read anything.
//   PAPRIKA_EMAIL, PAPRIKA_PASSWORD  optional: a Paprika Cloud Sync account to show our recipes.
//   GROCERIES_SOURCE, TODO_SOURCE  optional: "reminders" to show that list from Apple Reminders
//                  through a Mac at home instead of Todoist (bridge.js, docs/lists.md), with
//                  REMINDERS_GROCERIES_LIST / REMINDERS_TODO_LIST naming the lists and BRIDGE_TOKEN.
//   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN  optional: all playlists and
//                  their last-played order for the Music tab (scripts/spotify-auth.mjs).
// Optional: DISPLAY_TZ  IANA zone for times with no TZID and no X-WR-TIMEZONE (default UTC).
import { expand, fromBridge, merge, splitNotes } from './calendar.js';
import { getWeather } from './weather.js';
import { getRadar } from './radar.js';
import { LISTS, getList, addItem, updateItem, completeItem } from './todoist.js';
import { listPhotos, photoResponse, bridgeAlbum, bridgePhotoList, bridgePhotoUpload } from './photos.js';
import { room } from './messages.js';
import { listNotices, addNotice } from './notices.js';
import { saveStatus, getStatus, getSettings, getSettingsHistory } from './frame.js';
import { opsSummary } from './ops.js';
export { MessageRoom } from './messages.js'; // Durable Object class (wrangler.jsonc)
export { ListBridge } from './bridge.js';      // Durable Object class: Apple Reminders through a Mac
import { explore, listSaved, saveRecipe, deleteRecipe, recipeImage, moveToPaprika } from './recipes.js';
import { geocode, tile } from './maps.js';
import { spotifyConfigured, getPlaylists, getNow, getQueue } from './spotify.js';
import { level, BRIDGE_LISTS, fromReminders, remindersName, bridge } from './bridge.js';

// An edit from the frame's item sheet: a new title and/or priority (0 clears it).
const editOf = (b) => ({
  ...(String((b && b.content) || '').trim() ? { content: String(b.content).trim().slice(0, 500) } : {}),
  ...(b && b.priority !== undefined ? { priority: level(b.priority) } : {}),
});
import { syncPaprika, listPaprika, getPaprika, paprikaImage, listMeals } from './paprika.js';

const KEY = 'calendar';
const DAY = 864e5;
const DAYS_AHEAD = 70;  // Calendar: five weeks of week view, and month view through next month
const DAYS_BACK = 40;   // month view shows the whole current month, so include its earlier days
// The cron refreshes the calendar every 10 minutes but only writes KV when it changed, or hourly
// (so `updated` stays meaningful). Requests refresh it themselves only if the cron has fallen behind.
const HEARTBEAT_MS = 60 * 60 * 1000;
const STALE_MS = 75 * 60 * 1000;
const PAPRIKA_CRON = '*/15 * * * *'; // must match wrangler.jsonc

export default {
  // Every response to the frame's key also carries the cookie images and the live messages socket
  // authenticate with (see authorized()), set once and refreshed when missing.
  async fetch(req, env, ctx) {
    return withAuthCookie(req, env, await handle(req, env, ctx));
  },

  async scheduled(controller, env) {
    return scheduled(controller, env);
  },
};

async function handle(req, env, ctx) {
  {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) {
      const res = await env.ASSETS.fetch(req);
      // A built file that isn't there must never be cached. public/_headers marks everything under
      // /assets/ as kept forever (right for real files, whose names change with each build), and
      // Cloudflare applied that to a 404 too: the frame asked for a new build's script a moment
      // before it was everywhere, kept the 404, and couldn't start again until a rollback
      // (2026-10-16). So a missing one is no-store.
      if (url.pathname.startsWith('/assets/') && !res.ok) {
        const miss = new Response(res.body, res);
        miss.headers.set('Cache-Control', 'no-store');
        return miss;
      }
      if (!(res.headers.get('Content-Type') || '').includes('text/html')) return res;
      // Never cache the page, or the frame keeps running an old build after a deploy.
      const page = new Response(res.body, res);
      page.headers.set('Cache-Control', 'no-store');
      return page;
    }
    // Agents post with their own token, which opens this one route and nothing else.
    if (url.pathname === '/api/messages' && req.method === 'POST') {
      if (!env.AGENT_TOKEN || req.headers.get('Authorization') !== 'Bearer ' + env.AGENT_TOKEN) return json({ error: 'unauthorized' }, 401);
      return room(env).fetch('https://room/post', { method: 'POST', body: await req.text() });
    }
    // The Mac that bridges Apple Reminders (bridge/mac/) has its own token, for these routes only.
    if (url.pathname.startsWith('/api/bridge/')) {
      if (!env.BRIDGE_TOKEN || req.headers.get('Authorization') !== 'Bearer ' + env.BRIDGE_TOKEN) return json({ error: 'unauthorized' }, 401);
      const what = url.pathname.slice('/api/bridge/'.length);
      if (what === 'config') {
        // extras: also read sections, flags and assignees from the Reminders database (docs/lists.md).
        const extras = /^(on|yes|true|1)$/i.test(String(env.REMINDERS_EXTRAS || '').trim());
        // calendars: the bridge:<name> entries in CALENDAR_URLS, with whether to send their notes.
        const cals = bridgeCalendars(env);
        return json({ lists: Object.fromEntries(Object.keys(BRIDGE_LISTS).filter((l) => fromReminders(env, l)).map((l) => [l, remindersName(env, l)])), ...(extras ? { extras: true } : {}),
          ...(cals.length ? { calendars: Object.fromEntries(cals.map((c) => [c.name, { notes: c.notes }])), window: { back: DAYS_BACK, ahead: DAYS_AHEAD } } : {}),
          // photos: the shared album to send, and the sizes to send it at (a landscape fills the
          // 1920-wide screen, a portrait half of it, as they show in pairs).
          ...(bridgeAlbum(env) ? { photos: { album: bridgeAlbum(env), landscape: 1920, portrait: 960 } } : {}) });
      }
      if (what === 'photos' && req.method === 'POST') return json(await bridgePhotoList(env, await req.json().catch(() => ({}))));
      if (what.startsWith('photos/') && req.method === 'PUT') {
        const { status, body } = await bridgePhotoUpload(env, what.slice(7), await req.arrayBuffer());
        return json(body, status);
      }
      if (what === 'snapshot' && req.method === 'POST') {
        let body;
        try { body = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }
        // Calendars come only when they changed (or hourly): kept in KV for the calendar refresh,
        // which runs at once so the frame sees the change within a minute.
        if (body.calendars && typeof body.calendars === 'object') {
          const wanted = new Set(bridgeCalendars(env).map((c) => c.name));
          const calendars = Object.fromEntries(Object.entries(body.calendars).filter(([n, l]) => wanted.has(n) && Array.isArray(l)).map(([n, l]) => [n, l.slice(0, 5000)]));
          await env.CALENDAR.put(BRIDGE_CAL_KEY, JSON.stringify({ at: new Date().toISOString(), calendars }));
          ctx.waitUntil(env.CALENDAR.get(KEY, 'json').then((prev) => updateCalendar(env, prev)));
        }
        delete body.calendars;
        return bridge(env).fetch('https://bridge/snapshot', { method: 'POST', body: JSON.stringify(body) });
      }
      if (what === 'live') return bridge(env).fetch(new Request('https://bridge/live', req));
      return json({ error: 'not found' }, 404);
    }
    // Agents may also save recipes with their token (the frame saves with its own key).
    const agent = env.AGENT_TOKEN && req.headers.get('Authorization') === 'Bearer ' + env.AGENT_TOKEN;
    if (url.pathname === '/api/recipes' && req.method === 'POST' && agent) {
      const { status, body } = await saveRecipe(env, await req.json().catch(() => ({})), ctx);
      return json(body, status);
    }
    if (!(await authorized(req, env))) return json({ error: 'unauthorized' }, 401);

    try {
      if (url.pathname === '/api/calendar') {
        const stored = await env.CALENDAR.get(KEY, 'json');
        if (!stored || url.searchParams.has('refresh')) return json(await updateCalendar(env, stored));
        // Stale: answer from the copy now, bring it up to date for the next poll.
        if (Date.now() - Date.parse(stored.updated) > STALE_MS) ctx.waitUntil(updateCalendar(env, stored));
        return json(stored);
      }
      if (url.pathname === '/api/weather') return json(await getWeather(env));
      if (url.pathname === '/api/radar') return json(await getRadar(env));
      if (url.pathname === '/api/spotify/playlists') {
        if (!spotifyConfigured(env)) return json({ configured: false });
        try { return json({ configured: true, ...(await getPlaylists(env)) }); }
        catch (err) { return json({ configured: true, error: String(err.message || err) }, 502); }
      }
      if (url.pathname === '/api/spotify/now') {
        if (!spotifyConfigured(env)) return json({ configured: false });
        try { return json({ configured: true, ...(await getNow(env)) }); }
        catch (err) { return json({ configured: true, error: String(err.message || err) }, 502); }
      }
      if (url.pathname === '/api/spotify/queue') {
        if (!spotifyConfigured(env)) return json({ configured: false });
        try { return json({ configured: true, ...(await getQueue(env)) }); }
        catch (err) { return json({ configured: true, error: String(err.message || err) }, 502); }
      }
      if (url.pathname === '/api/geo') {
        try { return json({ place: await geocode(env, url.searchParams.get('q')) }, 200, 'private, max-age=86400'); }
        catch (err) { return json({ place: null, error: String(err.message || err) }); } // not cached; tried again next open
      }
      const t = /^\/api\/tiles\/(\d+)\/(\d+)\/(\d+)$/.exec(url.pathname);
      if (t) return tile(+t[1], +t[2], +t[3], ctx);
      if (url.pathname === '/api/photos') {
        if (!env.ALBUM_URL) return json({ photos: [], error: 'Add ALBUM_URL to show photos' });
        return json(await listPhotos(env, ctx));
      }
      if (url.pathname.startsWith('/api/photos/')) return photoResponse(env, url.pathname.slice('/api/photos/'.length), ctx);
      if (url.pathname === '/api/messages' && req.method === 'GET') return room(env).fetch('https://room/list');
      if (url.pathname === '/api/notices' && req.method === 'GET') return json(await listNotices(env));
      if (url.pathname === '/api/frame/status' && req.method === 'POST') {
        const { status, body } = await saveStatus(env, await req.json().catch(() => ({})));
        return json(body, status);
      }
      // Ask the frame to check in now, over its live connection (scripts/frame-status.sh --now).
      if (url.pathname === '/api/frame/checkin' && req.method === 'POST') return room(env).fetch('https://room/command', { method: 'POST', body: JSON.stringify({ command: 'checkin' }) });
      if (url.pathname === '/api/frame/reload' && req.method === 'POST') return room(env).fetch('https://room/command', { method: 'POST', body: JSON.stringify({ command: 'reload' }) });
      if (url.pathname === '/api/frame/status') return json(await getStatus(env));
      if (url.pathname === '/api/frame/settings') return json(url.searchParams.has('history') ? await getSettingsHistory(env) : await getSettings(env));
      if (url.pathname === '/api/ops/summary') return json(await opsSummary(env, KEY));
      if (url.pathname === '/api/notices' && req.method === 'POST') {
        const { status, body } = await addNotice(env, await req.json().catch(() => ({})));
        return json(body, status);
      }
      if (url.pathname === '/api/messages/live') return room(env).fetch(new Request('https://room/live', req));
      if (url.pathname === '/api/recipes/explore') {
        // TheMealDB barely changes: let the frame's own HTTP cache answer repeat visits for a day
        // (no Worker request at all). Random picks are never cached.
        const random = url.searchParams.has('random');
        return json(await explore(url.searchParams), 200, random ? 'no-store' : 'private, max-age=86400');
      }
      if (url.pathname === '/api/meals' && req.method === 'GET') return json(await listMeals(env));
      if (url.pathname === '/api/rotations') return json({ rotations: rotations(env) });
      // The camera relay on the home network (bridge/camera-relay/): CAMERA_RELAY, a secret,
      // holds one or more addresses of the same relay, space-separated, each
      // http://<host>:1985/<token>/?cameras=<name>,<name>. The frame uses whichever answers.
      if (url.pathname === '/api/camera-relay') return json({ relays: String(env.CAMERA_RELAY || '').split(/[\s,]+(?=https?:)/).map((s) => s.trim()).filter(Boolean) });
      if (url.pathname === '/api/recipes/paprika' && req.method === 'GET') {
        if (url.searchParams.has('sync')) await syncPaprika(env);
        return json(await listPaprika(env));
      }
      const pap = /^\/api\/recipes\/paprika\/([\w-]+)(\/image)?$/.exec(url.pathname);
      if (pap && req.method === 'GET') {
        if (pap[2]) return paprikaImage(env, pap[1], url.searchParams.get('w'));
        const recipe = await getPaprika(env, pap[1]);
        return recipe ? json({ recipe }) : json({ error: 'not found' }, 404);
      }
      if (url.pathname === '/api/recipes' && req.method === 'GET') return json(await listSaved(env));
      if (url.pathname === '/api/recipes' && req.method === 'POST') {
        const { status, body } = await saveRecipe(env, await req.json().catch(() => ({})), ctx);
        return json(body, status);
      }
      const move = /^\/api\/recipes\/([\w-]+)\/paprika$/.exec(url.pathname);
      if (move && req.method === 'POST') { const { status, body } = await moveToPaprika(env, move[1], ctx); return json(body, status); }
      const recipe = /^\/api\/recipes\/([\w-]+)(\/image)?$/.exec(url.pathname);
      if (recipe && recipe[2] && req.method === 'GET') return recipeImage(env, recipe[1]);
      if (recipe && !recipe[2] && req.method === 'DELETE') return json(await deleteRecipe(env, recipe[1]));
      const dismiss = /^\/api\/messages\/([\w-]+)\/dismiss$/.exec(url.pathname);
      if (dismiss && req.method === 'POST') return room(env).fetch('https://room/dismiss/' + dismiss[1], { method: 'POST' });

      const [, , section, list, id, action] = url.pathname.split('/');
      if (section === 'lists' && list in LISTS && fromReminders(env, list)) {
        // This list comes from Apple Reminders through the Mac (bridge.js), not Todoist.
        const b = bridge(env);
        if (req.method === 'GET' && !id) return b.fetch('https://bridge/view/' + list);
        if (req.method === 'POST' && !id) {
          const body = await req.json();
          const items = (Array.isArray(body.items) ? body.items : [body]).slice(0, 40);
          return b.fetch('https://bridge/add/' + list, { method: 'POST', body: JSON.stringify({ items }) });
        }
        if (req.method === 'POST' && id && action === 'done') return b.fetch('https://bridge/done/' + list + '/' + encodeURIComponent(id), { method: 'POST' });
        if (req.method === 'POST' && id && !action) return b.fetch('https://bridge/update/' + list + '/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify(editOf(await req.json())) });
      }
      if (section === 'lists' && list in LISTS) {
        if (!env.TODOIST_TOKEN) return json({ error: 'Add TODOIST_TOKEN to connect Todoist' }, 503);
        if (req.method === 'GET' && !id) return json(await getList(env, list));
        if (req.method === 'POST' && !id) {
          const body = await req.json();
          const clean = (x) => ({ content: String((x && x.content) || '').trim().slice(0, 500), description: String((x && x.description) || '').trim().slice(0, 500), priority: level(x && x.priority) });
          if (Array.isArray(body.items)) {
            // Several at once (recipe ingredients): added in parallel, up to 40.
            const items = body.items.map(clean).filter((x) => x.content).slice(0, 40);
            if (!items.length) return json({ error: 'items required' }, 400);
            return json({ items: await Promise.all(items.map((x) => addItem(env, list, x.content, x.description, x.priority))) });
          }
          const one = clean(body);
          if (!one.content) return json({ error: 'content required' }, 400);
          return json(await addItem(env, list, one.content, one.description, one.priority));
        }
        if (req.method === 'POST' && id && action === 'done') return json(await completeItem(env, id));
        if (req.method === 'POST' && id && !action) return json(await updateItem(env, id, editOf(await req.json())));
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.error(url.pathname, err);
      return json({ error: String(err.message || err) }, 502);
    }
  }
}

// ROTATIONS: a JSON list (a secret, so household names stay out of the repo). Unset or unreadable: none.
function rotations(env) {
  if (!env.ROTATIONS) return [];
  try { const r = JSON.parse(env.ROTATIONS); return Array.isArray(r) ? r : []; }
  catch { console.warn({ source: 'worker', message: 'ROTATIONS is not valid JSON' }); return []; }
}

async function scheduled(controller, env) {
  {
    // Paprika has its own cron so its requests and CPU don't share a run with the calendar's.
    if (controller.cron === PAPRIKA_CRON) {
      const r = await syncPaprika(env);
      console.log('cron ' + controller.cron + ': paprika ' + JSON.stringify(r));
      return;
    }
    const data = await updateCalendar(env, await env.CALENDAR.get(KEY, 'json'));
    console.log('cron ' + controller.cron + ': ' + data.events.length + ' events, ' + data.errors.length + ' errors');
  }
}

// Fetches the feeds and stores the result when the events or errors changed, or hourly.
async function updateCalendar(env, previous) {
  const data = await refresh(env, previous);
  const pick = (d) => JSON.stringify([d.events, d.errors, d.names, d.colors, d.details, d.notes]);
  const same = previous && pick(previous) === pick(data);
  if (!same || Date.now() - Date.parse(previous.updated) > HEARTBEAT_MS) await env.CALENDAR.put(KEY, JSON.stringify(data));
  return data;
}

// The calendars CALENDAR_URLS takes from the Mac bridge (bridge:<name>), with their index there and
// whether their notes are wanted (CALENDAR_DETAILS).
const BRIDGE_CAL_KEY = 'bridge-calendars';
const BRIDGE_CAL_STALE_MS = 3 * 60 * 60 * 1000; // the Mac resends at least hourly
function bridgeCalendars(env) {
  const urls = String(env.CALENDAR_URLS || '').split(/[\s,]+/).filter(Boolean);
  const details = String(env.CALENDAR_DETAILS || '').split(',');
  return urls.map((u, cal) => ({ cal, name: /^bridge:/i.test(u) ? decodeURIComponent(u.slice(7)) : null, notes: /^(yes|y|true|on)$/i.test((details[cal] || '').trim()) }))
    .filter((c) => c.name);
}

async function refresh(env, previous) {
  const urls = String(env.CALENDAR_URLS || '').split(/[\s,]+/).filter(Boolean);
  // What the Mac bridge last sent, for bridge:<name> calendars (read once for all of them).
  const fromMac = urls.some((u) => /^bridge:/i.test(u)) ? await env.CALENDAR.get(BRIDGE_CAL_KEY, 'json') : null;
  const now = Date.now(), from = now - DAYS_BACK * DAY, to = now + DAYS_AHEAD * DAY;
  const tz = env.DISPLAY_TZ || 'UTC';
  const errors = [];
  const names = [];
  // CALENDAR_DETAILS (optional, same order): which calendars' events open with their notes.
  const details = env.CALENDAR_DETAILS ? urls.map((_, i) => /^(yes|y|true|on)$/i.test((String(env.CALENDAR_DETAILS).split(',')[i] || '').trim())) : null;

  const lists = await Promise.all(urls.map(async (link, cal) => {
    try {
      if (/^bridge:/i.test(link)) {
        const name = decodeURIComponent(link.slice(7));
        names[cal] = name;
        const list = fromMac?.calendars?.[name];
        if (!list) throw new Error('nothing from the Mac bridge yet for "' + name + '"');
        // Old but kept: the frame shows them, and the status page says the Mac has gone quiet.
        if (now - Date.parse(fromMac.at) > BRIDGE_CAL_STALE_MS) errors.push({ cal, error: 'the Mac bridge last sent this calendar ' + fromMac.at });
        return fromBridge(list, cal, from, to, { notes: !!details?.[cal] });
      }
      // Some feeds (Sidearm sports sites, say) refuse anything that doesn't look like a browser.
      const res = await fetch(link.replace(/^webcal:/i, 'https:'), { headers: { Accept: 'text/calendar', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (!text.includes('BEGIN:VCALENDAR')) throw new Error('not an iCal feed');
      // The feed's own name (X-WR-CALNAME), for the frame's show/hide list.
      const named = /\nX-WR-CALNAME:([^\r\n]+)/.exec(text);
      names[cal] = named ? named[1].trim() : null;
      const events = expand(text, cal, from, to, tz, { notes: !!details?.[cal] });
      // Holiday feeds (Google's or Apple's) are marked, so the frame can leave them out of counts.
      if (/holiday/i.test(link)) for (const e of events) e.holiday = true;
      return events;
    } catch (err) {
      // Keep this calendar's last good events so a blip doesn't blank the wall display.
      // Without the link itself: a feed's URL is its secret (fetch errors can quote it).
      errors.push({ cal, error: String(err.message || err).replace(/(?:https?|webcal):\/\/\S+/gi, '<link>') });
      names[cal] = previous?.names?.[cal] ?? null;
      console.error('calendar ' + cal + ' failed: ' + errors[errors.length - 1].error);
      return (previous?.events || []).filter((e) => e.cal === cal)
        .map((e) => ({ ...e, startMs: Date.parse(e.start), ...(details?.[cal] && previous.notes?.[e.uid] ? { notes: previous.notes[e.uid] } : {}) }));
    }
  }));

  // CALENDAR_NAMES (optional, comma-separated, same order as the links) overrides the feeds' names.
  const custom = String(env.CALENDAR_NAMES || '').split(',').map((x) => x.trim());
  // CALENDAR_COLORS (optional, same order): the frame's colour per calendar; unset ones rotate.
  const colors = env.CALENDAR_COLORS ? String(env.CALENDAR_COLORS).split(',').map((x) => x.trim()) : null;
  const events = merge(lists);
  const notes = splitNotes(events);
  return { updated: new Date(now).toISOString(), calendars: urls.length, names: urls.map((_, i) => custom[i] || names[i] || null),
    colors: colors ? urls.map((_, i) => colors[i] || null) : undefined, details: details || undefined,
    notes: Object.keys(notes).length ? notes : undefined, errors, events };
}

// The frame sends its key as a header. <img> and WebSocket can't, so those GETs authenticate with a
// cookie instead: an HMAC of the key (not the key), HttpOnly, Secure, SameSite=Strict, set on any
// response to a request that had the key. That keeps the key out of URLs, and so out of request
// logs and caches. (A key in the URL, ?key=, how they used to do it, is no longer accepted.)
const AUTH_COOKIE = 'frame_auth';
const mediaPath = (p) => p.startsWith('/api/photos/') || p.startsWith('/api/videos/') || p.startsWith('/api/tiles/') || p === '/api/messages/live' || /^\/api\/recipes\/(paprika\/)?[\w-]+\/image$/.test(p);
// Constant-time comparison, so a key or cookie can't be guessed a character at a time.
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const hasKey = (req, env) => same(req.headers.get('Authorization') || '', 'Bearer ' + env.DASHBOARD_KEY);

async function cookieValue(env) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.DASHBOARD_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('kitchen-frame auth cookie v1')));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const cookieOf = (req) => (/(?:^|;\s*)frame_auth=([^;]+)/.exec(req.headers.get('Cookie') || '') || [])[1] || null;

async function authorized(req, env) {
  // No key set: refused, unless local development says otherwise (ALLOW_NO_KEY=1 in .dev.vars only),
  // so a key lost in a rotation can't leave the API open.
  if (!env.DASHBOARD_KEY) return env.ALLOW_NO_KEY === '1';
  if (hasKey(req, env)) return true;
  const url = new URL(req.url);
  if (req.method !== 'GET' || !mediaPath(url.pathname)) return false;
  return same(cookieOf(req) || '', await cookieValue(env));
}

async function withAuthCookie(req, env, res) {
  if (!env.DASHBOARD_KEY || !hasKey(req, env) || res.status === 101 || res.webSocket) return res;
  const value = await cookieValue(env);
  if (cookieOf(req) === value) return res;
  const out = new Response(res.body, res);
  out.headers.append('Set-Cookie', AUTH_COOKIE + '=' + value + '; Path=/api; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict');
  return out;
}

function json(body, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
  });
}
