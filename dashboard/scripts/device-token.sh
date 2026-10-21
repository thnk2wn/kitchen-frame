#!/bin/bash
# Makes the status page's own key (worker/devices.js, role ops: the Ops summary and nothing else) with
# the admin key, and stores it as the status page Worker's OPS_KEY secret (ops/). The key is never
# printed or written to a file. Run from dashboard/:  scripts/device-token.sh ops
# Then remove the admin key from the status page: npx wrangler secret delete DASHBOARD_KEY --config ops/wrangler.jsonc
# The frame and phones get their keys themselves (the frame from its setup link, a phone by pairing).
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${1:-}" = ops ] || { echo "usage: scripts/device-token.sh ops" >&2; exit 2; }
key=$(sed -n 's/^DASHBOARD_KEY="\(.*\)"/\1/p' .dev.vars)
url=$(sed -n 's/^DASHBOARD_URL="\(.*\)"/\1/p' .frame.vars); url=${url%/}
[ -n "$key" ] && [ -n "$url" ] || { echo "needs DASHBOARD_KEY in .dev.vars and DASHBOARD_URL in .frame.vars" >&2; exit 2; }
# The admin key goes to curl on stdin (-H @-), not its command line, where ps would show it.
token=$(printf 'Authorization: Bearer %s\n' "$key" | curl -fsS -X POST -H @- -H 'Content-Type: application/json' -d '{"role":"ops","name":"Status page"}' "$url/api/devices" \
  | python3 -I -c 'import json,sys; t=json.load(sys.stdin).get("token",""); print(t if t.startswith("kfd_") else "")')
unset key
[ -n "$token" ] || { echo "the Worker didn't return a key" >&2; exit 1; }
printf '%s' "$token" | npx wrangler secret put OPS_KEY --config ops/wrangler.jsonc >/dev/null
unset token
echo "OPS_KEY set on the status page's Worker. It shows under Settings → About → Devices on the frame as \"Status page\"."
