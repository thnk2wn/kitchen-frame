#!/bin/bash
# Builds the frame's boot animation (build/bootanimation.zip) from frame.html: an intro of 1.2 s played
# once (the frame draws itself, the sun comes up, the name fades in), then a 3 s loop repeated until
# Android has started (the sun's glow breathes, a warm light drifts across). 15 frames a second, drawn
# by headless Chrome. The zip must be stored, not compressed, for Android to read it.
#
# Install (rooted frame, over adb): Android 8.1 plays /oem/media/bootanimation.zip in preference to
# /system/media/bootanimation.zip, and /oem is its own partition, outside verified boot, so nothing
# in /system changes. See docs/frame.md for the commands and the undo.
set -euo pipefail
cd "$(dirname "$0")"
# The name under the mark: $FRAME_NAME, else FRAME_NAME in dashboard/.frame.vars, else "Kitchen Frame".
name=${FRAME_NAME:-$(sed -n 's/^FRAME_NAME="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' ../../dashboard/.frame.vars 2>/dev/null | head -1)}
name=${name:-Kitchen Frame}
enc=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$name")
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
rm -rf build && mkdir -p build/anim/part0 build/anim/part1
shot() { local prof; prof=$(mktemp -d); "$chrome" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$prof" \
  --window-size=800,480 --force-device-scale-factor=1 --screenshot="$2" "file://$PWD/frame.html#$1&name=$enc" >/dev/null 2>&1; rm -rf "$prof"; }
FPS=15
for i in $(seq 0 $((FPS * 12 / 10 - 1))); do shot "part=intro&t=$(python3 -c "print($i/$FPS)")" "build/anim/part0/$(printf %03d "$i").png"; done
for i in $(seq 0 $((FPS * 3 - 1))); do shot "part=loop&t=$(python3 -c "print($i/$FPS)")" "build/anim/part1/$(printf %03d "$i").png"; done
printf '800 480 15\np 1 0 part0\np 0 0 part1\n' > build/anim/desc.txt
(cd build/anim && zip -0 -q -r ../bootanimation.zip desc.txt part0 part1)
echo "Built kiosk/bootanimation/build/bootanimation.zip (\"$name\")"
