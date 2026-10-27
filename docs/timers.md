# Timers

Start one from the timer button in the top bar: tap a time (it starts at once), then optionally a
name. The names default to Pasta, Bread, Veggies, Oven and Protein; set your own per frame with
`TIMER_NAMES` in `dashboard/.frame.vars` (or `?timer_names=` in a setup link). On a recipe page,
times in the steps are buttons that start a timer named after the recipe. Up to three can run, in a
row along the bottom of every screen (below). Timers survive a reload, and the clock screen never comes
on while one is running.

**Full screen**, to read from across the kitchen: a timer started through Alexa or the phone
opens it (on Recipes, the row below), and the row's button opens it again. One timer fills the screen; two or three share it in
columns, ending soonest first, each with +1 min and Cancel, and New timer below (a time, then a name). A timer that ends
turns red in its place, with +1 min and Dismiss. A timer named for food (Pasta, Bread, Chicken, Oven
and so on) has a faint picture of it in its corner, and in the row. With Home Assistant, the bottom row picks the speaker that says when a timer is done (or
Frame only), the same choice as in Settings. It goes back to the row with its button, or closes when the
last timer is dismissed or cancelled.

**The row**: while timers run, they're a row along the bottom of every tab (not the clock screen):
a card each, with its picture, name, digits readable from the stove, progress, +1 min and cancel,
and a button for full screen (tapping a card opens it too). The tab above shrinks to make room. The timer button in the top bar
starts more, up to three, and they join the row. On Recipes, timers from Alexa or the phone join
the row too, rather than going full screen, so the recipe stays in view.

**By voice**, with the [Alexa skill](alexa.md#what-you-can-say), in one sentence: "Alexa, ask Kitchen Frame to start a 10 minute pasta
timer" (without a time, Alexa asks how long), "…to cancel the timer", "…to add a minute". The timer
runs on the frame, full screen, not on the Echo. With Alexa+ on, "timer" may go to Alexa's own timers
instead. The [phone app](../ios/README.md) starts, adds to and cancels them too, from its Timers tab (with Recents, the names and lengths used lately, which the Worker keeps) or
through Siri ("Hey Siri, Kitchen Frame 10 minute timer").

When a timer ends: the frame chimes (Web Audio, no sound files), a full-screen alert offers +1 min
or Dismiss, and, with Home Assistant, a speaker announces it through a `notify` entity, such as an
Echo's "Announce" from the Alexa Devices integration (Settings → Announcements → Timer alerts; by
default the one with "kitchen" in its name). The kiosk app (1.4+) lets the page play sound without a tap first.

`?timer=Pasta:7` in the address starts one, for screenshots.
