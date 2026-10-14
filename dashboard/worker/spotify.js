// Spotify playlists for the Music tab, straight from the Spotify Web API. Home Assistant's Spotify
// integration only lists the first 48 playlists and only while something is playing, and it can't
// say which playlist was played last. Here: every playlist in the library (made or followed), and
// when each was last played on any device, from recently played tracks and their playlist.
// Playing still goes through Home Assistant.
// Secrets: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET (a developer.spotify.com app) and
// SPOTIFY_REFRESH_TOKEN (scripts/spotify-auth.mjs). Read-only scopes: playlists, recently played,
// currently playing.
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
  return (sized.find((i) => i.width >= 160) || sized[sized.length - 1] || imgs[0]).url;
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
    else {
      // Not in the library (a Spotify mix, say): ask for its name; Spotify refuses some of these.
      const r = await call(env, '/playlists/' + ctx.uri.split(':').pop() + '?fields=name').catch(() => null);
      title = r && r.name || null;
    }
  }
  current = { at: Date.now(), value: { uri: ctx ? ctx.uri : null, title } };
  return current.value;
}
