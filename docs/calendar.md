# Calendar

The Worker merges any number of calendar feeds (iCal links) into one agenda for the frame: Home's
Today and Upcoming, the Calendar tab's week and month, and the next event on the clock screen.

## Getting a calendar's link

Each link is effectively a password: anyone with it can read that calendar. They go in
`CALENDAR_URLS` in `dashboard/.dev.vars` (separated by commas, spaces or new lines), and from there
to the Worker as a secret with `scripts/push-secrets.sh`; they're never in the repo or on the frame.

- **Google:** Settings → your calendar → *Integrate calendar* → **Secret address in iCal format**.
- **Apple (iCloud):** Calendar app → right-click the calendar → *Share Calendar* → **Public
  Calendar** → copy the `webcal://` link (used as-is).
- **Fastmail:** Settings → Calendars → the calendar's sharing settings → **Publish**, full details →
  copy the .ics link.
- **Outlook / Microsoft 365 (Exchange):** Outlook on the web → Settings → Calendar → Shared calendars
  → **Publish a calendar** ("Can view titles and locations") → copy the **ICS** link. Some
  organisations turn publishing off.
- **Subscribed calendars** (a sports team's schedule, school holidays): use the same .ics link you'd
  subscribe to on your phone. Some sports sites refuse anything that doesn't look like a browser;
  the Worker identifies itself as one, so these work.

## Settings

All optional, comma-separated, in the same order as `CALENDAR_URLS`:

| Setting | What it does |
| --- | --- |
| `CALENDAR_NAMES` | Names in the frame's **Calendars** list, when a feed's own name isn't useful (Exchange calls everything "Calendar"). |
| `CALENDAR_DETAILS` | `yes` for calendars whose events open with their details when tapped; others (unset or `no`) don't. See [Event details](#event-details). |
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
published feed, so this hides it from the kitchen, not from anyone who has the link.

## Refreshing and failures

A cron job fetches every feed into KV every 10 minutes, and writes KV only when something changed (or
hourly, to show it's alive). The frame asks the Worker every 5 minutes; Settings → **Reload** pulls
fresh from the feeds right away. If one feed fails, its last good events stay up and the others carry
on.

The free Workers plan allows 10 ms of CPU per cron run (Workers Paid allows 30 s). Old one-off events
are skipped before parsing and long-running repeats are fast-forwarded, so a typical family calendar
fits; a very large one may need Paid.

## Tests

`npm test` (from `dashboard/`) includes the iCal parser, run against Google and iCloud fixtures in
`worker/fixtures/`.
