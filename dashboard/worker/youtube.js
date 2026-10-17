// YouTube videos for the Media tab's Videos view: groups of chosen videos and playlists, for kids
// to pick from on the frame (docs/music.md → Videos). Played there in YouTube's own embedded player.
//
// Setting YOUTUBE_VIDEOS (a Worker secret, as what a household watches is its own business):
//   "Blippi: https://www.youtube.com/playlist?list=PL… | Diggers: https://youtu.be/AbC… https://youtu.be/XyZ…"
// Groups are separated by |, each a name, a colon and links to videos or playlists, in any mix.
// A playlist gives its 15 newest videos (YouTube's public feed, no key), or all of them with
// YOUTUBE_API_KEY (optional, free from Google Cloud). A single video's title comes from YouTube's
// oEmbed, which needs no key either. Kept in KV for 6 hours, so YouTube is asked rarely.
//   GET /api/youtube               { groups: [{ name, videos: [{ id, title, seconds? }] }] }
//   GET /api/youtube/thumb/:id     the video's thumbnail, passed through and cached
const KEY = 'youtube';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const ID = /^[\w-]{11}$/;

// The video id in a YouTube link of any form (youtu.be, watch?v=, shorts, embed), or null.
export function videoIdOf(text) {
  const m = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/.exec(String(text || ''));
  return m ? m[1] : null;
}

export function parseSetting(text) {
  return String(text || '').split('|').map((g) => {
    const i = g.indexOf(':');
    if (i < 0) return null;
    const name = g.slice(0, i).trim().slice(0, 40);
    const links = g.slice(i + 1).trim().split(/\s+/).filter(Boolean);
    const items = links.map((l) => {
      const list = /[?&]list=([\w-]+)/.exec(l);
      if (list && !/[?&]v=/.test(l)) return { playlist: list[1] };
      const v = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([\w-]{11})/.exec(l) || (ID.test(l) ? [l, l] : null);
      return v ? { video: v[1] } : null;
    }).filter(Boolean);
    return name && items.length ? { name, items } : null;
  }).filter(Boolean);
}

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export async function videoTitle(id) {
  const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
  if (!r.ok) return null; // removed, private, or embedding refused
  return (await r.json()).title || '';
}

async function playlistVideos(env, list) {
  if (env.YOUTUBE_API_KEY) {
    const out = [];
    let page = '';
    do {
      const r = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?' + new URLSearchParams({ part: 'snippet', maxResults: '50', playlistId: list, key: env.YOUTUBE_API_KEY, ...(page ? { pageToken: page } : {}) }));
      if (!r.ok) throw new Error('YouTube API HTTP ' + r.status);
      const d = await r.json();
      for (const it of d.items || []) {
        const id = it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId;
        if (id && it.snippet.title !== 'Private video' && it.snippet.title !== 'Deleted video') out.push({ id, title: it.snippet.title });
      }
      page = d.nextPageToken || '';
    } while (page && out.length < 200);
    return out;
  }
  const r = await fetch('https://www.youtube.com/feeds/videos.xml?playlist_id=' + encodeURIComponent(list));
  if (!r.ok) throw new Error('playlist feed HTTP ' + r.status + ' (is the playlist public or unlisted?)');
  const xml = await r.text();
  return [...xml.matchAll(/<entry>[\s\S]*?<yt:videoId>([\w-]{11})<\/yt:videoId>[\s\S]*?<title>([^<]*)<\/title>/g)].map((m) => ({ id: m[1], title: decode(m[2]) }));
}

// Each video's length, for the badge on its thumbnail: from the API with a key, else from the
// video's public page ("lengthSeconds"). Kept by id across refreshes, and at most NEW_LENGTHS looked
// up per refresh (the free plan allows about 50 outside requests per call), so a long list fills in
// over a few refreshes. A video whose page can't be read just has no badge.
const LENGTHS_KEY = 'youtube-lengths';
const NEW_LENGTHS = 30;     // without a key: one page each
const NEW_LENGTHS_KEY = 500; // with a key: 50 a request
async function lengths(env, ids) {
  const known = (await env.CALENDAR.get(LENGTHS_KEY, 'json')) || {};
  const missing = ids.filter((id) => !(id in known)).slice(0, env.YOUTUBE_API_KEY ? NEW_LENGTHS_KEY : NEW_LENGTHS);
  if (!missing.length) return known;
  if (env.YOUTUBE_API_KEY) {
    for (let i = 0; i < missing.length; i += 50) {
      const r = await fetch('https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({ part: 'contentDetails', id: missing.slice(i, i + 50).join(','), key: env.YOUTUBE_API_KEY }));
      if (!r.ok) break;
      for (const it of (await r.json()).items || []) {
        const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(it.contentDetails && it.contentDetails.duration || '');
        if (m) known[it.id] = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
      }
    }
  } else {
    for (const id of missing) {
      try {
        // The consent cookie skips the cookie page YouTube shows some servers' first visit.
        const r = await fetch('https://www.youtube.com/watch?v=' + id, { headers: { 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' } });
        const text = r.ok ? await r.text() : '';
        const m = /"lengthSeconds":"(\d+)"/.exec(text);
        // Without the player data (YouTube's page for servers it suspects), the page's own metadata.
        const meta = /itemprop="duration" content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/.exec(text);
        if (m) known[id] = +m[1];
        else if (meta) known[id] = (+meta[1] || 0) * 3600 + (+meta[2] || 0) * 60 + (+meta[3] || 0);
        else console.warn('youtube length: no lengthSeconds for ' + id + ' (HTTP ' + r.status + ', ' + text.length + ' bytes' + (/consent|confirm you|not a bot/i.test(text) ? ', a consent or bot page' : '') + ')');
      } catch {}
    }
  }
  await env.CALENDAR.put(LENGTHS_KEY, JSON.stringify(known)).catch(() => {});
  return known;
}

async function fetchGroups(env) {
  const groups = [];
  const errors = [];
  for (const g of parseSetting(env.YOUTUBE_VIDEOS)) {
    const videos = [];
    for (const it of g.items) {
      try {
        if (it.playlist) videos.push(...(await playlistVideos(env, it.playlist)));
        else { const title = await videoTitle(it.video); if (title !== null) videos.push({ id: it.video, title }); }
      } catch (e) { errors.push(g.name + ': ' + String(e.message || e)); }
    }
    const seen = new Set();
    groups.push({ name: g.name, videos: videos.filter((v) => !seen.has(v.id) && seen.add(v.id)) });
  }
  const len = await lengths(env, groups.flatMap((g) => g.videos.map((v) => v.id))).catch(() => ({}));
  for (const g of groups) for (const v of g.videos) if (len[v.id]) v.seconds = len[v.id];
  return { fetched: Date.now(), groups, ...(errors.length ? { errors } : {}) };
}

export async function listVideos(env, { force = false } = {}) {
  if (!env.YOUTUBE_VIDEOS) return { groups: [] };
  const cached = await env.CALENDAR.get(KEY, 'json');
  if (!force && cached && Date.now() - cached.fetched < MAX_AGE_MS && cached.setting === env.YOUTUBE_VIDEOS) return cached.data;
  try {
    const data = await fetchGroups(env);
    await env.CALENDAR.put(KEY, JSON.stringify({ fetched: data.fetched, setting: env.YOUTUBE_VIDEOS, data }));
    return data;
  } catch (e) {
    if (cached) return { ...cached.data, error: String(e.message || e) }; // keep showing the last good list
    throw e;
  }
}

// The thumbnail (320x180), passed through: the frame then needn't trust YouTube's image servers'
// certificates itself (its Android 8.1 trust store is old), and Cloudflare's cache keeps it.
export async function thumbResponse(id, ctx) {
  if (!ID.test(id)) return new Response('not found', { status: 404 });
  const cacheKey = new Request('https://thumbs.local/' + id);
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;
  const r = await fetch('https://i.ytimg.com/vi/' + id + '/mqdefault.jpg');
  if (!r.ok) return new Response('not found', { status: 404 });
  const res = new Response(r.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' } });
  if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}
