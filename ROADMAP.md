# Roadmap

Ideas for the frame, roughly in order of interest. Nothing here is promised; what's built is in the
[README](README.md).

## On the hardware

The dashboard was built and tested in a browser at the frame's size. On a real frame:

- Measure with `?diag` (fps, jank, DOM count, image megapixels, heap) on each tab, especially
  Recipes, the slideshow and the event map.
- The doorbell pop-up and chime on a real ring (live video itself was worked through on the frame
  2026-10-15/16: docs/house.md).
- The on-screen keyboard in Lists and recipe search.

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
- **Calendars chosen on the frame:** the Mac bridge can see every calendar the Mac has (accounts and
  subscriptions), so Settings could list them to pick and colour, instead of `CALENDAR_URLS`.
- **Countdowns:** "12 days to the beach" for chosen events, on Home or the clock screen.
- **Two columns per day** in Upcoming when a day is busy.

## Fitness

- **A "check your rings" nudge, opt in per person:** a frame notice in the evening (say 7 PM) when a
  ring is behind for the time of day, gone by itself once the ring closes or at 10 PM, never kept
  in the notices history. A setting on the phone (Settings → Apple Health), off by default; maybe
  spoken on one Echo instead, if a notice turns out too easy to ignore.
- **Another person's rings:** HealthKit only gives an app its phone owner's data, so
  the Kitchen Frame app on their phone, or a Shortcut posting the same numbers.
- **Who is asking Alexa:** with Alexa voice profiles, "how's my fitness" could answer for the
  speaker only, rather than everyone sharing.
- **Looked at, not planned: a Watch app for fresher rings.** A worn Watch is unlocked, so it could
  always read Health, but watchOS only gives a reliable budget (a few runs an hour) to an app with a
  complication on the face in use; in the background it's a handful a day. A complication slot and a
  watchOS app to keep, for rings sooner than about an hour, with nothing for it to show that Apple's
  Activity complication doesn't. The Fitness tab's Refresh covers "current now".

## Lists

- **Aisles for Groceries from Todoist, by AI:** group the list into sections (Produce, Dairy,
  Spices…). A Reminders list already brings its own sections through the Mac bridge (extras). Ask a small model
  through Cloudflare Workers AI, which has a free daily allowance far beyond a household's list,
  once per new item, and remember the answer. No keyword lists.

## Media

- **Progress back to the phone:** where an episode stops on the frame or an Echo stays here; the
  iPhone's Podcasts app doesn't hear of it (Apple has no way in).

## Announcements

Built: Settings → Announcements (speaker, volume, alert volume, agent messages, event reminders
by calendar, red and orange Home Assistant alerts) and `script.frame_announce`. Later:

- **Leave-by reminders** from travel time (with the commute idea under Calendar and events).
- **The washer reminder** moved onto the shared announce script, so all speech shares one volume routine.
- **Snooze a reminder from the frame:** dismissing "Washer done" could pause the spoken reminders until
  morning, or "remind me in 2 hours", rather than nothing; an hour's snooze was judged not worth it
  against a 30-minute repeat.

## Deploys and keeping the frame up

Since 2026-10-19 one part of the screen that fails shows a placeholder instead of taking the page
down (`components/Safe.svelte`), and the frame reloads itself if the page stops updating or keeps
erroring (`lib/watchdog.js`). Next:

- **Smoke test as a deploy gate:** `scripts/smoke.mjs` already opens every screen of a new build on
  the real data and in demo mode and fails on any error (it would have stopped the white frame of
  2026-10-19). Run it from `npm run deploy` before `wrangler deploy`, gated on its exit code, with a
  way around it for an emergency fix. Two things to fix first: `vite preview` (with the Cloudflare
  plugin) runs the Worker locally against an empty local KV, so "real data" isn't the live Worker's
  stored data (Fitness, notices, Paprika); and one run had 19 of 30 screens fail that passed on a
  rerun, so retry a failing screen once and print why it failed.
- **Roll back on its own:** after a deploy, if the frame hasn't checked in on the new build within a
  few minutes, `wrangler rollback` to the version before and say so.
- **Tell someone when the frame goes quiet:** a Home Assistant notification to a phone when the frame
  hasn't checked in for 15 minutes (the Ops tab's badge only shows when the app is open).
- **Pull requests for larger changes,** with an adversarial review (an agent looking for data that
  breaks it: out-of-order or repeated items, empty lists, missing fields) before merging. Small fixes
  and docs go straight to `main`.
- **CI/CD:** CI runs the tests and the build on every push and pull request. Add the smoke test in demo
  mode there (headless Chrome on the runner), and deploy from GitHub Actions on a merge to `main`
  (a Cloudflare API token as a repository secret) behind the same gate and rollback, so a deploy no
  longer depends on one laptop. A preview version per pull request (`wrangler versions upload`) to try
  on the frame before merging, if preview links work with the Worker's Durable Objects.
- **Tests for data the household produces:** the white frame came from real data no test had (a
  calendar from the Mac arriving after the others). Unit tests on lists built from such data, and keyed
  lists that can't repeat a key.

## Operations and security

- **Worker metrics** on it from Cloudflare's analytics API (a read-only API token as a secret).
- **A key per phone,** instead of the one dashboard key everything shares, so a lost phone can be cut
  off without re-pairing the rest, and only the frame can check in as the frame (today anyone with
  the key could, which is how a leaked key gets past the home-only check). Pairing would hand each
  phone its own key, listed (with when it was last used) and revocable in the frame's Settings.
- **A PIN for Settings:** unlocking has one (Settings → Home). Settings changes are logged and the
  last 10 versions kept, so a PIN there waits until a change slips by unnoticed.

## Home Assistant

- **The camera relay on Home Assistant's box.** Cameras too big for the frame now play through a
  relay on an always-on Mac (docs/house.md). An Intel N100/N150 box running Home Assistant OS could
  transcode with QuickSync instead, one less thing on the Mac, and speed up everything else.
- **More notice blueprints:** garage door left open, a bedtime check (doors unlocked, lights on).
- **Pop-in for red alerts:** an alert notice briefly takes over the screen, like the doorbell,
  instead of only a banner.
- **Status line on Home:** a one-line summary (locks, doors, who's home) without opening the House tab.

## Screen and slideshow

- **A way back to the dashboard from Android settings.** The frame has no navigation bar, so after
  opening Android's own settings (to change the volume, say) the only way back was a restart. A
  gesture or a button in the kiosk app that brings it to the front.
- **Screen fully off at night**, through the kiosk app (backlight off), as an alternative to night
  mode's lowest brightness, for a frame in a bedroom.

- **Room for more videos, when storage climbs** (Settings → Display and the status page show it;
  3% used on 2026-10-16). Options: a rotating set (the Mac sends, say, 30 videos and swaps a few
  each day; storage stays capped); Cloudflare R2 (10 GB free, needs a payment method on the
  account); or videos served from the Mac on the home network (nothing in the cloud, but only while
  the Mac is on).

## Access

- **Cloudflare Access with a custom domain**, so the dashboard sits behind a login rather than only
  the shared key.

## Docs

- **More on the feature pages.** The README split (2026-10-16) moved the detail into `docs/` with
  the text as it was; several pages would be clearer with a screenshot and a worked example (the
  House tab's setup, notices from a blueprint, announcements, the Media tab).
- **A page for the status page / frame check-in**, with a screenshot. The real page shows the
  household (calendar names, notices), so it needs a demo mode of its own (invented frame, backends
  and events, like the dashboard's `?demo=on`) or redaction before a screenshot.

