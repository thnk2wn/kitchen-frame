import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guestMode, setGuestMode } from './guest.js';
import { MessageRoom } from './messages.js';

// The real message room, with in-memory storage and one connected frame.
function env() {
  const data = new Map(), sent = [];
  const ctx = { storage: { get: async (k) => data.get(k), put: async (k, v) => data.set(k, v) }, getWebSockets: () => [{ send: (m) => sent.push(JSON.parse(m)) }] };
  const instance = new MessageRoom(ctx);
  return { sent, MESSAGES: { idFromName: () => 'frame', get: () => instance } };
}

test('guest mode: off until turned on, on until turned off, and the frame told each time', async () => {
  const e = env();
  assert.deepEqual(await guestMode(e), { on: false });
  assert.deepEqual(await setGuestMode(e, true), { on: true });
  assert.deepEqual(await guestMode(e), { on: true }); // straight away, unlike KV
  await setGuestMode(e, false);
  assert.deepEqual(await guestMode(e), { on: false });
  assert.deepEqual(e.sent, [{ command: 'refresh', what: 'fitness' }, { command: 'refresh', what: 'fitness' }]);
});
