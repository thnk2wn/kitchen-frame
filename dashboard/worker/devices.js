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
import { phoneId } from './fitness.js';
import { homeOnly } from './home.js';

export const TOKEN_PREFIX = 'kfd_';
export const PAIR_MS = 10 * 60 * 1000;
const CACHE_MS = 60 * 1000;
const TOUCH_MS = 10 * 60 * 1000;
const ROLES = ['frame', 'phone', 'ops'];

// What a phone may call: [method, path or prefix ending in /].
const PHONE = [
  ['POST', '/api/fitness'], ['DELETE', '/api/fitness'], // its own person only (no reading anyone's)
  ['POST', '/api/frame/checkin'], ['POST', '/api/frame/command'],
  ['GET', '/api/frame/guest'], ['POST', '/api/frame/guest'], ['GET', '/api/frame/home'],
  ['GET', '/api/frame/screenshot'], ['POST', '/api/frame/screenshot/request'], ['GET', '/api/frame/status'],
  ['GET', '/api/ops/summary'], ['POST', '/api/share/media'], ['POST', '/api/share/play'],
  ['POST', '/api/devices/pin'], // its owner's PIN, for the frame (its own record only)
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
// Control characters and text-direction overrides out, so one name can't pose as another in the list.
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max) : '');

// ---- In the Durable Object (MessageRoom delegates /devices/* here) ----

// Storage: "devices" { id: { id, name, role, hash, created, lastUsed, fitnessId? } },
// "pair-codes" { code: expires }.
export async function devicesRoute(storage, path, req) {
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  // A new key is made and hashed first, then the list read and written with no other await between,
  // so a revoke or another add can't be overwritten by a stale copy.
  const fresh = async () => { const token = newToken(); return { token, id: newId(), hash: await hashToken(token) }; };
  const read = async () => (await storage.get('devices')) || {};
  // A phone's owner's PIN goes with it (salt and hash only), with their name and their fitness id, so
  // the frame can take it for anything a PIN guards and for that person's own details.
  const pub = (d) => ({ id: d.id, name: d.name, role: d.role, created: d.created, lastUsed: d.lastUsed || null,
    ...(d.pin ? { pin: d.pin, person: d.person || d.name, fitnessId: d.fitnessId || null } : {}) });
  const add = async (key, role, name, devices) => {
    devices[key.id] = { id: key.id, name: clean(name, 60) || role, role, hash: key.hash, created: new Date().toISOString() };
    await storage.put('devices', devices);
    return { token: key.token, id: key.id };
  };
  if (path === '/devices/find') {
    const devices = await read();
    const d = Object.values(devices).find((x) => x.hash === body.hash);
    if (!d) return json({ device: null });
    if (!d.lastUsed || Date.now() - Date.parse(d.lastUsed) > TOUCH_MS) { d.lastUsed = new Date().toISOString(); await storage.put('devices', devices); }
    return json({ device: { id: d.id, role: d.role, name: d.name, fitnessId: d.fitnessId || null } });
  }
  if (path === '/devices/get') {
    const d = (await read())[body.id];
    return json({ device: d ? { id: d.id, role: d.role, name: d.name, fitnessId: d.fitnessId || null } : null });
  }
  if (path === '/devices/list') return json({ devices: Object.values(await read()).map(pub).sort((a, b) => a.created.localeCompare(b.created)) });
  if (path === '/devices/add') {
    if (!ROLES.includes(body.role)) return json({ error: 'role: frame, phone or ops' }, 400);
    const key = await fresh();
    const devices = await read();
    // A new key for the frame replaces the frame's last one (a setup link run again, a reset).
    if (body.replaceRole === 'frame' && body.role === 'frame') for (const [id, d] of Object.entries(devices)) if (d.role === 'frame') delete devices[id];
    return json(await add(key, body.role, body.name, devices));
  }
  if (path === '/devices/remove') {
    const devices = await read();
    if (!devices[body.id]) return json({ error: 'no such device' }, 404);
    delete devices[body.id];
    await storage.put('devices', devices);
    return json({ ok: true });
  }
  // A phone sets (or clears, pin: null) its owner's PIN: the salted hash the phone made, never the
  // digits, in the frame's own format (src/lib/pin.js).
  if (path === '/devices/pin') {
    const devices = await read();
    const d = devices[body.id];
    if (!d || d.role !== 'phone') return json({ error: 'no such phone' }, 404);
    const p = body.pin;
    if (p === null) { delete d.pin; delete d.person; }
    else if (p && /^[0-9a-f]{32}$/.test(p.salt) && /^[0-9a-f]{64}$/.test(p.hash)) { d.pin = { salt: p.salt, hash: p.hash }; d.person = clean(body.person, 40) || d.name; }
    else return json({ error: 'pin: { salt, hash } or null' }, 400);
    await storage.put('devices', devices);
    return json({ ok: true });
  }
  if (path === '/devices/bind') {
    // A phone's fitness person: the first id it sends is kept, and another is refused, as is an id
    // another phone already holds (one phone can't take over someone else's numbers).
    const devices = await read();
    const d = devices[body.id], fid = phoneId(body.fitnessId);
    if (!d || !fid) return json({ ok: false });
    // Compared without case: a phone bound before 2026-10-20 kept its id as iOS writes it (upper case).
    const same = (x) => typeof x === 'string' && x.toLowerCase() === fid;
    if (!d.fitnessId) {
      if (Object.values(devices).some((x) => x.id !== d.id && same(x.fitnessId))) return json({ ok: false });
      d.fitnessId = fid;
      await storage.put('devices', devices);
    }
    return json({ ok: same(d.fitnessId) });
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
      // Wrong guesses cost every code: ten in a row and the frame has to show a new one. Counted only
      // while a code is showing, so with none there's nothing to guess and nothing written.
      if (Object.values(codes).some((e) => e > Date.now())) {
        const fails = ((await storage.get('pair-fails')) || 0) + 1;
        if (fails >= 10) { await storage.delete(['pair-codes', 'pair-fails']); } else await storage.put('pair-fails', fails);
      }
      return json({ error: 'That pairing code isn’t valid any more. Show a new one on the frame (Settings → About → Pair a phone).' }, 403);
    }
    delete codes[code];
    await storage.put('pair-codes', codes);
    await storage.delete('pair-fails');
    const key = await fresh();
    return json(await add(key, 'phone', body.name || 'Phone', await read()));
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
  if (path === '/api/devices/pin' && req.method === 'POST') {
    if (!who || !who.device || who.device.role !== 'phone') return json({ error: 'a phone sets its own PIN' }, 403);
    // Only from home: anyone's PIN also unlocks a door at the frame, so a phone's key used from
    // elsewhere (a lost phone, before it's revoked) can't plant one (home.js).
    const away = await homeOnly(env, req);
    if (away) return away;
    const b = await req.json().catch(() => ({}));
    const r = await roomCall(env, '/devices/pin', { id: who.device.id, pin: b.pin === null ? null : b.pin, person: b.person });
    // The frame fetches the PINs again now, so a new one works at once.
    if (r.status === 200) await roomCall(env, '/command', { command: 'refresh', what: 'pins' }).catch(() => {});
    return json(r.body, r.status);
  }
  const m = /^\/api\/devices\/([\w-]{6,20})$/.exec(path);
  if (m && req.method === 'DELETE') {
    const r = await roomCall(env, '/devices/remove', { id: m[1] });
    forgetDevices();
    // A revoked phone's PIN stops working on the frame now, not at its next 10-minute fetch.
    if (r.status === 200) await roomCall(env, '/command', { command: 'refresh', what: 'pins' }).catch(() => {});
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
