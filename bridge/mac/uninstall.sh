#!/bin/bash
# Stops the Reminders bridge and removes it. Keeps config.json unless you pass --all.
set -euo pipefail
label=local.kitchen-frame.reminders-bridge
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$label.plist"
rm -rf "$HOME/Applications/KitchenFrameBridge.app"
[ "${1:-}" = "--all" ] && rm -rf "$HOME/Library/Application Support/KitchenFrameBridge"
echo "Removed. (Reminders access stays listed in System Settings until you remove it there.)"
