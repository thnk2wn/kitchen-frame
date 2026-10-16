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

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// The Worker's stub for the room. Every request goes through one instance, so the list is consistent.
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
    if (path === '/post') return this.post(req);
    // A command for the frame itself (e.g. "checkin": send your status and events now), pushed to
    // every connected frame; nothing is stored.
    if (path === '/command') {
      const { command } = await req.json().catch(() => ({}));
      if (!['checkin'].includes(command)) return json({ error: 'unknown command' }, 400);
      let sent = 0;
      for (const ws of this.ctx.getWebSockets()) { try { ws.send(JSON.stringify({ command })); sent++; } catch {} }
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
    const next = Math.min(...list.map((m) => m.expires || Infinity));
    if (next < Infinity) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    await this.save(await this.load());
  }

  // Frames only send "ping" (auto-answered above); anything else is ignored.
  webSocketMessage() {}
  webSocketClose() {}
  webSocketError() {}
}
