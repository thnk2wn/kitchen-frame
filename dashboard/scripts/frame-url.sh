#!/bin/bash
# Prints the one-time setup URL for a frame or browser: the dashboard address with its key and the
# Home Assistant settings from the gitignored .frame.vars (HA_URL, HA_TOKEN, HA_DASHBOARD, and
# optionally TIMER_NAMES, comma-separated), plus
# DASHBOARD_KEY from .dev.vars and DASHBOARD_URL from .frame.vars. The page saves them and strips
# them from the address bar. Usage:
#   open "$(scripts/frame-url.sh)"                       # this Mac's browser
#   adb shell am start -n com.huntsyea.frame/.MainActivity -d "'$(scripts/frame-url.sh)'"   # the frame
set -euo pipefail
cd "$(dirname "$0")/.."
get() { sed -n "s/^$1=\"\(.*\)\"\s*$/\1/p" "$2" | head -1; }
url=$(get DASHBOARD_URL .frame.vars)
[ -n "$url" ] || { echo "Set DASHBOARD_URL in dashboard/.frame.vars" >&2; exit 1; }
python3 -I - "$url" "$(get DASHBOARD_KEY .dev.vars)" "$(get HA_URL .frame.vars)" "$(get HA_TOKEN .frame.vars)" "$(get HA_DASHBOARD .frame.vars)" "$(get TIMER_NAMES .frame.vars)" <<'PY'
import sys, urllib.parse
url, key, ha_url, ha_token, ha_dash, names = sys.argv[1:7]
q = {k: v for k, v in [('key', key), ('ha_url', ha_url), ('ha_token', ha_token), ('ha_dashboard', ha_dash), ('timer_names', names)] if v}
print(url.rstrip('/') + '/?' + urllib.parse.urlencode(q))
PY
