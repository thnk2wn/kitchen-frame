# Bench: profiling on the real frame

Scripts that measure the dashboard on the frame itself, over USB, through ADB and Chrome DevTools. Use
them before and after a change that might cost speed or memory (CLAUDE.md's "measure before and after"),
alongside `?diag` on the screen.

Needs: the frame on USB with ADB authorised, Node 22 or later (for its built-in `WebSocket`), and kiosk
1.2 or later (DevTools open when it's started with `--ez debug true`; the scripts do that and switch it
off again when they finish). They load screens on the frame, so it will show other tabs for a few minutes
and return to Home.

```sh
cd dashboard
node scripts/bench/bench.mjs before          # each screen: load, settle 15 s, sample 10 s
node scripts/bench/interact.mjs before       # tab switches through the tab bar (3 rounds), then scrolling
# … make the change, deploy, then the same with "after"
```

Results print as they go and are saved in `diagnostics/bench/<label>.json` (gitignored; `BENCH_OUT`
changes the folder).

| Script | Measures |
| --- | --- |
| `bench.mjs` | Per screen (Home, Calendar, Fitness, Recipes, Groceries, Media, House, the clock screen): frames a second, frames over 50 ms, 95th-percentile and longest frame, load and first-paint times, DOM nodes, decoded image megapixels, JS heap, and the app's memory as Android counts it (PSS) |
| `interact.mjs` | Tap → painted for each tab (median per tab over the rounds), late frames while switching, then a touch scroll down and up on Recipes, Calendar, House and Groceries |
| `cdp.mjs` | The shared ADB and DevTools plumbing |

A second argument profiles another package instead of the kiosk, such as a browser installed for a
comparison (`org.chromium.chrome`); see [docs/webview.md](../../../docs/webview.md) for how WebView 106
and 138 were compared that way.

Notes:

- The panel refreshes at 50 Hz, so 50 frames a second (a frame every 20 ms) is the ceiling.
- `performance.memory` is rounded off in this WebView; the JS heap comes from DevTools' own metrics.
- The frame's memory rises with each page load in a run; compare runs of the same script, not single
  numbers.
