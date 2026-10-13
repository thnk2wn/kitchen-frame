#!/bin/bash
# Uploads the Worker's secrets from dashboard/.dev.vars to Cloudflare (`wrangler secret bulk`).
# Values are never printed: they go through a temp file readable only by you, deleted afterwards.
#
#   scripts/push-secrets.sh                      # every non-empty, uncommented setting
#   scripts/push-secrets.sh TODOIST_TOKEN ...    # only these
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .dev.vars ] || { echo "No dashboard/.dev.vars (copy .dev.vars.example)" >&2; exit 1; }
umask 077
tmp=$(mktemp "${TMPDIR:-/tmp}/kf-secrets.XXXXXX")
trap 'rm -f "$tmp"' EXIT
python3 -I - "$tmp" "$@" <<'PY'
import json, re, sys
out, only = sys.argv[1], set(sys.argv[2:])
vals = {}
for line in open('.dev.vars'):
    m = re.match(r'^([A-Z][A-Z0-9_]*)="?(.*?)"?\s*$', line)
    if m and m.group(2) and (not only or m.group(1) in only):
        vals[m.group(1)] = m.group(2)
missing = only - set(vals)
if missing:
    sys.exit('Not set in .dev.vars: ' + ', '.join(sorted(missing)))
json.dump(vals, open(out, 'w'))
print('Uploading:', ', '.join(sorted(vals)))
PY
npx wrangler secret bulk "$tmp"
