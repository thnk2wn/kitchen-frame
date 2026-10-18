// Podcasts (Media → Podcasts), from the Apple Podcasts library through the Mac bridge (PODCASTS=bridge;
// bridge/mac/, docs/music.md). The iPhone's library reaches the Mac's Podcasts app through iCloud; the
// bridge reads it there and sends the shows followed, each with its newest and half-played episodes,
// whenever it changes (or hourly). Kept here in KV for the frame:
//   POST /api/bridge/snapshot  { podcasts: [...] } from the bridge (index.js)
//   GET  /api/podcasts          the shows, most listened to first, with artwork the frame can show
// Episodes play straight from their public feed (their https audio links), from where the phone left off.
const KEY = 'bridge-podcasts';
const ART_KEY = 'podcast-art'; // Apple directory id -> a 300 px artwork URL, looked up once
const MAX_SHOWS = 60, MAX_EPISODES = 20;

export const podcastsOn = (env) => String(env.PODCASTS || '').trim().toLowerCase() === 'bridge';

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : undefined);
const https = (v) => (typeof v === 'string' && /^https:\/\//i.test(v) ? v.slice(0, 1000) : undefined);

// What the bridge sent, kept to known fields and sizes.
export function cleanShows(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_SHOWS).map((s) => ({
    id: str(s.id, 80), title: str(s.title, 200), author: str(s.author, 200), feed: https(s.feed), storeId: /^\d{1,15}$/.test(String(s.storeId || '')) ? String(s.storeId) : undefined,
    art: https(s.art), plays: num(s.plays) || 0, lastPlayed: str(s.lastPlayed, 40),
    episodes: (Array.isArray(s.episodes) ? s.episodes : []).slice(0, MAX_EPISODES).map((e) => ({
      id: str(e.id, 80), title: str(e.title, 300), url: https(e.url), date: str(e.date, 40), seconds: num(e.seconds),
      description: str(e.description, 700), position: num(e.position), played: e.played === true || undefined,
      touched: str(e.touched, 40), video: e.video === true || undefined,
    })).filter((e) => e.id && e.title && e.url),
  })).filter((s) => s.id && s.title);
}

export async function savePodcasts(env, list) {
  await env.CALENDAR.put(KEY, JSON.stringify({ at: new Date().toISOString(), shows: cleanShows(list) }));
}

// Most listened to first: played lately (within a fortnight) by when, then by how many plays, then A–Z.
export function rank(shows, now = Date.now()) {
  const recent = (s) => (s.lastPlayed && now - Date.parse(s.lastPlayed) < 14 * 86400000 ? Date.parse(s.lastPlayed) : 0);
  return [...shows].sort((a, b) => recent(b) - recent(a) || b.plays - a.plays || a.title.localeCompare(b.title));
}

// Artwork at 300 px: the library's own template when it had one, else Apple's directory (iTunes
// Search lookup, no key) by the show's id. Found ones are kept; a failed lookup is tried again a day on.
// Apple's artwork templates end "{w}x{h}bb.{f}" (or "{w}x{h}{c}.{f}"): filled in at 300 px.
export const sized = (url) => (url ? url.replace(/\{w\}x\{h\}(\{c\}|[a-z]*)\.\{f\}$/, '300x300bb.jpg') : url);
async function withArt(env, shows) {
  shows = shows.map((s) => (s.art ? { ...s, art: sized(s.art) } : s));
  const need = shows.filter((s) => !s.art && s.storeId);
  if (!need.length) return shows;
  const known = (await env.CALENDAR.get(ART_KEY, 'json')) || {};
  const stale = (k) => !k || (!k.url && Date.now() - (k.at || 0) > 86400000);
  const missing = need.filter((s) => stale(known[s.storeId])).map((s) => s.storeId);
  if (missing.length) {
    try {
      const r = await fetch('https://itunes.apple.com/lookup?entity=podcast&id=' + missing.slice(0, 50).join(','), { headers: { 'User-Agent': 'kitchen-frame' } });
      if (r.ok) {
        const d = await r.json();
        for (const x of d.results || []) {
          const url = x.artworkUrl600 || x.artworkUrl100;
          if (x.collectionId && url) known[String(x.collectionId)] = { url: url.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/300x300bb.$1'), at: Date.now() };
        }
        for (const id of missing) if (!known[id]) known[id] = { url: null, at: Date.now() };
        await env.CALENDAR.put(ART_KEY, JSON.stringify(known));
      } else console.warn('podcast art lookup: HTTP ' + r.status);
    } catch (e) { console.warn('podcast art lookup: ' + e.message); }
  }
  return shows.map((s) => (s.art || !s.storeId || !known[s.storeId] || !known[s.storeId].url ? s : { ...s, art: known[s.storeId].url }));
}

// A feed's newest episodes (for a show with no directory entry).
const unxml = (t) => String(t || '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
  .replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const tag = (item, name) => { const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i').exec(item); return m ? m[1] : ''; };
export const seconds = (d) => { const p = String(d || '').trim().split(':').map(Number); if (p.some(isNaN)) return undefined; return p.reduce((a, n) => a * 60 + n, 0) || undefined; };
export function feedEpisodes(xml, max = 12) {
  const out = [];
  for (const m of String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const item = m[0];
    const url = (/<enclosure[^>]*\surl="([^"]+)"/i.exec(item) || [])[1];
    if (!url || !/^https:\/\//i.test(url.replace(/&amp;/g, '&'))) continue;
    const title = unxml(tag(item, 'title'));
    const guid = unxml(tag(item, 'guid')) || url;
    const date = Date.parse(unxml(tag(item, 'pubDate')));
    out.push({ id: 'feed:' + guid.slice(-60), title, url: url.replace(/&amp;/g, '&'), date: isNaN(date) ? undefined : new Date(date).toISOString(),
      seconds: seconds(unxml(tag(item, 'itunes:duration'))), description: unxml(tag(item, 'description') || tag(item, 'itunes:summary')).slice(0, 700) || undefined });
    if (out.length >= max) break;
  }
  return out.filter((e) => e.title);
}
// Apple's directory lists a show's latest episodes with their audio (no key): the episodes of a show
// the Mac has none playable for, which happens for long-followed shows the app no longer refreshes.
export function directoryEpisodes(results, max = 12) {
  return (results || []).filter((r) => r.wrapperType === 'podcastEpisode' && /^https:\/\//i.test(r.episodeUrl || '')).slice(0, max).map((r) => ({
    id: 'apple:' + r.trackId, title: String(r.trackName || '').slice(0, 300), url: r.episodeUrl.slice(0, 1000),
    date: r.releaseDate || undefined, seconds: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : undefined,
    description: unxml(r.description || r.shortDescription || '').slice(0, 700) || undefined,
  })).filter((e) => e.title);
}
// Every show's latest episodes from Apple's directory (the Mac only refreshes a show while its Podcasts
// app runs, so its list can be months behind), with the phone's progress kept on the ones it has
// (matched by audio link or title), and its half-played ones kept first.
const same = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function mergeEpisodes(mac, latest, max = 14) {
  if (!latest.length) return mac;
  const byUrl = new Map(mac.map((e) => [e.url, e])), byTitle = new Map(mac.map((e) => [same(e.title), e]));
  const used = new Set();
  const merged = latest.map((e) => {
    const m = byUrl.get(e.url) || byTitle.get(same(e.title));
    if (!m) return e;
    used.add(m.id);
    return { ...e, id: m.id, position: m.position, played: m.played, touched: m.touched, description: m.description || e.description };
  });
  const started = mac.filter((e) => e.position && !used.has(e.id));
  return [...started, ...merged].slice(0, max);
}
async function directory(s) {
  const key = new Request('https://podcast-episodes-2.local/' + s.storeId);
  let hit = await caches.default.match(key);
  if (!hit) {
    const r = await fetch('https://itunes.apple.com/lookup?entity=podcastEpisode&limit=12&id=' + s.storeId, { headers: { 'User-Agent': 'kitchen-frame' } });
    const episodes = r.ok ? directoryEpisodes((await r.json()).results) : [];
    if (!r.ok) console.warn('podcast episodes lookup: HTTP ' + r.status);
    // Kept 6 hours; none found is tried again in 10 minutes.
    hit = new Response(JSON.stringify(episodes), { headers: { 'Cache-Control': 'public, max-age=' + (episodes.length ? 21600 : 600) } });
    await caches.default.put(key, hit.clone());
  }
  return hit.json();
}
// No directory entry and nothing from the Mac: the start of its feed (newest first), at most 512 KB.
async function fromFeed(s) {
  const key = new Request('https://podcast-feed-2.local/' + encodeURIComponent(s.feed));
  let hit = await caches.default.match(key);
  if (!hit) {
    let episodes = [];
    const r = await fetch(s.feed, { headers: { 'User-Agent': 'kitchen-frame' } });
    if (r.ok && r.body) {
      const reader = r.body.getReader(), dec = new TextDecoder();
      let text = '';
      while (text.length < 524288) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); }
      reader.cancel().catch(() => {});
      episodes = feedEpisodes(text);
    }
    hit = new Response(JSON.stringify(episodes), { headers: { 'Cache-Control': 'public, max-age=' + (episodes.length ? 21600 : 3600) } });
    await caches.default.put(key, hit.clone());
  }
  return hit.json();
}
async function withEpisodes(shows) {
  return Promise.all(shows.map(async (s) => {
    try {
      const mac = s.episodes || [];
      if (s.storeId) return { ...s, episodes: mergeEpisodes(mac, await directory(s)) };
      if (!mac.length && s.feed) return { ...s, episodes: await fromFeed(s) };
    } catch (e) { console.warn('podcast episodes: ' + e.message); }
    return s;
  }));
}

export async function listPodcasts(env) {
  if (!podcastsOn(env)) return { configured: false, shows: [] };
  const stored = await env.CALENDAR.get(KEY, 'json');
  if (!stored) return { configured: true, updated: null, shows: [] };
  return { configured: true, updated: stored.at, shows: rank(await withEpisodes(await withArt(env, stored.shows || []))) };
}
