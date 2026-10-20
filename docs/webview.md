# WebView 138 on the frame

On 2026-10-20 the frame's system WebView went from the vendor's **106** (late 2022) to **138**, the last
one for Android 8.1. Tabs open about a quarter faster, and the frame got three years of security fixes.
This page covers why and how, and how to undo it. Credit to upstream
[PR #139](https://github.com/wesbos/photo-frame-dashboard/pull/139), which did the same on another
FRAME156 first.

## Why

- **Security.** 106 is missing roughly three years of Chromium fixes, including an image-decoding hole
  that was attacked in the wild in 2023 (WebP, fixed in 116). The frame shows images from YouTube, iCloud
  and recipe sites, so that's not theoretical.
- **Speed.** Measured in the kiosk (below): tab switches about 20–40% faster, and page loads quicker.
- **Room to grow.** Newer CSS and JavaScript work on the frame. The dashboard still sticks to what
  WebView 106 supports (CLAUDE.md), because other frames, upstream's included, may be on 106.

## Why it had to be a file swap

- Android here accepts only `com.android.webview` as the WebView (`dumpsys webviewupdate`), and the
  vendor's copy is a system app signed with the maker's key, so `adb install` of another build fails
  (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`).
- `/system` is plain ext4 with no dm-verity device, despite `androidboot.veritymode=enforcing` on the
  kernel command line ([frame.md](frame.md#identity-read-over-adb-2026-10-12)). With the frame's root,
  the files in `/system/app/webview` can be replaced, and Android picks the new build up at boot.
- 138 is the end of the line: LineageOS's 139 and later need Android 10 (minSdk 29).

## The build

LineageOS's `com.android.webview` **138.0.7204.63** for 32-bit ARM, a patched stable release, from
[`android_external_chromium-webview_prebuilt_arm` at `b2639126d02b`](https://github.com/LineageOS/android_external_chromium-webview_prebuilt_arm/commit/b2639126d02b401ae8a8a7f3ca302633713a12e6).
It's the same file upstream used, so the SHA-256s in [`kiosk/webview/new.sha256`](../kiosk/webview/new.sha256) match
[upstream's FRAME156 guide](https://github.com/wesbos/photo-frame-dashboard/blob/main/docs/pastigio-frame156.md).
GitHub serves only an LFS pointer; the file downloads from LineageOS's Gerrit, and the check stops on a
mismatch:

```sh
mkdir webview && cd webview   # anywhere outside the repo
href=$(curl -s -X POST -H "Accept: application/vnd.git-lfs+json" -H "Content-Type: application/vnd.git-lfs+json" \
  -d '{"operation":"download","transfers":["basic"],"objects":[{"oid":"b7268786318f404bdad53eaaec889619ff30100b935541a9e393e32efed3cf11","size":90257078}]}' \
  https://review.lineageos.org/LineageOS/android_external_chromium-webview_prebuilt_arm/info/lfs/objects/batch \
  | python3 -I -c 'import sys,json; print(json.load(sys.stdin)["objects"][0]["actions"]["download"]["href"])')
curl -sfL "$href" -o webview.apk   # a signed link, valid for 60 seconds
mkdir -p lib/arm && unzip -o -j webview.apk 'lib/armeabi-v7a/*' -d lib/arm
cp <repo>/kiosk/webview/new.sha256 . && shasum -a 256 -c new.sha256
```

Google's own build of the same version (`SystemWebView.apk` in the Chromium snapshot at position 1465706)
also fits, but it's the unpatched branch point `138.0.7204.0`, so LineageOS's is the better pick.

## Backups first

Keep these off the repo (they identify the device), somewhere that is itself backed up, and check each
against a SHA-256 taken on the frame:

| Backup | Why |
| --- | --- |
| The firmware: every eMMC partition except `userdata` | The last resort. This frame's was taken at its firmware reset ([frame.md](frame.md#found-reset-set-up-again-2026-10-14)) |
| `/system` just before the swap (below) | Restores `/system` exactly. Here it differed from the firmware backup only in ext4 bookkeeping (mount count, journal), not in any file |
| The stock `/system/app/webview` tree (`adb pull`), with its SHA-256s, ownership and SELinux labels | A quick undo that doesn't need the whole image |
| `/system` after the swap, with the 138 files used | Puts 138 back after a firmware reset without redoing the steps |

Imaging `/system` (`mmcblk2p11`, 1.5 GB, about 7 minutes over USB):

```sh
adb shell "su -c 'sha256sum /dev/block/mmcblk2p11'"
adb exec-out "su -c 'dd if=/dev/block/mmcblk2p11 bs=1048576 2>/dev/null | gzip -1 | base64'" \
  | tr -d '\r' | base64 -D > system.img.gz
gzip -dc system.img.gz | shasum -a 256   # must match the device's
```

## The swap

[`kiosk/webview/swap.sh`](../kiosk/webview/swap.sh) runs on the frame as root. It refuses to start
unless the staged files match `new.sha256` and the live tree is exactly the stock 106 recorded in
[`stock.sha256`](../kiosk/webview/stock.sha256) (the stock 106 files, hashed on the frame). It then
remounts `/system` read-write, builds the new tree beside the old one (root:root, 0755/0644,
`u:object_r:system_file:s0`), checks it, moves the stock tree to `/system/kf-stock-webview`, moves the
new one into place, checks both again, and remounts read-only. If any step fails it puts the stock tree
back. The only thing it deletes is its own half-built copy.

```sh
adb shell mkdir -p /data/local/tmp/kf-webview/lib/arm
adb push webview.apk <repo>/kiosk/webview/{new.sha256,stock.sha256,swap.sh,undo.sh} /data/local/tmp/kf-webview/
adb push lib/arm/. /data/local/tmp/kf-webview/lib/arm/
adb shell "su -c 'sh /data/local/tmp/kf-webview/swap.sh'"
adb reboot
```

The frame has no `awk`, so the scripts stick to `sha256sum`, `find`, `chcon` and plain `sh`.

**Checked after the reboot (2026-10-20):** the frame booted in about 15 s; `dumpsys webviewupdate` reports
`com.android.webview, 138.0.7204.63` at `/system/app/webview`; the kiosk came up on its own and the
dashboard renders as before. One logcat line is expected: `aw_component_update_service … No directory
found for component`, the WebView's component updater with no Play Store behind it.

## Undo

[`kiosk/webview/undo.sh`](../kiosk/webview/undo.sh) checks the kept stock tree against `stock.sha256`,
moves 138 aside to `/system/kf-138-webview` and the stock 106 back into place:

```sh
adb shell "su -c 'sh /data/local/tmp/kf-webview/undo.sh'" && adb reboot
```

If `/system/kf-stock-webview` is ever gone, push the stock tree back from the backup, or write
`system.img` back to `mmcblk2p11`. A broken WebView only blanks the kiosk: Android still boots and ADB
still works, so all of this can be done over USB. A firmware reset like 2026-10-14's would also put 106
back by itself; then run the swap again.

## Measured

With [`dashboard/scripts/bench/`](../dashboard/scripts/bench/README.md), in the kiosk, on the same data
and the same day. Tap → painted is from tapping a tab until the new tab's first frame is on screen.

| Tap → painted (median) | WebView 106 | WebView 138 (two runs) |
| --- | --- | --- |
| Home | 856 ms | 613 / 656 ms |
| Fitness | 477 ms | 333 / 351 ms |
| Calendar | 380 ms | 288 / 281 ms |
| Media | 355 ms | 282 / 298 ms |
| House | 333 ms | 200 / 217 ms |
| Lists | 165 ms | 116 / 94 ms |
| Recipes | 149 ms | 121 / 112 ms |
| All tabs | 355 ms | 282 / 265 ms |
| Frames late while switching (total) | 8.3 s | 6.0 / 5.7 s |

- **Loading** Home from scratch: 1.57 s → 1.12 s.
- **Idle screens and scrolling** were already at the panel's 50 frames a second on 106, and still are.
- **Memory** (the kiosk's total, as Android counts it) is about the same to 20 MB more: 204 → 182–224 MB
  after the switching test. The frame has 2 GB.

Before the swap, Chromium 106 and Chromium 138 were compared as ordinary browser apps (Google's Chromium
snapshots at positions 1036832 and 1465706, installed alongside and removed afterwards), to see the
engine's effect without touching `/system`. They showed the same direction: Home 920–1160 → ~735 ms,
Recipes scrolling 14 → 30–36 fps, with about 65 MB more memory for the browser's extra processes.

## What 138 changed: pictures from Home Assistant

The dashboard is `https` (the Worker) and Home Assistant is plain `http` on the home network. The
kiosk sets "allow mixed content", and WebView 106 honoured it for everything. **138 still allows
scripts' requests** (the Home Assistant WebSocket, `fetch()`, the camera relay's WebSocket), with a
console warning, **but blocks `http` images outright**. After the swap, House's camera thumbnails
showed as broken pictures, and the same applied to the full-screen camera's still, the doorbell
pop-up's snapshot, and album art in Now Playing, Media and TV. Live video was unaffected: Home
Assistant's is WebRTC set up over the WebSocket, and the relay's goes through its own WebSocket.

The fix, deployed the same day:

- **Dashboard:** `lib/ha-image.js` fetches each such picture and shows it from a blob URL
  (`<img {@attach haImage(url)}>`). It only does that for an `http` picture on an `https` page;
  anything else loads as before. The `<img>` still gets its `load` and `error` events.
- **Home Assistant:** a `fetch()` needs Home Assistant to allow the dashboard's origin, so
  `https://<worker>.workers.dev` was added to Settings → System → Network → **CORS allowed origins**
  (next to the default `https://cast.home-assistant.io`). Home Assistant restarts to apply it, then
  asks for a confirmation in its UI within 5 minutes, or it reverts. Note the list before changing it,
  to put it back. Setup for a new install:
  [house.md](house.md#setup).

If 138 is ever undone, both can stay: the fetch works on 106 too.

The Home Assistant WebSocket logs "Connecting to a non-secure WebSocket server from a secure origin is
deprecated" on 138. It still works on 138, the last WebView this frame can run, so it's a note, not a
problem. Serving Home Assistant over `https` on the home network would clear both warnings.

## What doesn't change

- The dashboard's build targets and CSS rules (`build.target: 'chrome106'`, no `color-mix()`, `:has()`
  and so on). They're for the upstream floor, not this frame.
- The kiosk app. It uses whatever system WebView there is.
