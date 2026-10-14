# Our frame: Pastigio FRAME156 (15.6", Frameo)

Same model and firmware as Wes's unit, so
`reference/photo-frame-dashboard/docs/pastigio-frame156.md` applies directly. Serial number, MAC
and IP address are deliberately not recorded here.

## Identity (read over ADB, 2026-10-12)

| | |
| --- | --- |
| Model / firmware | Pastigio `FRAME156` · `FrameO.DP105F.v2026010414` |
| Android | 8.1.0 (API 27), security patch 2020-11-05, SELinux permissive |
| SoC / RAM | Rockchip RK3326, 32-bit userspace (`armeabi-v7a`) · 951 MB |
| Screen | 1920×1080 at 170 dpi (the dashboard was designed for 1280×800 and must be adapted) |
| WebView | 106.0.5249.126, already current, no swap needed |
| Root | `su -c id` returns uid 0 with no prompt. Any app on the frame can get root: install nothing untrusted |
| Home app | `net.frameo.frame` (Frameo) |
| Network ADB | off (nothing listening on 5555) |
| Clock | **No battery-backed clock** (`/dev/rtc0` missing). Every power-up starts at 2008-12-31 until Wi-Fi time sync, so the first HTTPS load fails with a certificate-date error. The kiosk retries until it loads (verified 2026-10-12 by setting the clock back). |

## Getting ADB working (what actually worked)

1. Frameo setting **Transfer from computer: off**. With it on, the frame shows up on USB for a moment,
   then Frameo takes the USB connection and ADB disappears before the approval prompt can appear.
2. Plug in by USB (it worked through an Apple USB-C Digital AV Multiport Adapter).
3. Open Frameo's Settings screen so the slideshow isn't in front, then re-request authorization
   from the Mac (`adb reconnect`) until "Allow USB debugging?" appears; tap Allow.
4. The USB link still drops for a few seconds now and then; retry commands rather than assuming failure.

## Changes made

| Date | Change | Command | Undo |
| --- | --- | --- | --- |
| 2026-10-12 | Vendor OTA updater off | `pm disable-user --user 0 com.muxintu.app.mxota` | `pm enable com.muxintu.app.mxota` |
| 2026-10-12 | Rockchip updater off | `pm disable-user --user 0 android.rockchip.update.service` | `pm enable android.rockchip.update.service` |
| 2026-10-12 | Kiosk installed (`com.huntsyea.frame`, now 1.3, built from `kiosk/`; 1.2 adds the brightness bridge `window.FrameKiosk`, 1.3 allows the https page to reach Home Assistant over plain http on the LAN) | `adb install -r kiosk/build/frame.apk`, URL set once with `am start … -d <dashboard url with ?key=>` | `adb uninstall com.huntsyea.frame` |
| 2026-10-12 | Frameo off | `pm disable-user --user 0 net.frameo.frame` | `pm enable net.frameo.frame` (photos and settings untouched) |
| 2026-10-12 | Kiosk made the Home app | `cmd package set-home-activity com.huntsyea.frame/.MainActivity` | `cmd package set-home-activity net.frameo.frame/.ui.activities.AWaitForDeferredInitCompleted` after re-enabling Frameo |

Nothing under `/system` or any flash partition has been written. No backup taken (owner's choice).

## Day-to-day

- Dashboard: `https://photo-frame-dashboard.<your-subdomain>.workers.dev/?key=<DASHBOARD_KEY>` (key in `dashboard/.prod.vars`, gitignored).
- Change the URL: `adb shell am start -n com.huntsyea.frame/.MainActivity -d '<url>'` (remembered across reboots).
- Escape hatch on the frame: hold two fingers still for 2 s → Reload dashboard / Android settings.
- Logs: `adb logcat -s FrameKiosk` shows loads, retries and SSL/network errors.
- Remote debugging (chrome://inspect) only while launched with `--ez debug true`; any normal launch turns it off.
- Brightness: Settings → Brightness calls `window.FrameKiosk.setBrightness(0.05–1)`; the kiosk saves it and applies it at start. `setBrightness(-1)` hands control back to Android's own setting.
- Demo mode (Settings): sample calendar and lists, no photos; ticks and additions stay on the frame and never reach Todoist.
- After a deploy, Cloudflare can take ~30 s to serve the new version everywhere; a frame that reloads sooner gets the old one until its next reload.

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
- **The current token belongs to an admin HA account (owner's choice, 2026-10-12).** Any app on this
  frame can get root, so anything that compromised the frame would have full control of Home Assistant.
  Recommended: create a non-admin "Kitchen Frame" user, put its token in `.frame.vars`, push it to the
  frame the same way, then delete the admin token in HA (Profile → Security).
- The Music tab only appears when a token is present. Removing `frame-ha-token` hides it again.
- The Worker's Spotify connection (every playlist, what's playing) is set up: `SPOTIFY_*` secrets,
  signed in 2026-10-14 with the playlists, recently played and currently playing permissions.
