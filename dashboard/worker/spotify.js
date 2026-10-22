// Spotify playlists for the Music tab, straight from the Spotify Web API. Home Assistant's Spotify
// integration only lists the first 48 playlists and only while something is playing, and it can't
// say which playlist was played last. Here: every playlist in the library (made or followed), and
// when each was last played on any device, from recently played tracks and their playlist.
// Playing still goes through Home Assistant.
// Secrets: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET (a developer.spotify.com app) and
// SPOTIFY_REFRESH_TOKEN (scripts/spotify-auth.mjs). Read-only scopes: playlists, recently played,
// currently playing, and playback state (for the queue; Up next).
const API = 'https://api.spotify.com/v1';
const LIST_MS = 10 * 60 * 1000;   // the library changes rarely
const PLAYED_MS = 2 * 60 * 1000;  // listening changes often

export const spotifyConfigured = (env) => !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET && env.SPOTIFY_REFRESH_TOKEN);

let token = null; // { value, until }, per isolate
let lists = null; // { at, items }
let played = null; // { at, map }

async function digest(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function accessToken(env) {
  if (token && Date.now() < token.until) return token.value;
  // Spotify may hand back a new refresh token; it's kept in KV and preferred over the secret, under
  // a key tied to that secret, so signing in again (new secret, new permissions) starts fresh.
  const kvKey = 'spotify:refresh:' + (await digest(env.SPOTIFY_REFRESH_TOKEN));
  const refresh = (await env.CALENDAR.get(kvKey)) || env.SPOTIFY_REFRESH_TOKEN;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET) },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
  });
  if (!res.ok) throw new Error('Spotify token HTTP ' + res.status);
  const t = await res.json();
  if (t.refresh_token && t.refresh_token !== refresh) await env.CALENDAR.put(kvKey, t.refresh_token);
  token = { value: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 };
  return token.value;
}

async function call(env, url) {
  const res = await fetch(url.startsWith('http') ? url : API + url, { headers: { Authorization: 'Bearer ' + (await accessToken(env)) } });
  if (res.status === 401) token = null;
  if (!res.ok) throw new Error('Spotify HTTP ' + res.status);
  return res.json();
}

// The smallest cover at least 160 px wide (cards are ~130 px), else the largest there is.
function cover(images) {
  const imgs = (images || []).filter((i) => i && i.url);
  if (!imgs.length) return null;
  const sized = imgs.filter((i) => i.width).sort((a, b) => a.width - b.width);
  const url = (sized.find((i) => i.width >= 160) || sized[sized.length - 1] || imgs[0]).url;
  // Mosaics (the 2x2 covers of playlists without their own picture) come without sizes, so the
  // first, 640 px, would be used: ask for the 300 px one instead, a fifth of the pixels to decode.
  return url.replace(/^(https:\/\/mosaic\.scdn\.co\/)640\//, '$1300/');
}

// Every page of the library, or null when the pages don't add up to the total Spotify reports.
async function readAll(env) {
  const items = [];
  let total = null, seen = 0;
  for (let url = '/me/playlists?limit=50'; url && seen < 500;) {
    const page = await call(env, url);
    if (total == null) total = page.total;
    for (const p of page.items || []) {
      seen++;
      if (p) items.push({ title: p.name, media_content_id: p.uri, media_content_type: 'playlist', thumbnail: cover(p.images) });
    }
    url = page.next;
  }
  return total == null || seen >= Math.min(total, 500) ? items : null;
}

export async function getPlaylists(env) {
  if (!lists || Date.now() - lists.at > LIST_MS) {
    // Spotify has once answered with part of the list; a short read is tried again, then refused,
    // so the frame keeps its last full list rather than showing a few playlists as if that's all.
    let items = await readAll(env);
    if (!items) items = await readAll(env);
    if (!items) throw new Error('Spotify returned an incomplete playlist list');
    lists = { at: Date.now(), items };
  }
  if (!played || Date.now() - played.at > PLAYED_MS) {
    // The last 50 tracks played anywhere, each with the playlist it was played from (if any).
    const map = {};
    const recent = await call(env, '/me/player/recently-played?limit=50').catch(() => ({ items: [] }));
    for (const it of recent.items || []) {
      const uri = it.context && it.context.type === 'playlist' && it.context.uri;
      const at = Date.parse(it.played_at);
      if (uri && !(map[uri] >= at)) map[uri] = at;
    }
    played = { at: Date.now(), map };
  }
  return { playlists: lists.items, played: played.map };
}

// The playlist playing now (any device), for the Music tab's "From …" line: { uri, title } or nulls.
// Asked each time the song changes, so a short cache is enough.
let current = null; // { at, value }
// The ~300px picture from a Spotify images list (a cover for the tint), or the smallest at least
// 64px (a thumbnail in Up next).
function pick(images, min) {
  const s = [...(images || [])].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (s.find((i) => (i.width || 0) >= min) || s[s.length - 1] || {}).url || null;
}

// What the song is playing from: a playlist (named), an album, an artist, Liked Songs, or nothing
// (a song started on its own, or autoplay after a playlist ends).
export function sourceOf(body, playlistTitle) {
  const item = body && body.item, c = body && body.context;
  if (!item) return null;
  if (!c) return { kind: 'none' };
  if (c.type === 'playlist') return { kind: 'playlist', name: playlistTitle || null };
  if (c.type === 'album') return { kind: 'album', name: item.album && item.album.name };
  if (c.type === 'artist') return { kind: 'artist', name: ((item.artists || []).find((a) => a.uri === c.uri) || (item.artists || [])[0] || {}).name };
  if (c.type === 'collection') return { kind: 'liked', name: 'Liked Songs' };
  return { kind: 'none' };
}

// A playlist's name when it isn't in the library: the Web API's, else Spotify's public embed info
// (open.spotify.com/oembed). The API refuses Spotify's own playlists, the mixes and editorial ones
// ("Chill Good Vibes Mix", ids starting 37i9dQZF), for apps like this one since late 2024; the embed
// info still names them. Kept per playlist, so a song change doesn't ask again.
const names = new Map(); // uri -> name or ''
async function playlistName(env, uri) {
  if (names.has(uri)) return names.get(uri) || null;
  const id = uri.split(':').pop();
  let name = ((await call(env, '/playlists/' + id + '?fields=name').catch(() => null)) || {}).name || '';
  if (!name) {
    const r = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent('https://open.spotify.com/playlist/' + id)).catch(() => null);
    name = (r && r.ok && ((await r.json().catch(() => null)) || {}).title) || '';
  }
  if (names.size > 200) names.clear();
  names.set(uri, String(name).slice(0, 120));
  return name || null;
}

export async function getNow(env) {
  if (current && Date.now() - current.at < 10000) return current.value;
  const res = await fetch(API + '/me/player/currently-playing', { headers: { Authorization: 'Bearer ' + (await accessToken(env)) } });
  if (res.status === 401) token = null;
  if (res.status === 403) throw new Error('Spotify needs the currently-playing permission: run scripts/spotify-auth.mjs again');
  if (!res.ok && res.status !== 204) throw new Error('Spotify HTTP ' + res.status);
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  const ctx = body && body.context && body.context.type === 'playlist' ? body.context : null;
  let title = null;
  if (ctx) {
    const known = lists && lists.items.find((p) => p.media_content_id === ctx.uri);
    if (known) title = known.title;
    else title = await playlistName(env, ctx.uri);
  }
  const item = body && body.item;
  current = { at: Date.now(), value: {
    uri: ctx ? ctx.uri : null, title, from: sourceOf(body, title),
    image: item ? pick((item.album && item.album.images) || item.images, 250) : null,
  } };
  return current.value;
}

// Up next: the next few songs in Spotify's queue (needs the user-read-playback-state permission;
// without it, { needsAuth: true }, and the Music tab says how to grant it).
let queued = null; // { at, value }
export async function getQueue(env) {
  if (queued && Date.now() - queued.at < 10000) return queued.value;
  const res = await fetch(API + '/me/player/queue', { headers: { Authorization: 'Bearer ' + (await accessToken(env)) } });
  if (res.status === 401) token = null;
  if (res.status === 401 || res.status === 403) return { needsAuth: true };
  if (!res.ok && res.status !== 204) throw new Error('Spotify HTTP ' + res.status);
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  const seen = new Set();
  const items = [];
  for (const t of (body && body.queue) || []) {
    // Spotify repeats the last songs to fill the queue near the end of a playlist: once each.
    if (!t || seen.has(t.uri)) continue;
    seen.add(t.uri);
    items.push({ title: t.name, artist: (t.artists || []).map((a) => a.name).join(', ') || (t.show && t.show.name) || '', image: pick((t.album && t.album.images) || t.images, 64) });
    if (items.length === 6) break;
  }
  queued = { at: Date.now(), value: { items } };
  return queued.value;
}
