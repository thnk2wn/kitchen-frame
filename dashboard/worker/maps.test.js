import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mappable, geocode } from './maps.js';

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
  assert.deepEqual(await geocode(env, 'Williams-Brice Stadium, Columbia'), { lat: 33.97, lon: -81.02 });
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
