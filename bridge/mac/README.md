# bridge/mac

The Mac bridge: a small background app (Swift, no Xcode project) for a Mac at home that sends the
Worker the Apple things a server can't reach without a public link, each only if the Worker's
settings ask for it:

- **Apple Reminders lists**, two-way (the frame's ticks and adds go back to Reminders);
- **iCloud calendars**, with their alerts (iCloud's public links leave them out);
- **an iCloud shared album**, sized for the frame's screen, so the album needs no public website.

**Only if you use one of those.** Todoist lists, other calendars and a public album link need no
Mac. It also reports its problems, and whether the camera relay on the same Mac is running, to the
status page.

```
./install.sh          # build, sign, ask macOS for the access the jobs need, start at login
./install.sh --reconfigure   # enter the Worker address and BRIDGE_TOKEN again
./uninstall.sh [--all]
```

| File | |
| --- | --- |
| `KitchenFrameBridge.swift` | The whole app: EventKit (Reminders, Calendar), the Photos framework, the Worker's API |
| `build.sh` | Compiles and signs it with a self-signed certificate made once on the Mac, so macOS keeps its permissions across rebuilds |
| `install.sh`, `uninstall.sh` | The launch agent, the Worker address and token, the first permission prompts |
| `Info.plist`, `AppIcon.icns`, `icon/` | The app bundle's details and its icon (the frame's mark; `icon/make-icon.sh` renders it) |

Setup, what travels, when it sends and troubleshooting: [docs/mac-bridge.md](../../docs/mac-bridge.md).
