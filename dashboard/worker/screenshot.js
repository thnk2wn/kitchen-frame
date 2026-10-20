// The frame's screen, for the phone app's Screenshot (and scripts/frame-screenshot.sh): the frame is
// asked over the messages socket, its kiosk app (1.7+) captures the screen as root and uploads a
// JPEG, and the asker fetches it. Only the latest is kept, in the message room (messages.js /shot),
// behind the dashboard key, and for 10 minutes at most: it shows whatever the frame shows.
//   POST /api/frame/screenshot/request  { tab? } -> { asked, sent }: asked is the Worker's time (ms)
//        to fetch with as since (the phone's clock may differ); sent, how many screens heard it
//        (only the frame's kiosk app answers). tab: show that tab first. 429 within 10 s of the last.
//   PUT  /api/frame/screenshot          the kiosk's JPEG, at most 2 MB
//   POST /api/frame/screenshot/error    { error }: the frame couldn't (screencap or the upload failed)
//   GET  /api/frame/screenshot?since=ms the JPEG (X-Taken-At: ms) once one is at least that new; 422
//        { error } if the frame said it couldn't since then; 404 { waiting } before either.
import { room } from './messages.js';

const MAX_BYTES = 2 * 1024 * 1024;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const command = (env, body) => room(env).fetch('https://room/command', { method: 'POST', body: JSON.stringify(body) });

// null when the path isn't one of these.
export async function screenshotRoute(req, env, url) {
  const path = url.pathname;
  if (path === '/api/frame/screenshot/request' && req.method === 'POST') {
    const { tab } = await req.json().catch(() => ({}));
    const limit = await room(env).fetch('https://room/shot/ask', { method: 'POST' });
    if (limit.status !== 200) return limit;
    const asked = Date.now();
    if (tab) await command(env, { command: 'show', tab });
    const { sent = 0 } = await (await command(env, { command: 'screenshot' })).json().catch(() => ({}));
    return json({ asked, sent, ...(sent ? {} : { error: 'The frame isn’t connected right now' }) });
  }
  if (path === '/api/frame/screenshot' && req.method === 'PUT') {
    if (!/^image\/jpeg\b/.test(req.headers.get('Content-Type') || '')) return json({ error: 'Send image/jpeg' }, 415);
    if (Number(req.headers.get('Content-Length') || 0) > MAX_BYTES) return json({ error: 'Too big' }, 413);
    const image = await req.arrayBuffer();
    if (!image.byteLength || image.byteLength > MAX_BYTES) return json({ error: 'Empty or too big' }, 413);
    return room(env).fetch('https://room/shot', { method: 'PUT', body: image });
  }
  if (path === '/api/frame/screenshot/error' && req.method === 'POST') {
    return room(env).fetch('https://room/shot', { method: 'POST', body: await req.text() });
  }
  if (path === '/api/frame/screenshot' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since')) || 0;
    const res = await room(env).fetch('https://room/shot');
    let errorAt = 0, error = '';
    if (res.status === 200) {
      const at = Number(res.headers.get('X-Taken-At')) || 0;
      if (at >= since) return new Response(res.body, { headers: { 'Content-Type': 'image/jpeg', 'X-Taken-At': String(at), 'Cache-Control': 'no-store' } });
      errorAt = Number(res.headers.get('X-Error-At')) || 0;
      error = decodeURIComponent(res.headers.get('X-Error') || '');
    } else {
      const body = await res.json().catch(() => ({}));
      if (body.error) ({ at: errorAt, error } = body.error);
    }
    if (since && errorAt >= since) return json({ error }, 422);
    return json({ waiting: true }, 404);
  }
  return null;
}
