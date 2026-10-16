# Timers

Start one from the timer button in the top bar: tap a time (it starts at once), then optionally a
name. The names default to Pasta, Bread, Veggies, Oven and Protein; set your own per frame with
`TIMER_NAMES` in `dashboard/.frame.vars` (or `?timer_names=` in a setup link). On a recipe page,
times in the steps are buttons that start a timer named after the recipe. Up to three can run; the
top bar on every screen shows one chip, the timer that ends next, with "+N" for the others (tap it
to see them all, add a minute or cancel). Timers survive a reload, and the clock screen never comes
on while one is running.

When a timer ends: the frame chimes (Web Audio, no sound files), a full-screen alert offers +1 min
or Dismiss, and, with Home Assistant, a speaker announces it through a `notify` entity, such as an
Echo's "Announce" from the Alexa Devices integration (Settings → Announcements → Timer alerts; by
default the one with "kitchen" in its name). The frame has no microphone, so voice timers stay with
your smart speakers. The kiosk app (1.4+) lets the page play sound without a tap first.

`?timer=Pasta:7` in the address starts one, for screenshots.
