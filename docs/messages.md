# Posting messages to the frame

Any AI agent or script can put a message on the kitchen frame. It covers the whole screen
(dashboard or slideshow) until someone taps its X. Several messages queue up, oldest first.

**Needs:** only an `AGENT_TOKEN`, and only if you want agents or scripts to post; without it the
frame simply never gets messages. Reading them aloud also needs Home Assistant and a speaker
([announcements](announcements.md)).

```sh
curl -X POST https://photo-frame-dashboard.<your-subdomain>.workers.dev/api/messages \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Dinner is ready", "body": "Come down when you can.", "from": "Kitchen agent", "ttl_minutes": 60, "speak": true}'
```

- **Token:** `AGENT_TOKEN` in `dashboard/.prod.vars` (gitignored). It can only post messages and save
  recipes ([recipes.md](recipes.md)); it can't read the calendar, tasks, photos or anything else. To revoke it, put a new value in `.prod.vars` and
  run `npx wrangler secret put AGENT_TOKEN` from `dashboard/`.
- **Fields:** `title` (up to 120 characters) and/or `body` (up to 2,000; line breaks kept), optional
  `from` (shown above the title, up to 60) and `ttl_minutes` (message disappears by itself after that,
  up to 7 days; without it, it stays until dismissed). Plain text only.
- **Response:** `201 {"id": "..."}`. `400` for an empty or invalid body, `401` for a wrong token,
  `429` when 20 messages are already waiting.
- **Timing:** instant. The frame keeps a WebSocket open to a Cloudflare Durable Object
  (`MessageRoom` in `dashboard/worker/messages.js`), which stores the messages and pushes every
  change to the screen: about 0.1 s from the POST to the message showing. If the connection drops
  (Wi-Fi blip, reboot), the frame reconnects with backoff (1 s up to 1 minute) and checks once a
  minute until it's back, so nothing is missed.
- **Cost:** about nothing. The Durable Object uses WebSocket hibernation: between messages it's
  out of memory and not billed, while the connection stays open. The frame's keep-alive "ping"
  every 30 seconds is answered by Cloudflare's runtime ("pong") without waking it. It wakes only
  to accept a connection, store a post or dismissal, or remove a message whose `ttl_minutes`
  ran out (a scheduled alarm). This fits well inside the free plan's Durable Objects allowance.
- **Demo mode** holds messages back; they appear when demo mode is switched off.
- **Read aloud:** with Settings → Announcements on and **Agent messages** on, the frame has Home
  Assistant say each new message on the Announcements speaker, at its announcement volume (through
  `script.frame_announce`; docs/announcements.md): "Message from <from>. <title>. <body>", up to 400
  characters. Not during night hours, not in demo mode, not for messages over 10 minutes old, and never
  twice. Send `"speak": false` to show a message silently.
