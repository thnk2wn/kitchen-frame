# Lists: Todoist or Apple Reminders

The frame has two lists, **Groceries** and **Tasks** (on Home and the Lists tab). Each one comes
from either **Todoist** or **Apple Reminders**, chosen per list. Groceries could come from Reminders
while Tasks stays in Todoist, say.

**Needs:** a Todoist account and its API token (the default), or, for a list kept in Apple
Reminders, a Mac at home running the [Mac bridge](mac-bridge.md). Todoist needs nothing on a Mac. With neither set up,
the lists say Todoist isn't connected.

| | Todoist (default) | Apple Reminders, through a Mac |
| --- | --- | --- |
| Where you keep the list | The Todoist app | The Reminders app, as you do now |
| Adding by voice | "Hey Siri" can't add straight to a Todoist project in one sentence (see [Voice](#adding-by-voice-with-todoist)) | "Hey Siri, add milk to my Groceries list", from a phone, watch, CarPlay or HomePod |
| On the frame | Two-way, live | Two-way, within seconds |
| Sections and assignees on the board | Yes | Only with [extras](#extras-sections-flags-and-assignees) (EventKit, Apple's Reminders API, doesn't expose them) |
| Priority and due time | Yes | Yes |
| Flags | No (Todoist has none) | Only with [extras](#extras-sections-flags-and-assignees), shown but not set from the frame |
| Needs | A Todoist account and API token | A Mac at home that stays on, signed in to iCloud |
| If the thing in the middle is off | Nothing in the middle | The frame shows the last copy and says so; changes made on the frame wait and are applied when the Mac is back |
| Setup | One token | A Mac app, a token, a few Mac settings |

Apple doesn't let servers reach Reminders. Since iOS 13 they aren't on CalDAV, and there's no
web API. A Mac signed in to iCloud can read and change them through Apple's own EventKit, which is
what the bridge here uses. Everything else is a workaround, compared [below](#other-ways-and-why-not).

## Todoist

Set `TODOIST_TOKEN` (Todoist → Settings → Integrations → Developer). The frame uses the projects
named in `TODOIST_GROCERY_PROJECT` and `TODOIST_TODO_PROJECT` (in `wrangler.jsonc`; "Groceries" and
"To-do" by default). Sections become the board's columns and shared projects show who an item is
assigned to.

On the iPhone app, **Settings → General → Home view** can open straight to Groceries, and the
navigation bar can be reordered (Browse first).

### Adding by voice with Todoist

Todoist's own Siri support adds to the Inbox. Two ways to reach a project:

- **A Shortcut per list**: *Dictate Text* → Todoist *Add task* (project: Groceries), named "Add
  groceries". "Hey Siri, add groceries", then Siri asks what. Two steps, and it needs Todoist
  signed in on each phone.
- **Reminders as an inbox**: say "add milk to my Groceries list" as usual; a Shortcut on one iPhone
  moves new items from that Reminders list into the Todoist project and marks them done in
  Reminders. One sentence, works from the watch. Build it as: *Find Reminders* (List is Groceries,
  Is Not Completed) → *Repeat with each* → Todoist *Add task* (Repeat Item, project Groceries) →
  *Set Reminder Details* (Is Completed: on) → *End Repeat*. Run it from Automations, set to **Run
  Immediately**, when Todoist is opened, when Reminders is closed and when you arrive home. Give
  Shortcuts **Full Access** to Reminders (Settings → Privacy & Security → Reminders); without it,
  you get `com.apple.reminderkit error -1`. The move is one way: once moved, the item lives in
  Todoist, and Reminders is only for capture.

## Apple Reminders, through a Mac

Only for lists kept in Apple Reminders; skip this section if you use Todoist. It uses the
[Mac bridge](mac-bridge.md), a small app on a Mac at home; that page covers installing it, keeping
it running and its other, separate jobs (iCloud calendars and a shared album).

```
Siri / iPhone / Watch ──iCloud──▶ Reminders on the Mac ──EventKit──▶ bridge app ──HTTPS──▶ Worker ──▶ frame
frame: tick, add ──▶ Worker queue ──WebSocket──▶ bridge app ──EventKit──▶ Reminders ──iCloud──▶ everywhere
```

- **The bridge app** (`bridge/mac/`) runs in the background on the Mac. When a chosen list
  changes, it sends the list to the Worker within a couple of seconds. The Worker pushes the
  frame's changes to it over a WebSocket, and it applies them to Reminders, so a tick on the frame
  shows on your phone and watch a few seconds later.
- **The Worker** keeps the Mac's latest copy and a queue of the frame's changes (a Durable Object,
  `worker/bridge.js`). The frame never talks to the Mac.
- **Only the lists you name** are read or changed. Timed and location reminders in other lists are
  never touched.
- **What travels**: each item's title, due date and time, priority and the first line of its notes,
  and an ID.

### What happens when

| You do this | Result |
| --- | --- |
| Add, edit or delete in Reminders (Siri, phone, watch, anyone on a shared list) | On the frame within seconds (iCloud reaches the Mac, the Mac sends the list) |
| Tick an item's circle on the frame | Gone from the frame at once, with **Undo** for 8 seconds; ticked in Reminders a few seconds after that |
| Tap an item's text on the frame | Its sheet: change the title or priority (in Reminders within seconds), or Complete |
| Add on the frame (+ Add, or a recipe's "Add to Groceries") | On the frame at once; created in Reminders within seconds, with "For: …" in its notes for recipe items |
| Tick on the frame something that hasn't reached Reminders yet | The add is cancelled; it never reaches Reminders |
| The same item changed on the frame and in Reminders at once | Reminders wins; the frame catches up on the Mac's next send |
| Two items with the same name | Fine: items are matched by ID, not by name |
| Mac asleep, off, or iCloud stalled | The frame keeps the last copy and, after 30 minutes without the Mac checking in, says when it last did. Frame changes wait (up to a week) and are applied when it's back |
| Priority, due time | Shown: `!!!`, `!!` or `!` before the title, and "Today 4 PM" (red once past) |
| Add a task on the frame with a priority | Tap `!` beside the field to cycle none → ! → !! → !!!; set in Reminders as Low, Medium or High |
| Sections, flags, assignees | Not shown, unless [extras](#extras-sections-flags-and-assignees) are on |
| Subtasks, tags, images | Not shown (EventKit doesn't expose them); subtasks show as ordinary items |

Order on the frame: Groceries in the order items were added; Tasks with dated items first (soonest
at the top; within a day, untimed then by time), then the rest in the order added. Reminders' own
manual order isn't available to EventKit; its grocery aisles are, with
[extras](#extras-sections-flags-and-assignees). Each list can also be shown A–Z: the small sort
button by the list's name on Home, or beside **Add** on the Lists tab, switches between as added (a
clock) and A–Z (remembered per list, on that frame).

### Settings

In `dashboard/.dev.vars`, then `scripts/push-secrets.sh`:

| Setting | |
| --- | --- |
| `GROCERIES_SOURCE`, `TODO_SOURCE` | `reminders` to use the Mac for that list; anything else (or unset) means Todoist |
| `REMINDERS_GROCERIES_LIST`, `REMINDERS_TODO_LIST` | The Reminders list's name, as in the Reminders app (defaults "Groceries" and "To Do") |

The Mac asks the Worker which lists to sync (every 5 minutes), so changing these needs no change on the
Mac. [Set up the Mac bridge](mac-bridge.md#setting-it-up) first; until the Mac has sent the list,
the frame shows "Waiting for the Mac".

**Check it**: add something with Siri, and it's in the bridge's log
(`~/Library/Logs/KitchenFrameBridge.log`) and on the frame within seconds. Tick it on the frame:
"Completed …" in the log, and ticked on your phone.

### Extras: sections, flags and assignees

EventKit leaves out sections (such as the aisles of the Reminders grocery template), flags and who a
shared reminder is assigned to. The Reminders app keeps them in its own database on the Mac, and the
bridge can read them from there. It only reads: every change still goes through EventKit.

1. On the Mac: System Settings → Privacy & Security → **Full Disk Access** → **+** → choose
   `~/Applications/KitchenFrameBridge.app` and turn it on. It stays on across updates
   ([mac-bridge.md](mac-bridge.md)).
2. Set `REMINDERS_EXTRAS=on` in `.dev.vars` and run `scripts/push-secrets.sh`. The Mac picks it up
   within 5 minutes; its log says "Extras on".

On the frame: Groceries on the Lists tab is grouped by aisle, flagged items get an orange flag, and
assigned tasks show the person's initials. Flags and assignees can't be changed from the frame.

This database isn't an Apple API. If a macOS update changes it, the log says so once and the frame
goes back to plain lists until the bridge is fixed; nothing else stops working.

### Troubleshooting

The Mac bridge's own problems (the token, permissions, the Mac asleep) are in
[mac-bridge.md → Troubleshooting](mac-bridge.md#troubleshooting).

| Symptom | Fix |
| --- | --- |
| "Waiting for the Mac to send this Reminders list" | The bridge isn't running or can't reach the Worker: check the log, and that `BRIDGE_TOKEN` matches on both sides |
| `--check` lists only "Reminders" | The Mac isn't showing your iCloud lists: turn on iCloud → Reminders, open the Reminders app until your lists appear, then run `install.sh` again |
| `No Reminders list named "…"` in the log | The name in `REMINDERS_…_LIST` must match the list in Reminders (case doesn't matter) |
| `Extras: can't read the Reminders database` | Full Disk Access for Kitchen Frame Bridge is off; see [extras](#extras-sections-flags-and-assignees) |
| Changes from the phone are slow to reach the frame | That's iCloud reaching the Mac; the bridge also checks every 5 minutes. Opening Reminders on the Mac nudges a stuck iCloud sync |

## Other ways, and why not

| | Why not (or when) |
| --- | --- |
| **Reminders → Todoist with an iPhone Shortcut** | Good if you keep the list in Todoist and only want Siri capture: see [Adding by voice](#adding-by-voice-with-todoist). One way only |
| **Mirroring Reminders to the frame from an iPhone Shortcut** | No Mac needed, but it runs only as often as iOS automations fire (minutes to hours), can only match items by name, and stops when the phone is off |
| **IFTTT (iOS Reminders → Todoist)** | Hourly on the free plan (two applets), five minutes on Pro, through the IFTTT app; copies items without completing them, so the two lists drift |
| **Logging in to iCloud.com unofficially** | Needs the Apple ID password and repeated two-factor approval, and breaks when Apple changes the site |
