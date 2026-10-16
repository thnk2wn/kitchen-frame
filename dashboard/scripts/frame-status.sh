#!/bin/bash
# What the frame last reported (lib/checkin.js, worker/frame.js): dashboard and kiosk versions, the
# WebView, when the page loaded, what it's showing, and how long ago it checked in. It checks in
# every 10 minutes, so "minutes ago" over about 12 means it's off, offline or not in the kiosk app.
# Also whether the dashboard it runs is the one deployed now. Usage: scripts/frame-status.sh
# With --log, also the frame's recent events (lib/log.svelte.js), oldest first; --log N for the last N.
# With --now first, it asks the frame to check in at once (over its live connection) and waits for it:
#   scripts/frame-status.sh --now --log 30
# --reload asks it to reload the dashboard (sending its events first), e.g. to pick up a deploy.
set -euo pipefail
cd "$(dirname "$0")/.."
key=$(sed -n 's/^DASHBOARD_KEY="\(.*\)"/\1/p' .dev.vars)
url=$(sed -n 's/^DASHBOARD_URL="\(.*\)"/\1/p' .frame.vars); url=${url%/}
if [ "${1:-}" = "--reload" ]; then
  sent=$(curl -fsS -X POST -H "Authorization: Bearer $key" "$url/api/frame/reload" | python3 -I -c 'import json,sys; print(json.load(sys.stdin).get("sent", 0))')
  echo "Asked the frame to reload ($sent connection(s))."; exit 0
fi
if [ "${1:-}" = "--now" ]; then
  shift
  sent=$(curl -fsS -X POST -H "Authorization: Bearer $key" "$url/api/frame/checkin" | python3 -I -c 'import json,sys; print(json.load(sys.stdin).get("sent", 0))')
  if [ "$sent" = "0" ]; then echo "The frame isn't connected right now; showing its last check-in."
  else echo "Asked the frame to check in ($sent connection(s)); waiting..."; perl -e 'sleep 6'; fi
fi
status=$(curl -fsS -H "Authorization: Bearer $key" "$url/api/frame/status")
live=$(curl -fsS "$url/" | sed -n 's/.*assets\/index-\([A-Za-z0-9_-]\{1,8\}\).*/\1/p' | head -1)
python3 -I - "$status" "$live" "${1:-}" "${2:-40}" <<'PY'
import json, sys, datetime as dt
s, live, mode, count = json.loads(sys.argv[1]), sys.argv[2], sys.argv[3], int(sys.argv[4] or 40)
if not s: sys.exit('The frame has never checked in.')
ago = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(s['receivedAt'].replace('Z', '+00:00'))).total_seconds() / 60
print(f"Checked in   {ago:.0f} min ago")
print(f"Dashboard    {(s.get('release') + '  build ') if s.get('release') else ''}{s.get('version')}" + ('  (the deployed one)' if s.get('version') == live[:len(s.get('version') or '')] else f'  (deployed now: {live}; it reloads once idle)'))
print(f"Kiosk app    {s.get('kiosk') or 'before 1.6'}   WebView {s.get('webview')}")
print(f"Loaded       {s.get('loadedAt')}")
print(f"Showing      {s.get('screen')} · tab {s.get('tab')} · Home Assistant {s.get('ha')}")
if mode == '--log':
    events = (s.get('log') or [])[-count:]
    print(f"\nLast {len(events)} events (sent with each check-in, so up to 10 minutes behind):")
    for e in events:
        t = dt.datetime.fromisoformat(e['t'].replace('Z', '+00:00')).astimezone().strftime('%a %-I:%M:%S %p')
        rest = ', '.join(f"{k}: {v}" for k, v in e.items() if k not in ('t', 'event', 'level'))
        mark = {'error': '!! ', 'warn': ' ! '}.get(e.get('level'), '   ')
        print(f"{mark}{t}  {e['event']}" + (f"  ({rest})" if rest else ''))
PY
