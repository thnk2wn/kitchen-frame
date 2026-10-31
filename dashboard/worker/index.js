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
//   GET  /api/photos?demo, /api/photos/demo-:n   demo mode's stock photos (demo-photos.js)
//   GET  /api/podcasts               Apple Podcasts shows and episodes, through the Mac bridge (podcasts.js)
//   POST /api/alexa/heard            what an Echo heard (Home Assistant's voice events, via the frame): alexa-log.js
//   POST /api/podcasts/cast, GET /api/podcasts/now   an episode for an Echo, and what it's playing (podcast-audio.js)
//   GET  /api/demo                   demo mode's Media: shown names (DEMO_NAMES), public playlists (demo-media.js)
//   POST /api/messages               an agent posts a full-screen message (AGENT_TOKEN; see messages.js)
//   GET  /api/messages               pending messages for the frame
//   GET  /api/messages/live          WebSocket: messages pushed the moment they change
//   POST /api/messages/:id/dismiss   the frame's X button
//   GET  /api/notices                Home Assistant notices that have ended, for "Earlier" (notices.js)
//   POST /api/notices                the frame reports one as it ends
//   POST /api/frame/status           the kiosk checks in: version, screen, and its settings (frame.js)
//   GET  /api/frame/status           its last check-in;  GET /api/frame/settings  the settings backup
//   POST /api/frame/checkin          asks the frame to check in now, over the messages socket
//   POST /api/frame/demo             the frame's demo mode on or off, for Alexa (alexa.js)
//   POST /api/frame/reload           asks it to reload the dashboard (it sends its events first)
//   POST /api/frame/restart          asks it to restart the kiosk app (1.12+; an older one reloads)
//   POST /api/share/media            a photo or video from the phone app, shown on the frame (shared-media.js)
//   GET  /api/share/media/:id        that photo or video
//   POST /api/frame/command          { command: show|slideshow|wake|close|playgroup|timer, tab?, group?,
//                                      action?, label?, seconds?, id? } (the phone app; timer: start|cancel|add)
//   /api/frame/screenshot...         the frame's screen, for the phone app (screenshot.js)
//   GET  /api/frame/home             { home }: is the caller on the frame's network (home.js); ?why adds
//                                    { you, frame }: the networks it compared
//   GET  /api/ops/summary            everything the status page shows (ops.js; ops/ is that page)
//   GET, POST, DELETE /api/fitness   Activity rings and workouts, sent by each person's phone (fitness.js)
//   GET, POST /api/frame/guest       guest mode: nothing personal on the frame (guest.js)
//   GET, POST /api/frame/timers      { timers, at, recents }: the frame's timers, sent as they change, for the phone,
//                                    and the names and lengths used lately
//   DELETE /api/frame/timers/recents { label, seconds }: forget one of the recents ({ all: true }: all of them)
//   /api/recipes...                  Explore (TheMealDB) and Saved recipes (see recipes.js)
//   /api/recipes/paprika...          our own recipes, synced read-only from Paprika (see paprika.js)
//   GET  /api/meals                  the Paprika meal plan around today (see paprika.js)
//   POST /api/meals/sync             fetch the meal plan from Paprika now (Meals' Refresh), and answer with it
//   GET  /api/meals/groceries        a shopping list for the week's meals, made by Workers AI (see meal-groceries.js)
//   GET  /api/rotations              who's up early, whose bedtime (ROTATIONS; src/lib/rotations.js)
//   GET  /api/geo?q=                 an event location's coordinates, for its map (see maps.js)
//   GET  /api/tiles/:z/:x/:y         OpenStreetMap tiles, cached
//   GET  /api/staticmap?lat&lon&w&h&z Google's map picture of a place (maps.js), when GOOGLE_MAPS_KEY is set
//   GET  /api/gtiles/:z/:x/:y        Google's street map tiles (maps.js), for the radar and the full map
//   GET  /api/gtiles/credit?z&n&s&e&w Google's map data credit for a view
//   GET  /api/drive?q=&at=          { drive: { minutes, usual } | null }: from home to an event's place
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
//   CALENDAR_REFRESH optional hours per calendar, comma-separated, in link order: fetch that feed at
//                  most that often (blank: every 10 minutes). For feeds that barely change, or a
//                  site that refuses frequent fetches from a cloud server (calendar-feeds, below).
//   DASHBOARD_KEY  the admin key: setup and scripts; each device has its own (devices.js). Unset = refused (ALLOW_NO_KEY=1 for dev).
//   TODOIST_TOKEN  Todoist API token.
//   YOUTUBE_VIDEOS optional: groups of YouTube videos and playlists for Media → Videos (youtube.js),
//                  with YOUTUBE_API_KEY optional for whole playlists.
//   ALBUM_URL      iCloud shared album link with Public Website on, or bridge:<album name> for the
//                  Mac bridge to send that shared album's photos, with no public link (photos.js).
//   AGENT_TOKEN    lets AI agents post messages and save recipes; it can't read anything.
//   SHARE_TOKEN    optional: lets a phone's share sheet play a YouTube video on the frame
//                  (POST /api/share/play), and nothing else.
//   PODCASTS       optional: "bridge" for Media → Podcasts from the Apple Podcasts library on the Mac
//                  bridge (podcasts.js).
//   DEMO_NAMES     optional: JSON of real -> shown names for demo mode's live Media tab (demo-media.js),
//                  with DEMO_PLAYLISTS (public Spotify playlist links) for its Music row.
//   ALEXA_SKILL_ID optional: the id of your own Alexa skill (POST /api/alexa, alexa.js, docs/alexa.md),
//                  with ALEXA_USER_IDS to allow only those Amazon accounts.
//   PAPRIKA_EMAIL, PAPRIKA_PASSWORD  optional: a Paprika Cloud Sync account to show our recipes.
//   GROCERIES_SOURCE, TODO_SOURCE  optional: "reminders" to show that list from Apple Reminders
//                  through a Mac at home instead of Todoist (bridge.js, docs/lists.md), with
//                  REMINDERS_GROCERIES_LIST / REMINDERS_TODO_LIST naming the lists and BRIDGE_TOKEN.
//   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN  optional: all playlists and
//                  their last-played order for the Music tab (scripts/spotify-auth.mjs).
// Optional: DISPLAY_TZ  IANA zone for times with no TZID and no X-WR-TIMEZONE (default UTC).
import { listFitness, saveFitness, removeFitness } from './fitness.js';
import { guestMode, setGuestMode } from './guest.js';
import { expand, fromBridge, merge, splitNotes, splitLinks } from './calendar.js';
import { getWeather } from './weather.js';
import { getRadar } from './radar.js';
import { LISTS, getList, addItem, updateItem, completeItem } from './todoist.js';
import { listPhotos, photoResponse, bridgeAlbum, bridgePhotoList, bridgePhotoUpload, bridgeVideoUpload, videoResponse } from './photos.js';
import { room } from './messages.js';
import { screenshotRoute } from './screenshot.js';
import { tooBig, rateKey, overLimit } from './limits.js';
import { cspPolicy, cspReport } from './csp.js';
import { atHome, homeCheck, homeOnly, noteHome } from './home.js';
import { TOKEN_PREFIX, allowed, deviceById, deviceForToken, devicesApi, fitnessAllowed } from './devices.js';
import { listNotices, addNotice } from './notices.js';
import { saveStatus, getStatus, getSettings, getSettingsHistory, cleanTimers } from './frame.js';
import { opsSummary } from './ops.js';
import { listVideos, thumbResponse, videoIdOf, videoTitle, parseSetting } from './youtube.js';
import { tvArtResponse } from './tvart.js';
import { handleAlexa } from './alexa.js';
import { addLog, heardEntry, readLog } from './alexa-log.js';
import { demoPhotos, demoPhotoResponse, demoCamResponse } from './demo-photos.js';
import { demoMedia } from './demo-media.js';
import { podcastsOn, savePodcasts, listPodcasts } from './podcasts.js';
import { saveCast, echoNow, echoSpots, withEchoSpots } from './podcast-audio.js';
const DEMO_KEY = 'frame:demo'; // { on, at }: the frame's demo mode (POST /api/frame/demo)
export { MessageRoom } from './messages.js'; // Durable Object class (wrangler.jsonc)
export { ListBridge } from './bridge.js';      // Durable Object class: Apple Reminders through a Mac
import { explore, listSaved, saveRecipe, deleteRecipe, recipeImage, moveToPaprika } from './recipes.js';
import { geocode, staticMap, drive, googleTile, mapCredit, tile } from './maps.js';
import { spotifyConfigured, getPlaylists, getNow, getQueue } from './spotify.js';
import { level, BRIDGE_LISTS, fromReminders, remindersName, bridge } from './bridge.js';

// An edit from the frame's item sheet: a new title and/or priority (0 clears it).
const editOf = (b) => ({
  ...(String((b && b.content) || '').trim() ? { content: String(b.content).trim().slice(0, 500) } : {}),
  ...(b && b.priority !== undefined ? { priority: level(b.priority) } : {}),
});
import { syncPaprika, listPaprika, getPaprika, paprikaImage, listMeals, syncMealPlan } from './paprika.js';
import { mealGroceries, MODEL } from './meal-groceries.js';
import { saveShared, sharedResponse } from './shared-media.js';

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
  // authenticate with (see identify()), set once and refreshed when missing.
  async fetch(req, env, ctx) {
    const res = await handle(req, env, ctx);
    return withAuthCookie(req, env, res, callers.get(req));
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
      const html = await res.text();
      const page = new Response(html, res);
      page.headers.set('Cache-Control', 'no-store');
      // Defence in depth (2026-10-20 security review): no sniffing, no embedding in another site, and
      // the browser's default referrer policy made explicit (YouTube embeds need a referrer). The full
      // Content-Security-Policy only reports for now (csp.js); Home Assistant, YouTube, maps and the
      // relay each need care before it blocks.
      page.headers.set('X-Content-Type-Options', 'nosniff');
      page.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      page.headers.set('X-Frame-Options', 'DENY');
      page.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
      if (html) page.headers.set('Content-Security-Policy-Report-Only', await cspPolicy(html));
      return page;
    }
    // Bodies over their route's limit are refused before they're read (limits.js).
    if (tooBig(req, url.pathname)) return json({ error: 'too large' }, 413);
    // What the page's policy would have blocked (csp.js). The browser sends these with no key.
    if (url.pathname === '/api/csp-report' && req.method === 'POST') {
      if (await overLimit(env.ADDRESS_LIMIT, 'ip:' + (req.headers.get('CF-Connecting-IP') || ''))) return tooMany();
      return cspReport(req, env);
    }
    // Agents post with their own token, which opens this one route and nothing else.
    if (url.pathname === '/api/messages' && req.method === 'POST') {
      if (!env.AGENT_TOKEN || req.headers.get('Authorization') !== 'Bearer ' + env.AGENT_TOKEN) return json({ error: 'unauthorized' }, 401);
      return room(env).fetch('https://room/post', { method: 'POST', body: await req.text() });
    }
    // The Mac that bridges Apple Reminders (bridge/mac/) has its own token, for these routes only.
    if (url.pathname.startsWith('/api/bridge/')) {
      if (!env.BRIDGE_TOKEN || req.headers.get('Authorization') !== 'Bearer ' + env.BRIDGE_TOKEN) return json({ error: 'unauthorized' }, 401);
      await noteHome(env, req); // the Mac is at home: its network is the frame's (home.js)
      const what = url.pathname.slice('/api/bridge/'.length);
      // Just the home check's learning (above): the bridge's launch agent calls this over IPv4 every
      // 10 minutes (bridge/mac/install.sh), since its own traffic and the frame's go over IPv6, which
      // left home without an IPv4 address and a phone on IPv4 refused (2026-10-20).
      if (what === 'home') return json({ ok: true });
      if (what === 'config') {
        // extras: also read sections, flags and assignees from the Reminders database (docs/lists.md).
        const extras = /^(on|yes|true|1)$/i.test(String(env.REMINDERS_EXTRAS || '').trim());
        // calendars: the bridge:<name> entries in CALENDAR_URLS, with whether to send their notes.
        const cals = bridgeCalendars(env);
        return json({ lists: Object.fromEntries(Object.keys(BRIDGE_LISTS).filter((l) => fromReminders(env, l)).map((l) => [l, remindersName(env, l)])), ...(extras ? { extras: true } : {}), ...(podcastsOn(env) ? { podcasts: true } : {}),
          ...(cals.length ? { calendars: Object.fromEntries(cals.map((c) => [c.name, { notes: c.notes }])), window: { back: DAYS_BACK, ahead: DAYS_AHEAD } } : {}),
          // photos: the shared album to send, and the sizes to send it at (a landscape fills the
          // 1920-wide screen, a portrait half of it, as they show in pairs).
          // clip: seconds of each video to send, a little over the frame's slide (SLIDE_MS in
          // src/views/Ambient.svelte, 30 s), which is all the slideshow ever shows of one.
          ...(bridgeAlbum(env) ? { photos: { album: bridgeAlbum(env), landscape: 1920, portrait: 960, clip: 32 } } : {}) });
      }
      if (what === 'photos' && req.method === 'POST') return json(await bridgePhotoList(env, await req.json().catch(() => ({}))));
      if (what.startsWith('videos/') && req.method === 'PUT') {
        const { status, body } = await bridgeVideoUpload(env, what.slice(7), await req.arrayBuffer());
        return json(body, status);
      }
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
        // Podcasts: the Podcasts library (podcasts.js), when it changed or hourly.
        if (Array.isArray(body.podcasts) && podcastsOn(env)) await savePodcasts(env, body.podcasts);
        delete body.podcasts;
        delete body.calendars;
        return bridge(env).fetch('https://bridge/snapshot', { method: 'POST', body: JSON.stringify(body) });
      }
      if (what === 'live') return bridge(env).fetch(new Request('https://bridge/live', req));
      return json({ error: 'not found' }, 404);
    }
    // A phone shares a YouTube video to the frame (an iOS Shortcut on the share sheet: docs/music.md), with
    // its own SHARE_TOKEN, which opens this route and nothing else: the worst a leaked one can do is
    // play a video on the frame.
    if (url.pathname === '/api/share/play' && req.method === 'POST') {
      // Also the phone app's share extension, with the dashboard key it was paired with.
      const shareToken = env.SHARE_TOKEN && same(req.headers.get('Authorization') || '', 'Bearer ' + env.SHARE_TOKEN);
      if (!shareToken && !allowed(await identify(req, env), 'POST', '/api/share/play')) return json({ error: 'unauthorized' }, 401);
      const away = await homeOnly(env, req); // only from home (home.js)
      if (away) return away;
      const body = await req.text();
      let text = body;
      try { const j = JSON.parse(body); text = j.url || j.text || body; } catch {}
      const id = videoIdOf(String(text));
      if (!id) return json({ error: 'no YouTube video link in that' }, 400);
      const title = await videoTitle(id).catch(() => null);
      if (title === null) return json({ error: 'YouTube says that video can\'t be played outside YouTube (or is gone)' }, 422);
      const r = await room(env).fetch('https://room/command', { method: 'POST', body: JSON.stringify({ command: 'play', id, title }) });
      const { sent = 0 } = await r.json().catch(() => ({}));
      return json({ ok: sent > 0, title, sent, ...(sent ? {} : { error: 'the frame isn\'t connected right now' }) });
    }
    // Alexa ("Alexa, ask Frame to…": docs/alexa.md). Amazon signs each request; alexa.js checks that,
    // the skill id and (optionally) the Amazon account, and nothing else reaches it.
    if (url.pathname === '/api/alexa' && req.method === 'POST') {
      return handleAlexa(req, env, {
        log: (entry) => ctx.waitUntil(addLog(env, entry)),
        command: async (command, data = {}) => {
          const r = await room(env).fetch('https://room/command', { method: 'POST', body: JSON.stringify({ command, ...data }) });
          return ((await r.json().catch(() => ({}))).sent) || 0;
        },
        calendar: async () => (await env.CALENDAR.get(KEY, 'json')) || updateCalendar(env, null),
        videoGroups: () => parseSetting(env.YOUTUBE_VIDEOS).map((g) => g.name),
        meals: () => listMeals(env),
        recipes: () => listPaprika(env),
        podcasts: () => listPodcasts(env),
        rotations: () => rotations(env),
        demo: async () => ((await env.CALENDAR.get(DEMO_KEY, 'json')) || {}).on === true,
        fitness: () => listFitness(env),
        guest: () => guestMode(env),
        setGuest: (on) => setGuestMode(env, on),
      });
    }
    // Agents may also save recipes with their token (the frame saves with its own key).
    const agent = env.AGENT_TOKEN && req.headers.get('Authorization') === 'Bearer ' + env.AGENT_TOKEN;
    if (url.pathname === '/api/recipes' && req.method === 'POST' && agent) {
      const { status, body } = await saveRecipe(env, await req.json().catch(() => ({})), ctx);
      return json(body, status);
    }
    // A phone pairs with a one-time code from the frame, not a key (devices.js).
    // Pairing attempts and calls without a working key count against their address (limits.js);
    // a key's calls count against the key.
    const address = 'ip:' + (req.headers.get('CF-Connecting-IP') || '');
    if (url.pathname === '/api/devices/claim' && req.method === 'POST') {
      if (await overLimit(env.ADDRESS_LIMIT, address)) return tooMany();
      return devicesApi(req, env, url, null);
    }
    const who = await identify(req, env);
    if (!who) return (await overLimit(env.ADDRESS_LIMIT, address)) ? tooMany() : json({ error: 'unauthorized' }, 401);
    if (await overLimit(env.KEY_LIMIT, rateKey(who))) return tooMany();
    callers.set(req, who);
    // Each device's key opens only what that device uses (devices.js).
    if (!allowed(who, req.method, url.pathname)) return json({ error: 'This device’s key can’t do that.' }, 403);
    if (url.pathname === '/api/devices' || url.pathname.startsWith('/api/devices/')) return (await devicesApi(req, env, url, who)) || json({ error: 'not found' }, 404);

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
        // A place found is kept a day by the frame's browser; a miss isn't kept, so a later fix or a
        // newly findable place shows at once.
        try { const place = await geocode(env, url.searchParams.get('q')); return json({ place }, 200, place ? 'private, max-age=86400' : 'no-store'); }
        catch (err) { return json({ place: null, error: String(err.message || err) }); } // not cached; tried again next open
      }
      if (url.pathname === '/api/staticmap') return staticMap(env, url.searchParams);
      if (url.pathname === '/api/drive') {
        try { const d = await drive(env, url.searchParams.get('q'), url.searchParams.get('at')); return json({ drive: d }, 200, d ? 'private, max-age=600' : 'no-store'); }
        catch (err) { return json({ drive: null, error: String(err.message || err) }); }
      }
      if (url.pathname === '/api/gtiles/credit') {
        try { return json(await mapCredit(env, url.searchParams, ctx), 200, 'private, max-age=86400'); }
        catch (err) { return json({ credit: 'Google', error: String(err.message || err) }); }
      }
      const g = /^\/api\/gtiles\/(\d+)\/(\d+)\/(\d+)$/.exec(url.pathname);
      if (g) {
        try { return await googleTile(env, +g[1], +g[2], +g[3], ctx); }
        catch (err) { return new Response(String(err.message || err), { status: 502 }); }
      }
      const t = /^\/api\/tiles\/(\d+)\/(\d+)\/(\d+)$/.exec(url.pathname);
      if (t) return tile(+t[1], +t[2], +t[3], ctx);
      // Demo mode's Media on a frame with Home Assistant: names fit to show, public playlists (demo-media.js).
      if (url.pathname === '/api/demo') return json(await demoMedia(env), 200, 'private, max-age=300');
      // Demo mode's stock slideshow (demo-photos.js), never the album.
      if (url.pathname === '/api/photos' && url.searchParams.has('demo')) return json(demoPhotos(), 200, 'private, max-age=86400');
      if (url.pathname.startsWith('/api/photos/demo-cam-')) return demoCamResponse(url.pathname.slice('/api/photos/demo-cam-'.length), ctx);
      if (url.pathname.startsWith('/api/photos/demo-')) return demoPhotoResponse(url.pathname.slice('/api/photos/'.length), ctx);
      if (url.pathname === '/api/photos') {
        if (!env.ALBUM_URL) return json({ photos: [], error: 'Add ALBUM_URL to show photos' });
        return json(await listPhotos(env, ctx));
      }
      if (url.pathname.startsWith('/api/photos/')) return photoResponse(env, url.pathname.slice('/api/photos/'.length), ctx);
      if (url.pathname.startsWith('/api/videos/')) return videoResponse(env, url.pathname.slice('/api/videos/'.length), req);
      if (url.pathname === '/api/podcasts') {
        const list = await listPodcasts(env);
        return json({ ...list, shows: withEchoSpots(list.shows, await echoSpots(env)) });
      }
      // An episode for the Echo (podcast-audio.js): the frame stores it, then asks the Echo to play it.
      if (url.pathname === '/api/podcasts/cast' && req.method === 'POST') {
        const { status, body } = await saveCast(env, await req.json().catch(() => ({})));
        return json(body, status);
      }
      if (url.pathname === '/api/podcasts/now') return json({ now: await echoNow(env) });
      // What an Echo heard, from Home Assistant's voice events (the frame watches them): the Alexa log.
      if (url.pathname === '/api/alexa/heard' && req.method === 'POST') {
        const e = heardEntry(await req.json().catch(() => ({})));
        if (e) ctx.waitUntil(addLog(env, e));
        return json({ ok: !!e });
      }
      if (url.pathname === '/api/youtube') return json(await listVideos(env, { force: url.searchParams.has('refresh') }));
      if (url.pathname.startsWith('/api/youtube/thumb/')) return thumbResponse(url.pathname.slice('/api/youtube/thumb/'.length), ctx);
      // A poster for what a TV plays when Home Assistant has none (tvart.js).
      if (url.pathname === '/api/tvart') return tvArtResponse(url, ctx);
      if (url.pathname === '/api/messages' && req.method === 'GET') return room(env).fetch('https://room/list');
      if (url.pathname === '/api/notices' && req.method === 'GET') return json(await listNotices(env));
      if (url.pathname === '/api/frame/status' && req.method === 'POST') {
        // Where the frame is is home (home.js): only the frame's own key (or the admin key) teaches it.
        if (who.role === 'frame' || who.role === 'admin') await noteHome(env, req);
        const { status, body } = await saveStatus(env, await req.json().catch(() => ({})));
        return json(body, status);
      }
      // Ask the frame to check in now, over its live connection (scripts/frame-status.sh --now).
      // The frame's demo mode, for Alexa to read the same invented day (alexa.js).
      if (url.pathname === '/api/frame/demo' && req.method === 'POST') {
        const { on } = await req.json().catch(() => ({}));
        await env.CALENDAR.put(DEMO_KEY, JSON.stringify({ on: on === true, at: new Date().toISOString() }));
        return json({ ok: true });
      }
      if (url.pathname === '/api/frame/checkin' && req.method === 'POST') return room(env).fetch('https://room/command', { method: 'POST', body: JSON.stringify({ command: 'checkin' }) });
      // A photo or video shared from the phone app, shown on the frame at once (shared-media.js).
      if (url.pathname === '/api/share/media' && req.method === 'POST') {
        const away = await homeOnly(env, req);
        if (away) return away;
        const r = await saveShared(env, await req.formData());
        if (r.status !== 200) return json(r.body, r.status);
        const res = await room(env).fetch('https://room/command', { method: 'POST', body: JSON.stringify({ command: 'media', id: r.id, kind: r.kind, title: r.title }) });
        const { sent = 0 } = await res.json().catch(() => ({}));
        return json({ id: r.id, kind: r.kind, sent, ...(sent ? {} : { error: 'the frame isn\'t connected right now' }) });
      }
      const shared = /^\/api\/share\/media\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (shared && req.method === 'GET') return sharedResponse(env, shared[1], req);
      // Whether the caller is on the frame's home network (home.js), so the phone app can say so up front.
      if (url.pathname === '/api/frame/home' && req.method === 'GET') {
        if (String(env.HOME_ONLY || '').toLowerCase() === 'off') return json({ home: true });
        const check = await homeCheck(env, req);
        return json(url.searchParams.has('why') ? check : { home: check.home });
      }
      // The frame's screen, for the phone app (screenshot.js).
      if (url.pathname.startsWith('/api/frame/screenshot')) {
        // Asking for and fetching it only from home (home.js); the frame's own upload is at home anyway.
        if (url.pathname === '/api/frame/screenshot/request' || req.method === 'GET') {
          const away = await homeOnly(env, req);
          if (away) return away;
        }
        const shot = await screenshotRoute(req, env, url);
        if (shot) return shot;
      }
      // The phone app's remote (ios/): the same commands Alexa sends; messages.js checks them.
      if (url.pathname === '/api/frame/command' && req.method === 'POST') {
        const away = await homeOnly(env, req); // only from home (home.js)
        if (away) return away;
        const { command, tab, group, action, label, seconds, id } = await req.json().catch(() => ({}));
        if (!['show', 'slideshow', 'wake', 'close', 'playgroup', 'timer'].includes(command)) return json({ error: 'unknown command' }, 400);
        return room(env).fetch('https://room/command', { method: 'POST', body: JSON.stringify({ command, tab, group, action, label, seconds, id }) });
      }
      if (url.pathname === '/api/frame/reload' && req.method === 'POST') return room(env).fetch('https://room/command', { method: 'POST', body: JSON.stringify({ command: 'reload' }) });
      if (url.pathname === '/api/frame/restart' && req.method === 'POST') return room(env).fetch('https://room/command', { method: 'POST', body: JSON.stringify({ command: 'restart' }) });
      if (url.pathname === '/api/frame/status') return json(await getStatus(env));
      if (url.pathname === '/api/frame/settings') return json(url.searchParams.has('history') ? await getSettingsHistory(env) : await getSettings(env));
      if (url.pathname === '/api/ops/summary') return json(await opsSummary(env, KEY));
      // In guest mode nobody's fitness leaves the Worker (guest.js).
      if (url.pathname === '/api/fitness' && req.method === 'GET') {
        const guest = await guestMode(env);
        return json(guest.on ? { people: [], guest } : { ...(await listFitness(env)), guest });
      }
      // The frame's timers: the frame sends them as they change, the phone app's Remote reads them.
      if (url.pathname === '/api/frame/timers' && req.method === 'POST') {
        const { timers } = await req.json().catch(() => ({}));
        return room(env).fetch('https://room/timers', { method: 'POST', body: JSON.stringify({ timers: cleanTimers(timers) || [] }) });
      }
      if (url.pathname === '/api/frame/timers' && req.method === 'GET') return room(env).fetch('https://room/timers');
      // One of the recents swiped away on the phone.
      if (url.pathname === '/api/frame/timers/recents' && req.method === 'DELETE') {
        const { label, seconds, all } = await req.json().catch(() => ({}));
        if (all === true) return room(env).fetch('https://room/timers', { method: 'DELETE', body: JSON.stringify({ all }) });
        if (typeof label !== 'string' || !Number.isFinite(seconds)) return json({ error: 'label and seconds, or all: true' }, 400);
        return room(env).fetch('https://room/timers', { method: 'DELETE', body: JSON.stringify({ label, seconds }) });
      }
      if (url.pathname === '/api/frame/guest' && req.method === 'GET') return json(await guestMode(env));
      if (url.pathname === '/api/frame/guest' && req.method === 'POST') {
        const { on } = await req.json().catch(() => ({}));
        if (typeof on !== 'boolean') return json({ error: 'on: true or false' }, 400);
        return json(await setGuestMode(env, on)); // the room tells the frame
      }
      if (url.pathname === '/api/fitness' && (req.method === 'POST' || req.method === 'DELETE')) {
        const sent = req.method === 'POST' ? await req.json().catch(() => ({})) : null;
        const fitnessId = sent ? sent.id : url.searchParams.get('id');
        // A phone sends and removes only its own person: the first id its key sent (devices.js).
        if (!(await fitnessAllowed(env, who, fitnessId))) return json({ error: 'This phone can only send its own fitness.' }, 403);
        const { status, body } = sent ? await saveFitness(env, sent) : await removeFitness(env, fitnessId);
        // The frame shows it at once rather than at its next fetch.
        if (status === 200) await room(env).fetch('https://room/command', { method: 'POST', body: JSON.stringify({ command: 'refresh', what: 'fitness' }) }).catch(() => {});
        return json(body, status);
      }
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
      if (url.pathname === '/api/meals/sync' && req.method === 'POST') return json(await syncMealPlan(env));
      if (url.pathname === '/api/meals/groceries' && req.method === 'GET') {
        // What's on Groceries now, from wherever that list lives, so the model leaves it out.
        const view = fromReminders(env, 'groceries')
          ? await (await bridge(env).fetch('https://bridge/view/groceries')).json()
          : env.TODOIST_TOKEN ? await getList(env, 'groceries') : { items: [] };
        const today = new Date().toLocaleDateString('en-CA', { timeZone: env.DISPLAY_TZ || 'UTC' });
        const model = /^@cf\/[\w.\/-]+$/.test(url.searchParams.get('model') || '') ? url.searchParams.get('model') : MODEL;
        return json(await mealGroceries(env, (view.items || []).map((i) => i.content), { today, model }));
      }
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
      // The status page's "Last checked" (messages.js /stamps), with the error when the run failed.
      const stamp = (error) => room(env).fetch(new Request('https://room/stamps', { method: 'POST', body: JSON.stringify({ name: 'paprika', error }) })).catch(() => {});
      let r;
      try { r = await syncPaprika(env); } catch (e) { await stamp(String(e.message || e)); throw e; }
      if (!r.skipped) await stamp(null);
      console.log('cron ' + controller.cron + ': paprika ' + JSON.stringify(r));
      // A changed meal plan reaches an open frame at once, not at its next half-hourly look.
      if (r.mealsChanged) await room(env).fetch('https://room/command', { method: 'POST', body: JSON.stringify({ command: 'refresh', what: 'meals' }) }).catch(() => {});
      return;
    }
    const data = await updateCalendar(env, await env.CALENDAR.get(KEY, 'json'));
    console.log('cron ' + controller.cron + ': ' + data.events.length + ' events, ' + data.errors.length + ' errors');
  }
}

// Fetches the feeds and stores the result when the events or errors changed, or hourly.
async function updateCalendar(env, previous) {
  const feeds = (await env.CALENDAR.get(FEEDS_KEY, 'json')) || {};
  const before = JSON.stringify(feeds);
  const data = await refresh(env, previous, feeds);
  const pick = (d) => JSON.stringify([d.events, d.errors, d.names, d.colors, d.details, d.notes, d.links, d.pins, d.drive]);
  const same = previous && pick(previous) === pick(data);
  if (!same || Date.now() - Date.parse(previous.updated) > HEARTBEAT_MS) await env.CALENDAR.put(KEY, JSON.stringify(data));
  // Each feed's fetch record changes only when a feed is fetched on a slow schedule or fails, so
  // this is a handful of writes a day, not one per run.
  if (JSON.stringify(feeds) !== before) await env.CALENDAR.put(FEEDS_KEY, JSON.stringify(feeds));
  return data;
}

// When each linked feed was last fetched, and its failures in a row (KV "calendar-feeds", by
// calendar index, with a short hash of its link so a changed link starts afresh):
//   - CALENDAR_REFRESH (optional, hours, comma-separated in link order): fetch that feed at most
//     that often; blank fetches on every run. A season's game schedule barely changes, and some
//     sports sites refuse a cloud server that asks every 10 minutes.
//   - After a failure, wait 10, 20, 40 ... minutes (at most 6 hours) before trying that feed again,
//     showing its last good events meanwhile.
const FEEDS_KEY = 'calendar-feeds';
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;
const linkTag = (link) => { let h = 0; for (const c of link) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
function feedDue(feed, everyMs, now) {
  if (!feed) return true;
  if (feed.fails) return now - Date.parse(feed.tried) >= Math.min(RETRY_MAX_MS, 10 * 60000 * 2 ** (feed.fails - 1)) - 30000;
  return !everyMs || now - Date.parse(feed.ok) >= everyMs - 30000;
}

// The calendars CALENDAR_URLS takes from the Mac bridge (bridge:<name>), with their index there and
// whether their notes are wanted (CALENDAR_DETAILS).
const BRIDGE_CAL_KEY = 'bridge-calendars';
const BRIDGE_CAL_STALE_MS = 3 * 60 * 60 * 1000; // the Mac resends at least hourly
function bridgeCalendars(env) {
  const urls = String(env.CALENDAR_URLS || '').split(/[\s,]+/).filter(Boolean);
  return urls.map((u, cal) => ({ cal, name: /^bridge:/i.test(u) ? decodeURIComponent(u.slice(7)) : null, notes: detailsOf(env, cal).open }))
    .filter((c) => c.name);
}
// One calendar's CALENDAR_DETAILS: yes (opens with its details), pin:<name> (opens with them after that
// person's own PIN on the frame), or no (titles and times only; its notes are never kept).
export function detailsOf(env, cal) {
  const v = (String(env.CALENDAR_DETAILS || '').split(',')[cal] || '').trim();
  const pin = /^pin:\s*(.{1,40})$/i.exec(v);
  return { open: !!pin || /^(yes|y|true|on)$/i.test(v), pin: pin ? pin[1].trim() : null };
}

async function refresh(env, previous, feeds = {}) {
  const urls = String(env.CALENDAR_URLS || '').split(/[\s,]+/).filter(Boolean);
  // What the Mac bridge last sent, for bridge:<name> calendars (read once for all of them).
  const fromMac = urls.some((u) => /^bridge:/i.test(u)) ? await env.CALENDAR.get(BRIDGE_CAL_KEY, 'json') : null;
  const now = Date.now(), from = now - DAYS_BACK * DAY, to = now + DAYS_AHEAD * DAY;
  const tz = env.DISPLAY_TZ || 'UTC';
  const errors = [];
  const names = [];
  // CALENDAR_DETAILS (optional, same order): which calendars' events open with their notes.
  const details = env.CALENDAR_DETAILS ? urls.map((_, i) => detailsOf(env, i).open) : null;
  // CALENDAR_DRIVE (optional, same order): calendars whose events show the drive there (maps.js
  // drive()); yes for your own, no for a team's schedule nobody drives to. Needs GOOGLE_MAPS_KEY.
  const drive = env.CALENDAR_DRIVE && env.GOOGLE_MAPS_KEY ? urls.map((_, i) => /^(yes|y|true|on)$/i.test((String(env.CALENDAR_DRIVE).split(',')[i] || '').trim())) : null;
  // Whose PIN opens each calendar's events, for those set to pin:<name>.
  const pins = env.CALENDAR_DETAILS ? urls.map((_, i) => detailsOf(env, i).pin) : [];
  const every = String(env.CALENDAR_REFRESH || '').split(',').map((x) => (Number(x) > 0 ? Number(x) * 3600000 : 0));
  // The last good copy of a calendar, for a feed not fetched this time (failing, or not due yet).
  const kept = (cal) => (previous?.events || []).filter((e) => e.cal === cal)
    .map((e) => ({ ...e, startMs: Date.parse(e.start), ...(details?.[cal] && previous.notes?.[e.uid] ? { notes: previous.notes[e.uid] } : {}),
      ...(details?.[cal] && previous.links?.[e.uid] ? { links: previous.links[e.uid] } : {}) }));

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
      const tag = linkTag(link);
      if (feeds[cal] && feeds[cal].tag !== tag) delete feeds[cal];
      const feed = feeds[cal];
      if (!feedDue(feed, every[cal], now) && previous) {
        names[cal] = previous.names?.[cal] ?? null;
        // Still failing: say so (with when the copy is from), rather than going quiet between tries.
        if (feed.fails) errors.push({ cal, error: feed.error, since: feed.ok || null });
        return kept(cal);
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
      // Only feeds on a slow schedule, or recovering, need a record (so a write); the rest run every time.
      if (every[cal] || feed?.fails) feeds[cal] = { tag, ok: new Date(now).toISOString() };
      return events;
    } catch (err) {
      // Keep this calendar's last good events so a blip doesn't blank the wall display.
      // Without the link itself: a feed's URL is its secret (fetch errors can quote it).
      const error = String(err.message || err).replace(/(?:https?|webcal):\/\/\S+/gi, '<link>');
      names[cal] = previous?.names?.[cal] ?? null;
      console.error('calendar ' + cal + ' failed: ' + error);
      if (!/^bridge:/i.test(link)) {
        const f = feeds[cal]?.tag === linkTag(link) ? feeds[cal] : { tag: linkTag(link), ok: null };
        feeds[cal] = { ...f, error, tried: new Date(now).toISOString(), fails: (f.fails || 0) + 1 };
      }
      // since: when its last good copy is from (the status page is calmer about a recent one).
      errors.push({ cal, error, ...(/^bridge:/i.test(link) ? {} : { since: feeds[cal].ok || null }) });
      return kept(cal);
    }
  }));

  // CALENDAR_NAMES (optional, comma-separated, same order as the links) overrides the feeds' names.
  const custom = String(env.CALENDAR_NAMES || '').split(',').map((x) => x.trim());
  // CALENDAR_COLORS (optional, same order): the frame's colour per calendar; unset ones rotate.
  const colors = env.CALENDAR_COLORS ? String(env.CALENDAR_COLORS).split(',').map((x) => x.trim()) : null;
  const events = merge(lists);
  const notes = splitNotes(events), links = splitLinks(events);
  return { updated: new Date(now).toISOString(), calendars: urls.length, names: urls.map((_, i) => custom[i] || names[i] || null),
    colors: colors ? urls.map((_, i) => colors[i] || null) : undefined, details: details || undefined,
    pins: pins.some(Boolean) ? pins : undefined, drive: drive && drive.some(Boolean) ? drive : undefined,
    notes: Object.keys(notes).length ? notes : undefined, links: Object.keys(links).length ? links : undefined, errors, events };
}

// The frame sends its key as a header. <img> and WebSocket can't, so those GETs authenticate with a
// cookie instead: an HMAC of the key (not the key), HttpOnly, Secure, SameSite=Strict, set on any
// response to a request that had the key. That keeps the key out of URLs, and so out of request
// logs and caches. (A key in the URL, ?key=, how they used to do it, is no longer accepted.)
const AUTH_COOKIE = 'frame_auth';
const mediaPath = (p) => p.startsWith('/api/photos/') || p.startsWith('/api/videos/') || p.startsWith('/api/share/media/') || p.startsWith('/api/youtube/thumb/') || p === '/api/tvart' || p.startsWith('/api/tiles/') || p.startsWith('/api/gtiles/') || p === '/api/staticmap' || p === '/api/messages/live' || /^\/api\/recipes\/(paprika\/)?[\w-]+\/image$/.test(p);
// Constant-time comparison, so a key or cookie can't be guessed a character at a time.
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const hasKey = (req, env) => same(req.headers.get('Authorization') || '', 'Bearer ' + env.DASHBOARD_KEY);

async function cookieValue(env, deviceId) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.DASHBOARD_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(deviceId ? 'kitchen-frame device cookie v1 ' + deviceId : 'kitchen-frame auth cookie v1')));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const cookieOf = (req) => (/(?:^|;\s*)frame_auth=([^;]+)/.exec(req.headers.get('Cookie') || '') || [])[1] || null;

// Who is calling: { role: 'admin' } for DASHBOARD_KEY, { role, device } for a device's own key
// (devices.js), or the same from the cookie on a media path; null otherwise. No DASHBOARD_KEY set:
// refused, unless local development says otherwise (ALLOW_NO_KEY=1 in .dev.vars only), so a key lost in
// a rotation can't leave the API open.
const callers = new WeakMap(); // request -> who, for the cookie on its response
async function identify(req, env) {
  if (!env.DASHBOARD_KEY) return env.ALLOW_NO_KEY === '1' ? { role: 'admin' } : null;
  const auth = req.headers.get('Authorization') || '';
  if (hasKey(req, env)) return { role: 'admin' };
  if (auth.startsWith('Bearer ' + TOKEN_PREFIX)) {
    const device = await deviceForToken(env, auth.slice(7));
    return device ? { role: device.role, device } : null;
  }
  const url = new URL(req.url);
  if (req.method !== 'GET' || !mediaPath(url.pathname)) return null;
  const c = cookieOf(req);
  if (!c) return null;
  if (same(c, await cookieValue(env))) return { role: 'admin', cookie: true };
  // A device's cookie: d.<id>.<HMAC of the id>, for the frame's own key.
  const m = /^d\.([\w-]{6,20})\.([\w-]+)$/.exec(c);
  if (m && same(m[2], await cookieValue(env, m[1]))) {
    const device = await deviceById(env, m[1]);
    if (device && device.role === 'frame') return { role: 'frame', device, cookie: true };
  }
  return null;
}

// The cookie for a key's media requests: set on a response to the admin key or the frame's own key.
async function withAuthCookie(req, env, res, who) {
  if (!env.DASHBOARD_KEY || !who || who.cookie || res.status === 101 || res.webSocket) return res;
  if (who.role !== 'admin' && who.role !== 'frame') return res;
  const value = who.role === 'admin' ? await cookieValue(env) : 'd.' + who.device.id + '.' + await cookieValue(env, who.device.id);
  if (cookieOf(req) === value) return res;
  const out = new Response(res.body, res);
  out.headers.append('Set-Cookie', AUTH_COOKIE + '=' + value + '; Path=/api; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict');
  return out;
}

const tooMany = () => new Response(JSON.stringify({ error: 'too many requests' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } });

function json(body, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
  });
}
