#!/bin/bash
# Prints the one-time setup URL for a frame or browser: the dashboard address with its key and the
# Home Assistant settings from the gitignored .frame.vars (HA_URL, HA_TOKEN, HA_DASHBOARD, and
# optionally TIMER_NAMES, comma-separated, and DOORBELL / DOORBELL_CAMERA to override the doorbell
# pop-up's discovery: entity ids, or DOORBELL="off"; THERMOSTAT_GAP, the least °F a thermostat keeps
# between its heat and cool setpoints (default 5); PRESENCE_AREA, an HA area such as kitchen whose
# motion sensors decide when the clock screen comes on), plus
# DASHBOARD_KEY from .dev.vars and DASHBOARD_URL from .frame.vars. The page saves them and strips
# them from the address bar. Usage:
#   open "$(scripts/frame-url.sh)"                       # this Mac's browser
#   adb shell am start -n com.huntsyea.frame/.MainActivity -d "'$(scripts/frame-url.sh)'"   # the frame
set -euo pipefail
cd "$(dirname "$0")/.."
get() { sed -n "s/^$1=\"\(.*\)\"\s*$/\1/p" "$2" | head -1; }
url=$(get DASHBOARD_URL .frame.vars)
[ -n "$url" ] || { echo "Set DASHBOARD_URL in dashboard/.frame.vars" >&2; exit 1; }
python3 -I - "$url" "$(get DASHBOARD_KEY .dev.vars)" "$(get HA_URL .frame.vars)" "$(get HA_TOKEN .frame.vars)" "$(get HA_DASHBOARD .frame.vars)" "$(get TIMER_NAMES .frame.vars)" "$(get DOORBELL .frame.vars)" "$(get DOORBELL_CAMERA .frame.vars)" "$(get PRESENCE_AREA .frame.vars)" "$(get THERMOSTAT_GAP .frame.vars)" <<'PY'
import sys, urllib.parse
url, key, ha_url, ha_token, ha_dash, names, bell, bell_cam, area, gap = sys.argv[1:11]
q = {k: v for k, v in [('key', key), ('ha_url', ha_url), ('ha_token', ha_token), ('ha_dashboard', ha_dash), ('timer_names', names), ('doorbell', bell), ('doorbell_camera', bell_cam), ('presence_area', area), ('thermostat_gap', gap)] if v}
print(url.rstrip('/') + '/?' + urllib.parse.urlencode(q))
PY
