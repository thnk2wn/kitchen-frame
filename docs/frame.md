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
| Clock | **No battery-backed clock** (`/dev/rtc0` missing). Every power-up starts at 2008-12-31 until Wi-Fi time sync, so the first HTTPS load fails with a certificate-date error. The kiosk retries until it loads (verified 2026-10-12 by setting the clock back). |

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
| Kiosk 1.4 installed, URL set | `adb install -r kiosk/build/frame.apk`, then `am start … -d "'$(dashboard/scripts/frame-url.sh)'"` (dashboard key and HA settings) | `adb uninstall com.huntsyea.frame` |
| Kiosk made the Home app | `cmd package set-home-activity com.huntsyea.frame/.MainActivity`, plus **Always** on Android's "Select a Home app" dialog | as above |
| Frameo hidden for the user (not just disabled) | `pm uninstall -k --user 0 net.frameo.frame` (keeps its data) | `cmd package install-existing net.frameo.frame` |

**Wait before rebooting.** Android saves these package changes about 10 seconds after they're made.
Rebooting straight after `pm disable-user` or `pm uninstall --user 0` loses them, and Frameo was back
after the first two reboots for that reason, not because anything re-enables it. Wait 30 s (or check
`/data/system/users/0/package-restrictions.xml` with `su`), then reboot. Verified after a reboot:
boots into the kiosk, Frameo and the updaters not installed or running.

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
