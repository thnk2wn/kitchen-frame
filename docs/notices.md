# Notices from Home Assistant

<img src="images/notices-light.jpg" alt="Two notices under the clock on Home: a red garage freezer alert and a blue thermostat change" width="404" align="right">

**Needs:** Home Assistant on the frame, and automations of your own that post them (below, with
blueprints for common ones). Without HA there are simply none.

Short, glanceable notices that clear themselves: a banner in Home's left column (red, orange or
blue) and a line on the clock screen. The bell in the top bar counts the new ones (since you
last looked) that are still on, in the most urgent one's colour: one that has already cleared itself
needs no one, so it's listed under New but not counted. It opens the notices sheet: **New**, then **Earlier**, the
last 24 hours including notices that have ended (greyed, with "Cleared at 7:42 AM, after 14 min").
Each row starts with the time it came in. Dismiss (or Dismiss all) removes a notice in Home
Assistant for every screen. Red and (optionally) orange notices can also be said out loud: see
[announcements.md](announcements.md).

<br clear="right">

## Posting one from Home Assistant

The frame shows any HA persistent notification whose `notification_id` starts with `frame_`, so
everything device-specific stays in your Home Assistant automations, not in this repo:

- `persistent_notification.create` with `notification_id: frame_alert_freezer` (and a title and
  message) shows it; `persistent_notification.dismiss` with the same id removes it.
- `frame_alert_…` is red, `frame_info_…` blue, any other `frame_…` orange. Alerts sort first.
- HA's own notifications (repairs, new devices) don't start with `frame_` and stay off the frame.

For messages that should take over the screen (and be read aloud), use
[agent messages](messages.md) instead.

## Blueprints

Blueprints in [`homeassistant/blueprints/`](../homeassistant/blueprints/) make common ones a form to
fill in (Settings → Automations & Scenes → Blueprints → Import Blueprint, paste the file's GitHub URL):

- **Temperature too high** (`frame-temperature-high.yaml`): a temperature sensor above a limit for a
  while (a freezer, fridge or crawlspace), cleared once it's back below a second level. The time
  window keeps short spikes such as a freezer's defrost cycle from raising it.
- **Thermostat changed** (`frame-thermostat-changed.yaml`): someone changed a thermostat's mode or
  setpoint outside Home Assistant (at the wall, in its app, by voice), shown for a while as
  "Upstairs set to Auto, 70–75°". Changes made in HA (the frame, the HA app, automations) and
  schedule switches on the hour or half hour don't count, and clear an earlier notice.

Other notices this household runs as plain automations: washer running and done, dryer done, the
doorbell, a person at the front door, low batteries and filters, a water leak (red), and leak
sensors going offline.

## History

Home Assistant keeps no history of its notifications, so the frame reports each one to the Worker
as it ends and the Worker keeps it in KV. Blue info notices still on after a day are dismissed as
"Expired"; red and orange ones stay until dismissed or cleared. Optional Worker vars change this:
`NOTICES_KEEP_HOURS` (24), `NOTICES_KEEP_MAX` (50 at most) and `NOTICES_INFO_HOURS` (24, or 0 for
never). A notice that starts and ends while the frame is off isn't recorded.
