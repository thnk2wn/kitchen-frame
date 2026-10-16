#!/bin/bash
# Renders icon.html with headless Chrome and turns it into ../AppIcon.icns (the bridge app's icon).
# Run after changing icon.html; the .icns is committed, so building the bridge doesn't need Chrome.
set -euo pipefail
cd "$(dirname "$0")"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
tmp=$(mktemp -d)
"$chrome" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 --user-data-dir="$tmp/profile" \
  --window-size=1024,1024 --force-device-scale-factor=1 --screenshot="$tmp/icon.png" "file://$PWD/icon.html" >/dev/null 2>&1
set=$tmp/AppIcon.iconset && mkdir -p "$set"
for s in 16 32 128 256 512; do
  sips -z $s $s "$tmp/icon.png" --out "$set/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$tmp/icon.png" --out "$set/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$set" -o ../AppIcon.icns
cp "$tmp/icon.png" preview.png
rm -rf "$tmp"
echo "Made bridge/mac/AppIcon.icns (preview: bridge/mac/icon/preview.png)"
