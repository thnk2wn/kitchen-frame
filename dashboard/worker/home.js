// Home-only actions: the ones that act on the frame or see its screen (the phone app's Remote and
// Screenshot, sharing a video or photo to it) are accepted only from the frame's own network, so a
// lost phone or a leaked key can't drive the frame or look at the kitchen from elsewhere. Reading
// (Ops), fitness sends and guest mode work from anywhere.
//
// "The frame's network" is learned, not configured: the addresses the frame's check-ins and the Mac
// bridge's posts come from (Cloudflare's CF-Connecting-IP), kept in the message room. A request is at
// home when it comes from the same IPv4 address, or from the same IPv6 /64 (each device on the home
// network has its own IPv6 address, all within one /64). A new address from the ISP is learned at
// the next check-in, within 10 minutes. The frame and the bridge talk over IPv6 when they can, so the
// bridge also calls /api/bridge/home over IPv4 every 10 minutes (bridge/mac/install.sh): a phone can
// pick either, and one on IPv4 was refused at home while only IPv6 was known. HOME_ONLY=off turns the check off (a phone on a VPN, a frame
// on another network than the phones).
//
// What it stops: a lost or stolen phone driving the frame from elsewhere; the app can't claim to be
// home. What it doesn't: someone holding the dashboard key itself could post a check-in as the frame
// from anywhere and be "home". A key per phone (ROADMAP) is the fix for a leaked key.
import { room } from './messages.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// { v4: '203.0.113.7' } or { v6: '2001:db8:1:2' } (the first four groups, normalized), or null.
export function network(ip) {
  if (typeof ip !== 'string' || !ip) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped || /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return { v4: mapped ? mapped[1] : ip };
  if (!ip.includes(':')) return null;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return { v6: groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':') };
}

const ipOf = (req) => req.headers.get('CF-Connecting-IP') || '';

// The frame or the bridge just called from home: remember that network (messages.js /home).
// Never fails the request it rides on.
export async function noteHome(env, req) {
  const net = network(ipOf(req));
  if (!net || !env.MESSAGES) return;
  try { await room(env).fetch('https://room/home', { method: 'POST', body: JSON.stringify(net) }); } catch {}
}

export async function atHome(env, req) {
  return (await homeCheck(env, req)).home;
}

// The check and what it compared: the caller's network and the frame's, for "why not home?"
// (GET /api/frame/home?why). Only callers with the dashboard key get here.
export async function homeCheck(env, req) {
  const net = network(ipOf(req));
  let home = {};
  try { home = await (await room(env).fetch('https://room/home')).json(); } catch {}
  const at = !!net && ((!!net.v4 && net.v4 === home.v4) || (!!net.v6 && net.v6 === home.v6));
  return { home: at, you: net, frame: { v4: home.v4 || null, v6: home.v6 || null } };
}

// null when the request may go ahead, else the 403 to answer with.
export async function homeOnly(env, req) {
  if (String(env.HOME_ONLY || '').toLowerCase() === 'off') return null;
  if (await atHome(env, req)) return null;
  return json({ error: 'Only on the frame’s home network. Connect this phone to the home Wi-Fi and try again.', home: false }, 403);
}
