import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveCast, playPodcast, audioEvent, resume, withEchoSpots, echoSpots } from './podcast-audio.js';

const kv = () => { const m = new Map(); return { CALENDAR: { get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => m.set(k, v) } }; };
const ep = { id: 'e1', title: 'Episode One', url: 'https://cdn/1.mp3', seconds: 3600 };
const show = { title: 'The Show', art: 'https://art/1.jpg' };

test('podcast on the Echo: the frame\'s pick plays from its place, and the place is kept', async () => {
  const env = kv();
  assert.equal((await saveCast(env, { episode: { id: 'x', url: 'http://insecure' }, show })).status, 400);
  await saveCast(env, { episode: ep, show, position: 754 });
  const r = await playPodcast(env, '', []);
  const d = r.response.directives[0];
  assert.equal(d.type, 'AudioPlayer.Play');
  assert.equal(d.audioItem.stream.url, 'https://cdn/1.mp3');
  assert.equal(d.audioItem.stream.token, 'e1');
  assert.equal(d.audioItem.stream.offsetInMilliseconds, 754000);
  assert.equal(d.audioItem.metadata.subtitle, 'The Show');
  assert.equal(r.response.outputSpeech.text, 'Playing Episode One.');
  // Alexa says it stopped at 20 minutes: kept for the frame and for "resume".
  await audioEvent(env, 'AudioPlayer.PlaybackStopped', { token: 'e1', offsetInMilliseconds: 1200000 });
  assert.equal((await echoSpots(env)).e1.pos, 1200);
  const again = await resume(env, {});
  assert.equal(again.response.directives[0].audioItem.stream.offsetInMilliseconds, 1200000);
  // Finished: back to the start next time.
  await audioEvent(env, 'AudioPlayer.PlaybackFinished', { token: 'e1', offsetInMilliseconds: 3600000 });
  assert.equal((await echoSpots(env)).e1.done, true);
});

test('podcast on the Echo: by name, the half-played episode, else the newest', async () => {
  const env = kv();
  const shows = [{ title: 'Science Friday: Weekly Science', episodes: [{ id: 'n', title: 'Newest', url: 'https://cdn/n.mp3' }, { id: 'h', title: 'Half', url: 'https://cdn/h.mp3', position: 300 }] }];
  const r = await playPodcast(env, 'science friday', shows);
  assert.equal(r.response.directives[0].audioItem.stream.token, 'h');
  assert.equal(r.response.directives[0].audioItem.stream.offsetInMilliseconds, 300000);
  assert.match((await playPodcast(env, 'nonsense', shows)).response.outputSpeech.text, /couldn't find/);
});

test('podcast on the Echo: its places show on the frame when newer than the phone\'s', () => {
  const shows = [{ episodes: [{ id: 'a', touched: '2026-10-17T10:00:00Z', position: 100 }, { id: 'b', touched: '2026-10-17T10:00:00Z', position: 100 }] }];
  const out = withEchoSpots(shows, { a: { pos: 900, at: Date.parse('2026-10-17T12:00:00Z') }, b: { pos: 50, at: Date.parse('2026-10-17T09:00:00Z') } });
  assert.equal(out[0].episodes[0].position, 900);
  assert.equal(out[0].episodes[1].position, 100);
});
