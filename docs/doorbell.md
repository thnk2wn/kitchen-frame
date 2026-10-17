# Doorbell pop-up

**Needs:** Home Assistant and a doorbell it knows about (any integration that gives an event entity
with device class `doorbell`). Without them there's no pop-up; nothing else changes.

With Home Assistant connected, a doorbell ring covers the screen (the clock screen too) with that
doorbell's camera for 90 seconds, or until Dismiss. It shows the camera's latest snapshot at once and
switches to live video when the camera streams over WebRTC (Ring does; Sound turns the audio on).
For a Ring doorbell with ring-mqtt's snapshot camera beside it, the frame also asks for a fresh
snapshot on each ring.
Rings are in the frame's event log (`doorbell.ring`).

Nothing to configure in the usual case: every event entity with device class `doorbell` (Ring,
Reolink, UniFi Protect, Nest and others provide one) is watched, and the camera is the one on the
same device. To override, set `DOORBELL` (entity ids, comma-separated, or `off`) and
`DOORBELL_CAMERA` in `dashboard/.frame.vars` (or `?doorbell=` / `?doorbell_camera=` in a setup link).
Settings → Home → Doorbell → Test shows the pop-up without anyone at the door.

Which video plays, and what the frame can decode, is the same as for the House tab's cameras: see
[house.md → Cameras](house.md#cameras).
