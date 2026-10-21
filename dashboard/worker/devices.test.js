import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';
import { MessageRoom } from './messages.js';
import { allowed } from './devices.js';

// The message room (which keeps the devices) behind a stand-in for its Durable Object, and KV.
function setup() {
  const data = new Map(), kv = new Map();
  const ctx = {
    storage: {
      get: async (k) => structuredClone(data.get(k)),
      put: async (k, v) => { data.set(k, structuredClone(v)); },
      delete: async (k) => { for (const x of [].concat(k)) data.delete(x); },
      setAlarm: async () => {}, deleteAlarm: async () => {},
    },
    getWebSockets: () => [], acceptWebSocket() {}, setWebSocketAutoResponse() {},
  };
  const room = new MessageRoom(ctx);
  const env = {
    DASHBOARD_KEY: 'admin-key',
    MESSAGES: { idFromName: (n) => n, get: () => ({ fetch: (u, init) => room.fetch(u instanceof Request ? u : new Request(u, init)) }) },
    CALENDAR: { get: async (k, type) => (kv.has(k) ? (type === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); }, list: async () => ({ keys: [...kv.keys()].map((name) => ({ name })) }) },
  };
  const call = (path, { key, method = 'GET', body, headers = {} } = {}) => worker.fetch(new Request('https://frame.test' + path, {
    method, headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), 'CF-Connecting-IP': '203.0.113.7', ...headers }, body: body && JSON.stringify(body),
  }), env, { waitUntil() {} });
  return { env, call, data };
}

async function frameAndPhone(t) {
  const frame = await (await t.call('/api/devices/frame', { key: 'admin-key', method: 'POST', body: { name: 'Kitchen' } })).json();
  const { code } = await (await t.call('/api/devices/pair', { key: frame.token, method: 'POST' })).json();
  const phone = await (await t.call('/api/devices/claim', { method: 'POST', body: { code, name: 'iPhone' } })).json();
  return { frame, phone, code };
}

test('roles: each key opens only what its device uses', () => {
  assert.equal(allowed({ role: 'admin' }, 'POST', '/api/devices/frame'), true);
  assert.equal(allowed({ role: 'frame' }, 'GET', '/api/calendar'), true);
  assert.equal(allowed({ role: 'frame' }, 'POST', '/api/devices/frame'), false);
  assert.equal(allowed({ role: 'phone' }, 'POST', '/api/frame/command'), true);
  assert.equal(allowed({ role: 'phone' }, 'GET', '/api/calendar'), false);
  assert.equal(allowed({ role: 'phone' }, 'POST', '/api/frame/status'), false); // can't check in as the frame
  assert.equal(allowed({ role: 'phone' }, 'GET', '/api/devices'), false);
  assert.equal(allowed({ role: 'phone' }, 'GET', '/api/fitness'), false); // can't read everyone's
  assert.equal(allowed({ role: 'ops' }, 'GET', '/api/ops/summary'), true);
  assert.equal(allowed({ role: 'ops' }, 'GET', '/api/fitness'), false);
  assert.equal(allowed(null, 'GET', '/api/weather'), false);
});

test('pairing: a one-time code from the frame becomes a phone key; used once, and only while fresh', async () => {
  const t = setup();
  const { frame, phone, code } = await frameAndPhone(t);
  assert.match(frame.token, /^kfd_/);
  assert.match(phone.token, /^kfd_/);
  assert.equal((await t.call('/api/devices/claim', { method: 'POST', body: { code, name: 'Again' } })).status, 403);
  // The phone can use the Remote's routes, not the frame's data or check-in.
  assert.equal((await t.call('/api/frame/home', { key: phone.token })).status, 200);
  assert.equal((await t.call('/api/calendar', { key: phone.token })).status, 403);
  assert.equal((await t.call('/api/frame/status', { key: phone.token, method: 'POST', body: { version: 'x' } })).status, 403);
  assert.equal((await t.call('/api/devices/pair', { key: phone.token, method: 'POST' })).status, 403);
  // Only the admin key makes a frame key.
  assert.equal((await t.call('/api/devices/frame', { key: frame.token, method: 'POST', body: {} })).status, 403);
  // Stored as hashes, never the keys.
  assert.ok(!JSON.stringify(t.data.get('devices')).includes(phone.token));
});

test('ten wrong pairing codes in a row cancel the ones showing', async () => {
  const t = setup();
  const frame = await (await t.call('/api/devices/frame', { key: 'admin-key', method: 'POST', body: {} })).json();
  const { code } = await (await t.call('/api/devices/pair', { key: frame.token, method: 'POST' })).json();
  for (let i = 0; i < 10; i++) await t.call('/api/devices/claim', { method: 'POST', body: { code: 'WRONG' + i } });
  assert.equal((await t.call('/api/devices/claim', { method: 'POST', body: { code } })).status, 403);
});

test('the frame lists and revokes devices; a revoked key stops at once', async () => {
  const t = setup();
  const { frame, phone } = await frameAndPhone(t);
  const list = (await (await t.call('/api/devices', { key: frame.token })).json()).devices;
  assert.deepEqual(list.map((d) => [d.role, d.name, d.you]), [['frame', 'Kitchen', true], ['phone', 'iPhone', false]]);
  assert.ok(!JSON.stringify(list).includes('hash'));
  assert.equal((await t.call('/api/devices/' + phone.id, { key: frame.token, method: 'DELETE' })).status, 200);
  assert.equal((await t.call('/api/frame/home', { key: phone.token })).status, 401);
  // A new frame key replaces the last one.
  const again = await (await t.call('/api/devices/frame', { key: 'admin-key', method: 'POST', body: {} })).json();
  assert.equal((await t.call('/api/devices', { key: frame.token })).status, 401);
  assert.equal((await t.call('/api/devices', { key: again.token })).status, 200);
});

test('a phone sends fitness for one person only', async () => {
  const t = setup();
  const { phone } = await frameAndPhone(t);
  const send = (id) => t.call('/api/fitness', { key: phone.token, method: 'POST', body: { id, name: 'Sam', days: [] } });
  assert.notEqual((await send('11111111-1111-4111-8111-111111111111')).status, 403);
  assert.equal((await send('22222222-2222-4222-8222-222222222222')).status, 403);
  assert.equal((await t.call('/api/fitness?id=22222222-2222-4222-8222-222222222222', { key: phone.token, method: 'DELETE' })).status, 403);
  // The same id in another case is still this phone's (iOS writes UUIDs in upper case).
  assert.notEqual((await send('11111111-1111-4111-8111-111111111111'.toUpperCase())).status, 403);
  // A second phone can't take over the first one's person, even before sending its own.
  const { frame } = await frameAndPhone(t);
  const { code } = await (await t.call('/api/devices/pair', { key: frame.token, method: 'POST' })).json();
  const other = await (await t.call('/api/devices/claim', { method: 'POST', body: { code, name: 'Other' } })).json();
  assert.equal((await t.call('/api/fitness?id=11111111-1111-4111-8111-111111111111', { key: other.token, method: 'DELETE' })).status, 403);
  assert.equal((await t.call('/api/fitness', { key: other.token })).status, 403);
});

test('wrong pairing codes count only while a code is showing', async () => {
  const t = setup();
  for (let i = 0; i < 12; i++) await t.call('/api/devices/claim', { method: 'POST', body: { code: 'JUNK' + i } });
  assert.equal(t.data.get('pair-fails'), undefined);
});

test('names lose control characters and direction overrides', async () => {
  const t = setup();
  const frame = await (await t.call('/api/devices/frame', { key: 'admin-key', method: 'POST', body: {} })).json();
  const { code } = await (await t.call('/api/devices/pair', { key: frame.token, method: 'POST' })).json();
  await t.call('/api/devices/claim', { method: 'POST', body: { code, name: 'Sam\u202Eenohp\u0007' } });
  const names = (await (await t.call('/api/devices', { key: frame.token })).json()).devices.map((d) => d.name);
  assert.ok(names.includes('Samenohp'));
});

test('only the frame (or the admin key) teaches the home network', async () => {
  const t = setup();
  const { frame } = await frameAndPhone(t);
  await t.call('/api/frame/status', { key: frame.token, method: 'POST', body: { version: 'x' } });
  const why = await (await t.call('/api/frame/home?why', { key: frame.token })).json();
  assert.equal(why.frame.v4, '203.0.113.7');
});

test('the status page key reads the summary only', async () => {
  const t = setup();
  assert.equal((await t.call('/api/devices', { key: 'admin-key', method: 'POST', body: { role: 'phone' } })).status, 400);
  const ops = await (await t.call('/api/devices', { key: 'admin-key', method: 'POST', body: { role: 'ops', name: 'Status page' } })).json();
  assert.notEqual((await t.call('/api/ops/summary', { key: ops.token })).status, 403);
  assert.equal((await t.call('/api/fitness', { key: ops.token })).status, 403);
});

test('the frame key gets a media cookie of its own; a phone key gets none', async () => {
  const t = setup();
  const { frame, phone } = await frameAndPhone(t);
  const set = (await t.call('/api/frame/home', { key: frame.token })).headers.get('Set-Cookie');
  assert.match(set, /^frame_auth=d\.[\w-]+\.[\w-]+; Path=\/api;/);
  const cookie = set.split(';')[0];
  assert.notEqual((await t.call('/api/tiles/1/1/1', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await t.call('/api/weather', { headers: { Cookie: cookie } })).status, 401); // media paths only
  assert.equal((await t.call('/api/tiles/1/1/1', { headers: { Cookie: cookie.replace(/\.[\w-]+$/, '.forged') } })).status, 401);
  assert.equal((await t.call('/api/frame/home', { key: phone.token })).headers.get('Set-Cookie'), null);
});
