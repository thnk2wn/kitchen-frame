# homeassistant

Pieces to import into your Home Assistant. **Only if** you use Home Assistant with the frame; each
is optional.

| File | What it's for | Details |
| --- | --- | --- |
| `scripts/frame-announce.yaml` | `script.frame_announce`: says something on a speaker at a set volume and puts the speaker's own volume back afterwards. The frame's announcements use it when it's there | [docs/announcements.md](../docs/announcements.md) |
| `scripts/frame-fitness-refresh.yaml` | `script.frame_fitness_refresh`: notifies a person's iPhone (Companion app) to send their latest rings; tapping it opens Kitchen Frame, which sends. The Fitness tab's Refresh uses it when it's there | [docs/fitness.md](../docs/fitness.md) |
| `blueprints/frame-temperature-high.yaml` | A notice on the frame when a temperature goes past a limit (a freezer warming, say) | [docs/notices.md](../docs/notices.md) |
| `blueprints/frame-thermostat-changed.yaml` | A notice when someone changes a thermostat | [docs/notices.md](../docs/notices.md) |

Import a blueprint from Settings → Automations & Scenes → Blueprints, and a script by pasting it into
a new script's YAML.
