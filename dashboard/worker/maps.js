// Map previews for event locations: Google Maps when GOOGLE_MAPS_KEY is set, OpenStreetMap
// otherwise, and whenever Google says no or its allowance below is used up.
//   geocode(): an event's location text -> { lat, lon }, cached in KV (Google's answers for 30
//     days, as long as its terms allow; OSM's for good; misses for a week), so each place is looked
//     up once. Only called when someone opens an event's details, never for every event in the feeds.
//   staticMap(): Google's map picture for a place, fetched by the Worker so the key never reaches a
//     screen. Not kept in Cloudflare's cache (Google's terms); the frame's browser keeps it a day.
//   drive(): how long the drive is from home to an event's place, leaving shortly before it starts,
//     with traffic (Google's Routes API). Home is HOME_LAT/HOME_LON, or WEATHER_LAT/LON when unset
//     (rounded, so a minute or two out). Kept briefly in Cloudflare's cache and shared by every screen
//     and reload: 12 hours while the event is more than 2 hours off, then 10 minutes (DRIVE_KEEP).
//   googleTile(): Google's street map tiles (Map Tiles API) for the radar and the full-screen map,
//     through the Worker for the key. Kept only as long as Google's own Cache-Control allows (its
//     terms): in Cloudflare's cache when public, otherwise only by the frame's browser.
//   mapCredit(): the map data credit Google asks to be shown under its tiles, for a view.
//   tile(): map tiles passed through from tile.openstreetmap.org and kept in Cloudflare's cache, so
//     the frame's slow Wi-Fi and OSM's servers each see a place's tiles once. The fallback when
//     Google's tiles aren't there.
// OSM's usage policies: an identifying User-Agent, light use, results cached.
//
// Google bills past a free allowance each month and has no spending cap for Maps (its daily quotas
// can't be lowered on every account), so the Worker keeps its own: GOOGLE_CAPS, counted in the
// message room (messages.js /google/spend). Each day's cap times 31 stays under the month's free
// calls (10,000 Static Maps and Geocoding; 5,000 Routes with traffic; 100,000 map tiles).
const UA = 'kitchen-frame/1.0 (+https://github.com/thnk2wn/kitchen-frame)';
const DAY = 86400;
export const GOOGLE_CAPS = { static: { day: 300, month: 9000 }, geocode: { day: 300, month: 9000 }, routes: { day: 150, month: 4500 }, tiles: { day: 3000, month: 90000 } };
const GOOGLE = 'https://maps.googleapis.com/maps/api/';

// Not places: video calls and links. Checked before anything is sent to Nominatim.
export function mappable(q) {
  q = String(q || '').trim();
  return q.length >= 4 && q.length <= 200 && !/https?:|www\.|\b(zoom|teams|meet|webex|skype|video|call|phone|virtual|online|tbd|tba)\b/i.test(q);
}

// What to look up, in order: the text as written, then, when a place's name comes before its street
// address ("Riverside Fitness - Springfield 120 Main St, Springfield, IL", as calendars fill it in
// when a place is picked by name), the address from its house number on. Nominatim finds nothing for
// the whole, and the address alone.
export function lookups(q) {
  const out = [q];
  const at = q.search(/\b\d{1,6}[a-z]?\s+[a-z]/i);
  if (at > 0) out.push(q.slice(at).trim());
  return out;
}

// Near home (WEATHER_LAT/LON) first: see osmGeocode() below; Google is asked to lean the same way.
export async function geocode(env, raw, wait = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const q = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!mappable(q)) return null;
  const key = 'geo:' + q.toLowerCase();
  const hit = await env.CALENDAR.get(key, 'json');
  // A miss saved before addresses were tried on their own (no v) is looked up again.
  if (hit && (hit.lat != null || hit.v === 2)) return hit.lat != null ? { lat: hit.lat, lon: hit.lon } : null;
  const lat = Number(env.WEATHER_LAT), lon = Number(env.WEATHER_LON);
  const home = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  let found = null, by = 'osm';
  if (env.GOOGLE_MAPS_KEY) {
    try {
      for (const text of lookups(q)) {
        if (!(await spend(env, 'geocode'))) break;
        found = await googleSearch(env, text, home);
        // Google only leans towards home, so a bare name found far away is taken as the wrong place.
        if (found && home && !nearHome(found, home) && !/[,\d]/.test(text)) found = null;
        if (found) { by = 'google'; break; }
      }
    } catch (err) {
      console.log('google geocode: ' + (err.message || err)); // then OSM
    }
  }
  if (!found) found = await osmGeocode(q, home, wait);
  await env.CALENDAR.put(key, JSON.stringify(found ? { ...found, by } : { none: true, v: 2 }), by === 'google' ? { expirationTtl: 30 * DAY } : found ? {} : { expirationTtl: 7 * DAY });
  return found;
}

const nearHome = (p, home) => Math.abs(p.lat - home.lat) <= 1.4 && Math.abs(p.lon - home.lon) <= 1.5;

// Search near home first (~150 km either way), so "Aquatic center" means the local one. Anywhere
// else only when the text names more than a bare place (a comma or a number, as in "Williams-Brice
// Stadium, Columbia" or a street address), to avoid a same-named place abroad.
async function osmGeocode(q, home, wait) {
  const near = home ? [home.lon - 1.5, home.lat + 1.4, home.lon + 1.5, home.lat - 1.4].map((n) => n.toFixed(3)).join(',') : null;
  let calls = 0;
  // OSM asks for at most one search a second.
  const ask = async (text, box) => { if (calls++) await wait(1100); return search(text, box); };
  for (const text of lookups(q)) {
    let found = near ? await ask(text, near) : null;
    if (!found && (!near || /[,\d]/.test(text))) found = await ask(text, null);
    if (found) return found;
  }
  return null;
}

async function googleSearch(env, address, home) {
  const u = new URL(GOOGLE + 'geocode/json');
  u.search = new URLSearchParams({ address, key: env.GOOGLE_MAPS_KEY, ...(home ? { bounds: `${home.lat - 1.4},${home.lon - 1.5}|${home.lat + 1.4},${home.lon + 1.5}` } : {}) });
  const res = await fetch(u);
  const body = await res.json().catch(() => ({}));
  if (body.status === 'ZERO_RESULTS') return null;
  if (body.status !== 'OK') throw new Error('HTTP ' + res.status + ' ' + (body.status || ''));
  const { lat, lng } = body.results[0].geometry.location;
  return { lat: Number(lat), lon: Number(lng) };
}

// One more call to a Google API, if today's and this month's allowance has room (GOOGLE_CAPS).
export async function spend(env, api) {
  if (!env.MESSAGES) return true; // tests
  const res = await env.MESSAGES.get(env.MESSAGES.idFromName('frame')).fetch('https://room/google/spend', { method: 'POST', body: JSON.stringify({ api }) });
  return res.status === 200;
}

// The room's side of spend(): counts by UTC day and month, in one stored value.
export async function countGoogle(storage, api, now = new Date()) {
  const cap = GOOGLE_CAPS[api];
  if (!cap) return { ok: false };
  const day = now.toISOString().slice(0, 10), month = day.slice(0, 7);
  const c = (await storage.get('google-calls')) || {};
  const d = c.day === day ? c.d || {} : {}, m = c.month === month ? c.m || {} : {};
  if ((d[api] || 0) >= cap.day || (m[api] || 0) >= cap.month) return { ok: false, day: d[api] || 0, month: m[api] || 0 };
  d[api] = (d[api] || 0) + 1; m[api] = (m[api] || 0) + 1;
  await storage.put('google-calls', { day, month, d, m });
  return { ok: true, day: d[api], month: m[api] };
}

// Google's map picture of a place, with its pin, at the size shown (and twice the pixels, for the
// frame's 1.5x screen). null when there's no key, the allowance is used up, or Google says no: the
// page shows OSM's tiles instead.
export async function staticMap(env, p) {
  const lat = Number(p.get('lat')), lon = Number(p.get('lon')), w = Math.round(Number(p.get('w'))), h = Math.round(Number(p.get('h'))), z = Math.round(Number(p.get('z')));
  if (!(Math.abs(lat) <= 85 && Math.abs(lon) <= 180 && w >= 50 && w <= 640 && h >= 50 && h <= 640 && z >= 3 && z <= 18)) return new Response('bad map', { status: 400 });
  if (!env.GOOGLE_MAPS_KEY) return new Response('no key', { status: 404 });
  if (!(await spend(env, 'static'))) return new Response('over the day\'s allowance', { status: 429 });
  const at = lat.toFixed(5) + ',' + lon.toFixed(5);
  const u = new URL(GOOGLE + 'staticmap');
  u.search = new URLSearchParams({ center: at, zoom: String(z), size: w + 'x' + h, scale: '2', markers: 'color:red|' + at, key: env.GOOGLE_MAPS_KEY });
  const up = await fetch(u);
  if (!up.ok || !/^image\//.test(up.headers.get('Content-Type') || '')) return new Response('map HTTP ' + up.status, { status: 502 });
  return new Response(up.body, { headers: { 'Content-Type': up.headers.get('Content-Type'), 'Cache-Control': 'private, max-age=' + DAY } });
}

async function search(q, viewbox) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ q, format: 'jsonv2', limit: '1', ...(viewbox ? { viewbox, bounded: '1' } : {}) });
  const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error('geocode HTTP ' + res.status);
  const [r] = await res.json();
  return r ? { lat: Number(r.lat), lon: Number(r.lon) } : null;
}

// { minutes, usual } for an event at a place starting at `at` (ISO), or null when it can't be found,
// is too soon gone or too far ahead to say (a week), or Google's allowance is used up. usual: without
// traffic. Leaving 30 minutes before it starts (or now, if that's past) is close enough for a trip of
// up to an hour or so.
const DRIVE_SOON = 2 * 3600, DRIVE_KEEP = { far: 12 * 3600, soon: 600 }; // seconds

export async function drive(env, q, at, now = Date.now()) {
  const start = Date.parse(at);
  if (!env.GOOGLE_MAPS_KEY || !(start > now && start - now < 7 * DAY * 1000)) return null;
  const lat = Number(env.HOME_LAT || env.WEATHER_LAT), lon = Number(env.HOME_LON || env.WEATHER_LON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const place = await geocode(env, q);
  if (!place) return null;
  // One answer per place, start and time bucket for every screen asking (Routes calls are capped).
  const keep = start - now > DRIVE_SOON * 1000 ? DRIVE_KEEP.far : DRIVE_KEEP.soon;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(`https://drive.cache/${place.lat},${place.lon}/${lat},${lon}/${start}/${keep}/${Math.floor(now / (keep * 1000))}`);
  const hit = cache && (await cache.match(cacheKey));
  if (hit) return hit.json();
  if (!(await spend(env, 'routes'))) return null;
  const point = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } });
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_MAPS_KEY, 'X-Goog-FieldMask': 'routes.duration,routes.staticDuration' },
    body: JSON.stringify({
      origin: point({ lat, lon }), destination: point(place), travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE', departureTime: new Date(Math.max(now + 60000, start - 30 * 60000)).toISOString(),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + ((body.error && body.error.status) || ''));
  const r = (body.routes || [])[0];
  if (!r) return null; // no road there (an island, another continent)
  const mins = (d) => Math.max(1, Math.round(parseFloat(d) / 60));
  const out = { minutes: mins(r.duration), usual: mins(r.staticDuration || r.duration) };
  if (cache) await cache.put(cacheKey, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + keep } }));
  return out;
}

const TILES = 'https://tile.googleapis.com/v1/';

// The tiles' session (Google's: about two weeks), made once and kept in KV until a day before it ends.
async function tileSession(env, fresh = false) {
  if (!fresh) {
    const hit = await env.CALENDAR.get('gtiles:session', 'json');
    if (hit && hit.session) return hit.session;
  }
  if (!(await spend(env, 'tiles'))) return null;
  const r = await fetch(TILES + 'createSession?key=' + encodeURIComponent(env.GOOGLE_MAPS_KEY), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapType: 'roadmap', language: 'en-US', region: 'US' }),
  });
  const d = r.ok ? await r.json() : null;
  if (!d || !d.session) throw new Error('tile session HTTP ' + r.status);
  const left = Number(d.expiry) - Date.now() / 1000 - DAY;
  await env.CALENDAR.put('gtiles:session', JSON.stringify({ session: d.session }), { expirationTtl: Math.max(60, Math.min(left, 13 * DAY)) | 0 });
  return d.session;
}

// Google's answer's own caching, as Cloudflare's cache and the browser should keep it: { edge, browser }
// in seconds, edge 0 when it's private or not to be stored.
export function tileKeep(cc) {
  cc = String(cc || '').toLowerCase();
  const m = /(?:^|,)\s*max-age=(\d+)/.exec(cc), age = m ? Math.min(+m[1], 30 * DAY) : 0;
  if (/no-store/.test(cc)) return { edge: 0, browser: 0 };
  return { edge: /private|no-cache/.test(cc) ? 0 : age, browser: /no-cache/.test(cc) ? 0 : age };
}

export async function googleTile(env, z, x, y, ctx) {
  const max = 2 ** z;
  if (!(z >= 3 && z <= 20 && x >= 0 && x < max && y >= 0 && y < max)) return new Response('bad tile', { status: 400 });
  if (!env.GOOGLE_MAPS_KEY) return new Response('no key', { status: 404 });
  const cache = caches.default, cacheKey = new Request(`https://gtile.cache/${z}/${x}/${y}`);
  let res = await cache.match(cacheKey), kept = res ? 'hit' : 'miss';
  if (!res) {
    let session = await tileSession(env);
    if (!session || !(await spend(env, 'tiles'))) return new Response('over the day\'s allowance', { status: 429 });
    const get = (s) => fetch(`${TILES}2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(s)}&key=${encodeURIComponent(env.GOOGLE_MAPS_KEY)}`);
    let up = await get(session);
    // A session Google has ended early: a new one, once.
    if (up.status === 400 || up.status === 401 || up.status === 403) {
      session = await tileSession(env, true);
      if (!session) return new Response('over the day\'s allowance', { status: 429 });
      up = await get(session);
    }
    const type = up.headers.get('Content-Type') || '';
    if (!up.ok || !/^image\//.test(type)) return new Response('tile HTTP ' + up.status, { status: 502 });
    const keep = tileKeep(up.headers.get('Cache-Control'));
    res = new Response(up.body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=' + keep.edge, 'X-Browser-Keep': String(keep.browser) } });
    if (keep.edge > 0) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    else kept = 'not kept';
  }
  // X-Edge: whether Cloudflare had it (hit), fetched it to keep (miss), or may not keep it (not kept).
  return new Response(res.body, { headers: { 'Content-Type': res.headers.get('Content-Type'), 'Cache-Control': 'private, max-age=' + (res.headers.get('X-Browser-Keep') || 0), 'X-Edge': kept } });
}

// Google's map data credit ("Map data ©2026 Google") for the view a screen shows: north, south, east,
// west and the zoom. Rounded outwards to a tenth of a degree and kept a day, so panning about one
// place asks once.
export async function mapCredit(env, p, ctx) {
  const z = Math.round(Number(p.get('z'))), edge = (k, f) => f(Number(p.get(k)) * 10) / 10;
  const n = edge('n', Math.ceil), s = edge('s', Math.floor), e = edge('e', Math.ceil), w = edge('w', Math.floor);
  if (!(z >= 3 && z <= 20 && n > -90 && n < 90 && s > -90 && s < 90 && n > s && Math.abs(e) <= 180 && Math.abs(w) <= 180)) return { credit: '' };
  if (!env.GOOGLE_MAPS_KEY) return { credit: '' };
  const cache = caches.default, cacheKey = new Request(`https://gtile.cache/credit/${z}/${n}/${s}/${e}/${w}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();
  const session = await tileSession(env);
  if (!session || !(await spend(env, 'tiles'))) return { credit: 'Google' };
  const u = new URL(TILES.replace('/v1/', '/tile/v1/') + 'viewport');
  u.search = new URLSearchParams({ session, key: env.GOOGLE_MAPS_KEY, zoom: String(z), north: n, south: s, east: e, west: w });
  const up = await fetch(u);
  const d = up.ok ? await up.json() : null;
  const out = { credit: (d && d.copyright) || 'Google' };
  if (d) ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(out), { headers: { 'Cache-Control': 'public, max-age=' + DAY } })));
  return out;
}

export async function tile(z, x, y, ctx) {
  const max = 2 ** z;
  if (!(z >= 3 && z <= 18 && x >= 0 && x < max && y >= 0 && y < max)) return new Response('bad tile', { status: 400 });
  const src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  const cache = caches.default, cacheKey = new Request(src);
  let res = await cache.match(cacheKey);
  if (!res) {
    const up = await fetch(src, { headers: { 'User-Agent': UA } });
    if (!up.ok) return new Response('tile HTTP ' + up.status, { status: 502 });
    res = new Response(up.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=' + 30 * DAY } });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  return new Response(res.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=' + 30 * DAY } });
}
