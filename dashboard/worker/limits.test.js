import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';
import { bodyLimit, DEFAULT_BODY, overLimit, rateKey } from './limits.js';

// A rate limiter that allows `n` calls per key, then refuses.
const limiter = (n) => { const seen = new Map(); return { limit: async ({ key }) => { seen.set(key, (seen.get(key) || 0) + 1); return { success: seen.get(key) <= n }; } }; };
const call = (env, path, { key, method = 'GET', headers = {} } = {}) => worker.fetch(new Request('https://frame.test' + path, {
  method, headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), 'CF-Connecting-IP': '203.0.113.7', ...headers },
}), env, { waitUntil() {} });

test('body limits: uploads get room, everything else the default', () => {
  assert.equal(bodyLimit('/api/frame/settings'), DEFAULT_BODY);
  assert.ok(bodyLimit('/api/bridge/videos/abc') > 24 * 1024 * 1024);
  assert.ok(bodyLimit('/api/share/media') > 24 * 1024 * 1024);
  assert.ok(bodyLimit('/api/frame/screenshot') > 1.5 * 1024 * 1024);
});

test('a body declared over its limit is refused before anything else', async () => {
  const env = { DASHBOARD_KEY: 'admin-key' };
  const res = await call(env, '/api/frame/settings', { key: 'admin-key', method: 'POST', headers: { 'Content-Length': String(2 * 1024 * 1024) } });
  assert.equal(res.status, 413);
});

test('a key over its rate gets 429; without a key, the address counts', async () => {
  const env = { DASHBOARD_KEY: 'admin-key', KEY_LIMIT: limiter(2), ADDRESS_LIMIT: limiter(1) };
  // The first two get past the limit (and on to "not found" for a route that isn't there).
  assert.notEqual((await call(env, '/api/nothing-here', { key: 'admin-key' })).status, 429);
  assert.notEqual((await call(env, '/api/nothing-here', { key: 'admin-key' })).status, 429);
  const third = await call(env, '/api/nothing-here', { key: 'admin-key' });
  assert.equal(third.status, 429);
  assert.equal(third.headers.get('Retry-After'), '60');
  assert.equal((await call(env, '/api/weather', { key: 'wrong' })).status, 401);
  assert.equal((await call(env, '/api/weather', { key: 'wrong' })).status, 429);
});

test('no limiter, or one that fails, lets requests through', async () => {
  assert.equal(await overLimit(undefined, 'admin'), false);
  assert.equal(await overLimit({ limit: async () => { throw new Error('down'); } }, 'admin'), false);
  assert.equal(rateKey({ role: 'frame', device: { id: 'abc123' } }), 'd:abc123');
  assert.equal(rateKey({ role: 'admin' }), 'admin');
});
