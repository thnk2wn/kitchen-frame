#!/bin/bash
# What a build has to pass before it's deployed, wherever it's deployed from: this Mac
# (scripts/deploy.sh) or Cloudflare's builds (their build command: npm ci && scripts/check.sh).
#   the tests, the build, then the smoke test (scripts/smoke.mjs) when there's a Chrome and the live
#   Worker's address and key to run it with (on this Mac; skipped on Cloudflare's machines, which have
#   no Chrome). SKIP_SMOKE=1 skips it anywhere.
# Any step failing stops here, with what failed, and exits non-zero.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n== %s\n' "$*"; }

step tests
npm test --silent > /dev/null 2>&1 || { npm test 2>&1 | grep -E '^not ok|✖|# fail' | head -20; echo "check: tests failed" >&2; exit 1; }
echo "passed"

step build
npx vite build --logLevel error
built=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/client/index.html | head -1)
[ -n "$built" ] || { echo "check: the build has no page script" >&2; exit 1; }
echo "$built"

chrome=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
if [ "${SKIP_SMOKE:-}" = 1 ]; then
  step "smoke test SKIPPED (SKIP_SMOKE=1)"
elif [ ! -x "$chrome" ] || [ ! -f .dev.vars ] || [ ! -f .frame.vars ]; then
  step "smoke test skipped (no Chrome or no .dev.vars/.frame.vars here)"
else
  step "smoke test"
  # Only failures, retries and the summary: the screens that passed outright aren't news.
  set +e; node scripts/smoke.mjs | grep -v '^ok   [^(]*$'; rc=${PIPESTATUS[0]}; set -e
  [ "$rc" = 0 ] || { echo "check: smoke test failed" >&2; exit 1; }
fi
