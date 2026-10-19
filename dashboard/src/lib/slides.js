// Slideshow order and preloading. The frame's Wi-Fi takes several seconds per photo, so the
// next slide is always downloaded and decoded ahead of time: in the background while the
// dashboard is up, and during each slide's 30 seconds on screen.
import { photos, ui } from './state.svelte.js';
import { mediaUrl } from './api.js';
import { log } from './log.svelte.js';

export const src = (p) => mediaUrl('/api/photos/' + p.id);
export const videoSrc = (p) => mediaUrl('/api/videos/' + p.id);
// A video plays as a video (Settings → Display → Videos in the slideshow); otherwise its still shows.
export const asVideo = (p) => !!(p && p.video && ui.slideVideos);

let queue = [];
let known = null;
let ready = null;      // a slide whose images are downloaded and decoded
let preparing = null;  // the preload in flight, if any

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Call whenever the album list changes: photos added since last time go to the front (shuffled
// among themselves: when many arrive at once, as when the album's source changed, they'd otherwise
// play in the album's order, newest first, every time), and photos removed from the album leave
// the queue.
export function noteAlbum(items) {
  const ids = new Set(items.map((p) => p.id));
  if (known !== null) queue = once([...shuffle(items.filter((p) => !known.has(p.id))), ...queue.filter((p) => ids.has(p.id))]);
  known = ids;
  // A slide prepared from the other set (demo mode's stock photos, or the album) is dropped.
  if (ready && !ready.every((p) => ids.has(p.id))) ready = null;
}

// Each photo once (by id). A photo queued twice (the album refreshed while the queue refilled) could
// otherwise be paired with itself, and a slide with the same photo twice stops the page (Svelte's
// each_key_duplicate), clock screen and waking included (seen 2026-10-19).
const once = (list) => { const seen = new Set(); return list.filter((p) => !seen.has(p.id) && seen.add(p.id)); };

// Portraits go in pairs (side by side fills a landscape screen); landscapes and videos go alone.
function pick() {
  const items = photos.items;
  if (!queue.length) queue = shuffle(once([...items]));
  const first = queue.shift();
  queue = queue.filter((p) => p.id !== first.id);
  if (first.h <= first.w || asVideo(first)) return [first];
  const i = queue.findIndex((p) => p.h > p.w && !asVideo(p));
  if (i >= 0) return [first, queue.splice(i, 1)[0]];
  const other = items.find((p) => p.h > p.w && p.id !== first.id && !asVideo(p));
  return other ? [first, other] : [first];
}

// How bright each photo is where text goes over it (0 dark … 1 white): the bottom left, behind the
// clock, and the top right, behind its details. Measured once per photo from a tiny copy (32 px
// across) while it's prepared, so the slideshow can shade just the bright ones. Keyed by photo id.
const light = new Map();
export const lightOf = (id) => light.get(id) || null;
function measure(p, img) {
  if (light.has(p.id)) return;
  try {
    const w = 32, h = Math.max(1, Math.round((32 * img.naturalHeight) / img.naturalWidth));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    // Average brightness (Rec. 709 luma) over a box given as fractions of the photo.
    const avg = (x0, y0, x1, y1) => {
      let sum = 0, n = 0;
      for (let y = Math.floor(y0 * h); y < Math.ceil(y1 * h); y++) {
        for (let x = Math.floor(x0 * w); x < Math.ceil(x1 * w); x++) {
          const i = (y * w + x) * 4;
          sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255; n++;
        }
      }
      return n ? sum / n : 0;
    };
    light.set(p.id, { bottom: avg(0, 0.6, 0.7, 1), corner: avg(0.6, 0, 1, 0.2) });
  } catch {} // unmeasured photos get the usual shading
}

// Videos (from the Mac bridge): muted, loaded in a hidden player while the slide before shows, and
// played in the photo's place when it's ready to play through. One that isn't within VIDEO_WAIT_MS
// shows its still this time. The prepared player is handed over by takeVideo.
const VIDEO_WAIT_MS = 60000;
const players = new Map(); // photo id -> a loaded <video>
export function takeVideo(p) {
  const v = players.get(p.id);
  players.delete(p.id);
  return v || null;
}
function loadVideo(p) {
  const t0 = Date.now();
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto';
  v.poster = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  return new Promise((done) => {
    const finish = (ok, why) => {
      clearTimeout(timer);
      v.oncanplaythrough = v.onerror = null;
      if (ok) { players.set(p.id, v); log('slide.video', { video: p.id.slice(0, 8), ms: Date.now() - t0 }); }
      else { v.removeAttribute('src'); v.load(); log('slide.video_skipped', { video: p.id.slice(0, 8), why, ms: Date.now() - t0 }, 'warn'); }
      done();
    };
    const timer = setTimeout(() => finish(false, 'slow'), VIDEO_WAIT_MS);
    v.oncanplaythrough = () => finish(true);
    v.onerror = () => finish(false, 'error ' + (v.error && v.error.code));
    v.src = videoSrc(p);
    v.load();
  });
}

export function prepare() {
  if (ready || preparing || !photos.items.length) return preparing;
  const items = pick();
  preparing = Promise.all(items.map((p) => {
    const img = new Image(); img.src = src(p);
    const still = img.decode().then(() => measure(p, img));
    return asVideo(p) ? still.then(() => loadVideo(p)) : still;
  }))
    .then(() => { if (!known || items.every((p) => known.has(p.id))) ready = items; }, () => {}) // a failed photo is skipped; the next call picks another
    .finally(() => { preparing = null; });
  return preparing;
}

// The next slide, ready to show; starts preparing the one after.
export async function takeSlide() {
  if (!ready) await prepare();
  const slide = ready && once(ready);
  ready = null;
  prepare();
  return slide;
}
