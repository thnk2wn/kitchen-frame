#!/bin/bash
# The frame over days, from the Workers Analytics Engine dataset the check-in writes to (worker/frame.js):
#   scripts/frame-metrics.sh [memory] [days]   per hour: the kiosk app's memory (kiosk 1.8+, WebView
#                                              included), the frame's free memory, page reloads. A climb
#                                              between reloads is a leak; flat means no nightly reload.
#   scripts/frame-metrics.sh video [days]      per day and camera: live starts, time to first frame,
#                                              relay offline, fallbacks, failures
#   scripts/frame-metrics.sh stability [days]  per day: check-ins (144 expected), page loads by reason,
#                                              the frame's own reloads, Home Assistant drops, errors
# days defaults to 3 (memory) or 7.
#
# Needs in dashboard/.frame.vars (gitignored; not .dev.vars, whose settings go to the Worker):
#   CF_ACCOUNT_ID="…"            (wrangler whoami)
#   CF_ANALYTICS_TOKEN="…"       a custom API token with Account › Account Analytics › Read only
set -euo pipefail
cd "$(dirname "$0")/.."
get() { sed -n "s/^$1=\"\(.*\)\"[[:space:]]*$/\1/p" .frame.vars | head -1; }
acct=$(get CF_ACCOUNT_ID); token=$(get CF_ANALYTICS_TOKEN)
[ -n "$acct" ] && [ -n "$token" ] || { echo "Set CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN in dashboard/.frame.vars (see the top of this script)." >&2; exit 2; }
report=memory
case "${1:-}" in memory|video|stability) report=$1; shift ;; esac
days=${1:-$([ "$report" = memory ] && echo 3 || echo 7)}
[[ "$days" =~ ^[0-9]+$ ]] || { echo "days must be a number" >&2; exit 2; }

query() {
  curl -fsS -X POST -H "Authorization: Bearer $token" --data-binary "$1" \
    "https://api.cloudflare.com/client/v4/accounts/$acct/analytics_engine/sql" \
    || { echo "The query failed (token, account id, or no data yet)." >&2; exit 1; }
}
since="timestamp > NOW() - INTERVAL '$days' DAY"
case $report in
  memory)
    # double1 pss, double4 avail, double6 upMin (app up), double8 minutes since the page loaded.
    res=$(query "SELECT toStartOfInterval(timestamp, INTERVAL '1' HOUR) AS hour,
      sum(_sample_interval) AS n, round(avg(double1)) AS pss, max(double1) AS pss_max, min(double4) AS free_min,
      min(double8) AS page_min, argMax(blob1, timestamp) AS build
      FROM kitchen_frame_metrics WHERE index1 = 'frame' AND $since GROUP BY hour ORDER BY hour FORMAT JSON") ;;
  video|stability)
    # Events: blob1 event, blob2 about (camera, reason, …), double1 ms (-1 without one). Hourly, so
    # Python can group them into local days.
    res=$(query "SELECT toStartOfInterval(timestamp, INTERVAL '1' HOUR) AS day, blob1 AS event, blob2 AS about,
      sum(_sample_interval) AS n, sum(if(double1 >= 0, 1, 0)) AS timed, sum(if(double1 >= 0, double1, 0.0)) AS ms_sum, max(double1) AS ms_max
      FROM kitchen_frame_metrics WHERE index1 = 'event' AND $since GROUP BY day, event, about ORDER BY day FORMAT JSON")
    checks=$(query "SELECT toStartOfInterval(timestamp, INTERVAL '1' HOUR) AS day, sum(_sample_interval) AS n
      FROM kitchen_frame_metrics WHERE index1 = 'frame' AND $since GROUP BY day ORDER BY day FORMAT JSON") ;;
esac

python3 -I - "$report" "$res" "${checks:-}" <<'PY'
import json, sys, datetime as dt
from collections import defaultdict
report, rows, checks = sys.argv[1], json.loads(sys.argv[2]).get('data', []), json.loads(sys.argv[3] or '{}').get('data', [])
local = lambda s, f: dt.datetime.fromisoformat(s.replace(' ', 'T') + '+00:00').astimezone().strftime(f)
if not rows and not checks: sys.exit('No data yet: the dataset fills from the frame\'s check-ins (every 10 minutes).')
if report == 'video' and not rows: sys.exit('No video or doorbell events in that time.')

if report == 'memory':
    print(f"{'hour':<14} {'checks':>6} {'app MB':>7} {'max':>5} {'free MB':>8}  page    build")
    prev = None
    for r in rows:
        reload = 'reload' if float(r['page_min']) < 60 else ''
        build = r['build'] if r['build'] != prev else ''
        prev = r['build']
        print(f"{local(r['hour'], '%a %-I %p'):<14} {int(r['n']):>6} {int(float(r['pss'])):>7} {int(float(r['pss_max'])):>5} {int(float(r['free_min'])):>8}  {reload:<7} {build}")
    pss = [float(r['pss']) for r in rows]
    print(f"\nApp memory: {int(min(pss))}–{int(max(pss))} MB over {len(rows)} hours.")
    sys.exit()

# The queries bucket by UTC hour; add those up into local days. Day -> event -> about -> totals.
# Keyed by the local date (YYYY-MM-DD, so they sort across a new year), shown as "Tue Oct 20".
by = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: {'n': 0.0, 'timed': 0.0, 'ms_sum': 0.0, 'ms_max': -1.0})))
label = {}
for r in rows + checks: label[local(r['day'], '%Y-%m-%d')] = local(r['day'], '%a %b %-d')
for r in rows:
    t = by[local(r['day'], '%Y-%m-%d')][r['event']][r['about']]
    for k in ('n', 'timed', 'ms_sum'): t[k] += float(r[k])
    t['ms_max'] = max(t['ms_max'], float(r['ms_max']))
seen = defaultdict(int)
for c in checks: seen[local(c['day'], '%Y-%m-%d')] += int(float(c['n']))
days = sorted(set(by) | set(seen))

def n(d, ev, about=None):
    x = by[d].get(ev, {})
    return int(sum(v['n'] for a, v in x.items() if about is None or a == about))

if report == 'video':
    cams = sorted({a for d in by for ev in by[d] if ev.startswith('camera.') for a in by[d][ev]} - {''})
    for d in days:
        print(label[d])
        rings = n(d, 'doorbell.ring')
        bl = [v for v in by[d].get('doorbell.live', {}).values() if v['timed']]
        if rings or bl:
            t = sum(v['timed'] for v in bl)
            print(f"  doorbell rings: {rings}" + (f" · ring to live avg {sum(v['ms_sum'] for v in bl) / t / 1000:.1f} s, slowest {max(v['ms_max'] for v in bl) / 1000:.1f} s" if t else ''))
        for c in cams:
            view = by[d].get('camera.view_live', {}).get(c)
            live = by[d].get('camera.live', {}).get(c)
            parts = []
            if view and view['timed']: parts.append(f"opened to live avg {view['ms_sum'] / view['timed'] / 1000:.1f} s, slowest {view['ms_max'] / 1000:.1f} s")
            if live and live['timed']: parts.append(f"{int(live['n'])} live, avg attempt {live['ms_sum'] / live['timed'] / 1000:.1f} s")
            for ev, word in (('camera.relay_offline', 'relay offline'), ('camera.fallback', 'fell back'), ('camera.live_error', 'failed'),
                             ('camera.no_live', 'no live'), ('camera.not_playing', 'not playing'), ('camera.ice', 'dropped'), ('camera.still_failed', 'still failed')):
                k = n(d, ev, c)
                if k: parts.append(f"{k} {word}")
            if parts: print(f"  {c:<26} " + ' · '.join(parts))
else:
    print(f"{'day':<12} {'check-ins':>9} {'loads':>6}  {'reasons':<28} {'self-reloads':>12} {'HA drops':>8} {'HA down':>8} {'part errors':>11} {'API failed':>10}")
    for d in days:
        loads = by[d].get('app.load', {})
        reasons = ', '.join(f"{a or '?'} {int(v['n'])}" for a, v in sorted(loads.items(), key=lambda x: -x[1]['n']))
        down = by[d].get('ha.connected', {})
        down_s = sum(v['ms_sum'] for v in down.values()) / 1000
        print(f"{label[d]:<12} {seen.get(d, 0):>9} {n(d, 'app.load'):>6}  {reasons[:28]:<28} {n(d, 'frame.selfreload'):>12} {n(d, 'ha.disconnected'):>8} {down_s:>7.0f}s {n(d, 'ui.error'):>11} {n(d, 'api.failed'):>10}")
    print("\n144 check-ins is a full day (one every 10 minutes); fewer means it was off, offline or reloading.")
PY
