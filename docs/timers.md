# Timers

Start one from the timer button in the top bar: tap a time (it starts at once), then optionally a
name. The names default to Pasta, Bread, Veggies, Oven and Protein; set your own per frame with
`TIMER_NAMES` in `dashboard/.frame.vars` (or `?timer_names=` in a setup link). On a recipe page,
times in the steps are buttons that start a timer named after the recipe. Up to three can run; the
top bar on every screen shows one chip, the timer that ends next, with "+N" for the others. Timers survive a reload, and the clock screen never comes
on while one is running.

**Full screen**, to read from across the kitchen: a timer started from the top bar or through Alexa
opens it, and tapping the chip opens it again. One timer fills the screen; two or three share it in
columns, ending soonest first, each with +1 min and Cancel, and New timer below (a time, then a name). A timer that ends
turns red in its place, with +1 min and Dismiss. A timer named for food (Pasta, Bread, Chicken, Oven
and so on) has a faint picture of it in its corner, and in the chip. With Home Assistant, the bottom row picks the speaker that says when a timer is done (or
Frame only), the same choice as in Settings. It goes back to the chip with its button, or when the
last timer is dismissed or cancelled. A timer started from a recipe's steps stays in the chip, so the
recipe stays readable.

**By voice**, with the [Alexa skill](alexa.md): "Alexa, ask Kitchen Frame to start a 10 minute pasta
timer" (without a time, Alexa asks how long), "…to cancel the timer", "…to add a minute". The timer
runs on the frame, full screen, not on the Echo. With Alexa+ on, "timer" may go to Alexa's own timers
instead. The [phone app](../ios/README.md) starts, adds to and cancels them too, from its Remote or
through Siri ("Hey Siri, set a 10 minute Kitchen Frame timer").

When a timer ends: the frame chimes (Web Audio, no sound files), a full-screen alert offers +1 min
or Dismiss, and, with Home Assistant, a speaker announces it through a `notify` entity, such as an
Echo's "Announce" from the Alexa Devices integration (Settings → Announcements → Timer alerts; by
default the one with "kitchen" in its name). The kiosk app (1.4+) lets the page play sound without a tap first.

`?timer=Pasta:7` in the address starts one, for screenshots.
