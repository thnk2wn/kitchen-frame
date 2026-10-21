// Devices: a key of its own for the frame, each phone and the status page, instead of one dashboard
// key shared by everything (a 2026-10-20 security review). A lost phone is revoked alone (Settings →
// Home → Devices on the frame), and each key opens only what its device uses:
//   frame   the dashboard page: everything it calls, and pairing phones and the device list
//   phone   the phone app: the Remote, Screenshot, sharing, guest mode, the Ops summary and the frame's
//           status, and fitness for one person (the first fitness id it sends, kept with the device)
//   ops     the status page's Worker: the Ops summary, nothing else
// DASHBOARD_KEY stays the admin key: setup (the setup link, which the page swaps for a frame key at
// once), scripts on the Mac, and making the status page's key (scripts/device-token.sh).
//
// Keys are 32 random bytes as "kfd_" + base64url; only their SHA-256 is stored (the message room's
// Durable Object, "devices"). A phone pairs with a one-time code instead of a key: the frame's QR code
// carries kitchenframe://pair?url=…&code=…, good for PAIR_MS and once, and the phone trades it for a
// key of its own (POST /api/devices/claim). Lookups are cached in the isolate for CACHE_MS, so a
// revoked key stops working within a minute; "last used" is written at most every TOUCH_MS.
//
//   POST   /api/devices/claim       { code, name } -> { token, id }      no key: the code is the key
//   GET    /api/devices             -> { devices: [{ id, name, role, created, lastUsed, you }] }   frame
//   POST   /api/devices/pair        -> { code, expires }                                         frame
//   DELETE /api/devices/:id         revokes one                                                  frame
//   POST   /api/devices/frame       { name } -> { token, id }: the page's own key (replaces the last)  admin
//   POST   /api/devices             { role: 'ops', name } -> { token, id }                       admin
import { room } from './messages.js';

export const TOKEN_PREFIX = 'kfd_';
export const PAIR_MS = 10 * 60 * 1000;
const CACHE_MS = 60 * 1000;
const TOUCH_MS = 10 * 60 * 1000;
const ROLES = ['frame', 'phone', 'ops'];

// What a phone may call: [method, path or prefix ending in /].
const PHONE = [
  ['GET', '/api/fitness'], ['POST', '/api/fitness'], ['DELETE', '/api/fitness'],
  ['POST', '/api/frame/checkin'], ['POST', '/api/frame/command'],
  ['GET', '/api/frame/guest'], ['POST', '/api/frame/guest'], ['GET', '/api/frame/home'],
  ['GET', '/api/frame/screenshot'], ['POST', '/api/frame/screenshot/request'], ['GET', '/api/frame/status'],
  ['GET', '/api/ops/summary'], ['POST', '/api/share/media'], ['POST', '/api/share/play'],
];
const OPS = [['GET', '/api/ops/summary']];
const ADMIN_ONLY = [['POST', '/api/devices/frame'], ['POST', '/api/devices']];

const match = (list, method, path) => list.some(([m, p]) => m === method && (p.endsWith('/') ? path.startsWith(p) : path === p));

// May this caller ({ role }) make this request?
export function allowed(who, method, path) {
  if (!who) return false;
  if (who.role === 'admin') return true;
  if (match(ADMIN_ONLY, method, path)) return false;
  if (who.role === 'frame') return true;
  if (who.role === 'phone') return match(PHONE, method, path);
  if (who.role === 'ops') return match(OPS, method, path);
  return false;
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function hashToken(token) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
export const newToken = () => TOKEN_PREFIX + b64url(crypto.getRandomValues(new Uint8Array(32)));
const newId = () => b64url(crypto.getRandomValues(new Uint8Array(9)));
// Pairing codes: 10 characters without look-alikes (no 0/O, 1/I/L), about 49 bits.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '');

// ---- In the Durable Object (MessageRoom delegates /devices/* here) ----

// Storage: "devices" { id: { id, name, role, hash, created, lastUsed, fitnessId? } },
// "pair-codes" { code: expires }.
export async function devicesRoute(storage, path, req) {
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const devices = (await storage.get('devices')) || {};
  const save = () => storage.put('devices', devices);
  const pub = (d) => ({ id: d.id, name: d.name, role: d.role, created: d.created, lastUsed: d.lastUsed || null });
  const add = async (role, name) => {
    const token = newToken(), id = newId();
    devices[id] = { id, name: clean(name, 60) || role, role, hash: await hashToken(token), created: new Date().toISOString() };
    await save();
    return { token, id };
  };
  if (path === '/devices/find') {
    const d = Object.values(devices).find((x) => x.hash === body.hash);
    if (!d) return json({ device: null });
    if (!d.lastUsed || Date.now() - Date.parse(d.lastUsed) > TOUCH_MS) { d.lastUsed = new Date().toISOString(); await save(); }
    return json({ device: { id: d.id, role: d.role, name: d.name, fitnessId: d.fitnessId || null } });
  }
  if (path === '/devices/get') {
    const d = devices[body.id];
    return json({ device: d ? { id: d.id, role: d.role, name: d.name, fitnessId: d.fitnessId || null } : null });
  }
  if (path === '/devices/list') return json({ devices: Object.values(devices).map(pub).sort((a, b) => a.created.localeCompare(b.created)) });
  if (path === '/devices/add') {
    if (!ROLES.includes(body.role)) return json({ error: 'role: frame, phone or ops' }, 400);
    // A new key for the frame replaces the frame's last one (a setup link run again, a reset).
    if (body.replaceRole === 'frame' && body.role === 'frame') for (const [id, d] of Object.entries(devices)) if (d.role === 'frame') delete devices[id];
    return json(await add(body.role, body.name));
  }
  if (path === '/devices/remove') {
    if (!devices[body.id]) return json({ error: 'no such device' }, 404);
    delete devices[body.id];
    await save();
    return json({ ok: true });
  }
  if (path === '/devices/bind') {
    // A phone's fitness person: the first id it sends is kept; another is refused.
    const d = devices[body.id];
    if (!d) return json({ ok: false });
    if (!d.fitnessId) { d.fitnessId = clean(body.fitnessId, 80); await save(); }
    return json({ ok: d.fitnessId === body.fitnessId });
  }
  if (path === '/devices/pair') {
    const codes = (await storage.get('pair-codes')) || {};
    const now = Date.now();
    for (const [c, exp] of Object.entries(codes)) if (exp < now) delete codes[c];
    const code = newCode();
    codes[code] = now + PAIR_MS;
    await storage.put('pair-codes', codes);
    return json({ code, expires: new Date(now + PAIR_MS).toISOString() });
  }
  if (path === '/devices/claim') {
    const codes = (await storage.get('pair-codes')) || {};
    const code = clean(body.code, 20).toUpperCase();
    const exp = codes[code];
    if (!exp || exp < Date.now()) {
      // Wrong guesses cost every code: ten in a row and the frame has to show a new one.
      const fails = ((await storage.get('pair-fails')) || 0) + 1;
      if (fails >= 10) { await storage.delete(['pair-codes', 'pair-fails']); } else await storage.put('pair-fails', fails);
      return json({ error: 'That pairing code isn’t valid any more. Show a new one on the frame (Settings → About → Pair a phone).' }, 403);
    }
    delete codes[code];
    await storage.put('pair-codes', codes);
    await storage.delete('pair-fails');
    return json(await add('phone', body.name || 'Phone'));
  }
  return json({ error: 'not found' }, 404);
}

// ---- In the Worker ----

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const roomCall = async (env, path, body) => {
  const r = await room(env).fetch('https://room' + path, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const cache = new Map(); // hash or "id:<id>" -> { device, at }
export const forgetDevices = () => cache.clear();
async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.device;
  const device = await load();
  cache.set(key, { device, at: Date.now() });
  return device;
}

// The device a key belongs to, or null.
export async function deviceForToken(env, token) {
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 100 || !env.MESSAGES) return null;
  const hash = await hashToken(token);
  return cached(hash, async () => (await roomCall(env, '/devices/find', { hash })).body.device || null);
}
export async function deviceById(env, id) {
  if (typeof id !== 'string' || !/^[\w-]{6,20}$/.test(id) || !env.MESSAGES) return null;
  return cached('id:' + id, async () => (await roomCall(env, '/devices/get', { id })).body.device || null);
}

// The routes above, for a caller already identified (who), or none for claim.
export async function devicesApi(req, env, url, who) {
  const path = url.pathname;
  if (path === '/api/devices/claim' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const r = await roomCall(env, '/devices/claim', { code: b.code, name: b.name });
    return json(r.body, r.status);
  }
  if (path === '/api/devices' && req.method === 'GET') {
    const r = await roomCall(env, '/devices/list');
    return json({ devices: (r.body.devices || []).map((d) => ({ ...d, you: !!(who.device && who.device.id === d.id) })) });
  }
  if (path === '/api/devices/pair' && req.method === 'POST') return json((await roomCall(env, '/devices/pair', {})).body);
  if (path === '/api/devices/frame' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const r = await roomCall(env, '/devices/add', { role: 'frame', name: b.name || 'Frame', replaceRole: 'frame' });
    forgetDevices();
    return json(r.body, r.status);
  }
  if (path === '/api/devices' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (b.role !== 'ops') return json({ error: 'only an ops key is made here; a frame or phone gets its own' }, 400);
    const r = await roomCall(env, '/devices/add', { role: 'ops', name: b.name || 'Status page' });
    return json(r.body, r.status);
  }
  const m = /^\/api\/devices\/([\w-]{6,20})$/.exec(path);
  if (m && req.method === 'DELETE') {
    const r = await roomCall(env, '/devices/remove', { id: m[1] });
    forgetDevices();
    return json(r.body, r.status);
  }
  return null;
}

// A phone's fitness send or removal: only for the person it first sent (another phone's id is refused).
export async function fitnessAllowed(env, who, fitnessId) {
  if (!who || who.role !== 'phone') return true;
  if (!fitnessId) return false;
  const r = await roomCall(env, '/devices/bind', { id: who.device.id, fitnessId: String(fitnessId) });
  return r.body.ok === true;
}
