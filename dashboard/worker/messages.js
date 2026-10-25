// Messages that AI agents (or scripts) post to the frame. They cover the screen until dismissed.
//   POST /api/messages              Authorization: Bearer <AGENT_TOKEN>
//        { "title": "...", "body": "...", "from": "...", "ttl_minutes": 120, "speak": true }  -> { "id": "..." }
//        speak (default true): the frame has Home Assistant read it aloud (see src/lib/state.svelte.js)
//   GET  /api/messages              (frame key) pending messages, oldest first
//   GET  /api/messages/live         (frame key, ?key=) WebSocket: the list now and on every change
//   POST /api/messages/:id/dismiss  (frame key) removes it
// Secret: AGENT_TOKEN, separate from DASHBOARD_KEY so an agent can post but read nothing.
//
// One Durable Object (MessageRoom, a single instance named "frame") holds the list and the frames'
// WebSockets, so a posted message reaches the screen in well under a second. It uses WebSocket
// hibernation: between messages the object is evicted from memory and costs nothing while the
// sockets stay open. The frames' keep-alive pings are answered by the runtime ("ping" -> "pong")
// without waking it. It wakes only to post, dismiss, expire a message, or accept a connection.
const KEY = 'messages';
const MAX_PENDING = 20;
const LIMITS = { title: 120, body: 2000, from: 60 };
// The frame's screenshot (screenshot.js) is deleted this long after it was taken; one ask per ASK_MS.
const SHOT_KEEP_MS = 10 * 60000, SHOT_ASK_MS = 10000;

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// The Worker's stub for the room. Every request goes through one instance, so the list is consistent.
import { devicesRoute } from './devices.js';
import { storeRoute } from './store.js';
import { countGoogle } from './maps.js';

export const room = (env) => env.MESSAGES.get(env.MESSAGES.idFromName('frame'));

export class MessageRoom {
  constructor(ctx) {
    this.ctx = ctx;
    // Answered by the runtime itself, so keep-alives never wake the object or bill duration.
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }
  }

  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/live') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server); // hibernatable (unlike server.accept())
      server.send(JSON.stringify({ messages: await this.load() }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (path === '/list') return json({ messages: await this.load() });
    // The frame's home network (home.js): { v4, v6 } as last seen from the frame or the Mac bridge.
    // Written only when it changes, so a check-in every 10 minutes doesn't write each time.
    // Devices and their keys (devices.js): stored here, with everything else about the frame.
    if (path.startsWith('/devices/')) return devicesRoute(this.ctx.storage, path, req);
    // What's written all day (the frame's check-ins, fitness): a small store here instead of KV (store.js).
    // Calls to Google's map APIs today and this month (maps.js spend()): 429 once at the cap.
    if (path === '/google/spend') {
      const { api } = await req.json().catch(() => ({}));
      const r = await countGoogle(this.ctx.storage, api);
      return json(r, r.ok ? 200 : 429);
    }
    if (path.startsWith('/store/')) return json(await storeRoute(this.ctx.storage, path.slice(7), await req.json().catch(() => ({}))));
    if (path === '/home') {
      const home = (await this.ctx.storage.get('home')) || {};
      if (req.method === 'POST') {
        const { v4, v6 } = await req.json().catch(() => ({}));
        const next = { ...home, ...(v4 ? { v4: clean(v4, 45) } : {}), ...(v6 ? { v6: clean(v6, 45) } : {}) };
        if (next.v4 !== home.v4 || next.v6 !== home.v6) await this.ctx.storage.put('home', next);
        return json(next);
      }
      return json(home);
    }
    // The frame's screen (screenshot.js): the latest JPEG the kiosk uploaded (PUT) and why the last
    // ask failed, if it did (POST { error }); GET answers both as stored. Here rather than in KV for
    // the same reason as guest mode: the phone asks for it seconds after the frame sends it. Only
    // one is kept, and the alarm deletes it SHOT_KEEP_MS after it was taken.
    if (path === '/shot/ask') {
      const last = (await this.ctx.storage.get('shot-asked')) || 0;
      if (Date.now() - last < SHOT_ASK_MS) return json({ error: 'Asked a moment ago; try again in a few seconds' }, 429);
      await this.ctx.storage.put('shot-asked', Date.now());
      return json({ ok: true });
    }
    if (path === '/shot') {
      if (req.method === 'PUT') {
        const at = Date.now();
        await this.ctx.storage.put({ shot: { at, image: await req.arrayBuffer() }, 'shot-at': at });
        await this.schedule(await this.load());
      }
      if (req.method === 'POST') {
        const { error } = await req.json().catch(() => ({}));
        await this.ctx.storage.put('shot-error', { at: Date.now(), error: clean(error, 200) || 'The frame couldn’t take it' });
      }
      if (req.method === 'GET') {
        const [shot, error] = await Promise.all([this.ctx.storage.get('shot'), this.ctx.storage.get('shot-error')]);
        if (shot && shot.image) return new Response(shot.image, { headers: { 'Content-Type': 'image/jpeg', 'X-Taken-At': String(shot.at), 'X-Error-At': String(error ? error.at : 0), 'X-Error': encodeURIComponent(error ? error.error : '') } });
        return json({ error: error || null }, 404);
      }
      return json({ ok: true });
    }
    // When a regular job last ran ({ name: { at, error } }), for the status page: e.g. the Paprika
    // sync every 15 minutes, which only writes KV when something changed. Kept here rather than in KV
    // so a write every run doesn't eat into KV's daily allowance.
    if (path === '/stamps') {
      const stamps = (await this.ctx.storage.get('stamps')) || {};
      if (req.method === 'POST') {
        const { name, error } = await req.json().catch(() => ({}));
        if (typeof name !== 'string' || !name) return json({ error: 'name' }, 400);
        stamps[name.slice(0, 40)] = { at: new Date().toISOString(), ...(error ? { error: String(error).slice(0, 200) } : {}) };
        await this.ctx.storage.put('stamps', stamps);
      }
      return json(stamps);
    }
    // Guest mode (guest.js), kept here rather than in KV: KV can answer with the old value for a
    // minute after a change, so a phone turning it on wouldn't reach the frame straight away. Set,
    // it tells the frame to fetch what it may show.
    if (path === '/guest') {
      if (req.method === 'POST') {
        const { on } = await req.json().catch(() => ({}));
        await this.ctx.storage.put('guest', { on: !!on });
        const msg = JSON.stringify({ command: 'refresh', what: 'fitness' });
        for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch {} }
      }
      return json({ on: !!((await this.ctx.storage.get('guest')) || {}).on });
    }
    if (path === '/post') return this.post(req);
    // A command for the frame itself ("checkin": send your status and events now; "reload": load the
    // dashboard again, e.g. to pick up a deploy at once), pushed to
    // every connected frame; nothing is stored.
    if (path === '/command') {
      const { command, id, title, tab, group, what, kind, action, label, seconds } = await req.json().catch(() => ({}));
      // play: a YouTube video shared from a phone (index.js /api/share/play), with its id and title.
      // show (a tab), slideshow, wake, playgroup (a Media → Videos group), recipe (a Paprika recipe's id
      // and title), meals (Recipes → Meals), close (whatever sheet is open) and timer (start, cancel or
      // add to one): from Alexa (alexa.js).
      // refresh (what: 'meals' or 'fitness'): something the frame shows changed on the Worker; fetch it now.
      // media: a photo or video shared from a phone (shared-media.js), by id, to show full screen.
      if (!['checkin', 'reload', 'restart', 'play', 'show', 'slideshow', 'wake', 'playgroup', 'recipe', 'meals', 'close', 'refresh', 'media', 'screenshot', 'timer'].includes(command)) return json({ error: 'unknown command' }, 400);
      if (command === 'timer' && !['start', 'cancel', 'add'].includes(action)) return json({ error: 'a timer action' }, 400);
      if (command === 'media' && (!/^[0-9a-f-]{36}$/.test(id || '') || !['photo', 'video'].includes(kind))) return json({ error: 'a shared photo or video id' }, 400);
      if (command === 'play' && !/^[\w-]{11}$/.test(id || '')) return json({ error: 'a YouTube video id' }, 400);
      const extra = command === 'play' ? { id, title: String(title || '').slice(0, 200) }
        : command === 'show' ? { tab: String(tab || '').slice(0, 20) }
          : command === 'playgroup' ? { group: String(group || '').slice(0, 40) }
            : command === 'recipe' ? { id: String(id || '').slice(0, 100), title: String(title || '').slice(0, 200) }
              : command === 'refresh' ? { what: String(what || '').slice(0, 20) }
                : command === 'media' ? { id, kind, title: String(title || '').slice(0, 120) }
                  : command === 'timer' ? { action, label: String(label || '').slice(0, 40), seconds: Math.max(0, Math.min(86400, Math.round(Number(seconds) || 0))), ...(id ? { id: String(id).slice(0, 20) } : {}) } : {};
      const msg = JSON.stringify({ command, ...extra });
      let sent = 0;
      for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); sent++; } catch {} }
      return json({ sent });
    }
    const dismiss = /^\/dismiss\/([\w-]+)$/.exec(path);
    if (dismiss) {
      const list = await this.load();
      const rest = list.filter((m) => m.id !== dismiss[1]);
      if (rest.length !== list.length) await this.save(rest);
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  }

  async post(req) {
    let input;
    try { input = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }
    const msg = { title: clean(input.title, LIMITS.title), body: clean(input.body, LIMITS.body), from: clean(input.from, LIMITS.from) };
    if (!msg.title && !msg.body) return json({ error: 'Send a title, a body, or both' }, 400);
    const list = await this.load();
    if (list.length >= MAX_PENDING) return json({ error: 'Too many undismissed messages on the frame' }, 429);
    const ttl = Number(input.ttl_minutes);
    const entry = {
      id: crypto.randomUUID(),
      ...msg,
      at: new Date().toISOString(),
      ...(ttl > 0 ? { expires: Date.now() + Math.min(ttl, 7 * 24 * 60) * 60000 } : {}),
      ...(input.speak === false ? { speak: false } : {}),
    };
    await this.save([...list, entry]);
    return json({ id: entry.id }, 201);
  }

  // Pending messages, without expired ones.
  async load() {
    const now = Date.now();
    return ((await this.ctx.storage.get(KEY)) || []).filter((m) => !m.expires || m.expires > now);
  }

  // Store, push the new list to every connected frame, and wake again when the next one expires.
  async save(list) {
    await this.ctx.storage.put(KEY, list);
    const text = JSON.stringify({ messages: list });
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(text); } catch {} }
    await this.schedule(list);
  }

  // Wake for whichever comes first: the next message to expire, or the screenshot's deletion.
  async schedule(list) {
    const shotAt = await this.ctx.storage.get('shot-at');
    const next = Math.min(...list.map((m) => m.expires || Infinity), shotAt ? shotAt + SHOT_KEEP_MS : Infinity);
    if (next < Infinity) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    const shotAt = await this.ctx.storage.get('shot-at');
    if (shotAt && Date.now() >= shotAt + SHOT_KEEP_MS) await this.ctx.storage.delete(['shot', 'shot-at', 'shot-error']);
    await this.save(await this.load());
  }

  // Frames only send "ping" (auto-answered above); anything else is ignored.
  webSocketMessage() {}
  webSocketClose() {}
  webSocketError() {}
}
