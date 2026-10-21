#!/bin/bash
# Prints the one-time setup URL for a frame or browser: the dashboard address with its key and the
# Home Assistant settings from the gitignored .frame.vars (HA_URL: HA's LAN address, http://<ip>:8123; HA_TOKEN; HA_DASHBOARD; and
# optionally TIMER_NAMES, comma-separated, and DOORBELL / DOORBELL_CAMERA to override the doorbell
# pop-up's discovery: entity ids, or DOORBELL="off"; THERMOSTAT_GAP, the least °F a thermostat keeps
# between its heat and cool setpoints (default 5); FRAME_NAME, shown on the start screen (and built
# into the boot animation by kiosk/bootanimation/build.sh); PRESENCE_AREA, an HA area such as kitchen whose
# motion sensors decide when the clock screen comes on (and whose light sensor "Dim when dark" reads);
# LIGHT_SENSOR, a sensor.x illuminance entity to use instead, or "off"; DARK_LUX, the lux at or below
# which the room counts as dark (default 20); TV_AUDIO, "media_player.tv=media_player.soundbar"
# pairs, comma-separated, for TVs whose volume a soundbar handles), plus
# DASHBOARD_KEY from .dev.vars and DASHBOARD_URL from .frame.vars, after # so they never reach the
# server. The page saves them and strips them from the address bar. Usage:
#   open "$(scripts/frame-url.sh)"                       # this Mac's browser
#   adb shell am start -n com.huntsyea.frame/.MainActivity -d "'$(scripts/frame-url.sh)'"   # the frame
# With --clear-pin, the link also removes the unlock PIN (Settings → Home), for a forgotten one.
set -euo pipefail
clear_pin=""; [ "${1:-}" = "--clear-pin" ] && clear_pin=1
cd "$(dirname "$0")/.."
get() { sed -n "s/^$1=\"\(.*\)\"\s*$/\1/p" "$2" | head -1; }
url=$(get DASHBOARD_URL .frame.vars)
[ -n "$url" ] || { echo "Set DASHBOARD_URL in dashboard/.frame.vars" >&2; exit 1; }
python3 -I - "$url" "$(get DASHBOARD_KEY .dev.vars)" "$(get HA_URL .frame.vars)" "$(get HA_TOKEN .frame.vars)" "$(get HA_DASHBOARD .frame.vars)" "$(get TIMER_NAMES .frame.vars)" "$(get DOORBELL .frame.vars)" "$(get DOORBELL_CAMERA .frame.vars)" "$(get PRESENCE_AREA .frame.vars)" "$(get THERMOSTAT_GAP .frame.vars)" "$(get FRAME_NAME .frame.vars)" "$(get TV_AUDIO .frame.vars)" "$(get LIGHT_SENSOR .frame.vars)" "$(get DARK_LUX .frame.vars)" "$clear_pin" <<'PY'
import sys, urllib.parse
url, key, ha_url, ha_token, ha_dash, names, bell, bell_cam, area, gap, fname, tv_audio, light, dark_lux, clear_pin = sys.argv[1:16]
q = {k: v for k, v in [('key', key), ('ha_url', ha_url), ('ha_token', ha_token), ('ha_dashboard', ha_dash), ('timer_names', names), ('doorbell', bell), ('doorbell_camera', bell_cam), ('presence_area', area), ('thermostat_gap', gap), ('frame_name', fname), ('tv_audio', tv_audio), ('light_sensor', light), ('dark_lux', dark_lux), ('clear_pin', clear_pin)] if v}
# After #, not ?: a browser never sends that part, so the key and token stay out of request logs
# (index.html moves it into the query in the page). The kiosk needs 1.10 to not keep it.
print(url.rstrip('/') + '/#' + urllib.parse.urlencode(q))
PY
