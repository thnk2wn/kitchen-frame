# House tab: Home Assistant devices

With a Home Assistant URL, token and dashboard set on the frame, a **House** tab mirrors that HA
dashboard: its headings become groups, tiles become devices you can tap (lights, fans, switches,
locks, covers, scenes), thermostats get setpoint buttons, sensors show their values, markdown cards
(including the view header) are rendered live by HA, and cameras show a snapshot. Edit the dashboard
in HA and the frame follows within a second or two.

**Needs:** Home Assistant, reachable from the frame on the home network, and a dashboard in it to
mirror. Without the HA settings below the frame has no House tab (and no Media tab); everything else
works as before. Cameras need nothing more for pictures; live video needs a camera HA can stream over
WebRTC.

![House tab](images/house-light.jpg)

## Setup

Put `DASHBOARD_URL`, `HA_URL`, `HA_TOKEN` and `HA_DASHBOARD` (and optionally `THERMOSTAT_GAP`,
`PRESENCE_AREA`, `TV_AUDIO`, …) in the gitignored `dashboard/.frame.vars`, then
`open "$(dashboard/scripts/frame-url.sh)"` (a browser) or pass the same URL to the kiosk with
`adb shell am start … -d`. The page saves the settings and removes them from the address bar.

- `HA_DASHBOARD` is the URL path of the dashboard to mirror (for example `dashboard-favorites`).
- For the frame, make `HA_URL` Home Assistant's address on the home network
  (`http://<HA's IP>:8123`; the kiosk lets the https page reach it), not a Nabu Casa or other
  remote address, and give HA a fixed IP (a router reservation, or a static address in HA outside
  the router's DHCP range). Then `HA_TOKEN` can belong to a **non-admin** HA user marked **Can only
  log in from the local network**, so the token is useless outside the house
  ([SECURITY.md](../SECURITY.md)).
- **Add the dashboard's address to Home Assistant's CORS allowed origins** (Settings → System →
  Network → CORS allowed origins, since 2026.8; before that `http: cors_allowed_origins:` in
  `configuration.yaml`), for example `https://<your worker>.workers.dev`. Camera pictures and album
  art are fetched from Home Assistant by the page (`lib/ha-image.js`), because a current WebView blocks
  plain-`http` images on the `https` dashboard; without the origin they show as broken pictures. Home
  Assistant restarts to apply it and asks you to confirm within 5 minutes, or it goes back.

## Devices

- **Taps** toggle lights, fans, switches and covers, run scenes and scripts, and press buttons. The
  tile says what it's doing ("Locking…") until the device reports back, and "Didn't change" if it
  doesn't.
- **Locks:** locking is one tap. Unlocking takes two taps, or asks for a four-digit PIN once one is
  set in **Settings → Home → Unlock PIN** (a correct PIN is trusted for a minute; five misses start
  a wait that doubles; locks and unlocks are logged). Forgotten: `scripts/frame-url.sh --clear-pin`
  sent over ADB removes it.
- **Thermostats** in heat/cool keep their two setpoints apart by `THERMOSTAT_GAP` (°F, default 5,
  the ecobee's own minimum unless changed; set it in `.frame.vars`), moving the other one as the
  thermostat's app does.

## Cameras

Any camera on the mirrored dashboard works: Ring, Reolink, UniFi Protect, Nest or anything else Home
Assistant has. Each camera tile shows a snapshot. Pictures change when the tab opens, on **Refresh** by the
heading, on a tap, and on the schedule in **Settings → Home → Camera pictures** (every minute by
default, every 5 minutes, or off): the newest picture the camera's add-on already took, and at most
every 5 minutes a new one from a camera whose picture is older than that, since asking a battery
camera wakes it. New pictures load before they replace the old one, so nothing flashes.

Tap a camera for it full screen: live video over WebRTC when the camera offers it, otherwise the
picture refreshed every 15 seconds, with when it was taken ("picture taken 10:31:42 PM (25 s ago)").
It closes itself after two minutes. While video is arriving but hasn't shown yet (waiting for a
keyframe) the frame waits up to 30 seconds before retrying. **Sound** unmutes it; for a camera
whose sharp stream has no sound, it switches to the camera's own live view (smaller, with sound)
and **Sharper** switches back.

### Live video, and what the frame can decode

**The short version:** a camera whose picture is wider than the frame's video decoder handles
arrives but never shows. Most cameras play as they come and need nothing below. For the ones that
don't (here, some Ring cameras), a Mac at home can shrink the picture first.

Which parts of this you need:

- **Any camera HA streams over WebRTC:** nothing; the full-screen view plays it, else shows pictures.
- **Ring cameras:** paths 2 and 3 below are Ring's (through the
  [ring-mqtt](https://github.com/tsightler/ring-mqtt) add-on and HA's Ring integration). Other
  cameras have only HA's own stream and skip them.
- **The camera relay** (a Mac, go2rtc, a token gate, `CAMERA_RELAY`): only if you want live video
  from a camera your frame can't decode. Without it those cameras show pictures, as before.

A Ring camera can reach the frame three ways. The full-screen view tries them in this order and
falls back on its own:

1. **The camera relay** (below, optional), for cameras too big for the frame: shrunk on a Mac,
   with sound.
2. **`camera.<name>_stream`**: a **Generic Camera** in Home Assistant on the camera's
   [ring-mqtt](https://github.com/tsightler/ring-mqtt) stream, played through Home Assistant. No sound.
3. **`camera.<name>_live_view`**: Ring's own live view through Home Assistant's Ring integration,
   with sound. Used when the others fail, and by **Sound** for a camera on path 2.

Then pictures, refreshed every 15 seconds. Whenever it falls back, a yellow line under the camera's
name says why (for example "⚠ Video relay offline · showing the camera's own video"), so a grainy
or still picture is never a mystery. The reasons are also in the frame's event log (`camera.*`).

For path 2, add a Generic Camera (Settings → Devices & Services → Add → Generic Camera) with its
**Stream source** set to the `stream_Source` address on the camera's ring-mqtt **Info** sensor
(`rtsp://<user>:<password>@…-ring-mqtt:8554/<id>_live`, with the livestream user and password once
those are set in ring-mqtt), and name its entity `camera.<name>_stream`, where `<name>` matches the
camera's `camera.<name>_live_view`.

**Which cameras need the relay.** It depends on your frame's video decoder and your cameras' size.
The Pastigio FRAME156's RK3326 decodes H.264 up to 1920 wide; other frames differ. A picture wider
than the decoder handles arrives but never decodes: the event log shows `camera.not_playing` with
bytes received but 0 frames. That's the sign a camera needs the relay. Measured here, on a FRAME156:

| Camera | Ring sends | On the frame |
|---|---|---|
| Floodlight Cam Pro, Stick Up Cam | 720p through ring-mqtt | plays (path 2) |
| Doorbell Pro 2 | 1536×1536 | plays only now and then: use the relay |
| Spotlight Cam Pro | 2624×1472 ("2K") or 1968×1104 ("1080p") | never: use the relay |

For Ring there's no way to ask for less: ring-mqtt passes the camera's size through, and Ring ignored
both the bandwidth cap and the frame-size limit the frame can put in its WebRTC offer (both tried).
The Ring app's **Video Quality** setting doesn't go below 1968 wide on a Spotlight Cam Pro.

### Cameras the frame can't decode: the camera relay

Optional, and only for cameras your frame can't decode (above). It needs an always-on Mac on the
home network (here the one that runs the Reminders bridge), which shrinks those cameras to 1280
wide (decoding in software, encoding on its video hardware), adds their sound, and the frame plays them straight from it. The setup
below is for Ring cameras through ring-mqtt, the only cameras tried here. Another camera should work
the same way in principle (go2rtc reads most cameras' RTSP streams), but untested: its stream in the
relay's config, and a Generic Camera named `camera.<name>_stream` in Home Assistant, since that's
the name the frame looks for to know a camera has a relay stream:

```
Ring → ring-mqtt (Home Assistant add-on) → go2rtc on the Mac (shrink, add sound) → the frame
                                                 ↑ relay-gate.py checks the frame's token
```

**Why straight to the frame, not through Home Assistant.** Home Assistant gives up on a stream that
stays silent for about 10 seconds, and a cold start (Ring wakes the camera, ring-mqtt connects,
the Mac starts transcoding) measured 4 to 12 s, so about half the cold opens failed. Played directly,
the frame waits as long as it needs (up to 30 s). The Mac's streams still exist as Generic Cameras
in Home Assistant (path 2) for anything else that wants them.

**Why a gate.** The frame's page can't hand go2rtc a password: browsers drop a password written in a
WebSocket address, and go2rtc refuses the check browsers make before sending one in a header. Its
API can't simply be left open, because go2rtc's API can run commands on the Mac. So go2rtc's API
listens on the Mac only, and `relay-gate.py` (about 80 lines, Python that ships with macOS) lets
through just the video signalling, and only with a long random token. The Worker hands the
relay's address and token to the frame (secret `CAMERA_RELAY`), like it hands it everything else.

**Why the sound is a separate ffmpeg.** One ffmpeg muxing both held the video seconds behind the
audio, which played choppy and then froze while the page still said Live. Each now runs on its own
and go2rtc combines them. For the same reason the frame plays them without lip sync, since their
clocks are unrelated (sync froze the picture the moment sound was turned on).

**Setup** (files in [`bridge/camera-relay/`](../bridge/camera-relay/)):

1. **ring-mqtt** (Ring cameras only): in the add-on's options set a livestream user and password, and in its Network
   section expose port 8554 on the home network. Restart the add-on. **This puts a password on every
   ring-mqtt stream**, so update any Generic Camera that used the bare address (path 2 above) to the
   one with the user and password, or it stops playing (Home Assistant logs `401 Unauthorized`).
2. **The Mac:** make `~/go2rtc/` and put two programs in it: `go2rtc`
   ([releases](https://github.com/AlexxIT/go2rtc/releases), `go2rtc_mac_amd64` or `_arm64`) and a
   static `ffmpeg` with VideoToolbox (for example the darwin build from
   [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static/releases); check
   `./ffmpeg -encoders | grep videotoolbox`).
3. **Install:** copy `bridge/camera-relay/` to the Mac and run `camera-relay.sh install`. It wraps
   go2rtc in a small app bundle, sets up go2rtc and the gate to run at login and restart if they stop,
   makes the token, and writes `~/go2rtc/go2rtc.yaml` from the example the first time. Fill in its
   `<…>` parts (one `<name>` and `<name>_av` pair per camera), then `camera-relay.sh restart`.
   `camera-relay.sh status` and `logs` show what's running. They're two processes rather than one
   because go2rtc's app bundle holds a macOS permission the gate doesn't need (next step).
4. **macOS asks once** whether go2rtc may use the local network; allow it (System Settings → Privacy &
   Security → Local Network). Until then go2rtc's ffmpeg gets "No route to host" even though the same
   command works from a shell. That's why go2rtc runs as an app: the permission belongs to an app.
5. **The Worker:** store the relay's address with the token, from the computer you deploy from (the
   install prints the command): `CAMERA_RELAY` = `http://<the mac's IP>:1985/<token>/?cameras=<name>,<name>`.
   `?cameras=` lists the cameras the relay serves; their `<name>`s match the Home Assistant cameras.
   More than one address (space-separated) is allowed and the frame uses whichever answers, but use
   the IP: the frame asks Google's DNS, not the router's, so `.lan` and `.local` names don't resolve on it.
   **Give the Mac a fixed IP.** Reserve one in the router if it can; if it can't (some ISP routers can't),
   set it on the Mac, outside the router's DHCP range (next to Home Assistant's fixed address, say),
   with System Settings → Wi-Fi → Details → TCP/IP → Configure IPv4 **Manually**, the router as router
   and DNS, or `sudo networksetup -setmanual Wi-Fi <ip> 255.255.255.0 <router>` and
   `sudo networksetup -setdnsservers Wi-Fi <router>` (undo: `sudo networksetup -setdhcp Wi-Fi`).
   **Keep it awake on its charger:** System Settings → Battery → Options → **Prevent automatic sleeping
   on power adapter when the display is off**, and Low Power Mode only on battery (or
   `sudo pmset -c sleep 0 lowpowermode 0`; check with `pmset -g custom`).
6. **Home Assistant (optional):** point each camera's Generic Camera at
   `rtsp://frame:<go2rtc password>@<the mac's IP>:8554/<name>`, so `camera.<name>_stream` (path 2) also
   goes through the Mac. Saving can time out while Home Assistant test-opens a cold stream; open the
   stream first (any player) so it's warm.

**If the Mac is off, asleep or has a new address,** the frame notices in about 2.5 s and shows the
camera's own live view with "⚠ Video relay offline". A Doorbell Pro 2 then often still plays; a
Spotlight Cam Pro shows pictures.

On 2026-10-20 the relay showed "offline" with the Mac on, for three reasons together: the Mac was
asleep (`sleep 1` on its charger; a sleeping Mac still answers ping through its Wi-Fi card, which hides
it), its DHCP address had moved, so `CAMERA_RELAY` was stale, and go2rtc was still
bound to the old address for WebRTC (`listen udp addr=` in `~/go2rtc/go2rtc.log`). After any address
change, restart it: `launchctl kickstart -k gui/$(id -u)/local.kitchen-frame.go2rtc`. Home Assistant's
Generic Cameras pointed at a `.lan` name that the router had given to another device; they now use
the fixed IP too.

**Measured here:** cold, the frame shows a Spotlight Cam Pro (1280×718) or a Doorbell Pro 2
(1280×1280) in 10–14 s, a desktop browser in about 6.5 s. The Mac (a 2019 MacBook Pro, 2.3 GHz Intel
i7) spends about 57% of a core per camera decoding in software, only while someone watches.

**Decode in software on an older Intel Mac.** The relay first decoded on the Mac's video hardware
(VideoToolbox, a few % of a core). By 2026-10-20 that had become the slow part: Apple's hardware
decoder stalled on the damaged first frames of a Ring stream, and a camera took 45–120 s to appear,
or the frame gave up, while the same stream decoded in software gave a first picture in 2–8 s (cold
through the whole relay, 11–16 s; the doorbell longer when it has to wake). Encoding stays on the
hardware, which was never slow. To check a Mac, time a first frame both ways on it, with the
camera's ring-mqtt address (wait a few seconds between runs, or ring-mqtt answers 404):
`./ffmpeg -rtsp_transport tcp -hwaccel videotoolbox -hwaccel_output_format videotoolbox_vld -i <rtsp
url> -an -vf scale_vt=w=1280:h=718 -c:v h264_videotoolbox -frames:v 1 -f null -` against the same
without `-hwaccel …` and with `-vf scale=1280:718`. Apple silicon may well be fast both ways.
go2rtc's sources also wait up to 60 s for the first video (`#starttimeout=60`) and the frame up to
65 s for the relay to answer, since a cold Ring session can take that long; above 30 s either used
to give up. ring-mqtt
drops the Ring session the moment the last viewer leaves, so a request within a second of that gets
a 404 and is retried. Ring's own sound is quiet (near silence from a quiet porch), so the relay
boosts it 4×.

