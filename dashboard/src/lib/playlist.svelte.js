// Which playlist Spotify is playing from, for "From …" on the Music tab and Home's Now Playing card.
// HA's Spotify player often leaves media_playlist empty, so the Worker asks Spotify (once per song;
// SPOTIFY_* settings, docs/music.md). Without that connection, HA's own value is used when it has one.
import { ha } from './ha.svelte.js';
import { api } from './api.js';

// from: { kind: playlist | album | artist | liked | none, name }; image: the cover (Spotify's, which
// the frame may read colours from); queue: Up next, or null; queueAuth: Up next needs a permission.
export const nowList = $state({ entity: null, uri: null, title: null, from: null, image: null, queue: null, queueAuth: false });

$effect.root(() => {
  $effect(() => {
    const sp = ha.players.find((p) => p.entity_id.startsWith('media_player.spotify_'));
    const key = sp && sp.state === 'playing' ? sp.media_title + '|' + sp.media_artist : '';
    if (!key) return;
    let live = true;
    api('/api/spotify/now').then((r) => {
      if (!live || !r.configured || r.error) return;
      Object.assign(nowList, { entity: sp.entity_id, uri: r.uri || null, title: r.uri ? r.title : null, from: r.from || null, image: r.image || null });
    }).catch(() => {});
    api('/api/spotify/queue').then((r) => {
      if (!live || !r.configured || r.error) return;
      Object.assign(nowList, { queue: r.items || null, queueAuth: !!r.needsAuth });
    }).catch(() => {});
    return () => { live = false; };
  });
});

// The playlist name for a player, or null (an album, a single song, or not known).
export function playlistOf(p) {
  if (!p) return null;
  if (p.entity_id === nowList.entity && nowList.uri) return nowList.title || p.media_playlist || null;
  return p.media_playlist || null;
}
