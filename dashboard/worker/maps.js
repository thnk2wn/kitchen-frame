// Map previews for event locations, from OpenStreetMap: no account or key.
//   geocode(): an event's location text -> { lat, lon }, from Nominatim, cached in KV for good
//     (misses for a week), so each place is looked up once. Only called when someone opens an
//     event's details, never for every event in the feeds.
//   tile(): map tiles passed through from tile.openstreetmap.org and kept in Cloudflare's cache, so
//     the frame's slow Wi-Fi and OSM's servers each see a place's tiles once.
// Both follow OSM's usage policies: an identifying User-Agent, light use, results cached.
const UA = 'kitchen-frame/1.0 (+https://github.com/thnk2wn/kitchen-frame)';
const DAY = 86400;

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

// Search near home first (WEATHER_LAT/LON, ~150 km either way), so "Aquatic center" means the local
// one. Anywhere else only when the text names more than a bare place (a comma or a number, as in
// "Williams-Brice Stadium, Columbia" or a street address), to avoid a same-named place abroad.
export async function geocode(env, raw, wait = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const q = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!mappable(q)) return null;
  const key = 'geo:' + q.toLowerCase();
  const hit = await env.CALENDAR.get(key, 'json');
  // A miss saved before addresses were tried on their own (no v) is looked up again.
  if (hit && (hit.lat != null || hit.v === 2)) return hit.lat != null ? hit : null;
  const lat = Number(env.WEATHER_LAT), lon = Number(env.WEATHER_LON);
  const near = Number.isFinite(lat) && Number.isFinite(lon) ? [lon - 1.5, lat + 1.4, lon + 1.5, lat - 1.4].map((n) => n.toFixed(3)).join(',') : null;
  let found = null, calls = 0;
  // OSM asks for at most one search a second.
  const ask = async (text, box) => { if (calls++) await wait(1100); return search(text, box); };
  for (const text of lookups(q)) {
    found = near ? await ask(text, near) : null;
    if (!found && (!near || /[,\d]/.test(text))) found = await ask(text, null);
    if (found) break;
  }
  await env.CALENDAR.put(key, JSON.stringify(found || { none: true, v: 2 }), found ? {} : { expirationTtl: 7 * DAY });
  return found;
}

async function search(q, viewbox) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ q, format: 'jsonv2', limit: '1', ...(viewbox ? { viewbox, bounded: '1' } : {}) });
  const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error('geocode HTTP ' + res.status);
  const [r] = await res.json();
  return r ? { lat: Number(r.lat), lon: Number(r.lon) } : null;
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
