import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNowPlaying, HOLD_MS } from './nowplaying.js';

// Shapes as Home Assistant reports them: an Apple TV, and a soundbar that receives its sound over
// AirPlay and names the TV as the album (while playing) or artist (once paused).
const NOW = 1_800_000_000_000;
const tv = (state, extra = {}) => ({ entity_id: 'media_player.living_tv', friendly_name: 'Living Room', tv: true, platform: 'apple_tv', state, ...extra });
const bar = (state, extra = {}) => ({ entity_id: 'media_player.soundbar', friendly_name: 'Soundbar', state, ...extra });
const echo = (state, extra = {}) => ({ entity_id: 'media_player.kitchen_echo', friendly_name: 'Kitchen Echo', state, ...extra });
const spotify = (state, extra = {}) => ({ entity_id: 'media_player.spotify_me', friendly_name: 'Spotify', state, ...extra });
const pick = (players, opts = {}) => pickNowPlaying(players, { now: NOW, ...opts }).player;
const id = (p) => p && p.entity_id;

test('now playing: a TV playing a show, not the soundbar echoing it', () => {
  const players = [tv('playing', { media_title: 'Dancing With the Stars', media_artist: 'ABC 11' }),
    bar('playing', { media_title: 'Dancing With the Stars', media_artist: 'ABC 11', media_album_name: 'Living Room' })];
  assert.equal(id(pick(players)), 'media_player.living_tv');
  assert.equal(id(pick([...players].reverse())), 'media_player.living_tv');
});

test('now playing: the TV off leaves nothing, though the soundbar stays paused on its last title', () => {
  // The Apple TV's screensaver played a memory; the TV went off; the soundbar kept it, paused.
  const players = [tv('off'), bar('paused', { media_title: 'Beach Day - Summer', media_artist: 'Living Room' })];
  assert.equal(pick(players, { hold: true, held: 'media_player.soundbar', lastPlayed: NOW - 60000 }), null);
  assert.equal(pick(players, { hold: true, held: 'media_player.living_tv', lastPlayed: NOW - 60000 }), null);
});

test('now playing: a title of only spaces is no title (AirPlay from Netflix)', () => {
  const players = [tv('playing', { app_name: 'Netflix' }), bar('playing', { media_title: ' ', media_artist: ' ', media_album_name: 'Living Room' })];
  assert.equal(pick(players), null);
  // Without a TV it names, a blank title still isn't a card.
  assert.equal(pick([bar('playing', { media_title: ' ' })]), null);
});

test('now playing: the soundbar playing music of its own is shown', () => {
  const players = [tv('off'), bar('playing', { media_title: 'Golden Hour', media_artist: 'The Lanterns', media_album_name: 'Sunrise' })];
  assert.equal(id(pick(players)), 'media_player.soundbar');
});

test("now playing: Spotify's player over an Echo reporting the same song", () => {
  const song = { media_title: 'Golden Hour', media_artist: 'The Lanterns' };
  assert.equal(id(pick([echo('playing', song), spotify('playing', song)])), 'media_player.spotify_me');
});

test('now playing: TVs left out when Now Playing is music only', () => {
  const players = [tv('playing', { media_title: 'Coastlines' })];
  assert.equal(pick(players, { tv: false }), null);
  assert.equal(id(pick(players, { tv: true })), 'media_player.living_tv');
});

test('now playing: a paused speaker is held for 30 minutes, then let go', () => {
  const players = [echo('paused', { media_title: 'Golden Hour' })];
  const held = 'media_player.kitchen_echo';
  assert.equal(id(pick(players, { hold: true, held, lastPlayed: NOW - 60000 })), held);
  assert.equal(id(pick([echo('idle', { media_title: 'Golden Hour' })], { hold: true, held, lastPlayed: NOW - 60000 })), held);
  assert.equal(pick(players, { hold: true, held, lastPlayed: NOW - HOLD_MS - 1 }), null);
  // Without hold (the slideshow), only what's playing.
  assert.equal(pick(players, { held, lastPlayed: NOW - 60000 }), null);
  // Off, or its track gone: let go.
  assert.equal(pick([echo('off')], { hold: true, held, lastPlayed: NOW - 60000 }), null);
  assert.equal(pick([echo('paused')], { hold: true, held, lastPlayed: NOW - 60000 }), null);
});

test('now playing: another player starting takes over from the held one', () => {
  const players = [echo('paused', { media_title: 'Golden Hour' }), tv('playing', { media_title: 'Coastlines' })];
  const r = pickNowPlaying(players, { hold: true, held: 'media_player.kitchen_echo', lastPlayed: NOW - 60000, now: NOW });
  assert.equal(id(r.player), 'media_player.living_tv');
  assert.equal(r.held, 'media_player.living_tv');
  assert.equal(r.lastPlayed, NOW);
});
