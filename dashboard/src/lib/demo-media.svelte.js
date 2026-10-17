// Demo mode's Media and House tabs. On a frame with Home Assistant it stays live: the real speakers, TVs and
// videos, all working, with private names swapped for ones fit to show an audience (DEMO_NAMES on the
// Worker: "Den TV" -> "Living Room TV") and public Spotify playlists in place of ours. Without
// Home Assistant (a laptop, the README screenshots) they're invented, as before.
import { ui } from './state.svelte.js';
import { haConfigured } from './ha.svelte.js';
import { api } from './api.js';

export const demoMedia = $state({ names: {}, playlists: [] });
export const liveDemo = () => ui.demo && haConfigured();
export const fakeMedia = () => ui.demo && !haConfigured();
// A name or text as demo mode shows it: a whole match first ("Alex Office Temperature" -> "Office
// Temperature"), else each name inside it, whole words, longest first ("Alex: Home" -> "Dad: Home").
// Unchanged outside demo mode.
let words = [];
export function nm(s) {
  if (!ui.demo || !s) return s;
  const names = demoMedia.names;
  if (names[s]) return names[s];
  let out = String(s);
  for (const [re, to] of words) out = out.replace(re, (m, pre) => pre + to);
  return out;
}
const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function setNames(names) {
  demoMedia.names = names;
  words = Object.keys(names).sort((a, b) => b.length - a.length)
    .map((k) => [new RegExp('(^|[^\\p{L}\\p{N}])' + esc(k) + '(?![\\p{L}\\p{N}])', 'gu'), names[k]]);
}

let loaded = false;
export function loadDemoMedia() {
  if (!liveDemo() || loaded) return;
  loaded = true;
  api('/api/demo').then((d) => {
    setNames(d.names || {});
    demoMedia.playlists = d.playlists || [];
  }, () => { loaded = false; });
}
