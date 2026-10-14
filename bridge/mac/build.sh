#!/bin/bash
# Builds KitchenFrameBridge.app (a background app, no Dock icon) into bridge/mac/build/.
# Needs Apple's command line tools: xcode-select --install
set -euo pipefail
cd "$(dirname "$0")"
command -v swiftc >/dev/null || { echo "swiftc not found. Install Apple's command line tools: xcode-select --install" >&2; exit 1; }
app=build/KitchenFrameBridge.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp Info.plist "$app/Contents/Info.plist"
swiftc -O -swift-version 5 -framework EventKit KitchenFrameBridge.swift -o "$app/Contents/MacOS/KitchenFrameBridge"
# Ad-hoc signature: enough for macOS to remember the Reminders permission. A rebuild changes it, so
# macOS asks again after reinstalling.
codesign --force --sign - "$app"
echo "Built $app"
