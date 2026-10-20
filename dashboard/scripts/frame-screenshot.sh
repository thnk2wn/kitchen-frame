#!/bin/bash
# Takes a screenshot of the frame, the way the phone app's Screenshot does (worker/screenshot.js), and
# saves it: scripts/frame-screenshot.sh [out.jpg] [tab]. With a tab (home, calendar, fitness…) the
# frame shows that tab first. Needs DASHBOARD_KEY in .dev.vars and DASHBOARD_URL in .frame.vars, and
# the kiosk app 1.7 or later on the frame, and jq.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
setting() { sed -nE "s/^$1=\"?([^\"]*)\"?\$/\\1/p" "$here/$2" | head -1; }
key=$(setting DASHBOARD_KEY .dev.vars)
base=$(setting DASHBOARD_URL .frame.vars)
base=$(printf '%s' "$base" | sed -E 's#^(https?://[^/]+).*#\1#')
out=${1:-frame-screenshot.jpg}
tab=${2:-}
[ -n "$key" ] && [ -n "$base" ] || { echo "frame-screenshot: needs DASHBOARD_KEY and DASHBOARD_URL" >&2; exit 2; }

asked=$(curl -sS -X POST -H "Authorization: Bearer $key" -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg tab "$tab" '{tab: $tab}')" "$base/api/frame/screenshot/request")
since=$(printf '%s' "$asked" | jq -r '.asked // empty')
[ -n "$since" ] && [ "$(printf '%s' "$asked" | jq -r '.sent')" != 0 ] || { echo "frame-screenshot: $asked" >&2; exit 1; }

# The frame captures and uploads in a few seconds; give it 30.
for _ in $(seq 1 30); do
  sleep 1
  code=$(curl -sS -o "$out.part" -w '%{http_code}' -H "Authorization: Bearer $key" "$base/api/frame/screenshot?since=$since")
  case $code in
    200) mv "$out.part" "$out"; echo "$out"; exit 0 ;;
    404) ;;
    *) echo "frame-screenshot: $code $(cat "$out.part")" >&2; rm -f "$out.part"; exit 1 ;;
  esac
done
rm -f "$out.part"
echo "frame-screenshot: no screenshot after 30 s (is the frame on, with kiosk 1.7?)" >&2
exit 1
