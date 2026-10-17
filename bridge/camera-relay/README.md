# bridge/camera-relay

Live video for cameras whose picture is bigger than your frame's video decoder handles: go2rtc on
an always-on Mac shrinks them (on the Mac's video hardware) and adds their sound, and the frame
plays them straight from it.

**Only if** you use Home Assistant cameras for live video, and one of them doesn't play on your
frame (the frame's event log shows `camera.not_playing` with bytes received but 0 frames). On the
Pastigio FRAME156 that's anything over 1920 wide, such as a Ring Spotlight Cam Pro. Without the
relay those cameras show refreshing pictures instead. It has nothing to do with the Mac bridge,
though both can run on the same Mac.

| File | |
| --- | --- |
| `camera-relay.sh` | Installs and runs both pieces at login: `install`, `status`, `restart`, `logs`, `uninstall` |
| `go2rtc.example.yaml` | The go2rtc config to copy and fill in: a video stream per camera for Home Assistant, and the same with sound for the frame |
| `relay-gate.py` | The token check in front of go2rtc's API, which can run commands and so never faces the network |

```
./camera-relay.sh install    # needs ~/go2rtc/go2rtc and ~/go2rtc/ffmpeg first
```

Why it works this way, setup for Ring cameras, and measurements:
[docs/house.md](../../docs/house.md#cameras-the-frame-cant-decode-the-camera-relay).
