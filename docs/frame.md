# Our frame: Pastigio FRAME156 (15.6", Frameo)

Same model and firmware as Wes's unit, so
`reference/photo-frame-dashboard/docs/pastigio-frame156.md` applies directly. Serial number, MAC
and IP address are deliberately not recorded here.

## Identity (read over ADB, 2026-10-12)

| | |
| --- | --- |
| Model / firmware | Pastigio `FRAME156` · `FrameO.DP105F.v2026010414` (10-12); `FrameO.DP105F.v2026051219` by 10-14 (see below) |
| Android | 8.1.0 (API 27), security patch 2020-11-05, SELinux permissive |
| SoC / RAM | Rockchip RK3326, 32-bit userspace (`armeabi-v7a`) · 951 MB |
| Screen | 1920×1080 at 170 dpi (the dashboard was designed for 1280×800 and must be adapted) |
| WebView | 106.0.5249.126, already current, no swap needed |
| Root | `su -c id` returns uid 0 with no prompt (still true on the 2026-05 firmware). Any app on the frame can get root: install nothing untrusted |
| Home app | `net.frameo.frame` (Frameo) |
| Network ADB | off (nothing listening on 5555) |
| Clock | **No battery-backed clock** (`/dev/rtc0` missing). Every power-up starts at 2008-12-31 until Wi-Fi time sync, so the first HTTPS load fails with a certificate-date error, and Android's own sync takes about 100 s. Since kiosk 1.5 the kiosk sets the clock itself on that error (a plain-HTTP Date header, then `su -c date`) and loads within seconds; without root it retries until Android syncs (verified 2026-10-14 by setting the clock back). |

## Getting ADB working (what actually worked)

1. Frameo **Settings → About → Beta Program: on**. Only then does **ADB Access** appear below it;
   turn it on and accept Frameo's warning. (Joining the beta only changes which Frameo updates arrive,
   and Frameo is turned off below.)
2. Frameo setting **Transfer from computer: off**. With it on, the frame shows up on USB for a moment,
   then Frameo takes the USB connection and ADB disappears before the approval prompt can appear.
3. **Cable:** the frame's **USB-C** port (the USB-A port is a host port, for thumb drives), with a
   cable whose other end is **USB-A** into the computer (a dock's USB-A port, or the Apple USB-C
   Digital AV Multiport Adapter's). A USB-C-to-USB-C cable, even Apple's, shows nothing at all: the
   frame's port seems to lack what C-to-C needs. If the Mac doesn't list a Rockchip device
   (`system_profiler SPUSBHostDataType`), it's the cable or port, not a setting.
4. Open Frameo's Settings screen so the slideshow isn't in front, then re-request authorization
   from the Mac (`adb reconnect`) until "Allow USB debugging?" appears; tap Allow. Turning ADB Access
   off and on again also brings the prompt back.
5. The USB link still drops for a few seconds now and then; retry commands rather than assuming failure.

## Changes made

| Date | Change | Command | Undo |
| --- | --- | --- | --- |
| 2026-10-12 | Vendor OTA updater off | `pm disable-user --user 0 com.muxintu.app.mxota` | `pm enable com.muxintu.app.mxota` |
| 2026-10-12 | Rockchip updater off | `pm disable-user --user 0 android.rockchip.update.service` | `pm enable android.rockchip.update.service` |
| 2026-10-12 | Kiosk installed (`com.huntsyea.frame`, now 1.3, built from `kiosk/`; 1.2 adds the brightness bridge `window.FrameKiosk`, 1.3 allows the https page to reach Home Assistant over plain http on the LAN) | `adb install -r kiosk/build/frame.apk`, URL set once with `am start … -d <dashboard url with ?key=>` | `adb uninstall com.huntsyea.frame` |
| 2026-10-12 | Frameo off | `pm disable-user --user 0 net.frameo.frame` | `pm enable net.frameo.frame` (photos and settings untouched) |
| 2026-10-12 | Kiosk made the Home app | `cmd package set-home-activity com.huntsyea.frame/.MainActivity` | `cmd package set-home-activity net.frameo.frame/.ui.activities.AWaitForDeferredInitCompleted` after re-enabling Frameo |

Nothing under `/system` or any flash partition has been written. No backup taken (owner's choice).

### Found reset, set up again (2026-10-14)

The frame came back on Frameo's first-run Welcome screen with newer firmware
(`FrameO.DP105F.v2026051219`), so a vendor or Frameo update had reset it: the kiosk was gone, Frameo
and the updaters were on again. Root (`su`) still works on that firmware, and network ADB was off.
During setup Frameo updated itself to 1.32.15 (an app update in `/data/app`; the firmware didn't
change). Redone over USB:

| Change | Command | Undo |
| --- | --- | --- |
| Vendor and Rockchip updaters off | `pm disable-user --user 0 com.muxintu.app.mxota` and `android.rockchip.update.service` | `pm enable …` |
| Kiosk 1.4 installed, URL set (now 1.6: 1.5 sets the clock itself at boot from a server's Date header, so the dashboard loads in seconds, not after Android's 100 s time sync; 1.6 reports its version to the page, makes the two-finger hold more forgiving, and keeps only the dashboard's address, not the setup link's key and token) | `adb install -r kiosk/build/frame.apk`, then `am start … -d "'$(dashboard/scripts/frame-url.sh)'"` (dashboard key and HA settings) | `adb uninstall com.huntsyea.frame` |
| Kiosk made the Home app | `cmd package set-home-activity com.huntsyea.frame/.MainActivity`, plus **Always** on Android's "Select a Home app" dialog | as above |
| Frameo hidden for the user (not just disabled) | `pm uninstall -k --user 0 net.frameo.frame` (keeps its data) | `cmd package install-existing net.frameo.frame` |
| Boot animation: the frame's mark and name (`FRAME_NAME` in `.frame.vars`, default "Kitchen Frame") fading in (`kiosk/bootanimation/build.sh`) | `adb push build/bootanimation.zip /data/local/tmp/`, then as root: `mount -o remount,rw /oem; mkdir -p /oem/media; cp /data/local/tmp/bootanimation.zip /oem/media/; chmod 755 /oem/media; chmod 644 /oem/media/bootanimation.zip; chcon u:object_r:oemfs:s0 /oem/media /oem/media/bootanimation.zip; sync; mount -o remount,ro /oem`. Android 8.1 plays `/oem/media/bootanimation.zip` before `/system/media/`'s; `/oem` is outside verified boot, so `/system` is untouched. Preview without a reboot: `setprop service.bootanim.exit 0; start bootanim` (then `setprop service.bootanim.exit 1; stop bootanim`) | As root: `mount -o remount,rw /oem; rm -r /oem/media; mount -o remount,ro /oem` (the stock animation comes back) |

**Firmware backup (2026-10-14).** Every eMMC partition except `userdata`, plus the 8 MiB before
`uboot` (partition table and loader area) and `mmcblk2boot0/1`, each verified against a SHA-256 taken
on the frame: 527 MB compressed, kept off the repo (it holds device identifiers). Method from
`reference/photo-frame-dashboard/docs/pastigio-frame156.md`, with two traps found here: this `dd`
rejects `bs=1M` (use `bs=1048576`), and the USB link can drop mid-copy, so check every checksum and
retry the parts that fail. Restoring would need Rockchip loader mode, still untested on this model.

**Read-only audit (2026-10-14).** No Aimor apps. Only the kiosk holds network connections (the
Worker on Cloudflare, and a CDN); Frameo and both updaters are off, and the factory test app
(`com.szclink.app.cldevicetest`) is installed but not running.

**Wait before rebooting.** Android saves these package changes about 10 seconds after they're made.
Rebooting straight after `pm disable-user` or `pm uninstall --user 0` loses them, and Frameo was back
after the first two reboots for that reason, not because anything re-enables it. Wait 30 s (or check
`/data/system/users/0/package-restrictions.xml` with `su`), then reboot. Verified after a reboot:
boots into the kiosk, Frameo and the updaters not installed or running.

## Day-to-day

- Dashboard: `https://photo-frame-dashboard.<your-subdomain>.workers.dev/?key=<DASHBOARD_KEY>` (key in `dashboard/.prod.vars`, gitignored).
- Change the URL: `adb shell am start -n com.huntsyea.frame/.MainActivity -d '<url>'` (remembered across reboots).
- Escape hatch on the frame: hold two (or more) fingers still for 2 s → Reload dashboard / Android settings.
  Kiosk 1.6 allows some drift and a stray extra touch; a cancelled hold is logged (`adb logcat -s FrameKiosk`).
- Logs: `adb logcat -s FrameKiosk` shows loads, retries and SSL/network errors.
- Status without the cable: `dashboard/scripts/frame-status.sh` prints the frame's last check-in
  (every 10 minutes): dashboard and kiosk versions, WebView, when it loaded, what it's showing, and
  whether it's running the deployed dashboard yet; `--log` adds its recent events. The same check-in
  backs up its Settings choices to the Worker; after a reset, run the setup link and the rest come
  back by themselves.
- Network exposure: nothing on the frame listens for connections (checked 2026-10-15), so ADB works
  only over USB.
- Remote debugging (chrome://inspect) only while launched with `--ez debug true`; any normal launch turns it off.
- Brightness: Settings → Brightness calls `window.FrameKiosk.setBrightness(0.05–1)`; the kiosk saves it and applies it at start. `setBrightness(-1)` hands control back to Android's own setting.
- Demo mode (Settings): sample calendar and lists, no photos; ticks and additions stay on the frame and never reach Todoist.
- After a deploy, Cloudflare can take ~30 s to serve the new version everywhere; a frame that reloads sooner gets the old one until its next reload.

## Security

What each secret opens, and what to do if one leaks or the frame is lost.

| Secret | Kept in | Opens |
| --- | --- | --- |
| `DASHBOARD_KEY` | Worker secret; the frame's storage; `.dev.vars` | the Worker's API: calendars (details too), lists (read and change), photos, messages, the frame's status and settings backup |
| The frame's Home Assistant token | the frame's storage | what the HA user it belongs to may do. Use a **non-admin** user for the frame, and tick **Can only log in from the local network** for it once the frame reaches HA by its LAN address (not Nabu Casa), so a copied token is useless outside the house |
| `AGENT_TOKEN` | wherever agents run | posting messages (which may be read aloud) and saving recipes |
| `BRIDGE_TOKEN` | the Mac (`bridge/mac/`) | the Reminders lists |

The key travels only as a header. Images and the live messages socket, which can't send headers,
use an HttpOnly cookie the Worker sets: an HMAC of the key, not the key, valid only for those paths.
So the key never appears in a URL, a request log or a cache.

**Unlock PIN** (Settings → Home, lib/pin.svelte.js): stops someone at the screen unlocking a door,
like the PIN Alexa asks for. It's kept as a salted PBKDF2 hash, never the digits, and five misses
start a wait that doubles up to 15 minutes. It doesn't protect the device itself: whoever can root
the frame can read its token and unlock without the dashboard, which is what the steps below are for.

**Settings changes** are logged as `settings.changed` events (what changed, from what to what) and
the 10 versions before the current backup are kept: `GET /api/frame/settings?history`.

**If the frame is lost, stolen or sent off for repair** (or a secret leaks):
1. In Home Assistant: the frame's user → its long-lived token → **Delete** (or deactivate the user).
2. A new dashboard key: `cd dashboard && npx wrangler secret put DASHBOARD_KEY`, and put the same
   value in `.dev.vars`. The old key, and every cookie made from it, stop working at once.
3. On the frame (or its replacement): a new HA token in `.frame.vars`, then the setup link
   (`scripts/frame-url.sh`, README → The frame). Its settings come back from the Worker's backup.
4. `AGENT_TOKEN` and `BRIDGE_TOKEN` only if they leaked: `wrangler secret put` each, then update
   the agents and the Mac.

## Music (Home Assistant)

How the Music tab works and how to set it up (Spotify, Home Assistant, Echos) is in
[music.md](music.md). On this frame:

- The Music tab talks to Home Assistant directly on the LAN (`http://<home-assistant-ip>`, HA 2026.9.4) over its
  WebSocket API; HA's REST API rejects cross-origin calls, the WebSocket API doesn't. It uses HA's
  Spotify integration; Music Assistant 2.10.5 also runs as an add-on, and is what the tab falls back to
  without Spotify.
- The HA URL and long-lived token are stored only in the frame's localStorage (`frame-ha-url`,
  `frame-ha-token`), pushed over ADB/DevTools from `dashboard/.frame.vars` (gitignored). They are not in
  the deployed site or Cloudflare.
- The token belongs to a non-admin "Kitchen Frame" user that can only log in from the local network
  (checked 2026-10-15). Any app on this frame can get root, so keep it that way: a non-admin token
  can still operate devices, but not change Home Assistant's configuration, users or integrations.
- The Music tab only appears when a token is present. Removing `frame-ha-token` hides it again.
- The Worker's Spotify connection (every playlist, what's playing) is set up: `SPOTIFY_*` secrets,
  signed in 2026-10-14 with the playlists, recently played and currently playing permissions.

## Troubleshooting from anywhere

The frame checks in with the Worker every 10 minutes, with its versions, what it's showing and an
event log: page loads, Home Assistant dropping or refusing an action, failed or slow calls to the
Worker, the clock screen coming and going and why, cameras (each step of live video), locks and
unlocks, what was announced, settings someone changed, and errors. A runaway loop is cut off
(`ha.call_flood`, `log.flood`). `dashboard/scripts/frame-status.sh --log` prints it, `--now` asks
the frame to check in first, and `--reload` has it reload the dashboard (to pick up a deploy); on
the frame, Settings → About → Recent events; in Cloudflare (Worker → Observability) search
`source = "frame"`. Settings are backed up with each check-in: after a reset the frame takes them
back, and the last 10 versions are kept (`GET /api/frame/settings?history`).

Settings → About shows the version: `v1.0.0` on a tag, `v1.0.0+3 (a1b2c3d)` three commits past it
(`git describe` at build time), with the bundle hash and build time.

## Status page (optional)

`dashboard/ops/` is a private status page, its own Worker (`kitchen-frame-ops`) behind GitHub
sign-in: whether the frame is online and what it's running, a 24-hour strip of dashboard / clock
screen / night / Home Assistant down, the event log with filters, and the backend's health
(calendar feeds, Paprika, the Reminders bridge, Spotify) and recent notices. It reads one summary
from the main Worker (`GET /api/ops/summary`, counts and times rather than content) over a service
binding, and can't change anything. Only one GitHub account (by its numeric ID) can sign in;
anything else, and any request without a session, is refused, and so is everything if a secret is
missing.

1. Create a GitHub OAuth app (github.com → Settings → Developer settings → OAuth Apps → New): homepage
   `https://kitchen-frame-ops.<your-subdomain>.workers.dev`, callback the same plus `/callback`.
2. `cd dashboard && ./node_modules/.bin/wrangler deploy --config ops/wrangler.jsonc`
3. Its secrets (`./node_modules/.bin/wrangler secret put NAME --config ops/wrangler.jsonc`):
   `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (the app's), `ALLOWED_GITHUB_ID`
   (`gh api user --jq .id`), `SESSION_SECRET` (`openssl rand -hex 32`; changing it signs everyone
   out) and `DASHBOARD_KEY` (the main Worker's).

## A different frame

To set up a different frame, start from the upstream device guides in
`reference/photo-frame-dashboard/docs/devices.md` (ADB, root, WebView 106, disabling the vendor app;
some vendor apps accept root commands from the vendor's server), set its time zone (event times
render in it), and measure it with `?diag`.
