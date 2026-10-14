import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPlaylists, spotifyConfigured, sourceOf, getQueue } from './spotify.js';

test('spotify: every page of playlists, a card-sized cover, and last played per playlist', async () => {
  const env = { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 's', SPOTIFY_REFRESH_TOKEN: 'r', CALENDAR: { get: async () => null, put: async () => {} } };
  assert.equal(spotifyConfigured(env), true);
  assert.equal(spotifyConfigured({}), false);
  const pl = (n, images = []) => ({ name: 'List ' + n, uri: 'spotify:playlist:' + n, images });
  globalThis.fetch = async (u) => {
    u = String(u);
    if (u.includes('/api/token')) return Response.json({ access_token: 'a', expires_in: 3600 });
    if (u.includes('/me/playlists') && !u.includes('offset')) return Response.json({ total: 3, items: [pl(1, [{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'small', width: 60 }]), null], next: 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50' });
    if (u.includes('offset=50')) return Response.json({ total: 3, items: [pl(2, [{ url: 'mosaic', width: null }])], next: null });
    if (u.includes('recently-played')) return Response.json({ items: [
      { played_at: '2026-10-14T13:00:00Z', context: { type: 'playlist', uri: 'spotify:playlist:2' } },
      { played_at: '2026-10-14T12:00:00Z', context: { type: 'playlist', uri: 'spotify:playlist:2' } },
      { played_at: '2026-10-14T11:00:00Z', context: { type: 'album', uri: 'spotify:album:x' } },
    ] });
    throw new Error('unexpected ' + u);
  };
  const r = await getPlaylists(env);
  assert.deepEqual(r.playlists.map((p) => [p.title, p.media_content_id, p.thumbnail]), [['List 1', 'spotify:playlist:1', 'mid'], ['List 2', 'spotify:playlist:2', 'mosaic']]);
  assert.deepEqual(r.played, { 'spotify:playlist:2': Date.parse('2026-10-14T13:00:00Z') });
});

test('spotify: a short list is retried, then refused rather than served', async () => {
  const { getPlaylists: fresh } = await import('./spotify.js?short');
  const env = { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 's', SPOTIFY_REFRESH_TOKEN: 'r', CALENDAR: { get: async () => null, put: async () => {} } };
  let pages = 0;
  globalThis.fetch = async (u) => {
    u = String(u);
    if (u.includes('/api/token')) return Response.json({ access_token: 'a', expires_in: 3600 });
    if (u.includes('/me/playlists')) { pages++; return Response.json({ total: 53, items: [{ name: 'Tron', uri: 'spotify:playlist:t', images: [] }], next: null }); }
    return Response.json({ items: [] });
  };
  await assert.rejects(fresh(env), /incomplete/);
  assert.equal(pages, 2);
});

test('spotify: what a song plays from, whatever the source', () => {
  const item = { album: { name: 'Tunes Vol. 1' }, artists: [{ name: 'Blippi', uri: 'spotify:artist:b' }] };
  assert.deepEqual(sourceOf({ item, context: { type: 'playlist', uri: 'spotify:playlist:1' } }, 'Kids'), { kind: 'playlist', name: 'Kids' });
  assert.deepEqual(sourceOf({ item, context: { type: 'album' } }), { kind: 'album', name: 'Tunes Vol. 1' });
  assert.deepEqual(sourceOf({ item, context: { type: 'artist', uri: 'spotify:artist:b' } }), { kind: 'artist', name: 'Blippi' });
  assert.deepEqual(sourceOf({ item, context: { type: 'collection' } }), { kind: 'liked', name: 'Liked Songs' });
  assert.deepEqual(sourceOf({ item, context: null }), { kind: 'none' });
  assert.equal(sourceOf(null), null);
});

test('spotify: Up next, each song once, or a note that the permission is missing', async () => {
  const env = { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 's', SPOTIFY_REFRESH_TOKEN: 'r2', CALENDAR: { get: async () => null, put: async () => {} } };
  const song = (n) => ({ uri: 'spotify:track:' + n, name: 'Song ' + n, artists: [{ name: 'A' }], album: { images: [{ url: 'big', width: 640 }, { url: 'small', width: 64 }] } });
  globalThis.fetch = async (u) => {
    u = String(u);
    if (u.includes('/api/token')) return Response.json({ access_token: 'a', expires_in: 3600 });
    return Response.json({ queue: [song(1), song(2), song(2), song(1)] });
  };
  const q = await getQueue(env);
  assert.deepEqual(q.items.map((t) => [t.title, t.image]), [['Song 1', 'small'], ['Song 2', 'small']]);
});
