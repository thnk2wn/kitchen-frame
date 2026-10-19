# Kitchen Frame for iPhone

A companion app for the frame:

- **Share to the frame:** in Photos (or anywhere), Share → **Kitchen Frame** shows a photo or video
  full screen on the frame until it's closed; a YouTube link plays there (alongside the YouTube
  Shortcut, which still works). The phone prepares it for the frame first: a photo at screen size, a
  video converted to H.264 at 960x540 and about 0.9 Mbit/s (the frame's Wi-Fi is slow), the first 3
  minutes. The Worker keeps it a day (`dashboard/worker/shared-media.js`).
- **Remote:** show any screen on the frame, start the slideshow, wake it, or close what's open, and see
  what the frame is displaying.
- **Ops:** the status page on the phone: is the frame online and what it's running, the health of the
  calendar, lists, Mac bridge and Paprika sync, the frame's event log, the Alexa log and recent notices,
  with a badge on the tab when something needs a look. It reads the same summary the status page does,
  with the key the app was paired with, so there's no GitHub sign-in.

It talks to the same Worker as the frame, with the same key, which it keeps in the iPhone's Keychain.

## Build and install

You need a Mac with Xcode (26 or later), an iPhone on iOS 26 or later, and
[XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

1. `cp ios/Config/Signing.example.xcconfig ios/Config/Signing.xcconfig` and fill in your team id and a
   bundle id prefix of your own. A free Apple ID works for your own phone (Xcode → Settings →
   Accounts adds it as a "Personal Team"), but apps signed that way stop opening after 7 days until
   you install them again. The Apple Developer Program ($99 a year) signs them for a year and adds
   TestFlight, for putting the app on other people's phones.
2. `cd ios && xcodegen && open KitchenFrame.xcodeproj`. The project is generated from `project.yml`
   and isn't committed; run `xcodegen` again after pulling changes.
3. Connect the iPhone, pick it as the run destination, and Run. The first time, the iPhone asks you to
   turn on Developer Mode (Settings → Privacy & Security) and, with a free account, to trust your
   developer certificate (Settings → General → VPN & Device Management).

## Pair it with the frame

On the frame, open Settings → About → **Pair a phone** (it asks for the unlock PIN when one is set).
Point the iPhone's Camera app at the QR code and tap the Kitchen Frame link. The code holds the
dashboard's address and key, so it hides itself after two minutes. Unpair from the app's Settings.

## How the pieces fit

| Part | Where |
| --- | --- |
| Remote | `POST /api/frame/command` (`show` with a `tab`, `slideshow`, `wake`, `close`), then `POST /api/frame/checkin` and `GET /api/frame/status` for what it shows |
| Ops | `GET /api/ops/summary` (`dashboard/worker/ops.js`), what needs attention as `dashboard/ops/page.html` decides it; `KitchenFrame/OpsView.swift` |
| Pairing | `kitchenframe://pair?url=…&key=…`, from the frame's Settings (`dashboard/src/components/Settings.svelte`); kept by `KitchenFrame/Pairing.swift` |
| Share extension | `Share/ShareViewController.swift`; preparing photos and videos in `KitchenFrame/MediaSender.swift`; `POST /api/share/media` (or `/api/share/play` for YouTube), shown by `dashboard/src/components/SharedMedia.svelte`. It reads the pairing from a Keychain group shared with the app (open the app once after updating so it moves there). |

Adding recipes from photos into Paprika is a separate app, since it's phone-to-Paprika and doesn't
need the frame.
