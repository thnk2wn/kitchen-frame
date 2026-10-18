# Kitchen Frame for iPhone

A companion app for the frame. For now it's a **remote**: show any screen on the frame, start the
slideshow, wake it, or close what's open, and see what the frame is displaying. More frame-specific
things can join it (the lists, notices, sharing a video to the frame from the share sheet).

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
| Pairing | `kitchenframe://pair?url=…&key=…`, from the frame's Settings (`dashboard/src/components/Settings.svelte`); kept by `KitchenFrame/Pairing.swift` |

Adding recipes from photos into Paprika is a separate app, since it's phone-to-Paprika and doesn't
need the frame.
