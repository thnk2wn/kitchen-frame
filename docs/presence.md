# Presence: when the clock screen comes on

The dashboard is most useful when it's simply there to glance at, so the frame tries not to hide it
behind the clock screen while people are around. This page explains how it decides, how to point it
at your motion sensors, and what to expect from different kinds of sensor.

**Needs:** nothing to start: without sensors the clock screen follows touches alone. Motion sensors
are optional and come through Home Assistant. Photos behind the clock are optional too: an iCloud
shared album (below); without one the clock shows on its own.

## Without sensors

Settings → **Clock screen after** sets how long the frame waits without a touch: 15 minutes,
30 (the default), 1 hour, 2 hours or never. Any tap brings the dashboard back. It never switches
while:

- a recipe is open (hands are busy, and the directions are what you're reading), or
- a timer is running.

## With motion sensors

If Home Assistant has motion sensors in the room, the frame can use them so that:

- the clock screen comes on only once **nobody has touched the frame and no sensor has seen
  anyone** for the chosen time, and
- the dashboard **comes back by itself** when a sensor sees someone, with no tap needed.

### Setup

1. In Home Assistant, put the room's sensors in an **area** (Settings → Areas), for example
   `kitchen`. A sensor counts if it, or the device it belongs to, is in that area.
2. Tell the frame the area: `PRESENCE_AREA="kitchen"` in `dashboard/.frame.vars`, then open the
   setup link from `scripts/frame-url.sh` on the frame (or add `?presence_area=kitchen` to the
   dashboard URL once). Use the area's id, as in its URL in HA.
3. Check Settings on the frame: under **Display → Clock screen after** it should say *Once no one's
   in the kitchen*, and **Home → Presence sensors** should list the area's sensors.

The frame uses the token you already gave it for Home Assistant; nothing else to configure.

### Which sensors count

Every `binary_sensor` in the area whose device class is **motion**, **occupancy** or **presence**,
except those left out in **Settings → Home → Presence sensors** (tap a sensor to leave it out or
bring it back). Occupancy sensors start left out: an ecobee room sensor, for one, stays "occupied"
for hours after the last motion, so it adds nothing beside a motion sensor. The frame's event log
records which sensor woke the dashboard (`screen.awake`) and what was seen last before the clock
screen came on (`screen.clock`).
Add, remove or move sensors between areas in Home Assistant and the frame follows within seconds;
there's nothing to change on the frame. Other sensors in the area (doors, windows, tamper switches)
are ignored.

To see what the frame sees, paste this into Home Assistant's Developer tools → Template:

```jinja
{% set ids = area_entities('kitchen') | select('match', 'binary_sensor\.') | list %}
{% set s = expand(ids) | selectattr('attributes.device_class', 'in', ['motion', 'occupancy', 'presence']) | list %}
{{ s | map(attribute='entity_id') | list }} on: {{ s | selectattr('state', 'eq', 'on') | map(attribute='entity_id') | list }}
```

### How it decides

- **A sensor turning on** is what counts as someone being there. It wakes the dashboard and restarts
  the countdown.
- **A sensor that stays on** counts only when it first turns on. Occupancy sensors often hold "on"
  for a long time, and a sensor with a flat battery can stick; neither can keep the clock screen
  away forever. In practice motion sensors re-trigger every few minutes while people are moving
  about, so a busy room keeps counting as busy.
- **A tap** counts too, as before.
- **Recipes and timers** still hold off the clock screen whatever the sensors say.

The frame gets sensor changes pushed over its Home Assistant connection (one subscription that HA
re-evaluates whenever any of the sensors changes), so there's no polling delay beyond the sensor's
own.

## Kinds of sensor

| Sensor | How it senses | Good for | Watch out for |
| --- | --- | --- | --- |
| Infrared motion (PIR), e.g. alarm-system motion detectors | Body heat moving across its view | Reliable, fast, re-triggers often while people move | Only sees where it's aimed; someone standing still may stop registering |
| Thermostat room sensors (e.g. ecobee) | Motion, often reported as occupancy | Already in many homes | Through HomeKit they report rarely and hold "on" for a long time: fine as an extra, poor as the only sensor |
| Smart speakers (e.g. Echo) | Ultrasound: an inaudible tone and its echo, like sonar | Covers the area right around the speaker, works in the dark | Doesn't reach HA directly (see below); stops when the microphones are muted |
| mmWave presence sensors | Radar; detects even breathing | Sees people sitting still | Needs careful placement to avoid neighbouring rooms |

Two or more kinds complement each other: a motion detector covering the doorway and a speaker on the
counter, say.

## Using an Echo's presence detection

Recent Echo devices sense presence by ultrasound and can run Alexa routines on it, but Home
Assistant's Alexa Devices integration polls Amazon and misses these brief detections. A routine can
push them to Home Assistant instead, with no delay:

1. **A toggle in HA:** Settings → Helpers → Create → Toggle, e.g. *Kitchen Echo presence*.
2. **A motion sensor that mirrors it, in the area:** Settings → Helpers → Create → Template →
   Binary sensor, state `{{ is_state('input_boolean.kitchen_echo_presence', 'on') }}`, device class
   **Motion**, area **Kitchen**.
3. **Reset after a minute**, so each detection is a fresh "turning on": an automation triggered by
   the toggle being on for 1 minute, that turns it off.
4. **Share only the toggle with Alexa** (Home Assistant Cloud): Settings → Voice assistants →
   Expose. Turn off *Expose new entities* for Alexa first, or every light, lock and switch will be
   shared too.
5. **Link Alexa to Home Assistant:** enable the Home Assistant skill (by Nabu Casa) in the Alexa app
   and sign in. In the newer Alexa+ app, type "go to skills page" into the Ask Alexa box to find
   skills. Let it discover devices; only the toggle should appear.
6. **An Alexa routine:** When the Echo detects presence → Smart Home → the toggle → On.

Walk past the Echo and the toggle should turn on within a second or two, and off again a minute
later.

## Limits

- Sensors detect movement, not people. Someone reading the screen without moving may not register,
  but any movement within the chosen time keeps the dashboard up.
- Without Home Assistant (or while it's unreachable) the frame falls back to taps only.
- Waking happens when a sensor reports; most report within a second or two.

## The clock screen, and Night

After a while untouched (Settings → Display → Clock screen after: 30 minutes by default, up to two
hours, or never) the frame shows a clock over the photo slideshow, and any tap brings the dashboard
back. Swipe right to left for the next photo, left to right for the one before (the last 20); a
swipe doesn't wake the dashboard, and the photo you picked stays its full 30 seconds. **Settings →
Display → Photo details** (off to start) puts when and where each photo was taken in its top
corner, small: "October 3, 2026 · Asheville, NC". The place comes only through the Mac bridge,
which looks it up on the Mac with Apple's geocoder: a place of interest when there is one ("Golden Gate
Park"), else the town. Close to what Photos shows, though not always the same (Photos has
its own place names it doesn't share). Only the name reaches the Worker, never coordinates, and
photos taken at home can say just "Home" ([mac-bridge.md](mac-bridge.md#photos-taken-at-home)). A
public album link gives the date alone.

**Videos** in the album play in the slideshow, muted, for the same 30 seconds as a photo (a shorter
one loops), when they come through the Mac bridge; **Settings → Display → Videos in the slideshow**
turns them off (their stills show instead). Each loads in the background while the slide before it
shows, and one that isn't ready in a minute shows its still that time. The Mac sends the first 30
seconds of the picture, without sound and not re-encoded: a shared album keeps videos at 720p H.264,
which the FRAME156 plays smoothly under the clock (measured: 0 dropped frames, ready in about a
second). Each such clip is about 12 MB of the Worker's storage (the free plan has 1 GB, room for
roughly 75 clips beside a few hundred photos), and a public album link gives only the stills. How
much is used shows under that setting and on the status page (Mac bridge → Storage), amber past
70% and red past 90%; past 100%, uploads fail and the status page says so. It never switches while a recipe is open or a timer is running. The clock's colour is chosen
in Settings → Display, and the slideshow uses an iCloud shared album (album videos show as a still).
With the [Mac bridge](mac-bridge.md), set `ALBUM_URL=bridge:<album name>`:
the Mac reads the album as you and uploads each photo sized for the screen (a landscape 1920 wide, a
portrait 960, as they show in pairs) about 15 seconds after iCloud brings it to the Mac (seconds
to a minute or two), checking every 10 minutes as well; photos taken out of the album are deleted
from the Worker. The frame picks them up on its next photo refresh (every 5 minutes while the
slideshow shows, and whenever it goes idle). The album then needs no public link: turn **Public Website**
off. Without a Mac, `ALBUM_URL` is the album's link with Public Website on (both link formats work),
which anyone holding it can open. The event log records each switch and why (`screen.clock`,
`screen.awake`).

**Night** (Settings → Display → Night, 10:30 PM to 6:30 AM by default, or off): the clock screen
comes on two minutes after the last touch, without photos, in red (Settings → Display → Night clock
color: red, orange, yellow or the daytime colour) and at the screen's lowest brightness, and motion
in the room doesn't bring the dashboard back. A tap does, at the daytime brightness, as do a timer
alert and the doorbell. The daytime brightness (Settings → Display → Brightness) comes back each
morning, and nothing is announced during these hours except red alerts, if they're set to speak at
night.
