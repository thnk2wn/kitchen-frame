import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mappable, geocode, lookups, countGoogle, staticMap, drive, googleTile, mapCredit, tileKeep, GOOGLE_CAPS } from './maps.js';

function kv() {
  const m = new Map(), puts = [];
  return { puts, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), put: async (k, v, o) => { m.set(k, v); puts.push([k, JSON.parse(v), o]); } };
}
const home = { WEATHER_LAT: '39.80', WEATHER_LON: '-89.64' };

test('video calls and links are never looked up', () => {
  for (const q of ['Video call', 'Microsoft Teams Meeting', 'https://zoom.us/j/1', 'Zoom', '']) assert.equal(mappable(q), false, q);
  for (const q of ['401 Main St, Springfield, IL', 'Neyland Stadium, Knoxville', 'Aquatic center']) assert.equal(mappable(q), true, q);
});

test('geocode: near home first, anywhere only for a specific place, cached either way', async () => {
  const asked = [];
  globalThis.fetch = async (u) => {
    const p = new URL(u).searchParams; asked.push(p.get('bounded') ? 'near' : 'anywhere');
    const hit = p.get('q').includes('Columbia') && !p.get('bounded');
    return Response.json(hit ? [{ lat: '33.97', lon: '-81.02' }] : []);
  };
  const env = { ...home, CALENDAR: kv() };
  assert.deepEqual(await geocode(env, 'Williams-Brice Stadium, Columbia', async () => {}), { lat: 33.97, lon: -81.02 });
  assert.deepEqual(asked, ['near', 'anywhere']);
  asked.length = 0;
  assert.equal(await geocode(env, 'Aquatic center'), null); // a bare name is only looked for nearby
  assert.deepEqual(asked, ['near']);
  asked.length = 0;
  await geocode(env, 'Williams-Brice Stadium,  Columbia'); // same place, cached
  await geocode(env, 'aquatic center');
  assert.deepEqual(asked, []);
  const miss = env.CALENDAR.puts.find(([k]) => k === 'geo:aquatic center');
  assert.equal(miss[2].expirationTtl, 7 * 86400); // misses are tried again after a week
});

test('lookups: a place name before its street address also tries the address alone', () => {
  assert.deepEqual(lookups('Riverside Fitness - Springfield 120 Main St, Springfield, IL 62701, United States'),
    ['Riverside Fitness - Springfield 120 Main St, Springfield, IL 62701, United States', '120 Main St, Springfield, IL 62701, United States']);
  assert.deepEqual(lookups('120 Main St, Springfield, IL'), ['120 Main St, Springfield, IL']); // already an address
  assert.deepEqual(lookups('Williams-Brice Stadium, Columbia'), ['Williams-Brice Stadium, Columbia']);
});

test('geocode: the address alone when the whole is not found; an old miss is looked up again', async () => {
  const asked = [];
  globalThis.fetch = async (u) => {
    const q = new URL(u).searchParams.get('q'); asked.push(q);
    return Response.json(q.startsWith('120 ') ? [{ lat: '39.80', lon: '-89.64' }] : []);
  };
  const env = { ...home, CALENDAR: kv() };
  const place = 'Riverside Fitness - Springfield 120 Main St, Springfield, IL 62701';
  await env.CALENDAR.put('geo:' + place.toLowerCase(), JSON.stringify({ none: true })); // saved by the old version
  assert.deepEqual(await geocode(env, place, async () => {}), { lat: 39.80, lon: -89.64 });
  assert.equal(asked.at(-1), '120 Main St, Springfield, IL 62701');
});

test('geocode with a Google key: Google first, kept 30 days; OSM when Google says no', async () => {
  const asked = [];
  globalThis.fetch = async (u) => {
    u = new URL(u); asked.push(u.host);
    if (u.host === 'maps.googleapis.com') {
      const a = u.searchParams.get('address');
      if (a.includes('Denied')) return Response.json({ status: 'REQUEST_DENIED' }, { status: 200 });
      return Response.json({ status: 'OK', results: [{ geometry: { location: { lat: 39.81, lng: -89.65 } } }] });
    }
    return Response.json([{ lat: '39.70', lon: '-89.60' }]);
  };
  const env = { ...home, GOOGLE_MAPS_KEY: 'k', CALENDAR: kv() };
  assert.deepEqual(await geocode(env, '401 Main St, Springfield'), { lat: 39.81, lon: -89.65 });
  assert.deepEqual(asked, ['maps.googleapis.com']);
  assert.equal(env.CALENDAR.puts[0][2].expirationTtl, 30 * 86400);
  asked.length = 0;
  assert.deepEqual(await geocode(env, 'Denied Arena', async () => {}), { lat: 39.70, lon: -89.60 });
  assert.deepEqual(asked, ['maps.googleapis.com', 'nominatim.openstreetmap.org']);
});

test('geocode with a Google key: a bare name found far from home is not taken', async () => {
  globalThis.fetch = async (u) => (new URL(u).host === 'maps.googleapis.com'
    ? Response.json({ status: 'OK', results: [{ geometry: { location: { lat: 51.5, lng: -0.1 } } }] })
    : Response.json([]));
  assert.equal(await geocode({ ...home, GOOGLE_MAPS_KEY: 'k', CALENDAR: kv() }, 'Aquatic center'), null);
});

test('countGoogle: stops at the day cap, starts again the next day', async () => {
  const m = new Map(), storage = { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); } };
  const day1 = new Date('2026-10-24T12:00:00Z'), day2 = new Date('2026-10-25T12:00:00Z');
  for (let i = 0; i < GOOGLE_CAPS.routes.day; i++) assert.equal((await countGoogle(storage, 'routes', day1)).ok, true);
  assert.equal((await countGoogle(storage, 'routes', day1)).ok, false);
  assert.equal((await countGoogle(storage, 'static', day1)).ok, true); // each API its own
  assert.equal((await countGoogle(storage, 'routes', day2)).ok, true);
  assert.equal((await countGoogle(storage, 'nope', day2)).ok, false);
});

test('countGoogle: stops at the month cap however the days fall', async () => {
  const m = new Map([['google-calls', { day: '2026-10-01', month: '2026-10', d: {}, m: { geocode: GOOGLE_CAPS.geocode.month } }]]);
  const storage = { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); } };
  assert.equal((await countGoogle(storage, 'geocode', new Date('2026-10-24T12:00:00Z'))).ok, false);
  assert.equal((await countGoogle(storage, 'geocode', new Date('2026-11-01T12:00:00Z'))).ok, true);
});

test('staticMap: checks its numbers, needs a key, and passes the picture through', async () => {
  const p = (q) => new URLSearchParams(q);
  assert.equal((await staticMap({ GOOGLE_MAPS_KEY: 'k' }, p('lat=1&lon=2&w=9999&h=200&z=15'))).status, 400);
  assert.equal((await staticMap({}, p('lat=1&lon=2&w=340&h=280&z=15'))).status, 404);
  let sent;
  globalThis.fetch = async (u) => { sent = new URL(u); return new Response('png', { headers: { 'Content-Type': 'image/png' } }); };
  const res = await staticMap({ GOOGLE_MAPS_KEY: 'k' }, p('lat=39.8&lon=-89.64&w=340&h=280&z=15'));
  assert.equal(res.status, 200);
  assert.equal(sent.searchParams.get('size'), '340x280');
  assert.equal(sent.searchParams.get('markers'), 'color:red|39.80000,-89.64000');
  assert.match(res.headers.get('Cache-Control'), /^private/);
});

test('drive: from home with traffic, only for a start in the coming week', async () => {
  let sent;
  globalThis.fetch = async (u, o) => {
    if (String(u).startsWith('https://routes.googleapis.com')) { sent = JSON.parse(o.body); return Response.json({ routes: [{ duration: '1260s', staticDuration: '900s' }] }); }
    return Response.json({ status: 'OK', results: [{ geometry: { location: { lat: 39.81, lng: -89.65 } } }] });
  };
  const env = { ...home, HOME_LAT: '39.7712', HOME_LON: '-89.6011', GOOGLE_MAPS_KEY: 'k', CALENDAR: kv() };
  const now = Date.parse('2026-10-24T12:00:00Z');
  assert.deepEqual(await drive(env, '401 Main St, Springfield', '2026-10-24T14:00:00Z', now), { minutes: 21, usual: 15 });
  assert.equal(sent.routingPreference, 'TRAFFIC_AWARE');
  assert.equal(sent.departureTime, '2026-10-24T13:30:00.000Z');
  assert.deepEqual(sent.origin.location.latLng, { latitude: 39.7712, longitude: -89.6011 });
  assert.equal(await drive(env, '401 Main St, Springfield', '2026-10-24T11:00:00Z', now), null); // already started
  assert.equal(await drive(env, '401 Main St, Springfield', '2026-11-05T11:00:00Z', now), null); // too far ahead
  assert.equal(await drive({ ...env, GOOGLE_MAPS_KEY: '' }, '401 Main St, Springfield', '2026-10-24T14:00:00Z', now), null);
});

test('drive: the route comes back as Google\'s line in the same call', async () => {
  let mask;
  globalThis.fetch = async (u, o) => {
    if (String(u).startsWith('https://routes.googleapis.com')) { mask = o.headers['X-Goog-FieldMask']; return Response.json({ routes: [{ duration: '780s', staticDuration: '780s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' } }] }); }
    return Response.json({ status: 'OK', results: [{ geometry: { location: { lat: 39.81, lng: -89.65 } } }] });
  };
  const env = { ...home, GOOGLE_MAPS_KEY: 'k', CALENDAR: kv() };
  const now = Date.parse('2026-10-24T12:00:00Z');
  assert.deepEqual(await drive(env, '401 Main St, Springfield', '2026-10-24T14:00:00Z', now), { minutes: 13, usual: 13, line: '_p~iF~ps|U_ulLnnqC' });
  assert.match(mask, /routes\.polyline\.encodedPolyline/);
  assert.doesNotMatch(mask, /speedReading|travelAdvisory/); // traffic along the line is a dearer tier
});

test('drive: one Routes call shared by every screen asking within its time bucket', async () => {
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
  let routes = 0;
  globalThis.fetch = async (u) => {
    if (String(u).startsWith('https://routes.googleapis.com')) { routes++; return Response.json({ routes: [{ duration: '780s', staticDuration: '780s' }] }); }
    return Response.json({ status: 'OK', results: [{ geometry: { location: { lat: 39.81, lng: -89.65 } } }] });
  };
  const env = { ...home, GOOGLE_MAPS_KEY: 'k', CALENDAR: kv() };
  const now = Date.parse('2026-10-24T12:00:00Z');
  for (let i = 0; i < 3; i++) assert.deepEqual(await drive(env, '401 Main St, Springfield', '2026-10-26T10:30:00Z', now + i * 60000), { minutes: 13, usual: 13 });
  assert.equal(routes, 1);
  delete globalThis.caches;
});

test('tileKeep: keeps a tile only as Google says', () => {
  assert.deepEqual(tileKeep('public, max-age=86400'), { edge: 86400, browser: 86400 });
  assert.deepEqual(tileKeep('private, max-age=3600'), { edge: 0, browser: 3600 });
  assert.deepEqual(tileKeep('no-store'), { edge: 0, browser: 0 });
  assert.deepEqual(tileKeep(null), { edge: 0, browser: 0 });
});

test('googleTile: one session kept, Cloudflare keeps public tiles, a dead session replaced once', async () => {
  const store = new Map(), waits = [], calls = [];
  globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
  let sessions = 0, dead = false;
  globalThis.fetch = async (u) => {
    u = String(u); calls.push(u.split('?')[0]);
    if (u.includes('createSession')) return Response.json({ session: 's' + ++sessions, expiry: String(Date.now() / 1000 + 14 * 86400) });
    if (dead && u.includes('session=s1')) return new Response('expired', { status: 400 });
    return new Response('png', { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
  };
  const env = { GOOGLE_MAPS_KEY: 'k', CALENDAR: kv() }, ctx = { waitUntil: (p) => waits.push(p) };
  assert.equal((await googleTile({}, 10, 1, 1, ctx)).status, 404); // no key
  assert.equal((await googleTile(env, 10, 2000, 1, ctx)).status, 400); // no such tile
  const a = await googleTile(env, 10, 1, 1, ctx);
  assert.equal(a.status, 200);
  assert.match(a.headers.get('Cache-Control'), /^private, max-age=86400$/);
  await Promise.all(waits);
  await googleTile(env, 10, 1, 1, ctx); // from Cloudflare's cache
  await googleTile(env, 10, 1, 2, ctx); // the same session
  assert.deepEqual(calls.filter((c) => c.includes('createSession')).length, 1);
  assert.equal(calls.filter((c) => c.includes('2dtiles')).length, 2);
  assert.doesNotMatch(String([...store.keys()]), /key=/); // the key never in a cache key
  dead = true;
  assert.equal((await googleTile(env, 10, 1, 3, ctx)).status, 200);
  assert.equal(sessions, 2);
  delete globalThis.caches;
});

test('mapCredit: a close view still asks (its edges rounded outwards), and is kept', async () => {
  const store = new Map(), waits = [], asked = [];
  globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
  globalThis.fetch = async (u) => {
    u = String(u);
    if (u.includes('createSession')) return Response.json({ session: 's1', expiry: String(Date.now() / 1000 + 14 * 86400) });
    asked.push(new URL(u).searchParams);
    return Response.json({ copyright: 'Map data ©2026 Google' });
  };
  const env = { GOOGLE_MAPS_KEY: 'k', CALENDAR: kv() }, ctx = { waitUntil: (p) => waits.push(p) };
  const p = new URLSearchParams('z=17&n=39.8062&s=39.8000&e=-89.6400&w=-89.6510');
  assert.deepEqual(await mapCredit(env, p, ctx), { credit: 'Map data ©2026 Google' });
  assert.deepEqual([asked[0].get('north'), asked[0].get('south'), asked[0].get('east'), asked[0].get('west')], ['39.9', '39.8', '-89.6', '-89.7']);
  await Promise.all(waits);
  await mapCredit(env, p, ctx);
  assert.equal(asked.length, 1);
  delete globalThis.caches;
});
