# Roadmap

Ideas for the frame, roughly in order of interest. Nothing here is promised; what's built is in the
[README](README.md).

## On the hardware

The dashboard was built and tested in a browser at the frame's size. On a real frame:

- Measure with `?diag` (fps, jank, DOM count, image megapixels, heap) on each tab, especially
  Recipes, the slideshow and the event map.
- Doorbell live video over the frame's Wi-Fi (WebRTC from Home Assistant), and the chime.
- The on-screen keyboard in Lists and recipe search.
- Presence: the clock screen coming on and going away with real comings and goings.
- Real-world notices: a weather alert, a freezer warming, a thermostat change.

## Performance experiments

Thoughts to try in a branch and measure on the frame, not plans:

- **A newer browser engine.** The frame's WebView is 106 (late 2022). Checked 2026-10-15: it isn't
  updatable. The firmware accepts only `com.android.webview`, a system app signed with the
  maker's key, and `/system` is under dm-verity (enforcing), so swapping it means modifying
  verified system files. **But:** upstream PR #139 found another FRAME156 whose `/system` is plain
  ext4 despite `veritymode=enforcing`, and swapped in LineageOS's WebView 138 through `su` (keeping
  the stock tree for undo, restore untested). Check ours (`mount | grep ' /system '`, any
  `/dev/block/dm-*`) before ruling it out. Alternatives that leave `/system` alone: try the dashboard in a newer
  browser installed alongside (Firefox, or the last Chrome for Android 8) to see if it feels faster,
  and if it does, embed GeckoView (Firefox's engine, supports Android 8) in the kiosk app.
- **Native clock screen.** Draw the clock and slideshow, the screen shown most of the day, with
  Android views in the kiosk app, and hand over to the web dashboard on a touch. Others report native
  views feeling much smoother than a WebView on these frames. Go further (Recipes scrolling, say)
  only if it clearly feels better; a full native rewrite would give up CSS, instant deploys and
  desktop previews.
- **Linux instead of Android.** The frame's RK3326 is the chip in several handheld game consoles that
  run mainline Linux with an open GPU driver (Panfrost), so a current Chromium or WPE WebKit in a
  kiosk session is plausible, booted from microSD to leave Android on the eMMC untouched. The unknowns
  are this board's display panel, touch controller and Wi-Fi drivers, and hardware video decode for
  cameras. A hobby project, with a backup of the firmware first.

## Calendar and events

- **Commute time** on an event's details: "25 min with traffic · leave by 7:55". Google's Routes API
  is free within 5,000 traffic-aware requests a month (needs a billing account; cap requests per day
  to guarantee $0). Apple's Maps Server API is free within 25,000 calls a day but needs a paid
  developer membership. OSRM is free with no key but has no traffic.
- **Full-screen map:** tap the map preview for a larger one, with + and – buttons (no pinch on the
  frame).
- **Links as QR codes:** notes drop links because the kiosk can't open them; a QR code would let you
  open one on your phone (tickets, a video call, a sign-up form).
- **PIN for private calendars:** let a calendar's details open after a PIN, so work events can be
  read without being open to anyone in the kitchen.
- **Countdowns:** "12 days to the beach" for chosen events, on Home or the clock screen.
- **Two columns per day** in Upcoming when a day is busy.

## Lists

- **Aisles for Groceries, by AI:** group the grocery list into sections (Produce, Dairy, Spices…)
  like Reminders does on the iPhone, which Apple doesn't share with other apps. Ask a small model
  through Cloudflare Workers AI, which has a free daily allowance far beyond a household's list,
  once per new item, and remember the answer. No keyword lists.

## Announcements

Built: Settings → Announcements (speaker, volume, alert volume, agent messages, event reminders
by calendar, red and orange Home Assistant alerts) and `script.frame_announce`. Later:

- **Leave-by reminders** from travel time (with the commute idea under Calendar and events).
- **The washer reminder** moved onto the shared announce script, so all speech shares one volume routine.
- **Snooze a reminder from the frame:** dismissing "Washer done" could pause the spoken reminders until
  morning, or "remind me in 2 hours", rather than nothing; an hour's snooze was judged not worth it
  against a 30-minute repeat.

## Operations and security

- **Worker metrics** on it from Cloudflare's analytics API (a read-only API token as a secret).
- **A PIN for Settings:** unlocking has one (Settings → Home). Settings changes are logged and the
  last 10 versions kept, so a PIN there waits until a change slips by unnoticed.
- **Drop the old `?key=` URLs:** images and the messages socket now use the auth cookie; once the
  Worker's "key in URL" log lines stop, remove that fallback.

## Home Assistant

- **Live video from the 2K cameras, by transcoding.** The frame's RK3326 decodes H.264 up to 1920
  wide; Ring's Spotlight Cam Pro sends 2624×1472 ("2K") or 1968×1104 ("1080p") on every path, and
  Ring ignores the offer's bandwidth (`b=AS`) and frame-size (`max-fs`) hints (tried 2026-10-15).
  So those cameras fall back to pictures. The fix is shrinking the video before it reaches the frame:
  go2rtc with an `ffmpeg:…#video=h264#width=1280` stream, which wants hardware encoding. On the Pi 4
  that is marginal; an Intel N100/N150 box (QuickSync) running Home Assistant OS would do it at
  near-zero CPU, and would speed up everything else (docs/house.md has the measured sizes).
- **More notice blueprints:** garage door left open, a bedtime check (doors unlocked, lights on).
- **Pop-in for red alerts:** an alert notice briefly takes over the screen, like the doorbell,
  instead of only a banner.
- **Status line on Home:** a one-line summary (locks, doors, who's home) without opening the House tab.

## Screen and slideshow

- **Screen fully off at night**, through the kiosk app (backlight off), as an alternative to night
  mode's lowest brightness, for a frame in a bedroom.
- **Videos in the slideshow** (short clips from the shared album; needs a look at what the frame's
  CPU can decode).

## Access

- **Cloudflare Access with a custom domain**, so the dashboard sits behind a login rather than only
  the shared key.
