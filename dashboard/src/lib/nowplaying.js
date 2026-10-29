// Which player is "now playing" on Home, the top bar and the slideshow: the rules, apart from Home
// Assistant and storage so they can be tested (nowplaying.test.js). lib/ha.svelte.js keeps the state.

// After a pause, the last player stays this long (Home keeps the card so you can resume).
export const HOLD_MS = 30 * 60 * 1000;

// A speaker playing a TV's sound over AirPlay reports it as a track of its own, named after the TV
// (the TV's name as its album or artist), and stays paused on it after the TV is off. The TV is the
// one to show, so such a speaker isn't Now Playing.
export const echoesTv = (x, players) => !x.tv && players.some((t) => t.tv && t.friendly_name
  && (x.media_album_name === t.friendly_name || x.media_artist === t.friendly_name));

// Worth a card: a real title (AirPlay sends " " for most apps), a TV only when TVs are shown.
export const showable = (x, players, { tv = true } = {}) =>
  !!(x.media_title && x.media_title.trim()) && (tv || !x.tv) && !echoesTv(x, players);

// players: Home Assistant's media players. held/lastPlayed: the last player seen playing and when.
// Returns { player, held, lastPlayed }: what to show (or null) and the held player to remember.
export function pickNowPlaying(players, { tv = true, hold = false, held = null, lastPlayed = 0, now = Date.now() } = {}) {
  // Spotify's player first: an Echo playing Spotify also reports the song through its own player
  // (Alexa Devices), but only Spotify's knows the playlist.
  const busy = players.filter((x) => x.state === 'playing' && showable(x, players, { tv }));
  const p = busy.find((x) => x.entity_id.startsWith('media_player.spotify_')) || busy[0];
  if (p) return { player: p, held: p.entity_id, lastPlayed: now };
  if (!hold || !held || now - lastPlayed > HOLD_MS) return { player: null, held, lastPlayed };
  // Some speakers report "idle" instead of "paused" soon after a pause.
  const h = players.find((x) => x.entity_id === held);
  const ok = h && (h.state === 'paused' || h.state === 'idle') && showable(h, players, { tv });
  return { player: ok ? h : null, held, lastPlayed };
}
