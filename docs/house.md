# House tab: Home Assistant devices

With a Home Assistant URL, token and dashboard set on the frame, a **House** tab mirrors that HA
dashboard: its headings become groups, tiles become devices you can tap (lights, fans, switches,
locks, covers, scenes), thermostats get setpoint buttons, sensors show their values, markdown cards
(including the view header) are rendered live by HA, and cameras show a snapshot. Edit the dashboard
in HA and the frame follows within a second or two.

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
  ([frame.md → Security](frame.md#security)).

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

Each camera tile shows a snapshot. Pictures change when the tab opens, on **Refresh** by the
heading, on a tap, and on the schedule in **Settings → Home → Camera pictures** (every minute by
default, every 5 minutes, or off): the newest picture the camera's add-on already took, and at most
every 5 minutes a new one from a camera whose picture is older than that, since asking a battery
camera wakes it. New pictures load before they replace the old one, so nothing flashes.

Tap a camera for it full screen: live video over WebRTC when the camera offers it, otherwise the
picture refreshed every 15 seconds, with when it was taken ("picture taken 10:31:42 PM (25 s ago)").
It closes itself after two minutes. While video is arriving but hasn't shown yet (waiting for a
keyframe) the frame waits up to 30 seconds before retrying.

### Sharper Ring live video, and what the frame can decode

Through Home Assistant's Ring integration, a Ring camera streams at its native size. With
[ring-mqtt](https://github.com/tsightler/ring-mqtt), add a **Generic Camera** in Home Assistant for
a camera (Settings → Devices & Services → Add → Generic Camera) with its **Stream source** set to the
`stream_Source` address shown on that camera's ring-mqtt **Info** sensor
(`rtsp://…-ring-mqtt:8554/<id>_live`), and name its entity `camera.<name>_stream`, where `<name>`
matches the camera's `camera.<name>_live_view` or `_snapshot`. The House tab and the doorbell pop-up
then prefer the stream and fall back to Ring's live view without one, or when the stream doesn't
play within 30 s. The full-screen view's **Sound** button switches to Ring's live view (with sound)
and **Sharper** back.

**Try each camera on the frame before keeping it.** A picture wider than the frame's video decoder
handles arrives but never decodes: the frame's event log shows `camera.not_playing` with bytes but
0 frames. This frame's RK3326 decodes H.264 up to 1920 wide. Measured here: a Doorbell Pro 2 at
1536×1536 plays; a Floodlight Cam Pro and a Stick Up Cam play through ring-mqtt streams that come
through at 720p; a Spotlight Cam Pro doesn't play on either path, since Ring sends it at 2624×1472
(its "2K" video quality setting) or 1968×1104 (its "1080p"), ring-mqtt passes the camera's size
through, and Ring ignores the bandwidth and frame-size hints a viewer can put in its offer. Those
cameras use refreshing pictures instead; the fix would be transcoding before the frame (see
[ROADMAP.md](../ROADMAP.md)). Streams that don't play are best left disabled in HA (Settings →
Devices & Services → Generic Camera) so the frame doesn't wait on them.
