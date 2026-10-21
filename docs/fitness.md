# Fitness

Each person's Apple Watch Activity rings, steps and recent workouts on the frame: a **Fitness** tab,
their rings on Home, and "how's my fitness" through [Alexa](alexa.md); and, for anyone who turns it
on, their weight trend against a goal. Every person's own iPhone sends their numbers, through the
[iPhone app](../ios/README.md); nothing else from Health leaves the phone.

![Fitness](images/fitness-light.jpg)

## What it shows

- **Today:** the three rings and their numbers against the person's own goals, today's steps and
  distance, and a line on how the day is going against the time of day: on track, behind on a ring
  (in that ring's colour, which pulses for a few seconds as the tab opens and again every 5 minutes
  through the day), or all three closed (a check in the rings, and a small bounce as the tab opens).
- **The last 7 days** as small rings. Tap one for that day's numbers, steps and minutes of workouts.
- **Trends**, from the last 4 weeks: a streak (days in a row with Move closed, or all three), today's
  steps and exercise against the person's usual by this time of day, and how many days had a workout.
- **Recent workouts:** the latest 4 (the phone sends up to 5 from the last 2 weeks). Tap one for its
  details: time, distance, active and total calories, elevation gain, pace or speed, the effort the
  Watch recorded, the weather, and average heart rate if its owner chose to share it.
- **Weight** (opt in, per person): a chip in the trends, such as "↓ 1.6 lb/mo · 11.6 to go", and a tap
  for a sheet: the pace, what's left to the goal, the change from the year's peak with a progress bar
  from there to the goal, the last weigh-in, about when the goal comes at this pace, and a chart of the
  year's weigh-ins with a band around the goal (give or take 5) and the fitted trend.
- **Home:** each person's rings under the clock when notices and Now Playing leave room (with the three
  numbers, or a short status when it's tight), else small rings beside the date. Tap to open Fitness.

Each person shows "Watch data as of 8:20 AM": the newest reading their phone had from the Watch, which
is how current the rings are (a phone can send without anything new). Numbers a few hours old are
faded, so a phone that stopped sending never looks current. A send that came before the phone had the day's rings from the Watch (first thing in the
morning, from the iPhone's own steps) shows "Today's rings haven't come from the Watch yet" rather than
zeros.

## Set it up

1. Build the [iPhone app](../ios/README.md) with the HealthKit capability (in `ios/project.yml`; a free
   Apple account can sign it) and pair it with the frame.
2. In the app: **Settings → Apple Health**, type your name as the frame should show it, and turn on
   **Share Fitness on the frame**. Allow the Health access it asks for. **Average heart rate on
   workouts** is a separate switch, off until turned on.
3. Repeat on each person's phone. Up to six people.

Weight is a third switch there, **Share weight trend**, with a **Goal** (in pounds in the US, else
kilograms) and **Show my weight on the frame** (off). Any scale that saves to Health works (RENPHO,
Withings, a weight typed into Health). Without a goal nothing is sent.

### The weight trend

People weigh in every week or two at best, so the pace isn't the last two readings: it's a straight
line fitted through every weigh-in of the last 6 months, given only with at least 3 that cover at
least 3 weeks (`src/lib/weight.js`). With fewer, the sheet gives the change since the weigh-in before,
not a trend. Under half a pound (or kilo) a month either way is "steady". "At this pace" appears only
when the trend heads toward the goal from at least 4 weigh-ins, and not when it's over 2 years out. A
last weigh-in more than 3 weeks old says so. A goal worth aiming for is between the person and their
doctor; the frame only measures against the one set.

The Fitness tab appears once someone shares (or in demo mode). Turning sharing off removes that
person from the frame at once; turning it back on shows them again within seconds.

## How fresh it is

The phone sends when the app opens, as soon as Health saves a workout, and when Health has new ring
data, which iOS allows at most hourly and only while the phone has been unlocked since. A phone that
was just locked all evening catches up when it's next used. Settings → Apple Health on the phone lists
the day's sends and why; the status page and the app's Ops tab show each person's last send, amber
after 12 hours and red after 36.

After the app is installed or updated, open it once: iOS doesn't wake an app in the background until
it has run.

### Refresh

With Home Assistant and its Companion app on each phone, each person on the Fitness tab has a
**Refresh**: it sends a notification to their phone, and tapping it opens Kitchen Frame, which sends
at once (the tap matters: a locked phone can't read Health in the background). The frame updates as
soon as the send arrives. Add [`script.frame_fitness_refresh`](../homeassistant/scripts/frame-fitness-refresh.yaml)
with a branch per person; Refresh shows only once that script exists. After asking, the frame says
"Asked …" and won't ask that phone again for 10 minutes unless it answers.

## Guest mode

Hides personal things on the frame while guests are over; for now, Fitness: no tab, no rings on Home,
and Alexa won't read it. Turn it on from the frame (Settings → Display → Guest mode), the app's **Settings**, or Alexa ("we
have guests"); turn it off from the frame (which asks for the unlock PIN when one is set) or the app.
Not by voice: anyone in the kitchen can talk to an Echo. It stays on until turned off. While it's on, the Worker sends nobody's fitness
to the frame at all.

## Privacy

What a phone sends: the last 4 weeks of daily ring totals and goals, each day's steps and minutes of
workouts, today's steps and walking distance, and the last 5 workouts of the last 2 weeks (type,
start, length, calories, distance, climb, effort, the weather recorded with it, and average heart rate
only when that switch is on). No routes, places, heart-rate samples or anything else from Health.

Weight, only with **Share weight trend** on and a goal set: the last year's weigh-ins (the last of
each day) as the difference from the goal, such as "+11.8", never the weight itself. So the frame can
show the pace and what's left, but not a weight, unless **Show my weight** is also on, which sends the
goal (and the person's height, for BMI). With a PIN of their own (the app's Settings → PIN), the
weight, goal weight, BMI and body fat stay hidden on the frame until that person's PIN is entered
(**Show weight** on the sheet), and hide again when it closes. Turning weight off removes it from the
frame on the next send. Weight never goes to Alexa, its model or the status page, and guest mode hides it with the rest
of Fitness.

The Worker keeps each phone's latest report as one KV entry (by a random id the phone makes, not the
typed name), behind the dashboard key, and replaces it on every send. Turning sharing off or unpairing
deletes it, and one that hasn't been sent for 14 days (a phone unpaired offline, the app deleted) goes
by itself. Alexa's spoken summary is worded by an open-weight model on Cloudflare's Workers AI from
these numbers (names, rings, steps, streaks, the latest workouts; no heart rate), cached for half an
hour; without the model, the same facts are read out plainly. The Alexa log on the status page notes
that a summary was given, not what it said.

## How it works

| Part | Where |
| --- | --- |
| Reading Health, sending | `ios/KitchenFrame/Fitness.swift` (HealthKit; background delivery wakes it for new data) |
| Storing | `dashboard/worker/fitness.js`: `GET`, `POST`, `DELETE /api/fitness` |
| Guest mode | `dashboard/worker/guest.js`, kept in the message room (`messages.js`) so a change reaches the frame at once |
| The tab and Home | `dashboard/src/views/Fitness.svelte`, `components/HomeRings.svelte`, `Rings.svelte`, `WorkoutSheet.svelte`; the numbers in `src/lib/fitness.js` |
| Alexa | `dashboard/worker/fitness-speech.js` |

Screenshots: `?tab=fitness` in demo mode, `&workout=<n>` opens a workout, `&fitnessday=<n>` a day's
numbers.
