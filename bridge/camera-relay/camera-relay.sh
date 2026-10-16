#!/bin/bash
# The camera relay on an always-on Mac (docs/house.md → "Cameras the frame can't decode"): go2rtc,
# which shrinks Ring cameras the frame can't decode and adds their sound, and relay-gate.py, the
# token check in front of it. Two small background services, managed together here:
#
#   camera-relay.sh install     set up or update both (run again after pulling new code)
#   camera-relay.sh status      are they running, and listening
#   camera-relay.sh restart     restart both (after editing ~/go2rtc/go2rtc.yaml)
#   camera-relay.sh logs        the last lines of both logs
#   camera-relay.sh uninstall   stop both and remove their launch agents (keeps ~/go2rtc)
#
# Why two processes and not one: go2rtc runs from its own app bundle, which holds macOS's Local
# Network permission (without it its ffmpeg can't reach Home Assistant). The gate needs no such
# permission, and folding it into go2rtc's bundle would change the bundle's signature and ask again.
#
# Install expects ~/go2rtc/go2rtc (the go2rtc release binary for macOS) and ~/go2rtc/ffmpeg (a static
# ffmpeg with VideoToolbox), as docs/house.md describes.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/go2rtc"
APP="$DIR/go2rtc.app"
AGENTS="$HOME/Library/LaunchAgents"
GO2RTC=local.kitchen-frame.go2rtc
GATE=local.kitchen-frame.relay-gate
UID_=$(id -u)

agent() { # label, then the program and its arguments
  local label=$1; shift
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo "  <key>Label</key><string>$label</string>"
    echo '  <key>ProgramArguments</key><array>'
    for a in "$@"; do echo "    <string>$a</string>"; done
    echo '  </array>'
    echo "  <key>WorkingDirectory</key><string>$DIR</string>"
    echo '  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>'
    echo '  <key>ThrottleInterval</key><integer>30</integer><key>ProcessType</key><string>Background</string>'
    echo "  <key>StandardOutPath</key><string>$DIR/${label##*.}.log</string>"
    echo "  <key>StandardErrorPath</key><string>$DIR/${label##*.}.log</string>"
    echo '</dict></plist>'
  } > "$AGENTS/$label.plist"
}

load() { # (re)load a launch agent
  launchctl bootout "gui/$UID_/$1" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_" "$AGENTS/$1.plist"
}

install() {
  [ -x "$DIR/go2rtc" ] || [ -x "$APP/Contents/MacOS/go2rtc" ] || { echo "Put the go2rtc binary at $DIR/go2rtc first (docs/house.md)." >&2; exit 1; }
  [ -x "$DIR/ffmpeg" ] || { echo "Put a static ffmpeg at $DIR/ffmpeg first (docs/house.md)." >&2; exit 1; }
  mkdir -p "$AGENTS"

  # go2rtc in a minimal app bundle: macOS grants Local Network access to apps, and asks once.
  # Rebuilt only when the binary changes, since a new signature asks again.
  if [ -x "$DIR/go2rtc" ] && ! cmp -s "$DIR/go2rtc" "$APP/Contents/MacOS/go2rtc" 2>/dev/null; then
    mkdir -p "$APP/Contents/MacOS"
    cp "$DIR/go2rtc" "$APP/Contents/MacOS/go2rtc"
    local v; v=$("$DIR/go2rtc" -version 2>/dev/null | grep -o '[0-9][0-9.]*' | head -1 || echo 1)
    cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>$GO2RTC</string>
  <key>CFBundleName</key><string>go2rtc</string>
  <key>CFBundleExecutable</key><string>go2rtc</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>$v</string>
  <key>LSUIElement</key><true/>
  <key>NSLocalNetworkUsageDescription</key><string>go2rtc pulls camera streams from Home Assistant on the home network and shrinks them for the kitchen frame.</string>
</dict></plist>
EOF
    codesign --force --sign - "$APP"
    echo "go2rtc bundled. macOS may ask whether go2rtc can find devices on the local network: allow it."
  fi

  [ -f "$DIR/go2rtc.yaml" ] || { cp "$HERE/go2rtc.example.yaml" "$DIR/go2rtc.yaml"; echo "Wrote $DIR/go2rtc.yaml from the example: fill in its <…> parts, then run: $0 restart"; }
  cp "$HERE/relay-gate.py" "$DIR/relay-gate.py"
  [ -s "$DIR/relay-gate.token" ] || (umask 077; /usr/bin/python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > "$DIR/relay-gate.token")

  agent "$GO2RTC" "$APP/Contents/MacOS/go2rtc" -config "$DIR/go2rtc.yaml"
  agent "$GATE" /usr/bin/python3 "$DIR/relay-gate.py"
  load "$GO2RTC"
  load "$GATE"
  sleep 2
  status
  cat <<EOF

Last step, from the computer you deploy the dashboard from: store the relay's address in the Worker
(the token never needs to be shown). One address per way of reaching this Mac, space-separated:
  token=\$(ssh $(whoami)@<this mac> cat go2rtc/relay-gate.token)
  printf '%s' "http://<this mac's address>:1985/\$token/?cameras=<name>,<name>" | npx wrangler secret put CAMERA_RELAY
EOF
}

status() {
  for l in "$GO2RTC" "$GATE"; do
    local pid; pid=$(launchctl list | awk -v l="$l" '$3 == l && $1 != "-" { print $1 }')
    if [ -n "$pid" ]; then printf '%-32s running (pid %s)\n' "$l" "$pid"; else printf '%-32s NOT running\n' "$l"; fi
  done
  lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 && /:(1984|1985|8554|8555) / { print "  listening " $9 " (" $1 ")" }' | sort -u
}

case "${1:-}" in
  install) install ;;
  status) status ;;
  restart) launchctl kickstart -k "gui/$UID_/$GO2RTC"; launchctl kickstart -k "gui/$UID_/$GATE"; sleep 2; status ;;
  logs) for f in "$DIR/go2rtc.log" "$DIR/relay-gate.log"; do echo "== $f"; tail -n "${2:-15}" "$f" 2>/dev/null | sed -E 's#(rtsp://[^:/@ ]*:)[^@ ]*@#\1***@#g'; done ;;
  uninstall) for l in "$GO2RTC" "$GATE"; do launchctl bootout "gui/$UID_/$l" 2>/dev/null || true; rm -f "$AGENTS/$l.plist"; done; echo "Stopped and removed both launch agents; $DIR is left as it was." ;;
  *) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
