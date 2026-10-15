// Slideshow order and preloading. The frame's Wi-Fi takes several seconds per photo, so the
// next slide is always downloaded and decoded ahead of time: in the background while the
// dashboard is up, and during each slide's 30 seconds on screen.
import { photos } from './state.svelte.js';
import { mediaUrl } from './api.js';

export const src = (p) => mediaUrl('/api/photos/' + p.id);

let queue = [];
let known = null;
let ready = null;      // a slide whose images are downloaded and decoded
let preparing = null;  // the preload in flight, if any

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Call whenever the album list changes: photos added since last time go to the front, and
// photos removed from the album leave the queue.
export function noteAlbum(items) {
  const ids = new Set(items.map((p) => p.id));
  if (known !== null) queue = [...items.filter((p) => !known.has(p.id)), ...queue.filter((p) => ids.has(p.id))];
  known = ids;
}

// Portraits go in pairs (side by side fills a landscape screen); landscapes go alone.
function pick() {
  const items = photos.items;
  if (!queue.length) queue = shuffle([...items]);
  const first = queue.shift();
  if (first.h <= first.w) return [first];
  const i = queue.findIndex((p) => p.h > p.w);
  if (i >= 0) return [first, queue.splice(i, 1)[0]];
  const other = items.find((p) => p.h > p.w && p.id !== first.id);
  return other ? [first, other] : [first];
}

export function prepare() {
  if (ready || preparing || !photos.items.length) return preparing;
  const items = pick();
  preparing = Promise.all(items.map((p) => { const img = new Image(); img.src = src(p); return img.decode(); }))
    .then(() => { ready = items; }, () => {}) // a failed photo is skipped; the next call picks another
    .finally(() => { preparing = null; });
  return preparing;
}

// The next slide, ready to show; starts preparing the one after.
export async function takeSlide() {
  if (!ready) await prepare();
  const slide = ready;
  ready = null;
  prepare();
  return slide;
}
