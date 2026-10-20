# kiosk

The Android app the frame boots into: one full-screen WebView showing the dashboard, made the
frame's Home app so it comes back after a restart. Needed on an Android frame; in a browser you
don't need it.

What it adds over a plain browser:

- Starts at boot and stays full screen; the dashboard's address is set once with a setup link.
- Lets the https page reach Home Assistant over plain http on the home network.
- Sets the clock itself at boot from a server's Date header when Android's time sync is slow (a
  frame without a clock battery), so the dashboard loads in seconds.
- A brightness bridge for Settings (`window.FrameKiosk.setBrightness`) and its version for the
  status page.
- Its memory for the page's check-in (`window.FrameKiosk.getMemory`, 1.8), so the status page can
  show whether it creeps up.
- Screenshots for the phone app (`window.FrameKiosk.captureTo`, 1.7): the screen captured as root,
  1280 wide, uploaded only to the dashboard's own Worker (`dashboard/worker/screenshot.js`).
- An escape hatch: hold two or more fingers still for 2 seconds for Reload dashboard or Android
  settings.

Build without Gradle, with the plain Android SDK tools (requirements at the top of the script):

```
./build.sh && adb install -r build/frame.apk
```

`bootanimation/` builds the frame's boot animation (its mark and name, drawn by headless Chrome).
Installing both, setting the address, and undoing each change are in
[docs/frame.md](../docs/frame.md). Version history is in the same page's change table.
