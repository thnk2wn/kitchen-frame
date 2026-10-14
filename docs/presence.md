# Presence: when the clock screen comes on

The dashboard is most useful when it's simply there to glance at, so the frame tries not to hide it
behind the clock screen while people are around. This page explains how it decides, how to point it
at your motion sensors, and what to expect from different kinds of sensor.

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
3. Check Settings on the frame: under **Clock screen after** it should say *Once nobody has been
   seen in the kitchen (N sensors) this long*.

The frame uses the token you already gave it for Home Assistant; nothing else to configure.

### Which sensors count

Every `binary_sensor` in the area whose device class is **motion**, **occupancy** or **presence**.
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
