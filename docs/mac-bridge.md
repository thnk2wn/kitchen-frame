# The Mac bridge

A small background app on a Mac at home (`bridge/mac/`) that reaches the Apple things a server
can't, or can only reach through a public link, and sends them to the Worker:

| Job | Turned on by (Worker settings) | Why through a Mac | Details |
| --- | --- | --- | --- |
| Apple Reminders lists, two-way | `GROCERIES_SOURCE` / `TODO_SOURCE` = `reminders` | Apple offers no web API for Reminders | [lists.md](lists.md#apple-reminders-through-a-mac) |
| iCloud calendars, with their alerts | `bridge:<name>` entries in `CALENDAR_URLS` | iCloud's public links leave out alerts, and are readable by anyone with the link | [calendar.md](calendar.md#apple-calendars-through-the-mac) |
| An iCloud shared album | `ALBUM_URL=bridge:<album name>` | the alternative is the album's public website | [presence.md](presence.md) |
| Apple Podcasts: the shows you follow and your listening | `PODCASTS=bridge` | Apple offers no API for a podcast library | [music.md](music.md#podcasts-apple-podcasts-through-the-mac) |

**Needs:** a Mac with macOS 13 or later that stays on at home, signed in to your Apple ID, and
`BRIDGE_TOKEN` on the Worker. **Only if you use one of the jobs above**: Todoist lists, Google,
Fastmail or Outlook calendars and a public album link all work without a Mac. Each job is separate,
chosen on the Worker; the bridge does only those, and macOS is asked only for the access they need
(Reminders, Calendar, Photos; Full Disk Access for Reminders' extras and Podcasts).

The camera relay is a different thing that can run on the same Mac ([house.md](house.md#cameras-the-frame-cant-decode-the-camera-relay)).

## How it works

```
iCloud ──▶ Reminders / Calendar / Photos on the Mac ──Apple's frameworks──▶ bridge app ──HTTPS──▶ Worker ──▶ frame
frame: tick, add (lists only) ──▶ Worker queue ──WebSocket──▶ bridge app ──EventKit──▶ Reminders ──iCloud──▶ everywhere
```

- **It reads as you**, through Apple's own frameworks (EventKit for Reminders and Calendar, the
  Photos framework for albums), using the Mac's existing iCloud sign-in. Your Apple ID and password
  never leave the Mac. It only reads, except the Reminders lists you chose, where it applies the
  frame's ticks and adds.
- **When it sends:** a list or calendar within seconds of a change and every 5 minutes anyway; an
  album about 15 seconds after iCloud brings a new photo to the Mac, and every 10 minutes. The frame
  never talks to the Mac; the Worker keeps the Mac's latest copies.
- **What travels:** list items (title, due date and time, priority, the first line of notes, an
  ID); calendar events in the frame's window (title, times, location, alerts, notes only for
  calendars set to show details); album photos sized for the screen, with when each was taken and
the town it was taken in (looked up on the Mac with Apple's geocoder; coordinates stay on the Mac);
for a video, also its first 30 seconds, picture only, for the slideshow.
- **When the Mac is off** the frame keeps the last copies and says so (lists after 30 minutes,
  calendars on the status page after 3 hours); list changes made on the frame wait, up to a week.
- **The status page** shows when the Mac last checked in and any problem it reports (a permission
  lost, a calendar or album not found, uploads failing), plus whether the camera relay on the same
  Mac is running.

## Setting it up

1. **Choose the jobs** on the Worker (the table above) and set `BRIDGE_TOKEN`: any long random
   string (`openssl rand -hex 24`), in `dashboard/.dev.vars`, then `scripts/push-secrets.sh`. It only
   opens the bridge's routes.
2. **iCloud on the Mac.** System Settings → your name → iCloud: turn on what the jobs need
   (Reminders, Calendars, and in Photos → Settings → iCloud, **Shared Albums**). Open the app once and
   check the lists, calendars or album are there. Lists others add to should be **shared** with them.
3. **Apple's command line tools** (the Swift compiler): in Terminal, `xcode-select --install`.
   Xcode itself isn't needed.
4. **Get the code.** `git clone https://github.com/thnk2wn/kitchen-frame.git ~/kitchen-frame` (or
   your fork).
5. **Install.** `~/kitchen-frame/bridge/mac/install.sh`
   - It asks for the Worker's address (`https://kitchen-frame.<you>.workers.dev`) and
     `BRIDGE_TOKEN`. Paste the token from `dashboard/.dev.vars` on the computer you deploy from.
   - It opens the bridge once so macOS asks for the access your jobs need: click **Allow** (Full
     Access) for each.
   - It prints what the Mac can see and confirms it reached the Worker, then starts the bridge in
     the background, now and at every login.
6. **Keep it running.** System Settings:
   - **Battery / Energy**: turn on *Prevent automatic sleeping when the display is off* (on a
     laptop, under Options, "on power adapter"), and *Start up automatically after a power failure*
     if offered. The display can still sleep.
   - **Users & Groups → Automatically log in as** you, so it comes back after a restart. This needs
     FileVault off; with FileVault on, the bridge resumes once someone logs in after a restart, and
     the frame says the Mac is quiet until then.
   - A laptop with its lid closed sleeps unless it's connected to a display, so leave the lid open.

**Check it:** `tail -f ~/Library/Logs/KitchenFrameBridge.log` on the Mac, and the status page's Mac
bridge section.

**Update** after pulling new code: `git -C ~/kitchen-frame pull && ~/kitchen-frame/bridge/mac/install.sh`.
Permissions carry over: the build signs the app with the same self-signed certificate every time
(made once on the Mac, in its own keychain under `~/Library/Application Support/KitchenFrameBridge/signing`),
and macOS knows an app by its identifier and certificate. Builds signed before that (ad hoc) were a
new app to macOS each time; the first build with the certificate asks once more.

### Photos taken at home

Optional: to show photos taken at home as "Home" rather than your street's place name, add your
home's position to the bridge's settings file on the Mac,
`~/Library/Application Support/KitchenFrameBridge/config.json`, beside the address and token:
`"home": {"lat": 35.0000, "lon": -78.0000, "radius": 150}` (metres; 150 if left out). Home
Assistant's home zone has the numbers (Settings → Areas & zones → Home). It's decided on the Mac and
never sent anywhere, so the Worker never learns where home is. The bridge reads it at start: run
`install.sh` again, or restart it.

**Remove:** `~/kitchen-frame/bridge/mac/uninstall.sh` (add `--all` to delete its settings too), and
switch the jobs back on the Worker (lists to `todoist`, calendars and the album to links).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `HTTP 401` in the log | The token doesn't match the Worker's `BRIDGE_TOKEN`: run `install.sh --reconfigure` and paste it again (without the quotes) |
| `Nothing is set to come from this Mac yet` | No job is turned on in the Worker's settings (the table above) |
| `No access to Reminders` / `Calendar` / `Photos` | System Settings → Privacy & Security → that category → Kitchen Frame Bridge on (Full Access), then run install.sh again |
| `No calendar named "…" on this Mac` | `bridge:<name>` in `CALENDAR_URLS` must match the calendar's name in Apple Calendar (`--check` lists them) |
| `No album named "…"` | The name in `ALBUM_URL` (`bridge:<name>`) must match the album, and Shared Albums must be on (Photos → Settings → iCloud) |
| Lists: "Waiting for the Mac", or other list problems | [lists.md → Troubleshooting](lists.md#troubleshooting) |
| "The Mac last checked in …" on the frame or status page | The Mac is asleep, off or logged out; see step 6 |
| Changes are slow to reach the frame | That's iCloud reaching the Mac; the bridge also checks on its own. Opening the app on the Mac nudges a stuck iCloud sync |
