# Roadmap

Ideas for the frame, roughly in order of interest. Nothing here is promised; what's built is in the
[README](README.md).

## On the hardware

The dashboard was built and tested in a browser at the frame's size. On a real frame:

- Measure with `?diag` (fps, jank, DOM count, image megapixels, heap) on each tab, especially
  Recipes, the slideshow and the event map.
- Doorbell live video over the frame's Wi-Fi (WebRTC from Home Assistant), and the chime.
- The on-screen keyboard in Lists and recipe search.
- Presence: the clock screen coming on and going away with real comings and goings.
- Real-world notices: a weather alert, a freezer warming, a thermostat change.

## Calendar and events

- **Commute time** on an event's details: "25 min with traffic · leave by 7:55". Google's Routes API
  is free within 5,000 traffic-aware requests a month (needs a billing account; cap requests per day
  to guarantee $0). Apple's Maps Server API is free within 25,000 calls a day but needs a paid
  developer membership. OSRM is free with no key but has no traffic.
- **Full-screen map:** tap the map preview for a larger one, with + and – buttons (no pinch on the
  frame).
- **Links as QR codes:** notes drop links because the kiosk can't open them; a QR code would let you
  open one on your phone (tickets, a video call, a sign-up form).
- **PIN for private calendars:** let a calendar's details open after a PIN, so work events can be
  read without being open to anyone in the kitchen.
- **Countdowns:** "12 days to the beach" for chosen events, on Home or the clock screen.
- **Two columns per day** in Upcoming when a day is busy.

## Home Assistant

- **More notice blueprints:** garage door left open, a bedtime check (doors unlocked, lights on).
- **Pop-in for red alerts:** an alert notice briefly takes over the screen, like the doorbell,
  instead of only a banner.
- **Status line on Home:** a one-line summary (locks, doors, who's home) without opening the House tab.

## Screen and slideshow

- **Screen off at night**, through the kiosk app, rather than only dimming.
- **Videos in the slideshow** (short clips from the shared album; needs a look at what the frame's
  CPU can decode).

## Access

- **Cloudflare Access with a custom domain**, so the dashboard sits behind a login rather than only
  the shared key.
