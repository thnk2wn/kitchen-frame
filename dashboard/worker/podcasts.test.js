import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanShows, rank, feedEpisodes, seconds, directoryEpisodes, mergeEpisodes, sized, parseExtra } from './podcasts.js';

test('podcasts: only known fields, https audio, and sizes kept in bounds', () => {
  const [s] = cleanShows([{ id: 'a', title: 'Show', extra: 'x', feed: 'http://insecure', episodes: [
    { id: 'e1', title: 'One', url: 'https://cdn/1.mp3', position: 120, seconds: 3600 },
    { id: 'e2', title: 'No audio' },
    { id: 'e3', title: 'Plain http', url: 'http://cdn/3.mp3' },
  ] }]);
  assert.equal(s.extra, undefined);
  assert.equal(s.feed, undefined);
  assert.deepEqual(s.episodes.map((e) => e.id), ['e1']);
  assert.equal(s.episodes[0].position, 120);
  assert.deepEqual(cleanShows('nope'), []);
});

test('podcasts: played lately first, then most played, then A–Z', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const shows = [
    { title: 'B', plays: 40, lastPlayed: '2026-09-01T00:00:00Z' },
    { title: 'A', plays: 2 },
    { title: 'C', plays: 5, lastPlayed: '2026-10-16T00:00:00Z' },
    { title: 'D', plays: 9, lastPlayed: '2026-10-17T08:00:00Z' },
  ];
  assert.deepEqual(rank(shows, now).map((s) => s.title), ['D', 'C', 'B', 'A']);
});

test('podcasts: a feed\'s newest episodes, https audio only', () => {
  const xml = `<rss><channel><title>Show</title>
    <item><title><![CDATA[Episode Two & More]]></title><guid>g2</guid><pubDate>Tue, 14 Oct 2026 09:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/2.mp3?a=1&amp;b=2" type="audio/mpeg"/><itunes:duration>1:02:03</itunes:duration>
      <description><![CDATA[<p>Show notes &amp; links</p>]]></description></item>
    <item><title>Old http one</title><enclosure url="http://cdn.example.com/1.mp3"/></item>
  </channel></rss>`;
  const [e, ...rest] = feedEpisodes(xml);
  assert.equal(rest.length, 0);
  assert.equal(e.title, 'Episode Two & More');
  assert.equal(e.url, 'https://cdn.example.com/2.mp3?a=1&b=2');
  assert.equal(e.seconds, 3723);
  assert.equal(e.description, 'Show notes & links');
  assert.equal(e.date, '2026-10-14T09:00:00.000Z');
  assert.equal(seconds('2400'), 2400);
});

test('podcasts: episodes from Apple\'s directory, https audio only', () => {
  const eps = directoryEpisodes([
    { wrapperType: 'track', trackName: 'The show itself' },
    { wrapperType: 'podcastEpisode', trackId: 7, trackName: 'Ep', episodeUrl: 'https://a/7.mp3', releaseDate: '2026-10-01T00:00:00Z', trackTimeMillis: 1800000, description: 'Notes &amp; more' },
    { wrapperType: 'podcastEpisode', trackId: 8, trackName: 'Insecure', episodeUrl: 'http://a/8.mp3' },
  ]);
  assert.deepEqual(eps, [{ id: 'apple:7', title: 'Ep', url: 'https://a/7.mp3', date: '2026-10-01T00:00:00Z', seconds: 1800, description: 'Notes & more' }]);
});

test('podcasts: the directory\'s latest episodes keep the phone\'s progress', () => {
  const mac = [
    { id: 'm1', title: 'Old one, half played', url: 'https://a/old.mp3', position: 600 },
    { id: 'm2', title: 'Episode 2!', url: 'https://cdn-old/2.mp3', played: true, description: 'From the Mac' },
  ];
  const latest = [{ id: 'apple:3', title: 'Episode 3', url: 'https://a/3.mp3' }, { id: 'apple:2', title: 'Episode 2', url: 'https://a/2.mp3' }];
  const out = mergeEpisodes(mac, latest);
  assert.deepEqual(out.map((e) => e.id), ['m1', 'apple:3', 'm2']);
  assert.equal(out[2].played, true);
  assert.equal(out[2].url, 'https://a/2.mp3');
  assert.deepEqual(mergeEpisodes(mac, []), mac);
});

test('podcasts: artwork templates filled in at 300 px', () => {
  assert.equal(sized('https://is1-ssl.mzstatic.com/image/thumb/x/mza_1.png/{w}x{h}bb.{f}'), 'https://is1-ssl.mzstatic.com/image/thumb/x/mza_1.png/300x300bb.jpg');
  assert.equal(sized('https://a/b.jpg/{w}x{h}{c}.{f}'), 'https://a/b.jpg/300x300bb.jpg');
  assert.equal(sized('https://a/600x600bb.jpg'), 'https://a/600x600bb.jpg');
});

test('podcasts: extra rows from links or ids, each with its name', () => {
  assert.deepEqual(parseExtra('Sam: https://podcasts.apple.com/us/podcast/planet-money/id290783428?uo=4 158004641 | Kids: id123456 | Bad: nothing | : 999999'),
    [{ name: 'Sam', ids: ['290783428', '158004641'] }, { name: 'Kids', ids: ['123456'] }]);
  assert.deepEqual(parseExtra(''), []);
});
