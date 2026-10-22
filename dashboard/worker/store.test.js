import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageRoom } from './messages.js';
import { roomStore } from './store.js';
import { saveFitness, listFitness, removeFitness } from './fitness.js';
import { saveStatus, getStatus } from './frame.js';

// The message room behind a stand-in for its Durable Object storage (with list, as Cloudflare's has),
// and a KV stand-in that counts its writes and lists.
function setup() {
  const data = new Map(), kv = new Map(), kvOps = { put: 0, list: 0 };
  const storage = {
    get: async (k) => structuredClone(data.get(k)),
    put: async (k, v) => { data.set(k, structuredClone(v)); },
    delete: async (k) => { for (const x of [].concat(k)) data.delete(x); },
    list: async ({ prefix = '', limit = 1000 } = {}) => new Map([...data.entries()].filter(([k]) => k.startsWith(prefix)).sort().slice(0, limit).map(([k, v]) => [k, structuredClone(v)])),
    setAlarm: async () => {}, deleteAlarm: async () => {},
  };
  const room = new MessageRoom({ storage, getWebSockets: () => [], acceptWebSocket() {}, setWebSocketAutoResponse() {} });
  const env = {
    MESSAGES: { idFromName: (n) => n, get: () => ({ fetch: (u, init) => room.fetch(u instanceof Request ? u : new Request(u, init)) }) },
    CALENDAR: {
      get: async (k, type) => (kv.has(k) ? (type === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null),
      put: async (k, v) => { kvOps.put++; kv.set(k, v); }, delete: async (k) => { kv.delete(k); },
      list: async ({ prefix }) => { kvOps.list++; return { keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
    },
  };
  return { env, data, kv, kvOps };
}
const ID1 = '11111111-2222-3333-4444-555555555555';
const day = (date) => ({ date, move: 300, moveGoal: 500, exercise: 12, exerciseGoal: 30, stand: 6, standGoal: 12 });

test('the room store: get, put, delete, list and entries by prefix; an expired entry is gone', async () => {
  const { env } = setup();
  const s = roomStore(env);
  await s.put('a:1', 'one');
  await s.put('a:2', JSON.stringify({ n: 2 }));
  await s.put('b:1', 'other');
  assert.equal(await s.get('a:1'), 'one');
  assert.deepEqual(await s.get('a:2', 'json'), { n: 2 });
  assert.equal(await s.get('nothing'), null);
  assert.deepEqual((await s.list({ prefix: 'a:' })).keys.map((k) => k.name), ['a:1', 'a:2']);
  assert.deepEqual((await s.entries('a:')).map((e) => e.key), ['a:1', 'a:2']);
  await s.delete('a:1');
  assert.equal(await s.get('a:1'), null);
  // A ttl in the past (put with a negative one is refused as none; so age one by hand).
  await s.put('t:1', 'x', { expirationTtl: 1 });
  const realNow = Date.now;
  Date.now = () => realNow() + 5000;
  try {
    assert.equal(await s.get('t:1'), null);
    assert.deepEqual((await s.list({ prefix: 't:' })).keys, []);
  } finally { Date.now = realNow; }
});

test('fitness lives in the room, not KV: sends write no KV, reading everyone lists no KV', async () => {
  const { env, kvOps } = setup();
  assert.equal((await saveFitness(env, { id: ID1, name: 'Sam', days: [day('2026-10-20')] })).status, 200);
  const { people } = await listFitness(env);
  assert.deepEqual(people.map((p) => p.name), ['Sam']);
  const before = { ...kvOps };
  await saveFitness(env, { id: ID1, name: 'Sam', days: [day('2026-10-21')] });
  await listFitness(env);
  assert.deepEqual(kvOps, before); // after the one-time move, no KV at all
  await removeFitness(env, ID1);
  assert.deepEqual((await listFitness(env)).people, []);
});

test('fitness that was in KV moves over once, so nobody disappears', async () => {
  const { env, kv } = setup();
  kv.set('fitness:' + ID1, JSON.stringify({ id: ID1, name: 'Sam', days: [], workouts: [], updated: '2026-10-21T00:00:00Z' }));
  assert.deepEqual((await listFitness(env)).people.map((p) => p.name), ['Sam']);
});

test('check-ins write the room, not KV; the last KV status is read until the first one', async () => {
  const { env, kv, kvOps } = setup();
  kv.set('frame:status', JSON.stringify({ version: 'old', log: [] }));
  assert.equal((await getStatus(env)).version, 'old');
  await saveStatus(env, { version: 'new', events: [] });
  assert.equal((await getStatus(env)).version, 'new');
  assert.equal(kvOps.put, 0);
});
