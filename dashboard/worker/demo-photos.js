// Demo mode's slideshow: stock photos from Lorem Picsum (picsum.photos: free Unsplash photos, no key),
// so a demo never shows the family album and there's nothing to keep up. Picsum's ids are fixed;
// these are landscapes, towns and water picked for a kitchen wall (no screens, desks or faces).
const IDS = [110, 112, 116, 118, 124, 128, 142, 152, 162, 164, 165, 167, 174, 179, 182, 191, 193, 199, 200,
  204, 206, 215, 217, 218, 219, 231, 235, 244, 247, 249, 256, 259, 271, 277];
const W = 1280, H = 720; // the frame's screen in CSS px; Picsum crops to it

export const demoPhotos = () => ({ photos: IDS.map((n) => ({ id: 'demo-' + n, w: W, h: H, date: null, place: null })) });

// GET /api/photos/demo-<n>: passed through (Picsum redirects to its CDN) and kept a month at the edge.
export async function demoPhotoResponse(id, ctx) {
  const n = Number(/^demo-(\d{1,4})$/.exec(id)?.[1]);
  if (!IDS.includes(n)) return new Response('not found', { status: 404 });
  const key = new Request('https://picsum.photos/id/' + n + '/' + W + '/' + H + '.jpg');
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const r = await fetch(key, { redirect: 'follow' });
  if (!r.ok) return new Response('photo unavailable', { status: 502 });
  const res = new Response(r.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=2592000, immutable' } });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

// Demo mode's camera tiles on the House tab (a frame with Home Assistant): public-domain photos (from
// Flickr through Openverse) of the places cameras usually watch, picked by the camera's name, and
// light-coloured houses so they pass for one home. Never the real cameras.
const CAMS = {
  door: 'https://live.staticflickr.com/7711/17158419548_8a95f386f2_b.jpg',      // "Front Entry", Paul Pakozdi (public domain)
  driveway: 'https://live.staticflickr.com/5595/14954606117_c0f3c47ca8_b.jpg',  // "Spring Lake", satguru
  garage: 'https://live.staticflickr.com/65535/50266986133_613d4d586d_b.jpg',   // "Home Garage with Epoxy Coatings", Nolan V.
  yard: 'https://live.staticflickr.com/6187/6056683232_d3acd42948_b.jpg',       // "The beginnings of a Garden for the Buddha", Wonderlane
};
// GET /api/photos/demo-cam-<place>: passed through and kept a month at the edge.
export async function demoCamResponse(place, ctx) {
  if (!CAMS[place]) return new Response('not found', { status: 404 });
  const key = new Request(CAMS[place]);
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const r = await fetch(key, { headers: { 'User-Agent': 'kitchen-frame (demo camera picture)' } });
  if (!r.ok) return new Response('photo unavailable', { status: 502 });
  const res = new Response(r.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=2592000, immutable' } });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}
