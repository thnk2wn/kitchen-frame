# Calendar

The Worker merges any number of calendar feeds (iCal links) into one agenda for the frame: Home's
Today and Upcoming, the Calendar tab's week and month, and the next event on the clock screen.

**Needs:** at least one calendar's iCal link (Google, Fastmail, Outlook, iCloud or a subscribed
schedule) in `CALENDAR_URLS`; without any, the calendar views are empty. The Mac bridge is optional,
and only for Apple calendars: to have their alerts announced, or to share them without a public
link.

## Getting a calendar's link

Each link is effectively a password: anyone with it can read that calendar. They go in
`CALENDAR_URLS` in `dashboard/.dev.vars` (separated by commas, spaces or new lines), and from there
to the Worker as a secret with `scripts/push-secrets.sh`; they're never in the repo or on the frame.

- **Google:** Settings → your calendar → *Integrate calendar* → **Secret address in iCal format**.
- **Apple (iCloud):** best through the Mac bridge, with no link at all (next section). Otherwise
  Calendar app → right-click the calendar → *Share Calendar* → **Public Calendar** → copy the
  `webcal://` link (used as-is). iCloud's public link leaves out every alert, so the frame can only
  announce its events at the default lead time.
- **Fastmail:** Settings → Calendars → the calendar's sharing settings → **Publish**, full details →
  copy the .ics link.
- **Outlook / Microsoft 365 (Exchange):** Outlook on the web → Settings → Calendar → Shared calendars
  → **Publish a calendar** ("Can view titles and locations") → copy the **ICS** link. Some
  organisations turn publishing off.
- **Subscribed calendars** (a sports team's schedule, school holidays): use the same .ics link you'd
  subscribe to on your phone. Some sports sites refuse anything that doesn't look like a browser;
  the Worker identifies itself as one, so these work.

### Apple calendars through the Mac

Optional, for iCloud calendars only: if you have the [Mac bridge](mac-bridge.md)
set up (or would set it up for this), put `bridge:<name>` in `CALENDAR_URLS` instead of a link, where
`<name>` is the calendar's name in Apple Calendar on that Mac (`bridge:Family`, say). A Google,
Fastmail or Outlook calendar doesn't need this: its link already includes its alerts, or the
service has none to give. The bridge reads the calendar as you, through Apple's EventKit, and sends its
events to the Worker whenever they change (and hourly), repeats already expanded:

- **Alerts come along.** In Apple Calendar an alert belongs to each person, not to the event, so a
  shared calendar's public link has none. The bridge sends yours, so the frame announces an event at
  each of them ([announcements](announcements.md#event-reminders)).
- **No public link.** Turn **Public Calendar** off, and there's no address left that reads the
  calendar. Sharing it with people directly isn't affected.
- **The Mac has to be on.** When it isn't, the frame keeps the last events it sent, and after 3 hours
  the status page says when the Mac last sent the calendar.
- The first time, macOS asks to give Kitchen Frame Bridge access to Calendar; click **Allow**
  (Full Access). It only reads, and only the calendars named here.

Names, colours and details below work the same, in the same position in the list.

## Settings

All optional, comma-separated, in the same order as `CALENDAR_URLS`:

| Setting | What it does |
| --- | --- |
| `CALENDAR_NAMES` | Names in the frame's **Calendars** list, when a feed's own name isn't useful (Exchange calls everything "Calendar"). |
| `CALENDAR_DETAILS` | `yes` for calendars whose events open with their details when tapped; others (unset or `no`) don't. See [Event details](#event-details). |
| `CALENDAR_REFRESH` | Hours between fetches of that feed (blank: every 10 minutes). For a feed that rarely changes, such as a season's game schedule, or a site that refuses a cloud server asking often. |
| `CALENDAR_COLORS` | Each calendar's colour, to match your phone say: `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `indigo`, `purple`, `pink`, `brown`, `gray`, or `#rrggbb`. Unset ones rotate through red, blue, green, purple, orange, teal. Named colours have light and dark versions that follow the frame's theme. |

On the frame, **Calendars** (on Home or the Calendar tab) shows or hides each calendar on that device;
the choice is remembered.

## Event details

Tapping an event on a calendar set to `yes` in `CALENDAR_DETAILS` opens a sheet with its calendar,
day and time, location and notes (the event's description). Those events show a › on Home; in the
week view a tap opens the sheet instead of just showing the end time. For example, with
`CALENDAR_URLS` holding a personal, a family, a work and a sports calendar:

```
CALENDAR_DETAILS="yes, yes, no, yes"
```

- **Notes are only kept for these calendars.** The Worker reads each feed in full (an iCal link
  has no way to leave descriptions out), but for other calendars it never takes the description out
  of the feed, so it isn't stored in KV, sent to the frame or cached there.
- **Cleaned up for a screen nobody can click:** links are removed (the kiosk can't open them), along
  with lines left with just a label ("Tickets:"), a first line that repeats the title, separator
  rules and HTML formatting. Notes are cut at 1,000 characters. A sports feed's "W 56-9 / TV: SEC
  Network" survives; its ticket and streaming links don't.
- A weekly event's notes are stored once, not per week.
- **A map** of the location shows beside the details when the place can be found: an address, or a
  named place like a stadium. The Worker looks it up with OpenStreetMap's Nominatim the first time
  that event is opened, searching near home first (`WEATHER_LAT`/`WEATHER_LON`) so "Aquatic center"
  finds the local one, and caches the answer in KV. Map tiles come from OpenStreetMap through the
  Worker's cache. Video calls and links are never looked up. This sends the location text (only) to
  OpenStreetMap's servers, and only for calendars set to open.
- Without `CALENDAR_DETAILS`, nothing opens and no notes are kept, as before.

Calendars you'd want behind a PIN (a work calendar, say) are best left at `no` for now; a frame in
the kitchen has no way to know who's tapping.

## Privacy

The frame shows each event's title, time and location, and notes only for calendars set to open
(above); never attendees.

To keep an event off the frame (a surprise, say), put `#private` in its title or notes, or mark it
Private in your calendar app. The Worker drops it before the frame ever sees it. It's still in the
published feed, so this hides it from the kitchen, not from anyone who has the link. A calendar
through the Mac bridge has no link; `#private` works there too.

To show an event but never say it out loud (an early gym session, say), put `#quiet` in its title or
notes. The frame takes the tag out of what it shows, skips the event's spoken reminders, and its
details say "Not announced (#quiet)".

## Refreshing and failures

A cron job fetches every feed into KV every 10 minutes (a calendar from the Mac bridge arrives
when it changes instead), and writes KV only when something changed (or
hourly, to show it's alive). The frame asks the Worker every 5 minutes; Settings → **Reload** pulls
fresh from the feeds right away. If one feed fails, its last good events stay up and the others carry
on, and that feed is tried again after 10 minutes, then 20, 40 and so on, up to 6 hours. The status
page shows it on the calendar's own row: amber while its last good copy is under two days old, red
after that.

The free Workers plan allows 10 ms of CPU per cron run (Workers Paid allows 30 s). Old one-off events
are skipped before parsing and long-running repeats are fast-forwarded, so a typical family calendar
fits; a very large one may need Paid.

## Tests

`npm test` (from `dashboard/`) includes the iCal parser, run against Google and iCloud fixtures in
`worker/fixtures/`.

## What it looks like

<img src="images/event-light.jpg" alt="An event's details: calendar, day and time, stadium, TV and radio notes, and a map of the stadium" width="640">

A Zoom, Teams or Meet link as a location shows as "Video call"; other links are dropped.
