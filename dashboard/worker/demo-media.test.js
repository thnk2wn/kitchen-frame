import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNames, playlistIds } from './demo-media.js';

test('demo names: a JSON object of strings; anything else is ignored', () => {
  assert.deepEqual(parseNames('{"Den TV":"Living Room TV","Sam":"Kiddo","x":3}'), { 'Den TV': 'Living Room TV', Sam: 'Kiddo' });
  assert.deepEqual(parseNames('not json'), {});
  assert.deepEqual(parseNames('["a"]'), {});
  assert.deepEqual(parseNames(''), {});
});

test('demo playlists: links or URIs from the setting, else the defaults', () => {
  assert.deepEqual(playlistIds('https://open.spotify.com/playlist/37i9dQZF1DX6ziVCJnEm59?si=x spotify:playlist:5RVeM2nZy52ve01J7k1FOe'),
    ['37i9dQZF1DX6ziVCJnEm59', '5RVeM2nZy52ve01J7k1FOe']);
  assert.equal(playlistIds('').length, 12);
});
