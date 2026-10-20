import { test } from 'node:test';
import assert from 'node:assert/strict';
import { network, noteHome, homeOnly } from './home.js';
import { MessageRoom } from './messages.js';

// The real message room, with in-memory storage.
function env(extra = {}) {
  const data = new Map();
  const ctx = { storage: { get: async (k) => data.get(k), put: async (k, v) => data.set(k, v) }, getWebSockets: () => [] };
  const instance = new MessageRoom(ctx);
  return { data, MESSAGES: { idFromName: () => 'frame', get: () => ({ fetch: (u, init) => instance.fetch(new Request(u, init)) }) }, ...extra };
}
const from = (ip) => new Request('https://frame.example.com/api/frame/command', { method: 'POST', headers: ip ? { 'CF-Connecting-IP': ip } : {} });

test('network: IPv4 as is, IPv6 by its /64, mapped IPv4 as IPv4, junk as null', () => {
  assert.deepEqual(network('203.0.113.7'), { v4: '203.0.113.7' });
  assert.deepEqual(network('2001:db8:a:b:1:2:3:4'), { v6: '2001:db8:a:b' });
  assert.deepEqual(network('2001:0DB8:000a:b::99'), { v6: '2001:db8:a:b' });
  assert.deepEqual(network('2001:db8::1'), { v6: '2001:db8:0:0' });
  assert.deepEqual(network('::ffff:203.0.113.7'), { v4: '203.0.113.7' });
  assert.equal(network(''), null);
  assert.equal(network('not an address'), null);
  assert.equal(network('1:2:3:4:5:6:7:8:9'), null);
});

test('homeOnly: the frame\'s network (either family) goes ahead; elsewhere, or before any check-in, is refused', async () => {
  const e = env();
  assert.equal((await homeOnly(e, from('2001:db8:a:b::5'))).status, 403); // nothing learned yet
  await noteHome(e, from('2001:db8:a:b::1')); // the frame checks in over IPv6
  await noteHome(e, from('203.0.113.7')); // the Mac bridge over IPv4
  assert.equal(await homeOnly(e, from('2001:db8:a:b:aaaa::42')), null); // a phone on the same /64
  assert.equal(await homeOnly(e, from('203.0.113.7')), null);
  const away = await homeOnly(e, from('2001:db8:ffff:1::5'));
  assert.equal(away.status, 403);
  assert.match((await away.json()).error, /home network/);
  assert.equal((await homeOnly(e, from('198.51.100.1'))).status, 403);
  assert.equal((await homeOnly(e, from(''))).status, 403);
});

test('homeOnly: a new address from the ISP replaces the old; HOME_ONLY=off turns it off', async () => {
  const e = env();
  await noteHome(e, from('203.0.113.7'));
  await noteHome(e, from('203.0.113.99'));
  assert.equal((await homeOnly(e, from('203.0.113.7'))).status, 403);
  assert.equal(await homeOnly(e, from('203.0.113.99')), null);
  assert.equal(await homeOnly(env({ HOME_ONLY: 'off' }), from('198.51.100.1')), null);
});
