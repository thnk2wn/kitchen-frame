// A photo or video shared from a phone (the iPhone app's share extension, ios/): shown on the frame at
// once, full screen over whatever it shows, until someone closes it. The phone sends it ready for the
// frame: a JPEG at screen size, or an H.264 MP4 small enough for the frame's Wi-Fi. Kept a day (then KV
// drops it), so sharing doesn't use up the album's storage.
//
//   POST /api/share/media        multipart: file (image/jpeg or video/mp4), title? -> { id, sent }
//   GET  /api/share/media/:id    the file (videos by range, so the frame's player can seek)
const KEY = 'shared:';
const KEEP_S = 24 * 60 * 60;
const MAX_BYTES = 24 * 1024 * 1024; // a KV value can be 25 MB
export const SHARED_ID = /^[0-9a-f-]{36}$/;

export function kindOf(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'photo';
  if (String.fromCharCode(...b.slice(4, 8)) === 'ftyp') return 'video';
  return null;
}

export async function saveShared(env, form) {
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return { status: 400, body: { error: 'file: a JPEG or an MP4' } };
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return { status: 413, body: { error: 'over 24 MB' } };
  const kind = kindOf(bytes);
  if (!kind) return { status: 415, body: { error: 'not a JPEG or an MP4' } };
  const id = crypto.randomUUID();
  const title = String(form.get('title') || '').trim().slice(0, 120);
  await env.CALENDAR.put(KEY + id, bytes, { expirationTtl: KEEP_S, metadata: { kind } });
  return { status: 200, id, kind, title };
}

export async function sharedResponse(env, id, req) {
  if (!SHARED_ID.test(id)) return new Response('not found', { status: 404 });
  const { value: all, metadata } = await env.CALENDAR.getWithMetadata(KEY + id, 'arrayBuffer');
  if (!all) return new Response('not found', { status: 404 });
  const type = metadata && metadata.kind === 'video' ? 'video/mp4' : 'image/jpeg';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400, immutable' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') || '');
  if (!m) return new Response(all, { headers: { ...headers, 'Content-Length': String(all.byteLength) } });
  let start = m[1] ? Number(m[1]) : all.byteLength - Number(m[2]);
  let end = m[1] && m[2] ? Number(m[2]) : all.byteLength - 1;
  start = Math.max(0, start); end = Math.min(end, all.byteLength - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + all.byteLength } });
  return new Response(all.slice(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${all.byteLength}`, 'Content-Length': String(end - start + 1) } });
}
