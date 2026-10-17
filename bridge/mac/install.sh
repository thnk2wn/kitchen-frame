#!/bin/bash
# Installs the Mac bridge (Reminders lists, Apple calendars, a shared album: whichever the Worker asks for) on this Mac and starts it at login (docs/mac-bridge.md walks through it).
#   1. builds the app into ~/Applications
#   2. asks for the Worker address and BRIDGE_TOKEN (first time only; kept in
#      ~/Library/Application Support/KitchenFrameBridge/config.json, readable only by you)
#   3. opens it once so macOS asks for the access it needs (click Allow): Reminders, Calendar or Photos,
#      each only if the Worker's settings send that source through this Mac
#   4. adds a LaunchAgent so it runs in the background from now on, restarting if it stops
# Run again after pulling changes to update it.
set -euo pipefail
cd "$(dirname "$0")"
label=local.kitchen-frame.reminders-bridge
support="$HOME/Library/Application Support/KitchenFrameBridge"
log="$HOME/Library/Logs/KitchenFrameBridge.log"
agent="$HOME/Library/LaunchAgents/$label.plist"
app="$HOME/Applications/KitchenFrameBridge.app"

./build.sh
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
mkdir -p "$HOME/Applications" "$support" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
rm -rf "$app" && cp -R build/KitchenFrameBridge.app "$app"

# --reconfigure asks for the address and token again (a wrong token shows as "HTTP 401" in the log).
[ "${1:-}" = "--reconfigure" ] && rm -f "$support/config.json"
if [ ! -f "$support/config.json" ]; then
  read -r -p "Worker address (e.g. https://kitchen-frame.example.workers.dev): " worker
  read -r -s -p "BRIDGE_TOKEN (from dashboard/.dev.vars, without the quotes; not shown as you paste): " token; echo
  # Forgive a pasted line's quotes, spaces or a leading BRIDGE_TOKEN=.
  token=$(printf '%s' "$token" | sed -e 's/^[[:space:]]*//' -e 's/^BRIDGE_TOKEN=//' -e 's/^[[:space:]"'"'"']*//' -e 's/[[:space:]"'"'"']*$//')
  worker=$(printf '%s' "$worker" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]/]*$//')
  umask 077
  python3 -c 'import json,sys; print(json.dumps({"worker": sys.argv[1], "token": sys.argv[2]}))' "$worker" "$token" > "$support/config.json"
fi

echo "Opening the bridge once to ask for the access it needs (only for what's set to come from this Mac). If macOS asks, click Allow (Full Access)."
: > "$log"
open -W "$app" --args --check || true
cat "$log"
grep -q "Worker reachable" "$log" || { echo "Couldn't reach the Worker with that address and token (see above). Run: $0 --reconfigure" >&2; exit 1; }
if grep -q "access NOT granted" "$log"; then
  echo "Some access wasn't granted (see above): System Settings > Privacy & Security, turn on Kitchen Frame Bridge, then run this again." >&2; exit 1
fi

cat > "$agent" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$app/Contents/MacOS/KitchenFrameBridge</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <!-- The app writes its own log; this catches anything else (a crash). -->
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/KitchenFrameBridge.err.log</string>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$agent"
sleep 5
echo "Running. Recent log:"
tail -n 8 "$log"
echo "Follow it with: tail -f \"$log\""
