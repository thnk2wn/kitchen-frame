#!/bin/bash
# Makes a key for something other than the frame or a phone (worker/devices.js), with the admin key.
# The key is never printed or written to a file.
#   scripts/device-token.sh ops     the status page's (the Ops summary and nothing else), stored as the
#                                   status page Worker's OPS_KEY secret (ops/)
#   scripts/device-token.sh deploy  Cloudflare's builds' (the frame's status and a reload, nothing else),
#                                   put on the clipboard to paste as the FRAME_STATUS_KEY build variable
#                                   (Workers → kitchen-frame → Settings → Builds → Variables, encrypted)
# Then remove the admin key from the status page: npx wrangler secret delete DASHBOARD_KEY --config ops/wrangler.jsonc
# The frame and phones get their keys themselves (the frame from its setup link, a phone by pairing).
set -euo pipefail
cd "$(dirname "$0")/.."
role=${1:-}
[ "$role" = ops ] || [ "$role" = deploy ] || { echo "usage: scripts/device-token.sh ops|deploy" >&2; exit 2; }
name=$([ "$role" = ops ] && echo "Status page" || echo "Cloudflare builds")
key=$(sed -n 's/^DASHBOARD_KEY="\(.*\)"/\1/p' .dev.vars)
url=$(sed -n 's/^DASHBOARD_URL="\(.*\)"/\1/p' .frame.vars); url=${url%/}
[ -n "$key" ] && [ -n "$url" ] || { echo "needs DASHBOARD_KEY in .dev.vars and DASHBOARD_URL in .frame.vars" >&2; exit 2; }
# The admin key goes to curl on stdin (-H @-), not its command line, where ps would show it.
token=$(printf 'Authorization: Bearer %s\n' "$key" | curl -fsS -X POST -H @- -H 'Content-Type: application/json' -d "{\"role\":\"$role\",\"name\":\"$name\"}" "$url/api/devices" \
  | python3 -I -c 'import json,sys; t=json.load(sys.stdin).get("token",""); print(t if t.startswith("kfd_") else "")')
unset key
[ -n "$token" ] || { echo "the Worker didn't return a key" >&2; exit 1; }
if [ "$role" = deploy ]; then
  printf '%s' "$token" | pbcopy
  unset token
  echo "The deploy key is on the clipboard: paste it as FRAME_STATUS_KEY (encrypted) in Cloudflare's build variables, then copy something else over it. It shows on the frame under Settings → About → Devices as \"Cloudflare builds\"."
  exit 0
fi
printf '%s' "$token" | npx wrangler secret put OPS_KEY --config ops/wrangler.jsonc >/dev/null
unset token
echo "OPS_KEY set on the status page's Worker. It shows under Settings → About → Devices on the frame as \"Status page\"."
