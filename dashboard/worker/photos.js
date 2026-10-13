// Photos for the idle screen, from an iCloud Shared Album with "Public Website" turned on.
// Secret: ALBUM_URL, either link format iCloud hands out:
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
  return { photos: album.photos.map(({ url, ...p }) => p), updated: new Date(album.fetched).toISOString(), ...(album.error ? { error: album.error } : {}) };
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
