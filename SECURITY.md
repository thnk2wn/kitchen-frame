# Security

## Reporting a problem

Please report security problems privately through GitHub: **Security → Report a vulnerability** on
this repository. Don't open a public issue for them.

## How it's put together

The frame is a kiosk that talks to the Worker (Cloudflare) for calendars, lists, photos and messages.
The Worker holds every other service's credentials, so the frame never does. Everything else is
optional: Home Assistant on the home network (the House tab, music, the doorbell, announcements),
and, on an always-on Mac, the bridge (Apple Reminders, or iCloud calendars and photos without public
links) and the camera relay (for cameras too big for the frame's video decoder).

## What each secret opens

Only the first is always needed; each of the rest exists only if you use what it's for.

| Secret | Needed | Kept in | Opens |
| --- | --- | --- | --- |
| `DASHBOARD_KEY` | always | Worker secret; the frame's storage; `.dev.vars` | the Worker's API: calendars (details too), lists (read and change), photos, messages, the frame's status and settings backup |
| The frame's Home Assistant token | only with Home Assistant (House tab, Music, doorbell, announcements) | the frame's storage | what the HA user it belongs to may do. Use a **non-admin** user for the frame, and tick **Can only log in from the local network** for it once the frame reaches HA by its LAN address (not Nabu Casa), so a copied token is useless outside the house |
| `AGENT_TOKEN` | only if AI agents or automations post messages or save recipes | wherever agents run | posting messages (which may be read aloud) and saving recipes; it can't read anything |
| `BRIDGE_TOKEN` | only with a Mac running the bridge: for Apple Reminders lists, or iCloud calendars and a shared album without public links | the Mac (`bridge/mac/`) | sending the lists, calendars and album photos the Worker asks the Mac for, and taking the frame's list changes |
| `CAMERA_RELAY` (its token) | only with the camera relay: Home Assistant cameras whose picture is too big for your frame's video decoder | Worker secret; the Mac (`relay-gate.token`) | WebRTC signalling for the cameras the relay serves, from the home network only |
| Calendar links (`CALENDAR_URLS`), an album link (`ALBUM_URL`) | for each calendar or album shown by link (not through the Mac) | Worker secrets | reading that calendar or album, for anyone holding the link |
| Todoist, Paprika, Spotify credentials | only with those services | Worker secrets | those accounts, as described in each feature's page |
| The status page's GitHub app and session secret | only with the optional status page | the status page Worker's secrets | the status page, for the one GitHub account allowed (`ALLOWED_GITHUB_ID`) |

None of these are ever in the repository: they live in `wrangler secret`, the gitignored
`dashboard/.dev.vars`, `.prod.vars` and `.frame.vars`, or on the device that uses them.

## Choices that keep things narrow

- **The key never appears in a URL.** It travels only as a header. Images and the live messages
  socket, which can't send headers, use an HttpOnly cookie the Worker sets: an HMAC of the key, not
  the key, valid only for those paths. A key in a URL isn't accepted, except once on the setup link,
  which carries it (and the Home Assistant token) after `#`, the part a browser never sends, so it
  can't reach the Worker's request logs; the page saves it and strips it from the address (since
  2026-10-20; links made before put it in the query, which reached the logs). The kiosk app doesn't
  keep it in its own settings.
- **Public links are optional.** iCloud calendars and the shared album can come through the Mac
  bridge instead (`bridge:<name>`), read as you through Apple's own frameworks, so there's no link
  that reads them at all; turn **Public Calendar** and **Public Website** off. Links still work for
  anyone without a Mac, and for feeds like Fastmail or a sports schedule.
- **`#private`** in an event's title or notes (or marking it Private) keeps it off the frame. It's
  still in a published feed, so this hides it from the kitchen, not from anyone with the link.
- **The camera relay's own API never faces the network** (if you run it). go2rtc's API can run commands, so it
  listens on the Mac only; `relay-gate.py` passes just the video signalling, and only with the
  token: one WebSocket upgrade for a `<name>_av` stream, tunnelled only once go2rtc has accepted it,
  so no other request can follow it on the connection (`test_relay_gate.py`; a 2026-10-20 review
  found that hole). With Ring cameras through ring-mqtt, its streams need a password once they're exposed for
  the relay, which means Home Assistant's own cameras need it in their addresses too (docs/house.md).
- **Acting on the frame is home-only.** The phone app's Remote and Screenshot, and sharing a video or
  photo to the frame, are accepted only from the frame's own network: the IPv4 address or IPv6 /64
  its check-ins (and the Mac bridge's) come from (`worker/home.js`). Reading (Ops), fitness sends and
  guest mode work from anywhere. This stops a lost phone driving the frame or seeing its screen from
  elsewhere; it doesn't stop someone holding the key itself, who could check in as the frame.
  `HOME_ONLY=off` turns it off.
- **Screenshots are kept briefly.** Only the latest, in the message room, deleted 10 minutes after it
  was taken; the frame says "Screenshot sent to a phone" each time. The kiosk app uploads only to the
  dashboard's own address, never to one a page passes it (Android 8's WebView shares the kiosk's
  bridge with embedded frames, like YouTube's).
- **The bridge asks only for what it's given to do** (Reminders, Calendar, Photos, each only when a
  source is set to come through the Mac), and only reads, except the Reminders lists you chose: a
  change to a reminder is refused unless the reminder is in the list it names.
- **Pairing a phone asks first.** A pairing link only proposes: the app shows the frame's address
  and pairs on a tap, and pairing with a different frame turns fitness sharing off until it's turned
  on again, so a link from someone else can't quietly redirect this phone's health data.
- **The kiosk stays on the dashboard.** A top-level page on another host is refused (it would get
  the kiosk's bridge), and the dashboard's page is served with `nosniff`, `X-Frame-Options: DENY` /
  `frame-ancestors 'none'` and an explicit referrer policy.

## On the frame

**Unlock PIN** (Settings → Home, `lib/pin.svelte.js`): stops someone at the screen unlocking a door,
like the PIN Alexa asks for. It's kept as a salted PBKDF2 hash, never the digits, and five misses
start a wait that doubles up to 15 minutes. It doesn't protect the device itself: whoever can root
the frame can read its tokens and unlock without the dashboard, which is what the steps below are for.

**Settings changes** are logged as `settings.changed` events (what changed, from what to what) and
the 10 versions before the current backup are kept: `GET /api/frame/settings?history`.

## If the frame is lost, stolen or sent off for repair (or a secret leaks)

1. With Home Assistant: the frame's user → its long-lived token → **Delete** (or deactivate the user).
2. A new dashboard key: `cd dashboard && npx wrangler secret put DASHBOARD_KEY`, and put the same
   value in `.dev.vars`. The old key, and every cookie made from it, stop working at once.
3. On the frame (or its replacement): a new HA token in `.frame.vars` if you use one, then the setup link
   (`scripts/frame-url.sh`, README → The frame). Its settings come back from the Worker's backup.
4. The rest only if they leaked:
   - `AGENT_TOKEN`, `BRIDGE_TOKEN`: `wrangler secret put` each, then update the agents and the Mac.
   - The camera relay's token: delete `~/go2rtc/relay-gate.token` on the Mac, run
     `camera-relay.sh install` to make a new one, and store the new `CAMERA_RELAY`.
   - A calendar or album link: turn its sharing off and on in the app that made it, which makes a
     new link, and store that one (or move it to the Mac bridge and leave sharing off).
