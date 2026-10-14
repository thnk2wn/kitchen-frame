// Apple Reminders as a list source, through a Mac at home (bridge/mac/). Apple offers no way to reach
// Reminders from a server, but a Mac signed in to iCloud can read and change them with Apple's own
// Reminders API (EventKit). The Mac pushes each chosen list here whenever it changes, and takes the
// frame's changes (an item ticked off, items added) from a queue, live over a WebSocket.
//
//   Frame (dashboard key), through /api/lists/:list when that list's source is "reminders":
//     GET  /api/lists/:list                the Mac's latest copy, with queued changes already applied
//     POST /api/lists/:list                { content, description?, priority? } or { items: [...] }: queued adds
//     POST /api/lists/:list/:id            { content?, priority? }: a queued edit
//     POST /api/lists/:list/:id/done       a queued completion
//   Mac (Authorization: Bearer <BRIDGE_TOKEN>), separate from the frame's key:
//     GET  /api/bridge/config              which Reminders list feeds which frame list
//     POST /api/bridge/snapshot            { lists: { groceries: {...}, todo: {...} }, applied: [op ids] }
//                                          -> { ops: [...] } still to apply
//     GET  /api/bridge/live                WebSocket: { ops } pushed as soon as the frame queues one
//
// Settings: GROCERIES_SOURCE / TODO_SOURCE = todoist (default) | reminders; REMINDERS_GROCERIES_LIST /
// REMINDERS_TODO_LIST = the Reminders list's name (default "Groceries" / "To Do"); BRIDGE_TOKEN;
// REMINDERS_EXTRAS = on to have the Mac also send sections, flags and assignees, which it reads from
// the Reminders database (it needs Full Disk Access; EventKit doesn't have them).
//
// One Durable Object (ListBridge, a single instance) holds the copies and the queue, so the frame
// and the Mac always see the same state. Like the message room it hibernates between changes.
export const BRIDGE_LISTS = { groceries: ['GROCERIES_SOURCE', 'REMINDERS_GROCERIES_LIST', 'Groceries'], todo: ['TODO_SOURCE', 'REMINDERS_TODO_LIST', 'To Do'] };
export const fromReminders = (env, list) => BRIDGE_LISTS[list] && String(env[BRIDGE_LISTS[list][0]] || '').trim().toLowerCase() === 'reminders';
export const remindersName = (env, list) => String(env[BRIDGE_LISTS[list][1]] || '').trim() || BRIDGE_LISTS[list][2];
export const bridge = (env) => env.BRIDGE.get(env.BRIDGE.idFromName('home'));

const STALE_MS = 30 * 60 * 1000;   // the Mac sends a heartbeat every 5 minutes; 30 without one is worth saying
const OP_TTL_MS = 7 * 864e5;       // a change the Mac never picks up is dropped after a week
const MAX_OPS = 200;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
// A priority on the frame's scale: 3 high, 2 medium, 1 low, 0 none (the Mac converts Reminders' own).
export const level = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 3 ? n : 0; };

// The frame's view of a list: the Mac's copy, minus items with a queued completion, plus queued adds
// (shown at once, with a temporary id, until the Mac has created them).
export function viewOf(snap, ops, list, now = Date.now()) {
  // Sections and people (with REMINDERS_EXTRAS) arrive as names; the frame wants ids, and a name is one.
  const people = {};
  for (const i of snap?.items || []) if (i.assignee) people[i.assignee] = i.assignee;
  const done = new Set(ops.filter((o) => o.list === list && o.type === 'complete').map((o) => o.itemId));
  const edits = new Map(ops.filter((o) => o.list === list && o.type === 'update').map((o) => [o.itemId, o]));
  const items = (snap?.items || []).filter((i) => !done.has(i.id)).map((i) => {
    const e = edits.get(i.id);
    if (!e) return i;
    const out = { ...i, ...(e.content ? { content: e.content } : {}), pending: true };
    if (e.priority !== undefined) { if (e.priority) out.priority = e.priority; else delete out.priority; }
    return out;
  });
  for (const o of ops) {
    if (o.list === list && o.type === 'add') items.push({ id: 'pending-' + o.id, content: o.content, ...(o.description ? { note: o.description } : {}), ...(o.priority ? { priority: o.priority } : {}), pending: true });
  }
  const seen = snap?.seen || 0;
  return {
    project: snap?.name || '',
    items,
    sections: (snap?.sections || []).map((name) => ({ id: name, name })),
    people,
    source: 'reminders',
    updated: snap?.at || null,
    // The Lists tab says so when the Mac has gone quiet: changes still queue, and nothing is lost.
    ...(!snap ? { waiting: true } : now - seen > STALE_MS ? { stale: new Date(seen).toISOString() } : {}),
  };
}

// Items from the Mac, trimmed to what the frame shows.
export function cleanItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 500).map((i) => ({
    id: clean(i && i.id, 200),
    content: clean(i && i.title, 500),
    ...(i && /^\d{4}-\d{2}-\d{2}$/.test(i.due || '') ? { due: i.due } : {}),
    ...(i && i.due && /^\d{2}:\d{2}$/.test(i.time || '') ? { time: i.time } : {}),
    ...(level(i && i.priority) ? { priority: level(i.priority) } : {}),
    ...(clean(i && i.section, 60) ? { section: clean(i.section, 60) } : {}),
    ...(i && i.flagged === true ? { flagged: true } : {}),
    ...(clean(i && i.assignee, 40) ? { assignee: clean(i.assignee, 40) } : {}),
    ...(clean(i && i.note, 120) ? { note: clean(i.note, 120) } : {}),
  })).filter((i) => i.id && i.content);
}

export class ListBridge {
  constructor(ctx) {
    this.ctx = ctx;
    if (typeof WebSocketRequestResponsePair !== 'undefined') ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async ops() {
    const now = Date.now();
    return ((await this.ctx.storage.get('ops')) || []).filter((o) => now - o.at < OP_TTL_MS);
  }

  async saveOps(ops) {
    await this.ctx.storage.put('ops', ops.slice(-MAX_OPS));
    const text = JSON.stringify({ ops });
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(text); } catch {} }
  }

  async fetch(req) {
    const url = new URL(req.url);
    const [, kind, list, arg] = url.pathname.split('/');

    if (kind === 'live') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ ops: await this.ops() }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (kind === 'snapshot' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }
      const now = Date.now();
      for (const [name, l] of Object.entries(body.lists || {})) {
        if (!(name in BRIDGE_LISTS) || !l) continue;
        const items = cleanItems(l.items);
        // Only sections that hold an item, in the Mac's (Reminders') order, each name once: a list can
        // have two sections with one name (the grocery template has), and the frame keys them by name.
        const used = new Set(items.map((i) => i.section).filter(Boolean));
        const sections = [...new Set((Array.isArray(l.sections) ? l.sections : []).map((x) => clean(x, 60)))].filter((x) => used.has(x)).slice(0, 60);
        await this.ctx.storage.put('snap:' + name, { name: clean(l.name, 120), items, ...(sections.length ? { sections } : {}), at: new Date(now).toISOString(), seen: now });
      }
      // Heartbeat for lists not sent this time (nothing changed): keep "seen" fresh.
      for (const name of Object.keys(BRIDGE_LISTS)) {
        if (body.lists && body.lists[name]) continue;
        const s = await this.ctx.storage.get('snap:' + name);
        if (s) await this.ctx.storage.put('snap:' + name, { ...s, seen: now });
      }
      const applied = new Set(Array.isArray(body.applied) ? body.applied : []);
      let ops = await this.ops();
      if (applied.size) { ops = ops.filter((o) => !applied.has(o.id)); await this.ctx.storage.put('ops', ops); }
      return json({ ops });
    }

    if (kind === 'view') return json(viewOf(await this.ctx.storage.get('snap:' + list), await this.ops(), list));

    if (kind === 'add' && req.method === 'POST') {
      const items = (await req.json()).items || [];
      const added = items.map((x) => ({ id: crypto.randomUUID(), list, type: 'add', content: clean(x.content, 500), ...(clean(x.description, 500) ? { description: clean(x.description, 500) } : {}), ...(level(x.priority) ? { priority: level(x.priority) } : {}), at: Date.now() })).filter((o) => o.content);
      if (!added.length) return json({ error: 'content required' }, 400);
      await this.saveOps([...(await this.ops()), ...added]);
      return json({ items: added.map((o) => ({ id: 'pending-' + o.id, content: o.content, ...(o.priority ? { priority: o.priority } : {}) })) });
    }

    if (kind === 'update' && req.method === 'POST') {
      const id = decodeURIComponent(arg || '');
      const b = await req.json();
      const change = { ...(clean(b.content, 500) ? { content: clean(b.content, 500) } : {}), ...(b.priority !== undefined ? { priority: level(b.priority) } : {}) };
      let ops = await this.ops();
      if (id.startsWith('pending-')) {
        // Not created in Reminders yet: change the queued add instead.
        ops = ops.map((o) => {
          if (o.id !== id.slice(8)) return o;
          const { priority, ...rest } = { ...o, ...change };
          return priority ? { ...rest, priority } : rest;
        });
      } else {
        // One queued edit per item, merged with any earlier one not yet applied.
        const prev = ops.find((o) => o.type === 'update' && o.itemId === id);
        ops = ops.filter((o) => o !== prev);
        ops.push({ ...(prev || {}), id: crypto.randomUUID(), list, type: 'update', itemId: id, ...change, at: Date.now() });
      }
      await this.saveOps(ops);
      return json({ ok: true });
    }

    if (kind === 'done' && req.method === 'POST') {
      const id = decodeURIComponent(arg || '');
      let ops = await this.ops();
      if (id.startsWith('pending-')) {
        // Ticked before the Mac created it: just drop the queued add.
        ops = ops.filter((o) => o.id !== id.slice(8));
      } else if (!ops.some((o) => o.type === 'complete' && o.itemId === id)) {
        ops.push({ id: crypto.randomUUID(), list, type: 'complete', itemId: id, at: Date.now() });
      }
      await this.saveOps(ops);
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  }

  webSocketMessage() {}
  webSocketClose() {}
  webSocketError() {}
}
