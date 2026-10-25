// Street map tiles for the radar and the full-screen map: Google's (worker/maps.js googleTile), or
// OpenStreetMap's when Google's aren't there (no key, the day's allowance used up, an error). After
// a few failures this run, OSM's from the start, so a missing key doesn't cost a failed request a tile.
// Demo mode keeps to OSM, like the event map.
import { api, mediaUrl } from './api.js';
import { ui } from './state.svelte.js';

export const TILE = 256;
let failures = 0;

export const googleFirst = () => !ui.demo && failures < 3;
export const tileSrc = (z, x, y, google) => mediaUrl(`/api/${google ? 'gtiles' : 'tiles'}/${z}/${x}/${y}`);
export const tileFailed = () => { failures++; };

// Web Mercator: a point's position in pixels at a zoom, and back.
export const pixel = (lat, lon, z) => {
  const n = 2 ** z * TILE, r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
};
export const lonLat = (x, y, z) => {
  const n = 2 ** z * TILE;
  return { lon: (x / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI };
};

// Google's map data credit for a view in pixels at a zoom ("Map data ©2026 Google"), which its terms
// ask to be shown with its tiles. The Worker keeps each a day.
const credits = new Map();
export function mapCredit(z, left, top, width, height) {
  const a = lonLat(left, top, z), b = lonLat(left + width, top + height, z);
  const q = `z=${z}&n=${a.lat.toFixed(4)}&s=${b.lat.toFixed(4)}&e=${b.lon.toFixed(4)}&w=${a.lon.toFixed(4)}`;
  if (!credits.has(q)) credits.set(q, api('/api/gtiles/credit?' + q).then((r) => r.credit || 'Google').catch(() => 'Google'));
  return credits.get(q);
}

// A tile as an image: Google's, or OSM's in its place. { img, google } or null.
const loadImg = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
export async function loadTile(z, x, y) {
  if (googleFirst()) {
    const img = await loadImg(tileSrc(z, x, y, true));
    if (img) return { img, google: true };
    tileFailed();
  }
  const img = await loadImg(tileSrc(z, x, y, false));
  return img ? { img, google: false } : null;
}
