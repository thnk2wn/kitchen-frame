// Photos for the idle screen, from an iCloud Shared Album: sent by the Mac bridge (ALBUM_URL
// bridge:<album name>, below), or read from the album's public link (ALBUM_URL, with the album's
// "Public Website" on), either link format iCloud hands out:
//   https://photos.icloud.com/shared/album/<token>   (newer: CloudKit, below)
//   https://www.icloud.com/sharedalbum/#<token>       (classic: the sharedstreams web feed, further down)
//
// Uses the same anonymous CloudKit calls the album's public web page makes: resolve the share
// token, then query the shared zone with the short-lived publicAccessAuthToken it returns. This
// is not a documented Apple API and may change without notice.
//
// The frame can't fetch from Apple's photo servers directly (its Android 8.1 trust store lacks
// DigiCert Global Root G2), so the Worker passes each image through.
import { shrink } from './images.js';

const CK = 'https://ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production';
const KEY = 'photos';
// New album photos reach the frame within half an hour. Expired image links don't wait for this:
// photoResponse re-lists the album when a link fails.
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_PHOTOS = 500;

export function albumToken(albumUrl) {
  const m = /\/shared\/album\/([A-Za-z0-9_-]+)/.exec(albumUrl || '');
  return m ? m[1] : null;
}

async function ck(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: 'https://photos.icloud.com' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('iCloud HTTP ' + res.status);
  return res.json();
}

// Album -> [{ id, w, h, date, url }], newest first. Prefers the edited version of a photo.
export async function fetchAlbum(albumUrl) {
  const classic = classicToken(albumUrl);
  if (classic) return fetchClassic(classic);
  const token = albumToken(albumUrl);
  if (!token) throw new Error('ALBUM_URL is not an iCloud shared album link');
  const resolved = await ck(CK + '/public/records/resolve?remapEnums=true', { shortGUIDs: [{ value: token }] });
  const share = resolved.results && resolved.results[0];
  const access = share && share.anonymousPublicAccess;
  if (!access) throw new Error('Album is not public (turn on Public Website in the album settings)');

  const query = access.databasePartition.replace(/\/$/, '') + '/database/1/com.apple.photos.cloud/production/shared/records/query?'
    + new URLSearchParams({ remapEnums: 'true', publicAccessAuthToken: access.token });
  const records = [];
  let marker;
  do {
    const page = await ck(query, {
      query: {
        recordType: 'CPLAssetAndMasterByAssetDateWithoutHiddenOrDeleted',
        filterBy: [{ fieldName: 'direction', comparator: 'EQUALS', fieldValue: { value: 'DESCENDING', type: 'STRING' } }],
      },
      zoneID: share.zoneID,
      resultsLimit: 200,
      ...(marker ? { continuationMarker: marker } : {}),
    });
    records.push(...(page.records || []));
    marker = page.continuationMarker;
  } while (marker && records.length < MAX_PHOTOS * 2);
  return toPhotos(records);
}

export function toPhotos(records) {
  const masters = new Map(records.filter((r) => r.recordType === 'CPLMaster').map((r) => [r.recordName, r.fields]));
  const photos = [];
  for (const asset of records.filter((r) => r.recordType === 'CPLAsset')) {
    const a = asset.fields;
    const m = masters.get(a.masterRef && a.masterRef.value.recordName) || {};
    // Edited photos carry their own rendered JPEG on the asset; otherwise use the master's medium
    // JPEG. Small JPEG originals (saved images) get no medium size, so use the original itself.
    const pick = [[a, 'resJPEGMed'], [m, 'resJPEGMed'], [m, 'resOriginal']].find(([f, k]) =>
      f[k + 'Res'] && /jpeg/.test(String(f[k + 'FileType'] && f[k + 'FileType'].value))
      && (k !== 'resOriginal' || Math.max(f[k + 'Width'].value, f[k + 'Height'].value) <= 2560));
    if (!pick) continue; // videos, HEIC-only originals
    const [src, k] = pick;
    photos.push({
      id: asset.recordName.replace(/[^A-Za-z0-9-]/g, '') + '-' + String(src[k + 'Fingerprint'].value).replace(/[^A-Za-z0-9]/g, '').slice(0, 12),
      w: src[k + 'Width'].value,
      h: src[k + 'Height'].value,
      date: a.assetDate ? a.assetDate.value : null,
      url: src[k + 'Res'].value.downloadURL.replace('${f}', 'photo.jpg'),
    });
    if (photos.length >= MAX_PHOTOS) break;
  }
  return photos;
}

// ---- Classic shared albums (www.icloud.com/sharedalbum/#<token>)
// The album's public web page reads two endpoints: webstream (every photo with its sizes, by
// checksum) and webasseturls (short-lived download links for chosen checksums). The first call may
// answer 330 with the album's real host. Videos come with a PosterFrame still, used as a photo.
export function classicToken(albumUrl) {
  const m = /icloud\.com\/sharedalbum\/[^#]*#([A-Za-z0-9_;-]+)/.exec(albumUrl || ''); // newer tokens include - _ ;
  return m ? m[1] : null;
}
async function stream(host, token, path, body) {
  const res = await fetch('https://' + host + '/' + encodeURIComponent(token) + '/sharedstreams/' + path, {
    method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://www.icloud.com' }, body: JSON.stringify(body),
  });
  if (res.status === 330) return { redirect: (await res.json().catch(() => ({})))['X-Apple-MMe-Host'] || res.headers.get('X-Apple-MMe-Host') };
  if (!res.ok) throw new Error('iCloud HTTP ' + res.status);
  return { data: await res.json() };
}
// Largest JPEG size that's at most 2560 px on its long side (iCloud's are ~2048), else the smallest.
export function pickDerivative(photo) {
  const ds = Object.entries(photo.derivatives || {}).map(([key, d]) => ({ key, ...d, w: Number(d.width), h: Number(d.height) }))
    .filter((d) => d.checksum && d.w && d.h && (photo.mediaAssetType !== 'video' || d.key === 'PosterFrame'));
  const fit = ds.filter((d) => Math.max(d.w, d.h) <= 2560).sort((a, b) => b.w * b.h - a.w * a.h);
  return fit[0] || ds.sort((a, b) => a.w * a.h - b.w * b.h)[0] || null;
}
// The token's leading characters name the album's server partition (base 62), as the web page does.
export function classicHost(token) {
  const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const digits = token[0] === 'A' ? token.slice(1, 2) : token.slice(1, 3);
  let n = 0;
  for (const c of digits) n = n * 62 + B62.indexOf(c);
  return 'p' + String(n).padStart(2, '0') + '-sharedstreams.icloud.com';
}
async function fetchClassic(token) {
  let host = classicHost(token);
  let r = await stream(host, token, 'webstream', { streamCtag: null });
  if (r.redirect) { host = r.redirect; r = await stream(host, token, 'webstream', { streamCtag: null }); }
  if (!r.data) throw new Error('Album is not public (turn on Public Website in the album settings)');
  const items = (r.data.photos || [])
    .map((p) => ({ p, d: pickDerivative(p) }))
    .filter((x) => x.d)
    .sort((a, b) => String(b.p.dateCreated || '').localeCompare(String(a.p.dateCreated || '')))
    .slice(0, MAX_PHOTOS);
  const urls = {};
  for (let i = 0; i < items.length; i += 100) {
    const u = await stream(host, token, 'webasseturls', { photoGuids: items.slice(i, i + 100).map((x) => x.p.photoGuid) });
    Object.assign(urls, (u.data && u.data.items) || {});
  }
  return items.filter(({ d }) => urls[d.checksum]).map(({ p, d }) => ({
    id: String(p.photoGuid).replace(/[^A-Za-z0-9-]/g, '') + '-' + String(d.checksum).replace(/[^A-Za-z0-9]/g, '').slice(0, 12),
    w: d.w,
    h: d.h,
    date: p.dateCreated || null,
    url: 'https://' + urls[d.checksum].url_location + urls[d.checksum].url_path,
  }));
}

// Cached album list (with signed links) from KV. When it's older than MAX_AGE_MS the cached copy
// is answered at once and re-listed in the background (with ctx), one re-list per isolate at a time.
let relisting = null;
function relist(env) {
  relisting ||= fetchAlbum(env.ALBUM_URL)
    .then(async (photos) => { const fresh = { fetched: Date.now(), photos }; await env.CALENDAR.put(KEY, JSON.stringify(fresh)); return fresh; })
    .finally(() => { relisting = null; });
  return relisting;
}

export async function getAlbum(env, { force = false, ctx } = {}) {
  if (bridgeAlbum(env)) return (await env.CALENDAR.get(BRIDGE_KEY, 'json')) || { fetched: 0, photos: [], error: 'Waiting for the Mac to send the album' };
  const cached = await env.CALENDAR.get(KEY, 'json');
  if (!force && cached && Date.now() - cached.fetched < MAX_AGE_MS) return cached;
  if (!force && cached && ctx) { ctx.waitUntil(relist(env).catch(() => {})); return cached; }
  try {
    return await relist(env);
  } catch (err) {
    if (cached) return { ...cached, error: String(err.message || err) }; // keep showing the last good list
    throw err;
  }
}

// What the frame sees: ids and sizes only, no Apple URLs.
export async function listPhotos(env, ctx) {
  const album = await getAlbum(env, { ctx });
  const storage = bridgeAlbum(env) ? await mediaStorage(env).catch((e) => { console.error('storage tally failed: ' + (e && e.message)); return null; }) : null;
  return { photos: album.photos.map(({ url, ...p }) => p), updated: new Date(album.fetched).toISOString(), ...(album.error ? { error: album.error } : {}), ...(storage ? { storage } : {}) };
}

const PHOTO_TTL_S = 30 * 24 * 3600; // keep each image's bytes in KV for 30 days

// Images are slow to fetch from iCloud (several seconds each), so the bytes are kept in KV
// after the first fetch; later requests from any device are served from there.
export async function photoResponse(env, id, ctx) {
  const headers = {
    'Content-Type': 'image/jpeg',
    // The id includes the image fingerprint, so a given URL never changes: cache it on the frame.
    'Cache-Control': 'private, max-age=604800, immutable',
  };
  const stored = await env.CALENDAR.get('photo:' + id, 'arrayBuffer');
  if (stored) return new Response(stored, { headers: { ...headers, 'X-Photo-Source': 'kv' } });
  if (bridgeAlbum(env)) return new Response('not found', { status: 404 }); // only what the Mac sent

  let photo = (await getAlbum(env)).photos.find((p) => p.id === id);
  let upstream = photo && (await fetch(photo.url));
  if (!upstream || !upstream.ok) {
    // Link expired or the photo is new: re-list once and try again.
    photo = (await getAlbum(env, { force: true })).photos.find((p) => p.id === id);
    upstream = photo && (await fetch(photo.url));
  }
  if (!upstream || !upstream.ok) return new Response('not found', { status: 404 });
  // Sized once for the 1920x1080 screen: a landscape fills it, a portrait fills half (they show in pairs).
  const { bytes } = await shrink(env, await upstream.arrayBuffer(), 'image/jpeg', photo.h > photo.w ? 960 : 1920, 250 * 1024);
  const save = env.CALENDAR.put('photo:' + id, bytes, { expirationTtl: PHOTO_TTL_S });
  if (ctx && ctx.waitUntil) ctx.waitUntil(save); else await save;
  return new Response(bytes, { headers: { ...headers, 'X-Photo-Source': 'icloud' } });
}

// ---- Through the Mac bridge (bridge/mac/): ALBUM_URL = bridge:<album name>
// The Mac reads the shared album as you (Apple's Photos framework), so the album needs no public
// link. It sends the album's photo list; the Worker answers which photos it doesn't have yet; the Mac
// uploads those, already sized for the screen, and sends the list again. Photos taken out of the
// album are deleted here. Uploaded photos don't expire: they stay until they leave the album.
const BRIDGE_KEY = 'bridge-photos';
export const bridgeAlbum = (env) => (/^bridge:/i.test(env.ALBUM_URL || '') ? decodeURIComponent(env.ALBUM_URL.slice(7)) : null);
const PHOTO_ID = /^[A-Za-z0-9-]{8,80}$/;
const MAX_UPLOAD = 1024 * 1024;

// POST { photos: [{ id, w, h, date }] }, newest first -> { missing: [ids still to upload] }.
// The frame's list becomes the photos sent that are here; any missing join it once uploaded.
export async function bridgePhotoList(env, body) {
  const sent = (Array.isArray(body && body.photos) ? body.photos : []).filter((p) => p && PHOTO_ID.test(p.id) && p.w > 0 && p.h > 0).slice(0, MAX_PHOTOS)
    .map((p) => ({ id: p.id, w: Math.round(p.w), h: Math.round(p.h), date: typeof p.date === 'string' ? p.date.slice(0, 40) : null,
      // where it was taken, as a town name the Mac looked up ("Asheville, NC"); never coordinates
      ...(typeof p.place === 'string' && p.place.trim() ? { place: p.place.trim().slice(0, 80) } : {}),
      // A video: its still shows as a photo, and the clip (uploaded separately) plays in the slideshow.
      ...(p.video === true ? { video: true, ...(Number.isFinite(p.seconds) ? { seconds: Math.round(p.seconds) } : {}) } : {}) }));
  const prev = (await env.CALENDAR.get(BRIDGE_KEY, 'json')) || { photos: [] };
  const had = new Set(prev.photos.map((p) => p.id));
  const missing = [];
  for (const p of sent) if (!had.has(p.id) && !(await env.CALENDAR.get('photo:' + p.id, 'stream'))) missing.push(p.id);
  const photos = sent.filter((p) => !missing.includes(p.id));
  const keep = new Set(sent.map((p) => p.id));
  const gone = prev.photos.filter((p) => !keep.has(p.id)).map((p) => p.id);
  for (const id of gone) await env.CALENDAR.delete('photo:' + id);
  if (gone.length) await forgetSizes(env, gone);
  if (gone.length || JSON.stringify(photos) !== JSON.stringify(prev.photos)) {
    await env.CALENDAR.put(BRIDGE_KEY, JSON.stringify({ fetched: Date.now(), photos }));
  }
  for (const id of gone) await env.CALENDAR.delete('video:' + id);
  // Videos whose clip isn't here yet, for the Mac to re-encode and upload after the stills.
  const missingVideos = [];
  for (const p of photos) if (p.video && !(await env.CALENDAR.get('video:' + p.id, 'stream'))) missingVideos.push(p.id);
  return { missing, missingVideos, removed: gone.length, showing: photos.length };
}

// PUT a photo's JPEG (sized by the Mac).
export async function bridgePhotoUpload(env, id, bytes) {
  if (!PHOTO_ID.test(id)) return { status: 400, body: { error: 'bad photo id' } };
  const b = new Uint8Array(bytes);
  if (b.byteLength > MAX_UPLOAD) return { status: 413, body: { error: 'over 1 MB: size it for the screen first' } };
  if (b[0] !== 0xff || b[1] !== 0xd8) return { status: 415, body: { error: 'not a JPEG' } };
  await env.CALENDAR.put('photo:' + id, bytes);
  await noteSize(env, 'photo:' + id, b.byteLength);
  return { status: 200, body: { ok: true } };
}

// ---- Videos from the Mac bridge, for the slideshow
// The Mac re-encodes each album video for the frame (H.264, 960x540) and uploads it here; the frame
// streams it from GET /api/videos/:id, in pieces (Range), as <video> asks.
const MAX_VIDEO = 24 * 1024 * 1024; // a KV value can be 25 MB

export async function bridgeVideoUpload(env, id, bytes) {
  if (!PHOTO_ID.test(id)) return { status: 400, body: { error: 'bad video id' } };
  const b = new Uint8Array(bytes);
  if (b.byteLength > MAX_VIDEO) return { status: 413, body: { error: 'over 24 MB' } };
  if (String.fromCharCode(...b.slice(4, 8)) !== 'ftyp') return { status: 415, body: { error: 'not an MP4' } };
  await env.CALENDAR.put('video:' + id, bytes);
  await noteSize(env, 'video:' + id, b.byteLength);
  return { status: 200, body: { ok: true, bytes: b.byteLength } };
}

export async function videoResponse(env, id, req) {
  if (!PHOTO_ID.test(id)) return new Response('not found', { status: 404 });
  const all = await env.CALENDAR.get('video:' + id, 'arrayBuffer');
  if (!all) return new Response('not found', { status: 404 });
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=604800, immutable' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') || '');
  if (!m) return new Response(all, { headers: { ...headers, 'Content-Length': String(all.byteLength) } });
  let start = m[1] ? Number(m[1]) : all.byteLength - Number(m[2]);
  let end = m[1] && m[2] ? Number(m[2]) : all.byteLength - 1;
  start = Math.max(0, start); end = Math.min(end, all.byteLength - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + all.byteLength } });
  return new Response(all.slice(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${all.byteLength}`, 'Content-Length': String(end - start + 1) } });
}

// ---- How much of Cloudflare's storage the album uses
// KV can't report its own size, and listing keys is limited on the free plan (1,000 a day), so the
// Worker keeps a tally: each photo's and video's size as it's uploaded, in one record. Photos and
// videos are nearly all of the storage (calendars and settings are small). The free plan has 1 GB;
// past that, uploads fail (and the Mac reports it on the status page).
const SIZES_KEY = 'media-sizes';
export const STORAGE_LIMIT = 1024 * 1024 * 1024;
async function noteSize(env, key, bytes) {
  const sizes = (await env.CALENDAR.get(SIZES_KEY, 'json')) || {};
  sizes[key] = bytes;
  await env.CALENDAR.put(SIZES_KEY, JSON.stringify(sizes));
}
async function forgetSizes(env, ids) {
  const sizes = (await env.CALENDAR.get(SIZES_KEY, 'json')) || {};
  for (const id of ids) { delete sizes['photo:' + id]; delete sizes['video:' + id]; }
  await env.CALENDAR.put(SIZES_KEY, JSON.stringify(sizes));
}
// { bytes, limit, photos, videos } for the album as it is now. Media stored before the tally began
// are measured once here (a handful of reads), then counted.
export async function mediaStorage(env) {
  const album = (await env.CALENDAR.get(BRIDGE_KEY, 'json')) || { photos: [] };
  const sizes = (await env.CALENDAR.get(SIZES_KEY, 'json')) || {};
  let added = false;
  const keys = album.photos.flatMap((p) => ['photo:' + p.id, ...(p.video ? ['video:' + p.id] : [])]);
  for (const k of keys.filter((k) => !(k in sizes)).slice(0, 50)) {
    const v = await env.CALENDAR.get(k, 'arrayBuffer');
    if (v) { sizes[k] = v.byteLength; added = true; }
  }
  // Saved for next time; a clash with another save (KV takes one write a second per key) only means
  // measuring again next time, so it's not an error.
  if (added) await env.CALENDAR.put(SIZES_KEY, JSON.stringify(sizes)).catch(() => {});
  const bytes = keys.reduce((n, k) => n + (sizes[k] || 0), 0);
  return { bytes, limit: STORAGE_LIMIT, photos: album.photos.length, videos: album.photos.filter((p) => p.video && sizes['video:' + p.id]).length };
}
