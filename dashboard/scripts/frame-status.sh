#!/bin/bash
# What the frame last reported (lib/checkin.js, worker/frame.js): dashboard and kiosk versions, the
# WebView, when the page loaded, what it's showing, and how long ago it checked in. It checks in
# every 10 minutes, so "minutes ago" over about 12 means it's off, offline or not in the kiosk app.
# Also whether the dashboard it runs is the one deployed now. Usage: scripts/frame-status.sh
set -euo pipefail
cd "$(dirname "$0")/.."
key=$(sed -n 's/^DASHBOARD_KEY="\(.*\)"/\1/p' .dev.vars)
url=$(sed -n 's/^DASHBOARD_URL="\(.*\)"/\1/p' .frame.vars); url=${url%/}
status=$(curl -fsS -H "Authorization: Bearer $key" "$url/api/frame/status")
live=$(curl -fsS "$url/" | sed -n 's/.*assets\/index-\([A-Za-z0-9_-]\{1,8\}\).*/\1/p' | head -1)
python3 -I - "$status" "$live" <<'PY'
import json, sys, datetime as dt
s, live = json.loads(sys.argv[1]), sys.argv[2]
if not s: sys.exit('The frame has never checked in.')
ago = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(s['receivedAt'].replace('Z', '+00:00'))).total_seconds() / 60
print(f"Checked in   {ago:.0f} min ago")
print(f"Dashboard    {s.get('version')}" + ('  (the deployed one)' if s.get('version') == live[:len(s.get('version') or '')] else f'  (deployed now: {live}; it reloads once idle)'))
print(f"Kiosk app    {s.get('kiosk') or 'before 1.6'}   WebView {s.get('webview')}")
print(f"Loaded       {s.get('loadedAt')}")
print(f"Showing      {s.get('screen')} · tab {s.get('tab')} · Home Assistant {s.get('ha')}")
PY
