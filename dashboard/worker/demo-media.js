// GET /api/demo: what demo mode's Media tab needs on a frame with Home Assistant (src/lib/demo-media.svelte.js).
//   names      DEMO_NAMES, a JSON object of real name -> shown name for speakers, TVs, Spotify devices
//              and Videos groups ({"Den TV": "Living Room TV", "Sam": "Kiddo"}). A secret, so
//              the names stay out of the repo.
//   playlists  public Spotify playlists for the Music row in place of ours: DEMO_PLAYLISTS (playlist
//              links, separated by spaces) or the public ones below. Titles and covers come from
//              Spotify's oEmbed, which needs no key; they play through Home Assistant like ours.
// Dinner and kitchen ones first, then everyday ones: public playlists, some made by listeners, some
// by Spotify.
const DEFAULT = ['5RVeM2nZy52ve01J7k1FOe', '33YLYbQcmFT7Qv7NrNVIDo', '37i9dQZF1DX6ziVCJnEm59', '0ZjPyJzy3zNaDsLEpDyMO0',
  '71aeVyCWUHWuOvJeod2XB1', '7LD17YaJftpf0WMg40h25L', '37i9dQZF1DX0SM0LYsmbMT', '37i9dQZF1DXdPec7aLTmlC',
  '2PAGgoyhVYdC0q6vnb8qAL', '37i9dQZF1DX4WYpdgoIcn6', '37i9dQZF1DX4sWSpwq3LiO', '37i9dQZF1DXcBWIGoYBM5M'];

export function parseNames(text) {
  try {
    const o = JSON.parse(text || '{}');
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    return Object.fromEntries(Object.entries(o).filter(([k, v]) => typeof v === 'string' && k).map(([k, v]) => [k.slice(0, 80), v.slice(0, 40)]).slice(0, 100));
  } catch { return {}; }
}
export const playlistIds = (text) => {
  const ids = [...String(text || '').matchAll(/playlist[/:]([A-Za-z0-9]{22})/g)].map((m) => m[1]);
  return (ids.length ? ids : DEFAULT).slice(0, 20);
};

async function playlist(id) {
  const key = new Request('https://demo-playlist.local/' + id);
  const hit = await caches.default.match(key);
  if (hit) return hit.json();
  const r = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent('https://open.spotify.com/playlist/' + id));
  if (!r.ok) return null;
  const d = await r.json();
  const pl = { title: String(d.title || '').slice(0, 80), media_content_id: 'spotify:playlist:' + id, media_content_type: 'playlist', thumbnail: d.thumbnail_url || null };
  await caches.default.put(key, new Response(JSON.stringify(pl), { headers: { 'Cache-Control': 'public, max-age=86400' } }));
  return pl;
}

export async function demoMedia(env) {
  const playlists = (await Promise.all(playlistIds(env.DEMO_PLAYLISTS).map((id) => playlist(id).catch(() => null)))).filter((p) => p && p.title);
  return { names: parseNames(env.DEMO_NAMES), playlists };
}
