#!/bin/bash
# The deploy: the checks (scripts/check.sh: tests, build, smoke test), wrangler deploy, then a check that
# the live site serves this build, and a reload of the frame so it shows it now rather than once idle,
# rolled back if the frame got the reload but doesn't come up on the new build. Any step failing stops
# it before the next.
#
# Where it runs from:
#   npm run deploy             this Mac, when there's anything not yet in GitHub's main (changes, or
#                              commits not pushed); with everything pushed, Cloudflare's builds deploy
#                              main on the push, so this says so and stops
#   npm run deploy -- --local  this Mac, whatever is or isn't pushed
#   scripts/deploy.sh --cloud  Cloudflare's builds, after their build command (npm ci && scripts/check.sh)
#                              passed: deploys, then checks the site and the frame with the deploy key
#                              (DASHBOARD_URL and FRAME_STATUS_KEY as build variables)
# SKIP_SMOKE=1 skips the smoke test (about a minute) in an emergency. NO_ROLLBACK=1 keeps the new
# version whatever the frame does. The first deploy, before there's a Worker or a frame (no
# DASHBOARD_URL yet), skips the smoke test and the checks after the deploy by itself.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n== %s\n' "$*"; }
# The page's script, named after its content hash: what tells one build from another.
script_of() { grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1; }

mode=auto
case "${1:-}" in --local) mode=local ;; --cloud) mode=cloud ;; "") ;; *) echo "usage: scripts/deploy.sh [--local|--cloud]" >&2; exit 2 ;; esac
url=${DASHBOARD_URL:-$(sed -n 's/^DASHBOARD_URL="\(.*\)"/\1/p' .frame.vars 2>/dev/null || true)}; url=${url%/}

if [ "$mode" = auto ]; then
  git fetch -q origin 2>/dev/null || true
  if [ -z "$(git status --porcelain -- . 2>/dev/null)" ] && [ "$(git rev-parse HEAD)" = "$(git rev-parse '@{u}' 2>/dev/null)" ]; then
    echo "Everything here is committed and pushed: Cloudflare's builds deploy main on the push (Workers → kitchen-frame → Deployments)."
    echo "To deploy from this Mac anyway: npm run deploy -- --local"
    exit 0
  fi
  echo "Deploying from this Mac: there are changes or commits not yet in GitHub's main."
fi

if [ "$mode" = cloud ]; then
  # Cloudflare's build command has already run the checks on this checkout.
  built=$(script_of < dist/client/index.html)
else
  scripts/check.sh || { echo "deploy: nothing deployed (SKIP_SMOKE=1 to skip the smoke test)" >&2; exit 1; }
  built=$(script_of < dist/client/index.html)
fi
[ -n "$built" ] || { echo "deploy: the build has no page script" >&2; exit 1; }

step deploy
# What to go back to, and whether the frame is there to judge the new build by (it checks in every 10
# minutes; a frame already off or offline isn't the new build's fault).
prev=$(npx wrangler deployments status --json 2>/dev/null | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["versions"][0]["version_id"])' 2>/dev/null || true)
frame_up=""
if [ -n "$url" ]; then
  ago=$(scripts/frame-status.sh 2>/dev/null | sed -n 's/^Checked in *\([0-9]*\) min ago.*/\1/p' || true)
  [ -n "$ago" ] && [ "$ago" -le 12 ] && frame_up=1
fi
if [ -n "$frame_up" ]; then judge="the frame is checking in"; else judge="the frame isn't checking in, so no rollback"; fi
echo "replacing ${prev:-an unknown version}; $judge"
set +e; npx wrangler deploy 2>&1 | grep -E 'Deployed|Version ID|rror'; rc=${PIPESTATUS[0]}; set -e
[ "$rc" = 0 ] || { echo "deploy: wrangler deploy failed" >&2; exit 1; }

[ -n "$url" ] || { echo "No DASHBOARD_URL in .frame.vars yet, so no live-site or frame check."; exit 0; }

step "live site"
live=""
for _ in 1 2 3 4 5 6; do
  live=$(curl -fsS -H 'Cache-Control: no-cache' "$url/" | script_of || true)
  [ "$live" = "$built" ] && break
  perl -e 'sleep 5'
done
[ "$live" = "$built" ] || { echo "deploy: the live site serves ${live:-nothing} rather than $built" >&2; exit 1; }
echo "serves $built"

step frame
# The reload goes over the frame's live connection, which can be down for a moment (it reconnects by
# itself), so it's sent again every 20 seconds until the Worker says a frame got it, and the 3 minutes
# for the new build start then. The wait only reads the frame's status: asking it to check in as well
# would land inside the frame's 10-second guard and swallow a reload sent again.
line=""; delivered=""; i=0
# Up to 5 minutes for a reload to get through, then 3 minutes from when it did.
while [ $i -lt 48 ]; do
  i=$((i + 1))
  [ -z "$delivered" ] && [ $i -gt 30 ] && break
  if [ -z "$delivered" ] && [ $((i % 2)) = 1 ]; then
    n=$(scripts/frame-status.sh --reload 2>/dev/null | sed -n 's/.*(\([0-9]*\) connection.*/\1/p' || true)
    if [ "${n:-0}" -gt 0 ]; then delivered=$i; echo "reload reached the frame"; fi
  fi
  perl -e 'sleep 10'
  line=$(scripts/frame-status.sh 2>/dev/null | grep '^Dashboard' || true)
  case $line in *"the deployed one"*) echo "$line"; exit 0;; esac
  [ -n "$delivered" ] && [ $((i - delivered)) -ge 18 ] && break
done
if [ -z "$delivered" ]; then
  echo "deploy: deployed, but no reload reached the frame in 5 minutes (offline, or its connection down), so no rollback: ${line:-no check-in}" >&2; exit 1
fi
if [ -z "$frame_up" ]; then
  echo "deploy: deployed; the frame wasn't checking in before it either, so no rollback: ${line:-no check-in}" >&2; exit 0
fi
if [ "${NO_ROLLBACK:-}" = 1 ] || [ -z "$prev" ]; then
  echo "deploy: deployed, but the frame hasn't come up on the new build: ${line:-no check-in}" >&2; exit 1
fi
step "rollback"
echo "The frame got the reload but hasn't come up on $built in 3 minutes: ${line:-no check-in}"
set +e; npx wrangler rollback "$prev" -y -m "deploy.sh: the frame didn't come up on $built" 2>&1 | grep -E 'SUCCESS|rror'; rc=${PIPESTATUS[0]}; set -e
[ "$rc" = 0 ] || { echo "deploy: the frame didn't come up on $built, and the ROLLBACK FAILED; run: npx wrangler rollback $prev" >&2; exit 1; }
scripts/frame-status.sh --reload || true
echo "deploy: ROLLED BACK to $prev and reloaded the frame. Look at scripts/frame-status.sh --log 40 for why." >&2
exit 1
