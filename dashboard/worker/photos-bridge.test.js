import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgePhotoList, bridgePhotoUpload, listPhotos, photoResponse } from './photos.js';

// KV with the calls photos.js makes: get (json, stream, arrayBuffer), put, delete.
function kv() {
  const m = new Map();
  return {
    m,
    get: async (k, type) => (!m.has(k) ? null : type === 'json' ? JSON.parse(m.get(k)) : m.get(k)),
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
  };
}
const jpeg = (n = 10) => { const b = new Uint8Array(n); b[0] = 0xff; b[1] = 0xd8; return b.buffer; };
const photo = (id) => ({ id, w: 1920, h: 1080, date: '2026-10-01T12:00:00Z' });

test('bridge photos: list, upload what is missing, then show it; removed ones are deleted', async () => {
  const env = { CALENDAR: kv(), ALBUM_URL: 'bridge:Family%20Photos' };
  let r = await bridgePhotoList(env, { photos: [photo('aaaaaaaa-1'), photo('bbbbbbbb-2')] });
  assert.deepEqual(r.missing, ['aaaaaaaa-1', 'bbbbbbbb-2']);
  assert.equal((await listPhotos(env)).photos.length, 0);     // nothing to show until uploaded

  assert.equal((await bridgePhotoUpload(env, 'aaaaaaaa-1', jpeg())).status, 200);
  r = await bridgePhotoList(env, { photos: [photo('aaaaaaaa-1'), photo('bbbbbbbb-2')] });
  assert.deepEqual(r.missing, ['bbbbbbbb-2']);
  assert.deepEqual((await listPhotos(env)).photos.map((p) => p.id), ['aaaaaaaa-1']);
  assert.equal((await photoResponse(env, 'aaaaaaaa-1')).status, 200);
  assert.equal((await photoResponse(env, 'bbbbbbbb-2')).status, 404); // never fetched from anywhere else

  r = await bridgePhotoList(env, { photos: [] });              // taken out of the album
  assert.equal(r.removed, 1);
  assert.equal(env.CALENDAR.m.has('photo:aaaaaaaa-1'), false);
});

test('bridge photos: uploads must be JPEGs under 1 MB with a plain id', async () => {
  const env = { CALENDAR: kv(), ALBUM_URL: 'bridge:Family' };
  assert.equal((await bridgePhotoUpload(env, '../etc', jpeg())).status, 400);
  assert.equal((await bridgePhotoUpload(env, 'aaaaaaaa-1', new Uint8Array([1, 2, 3]).buffer)).status, 415);
  assert.equal((await bridgePhotoUpload(env, 'aaaaaaaa-1', jpeg(1024 * 1024 + 1))).status, 413);
});
