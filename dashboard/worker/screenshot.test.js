import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenshotRoute } from './screenshot.js';
import { MessageRoom } from './messages.js';

// The real message room, with in-memory storage and one connected frame.
function env() {
  const data = new Map(), sent = [];
  const storage = {
    get: async (k) => data.get(k),
    put: async (k, v) => { if (typeof k === 'object') for (const [kk, vv] of Object.entries(k)) data.set(kk, vv); else data.set(k, v); },
    delete: async (k) => { for (const kk of [].concat(k)) data.delete(kk); },
    setAlarm: async (t) => data.set('alarm', t),
    deleteAlarm: async () => data.delete('alarm'),
  };
  const instance = new MessageRoom({ storage, getWebSockets: () => [{ send: (m) => sent.push(JSON.parse(m)) }] });
  return { data, sent, instance, MESSAGES: { idFromName: () => 'frame', get: () => ({ fetch: (u, init) => instance.fetch(new Request(u, init)) }) } };
}
const call = (e, method, path, body, headers = {}) => {
  const url = new URL('https://frame.example.com' + path);
  return screenshotRoute(new Request(url, { method, body, headers }), e, url);
};
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

test('screenshot: asked (with a tab first), uploaded by the frame, then fetched as the JPEG', async () => {
  const e = env();
  const { asked, sent } = await (await call(e, 'POST', '/api/frame/screenshot/request', JSON.stringify({ tab: 'fitness' }))).json();
  assert.equal(sent, 1);
  assert.deepEqual(e.sent, [{ command: 'show', tab: 'fitness' }, { command: 'screenshot' }]);
  assert.equal((await call(e, 'GET', '/api/frame/screenshot?since=' + asked)).status, 404); // not yet
  assert.equal((await call(e, 'PUT', '/api/frame/screenshot', jpeg, { 'Content-Type': 'image/jpeg' })).status, 200);
  const got = await call(e, 'GET', '/api/frame/screenshot?since=' + asked);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('Content-Type'), 'image/jpeg');
  assert.ok(Number(got.headers.get('X-Taken-At')) >= asked);
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), jpeg);
  // An older one isn't an answer to a newer ask.
  assert.equal((await call(e, 'GET', '/api/frame/screenshot?since=' + (Date.now() + 60000))).status, 404);
});

test('screenshot: one ask per 10 seconds; nobody connected is said', async () => {
  const e = env();
  assert.equal((await call(e, 'POST', '/api/frame/screenshot/request', '{}')).status, 200);
  assert.equal((await call(e, 'POST', '/api/frame/screenshot/request', '{}')).status, 429);
  const lonely = env();
  lonely.instance.ctx.getWebSockets = () => [];
  assert.match((await (await call(lonely, 'POST', '/api/frame/screenshot/request', '{}')).json()).error, /isn’t connected/);
});

test('screenshot: the frame saying it couldn\'t is the answer; only JPEGs taken', async () => {
  const e = env();
  const { asked } = await (await call(e, 'POST', '/api/frame/screenshot/request', '{}')).json();
  await call(e, 'POST', '/api/frame/screenshot/error', JSON.stringify({ error: 'su refused' }));
  const got = await call(e, 'GET', '/api/frame/screenshot?since=' + asked);
  assert.equal(got.status, 422);
  assert.deepEqual(await got.json(), { error: 'su refused' });
  assert.equal((await call(e, 'PUT', '/api/frame/screenshot', 'hello', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await call(e, 'PUT', '/api/frame/screenshot', new Uint8Array(0), { 'Content-Type': 'image/jpeg' })).status, 413);
  assert.equal(await call(e, 'GET', '/api/frame/elsewhere'), null);
});

test('screenshot: deleted 10 minutes after it was taken, by the room\'s alarm', async () => {
  const e = env();
  await call(e, 'PUT', '/api/frame/screenshot', jpeg, { 'Content-Type': 'image/jpeg' });
  assert.equal(e.data.get('alarm'), e.data.get('shot-at') + 10 * 60000);
  await e.instance.alarm(); // too early: kept
  assert.ok(e.data.has('shot'));
  e.data.set('shot-at', Date.now() - 11 * 60000);
  await e.instance.alarm();
  assert.ok(!e.data.has('shot') && !e.data.has('shot-at'));
  assert.equal((await call(e, 'GET', '/api/frame/screenshot')).status, 404);
});
