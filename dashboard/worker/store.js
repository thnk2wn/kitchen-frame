// A small key-value store in the message room's Durable Object storage (messages.js), for what is
// written all day: the frame's check-in status (every 10 minutes) and each phone's fitness (hourly
// and after every workout). Workers KV's free plan allows 1,000 writes and 1,000 lists a day, and
// those two alone came close to it (2026-10-21); a Durable Object's free storage allows about 100,000
// row writes a day, and listing costs nothing extra. Same shape as KV (get, put with
// expirationTtl, delete, list) so the callers barely change, plus entries(): a prefix's values in
// one call. KV keeps what changes rarely: the calendar, recipes, photos, settings and caches.
import { room } from './messages.js';

const PREFIX = 'kv:';
const MAX_LIST = 200;

// In the room: one operation on its storage. Expired entries are left out (and dropped) when read.
export async function storeRoute(storage, op, body) {
  const now = Date.now();
  const live = (e) => e && (!e.exp || e.exp > now);
  const key = PREFIX + String(body.key || '');
  if (op === 'get') {
    const e = await storage.get(key);
    if (e && !live(e)) await storage.delete(key);
    return { value: live(e) ? e.v : null };
  }
  if (op === 'put') {
    await storage.put(key, { v: String(body.value), ...(body.ttl > 0 ? { exp: now + body.ttl * 1000 } : {}) });
    return { ok: true };
  }
  if (op === 'delete') { await storage.delete(key); return { ok: true }; }
  if (op === 'list' || op === 'entries') {
    const found = await storage.list({ prefix: PREFIX + String(body.prefix || ''), limit: MAX_LIST });
    const out = [], gone = [];
    for (const [k, e] of found) (live(e) ? out : gone).push(op === 'list' ? k.slice(PREFIX.length) : { key: k.slice(PREFIX.length), value: e.v });
    if (gone.length) await storage.delete(op === 'list' ? gone.map((k) => PREFIX + k) : gone.map((x) => PREFIX + x.key));
    return op === 'list' ? { keys: out } : { entries: out };
  }
  return { error: 'unknown operation' };
}

// In the Worker: the store, through the room.
export function roomStore(env) {
  const call = async (op, body) => {
    const r = await room(env).fetch('https://room/store/' + op, { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) throw new Error('store ' + op + ': HTTP ' + r.status);
    return r.json();
  };
  return {
    get: async (key, type) => { const { value } = await call('get', { key }); return value == null ? null : type === 'json' ? JSON.parse(value) : value; },
    put: (key, value, opts = {}) => call('put', { key, value, ttl: opts.expirationTtl || 0 }),
    delete: (key) => call('delete', { key }),
    list: async ({ prefix }) => ({ keys: (await call('list', { prefix })).keys.map((name) => ({ name })) }),
    entries: async (prefix) => (await call('entries', { prefix })).entries,
  };
}
