import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, saveShared, sharedResponse } from './shared-media.js';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]).buffer;
const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 9, 9, 9, 9]).buffer;
const kv = () => {
  const m = new Map();
  return { m, put: async (k, v, o) => m.set(k, { v, o }), getWithMetadata: async (k) => ({ value: m.get(k)?.v ?? null, metadata: m.get(k)?.o?.metadata }) };
};
const form = (bytes, title) => { const f = new FormData(); if (bytes) f.append('file', new Blob([bytes]), 'f'); if (title) f.append('title', title); return f; };

test('kindOf: JPEG and MP4 by their bytes, anything else not', () => {
  assert.equal(kindOf(jpeg), 'photo');
  assert.equal(kindOf(mp4), 'video');
  assert.equal(kindOf(new TextEncoder().encode('<html>').buffer), null);
});

test('saveShared: kept a day with its kind; other files refused', async () => {
  const env = { CALENDAR: kv() };
  const r = await saveShared(env, form(mp4, 'Birthday'));
  assert.equal(r.status, 200);
  assert.equal(r.kind, 'video');
  assert.equal(r.title, 'Birthday');
  const [[key, { o }]] = [...env.CALENDAR.m];
  assert.equal(key, 'shared:' + r.id);
  assert.equal(o.expirationTtl, 86400);
  assert.equal((await saveShared(env, form(new TextEncoder().encode('hi').buffer))).status, 415);
  assert.equal((await saveShared(env, form(null))).status, 400);
});

test('sharedResponse: the whole file, a range of it, or not found', async () => {
  const env = { CALENDAR: kv() };
  const { id } = await saveShared(env, form(mp4));
  const all = await sharedResponse(env, id, new Request('https://x/'));
  assert.equal(all.headers.get('Content-Type'), 'video/mp4');
  assert.equal((await all.arrayBuffer()).byteLength, 16);
  const part = await sharedResponse(env, id, new Request('https://x/', { headers: { Range: 'bytes=4-7' } }));
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('Content-Range'), 'bytes 4-7/16');
  assert.equal((await sharedResponse(env, crypto.randomUUID(), new Request('https://x/'))).status, 404);
  assert.equal((await sharedResponse(env, 'nope', new Request('https://x/'))).status, 404);
});
