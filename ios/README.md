# Kitchen Frame for iPhone

A companion app for the frame:

- **Share to the frame:** in Photos (or anywhere), Share → **Kitchen Frame** shows a photo or video
  full screen on the frame until it's closed; a YouTube link plays there (alongside the YouTube
  Shortcut, which still works). The phone prepares it for the frame first: a photo at screen size, a
  video converted to H.264 at 960x540 and about 0.9 Mbit/s (the frame's Wi-Fi is slow), the first 3
  minutes. The Worker keeps it a day (`dashboard/worker/shared-media.js`).
- **Remote:** show any screen on the frame, start the slideshow, wake it, or close what's open, and see
  what the frame is displaying. **Screenshot** shows the frame's screen as it is right now, full screen
  (pinch to zoom, share): the frame's kiosk app (1.7+) captures it and the Worker keeps it 10 minutes
  (`dashboard/worker/screenshot.js`); the frame says "Screenshot sent to a phone" afterwards.
- **Timers** (on Remote): the frame's timers counting down, with +1 and cancel, and a name and a time
  to start one there, full screen. **Siri** too, with no setup: "Hey Siri, set a 10 minute Kitchen
  Frame timer", "start a pasta timer on Kitchen Frame" (Siri asks how long), "cancel the Kitchen Frame
  timer", "add a minute to the Kitchen Frame timer" (`FrameTimers.swift`). Apple's phrases take one
  detail each, so a length and a name together aren't one phrase. Like Remote, home Wi-Fi only.
- **Guest mode** (Settings) hides personal things on the frame (Fitness) while guests are over.
- **Apple Health:** Settings → Apple Health sends its owner's Activity rings, steps and recent workouts
  to the frame's [Fitness](../docs/fitness.md) tab, when the app opens and when Health has new data;
  average heart rate only if that switch is on. Each person shares from their own phone. It lists the
  day's sends, to see how fresh the frame is.
- **Ops:** the status page on the phone: is the frame online and what it's running, the health of the
  calendar, lists, Mac bridge, Paprika sync and each phone's fitness sends, the frame's event log, the Alexa log and recent notices,
  with a badge on the tab when something needs a look. It reads the same summary the status page does,
  with the key the app was paired with, so there's no GitHub sign-in.

It talks to the same Worker as the frame, with the same key, which it keeps in the iPhone's Keychain.

## Build and install

You need a Mac with Xcode (26 or later), an iPhone on iOS 26 or later, and
[XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

1. `cp ios/Config/Signing.example.xcconfig ios/Config/Signing.xcconfig` and fill in your team id and a
   bundle id prefix of your own. A free Apple ID works for your own phone (Xcode → Settings →
   Accounts adds it as a "Personal Team"), but apps signed that way stop opening after 7 days until
   you install them again. The Apple Developer Program ($99 a year) signs them for a year, which is
   also how to put the app on other people's phones (register each one, or use TestFlight). The app
   uses HealthKit for [Fitness](../docs/fitness.md); both kinds of account can sign it. After
   installing or updating, open the app once so Health can wake it in the background.
2. `cd ios && xcodegen && open KitchenFrame.xcodeproj`. The project is generated from `project.yml`
   and isn't committed; run `xcodegen` again after pulling changes.
3. Connect the iPhone, pick it as the run destination, and Run. The first time, the iPhone asks you to
   turn on Developer Mode (Settings → Privacy & Security) and, with a free account, to trust your
   developer certificate (Settings → General → VPN & Device Management).

## Pair it with the frame

On the frame, open Settings → About → **Pair a phone** (it asks for the unlock PIN when one is set).
Point the iPhone's Camera app at the QR code, tap the Kitchen Frame link, and confirm the frame's
address. The QR code holds the dashboard's address and a one-time code, good for 10 minutes and once;
the app trades it for a key of its own, which shows on the frame under Settings → About → Devices,
where a lost phone can be revoked. Pairing with a different frame turns fitness sharing off until it's
turned on again. Unpair from the app's Settings.

## How the pieces fit

| Part | Where |
| --- | --- |
| Remote | `POST /api/frame/command` (`show` with a `tab`, `slideshow`, `wake`, `close`, `timer` with an `action`), then `POST /api/frame/checkin` and `GET /api/frame/status` for what it shows |
| Screenshot | `POST /api/frame/screenshot/request`, then `GET /api/frame/screenshot?since=` until the frame's JPEG is there |
| Ops | `GET /api/ops/summary` (`dashboard/worker/ops.js`), what needs attention as `dashboard/ops/page.html` decides it; `KitchenFrame/OpsView.swift` |
| Pairing | `kitchenframe://pair?url=…&code=…`, a one-time code from the frame's Settings (`dashboard/src/components/Settings.svelte`), traded for this phone's own key (`POST /api/devices/claim`, `dashboard/worker/devices.js`); kept by `KitchenFrame/Pairing.swift` |
| Share extension | `Share/ShareViewController.swift`; preparing photos and videos in `KitchenFrame/MediaSender.swift`; `POST /api/share/media` (or `/api/share/play` for YouTube), shown by `dashboard/src/components/SharedMedia.svelte`. It reads the pairing from a Keychain group shared with the app (open the app once after updating so it moves there). |

Adding recipes from photos into Paprika is a separate app, since it's phone-to-Paprika and doesn't
need the frame.
